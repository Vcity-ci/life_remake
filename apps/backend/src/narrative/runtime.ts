import { randomUUID } from "node:crypto";
import type { DecisionType, NarrativeAgentAttemptRecord, NarrativeAttributePolicy, NarrativeFactResolution, NarrativeWorldDefinition, WorldConfig } from "@reroll/shared";
import {
  generateDynamicNarrativeScene,
  generateDirectedDecisionNarrativeOutcome,
  generateEndingNarrative,
  generateNarrativeHorizonPlan,
  generateNarrativeTurnPlan,
  refineNarrativeProse,
  type DynamicNarrativeSceneInput,
  type DynamicNarrativeSceneResult,
  type DirectedDecisionNarrativeOutcome,
  type NarrativeContext
} from "../ai.js";
import type { InternalRunState } from "../engine.js";
import { buildNarrativePromptPlan, type NarrativePromptPlan } from "../narrative.js";
import type { NarrativeTurnEnvelope, NarrativeTurnPlan } from "./turn.js";

export interface NarrativeAgentTurnInput {
  run: InternalRunState;
  world: WorldConfig;
  narrativeWorld: NarrativeWorldDefinition;
  context: NarrativeContext;
  envelope: NarrativeTurnEnvelope;
  buildRenderInput: (plan: NarrativeTurnPlan, promptPlan: NarrativePromptPlan) => Omit<DynamicNarrativeSceneInput, "plan">;
}

export interface NarrativeAgentTurnResult {
  attemptId: string;
  plan: NarrativeTurnPlan;
  scene: DynamicNarrativeSceneResult;
}

function appendAttempt(
  run: InternalRunState,
  input: Omit<NarrativeAgentAttemptRecord, "id" | "createdAt" | "contextFragmentIds"> & { contextFragmentIds?: string[] }
): void {
  const record: NarrativeAgentAttemptRecord = {
    ...input,
    id: `${input.attemptId}:${input.stage}`,
    contextFragmentIds: input.contextFragmentIds ?? [],
    createdAt: Date.now()
  };
  run.narrative.agentAttempts = [...run.narrative.agentAttempts.filter((entry) => entry.id !== record.id), record].slice(-48);
}

function contextFragmentIds(ctx: NarrativeContext): string[] {
  return ctx.lastContextManifest?.fragments.map((fragment) => fragment.id) ?? [];
}

function currentHorizonIsUsable(run: InternalRunState, actId: string): boolean {
  return run.narrative.horizonPlan?.status === "active" && run.narrative.horizonPlan.actId === actId;
}

async function ensureNarrativeHorizon(input: NarrativeAgentTurnInput, attemptId: string): Promise<void> {
  const { run, world, context, envelope } = input;
  if (currentHorizonIsUsable(run, envelope.act.id)) {
    envelope.horizon = run.narrative.horizonPlan;
    return;
  }
  const previousRevision = run.narrative.horizonPlan?.revision ?? 0;
  const horizon = await generateNarrativeHorizonPlan(run, world, {
    callId: `${envelope.callId}:horizon:${previousRevision + 1}`,
    worldId: envelope.worldId,
    act: envelope.act,
    beat: envelope.beat,
    routes: envelope.routes,
    factions: envelope.factions,
    focusReferences: envelope.focusReferences,
    previousCanon: (context.narrativePlan?.actCanon ?? []).map((canon) => ({ actId: canon.actId, text: canon.text })),
    memoryDigests: (context.narrativePlan?.memoryDigests ?? []).map((digest) => ({ id: digest.id, text: digest.text })),
    throughEpisodeId: run.narrative.episodes.at(-1)?.id,
    nextRevision: previousRevision + 1
  }, context);
  run.narrative.horizonPlan = horizon;
  envelope.horizon = horizon;
  appendAttempt(run, {
    callId: envelope.callId,
    attemptId,
    task: "horizon",
    source: envelope.source,
    stage: "horizon",
    actId: envelope.act.id,
    beat: envelope.beat,
    horizonRevision: horizon.revision,
    digestRevision: run.narrative.memoryRevision,
    contextFragmentIds: contextFragmentIds(context)
  });
}

