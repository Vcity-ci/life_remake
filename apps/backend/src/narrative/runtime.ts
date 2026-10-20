import { randomUUID } from "node:crypto";
import type { DecisionType, NarrativeAgentAttemptRecord, NarrativeAttributePolicy, NarrativeBeatObservation, NarrativeDecisionBrief, NarrativeFactResolution, NarrativeStageTask, NarrativeStoryPackSnapshot, NarrativeWorldDefinition, WorldConfig } from "@reroll/shared";
import {
  generateDynamicNarrativeScene,
  settleDynamicNarrativeScene,
  generateDirectedDecisionSettlement,
  generateEndingNarrative,
  generateNarrativeTurnPlan,
  prepareNarrativeAssetUses,
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
  type NarrativeReviewedProse,
  type NarrativeContext
} from "../ai.js";
import { applyNarrativeRelationshipUpdates, resolveNarrativeStatLabels, type InternalRunState } from "../engine.js";
import { buildNarrativePromptPlan, narrativeDefaultAssetFocusIds, type NarrativePromptPlan } from "../narrative.js";
import { narrativeProseProfile } from "../narrative-prompts.js";
import { narrativeStoryPackNextAct } from "../narrative-experience.js";
import { narrativeTurnPlanFocusIds, resolveNarrativeTurnTime, type NarrativeTurnTime, type NarrativeTurnEnvelope, type NarrativeTurnPlan } from "./turn.js";
import { narrativeProtagonistAnchor } from "../narrative-characters.js";
import type { NarrativeRoundHandoff } from "./handoff.js";
import { prepareNarrativeFactUpdates } from "../narrative-continuity.js";
import { applyNarrativeIdentityMerges, canonicalizeNarrativeReferences } from "../narrative-identities.js";
import { acknowledgeNarrativeAssetBatch, narrativeAssetBatchReady, stageNarrativeAssetRound } from "./asset-buffer.js";
import { applyNarrativeAssetUpdates, commitNarrativeAssets } from "../narrative-assets.js";
import { registerNarrativeParticipants } from "../narrative-characters.js";
import { hasNarrativeFactCompletion, narrativeActProgress, narrativeFactProgressForCommit, narrativeObservationFacts } from "./observation.js";
import { committedNarrativeSequence } from "./history.js";
import { commitNarrativeActOutline } from "./act-outline.js";

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
  return {
    id: `${attemptId}:brief`,
    handoff: { sourceEventId, characters: [] },
    plan: { ...plan, materials: [
      ...(promptPlan.recall?.characters ?? []).map((entry) => ({ id: entry.id, kind: "character" as const, label: entry.name, description: entry.description })),
      ...(promptPlan.recall?.assetSources ?? []).filter((entry) => entry.kind !== "ability" || run.narrative.assets?.abilities.some((ability) => ability.id === entry.id && ability.status === "available"))
        .map((entry) => ({ id: entry.id, kind: entry.kind, label: (entry.kind === "location" ? run.narrative.assets?.locations : run.narrative.assets?.abilities)?.find((asset) => asset.id === entry.id)?.name ?? entry.id, description: entry.text }))
    ] },
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

function activeStoryPackAct(world: NarrativeWorldDefinition, actId: string) {
  const storyPack = (world as NarrativeWorldDefinition & { storyPack?: NarrativeStoryPackSnapshot }).storyPack;
  return storyPack?.acts.find((entry) => entry.id === actId);
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
  const plan: NarrativeTurnPlan = backgroundOnly
    ? {
        callId: envelope.callId,
        turnKind: "background",
        patternIds: [],
        forceIds: [],
        conflictRefs: [],
        abilityRefs: [],
        sceneGoal: `叙述${envelope.backgroundAgeRange.fromAge}岁至${envelope.backgroundAgeRange.toAge}岁在当前住处的日常生活、成长与身边关系`,
        presentation: "summary",
        clockRequest: "advance"
      }
    : await generateNarrativeTurnPlan(run, world, envelope, context);
  // This state is still inside the existing round transaction. The writer and
  // observer read the same concrete outline; failure discards the transaction.
  if (plan.actOutline && plan.actOutline.revision !== envelope.actOutline?.revision) {
    commitNarrativeActOutline(run.narrative, plan.actOutline);
  }
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
  await prepareNarrativeAssetUses(run, world, context, assetFocusIds);
  const promptPlan = buildNarrativePromptPlan(run, narrativeWorld, null, renderTask, {
    backgroundAllowed: plan.turnKind === "background",
    factionIds: plan.forceIds,
    patternIds: plan.patternIds,
    focusIds: assetFocusIds,
    semanticQuery: [plan.sceneGoal, ...(plan.assetNeeds ?? []).map((need) => need.purpose)].join("；"),
    worldCardCandidates: backgroundOnly ? undefined : worldCardCandidates
  });
  if (!promptPlan) throw new Error("narrative_agent_prompt_plan_missing");
  const sourceEventId = plan.turnKind === "background"
    ? `background:${time.backgroundAgeRange.fromAge}:${time.backgroundAgeRange.toAge}:${run.history.length + time.backgroundAgeRange.toAge - time.backgroundAgeRange.fromAge + 1}`
    : `dynamic:${envelope.act.id}:${envelope.beat}:${time.sceneAge}:${run.history.length + 1}`;
  const brief = createNarrativeTurnBrief(attemptId, plan, promptPlan, sourceEventId, run);
  context.narrativePlan = brief.promptPlan;
  await input.onProgress?.("rendering");
  const nextAct = envelope.beat === "payoff"
    ? narrativeStoryPackNextAct((narrativeWorld as NarrativeWorldDefinition & { storyPack?: NarrativeStoryPackSnapshot }).storyPack, envelope.act.id)
    : undefined;
  const renderInput = { ...input.buildRenderInput(brief.plan, brief.promptPlan), ...time, statTierLabels: resolveNarrativeStatLabels(run.stats, run.narrative.statTierConfig, run.narrative.statTierPresentation), handoff: brief.handoff, protagonistAnchor: narrativeProtagonistAnchor(run), plan: brief.plan };
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

  {
    const proseProfile = narrativeProseProfile(scene.turnKind === "background" ? "summary" : scene.createsDecision ? "choice" : "scene", envelope.beat);
    const reviewInput = {
      changes: scene,
      socialForces: narrativeWorld.socialForces,
      handoff: scene.handoff,
      callId: envelope.callId,
      task: scene.turnKind === "background" ? "background" as const : scene.createsDecision ? "choice" as const : "scene" as const,
      ageLabel: scene.turnKind === "background"
        ? `${time.backgroundAgeRange.fromAge}-${time.backgroundAgeRange.toAge}岁`
        : `${time.sceneAge}岁`,
      sceneGoal: plan.sceneGoal,
      narrative: scene.narrative,
      background: scene.milestoneCopy?.background,
      targetMinLength: proseProfile.targetMinLength,
      targetMaxLength: proseProfile.targetMaxLength,
      backgroundTargetMaxLength: proseProfile.backgroundTargetMaxLength,
      interactionState: scene.createsDecision ? "choice_pending" as const : "none" as const,
      beat: envelope.beat,
      protagonistAnchor: narrativeProtagonistAnchor(run),
      storyDelta: scene.storyDelta,
      assetActivity: scene.assetActivity,
      continuityRefs: scene.continuityRefs,
      continuityRequired: scene.continuityRequired,
      approvedResult: JSON.stringify({ options: scene.milestoneCopy?.optionOverrides })
    };
    if (shouldRefineNarrativeProse(reviewInput)) {
      const previousPlan = context.narrativePlan;
      context.narrativePlan = { ...promptPlan, task: "reviewing" };
      let reviewed: NarrativeReviewedProse;
      try {
        reviewed = await refineNarrativeProse(run, world, reviewInput, context);
      } finally {
        context.narrativePlan = previousPlan;
      }
      scene = {
        ...scene,
        ...reviewed,
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
  if (!scene.createsDecision) {
    await input.onProgress?.("settling");
    scene = await settleDynamicNarrativeScene(run, world, renderInput, scene, context);
  }
  // Annual survival may shorten a background interval before its assets can be registered.
  if (scene.turnKind === "background") return { attemptId, plan, scene, time, worldCardIds: brief.worldCardIds };
  const synchronized = await synchronizeNarrativeAgentScene({ ...input, scene, plan, promptPlan, callId: envelope.callId, age: time.sceneAge });
  scene = synchronized.scene;
  const { writeSet, continuityStatus } = synchronized;
  if (scene.turnKind === "scene") scene.factUpdates = prepareNarrativeFactUpdates(run.runId, scene.handoff!.sourceEventId, scene.factUpdates);
  if (scene.turnKind === "scene" && (!scene.createsDecision || hasNarrativeFactCompletion(scene.factUpdates))) {
    const arc = run.narrative.sessionPremise?.arcs.find((entry) => entry.actId === envelope.act.id);
    const storyPackAct = activeStoryPackAct(narrativeWorld, envelope.act.id);
    const progress = narrativeActProgress(run, envelope.act.id);
    const observation = await observeNarrativeBeat(run, world, {
      callId: envelope.callId,
      actId: envelope.act.id,
      beat: envelope.beat,
      arcQuestion: arc?.dramaticQuestion ?? envelope.act.prompt,
      stageTask: plan.stageTask,
      actObjective: storyPackAct?.objective,
      payoffMeaning: storyPackAct?.payoffMeaning,
      beatOutline: plan.actOutline
        ? Object.fromEntries(Object.entries(plan.actOutline.beats).map(([beat, node]) => [beat,
            `${storyPackAct?.beatOutline[beat as keyof typeof plan.actOutline.beats] ?? ""}；本局具体发展：${node.story}`]))
        : storyPackAct?.beatOutline,
      actProgress: progress.changes,
      actSummary: progress.summary,
      currentDelta: scene.storyDelta,
      activeFacts: narrativeObservationFacts(run, envelope.act.id, scene.factUpdates, [...plan.conflictRefs, ...writeSet.factIds]),
      nextAct: nextAct ? { label: nextAct.label, objective: nextAct.objective } : undefined,
      factsOnly: scene.createsDecision === true
    }, context);
    if (!scene.createsDecision) run.narrative.lastBeatObservation = observation;
    scene = {
      ...scene,
      beatDecision: observation.decision,
      factUpdates: narrativeFactProgressForCommit(scene.factUpdates),
      observerResolvedFactIds: observation.resolvedFactIds,
      observerResolutions: observation.resolutions,
      actHandoff: observation.actHandoff
    };
  } else if (scene.createsDecision) {
    scene = { ...scene, factUpdates: narrativeFactProgressForCommit(scene.factUpdates), beatDecision: "hold" };
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
  return { attemptId, plan, scene, time, worldCardIds: brief.worldCardIds };
}

export async function synchronizeNarrativeAgentScene(input: {
  run: InternalRunState; world: WorldConfig; narrativeWorld: NarrativeWorldDefinition;
  context: NarrativeContext; scene: DynamicNarrativeSceneResult; plan: NarrativeTurnPlan;
  promptPlan: NarrativePromptPlan; callId: string;
  age?: number;
  onProgress?: NarrativeAgentTurnInput["onProgress"];
}) {
  const { run, world, narrativeWorld, context, plan, promptPlan, callId } = input;
  let scene = input.scene;
  const writeSet = buildNarrativeContinuityWriteSet(
    run,
    narrativeContinuityWritableSet(run, promptPlan),
    scene.continuityRefs
  );
  scene.assetUpdates = stageNarrativeAssetRound(run, {
    sourceEventId: scene.handoff!.sourceEventId, source: plan.turnKind,
    age: input.age ?? run.age, subject: plan.sceneGoal,
    narrative: [scene.narrative, scene.milestoneCopy?.background].filter(Boolean).join("\n")
  }, scene, { age: input.age ?? run.age });
  if (narrativeAssetBatchReady(run.narrative)) await input.onProgress?.("syncing");
  const continuityStatus = await synchronizeNarrativeAssetBatch(run, world, context, callId, narrativeWorld.socialForces);
  scene = canonicalizeNarrativeReferences(run.narrative, scene);
  return { scene, writeSet, continuityStatus };
}

export async function synchronizeNarrativeAssetBatch(
  run: InternalRunState, world: WorldConfig, context: NarrativeContext, callId: string,
  socialForces: DynamicNarrativeSceneInput["socialForces"] = [], flush = false
): Promise<NarrativeAgentAttemptRecord["continuityStatus"]> {
  if (!narrativeAssetBatchReady(run.narrative, flush)) return "skipped";
  const batch = structuredClone(run.narrative.assetBuffer!);
  const writeSet = { factIds: [], characterIds: run.narrative.dynamicCharacters.map((entry) => entry.id),
    locationIds: run.narrative.assets?.locations.map((entry) => entry.id) ?? [],
    abilityIds: run.narrative.assets?.abilities.map((entry) => entry.id) ?? [] };
  const changes = await synchronizeNarrativeContinuity(run, world, {
    callId, source: batch.rounds.at(-1)!.source, subject: "整理本批已发生的资产变化",
    narrative: batch.rounds.map((round) => `【${round.age}岁·${round.source}】\n${round.narrative}`).join("\n\n"),
    writeSet, focusIds: [...writeSet.characterIds, ...writeSet.locationIds, ...writeSet.abilityIds],
    continuityRequired: true, socialForces, assetsOnly: true,
    handoff: { sourceEventId: batch.rounds.at(-1)!.sourceEventId, characters: [] }
  }, { ...context, conversation: undefined, narrativePlan: undefined });
  applyNarrativeIdentityMerges(run, changes.identityMerges);
  const canonical = canonicalizeNarrativeReferences(run.narrative, changes);
  const when = { age: batch.rounds.at(-1)!.age };
  registerNarrativeParticipants({ ...run, age: when.age }, canonical.participants, callId, [], canonical.handoff?.characters);
  commitNarrativeAssets(run.narrative, applyNarrativeAssetUpdates(run.narrative.assets, canonical.assetUpdates, when), when);
  // Relationship changes use the original commit path after identities have been unified.
  applyNarrativeRelationshipUpdates(run, canonical.relationshipUpdates, []);
  acknowledgeNarrativeAssetBatch(run.narrative, batch.rounds.map((entry) => entry.sourceEventId));
  return canonical.assetUpdates?.locations.length || canonical.assetUpdates?.abilities.length || canonical.participants?.length || changes.identityMerges?.length || canonical.relationshipUpdates?.length
    ? "requested_changed" : "requested_empty";
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
  decision: { decision: DecisionType; label: string; description: string; abilityRefs?: string[]; locationDirective?: NarrativeTurnPlan["locationDirective"]; decisionBrief?: NarrativeDecisionBrief; stageTask?: NarrativeStageTask; attributePolicy: NarrativeAttributePolicy; factResolutionModes?: NarrativeFactResolution[] };
  onProgress?: (stage: "settling" | "rendering" | "syncing") => Promise<void> | void;
}): Promise<{ attemptId: string; outcome: DirectedDecisionNarrativeOutcome; observation: NarrativeBeatObservation }> {
  const attemptId = `attempt:${randomUUID()}`;
  await prepareNarrativeAssetUses(input.run, input.world, input.context, [
    ...(input.decision.abilityRefs ?? []), ...(input.decision.locationDirective?.locationRef ? [input.decision.locationDirective.locationRef] : [])
  ]);
  input.context.narrativePlan = buildNarrativePromptPlan(input.run, input.narrativeWorld, null, "decision", {
    factionIds: input.run.pendingDynamicScene?.forceIds, patternIds: input.run.pendingDynamicScene?.patternIds,
    focusIds: [...(input.decision.abilityRefs ?? []), ...(input.decision.locationDirective?.locationRef ? [input.decision.locationDirective.locationRef] : [])]
  });
  const turnPlan = input.context.narrativePlan;
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
  let rendered = await renderDirectedDecisionNarrative(input.run, input.world, { ...input.decision, socialForces: input.narrativeWorld.socialForces }, input.context);
  appendAttempt(input.run, {
    callId: input.callId, attemptId, task: "decision", source: "decision", stage: "render",
    actId: input.run.narrative.actRuntime?.actId, beat: input.run.narrative.actRuntime?.beat,
    briefId, focusIds: briefFocusIds, worldCardIds: briefWorldCardIds,
    contextFragmentIds: contextFragmentIds(input.context)
  });
  const decisionWritableSet = narrativeContinuityWritableSet(input.run, input.context.narrativePlan);
  const proseProfile = narrativeProseProfile("decision", input.run.narrative.actRuntime?.beat);
  const reviewInput = {
    handoff: rendered.handoff,
    changes: rendered,
    socialForces: input.narrativeWorld.socialForces,
    callId: input.callId,
    task: "decision" as const,
    ageLabel: `${input.run.age}岁`,
    sceneGoal: `承接“${input.decision.label}”已经造成的直接结果`,
    narrative: rendered.narrative,
    targetMinLength: proseProfile.targetMinLength,
    targetMaxLength: proseProfile.targetMaxLength,
    interactionState: "choice_resolved" as const,
    protagonistAnchor: narrativeProtagonistAnchor(input.run),
    storyDelta: rendered.storyDelta,
    assetActivity: rendered.assetActivity,
    continuityRefs: rendered.continuityRefs,
    continuityRequired: rendered.continuityRequired,
    approvedResult: JSON.stringify({ selectedAction: input.decision.label, description: input.decision.description })
  };
  let narrative = rendered.narrative;
  if (shouldRefineNarrativeProse(reviewInput)) {
    input.context.narrativePlan = turnPlan ? { ...turnPlan, task: "reviewing" } : undefined;
    try {
      rendered = { ...rendered, ...await refineNarrativeProse(input.run, input.world, reviewInput, input.context) };
      narrative = rendered.narrative;
    } finally {
      input.context.narrativePlan = turnPlan;
    }
  }
  await input.onProgress?.("settling");
  const settlement = await generateDirectedDecisionSettlement(input.run, input.world, { ...input.decision, narrative }, input.context);
  const writeSet = buildNarrativeContinuityWriteSet(
    input.run,
    decisionWritableSet,
    rendered.continuityRefs
  );
  rendered.assetUpdates = stageNarrativeAssetRound(input.run, {
    sourceEventId: rendered.handoff!.sourceEventId, source: "decision", age: input.run.age,
    subject: input.decision.label, narrative
  }, rendered, { age: input.run.age });
  if (narrativeAssetBatchReady(input.run.narrative)) await input.onProgress?.("syncing");
  const continuityStatus = await synchronizeNarrativeAssetBatch(input.run, input.world, input.context, input.callId, input.narrativeWorld.socialForces);
  rendered = canonicalizeNarrativeReferences(input.run.narrative, rendered);
  const outcome: DirectedDecisionNarrativeOutcome = {
    ...rendered,
    ...settlement,
    narrative,
    storyDelta: rendered.storyDelta,
    assetActivity: rendered.assetActivity
  };
  outcome.factUpdates = prepareNarrativeFactUpdates(input.run.runId, outcome.handoff?.sourceEventId ?? `${input.run.pendingDynamicScene?.id ?? input.callId}:decision:${input.run.history.length + 1}`, outcome.factUpdates);
  const runtime = input.run.narrative.actRuntime;
  if (!runtime) throw new Error("decision_beat_observer_runtime_missing");
  const arc = input.run.narrative.sessionPremise?.arcs.find((entry) => entry.actId === runtime.actId);
  const storyPackAct = activeStoryPackAct(input.narrativeWorld, runtime.actId);
  const progress = narrativeActProgress(input.run, runtime.actId);
  const acts = input.narrativeWorld.mainlineActs ?? [];
  const followingAct = acts[acts.findIndex((entry) => entry.id === runtime.actId) + 1];
  const followingStoryAct = followingAct ? activeStoryPackAct(input.narrativeWorld, followingAct.id) : undefined;
  const observation = await observeNarrativeBeat(input.run, input.world, {
    callId: input.callId,
    actId: runtime.actId,
    beat: runtime.beat,
    arcQuestion: arc?.dramaticQuestion ?? input.narrativeWorld.mainlineActs?.find((entry) => entry.id === runtime.actId)?.prompt ?? "当前经历",
    stageTask: runtime.stageTask,
    actObjective: storyPackAct?.objective,
    payoffMeaning: storyPackAct?.payoffMeaning,
    beatOutline: runtime.outline
      ? Object.fromEntries(Object.entries(runtime.outline.beats).map(([beat, node]) => [beat,
          `${storyPackAct?.beatOutline[beat as keyof typeof runtime.outline.beats] ?? ""}；本局具体发展：${node.story}`]))
      : storyPackAct?.beatOutline,
    actProgress: progress.changes,
    actSummary: progress.summary,
    currentDelta: rendered.storyDelta,
    nextAct: followingAct ? { label: followingAct.label, objective: followingStoryAct?.objective ?? followingAct.prompt } : undefined,
    activeFacts: narrativeObservationFacts(input.run, runtime.actId, outcome.factUpdates, [
      ...(input.run.pendingDynamicScene?.factIds ?? []), ...writeSet.factIds
    ])
  }, input.context);
  input.run.narrative.lastBeatObservation = observation;
  outcome.observerResolvedFactIds = observation.resolvedFactIds;
  outcome.observerResolutions = observation.resolutions;
  outcome.factUpdates = narrativeFactProgressForCommit(outcome.factUpdates);
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
    stage: "review",
    actId: input.run.narrative.actRuntime?.actId,
    beat: input.run.narrative.actRuntime?.beat,
    horizonRevision: input.run.narrative.horizonPlan?.revision,
    digestRevision: input.run.narrative.memoryRevision,
    contextFragmentIds: contextFragmentIds(input.context)
  });
  return { attemptId, narrative };
}
