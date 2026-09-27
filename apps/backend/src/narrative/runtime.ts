import { randomUUID } from "node:crypto";
import type { DecisionType, NarrativeAgentAttemptRecord, NarrativeAttributePolicy, NarrativeBeatObservation, NarrativeFactResolution, NarrativeStoryPackSnapshot, NarrativeWorldDefinition, WorldConfig } from "@reroll/shared";
import {
  generateDynamicNarrativeScene,
  generateDirectedDecisionSettlement,
  generateEndingNarrative,
  generateNarrativeHorizonPlan,
  generateNarrativeTurnPlan,
  observeNarrativeBeat,
  renderDirectedDecisionNarrative,
  synchronizeNarrativeContinuity,
  refineNarrativeProse,
  shouldRefineNarrativeProse,
  buildNarrativeContinuityWriteSet,
  hasNarrativeContinuityWork,
  narrativeContinuityWritableSet,
  type DynamicNarrativeSceneInput,
  type DynamicNarrativeSceneResult,
  type DirectedDecisionNarrativeOutcome,
  type NarrativeContext
} from "../ai.js";
import type { InternalRunState } from "../engine.js";
import { buildNarrativePromptPlan, type NarrativePromptPlan } from "../narrative.js";
import { narrativeProseProfile } from "../narrative-prompts.js";
import type { NarrativeTurnEnvelope, NarrativeTurnPlan } from "./turn.js";

export interface NarrativeAgentTurnInput {
  run: InternalRunState;
  world: WorldConfig;
  narrativeWorld: NarrativeWorldDefinition;
  context: NarrativeContext;
  envelope: NarrativeTurnEnvelope;
  buildRenderInput: (plan: NarrativeTurnPlan, promptPlan: NarrativePromptPlan) => Omit<DynamicNarrativeSceneInput, "plan">;
  onProgress?: (stage: "settling" | "rendering" | "syncing") => Promise<void> | void;
}

export interface NarrativeAgentTurnResult {
  attemptId: string;
  plan: NarrativeTurnPlan;
  scene: DynamicNarrativeSceneResult;
}

interface NarrativeTurnBrief {
  id: string;
  plan: NarrativeTurnPlan;
  promptPlan: NarrativePromptPlan;
  focusIds: string[];
  worldCardIds: string[];
}

function createNarrativeTurnBrief(
  attemptId: string,
  plan: NarrativeTurnPlan,
  promptPlan: NarrativePromptPlan
): NarrativeTurnBrief {
  return {
    id: `${attemptId}:brief`,
    plan,
    promptPlan,
    focusIds: Array.from(new Set([
      ...plan.focusRefs,
      ...(promptPlan.recall?.facts.map((entry) => entry.id) ?? []),
      ...(promptPlan.recall?.characters.map((entry) => entry.id) ?? []),
      ...(promptPlan.recall?.assetSources?.map((entry) => entry.id) ?? [])
    ])),
    worldCardIds: promptPlan.activeWorldCardSources?.map((entry) => entry.id) ?? []
  };
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
  return run.narrative.horizonPlan?.status === "active" && run.narrative.horizonPlan.actId === actId &&
    run.narrative.horizonPlan.intents.some((intent) => intent.status === "active");
}

function applyHorizonObservation(run: InternalRunState, observation: NarrativeBeatObservation, intentId?: string): void {
  const horizon = run.narrative.horizonPlan;
  if (!horizon || horizon.status !== "active") return;
  if (observation.horizonDecision === "replan") {
    horizon.status = "stale";
    return;
  }
  if (observation.horizonDecision === "consume" && intentId) {
    const intent = horizon.intents.find((entry) => entry.id === intentId);
    if (intent) intent.status = "consumed";
  }
  if (!horizon.intents.some((intent) => intent.status === "active")) horizon.status = "stale";
}