export async function runNarrativeAgentTurn(input: NarrativeAgentTurnInput): Promise<NarrativeAgentTurnResult> {
  const { run, world, narrativeWorld, context, envelope } = input;
  const attemptId = `attempt:${randomUUID()}`;
  appendAttempt(run, {
    callId: envelope.callId,
    attemptId,
    task: "dynamic",
    source: envelope.source,
    stage: "prepare",
    actId: envelope.act.id,
    beat: envelope.beat,
    digestRevision: run.narrative.memoryRevision
  });

  const backgroundOnly = envelope.allowedTurnKinds.length === 1 && envelope.allowedTurnKinds[0] === "background";
  if (!backgroundOnly) await ensureNarrativeHorizon(input, attemptId);
  const plan: NarrativeTurnPlan = backgroundOnly
    ? {
        callId: envelope.callId,
        turnKind: "background",
        focusRefs: [],
        sceneGoal: `叙述${envelope.backgroundAgeRange.fromAge}岁至${envelope.backgroundAgeRange.toAge}岁的人生变化`,
        presentation: "summary",
        clockRequest: "advance"
      }
    : await generateNarrativeTurnPlan(run, world, envelope, context);
  appendAttempt(run, {
    callId: envelope.callId,
    attemptId,
    task: "planning",
    source: envelope.source,
    stage: "plan",
    actId: envelope.act.id,
    beat: envelope.beat,
    routeId: plan.routeId,
    factionId: plan.factionId,
    horizonRevision: run.narrative.horizonPlan?.revision,
    digestRevision: run.narrative.memoryRevision,
    contextFragmentIds: contextFragmentIds(context)
  });

  const renderTask = plan.turnKind === "background" ? "background" : "rendering";
  const promptPlan = buildNarrativePromptPlan(run, narrativeWorld, plan.routeId ?? null, renderTask, {
    backgroundAllowed: plan.turnKind === "background",
    factionIds: plan.factionId ? [plan.factionId] : undefined,
    focusIds: plan.focusRefs
  });
  if (!promptPlan) throw new Error("narrative_agent_prompt_plan_missing");
  context.narrativePlan = promptPlan;
  let scene = await generateDynamicNarrativeScene(run, world, { ...input.buildRenderInput(plan, promptPlan), plan }, context);
  appendAttempt(run, {
    callId: envelope.callId,
    attemptId,
    task: renderTask,
    source: plan.turnKind,
    stage: "render",
    actId: envelope.act.id,
    beat: envelope.beat,
    routeId: scene.routeId,
    factionId: scene.factionId,
    horizonRevision: run.narrative.horizonPlan?.revision,
    digestRevision: run.narrative.memoryRevision,
    contextFragmentIds: contextFragmentIds(context)
  });

  if (scene.turnKind === "scene") {
    const reviewed = await refineNarrativeProse(run, world, {
      callId: envelope.callId,
      task: scene.createsDecision ? "choice" : "scene",
      ageLabel: `${envelope.sceneAge}岁`,
      sceneGoal: plan.sceneGoal,
      narrative: scene.narrative,
      background: scene.milestoneCopy?.background
    }, context);
    scene = {
      ...scene,
      narrative: reviewed.narrative,
      milestoneCopy: scene.milestoneCopy && reviewed.background
        ? { ...scene.milestoneCopy, background: reviewed.background }
        : scene.milestoneCopy
    };
    appendAttempt(run, {
      callId: envelope.callId,
      attemptId,
      task: "reviewing",
      source: "scene",
      stage: "review",
      actId: envelope.act.id,
      beat: envelope.beat,
      routeId: scene.routeId,
      factionId: scene.factionId,
      horizonRevision: run.narrative.horizonPlan?.revision,
      digestRevision: run.narrative.memoryRevision,
      contextFragmentIds: contextFragmentIds(context)
    });
  }
  return { attemptId, plan, scene };
}

export function commitNarrativeAgentTurn(run: InternalRunState, attemptId: string, episodeId: string): void {
  const previous = [...run.narrative.agentAttempts].reverse().find((entry) => entry.attemptId === attemptId);
  if (!previous) return;
  appendAttempt(run, {
    callId: previous.callId,
    attemptId,
    task: previous.task,
    source: previous.source,
    stage: "commit",
    actId: previous.actId,
    beat: previous.beat,
    routeId: previous.routeId,
    factionId: previous.factionId,
    horizonRevision: previous.horizonRevision,
    digestRevision: previous.digestRevision,
    episodeId
  });
}

export function invalidateNarrativeHorizon(run: InternalRunState): void {
  if (run.narrative.horizonPlan) run.narrative.horizonPlan.status = "stale";
}

export async function runNarrativeAgentDecision(input: {
  run: InternalRunState;
  world: WorldConfig;
  context: NarrativeContext;
  callId: string;
  decision: { decision: DecisionType; label: string; description: string; attributePolicy: NarrativeAttributePolicy; factResolutionModes?: NarrativeFactResolution[] };
}): Promise<{ attemptId: string; outcome: DirectedDecisionNarrativeOutcome }> {
  const attemptId = `attempt:${randomUUID()}`;
  appendAttempt(input.run, {
    callId: input.callId,
    attemptId,
    task: "decision",
    source: "decision",
    stage: "prepare",
    actId: input.run.narrative.actRuntime?.actId,
    beat: input.run.narrative.actRuntime?.beat,
    horizonRevision: input.run.narrative.horizonPlan?.revision,
    digestRevision: input.run.narrative.memoryRevision
  });
  const outcome = await generateDirectedDecisionNarrativeOutcome(input.run, input.world, input.decision, input.context);
  appendAttempt(input.run, {
    callId: input.callId,
    attemptId,
    task: "decision",
    source: "decision",
    stage: "review",
    actId: input.run.narrative.actRuntime?.actId,
    beat: input.run.narrative.actRuntime?.beat,
    horizonRevision: input.run.narrative.horizonPlan?.revision,
    digestRevision: input.run.narrative.memoryRevision,
    contextFragmentIds: contextFragmentIds(input.context)
  });
  return { attemptId, outcome };
}

export async function runNarrativeAgentEnding(input: {
  run: InternalRunState;
  world: WorldConfig;
  context: NarrativeContext;
  callId: string;
}): Promise<{ attemptId: string; narrative: string }> {
  const attemptId = `attempt:${randomUUID()}`;
  appendAttempt(input.run, {
    callId: input.callId,
    attemptId,
    task: "ending",
    source: "ending",
    stage: "prepare",
    actId: input.run.narrative.actRuntime?.actId,
    beat: input.run.narrative.actRuntime?.beat,
    horizonRevision: input.run.narrative.horizonPlan?.revision,
    digestRevision: input.run.narrative.memoryRevision
  });
  const narrative = await generateEndingNarrative(input.run, input.world, input.context);
  appendAttempt(input.run, {
    callId: input.callId,
    attemptId,
    task: "ending",
    source: "ending",
    stage: "review",
    actId: input.run.narrative.actRuntime?.actId,
    beat: input.run.narrative.actRuntime?.beat,
    horizonRevision: input.run.narrative.horizonPlan?.revision,
    digestRevision: input.run.narrative.memoryRevision,
    contextFragmentIds: contextFragmentIds(input.context)
  });
  return { attemptId, narrative };
}
