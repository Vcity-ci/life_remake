import { randomUUID } from "node:crypto";
import { prepareChoiceCheck, canOpenChoiceSurvival } from "../choice-check.js";
import type { DecisionType, NarrativeAgentAttemptRecord, NarrativeAttributePolicy, NarrativeBeatObservation, NarrativeDecisionBrief, NarrativeFactResolution, NarrativeStoryPackSnapshot, NarrativeWorldDefinition, PublicMilestoneChoice, WorldConfig } from "@reroll/shared";
import {
  generateDynamicNarrativeScene,
  settleDynamicNarrativeScene,
  generateDirectedDecisionSettlement,
  generateEndingNarrative,
  generateNarrativeTurnPlan,
  observeNarrativeBeat,
  renderDirectedDecisionNarrative,
  synchronizeNarrativeContinuity,
  buildNarrativeContinuityWriteSet,
  hasNarrativeContinuityWork,
  narrativeContinuityWritableSet,
  type DynamicNarrativeSceneInput,
  type DynamicNarrativeSceneResult,
  type DirectedDecisionNarrativeOutcome,
  type NarrativeContext
} from "../ai.js";
import { applyNarrativeFactUpdates, applyNarrativeRelationshipUpdates, resolveAgeStageByWorld, resolveNarrativeStatLabels, type InternalRunState } from "../engine.js";
import { buildNarrativePromptPlan, narrativeDefaultAssetFocusIds, type NarrativePromptPlan } from "../narrative.js";
import { narrativeTurnPlanFocusIds, resolveNarrativeTurnTime, type NarrativeTurnTime, type NarrativeTurnEnvelope, type NarrativeTurnPlan } from "./turn.js";
import { narrativeProtagonistAnchor } from "../narrative-characters.js";
import type { NarrativeRoundHandoff } from "./handoff.js";
import { narrativeActFacts, narrativeContinuityFacts, prepareNarrativeFactUpdates } from "../narrative-continuity.js";
import { applyNarrativeIdentityMerges, canonicalizeNarrativeReferences } from "../narrative-identities.js";
import { acknowledgeNarrativeAssetBatch, narrativeAssetBatchReady, stageNarrativeAssetRound } from "./asset-buffer.js";
import { applyNarrativeAssetActivity, applyNarrativeAssetUpdates, commitNarrativeAssets } from "../narrative-assets.js";
import { formatNarrativeDialogue, formatNarrativeExperience } from "../narrative-memory.js";
import { narrativeObservationGap, narrativeObservationHistory } from "./observation.js";
import { committedNarrativeSequence } from "./history.js";

export interface NarrativeAgentTurnInput {
  run: InternalRunState;
  world: WorldConfig;
  narrativeWorld: NarrativeWorldDefinition;
  context: NarrativeContext;
  envelope: NarrativeTurnEnvelope;
  buildRenderInput: (plan: NarrativeTurnPlan, promptPlan: NarrativePromptPlan) => Omit<DynamicNarrativeSceneInput, "plan" | "sceneAge" | "backgroundAgeRange">;
  onProgress?: (stage: "settling" | "rendering" | "syncing") => Promise<void> | void;
}

export interface NarrativeAgentTurnResult {
  time: NarrativeTurnTime;
  attemptId: string;
  plan: NarrativeTurnPlan;
  scene: DynamicNarrativeSceneResult;
  worldCardIds: string[];
}

interface NarrativeTurnBrief {
  id: string;
  plan: NarrativeTurnPlan;
  promptPlan: NarrativePromptPlan;
  focusIds: string[];
  worldCardIds: string[];
  handoff: NarrativeRoundHandoff;
}