function storyProgressForObservation(run: InternalRunState): string {
  const digest = run.narrative.memoryDigests.find((entry) => entry.id === "run");
  const covered = new Set(digest?.coveredEpisodeIds ?? []);
  const memories = new Map(run.narrative.memoryEntries.map((entry) => [entry.id, entry.text]));
  const pending = run.narrative.episodes
    .filter((episode) => !covered.has(episode.id))
    .slice(-2)
    .map((episode) => episode.storyDelta || episode.memoryIds.map((id) => memories.get(id)).filter(Boolean).join("\n"))
    .filter(Boolean);
  return [digest?.summary, ...pending].filter(Boolean).join("；");
}

function activeFactsForObservation(run: InternalRunState, actId: string) {
  return (run.story.factLedger?.facts ?? [])
    .filter((fact) => fact.status === "open" && (!fact.actId || fact.actId === actId))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || b.lastTouchedAge - a.lastTouchedAge)
    .slice(0, 12)
    .map((fact) => ({ id: fact.id, state: fact.progressSummary ?? fact.label, actId: fact.actId }));
}

function activeStoryPackAct(world: NarrativeWorldDefinition, actId: string) {
  const storyPack = (world as NarrativeWorldDefinition & { storyPack?: NarrativeStoryPackSnapshot }).storyPack;
  return storyPack?.acts.find((entry) => entry.id === actId);
}

async function ensureNarrativeHorizon(input: NarrativeAgentTurnInput, attemptId: string): Promise<void> {
  const { run, world, narrativeWorld, context, envelope } = input;
  if (currentHorizonIsUsable(run, envelope.act.id)) {
    envelope.horizon = run.narrative.horizonPlan;
    return;
  }
  const previousRevision = run.narrative.horizonPlan?.revision ?? 0;
  const previousPlan = context.narrativePlan;
  const horizonPlan = buildNarrativePromptPlan(run, narrativeWorld, null, "horizon", {
    factionIds: envelope.socialForces.map((force) => force.id),
    focusIds: envelope.focusReferences.map((entry) => entry.id)
  });
  if (!horizonPlan) throw new Error("narrative_horizon_prompt_plan_missing");
  context.narrativePlan = horizonPlan;
  let horizon: Awaited<ReturnType<typeof generateNarrativeHorizonPlan>>;
  try {
    horizon = await generateNarrativeHorizonPlan(run, world, {
      callId: `${envelope.callId}:horizon:${previousRevision + 1}`,
      worldId: envelope.worldId,
      act: envelope.act,
      beat: envelope.beat,
      storyPatterns: envelope.storyPatterns,
      socialForces: envelope.socialForces,
      focusReferences: envelope.focusReferences,
      previousCanon: (horizonPlan.actCanon ?? []).map((canon) => ({ actId: canon.actId, text: canon.text })),
      memoryDigests: (horizonPlan.memoryDigests ?? []).filter((digest) => digest.id === "run").map((digest) => ({ id: digest.id, text: digest.text })),
      recentChanges: envelope.recentChanges,
      throughEpisodeId: run.narrative.episodes.at(-1)?.id,
      nextRevision: previousRevision + 1
    }, context);
  } finally {
    context.narrativePlan = previousPlan;
  }
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

  const backgroundOnly = envelope.capabilities.length === 1 && envelope.capabilities[0] === "background";
  if (!backgroundOnly) await ensureNarrativeHorizon(input, attemptId);
  const plan: NarrativeTurnPlan = backgroundOnly
    ? {
        callId: envelope.callId,
        turnKind: "background",
        patternIds: [],
        forceIds: [],
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
    routeId: plan.patternIds[0],
    factionId: plan.forceIds[0],
    horizonRevision: run.narrative.horizonPlan?.revision,
    digestRevision: run.narrative.memoryRevision,
    contextFragmentIds: contextFragmentIds(context)
  });

  const renderTask = plan.turnKind === "background" ? "background" : "rendering";
  const promptPlan = buildNarrativePromptPlan(run, narrativeWorld, null, renderTask, {
    backgroundAllowed: plan.turnKind === "background",
    factionIds: plan.forceIds,
    patternIds: plan.patternIds,
    focusIds: plan.focusRefs,
    semanticQuery: plan.sceneGoal
  });
  if (!promptPlan) throw new Error("narrative_agent_prompt_plan_missing");
  const brief = createNarrativeTurnBrief(attemptId, plan, promptPlan);
  context.narrativePlan = brief.promptPlan;
  await input.onProgress?.("settling");
  let scene = await generateDynamicNarrativeScene(
    run,
    world,
    { ...input.buildRenderInput(brief.plan, brief.promptPlan), plan: brief.plan },
    context,
    () => input.onProgress?.("rendering")
  );
  appendAttempt(run, {
    callId: envelope.callId,
    attemptId,
    task: renderTask,
    source: plan.turnKind,
    stage: "render",
    actId: envelope.act.id,
    beat: envelope.beat,
    routeId: scene.patternIds[0],
    factionId: scene.forceIds[0],
    horizonRevision: run.narrative.horizonPlan?.revision,
    digestRevision: run.narrative.memoryRevision,
    briefId: brief.id,
    focusIds: brief.focusIds,
    worldCardIds: brief.worldCardIds,
    contextFragmentIds: contextFragmentIds(context)
  });

  {
    const proseProfile = narrativeProseProfile(plan.presentation, envelope.beat);
    const reviewInput = {
      callId: envelope.callId,
      task: scene.turnKind === "background" ? "background" as const : scene.createsDecision ? "choice" as const : "scene" as const,
      ageLabel: scene.turnKind === "background"
        ? `${envelope.backgroundAgeRange.fromAge}-${envelope.backgroundAgeRange.toAge}岁`
        : `${envelope.sceneAge}岁`,
      sceneGoal: plan.sceneGoal,
      narrative: scene.narrative,
      background: scene.milestoneCopy?.background,
      targetMinLength: proseProfile.targetMinLength,
      targetMaxLength: proseProfile.targetMaxLength,
      reviewAtLength: proseProfile.reviewAtLength,
      maxLength: proseProfile.hardMaxLength,
      backgroundTargetMaxLength: proseProfile.backgroundTargetMaxLength,
      backgroundMaxLength: proseProfile.backgroundHardMaxLength,
      interactionState: scene.createsDecision ? "choice_pending" as const : "none" as const
    };
    if (shouldRefineNarrativeProse(reviewInput)) {
      const reviewPlan = buildNarrativePromptPlan(run, narrativeWorld, null, "reviewing", {
        factionIds: scene.forceIds,
        patternIds: scene.patternIds,
        focusIds: plan.focusRefs
      });
      if (!reviewPlan) throw new Error("narrative_review_prompt_plan_missing");
      context.narrativePlan = reviewPlan;
      const reviewed = await refineNarrativeProse(run, world, reviewInput, context);
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
        source: scene.turnKind,
        stage: "review",
        actId: envelope.act.id,
        beat: envelope.beat,
        routeId: scene.patternIds[0],
        factionId: scene.forceIds[0],
        horizonRevision: run.narrative.horizonPlan?.revision,
        digestRevision: run.narrative.memoryRevision,
        briefId: brief.id,
        focusIds: brief.focusIds,
        worldCardIds: brief.worldCardIds,
        contextFragmentIds: contextFragmentIds(context)
      });
    }
  }
  const writeSet = buildNarrativeContinuityWriteSet(
    run,
    narrativeContinuityWritableSet(run, promptPlan),
    scene.continuityRefs
  );
  let continuityStatus: NarrativeAgentAttemptRecord["continuityStatus"] = "skipped";
  if (hasNarrativeContinuityWork(writeSet, scene.continuityRequired)) {
    await input.onProgress?.("syncing");
    const continuityFocusIds = Array.from(new Set([
      ...writeSet.factIds,
      ...writeSet.characterIds,
      ...writeSet.locationIds,
      ...writeSet.abilityIds
    ]));
    const continuityPlan = buildNarrativePromptPlan(run, narrativeWorld, null, "continuity", {
      factionIds: scene.forceIds,
      patternIds: scene.patternIds,
      focusIds: continuityFocusIds
    });
    if (!continuityPlan) throw new Error("narrative_continuity_prompt_plan_missing");
    context.narrativePlan = continuityPlan;
    const continuity = await synchronizeNarrativeContinuity(run, world, {
      callId: envelope.callId,
      source: plan.turnKind,
      subject: plan.sceneGoal,
      narrative: [scene.narrative, scene.milestoneCopy?.background].filter(Boolean).join("\n"),
      focusIds: continuityFocusIds,
      writeSet,
      continuityRequired: scene.continuityRequired
    }, context);
    continuityStatus = continuity.assetUpdates || continuity.factUpdates || continuity.relationshipUpdates
      ? "requested_changed" : "requested_empty";
    scene = { ...scene, ...continuity };
  }
  if (scene.turnKind === "scene" && !scene.createsDecision) {
    const arc = run.narrative.sessionPremise?.arcs.find((entry) => entry.actId === envelope.act.id);
    const storyPackAct = activeStoryPackAct(narrativeWorld, envelope.act.id);
    const observation = await observeNarrativeBeat(run, world, {
      callId: envelope.callId,
      actId: envelope.act.id,
      beat: envelope.beat,
      arcQuestion: arc?.dramaticQuestion ?? envelope.act.prompt,
      actObjective: storyPackAct?.objective,
      payoffMeaning: storyPackAct?.payoffMeaning,
      storyProgress: storyProgressForObservation(run),
      currentDelta: scene.storyDelta,
      activeFacts: activeFactsForObservation(run, envelope.act.id),
      horizonIntent: run.narrative.horizonPlan?.intents.find((intent) => intent.id === plan.horizonIntentId)
    }, context);
    run.narrative.lastBeatObservation = observation;
    applyHorizonObservation(run, observation, plan.horizonIntentId);
    scene = {
      ...scene,
      beatDecision: observation.decision,
      observerResolvedFactIds: observation.resolvedFactIds,
      actHandoff: scene.actHandoff ? { ...scene.actHandoff, carryFactIds: observation.carryFactIds } : undefined
    };
  } else if (scene.createsDecision) {
    scene = { ...scene, beatDecision: "hold" };
  }
  appendAttempt(run, {
    callId: envelope.callId,
    attemptId,
    task: "continuity",
    source: plan.turnKind,
    stage: "sync",
    actId: envelope.act.id,
    beat: envelope.beat,
    routeId: scene.patternIds[0],
    factionId: scene.forceIds[0],
    horizonRevision: run.narrative.horizonPlan?.revision,
    digestRevision: run.narrative.memoryRevision,
    briefId: brief.id,
    focusIds: brief.focusIds,
    worldCardIds: brief.worldCardIds,
    continuityStatus,
    contextFragmentIds: contextFragmentIds(context)
  });
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
    briefId: previous.briefId,
    focusIds: previous.focusIds,
    worldCardIds: previous.worldCardIds,
    episodeId
  });
  const sequence = run.narrative.episodes.length;
  const cardRefs = run.narrative.agentAttempts
    .filter((entry) => entry.attemptId === attemptId)
    .flatMap((entry) => entry.contextFragmentIds ?? [])
    .filter((id) => id.startsWith("recall:world-card:"));
  if (cardRefs.length) {
    const byId = new Map((run.narrative.worldCardActivations ?? []).map((state) => [state.cardId, state]));
    for (const ref of new Set(cardRefs)) {
      const [cardId, stickyRaw, cooldownRaw, activationKind] = ref.slice("recall:world-card:".length).split("|");
      if (!cardId) continue;
      // Sticky continuation is consumption of an existing activation, not a
      // fresh activation. Persisting it again would make sticky self-renewing
      // and prevent cooldown from ever beginning.
      if (activationKind === "sticky") continue;
      const sticky = Math.max(0, Math.min(8, Math.trunc(Number(stickyRaw) || 0)));
      const cooldown = Math.max(0, Math.min(16, Math.trunc(Number(cooldownRaw) || 0)));
      byId.set(cardId, {
        cardId,
        lastActivatedSequence: sequence,
        stickyUntilSequence: sequence + sticky,
        cooldownUntilSequence: sequence + sticky + cooldown
      });
    }
    // The set is bounded by the active world's authored cards. Keeping every
    // card state avoids silently dropping lifecycle data in larger community
    // world packs.
    run.narrative.worldCardActivations = Array.from(byId.values());
  }
}