function createNarrativeTurnBrief(
  attemptId: string,
  plan: NarrativeTurnPlan,
  promptPlan: NarrativePromptPlan,
  sourceEventId: string,
  run: InternalRunState
): NarrativeTurnBrief {
  const materials = [
    ...(promptPlan.recall?.characters ?? []).map((entry) => ({ id: entry.id, kind: "character" as const, label: entry.name, description: entry.description })),
    ...(promptPlan.recall?.assetSources ?? []).map((entry) => ({ id: entry.id, kind: entry.kind,
      label: (entry.kind === "location" ? run.narrative.assets?.locations : run.narrative.assets?.abilities)?.find((asset) => asset.id === entry.id)?.name ?? entry.id,
      description: entry.text }))
  ];
  const names = new Map([
    ...materials.map((entry) => [entry.id, entry.label] as const),
    ...(promptPlan.activeWorldCardSources ?? []).map((entry) => [entry.id, entry.title ?? entry.id] as const)
  ]);
  return {
    id: `${attemptId}:brief`,
    handoff: { sourceEventId, characters: [] },
    plan: { ...plan, materials,
      recallUses: plan.recallUses?.map((use) => ({ ...use, label: names.get(use.ref) ?? use.label })) },
    promptPlan,
    focusIds: Array.from(new Set([
      ...narrativeTurnPlanFocusIds(plan),
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
  const worldCardCandidates = context.narrativePlan?.activeWorldCardSources;
  const choiceCheck = envelope.capabilities.includes("scene") ? prepareChoiceCheck(run, narrativeWorld) : undefined;
  const plan = await generateNarrativeTurnPlan(run, world, { ...envelope, choiceCheck,
    progressGap: narrativeObservationGap(run, envelope.act.id, envelope.beat) }, context);
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
  const time = resolveNarrativeTurnTime(envelope, plan);
  const assetFocusIds = backgroundOnly
    ? narrativeDefaultAssetFocusIds(run.narrative, renderTask)
    : narrativeTurnPlanFocusIds(plan);
  const narrativeAge = plan.turnKind === "background" ? time.backgroundAgeRange.toAge : time.sceneAge;
  const protagonistAtNarrativeAge = { ...run, age: narrativeAge, ageStage: resolveAgeStageByWorld(world, narrativeAge) };
  const promptPlan = buildNarrativePromptPlan(protagonistAtNarrativeAge, narrativeWorld, null, renderTask, {
    backgroundAllowed: plan.turnKind === "background",
    factionIds: plan.forceIds,
    patternIds: plan.patternIds,
    focusIds: assetFocusIds,
    semanticQuery: [plan.beatChange, ...(plan.recallUses ?? []).map((use) => use.purpose), ...(plan.assetNeeds ?? []).map((need) => need.purpose)].filter(Boolean).join("；"),
    worldCardCandidates: backgroundOnly ? undefined : worldCardCandidates
  });
  if (!promptPlan) throw new Error("narrative_agent_prompt_plan_missing");
  const sourceEventId = plan.turnKind === "background"
    ? `background:${time.backgroundAgeRange.fromAge}:${time.backgroundAgeRange.toAge}:${run.history.length + time.backgroundAgeRange.toAge - time.backgroundAgeRange.fromAge + 1}`
    : `dynamic:${envelope.act.id}:${envelope.beat}:${time.sceneAge}:${run.history.length + 1}`;
  const brief = createNarrativeTurnBrief(attemptId, plan, promptPlan, sourceEventId, run);
  context.narrativePlan = brief.promptPlan;
  await input.onProgress?.("rendering");
  const renderInput = { ...input.buildRenderInput(brief.plan, brief.promptPlan), ...time, choiceCheck, statTierLabels: resolveNarrativeStatLabels(run.stats, run.narrative.statTierConfig, run.narrative.statTierPresentation), handoff: brief.handoff, protagonistAnchor: narrativeProtagonistAnchor(run), plan: brief.plan };
  let scene = await generateDynamicNarrativeScene(run, world, renderInput, context);
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

  if (!scene.createsDecision) {
    await input.onProgress?.("settling");
    scene = await settleDynamicNarrativeScene(run, world, renderInput, scene, context);
  }
  // Annual survival may shorten a background interval before its assets can be registered.
  if (scene.turnKind === "background") return { attemptId, plan, scene, time, worldCardIds: brief.worldCardIds };
  const synchronized = await synchronizeNarrativeAgentScene({ ...input, scene, plan, promptPlan, callId: envelope.callId, age: time.sceneAge, deferSync: true });
  scene = synchronized.scene;
  if (!scene.createsDecision) {
    const observation = await observeNarrativeBeat(run, world, {
      callId: envelope.callId, actId: envelope.act.id, beat: envelope.beat,
      recentStory: narrativeObservationHistory(run, {
        actId: envelope.act.id, age: time.sceneAge, sourceEventId: scene.handoff!.sourceEventId, narrative: scene.narrative
      }),
      outline: run.narrative.actRuntime?.outline
    }, context);
    run.narrative.lastBeatObservation = observation;
    scene.beatDecision = observation.decision;
  } else {
    scene.beatDecision = "hold";
  }
  const closesAct = !scene.createsDecision && envelope.beat === "payoff" && scene.beatDecision === "advance";
  if (narrativeAssetBatchReady(run.narrative, closesAct)) await input.onProgress?.("syncing");
  const batchResult = scene.createsDecision ? { status: "skipped" as const } : await synchronizeNarrativeAssetBatch(run, world, context, envelope.callId, narrativeWorld.socialForces, closesAct);
  scene = canonicalizeNarrativeReferences(run.narrative, scene);
  const continuityStatus = batchResult.status;
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
  return { attemptId, plan, scene, time, worldCardIds: brief.worldCardIds };
}

export async function synchronizeNarrativeAgentScene(input: {
  run: InternalRunState; world: WorldConfig; narrativeWorld: NarrativeWorldDefinition;
  context: NarrativeContext; scene: DynamicNarrativeSceneResult; plan: NarrativeTurnPlan;
  promptPlan: NarrativePromptPlan; callId: string;
  age?: number;
  ageFrom?: number;
  deferSync?: boolean;
  onProgress?: NarrativeAgentTurnInput["onProgress"];
}) {
  const { run, world, narrativeWorld, context, plan, promptPlan, callId } = input;
  let scene = input.scene;
  const writeSet = narrativeContinuityWritableSet(run, promptPlan);
  scene.assetUpdates = stageNarrativeAssetRound(run, {
    sourceEventId: scene.handoff!.sourceEventId, source: plan.turnKind,
    age: input.age ?? run.age,
    ageFrom: input.ageFrom, actId: run.narrative.actRuntime?.actId,
    subject: plan.turnKind === "background" ? "日常生活" : "当年经历",
    narrative: scene.narrative
  }, { ...scene, pendingChoice: scene.createsDecision }, { age: input.age ?? run.age });
  if (!input.deferSync && narrativeAssetBatchReady(run.narrative)) await input.onProgress?.("syncing");
  const batchResult = input.deferSync || scene.createsDecision ? { status: "skipped" as const } : await synchronizeNarrativeAssetBatch(run, world, context, callId, narrativeWorld.socialForces);
  scene = canonicalizeNarrativeReferences(run.narrative, scene);
  return { scene, writeSet, continuityStatus: batchResult.status };
}

export async function synchronizeNarrativeAssetBatch(
  run: InternalRunState, world: WorldConfig, context: NarrativeContext, callId: string,
  socialForces: DynamicNarrativeSceneInput["socialForces"]= [], flush = false
): Promise<{ status: NarrativeAgentAttemptRecord["continuityStatus"] }> {
  if (!narrativeAssetBatchReady(run.narrative, flush)) return { status: "skipped" };
  const batch = structuredClone(run.narrative.assetBuffer!);
  const writeSet = {
    factIds: narrativeContinuityFacts(run.story.factLedger?.facts ?? [], run.narrative.actRuntime?.actId).map((fact) => fact.id),
    characterIds: run.narrative.dynamicCharacters.map((entry) => entry.id),
    locationIds: run.narrative.assets?.locations.map((entry) => entry.id) ?? [],
    abilityIds: run.narrative.assets?.abilities.map((entry) => entry.id) ?? []
  };
  const changes = await synchronizeNarrativeContinuity(run, world, {
    callId, source: batch.rounds.at(-1)!.source, subject: "使资产当前状态与本批已发生经历一致，仅提交改变的值",
    narrative: batch.rounds.map((round) => `【${round.sourceEventId}】\n${formatNarrativeExperience(round, round.narrative)}`).join("\n\n"),
    eventSources: batch.rounds.map((round) => ({ sourceEventId: round.sourceEventId, age: round.age, actId: round.actId })),
    writeSet, focusIds: [...writeSet.characterIds, ...writeSet.locationIds, ...writeSet.abilityIds],
    continuityRequired: true, socialForces,
    handoff: { sourceEventId: batch.rounds.at(-1)!.sourceEventId, characters: [] }
  }, { ...context, conversation: undefined, narrativePlan: undefined });
  applyNarrativeIdentityMerges(run, changes.identityMerges);
  const canonical = canonicalizeNarrativeReferences(run.narrative, changes);
  const last = batch.rounds.at(-1)!;
  canonical.factUpdates = prepareNarrativeFactUpdates(run.runId, last.sourceEventId, canonical.factUpdates);
  const when = { age: last.age };
  commitNarrativeAssets(run.narrative, applyNarrativeAssetUpdates(run.narrative.assets, canonical.assetUpdates, when), when);
  const factIds = applyNarrativeFactUpdates(run, canonical.factUpdates, { sourceEventId: last.sourceEventId, actId: last.actId ?? run.narrative.actRuntime?.actId });
  applyNarrativeRelationshipUpdates(run, canonical.relationshipUpdates, [], when);
  acknowledgeNarrativeAssetBatch(run.narrative, batch.rounds.map((entry) => entry.sourceEventId));
  return {
    status: canonical.assetUpdates?.locations.length || canonical.assetUpdates?.abilities.length || changes.identityMerges?.length || canonical.relationshipUpdates?.length || factIds.length
      ? "requested_changed" : "requested_empty"
  };
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
  const sequence = committedNarrativeSequence(run.narrative);
  const cardRefs = run.narrative.agentAttempts
    .filter((entry) => entry.attemptId === attemptId && (entry.stage === "render" || entry.stage === "review"))
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
  choice?: PublicMilestoneChoice;
  decision: { decision: DecisionType; label: string; description: string; abilityRefs?: string[]; locationDirective?: NarrativeTurnPlan["locationDirective"]; decisionBrief?: NarrativeDecisionBrief; attributePolicy: NarrativeAttributePolicy; factResolutionModes?: NarrativeFactResolution[] };
  onProgress?: (stage: "settling" | "rendering" | "syncing") => Promise<void> | void;
  onRendered?: (outcome: Omit<DirectedDecisionNarrativeOutcome, "effects">) => Promise<void> | void;
  onSettled?: () => Promise<void> | void;
}): Promise<{ attemptId: string; outcome: DirectedDecisionNarrativeOutcome }> {
  const execution = input.run.choiceExecution;
  const attemptId = execution?.attemptId ?? `attempt:${randomUUID()}`;
  if (execution) execution.attemptId = attemptId;
  input.context.narrativePlan = buildNarrativePromptPlan(input.run, input.narrativeWorld, null, "decision", {
    factionIds: input.run.pendingDynamicScene?.forceIds, patternIds: input.run.pendingDynamicScene?.patternIds,
    focusIds: [...(input.decision.abilityRefs ?? []), ...(input.decision.locationDirective?.locationRef ? [input.decision.locationDirective.locationRef] : [])]
  });
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
  await input.onProgress?.("rendering");
  const check = input.run.nextMilestoneChoice?.check;
  const rendered = execution?.rendered ?? await renderDirectedDecisionNarrative(input.run, input.world, {
    ...input.decision, check, roll: execution?.roll,
    allowSurvival: Boolean(check && execution && canOpenChoiceSurvival(check, execution.roll)),
    socialForces: input.narrativeWorld.socialForces
  }, input.context);
  if (execution) execution.rendered = rendered;
  await input.onRendered?.(rendered);
  appendAttempt(input.run, {
    callId: input.callId, attemptId, task: "decision", source: "decision", stage: "render",
    actId: input.run.narrative.actRuntime?.actId, beat: input.run.narrative.actRuntime?.beat,
    briefId, focusIds: briefFocusIds, worldCardIds: briefWorldCardIds,
    contextFragmentIds: contextFragmentIds(input.context)
  });
  const narrative = rendered.narrative;
  await input.onProgress?.("settling");
  const settlement = execution?.outcome ?? await generateDirectedDecisionSettlement(input.run, input.world, { ...input.decision, narrative }, input.context);
  const outcome: DirectedDecisionNarrativeOutcome = { ...rendered, ...settlement, narrative, assetActivity: rendered.assetActivity };
  if (execution) execution.outcome = outcome;
  await input.onSettled?.();
  return { attemptId, outcome };
}

/** Called only after the outcome's numeric settlement is applied. */
export async function finishNarrativeAgentDecision(input: {
  run: InternalRunState; world: WorldConfig; narrativeWorld: NarrativeWorldDefinition; context: NarrativeContext;
  callId: string; attemptId: string; choice?: PublicMilestoneChoice;
  decision: { label: string; description: string }; outcome: DirectedDecisionNarrativeOutcome;
  onAssetsSynced?: () => Promise<void> | void;
}): Promise<NarrativeBeatObservation> {
  const { run, outcome } = input;
  const runtime = input.run.narrative.actRuntime;
  if (!runtime) throw new Error("decision_beat_observer_runtime_missing");
  if (!run.choiceExecution?.assetsSynced) {
    // A pending choice is never a separately completed experience in this batch.
    if (run.narrative.assetBuffer) run.narrative.assetBuffer.rounds = run.narrative.assetBuffer.rounds.filter((round) => round.sourceEventId !== run.pendingDynamicScene?.id);
    const record = run.turnRecords.find((record) => record.choice?.sceneId === input.choice?.sceneId && record.choice?.revision === input.choice?.revision);
    const sceneText = record?.narrative ?? "";
    outcome.assetUpdates = stageNarrativeAssetRound(run, {
      sourceEventId: outcome.handoff!.sourceEventId, source: "decision", age: run.age, actId: runtime.actId,
      subject: input.decision.label,
      narrative: formatNarrativeDialogue({ narrative: sceneText,
        choiceBackground: input.choice?.background === sceneText ? undefined : input.choice?.background,
        selectedAction: `${input.decision.label}：${input.decision.description}` }) +
        `\n行动结果${run.choiceExecution?.roll ? `（检定${run.choiceExecution.roll.success ? "成功" : "失败"}）` : ""}：${outcome.narrative}`
    }, outcome, { age: run.age });
    if (run.pendingDynamicScene) run.pendingDynamicScene.characterIds = Array.from(new Set([
      ...(run.pendingDynamicScene.characterIds ?? []), ...(outcome.handoff?.characters ?? []).map((entry) => entry.characterRef)
    ]));
    run.narrative.assets = applyNarrativeAssetActivity(run.narrative.assets, outcome.assetActivity, { age: run.age });
    await synchronizeNarrativeAssetBatch(run, input.world, input.context, input.callId, input.narrativeWorld.socialForces, true);
    if (run.choiceExecution) run.choiceExecution.assetsSynced = true;
    await input.onAssetsSynced?.();
  }
  if (run.survivalCrisis) return { decision: "hold", actId: runtime.actId, beat: runtime.beat, createdAt: Date.now() };
  const observation = await observeNarrativeBeat(input.run, input.world, {
    callId: input.callId, actId: runtime.actId, beat: runtime.beat,
    recentStory: narrativeObservationHistory(input.run, {
      actId: runtime.actId, age: input.run.age, sourceEventId: outcome.handoff!.sourceEventId, narrative: outcome.narrative,
      decisionResult: run.choiceExecution?.roll ? (run.choiceExecution.roll.success ? "success" : "failure") : undefined,
      selection: input.choice ? { choice: input.choice, label: input.decision.label, description: input.decision.description } : undefined
    }),
    outline: runtime.outline
  }, input.context);
  input.run.narrative.lastBeatObservation = observation;
  appendAttempt(input.run, {
    callId: input.callId,
    attemptId: input.attemptId,
    task: "decision",
    source: "decision",
    stage: "sync",
    actId: input.run.narrative.actRuntime?.actId,
    beat: input.run.narrative.actRuntime?.beat,
    horizonRevision: input.run.narrative.horizonPlan?.revision,
    digestRevision: input.run.narrative.memoryRevision,
    continuityStatus: "requested_changed",
    contextFragmentIds: contextFragmentIds(input.context)
  });
  return observation;
}

export async function runNarrativeAgentEnding(input: {
  run: InternalRunState;
  world: WorldConfig;
  context: NarrativeContext;
  callId: string;
  narrativeWorld?: NarrativeWorldDefinition | null;
}): Promise<{ attemptId: string; narrative: string }> {
  await synchronizeNarrativeAssetBatch(input.run, input.world, input.context, input.callId, input.narrativeWorld?.socialForces, true);
  if (input.narrativeWorld) input.context.narrativePlan = buildNarrativePromptPlan(input.run, input.narrativeWorld, null, "ending");
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
    stage: "render",
    actId: input.run.narrative.actRuntime?.actId,
    beat: input.run.narrative.actRuntime?.beat,
    horizonRevision: input.run.narrative.horizonPlan?.revision,
    digestRevision: input.run.narrative.memoryRevision,
    contextFragmentIds: contextFragmentIds(input.context)
  });
  return { attemptId, narrative };
}