export function invalidateNarrativeHorizon(run: InternalRunState): void {
  if (run.narrative.horizonPlan) run.narrative.horizonPlan.status = "stale";
}

export async function runNarrativeAgentDecision(input: {
  run: InternalRunState;
  world: WorldConfig;
  narrativeWorld: NarrativeWorldDefinition;
  context: NarrativeContext;
  callId: string;
  decision: { decision: DecisionType; label: string; description: string; attributePolicy: NarrativeAttributePolicy; factResolutionModes?: NarrativeFactResolution[] };
  onProgress?: (stage: "settling" | "rendering" | "syncing") => Promise<void> | void;
}): Promise<{ attemptId: string; outcome: DirectedDecisionNarrativeOutcome; observation: NarrativeBeatObservation }> {
  const attemptId = `attempt:${randomUUID()}`;
  const briefId = `${attemptId}:brief`;
  const briefFocusIds = Array.from(new Set([
    ...(input.context.narrativePlan?.recall?.facts.map((entry) => entry.id) ?? []),
    ...(input.context.narrativePlan?.recall?.characters.map((entry) => entry.id) ?? []),
    ...(input.context.narrativePlan?.recall?.assetSources?.map((entry) => entry.id) ?? [])
  ]));
  const briefWorldCardIds = input.context.narrativePlan?.activeWorldCardSources?.map((entry) => entry.id) ?? [];
  appendAttempt(input.run, {
    callId: input.callId,
    attemptId,
    task: "decision",
    source: "decision",
    stage: "prepare",
    actId: input.run.narrative.actRuntime?.actId,
    beat: input.run.narrative.actRuntime?.beat,
    horizonRevision: input.run.narrative.horizonPlan?.revision,
    digestRevision: input.run.narrative.memoryRevision,
    briefId,
    focusIds: briefFocusIds,
    worldCardIds: briefWorldCardIds
  });
  await input.onProgress?.("settling");
  const settlement = await generateDirectedDecisionSettlement(input.run, input.world, input.decision, input.context);
  await input.onProgress?.("rendering");
  const rendered = await renderDirectedDecisionNarrative(input.run, input.world, input.decision, settlement, input.context);
  const decisionWritableSet = narrativeContinuityWritableSet(input.run, input.context.narrativePlan);
  const proseProfile = narrativeProseProfile("decision", input.run.narrative.actRuntime?.beat);
  const reviewInput = {
    callId: input.callId,
    task: "decision" as const,
    ageLabel: `${input.run.age}岁`,
    sceneGoal: `承接“${input.decision.label}”已经造成的直接结果`,
    narrative: rendered.narrative,
    targetMinLength: proseProfile.targetMinLength,
    targetMaxLength: proseProfile.targetMaxLength,
    reviewAtLength: proseProfile.reviewAtLength,
    maxLength: proseProfile.hardMaxLength,
    interactionState: "none" as const
  };
  let narrative = rendered.narrative;
  if (shouldRefineNarrativeProse(reviewInput)) {
    const reviewPlan = buildNarrativePromptPlan(input.run, input.narrativeWorld, null, "reviewing", {
      factionIds: input.run.pendingDynamicScene?.forceIds,
      patternIds: input.run.pendingDynamicScene?.patternIds,
      focusIds: briefFocusIds
    });
    if (!reviewPlan) throw new Error("decision_review_prompt_plan_missing");
    input.context.narrativePlan = reviewPlan;
    narrative = (await refineNarrativeProse(input.run, input.world, reviewInput, input.context)).narrative;
  }
  const writeSet = buildNarrativeContinuityWriteSet(
    input.run,
    decisionWritableSet,
    rendered.continuityRefs
  );
  let continuity = {};
  let continuityStatus: NarrativeAgentAttemptRecord["continuityStatus"] = "skipped";
  if (hasNarrativeContinuityWork(writeSet, rendered.continuityRequired)) {
    await input.onProgress?.("syncing");
    const continuityFocusIds = Array.from(new Set([
      ...writeSet.factIds,
      ...writeSet.characterIds,
      ...writeSet.locationIds,
      ...writeSet.abilityIds
    ]));
    const continuityPlan = buildNarrativePromptPlan(input.run, input.narrativeWorld, null, "continuity", {
      factionIds: input.run.pendingDynamicScene?.forceIds,
      patternIds: input.run.pendingDynamicScene?.patternIds,
      focusIds: continuityFocusIds
    });
    if (!continuityPlan) throw new Error("decision_continuity_prompt_plan_missing");
    input.context.narrativePlan = continuityPlan;
    continuity = await synchronizeNarrativeContinuity(input.run, input.world, {
      callId: input.callId,
      source: "decision",
      subject: `人物选择“${input.decision.label}”：${input.decision.description}`,
      narrative,
      focusIds: continuityFocusIds,
      writeSet,
      continuityRequired: rendered.continuityRequired
    }, input.context);
    const changes = continuity as DirectedDecisionNarrativeOutcome;
    continuityStatus = changes.assetUpdates || changes.factUpdates || changes.relationshipUpdates
      ? "requested_changed" : "requested_empty";
  }
  const outcome: DirectedDecisionNarrativeOutcome = { ...settlement, narrative, storyDelta: rendered.storyDelta, ...continuity };
  const runtime = input.run.narrative.actRuntime;
  if (!runtime) throw new Error("decision_beat_observer_runtime_missing");
  const arc = input.run.narrative.sessionPremise?.arcs.find((entry) => entry.actId === runtime.actId);
  const storyPackAct = activeStoryPackAct(input.narrativeWorld, runtime.actId);
  const observation = await observeNarrativeBeat(input.run, input.world, {
    callId: input.callId,
    actId: runtime.actId,
    beat: runtime.beat,
    arcQuestion: arc?.dramaticQuestion ?? input.narrativeWorld.mainlineActs?.find((entry) => entry.id === runtime.actId)?.prompt ?? "当前经历",
    actObjective: storyPackAct?.objective,
    payoffMeaning: storyPackAct?.payoffMeaning,
    storyProgress: storyProgressForObservation(input.run),
    currentDelta: rendered.storyDelta,
    activeFacts: activeFactsForObservation(input.run, runtime.actId),
    horizonIntent: input.run.narrative.horizonPlan?.intents.find((intent) => intent.id === input.run.pendingDynamicScene?.horizonIntentId)
  }, input.context);
  input.run.narrative.lastBeatObservation = observation;
  applyHorizonObservation(input.run, observation, input.run.pendingDynamicScene?.horizonIntentId);
  outcome.observerResolvedFactIds = observation.resolvedFactIds;
  appendAttempt(input.run, {
    callId: input.callId,
    attemptId,
    task: "decision",
    source: "decision",
    stage: "sync",
    actId: input.run.narrative.actRuntime?.actId,
    beat: input.run.narrative.actRuntime?.beat,
    horizonRevision: input.run.narrative.horizonPlan?.revision,
    digestRevision: input.run.narrative.memoryRevision,
    briefId,
    focusIds: briefFocusIds,
    worldCardIds: briefWorldCardIds,
    continuityStatus,
    contextFragmentIds: contextFragmentIds(input.context)
  });
  return { attemptId, outcome, observation };
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
