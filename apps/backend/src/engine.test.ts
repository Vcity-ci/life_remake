import { dynamicNarrativeSceneTools, narrativeTurnPlanTools, narrativeTurnPlanningPrompt, narrativeDecisionOutcomeTool, narrativeDecisionRenderTool, narrativeHorizonTool, narrativeBeatObservationPrompt, normalizeMilestoneOptionOverrides, parseDynamicNarrativeParticipants, NarrativeOutcomeError, prepareNarrativeOutcomeRequest, interruptedBackgroundTask, recordDirectedDecisionOutcome, recordDirectedStoryTurnOutcome, buildNarrativeContinuityWriteSet, narrativeContinuityReadSet, narrativeContinuityWritableSet, hasNarrativeContinuityWork, validateNarrativeContinuityToolArguments, extractProviderUsage, type NarrativeContext } from "./ai.js";
import { factUpdateContract, parseFactUpdates, prepareNarrativeFactUpdates, parseRelationshipUpdates, narrativeFactResolutionModes, narrativeContinuityFacts, NarrativeContinuityValidationError } from "./narrative-continuity.js";
import { generateNarrativeTurnPlan, observeNarrativeBeat, parseNarrativeTurnPlan, parseNarrativeMemoryCuration, memoryCurationTool } from "./ai.js";
import { narrativeObservationHistory } from "./narrative/observation.js";
import { pendingConversationContext, applyConversationSummary, buildConversationPromptMessages, keepRecentConversationRounds, summarizedConversationMemoryIds, type ChatConversationState } from "./conversation.js";
import { commitNarrativeMemory, narrativeTextOverlap } from "./narrative-memory.js";
import { validateNarrativeEffects, narrativeEffectsSchema } from "./narrative-attributes.js";
import { NARRATIVE_ABILITY_DEFINITION, normalizeNarrativeText, isNarrativePlainText, narrativeProseProfile } from "./narrative-prompts.js";
import assert from "node:assert/strict";
import { dynamicNarrativeRenderPrompt, dynamicNarrativeScenePrompt, parseDynamicNarrativeProse, memoryCurationPrompt, narrativeOriginPrompt, type DynamicNarrativeSceneInput } from "./ai.js";
import { retrieveNarrativeMemories } from "./narrative.js";
import test, { type TestContext } from "node:test";
import OpenAI from "openai";
import fs from "node:fs/promises";
import { getRun, resolveAnonymousSession, saveRun } from "./store.js";
import { createDefaultGameplayTuning } from "@reroll/shared";
import type { BackgroundCard, DifficultyConfig, EventDefinition, ItemDefinition, NarrativeAttributePolicy, NarrativeWorldDefinition, ResolvedNarrativeExperience, StoryDirectionDefinition, WorldConfig } from "@reroll/shared";
import {
  dynamicBackgroundAttributePolicy,
  dynamicSceneAttributePolicy,
  applyNarrativeFactUpdates,
  applyNarrativeRelationshipUpdates,
  advanceWithDirectedEvent,
  advanceWithDynamicNarrativeScene,
  applyDirectedClosureRequest,
  applyDirectedMilestonePresentation,
  appendPublicTurnRecord,
  approveNarrativeAttributeOutcome,
  applyMilestoneDecisionAndAdvance,
  completeMilestoneDecision,
  autoAdvanceToCheckpoint,
  buildDirectedEventCandidates,
  canRequestDirectedClosure,
  selectDirectedCandidateForIntent,
  createDirectedMilestoneChoice,
  createRun,
  ensureVisibleTurnRecords,
  resolveTurnRecordChoice,
  settleNarrativeBackgroundOutcomes,
  resolveSurvivalCrisis,
  toPublicMilestoneChoice,
  toPublicTimelineEntryFromEvent,
  toClientRun
} from "./engine.js";
import { advanceNarrativeActBeat, formatNarrativePromptPlan, buildNarrativePromptPlan, narrativeRouteBeatGuidance, selectDynamicNarrativeContext, selectNarrativeWorldCards, formatTaskNarrativeContext, assessClosureReadiness, assessEnding, ensureNarrativeActRuntime, ensureNarrativeRunState, getNarrativeRouteProgress, isNarrativeEarlyLife, isNarrativeMainlineActEntryReady, isNarrativeStageReady, refreshNarrativeMainlineCompletion } from "./narrative.js";
import { loadEventDefinitions, loadNarrativeWorldDefinition, validateNarrativeWorldFactContract } from "./content.js";
import { applyNarrativeAssetActivity, applyNarrativeAssetUpdates, commitNarrativeAssets, formatNarrativeAssets, selectNarrativeAssets, narrativeAbilityDirectory, narrativeContinuityAssetContract, narrativeLocationDirectory, narrativeAssetUpdatesSchema, normalizeNarrativeAssets, parseNarrativeAssetUpdates, parseNarrativeContinuityAssetUpdates, publicNarrativeAssetsSnapshot } from "./narrative-assets.js";
import { composeNarrativeContext } from "./narrative/context/orchestrator.js";
import { commitNarrativeActCanon, commitNarrativeEpisode as commitEpisode, runNarrativeTurnTransaction, type NarrativeCommitDraft } from "./narrative/commit.js";
import { applyNarrativeMemoryCuration, prepareNarrativeMemoryCuration } from "./narrative/curator.js";
import { commitNarrativeAgentTurn, runNarrativeAgentTurn, runNarrativeAgentDecision, finishNarrativeAgentDecision, synchronizeNarrativeAgentScene, synchronizeNarrativeAssetBatch } from "./narrative/runtime.js";
import { stageNarrativeAssetRound } from "./narrative/asset-buffer.js";
import { upgradeProviderOutputBudget } from "./config.js";
import { defaultNarrativeContextProviders } from "./narrative/context/collectors.js";
import { narrativeTurnCapabilities, narrativeTurnKindsForReadiness, recentCommittedNarrativeChanges, type NarrativeTurnEnvelope } from "./narrative/turn.js";
import { narrativeTaskContract } from "./narrative/task-contracts.js";
import { loadNarrativeStoryPack, loadNarrativeStoryPacksForWorld, validateNarrativeStoryPack } from "./story-packs.js";
import { resolveNarrativeExperience } from "./narrative-experience.js";
import { applyNarrativeIdentityMerges, canonicalizeNarrativeReferences, narrativeCharacterDirectory, parseNarrativeIdentityMerges } from "./narrative-identities.js";
import { resolveNarrativeStatTiers } from "./engine.js";
import { generateDirectedStoryTurn, generateDirectedStoryRender, generateDynamicNarrativeScene, generateNarrativeOrigin, renderDirectedDecisionNarrative, renderInterruptedBackground, synchronizeNarrativeContinuity } from "./ai.js";
import { registerNarrativeParticipants } from "./narrative-characters.js";
import { prepareRoundParticipants, roundCharacterDirectory } from "./narrative/handoff.js";
import { parseNarrativeActWorldCard, commitNarrativeActOutline } from "./narrative/act-outline.js";
import { buildNarrativeStoryHistory } from "./narrative/story-history.js";
import { prepareChoiceCheck, rollChoice } from "./choice-check.js";

type OutlineFixture = { goal: string; completionMeaning: string; fork?: { question: string; stakes: string; openingSituation: string } };
function actWorldCardForTest(task: OutlineFixture = { goal: "推进本幕人物处境", completionMeaning: "本幕问题及其实际后果已经形成" }) {
  return { background: "当前世界中的人物生活与本幕冲突。", beats: Object.fromEntries(["setup", "escalation", "pressure", "climax", "payoff"].map((beat) => [beat, {
    change: `${beat}：${task.goal}，承接已发生结果并推动人物面对本幕矛盾。`,
    props: ["主角", "本幕相关人物"], timeframe: null
  }])) };
}

function outlineForTest(actId: string, task?: OutlineFixture) {
  return parseNarrativeActWorldCard(actWorldCardForTest(task), actId);
}

function planningReplyForTest<T extends Record<string, unknown>>(fields: T) {
  return { beatChange: "承担本拍的一项实际责任", timeScope: "同年完成紧迫行动", note: "", assetNeeds: [], ...fields,
    ...Object.fromEntries(["conflictRefs", "abilityRefs", "forceIds"].map((field) => [field,
      ((fields[field] ?? []) as unknown[]).map((entry) => typeof entry === "string" ? { ref: entry, purpose: "为当前阶段改变提供行动条件" } : entry)
    ])) };
}

function observationReplyForTest(decision: string) {
  return { beatDecision: decision, evidence: decision === "advance" ? "正文中的阶段改变已经形成实际结果" : null,
    missing: decision === "hold" ? "本拍要求的处境改变尚未发生" : null };
}

// Older fixtures use storyDelta as their story text. Store that text through the
// same memory channel as current commits; it is no longer a second model output.
function commitNarrativeEpisode(run: Parameters<typeof commitEpisode>[0], draft: NarrativeCommitDraft & { storyDelta?: string }) {
  if (draft.storyDelta && !run.narrative.memoryEntries.some((entry) => entry.id === `memory:${draft.sourceEventId}`)) {
    commitNarrativeMemory(run.narrative, { id: `memory:${draft.sourceEventId}`, age: draft.age,
      factionIds: [], characterIds: [], factIds: [], text: draft.storyDelta });
  }
  return commitEpisode(run, draft);
}

function nextNarrativeScript<T extends { name: string; args: Record<string, unknown> }>(scripts: T[], payload: { tools: Array<{ function: { name: string; parameters?: unknown } }> }): T | undefined {
  const next = scripts[0];
  // Choice results now flush complete experiences before observation. These older
  // fault replays have no profile changes to propose in that new sync call.
  if (next?.name === "observe_story_beat" && payload.tools[0]?.function.name === "sync_narrative_continuity") {
    return { name: "sync_narrative_continuity", args: { locationUpdates: [], abilityUpdates: [], identityMerges: [], relationshipUpdates: [], factIntroductions: [], factUpdates: [] } } as unknown as T;
  }
  const required = (payload.tools[0]?.function.parameters as { required?: string[] } | undefined)?.required;
  if (next?.name === "plan_scene_turn" && next.args.actWorldCard && required?.length === 1 && required[0] === "actWorldCard") {
    return { ...next, args: { actWorldCard: next.args.actWorldCard } };
  }
  const step = scripts.shift();
  if (step?.name === "plan_scene_turn") {
    const { actWorldCard: _outline, ...materials } = step.args;
    return { ...step, args: planningReplyForTest(materials) };
  }
  if (step?.name === "observe_story_beat") return { ...step, args: { ...step.args, ...observationReplyForTest(String(step.args.beatDecision)) } };
  return step;
}

async function loadNarrativeExperienceForTest(worldId: string): Promise<NarrativeWorldDefinition> {
  const worldDefinition = await loadNarrativeWorldDefinition(worldId);
  assert.ok(worldDefinition);
  if (worldDefinition.version < 10) return worldDefinition;
  const defaultPackIds: Record<string, string> = {
    ancient: "ancient.sovereign-rise",
    modern: "modern.scholar-road",
    fantasy: "fantasy.sect-ascendant"
  };
  const storyPack = await loadNarrativeStoryPack(worldDefinition, defaultPackIds[worldId] ?? "");
  assert.ok(storyPack);
  return resolveNarrativeExperience(worldDefinition, storyPack);
}

const world: WorldConfig = {
  id: "test-world",
  name: "测试世界",
  intro: "用于验证人生事件。",
  stylePrompt: "简洁、因果明确。",
  milestoneAges: [18],
  endAgeRange: { min: 90, max: 90 },
  yearlyEventHints: ["转机"],
  ageThresholds: [
    { id: "child", label: "幼年", min: 0, max: 12 },
    { id: "youth", label: "青年", min: 13, max: 29 },
    { id: "prime", label: "壮年", min: 30, max: 44 },
    { id: "middle", label: "中年", min: 45, max: 59 },
    { id: "elder", label: "老年", min: 60, max: 120 }
  ]
};

const difficulty: DifficultyConfig = {
  id: "test",
  name: "测试",
  yearlyVolatility: 0,
  growthBias: 0,
  riskRewardMultiplier: 1,
  failurePenaltyMultiplier: 1,
  description: "测试"
};

const card: BackgroundCard = {
  id: "talent_guard",
  name: "护持",
  rarity: "rare",
  description: "减轻智力损失。",
  modifiers: {},
  tags: ["learning"],
  effects: [{ type: "negative_reduce", stat: "intelligence", amount: 1, description: "减轻智力损失。" }]
};

const event: EventDefinition = {
  id: "guardian_test",
  worldId: world.id,
  factionId: "guardian",
  title: "守望者的难题",
  kind: "any",
  tags: ["guardian", "charisma", "physique"],
  minAge: 0,
  maxAge: 120,
  cooldownYears: 8,
  baseWeight: 10,
  outcomeProfileId: "guardian",
  promptHook: "你必须在照料与责任之间作出判断。"
};

const item: ItemDefinition = {
  id: "test_item",
  name: "测试护符",
  rarity: "common",
  description: "测试道具。",
  tags: ["guardian"],
  effects: []
};

function makeRun() {
  const tuning = createDefaultGameplayTuning();
  return createRun(
    { world, difficulty, cards: [card], tuning },
    {
      clientId: "test-client",
      worldId: world.id,
      storyPackId: "test.story-pack",
      difficultyId: difficulty.id,
      personaPrompt: "一个想守住底线的普通人",
      talentPointTotal: 25,
      stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 },
      selectedCardIds: [card.id]
    }
  );
}

const narrativeWorld: NarrativeWorldDefinition = {
  version: 2,
  worldId: world.id,
  storyBible: "测试主线",
  styleRules: [],
  mainlineSkeleton: {
    premise: "一份旧档将几方人卷入同一场清查。",
    opening: "先获得一页证据。",
    pressure: "证据要求承担代价。",
    climax: "在清查中决定证据归属。",
    payoff: "让旧档与证词得到回应。",
    goodEndingDirection: "承担证据并留下秩序。",
    badEndingDirection: "失去证据或为其付出代价。"
  },
  progression: {
    backgroundPacing: { minYears: 1, maxYears: 3 },
    routes: [{
      directionId: "test.guardian",
      gates: { opening: { weights: { intelligence: 1 }, threshold: 8 } }
    }],
    completion: {
      requireCommittedDirection: true,
      requireDecisionConsequence: true,
      requireClimax: true,
      requirePayoff: true,
      requireResolvedCoreFacts: true,
      requireNoActiveScene: true
    }
  },
  routeArcs: [{ directionId: "test.guardian", summary: "测试路线", coreThreadIds: ["test.thread"] }],
  threads: [{ id: "test.thread", label: "旧档", premise: "测试", directionIds: ["test.guardian"], payoffHint: "回应旧档。" }],
  characters: [],
  lore: [],
  eventBindings: [],
  endingBlueprints: [
    { id: "test.good", worldId: world.id, directionId: "test.guardian", polarity: "good", title: "善终", premise: "测试", finalConflict: "测试", payoffFocus: "测试", epilogueFocus: "测试", statWeights: { intelligence: 1 }, requiredThreadIds: ["test.thread"] },
    { id: "test.normal", worldId: world.id, directionId: "test.guardian", polarity: "normal", title: "余温", premise: "测试", finalConflict: "测试", payoffFocus: "测试", epilogueFocus: "测试", statWeights: { intelligence: 1 }, requiredThreadIds: ["test.thread"] },
    { id: "test.bad", worldId: world.id, directionId: "test.guardian", polarity: "bad", title: "苦果", premise: "测试", finalConflict: "测试", payoffFocus: "测试", epilogueFocus: "测试", statWeights: { intelligence: 1 }, requiredThreadIds: ["test.thread"] }
  ]
};

test("导演事件会写入冷却、道具和经被动修正后的后果", () => {
  const run = makeRun();
  const candidate = buildDirectedEventCandidates(run, world, difficulty, [event], [item])[0];
  assert.ok(candidate);
  candidate.preview.statChanges = { intelligence: -2 };
  candidate.preview.item = { ...item, obtainedAge: 1 };

  const advanced = advanceWithDirectedEvent(run, world, candidate, "你在责任与压力间仍守住了判断。" );
  assert.equal(advanced.chunk[0]?.statChanges.intelligence, -1);
  assert.equal(run.items[0]?.id, item.id);
  assert.ok(run.story.seenEventIds.includes(event.id));
  assert.equal(run.story.cooldowns[event.id], run.age + event.cooldownYears);
});

test("关键事件的抉择后果只影响事件指定属性", () => {
  const run = makeRun();
  run.age = 17;
  run.ageStage = world.ageThresholds?.[1] ?? run.ageStage;
  const candidate = buildDirectedEventCandidates(run, world, difficulty, [event], [item])[0];
  assert.equal(candidate.kind, "milestone");
  advanceWithDirectedEvent(run, world, candidate, "你被推到一场无法回避的抉择前。" );
  const resolved = applyMilestoneDecisionAndAdvance(run, world, difficulty, "risky", {
    narrativeOutcome: {
      effects: [{ stat: "charisma", direction: "up", band: "heavy" }]
    }
  });
  const changed = Object.entries(resolved.decisionEvent.statChanges)
    .filter(([, value]) => value !== 0)
    .map(([key]) => key);
  assert.ok(changed.every((key) => key === "charisma" || key === "physique"));
});

test("导演抉择呈现只改写文案，不改变引擎锁定的风险语义", () => {
  const run = makeRun();
  const choice = createDirectedMilestoneChoice(18, event, run.tuningSnapshot);
  run.nextMilestoneChoice = choice;
  const original = choice.options.map((option) => ({ id: option.id, risk: option.risk, reward: option.reward }));

  applyDirectedMilestonePresentation(run, {
    background: "一封旧信把你推到无从回避的取舍前。",
    optionOverrides: [
      { id: "safe", label: "暂守旧约", description: "先护住眼前的人。" },
      {
        id: "balanced", label: "交换证词", description: "以让步换取转机。",
        abilityRefs: ["ability:negotiation"],
        locationDirective: { mode: "revisit", locationRef: "location:hall", purpose: "回到议事处完成交换" }
      },
      { id: "risky", label: "公开旧信", description: "押上名声逼出真相。" }
    ]
  });

  assert.equal(run.nextMilestoneChoice.background, "一封旧信把你推到无从回避的取舍前。");
  assert.deepEqual(
    run.nextMilestoneChoice.options.map((option) => ({ id: option.id, risk: option.risk, reward: option.reward })),
    original
  );
  assert.equal(run.nextMilestoneChoice.options[2]?.label, "公开旧信");
  assert.deepEqual(run.nextMilestoneChoice.options[1]?.abilityRefs, ["ability:negotiation"]);
  assert.equal(run.nextMilestoneChoice.options[1]?.locationDirective?.locationRef, "location:hall");
});

test("事件只能回收已经写入账本的事实", () => {
  const run = makeRun();
  const opener: EventDefinition = {
    ...event,
    id: "fact_opener",
    factEffect: {
      introduce: [{ id: "thread:guardian", kind: "open_question", label: "守望者留下的旧约", threadId: "guardian" }]
    }
  };
  const payoff: EventDefinition = {
    ...event,
    id: "fact_payoff",
    reclaimableFactIds: ["thread:guardian"]
  };

  assert.ok(!buildDirectedEventCandidates(run, world, difficulty, [payoff], [item])
    .some((candidate) => candidate.definition.id === payoff.id));
  const openingCandidate = buildDirectedEventCandidates(run, world, difficulty, [opener], [item])[0];
  assert.ok(openingCandidate);
  advanceWithDirectedEvent(run, world, openingCandidate, "守望者将未竟之约交到你手中。");
  assert.ok(buildDirectedEventCandidates(run, world, difficulty, [payoff], [item])
    .some((candidate) => candidate.definition.id === payoff.id));
});

test("地点本领随回合归档，引用复用且存档分支不会污染已公开快照", () => {
  const run = makeRun();
  const changes = parseNarrativeAssetUpdates({
    locations: [{ ref: "new", name: "山中书院", description: "临溪的学舍与演练庭院。", current: true , spatialDescription: "临溪的学舍与演练庭院。" }],
    abilities: [{ ref: "new", name: "观息", description: "从呼吸辨认疲惫与动作间隙。", source: "在书院练习中学得。", mastery: "初窥门径" , usage: "从呼吸辨认疲惫与动作间隙。" }]
  });
  commitNarrativeMemory(run.narrative, { id: "memory:study", age: 123, text: "你在书院学会观息。", factionIds: [], characterIds: [], factIds: [] });
  commitNarrativeAssets(run.narrative, applyNarrativeAssetUpdates(undefined, changes, { ageFrom: 120, age: 123 }), { ageFrom: 120, age: 123 }, { factionIds: ["academy"] }, "study");
  const original = structuredClone(run.narrative.assets!);
  assert.equal(run.narrative.scene.place, "山中书院");
  assert.equal(run.narrative.memoryEntries.at(-1)?.abilityIds?.[0], original.abilities[0].id);
  assert.equal(original.locations[0].factionIds, undefined, "同场关联保留在经历中，不累加为地点的当前归属");
  assert.deepEqual(run.narrative.memoryEntries.at(-1)?.factionIds, ["academy"]);
  appendPublicTurnRecord(run, { entryId: "study", ageFrom: 120, age: 123, ageStage: { label: "成年" }, kind: "passage", narrative: "你在书院学习观息，渐渐辨认出动作的间隙。", statChanges: {} });
  const saved = JSON.parse(JSON.stringify(run));
  const returned = applyNarrativeAssetUpdates(original, { locations: [{ ...changes!.locations[0], ref: original.locations[0].id }], abilities: [] }, { age: 124 }).assets;
  assert.equal(returned.locations.length, 1);
  assert.equal(returned.locations[0].id, original.locations[0].id);
  const trained = parseNarrativeAssetUpdates({
    locations: [],
    abilities: [{ ...changes!.abilities[0], ref: original.abilities[0].id, mastery: "运用自如" }]
  }, original);
  run.narrative.assets = applyNarrativeAssetUpdates(original, trained, { age: 124 }).assets;
  assert.equal(run.narrative.assets.abilities.length, 1);
  assert.equal(run.narrative.assets.abilities[0].id, original.abilities[0].id);
  assert.equal(toClientRun(run).narrativeAssets?.abilities[0].mastery, "初窥门径");
  assert.equal(run.turnRecords?.at(-1)?.narrativeAssetsSnapshot?.abilities[0].mastery, "初窥门径");
  assert.ok(!JSON.stringify(toClientRun(run).narrativeAssets).includes("academy"));
  assert.equal(saved.narrative.assets.abilities[0].mastery, "初窥门径");
  saved.runId = "restored-branch";
  assert.equal(ensureNarrativeRunState(saved.narrative, true).assets?.abilities[0].id, original.abilities[0].id);
  assert.deepEqual(normalizeNarrativeAssets().abilities, []);
  const message = formatNarrativeAssets(run.narrative.assets);
  assert.ok(message.includes(original.abilities[0].id));
  assert.ok(message.includes("运用自如"), "最新熟练程度进入正文材料");
  assert.ok(message.includes(original.locations[0].id));
  assert.equal(JSON.stringify(narrativeAssetUpdatesSchema(run.narrative.assets)), JSON.stringify(narrativeAssetUpdatesSchema()));
  assert.throws(() => parseNarrativeAssetUpdates({ locations: [{ ref: "missing", name: "远方", description: "一片山谷。", current: true }] }, original));
  assert.deepEqual(original, saved.narrative.assets);
});

test("地点本领未提交更新不改变状态，也不提前投影到历史回合", () => {
  const run = makeRun();
  appendPublicTurnRecord(run, { entryId: "before-choice", age: 10, ageStage: { label: "幼年" }, kind: "scene", narrative: "你站在书院门外，尚未决定是否求学。", statChanges: {} });
  assert.deepEqual(applyNarrativeAssetUpdates(undefined, undefined, { age: 10 }).assets, { locations: [], abilities: [], currentLocationId: undefined });
  assert.equal(parseNarrativeAssetUpdates(undefined), undefined);
  assert.equal(toClientRun(run).narrativeAssets?.abilities.length, 0);
  const changes = { locations: [], abilities: [{ ref: "new", name: "观息", description: "辨别呼吸的变化。", source: "求学所得。", mastery: "初学" , usage: "辨别呼吸的变化。" }] };
  run.narrative.assets = applyNarrativeAssetUpdates(undefined, changes, { age: 10 }).assets;
  assert.equal(toClientRun(run).narrativeAssets?.abilities.length, 0);
  appendPublicTurnRecord(run, { entryId: "after-choice", age: 10, ageStage: { label: "幼年" }, kind: "choice_outcome", narrative: "你决定留下求学，开始练习辨别呼吸的变化。", statChanges: {} });
  assert.equal(toClientRun(run).narrativeAssets?.abilities.length, 1);
});

test("本领规划目录提供能力与条件，获得来历不随目录传入", () => {
  const assets = applyNarrativeAssetUpdates(undefined, {
    locations: [],
    abilities: [
      { ref: "new", name: "听风诀", description: "凭声音判断远处方位", usage: "分辨远处声息", source: "旅途中习得", mastery: "熟练" },
      { ref: "new", name: "旧印术", description: "已经无法施展", source: "旧日传承", mastery: "残缺" , usage: "已经无法施展" }
    ]
  }, { age: 12 }).assets;
  const directory = narrativeAbilityDirectory(assets);
  assert.match(directory[0].label, /听风诀（熟练）.*凭声音判断远处方位.*分辨远处声息/);
  assert.ok(directory.every((entry) => !entry.label.includes("旅途中习得")));
});

test("旧资产在周期同步中补充用途，状态目录先于正文且与解析引用一致", async (t) => {
  const run = makeRun(); run.age = 12;
  run.narrative.assets = {
    locations: [{ id: "location:legacy", name: "河口营地", description: "去年在此守关，营地邻河且仅有一座吊桥。", introduced: { age: 10 }, lastSeen: { age: 12 } }],
    abilities: [{ id: "ability:legacy", name: "听风辨位", description: "上次救出同伴时凭声定位。", source: "师父所授", mastery: "初通", introduced: { age: 10 }, updated: { age: 12 } }],
    currentLocationId: "location:legacy"
  };
  const archived = publicNarrativeAssetsSnapshot(run.narrative.assets);
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { messages: Array<{ content: string }> }) => {
    const body = payload.messages.slice(1).map((entry) => entry.content).join("\n");
    const locationDirectory = body.split("\n").find((line) => line.startsWith("地点资产："))!;
    const abilityDirectory = body.split("\n").find((line) => line.startsWith("本领资产："))!;
    assert.equal(JSON.parse(locationDirectory.slice("地点资产：".length))[0].id, "location:legacy");
    assert.equal(JSON.parse(abilityDirectory.slice("本领资产：".length))[0].id, "ability:legacy");
    for (const prior of ["目录是当前状态的对照", "主角身份：", "地点资产：", "本领资产：", "可更新事件：", "正文来源与年龄："]) {
      assert.ok(body.indexOf(prior) < body.indexOf("最终正文："));
    }
    assert.equal(body.split("12岁：你在吊桥旁凭听风辨位发现来客，暴雨后听辨失效。").length - 1, 1);
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "sync", type: "function", function: {
      name: "sync_narrative_continuity", arguments: JSON.stringify({ factIntroductions: [], factUpdates: [], identityMerges: [], relationshipUpdates: [],
        locationUpdates: [{ ref: "location:legacy", description: "河口驻军营地。", spatialDescription: "邻河营地，唯一通路是一座吊桥。" }],
        abilityUpdates: [{ ref: "ability:legacy", description: "凭声音判断方位。", usage: "可定位视野外声响；暴雨时失效。" }] })
    } }] } }] };
  });
  const changes = await synchronizeNarrativeContinuity(run, world, { callId: "batch", source: "scene",
    subject: "巡行", narrative: "12岁：你在吊桥旁凭听风辨位发现来客，暴雨后听辨失效。", writeSet: narrativeContinuityWritableSet(run, undefined), continuityRequired: true
  }, { ...memoryTestContext(run), apiKey: "not-sent" });
  run.narrative.assets = applyNarrativeAssetUpdates(run.narrative.assets, changes.assetUpdates, { age: 12 }).assets;
  const restored = JSON.parse(JSON.stringify(run)) as typeof run;
  restored.narrative = ensureNarrativeRunState(restored.narrative, true);
  const text = formatNarrativeAssets(selectNarrativeAssets(restored.narrative.assets!, { abilityIds: ["ability:legacy"], includeCurrentLocation: true }));
  assert.match(text, /唯一通路/);
  assert.match(text, /听风辨位（初通）/);
  assert.doesNotMatch(text, /暴雨时失效/);
  assert.equal(publicNarrativeAssetsSnapshot(restored.narrative.assets).abilities[0].usage, "可定位视野外声响；暴雨时失效。");
  assert.doesNotMatch(text, /上次救出同伴|去年在此守关|师父所授/);
  assert.equal(archived!.abilities[0].description, "上次救出同伴时凭声定位。");
});

test("资产活动只记录到访和使用，不重写稳定档案", () => {
  const run = makeRun();
  const created = applyNarrativeAssetUpdates(undefined, {
    locations: [{ ref: "new", name: "北营校场", description: "边军操练与点兵的校场。", current: false , spatialDescription: "边军操练与点兵的校场。" }],
    abilities: [{ ref: "new", name: "骑射", description: "在奔马中稳定开弓。", source: "随边军操练习得。", mastery: "初通" , usage: "在奔马中稳定开弓。" }]
  }, { age: 12 }).assets;
  const location = created.locations[0]!;
  const ability = created.abilities[0]!;
  const active = applyNarrativeAssetActivity(created, {
    locationIds: [location.id], currentLocationId: location.id,
    abilityIds: [ability.id]
  }, { age: 14 });
  assert.equal(active.currentLocationId, location.id);
  assert.deepEqual(active.locations[0].lastSeen, { age: 14 });
  assert.equal(active.locations[0].description, location.description);
  assert.equal(active.abilities[0].mastery, ability.mastery);
  assert.deepEqual(active.abilities[0].updated, ability.updated);
  run.narrative.assets = active;
  const episode = commitNarrativeEpisode(run, {
    callId: "activity", sourceEventId: "activity:14", turnKind: "scene", age: 14,
    locationIds: [location.id], abilityIds: [ability.id]
  });
  assert.deepEqual(episode.locationIds, [location.id]);
  assert.deepEqual(episode.abilityIds, [ability.id]);
  assert.equal(run.narrative.memoryEntries.some((entry) => entry.id === "memory:activity:14"), false);
  assert.equal(narrativeLocationDirectory(active)[0].id, location.id);
  assert.match(narrativeLocationDirectory(active)[0].label, /北营校场.*边军操练与点兵的校场.*当前所在/);
});

test("连续性同步由持久变化信号触发", () => {
  const emptyWriteSet = { factIds: [], characterIds: [], locationIds: [], abilityIds: [] };
  assert.equal(hasNarrativeContinuityWork(emptyWriteSet, false), false);
  assert.equal(hasNarrativeContinuityWork(emptyWriteSet, true), true);
});

test("连续性资产工具始终开放稳定的数组式差量协议", () => {
  const assets = applyNarrativeAssetUpdates(undefined, {
    locations: [{ ref: "new", name: "营地", description: "驻军营地", current: true , spatialDescription: "驻军营地" }],
    abilities: [{ ref: "new", name: "骑射", description: "骑马开弓", source: "军中习得", mastery: "初通" , usage: "骑马开弓" }]
  }, { age: 12 }).assets;
  const contract = narrativeContinuityAssetContract(assets);
  assert.deepEqual(contract.required, ["locationUpdates", "abilityUpdates"]);
  assert.deepEqual(Object.keys(contract.properties).sort(), ["abilityUpdates", "locationUpdates"]);
  assert.equal((contract.properties.locationUpdates as any).items.properties.ref.enum, undefined);
  assert.equal((contract.properties.abilityUpdates as any).items.properties.ref.enum, undefined);
  assert.throws(() => parseNarrativeContinuityAssetUpdates({}, assets));
});

test("空目录可由连续性同步新建多个地点与本领并进入提交和下轮目录", () => {
  const run = makeRun();
  const changes = parseNarrativeContinuityAssetUpdates({
    locationUpdates: [
      { ref: "new", name: "北营校场", description: "驻军操练的校场", current: false , spatialDescription: "驻军操练的校场" },
      { ref: "new", name: "河湾小哨", description: "俯瞰河道的前沿哨所", current: true , spatialDescription: "俯瞰河道的前沿哨所" }
    ],
    abilityUpdates: [
      { ref: "new", name: "骑射", description: "在奔马中开弓", source: "随边军练习习得", mastery: "初通" , usage: "在奔马中开弓" }
    ]
  }, normalizeNarrativeAssets());
  assert.deepEqual(changes.locations.map((entry) => entry.ref), ["new", "new"]);
  assert.deepEqual(changes.abilities.map((entry) => entry.ref), ["new"]);
  const committed = commitNarrativeAssets(run.narrative, applyNarrativeAssetUpdates(run.narrative.assets, changes, { age: 12 }), { age: 12 }, {}, "scene:12");
  const episode = commitNarrativeEpisode(run, {
    callId: "scene:12", sourceEventId: "scene:12", turnKind: "scene", age: 12,
    locationIds: committed.locationIds, abilityIds: committed.abilityIds
  });
  assert.equal(run.narrative.assets?.currentLocationId, committed.locationIds[1]);
  assert.deepEqual(episode.locationIds, committed.locationIds);
  assert.deepEqual(episode.abilityIds, committed.abilityIds);
  assert.deepEqual(narrativeLocationDirectory(run.narrative.assets).map((entry) => entry.id), committed.locationIds);
  assert.equal(narrativeAbilityDirectory(run.narrative.assets)[0]?.id, committed.abilityIds[0]);
  const recalled = formatNarrativeAssets(selectNarrativeAssets(run.narrative.assets!, {
    locationIds: [committed.locationIds[1]!], abilityIds: committed.abilityIds
  }));
  assert.match(recalled, /河湾小哨/);
  assert.match(recalled, /骑射/);
});

test("规划引用不再被历史关联评分或人数截取覆盖，连续性按写入目标取档案", async () => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  const run = makeRun(); run.age = 20; run.worldId = definition.worldId; run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  const abilities = Array.from({ length: 5 }, (_, i) => ({
    id: `ability:selected-${i}`, name: `能力${i}`, description: `能力${i}的实际用途`, source: "军中习得", mastery: "初通",
    introduced: { age: 18 }, updated: { age: 18 }, factIds: i < 3 ? ["fact:old-a", "fact:old-b"] : []
  }));
  run.narrative.assets = {
    locations: [{ id: "location:current", name: "现营", description: "当前驻守的营地", spatialDescription: "当前驻守的营地", introduced: { age: 18 }, lastSeen: { age: 18 } }],
    abilities, currentLocationId: "location:current"
  };
  const characterIds = Array.from({ length: 6 }, (_, i) => `character:selected-${i}`);
  run.narrative.dynamicCharacters = characterIds.map((id, i) => ({ id, name: `同袍${i}`, role: "军士", description: `第${i}支小队的军士`,
    status: "active", importance: "recurring", introducedAge: 18, lastSeenAge: 18, relatedFactIds: [], relatedRouteIds: [] }));
  const selected = selectDynamicNarrativeContext(run, {
    task: "rendering", characterIds, abilityIds: [abilities[4].id], factIds: ["fact:old-a", "fact:old-b"], text: "能力0 能力1 能力2"
  });
  assert.deepEqual(selected.characters.map((entry) => entry.id), characterIds);
  assert.deepEqual(selected.assetSources!.filter((entry) => entry.kind === "ability").map((entry) => entry.id), [abilities[4].id]);
  assert.ok(!selectDynamicNarrativeContext(run, { task: "rendering", abilityIds: [], text: "能力0" }).assetSources!.some((entry) => entry.kind === "ability"));
  const focusIds = [...characterIds, ...abilities.slice(1).map((entry) => entry.id)];
  const plan = buildNarrativePromptPlan(run, definition, null, "rendering", { focusIds })!;
  const context = composeNarrativeContext({ task: "rendering", plan, taskPrompt: "组织守军的行动" });
  assert.ok(focusIds.every((id) => context.renderedContext.includes(id)), "规划选择超过旧上限时仍完整传入正文请求");
  const selectedAbility = abilities[4];
  const continuity = buildNarrativePromptPlan(run, definition, null, "continuity", { focusIds: [selectedAbility.id] })!;
  assert.deepEqual(continuity.recall!.assetSources!.map((entry) => entry.id), [selectedAbility.id]);
  assert.match(continuity.recall!.assetSources![0].text, /初通/);
  assert.ok(selectDynamicNarrativeContext(run, { task: "background", abilityIds: [selectedAbility.id] }).assetSources!.some((entry) => entry.kind === "ability"));
});

test("公开运行态只投影最后一个已提交回合的快照", () => {
  const run = makeRun();
  run.age = 8;
  run.stats.intelligence = 17;
  run.fame = 12;
  appendPublicTurnRecord(run, {
    entryId: "visible-turn",
    age: 4,
    ageStage: { label: "幼年" },
    kind: "passage",
    narrative: "你在乡里识字读书。",
    statChanges: { intelligence: 1 }
  });
  run.stats.intelligence = 31;
  run.fame = 40;

  const publicRun = toClientRun(run);
  assert.equal(publicRun.age, 4);
  assert.equal(publicRun.stats.intelligence, 17);
  assert.equal(publicRun.fame, 12);
});

test("开局身世作为0岁的独立公开回合持久化", () => {
  const run = makeRun();
  run.narrative.opening = {
    status: "ready",
    profile: {
      summary: "你出身于一户重视书信与账目的寻常人家。",
      seedHints: ["家中留有一封未寄出的旧信。"]
    }
  };
  appendPublicTurnRecord(run, {
    entryId: "origin",
    age: 0,
    ageStage: { label: "幼年" },
    kind: "origin",
    narrative: "你出生在城南雨巷的一户人家，家人以旧书与账册维持生计。",
    statChanges: {}
  });

  const publicRun = toClientRun(run);
  assert.equal(publicRun.opening?.status, "ready");
  assert.equal(publicRun.age, 0);
  assert.equal(run.turnRecords[0]?.kind, "origin");
  assert.deepEqual(run.turnRecords[0]?.statChanges, {});
});

test("身世只提供出生时的来处，不预写第一幕或主角往后的年龄", async () => {
  const definition = await loadNarrativeWorldDefinition("ancient");
  assert.ok(definition);
  const pack = await loadNarrativeStoryPack(definition, "ancient.frontier-commander");
  assert.ok(pack);
  const run = makeRun();
  run.storyPackSnapshot = pack;
  const prompt = narrativeOriginPrompt(run);
  assert.match(prompt, /家庭身份与生计须通向本线第一幕/);
  assert.ok(prompt.includes(pack.acts[0].objective));
  assert.equal(prompt.includes(pack.routePromise), false);
  assert.equal(prompt.includes(pack.originSeeds[0]), false);
  assert.equal(buildNarrativePromptPlan(run, resolveNarrativeExperience(definition, pack), null, "origin")?.mainlineSkeleton, undefined);
});

test("早年限制来自世界包，边界后仍由属性资格决定主线开场", () => {
  const earlyWorld: NarrativeWorldDefinition = {
    ...narrativeWorld,
    opening: { earlyLife: { maxAge: 3 } }
  };

  assert.equal(isNarrativeEarlyLife(earlyWorld, 0), true);
  assert.equal(isNarrativeEarlyLife(earlyWorld, 2), true);
  assert.equal(isNarrativeEarlyLife(earlyWorld, 3), false);
  assert.equal(isNarrativeEarlyLife(earlyWorld, 4), false);
});

test("待决抉择会修复到同年龄的公开回合记录", () => {
  const run = makeRun();
  run.age = 17;
  run.ageStage = world.ageThresholds?.[1] ?? run.ageStage;
  const candidate = buildDirectedEventCandidates(run, world, difficulty, [event], [item])[0];
  assert.equal(candidate?.kind, "milestone");
  const advanced = advanceWithDirectedEvent(run, world, candidate!, "一纸任命把你推到抉择之前。" );
  const sourceEvent = advanced.chunk[0];
  assert.ok(sourceEvent);

  appendPublicTurnRecord(run, toPublicTimelineEntryFromEvent(run, sourceEvent, world));
  ensureVisibleTurnRecords(run, world);

  const publicRun = toClientRun(run);
  assert.equal(publicRun.phase, "waiting_decision");
  assert.ok(publicRun.nextMilestoneChoice);
  assert.equal(run.turnRecords?.at(-1)?.choice?.age, run.age);
});

test("未经状态机引导的完成请求不能直接结束故事", () => {
  const run = makeRun();
  assert.equal(applyDirectedClosureRequest(run, "finish"), "ignored");
  assert.equal(run.ended, false);
});

test("路线开场受世界包属性资格控制，不受年龄硬触发", () => {
  const run = createRun(
    { world, difficulty, cards: [card], tuning: createDefaultGameplayTuning(), narrativeEnabled: true },
    {
      clientId: "narrative-test-client",
      worldId: world.id,
      storyPackId: "test.story-pack",
      difficultyId: difficulty.id,
      personaPrompt: "想查清旧档的人",
      talentPointTotal: 25,
      stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 },
      selectedCardIds: [card.id]
    }
  );
  const setup: EventDefinition = {
    ...event,
    id: "gated_setup",
    kind: "milestone",
    narrativeBeat: "setup",
    narrativeThreadIds: ["test.thread"],
    storyDirectionIds: ["test.guardian"]
  };

  assert.equal(run.endAge, Number.MAX_SAFE_INTEGER);
  assert.ok(!buildDirectedEventCandidates(run, world, difficulty, [setup], [item], [], narrativeWorld)
    .some((candidate) => candidate.definition.id === setup.id));
  run.stats.intelligence = 8;
  const candidate = buildDirectedEventCandidates(run, world, difficulty, [setup], [item], [], narrativeWorld)
    .find((item) => item.definition.id === setup.id);
  assert.ok(candidate);
  assert.equal(candidate.kind, "normal");
});

test("世界幕入口不会覆盖场景内部的压力与高潮门槛", () => {
  const run = createRun(
    { world, difficulty, cards: [card], tuning: createDefaultGameplayTuning(), narrativeEnabled: true },
    {
      clientId: "paced-scene-client",
      worldId: world.id,
      storyPackId: "test.story-pack",
      difficultyId: difficulty.id,
      personaPrompt: "愿意承担旧案余波的人",
      talentPointTotal: 25,
      stats: { intelligence: 8, charisma: 5, family: 4, fortune: 4, physique: 4 },
      selectedCardIds: [card.id]
    }
  );
  const definitions: EventDefinition[] = (["setup", "escalation", "pressure", "climax", "payoff"] as const).map((beat) => ({
    ...event,
    id: `paced-${beat}`,
    kind: (beat === "pressure" || beat === "climax" ? "milestone" : "normal") as EventDefinition["kind"],
    narrativeBeat: beat,
    narrativeThreadIds: ["test.thread"],
    opensThreads: beat === "setup" ? ["test.thread"] : undefined,
    resolvesThreads: beat === "payoff" ? ["test.thread"] : undefined,
    storyDirectionIds: ["test.guardian"],
    cooldownYears: 0
  }));
  const pacedWorld: NarrativeWorldDefinition = {
    ...narrativeWorld,
    mainlineActs: [{ id: "entry", label: "起点", prompt: "让旧档显形。", readinessStage: "opening" }],
    progression: {
      ...narrativeWorld.progression!,
      routes: [{
        directionId: "test.guardian",
        gates: {
          opening: { weights: { intelligence: 1 }, threshold: 8 },
          pressure: { weights: { intelligence: 1 }, threshold: 12 },
          climax: { weights: { intelligence: 1 }, threshold: 16 }
        }
      }]
    }
  };
  const candidateFor = (beat: EventDefinition["narrativeBeat"]) => buildDirectedEventCandidates(
    run, world, difficulty, definitions, [item], [], pacedWorld
  ).find((candidate) => candidate.definition.narrativeBeat === beat);

  const setup = candidateFor("setup");
  assert.equal(setup?.kind, "normal");
  advanceWithDirectedEvent(run, world, setup!, "旧档先在日常细节中露出痕迹。", undefined, undefined, pacedWorld, {
    attributeOutcome: { effects: [{ stat: "charisma", direction: "up", band: "light" }] }
  });
  const escalation = candidateFor("escalation");
  assert.equal(escalation?.kind, "normal");
  advanceWithDirectedEvent(run, world, escalation!, "你逐渐察觉到证词彼此抵触。", undefined, undefined, pacedWorld, {
    attributeOutcome: { effects: [{ stat: "charisma", direction: "up", band: "light" }] }
  });

  // 入口阈值已满足，但压力阈值尚未满足，故仍是普通加压而非抉择。
  assert.equal(candidateFor("escalation")?.kind, "normal");
  run.stats.intelligence = 12;
  const pressure = candidateFor("pressure");
  assert.equal(pressure?.kind, "milestone");
  advanceWithDirectedEvent(run, world, pressure!, "证人要求你立刻表态。", undefined, undefined, pacedWorld);
  run.nextMilestoneChoice = undefined;

  // 高潮门槛不足时，压力场景继续以普通叙事推进。
  assert.equal(candidateFor("pressure")?.kind, "normal");
  run.stats.intelligence = 16;
  assert.equal(candidateFor("climax")?.kind, "milestone");
});

test("叙事世界没有合法候选时不会生成全路线普通事件", () => {
  const run = createRun(
    { world, difficulty, cards: [card], tuning: createDefaultGameplayTuning(), narrativeEnabled: true },
    {
      clientId: "empty-candidate-client",
      worldId: world.id,
      storyPackId: "test.story-pack",
      difficultyId: difficulty.id,
      personaPrompt: "仍在积累处境的人",
      talentPointTotal: 25,
      stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 },
      selectedCardIds: [card.id]
    }
  );

  assert.deepEqual(
    buildDirectedEventCandidates(run, world, difficulty, [], [item], [], narrativeWorld),
    []
  );
});

test("模型选定路线后由旧高潮状态机在该路线选择当前拍点的具体事件", () => {
  const run = createRun(
    { world, difficulty, cards: [card], tuning: createDefaultGameplayTuning(), narrativeEnabled: true },
    {
      clientId: "route-material-client",
      worldId: world.id,
      storyPackId: "test.story-pack",
      difficultyId: difficulty.id,
      personaPrompt: "愿意承担旧案余波的人",
      talentPointTotal: 25,
      stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 },
      selectedCardIds: [card.id]
    }
  );
  run.stats.intelligence = 8;
  const direction: StoryDirectionDefinition = {
    id: "test.guardian",
    label: "守望路线",
    summary: "从旧档承担世界冲突。",
    focusTags: ["guardian"],
    factionIds: [],
    openingThreadIds: ["test.thread"],
    closureTags: []
  };
  const parallelDirection: StoryDirectionDefinition = {
    id: "test.parallel",
    label: "并行路线",
    summary: "以另一段经历承接同一世界冲突。",
    focusTags: ["parallel"],
    factionIds: [],
    openingThreadIds: ["test.parallel.thread"],
    closureTags: []
  };
  const definitions: EventDefinition[] = (["setup", "escalation", "pressure", "climax", "payoff"] as const).map((beat) => ({
    ...event,
    id: `route-${beat}`,
    kind: beat === "pressure" || beat === "climax" || beat === "payoff" ? "milestone" : "normal",
    narrativeBeat: beat,
    narrativeThreadIds: ["test.thread"],
    opensThreads: beat === "setup" ? ["test.thread"] : undefined,
    resolvesThreads: beat === "payoff" ? ["test.thread"] : undefined,
    storyDirectionIds: ["test.guardian"],
    cooldownYears: 0
  }));
  const worldWithActs: NarrativeWorldDefinition = {
    ...narrativeWorld,
    version: 3,
    routeArcs: [{
      directionId: "test.guardian",
      summary: "从旧档承担世界冲突。",
      coreThreadIds: ["test.thread"],
      materialEventIds: definitions.map((definition) => definition.id)
    }, {
      directionId: "test.parallel",
      summary: "以另一段经历承接同一世界冲突。",
      coreThreadIds: ["test.parallel.thread"]
    }],
    mainlineActs: [
      { id: "entry", label: "起点", prompt: "让旧档显形。" },
      { id: "pressure", label: "压力", prompt: "让代价扩大。" },
      { id: "reckoning", label: "回收", prompt: "承担结果。" }
    ],
    progression: {
      ...narrativeWorld.progression!,
      completion: {
        ...narrativeWorld.progression!.completion,
        requireResolvedCoreFacts: false,
        requireDecisionConsequence: false,
        requireNoActiveScene: true,
        requireAllMainlineActs: true,
        minCompletedSceneInstances: 3
      }
    }
  };
  const parallelSetup: EventDefinition = {
    ...event,
    id: "parallel-setup",
    narrativeBeat: "setup",
    narrativeThreadIds: ["test.parallel.thread"],
    opensThreads: ["test.parallel.thread"],
    storyDirectionIds: [parallelDirection.id],
    cooldownYears: 0
  };
  const openingCandidates = buildDirectedEventCandidates(
    run,
    world,
    difficulty,
    [...definitions, parallelSetup],
    [item],
    [direction, parallelDirection],
    worldWithActs
  );
  const parallelOpening = selectDirectedCandidateForIntent(
    run,
    openingCandidates,
    "continue",
    undefined,
    undefined,
    worldWithActs,
    parallelDirection.id
  );
  assert.equal(parallelOpening?.definition.id, parallelSetup.id);
  advanceWithDirectedEvent(run, world, parallelOpening!, "另一段经历先留下了未解的余波。", parallelDirection, undefined, worldWithActs, {
    experienceId: parallelDirection.id,
    attributeOutcome: { effects: [{ stat: "charisma", direction: "up", band: "light" }] }
  });
  assert.equal(getNarrativeRouteProgress(run.narrative, parallelDirection.id)?.phase, "setup");

  for (const actId of ["entry", "pressure", "reckoning"]) {
    for (const expectedBeat of ["setup", "escalation", "pressure", "climax", "payoff"] as const) {
      const candidates = buildDirectedEventCandidates(run, world, difficulty, definitions, [item], [direction], worldWithActs);
      const candidate = selectDirectedCandidateForIntent(
        run,
        candidates,
        expectedBeat === "payoff" ? "payoff" : "continue",
        undefined,
        undefined,
        worldWithActs,
        direction.id
      );
      assert.equal(candidate?.definition.narrativeBeat, expectedBeat);
      advanceWithDirectedEvent(run, world, candidate!, "旧档的代价终于落到你面前。", direction, undefined, worldWithActs, {
      experienceId: "test.guardian",
        attributeOutcome: candidate?.kind === "normal"
          ? { effects: [{ stat: "charisma", direction: "up", band: "light" }] }
          : undefined,
        completeMainlineAct: candidate?.definition.narrativeBeat === "payoff"
      });
      run.nextMilestoneChoice = undefined;
    }
    assert.ok(run.narrative.completedScenes.some((scene) => scene.mainlineActId === actId));
    if (actId !== "reckoning") {
      assert.equal(getNarrativeRouteProgress(run.narrative, direction.id), undefined);
      assert.equal(getNarrativeRouteProgress(run.narrative, parallelDirection.id), undefined);
    }
  }

  assert.deepEqual(run.narrative.completedScenes.map((scene) => scene.mainlineActId), ["entry", "pressure", "reckoning"]);
  assert.equal(run.story.closureExperienceId, "test.guardian");
  assert.ok(run.story.committedDirectionIds.includes("test.guardian"));
});

test("具体事件的最大年龄只影响排序，不会清空候选池", () => {
  const run = makeRun();
  run.age = 130;
  const agedMaterial: EventDefinition = { ...event, id: "aged_material", maxAge: 24 };

  const candidates = buildDirectedEventCandidates(run, world, difficulty, [agedMaterial], [item]);
  assert.ok(candidates.some((candidate) => candidate.definition.id === "aged_material"));
});

test("当前拍点没有具体素材时不注入通用情境原型", () => {
  const run = createRun(
    { world, difficulty, cards: [card], tuning: createDefaultGameplayTuning(), narrativeEnabled: true },
    {
      clientId: "archetype-fallback-client",
      worldId: world.id,
      storyPackId: "test.story-pack",
      difficultyId: difficulty.id,
      personaPrompt: "想查清旧档的人",
      talentPointTotal: 25,
      stats: { intelligence: 8, charisma: 5, family: 4, fortune: 4, physique: 4 },
      selectedCardIds: [card.id]
    }
  );
  run.narrative.activeScene = {
    id: "test-scene",
    threadId: "test.thread",
    phase: "setup",
    openedAge: 8,
    lastTouchedAge: 8
  };
  run.narrative.threads = [{ id: "test.thread", status: "seeded", openedAge: 8, lastTouchedAge: 8 }];
  const cooldownedEscalation: EventDefinition = {
    ...event,
    id: "cooldowned_escalation",
    narrativeBeat: "escalation",
    narrativeThreadIds: ["test.thread"],
    storyDirectionIds: ["test.guardian"]
  };
  run.story.cooldowns[cooldownedEscalation.id] = 100;
  const candidates = buildDirectedEventCandidates(
    run,
    world,
    difficulty,
    [cooldownedEscalation],
    [item],
    [],
    narrativeWorld
  );
  assert.deepEqual(candidates, []);
});

test("完成主线后可申请结局，年龄不再是额外门槛", () => {
  const run = createRun(
    { world, difficulty, cards: [card], tuning: createDefaultGameplayTuning(), narrativeEnabled: true },
    {
      clientId: "closure-test-client",
      worldId: world.id,
      storyPackId: "test.story-pack",
      difficultyId: difficulty.id,
      personaPrompt: "愿意承担旧账的人",
      talentPointTotal: 25,
      stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 },
      selectedCardIds: [card.id]
    }
  );
  run.age = 18;
  run.story.contract.initialDirectionId = "test.guardian";
  run.story.contract.coreThreadIds = ["test.thread"];
  run.story.activeDirectionId = "test.guardian";
  run.story.committedDirectionIds = ["test.guardian"];
  run.story.factLedger!.facts = [
    { id: "decision:test", kind: "commitment", label: "已作承诺", status: "open", introducedAge: 16, lastTouchedAge: 16, sourceEventId: "test" },
    { id: "thread:test.thread", kind: "open_question", label: "旧档", threadId: "test.thread", status: "resolved", introducedAge: 15, lastTouchedAge: 18, resolvedAge: 18, sourceEventId: "test" }
  ];
  run.narrative.climaxCount = 1;
  run.narrative.payoffCount = 1;
  run.narrative.completedScenes = [{
    id: "legacy-complete-scene",
    threadId: "test.thread",
    experienceId: "test.guardian",
    openedAge: 15,
    resolvedAge: 18,
    decisionCount: 1
  }];
  run.narrative.threads = [{ id: "test.thread", status: "resolved", openedAge: 15, lastTouchedAge: 18 }];

  const source = { worldId: run.worldId, age: run.age, personaPrompt: run.personaPrompt, stats: run.stats, cards: run.cards, items: run.items, story: run.story, narrative: run.narrative };
  assert.equal(refreshNarrativeMainlineCompletion(source, narrativeWorld), true);
  assert.equal(run.story.mainlineCompleted, true);
  assert.equal(assessClosureReadiness(source, narrativeWorld).eligible, true);
  assert.deepEqual(
    buildDirectedEventCandidates(run, world, difficulty, [event], [item], [], narrativeWorld),
    []
  );
  assert.equal(applyDirectedClosureRequest(run, "guide", narrativeWorld), "guiding");
  assert.ok(run.narrative.endingBlueprintId);
  assert.equal(run.story.closureState, "guiding");
  assert.equal(applyDirectedClosureRequest(run, "finish", narrativeWorld), "finished");
  assert.equal(run.ended, true);
});

test("基础世界与可独立发现的 IF 路线组合为运行时叙事", async () => {
  const ancientWorld = await loadNarrativeWorldDefinition("ancient");
  const modernWorld = await loadNarrativeWorldDefinition("modern");
  const fantasyWorld = await loadNarrativeWorldDefinition("fantasy");
  assert.ok(ancientWorld);
  assert.ok(modernWorld);
  assert.ok(fantasyWorld);
  const storyPacks = await loadNarrativeStoryPacksForWorld(ancientWorld);
  assert.equal(ancientWorld.mainlineFacts?.length ?? 0, 0);
  assert.equal(ancientWorld.mainlineActs, undefined);
  assert.equal(ancientWorld.storyPatterns, undefined);
  assert.equal(ancientWorld.version, 10);
  assert.equal(ancientWorld.socialForces?.length, 12);
  assert.ok((ancientWorld.worldCards?.length ?? 0) > 10);
  assert.doesNotMatch(ancientWorld.storyBible, /清丈|田册|账册|旧案/);
  const localSociety = ancientWorld.worldCards?.find((entry) => entry.id === "ancient.snapshot.local_society");
  const reform = ancientWorld.worldCards?.find((entry) => entry.id === "ancient.snapshot.jingyuan_reform");
  assert.ok(localSociety);
  assert.doesNotMatch(localSociety.content, /册页|仓门|证词/);
  assert.match(reform?.content ?? "", /清丈|田册/);
  assert.equal(storyPacks.length, 6);
  const ancientCardIds = new Set(ancientWorld.worldCards?.map((card) => card.id));
  for (const pack of storyPacks) {
    assert.equal(Object.prototype.hasOwnProperty.call(pack, "worldCards"), false);
    assert.ok(pack.worldCardRefs?.length);
    assert.ok(pack.worldCardRefs?.every((id) => ancientCardIds.has(id)));
    assert.ok(pack.acts.every((act) => act.worldCardRefs?.every((id) => ancientCardIds.has(id))));
  }
  const selected = storyPacks.find((pack) => pack.id === "ancient.sovereign-rise");
  assert.ok(selected);
  const experience = resolveNarrativeExperience(ancientWorld, selected);
  assert.deepEqual(experience.mainlineActs?.map((act) => act.id), selected.acts.map((act) => act.id));
  assert.equal(experience.storyPack.id, selected.id);
  assert.deepEqual(experience.worldCards?.map((card) => card.id), ancientWorld.worldCards?.map((card) => card.id));
  assert.equal(experience.mainlineSkeleton?.premise, selected.routePromise);
  assert.match(experience.mainlineActs?.[0]?.prompt ?? "", /朝廷|军镇|地方官署|宗族门第|乡里百姓/);
  assert.equal(ancientWorld.routeArcs, undefined);
  assert.throws(() => validateNarrativeStoryPack({
    ...selected,
    worldCardRefs: ["ancient.missing.card"]
  }, ancientWorld), /world_card_reference_invalid/);
  assert.throws(() => validateNarrativeStoryPack({
    ...selected,
    worldCards: []
  } as unknown as typeof selected, ancientWorld), /embedded_world_cards_not_supported/);
  for (const definition of [modernWorld, fantasyWorld]) {
    const packs = await loadNarrativeStoryPacksForWorld(definition);
    assert.equal(definition.version, 10);
    assert.equal(definition.mainlineActs, undefined);
    assert.equal(definition.storyPatterns, undefined);
    assert.equal(packs.length, 6);
    const resolved = resolveNarrativeExperience(definition, packs[0]!);
    assert.equal(resolved.storyPack.id, packs[0]!.id);
    assert.deepEqual(resolved.mainlineActs?.map((act) => act.id), packs[0]!.acts.map((act) => act.id));
  }
});

test("三个世界的领域素材按幕引用且保持开放的召回预算", async () => {
  const expectations = {
    ancient: { minimumCards: 30, actionTerms: ["侦察", "攻城", "辩经", "立派"] },
    fantasy: { minimumCards: 24, actionTerms: ["探索", "斗法", "守城", "飞升"] },
    modern: { minimumCards: 24, actionTerms: ["面试", "协作", "融资", "转型"] }
  } as const;

  for (const [worldId, expectation] of Object.entries(expectations)) {
    const definition = await loadNarrativeWorldDefinition(worldId);
    assert.ok(definition);
    const domainPrefix = `${worldId}.domain.`;
    const domainCards = (definition.worldCards ?? []).filter((card) => card.id.startsWith(domainPrefix));
    assert.ok(domainCards.length >= expectation.minimumCards);
    assert.ok(expectation.actionTerms.every((term) => definition.narrativePalette?.actionVocabulary.includes(term)));
    const knownCardIds = new Set(definition.worldCards?.map((card) => card.id));
    const packs = await loadNarrativeStoryPacksForWorld(definition);
    assert.equal(packs.length, 6);

    for (const pack of packs) {
      const experience = resolveNarrativeExperience(definition, pack);
      for (const act of pack.acts) {
        const domainRefs = (act.worldCardRefs ?? []).filter((id) => id.startsWith(domainPrefix));
        assert.ok(domainRefs.length >= 3, `${act.id} should reference at least three domain materials`);
        assert.ok((act.worldCardRefs ?? []).every((id) => knownCardIds.has(id)));
        const run = makeRun();
        run.worldId = worldId;
        run.narrative.enabled = true;
        const referencedCard = (experience.worldCards ?? []).find((card) =>
          domainRefs.includes(card.id) &&
          (card.activation?.keys ?? []).some((key) => key.trim().length > 1)
        );
        assert.ok(referencedCard, `${act.id} should reference an activatable domain material`);
        const trigger = referencedCard.activation!.keys!.find((key) => key.trim().length > 1)!;
        const selected = selectNarrativeWorldCards(run, experience, {
          task: "planning",
          actId: act.id,
          text: trigger,
          preferredCardIds: act.worldCardRefs
        });
        assert.ok(selected.some((card) => card.id === referencedCard.id), `${act.id} should recall the matching authored domain material`);
        assert.equal(new Set(selected.map((card) => card.id)).size, selected.length);
        assert.ok(selected.every((card) => experience.worldCards!.some((entry) => entry.id === card.id)));
      }
    }
  }
});

test("全局文风示例不绑定某条路线的具体事件", async () => {
  const routeSpecificObjects = /粮仓|账册|掌柜|石门|阵眼|追兵|邮件|新岗位|复诊|合租/;
  for (const worldId of ["ancient", "fantasy", "modern"]) {
    const definition = await loadNarrativeWorldDefinition(worldId);
    assert.ok(definition);
    const examples = (definition.worldCards ?? []).filter((card) => card.kind === "style_example");
    assert.equal(examples.length, 3);
    assert.ok(examples.every((card) => !routeSpecificObjects.test(card.content)));
  }
});

test("古代世界的 opening 属性门槛由世界级门槛控制", async () => {
  const [definitions, ancientWorld] = await Promise.all([
    loadEventDefinitions("ancient"),
    loadNarrativeWorldDefinition("ancient")
  ]);
  assert.ok(ancientWorld);
  const ancientRun = makeRun();
  ancientRun.worldId = "ancient";
  ancientRun.narrative.enabled = true;
  ancientRun.age = 0;
  ancientRun.stats = { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 };
  const ancientConfig: WorldConfig = { ...world, id: "ancient" };
  const candidates = buildDirectedEventCandidates(ancientRun, ancientConfig, difficulty, definitions, [item], [], ancientWorld);
  assert.equal(isNarrativeMainlineActEntryReady(ancientRun, ancientWorld), false);
  assert.ok(Array.isArray(candidates));
});

test("叙事迁移不会再把超过 120 岁的活动场景压回 120 岁", () => {
  const migrated = ensureNarrativeRunState({
    ...makeRun().narrative,
    version: 2,
    enabled: true,
    activeScene: { id: "legacy-scene", threadId: "test.thread", phase: "pressure", openedAge: 120, lastTouchedAge: 120 }
  }, true, 153);
  assert.equal(migrated.activeScene?.lastTouchedAge, 153);
  assert.equal(migrated.activeScene?.openedAge, 153);
});

test("普通年份只接受轻度或中度模型属性后果", () => {
  const run = makeRun();
  assert.deepEqual(
    approveNarrativeAttributeOutcome(run, world, {
      effects: [{ stat: "intelligence", direction: "up", band: "heavy" }]
    }, "background"),
    null
  );
  assert.equal(
    approveNarrativeAttributeOutcome(run, world, {
      effects: [{ stat: "intelligence", direction: "up", band: "medium" }]
    }, "background")?.intelligence,
    2
  );
});

test("导演抉择按稳健、适中、冒险分别审批属性后果", () => {
  const run = makeRun();
  run.age = 17;
  run.ageStage = world.ageThresholds?.[1] ?? run.ageStage;
  const candidate = buildDirectedEventCandidates(run, world, difficulty, [event], [item])[0];
  assert.ok(candidate);
  advanceWithDirectedEvent(run, world, candidate!, "旧约将你推到必须表态的关口。");
  const policies = run.pendingDirectedDecisionPolicy!;

  assert.equal(
    approveNarrativeAttributeOutcome(run, world, {
      effects: [{ stat: "charisma", direction: "up", band: "medium" }]
    }, "decision", policies.safe),
    null
  );
  assert.equal(
    approveNarrativeAttributeOutcome(run, world, {
      effects: [{ stat: "charisma", direction: "up", band: "light" }]
    }, "decision", policies.safe)?.charisma,
    1
  );
  const balanced = approveNarrativeAttributeOutcome(run, world, {
      effects: [
        { stat: "charisma", direction: "up", band: "medium" },
        { stat: "physique", direction: "down", band: "light" }
      ]
    }, "decision", policies.balanced);
  assert.equal(balanced?.charisma, 1);
  assert.equal(balanced?.physique, -1);
  const risky = approveNarrativeAttributeOutcome(run, world, {
      effects: [{ stat: "charisma", direction: "down", band: "heavy" }]
    }, "decision", policies.risky);
  assert.equal(risky?.charisma, -3);
});

test("连续场景停表时不会重复推进年龄", () => {
  const run = createRun(
    { world, difficulty, cards: [card], tuning: createDefaultGameplayTuning(), narrativeEnabled: true },
    {
      clientId: "scene-clock-client",
      worldId: world.id,
      storyPackId: "test.story-pack",
      difficultyId: difficulty.id,
      personaPrompt: "在旧案中周旋的人",
      talentPointTotal: 25,
      stats: { intelligence: 8, charisma: 5, family: 4, fortune: 4, physique: 4 },
      selectedCardIds: [card.id]
    }
  );
  run.age = 30;
  run.narrative.activeScene = { id: "held-scene", threadId: "test.thread", phase: "setup", openedAge: 30, lastTouchedAge: 30 };
  run.narrative.sceneClock = { mode: "hold", sameAgeTurnCount: 0, maxSameAgeTurns: 3 };
  run.narrative.threads = [{ id: "test.thread", status: "seeded", openedAge: 30, lastTouchedAge: 30 }];
  const escalation: EventDefinition = {
    ...event,
    id: "held-escalation",
    kind: "normal",
    narrativeBeat: "escalation",
    narrativeThreadIds: ["test.thread"],
    storyDirectionIds: ["test.guardian"]
  };
  const candidate = buildDirectedEventCandidates(run, world, difficulty, [escalation], [item], [], narrativeWorld)[0];
  assert.ok(candidate);
  const advanced = advanceWithDirectedEvent(run, world, candidate!, "旧案在同一日里又露出一处裂缝。", undefined, undefined, narrativeWorld, {
    attributeOutcome: { effects: [{ stat: "charisma", direction: "up", band: "light" }] }
  });
  assert.equal(advanced.fromAge, 30);
  assert.equal(advanced.toAge, 30);
  assert.equal(run.narrative.sceneClock.sameAgeTurnCount, 1);
});

test("动态场景同年计数不强制跨年，明确时间投影决定本轮年龄", () => {
  const run = makeRun();
  run.narrative.enabled = true;
  const definition: NarrativeWorldDefinition = {
    ...narrativeWorld,
    version: 9,
    storyPatterns: [],
    socialForces: [],
    mainlineActs: [{ id: "act.clock", label: "同年事件", prompt: "让一件事在同年内连续发展" }]
  };
  run.age = 30;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  run.narrative.activeScene = { id: "clock-scene", threadId: "arc:act.clock", phase: "setup", openedAge: 30, lastTouchedAge: 30, mainlineActId: "act.clock", decisionCount: 0 };
  run.narrative.sceneClock = { mode: "hold", sameAgeTurnCount: 0, maxSameAgeTurns: 3 };
  const advance = () => advanceWithDynamicNarrativeScene(run, world, definition, {
    patternIds: [], forceIds: [], beatDecision: "hold", beat: "setup",
    narrative: "同一件事又向前发展了一步，但还没有到必须跨年的地步。", participants: [],
    attributeOutcome: { effects: [{ stat: "intelligence", direction: "up", band: "light" }] },
    attributePolicy: { allowedStats: ["intelligence"], allowedBands: ["light"], allowedDirections: ["up"], minEffects: 1, maxEffects: 1 },
    sceneClockMode: "hold"
  });
  assert.equal(advance().toAge, 30);
  assert.equal(run.narrative.sceneClock.sameAgeTurnCount, 1);
  assert.equal(advance().toAge, 30);
  assert.equal(run.narrative.sceneClock.sameAgeTurnCount, 2);
  assert.equal(advance().toAge, 30);
  assert.equal(run.narrative.sceneClock.sameAgeTurnCount, 3);
  assert.equal(advance().toAge, 30);
  assert.equal(run.narrative.sceneClock.sameAgeTurnCount, 4);
  advanceWithDynamicNarrativeScene(run, world, definition, {
    patternIds: [], forceIds: [], beatDecision: "hold", beat: "setup", sceneAge: 31, sceneClockMode: "advance",
    narrative: "事情告一段落，次年你开始新的操练。", participants: [],
    attributeOutcome: { effects: [{ stat: "intelligence", direction: "up", band: "light" }] }
  });
  assert.equal(run.age, 31);
  assert.equal(run.narrative.sceneClock.sameAgeTurnCount, 0);
});

test("背景段延后结算后才写入模型提出的年度属性变化", () => {
  const run = makeRun();
  const before = run.stats.intelligence;
  const advanced = autoAdvanceToCheckpoint(run, world, difficulty, {
    targetYears: 1,
    maxTargetYears: 1,
    allowRandomMilestone: false,
    deferNarrativeAttributeEffects: true
  });
  assert.equal(advanced.chunk.length, 1);
  assert.equal(advanced.chunk[0]?.statChanges.intelligence ?? 0, 0);
  assert.equal(settleNarrativeBackgroundOutcomes(run, world, [{
    age: advanced.chunk[0]!.age,
    effects: [{ stat: "intelligence", direction: "up", band: "medium" }]
  }], advanced.chunk.map((event) => event.age)), true);
  assert.equal(run.stats.intelligence, before + 2);
});

test("三个已完成场景可复用同一经历，但必须覆盖世界定义的阶段", () => {
  const run = makeRun();
  run.story.contract.initialDirectionId = "test.guardian";
  run.story.activeDirectionId = "test.guardian";
  run.story.committedDirectionIds = ["test.guardian"];
  run.story.factLedger!.facts = [
    { id: "decision:three", kind: "commitment", label: "三次抉择留下承诺", status: "open", introducedAge: 10, lastTouchedAge: 10, sourceEventId: "test" },
    { id: "thread:test.thread", kind: "open_question", label: "旧档", threadId: "test.thread", status: "resolved", introducedAge: 10, lastTouchedAge: 20, resolvedAge: 20, sourceEventId: "test" },
    { id: "fact.one", kind: "open_question", label: "第一事实", status: "resolved", introducedAge: 10, lastTouchedAge: 20, resolvedAge: 20, sourceEventId: "test" }
  ];
  run.narrative.climaxCount = 3;
  run.narrative.payoffCount = 3;
  run.narrative.threads = [{ id: "test.thread", status: "resolved", openedAge: 10, lastTouchedAge: 20 }];
  run.narrative.completedScenes = ["entry", "pressure", "reckoning"].map((mainlineActId, index) => ({
    id: `scene-${index}`,
    experienceId: "test.guardian",
    threadId: "test.thread",
    mainlineActId,
    openedAge: 10 + index,
    resolvedAge: 11 + index,
    decisionCount: 1
  }));
  const worldWithActs: NarrativeWorldDefinition = {
    ...narrativeWorld,
    mainlineFacts: [{ id: "fact.one", kind: "open_question", label: "第一事实" }],
    mainlineActs: [
      { id: "entry", label: "进入", prompt: "进入处境" },
      { id: "pressure", label: "压力", prompt: "承担压力" },
      { id: "reckoning", label: "回应", prompt: "回应结果" }
    ],
    progression: {
      ...narrativeWorld.progression!,
      completion: { ...narrativeWorld.progression!.completion, minCompletedSceneInstances: 3, requireAllMainlineActs: true }
    }
  };
  const source = { worldId: run.worldId, age: run.age, personaPrompt: run.personaPrompt, stats: run.stats, cards: run.cards, items: run.items, story: run.story, narrative: run.narrative };
  assert.equal(refreshNarrativeMainlineCompletion(source, worldWithActs), true);
});

test("叙事结局以主线完成为前提，并稳定区分好、普通、坏三档", () => {
  const evaluate = (intelligence: number, tags: string[], fame: number) => {
    const run = createRun(
      { world, difficulty, cards: [card], tuning: createDefaultGameplayTuning(), narrativeEnabled: true },
      {
        clientId: `ending-${intelligence}-${tags.join("-") || "plain"}`,
        worldId: world.id,
        storyPackId: "test.story-pack",
        difficultyId: difficulty.id,
        personaPrompt: "愿意承担旧档代价的人",
        talentPointTotal: 25,
        stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 },
        selectedCardIds: [card.id]
      }
    );
    run.age = 36;
    run.stats.intelligence = intelligence;
    run.fame = fame;
    run.story.contract.initialDirectionId = "test.guardian";
    run.story.contract.coreThreadIds = ["test.thread"];
    run.story.activeDirectionId = "test.guardian";
    run.story.committedDirectionIds = ["test.guardian"];
    run.story.factLedger!.facts = [
      { id: "decision:ending", kind: "commitment", label: "承担旧档", status: "open", introducedAge: 20, lastTouchedAge: 20, sourceEventId: "test" },
      { id: "thread:test.thread", kind: "open_question", label: "旧档", threadId: "test.thread", status: "resolved", introducedAge: 18, lastTouchedAge: 36, resolvedAge: 36, sourceEventId: "test" }
    ];
    run.narrative.climaxCount = 1;
    run.narrative.payoffCount = 1;
    run.narrative.threads = [{ id: "test.thread", status: "resolved", openedAge: 18, lastTouchedAge: 36 }];
    run.narrative.completedScenes = [{
      id: "ending-scene",
      experienceId: "test.guardian",
      threadId: "test.thread",
      openedAge: 18,
      resolvedAge: 36,
      decisionCount: 1
    }];
    const history = tags.length ? [{ age: 30, title: "抉择", summary: "后果已留下。", statChanges: {}, tags: ["milestone", ...tags] }] : [];
    const source = {
      worldId: run.worldId,
      age: run.age,
      personaPrompt: run.personaPrompt,
      stats: run.stats,
      fame: run.fame,
      history,
      tuning: run.tuningSnapshot,
      cards: run.cards,
      items: run.items,
      story: run.story,
      narrative: run.narrative,
      difficultyId: run.difficultyId
    };
    assert.equal(refreshNarrativeMainlineCompletion(source, narrativeWorld), true);
    return assessEnding(source, narrativeWorld);
  };

  assert.equal(evaluate(26, ["decision_outcome_breakthrough"], 66).polarity, "good");
  assert.equal(evaluate(17, ["decision_outcome_stable"], 52).polarity, "normal");
  assert.equal(evaluate(9, ["decision_outcome_setback"], 26).polarity, "bad");
});

test("属性档位文案由世界包快照，不写死在引擎或已有存档中", () => {
  const run = createRun(
    { world, difficulty, cards: [card], tuning: createDefaultGameplayTuning(), narrativeEnabled: true },
    {
      clientId: "tier-presentation-client",
      worldId: world.id,
      storyPackId: "test.story-pack",
      difficultyId: difficulty.id,
      personaPrompt: "在世道里慢慢站稳的人",
      talentPointTotal: 25,
      stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 },
      selectedCardIds: [card.id]
    }
  );
  const presentation = {
    intelligence: { low: "学思未定", steady: "明察善断", high: "洞见如炬" },
    charisma: { low: "未谙人情", steady: "善解人意", high: "长袖善舞" },
    family: { low: "根基未稳", steady: "家道可凭", high: "门庭煊赫" },
    fortune: { low: "时运未至", steady: "逢凶化吉", high: "天眷所归" },
    physique: { low: "体弱未成", steady: "筋骨康健", high: "龙精虎健" }
  };
  const configuredWorld: NarrativeWorldDefinition = {
    ...narrativeWorld,
    progression: { ...narrativeWorld.progression!, statTiers: { lowMax: 4, highMin: 8 }, statTierPresentation: presentation },
    mainlineActs: [{ id: "act.one", label: "起始", prompt: "测试" }]
  };
  run.narrative = ensureNarrativeActRuntime(run.narrative, configuredWorld, run.age);
  assert.equal(toClientRun(run).statTierLabels?.intelligence, "明察善断");
  configuredWorld.progression!.statTierPresentation!.intelligence.steady = "不应影响旧局";
  run.narrative = ensureNarrativeActRuntime(run.narrative, configuredWorld, run.age);
  assert.equal(toClientRun(run).statTierLabels?.intelligence, "明察善断");
});

test("动态世界幕以单一五拍推进，路线可切换且常驻人物进入公开投影", () => {
  const run = createRun(
    { world, difficulty, cards: [card], tuning: createDefaultGameplayTuning(), narrativeEnabled: true },
    {
      clientId: "dynamic-world-client",
      worldId: world.id,
      storyPackId: "test.story-pack",
      difficultyId: difficulty.id,
      personaPrompt: "在旧案中寻找出路的人",
      talentPointTotal: 25,
      stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 },
      selectedCardIds: [card.id]
    }
  );
  const dynamicWorld: NarrativeWorldDefinition = {
    ...narrativeWorld,
    version: 9,
    worldCore: {
      identity: "一个由人物选择形成具体命运的测试世界。",
      laws: ["人物已经承担的后果必须继续有效。"],
      powerStructure: "不同社会位置拥有不同资源。",
      everydayLife: "人物通过生活、关系与行动积累能力。",
      tone: "克制而清晰。"
    },
    socialForces: [{ id: "force.one", label: "世道人心", summary: "向人物施加现实压力的社会力量。", methods: ["交涉", "施压"] }],
    narrativePalette: {
      sceneModes: ["生活积累"],
      conflictSources: ["关系与责任冲突"],
      actionVocabulary: ["人物以实际行动改变处境"],
      scalePossibilities: ["个人与社会之间"]
    },
    storyPatterns: [{ id: "pattern.one", label: "承担", summary: "人物面对此前选择带来的责任。" }],
    mainlineFacts: [{ id: "act.fact", kind: "open_question", label: "一份旧档的矛盾" }],
    mainlineActs: [{ id: "act.one", label: "旧案显形", prompt: "让旧档进入人物生活", factId: "act.fact" }],
    narrativeFactions: undefined,
    routeArcs: undefined
  };
  const setup = advanceWithDynamicNarrativeScene(run, world, dynamicWorld, {
    patternIds: [],
    forceIds: [],
    beatDecision: "advance",
    beat: "setup",
    narrative: "你从一页被改写的账目里，看见家门旧事与朝局之间的裂缝。",
    factUpdates: { introduce: [{ kind: "open_question", label: "沈衡为何隐瞒来历" }], touchFactIds: [], resolveFactIds: [] },
    participants: [{ characterRef: "new", name: "沈衡", factionId: "force.one", role: "递来旧档的书吏", description: "谨慎地试探你的立场", recurring: true, relationship: { stance: "guarded", summary: "愿意交谈，但仍试探你的立场。" } }],
    attributeOutcome: { effects: [{ stat: "intelligence", direction: "up", band: "light" }] },
    attributePolicy: { allowedStats: ["intelligence"], allowedBands: ["light"], allowedDirections: ["up"], minEffects: 1, maxEffects: 1 }
  });
  assert.equal(setup.updated.narrative.actRuntime?.beat, "escalation");
  assert.equal(setup.updated.narrative.dynamicCharacters[0]?.name, "沈衡");
  const shenHengId = setup.updated.narrative.dynamicCharacters[0]!.id;
  const introducedFact = run.story.factLedger!.facts.find((fact) => fact.id.startsWith("dynamic:"))!;
  assert.ok(run.narrative.dynamicCharacters[0]!.relatedFactIds.includes(introducedFact.id));
  assert.equal(run.narrative.dynamicCharacters[0]!.relationship?.stance, "guarded");
  const escalation = advanceWithDynamicNarrativeScene(run, world, dynamicWorld, {
    patternIds: [],
    forceIds: [],
    beatDecision: "advance",
    beat: "escalation",
    narrative: "沈衡带来的口供迫使你把家门的隐忧放到朝局的目光之下。",
    relationshipUpdates: [{ characterRef: shenHengId, stance: "friendly", summary: "你们因共同处境逐渐信任。" }],
    participants: [{ characterRef: shenHengId, name: "临时称谓", factionId: "court", role: "被改写的身份", description: "", recurring: false }],
    attributeOutcome: { effects: [{ stat: "charisma", direction: "up", band: "light" }] },
    attributePolicy: { allowedStats: ["charisma"], allowedBands: ["light"], allowedDirections: ["up"], minEffects: 1, maxEffects: 1 }
  });
  assert.equal(escalation.updated.narrative.actRuntime?.beat, "pressure");
  assert.deepEqual(escalation.updated.narrative.actRuntime?.selectedRouteIds, []);
  assert.equal(escalation.updated.narrative.dynamicCharacters.length, 1);
  assert.equal(escalation.updated.narrative.dynamicCharacters[0]?.name, "沈衡");
  assert.equal(escalation.updated.narrative.dynamicCharacters[0]?.role, "被改写的身份");
  assert.equal(escalation.updated.narrative.dynamicCharacters[0]?.description, "谨慎地试探你的立场");
  assert.equal(toClientRun(run).narrativeCharacters?.[0]?.name, "沈衡");
  assert.equal(run.narrative.dynamicCharacters[0]?.relationship?.stance, "friendly");
  advanceWithDynamicNarrativeScene(run, world, dynamicWorld, {
    patternIds: [], forceIds: [], beatDecision: "hold", beat: "pressure",
    narrative: "旧档牵连的人被带到堂前，你必须决定先保全谁的性命与名节。",
    participants: [],
    sceneClockMode: "hold",
    createsDecision: true
  });
  const pressureDecision = applyMilestoneDecisionAndAdvance(run, world, difficulty, "safe", {
    narrativeOutcome: { effects: [{ stat: "family", direction: "up", band: "light" }] },
    narrativeWorld: dynamicWorld,
    beatDecision: "advance",
    narrative: "你替沈衡保住家人，他当面说明了隐瞒的原委。",
    narrativeFactUpdates: { introduce: [], touchFactIds: [], resolveFactIds: [], resolutions: [{ factId: introducedFact.id, summary: "沈衡隐瞒来历是为了保全家人，如今已说明。" }] }
  });
  assert.equal(run.narrative.actRuntime?.beat, "climax");
  assert.equal(run.history.at(-1)?.summary, "你替沈衡保住家人，他当面说明了隐瞒的原委。");
  assert.equal(run.narrative.memoryEntries.at(-1)?.text, run.history.at(-1)?.summary);
  assert.ok(!run.story.factLedger!.facts.some((fact) => fact.id.startsWith("decision:") || fact.id.startsWith("cost:")));
  assert.equal(run.story.factLedger!.facts.find((fact) => fact.id === introducedFact.id)?.status, "resolved");
  assert.equal(run.story.factLedger!.facts.find((fact) => fact.id === introducedFact.id)?.lastSourceEventId, pressureDecision.sourceEventId);
  const decisionContext = memoryTestContext(run);
  decisionContext.conversation = { systemHash: "test", headCore: "规则", headMemory: "", history: [], archive: [] };
  recordDirectedDecisionOutcome(decisionContext, run, {
    sourceEventId: pressureDecision.sourceEventId, decision: "safe", label: "保全沈衡家人", narrative: run.history.at(-1)!.summary
  });
  assert.doesNotMatch((decisionContext.conversation.history.find((entry) => entry.role === "user") as { content: string }).content, /隐瞒来历|如今已说明/);
  advanceWithDynamicNarrativeScene(run, world, dynamicWorld, {
    patternIds: [], forceIds: [], beatDecision: "hold", beat: "climax",
    narrative: "证词与账册终于合在一处，任何署名都会改变此后谁还能开口。",
    participants: [],
    createsDecision: true
  });
  applyMilestoneDecisionAndAdvance(run, world, difficulty, "balanced", {
    narrativeOutcome: { effects: [{ stat: "intelligence", direction: "up", band: "medium" }] },
    factResolution: "exposed",
    narrativeWorld: dynamicWorld,
    beatDecision: "advance",
  });
  assert.equal(run.narrative.actRuntime?.beat, "payoff");
  assert.equal(run.story.factLedger?.facts.find((fact) => fact.id === "act.fact")?.status, "open", "主线事实在幕收束时结束");
});

function verifyThreeActClimaxCompletion(climaxMode: "choice" | "scene" | "mixed"): void {
  const run = createRun(
    { world, difficulty, cards: [card], tuning: createDefaultGameplayTuning(), narrativeEnabled: true },
    {
      clientId: "three-act-dynamic-world-client",
      worldId: world.id,
      storyPackId: "test.story-pack",
      difficultyId: difficulty.id,
      personaPrompt: "愿意承担旧案后果的人",
      talentPointTotal: 25,
      stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 },
      selectedCardIds: [card.id]
    }
  );
  const dynamicWorld: NarrativeWorldDefinition = {
    ...narrativeWorld,
    version: 9,
    worldCore: {
      identity: "一个由人物选择形成具体命运的测试世界。",
      laws: ["已经发生的选择会留下后果。"],
      powerStructure: "社会力量通过关系与资源发生作用。",
      everydayLife: "生活积累让人物逐渐取得行动能力。",
      tone: "清晰而连贯。"
    },
    socialForces: [{ id: "force.one", label: "世道人心", summary: "推动人物处境变化的社会力量。", methods: ["交涉", "施压"] }],
    narrativePalette: {
      sceneModes: ["生活", "冲突"],
      conflictSources: ["责任与选择"],
      actionVocabulary: ["承担", "改变"],
      scalePossibilities: ["个人", "社会"]
    },
    storyPatterns: [{ id: "pattern.one", label: "承担", summary: "人物面对此前选择带来的责任。" }],
    mainlineActs: [
      { id: "act.one", label: "旧事入局", prompt: "让人物从自身处境接触被遮蔽的旧事。" },
      { id: "act.two", label: "立身周旋", prompt: "承接前幕后果，让人物进入新的阵营位置。" },
      { id: "act.three", label: "大局担当", prompt: "让积累的身份面对更大范围的危机。" }
    ],
    endingBlueprints: (["good", "normal", "bad"] as const).map((polarity) => ({
      id: `world.${polarity}`,
      worldId: world.id,
      polarity,
      title: `${polarity}结局`,
      premise: "旧案的后果终于落定。",
      finalConflict: "人物必须承担最后的责任。",
      payoffFocus: "回应三幕留下的事实。",
      epilogueFocus: "交代人物与秩序的去处。",
      statWeights: { intelligence: 1 },
      requiredThreadIds: []
    }))
  };
  const growthPolicy: NarrativeAttributePolicy = {
    allowedStats: ["intelligence"],
    allowedBands: ["light"],
    allowedDirections: ["up"],
    minEffects: 1,
    maxEffects: 1
  };
  const scene = (
    routeId: "route.one" | "route.two",
    beat: "setup" | "escalation" | "pressure" | "climax" | "payoff",
    decision?: "hold" | "advance"
  ) => {
    const createsDecision = beat === "pressure" || (beat === "climax" &&
      (climaxMode === "choice" || (climaxMode === "mixed" && run.narrative.actRuntime?.actId !== "act.three")));
    return advanceWithDynamicNarrativeScene(run, world, dynamicWorld, {
      patternIds: [],
      forceIds: [],
      beatDecision: decision ?? (createsDecision ? "hold" : "advance"),
      beat,
      narrative: `这是${beat}阶段，旧案的后果迫使你作出新的承担。`,
      participants: [],
      ...(createsDecision ? { createsDecision: true } : {}),
      ...(!createsDecision
        ? {
            attributeOutcome: { effects: [{ stat: "intelligence" as const, direction: "up" as const, band: "light" as const }] },
            attributePolicy: growthPolicy
          }
        : {}),
      ...(beat === "setup" ? {
        factUpdates: {
          introduce: [
            { kind: "open_question" as const, label: "本幕尚待回答的问题" },
            { kind: "commitment" as const, label: "会延续到以后的人物承诺" },
            { kind: "commitment" as const, label: "另一件独立的延续承诺" }
          ],
          touchFactIds: [], resolveFactIds: []
        }
      } : {}),
    });
  };
  const playAct = (setupRoute: "route.one" | "route.two", climaxRoute: "route.one" | "route.two") => {
    scene(setupRoute, "setup");
    scene(climaxRoute, "escalation");
    scene(setupRoute, "pressure");
    applyMilestoneDecisionAndAdvance(run, world, difficulty, "safe", {
      narrativeOutcome: { effects: [{ stat: "family", direction: "up", band: "light" }] },
      narrativeWorld: dynamicWorld,
      beatDecision: "advance"
    });
    scene(climaxRoute, "climax");
    if (climaxMode === "choice" || (climaxMode === "mixed" && run.narrative.actRuntime?.actId !== "act.three")) {
      assert.ok(run.nextMilestoneChoice);
      applyMilestoneDecisionAndAdvance(run, world, difficulty, "balanced", {
        narrativeOutcome: { effects: [{ stat: "intelligence", direction: "up", band: "medium" }] },
        factResolution: "exposed",
        narrativeWorld: dynamicWorld,
        beatDecision: "advance"
      });
    } else {
      assert.equal(run.nextMilestoneChoice, undefined);
    }
    assert.equal(run.narrative.climaxCount, run.narrative.completedScenes.length + 1);
    const completingActId = run.narrative.actRuntime!.actId;
    const heldPayoff = scene(setupRoute, "payoff", "hold");
    assert.equal(heldPayoff.completedActId, undefined);
    assert.equal(run.narrative.actRuntime?.actId, completingActId);
    assert.equal(run.narrative.actRuntime?.beat, "payoff");
    const completedPayoff = scene(setupRoute, "payoff", "advance");
    assert.equal(completedPayoff.completedActId, completingActId);
  };

  playAct("route.one", "route.two");
  assert.equal(run.narrative.actRuntime?.actId, "act.two");
  assert.equal(run.narrative.actRuntime?.beat, "setup");
  assert.equal(run.story.factLedger?.facts.find((fact) => fact.label === "本幕尚待回答的问题")?.status, "open", "幕收束不自动伪造支线完成；旧幕事实退出当前幕召回");
  assert.equal(run.story.factLedger?.facts.find((fact) => fact.label === "会延续到以后的人物承诺")?.status, "open");
  assert.ok(run.story.factLedger?.facts.some((fact) =>
    fact.actId === "act.one" && fact.label === "会延续到以后的人物承诺" && fact.status === "open"
  ));
  assert.equal(run.story.factLedger?.facts.find((fact) => fact.label === "另一件独立的延续承诺")?.status, "open", "持续事件跨幕不伪造完成和副本");
  assert.ok(run.story.factLedger?.facts.some((fact) => fact.actId === "act.one" && fact.label === "另一件独立的延续承诺" && fact.status === "open"));
  const carriedFactId = run.story.factLedger?.facts.find((fact) => fact.actId === "act.one" && fact.label === "会延续到以后的人物承诺")?.id;
  assert.ok(carriedFactId);
  commitNarrativeActCanon(run, { actId: "act.one", sourceEventId: "event.payoff.act.one", resolvedAge: run.age });
  const planningHandoff = buildNarrativePromptPlan(run, dynamicWorld, null, "planning")!;
  assert.ok(planningHandoff.recall?.facts.some((fact) => fact.id === carriedFactId));
  const handoffPlan = buildNarrativePromptPlan(run, dynamicWorld, null, "dynamic", { focusIds: [carriedFactId] })!;
  assert.equal(Object.hasOwn(handoffPlan, "actHandoff"), false);
  assert.equal(Object.hasOwn(handoffPlan, "actCanon"), false);
  assert.ok(handoffPlan.recall?.facts.some((fact) => fact.id === carriedFactId));
  assert.ok(!handoffPlan.factDirectory?.some((fact) => fact.id.startsWith("act:act.one:")));
  const horizonPlan = buildNarrativePromptPlan(run, dynamicWorld, null, "horizon")!;
  const saved = JSON.parse(JSON.stringify(run)) as typeof run;
  const savedPlan = buildNarrativePromptPlan(saved, dynamicWorld, null, "dynamic", { focusIds: [carriedFactId] })!;
  assert.equal(Object.hasOwn(savedPlan, "actHandoff"), false);
  assert.equal(Object.hasOwn(savedPlan, "actCanon"), false);
  assert.ok(savedPlan.recall?.facts.some((fact) => fact.id === carriedFactId));
  playAct("route.two", "route.one");
  assert.equal(run.narrative.actRuntime?.actId, "act.three");
  assert.equal(run.narrative.actRuntime?.beat, "setup");
  playAct("route.one", "route.two");

  assert.equal(run.narrative.completedScenes.length, 3);
  assert.deepEqual(run.narrative.completedScenes.map((item) => item.mainlineActId), ["act.one", "act.two", "act.three"]);
  assert.equal(run.narrative.climaxCount, 3);
  assert.equal(run.narrative.payoffCount, 3);
  assert.ok(run.narrative.actCanon.some((result) => result.actId === "act.one" && result.sourceEventId));
  assert.ok(run.narrative.actCanon.some((result) => result.actId === "act.two" && result.sourceEventId));
  assert.equal(run.story.factLedger?.facts.some((fact) => fact.id === "act:act.two:continuation"), false, "幕结果不重复制造成账本事实");
  assert.equal(run.story.mainlineCompleted, true);
  assert.equal(run.narrative.endingState, "eligible");
  assert.equal(canRequestDirectedClosure(run, dynamicWorld), true);
  assert.throws(() => scene("route.one", "payoff"), /dynamic_scene_after_mainline_complete/);

  const restored = JSON.parse(JSON.stringify(run)) as typeof run;
  restored.narrative.climaxCount = 2;
  restored.story.mainlineCompleted = false;
  restored.story.closureEligible = false;
  restored.narrative.endingState = "open";
  assert.equal(canRequestDirectedClosure(restored, dynamicWorld), true);
  assert.equal(restored.narrative.climaxCount, 3);
  assert.equal(restored.story.mainlineCompleted, true);
}

for (const climaxMode of ["choice", "scene", "mixed"] as const) {
  test(`动态三幕只各自结算一次，并在最终 payoff 后进入结局申请（${climaxMode} 高潮）`, () => {
    verifyThreeActClimaxCompletion(climaxMode);
  });
}

test("世界幕引用不存在的事实会在内容加载前被拒绝", () => {
  const invalid: NarrativeWorldDefinition = {
    ...narrativeWorld,
    version: 4,
    mainlineFacts: [{ id: "known.fact", kind: "open_question", label: "已知事实" }],
    mainlineActs: [{
      id: "invalid.act",
      label: "错误幕",
      prompt: "不应进入运行态",
      factId: "missing.fact",
      introduceFactIds: ["missing.fact"]
    }]
  };
  assert.throws(() => validateNarrativeWorldFactContract(invalid), /mainline_act_fact_reference_invalid/);
});

test("连续跨年体魄低迷才进入濒死，三种求生方式由对应属性档位结算", () => {
  const survivalWorld: NarrativeWorldDefinition = {
    ...narrativeWorld,
    progression: {
      ...narrativeWorld.progression!,
      statTiers: { lowMax: 8, highMin: 22, overrides: { physique: { lowMax: 9, highMin: 22 } } },
      survival: {
        startAge: 4,
        graceYears: 3,
        stages: [{
          id: "child",
          label: "幼年",
          ageStageIds: ["child"],
          baseCrisisRisk: 1,
          additionalYearRisk: 0,
          maxCrisisRisk: 1
        }],
        recovery: {
          successRateByTier: { low: 0, steady: 0, high: 1 },
          restoreBuffer: 5
        },
        familyPhysiqueSupport: {
          low: { outcomes: [{ delta: 0, weight: 1 }] },
          steady: { outcomes: [{ delta: 0, weight: 1 }] },
          high: { outcomes: [{ delta: 0, weight: 1 }] }
        }
      }
    }
  };
  const advanceOneYear = (run: ReturnType<typeof makeRun>) => autoAdvanceToCheckpoint(run, world, difficulty, {
    targetYears: 1,
    maxTargetYears: 1,
    allowRandomMilestone: false,
    narrativeWorld: survivalWorld
  });

  const recoveredRun = makeRun();
  recoveredRun.age = 3;
  recoveredRun.ageStage = world.ageThresholds![0]!;
  recoveredRun.stats.physique = 0;
  recoveredRun.stats.intelligence = 30;
  advanceOneYear(recoveredRun);
  advanceOneYear(recoveredRun);
  assert.equal(recoveredRun.survivalCrisis, undefined);
  advanceOneYear(recoveredRun);
  assert.ok(recoveredRun.survivalCrisis);
  assert.equal(toClientRun(recoveredRun).survivalCrisis?.choices.find((choice) => choice.id === "self_rescue")?.guaranteed, true);
  const recoveredCrisis = recoveredRun.survivalCrisis as { id: string };
  const recovered = resolveSurvivalCrisis(recoveredRun, survivalWorld, "self_rescue", recoveredCrisis.id);
  assert.equal(recovered.recovered, true);
  assert.equal(recoveredRun.stats.physique, 14);
  assert.equal(recoveredRun.ended, false);

  const failedRun = makeRun();
  failedRun.age = 3;
  failedRun.ageStage = world.ageThresholds![0]!;
  failedRun.stats.physique = 0;
  failedRun.stats.fortune = 0;
  advanceOneYear(failedRun);
  advanceOneYear(failedRun);
  advanceOneYear(failedRun);
  assert.ok(failedRun.survivalCrisis);
  const failedCrisis = failedRun.survivalCrisis as { id: string };
  const failed = resolveSurvivalCrisis(failedRun, survivalWorld, "trust_fate", failedCrisis.id);
  assert.equal(failed.recovered, false);
  assert.equal(failedRun.outcome, "dead");
  assert.match(failedRun.deathCause ?? "", /幼年/);

  const interrupted = makeRun();
  interrupted.age = 3;
  interrupted.stats.physique = 0;
  const planned = autoAdvanceToCheckpoint(interrupted, world, difficulty, {
    targetYears: 5, maxTargetYears: 5, allowRandomMilestone: false,
    deferNarrativeAttributeEffects: true, narrativeWorld: survivalWorld
  });
  const ages = planned.chunk.map((event) => event.age);
  const policy: NarrativeAttributePolicy = { allowedStats: ["intelligence"], allowedBands: ["light"], allowedDirections: ["up"], minEffects: 1, maxEffects: 1 };
  assert.ok(settleNarrativeBackgroundOutcomes(interrupted, world,
    ages.map((age) => ({ age, effects: [{ stat: "intelligence", direction: "up", band: "light" }] })),
    ages, new Map(ages.map((age) => [age, policy])), survivalWorld));
  assert.equal(interrupted.age, 6);
  assert.ok(interrupted.survivalCrisis);
  assert.ok(interrupted.history.every((event) => event.age <= 6));
  const actualEvents = planned.chunk.filter((event) => event.age <= interrupted.age);
  const snapshot = structuredClone(interrupted);
  const task = interruptedBackgroundTask(interrupted, 4, actualEvents);
  const prepared = prepareNarrativeOutcomeRequest(interrupted, world, memoryTestContext(interrupted), task.tool, task.prompt, { task: "background" });
  const input = prepared.history.at(-1)!.content;
  assert.match(input, /4岁至6岁/);
  assert.doesNotMatch(input, /7岁|8岁/);
  assert.ok(input.includes(interrupted.survivalCrisis.cause));
  assert.deepEqual(interrupted, snapshot);
  assert.ok(!("effects" in task.tool.function.parameters.properties));
});


test("已离场人物的稳定身份在实际渲染目录与连续性目录中一致", () => {
  const run = makeRun();
  run.narrative.enabled = true;
  run.narrative.dynamicCharacters.push({
    id: "character:escort", name: "郑押队", role: "押队", description: "从前同行，后来离开",
    status: "gone", importance: "recurring", introducedAge: 4, lastSeenAge: 16,
    relatedFactIds: [], relatedRouteIds: []
  });
  run.narrative.assets = applyNarrativeAssetUpdates(undefined, {
    locations: [], abilities: [{ ref: "new", name: "辨蹄声", description: "从声响分辨马队", source: "早年习得", mastery: "初通" , usage: "从声响分辨马队" }]
  }, { age: 5 }).assets;
  const abilityId = run.narrative.assets.abilities[0].id;
  const ctx = memoryTestContext(run);
  assert.equal(ctx.narrativePlan?.recall?.characters.length, 0);
  const rendering = prepareNarrativeOutcomeRequest(run, world, ctx, narrativeDecisionRenderTool(), "故人重新参与事情", {
    task: "rendering", contracts: { references: true }
  });
  assert.ok(rendering.allowedContinuityRefs.characterIds.includes("character:escort"));
  assert.match(rendering.history.map((entry) => entry.content).join("\n"), /character:escort=郑押队/);
  const tool = { type: "function", function: { name: "sync_narrative_continuity", parameters: { type: "object", properties: {} } } };
  const prepared = prepareNarrativeOutcomeRequest(run, world, ctx, tool, "只整理本轮变更", {
    task: "continuity", writeSet: { factIds: [], characterIds: [], locationIds: [], abilityIds: [] },
    contracts: { layout: "continuity", assets: true, relationships: true }
  });
  assert.ok(prepared.characterIds.includes("character:escort"));
  assert.ok(prepared.allowedAssets.abilities.some((entry) => entry.id === abilityId));
  const text = prepared.history.map((entry) => entry.content).join("\n");
  assert.ok(text.includes(abilityId));
  const updates = parseNarrativeContinuityAssetUpdates({ locationUpdates: [], abilityUpdates: [{ ref: abilityId, mastery: "熟练" }] }, prepared.allowedAssets);
  assert.deepEqual(updates.abilities[0], { ref: abilityId, mastery: "熟练" });
  assert.equal(parseRelationshipUpdates([{ characterRef: "character:escort", stance: "friendly", summary: "再次同行" }], prepared.characterIds)?.length, 1);
  assert.throws(() => parseRelationshipUpdates([{ characterRef: "character:other-run", stance: "friendly", summary: "不属于本局" }], prepared.characterIds));
  assert.equal(run.narrative.dynamicCharacters[0].status, "gone");
});

test("人物提及不代替在场判断，状态变化由同步显式提交", () => {
  const run = makeRun();
  run.narrative.enabled = true;
  const definition: NarrativeWorldDefinition = { ...narrativeWorld, version: 9, storyPatterns: [], socialForces: [], mainlineActs: [{ id: "act.return", label: "故人", prompt: "再次同行" }] };
  run.narrative.dynamicCharacters.push({ id: "character:return", name: "郑押队", role: "押队", description: "旧日同行者", status: "gone", importance: "recurring", introducedAge: 4, lastSeenAge: 16, relatedFactIds: [], relatedRouteIds: [] });
  applyNarrativeRelationshipUpdates(run, [{ characterRef: "character:return", stance: "friendly", summary: "远方来信" }]);
  assert.equal(run.narrative.dynamicCharacters[0].status, "gone");
  const participants = parseDynamicNarrativeParticipants([{ characterRef: "character:return" }], [], narrativeCharacterDirectory(run.narrative))!;
  const advance = (relationshipUpdates?: Parameters<typeof applyNarrativeRelationshipUpdates>[1]) => advanceWithDynamicNarrativeScene(run, world, definition, {
    patternIds: [], forceIds: [], beat: "setup", beatDecision: "hold", narrative: "旧日同行者又来到你身边。", participants,
    attributeOutcome: { effects: [{ stat: "intelligence", direction: "up", band: "light" }] }, relationshipUpdates
  });
  advance();
  assert.equal(run.narrative.dynamicCharacters[0].status, "gone");
  advance([{ characterRef: "character:return", status: "active" }]);
  assert.equal(run.narrative.dynamicCharacters[0].status, "active");
  advance([{ characterRef: "character:return", stance: "friendly", summary: "忙完后再度远行", status: "gone" }]);
  assert.equal(run.narrative.dynamicCharacters.length, 1);
  assert.equal(run.narrative.dynamicCharacters[0].status, "gone");
});

test("语义归并贯通资产、待选引用、回合索引和召回，保留旧公开快照并隔离对局", () => {
  const run = makeRun();
  const updates = { locations: [], abilities: [
    { ref: "new", name: "识蹄辨马", description: "分辨马队的蹄声", source: "早年随行", mastery: "初通" , usage: "分辨马队的蹄声" },
    { ref: "new", name: "辨蹄声知来路", description: "已能分辨马队远近和来向", source: "后来随队", mastery: "熟练" , usage: "已能分辨马队远近和来向" }
  ] };
  run.narrative.assets = applyNarrativeAssetUpdates(undefined, { ...updates, abilities: [updates.abilities[0]] }, { age: 5 }).assets;
  run.narrative.assets = applyNarrativeAssetUpdates(run.narrative.assets, { ...updates, abilities: [updates.abilities[1]] }, { age: 9 }).assets;
  const [target, source] = run.narrative.assets.abilities;
  commitNarrativeMemory(run.narrative, { id: "memory:identity", age: 9, text: "你已能辨识远近马队。", characterIds: [], factionIds: [], factIds: [], abilityIds: [target.id, source.id] });
  const episode = commitNarrativeEpisode(run, { callId: "identity", sourceEventId: "identity", turnKind: "scene", age: 9, abilityIds: [source.id] });
  run.pendingDynamicScene = { id: "scene:identity", patternIds: [], forceIds: [], beat: "pressure", mainlineActId: "act.one", abilityIds: [source.id] };
  const oldTurn = appendPublicTurnRecord(run, { entryId: "identity", age: 9, kind: "scene", ageStage: { label: "幼年" }, narrative: "你已能辨识远近马队。", statChanges: {} });
  const independent = structuredClone(run);
  const merge = { kind: "ability" as const, sourceRef: source.id, targetRef: target.id };
  const before = structuredClone(run);
  assert.throws(() => applyNarrativeIdentityMerges(run, [merge, { ...merge, targetRef: "ability:another-run" }]), /identity_merge_reference_invalid/);
  assert.deepEqual(run, before);
  applyNarrativeIdentityMerges(run, [merge]);
  assert.equal(run.narrative.assets!.abilities.length, 1);
  assert.equal(run.narrative.assets!.abilities[0].name, "识蹄辨马");
  run.narrative.assets = applyNarrativeAssetUpdates(run.narrative.assets, parseNarrativeAssetUpdates({
    locations: [], abilities: [{ ref: target.id, mastery: "熟练", description: "已能分辨远近和来向", usage: "辨认马队距离与来向" }]
  }, run.narrative.assets), { age: 9 }).assets;
  assert.equal(run.narrative.assets!.abilities[0].mastery, "熟练");
  assert.equal(run.narrative.assets!.abilities[0].introduced.age, 5);
  const revisionAfterMerge = run.narrative.memoryRevision;
  applyNarrativeIdentityMerges(run, [merge]);
  assert.equal(run.narrative.memoryRevision, revisionAfterMerge);
  assert.equal(run.pendingDynamicScene.abilityIds?.[0], target.id);
  assert.deepEqual(run.narrative.memoryEntries[0].abilityIds, [target.id]);
  assert.deepEqual(run.narrative.episodes.find((entry) => entry.id === episode.id)?.abilityIds, [target.id]);
  const normalized = ensureNarrativeRunState(run.narrative, true, run.age);
  assert.equal(normalized.identityAliases?.[source.id], target.id);
  assert.equal(canonicalizeNarrativeReferences(normalized, { ref: source.id }).ref, target.id);
  run.narrative.assets = applyNarrativeAssetUpdates(run.narrative.assets, canonicalizeNarrativeReferences(normalized, { locations: [], abilities: [{ ref: source.id, name: "识蹄辨马", description: "可用于判断人数", source: "早年随行", mastery: "精通" }] }), { age: 10 }).assets;
  appendPublicTurnRecord(run, { entryId: "identity-next", age: 10, kind: "scene", ageStage: { label: "幼年" }, narrative: "你靠蹄声辨出追兵的人数。", statChanges: {} });
  assert.equal(toClientRun(run).narrativeAssets?.abilities.length, 1);
  assert.equal(oldTurn.narrativeAssetsSnapshot?.abilities.length, 2);
  assert.equal(independent.narrative.assets!.abilities.length, 2);
  assert.ok(selectDynamicNarrativeContext(run, { task: "decision", abilityIds: [target.id] }).assetSources?.some((entry) => entry.id === target.id));
  assert.deepEqual(parseNarrativeIdentityMerges(undefined, run.narrative), []);
});

test("人物归并保留稳定身份与最新关系，同名职务不能触发自动语义归并", () => {
  const run = makeRun();
  const person = { role: "主簿", description: "旧日相识", status: "active" as const, importance: "recurring" as const, introducedAge: 4, lastSeenAge: 4, relatedFactIds: [], relatedRouteIds: [] };
  run.narrative.dynamicCharacters = [
    { ...person, id: "character:original", name: "沈主簿" },
    { ...person, id: "character:duplicate", name: "新任主簿", lastSeenAge: 9, relationship: { stance: "hostile", summary: "此人后来成为对手", relatedFactIds: [], lastChangedAge: 9 } },
    { ...person, id: "character:different", name: "另县主簿" }
  ];
  assert.equal(narrativeCharacterDirectory(run.narrative).length, 3);
  applyNarrativeIdentityMerges(run, [{ kind: "character", sourceRef: "character:duplicate", targetRef: "character:original" }]);
  assert.equal(run.narrative.dynamicCharacters.length, 2);
  assert.equal(run.narrative.dynamicCharacters[0].name, "沈主簿");
  assert.equal(run.narrative.dynamicCharacters[0].relationship?.stance, "hostile");
});

function lowPhysiqueWorldForTest(): NarrativeWorldDefinition {
  return {
    ...narrativeWorld, version: 9, storyPatterns: [], socialForces: [], mainlineActs: [{ id: "act.risk", label: "生活", prompt: "生活中的变化" }],
    progression: {
      ...narrativeWorld.progression!, statTiers: { lowMax: 8, highMin: 22, overrides: { physique: { lowMax: 4, highMin: 22 } } },
      survival: {
        startAge: 4, graceYears: 3,
        stages: (["child", "youth", "prime", "middle", "elder"] as const).map((id) => ({ id, label: id, ageStageIds: [id], baseCrisisRisk: 1, additionalYearRisk: 0, maxCrisisRisk: 1 })),
        recovery: { successRateByTier: { low: 0, steady: 0.5, high: 1 }, restoreBuffer: 5 },
        familyPhysiqueSupport: { low: { outcomes: [{ delta: 0, weight: 1 }] }, steady: { outcomes: [{ delta: 0, weight: 1 }] }, high: { outcomes: [{ delta: 0, weight: 1 }] } }
      }
    }
  };
}

function settleQuietYearForTest(run: ReturnType<typeof makeRun>, definition: NarrativeWorldDefinition, years = 1) {
  const planned = autoAdvanceToCheckpoint(run, world, difficulty, { targetYears: years, maxTargetYears: years, allowRandomMilestone: false, deferNarrativeAttributeEffects: true, narrativeWorld: definition });
  const ages = planned.chunk.map((entry) => entry.age);
  assert.ok(settleNarrativeBackgroundOutcomes(run, world, ages.map((age) => ({ age, effects: [{ stat: "intelligence", direction: "up", band: "light" }] })), ages, undefined, definition));
  return planned;
}

test("三世界体魄档位经过存档规范化后与前端和模型判定一致", async () => {
  for (const id of ["ancient", "modern", "fantasy"]) {
    const definition = await loadNarrativeWorldDefinition(id);
    assert.ok(definition);
    const run = makeRun();
    run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
    run.narrative = ensureNarrativeRunState(run.narrative, true, run.age);
    for (const [body, expected] of [[4, "low"], [5, "developing"], [18, "developing"], [19, "steady"], [32, "steady"], [33, "advanced"], [47, "advanced"], [48, "high"]] as const) {
      run.stats.physique = body;
      const tiers = resolveNarrativeStatTiers(run.stats, run.narrative.statTierConfig);
      assert.equal(tiers.physique, expected);
      assert.equal(tiers.family, "low");
      assert.equal(toClientRun(run).statTiers?.physique, expected);
    }
  }
});

test("低档体魄跨年龄阶段保留连续年份，第三年触发且恢复至9", () => {
  const definition = lowPhysiqueWorldForTest();
  const run = makeRun();
  run.age = 10; run.stats.physique = 4;
  settleQuietYearForTest(run, definition);
  settleQuietYearForTest(run, definition);
  assert.equal(run.survival.lowPhysiqueYears, 2);
  assert.equal(run.survivalCrisis, undefined);
  settleQuietYearForTest(run, definition);
  assert.equal(run.age, 13);
  assert.equal(run.survival.lowPhysiqueYears, 3);
  assert.equal((run.survivalCrisis as { stageId: string } | undefined)?.stageId, "youth");
  run.stats.intelligence = 22;
  const recovered = resolveSurvivalCrisis(run, definition, "self_rescue");
  assert.equal(recovered.recovered, true);
  assert.equal(run.stats.physique, 9);
  assert.equal(run.survival.lowPhysiqueYears, 0);
  assert.equal(run.survivalCrisis, undefined);
});

test("五档展示在存档恢复后仍沿用独立的濒死及求生数值档位", async () => {
  const definition = lowPhysiqueWorldForTest();
  const configured = await loadNarrativeWorldDefinition("ancient");
  assert.ok(configured?.progression?.statTiers);
  definition.progression!.statTiers = structuredClone(configured.progression.statTiers);
  const run = makeRun();
  run.age = 10;
  run.stats.physique = 4;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  run.narrative = ensureNarrativeRunState(JSON.parse(JSON.stringify(run.narrative)), true, run.age);
  assert.deepEqual(run.narrative.statTierConfig, configured.progression.statTiers);
  settleQuietYearForTest(run, definition, 3);
  assert.ok(run.survivalCrisis);
  run.stats.intelligence = 22;
  assert.equal(toClientRun(run).statTiers?.intelligence, "steady");
  assert.equal(resolveSurvivalCrisis(run, definition, "self_rescue").recovered, true,
    "展示中档不改变原有22点高档求生概率");
  assert.equal(run.stats.physique, 9);
});

test("三幕属性门槛随责任提高，普通年积累恢复准入，年龄和计划区间不代替属性", async () => {
  for (const id of ["ancient", "modern", "fantasy"]) {
    const definition = await loadNarrativeExperienceForTest(id);
    const run = makeRun();
    run.age = 20;
    run.narrative.enabled = true;
    for (const [index, act] of definition.mainlineActs!.entries()) {
      run.narrative.activeMainlineActId = act.id;
      run.narrative.actRuntime = { actId: act.id, beat: "setup", enteredAge: run.age, lastAdvancedAge: run.age, selectedRouteIds: [], decisionCount: 0 };
      const gates = definition.progression!.actGateThresholds![index];
      for (const stat of Object.keys(run.stats) as Array<keyof typeof run.stats>) run.stats[stat] = gates.opening - 1;
      assert.equal(isNarrativeMainlineActEntryReady(run, definition), false);
      run.age = 75;
      assert.equal(isNarrativeMainlineActEntryReady(run, definition), false, "变老本身不授予能力");
      run.age = 20;
      for (const stat of Object.keys(run.stats) as Array<keyof typeof run.stats>) {
        const changes = approveNarrativeAttributeOutcome(run, world, {
          effects: [{ stat, direction: "up", band: "medium" }]
        }, "background", dynamicBackgroundAttributePolicy(run));
        assert.equal(changes?.[stat], 1);
        run.stats[stat] += changes![stat]!;
      }
      assert.equal(isNarrativeMainlineActEntryReady(run, definition), true);
      assert.equal(isNarrativeStageReady(run, definition, "climax"), false);
      for (const stat of Object.keys(run.stats) as Array<keyof typeof run.stats>) run.stats[stat] = gates.climax;
      assert.equal(isNarrativeStageReady(run, definition, "climax"), true);
      if (index < definition.mainlineActs!.length - 1) {
        run.narrative.actRuntime!.actId = definition.mainlineActs![index + 1].id;
        assert.equal(isNarrativeMainlineActEntryReady(run, definition), false, "上一幕的成熟基础尚不足以承担下一幕责任");
      }
    }
  }
});

test("场景使用已有能力不自动涨属性，实际成长及风险收益使用同一审批与结算规则", () => {
  const run = makeRun();
  run.age = 20;
  run.narrative.enabled = true;
  const definition = { ...narrativeWorld, mainlineActs: [{ id: "growth", label: "承担职责", prompt: "凭已有本领处理任务" }] };
  const before = structuredClone(run.stats);
  const policy = dynamicSceneAttributePolicy();
  const scene = (effects: Parameters<typeof approveNarrativeAttributeOutcome>[2]["effects"], createsDecision = false) =>
    advanceWithDynamicNarrativeScene(run, world, definition, {
      patternIds: [], forceIds: [], beat: "setup", beatDecision: "hold", sceneAge: run.age,
      sceneClockMode: "hold", narrative: "你凭已有骑术完成传令，之后继续练习。", participants: [],
      createsDecision, attributeOutcome: { effects }, attributePolicy: policy
    });
  assert.equal(scene([]).chunk.length, 1);
  assert.deepEqual(run.stats, before);
  scene([{ stat: "intelligence", direction: "up", band: "medium" }]);
  assert.equal(run.stats.intelligence, before.intelligence + 1);
  assert.equal(run.narrative.actRuntime?.beat, "setup", "能力成长不自动完成故事阶段");
  scene([], true);
  const risky = run.pendingDirectedDecisionPolicy!.risky;
  const changes = approveNarrativeAttributeOutcome(run, world, { effects: [
    { stat: "intelligence", direction: "up", band: "heavy" },
    { stat: "family", direction: "down", band: "medium" }
  ] }, "decision", risky);
  assert.equal(changes?.intelligence, 2);
  assert.equal(changes?.family, -2);
});

test("同年不会增加生存累计，同年恢复立即清除，随后降低从下一年重新累计", () => {
  const definition = lowPhysiqueWorldForTest();
  const run = makeRun(); run.narrative.enabled = true; run.age = 12; run.stats.physique = 3;
  run.survival = { stageId: "child", lowPhysiqueYears: 2 };
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  run.narrative.activeScene = { id: "risk:held", threadId: "arc:act.risk", phase: "setup", openedAge: 12, lastTouchedAge: 12, mainlineActId: "act.risk", decisionCount: 0 };
  run.narrative.sceneClock = { mode: "hold", sameAgeTurnCount: 0, maxSameAgeTurns: 3 };
  const scene = (stat: "intelligence" | "physique", band: "light" | "medium", createsDecision = false) => advanceWithDynamicNarrativeScene(run, world, definition, {
    patternIds: [], forceIds: [], beat: "setup", beatDecision: "hold", sceneClockMode: "hold", narrative: "这一天的事情仍在继续。", participants: [], attributeOutcome: { effects: [{ stat, direction: "up", band }] }, createsDecision
  });
  scene("intelligence", "light");
  assert.equal(run.age, 12); assert.equal(run.survival.lowPhysiqueYears, 2); assert.equal(run.survivalCrisis, undefined);
  scene("physique", "medium");
  assert.equal(run.stats.physique, 5); assert.equal(run.survival.lowPhysiqueYears, 0);
  scene("intelligence", "light", true);
  applyMilestoneDecisionAndAdvance(run, world, difficulty, "risky", { narrativeOutcome: { effects: [{ stat: "physique", direction: "down", band: "light" }] }, narrativeWorld: definition });
  assert.equal(run.stats.physique, 4); assert.equal(run.survival.lowPhysiqueYears, 0); assert.equal(run.age, 12);
  settleQuietYearForTest(run, definition);
  assert.equal(run.survival.lowPhysiqueYears, 1);
});

test("年度家境支持先结算再判断低档，早年保护和多年份危机截断保留", () => {
  const definition = lowPhysiqueWorldForTest();
  definition.progression!.survival!.familyPhysiqueSupport.high.outcomes = [{ delta: 1, weight: 1 }];
  const supported = makeRun(); supported.age = 5; supported.stats.physique = 4; supported.stats.family = 22;
  supported.survival.lowPhysiqueYears = 2;
  settleQuietYearForTest(supported, definition);
  assert.equal(supported.stats.physique, 5); assert.equal(supported.survival.lowPhysiqueYears, 0); assert.equal(supported.survivalCrisis, undefined);
  const protectedRun = makeRun(); protectedRun.age = 0; protectedRun.stats.physique = 4;
  settleQuietYearForTest(protectedRun, definition, 3);
  assert.equal(protectedRun.survival.lowPhysiqueYears, 0);
  const planned = settleQuietYearForTest(protectedRun, definition, 4);
  assert.equal(protectedRun.age, 6); assert.ok(protectedRun.survivalCrisis);
  assert.ok(protectedRun.history.every((entry) => entry.age <= 6));
  const before = structuredClone(protectedRun);
  assert.deepEqual(autoAdvanceToCheckpoint(protectedRun, world, difficulty, { narrativeWorld: definition }).chunk, []);
  assert.deepEqual(protectedRun, before);
  assert.equal(planned.chunk.length, 4);
});

test("三项濒死抉择分别使用对应属性档位，高档成功并清除累计", () => {
  const definition = lowPhysiqueWorldForTest();
  for (const [choice, stat] of [["self_rescue", "intelligence"], ["seek_help", "charisma"], ["trust_fate", "fortune"]] as const) {
    const run = makeRun(); run.age = 3; run.stats.physique = 4; run.stats[stat] = 22;
    settleQuietYearForTest(run, definition, 3);
    assert.equal(toClientRun(run).survivalCrisis?.choices.find((entry) => entry.id === choice)?.guaranteed, true);
    const result = resolveSurvivalCrisis(run, definition, choice);
    assert.equal(result.recovered, true);
    assert.equal(run.stats.physique, 9);
    assert.equal(run.survival.lowPhysiqueYears, 0);
    assert.equal(run.ended, false);
  }
});

test("有效背景人物引用沿用归并身份，过期批次不能重新写回重复档案", () => {
  const run = makeRun();
  run.ended = true;
  const person = { name: "故人", role: "同伴", description: "同行者", status: "active" as const, importance: "recurring" as const, introducedAge: 1, lastSeenAge: 1, relatedFactIds: [], relatedRouteIds: [] };
  run.narrative.dynamicCharacters = [{ ...person, id: "character:original" }, { ...person, id: "character:duplicate" }];
  for (let i = 1; i <= 3; i++) {
    commitNarrativeMemory(run.narrative, { id: `memory:merge-${i}`, age: i, text: "你与旧日同伴再次合作。", characterIds: ["character:duplicate"], factionIds: [], factIds: [] });
    commitNarrativeEpisode(run, { callId: `merge-${i}`, sourceEventId: `merge-${i}`, turnKind: "scene", age: i, characterIds: ["character:duplicate"] });
  }
  const work = prepareNarrativeMemoryCuration(run)!;
  const result = { summary: "故人曾与主角合作。" };
  assert.equal(applyNarrativeMemoryCuration(run, work, result), true);
  applyNarrativeIdentityMerges(run, [{ kind: "character", sourceRef: "character:duplicate", targetRef: "character:original" }]);
  const digest = run.narrative.memoryDigests.find((entry) => entry.scope === "run")!;
  assert.deepEqual(digest.characterIds, [], "压缩不另行维护人物引用");
  assert.equal(applyNarrativeMemoryCuration(run, work, result), false);
});

test("事实工具与提交使用同一引用合同，已完成事实只对明确归档任务可见", () => {
  const run = makeRun();
  const ids = applyNarrativeFactUpdates(run, {
    introduce: Array.from({ length: 5 }, (_, i) => ({ kind: "open_question" as const, label: "事实" + i })),
    touchFactIds: [], resolveFactIds: []
  }, { sourceEventId: "continuity:one", actId: "act.one" });
  assert.equal(ids.length, 5);
  const update = parseFactUpdates({
    touchFactIds: ids,
    progress: [{ factId: ids[0], summary: "已查明事情的来由" }],
    resolutions: ids.slice(1, 4).map((factId) => ({ factId, summary: "事情已经处理完毕" }))
  }, factUpdateContract(ids))!;
  applyNarrativeFactUpdates(run, update, { sourceEventId: "continuity:two", actId: "act.one" });
  assert.equal(run.story.factLedger!.facts.filter((fact) => fact.status === "resolved").length, 3);
  assert.equal(run.story.factLedger!.facts[0]?.progressSummary, "已查明事情的来由");
  assert.throws(() => parseFactUpdates({ resolveFactIds: ["world.fact"] }, factUpdateContract(["world.fact"])), /fact_reference/);
  assert.throws(() => parseFactUpdates({ touchFactIds: ["missing"] }, factUpdateContract(ids)), /fact_reference/);
  assert.throws(() => parseRelationshipUpdates([{ characterRef: "missing", stance: "friendly", summary: "熟识" }], []), /relationship_reference/);
  const recall = selectDynamicNarrativeContext(run, { task: "dynamic", actId: "act.one", text: "事情已经处理完毕" });
  assert.ok(recall.facts.every((fact) => !ids.slice(1, 4).includes(fact.id)));
  assert.deepEqual(recall.resolvedFacts, []);
  const payoffRecall = selectDynamicNarrativeContext(run, {
    task: "rendering",
    actId: "act.one",
    factIds: ids.slice(1, 4),
    text: "整理本幕收束结果",
    resolvedFactVisibility: "current-act"
  });
  assert.equal(payoffRecall.resolvedFacts?.length, 3);
  assert.ok(payoffRecall.resolvedFacts?.every((fact) => ids.slice(1, 4).includes(fact.id)));
  run.narrative.enabled = true;
  const plan = buildNarrativePromptPlan(run, { ...narrativeWorld, mainlineActs: [{ id: "act.one", label: "第一幕", prompt: "新的生活" }] }, null, "background");
  assert.doesNotMatch(formatTaskNarrativeContext(plan), /已发生的结果/);
  assert.ok(selectDynamicNarrativeContext(run, { task: "ending" }).resolvedFacts?.length);
});

test("同一正文的事实与资产链接合并，本领可以再次召回且分支独立", () => {
  const run = makeRun();
  const prose = "你使出先前习得的本领，护住同行者。";
  commitNarrativeMemory(run.narrative, { id: "memory:turn", age: 10, factionIds: [], characterIds: [], factIds: ["fact:a"], text: prose });
  const updates = { locations: [], abilities: [{ ref: "new", name: "息风诀", description: "借气息平复风势", source: "此前习得", mastery: "熟练" , usage: "借气息平复风势" }] };
  const assets = applyNarrativeAssetUpdates(run.narrative.assets, updates, { age: 10 });
  commitNarrativeAssets(run.narrative, assets, { age: 10 }, { factIds: ["fact:a"] }, "turn");
  assert.equal(run.narrative.memoryEntries.length, 1);
  assert.equal(run.narrative.memoryEntries[0]?.text, prose);
  assert.equal(run.narrative.memoryEntries[0]?.abilityIds?.[0], assets.assets.abilities[0]?.id);
  const snapshot = structuredClone(run);
  const query = { abilityIds: [assets.assets.abilities[0].id] };
  const first = formatNarrativeAssets(selectNarrativeAssets(run.narrative.assets!, query));
  assert.match(first, /息风诀/);
  assert.equal(formatNarrativeAssets(selectNarrativeAssets(run.narrative.assets!, query)), first);
  run.narrative.assets!.abilities[0]!.mastery = "精通";
  assert.equal(snapshot.narrative.assets!.abilities[0]?.mastery, "熟练");
  assert.ok(narrativeTextOverlap("以息风诀迎敌", "此前学会息风诀") > narrativeTextOverlap("以息风诀迎敌", "家门旧事"));
});

test("异步摘要只替换对应归档批次，保留新回合并拒绝过期结果", () => {
  const round = { id: "r1", user: "一次选择", assistant: "问题已经解决" };
  const conversation: ChatConversationState = { systemHash: "world", headCore: "世界", headMemory: "此前经历", history: [], archive: [round] };
  const work = { revision: 0, previousSummary: conversation.headMemory, rounds: structuredClone(conversation.archive) };
  conversation.archive.push({ id: "r2", user: "后来", assistant: "新的生活" });
  conversation.history.push({ role: "assistant", content: "最新正文" });
  assert.equal(applyConversationSummary(conversation, work, "此前问题解决，开始新的生活"), true);
  assert.deepEqual(conversation.archive.map((item) => item.id), ["r2"]);
  assert.equal(conversation.history[0]?.role, "assistant");
  assert.equal(applyConversationSummary(conversation, work, "过期摘要"), false);
  assert.equal(conversation.headMemory, "此前问题解决，开始新的生活");
  const changed = { ...work, revision: 1, previousSummary: conversation.headMemory };
  assert.equal(applyConversationSummary(conversation, changed, "另一分支摘要"), false);
});

test("自然段格式在入库前统一，内部结构不会被当作段落静默剥掉", () => {
  assert.equal(normalizeNarrativeText("第一段。</p><p>第二段。</p>"), "第一段。\n\n第二段。");
  assert.equal(normalizeNarrativeText("<p>第一段。<br/>第二行。</p>"), "第一段。\n第二行。");
  assert.match(normalizeNarrativeText("正文<assetUpdates>内部字段</assetUpdates>"), /assetUpdates/);
});


function memoryTestContext(run: ReturnType<typeof makeRun>, focusIds: string[] = []): NarrativeContext {
  return {
    apiKey: "", promptPack: {},
    providerConfig: { provider: "openai-compatible", baseUrl: "https://example.invalid", model: "unused", apiPath: "/chat/completions", temperature: 0.7, maxTokens: 2000, timeoutMs: 1000 },
    narrativePlan: buildNarrativePromptPlan(run, {
      ...narrativeWorld, mainlineActs: [{ id: "act.one", label: "第一幕", prompt: "生活的变化" }],
      endingGuide: "以平静的生活细节表现余韵"
    }, null, "background", { focusIds }),
    conversation: run.aiConversation?.year
  };
}

test("实际请求只提供一份人物材料，固定经历先于最新年龄能力", async () => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  const run = makeRun();
  run.worldId = "ancient";
  run.age = 16;
  run.ageStage = { id: "youth", label: "青年", min: 13, max: 29 };
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  const summary = "救回同袍后被调入斥候队，留下右肩旧伤，与营中医者相识。";
  run.narrative.opening = { status: "ready", profile: { summary: "出生于北境军户。", seedHints: [] } };
  run.narrative.memoryDigests = [{
    id: "run", format: "effective_facts", scope: "run", revision: 1,
    throughEpisodeId: "episode:earlier", coveredEpisodeIds: ["episode:earlier"], originCovered: true,
    summary, activeFactIds: [], historicalFactIds: [], characterIds: [], updatedAt: 1
  }];
  for (const task of ["planning", "background", "rendering", "dynamic", "decision", "closure", "ending"] as const) {
    const ctx = memoryTestContext(run);
    ctx.narrativePlan = buildNarrativePromptPlan(run, definition, null, task);
    const request = prepareNarrativeOutcomeRequest(run, world, ctx,
      narrativeDecisionOutcomeTool(dynamicSceneAttributePolicy()), "依据当前人物继续经历", { task });
    const text = request.history.map((entry) => entry.content).join("\n");
    assert.equal(text.split(summary).length - 1, 1, `${task}只提供一份经历摘要`);
    assert.equal(text.split("当前年龄：").length - 1, 1, `${task}只提供一次当前状态`);
    assert.ok(text.indexOf(run.personaPrompt) < text.indexOf(summary));
    assert.ok(text.indexOf(summary) < text.indexOf("当前年龄："));
    assert.ok(text.includes("当前年龄：16岁，青年"));
    assert.ok(text.includes("体魄=身健耐劳"));
    assert.ok(!text.includes("出生于北境军户。"), "被摘要覆盖的身世不重复拼入");
    assert.equal(text.split(run.personaPrompt).length - 1, 1, "人设与当前角色档案只提供一次");
  }
  run.age = 36;
  run.ageStage = { id: "prime", label: "壮年", min: 30, max: 44 };
  run.stats.physique = 35;
  const plan = buildNarrativePromptPlan(run, definition, null, "rendering");
  const request = composeNarrativeContext({ plan, task: "rendering", taskPrompt: "处理眼前困难" });
  assert.ok(request.renderedContext.includes("当前年龄：36岁，壮年"));
  assert.ok(request.renderedContext.includes("体魄=精力充沛"));
  assert.equal(request.renderedContext.split(summary).length - 1, 1);
  assert.equal(run.narrative.memoryDigests[0].revision, 1, "状态更新不依赖重做经历摘要");
});

test("年龄属性和所在地变化不再挡住既有经历，幕内规划使用同一份分层主角资料", () => {
  const run = makeRun(); run.age = 20; run.narrative.enabled = true;
  const summary = "已经完成护送，在边军立足。";
  run.narrative.memoryDigests = [{ id: "run", format: "effective_facts", scope: "run", revision: 1,
    throughEpisodeId: "episode:past", coveredEpisodeIds: ["episode:past"], originCovered: true,
    summary, activeFactIds: [], historicalFactIds: [], characterIds: [], updatedAt: 1 }];
  run.narrative.assets = { currentLocationId: "location:camp", abilities: [], locations: [
    { id: "location:camp", name: "军营", description: "河岸驻军", introduced: { age: 18 }, lastSeen: { age: 20 } },
    { id: "location:fort", name: "关城", description: "边境关城", introduced: { age: 18 }, lastSeen: { age: 20 } }
  ] };
  const prose = "河桥已被烧毁，主角随同袍留在河岸，等待另寻道路。";
  commitNarrativeEpisode(run, { callId: "river", sourceEventId: "river", turnKind: "scene", age: 20, storyDelta: prose });
  const prepare = (task: "background" | "rendering" | "dynamic" | "decision") => {
    const ctx = memoryTestContext(run);
    ctx.narrativePlan = { ...ctx.narrativePlan!, task, actBackground: "本幕需要守住河岸。" };
    return prepareNarrativeOutcomeRequest(run, world, ctx, narrativeDecisionOutcomeTool(dynamicSceneAttributePolicy()), "承接当前处境", { task });
  };
  const before = prepare("rendering");
  const beforeText = before.history.map((entry) => entry.content).join("\n");
  run.age = 21; run.stats.physique = 35; run.narrative.assets.currentLocationId = "location:fort";
  for (const task of ["background", "rendering", "dynamic", "decision"] as const) {
    const request = prepare(task);
    const text = request.history.map((entry) => entry.content).join("\n");
    const firstChangedContext = beforeText.indexOf("【本轮召回】");
    assert.equal(text.slice(0, firstChangedContext), beforeText.slice(0, firstChangedContext), `${task}保留原文以前的消息前缀`);
    assert.ok(text.indexOf(summary) < text.indexOf(prose));
    assert.ok(text.indexOf(prose) < text.indexOf("当前年龄：21岁"));
    assert.ok(text.includes("当前生活或行动所在地：关城。"));
    assert.notEqual(text.split("\n").find((line) => line.startsWith("当前能力基础：")),
      beforeText.split("\n").find((line) => line.startsWith("当前能力基础：")), "新属性档位仍按现有规则传达");
    assert.equal(text.split(prose).length - 1, 1);
  }
  const envelope: NarrativeTurnEnvelope = {
    callId: "execute-prefix", source: "scene", worldId: run.worldId, currentAge: run.age,
    backgroundAgeRange: { fromAge: 22, toAge: 22 }, act: { id: "act.one", label: "河岸", prompt: "守住河岸" }, beat: "setup",
    actOutline: outlineForTest("act.one"), capabilities: ["scene", "choice"], storyPatterns: [], socialForces: [],
    focusReferences: [{ id: "location:fort", kind: "location", label: "关城" }], currentLocationId: "location:fort",
    statTiers: resolveNarrativeStatTiers(run.stats), recentChanges: [prose], progressGap: "援军尚未到达",
    clock: { mode: "advance", sameAgeTurnCount: 0, maxSameAgeTurns: 3 }
  };
  const ctx = memoryTestContext(run);
  const prompt = narrativeTurnPlanningPrompt(envelope, ctx.narrativePlan);
  const prepared = prepareNarrativeOutcomeRequest(run, world, ctx, narrativeTurnPlanTools(envelope), prompt, { task: "planning", planningPurpose: "execute" });
  const text = prepared.history.map((entry) => entry.content).join("\n");
  for (const value of [summary, prose, run.personaPrompt, "当前年龄：21岁", envelope.actOutline!.background]) assert.equal(text.split(value).length - 1, 1);
  assert.ok(text.indexOf(summary) < text.indexOf("本幕简要故事："));
  assert.ok(text.indexOf("locationDirective / assetNeeds 地点目录：") < text.indexOf("近期实际经历："));
  assert.ok(text.indexOf(prose) < text.indexOf("当前年龄：21岁"));
  assert.ok(text.indexOf("当前年龄：21岁") < text.indexOf("援军尚未到达"));
  const nextRun = structuredClone(run); nextRun.age++;
  const nextPrompt = narrativeTurnPlanningPrompt({ ...envelope, currentAge: nextRun.age }, memoryTestContext(nextRun).narrativePlan);
  assert.equal(prompt.slice(0, prompt.indexOf("当前年龄：")), nextPrompt.slice(0, nextPrompt.indexOf("当前年龄：")));
});

test("导演两次调用沿用同一有序输入，不重新吸收会话或把消息压回一段文本", async (t) => {
  const run = makeRun();
  const ctx = { ...memoryTestContext(run), apiKey: "not-sent" };
  const sent: Array<Array<{ role: string; content: string | null }>> = [];
  const prose = "你随同袍沿河岸巡行，确认烧毁的桥仍不能通行。";
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { messages: Array<{ role: string; content: string | null }>; tools: Array<{ function: { name: string } }> }) => {
    sent.push(structuredClone(payload.messages));
    const name = sent.length === 1 ? "propose_story_intent" : "render_story_turn";
    assert.ok(payload.tools.some((tool) => tool.function.name === name));
    const args = sent.length === 1 ? { intent: "continue", routeId: "route.main" } : { narrative: prose };
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: name, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] };
  });
  const turn = await generateDirectedStoryTurn(run, world, { allowedIntents: ["continue"], allowClosureRequest: false,
    routeOptions: [{ id: "route.main", label: "守住河岸", summary: "保护河岸居民" }] }, ctx);
  assert.deepEqual(sent[0].slice(1), turn.continuation.messages);
  ctx.conversation!.history.push({ role: "user", content: "不应混入本次续接的会话" }, { role: "assistant", content: "另一段经历" });
  const rendered = await generateDirectedStoryRender(run, world, { turn, kind: "normal", intent: "continue", eventId: "river",
    eventTitle: "河岸巡行", premise: "桥已烧毁", outcomeHint: "确认渡河条件" }, ctx);
  assert.equal(rendered.narrative, prose);
  assert.deepEqual(sent[1].slice(0, sent[0].length), sent[0]);
  assert.ok(!JSON.stringify(sent[1]).includes("不应混入本次续接的会话"));
});

test("实际请求只开放本轮召回事实，工具目录不随存档事实总量增长", () => {
  const run = makeRun();
  run.narrative.enabled = true;
  const ids = applyNarrativeFactUpdates(run, {
    introduce: Array.from({ length: 6 }, (_, i) => ({ kind: "open_question" as const, label: "未了事实" + i })),
    touchFactIds: [], resolveFactIds: []
  }, { sourceEventId: "directory" });
  const ctx = memoryTestContext(run);
  assert.equal(ctx.narrativePlan?.recall?.facts.length, 0);
  const task = interruptedBackgroundTask(run, 0, []);
  const prepared = prepareNarrativeOutcomeRequest(run, world, ctx, task.tool, task.prompt, { task: "background" });
  assert.deepEqual(prepared.factContract.mutableIds, []);
  for (const id of ids) assert.equal(prepared.history.map((entry) => entry.content).join("\n").includes(id), false);
  const focusedCtx = memoryTestContext(run, [ids[5]]);
  const focused = prepareNarrativeOutcomeRequest(run, world, focusedCtx, task.tool, task.prompt, { task: "background" });
  assert.deepEqual(focused.factContract.mutableIds, [ids[5]]);
  assert.ok(focused.history.map((entry) => entry.content).join("\n").includes(ids[5]));
  assert.doesNotThrow(() => parseFactUpdates({ resolutions: [{ factId: ids[5], summary: "事情已经解决" }] }, focused.factContract));
  const schema = prepared.tools[0]!.function as typeof task.tool.function;
  assert.equal("effects" in schema.parameters.properties, false);
});

test("payoff背景与场景的最终工具描述、必填字段各自对应", () => {
  const run = makeRun();
  run.narrative.enabled = true;
  const policy: NarrativeAttributePolicy = { allowedStats: ["intelligence"], allowedBands: ["light"], allowedDirections: ["up"], minEffects: 1, maxEffects: 1 };
  const tools = dynamicNarrativeSceneTools({
    act: { id: "act.one", label: "第一幕", prompt: "生活变化" },
    beat: "payoff", presentation: "scene", allowedTurnKinds: ["scene"],
    sceneAge: 12, backgroundAgeRange: { fromAge: 12, toAge: 14 },
    storyPatterns: [{ id: "pattern.a", label: "经历", summary: "经历形态" }],
    socialForces: [{ id: "force.a", label: "同伴", summary: "熟悉的人" }],
    knownCharacters: [], attributePolicy: policy, backgroundAttributePolicy: policy,
    statTiers: { intelligence: "low", charisma: "low", family: "low", fortune: "low", physique: "low" }
  });
  const prepared = prepareNarrativeOutcomeRequest(run, world, memoryTestContext(run), tools.tools, "按当前任务叙述");
  const definitions = prepared.tools.map((tool) => tool.function as { name: string; parameters: { required: string[]; properties: Record<string, { description?: string }> } });
  const scene = definitions.find((tool) => tool.name === "resolve_scene_outcome")!;
  assert.equal("actHandoff" in scene.parameters.properties, false);
  assert.equal(scene.parameters.required.includes("actHandoff"), false);
  assert.equal("narrative" in scene.parameters.properties, false);
});

test("任务投影保留原人设与四张最终天赋，并隔离不相关身世线索", () => {
  const run = makeRun();
  run.narrative.enabled = true;
  run.personaPrompt = "想做远行船工的人";
  run.cards = Array.from({ length: 4 }, (_, i) => ({ ...card, id: "card" + i, name: "天赋" + i, description: "性情" + i }));
  run.narrative.opening = { status: "ready", profile: { summary: "生于河边", seedHints: ["远行船工留下的约定"] } };
  const ctx = memoryTestContext(run);
  const task = interruptedBackgroundTask(run, 0, []);
  const prepared = prepareNarrativeOutcomeRequest(run, world, ctx, task.tool, task.prompt);
  const text = prepared.history.map((entry) => entry.content).join("\n");
  assert.equal(text.split(run.personaPrompt).length - 1, 1);
  assert.doesNotMatch(prepared.conversation.headCore, /想做远行船工的人/);
  for (const talent of run.cards) assert.ok(text.includes(talent.name));
  assert.doesNotMatch(text, /可选身世线索/);
  const otherRun = makeRun();
  otherRun.narrative.enabled = true;
  otherRun.personaPrompt = "愿意留在故乡行医的人";
  const otherPrepared = prepareNarrativeOutcomeRequest(otherRun, world, memoryTestContext(otherRun), task.tool, task.prompt);
  assert.equal(prepared.conversation.systemHash, otherPrepared.conversation.systemHash, "角色数据不改变静态任务前缀");
  assert.match(formatNarrativePromptPlan(ctx.narrativePlan, "ending"), /平静的生活细节/);
  assert.doesNotMatch(formatTaskNarrativeContext(ctx.narrativePlan), /结局文风/);
});

test("背景任务从已提交原文读历史，旧会话归档不成为第二路上下文", () => {
  const run = makeRun();
  run.narrative.enabled = true;
  const ctx = memoryTestContext(run);
  prepareNarrativeOutcomeRequest(run, world, ctx, interruptedBackgroundTask(run, 0, []).tool, "开始");
  for (let i = 0; i < 5; i++) {
    const text = "独立经历" + i + "，事情已处理完毕。";
    commitNarrativeMemory(run.narrative, { id: "memory:round" + i, age: i, characterIds: [], factionIds: [], factIds: [], text });
    commitNarrativeEpisode(run, { callId: `round${i}`, sourceEventId: `round${i}`, turnKind: "background", age: i });
    recordDirectedStoryTurnOutcome(ctx, run, { kind: "normal", sourceEventId: "round" + i, narrative: text, statChanges: {} });
  }
  run.aiConversation = { year: ctx.conversation };
  assert.equal(ctx.conversation!.archive.length, 2);
  const nextCtx = memoryTestContext(run);
  assert.deepEqual(nextCtx.narrativePlan?.recall?.memories, []);
  const prepared = prepareNarrativeOutcomeRequest(run, world, nextCtx, interruptedBackgroundTask(run, 0, []).tool, "接着叙述");
  const input = prepared.history.map((message) => message.content).join("\n");
  for (let i = 0; i < 5; i++) assert.equal(input.split("独立经历" + i).length - 1, 1);
  const work = { revision: 0, previousSummary: "", rounds: structuredClone(nextCtx.conversation!.archive) };
  assert.ok(applyConversationSummary(nextCtx.conversation!, work, "较早的两段经历已完成。"));
  assert.equal(pendingConversationContext(nextCtx.conversation!), "");
});


test("实际世界成长侧重不会缩窄工具属性目录，搭配效果与引擎结算一致", async () => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  const run = makeRun();
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  const runtime = run.narrative.actRuntime!;
  assert.ok(runtime.growthFocusOptions?.length);
  for (const focus of runtime.growthFocusOptions!) {
    runtime.growthFocusId = focus.id;
    const policy = dynamicBackgroundAttributePolicy(run);
    const first = focus.primaryStats[0]!;
    const other = policy.allowedStats.find((stat) => !focus.primaryStats.includes(stat))!;
    const effects = [{ stat: first, direction: "up" as const, band: "medium" as const }, { stat: other, direction: "up" as const, band: "light" as const }];
    const tools = dynamicNarrativeSceneTools({
      act: definition.mainlineActs![0], beat: "setup", presentation: "summary", allowedTurnKinds: ["background"],
      sceneAge: 1, backgroundAgeRange: { fromAge: 1, toAge: 3 },
      storyPatterns: [], socialForces: [], knownCharacters: [], backgroundAttributePolicy: policy,
      statTiers: { intelligence: "low", charisma: "low", family: "low", fortune: "low", physique: "low" }
    });
    const taskPrompt = dynamicNarrativeScenePrompt({
      act: definition.mainlineActs![0], beat: "setup", presentation: "summary", allowedTurnKinds: ["background"],
      sceneAge: 1, backgroundAgeRange: { fromAge: 1, toAge: 3 }, storyPatterns: [], socialForces: [], knownCharacters: [],
      backgroundAttributePolicy: policy, statTiers: { intelligence: "low", charisma: "low", family: "low", fortune: "low", physique: "low" }
    }, tools);
    const prepared = prepareNarrativeOutcomeRequest(run, world, memoryTestContext(run), tools.tools, taskPrompt);
    const tool = prepared.tools[0].function as { parameters: { properties: { effects: { description: string; items: { properties: { stat: { enum: string[] } } } } } } };
    const schema = tool.parameters.properties.effects;
    assert.deepEqual(schema.items.properties.stat.enum, Object.keys(run.stats));
    for (const stat of focus.primaryStats) assert.ok(taskPrompt.includes(stat));
    assert.match(taskPrompt, /至少1项/);
    assert.equal(validateNarrativeEffects(effects, policy).ok, true);
    const before = structuredClone(run);
    assert.ok(approveNarrativeAttributeOutcome(run, world, { effects }, "background", policy));
    assert.deepEqual(run, before);
    const rejected = validateNarrativeEffects([effects[1]], policy);
    assert.ok(!rejected.ok);
    assert.equal(rejected.issue.rule, "growth_focus_missing");
    assert.equal(approveNarrativeAttributeOutcome(run, world, { effects: [effects[1]] }, "background", policy), null);
  }
});

test("属性畸形、重复和方向限制给出具体原因，场景限制也出现在工具说明", () => {
  const policy = dynamicSceneAttributePolicy();
  const examples: Array<[unknown, string, string]> = [
    [null, "array_required", "effects"],
    [[null], "object_required", "effects[0]"],
    [[{ stat: "family", direction: "up", band: "light" }, { stat: "family", direction: "down", band: "light" }], "duplicate_stat", "effects[1].stat"],
    [[{ stat: "physique", direction: "down", band: "light" }], "negative_stat_forbidden", "effects[0]"]
  ];
  for (const [raw, rule, path] of examples) {
    const result = validateNarrativeEffects(raw, policy);
    assert.ok(!result.ok);
    assert.equal(result.issue.rule, rule);
    assert.equal(result.issue.path, path);
  }
  const schema = narrativeEffectsSchema(policy) as { items: { properties: { stat: { enum: string[] } } } };
  assert.deepEqual(schema.items.properties.stat.enum, ["intelligence", "charisma", "family", "fortune", "physique"]);
  const prompt = dynamicNarrativeScenePrompt({
    act: { id: "act.one", label: "第一幕", prompt: "生活变化" }, beat: "setup", presentation: "scene", allowedTurnKinds: ["scene"],
    sceneAge: 12, backgroundAgeRange: { fromAge: 12, toAge: 13 }, storyPatterns: [], socialForces: [], knownCharacters: [],
    attributePolicy: policy, backgroundAttributePolicy: policy,
    statTiers: { intelligence: "low", charisma: "low", family: "low", fortune: "low", physique: "low" }
  });
  assert.match(prompt, /physique只采用正向/);
  assert.match(prompt, /effects 明确返回 \[\]/);
  assert.equal(validateNarrativeEffects([], policy).ok, true);
  assert.equal(validateNarrativeEffects([{ stat: "family", direction: "down", band: "light" }], policy).ok, true);
  assert.match(prompt, /每个属性只出现一次/);
});

test("动态抉择各档位的工具属性合同与引擎审批逐项一致", () => {
  const run = makeRun();
  run.narrative.enabled = true;
  const definition: NarrativeWorldDefinition = {
    ...narrativeWorld,
    mainlineActs: [{ id: "entry", label: "开场", prompt: "生活的变化" }],
    narrativeFactions: [{ id: "guardian", label: "同伴", summary: "同行之人" }]
  };
  advanceWithDynamicNarrativeScene(run, world, definition, {
    patternIds: [], forceIds: [], beatDecision: "advance", beat: "setup", narrative: "你在新学舍认识同伴，并渐渐熟悉周围的人和事。", participants: [],
    attributeOutcome: { effects: [{ stat: "intelligence", direction: "up", band: "light" }] }, attributePolicy: dynamicSceneAttributePolicy()
  });
  advanceWithDynamicNarrativeScene(run, world, definition, {
    patternIds: [], forceIds: [], beatDecision: "hold", beat: "escalation", narrative: "同伴遇到了困难，你需要决定是否一起承担这次任务。", participants: [], createsDecision: true
  });
  for (const policy of Object.values(run.pendingDirectedDecisionPolicy!)) {
    const tool = narrativeDecisionOutcomeTool(policy);
    const prepared = prepareNarrativeOutcomeRequest(run, world, memoryTestContext(run), tool, "结算抉择后果", { task: "settlement" });
    assert.ok(JSON.stringify(prepared.tools).includes(String(narrativeEffectsSchema(policy).description)));
    const settlementSchema = (prepared.tools[0].function as {
      parameters: { required: string[]; properties: Record<string, unknown> };
    }).parameters;
    assert.ok(!settlementSchema.required.includes("narrative"));
    assert.equal(settlementSchema.properties.narrative, undefined);
    for (const stat of policy.allowedStats) for (const direction of ["up", "down"] as const) for (const band of ["light", "medium", "heavy"] as const) {
      const effects = [{ stat, direction, band }];
      assert.equal(
        validateNarrativeEffects(effects, policy).ok,
        approveNarrativeAttributeOutcome(run, world, { effects }, "decision", policy) !== null,
        `${stat}/${direction}/${band}`
      );
    }
  }
  const balanced = run.pendingDirectedDecisionPolicy!.balanced;
  assert.equal(validateNarrativeEffects([{ stat: "physique", direction: "down", band: "medium" }], balanced).ok, true);
  assert.equal(validateNarrativeEffects([], balanced).ok, true);

  const renderPrepared = prepareNarrativeOutcomeRequest(
    run,
    world,
    memoryTestContext(run),
    narrativeDecisionRenderTool(),
    "依据已审批结算生成正文",
    { task: "decision" }
  );
  const renderSchema = (renderPrepared.tools[0].function as {
    parameters: { required: string[]; properties: Record<string, unknown> };
  }).parameters;
  assert.deepEqual(renderSchema.required, ["narrative"]);
  assert.deepEqual(Object.keys(renderSchema.properties), ["narrative", "survivalThreat"]);
});

test("选项仅按明确ID映射，重复和未知ID不会改派到其他风险档", () => {
  const options = [
    { id: "risky", label: "独自前往", description: "先行探明情况", abilityRefs: [], locationDirective: { mode: "stay" } },
    { id: "safe", label: "请人打听", description: "留在熟悉之处", abilityRefs: [], locationDirective: { mode: "stay" } },
    { id: "balanced", label: "结伴前往", description: "与同伴相互照应", abilityRefs: [], locationDirective: { mode: "stay" } }
  ];
  const parsed = normalizeMilestoneOptionOverrides(options)!;
  assert.deepEqual(parsed.map((entry) => entry.id), ["safe", "balanced", "risky"]);
  assert.equal(parsed[2].label, "独自前往");
  const duplicated = [options[0], options[1], { ...options[2], id: "safe" }];
  assert.equal(normalizeMilestoneOptionOverrides(duplicated), null);
  assert.throws(() => normalizeMilestoneOptionOverrides(duplicated, true), (error: unknown) =>
    error instanceof NarrativeOutcomeError && error.reason === "dynamic_choice_presentation_invalid" &&
    error.validation?.rule === "duplicate_choice_id" && error.validation.path === "optionOverrides[2].id");
  assert.equal(normalizeMilestoneOptionOverrides([{ ...options[0], id: "unknown", label: "冒险" }, ...options.slice(1)]), null);
  assert.deepEqual(normalizeMilestoneOptionOverrides([
    { ...options[1], id: "a" }, { ...options[2], id: "b" }, { ...options[0], id: "c" }
  ])?.map((entry) => entry.id), ["safe", "balanced", "risky"]);
});

test("人物引用沿用档案身份，短关系说明有效，新人物仍需完整身份", () => {
  const factions = [{ id: "school", label: "同窗", summary: "相识的学友" }];
  const known = [{ id: "character:one", name: "小林", role: "旧日同窗", description: "与你一同求学" }];
  const policy = dynamicSceneAttributePolicy();
  const sceneInput: DynamicNarrativeSceneInput = {
    act: { id: "act.one", label: "第一幕", prompt: "生活变化" }, beat: "setup", presentation: "scene", allowedTurnKinds: ["scene"],
    sceneAge: 12, backgroundAgeRange: { fromAge: 12, toAge: 13 }, storyPatterns: [], socialForces: factions, knownCharacters: known,
    attributePolicy: policy, backgroundAttributePolicy: policy,
    statTiers: { intelligence: "low", charisma: "low", family: "low", fortune: "low", physique: "low" }
  };
  const prompt = dynamicNarrativeScenePrompt(sceneInput, undefined, "你练习了剑术。");
  assert.match(prompt, /你练习了剑术/);
  assert.doesNotMatch(prompt, /character:one|小林|人物引用目录/);
  const renderPrompt = dynamicNarrativeRenderPrompt({ ...sceneInput, presentation: "choice",
    statTierLabels: { intelligence: "神思通明", charisma: "风姿出众", family: "家资丰厚", fortune: "福星高照", physique: "身强体健" }
  }, 11);
  assert.match(renderPrompt, /本次叙述年龄：12岁/);
  assert.doesNotMatch(renderPrompt, /safe|balanced|risky|已结算|attributeEffects/);
  assert.equal(dynamicNarrativeSceneTools({ ...sceneInput, presentation: "choice" }).tools.length, 1, "结算工具声明不再依据规划形式隐藏，实际待选正文由运行时跳过结算");
  const sceneTool = dynamicNarrativeSceneTools(sceneInput).tools[0] as { function: { parameters: { properties: Record<string, unknown> } } };
  assert.deepEqual(Object.keys(sceneTool.function.parameters.properties), ["effects"]);
  const parsed = parseDynamicNarrativeParticipants([{
    characterRef: known[0].id, name: "陌生称谓", factionId: "school",
    relationship: { stance: "friendly", summary: "和好" }
  }], factions, known)!;
  assert.equal(parsed[0].name, "小林");
  assert.equal(parsed[0].role, "");
  assert.equal(parsed[0].factionId, "school");
  assert.equal(parsed[0].description, "");
  assert.equal(parsed[0].relationship?.summary, "和好");
  assert.throws(
    () => parseDynamicNarrativeParticipants([{ characterRef: "character:missing" }], factions, known),
    (error: unknown) => error instanceof NarrativeOutcomeError &&
      error.validation?.rule === "character_reference_invalid" &&
      error.validation.received === "character:missing" &&
      Array.isArray(error.validation.expected) && error.validation.expected.includes("character:one")
  );
  assert.throws(
    () => parseDynamicNarrativeParticipants([{ characterRef: "one" }], factions, known),
    (error: unknown) => error instanceof NarrativeOutcomeError &&
      error.validation?.rule === "character_reference_invalid" &&
      error.validation.received === "one"
  );
  assert.throws(() => parseDynamicNarrativeParticipants([{ characterRef: "new" }], factions, known), NarrativeOutcomeError);
  assert.equal(parseDynamicNarrativeParticipants([{
    characterRef: "new", name: "小周", factionId: "school", role: "同桌", description: "热心的同学", recurring: true
  }], factions, known)?.length, 1);
  const ensemble = Array.from({ length: 8 }, (_, index) => ({
    characterRef: "new", name: `人物${index}`, role: `角色${index}`, description: `参与场景${index}`, recurring: false
  }));
  assert.equal(parseDynamicNarrativeParticipants(ensemble, factions, known)?.length, 8, "按返回对象维护身份，不按人数丢弃合法登记");
  const declared = parseDynamicNarrativeParticipants([{ characterRef: "new", name: "小周" }], factions, known, true)!;
  assert.equal(declared[0].name, "小周");
  assert.equal(declared[0].role, undefined);
});

test("地点与本领按引用更新指定字段，省略保留，显式更正名称与来历仍沿用身份", () => {
  const original = applyNarrativeAssetUpdates(undefined, parseNarrativeAssetUpdates({
    locations: [{ ref: "new", name: "河岸", description: "清静的渡口", current: true , spatialDescription: "清静的渡口" }],
    abilities: [{ ref: "new", name: "游水", description: "能顺水游过河道", source: "跟父亲学会", mastery: "初学" , usage: "能顺水游过河道" }]
  }), { age: 8 }).assets;
  const before = structuredClone(original);
  const changes = parseNarrativeAssetUpdates({
    locations: [{ ref: original.locations[0].id, description: "雨后水涨的渡口" }],
    abilities: [{ ref: original.abilities[0].id, mastery: "熟练" }]
  }, original);
  const updated = applyNarrativeAssetUpdates(original, changes, { age: 9 }).assets;
  assert.equal(updated.locations[0].name, "河岸");
  assert.equal(updated.currentLocationId, original.currentLocationId);
  assert.equal(updated.abilities[0].name, "游水");
  assert.equal(updated.abilities[0].source, "跟父亲学会");
  assert.equal(updated.abilities[0].mastery, "熟练");
  const corrected = applyNarrativeAssetUpdates(updated, { locations: [], abilities: [{ ref: original.abilities[0].id,
    name: "泅水", source: "幼时跟父亲学习，后在渡口练熟" }] }, { age: 10 }).assets;
  assert.equal(corrected.abilities[0].id, original.abilities[0].id);
  assert.equal(corrected.abilities[0].name, "泅水");
  assert.equal(corrected.abilities[0].source, "幼时跟父亲学习，后在渡口练熟");
  assert.equal(corrected.abilities[0].mastery, "熟练");
  assert.deepEqual(original, before);
  assert.deepEqual(parseNarrativeAssetUpdates({ locations: [], abilities: [] }, original), { locations: [], abilities: [] });
  assert.throws(() => parseNarrativeAssetUpdates({}, original));
  assert.throws(() => parseNarrativeAssetUpdates({ abilities: [{ ref: "new", mastery: "熟练" }] }, original));
});


test("高潮世界事实的缺省收束方式在实际请求中可见，无事实时不额外要求", () => {
  const run = makeRun();
  const act = { id: "one", label: "第一幕", prompt: "生活变化" };
  const scene = { beat: "climax", factId: "world:fact" };
  const modes = narrativeFactResolutionModes(act, scene);
  assert.deepEqual(modes, ["exposed", "concealed", "compromised", "sacrificed"]);
  assert.deepEqual(narrativeFactResolutionModes({ ...act, resolutionModes: [] }, scene), modes);
  assert.deepEqual(narrativeFactResolutionModes({ ...act, resolutionModes: ["exposed"] }, scene), ["exposed"]);
  assert.equal(narrativeFactResolutionModes(act, { beat: "climax" }), undefined);
  assert.equal(narrativeFactResolutionModes(act, { beat: "pressure", factId: scene.factId }), undefined);
  const prepared = prepareNarrativeOutcomeRequest(run, world, memoryTestContext(run),
    narrativeDecisionOutcomeTool(dynamicSceneAttributePolicy(), modes), "结算抉择结果", { task: "settlement" });
  const tool = prepared.tools[0].function as { parameters: { required: string[]; properties: { factResolution: { enum: string[] } } } };
  assert.equal(tool.parameters.required.includes("factResolution"), true);
  assert.deepEqual(tool.parameters.properties.factResolution.enum, ["exposed", "concealed", "compromised", "sacrificed"]);
});

test("抉择核心结算不隐式携带连续性字段", () => {
  const run = makeRun();
  const prepared = prepareNarrativeOutcomeRequest(
    run,
    world,
    memoryTestContext(run),
    narrativeDecisionOutcomeTool(dynamicSceneAttributePolicy()),
    "结算抉择结果",
    { task: "settlement" }
  );
  const tool = prepared.tools[0].function as { parameters: { properties: Record<string, unknown> } };
  assert.deepEqual(Object.keys(tool.parameters.properties).sort(), ["effects", "factResolution"]);
});

test("连续性同步使用浅层字段并复用同一引用契约", () => {
  const run = makeRun();
  const tool = {
    type: "function",
    function: {
      name: "sync_narrative_continuity",
      description: "同步连续性",
      parameters: { type: "object", additionalProperties: false, properties: {} as Record<string, unknown> }
    }
  };
  const prepared = prepareNarrativeOutcomeRequest(run, world, memoryTestContext(run), tool, "同步本轮变化", {
    task: "continuity",
    contracts: { assets: true, facts: true, relationships: true, layout: "continuity" }
  });
  const definition = prepared.tools[0].function as { parameters: { properties: Record<string, unknown>; required: string[] } };
  assert.deepEqual(Object.keys(definition.parameters.properties).sort(), [
    "abilityUpdates", "factIntroductions", "factUpdates", "identityMerges", "locationUpdates", "relationshipUpdates"
  ]);
  assert.deepEqual(definition.parameters.required, ["locationUpdates", "abilityUpdates", "factIntroductions", "factUpdates", "relationshipUpdates", "identityMerges"]);
  validateNarrativeContinuityToolArguments({ locationUpdates: [], abilityUpdates: [], factIntroductions: [], factUpdates: [], relationshipUpdates: [], identityMerges: [] }, definition.parameters);
  assert.equal("assetUpdates" in definition.parameters.properties, false);
});

test("实际连续性请求允许从最终正文登记多个新地点与本领", () => {
  const run = makeRun();
  const tool = {
    type: "function", function: {
      name: "sync_narrative_continuity", description: "同步连续性",
      parameters: { type: "object", additionalProperties: false, properties: {} as Record<string, unknown> }
    }
  };
  const prepared = prepareNarrativeOutcomeRequest(run, world, memoryTestContext(run), tool, "同步本轮变化", {
    task: "continuity",
    contracts: { assets: true, layout: "continuity" }
  });
  const definition = prepared.tools[0].function as { parameters: { required: string[]; properties: Record<string, unknown> } };
  assert.deepEqual(Object.keys(definition.parameters.properties), ["locationUpdates", "abilityUpdates", "identityMerges"]);
  assert.deepEqual(definition.parameters.required, ["locationUpdates", "abilityUpdates", "identityMerges"]);
  assert.match(prepared.conversation.headCore, /只提交.*改变/);
  validateNarrativeContinuityToolArguments({
    locationUpdates: [
      { ref: "new", name: "营地", description: "可回访的驻地", current: false , spatialDescription: "可回访的驻地" },
      { ref: "new", name: "河湾哨", description: "沿河设置的哨所", current: true , spatialDescription: "沿河设置的哨所" }
    ],
    abilityUpdates: [{ ref: "new", name: "骑射", description: "马上开弓", source: "随军习得", mastery: "初通" , usage: "马上开弓" }],
    identityMerges: []
  }, definition.parameters);
});

test("人物与资产变化在同一个连续性工具对象中提交", () => {
  const run = makeRun();
  run.narrative.enabled = true;
  const characterIds = ["character:mixed-one", "character:mixed-two"];
  for (const [index, id] of characterIds.entries()) {
    run.narrative.dynamicCharacters.push({
      id, name: `故人${index + 1}`, role: "同行者", description: "仍在此地生活",
      status: "active", importance: "recurring", introducedAge: 1, lastSeenAge: 1,
      relatedFactIds: [], relatedRouteIds: []
    });
  }
  const locationId = "location:mixed-town";
  run.narrative.assets = {
    locations: [{ id: locationId, name: "边镇", description: "边境小镇", introduced: { age: 1 }, lastSeen: { age: 1 } }],
    abilities: [], currentLocationId: locationId
  };
  const tool = {
    type: "function", function: {
      name: "sync_narrative_continuity", description: "同步连续性",
      parameters: { type: "object", additionalProperties: false, properties: {} as Record<string, unknown> }
    }
  };
  const prepared = prepareNarrativeOutcomeRequest(run, world, memoryTestContext(run, [...characterIds, locationId]), tool, "同步本轮变化", {
    task: "continuity",
    writeSet: { factIds: [], characterIds, locationIds: [locationId], abilityIds: [] },
    contracts: { assets: true, relationships: true, layout: "continuity" }
  });
  const parameters = (prepared.tools[0].function as { parameters: { properties: Record<string, unknown>; required: string[] } }).parameters;
  assert.deepEqual(Object.keys(parameters.properties).sort(), ["abilityUpdates", "identityMerges", "locationUpdates", "relationshipUpdates"]);
  assert.deepEqual(parameters.required, ["locationUpdates", "abilityUpdates", "relationshipUpdates", "identityMerges"]);
  assert.match(prepared.conversation.headCore, /sync_narrative_continuity.*参数对象/);
  assert.doesNotMatch(prepared.history.map((entry) => entry.content).join("\n"), /同级必填字段=/, "必填结构由原生 Schema 单独提供");

  const valid = {
    identityMerges: [],
    locationUpdates: [{ ref: locationId, description: "边镇新设巡防营地" }],
    abilityUpdates: [],
    relationshipUpdates: [{ characterRef: characterIds[0], stance: "friendly", summary: "共同守护边镇" }]
  };
  validateNarrativeContinuityToolArguments(valid, parameters);
  validateNarrativeContinuityToolArguments({ locationUpdates: [], abilityUpdates: [], relationshipUpdates: [], identityMerges: [] }, parameters);
  assert.equal(parseNarrativeContinuityAssetUpdates(valid, prepared.allowedAssets).locations.length, 1);
  assert.equal(parseRelationshipUpdates(valid.relationshipUpdates, characterIds)?.length, 1);
  assert.throws(() => validateNarrativeContinuityToolArguments({ relationshipUpdates: [] }, parameters),
    (error: unknown) => error instanceof NarrativeOutcomeError && error.validation?.path === "locationUpdates");
  assert.throws(() => validateNarrativeContinuityToolArguments({ ...valid, unexpectedAssetField: {} }, parameters),
    (error: unknown) => error instanceof NarrativeOutcomeError && error.validation?.path === "unexpectedAssetField");
});

test("连续性写集合只开放本轮实际可变的既有引用", () => {
  const run = makeRun();
  run.narrative.enabled = true;
  const factIds = applyNarrativeFactUpdates(run, {
    introduce: [
      { kind: "open_question", label: "本轮提到的疑问" },
      { kind: "open_question", label: "仅供读取的旁支" }
    ],
    touchFactIds: [],
    resolveFactIds: []
  }, { sourceEventId: "write-set" });
  const writableFactId = factIds[0]!;
  const ctx = memoryTestContext(run, factIds);
  const tool = {
    type: "function", function: {
      name: "sync_narrative_continuity", description: "同步连续性",
      parameters: { type: "object", additionalProperties: false, properties: {} as Record<string, unknown> }
    }
  };
  const prepared = prepareNarrativeOutcomeRequest(run, world, ctx, tool, "同步本轮变化", {
    task: "continuity",
    writeSet: { factIds: [writableFactId], characterIds: [], locationIds: [], abilityIds: [] },
    contracts: { assets: true, facts: true, relationships: true, layout: "continuity" }
  });
  assert.deepEqual(prepared.factContract.mutableIds, [writableFactId]);
  assert.deepEqual(prepared.characterIds, []);
  assert.deepEqual(prepared.allowedAssets.locations, []);
  assert.deepEqual(prepared.allowedAssets.abilities, []);
});

test("正文引用声明与渲染 ReadSet 取交集，参与人物仍可提交关系变化", () => {
  const run = makeRun();
  const factIds = applyNarrativeFactUpdates(run, {
    introduce: [
      { kind: "open_question", label: "被正文实际承接的疑问" },
      { kind: "open_question", label: "只被召回但未使用的疑问" }
    ], touchFactIds: [], resolveFactIds: []
  }, { sourceEventId: "read-write-set" });
  run.narrative.dynamicCharacters.push(
    { id: "person:declared", name: "甲", role: "同伴", description: "同行者", status: "active", importance: "recurring", introducedAge: 1, lastSeenAge: 1, relatedFactIds: [], relatedRouteIds: [] },
    { id: "person:participant", name: "乙", role: "对手", description: "本轮参与者", status: "active", importance: "recurring", introducedAge: 1, lastSeenAge: 1, relatedFactIds: [], relatedRouteIds: [] }
  );
  const writeSet = buildNarrativeContinuityWriteSet(run, {
    factIds, characterIds: ["person:declared"], locationIds: [], abilityIds: []
  }, {
    factIds: [factIds[0], "dynamic:not-recalled"], characterIds: [], locationIds: [], abilityIds: []
  }, ["person:participant"]);
  assert.deepEqual(writeSet.factIds, [factIds[0]]);
  assert.deepEqual(writeSet.characterIds, ["person:participant"]);
  assert.equal(hasNarrativeContinuityWork({ factIds: [], characterIds: [], locationIds: [], abilityIds: [] }), false);
  assert.equal(hasNarrativeContinuityWork(writeSet), true);
  assert.equal(hasNarrativeContinuityWork({ factIds: [], characterIds: [], locationIds: [], abilityIds: [] }, true), true);
});

test("连续性读取历史事实但只开放当前幕的开放事实写入", () => {
  const run = makeRun();
  run.narrative.enabled = true;
  run.narrative.actRuntime = {
    actId: "act.one", beat: "pressure", enteredAge: 10, lastAdvancedAge: 10,
    selectedRouteIds: [], decisionCount: 0, growthFocusOptions: []
  };
  const previousFactId = applyNarrativeFactUpdates(run, {
    introduce: [{ kind: "open_question", label: "上一幕尚有历史影响" }], touchFactIds: [], resolveFactIds: []
  }, { sourceEventId: "previous", actId: "act.previous" })[0]!;
  const currentFactId = applyNarrativeFactUpdates(run, {
    introduce: [{ kind: "stake", label: "当前幕正在承受的风险" }], touchFactIds: [], resolveFactIds: []
  }, { sourceEventId: "current", actId: "act.one" })[0]!;
  const resolvedFactId = applyNarrativeFactUpdates(run, {
    introduce: [{ kind: "commitment", label: "当前幕已经履行的承诺", status: "resolved" }], touchFactIds: [], resolveFactIds: []
  }, { sourceEventId: "resolved", actId: "act.one" })[0]!;
  const ctx = memoryTestContext(run, [previousFactId, currentFactId, resolvedFactId]);
  const factsById = new Map(run.story.factLedger?.facts.map((fact) => [fact.id, fact.label]));
  ctx.narrativePlan!.recall = {
    ...ctx.narrativePlan!.recall!,
    facts: [previousFactId, currentFactId].map((id) => ({ id, label: factsById.get(id)! })),
    resolvedFacts: [{ id: resolvedFactId, label: factsById.get(resolvedFactId)! }]
  };
  const readSet = narrativeContinuityReadSet(ctx.narrativePlan);
  assert.ok(readSet.factIds.includes(previousFactId));
  assert.ok(readSet.factIds.includes(currentFactId));
  assert.deepEqual(narrativeContinuityWritableSet(run, ctx.narrativePlan).factIds, [currentFactId]);
  const writeSet = buildNarrativeContinuityWriteSet(
    run,
    narrativeContinuityWritableSet(run, ctx.narrativePlan),
    { factIds: [previousFactId, currentFactId, resolvedFactId], characterIds: [], locationIds: [], abilityIds: [] }
  );
  assert.deepEqual(writeSet.factIds, [currentFactId]);
});

test("稳定渲染 Schema 通过动态任务目录回接本轮完整引用", () => {
  const run = makeRun();
  run.narrative.enabled = true;
  const [factId] = applyNarrativeFactUpdates(run, {
    introduce: [{ kind: "open_question", label: "需要承接的疑问" }], touchFactIds: [], resolveFactIds: []
  }, { sourceEventId: "reference-contract" });
  const characterId = "person:reference-contract";
  run.narrative.dynamicCharacters.push({
    id: characterId, name: "沈砚", role: "旧识", description: "仍与此事有关的人",
    status: "active", importance: "recurring", introducedAge: 1, lastSeenAge: 1,
    relatedFactIds: [factId], relatedRouteIds: []
  });
  run.narrative.assets = {
    locations: [{ id: "location:reference-contract", name: "临河旧宅", description: "此前见证此事的旧宅", spatialDescription: "此前见证此事的旧宅", introduced: { age: 1 }, lastSeen: { age: 1 } }],
    abilities: [{ id: "ability:reference-contract", name: "辨痕", description: "辨认旧物痕迹", usage: "辨认旧物痕迹", source: "早年习得", mastery: "熟练", introduced: { age: 1 }, updated: { age: 1 } }],
    currentLocationId: "location:reference-contract"
  };
  const focusIds = [factId, characterId, "location:reference-contract", "ability:reference-contract"];
  const ctx = memoryTestContext(run, focusIds);
  const prepared = prepareNarrativeOutcomeRequest(run, world, ctx, narrativeDecisionRenderTool(), "写正文", {
    task: "rendering", contracts: { assets: "declarations", references: true }
  });
  const definition = prepared.tools[0].function as { parameters: { required: string[]; properties: Record<string, any> } };
  assert.ok(definition.parameters.required.includes("continuityRefs"));
  assert.ok(definition.parameters.required.includes("continuityRequired"));
  assert.equal(definition.parameters.properties.continuityRefs.properties.factIds.items.enum, undefined);
  assert.equal(definition.parameters.properties.participants.items.properties.characterRef.enum, undefined);
  const requestText = prepared.history.map((entry) => entry.content).join("\n");
  assert.match(requestText, /本轮 continuityRefs 可修改事实目录/);
  assert.match(requestText, new RegExp(`${factId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}（需要承接的疑问）`));
  assert.match(requestText, new RegExp(`${characterId}=沈砚`));
  assert.match(requestText, /地点身份目录：location:reference-contract=临河旧宅/);
  assert.match(requestText, /本领身份目录：ability:reference-contract=辨痕/);
  assert.deepEqual(prepared.allowedActivityRefs.locationIds, ["location:reference-contract"]);
  assert.deepEqual(prepared.allowedActivityRefs.abilityIds, ["ability:reference-contract"]);

  const otherRun = makeRun();
  otherRun.narrative.enabled = true;
  const [otherFactId] = applyNarrativeFactUpdates(otherRun, {
    introduce: [{ kind: "open_question", label: "另一件需要承接的事" }], touchFactIds: [], resolveFactIds: []
  }, { sourceEventId: "reference-contract-other" });
  const otherPrepared = prepareNarrativeOutcomeRequest(otherRun, world, memoryTestContext(otherRun, [otherFactId]), narrativeDecisionRenderTool(), "写正文", {
    task: "rendering", contracts: { assets: "declarations", references: true }
  });
  assert.equal(JSON.stringify(prepared.tools), JSON.stringify(otherPrepared.tools));
  const stableText = (request: typeof prepared) => request.history.find((entry) => entry.content.startsWith("【长期设定】"))?.content;
  assert.equal(stableText(prepared), stableText(otherPrepared));
  assert.match(otherPrepared.history.map((entry) => entry.content).join("\n"), /另一件需要承接的事/);
  assert.doesNotMatch(otherPrepared.history.map((entry) => entry.content).join("\n"), /临河旧宅/);

  const emptyContract = factUpdateContract([]);
  assert.deepEqual(Object.keys(emptyContract.schema.properties), ["introduce", "updates"]);
});

test("非渲染合同不注入 continuityRefs 动态目录", () => {
  const run = makeRun();
  const prepared = prepareNarrativeOutcomeRequest(
    run,
    world,
    memoryTestContext(run),
    narrativeDecisionOutcomeTool(dynamicSceneAttributePolicy()),
    "结算抉择结果",
    { task: "settlement" }
  );
  assert.doesNotMatch(prepared.history.map((entry) => entry.content).join("\n"), /本轮 continuityRefs 可修改事实目录/);
});

test("服务商缓存 Token 与本地结果复用使用不同统计语义", () => {
  assert.deepEqual(extractProviderUsage({ usage: {
    prompt_tokens: 4320, completion_tokens: 180, total_tokens: 4500,
    prompt_cache_hit_tokens: 4096, prompt_cache_miss_tokens: 224
  } }, "chat"), {
    inputTokens: 4320, outputTokens: 180, totalTokens: 4500,
    cachedInputTokens: 4096, uncachedInputTokens: 224, providerCacheReported: true
  });
  assert.deepEqual(extractProviderUsage({ usage: {
    input_tokens: 1000, output_tokens: 80, total_tokens: 1080,
    input_tokens_details: { cached_tokens: 640 }
  } }, "responses"), {
    inputTokens: 1000, outputTokens: 80, totalTokens: 1080,
    cachedInputTokens: 640, uncachedInputTokens: 360, providerCacheReported: true
  });
});

test("旧幕后果不因另一关注对象的描述递归扩张，承诺仍可收束", () => {
  const run = makeRun();
  run.narrative.enabled = true;
  const records = [
    { id: "act:one:payoff", kind: "open_question" as const, status: "resolved" as const, label: "争议已经裁定" },
    { id: "act:one:consequence", kind: "cost" as const, status: "open" as const, label: "失去了原先的住处" },
    { id: "act:one:continuation", kind: "commitment" as const, status: "open" as const, label: "答应为同伴安置住处" },
    { id: "world:next", kind: "open_question" as const, status: "open" as const, label: "当前世界矛盾" }
  ].map((fact) => ({ ...fact, sourceEventId: "handoff", introducedAge: 20, lastTouchedAge: 20 }));
  run.story.factLedger!.facts = records;
  const snapshot = JSON.parse(JSON.stringify(run)) as typeof run;
  const ctx = memoryTestContext(run, ["act:one:continuation"]);
  const task = interruptedBackgroundTask(run, 0, []);
  const prepared = prepareNarrativeOutcomeRequest(run, world, ctx, task.tool, task.prompt, { task: "background" });
  assert.deepEqual(prepared.factContract.mutableIds, ["act:one:continuation"]);
  assert.ok(!ctx.narrativePlan!.factDirectory?.some((fact) => fact.id === "act:one:consequence"));
  assert.ok(!ctx.narrativePlan!.recall!.resolvedFacts?.some((fact) => fact.id === "act:one:consequence"));
  assert.ok(!selectDynamicNarrativeContext(run, { task: "background", text: "住处" }).resolvedFacts?.some((fact) => fact.label.includes("失去了原先的住处")));
  const update = parseFactUpdates({ resolutions: [{ factId: "act:one:continuation", summary: "同伴已经安顿下来" }] }, prepared.factContract)!;
  applyNarrativeFactUpdates(run, update, { sourceEventId: "settlement" });
  assert.equal(run.story.factLedger!.facts.find((fact) => fact.id === "act:one:consequence")?.status, "resolved");
  assert.equal(run.story.factLedger!.facts.find((fact) => fact.id === "act:one:continuation")?.resolutionSummary, "同伴已经安顿下来");
  assert.equal(run.story.factLedger!.facts.find((fact) => fact.id === "world:next")?.status, "open");
  assert.throws(() => parseFactUpdates({ resolveFactIds: ["world:next"] }, prepared.factContract));
  assert.throws(() => parseFactUpdates({ resolveFactIds: ["act:one:payoff"] }, prepared.factContract));
  assert.equal(snapshot.story.factLedger!.facts.find((fact) => fact.id === "act:one:continuation")?.status, "open");
  assert.deepEqual(memoryTestContext(snapshot, ["act:one:continuation"]).narrativePlan?.recall?.facts.map((fact) => fact.id), ["act:one:continuation"]);
});

test("静态 IF 只进入幕初规划，正文与观察只使用本幕简要故事", async () => {
  for (const worldId of ["ancient", "modern", "fantasy"]) {
    const definition = await loadNarrativeExperienceForTest(worldId);
    const run = makeRun(); run.worldId = worldId; run.narrative.enabled = true;
    run.narrative = ensureNarrativeActRuntime(run.narrative, definition, 20);
    const actId = run.narrative.actRuntime!.actId;
    const planning = buildNarrativePromptPlan(run, definition, null, "planning")!;
    assert.ok(planning.routeGuidance?.includes((definition as ResolvedNarrativeExperience).storyPack.routePromise));
    const outline = outlineForTest(actId);
    commitNarrativeActOutline(run.narrative, outline);
    for (const task of ["rendering", "decision"] as const) {
      const plan = buildNarrativePromptPlan(run, definition, null, task)!;
      assert.ok(plan.routeGuidance?.includes(outline.beats.setup.change));
      assert.equal(plan.mainlineSkeleton, undefined);
      assert.doesNotMatch(plan.routeGuidance ?? "", /本幕主线职责|本轮执行目标|当前 IF 节拍职责/);
    }
    assert.ok(buildNarrativePromptPlan(run, definition, null, "background")?.routeGuidance?.includes(outline.beats.setup.change));
  }
});

test("三世界的幕任务归属场景工具，纯背景和混合请求保持生活任务独立", async () => {
  for (const worldId of ["ancient", "fantasy", "modern"]) {
    const definition = await loadNarrativeExperienceForTest(worldId);
    const run = makeRun();
    run.worldId = definition.worldId;
    run.narrative.enabled = true;
    run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
    const currentAct = definition.mainlineActs![0];
    const mainlineFact = definition.mainlineFacts?.find((fact) => fact.id === currentAct.factId);
    if (mainlineFact) run.story.factLedger!.facts.push({
      ...mainlineFact, status: "open", sourceEventId: "world", introducedAge: 0, lastTouchedAge: 0
    });
    const [dynamicFactId] = applyNarrativeFactUpdates(run, {
      introduce: [{ kind: "commitment", label: "照料身边患病的亲友" }], touchFactIds: [], resolveFactIds: []
    }, { sourceEventId: "life" });
    const input: DynamicNarrativeSceneInput = {
      act: currentAct,
      beat: "pressure", presentation: "summary", allowedTurnKinds: ["background"],
      sceneAge: 20, backgroundAgeRange: { fromAge: 20, toAge: 22 },
      storyPatterns: definition.storyPatterns!,
      socialForces: definition.socialForces!, knownCharacters: [], attributePolicy: dynamicSceneAttributePolicy(), backgroundAttributePolicy: dynamicSceneAttributePolicy(),
      statTiers: { intelligence: "low", charisma: "low", family: "low", fortune: "low", physique: "low" }
    };
    for (const allowedTurnKinds of [["background"], ["background", "scene"], ["scene"]] as DynamicNarrativeSceneInput["allowedTurnKinds"][]) {
      input.allowedTurnKinds = allowedTurnKinds;
      input.presentation = allowedTurnKinds.includes("background") ? "summary" : "scene";
      const tools = dynamicNarrativeSceneTools(input);
      const ctx = memoryTestContext(run);
      const contextTask = "settlement";
      ctx.narrativePlan = buildNarrativePromptPlan(run, definition, null, contextTask, { backgroundAllowed: allowedTurnKinds.includes("background") });
      const taskPrompt = dynamicNarrativeScenePrompt(input);
      const request = prepareNarrativeOutcomeRequest(run, world, ctx, tools.tools, taskPrompt, { task: ctx.narrativePlan!.task });
      const text = request.history.map((entry) => entry.content).join("\n");
      const routeLore = new Set(definition.lore.filter((entry) => entry.directionIds?.length).map((entry) => entry.text));
      assert.equal(taskPrompt.includes(input.act.prompt), false, "属性结算不携带幕间大纲");
      assert.equal(ctx.narrativePlan!.mainlineSkeleton, undefined);
      assert.ok(!text.includes("不得写结局"));
      assert.ok(ctx.narrativePlan!.activeLore.every((entry) => !routeLore.has(entry)));
      if (allowedTurnKinds.includes("background")) {
        assert.ok(!mainlineFact || !text.includes(mainlineFact.label));
        assert.equal(ctx.narrativePlan!.factDirectory?.some((fact) => fact.id === dynamicFactId), false);
        assert.equal(request.factContract.mutableIds.includes(dynamicFactId), false);
      }
      for (const tool of request.tools) {
        const fn = tool.function as { name: string; description: string; parameters: { properties: Record<string, unknown> } };
        if (fn.name === "resolve_background_outcome") {
          assert.ok(!fn.description.includes(input.act.prompt));
          assert.match(fn.description, /最终正文/);
  assert.match(text, /20-22岁/);
        } else {
          assert.ok(!fn.description.includes(input.act.prompt));
          assert.ok(!fn.description.includes(definition.mainlineSkeleton!.premise));
          assert.equal("routeId" in fn.parameters.properties, false);
        }
      }
    }
  }
});

test("已结束事件退出正文事实，直接事实与本领用途仍可追溯结果", () => {
  const run = makeRun();
  run.age = 40;
  const [factId] = applyNarrativeFactUpdates(run, {
    introduce: [{ kind: "open_question", label: "谁藏着断箭的秘密" }], touchFactIds: [], resolveFactIds: []
  }, { sourceEventId: "old-event" });
  applyNarrativeFactUpdates(run, {
    introduce: [], touchFactIds: [], resolveFactIds: [], resolutions: [{ factId, summary: "双方达成和解，学会御风之术" }]
  }, { sourceEventId: "old-result" });
  run.story.factLedger!.facts[0].resolvedAge = 10;
  for (const id of ["old-a", "old-b"]) commitNarrativeMemory(run.narrative, {
    id, age: 10, text: "你隐隐觉得断箭还有更深秘密", characterIds: ["friend"], factionIds: [], factIds: [factId], abilityIds: ["wind"]
  });
  commitNarrativeMemory(run.narrative, {
    id: "current", age: 40, text: "你与同伴经营新开的茶铺", characterIds: ["friend"], factionIds: [], factIds: []
  });
  const before = structuredClone(run);
  assert.deepEqual(retrieveNarrativeMemories(run, { characterIds: ["friend"] }, 1), ["你与同伴经营新开的茶铺"]);
  assert.deepEqual(retrieveNarrativeMemories(run, { factIds: [factId] }), ["双方达成和解，学会御风之术"]);
  assert.deepEqual(retrieveNarrativeMemories(run, { abilityIds: ["wind"] }, 1), ["双方达成和解，学会御风之术"]);
  assert.deepEqual(retrieveNarrativeMemories(run, { text: "海港装卸" }), []);
  const recalled = selectDynamicNarrativeContext(run, { task: "background", text: "御风之术" });
  assert.deepEqual(recalled.resolvedFacts, []);
  assert.deepEqual(run, before);
});

test("规划读取当前开放事实，正文完整沿用规划选择且不重新评分限额", () => {
  const run = makeRun();
  const ids = applyNarrativeFactUpdates(run, {
    introduce: Array.from({ length: 5 }, (_, index) => ({ kind: "open_question" as const, label: `当前事务${index}` })),
    touchFactIds: [], resolveFactIds: []
  }, { sourceEventId: "current" });
  assert.deepEqual(selectDynamicNarrativeContext(run, { task: "planning" }).facts.map((entry) => entry.id), ids);
  assert.deepEqual(selectDynamicNarrativeContext(run, { task: "background", factIds: ids }).facts.map((entry) => entry.id), ids);
  assert.deepEqual(selectDynamicNarrativeContext(run, { task: "dynamic", backgroundAllowed: true, factIds: ids }).facts.map((entry) => entry.id), ids);
  assert.deepEqual(selectDynamicNarrativeContext(run, { task: "dynamic", factIds: [ids[4]] }).facts.map((entry) => entry.id), [ids[4]]);
  assert.deepEqual(selectDynamicNarrativeContext(run, { task: "background", text: "当前事务" }).facts, []);
  assert.deepEqual(factUpdateContract(run.story.factLedger!.facts.map((fact) => fact.id)).mutableIds, ids);
});

test("事实状态与内容同步提交，已发生结果不进入开放问题目录", () => {
  const run = makeRun();
  const introduced = parseFactUpdates({ introduce: [
    { kind: "commitment", label: "归还借来的书", status: "stay" },
    { kind: "cost", label: "修屋耗去了积蓄", status: "finish" }
  ] }, factUpdateContract([]))!;
  const ids = applyNarrativeFactUpdates(run, introduced, { sourceEventId: "begin" });
  assert.equal(run.story.factLedger!.facts.find((fact) => fact.id === ids[1])?.status, "resolved");
  const contract = factUpdateContract([ids[0], "world:chapter"]);
  const update = parseFactUpdates({ updates: [{ factId: ids[0], status: "finish", summary: "书已归还，借阅的约定履行完毕" }] }, contract)!;
  applyNarrativeFactUpdates(run, update, { sourceEventId: "returned" });
  assert.equal(run.story.factLedger!.facts.find((fact) => fact.id === ids[0])?.resolutionSummary, "书已归还，借阅的约定履行完毕");
  assert.equal(run.story.factLedger!.facts.filter((fact) => fact.status === "open").length, 0);
  assert.throws(() => parseFactUpdates({ updates: [{ factId: "world:chapter", status: "finish", summary: "结束" }] }, contract));
  assert.deepEqual(Object.keys(contract.schema.properties), ["introduce", "updates"]);
});

test("人物离场同步档案、上下文和公开回合，既有快照保持原样", () => {
  const run = makeRun();
  run.narrative.dynamicCharacters.push({
    id: "person:mentor", name: "老师", role: "启蒙者", description: "在村中教书", status: "active",
    importance: "recurring", introducedAge: 4, lastSeenAge: 4, relatedFactIds: [], relatedRouteIds: []
  });
  appendPublicTurnRecord(run, { entryId: "lesson", kind: "passage", age: 4, ageStage: { label: "幼年" }, narrative: "你跟老师读书。", statChanges: {} });
  const earlier = structuredClone(run.turnRecords);
  applyNarrativeRelationshipUpdates(run, parseRelationshipUpdates([{
    characterRef: "person:mentor", stance: "friendly", summary: "仍记得他的教诲", status: "gone", description: "老师已经病故"
  }], ["person:mentor"]));
  appendPublicTurnRecord(run, { entryId: "farewell", kind: "passage", age: 5, ageStage: { label: "幼年" }, narrative: "你送别了老师。", statChanges: {} });
  assert.match(run.turnRecords.at(-1)!.narrativeCharactersSnapshot![0].description!, /已离场/);
  assert.deepEqual(run.turnRecords[0], earlier[0]);
  assert.equal(run.narrative.dynamicCharacters.length, 1);
  assert.match(selectDynamicNarrativeContext(run, { task: "background", characterIds: ["person:mentor"] }).characters[0].description!, /已离场/);
});

test("摘要覆盖随分支归属，已覆盖经历仍能按直接事实引用召回", () => {
  const run = makeRun();
  const round = { id: "memory:covered", user: "一次相识", assistant: "你在渡口结识了舟子" };
  const conversation: ChatConversationState = { systemHash: "world", headCore: "规则", headMemory: "", history: [], archive: [round] };
  const branch = structuredClone(conversation);
  const work = { revision: 0, previousSummary: "", rounds: structuredClone(conversation.archive) };
  assert.ok(applyConversationSummary(conversation, work, "舟子已成为朋友"));
  assert.deepEqual(summarizedConversationMemoryIds(conversation, [round.id, "memory:later"]), [round.id]);
  assert.deepEqual(summarizedConversationMemoryIds(branch, [round.id]), []);
  run.aiConversation = { year: conversation };
  commitNarrativeMemory(run.narrative, { id: round.id, age: 5, text: round.assistant, factIds: ["fact:friend"], characterIds: [], factionIds: [] });
  assert.deepEqual(retrieveNarrativeMemories(run, { text: "渡口舟子" }), []);
  assert.deepEqual(retrieveNarrativeMemories(run, { factIds: ["fact:friend"] }), [round.assistant]);
});

test("普通年份不重复投影长期摘要，只保留当前任务", () => {
  const run = makeRun();
  run.narrative.enabled = true;
  const ctx = memoryTestContext(run);
  const task = interruptedBackgroundTask(run, 0, []);
  prepareNarrativeOutcomeRequest(run, world, ctx, task.tool, task.prompt);
  ctx.conversation!.headMemory = "已安顿好远行的亲人";
  const prepared = prepareNarrativeOutcomeRequest(run, world, ctx, task.tool, "本轮任务标记");
  const input = prepared.history.map((entry) => entry.content).join("\n");
  assert.equal(input.split("已安顿好远行的亲人").length - 1, 0);
  assert.equal(input.split("本轮任务标记").length - 1, 1);
  assert.doesNotMatch(prepared.conversation.headCore, /已安顿好远行的亲人/);
  assert.ok(input.endsWith("本轮任务标记"));
  assert.match(prepared.history[0]!.content, /^【长期设定】/);
  assert.match(prepared.history.at(-1)!.content, /^【当前任务】/);
});

test("上下文编排按来源去重并让 dynamic 只读取近期回合与按需记忆", () => {
  const conversation: ChatConversationState = {
    systemHash: "world", headCore: "规则", headMemory: "此前已经离开故乡", history: [], archive: [],
    summaryThroughMemoryId: "memory:home"
  };
  const composition = composeNarrativeContext({
    task: "dynamic",
    taskPrompt: "场景发生年龄：18岁。可选路线：study、career。",
    conversation,
    plan: {
      task: "dynamic", storyBible: "", styleRules: [], activeLore: ["城中书院与商会并立"], plotEssentials: [], activeThreads: [],
      activeCharacters: ["person:mentor=老师（academy，师长）：曾在故乡教书"], scene: "", authorNote: "", ending: "",
      persona: "谨慎而好学", talents: ["过目不忘：善于整理线索"], origin: "生于河畔小镇",
      factDirectory: [
        { id: "fact:exam", label: "即将参加考试", status: "open" },
        { id: "fact:debt", label: "仍欠一笔人情", status: "open" }
      ],
      recall: {
        assetContext: "",
        assetSources: [{ id: "location:academy", kind: "location", text: "location:academy=城中书院（当前所在）：学舍临河" }],
        characters: [{ id: "person:mentor", name: "老师", factionId: "academy", role: "师长", description: "曾在故乡教书" }],
        facts: [{ id: "fact:exam", label: "待回应的问题：即将参加考试" }],
        resolvedFacts: [],
        memories: ["老师曾在故乡教你识字"],
        memorySources: [{ id: "memory:lesson", text: "老师曾在故乡教你识字" }]
      }
    }
  });
  const selectedSources = composition.manifest.fragments.flatMap((entry) => entry.sourceIds);
  assert.equal(new Set(selectedSources).size, selectedSources.length);
  assert.equal(composition.renderedContext.split("fact:exam").length - 1, 1);
  assert.doesNotMatch(composition.renderedContext, /fact:debt/);
  assert.ok(composition.renderedContext.endsWith("场景发生年龄：18岁。可选路线：study、career。"));
  assert.equal(composition.historyMessages.some((entry) => entry.content.includes("此前已经离开故乡")), false);
  assert.equal(composition.manifest.summaryThroughMemoryId, "memory:home");
});

test("静态前缀不吸收主线运行态，动态世界卡也不伪装成长期设定", () => {
  const basePlan = {
    task: "planning" as const, storyBible: "固定世界切片", actBackground: "已经生成的本幕背景", styleRules: [], activeLore: [], plotEssentials: [], activeThreads: [],
    activeCharacters: [], scene: "", authorNote: "", ending: "", persona: "固定人物", mainlineSkeleton: "当前幕与节拍会变化",
    narrativePaletteContext: { background: "生活调色板", scene: "场景调色板" },
    activeWorldCardSources: [{
      id: "card.dynamic", title: "动态卡", text: "只在本轮召回", placement: "world" as const,
      activationReason: "text:1", activationKind: "direct" as const, stickyTurns: 0, cooldownTurns: 0,
      remainingStickyTurns: 0, remainingCooldownTurns: 0
    }]
  };
  const first = composeNarrativeContext({ task: "planning", taskPrompt: "规划", plan: basePlan });
  const second = composeNarrativeContext({ task: "planning", taskPrompt: "规划", plan: { ...basePlan, mainlineSkeleton: "另一幕运行态" } });
  assert.doesNotMatch(first.stableContext, /当前幕与节拍会变化/);
  assert.match(first.runtimeContext, /当前幕与节拍会变化/);
  assert.doesNotMatch(first.stableContext, /只在本轮召回/);
  assert.match(first.activeContext, /只在本轮召回/);
  assert.equal(first.stableContext, second.stableContext);
  assert.notEqual(first.runtimeContext, second.runtimeContext);
  const background = composeNarrativeContext({ task: "background", taskPrompt: "背景", plan: { ...basePlan, task: "background" as const } });
  assert.match(first.stableContext, /固定世界切片/);
  assert.doesNotMatch(background.stableContext, /固定世界切片/);
  assert.match(background.stableContext, /已经生成的本幕背景/);
  assert.doesNotMatch(first.activeContext, /场景调色板/);
  assert.doesNotMatch(background.activeContext, /生活调色板/);
});

test("原始世界只供幕初组织，正文和普通年沿用生成背景并可取用领域知识", async () => {
  const definition = await loadNarrativeExperienceForTest("fantasy");
  const run = makeRun(); run.worldId = "fantasy"; run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  const initial = buildNarrativePromptPlan(run, definition, null, "planning")!;
  assert.ok(initial.worldCoreContext?.includes(definition.worldCore!.identity));
  assert.ok(initial.activeWorldCardSources?.some((entry) => entry.contextRole === "foundation"));
  const origin = buildNarrativePromptPlan(run, definition, null, "origin")!;
  const originRequest = composeNarrativeContext({ task: "origin", plan: origin, taskPrompt: "写出生时的身世" });
  assert.ok(originRequest.renderedContext.includes(definition.storyBible), "身世仍然知道世界初始局势");
  const outline = outlineForTest(run.narrative.actRuntime!.actId);
  commitNarrativeActOutline(run.narrative, outline);
  for (const task of ["rendering", "background"] as const) {
    const plan = buildNarrativePromptPlan(run, definition, null, task)!;
    const request = composeNarrativeContext({ task, plan, taskPrompt: "写当前年龄" });
    assert.equal(request.stableContext.split(outline.background).length - 1, 1);
    assert.equal(request.renderedContext.includes(definition.worldCore!.identity), false);
    assert.equal(Object.hasOwn(plan, "narrativePaletteContext"), false);
    assert.ok(plan.activeWorldCardSources?.every((entry) => entry.contextRole === "knowledge" || entry.contextRole === "style"));
  }
  const domain = definition.worldCards!.find((entry) => entry.contextRole === "knowledge")!;
  const recalled = buildNarrativePromptPlan(run, definition, null, "rendering", {
    focusIds: [domain.id], worldCardCandidates: [{ id: domain.id, title: domain.title, text: domain.content, contextRole: "knowledge",
      placement: "author_note", activationKind: "direct", activationReason: "selected", stickyTurns: 0, cooldownTurns: 0,
      remainingStickyTurns: 0, remainingCooldownTurns: 0 }]
  })!;
  const knowledgeRequest = composeNarrativeContext({ task: "rendering", plan: recalled, taskPrompt: "写进入新领域后的故事" });
  assert.equal(knowledgeRequest.renderedContext.split(domain.content).length - 1, 1, "已选领域知识不被旧 author_note 位置丢弃");
  assert.ok(knowledgeRequest.manifest.fragments.some((entry) => entry.sourceIds.includes(`world-card:${domain.id}`) && entry.section === "lore"));
});

test("结局任务单独召回世界包结局文风", async () => {
  const definition = await loadNarrativeExperienceForTest("modern");
  const run = makeRun();
  run.worldId = "modern";
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  const plan = buildNarrativePromptPlan(run, definition, null, "ending")!;
  plan.ending = "普通结局：人物完成了这一生的主要选择。";
  const ending = composeNarrativeContext({ task: "ending", taskPrompt: "写人生评价", plan });
  assert.match(ending.renderedContext, /结局文风：以人物最终的生活方式/);
  const planning = composeNarrativeContext({ task: "planning", taskPrompt: "规划下一步", plan: { ...plan, task: "planning" } });
  assert.doesNotMatch(planning.renderedContext, /结局文风/);
});

test("长上下文保留按任务选定的材料与当前任务，估算 token 仅用于观测", () => {
  const activeLore = Array.from({ length: 80 }, (_, index) => `世界知识${index}：${"遥远地区的风俗与传闻".repeat(20)}`);
  const composition = composeNarrativeContext({
    task: "background",
    taskPrompt: "叙述10岁至12岁的生活与成长。",
    plan: {
      task: "background", storyBible: "", styleRules: [], activeLore, plotEssentials: [], activeThreads: [], activeCharacters: [],
      scene: "", authorNote: "", ending: "", persona: "一个正在成长的人"
    }
  });
  assert.deepEqual(composition.manifest.droppedFragmentIds, []);
  assert.equal(composition.manifest.fragments.filter((entry) => entry.id.startsWith("recall:lore:")).length, activeLore.length);
  assert.ok(composition.manifest.totalEstimatedTokens > 3600);
  assert.ok(activeLore.every((text) => composition.renderedContext.includes(text)));
  assert.ok(composition.manifest.fragments.some((entry) => entry.id === "task:current" && entry.required));
  assert.ok(composition.renderedContext.endsWith("叙述10岁至12岁的生活与成长。"));
});

test("选定 IF 路线后渲染工具只接收当前社会力量和呈现类型", async () => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  const force = definition.socialForces![1];
  const input: DynamicNarrativeSceneInput = {
    plan: {
      callId: "call:one", turnKind: "scene", patternIds: [], forceIds: [force.id],
      conflictRefs: [], abilityRefs: [], locationDirective: { mode: "stay" },
       presentation: "scene", clockRequest: "advance"
    },
    act: definition.mainlineActs![0], beat: "setup", presentation: "scene", allowedTurnKinds: ["scene"],
    sceneAge: 16, backgroundAgeRange: { fromAge: 16, toAge: 17 },
    storyPatterns: definition.storyPatterns!,
    socialForces: definition.socialForces!, knownCharacters: [],
    attributePolicy: dynamicSceneAttributePolicy(), backgroundAttributePolicy: dynamicBackgroundAttributePolicy(makeRun()),
    statTiers: { intelligence: "steady", charisma: "steady", family: "steady", fortune: "steady", physique: "steady" }
  };
  const tools = dynamicNarrativeSceneTools(input);
  assert.deepEqual(tools.names, ["resolve_scene_outcome"]);
  const fn = tools.tools[0]!.function as { parameters: { properties: Record<string, unknown> } };
  assert.equal("routeId" in fn.parameters.properties, false);
  assert.equal("factionId" in fn.parameters.properties, false);
  assert.doesNotMatch(dynamicNarrativeScenePrompt(input), new RegExp(force.methods[0]!));
});

test("选定 IF 路线固定在本局前提中，正文不重复注入摘要而观察器只读当前幕摘要", async () => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  const run = makeRun();
  run.worldId = "ancient";
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  const forceId = definition.socialForces![0]!.id;
  const currentActId = run.narrative.actRuntime!.actId;
  run.narrative.memoryDigests = [
    { id: "route:obsolete", scope: "route", scopeId: "obsolete", revision: 1, throughEpisodeId: "episode:one", coveredEpisodeIds: [], summary: "不属于当前 IF 路线的旧摘要。", activeFactIds: [], historicalFactIds: [], characterIds: [], updatedAt: 1 },
    { id: `faction:${forceId}`, scope: "faction", scopeId: forceId, revision: 1, throughEpisodeId: "episode:one", coveredEpisodeIds: [], summary: "朝廷此前以任免施加压力。", activeFactIds: [], historicalFactIds: [], characterIds: [], updatedAt: 1 },
    { id: `act:${currentActId}`, scope: "act", scopeId: currentActId, revision: 1, throughEpisodeId: "episode:one", coveredEpisodeIds: [], summary: "当前幕已经从操练推进到第一次边地冲突。", activeFactIds: [], historicalFactIds: [], characterIds: [], updatedAt: 1 }
  ];
  const planning = buildNarrativePromptPlan(run, definition, null, "planning")!;
  assert.equal((planning.memoryDigests ?? []).some((entry) => entry.id === "route:obsolete"), false);
  assert.match(planning.routeGuidance ?? "", /人物将从自身处境进入天下乱局/);
  const rendering = buildNarrativePromptPlan(run, definition, null, "rendering", { patternIds: [], factionIds: [forceId] })!;
  assert.deepEqual(rendering.memoryDigests ?? [], []);
  const horizon = buildNarrativePromptPlan(run, definition, null, "horizon")!;
  assert.equal(horizon.memoryDigests, undefined, "旧分层摘要不再成为第二份故事背景");
});

test("旧 Horizon 状态不再影响规划召回，当前 Planner 查询独立决定素材", async () => {
  const base = await loadNarrativeExperienceForTest("fantasy");
  const definition = {
    ...base,
    worldCards: [...(base.worldCards ?? []), {
      id: "test.horizon", kind: "motif", content: "残阵会改变眼前局势。", priority: 100,
      activation: { keys: ["玄衡印"], tasks: ["planning"] }
    }]
  } as ResolvedNarrativeExperience;
  const run = makeRun();
  run.worldId = "fantasy";
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);

  const runtime = run.narrative.actRuntime!;
  run.narrative.horizonPlan = {
    id: `horizon:${runtime.actId}:1`, actId: runtime.actId, revision: 1,
    dramaticQuestion: "如何前进", developingTension: "灵力传承正在显露代价",
    intents: [{ id: `horizon:${runtime.actId}:1:intent:1`, goal: "理解玄衡印留下的痕迹", status: "active" }], focusRefs: [], payoffShape: "人物形成自己的答案",
    status: "active", createdAt: 1
  };
  run.narrative.lastBeatObservation = { decision: "hold", actId: runtime.actId, beat: runtime.beat, createdAt: 1 };
  const planning = buildNarrativePromptPlan(run, definition, null, "planning")!;
  assert.equal(planning.authorNote, "");
  assert.equal(planning.activeWorldCardSources?.some((entry) => entry.id === "test.horizon"), false);
  const focused = buildNarrativePromptPlan(run, definition, null, "planning", { semanticQuery: "玄衡印" })!;
  assert.equal(focused.activeWorldCardSources?.some((entry) => entry.id === "test.horizon"), true);
  assert.equal(buildNarrativePromptPlan(run, definition, null, "rendering")?.authorNote, "");
  run.narrative.lastBeatObservation = { ...run.narrative.lastBeatObservation!, decision: "advance" };
  assert.equal(buildNarrativePromptPlan(run, definition, null, "planning")?.authorNote, "");
});

test("幕间能力目录直接表达背景、场景与抉择边界", () => {
  assert.deepEqual(narrativeTurnKindsForReadiness(true, true), ["background"]);
  assert.deepEqual(narrativeTurnKindsForReadiness(false, false), ["background"]);
  assert.deepEqual(narrativeTurnKindsForReadiness(false, true), ["scene"]);
  assert.deepEqual(narrativeTurnCapabilities(true, "setup", ["background"]), ["background"]);
  assert.deepEqual(narrativeTurnCapabilities(false, "setup", ["scene"]), ["scene", "choice"]);
  assert.deepEqual(narrativeTurnCapabilities(false, "escalation", ["background", "scene"]), ["background", "scene", "choice"]);
  assert.deepEqual(narrativeTurnCapabilities(false, "pressure", ["background", "scene"]), ["background", "scene", "choice"]);
  assert.deepEqual(narrativeTurnCapabilities(false, "climax", ["scene"]), ["scene", "choice"]);
  assert.deepEqual(narrativeTurnCapabilities(false, "payoff", ["background", "scene"]), ["background", "scene", "choice"]);
});

test("规划工具目录与能力目录使用同一协议，不再暴露返回后会被拒绝的呈现", () => {
  const envelope: NarrativeTurnEnvelope = {
    callId: "turn:contract", source: "scene", worldId: "ancient", currentAge: 20,
    backgroundAgeRange: { fromAge: 21, toAge: 22 }, act: { id: "act.one", label: "第一幕", prompt: "推进本幕" },
    beat: "payoff", capabilities: ["background", "scene"],
    storyPatterns: [{ id: "pattern.a", label: "经历", summary: "人物经历" }],
    socialForces: [{ id: "force.a", label: "力量", summary: "相关人物" }],
    focusReferences: [],
    statTiers: { intelligence: "steady", charisma: "steady", family: "steady", fortune: "steady", physique: "steady" },
    clock: { mode: "advance", sameAgeTurnCount: 0, maxSameAgeTurns: 3 }
  };
  const tools = narrativeTurnPlanTools({ ...envelope, actOutline: outlineForTest(envelope.act.id) }).map((tool) => tool.function as {
    name: string; parameters: { required: string[]; properties: Record<string, unknown> }
  });
  assert.deepEqual(tools.map((tool) => tool.name), ["plan_scene_turn"]);
  assert.deepEqual(narrativeTurnPlanTools({ ...envelope, actOutline: outlineForTest(envelope.act.id), source: "background", capabilities: ["background"] }), [], "普通年份不进入规划请求");
  assert.ok(!tools.some((tool) => tool.name === "plan_choice_turn"));
  const scene = tools.find((tool) => tool.name === "plan_scene_turn")!;
  assert.equal(scene.parameters.required.includes("patternIds"), false);
  assert.equal("patternIds" in scene.parameters.properties, false);
  assert.ok(scene.parameters.required.includes("forceIds"));
  assert.equal("presentation" in scene.parameters.properties, false);
  const planningPrompt = narrativeTurnPlanningPrompt(envelope);
  assert.doesNotMatch(planningPrompt, /调用plan_/);
  assert.match(narrativeTaskContract("planning").systemInstruction, /幕内.*召回.*交接时间/);
});

test("叙事事务失败不发布半成品，成功后 Episode 与幕结果只保存引用", async () => {
  const run = makeRun();
  const beforeAge = run.age;
  await assert.rejects(() => runNarrativeTurnTransaction(run, async (working) => {
    working.age += 3;
    working.history.push({ age: working.age, title: "未提交", summary: "不应留下", statChanges: {}, tags: [] });
    throw new Error("render_failed");
  }));
  assert.equal(run.age, beforeAge);
  assert.equal(run.history.some((entry) => entry.title === "未提交"), false);

  const sourceEventId = "dynamic:act.one:payoff:20:1";
  commitNarrativeMemory(run.narrative, {
    id: `memory:${sourceEventId}`, age: 20, routeId: "route.one", factionIds: ["faction.one"],
    characterIds: ["character.one"], factIds: ["fact.one"], locationIds: ["location.one"], abilityIds: ["ability.one"],
    text: "完整正文仍由既有记忆保存。"
  });
  const episode = commitNarrativeEpisode(run, {
    callId: "call:episode", sourceEventId, turnKind: "scene", ageFrom: 19, age: 20,
    actId: "act.one", beat: "payoff", routeId: "route.one", factionId: "faction.one"
  });
  commitNarrativeActCanon(run, { actId: "act.one", sourceEventId, resolvedAge: 20, routeId: "route.one" });
  assert.deepEqual(episode.memoryIds, [`memory:${sourceEventId}`]);
  assert.equal("text" in episode, false);
  const recall = buildNarrativeStoryHistory(run.narrative);
  assert.ok(recall.episodes.some((entry) => entry.sourceEventId === sourceEventId));
  assert.equal(run.narrative.actCanon[0].sourceEventId, sourceEventId);
});

test("异步记忆整理只覆盖已提交 Episode，并以 revision 原子提交", () => {
  const run = makeRun();
  run.ended = true;
  run.aiConversation = {
    year: {
      systemHash: "world", headCore: "规则", headMemory: "", history: [], summaryRevision: 0,
      archive: []
    }
  };
  for (let index = 0; index < 4; index += 1) {
    const sourceEventId = `background:${index}`;
    const memoryId = `memory:${sourceEventId}`;
    commitNarrativeMemory(run.narrative, {
      id: memoryId, age: index + 1, factionIds: [], characterIds: [], factIds: [], text: `第${index + 1}段已经发生的生活。`
    });
    commitNarrativeEpisode(run, { callId: `call:${index}`, sourceEventId, turnKind: "background", age: index + 1, actId: "act.one", beat: "setup" });
    run.aiConversation.year!.archive.push({ id: memoryId, user: `第${index + 1}年`, assistant: `第${index + 1}段已经发生的生活。` });
  }
  const work = prepareNarrativeMemoryCuration(run)!;
  assert.equal(work.episodeIds.length, 4);
  assert.equal(applyNarrativeMemoryCuration(run, work, { summary: "人物在四年生活中逐渐成长。" }), true);
  assert.equal(run.narrative.memoryRevision, 1);
  assert.equal(run.narrative.memoryDigests.find((entry) => entry.id === "run")?.coveredEpisodeIds.length, 4);
  assert.equal(run.aiConversation.year?.headMemory, "人物在四年生活中逐渐成长。");
  assert.equal(run.aiConversation.year?.archive.length, 0);
  assert.equal(applyNarrativeMemoryCuration(run, work, { summary: "" }), false);
});

test("身世实际进入压缩输入并随摘要替代，人物设定与当前幕职责仍各自保留", async () => {
  const base = await loadNarrativeWorldDefinition("ancient");
  assert.ok(base);
  const pack = await loadNarrativeStoryPack(base, "ancient.frontier-commander");
  assert.ok(pack);
  const definition = resolveNarrativeExperience(base, pack);
  const run = makeRun();
  run.worldId = "ancient"; run.age = 20; run.ended = true;
  run.storyPackSnapshot = pack;
  run.personaPrompt = "遇事先保护同袍的斥候";
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, 20);
  run.narrative.actRuntime!.beat = "pressure";
  const actId = run.narrative.actRuntime!.actId;
  run.narrative.opening = { status: "ready", profile: { summary: "父母在边镇驿站谋生，他出生在烽燧旁。", seedHints: [] } };
  const origin = commitNarrativeEpisode(run, { callId: "origin", sourceEventId: "origin", turnKind: "origin", age: 0 });
  const old = commitNarrativeEpisode(run, { callId: "old", sourceEventId: "old", turnKind: "scene", actId, beat: "setup", age: 18, storyDelta: "你跟随巡防队学会骑射，被编入斥候队。" });
  // Old saves may claim coverage of the empty origin episode without having supplied its profile.
  run.narrative.memoryDigests = [{ id: "run", format: "effective_facts", scope: "run", revision: 1,
    throughEpisodeId: origin.id, coveredEpisodeIds: [origin.id], summary: "你在边镇长大。", activeFactIds: [], historicalFactIds: [], characterIds: [], updatedAt: 1 }];
  const compose = (current: typeof run, task: "planning" | "rendering" | "decision") => composeNarrativeContext({
    task, taskPrompt: "继续当前经历", plan: buildNarrativePromptPlan(current, definition, null, task)
  });
  assert.equal(compose(run, "planning").renderedContext.split(run.narrative.opening.profile!.summary).length - 1, 1);
  const work = prepareNarrativeMemoryCuration(run)!;
  const prompt = memoryCurationPrompt(work);
  assert.equal(work.origin?.summary, run.narrative.opening.profile!.summary);
  assert.equal(prompt.split(work.origin!.summary).length - 1, 1);
  assert.doesNotMatch(prompt, /当前幕组织背景|阶段目标/);
  const summary = "边镇驿站的家境使你熟悉烽燧和行旅；随巡防队掌握骑射后成为斥候，开始以同袍安危决定自己的军中立场。";
  assert.equal(applyNarrativeMemoryCuration(run, work, parseNarrativeMemoryCuration({ summary }, work)), true);
  run.narrative = ensureNarrativeRunState(JSON.parse(JSON.stringify(run.narrative)), true, 20);
  assert.equal(run.narrative.memoryDigests.find((entry) => entry.id === "run")?.originCovered, true);
  for (const task of ["planning", "rendering", "decision"] as const) {
    const input = compose(run, task);
    assert.equal(input.renderedContext.split(summary).length - 1, 1);
    assert.equal(input.manifest.fragments.some((entry) => entry.sourceType === "origin"), false);
    assert.equal(input.renderedContext.includes("你跟随巡防队学会骑射，被编入斥候队。"), false);
    assert.equal(input.renderedContext.includes(definition.worldCore!.laws[0]), task === "planning");
    assert.equal(input.renderedContext.includes("已加入巡防队并成为斥候，当前战事尚待应对。"), false, "幕摘要由观察器消费，不与人生摘要重复注入正文");
  }
  const prepared = prepareNarrativeOutcomeRequest(run, world, {
    ...memoryTestContext(run), narrativePlan: buildNarrativePromptPlan(run, definition, null, "decision")
  }, narrativeDecisionRenderTool(), "写选择结果", { task: "decision" });
  assert.ok(prepared.history.some((message) => message.content.includes(run.personaPrompt)), "人物设定在角色档案中");
  assert.equal(prepared.history.map((message) => message.content).join("\n").split(summary).length - 1, 1);
  assert.equal(run.narrative.memoryDigests.length, 1, "压缩只维护一份人物经历");
});

test("已提交正文经恢复进入带年龄的压缩输入，正文不再产生第二份进展摘要", () => {
  const run = makeRun(); run.ended = true;
  for (let index = 1; index <= 3; index++) {
    const source = `prose:${index}`;
    commitNarrativeMemory(run.narrative, { id: `memory:${source}`, age: index, factionIds: [], characterIds: [], factIds: [], text: `人物完成第${index}次巡行的实际正文。` });
    commitNarrativeEpisode(run, { callId: source, sourceEventId: source, turnKind: "scene", actId: "act.one", age: index });
  }
  run.narrative = ensureNarrativeRunState(JSON.parse(JSON.stringify(run.narrative)), true);
  assert.ok(run.narrative.episodes.every((entry) => entry.storyDelta === undefined));
  assert.deepEqual(recentCommittedNarrativeChanges(run.narrative), [1, 2, 3].map((age) => `${age}岁：\n人物完成第${age}次巡行的实际正文。`));
  const work = prepareNarrativeMemoryCuration(run)!;
  assert.deepEqual(["run"], ["run"]);
  assert.deepEqual(work.episodes.map(({ age, narrative }) => ({ age, narrative })),
    [1, 2, 3].map((age) => ({ age, narrative: `人物完成第${age}次巡行的实际正文。` })));
  const prompt = memoryCurationPrompt(work);
  assert.ok(prompt.includes("3岁：") && prompt.includes("第3次巡行的实际正文"));
  assert.equal(applyNarrativeMemoryCuration(run, work, { summary: "巡行经历使人物熟悉山口与军中生活。" }), true);
  assert.equal(prepareNarrativeMemoryCuration(run), undefined);
});

test("异步整理期间已完成事实不会被摘要引用重新开放", () => {
  const run = makeRun();
  run.ended = true;
  const [factId] = applyNarrativeFactUpdates(run, { introduce: [{ kind: "open_question", label: "援军抵达" }], touchFactIds: [], resolveFactIds: [] }, { sourceEventId: "start" });
  for (let i = 0; i < 3; i++) commitNarrativeEpisode(run, { callId: `async:${i}`, sourceEventId: `async:${i}`, turnKind: "scene", age: i, storyDelta: "等待援军" });
  const work = prepareNarrativeMemoryCuration(run)!;
  applyNarrativeFactUpdates(run, { introduce: [], touchFactIds: [], resolveFactIds: [], resolutions: [{ factId, summary: "援军已经抵达" }] }, { sourceEventId: "done", actId: "act.one" });
  const result = { summary: "援军改变了守关处境。" };
  assert.equal(applyNarrativeMemoryCuration(run, work, result), true);
  assert.deepEqual(run.narrative.memoryDigests[0].activeFactIds, []);
  assert.deepEqual(run.narrative.memoryDigests[0].historicalFactIds, []);
  assert.equal(run.story.factLedger!.facts[0].status, "resolved");
});

test("不足十年的变化留在未压缩正文，幕收束可提前整理", () => {
  const run = makeRun();
  for (let i = 0; i < 2; i++) commitNarrativeEpisode(run, { callId: `batch:${i}`, sourceEventId: `batch:${i}`, turnKind: "scene", age: 9, actId: "act.one", beat: "payoff", storyDelta: `本幕变化${i}` });
  assert.equal(prepareNarrativeMemoryCuration(run), undefined);
  assert.equal(buildNarrativeStoryHistory(run.narrative).episodes.length, 2);
  commitNarrativeActCanon(run, { actId: "act.one", sourceEventId: "batch:1", resolvedAge: 9 });
  const work = prepareNarrativeMemoryCuration(run)!;
  assert.ok(work.episodes.some((episode) => episode.narrative.includes("本幕变化1")));
  assert.equal(work.episodeIds.length, 2);
});

test("记忆摘要不直接进入规划、观察器或正文任务", () => {
  const plan = {
    storyBible: "", styleRules: [], activeLore: [], plotEssentials: [], activeThreads: [],
    activeCharacters: [], scene: "", authorNote: "", ending: "",
    memoryDigests: [{ id: "ability:seal", text: "封息诀已能遮蔽行迹。", sourceIds: ["ability:seal"] }]
  };
  for (const task of ["planning", "horizon", "rendering", "dynamic", "decision", "background", "settlement"] as const) {
    const composition = composeNarrativeContext({ task, taskPrompt: "规划下一段经历。", plan: { ...plan, task } });
    assert.doesNotMatch(composition.renderedContext, /封息诀已能遮蔽行迹/);
  }
});

test("已进入长期摘要的回合不会在会话窗口滚动时重新归档", () => {
  const conversation: ChatConversationState = {
    systemHash: "hash", headCore: "system", headMemory: "前两段已经摘要", archive: [],
    summarizedMemoryIds: ["memory:0", "memory:1"],
    history: Array.from({ length: 4 }, (_, index) => [
      { role: "user" as const, content: `第${index}段输入`, turnId: `memory:${index}` },
      { role: "assistant" as const, content: `第${index}段正文` }
    ]).flat()
  };
  keepRecentConversationRounds(conversation, 2);
  assert.deepEqual(conversation.archive, []);
  assert.equal(conversation.history.length, 4);
});

test("零回合窗口不投射任何历史消息", () => {
  const conversation: ChatConversationState = {
    systemHash: "hash", headCore: "system", headMemory: "已经压缩的旧经历", archive: [],
    history: [
      { role: "user", content: "上一轮输入", turnId: "memory:previous" },
      { role: "assistant", content: "上一轮正文" }
    ]
  };
  assert.deepEqual(buildConversationPromptMessages(conversation, {
    includeHeadMemory: false,
    includeArchive: false,
    recentRoundLimit: 0,
    requiredRecentRounds: 0
  }), []);
});

test("审校与连续性任务不继承会话历史或无关召回层", () => {
  const run = makeRun();
  const ctx = memoryTestContext(run);
  ctx.conversation = {
    systemHash: "old", headCore: "旧规则", headMemory: "旧摘要", archive: [],
    history: [
      { role: "user", content: "旧输入", turnId: "memory:old" },
      { role: "assistant", content: "旧正文" }
    ]
  };
  const tool = {
    type: "function", function: {
      name: "isolated_task", description: "隔离任务",
      parameters: { type: "object", additionalProperties: false, properties: {} }
    }
  };
  for (const task of ["settlement", "continuity"] as const) {
    const prepared = prepareNarrativeOutcomeRequest(run, world, structuredClone(ctx), structuredClone(tool), "只处理当前输入", { task });
    assert.equal(prepared.history.some((entry) => /旧输入|旧正文|旧摘要/.test(entry.content)), false);
    assert.equal(prepared.contextManifest.historyMessageCount, 0);
  }
});

test("世界卡按当前任务、节拍和情景动态召回，不依赖固定路线", async () => {
  const definition = await loadNarrativeExperienceForTest("fantasy");
  const run = makeRun();
  run.worldId = "fantasy";
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  run.narrative.actRuntime!.beat = "pressure";
  const selected = selectNarrativeWorldCards(run, definition, {
    task: "rendering",
    actId: "fantasy.growth_and_encounter",
    beat: "pressure",
    text: "诡异的雾正迫使众人决定是否进入禁区。"
  });
  assert.ok(selected.some((card) => card.id === "fantasy.rule.power_has_trace"));
  assert.ok(selected.some((card) => card.id === "fantasy.setting.weird_ecology"));
  assert.ok(selected.some((card) => card.id === "fantasy.example.choice"));
  assert.equal(selected.some((card) => card.id === "fantasy.example.payoff"), false);
});

test("IF 路线全部适用素材进入候选，当前语义继续补充召回", async () => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  const run = makeRun();
  run.worldId = "ancient";
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  const act = (definition as ResolvedNarrativeExperience).storyPack.acts.find((entry) => entry.id === run.narrative.actRuntime?.actId);
  assert.ok(act);
  const keyedCard = (definition.worldCards ?? []).find((card) =>
    act.worldCardRefs?.includes(card.id) &&
    (card.activation?.keys ?? []).some((key) => key.trim().length > 1) &&
    (!card.activation?.tasks?.length || card.activation.tasks.includes("planning"))
  );
  assert.ok(keyedCard);
  const trigger = keyedCard.activation!.keys!.find((key) => key.trim().length > 1)!;
  const selectedWithoutTrigger = selectNarrativeWorldCards(run, definition, {
    task: "planning", actId: act.id, preferredCardIds: act.worldCardRefs, text: "平静的一日"
  });
  const selectedAnchorIds = selectedWithoutTrigger.filter((card) => act.worldCardRefs?.includes(card.id)).map((card) => card.id);
  assert.ok(selectedAnchorIds.length >= 1);
  const eligibleAnchors = act.worldCardRefs!.filter((id) => {
    const card = definition.worldCards!.find((entry) => entry.id === id)!;
    return !card.activation?.tasks?.length || card.activation.tasks.includes("planning");
  });
  assert.deepEqual(new Set(selectedAnchorIds), new Set(eligibleAnchors));
  const plan = buildNarrativePromptPlan(run, definition, null, "planning", { semanticQuery: trigger });
  assert.ok(plan);
  assert.ok(plan.activeWorldCardSources?.some((entry) => entry.id === keyedCard.id));
  assert.equal(plan.storyBible, definition.storyBible);
  assert.notEqual(plan.storyBible, definition.worldCore?.identity);
});

test("单字不构成语义命中，显式路线锚点仍可冷启动", async () => {
  const base = await loadNarrativeExperienceForTest("fantasy");
  const definition: NarrativeWorldDefinition = {
    ...base,
    worldCards: [{
      id: "test.contract", kind: "conflict", content: "契约与因果债。", priority: 90,
      activation: { keys: ["欠", "因果债"], tasks: ["planning"] }
    }]
  };
  const run = makeRun();
  run.worldId = "fantasy";
  run.narrative.enabled = true;
  assert.equal(selectNarrativeWorldCards(run, definition, {
    task: "planning", text: "邻人还欠一罐苦汤"
  }).length, 0);
  assert.equal(selectNarrativeWorldCards(run, definition, {
    task: "planning", text: "邻人还欠一罐苦汤", preferredCardIds: ["test.contract"]
  })[0]?.id, "test.contract");
  const matched = selectNarrativeWorldCards(run, definition, {
    task: "planning", text: "旧日因果债在此刻找上门", preferredCardIds: ["test.contract"]
  });
  assert.equal(matched[0]?.id, "test.contract");
});

test("世界卡会扫描当前场景文本并按选择逻辑激活", async () => {
  const definition = await loadNarrativeExperienceForTest("fantasy");
  const run = makeRun();
  run.worldId = "fantasy";
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  const selected = selectNarrativeWorldCards(run, definition, {
    task: "dynamic",
    actId: "fantasy.growth_and_encounter",
    beat: "pressure",
    routeId: "fantasy.guardian",
    text: "山雾里接连有人失踪，留下无法辨认的祭痕。",
    recentTexts: ["此前众人只把异象当成寻常山风。"]
  });
  assert.ok(selected.some((card) => card.id === "fantasy.setting.weird_ecology"));
  assert.equal(selected.some((card) => card.id === "fantasy.practice.combat_exchange"), false);
});


test("短程计划在节拍推进后失效，上下文 Provider 保持显式顺序", async () => {
  const run = makeRun();
  const definition = await loadNarrativeExperienceForTest("ancient");
  run.worldId = definition.worldId;
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  const actId = run.narrative.actRuntime!.actId;
  run.narrative.horizonPlan = {
    id: `horizon:${actId}:1`, actId, revision: 1, dramaticQuestion: "人物将如何应对",
    developingTension: "关系正在变化", intents: [
      { id: `horizon:${actId}:1:intent:1`, goal: "观察变化", status: "active" },
      { id: `horizon:${actId}:1:intent:2`, goal: "面对代价", status: "active" }
    ], focusRefs: [],
    payoffShape: "形成阶段结果", status: "active", createdAt: 1
  };
  const advanced = advanceNarrativeActBeat(run.narrative, definition, run.age);
  assert.equal(advanced.state.horizonPlan?.status, "stale");
  assert.equal(advanced.state.actRuntime?.beat, "escalation");
  advanced.state.actRuntime!.beat = "payoff";
  const nextAct = advanceNarrativeActBeat(advanced.state, definition, run.age);
  assert.equal(nextAct.state.horizonPlan?.status, "stale");
  assert.notEqual(nextAct.state.actRuntime?.actId, actId);
  assert.deepEqual(defaultNarrativeContextProviders.map((provider) => provider.id), [
    "legacy-plan", "stable-character", "story-runtime", "world-cards", "world-lore", "characters", "current-protagonist", "story-history", "facts",
    "narrative-assets", "narrative-memory", "ending", "current-task"
  ]);
  const horizon = narrativeHorizonTool({
    callId: "horizon:one", worldId: "test-world", act: { id: "act.one", label: "第一幕", prompt: "展开第一幕" },
    beat: "setup", storyPatterns: [{ id: "pattern.one", label: "形态", summary: "一种故事形态" }],
    socialForces: [{ id: "force.one", label: "力量", summary: "一种社会立场" }], focusReferences: [],
    previousCanon: [], memoryDigests: [], nextRevision: 1
  }).function as { parameters: { properties: Record<string, unknown> } };
  assert.equal("routeId" in horizon.parameters.properties, false);
  assert.equal("allowedRouteIds" in horizon.parameters.properties, false);

});

test("任务契约将正文登记、资产详情维护和判断分开", () => {
  assert.equal(narrativeTaskContract("planning").identity, "planner");
  assert.equal(narrativeTaskContract("settlement").identity, "adjudicator");
  assert.equal(narrativeTaskContract("rendering").usesNarratorVoice, true);
  for (const task of ["rendering", "decision", "background"] as const) {
    const text = narrativeTaskContract(task).systemInstruction;
    assert.match(text, /仅登记 ID 与名称/);
    assert.match(text, /assetActivity/);
    assert.doesNotMatch(text, /storyDelta|continuityRefs|factUpdates/);
  }
  assert.match(narrativeTaskContract("continuity").systemInstruction, /状态/);
  assert.equal(narrativeTaskContract("curation").identity, "curator");
  const tool = { type: "function", function: { name: "test_task_contract", description: "测试任务身份",
    parameters: { type: "object", additionalProperties: false, properties: {} } } };
  const run = makeRun();
  const prepared = prepareNarrativeOutcomeRequest(run, world, memoryTestContext(run), tool, "写故事", { task: "rendering" });
  assert.ok(prepared.conversation.headCore.includes(narrativeTaskContract("rendering").systemInstruction));
  const planner = prepareNarrativeOutcomeRequest(run, world, memoryTestContext(run), tool, "组织故事", { task: "planning" });
  assert.ok(!planner.conversation.headCore.includes(narrativeTaskContract("rendering").systemInstruction));
});



test("完整模型文本经登记、恢复和下轮请求保留能力边界与幕间结果", async (t) => {
  const run = makeRun(); run.narrative.enabled = true;
  const description = [
    "家族世代居住在山口渡口，往来船队在这里补给，父亲护送商旅，母亲在院中替邻人缝补冬衣。",
    "渡口有两条进出山地的道路，一条沿河岸通向旧营，另一条穿过密林抵达邻镇；暴雨时沿河道路常被山洪截断。",
    "旧营守军依靠渡口转运粮食和药材，熟悉当地道路的人能够辨认水位、天气与不同队伍留下的痕迹。",
    "沿河石桥只能容一辆车通过，山道又有数处险坡，护送队伍必须判断载重和时辰，在安全地带等待后续车辆。",
    "夜间巡行要观察火光、犬吠和林间的异常声响，先判断是否有人接近，再决定发出信号还是掩护同伴离开。",
    "这类经验适合辨认小队活动留下的痕迹，并不能单凭一处脚印判断整支军队的兵力；河水上涨也会抹去旧迹。",
    "当地不同营地使用的号灯并不相同，遇到陌生信号要先确认来源，不能把一个方向上的火光直接当成援军。",
    "长期巡行形成了对路径、遮蔽物和声音来源的辨别能力；雨夜能见度下降时，需要靠地形与同伴约定的信号配合。",
    "判断可以帮助队伍避开暴露的路段，在熟悉的地形中寻找掩护，但无法替代正面战斗，也不保证所有人都能安全撤离。",
    "巡防队在风雨中会分出前哨与后卫，前哨确认路面是否能够通行，后卫照看落后的车辆，双方依靠约定的哨音保持联系。",
    "遭遇突发阻截时，辨踪能够提示可能的敌人来向，却无法判断对方是否留有埋伏；指挥者仍须依据队伍的疲劳与补给作出取舍。",
    "踏入陌生地区后，过去对山口地形的熟悉不再直接适用，必须先向当地向导确认路径，再通过实际巡行建立新的空间认识。",
    "同一条道路在冬夏两季有不同的风险，冻土让车轮容易打滑，涨水则可能淹没旧桥，因此地图之外还要保留季候变化的经验。",
    "队伍能够把亲历的道路变化告诉后来者，已完成的护送无需再次追述，实际留下的能力才是面对新问题时可以继续运用的积累。",
    "可在夜战中分辨友军信号，掩护同伴撤离。"
  ].join("");
  assert.ok(description.length > 480);
  const narrative = `${description}\n\n渡口的日常由河水与季候决定，一场雨可以让赶路的人暂住数日，也让院中的炉火和留宿的客人变得熟悉。河水上涨时，船工会把绳索移到高处，院里的人则准备更多柴火，替滞留的旅人留出遮雨的地方。`;
  assert.ok(narrative.length > 800);
  const scripts = [
    { name: "render_origin", args: { narrative, summary: description, seedHints: [description], participants: [
      { characterRef: "new", name: "林渡", role: "护送商旅的父亲", description, recurring: true, relationship: { stance: "friendly", summary: description } }
    ], assetUpdates: { locations: [{ ref: "new", name: "山口渡口", description, spatialDescription: "山口河道边的渡船码头", current: true }], abilities: [] } } }
  ];
  const checkSchema = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node.type === "string") { assert.equal(node.maxLength, undefined); assert.ok(node.minLength === undefined || node.minLength === 1); }
    for (const child of Object.values(node)) checkSchema(child);
  };
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string; parameters: unknown } }> }) => {
    const step = nextNarrativeScript(scripts, payload); assert.ok(step);
    assert.ok(payload.tools.some((tool) => tool.function.name === step.name));
    checkSchema(payload.tools[0].function.parameters);
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [
      { id: step.name, type: "function", function: { name: step.name, arguments: JSON.stringify(step.args) } }
    ] } }] };
  });
  const ctx = { ...memoryTestContext(run), apiKey: "not-sent" };
  const origin = await generateNarrativeOrigin(run, world, ctx);
  assert.equal(origin.narrative, narrative);
  assert.deepEqual(origin.profile, { summary: description, seedHints: [description] });
  run.narrative.opening = { status: "ready", profile: origin.profile };
  registerNarrativeParticipants(run, origin.participants!.map((entry) => ({ ...entry, role: "护送商旅的父亲", description, relationship: { stance: "friendly", summary: description } })), "origin:full");
  assert.equal(run.narrative.dynamicCharacters.length, 1);
  const updates = { ...origin.assetUpdates!, abilities: [
    { ref: "new", name: "夜行辨踪", description, usage: "可在夜战中分辨友军信号，掩护同伴撤离；无法替代正面战斗。", source: "随队巡行", mastery: "熟练" }
  ] };
  const registered = applyNarrativeAssetUpdates(run.narrative.assets, updates, { age: 18 }, true);
  const assets = applyNarrativeAssetUpdates(registered.assets, { locations: [{ ref: registered.locationIds[0], description,
    spatialDescription: "山口河道边的渡船码头" }], abilities: [] }, { age: 18 });
  const links = commitNarrativeAssets(run.narrative, { ...assets, locationIds: registered.locationIds, abilityIds: registered.abilityIds }, { age: 18 }, {}, "full:asset");
  const [factId] = applyNarrativeFactUpdates(run, { introduce: [{ kind: "commitment", label: description }], touchFactIds: [], resolveFactIds: [] }, { sourceEventId: "full:fact" });
  assert.equal(run.story.factLedger!.facts.find((entry) => entry.id === factId)!.label, description);
  const episode = commitNarrativeEpisode(run, { callId: "full:call", sourceEventId: "full:asset", turnKind: "scene", age: 18, storyDelta: description, ...links });
  const canon = commitNarrativeActCanon(run, { actId: "act.one", sourceEventId: "full:asset", resolvedAge: 18 });
  const restored = JSON.parse(JSON.stringify(run)) as typeof run;
  restored.narrative = ensureNarrativeRunState(restored.narrative, true);
  assert.deepEqual(restored.narrative.opening, run.narrative.opening);
  assert.equal(restored.narrative.dynamicCharacters[0].id, run.narrative.dynamicCharacters[0].id);
  assert.equal(restored.narrative.dynamicCharacters[0].description, description);
  assert.equal(restored.narrative.dynamicCharacters[0].relationship!.summary, description);
  assert.deepEqual(restored.narrative.assets, run.narrative.assets);
  assert.equal(restored.narrative.episodes.find((entry) => entry.id === episode.id)!.storyDelta, undefined);
  assert.equal(recentCommittedNarrativeChanges(restored.narrative).at(-1), `18岁：\n${description}`);
  assert.deepEqual(restored.narrative.actCanon[0], canon);
  assert.ok(restored.narrative.memoryEntries.find((entry) => entry.id === "memory:full:asset")!.text.endsWith(description));
  const focusIds = [...links.locationIds, ...links.abilityIds];
  const next = memoryTestContext(restored, focusIds);
  const abilityText = next.narrativePlan!.recall!.assetSources!.find((entry) => entry.id === links.abilityIds[0])!.text;
  assert.match(abilityText, /夜行辨踪（熟练）/);
  assert.ok(!abilityText.includes(description));
  const request = prepareNarrativeOutcomeRequest(restored, world, next, narrativeDecisionRenderTool(), "写本轮经历", { task: "rendering", contracts: { references: true } });
  checkSchema(request.tools);
  assert.ok(request.history.some((entry) => entry.content.includes(abilityText)), "下一轮收到名称与熟练程度");
  assert.equal(publicNarrativeAssetsSnapshot(restored.narrative.assets).abilities[0].usage, run.narrative.assets!.abilities[0].usage);
  assert.equal(toClientRun(restored).narrativeAssets!.abilities[0].description, description);
  assert.equal(scripts.length, 0);
});

test("有效背景无字符硬裁剪，覆盖批次保留且过期结果不能覆盖新摘要", () => {
  const run = makeRun();
  run.ended = true;
  run.aiConversation = { year: { systemHash: "world", headCore: "世界", headMemory: "", history: [], archive: [] } };
  for (let index = 0; index < 4; index += 1) {
    const sourceEventId = `long-digest:${index}`;
    commitNarrativeMemory(run.narrative, { id: `memory:${sourceEventId}`, age: index + 1, factionIds: [], characterIds: [], factIds: [],
      abilityIds: ["ability:scout"], text: `巡行第${index + 1}年形成了新的辨踪经验。` });
    commitNarrativeEpisode(run, { callId: sourceEventId, sourceEventId, turnKind: "background", age: index + 1 });
    run.aiConversation.year!.archive.push({ id: `memory:${sourceEventId}`, user: "巡行", assistant: "新经验" });
  }
  const work = prepareNarrativeMemoryCuration(run)!;
  const summary = Array.from({ length: 12 }, (_, index) => `第${index + 1}段巡行经历中，人物逐步熟悉不同季候的道路、水位和队伍信号，已经完成的护送成为历史结果，新的职责改变了日后巡防的范围，具体能力仍由本领档案记录。`).join("");
  assert.ok(summary.length > 600);
  const schema = JSON.stringify(memoryCurationTool(work));
  assert.doesNotMatch(schema, /maxLength/);
  const proposal = (id: string, text = summary) => ({ id, summary: text, activeFactIds: [], historicalFactIds: [], characterIds: [] });
  const result = { summary };
  assert.equal(applyNarrativeMemoryCuration(run, work, result), true);
  assert.equal(run.aiConversation.year!.headMemory, summary);
  assert.equal(run.aiConversation.year!.archive.length, 0);
  assert.deepEqual(run.narrative.memoryDigests.find((entry) => entry.id === "run")!.coveredEpisodeIds, work.episodeIds);
  assert.equal(applyNarrativeMemoryCuration(run, work, { summary: "过期内容" }), false);
  const restored = ensureNarrativeRunState(JSON.parse(JSON.stringify(run.narrative)), true);
  assert.equal(restored.memoryDigests.find((entry) => entry.id === "run")!.summary, summary);
  assert.equal(restored.memoryDigests[0].format, "effective_facts");
});

test("任务身份替代通用系统指挥，原工具 JSON 历史完整保留且按任务选择窗口", () => {
  const run = makeRun();
  const ctx = memoryTestContext(run);
  const rules = Array.from({ length: 50 }, (_, index) => `第${index + 1}条世界信息说明季候、商旅与各地居民的关系，在相关经历中作为背景使用，具体行动由本轮任务决定。`).join("\n");
  const args = JSON.stringify({ narrative: rules, storyDelta: "渡口进入雨季，船队暂停通行。" });
  ctx.promptPack = { systemCore: rules };
  ctx.conversation = { systemHash: "world", headCore: "旧前缀", headMemory: "", archive: [], history: [
    { role: "user", content: "此前经历" },
    { role: "assistant", toolCall: { id: "full-tool", name: "render_scene_prose", arguments: args } },
    { role: "tool", toolCallId: "full-tool", name: "render_scene_prose", content: rules },
    { role: "assistant", content: "渡口进入雨季，船队暂停通行。" }
  ] };
  const prepared = prepareNarrativeOutcomeRequest(run, world, ctx, narrativeDecisionRenderTool(), "本轮渲染", { task: "rendering" });
  assert.equal(prepared.conversation.headCore.includes(rules), false);
  assert.ok(prepared.conversation.headCore.includes(narrativeTaskContract("rendering").systemInstruction));
  const call = prepared.conversation.history.find((entry) => entry.role === "assistant" && "toolCall" in entry);
  assert.ok(call && "toolCall" in call);
  assert.deepEqual(JSON.parse(call.toolCall.arguments), JSON.parse(args));
  const result = prepared.conversation.history.find((entry) => entry.role === "tool");
  assert.ok(result && "content" in result);
  assert.equal(result.content, rules);
  const isolated = prepareNarrativeOutcomeRequest(run, world, ctx, narrativeDecisionRenderTool(), "只结算本轮", { task: "settlement" });
  assert.equal(isolated.contextManifest.historyMessageCount, 0);
});

test("正文规格按叙事目的区分软目标，高潮与收束不套用普通年份长度", () => {
  const background = narrativeProseProfile("summary", "setup");
  const scene = narrativeProseProfile("scene", "escalation");
  const climax = narrativeProseProfile("scene", "climax");
  const payoff = narrativeProseProfile("scene", "payoff");
  const decision = narrativeProseProfile("decision", "pressure");
  assert.equal(background.purpose, "background");
  assert.ok(background.targetMaxLength < scene.targetMaxLength);
  assert.equal(climax.purpose, "climax");
  assert.ok(climax.targetMaxLength > scene.targetMaxLength);
  assert.equal(payoff.purpose, "payoff");
  assert.equal(decision.targetMaxLength, 200);
  assert.match(climax.instruction, /render_choice_prose/);
});

test("世界卡 sticky 只延续指定提交回合且不会自我续期", async () => {
  const base = await loadNarrativeExperienceForTest("fantasy");
  const definition: NarrativeWorldDefinition = {
    ...base,
    worldCards: [{
      id: "test.sticky", kind: "setting", content: "只在雾出现时直接激活。", priority: 90,
      activation: { keys: ["山雾"], tasks: ["dynamic"] }, stickyTurns: 1, cooldownTurns: 2
    }]
  };
  const run = makeRun();
  run.worldId = "fantasy";
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  const query = { task: "dynamic" as const, actId: definition.mainlineActs![0].id, beat: "setup" as const };
  assert.deepEqual(selectNarrativeWorldCards(run, definition, { ...query, text: "山雾升起" }).map((entry) => entry.id), ["test.sticky"]);

  const commitCard = (activationKind: "direct" | "sticky", index: number) => {
    const attemptId = `attempt:card:${index}`;
    run.narrative.agentAttempts.push({
      id: `${attemptId}:render`, callId: `call:${index}`, attemptId, task: "dynamic", source: "scene", stage: "render",
      contextFragmentIds: [`recall:world-card:test.sticky|1|2|${activationKind}`], createdAt: index
    });
    const sourceEventId = `card:${index}`;
    commitNarrativeMemory(run.narrative, { id: `memory:${sourceEventId}`, age: index, factionIds: [], characterIds: [], factIds: [], text: `第${index}次提交` });
    const episode = commitNarrativeEpisode(run, { callId: `call:${index}`, sourceEventId, turnKind: "scene", age: index });
    commitNarrativeAgentTurn(run, attemptId, episode.id);
  };

  commitCard("direct", 1);
  assert.deepEqual(run.narrative.worldCardActivations?.[0], {
    cardId: "test.sticky", lastActivatedSequence: 1, stickyUntilSequence: 2, cooldownUntilSequence: 4
  });
  const stickyPlan = buildNarrativePromptPlan(run, definition, null, "dynamic")!;
  assert.equal(stickyPlan.activeWorldCardSources?.find((entry) => entry.id === "test.sticky")?.activationKind, "sticky");
  commitCard("sticky", 2);
  assert.equal(run.narrative.worldCardActivations?.[0]?.lastActivatedSequence, 1);
  assert.equal(selectNarrativeWorldCards(run, definition, { ...query, text: "山雾升起" }).length, 0);

  for (const index of [3, 4]) {
    const sourceEventId = `cooldown:${index}`;
    commitNarrativeMemory(run.narrative, { id: `memory:${sourceEventId}`, age: index, factionIds: [], characterIds: [], factIds: [], text: "普通回合" });
    commitNarrativeEpisode(run, { callId: `call:cooldown:${index}`, sourceEventId, turnKind: "background", age: index });
  }
  assert.deepEqual(selectNarrativeWorldCards(run, definition, { ...query, text: "山雾升起" }).map((entry) => entry.id), ["test.sticky"]);
});

test("sticky 为零不延续，且 sticky 不跨越世界卡硬作用域", async () => {
  const base = await loadNarrativeExperienceForTest("fantasy");
  const firstActId = base.mainlineActs![0].id;
  const otherActId = base.mainlineActs![1].id;
  const definition: NarrativeWorldDefinition = {
    ...base,
    worldCards: [{
      id: "test.scope", kind: "setting", content: "仅属于第一幕。", priority: 90,
      activation: { keys: ["山门"], actIds: [firstActId], tasks: ["dynamic"] }, stickyTurns: 0
    }]
  };
  const run = makeRun();
  run.worldId = "fantasy";
  run.narrative.enabled = true;
  run.narrative.worldCardActivations = [{ cardId: "test.scope", lastActivatedSequence: 0, stickyUntilSequence: 0, cooldownUntilSequence: 0 }];
  assert.equal(selectNarrativeWorldCards(run, definition, { task: "dynamic", actId: firstActId, beat: "setup", text: "没有关键词" }).length, 0);
  run.narrative.worldCardActivations = [{ cardId: "test.scope", lastActivatedSequence: 0, stickyUntilSequence: 2, cooldownUntilSequence: 2 }];
  assert.equal(selectNarrativeWorldCards(run, definition, { task: "dynamic", actId: otherActId, beat: "setup", text: "山门" }).length, 0);
});

test("关联世界卡服从冷却和互斥组，适用内容不受数量预算淘汰", async () => {
  const base = await loadNarrativeExperienceForTest("fantasy");
  const definition: NarrativeWorldDefinition = {
    ...base,
    worldCards: [
      { id: "test.parent", kind: "setting", content: "父卡", priority: 90, activation: { keys: ["触发"], tasks: ["dynamic"] }, relatedCardIds: ["test.related"] },
      { id: "test.related", kind: "setting", content: "关联卡", priority: 80, activation: { keys: ["不会直接出现"], tasks: ["dynamic"] }, cooldownTurns: 2 }
    ]
  };
  const run = makeRun();
  run.worldId = "fantasy";
  run.narrative.enabled = true;
  run.narrative.worldCardActivations = [{ cardId: "test.related", lastActivatedSequence: 0, stickyUntilSequence: 0, cooldownUntilSequence: 2 }];
  assert.deepEqual(selectNarrativeWorldCards(run, definition, { task: "dynamic", text: "触发" }).map((entry) => entry.id), ["test.parent"]);
  run.narrative.worldCardActivations = [];
  definition.worldCards![0].inclusionGroup = "one";
  definition.worldCards![1].inclusionGroup = "one";
  assert.deepEqual(selectNarrativeWorldCards(run, definition, { task: "dynamic", text: "触发" }).map((entry) => entry.id), ["test.parent"]);
  definition.worldCards![1].inclusionGroup = "two";
  assert.deepEqual(selectNarrativeWorldCards(run, definition, { task: "dynamic", text: "触发" }).map((entry) => entry.id), ["test.parent", "test.related"]);
});

test("世界卡任务矩阵与 v8 单一数据源保持一致", async () => {
  const base = await loadNarrativeExperienceForTest("modern");
  const run = makeRun();
  run.worldId = "modern";
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, base, run.age);
  assert.equal(selectNarrativeWorldCards(run, base, { task: "origin" }).length, 0);
  assert.equal(selectNarrativeWorldCards(run, base, { task: "ending" }).length, 0);
  assert.ok(selectNarrativeWorldCards(run, base, { task: "horizon", actId: base.mainlineActs![0].id, beat: "setup" }).length > 0);
  assert.throws(() => validateNarrativeWorldFactContract({ ...base, worldCards: [] }), /world_cards_required/);

  const legacy: NarrativeWorldDefinition = {
    ...base, version: 7, worldCards: undefined,
    lore: [{ id: "legacy.lore", text: "旧版世界知识", priority: 100 }]
  };
  validateNarrativeWorldFactContract(legacy);
  assert.ok(buildNarrativePromptPlan(run, legacy, null, "planning")?.activeLore.includes("旧版世界知识"));
  assert.deepEqual(buildNarrativePromptPlan(run, base, null, "planning")?.activeLore, []);
});

test("公开抉择以 sceneId 和 revision 定位，并保存公开选项 ID", () => {
  const run = makeRun();
  const firstChoice = {
    sceneId: "scene_public",
    revision: 4,
    age: 18,
    background: "第一次取舍",
    options: [{ id: "option_public_one", label: "选择一", description: "承担第一种后果" }]
  };
  const laterChoice = {
    ...firstChoice,
    revision: 7,
    age: 20,
    background: "同一场景中的后续取舍",
    options: [{ id: "option_public_two", label: "选择二", description: "承担第二种后果" }]
  };
  const firstRecord = appendPublicTurnRecord(run, {
    entryId: "choice-one", age: 18, ageStage: { label: "青年" }, kind: "scene", narrative: "第一次取舍出现。", statChanges: {}
  }, firstChoice);
  const laterRecord = appendPublicTurnRecord(run, {
    entryId: "choice-two", age: 20, ageStage: { label: "青年" }, kind: "scene", narrative: "后续取舍出现。", statChanges: {}
  }, laterChoice);
  const resolved = resolveTurnRecordChoice(run, firstChoice, firstChoice.options[0]);
  assert.equal(resolved?.turnId, firstRecord.turnId);
  assert.equal(firstRecord.choiceOutcome?.optionId, "option_public_one");
  assert.equal(laterRecord.choiceOutcome, undefined);
});

test("IF 当前幕世界卡由同一候选集交给规划和正文，执行时不重新否决", async () => {
  const base = await loadNarrativeWorldDefinition("ancient");
  assert.ok(base);
  const pack = await loadNarrativeStoryPack(base, "ancient.frontier-commander");
  assert.ok(pack);
  const definition = resolveNarrativeExperience(base, pack);
  const firstAct = pack.acts[0];
  const run = makeRun();
  run.worldId = "ancient";
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  const candidates = buildNarrativePromptPlan(run, definition, null, "planning")!.activeWorldCardSources!;
  const militaryCardId = firstAct.worldCardRefs!.find((id) => id.includes("military"))!;
  assert.ok(candidates.some((entry) => entry.id === militaryCardId));
  run.narrative.worldCardActivations = [{ cardId: militaryCardId, lastActivatedSequence: 0, stickyUntilSequence: 0, cooldownUntilSequence: 9 }];
  const focused = buildNarrativePromptPlan(run, definition, null, "rendering", { focusIds: [militaryCardId], worldCardCandidates: candidates, semanticQuery: "展开本轮行动" })!;
  assert.equal(focused.activeWorldCardSources?.some((entry) => entry.id === militaryCardId), true);
});


test("节拍观察以既定故事和实际经历作判断，不自行补写阶段目标", () => {
  const outline = outlineForTest("act.one", { goal: "统领守军迎战", completionMeaning: "实际指挥形成攻守结果" });
  const prompt = narrativeBeatObservationPrompt({ beat: "payoff", outline, recentStory: "20岁：人物核验了数份文书。" });
  assert.ok(prompt.includes(outline.beats.payoff.change));
  assert.match(prompt, /20岁：人物核验了数份文书/);
  assert.doesNotMatch(prompt, /progressGap|actObjective|completionMeaning/);
});

test("抉择上下文精确继承场景地点与本领，风格卡只在声明任务出现", async () => {
  const definition = await loadNarrativeExperienceForTest("fantasy");
  const run = makeRun();
  run.worldId = "fantasy";
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  run.narrative.assets = {
    locations: [{ id: "location:gate", name: "石门", description: "潮湿石门", spatialDescription: "潮湿石门", introduced: { age: 8 }, lastSeen: { age: 8 } }],
    abilities: [{ id: "ability:seal", name: "封息诀", description: "收束气息", usage: "收束气息", source: "旧师传授", mastery: "初学", introduced: { age: 8 }, updated: { age: 8 } }],
    currentLocationId: undefined
  };
  run.pendingDynamicScene = {
    id: "pending", patternIds: [], forceIds: [], beat: "pressure", mainlineActId: definition.mainlineActs![0].id,
    characterIds: [], factIds: [], locationIds: ["location:gate"], abilityIds: ["ability:seal"]
  };
  run.narrative.actRuntime!.beat = "pressure";
  const decision = buildNarrativePromptPlan(run, definition, null, "decision")!;
  assert.deepEqual(decision.recall?.assetSources?.map((entry) => entry.id).sort(), ["ability:seal", "location:gate"]);
  assert.equal(decision.activeWorldCardSources?.some((entry) => entry.id.includes(".example.")), false);
  assert.equal(buildNarrativePromptPlan(run, definition, null, "rendering")?.activeWorldCardSources?.some((entry) => entry.id === "fantasy.example.choice"), true);
  assert.equal(buildNarrativePromptPlan(run, definition, null, "planning")?.activeWorldCardSources?.some((entry) => entry.id.includes(".example.")), false);
  assert.equal(buildNarrativePromptPlan(run, definition, null, "background")?.activeWorldCardSources?.some((entry) => entry.id === "fantasy.example.background"), true);
});

test("连续性同步直接结束经历，结果经读档和后续补充保持完成状态", () => {
  const run = makeRun();
  const contract = factUpdateContract([], [{ sourceEventId: "age12", age: 12, actId: "act.one" }]);
  const [id] = applyNarrativeFactUpdates(run, parseFactUpdates({
    introduce: [{ kind: "experience", label: "随母亲学会查账", status: "stay", sourceEventId: "age12" }], updates: []
  }, contract), { sourceEventId: "batch14", actId: "act.one" });
  assert.equal(run.story.factLedger!.facts[0].introducedAge, 12, "批末整理不改写经历发生年龄");
  const finished = parseFactUpdates({ introduce: [], updates: [{ factId: id, status: "finish", summary: "账已核清，主角熟悉了账目，接下来随军。", sourceEventId: "age14" }] },
    factUpdateContract([id], [{ sourceEventId: "age14", age: 14, actId: "act.one" }]))!;
  applyNarrativeFactUpdates(run, finished, { sourceEventId: "batch14", actId: "act.one" });
  const restored = JSON.parse(JSON.stringify(run)) as typeof run;
  applyNarrativeFactUpdates(restored, parseFactUpdates({ updates: [{ factId: id, status: "finish", summary: "核账已经结束，熟悉账目的经验成为随军基础。" }] }, factUpdateContract([id])),
    { sourceEventId: "supplement", actId: "act.one" });
  const fact = restored.story.factLedger!.facts[0];
  assert.equal(fact.kind, "experience");
  assert.equal(fact.status, "resolved");
  assert.equal(fact.resolutionSummary, "核账已经结束，熟悉账目的经验成为随军基础。");
  const context = selectDynamicNarrativeContext(restored, { task: "rendering", actId: "act.one", resolvedFactVisibility: "current-act" });
  assert.equal(context.facts.length, 0);
  assert.match(context.resolvedFacts![0].label, /finish.*核账已经结束/);
  const episode = commitNarrativeEpisode(restored, { callId: "supplement", sourceEventId: "supplement", turnKind: "scene", age: restored.age, actId: "act.one", storyDelta: "核账经历已经结束，人物继续随军。" });
  restored.narrative.memoryDigests = [{ id: "run", format: "effective_facts", scope: "run", revision: 1,
    throughEpisodeId: episode.id, coveredEpisodeIds: [episode.id], summary: "熟悉账目的经验成为随军基础。",
    activeFactIds: [], historicalFactIds: [id], characterIds: [], updatedAt: 1 }];
  assert.equal(selectDynamicNarrativeContext(restored, { task: "rendering", actId: "act.one", resolvedFactVisibility: "current-act" }).resolvedFacts!.length, 0,
    "已被人物经历摘要覆盖的结束事件不再单独重复注入正文");
  assert.equal(restored.story.factLedger!.facts[0].resolutionSummary, fact.resolutionSummary, "去重只影响模型可见性，不删除事实依据");
});

test("观察器窗口按故事年份滚动，同年行动全部保留且本轮只出现一次", () => {
  const run = makeRun();
  for (const [id, age, actId, text] of [
    ["old", 9, "act.one", "窗口之外"],
    ["a", 10, "act.one", "抵达关城"],
    ["b", 10, "act.one", "同年初次巡哨"],
    ["c", 11, "act.one", "发现敌踪"],
    ["other", 12, "act.other", "另一幕的事情"],
    ["current", 12, "act.one", "敌军主力逼近"]
  ] as const) {
    commitNarrativeMemory(run.narrative, { id: "memory:" + id, age, text, factIds: [], characterIds: [], factionIds: [] });
    commitNarrativeEpisode(run, { callId: id, sourceEventId: id, turnKind: "scene", age, actId });
  }
  const text = narrativeObservationHistory(run, { actId: "act.one", age: 12, sourceEventId: "current", narrative: "敌军主力逼近" });
  for (const expected of ["抵达关城", "同年初次巡哨", "发现敌踪", "敌军主力逼近"]) assert.ok(text.includes(expected));
  assert.equal(text.split("敌军主力逼近").length - 1, 1);
  assert.doesNotMatch(text, /窗口之外|另一幕的事情/);
});

test("已有事件使用同一 ID 持续更新并结束，不依赖观察器转交完成", () => {
  const run = makeRun();
  const [id] = applyNarrativeFactUpdates(run, { introduce: [{ kind: "commitment", label: "约定仍待履行" }], touchFactIds: [], resolveFactIds: [] }, { sourceEventId: "handoff", actId: "act.two" });
  const contract = factUpdateContract([id]);
  applyNarrativeFactUpdates(run, parseFactUpdates({ updates: [{ factId: id, status: "stay", summary: "约定已履行大半。" }] }, contract), { sourceEventId: "progress", actId: "act.two" });
  applyNarrativeFactUpdates(run, parseFactUpdates({ updates: [{ factId: id, status: "finish", summary: "约定全部履行。" }] }, contract), { sourceEventId: "complete", actId: "act.two" });
  assert.equal(run.story.factLedger!.facts.length, 1);
  assert.equal(run.story.factLedger!.facts[0].status, "resolved");
  assert.equal(run.story.factLedger!.facts[0].resolutionSummary, "约定全部履行。");
});

test("幕初规划通过共享历史读取未压缩的有效选择", () => {
  const run = makeRun();
  const episodes = ["已形成立场", "已选择迁移", "继续前行", "抵达途中", "获得协助", "进入新城"].map((delta, index) =>
    commitNarrativeEpisode(run, { callId: `call:${index}`, sourceEventId: `round:${index}`, turnKind: index === 1 ? "decision" : "scene", age: 12, actId: "act.one", beat: "pressure", storyDelta: delta }));
  commitNarrativeEpisode(run, { callId: "other", sourceEventId: "other", turnKind: "scene", age: 10, actId: "act.other", beat: "pressure", storyDelta: "其他幕的事情" });
  run.narrative.memoryDigests = [{
    id: "act:act.one", format: "effective_facts", scope: "act", scopeId: "act.one", revision: 2, throughEpisodeId: episodes[0].id,
    coveredEpisodeIds: ["episode:older-evicted-round", episodes[0].id], summary: "人物已明确自己的立场。",
    activeFactIds: [], historicalFactIds: [], characterIds: [], updatedAt: 2
  }];
  const summary = run.narrative.memoryDigests[0].summary;
  const envelope: NarrativeTurnEnvelope = {
    callId: "plan", source: "scene", worldId: world.id, currentAge: 12,
    backgroundAgeRange: { fromAge: 13, toAge: 13 }, act: { id: "act.one", label: "第一幕", prompt: "人生进展" }, beat: "pressure",
    capabilities: ["scene", "choice"], storyPatterns: [], socialForces: [], focusReferences: [],
    statTiers: { intelligence: "steady", charisma: "steady", family: "steady", fortune: "steady", physique: "steady" },
    clock: { mode: "hold", sameAgeTurnCount: 0, maxSameAgeTurns: 3 },
  };
  run.narrative.memoryDigests.push({ ...run.narrative.memoryDigests[0], id: "run", scope: "run", scopeId: undefined });
  const planning = composeNarrativeContext({ task: "planning", taskPrompt: narrativeTurnPlanningPrompt(envelope), plan: {
    task: "planning", storyBible: "测试世界", storyHistory: buildNarrativeStoryHistory(run.narrative), styleRules: [], activeLore: [],
    plotEssentials: [], activeThreads: [], activeCharacters: [], scene: "", authorNote: "", ending: ""
  } }).renderedContext;
  assert.match(planning, /已选择迁移/);
  assert.equal(planning.split(summary).length - 1, 1);
  assert.match(planning, /其他幕的事情/, "规划保留真实的跨幕历史，观察器依然只读取当前幕");
});

test("规划交接场景，正文实际抉择的问题与后果意图保留到待选存档和结果提交", async () => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  const run = makeRun();
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, 20);
  run.narrative.actRuntime!.beat = "pressure";
  run.age = 20;
  run.stats = { intelligence: 50, charisma: 50, family: 50, fortune: 50, physique: 100 };
  const act = definition.mainlineActs![0];
  const envelope: NarrativeTurnEnvelope = {
    callId: "choice-plan", source: "scene", worldId: run.worldId, currentAge: 20,
    backgroundAgeRange: { fromAge: 21, toAge: 21 }, act: { id: act.id, label: act.label, prompt: act.prompt }, beat: "pressure",
    capabilities: narrativeTurnCapabilities(false, "pressure", ["scene"]), storyPatterns: [], socialForces: [], focusReferences: [],
    statTiers: { intelligence: "steady", charisma: "steady", family: "steady", fortune: "steady", physique: "steady" },
    clock: { mode: "advance", sameAgeTurnCount: 0, maxSameAgeTurns: 3 }
  };
  const raw = planningReplyForTest({ conflictRefs: [], abilityRefs: [], forceIds: [], locationDirective: { mode: "stay" },  clockRequest: "hold", actWorldCard: actWorldCardForTest({ goal: "建立新的立足之处", completionMeaning: "人物在取舍后已经开始建立自己的生活" }) });
  const decisionBrief = { question: "留在故地还是迁居？", stakes: "决定以后生活的位置和交往圈子。" };
  const tools = narrativeTurnPlanTools(envelope).map((tool) => tool.function as { name: string; parameters: { required: string[] } });
  assert.ok(!tools.some((tool) => tool.name === "plan_choice_turn"));
  assert.ok(!tools.find((tool) => tool.name === "plan_scene_turn")!.parameters.required.includes("decisionBrief"));
  const plan = parseNarrativeTurnPlan(raw, "plan_scene_turn", { ...envelope, actOutline: parseNarrativeActWorldCard(raw.actWorldCard, envelope.act.id) });
  assert.equal(plan.presentation, "scene");
  commitNarrativeActOutline(run.narrative, plan.actOutline!);
  const prose = parseDynamicNarrativeProse({ narrative: "新的去处已有落脚机会，你需要决定是否启程。", storyDelta: "迁居机会使去向成为实质分歧", background: "留下与启程会改变生活与关系。", decisionBrief,
    optionOverrides: ["safe", "balanced", "risky"].map((id) => ({ id, label: "选择去向", description: "决定下一步生活", abilityRefs: [], locationDirective: { mode: "stay" } })) }, "render_choice_prose", plan);
  advanceWithDynamicNarrativeScene(run, world, definition, {
    patternIds: [], forceIds: [], beat: "pressure", beatDecision: "hold",
    ...prose, participants: []
  });
  assert.ok(run.nextMilestoneChoice);
  const restored = JSON.parse(JSON.stringify(run)) as ReturnType<typeof makeRun>;
  restored.narrative = ensureNarrativeRunState(restored.narrative, true);
  assert.deepEqual(restored.narrative.actRuntime?.outline, plan.actOutline);
  assert.deepEqual(restored.pendingDynamicScene?.decisionBrief, decisionBrief);
  const [factId] = applyNarrativeFactUpdates(restored, { introduce: [{ kind: "open_question", label: "去向尚未确定" }], touchFactIds: [], resolveFactIds: [] }, { sourceEventId: "choice-question", actId: act.id });
  const proposal = parseFactUpdates({ updates: [{ factId, status: "finish", summary: "人物已经选择迁居并启程。" }] }, factUpdateContract([factId]))!;
  applyMilestoneDecisionAndAdvance(restored, world, difficulty, "safe", {
    narrativeWorld: definition, narrativeOutcome: { effects: [{ stat: "family", direction: "up", band: "light" }] },
    narrative: "你已经启程，故地的来往至此告一段落。", narrativeFactUpdates: proposal, beatDecision: "advance"
  });
  assert.equal(restored.pendingDynamicScene, undefined);
  assert.equal(restored.nextMilestoneChoice, undefined);
  assert.equal(restored.narrative.actRuntime!.beat, "climax");
  assert.equal(restored.narrative.actRuntime!.outline?.beats.climax.change, plan.actOutline!.beats.climax.change);
  assert.equal(restored.story.factLedger!.facts.find((fact) => fact.id === factId)?.resolutionSummary, "人物已经选择迁居并启程。");
  assert.ok(restored.stats.family > run.stats.family);
  assert.equal(run.pendingDynamicScene?.decisionBrief?.question, decisionBrief.question, "另一份快照未被结果提交污染");
});

test("大纲跨生活年与同年回合保留，失败事务不提交，换幕不沿用旧大纲", async () => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  const run = makeRun(); run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, 20);
  const actId = run.narrative.actRuntime!.actId;
  const outline = outlineForTest(actId);
  await assert.rejects(runNarrativeTurnTransaction(run, async (working) => { commitNarrativeActOutline(working.narrative, outline); throw new Error("生成失败"); }), /生成失败/);
  assert.equal(Boolean(run.narrative.actRuntime!.outline), false);
  commitNarrativeActOutline(run.narrative, outline);
  settleQuietYearForTest(run, definition);
  assert.deepEqual(run.narrative.actRuntime!.outline, outline);
  for (const beat of ["setup", "escalation", "pressure", "climax", "payoff"] as const) {
    run.narrative.actRuntime!.beat = beat;
    run.narrative = advanceNarrativeActBeat(run.narrative, definition, run.age).state;
  }
  assert.notEqual(run.narrative.actRuntime!.actId, actId);
  assert.equal(run.narrative.actRuntime!.outline, undefined);
});

test("规划请求只使用一次幕背景，正文和连续性保留各自的按需召回", async () => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  const run = makeRun();
  run.worldId = definition.worldId;
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, 20);
  const actId = run.narrative.actRuntime!.actId;
  const covered = commitNarrativeEpisode(run, { callId: "covered", sourceEventId: "covered", turnKind: "scene", age: 20, actId, beat: "setup", storyDelta: "已被摘要替代的过程" });
  commitNarrativeEpisode(run, { callId: "fresh", sourceEventId: "fresh", turnKind: "decision", age: 20, actId, beat: "setup", storyDelta: "玩家选择已改变去向" });
  run.narrative.memoryDigests = [{ id: `act:${actId}`, format: "effective_facts", scope: "act", scopeId: actId, revision: 1, throughEpisodeId: covered.id, coveredEpisodeIds: [covered.id], summary: "已有的阶段历史结果", activeFactIds: [], historicalFactIds: [], characterIds: [], updatedAt: 1 }];
  run.narrative.memoryDigests.push({ ...run.narrative.memoryDigests[0], id: "run", scope: "run", scopeId: undefined });
  const summary = run.narrative.memoryDigests[0].summary;
  const envelope: NarrativeTurnEnvelope = {
    callId: "clean", source: "scene", worldId: run.worldId, currentAge: 20, backgroundAgeRange: { fromAge: 21, toAge: 21 },
    act: { id: actId, label: "当前幕", prompt: "重复的幕提示" }, beat: "setup", capabilities: ["scene"], storyPatterns: [], socialForces: [], focusReferences: [],
    statTiers: resolveNarrativeStatTiers(run.stats), clock: { mode: "hold", sameAgeTurnCount: 0, maxSameAgeTurns: 3 },
  };
  const ctx = memoryTestContext(run);
  ctx.narrativePlan = buildNarrativePromptPlan(run, definition, null, "planning");
  ctx.conversation = {
    systemHash: "prior", headCore: "原会话规则", headMemory: "另一份历史摘要", archive: [],
    history: [
      { role: "user", content: "原历史输入", turnId: "memory:covered" },
      { role: "assistant", content: "已被摘要替代的过程" },
      { role: "user", content: "最近的历史输入", turnId: "memory:fresh" },
      { role: "assistant", content: "玩家选择已改变去向" }
    ]
  };
  const request = prepareNarrativeOutcomeRequest(run, world, ctx, narrativeTurnPlanTools(envelope), narrativeTurnPlanningPrompt(envelope), { task: "planning" });
  const text = request.history.map((entry) => entry.content).join("\n");
  assert.equal(text.split(summary).length - 1, 1);
  assert.equal(text.split("玩家选择已改变去向").length - 1, 1);
  assert.doesNotMatch(text, /已被摘要替代的过程|另一份历史摘要|原历史输入|最近的历史输入/);
  assert.equal(request.contextManifest.historyMessageCount, 0);
  assert.equal(request.contextManifest.fragments.filter((entry) => entry.section === "route").length, 1);
  const actOutline = (definition as ResolvedNarrativeExperience).storyPack.acts[0].beatOutline;
  assert.ok(text.includes(actOutline.setup) && text.includes(actOutline.payoff));
});



test("观察器只读取同一份大纲与本轮正文，不返回独立剧情指挥", async (t) => {
  const run = makeRun();
  const outline = outlineForTest("act.one");
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string; parameters: { properties: Record<string, unknown> } } }>; messages: Array<{ content: string }> }) => {
    const tool = payload.tools[0].function;
    assert.equal(Object.hasOwn(tool.parameters.properties, "progressGap"), false);
    assert.equal(Object.hasOwn(tool.parameters.properties, "carryFactIds"), false);
    const text = payload.messages.map((message) => message.content).join("\n");
    assert.ok(text.includes(outline.beats.pressure.change));
    assert.ok(text.includes("20岁：\\n敌军已被击退。") || text.includes("敌军已被击退。"));
    assert.doesNotMatch(text, /本幕人物变化目标|当前故事弧问题|结束含义=/);
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "observer", type: "function", function: { name: tool.name, arguments: JSON.stringify(observationReplyForTest("advance")) } }] } }] };
  });
  const observed = await observeNarrativeBeat(run, world, { callId: "observe", actId: "act.one", beat: "pressure", outline, recentStory: "20岁：\n敌军已被击退。" }, { ...memoryTestContext(run), apiKey: "not-sent" });
  assert.equal(observed.decision, "advance");
});

test("仅背景入口和濒死重绘保留场景引用，当前位置独立声明后进入足迹与公开快照", async (t) => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  const run = makeRun(); run.age = 8; run.worldId = definition.worldId; run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  run.narrative.assets = {
    locations: [{ id: "location:fort", name: "军堡", description: "一家人居住的军堡", spatialDescription: "一家人居住的军堡", introduced: { age: 0 }, lastSeen: { age: 7 } }],
    abilities: [{ id: "ability:bow", name: "弓箭术", description: "练习射箭", usage: "练习射箭", source: "父亲教导", mastery: "初通", introduced: { age: 7 }, updated: { age: 7 } }],
    currentLocationId: "location:fort"
  };
  run.narrative.dynamicCharacters = [{ id: "character:father", name: "父亲", role: "军士", description: "住在军堡的父亲",
    status: "active", importance: "recurring", introducedAge: 0, lastSeenAge: 7, relatedFactIds: [], relatedRouteIds: [] }];
  run.narrative.activeCharacterIds = ["character:father"];
  commitNarrativeEpisode(run, { callId: "before", sourceEventId: "before", turnKind: "background", age: 7,
    characterIds: ["character:father"], locationIds: ["location:fort"], abilityIds: ["ability:bow"] });
  const activity = { locationIds: [], currentLocationId: "location:fort", abilityIds: [] };
  const scripts = [
    { name: "render_background_prose", args: { narrative: "你在军堡跟着父亲练习射箭，手臂渐渐有了力量。", storyDelta: "随父亲练习，身体逐渐长大", continuityRefs: { factIds: [], characterIds: [], locationIds: [], abilityIds: [] }, assetActivity: activity, continuityRequired: false , participants: [], assetUpdates: { locations: [], abilities: [] }, factUpdates: { introduce: [], updates: [] } } },
    { name: "resolve_background_outcome", args: { effects: [{ stat: "intelligence", direction: "up", band: "light" }] } },
    { name: "render_background_segment", args: { narrative: "你在军堡病倒，父亲守在床前照料。", storyDelta: "在军堡病倒，受到父亲照料", continuityRefs: { factIds: [], characterIds: [], locationIds: [], abilityIds: [] }, assetActivity: activity, continuityRequired: false , participants: [], assetUpdates: { locations: [], abilities: [] }, factUpdates: { introduce: [], updates: [] } } },
    { name: "render_background_segment", args: { narrative: "你在军堡病倒，父亲守在床前照料。", storyDelta: "在军堡病倒", continuityRefs: { factIds: [], characterIds: [], locationIds: [], abilityIds: [] }, assetActivity: { ...activity, currentLocationId: "location:outside-run" }, continuityRequired: false , participants: [], assetUpdates: { locations: [], abilities: [] }, factUpdates: { introduce: [], updates: [] } } }
  ];
  scripts.push(structuredClone(scripts.at(-1)!));
  const calls: string[] = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string } }>; messages: Array<{ content: string }> }) => {
    const step = nextNarrativeScript(scripts, payload); assert.ok(step); assert.ok(payload.tools.some((tool) => tool.function.name === step.name));
    const text = payload.messages.map((entry) => entry.content).join("\n");
    const expectedIds = step.name === "resolve_background_outcome" ? [] : ["location:fort"];
    for (const id of expectedIds) assert.ok(text.includes(id), `背景场景资料未传入：${id}`);
    calls.push(step.name);
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: step.name, type: "function", function: { name: step.name, arguments: JSON.stringify(step.args) } }] } }] };
  });
  const act = definition.mainlineActs![0];
  const turn = await runNarrativeAgentTurn({ run, world, narrativeWorld: definition,
    context: { ...memoryTestContext(run), apiKey: "not-sent" },
    envelope: { callId: "background-only", source: "background", worldId: run.worldId, currentAge: 8,
      backgroundAgeRange: { fromAge: 9, toAge: 10 }, act, beat: "setup", actOutline: outlineForTest(act.id), capabilities: ["background"], storyPatterns: [], socialForces: [],
      focusReferences: [], statTiers: resolveNarrativeStatTiers(run.stats), clock: { mode: "advance", sameAgeTurnCount: 0, maxSameAgeTurns: 3 } },
    buildRenderInput: (plan) => ({ act, beat: "setup", presentation: plan.presentation, allowedTurnKinds: ["background"], sceneAge: 9,
      backgroundAgeRange: { fromAge: 9, toAge: 10 }, storyPatterns: [], socialForces: [], knownCharacters: [],
      statTiers: resolveNarrativeStatTiers(run.stats), attributePolicy: dynamicSceneAttributePolicy(), backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run) }) });
  assert.deepEqual(calls, ["render_background_prose", "resolve_background_outcome"], "仅背景入口不新增规划或同步请求");
  assert.deepEqual(turn.scene.assetActivity.locationIds, ["location:fort"]);
  run.age = 10;
  run.narrative.assets = applyNarrativeAssetActivity(run.narrative.assets, turn.scene.assetActivity, { age: run.age });
  const episode = commitNarrativeEpisode(run, { callId: "background-only", sourceEventId: "background-only", turnKind: "background", age: run.age,
    locationIds: turn.scene.assetActivity.locationIds, abilityIds: turn.scene.assetActivity.abilityIds });
  assert.deepEqual(episode.locationIds, ["location:fort"]);
  const record = appendPublicTurnRecord(run, { entryId: "background-only", kind: "passage", age: run.age, ageStage: { label: "幼年" }, narrative: turn.scene.narrative, statChanges: {} });
  assert.equal(record.narrativeAssetsSnapshot!.currentLocationId, "location:fort");
  assert.equal(record.narrativeAssetsSnapshot!.locations[0].lastSeen.age, 10);
  assert.equal(run.narrative.assets.abilities[0].updated.age, 7, "召回不代表使用或升级");
  const context = { ...memoryTestContext(run), apiKey: "not-sent", narrativePlan: buildNarrativePromptPlan(run, definition, null, "background") };
  const interrupted = await renderInterruptedBackground(run, world, context, 9, []);
  assert.deepEqual(interrupted.assetActivity!.locationIds, ["location:fort"]);
  const before = structuredClone(run);
  await assert.rejects(renderInterruptedBackground(run, world, context, 9, []), (error: unknown) => error instanceof NarrativeOutcomeError && error.validation?.rule === "current_location_id_invalid");
  assert.deepEqual(run, before, "非法位置声明不改变运行态");
  assert.equal(scripts.length, 0);
});


test("payoff 由实际观察结果保持或结束，不要求同步另写交接剧情", async (t) => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  const act = definition.mainlineActs![0];
  let scripts: Array<{ name: string; args: Record<string, unknown> }> = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string; parameters: { properties: Record<string, unknown> } } }>; messages: Array<{ content: string }> }) => {
    const step = nextNarrativeScript(scripts, payload); assert.ok(step); assert.ok(payload.tools.some((tool) => tool.function.name === step.name));
    if (step.name === "resolve_scene_outcome") assert.equal(Object.hasOwn(payload.tools[0].function.parameters.properties, "actHandoff"), false);
    assert.doesNotMatch(payload.messages.map((entry) => entry.content).join("\n"), /拟交接/);
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: step.name, type: "function", function: { name: step.name, arguments: JSON.stringify(step.args) } }] } }] };
  });
  for (const decision of ["hold", "advance"] as const) {
    const run = makeRun(); run.age = 20; run.worldId = definition.worldId; run.narrative.enabled = true;
    run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
    run.narrative.actRuntime!.beat = "payoff";
    const before = structuredClone(run);
    const narrative = "你带着巡防小队回到营中，失联同袍仍未寻回，众人决定继续搜寻。";
    const rendered = { narrative, storyDelta: "巡防小队回营，失联同袍仍未寻回", continuityRefs: { factIds: [], characterIds: [], locationIds: [], abilityIds: [] }, assetActivity: { locationIds: [], abilityIds: [] }, continuityRequired: false, participants: [], assetUpdates: { locations: [], abilities: [] }, factUpdates: { introduce: [], updates: [] } };
    scripts = [
      { name: "plan_scene_turn", args: { conflictRefs: [], abilityRefs: [], forceIds: [], locationDirective: { mode: "stay" },  clockRequest: "hold",
        actWorldCard: actWorldCardForTest({ goal: "落实失联同袍的结果", completionMeaning: "巡防危机及其代价已经落定" }) } },
      { name: "render_scene_prose", args: rendered },
      { name: "resolve_scene_outcome", args: { participants: [], effects: [{ stat: "intelligence", direction: "up", band: "light" }] } },
      { name: "observe_story_beat", args: { beatDecision: decision, resolutions: [], carryFactIds: [] } }
    ];
    if (decision === "advance") scripts.push({ name: "sync_narrative_continuity", args: { locationUpdates: [], abilityUpdates: [], identityMerges: [], relationshipUpdates: [], factIntroductions: [], factUpdates: [] } });
    const execute = async (working: typeof run) => {
      const turn = await runNarrativeAgentTurn({ run: working, world, narrativeWorld: definition,
        context: { ...memoryTestContext(working), apiKey: "not-sent" },
        envelope: { callId: `payoff:${decision}`, source: "scene", worldId: working.worldId, currentAge: 20,
          backgroundAgeRange: { fromAge: 21, toAge: 21 }, act, beat: "payoff", capabilities: ["scene"], storyPatterns: [], socialForces: [],
          focusReferences: [], statTiers: resolveNarrativeStatTiers(working.stats), clock: { mode: "hold", sameAgeTurnCount: 0, maxSameAgeTurns: 3 } },
        buildRenderInput: (plan) => ({ act, beat: "payoff", presentation: plan.presentation, allowedTurnKinds: ["scene"], sceneAge: 20,
          backgroundAgeRange: { fromAge: 21, toAge: 21 }, storyPatterns: [], socialForces: [], knownCharacters: [], statTiers: resolveNarrativeStatTiers(working.stats),
          attributePolicy: dynamicSceneAttributePolicy(), backgroundAttributePolicy: dynamicBackgroundAttributePolicy(working) }) });
      return advanceWithDynamicNarrativeScene(working, world, definition, { ...turn.scene, sceneAge: turn.time.sceneAge,
        beat: "payoff", beatDecision: turn.scene.beatDecision!, sceneClockMode: "hold", attributeOutcome: { effects: turn.scene.attributeEffects! }, attributePolicy: dynamicSceneAttributePolicy() });
    };
    if (decision === "hold") {
      const committed = await runNarrativeTurnTransaction(run, execute);
      assert.equal(committed.result.completedActId, undefined);
      assert.equal(run.narrative.actRuntime!.actId, act.id);
      assert.equal(run.narrative.actRuntime!.beat, "payoff");
      assert.deepEqual(run.narrative.actCanon, []);
    } else {
      const committed = await runNarrativeTurnTransaction(run, execute);
      assert.equal(committed.result.completedActId, act.id);
      assert.equal(run.narrative.actCanon[0].sourceEventId, run.narrative.episodes.at(-1)?.sourceEventId ?? run.narrative.scene.lastEventId);
      assert.equal(Object.hasOwn(run.narrative.actCanon[0], "continuation"), false);
    }
    assert.equal(scripts.length, 0, "正文与审校实际完成后才进入观察裁定");
  }
});

test("同步区分局部战事结束与主线仍在持续，观察器不再重判事件状态", async (t) => {
  const run = makeRun(); run.narrative.enabled = true; run.age = 30;
  const [warId, battleId] = applyNarrativeFactUpdates(run, { introduce: [
    { kind: "open_question", label: "外敌入侵仍需解决" }, { kind: "experience", label: "今夜抵挡夜袭" }
  ], touchFactIds: [], resolveFactIds: [] }, { sourceEventId: "war", actId: "act.one" });
  for (const [i, age] of [28, 29, 30].entries()) stageNarrativeAssetRound(run, {
    sourceEventId: "round:" + i, source: "scene", age, actId: "act.one", subject: "守关", narrative: i === 2 ? "夜袭已退，敌主力仍在境外。" : "守关防御中。"
  }, {}, { age });
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
    const tool = payload.tools[0].function;
    assert.equal(tool.name, "sync_narrative_continuity");
    const text = payload.messages.map((message: any) => message.content).join("\n");
    assert.ok(text.includes(warId) && text.includes(battleId) && text.includes("夜袭已退"));
    assert.deepEqual(tool.parameters.properties.factUpdates.items.properties.status.enum, ["stay", "finish"]);
    return { choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "sync", type: "function", function: {
      name: tool.name, arguments: JSON.stringify({
        locationUpdates: [], abilityUpdates: [], identityMerges: [], relationshipUpdates: [], factIntroductions: [],
        factUpdates: [
          { factId: warId, status: "stay", summary: "敌主力仍在境外，战争尚未结束。", sourceEventId: "round:2" },
          { factId: battleId, status: "finish", summary: "这一轮夜袭已被击退。", sourceEventId: "round:2" }
        ]
      })
    } }] } }] };
  });
  await synchronizeNarrativeAssetBatch(run, world, { ...memoryTestContext(run), apiKey: "not-sent" }, "batch");
  assert.equal(run.story.factLedger!.facts.find((fact) => fact.id === warId)!.status, "open");
  assert.equal(run.story.factLedger!.facts.find((fact) => fact.id === battleId)!.status, "resolved");
  assert.equal(run.narrative.assetBuffer, undefined, "成功写入事件后才清空批次");
});

test("身世人物登记与后续职位变化共用身份，状态更新不伪造态度变化", async (t) => {
  const run = makeRun();
  run.narrative.enabled = true;
  const forces = [{ id: "force.garrison", label: "守军", summary: "守卫本地的军伍" }];
  const calls: Array<{ name: string; text: string; properties: Record<string, unknown> }> = [];
  let characterId = "";
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string; parameters: { properties: Record<string, unknown> } } }>; messages: Array<{ content: string }> }) => {
    const tool = payload.tools[0].function;
    calls.push({ name: tool.name, text: payload.messages.map((entry) => entry.content).join("\n"), properties: tool.parameters.properties });
    const args = tool.name === "render_origin" ? {
      narrative: "你降生在营镇的一个军户家庭，父亲韩岐守着城门，母亲靠织布维持家用。",
      summary: "来自营镇军户的孩子，父亲韩岐是守门军士。", seedHints: [],
      participants: [{ characterRef: "new", name: "韩岐", factionId: forces[0].id, role: "守门军士", description: "主角的父亲，驻守营镇", recurring: true }], assetUpdates: { locations: [], abilities: [] }
    } : {
      factIntroductions: [], factUpdates: [], locationUpdates: [], abilityUpdates: [], identityMerges: [],
      relationshipUpdates: [{ characterRef: characterId, role: "守备将军", description: "获授守备职责，负责营镇防务", status: "active" }]
    };
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: tool.name, type: "function", function: { name: tool.name, arguments: JSON.stringify(args) } }] } }] };
  });
  const origin = await generateNarrativeOrigin(run, world, { ...memoryTestContext(run), apiKey: "not-sent" }, forces);
  characterId = registerNarrativeParticipants(run, origin.participants, "origin")[0].character.id;
  run.narrative.dynamicCharacters[0].relationship = { stance: "friendly", summary: "父女相亲", relatedFactIds: [], lastChangedAge: 0 };
  const originalRelationship = structuredClone(run.narrative.dynamicCharacters[0].relationship);
  run.age = 20;
  const changes = await synchronizeNarrativeContinuity(run, world, {
    callId: "promotion", source: "scene", subject: "守备任命", narrative: "韩岐获授守备将军，统领营镇防务。",
    writeSet: { factIds: [], characterIds: [characterId], locationIds: [], abilityIds: [] }, continuityRequired: true, socialForces: forces
  }, { ...memoryTestContext(run, [characterId]), apiKey: "not-sent" });
  applyNarrativeRelationshipUpdates(run, changes.relationshipUpdates);
  const known = parseDynamicNarrativeParticipants([{ characterRef: characterId }], forces, narrativeCharacterDirectory(run.narrative), true)!;
  registerNarrativeParticipants(run, known, "new-command");
  applyNarrativeRelationshipUpdates(run, [{ characterRef: characterId, role: "镇边主将" }]);
  assert.equal(run.narrative.dynamicCharacters.length, 1);
  assert.equal(run.narrative.dynamicCharacters[0].id, characterId);
  assert.equal(run.narrative.dynamicCharacters[0].name, "韩岐");
  assert.equal(run.narrative.dynamicCharacters[0].role, "镇边主将");
  assert.deepEqual(run.narrative.dynamicCharacters[0].relationship, originalRelationship);
  appendPublicTurnRecord(run, { entryId: "promotion", kind: "scene", narrative: "韩岐统领营镇防务。", age: 20, ageStage: { label: "青年" }, statChanges: {} });
  assert.equal(run.turnRecords.at(-1)!.narrativeCharactersSnapshot![0].role, "镇边主将");
  assert.ok(Object.hasOwn(calls[0].properties, "participants"));
  assert.equal(Object.hasOwn(calls[1].properties, "participants"), false);
  assert.ok(Object.hasOwn(calls[1].properties, "relationshipUpdates"));
  assert.match(JSON.stringify(calls[0].properties.participants), /主角.*不作为 participants/);
  assert.match(calls[0].text, /participants 登记，主角保存在对局中/);
  assert.match(calls[1].text, /主角身份：/);
  assert.ok(calls[1].text.includes(characterId));
  assert.equal(makeRun().narrative.dynamicCharacters.length, 0, "人物资产没有跨局共享");
});

test("规划的同年时间贯通结算、正文与提交，可用资产不自动变成已使用资产", async (t) => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  const run = makeRun();
  run.worldId = definition.worldId; run.age = 20;
  run.stats = { intelligence: 50, charisma: 50, family: 0, fortune: 50, physique: 1 };
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, 20);
  run.narrative.actRuntime!.beat = "pressure";
  run.narrative.sceneClock = { mode: "advance", sameAgeTurnCount: 9, maxSameAgeTurns: 3 };
  run.survival.lowPhysiqueYears = 1;
  run.narrative.assets = {
    locations: [{ id: "location:fort", name: "旧营", description: "驻守之处", spatialDescription: "驻守之处", introduced: { age: 18 }, lastSeen: { age: 18 } }],
    abilities: [{ id: "ability:scout", name: "辨踪", description: "识别骑队行迹", usage: "识别骑队行迹", source: "巡防习得", mastery: "初通", introduced: { age: 19 }, updated: { age: 19 } }],
    currentLocationId: "location:fort"
  };
  const calls: Array<{ name: string; text: string }> = [];
  const scripts = ["hold", "advance"].flatMap((clockRequest) => [
    { name: "plan_scene_turn", args: {  actWorldCard: actWorldCardForTest({ goal: "确认后续行动", completionMeaning: "军令明确" }), clockRequest, conflictRefs: [], abilityRefs: ["ability:scout"], forceIds: [], locationDirective: { mode: "move", purpose: "接令后出营" } } },
    { name: "render_scene_prose", args: { narrative: "你仍在营中等候，军令迟迟未到，只听见值夜人的脚步。", storyDelta: "尚未接令，仍在营中等候", continuityRefs: { factIds: [], characterIds: [], locationIds: [], abilityIds: [] }, assetActivity: { locationIds: [], abilityIds: [] }, continuityRequired: false , participants: [], assetUpdates: { locations: [], abilities: [] }, factUpdates: { introduce: [], updates: [] } } },
    { name: "resolve_scene_outcome", args: { participants: [], effects: [{ stat: "intelligence", direction: "up", band: "light" }] } },
    { name: "observe_story_beat", args: { beatDecision: "hold", resolutions: [], carryFactIds: [] } }
  ]);
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string } }>; messages: Array<{ content: string }> }) => {
    const step = nextNarrativeScript(scripts, payload); assert.ok(step);
    assert.ok(payload.tools.some((tool) => tool.function.name === step.name));
    calls.push({ name: step.name, text: payload.messages.map((entry) => entry.content).join("\n") });
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: `time:${calls.length}`, type: "function", function: { name: step.name, arguments: JSON.stringify(step.args) } }] } }] };
  });
  for (const expectedAge of [20, 21]) {
    const act = definition.mainlineActs![0];
    const envelope: NarrativeTurnEnvelope = {
      callId: `clock:${expectedAge}`, source: "scene", worldId: run.worldId, currentAge: run.age,
      backgroundAgeRange: { fromAge: run.age + 1, toAge: run.age + 2 }, act, beat: "pressure", capabilities: ["scene"], storyPatterns: [], socialForces: [],
      focusReferences: [{ id: "ability:scout", kind: "ability", label: "辨踪" }, { id: "location:fort", kind: "location", label: "旧营" }],
      currentLocationId: "location:fort", statTiers: resolveNarrativeStatTiers(run.stats), clock: { ...run.narrative.sceneClock }
    };
    const turn = await runNarrativeAgentTurn({ run, world, narrativeWorld: definition,
      context: { ...memoryTestContext(run), apiKey: "not-sent", narrativePlan: buildNarrativePromptPlan(run, definition, null, "planning") }, envelope,
      buildRenderInput: (plan) => ({ act, beat: "pressure", presentation: plan.presentation, allowedTurnKinds: ["scene"],
        storyPatterns: [], socialForces: [], knownCharacters: [], knownFactIds: [], statTiers: envelope.statTiers, attributePolicy: dynamicSceneAttributePolicy(), backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run) })
    });
    assert.equal(turn.time.sceneAge, expectedAge);
    assert.equal(turn.time.previousAge, 20);
    assert.equal(turn.scene.scenePacing, expectedAge === 20 ? "continuous" : "spanning");
    const writer = calls.filter((entry) => entry.name === "render_scene_prose").at(-1)!;
    assert.ok(writer.text.includes(`当前年龄：${expectedAge}岁`), "人物介绍采用实际叙述年龄");
    assert.ok(writer.text.includes("上段已提交经历停在20岁"));
    assert.ok(writer.text.includes(expectedAge === 20 ? "本段与上段同年" : "本段已进入下一岁"));
    assert.deepEqual(turn.scene.assetActivity, { locationIds: [], abilityIds: [] });
    assert.deepEqual(turn.scene.assetUpdates, { locations: [], abilities: [] }, "规划中的移动没有成为真实到达");
    const recent = calls.slice(-3);
    for (const call of recent.filter((entry) => entry.name !== "observe_story_beat")) assert.ok(call.text.includes(`${expectedAge}岁`));
    advanceWithDynamicNarrativeScene(run, world, definition, { ...turn.scene, beat: "pressure", beatDecision: "hold", sceneAge: turn.time.sceneAge,
      sceneClockMode: turn.plan.clockRequest, attributeOutcome: { effects: turn.scene.attributeEffects! }, attributePolicy: dynamicSceneAttributePolicy() });
    run.narrative.assets = applyNarrativeAssetActivity(run.narrative.assets, turn.scene.assetActivity, { age: run.age });
    assert.equal(run.age, expectedAge);
    assert.deepEqual(run.narrative.assets.abilities[0].updated, { age: 19 });
    assert.deepEqual(run.narrative.assets.locations[0].lastSeen, { age: 18 });
    if (expectedAge === 20) {
      assert.equal(run.stats.physique, 1, "同年不额外领取家境年度增益");
      assert.equal(run.survival.lowPhysiqueYears, 1, "同年不重复累计低体魄年份");
      run.narrative = ensureNarrativeRunState(run.narrative, true);
      assert.equal(run.narrative.sceneClock.sameAgeTurnCount, 10, "恢复也不截断同年计数");
    } else assert.equal(run.survival.lowPhysiqueYears, 2, "实际跨年才累计生存年份");
  }
  assert.equal(scripts.length, 0);
});

test("摘要不改写同年展示快照，迟到批次不能覆盖较新的有效背景", () => {
  const run = makeRun(); run.narrative.enabled = true; run.age = 20;
  run.ended = true;
  const character = registerNarrativeParticipants(run, [{ characterRef: "new", name: "韩岐", role: "军士", description: "驻守营镇", recurring: true }], "origin")[0].character;
  run.narrative.assets = {
    locations: [{ id: "location:fort", name: "旧营", description: "初抵旧营", spatialDescription: "初抵旧营", introduced: { age: 20 }, lastSeen: { age: 20 } }],
    abilities: [{ id: "ability:scout", name: "辨踪", description: "分辨骑队踪迹", usage: "分辨骑队踪迹", source: "巡防习得", mastery: "初通", introduced: { age: 20 }, updated: { age: 20 } }]
  };
  const commitBatch = (prefix: string) => {
    for (let index = 0; index < 3; index++) {
      const sourceEventId = `${prefix}:${index}`;
      commitNarrativeMemory(run.narrative, { id: `memory:${sourceEventId}`, age: 20, factionIds: [], characterIds: [character.id], factIds: [],
        locationIds: ["location:fort"], abilityIds: ["ability:scout"], text: "同年经历。" });
      const turn = appendPublicTurnRecord(run, { entryId: sourceEventId, kind: "scene", narrative: "同年经历。", age: 20, ageStage: { label: "青年" }, statChanges: {} });
      commitNarrativeEpisode(run, { callId: sourceEventId, sourceEventId, turnId: turn.turnId, turnKind: "scene", age: 20, storyDelta: `${prefix}已发生的变化` });
    }
  };
  commitBatch("early");
  character.role = "将军"; character.description = "统领守军";
  run.narrative.assets.abilities[0].mastery = "熟练";
  run.narrative.assets.locations[0].description = "扩建后的驻防大营";
  let restored = JSON.parse(JSON.stringify(run)) as ReturnType<typeof makeRun>;
  restored.narrative = ensureNarrativeRunState(restored.narrative, true);
  const work = prepareNarrativeMemoryCuration(restored)!;
  assert.deepEqual(["run"], ["run"]);
  assert.equal(run.turnRecords[0].narrativeCharactersSnapshot![0].role, "军士");
  assert.equal(run.turnRecords[0].narrativeAssetsSnapshot!.abilities[0].mastery, "初通");
  assert.doesNotMatch(memoryCurationPrompt(work), /将军|统领守军|扩建后的驻防大营/);
  const digest = (id: string, summary: string) => ({ id, summary, activeFactIds: [], historicalFactIds: [], characterIds: [] });
  assert.equal(applyNarrativeMemoryCuration(run, work, { summary: "前一批经历。" }), true);
  commitBatch("later");
  const later = prepareNarrativeMemoryCuration(run)!;
  assert.equal(applyNarrativeMemoryCuration(run, later, { summary: "两批经历。" }), true);
  assert.equal(applyNarrativeMemoryCuration(run, work, { summary: "过期背景" }), false);
  assert.equal(run.narrative.memoryDigests.find((entry) => entry.id === "run")!.summary, "两批经历。");
});

test("只绑定地点时规划引用的本领仍可进入选项，审校、作答、同步、恢复与下一轮贯通", async (t) => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  const run = makeRun(); run.age = 20; run.worldId = "ancient"; run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, 20);
  run.narrative.actRuntime!.beat = "pressure";
  run.narrative.assets = {
    locations: [{ id: "location:watch", name: "山口哨所", description: "可以观察来敌的旧哨所", spatialDescription: "可以观察来敌的旧哨所", introduced: { age: 18 }, lastSeen: { age: 18 } }],
    abilities: [{ id: "ability:bow", name: "弓箭术", description: "可以射箭阻击来敌", usage: "可以射箭阻击来敌", source: "练兵", mastery: "初通", introduced: { age: 18 }, updated: { age: 18 } }]
  };
  const act = definition.mainlineActs![0];
  const options = ["safe", "balanced", "risky"].map((id) => ({ id, label: "应对来敌", description: "选用弓箭阻击，或前往新的营地求援。",
    abilityRefs: id === "risky" ? ["ability:bow"] : [],
    locationDirective: id === "safe" ? { mode: "revisit", locationRef: "location:watch" } : { mode: "move", purpose: "前往新营地求援" } }));
  const scripts: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: "plan_scene_turn", args: {  actWorldCard: actWorldCardForTest({ goal: "守住山口", completionMeaning: "来敌攻势已经得到回应" }),
      clockRequest: "hold", forceIds: [], conflictRefs: [], abilityRefs: [],
      locationDirective: { mode: "stay" }, assetNeeds: [{ kind: "ability", ref: "ability:bow", purpose: "弓箭射击来敌" }, { kind: "location", ref: "location:watch", purpose: "山口哨所观察来敌" }] } },
    { name: "render_choice_prose", args: { decisionBrief: { question: "如何应对来敌？", stakes: "防守方法与去向会改变" }, narrative: "来敌逼近山口，你带着弓站在营门，等候下一步的决定。\n\n来敌逼近山口，你带着弓站在营门，等候下一步的决定。\n\n来敌逼近山口，你带着弓站在营门，等候下一步的决定。", background: "守军尚未出动，你需要选择在山口阻击，还是离营寻求援军。",
      storyDelta: "来敌逼近，防守方式尚待选择", optionOverrides: options, continuityRefs: { factIds: [], characterIds: [], locationIds: [], abilityIds: [] }, assetActivity: { locationIds: [], abilityIds: [] }, continuityRequired: false , participants: [], assetUpdates: { locations: [], abilities: [] }, factUpdates: { introduce: [], updates: [] } } }
  ];
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string } }>; messages: Array<{ content: string }> }) => {
    const step = nextNarrativeScript(scripts, payload); assert.ok(step); assert.ok(payload.tools.some((tool) => tool.function.name === step.name));
    if (["render_choice_prose", "render_decision_outcome", "sync_narrative_continuity"].includes(step.name)) assert.ok(payload.messages.some((entry) => entry.content.includes("ability:bow")), "规划需求引用的本领直接进入执行请求");
    if (step.name === "render_choice_prose") {
      const text = payload.messages.map((entry) => entry.content).join("\n");
      assert.doesNotMatch(text, /本轮已绑定材料/);
      assert.equal(text.split("本领身份目录：").length - 1, 1, "变更与活动共用一份本领身份目录");
    }
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: step.name, type: "function", function: { name: step.name, arguments: JSON.stringify(step.args) } }] } }] };
  });
  const turn = await runNarrativeAgentTurn({ run, world, narrativeWorld: definition,
    context: { ...memoryTestContext(run), apiKey: "not-sent", narrativePlan: buildNarrativePromptPlan(run, definition, null, "planning") },
    envelope: { callId: "materials", source: "scene", worldId: "ancient", currentAge: 20,
      backgroundAgeRange: { fromAge: 21, toAge: 21 }, act, beat: "pressure", capabilities: ["scene", "choice"], storyPatterns: [], socialForces: [],
      focusReferences: [{ id: "ability:bow", kind: "ability", label: "弓箭术" }, { id: "location:watch", kind: "location", label: "山口哨所" }],
      statTiers: resolveNarrativeStatTiers(run.stats), clock: { mode: "hold", sameAgeTurnCount: 0, maxSameAgeTurns: 3 } },
    buildRenderInput: (plan) => ({ act, beat: "pressure", presentation: plan.presentation, allowedTurnKinds: ["scene"], sceneAge: 20,
      backgroundAgeRange: { fromAge: 21, toAge: 21 }, storyPatterns: [], socialForces: [], knownCharacters: [],
      statTiers: resolveNarrativeStatTiers(run.stats), attributePolicy: dynamicSceneAttributePolicy(), backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run) }) });
  assert.deepEqual(turn.scene.milestoneCopy!.optionOverrides[2].abilityRefs, ["ability:bow"]);
  const advanced = advanceWithDynamicNarrativeScene(run, world, definition, { ...turn.scene, sceneAge: turn.time.sceneAge, beat: "pressure", beatDecision: "hold", decisionBrief: turn.scene.decisionBrief, sceneClockMode: "hold" });
  applyDirectedMilestonePresentation(advanced.updated, turn.scene.milestoneCopy);
  const restored = JSON.parse(JSON.stringify(run)) as typeof run;
  restored.narrative = ensureNarrativeRunState(restored.narrative, true);
  assert.deepEqual(restored.nextMilestoneChoice!.options[2].abilityRefs, ["ability:bow"]);
  assert.equal(restored.narrative.assets!.locations.length, 1, "未来选项中的新营地还没有成为足迹");
  assert.deepEqual(restored.narrative.assets!.abilities[0].updated, { age: 18 }, "可选择本领不等于已经使用或升级");
  assert.equal(restored.age, 20);
  assert.equal(scripts.length, 0);

  const selected = restored.nextMilestoneChoice!.options[2];
  const finalText = "你以弓箭掩护同伴撤离，连发越发稳准。入夜抵达援军营地，向斥候学会了夜行辨路。";
  const actualActivity = { locationIds: [], abilityIds: ["ability:bow"] };
  const changedRefs = { factIds: [], characterIds: [], locationIds: [], abilityIds: ["ability:bow"] };
  scripts.push(
    { name: "render_decision_outcome", args: { narrative: finalText, storyDelta: "掩护撤离并抵达援军营地，学会夜行辨路", assetActivity: actualActivity, continuityRefs: changedRefs, continuityRequired: true, participants: [], assetUpdates: {
      locations: [{ ref: "new", name: "援军营地", description: "撤离后实际抵达的援军驻地", spatialDescription: "撤离后实际抵达的援军驻地", current: true }],
      abilities: [{ ref: "ability:bow", mastery: "熟练" }, { ref: "new", name: "夜行辨路", description: "在夜间辨识行军道路", usage: "在夜间辨识行军道路", source: "抵营后向斥候学得", mastery: "初通" }]
    }, factUpdates: { introduce: [], updates: [] } } },
    { name: "resolve_decision_outcome", args: { effects: [{ stat: "family", direction: "up", band: "light" }] } },
    { name: "observe_story_beat", args: { beatDecision: "hold", resolutions: [], carryFactIds: [] } }
  );
  const context = { ...memoryTestContext(restored), apiKey: "not-sent", narrativePlan: buildNarrativePromptPlan(restored, definition, null, "decision", {
    focusIds: [...selected.abilityRefs!, ...(selected.locationDirective?.locationRef ? [selected.locationDirective.locationRef] : [])],
    semanticQuery: [selected.label, selected.description, selected.locationDirective?.purpose].filter(Boolean).join("；")
  }) };
  const decision = await runNarrativeAgentDecision({ run: restored, world, narrativeWorld: definition, context, callId: "materials:answer", decision: {
    decision: "risky", label: selected.label, description: selected.description, abilityRefs: selected.abilityRefs, locationDirective: selected.locationDirective,
    attributePolicy: { allowedStats: ["family"], allowedDirections: ["up"], allowedBands: ["light"], minEffects: 1, maxEffects: 1 }
  } });
  assert.equal(restored.narrative.assets!.abilities[0].mastery, "初通", "正文只登记身份，能力变化由周期同步提炼后写入");
  const settled = applyMilestoneDecisionAndAdvance(restored, world, difficulty, "risky", { narrativeWorld: definition,
    narrativeOutcome: { effects: decision.outcome.effects }, narrative: decision.outcome.narrative, deferCompletion: true });
  const observation = await finishNarrativeAgentDecision({ run: restored, world, narrativeWorld: definition, context, callId: "materials:answer", attemptId: decision.attemptId, decision: selected, outcome: decision.outcome });
  completeMilestoneDecision(restored, settled.decisionEvent, settled.sourceEventId, settled.factIds, { narrativeWorld: definition, beatDecision: observation.decision });
  const committed = applyNarrativeAssetUpdates(applyNarrativeAssetActivity(restored.narrative.assets, decision.outcome.assetActivity, { age: restored.age }), decision.outcome.assetUpdates, { age: restored.age });
  commitNarrativeAssets(restored.narrative, committed, { age: restored.age }, {}, settled.sourceEventId);
  appendPublicTurnRecord(restored, { entryId: settled.sourceEventId, kind: "choice_outcome", narrative: decision.outcome.narrative, age: restored.age, ageStage: { label: "青年" }, statChanges: settled.decisionEvent.statChanges });
  const nextRun = JSON.parse(JSON.stringify(restored)) as typeof restored;
  nextRun.narrative = ensureNarrativeRunState(nextRun.narrative, true);
  const bow = nextRun.narrative.assets!.abilities.find((entry) => entry.id === "ability:bow")!;
  const learned = nextRun.narrative.assets!.abilities.find((entry) => entry.name === "夜行辨路")!;
  const arrived = nextRun.narrative.assets!.locations.find((entry) => entry.name === "援军营地")!;
  assert.equal(bow.mastery, "初通", "尚未到整理批次，不从正文登记字段抢先维护熟练程度");
  assert.equal(nextRun.narrative.assets!.currentLocationId, arrived.id);
  assert.equal(nextRun.narrative.assets!.abilities.length, 2);
  assert.equal(toClientRun(nextRun).narrativeAssets!.abilities.some((entry) => entry.id === learned.id), true);
  assert.equal(nextRun.turnRecords.at(-1)!.narrativeAssetsSnapshot!.currentLocationId, arrived.id);
  const nextPlan = buildNarrativePromptPlan(nextRun, definition, null, "rendering", { focusIds: [bow.id, learned.id, arrived.id], semanticQuery: "运用弓箭与夜行辨路组织营地巡防" })!;
  assert.ok([bow.id, learned.id, arrived.id].every((id) => nextPlan.recall?.assetSources?.some((entry) => entry.id === id)));
  assert.equal(nextRun.age, 20, "选择与后果保留在同年");
  assert.equal(scripts.length, 0);
});

test("回放镇北关回城选项：已有目的地按本局身份通过，选中后再召回详情", async (t) => {
  const baseWorld = await loadNarrativeWorldDefinition("ancient"); assert.ok(baseWorld);
  const pack = await loadNarrativeStoryPack(baseWorld, "ancient.frontier-commander"); assert.ok(pack);
  const definition = resolveNarrativeExperience(baseWorld, pack);
  const act = definition.mainlineActs!.find((entry) => entry.id === "ancient.frontier-commander.command")!;
  const run = makeRun(); run.age = 26; run.worldId = "ancient"; run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  run.narrative.actRuntime!.actId = act.id; run.narrative.actRuntime!.beat = "pressure";
  const cityId = "location:fff9e578-c225-4e96-a3ff-73bc274858c1";
  const currentId = "location:3dbf8ce3-157d-4b0a-bddf-2769899e59b6";
  const abilityId = "ability:1d9db034-9453-4254-ab34-4b8ce6e22b62";
  const characterId = "character:8e906be0-8b5d-4cc4-affd-04a7615c872d";
  const citySpace = "关城由城门、军营和军眷院组成，出哨归队须在城内缴还军令。";
  run.narrative.assets = {
    locations: [
      { id: cityId, name: "镇北关", description: "此前驻守的关城", spatialDescription: citySpace, introduced: { age: 0 }, lastSeen: { age: 25 } },
      { id: currentId, name: "镇北关外东北沟", description: "四骑正在分辨敌骑去向的草滩", spatialDescription: "草滩岔口分向西、南两路，敌骑留下轻重不同的蹄印。", introduced: { age: 26 }, lastSeen: { age: 26 } }
    ],
    abilities: [{ id: abilityId, name: "辨骑迹", description: "从蹄印判断敌骑去向", usage: "辨别蹄印深浅与负重，推断轻骑和辎重去向。", source: "巡哨习得", mastery: "熟练", introduced: { age: 20 }, updated: { age: 25 } }],
    currentLocationId: currentId
  };
  run.narrative.dynamicCharacters = [{ id: characterId, name: "老兵", role: "镇北关巡防哨探", description: "随主角出哨的老兵", status: "active", importance: "recurring", introducedAge: 20, lastSeenAge: 26, relatedFactIds: [], relatedRouteIds: [] }];
  const emptyChanges = { participants: [], assetUpdates: { locations: [], abilities: [] }, factUpdates: { introduce: [], updates: [] },
    continuityRefs: { factIds: [], characterIds: [], locationIds: [], abilityIds: [] }, continuityRequired: false };
  const options = [
    { id: "safe", label: "收队回城缴令", description: "弃探而归，把四骑与虚实一并带回镇北关，当面认下超期出哨与借粮之账。", abilityRefs: [], locationDirective: { mode: "revisit", locationRef: cityId } },
    { id: "balanced", label: "分骑：两骑回城报讯，你带两骑贴住重股", description: "以两骑携口信与账目回城缴令，余众短程咬住西去驮队，摸清换哨便退。", abilityRefs: [abilityId], locationDirective: { mode: "stay" } },
    { id: "risky", label: "全队咬住重股探到底", description: "不报不撤，四骑随你循重蹄印追到敌屯，赌一夜摸清辎重与换哨再回。", abilityRefs: [abilityId], locationDirective: { mode: "stay" } }
  ];
  const scripts: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: "plan_scene_turn", args: { conflictRefs: [], abilityRefs: [abilityId], assetNeeds: [{ kind: "character", ref: characterId, purpose: "同行老兵点明继续追踪与回城的风险" }],
      locationDirective: { mode: "stay" }, clockRequest: "hold", forceIds: [],  actWorldCard: actWorldCardForTest({ goal: "形成深入侦察或保全人马归队的取舍", completionMeaning: "这次无令出哨的去向与后果已经形成" }),
      } },
    { name: "render_choice_prose", args: { decisionBrief: { question: "继续咬住敌骑，还是回城缴令？", stakes: "敌情、人马安危与违令责任将随选择改变" }, ...emptyChanges,
      narrative: "草棱后风冷，你把四骑与老兵唤到一处，把话说得极直：干粮只余半日，火牌两趟已尽，这趟出哨本无令；眼前重驮那股往西，轻骑那股往南，是诱。年轻骑卒攥着缰绳，说老母在等他回城；老兵用炭条在沙上点出两条道，只说咬重股能摸出敌屯辎重与换哨时辰，回城则保得住人马，也保得住账。四人都看着你，等你一句话。",
      storyDelta: "在草滩岔口，沈氏将粮尽、火牌用尽、四骑无令续探与两股敌骑分流一并摊在众骑面前，四骑与老兵各执一说，等她当场定进退。",
      background: "景元二十五年，边饷仍欠，北虏骑部渐合。沈氏二十六岁，掌军眷院账目多年，今以火牌所领四骑深入东北沟，粮尽令绝。",
      optionOverrides: options, participants: [{ characterRef: characterId, role: "镇北关巡防哨探", description: "随沈氏深入东北沟草滩岔口，在断粮现场点明咬重股与回城各自的可追责后果，逼她定夺。" }],
      assetActivity: { locationIds: [], abilityIds: [abilityId], currentLocationId: currentId } } },
    { name: "render_decision_outcome", args: { ...emptyChanges, narrative: "你收拢四骑，沿旧道返回镇北关。天黑前人马进城，你交还军令，将两股敌骑的去向如实禀报，也认下无令续探的责任。四人平安归队，这趟侦察到此结束。",
      storyDelta: "主角带四骑平安返回镇北关，提交敌骑动向并承担无令续探的责任。", assetActivity: { locationIds: [], abilityIds: [], currentLocationId: cityId } } },
    { name: "resolve_decision_outcome", args: { effects: [{ stat: "family", direction: "up", band: "light" }] } },
    { name: "observe_story_beat", args: { beatDecision: "hold", resolutions: [], carryFactIds: [] } }
  ];
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string; parameters: { properties: Record<string, any> } } }>; messages: Array<{ content: string }> }) => {
    const step = nextNarrativeScript(scripts, payload); assert.ok(step, "只调用本次故障链路所需请求");
    const tool = payload.tools.find((entry) => entry.function.name === step.name)?.function; assert.ok(tool);
    const text = payload.messages.map((entry) => entry.content).join("\n");
    if (step.name === "render_choice_prose") {
      assert.ok(text.includes(cityId), "回城地点的完整身份已经提供给模型");
      assert.ok(!text.includes(citySpace), "待选场景只召回当前地点详情");
      assert.match(tool.parameters.properties.optionOverrides.items.properties.locationDirective.properties.locationRef.description, /本局地点身份目录/);
      assert.match(tool.parameters.properties.optionOverrides.items.properties.abilityRefs.items.description, /本轮可用材料目录/);
      assert.ok(text.includes(cityId), "目的地身份可引用，详情在作答时召回");
    }
    if (step.name === "render_decision_outcome") {
      assert.ok(text.includes(citySpace), "选中回城后召回镇北关空间详情");
      assert.ok(text.includes(`revisit:${cityId}`), "原选项目的地完整传入作答正文");
      assert.equal(run.narrative.assets!.currentLocationId, currentId, "作答正文提交前仍停留在草滩");
    }
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: step.name, type: "function", function: { name: step.name, arguments: JSON.stringify(step.args) } }] } }] };
  });
  let renderLocationIds: string[] = [];
  const turn = await runNarrativeAgentTurn({ run, world, narrativeWorld: definition,
    context: { ...memoryTestContext(run), apiKey: "not-sent", narrativePlan: buildNarrativePromptPlan(run, definition, null, "planning") },
    envelope: { callId: "replay:town-return", source: "scene", worldId: "ancient", currentAge: 26, currentLocationId: currentId,
      backgroundAgeRange: { fromAge: 27, toAge: 27 }, act, beat: "pressure", capabilities: ["scene", "choice"], storyPatterns: [], socialForces: [],
      focusReferences: [{ id: cityId, kind: "location", label: "镇北关" }, { id: currentId, kind: "location", label: "镇北关外东北沟" }, { id: abilityId, kind: "ability", label: "辨骑迹" }, { id: characterId, kind: "character", label: "老兵" }],
      statTiers: resolveNarrativeStatTiers(run.stats), clock: { mode: "hold", sameAgeTurnCount: 0, maxSameAgeTurns: 3 } },
    buildRenderInput: (plan) => {
      renderLocationIds = (plan.materials ?? []).filter((entry) => entry.kind === "location").map((entry) => entry.id);
      return { act, beat: "pressure", presentation: plan.presentation, allowedTurnKinds: ["scene"], sceneAge: 26,
        backgroundAgeRange: { fromAge: 27, toAge: 27 }, storyPatterns: [], socialForces: [], knownCharacters: [],
        statTiers: resolveNarrativeStatTiers(run.stats), attributePolicy: dynamicSceneAttributePolicy(), backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run) };
    } });
  assert.deepEqual(renderLocationIds, [currentId], "待选场景只有当前地点详情，回城目的地不提前进入材料");
  assert.deepEqual(turn.scene.milestoneCopy!.optionOverrides[0].locationDirective, options[0].locationDirective);
  const advanced = advanceWithDynamicNarrativeScene(run, world, definition, { ...turn.scene, sceneAge: turn.time.sceneAge, beat: "pressure", beatDecision: "hold", decisionBrief: turn.scene.decisionBrief, sceneClockMode: "hold" });
  applyDirectedMilestonePresentation(advanced.updated, turn.scene.milestoneCopy);
  const selected = run.nextMilestoneChoice!.options[0];
  assert.deepEqual(selected.locationDirective, options[0].locationDirective);
  const publicChoice = toPublicMilestoneChoice(run)!;
  appendPublicTurnRecord(run, { entryId: run.pendingDynamicScene!.id, kind: "scene", narrative: turn.scene.narrative,
    age: 26, ageStage: { label: "青年" }, statChanges: {} }, publicChoice);
  assert.equal(toClientRun(run).nextMilestoneChoice!.options[0].label, "收队回城缴令");
  assert.equal(run.narrative.assets!.currentLocationId, currentId, "展示选项不提前移动角色");
  const result = await runNarrativeAgentDecision({ run, world, narrativeWorld: definition, callId: "replay:town-return:answer",
    context: { ...memoryTestContext(run), apiKey: "not-sent" }, decision: { decision: "safe", label: selected.label, description: selected.description,
      abilityRefs: selected.abilityRefs, locationDirective: selected.locationDirective, decisionBrief: turn.scene.decisionBrief,
      attributePolicy: { allowedStats: ["family"], allowedDirections: ["up"], allowedBands: ["light"], minEffects: 1, maxEffects: 1 } } });
  assert.equal(result.outcome.assetActivity!.currentLocationId, cityId);
  const settled = applyMilestoneDecisionAndAdvance(run, world, difficulty, "safe", { narrativeWorld: definition,
    narrativeOutcome: { effects: result.outcome.effects }, narrative: result.outcome.narrative, deferCompletion: true });
  const observation = await finishNarrativeAgentDecision({ run, world, narrativeWorld: definition, context: { ...memoryTestContext(run), apiKey: "not-sent" }, callId: "replay:town-return:answer", attemptId: result.attemptId, choice: publicChoice, decision: selected, outcome: result.outcome });
  completeMilestoneDecision(run, settled.decisionEvent, settled.sourceEventId, settled.factIds, { narrativeWorld: definition, beatDecision: observation.decision });
  const application = applyNarrativeAssetUpdates(applyNarrativeAssetActivity(run.narrative.assets, result.outcome.assetActivity, { age: 26 }), result.outcome.assetUpdates, { age: 26 });
  commitNarrativeAssets(run.narrative, application, { age: 26 }, {}, "replay:town-return:answer");
  resolveTurnRecordChoice(run, publicChoice, publicChoice.options[0]);
  appendPublicTurnRecord(run, { entryId: settled.sourceEventId, kind: "choice_outcome", narrative: result.outcome.narrative,
    age: 26, ageStage: { label: "青年" }, statChanges: settled.decisionEvent.statChanges });
  assert.equal(toClientRun(run).narrativeAssets!.currentLocationId, cityId, "实际回城后更新前端地点");
  assert.equal(run.narrative.assets!.locations.length, 2, "返回已有地点不重复建档");
  assert.equal(scripts.length, 0, "一次规划、一次待选渲染与既有作答请求完成交接");
});

test("回放边将高潮部分绑定：三项既有本领可组合为选项，非法引用仍报告原值", async (t) => {
  const baseWorld = await loadNarrativeWorldDefinition("ancient"); assert.ok(baseWorld);
  const pack = await loadNarrativeStoryPack(baseWorld, "ancient.frontier-commander"); assert.ok(pack);
  const definition = resolveNarrativeExperience(baseWorld, pack);
  const run = makeRun(); run.age = 27; run.worldId = "ancient"; run.narrative.enabled = true;
  const locationId = "location:189f3550-33ab-4d13-8637-cc1415d22acc";
  const ids = ["ability:71c3a0fd-6a7d-41d8-98b2-8dfcc5f4e1c9", "ability:983d3ebc-a7a6-49ee-abe4-3d68d3186313", "ability:7fa55f0a-2b94-46aa-a3b7-d75e0bdba68b"];
  const names = ["远见策士", "识旗辨鼓", "王者气场"];
  run.narrative.assets = {
    locations: [{ id: locationId, name: "朔州镇北堡", description: "当前驻守的军堡", introduced: { age: 20 }, lastSeen: { age: 27 } }],
    abilities: ids.map((id, index) => ({ id, name: names[index], description: "指挥作战时可以运用的能力", usage: "指挥作战时可以运用的能力", source: "军中历练", mastery: "熟练", introduced: { age: 20 }, updated: { age: 25 } })),
    currentLocationId: locationId
  };
  const input: DynamicNarrativeSceneInput = {
    act: definition.mainlineActs![1], beat: "climax", presentation: "choice", allowedTurnKinds: ["scene"], sceneAge: 28,
    backgroundAgeRange: { fromAge: 28, toAge: 28 }, storyPatterns: [], socialForces: [], knownCharacters: [],
    statTiers: resolveNarrativeStatTiers(run.stats), attributePolicy: dynamicSceneAttributePolicy(), backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run),
    plan: { callId: "frontier-replay", turnKind: "scene", presentation: "choice", patternIds: [], forceIds: [], conflictRefs: [], abilityRefs: ids.slice(0, 2),
       clockRequest: "advance", decisionBrief: { question: "如何攻破敌营？", stakes: "行动方式与军队处境将改变" },
      materials: [{ id: locationId, kind: "location", label: "朔州镇北堡" }, ...ids.map((id, index) => ({ id, kind: "ability" as const, label: names[index] }))] }
  };
  const pairs = [[ids[1], ids[2]], [ids[0], ids[1]], [ids[0], ids[2]]];
  const options = ["safe", "balanced", "risky"].map((id, index) => ({ id, label: "选择攻势", description: "根据军情和指挥能力组织这一场攻势。", abilityRefs: pairs[index], locationDirective: { mode: "stay" } }));
  const scripts = [
    { name: "render_choice_prose", args: { decisionBrief: { question: "如何攻破敌营？", stakes: "行动方式与军队处境将改变" }, narrative: "你召集军士，铺开敌营的地形图。这一战的攻势仍待你决定。", background: "敌营就在前方，何时出兵和如何布阵，将决定这支队伍的命运。", storyDelta: "攻敌方式等待决定", optionOverrides: options,
      assetActivity: { locationIds: [locationId], currentLocationId: locationId, abilityIds: [] }, continuityRefs: { factIds: [], characterIds: [], locationIds: [], abilityIds: [] }, continuityRequired: false , participants: [], assetUpdates: { locations: [], abilities: [] }, factUpdates: { introduce: [], updates: [] } } }
  ];
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string; parameters: { properties: Record<string, any> } } }>; messages: Array<{ content: string }> }) => {
    const step = nextNarrativeScript(scripts, payload); assert.ok(step); assert.ok(payload.tools.some((tool) => tool.function.name === step.name));
    if (step.name === "render_choice_prose") {
      const text = payload.messages.map((entry) => entry.content).join("\n");
      assert.ok(ids.every((id) => text.includes(id)), "工具与模型接收完整候选引用，而非地点绑定子集");
      assert.ok(names.every((name) => text.includes(name)), "本领身份同时提供名称供模型理解");
      const abilitySchema = payload.tools.find((tool) => tool.function.name === step.name)!.function.parameters.properties.optionOverrides.items.properties.abilityRefs.items;
      assert.match(abilitySchema.description, /本轮可用材料目录/);
      assert.equal(abilitySchema.enum, undefined, "目录动态，原生 Schema 保持稳定");
    }
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: step.name, type: "function", function: { name: step.name, arguments: JSON.stringify(step.args) } }] } }] };
  });
  const beforeAssets = structuredClone(run.narrative.assets);
  const result = await generateDynamicNarrativeScene(run, world, input, { ...memoryTestContext(run, [locationId, ...ids]), apiKey: "not-sent" });
  assert.deepEqual(result.milestoneCopy!.optionOverrides.map((entry) => entry.abilityRefs), pairs);
  assert.deepEqual(input.plan!.abilityRefs, ids.slice(0, 2));
  assert.deepEqual(run.narrative.assets, beforeAssets, "生成选项不更改资产积累");
  assert.equal(scripts.length, 0, "待选场景一次渲染，没有前置结算或重试");
  assert.throws(() => normalizeMilestoneOptionOverrides([{ ...options[0], abilityRefs: ["ability:outside-run"] }, ...options.slice(1)], true, input.plan),
    (error: unknown) => error instanceof NarrativeOutcomeError && error.validation?.rule === "choice_ability_reference_invalid" && Array.isArray(error.validation.received) && error.validation.received[0] === "ability:outside-run");
});

test("正文登记同轮身份，观察器只判断节拍，失败不发布候选", async (t) => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  const base = makeRun(); base.age = 20; base.worldId = "ancient"; base.narrative.enabled = true;
  base.narrative = ensureNarrativeActRuntime(base.narrative, definition, 20);
  base.narrative.actRuntime!.beat = "pressure";
  const act = definition.mainlineActs![0];
  const [factId] = applyNarrativeFactUpdates(base, { introduce: [{ kind: "open_question", label: "来使能否平安入营" }], touchFactIds: [], resolveFactIds: [] }, { sourceEventId: "earlier", actId: act.id });
  let rejectObservation = false;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string } }>; messages: Array<{ content: string }> }) => {
    const name = payload.tools[0].function.name;
    const text = payload.messages.map((entry) => entry.content).join("\n");
    const args = name === "plan_scene_turn" ? planningReplyForTest({ conflictRefs: [], abilityRefs: [], forceIds: [], locationDirective: { mode: "stay" }, clockRequest: "hold" })
      : name === "render_scene_prose" ? { narrative: "你将来使平安护送入山口营地，与他商量驻守。", participants: [{ characterRef: "new", name: "来使" }],
        assetUpdates: { locations: [{ ref: "new", name: "山口营地", current: true }], abilities: [] }, assetActivity: { locationIds: [], abilityIds: [] } }
      : name === "resolve_scene_outcome" ? { effects: [{ stat: "intelligence", direction: "up", band: "light" }] }
      : observationReplyForTest(rejectObservation ? "unknown" : "hold");
    if (name === "observe_story_beat") assert.ok(text.includes("20岁") && text.includes("将来使平安护送"));
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: name, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] };
  });
  const execute = (run: typeof base) => runNarrativeAgentTurn({ run, world, narrativeWorld: definition,
    context: { ...memoryTestContext(run), apiKey: "not-sent" },
    envelope: { callId: "identity-facts", source: "scene", worldId: "ancient", currentAge: 20,
      backgroundAgeRange: { fromAge: 21, toAge: 21 }, act, beat: "pressure", actOutline: outlineForTest(act.id), capabilities: ["scene"],
      storyPatterns: [], socialForces: [], focusReferences: [], statTiers: resolveNarrativeStatTiers(run.stats),
      clock: { mode: "hold", sameAgeTurnCount: 0, maxSameAgeTurns: 3 } },
    buildRenderInput: (plan) => ({ act, beat: "pressure", presentation: plan.presentation, allowedTurnKinds: ["scene"], sceneAge: 20,
      backgroundAgeRange: { fromAge: 21, toAge: 21 }, storyPatterns: [], socialForces: [], knownCharacters: [],
      statTiers: resolveNarrativeStatTiers(run.stats), attributePolicy: dynamicSceneAttributePolicy(), backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run) }) });
  const run = structuredClone(base);
  const turn = await execute(run);
  assert.equal(turn.scene.factUpdates, undefined, "正文不输出另一份事实账本");
  assert.equal(run.narrative.dynamicCharacters.length, 1);
  const id = run.narrative.dynamicCharacters[0].id;
  assert.equal(turn.scene.participants[0].characterRef, id);
  assert.equal(run.narrative.dynamicCharacters[0].pendingDetails, true);
  assert.equal(run.narrative.assets!.locations[0].name, "山口营地");
  assert.equal(run.story.factLedger!.facts.find((fact) => fact.id === factId)!.status, "open", "未到同步批次时不让观察器维护事件");
  const restored = ensureNarrativeRunState(JSON.parse(JSON.stringify(run.narrative)), true);
  assert.equal(restored.dynamicCharacters[0].id, id);
  rejectObservation = true;
  const failed = structuredClone(base), before = structuredClone(failed);
  await assert.rejects(runNarrativeTurnTransaction(failed, execute), NarrativeOutcomeError);
  assert.deepEqual(failed, before);
});

test("中断背景采用实际终点正文登记轻量资产，年龄区间与身份保持一致", async (t) => {
  const run = makeRun(); run.age = 22; run.narrative.enabled = true;
  const finalText = "你在渡口病倒，渡口医者及时收留，你学会了辨认药草，但仍等候求生的机会。";
  const scripts = [
    { name: "render_background_segment", args: { narrative: finalText, storyDelta: "在渡口病倒并受医者收留", continuityRefs: { factIds: [], characterIds: [], locationIds: [], abilityIds: [] }, assetActivity: { locationIds: [], abilityIds: [] }, continuityRequired: true,
      participants: [{ characterRef: "new", name: "医者", role: "渡口医者", description: "病中收留你的人", recurring: true }], assetUpdates: {
        locations: [{ ref: "new", name: "渡口", description: "本段实际止步之处", spatialDescription: "沿河的渡船码头", current: true }],
        abilities: [{ ref: "new", name: "辨识药草", description: "识别常见药草", usage: "识别常见药草", source: "病中学得", mastery: "初通" }]
      }, factUpdates: { introduce: [{ kind: "commitment", label: "答谢医者收留", status: "open" }], updates: [] } } }
  ];
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string; parameters: { properties: Record<string, unknown> } } }>; messages: Array<{ content: string }> }) => {
    const step = nextNarrativeScript(scripts, payload); assert.ok(step); assert.ok(payload.tools.some((tool) => tool.function.name === step.name));
    if (step.name === "sync_narrative_continuity") {
      assert.ok(Object.hasOwn(payload.tools[0].function.parameters.properties, "factIntroductions"));
      assert.equal(payload.messages.map((entry) => entry.content).join("\n").split(finalText).length - 1, 1);
    }
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: step.name, type: "function", function: { name: step.name, arguments: JSON.stringify(step.args) } }] } }] };
  });
  const definition = await loadNarrativeExperienceForTest("ancient");
  const context = { ...memoryTestContext(run), apiKey: "not-sent" };
  run.worldId = definition.worldId;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  const rendered = await renderInterruptedBackground(run, world, context, 21, []);
  assert.equal(scripts.length, 0, "重绘同时提出实际变化，不额外请求同步");
  assert.equal(run.narrative.assets?.locations.length ?? 0, 0, "实际终点被接受前不提交生成提案");
  const result = (await synchronizeNarrativeAgentScene({
    run, world, narrativeWorld: definition, context, callId: "accepted-background",
    scene: { ...rendered, turnKind: "background", patternIds: [], forceIds: [] },
    plan: { callId: "accepted-background", turnKind: "background", presentation: "summary", patternIds: [], forceIds: [], conflictRefs: [], abilityRefs: [],  clockRequest: "advance" },
    promptPlan: buildNarrativePromptPlan(run, definition, null, "background")!
  })).scene;
  const source = `background:21:22:${run.history.length}`;
  assert.equal(result.factUpdates, undefined);
  registerNarrativeParticipants(run, result.participants, source, [], result.handoff!.characters);
  commitNarrativeAssets(run.narrative, applyNarrativeAssetUpdates(run.narrative.assets, result.assetUpdates, { ageFrom: 21, age: 22 }), { ageFrom: 21, age: 22 }, {}, source);
  assert.equal(result.handoff!.sourceEventId, source);
  assert.equal(run.narrative.assets!.locations[0].introduced.age, 22);
  assert.equal(run.narrative.assets!.abilities[0].introduced.age, 22);
  assert.equal(run.narrative.dynamicCharacters[0].id, result.participants![0].characterRef);
  assert.equal(scripts.length, 0);
});



test("规划完整引用保留用途，省略前缀不会被静默丢弃或自动恢复", () => {
  const run = makeRun();
  const abilityId = "ability:2a7ab99f-10e5-4d38-ae18-3a641c699e70";
  const locationId = "location:aeb415ee-ac02-4ced-9166-bd353b4711e5";
  const cardId = "ancient.domain.military.reconnaissance";
  const envelope: NarrativeTurnEnvelope = {
    callId: "refs:plan", source: "scene", worldId: "ancient", currentAge: 20,
    backgroundAgeRange: { fromAge: 21, toAge: 21 }, act: { id: "act.one", label: "守关", prompt: "面对来敌" }, beat: "pressure",
    capabilities: ["scene"], storyPatterns: [], socialForces: [], currentLocationId: locationId,
    focusReferences: [{ id: abilityId, kind: "ability", label: "弓箭术" }, { id: locationId, kind: "location", label: "山口" }, { id: cardId, kind: "world_card", label: "斥候、地形与敌情" }],
    statTiers: resolveNarrativeStatTiers(run.stats), clock: { mode: "hold", sameAgeTurnCount: 0, maxSameAgeTurns: 3 }
  };
  const args = { beatChange: "守住山口", timeScope: "同年完成阻击", note: "", abilityRefs: [{ ref: abilityId, purpose: "阻击来敌" }], conflictRefs: [], forceIds: [], clockRequest: "hold",
    locationDirective: { mode: "revisit", locationRef: locationId }, actWorldCard: actWorldCardForTest({ goal: "守住山口", completionMeaning: "来敌得到回应" }),
    assetNeeds: [{ kind: "ability", ref: abilityId, purpose: "阻击来敌" }] };
  const plan = parseNarrativeTurnPlan(args, "plan_scene_turn", envelope);
  assert.deepEqual(plan.abilityRefs, [abilityId]);
  assert.equal(plan.assetNeeds![0].purpose, "阻击来敌");
  const schema = JSON.stringify(narrativeTurnPlanTools({ ...envelope, actOutline: outlineForTest(envelope.act.id) }));
  assert.match(schema, /原样复制 abilityRefs 目录/);
  assert.equal(schema.includes(abilityId), false, "引用说明稳定，具体目录仍在动态输入中");
  const prompt = narrativeTurnPlanningPrompt({ ...envelope, actOutline: outlineForTest(envelope.act.id) });
  assert.ok(prompt.includes(abilityId) && prompt.includes(locationId));
  assert.ok(prompt.includes(JSON.stringify({ id: cardId, kind: "world_card", label: "斥候、地形与敌情" })));
  assert.equal(prompt.includes(`${cardId}=world_card:`), false);
  assert.deepEqual(parseNarrativeTurnPlan({ ...args, conflictRefs: [{ ref: cardId, purpose: "判断山口的防守条件" }] }, "plan_scene_turn", envelope).conflictRefs, [cardId]);
  const decoratedRef = `${cardId}=world_card:斥候、地形与敌情`;
  assert.throws(() => parseNarrativeTurnPlan({ ...args, conflictRefs: [{ ref: decoratedRef, purpose: "防守" }] }, "plan_scene_turn", envelope),
    (error: unknown) => error instanceof NarrativeOutcomeError && error.validation?.path === "conflictRefs[0].ref" && error.validation.received === decoratedRef);
  assert.throws(() => parseNarrativeTurnPlan({ ...args, abilityRefs: [{ ref: abilityId.slice("ability:".length), purpose: "阻击" }] }, "plan_scene_turn", envelope),
    (error: unknown) => error instanceof NarrativeOutcomeError && error.validation?.path === "abilityRefs[0].ref" && error.validation.received === abilityId.slice("ability:".length));
  assert.throws(() => parseNarrativeTurnPlan({ ...args, locationDirective: { mode: "revisit", locationRef: locationId.slice("location:".length) } }, "plan_scene_turn", envelope),
    (error: unknown) => error instanceof NarrativeOutcomeError && error.validation?.path === "locationDirective.locationRef");
  assert.deepEqual(parseNarrativeTurnPlan({ ...args, abilityRefs: [], assetNeeds: [{ kind: "ability", purpose: "学习新的护阵能力" }] }, "plan_scene_turn", envelope).assetNeeds,
    [{ kind: "ability", purpose: "学习新的护阵能力" }]);
});

test("边将规划目录原样引用贯通素材、移动和新资产登记，错误引用不发布本轮", async (t) => {
  const baseWorld = await loadNarrativeWorldDefinition("ancient"); assert.ok(baseWorld);
  const storyPack = await loadNarrativeStoryPack(baseWorld, "ancient.frontier-commander"); assert.ok(storyPack);
  const definition = resolveNarrativeExperience(baseWorld, storyPack);
  const base = makeRun(); base.age = 20; base.worldId = "ancient"; base.narrative.enabled = true;
  base.narrative = ensureNarrativeActRuntime(base.narrative, definition, base.age);
  base.narrative.actRuntime!.beat = "pressure";
  const act = definition.mainlineActs![0];
  const [fatherId, scoutId] = registerNarrativeParticipants(base, [
    { characterRef: "new", name: "父亲", role: "哨骑", description: "带领巡防的父亲", recurring: true },
    { characterRef: "new", name: "老哨骑", role: "斥候", description: "熟悉黑石滩的斥候", recurring: true }
  ], "origin").map((entry) => entry.character.id);
  const initialAssets = applyNarrativeAssetUpdates(base.narrative.assets, {
    locations: [{ ref: "new", name: "白石关", description: "此前居住的关城", spatialDescription: "扼守驼道的关城", current: true }],
    abilities: [{ ref: "new", name: "骑乘", description: "随父亲习得骑术", usage: "骑马短途巡行，尚不能骑射", source: "父亲传授", mastery: "初通" }]
  }, { age: 18 });
  base.narrative.assets = initialAssets.assets;
  const abilityId = initialAssets.abilityIds[0], locationId = initialAssets.locationIds[0];
  const [factId] = applyNarrativeFactUpdates(base, { introduce: [{ kind: "open_question", label: "黑石滩掠骑规模尚待实地确认" }], touchFactIds: [], resolveFactIds: [] }, { sourceEventId: "scouting", actId: act.id });
  const cardIds = ["ancient.domain.military.reconnaissance", "ancient.domain.military.logistics_morale"];
  const selectedCards = cardIds.map((id) => { const found = definition.worldCards!.find((entry) => entry.id === id); assert.ok(found); return found; });
  const socialForces = definition.socialForces!;
  const assetNeeds = [
    { kind: "location", purpose: "黑石滩外围的哨铺与驼道现场，用于实地核验掠骑痕迹" },
    { kind: "character", purpose: "常驻哨铺的哨长，提供实据并检验主角的判断" },
    { kind: "ability", purpose: "由哨长传授实地验迹之法，判断掠骑人数与去向" }
  ];
  let invalidRef = false;
  const calls: string[] = [];
  const requests: Array<{ name: string; text: string; system: string }> = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string; parameters: { required: string[] } } }>; messages: Array<{ role: string; content: string }> }) => {
    const name = payload.tools[0].function.name;
    calls.push(name);
    const text = payload.messages.map((entry) => entry.content).join("\n");
    requests.push({ name, text, system: payload.messages.find((entry) => entry.role === "system")!.content });
    let args: Record<string, unknown>;
    if (name === "plan_scene_turn") {
      args = { conflictRefs: [fatherId, scoutId, ...cardIds.map((id, index) => invalidRef ? `${id}=world_card:${selectedCards[index].title}` : id)], abilityRefs: [abilityId],
        locationDirective: { mode: "move", purpose: "随父亲出关到黑石滩哨铺，将口头推断落到实地" },
         clockRequest: "advance",
        forceIds: ["ancient.military", "ancient.markets"], assetNeeds,
        actWorldCard: actWorldCardForTest({ goal: "确认敌方骑兵动向", completionMeaning: "已用实地证据判断掠骑规模与去向" }) };
    } else if (name === "render_scene_prose") {
      args = { narrative: "你骑马随父亲抵达黑石滩哨铺。哨长教你辨认蹄印深浅和马蹄铁式样，你沿驼道核验，确认数十骑刚向北撤去，并把判断当面报给父亲。",
        storyDelta: "抵达黑石滩哨铺，习得验迹并确认掠骑北撤", continuityRefs: { factIds: [], characterIds: [], locationIds: [], abilityIds: [] },
        assetActivity: { locationIds: [], abilityIds: [abilityId] }, continuityRequired: true,
        participants: [{ characterRef: fatherId }, { characterRef: "new", name: "黑石滩哨长", role: "哨长", description: "传授验迹并核实军情的守军", recurring: true }],
        assetUpdates: { locations: [{ ref: "new", name: "黑石滩哨铺", description: "本次巡防抵达的驻地", spatialDescription: "黑石滩外围紧邻驼道的哨铺", current: true }],
          abilities: [{ ref: "new", name: "实地验迹", description: "哨长在巡防中传授的验迹方法", usage: "读蹄印和遗落物估计骑兵规模、去向，雨后难以判断旧迹", source: "黑石滩哨长传授", mastery: "初通" }] },
        factUpdates: { introduce: [], updates: [] } };
    } else if (name === "resolve_scene_outcome") {
      args = { effects: [{ stat: "intelligence", direction: "up", band: "light" }] };
    } else {
      assert.equal(name, "observe_story_beat");
      args = observationReplyForTest("hold");
    }
    if (name === "plan_scene_turn") {
      if (payload.tools[0].function.parameters.required.includes("actWorldCard")) args = { actWorldCard: args.actWorldCard };
      else { delete args.actWorldCard; args = planningReplyForTest(args); }
    }
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: name, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] };
  });
  const execute = (run: typeof base) => {
    const promptPlan = buildNarrativePromptPlan(run, definition, null, "planning")!;
    assert.ok(cardIds.every((id) => promptPlan.activeWorldCardSources!.some((card) => card.id === id)));
    const envelope: NarrativeTurnEnvelope = { callId: "frontier-directory", source: "scene", worldId: "ancient", currentAge: 20,
      backgroundAgeRange: { fromAge: 21, toAge: 21 }, act, beat: "pressure", capabilities: ["scene"], storyPatterns: [], socialForces,
      focusReferences: [
        ...promptPlan.activeWorldCardSources!.map((card) => ({ id: card.id, kind: "world_card" as const, label: card.title ?? card.id })),
        { id: fatherId, kind: "character", label: "父亲" }, { id: scoutId, kind: "character", label: "老哨骑" },
        ...narrativeAbilityDirectory(run.narrative.assets).map((entry) => ({ id: entry.id, kind: "ability" as const, label: entry.label })),
        ...narrativeLocationDirectory(run.narrative.assets).map((entry) => ({ id: entry.id, kind: "location" as const, label: entry.label })),
        { id: factId, kind: "fact", label: "黑石滩掠骑规模尚待实地确认" }
      ], currentLocationId: locationId, statTiers: resolveNarrativeStatTiers(run.stats), clock: { mode: "advance", sameAgeTurnCount: 0, maxSameAgeTurns: 3 } };
    return runNarrativeAgentTurn({ run, world, narrativeWorld: definition, context: { ...memoryTestContext(run), apiKey: "not-sent", narrativePlan: promptPlan }, envelope,
      buildRenderInput: () => ({ act, beat: "pressure", presentation: "scene", allowedTurnKinds: ["scene"], sceneAge: 20, backgroundAgeRange: { fromAge: 21, toAge: 21 },
        storyPatterns: [], socialForces, knownCharacters: [], statTiers: resolveNarrativeStatTiers(run.stats), attributePolicy: dynamicSceneAttributePolicy(), backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run) }) });
  };
  const run = structuredClone(base);
  const turn = await execute(run);
  assert.deepEqual(calls, ["plan_scene_turn", "plan_scene_turn", "render_scene_prose", "resolve_scene_outcome", "observe_story_beat"], "幕初建立大纲后选材，不重复规划剧情");
  const planner = requests.filter((entry) => entry.name === "plan_scene_turn").at(-1)!;
  for (const card of selectedCards) assert.ok(planner.text.includes(JSON.stringify({ id: card.id, kind: "world_card", label: card.title ?? card.id })));
  assert.ok(planner.text.includes(JSON.stringify({ id: abilityId, kind: "ability", label: narrativeAbilityDirectory(base.narrative.assets)[0].label })));
  assert.ok(planner.text.includes(JSON.stringify({ id: locationId, kind: "location", label: narrativeLocationDirectory(base.narrative.assets)[0].label, current: true })));
  assert.equal(planner.text.split(`"id":"${factId}","kind":"fact",`).length - 1, 1, "事实由事实提供器注入一次");
  assert.ok(planner.text.includes("黑石滩掠骑规模尚待实地确认"));
  assert.ok(planner.text.includes(run.narrative.actRuntime!.outline!.beats.pressure.change), "召回实际收到本幕选定的当前改变");
  const writer = requests.find((entry) => entry.name === "render_scene_prose")!;
  for (const card of selectedCards) assert.ok(writer.text.includes(card.content), "选中的完整世界材料到达正文请求");
  for (const need of assetNeeds) assert.ok(writer.text.includes(need.purpose), "新对象需求原样交给正文请求");
  assert.ok(writer.text.includes("骑乘（初通）"));
  assert.ok(!writer.text.includes(base.narrative.assets!.abilities[0].usage!));
  assert.match(requests.find((entry) => entry.name === "resolve_scene_outcome")!.text, /确认数十骑刚向北撤去/);
  assert.ok(cardIds.every((id) => turn.worldCardIds.includes(id)));
  assert.deepEqual(turn.plan.assetNeeds, assetNeeds);
  advanceWithDynamicNarrativeScene(run, world, definition, { ...turn.scene, sceneAge: turn.time.sceneAge, beat: "pressure", beatDecision: "hold", sceneClockMode: "advance", attributePolicy: dynamicSceneAttributePolicy(), attributeOutcome: { effects: turn.scene.attributeEffects! } });
  commitNarrativeAssets(run.narrative, applyNarrativeAssetUpdates(run.narrative.assets, turn.scene.assetUpdates, { age: 21 }), { age: 21 }, {}, turn.scene.handoff!.sourceEventId);
  const episode = commitNarrativeEpisode(run, { callId: turn.plan.callId, sourceEventId: turn.scene.handoff!.sourceEventId, turnKind: "scene", age: 21, actId: act.id, beat: "pressure", storyDelta: turn.scene.narrative });
  commitNarrativeAgentTurn(run, turn.attemptId, episode.id);
  assert.equal(run.age, 21);
  assert.equal(run.narrative.assets!.locations.find((entry) => entry.id === run.narrative.assets!.currentLocationId)!.name, "黑石滩哨铺");
  assert.deepEqual(run.narrative.assets!.abilities.map((entry) => entry.name), ["骑乘", "实地验迹"]);
  assert.ok(run.narrative.dynamicCharacters.some((entry) => entry.name === "黑石滩哨长"));
  assert.equal(run.story.factLedger!.facts.find((entry) => entry.id === factId)!.status, "open", "事件等待连续性批次整理，观察器不直接关闭");
  assert.ok(cardIds.every((id) => run.narrative.worldCardActivations!.some((entry) => entry.cardId === id)));
  const callsBeforeFailure = calls.length;
  const failed = structuredClone(base), before = structuredClone(failed);
  invalidRef = true;
  await assert.rejects(runNarrativeTurnTransaction(failed, execute), (error: unknown) => error instanceof NarrativeOutcomeError && error.validation?.path === "conflictRefs[2].ref");
  assert.deepEqual(calls.slice(callsBeforeFailure), ["plan_scene_turn", "plan_scene_turn", "plan_scene_turn"], "幕初大纲完成后，只纠正失败选材一次，不重跑大纲或正文");
  assert.deepEqual(failed, before, "错误引用不发布人物、资产、事实或素材冷却");
});

test("摘要只交接旧背景与本区间，模型返回更新后的摘要而非维护多类引用", () => {
  const run = makeRun(); run.ended = true;
  commitNarrativeEpisode(run, { callId: "first", sourceEventId: "first", turnKind: "scene", age: 20, storyDelta: "开始守关，结识同伴。" });
  const first = prepareNarrativeMemoryCuration(run)!;
  assert.equal(applyNarrativeMemoryCuration(run, first, parseNarrativeMemoryCuration({ summary: "主角开始守关，结识同伴。" }, first)), true);
  commitNarrativeEpisode(run, { callId: "second", sourceEventId: "second", turnKind: "scene", age: 21, storyDelta: "守关成功，被任命为队长。" });
  const work = prepareNarrativeMemoryCuration(run)!;
  const prompt = memoryCurationPrompt(work);
  assert.ok(prompt.includes("上一版长期记忆（与新增经历整合后整体替换）：主角开始守关，结识同伴。"));
  assert.ok(prompt.includes("21岁：\n守关成功，被任命为队长。"));
  assert.doesNotMatch(prompt, /当前幕组织背景|当前字段|已提交事实的当前状态/);
  assert.equal(applyNarrativeMemoryCuration(run, work, { summary: "主角守关成功，与军中同伴建立信任并升为队长。" }), true);
  assert.equal(prepareNarrativeMemoryCuration(run), undefined);
  assert.equal(applyNarrativeMemoryCuration(run, first, { summary: "过期" }), false);
});

test("仅使用已有本领和地点的抉择直接结算，活动展示保存且稳定档案不重写", async (t) => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  definition.worldCards = [{ id: "test.decision-voice", kind: "style_example", content: "写出行动之后眼前可见的余波。", priority: 90,
    activation: { tasks: ["decision"] }, cooldownTurns: 2 }];
  const run = makeRun(); run.age = 20; run.worldId = "ancient"; run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, 20);
  run.narrative.actRuntime!.beat = "pressure";
  run.narrative.assets = { currentLocationId: "location:watch",
    locations: [{ id: "location:watch", name: "山口", description: "守军的哨所", spatialDescription: "狭窄的山口", introduced: { age: 18 }, lastSeen: { age: 18 } }],
    abilities: [{ id: "ability:bow", name: "弓箭术", description: "随军学会射箭", usage: "远程阻击", source: "练兵", mastery: "初通", introduced: { age: 18 }, updated: { age: 18 } }] };
  const previous = structuredClone(run.narrative.assets);
  const activity = { locationIds: ["location:watch"], currentLocationId: "location:watch", abilityIds: ["ability:bow"] };
  const narrative = "你在山口用弓箭掩护同伴撤离，直到队伍退回哨所。";
  const scripts = [
    { name: "render_decision_outcome", args: { narrative, storyDelta: "掩护同伴安全撤回哨所", assetActivity: activity,
      continuityRefs: { factIds: [], characterIds: [], locationIds: [], abilityIds: [] }, continuityRequired: false, participants: [], assetUpdates: { locations: [], abilities: [] }, factUpdates: { introduce: [], updates: [] } } },
    { name: "resolve_decision_outcome", args: { effects: [{ stat: "fortune", direction: "up", band: "light" }] } }
  ];
  const calls: string[] = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string } }>; messages: Array<{ content: string }> }) => {
    const step = nextNarrativeScript(scripts, payload); assert.ok(step); assert.ok(payload.tools.some((tool) => tool.function.name === step.name));
    const text = payload.messages.map((entry) => entry.content).join("\n");
    if (step.name === "render_decision_outcome") {
      assert.ok(text.includes("ability:bow") && text.includes("location:watch"));
      assert.ok(text.includes("写出行动之后眼前可见的余波"));
    }
    if (step.name === "resolve_decision_outcome") assert.ok(text.includes(narrative), "结算使用最终正文");
    calls.push(step.name);
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: step.name, type: "function", function: { name: step.name, arguments: JSON.stringify(step.args) } }] } }] };
  });
  const result = await runNarrativeAgentDecision({ run, world, narrativeWorld: definition, context: { ...memoryTestContext(run), apiKey: "not-sent" }, callId: "activity:only",
    decision: { decision: "safe", label: "掩护撤退", description: "在山口使用弓箭掩护同伴", abilityRefs: ["ability:bow"], locationDirective: { mode: "stay", locationRef: "location:watch" },
      attributePolicy: { allowedStats: ["fortune"], allowedDirections: ["up"], allowedBands: ["light"], minEffects: 1, maxEffects: 1 } } });
  assert.deepEqual(calls, ["render_decision_outcome", "resolve_decision_outcome"]);
  assert.deepEqual(result.outcome.assetUpdates, { locations: [], abilities: [] });
  const episode = commitNarrativeEpisode(run, { callId: "activity:only", sourceEventId: "activity:only", turnKind: "decision", age: 20 });
  commitNarrativeAgentTurn(run, result.attemptId, episode.id);
  assert.deepEqual(run.narrative.worldCardActivations?.map((entry) => entry.cardId), ["test.decision-voice"]);
  run.narrative.assets = applyNarrativeAssetActivity(run.narrative.assets, result.outcome.assetActivity, { age: run.age });
  appendPublicTurnRecord(run, { entryId: "activity:only", kind: "choice_outcome", narrative: result.outcome.narrative, age: 20, ageStage: { label: "青年" }, statChanges: {} });
  assert.deepEqual(run.narrative.assets.abilities, previous.abilities);
  assert.equal(run.narrative.assets.locations[0].description, previous.locations[0].description);
  assert.deepEqual(run.narrative.assets.locations[0].lastSeen, { age: 20 });
  assert.equal(run.turnRecords.at(-1)!.narrativeAssetsSnapshot!.abilities[0].name, "弓箭术");
  assert.equal(run.age, 20);
  assert.equal(scripts.length, 0);
});



test("三世界的压力和高潮可直接叙事，同年保持且无需生成新的抉择", async () => {
  for (const worldId of ["ancient", "modern", "fantasy"]) {
    const definition = await loadNarrativeExperienceForTest(worldId);
    for (const beat of ["pressure", "climax"] as const) {
      const run = makeRun();
      run.narrative.enabled = true;
      run.narrative = ensureNarrativeActRuntime(run.narrative, definition, 20);
      run.narrative.actRuntime!.beat = beat;
      run.age = 20;
      run.stats.physique = 100;
      run.narrative.activeScene = { id: "active", threadId: `arc:${run.narrative.actRuntime!.actId}`, phase: beat, mainlineActId: run.narrative.actRuntime!.actId, openedAge: 20, lastTouchedAge: 20 };
      run.narrative.sceneClock.mode = "hold";
      const policy = dynamicSceneAttributePolicy();
      const toolSet = dynamicNarrativeSceneTools({
        act: { id: run.narrative.actRuntime!.actId, label: "当前幕", prompt: "当前幕发展" }, beat, presentation: "scene", allowedTurnKinds: ["scene"],
        sceneAge: 20, backgroundAgeRange: { fromAge: 21, toAge: 21 }, storyPatterns: [], socialForces: [], knownCharacters: [], knownFactIds: [],
        statTiers: { intelligence: "steady", charisma: "steady", family: "steady", fortune: "steady", physique: "steady" },
        attributePolicy: policy, backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run)
      });
      assert.deepEqual(toolSet.names, ["resolve_scene_outcome"]);
      const directScene = (beatDecision: "hold" | "advance") => advanceWithDynamicNarrativeScene(run, world, definition, {
        patternIds: [], forceIds: [], beat, beatDecision, narrative: "你完成先前决定的行动，新的处境已经形成。", participants: [],
        attributePolicy: policy, attributeOutcome: { effects: [{ stat: "intelligence", direction: "up", band: "light" }] }, createsDecision: false
      });
      directScene("hold");
      assert.equal(run.narrative.actRuntime!.beat, beat);
      assert.equal(run.narrative.climaxCount, 0);
      directScene("advance");
      assert.equal(run.age, 20);
      assert.equal(run.nextMilestoneChoice, undefined);
      assert.equal(run.pendingDynamicScene, undefined);
      assert.equal(run.narrative.actRuntime!.beat, beat === "pressure" ? "climax" : "payoff");
      assert.equal(run.narrative.climaxCount, beat === "climax" ? 1 : 0);
      assert.ok(run.history.at(-1)?.statChanges.intelligence);
    }
  }
});

test("同名新资产保持独立，实际登记 ID 贯通经历链接和公开档案", () => {
  const run = makeRun();
  commitNarrativeMemory(run.narrative, { id: "memory:second", age: 13, text: "你转入步营，学会步战连珠箭。", characterIds: [], factionIds: [], factIds: [] });
  const additions = {
    locations: [{ ref: "new", name: "校场", description: "关外骑营的校场", spatialDescription: "关外平地", current: true }],
    abilities: [{ ref: "new", name: "箭术", description: "骑营所授的骑射", usage: "驰马开弓", source: "骑营", mastery: "初通" }]
  };
  const first = commitNarrativeAssets(run.narrative, applyNarrativeAssetUpdates(undefined, additions, { age: 12 }), { age: 12 }, {}, "first");
  const second = commitNarrativeAssets(run.narrative, applyNarrativeAssetUpdates(run.narrative.assets, {
    locations: [{ ...additions.locations[0], description: "城中步营的校场", spatialDescription: "城内围墙" }],
    abilities: [{ ...additions.abilities[0], description: "步营所授的连珠箭", usage: "步战连续射击" }]
  }, { age: 13 }), { age: 13 }, {}, "second");
  assert.notEqual(first.locationIds[0], second.locationIds[0]);
  assert.notEqual(first.abilityIds[0], second.abilityIds[0]);
  assert.deepEqual(run.narrative.memoryEntries.find((entry) => entry.id === "memory:second")!.locationIds, second.locationIds);
  assert.equal(run.narrative.assets!.currentLocationId, second.locationIds[0]);
  registerNarrativeParticipants(run, [{ characterRef: "new", name: "李校尉", role: "骑营校尉", description: "关外驻防", recurring: true }], "first");
  registerNarrativeParticipants(run, [{ characterRef: "new", name: "李校尉", role: "步营校尉", description: "城中驻防", recurring: true }], "second");
  assert.equal(run.narrative.dynamicCharacters.length, 2);
  appendPublicTurnRecord(run, { entryId: "second", kind: "scene", age: 13, ageStage: { label: "少年" }, narrative: "你转入步营，学会步战连珠箭。", statChanges: {} });
  assert.equal(toClientRun(run).narrativeAssets!.abilities.length, 2);
  assert.equal(toClientRun(run).narrativeCharacters!.length, 2);
});


test("终幕 payoff 抉择与结果可同年延续，观察完成后才写结论和开放结局", async (t) => {
  const definition: NarrativeWorldDefinition = {
    ...narrativeWorld, version: 9, storyPatterns: [], socialForces: [],
    mainlineFacts: [{ id: "war", kind: "open_question", label: "敌军入侵能否结束" }],
    mainlineActs: [{ id: "act.final", label: "平定边患", prompt: "击退入侵并决定战后安排", introduceFactIds: ["war"], resolveFactIds: ["war"] }]
  };
  const run = makeRun(); run.age = 20; run.stats.physique = 100; run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, 20);
  advanceWithDynamicNarrativeScene(run, world, definition, {
    patternIds: [], forceIds: [], beat: "setup", beatDecision: "advance", sceneAge: 20,
    narrative: "敌军入侵，你承担守关职责。", participants: [],
    attributePolicy: dynamicSceneAttributePolicy(), attributeOutcome: { effects: [{ stat: "intelligence", direction: "up", band: "light" }] }
  });
  run.narrative.actRuntime!.beat = "payoff"; run.narrative.climaxCount = 1;
  const scene = () => advanceWithDynamicNarrativeScene(run, world, definition, {
    patternIds: [], forceIds: [], beat: "payoff", beatDecision: "advance", createsDecision: true,
    narrative: "敌军撤退后，停战条件尚待你的答复。", participants: [], sceneAge: 20, sceneClockMode: "hold"
  });
  scene();
  assert.equal(run.narrative.payoffCount, 0);
  assert.ok(run.narrative.activeScene && run.nextMilestoneChoice);
  assert.equal(canRequestDirectedClosure(run, definition), false);
  let complete = false;
  const handoff = { resolvedTension: "敌军退回界外，双方停止交战", lastingConsequence: "你保住关城并获封侯", continuation: "留守重建防务" };
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string } }>; messages: Array<{ content: string }> }) => {
    const name = payload.tools[0].function.name;
    const args = name === "render_decision_outcome" ? {
      narrative: complete ? "你签定停战条件，敌军退出关外。守军归营，你因守关之功获封侯。" : "你提出撤军条件，敌方使者须回营取得授权，战后安排仍未落定。",
      storyDelta: complete ? "敌军撤出，停战落定，主角获封侯" : "停战条件送往敌营，等待授权",
      assetActivity: { locationIds: [], abilityIds: [] }, continuityRefs: { factIds: [], characterIds: [], locationIds: [], abilityIds: [] }, continuityRequired: false
    , participants: [], assetUpdates: { locations: [], abilities: [] }, factUpdates: { introduce: [], updates: [] } } : name === "resolve_decision_outcome" ? { effects: [{ stat: "fortune", direction: "up", band: "light" }] }
      : name === "sync_narrative_continuity" ? { locationUpdates: [], abilityUpdates: [], identityMerges: [], relationshipUpdates: [], factIntroductions: [], factUpdates: [] }
      : observationReplyForTest(complete ? "advance" : "hold");
    assert.ok(["render_decision_outcome", "resolve_decision_outcome", "observe_story_beat", "sync_narrative_continuity"].includes(name), "干净正文不强制再整理");
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: name, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] };
  });
  const choose = async () => {
    const pending = structuredClone(run.pendingDynamicScene!);
    const result = await runNarrativeAgentDecision({ run, world, narrativeWorld: definition, context: { ...memoryTestContext(run), apiKey: "not-sent" }, callId: `payoff:${complete}`,
      decision: { decision: "safe", label: "停战并守关", description: "确认敌军撤出再停止交战", attributePolicy: { allowedStats: ["fortune"], allowedDirections: ["up"], allowedBands: ["light"], minEffects: 1, maxEffects: 1 } } });
    const settled = applyMilestoneDecisionAndAdvance(run, world, difficulty, "safe", { narrativeWorld: definition,
      narrative: result.outcome.narrative, narrativeOutcome: { effects: result.outcome.effects }, deferCompletion: true });
    const observation = await finishNarrativeAgentDecision({ run, world, narrativeWorld: definition, context: { ...memoryTestContext(run), apiKey: "not-sent" }, callId: `payoff:${complete}`, attemptId: result.attemptId, decision: { label: "停战并守关", description: "确认敌军撤出再停止交战" }, outcome: result.outcome });
    completeMilestoneDecision(run, settled.decisionEvent, settled.sourceEventId, settled.factIds, { narrativeWorld: definition, beatDecision: observation.decision });
    commitNarrativeEpisode(run, { callId: `payoff:${complete}`, sourceEventId: settled.sourceEventId, turnKind: "decision", age: 20, actId: pending.mainlineActId, beat: "payoff", storyDelta: result.outcome.narrative });
    return settled;
  };
  await choose();
  assert.equal(run.age, 20);
  assert.equal(run.narrative.actRuntime!.beat, "payoff");
  assert.equal(run.narrative.payoffCount, 0);
  assert.equal(run.narrative.actCanon.length, 0);
  assert.equal(canRequestDirectedClosure(run, definition), false);
  scene(); complete = true;
  const settled = await choose();
  assert.equal(run.age, 20);
  assert.equal(run.narrative.payoffCount, 1);
  assert.equal(run.narrative.completedScenes.length, 1);
  assert.equal(run.narrative.activeScene, undefined);
  assert.equal(run.narrative.actCanon[0].sourceEventId, settled.sourceEventId);
  assert.equal(run.narrative.actCanon[0].resolvedAge, 20);
  assert.equal(run.story.factLedger!.facts.find((fact) => fact.id === "war")!.status, "resolved");
  assert.equal(canRequestDirectedClosure(run, definition), true);
  assert.equal(run.ended, false, "确认幕间完成只开放结局申请");
  assert.equal(prepareNarrativeMemoryCuration(run), undefined, "终幕已结束但结局正文尚未提交，暂不启动终局压缩");
  commitNarrativeEpisode(run, { callId: "ending", sourceEventId: "ending", turnKind: "ending", age: 20, storyDelta: "主角封侯，留守边关" });
  run.ended = true;
  assert.ok(prepareNarrativeMemoryCuration(run)!.episodeIds.includes("episode:ending"), "结局提交后与终幕实际结论一起压缩");
});

test("未满十年仍可由幕间完成触发压缩，摘要不淘汰新幕和同年经历", () => {
  const run = makeRun();
  run.aiConversation = { year: { systemHash: "test", headCore: "", headMemory: "", archive: [], history: [] } };
  const add = (i: number, actId: string, text: string) => {
    const source = `interval:${i}`;
    const episode = commitNarrativeEpisode(run, { callId: source, sourceEventId: source, turnKind: "scene", age: 9, actId, storyDelta: text });
    recordDirectedStoryTurnOutcome(memoryTestContext(run), run, { kind: "normal", sourceEventId: source, narrative: text, statChanges: {} });
    return episode;
  };
  for (let i = 0; i < 8; i++) add(i, "act.one", "城防部署和同伴训练的完整正文。".repeat(200));
  assert.equal(prepareNarrativeMemoryCuration(run), undefined, "同年轮数和内容长短不等于十年");
  commitNarrativeActCanon(run, { actId: "act.one", sourceEventId: "interval:7", resolvedAge: 9 });
  const work = prepareNarrativeMemoryCuration(run)!;
  const next = add(8, "act.two", "同年调到河口，新同伴等你指挥。");
  assert.equal(applyNarrativeMemoryCuration(run, work, { summary: "守关战使你获任小队长，调往河口。" }), true);
  assert.deepEqual(buildNarrativeStoryHistory(run.narrative).episodes.map((entry) => entry.id), [next.id]);
  const history = buildConversationPromptMessages(run.aiConversation.year!, { recentRoundLimit: 3 });
  assert.ok(history.some((entry) => entry.role === "assistant" && entry.content.includes("新同伴等你指挥")));
  assert.equal(history.some((entry) => entry.content.includes("完整正文")), false);
  assert.equal(run.narrative.memoryEntries.length, 9, "仅改变可见投影，保存的原文不删除");
  const restored = ensureNarrativeRunState(JSON.parse(JSON.stringify(run.narrative)), true);
  assert.deepEqual(restored.memoryDigests[0].coveredEpisodeIds, work.episodeIds);
  assert.equal(prepareNarrativeMemoryCuration({ ...run, narrative: restored }), undefined);
});

test("幕内十年滚动压缩承接旧记忆，只替代本次覆盖原文并保留异步期间的新正文", () => {
  const run = makeRun();
  const add = (age: number, suffix = "") => commitNarrativeEpisode(run, {
    callId: `rolling:${age}:${suffix}`, sourceEventId: `rolling:${age}:${suffix}`,
    turnKind: "scene", actId: "act.one", beat: "pressure", age,
    storyDelta: `${age}岁${suffix}：边防仍在对峙，同袍已救回，敌军尚未撤走。`
  });
  add(9);
  add(9, "同年救援");
  assert.equal(prepareNarrativeMemoryCuration(run), undefined);
  add(10);
  const first = prepareNarrativeMemoryCuration(run)!;
  assert.equal(first.throughAge, 10);
  assert.equal(first.previousSummary, "");
  assert.doesNotMatch(memoryCurationPrompt(first), /本次结束区间/);
  const during = add(11);
  const summary = "幼年到十岁间，救回同袍使你获其信任；边防对峙仍未结束。";
  assert.equal(applyNarrativeMemoryCuration(run, first, { summary: "" }), false);
  assert.equal(buildNarrativeStoryHistory(run.narrative).episodes.length, 4, "失败不隐藏原文");
  assert.equal(applyNarrativeMemoryCuration(run, first, { summary }), true);
  assert.deepEqual(buildNarrativeStoryHistory(run.narrative).episodes.map((entry) => entry.id), [during.id]);
  add(19);
  assert.equal(prepareNarrativeMemoryCuration(run), undefined, "从成功覆盖的十岁重新累计");
  add(20);
  const second = prepareNarrativeMemoryCuration(run)!;
  assert.equal(second.previousSummary, summary);
  assert.deepEqual(second.episodes.map((entry) => entry.age), [11, 19, 20]);
  const prompt = memoryCurationPrompt(second);
  assert.equal(prompt.split(summary).length - 1, 1);
  assert.equal(prompt.includes("9岁同年救援"), false, "旧原文已被旧记忆取代");
  const after = add(21);
  assert.equal(applyNarrativeMemoryCuration(run, second, { summary: "救援建立的信任延续至青年，二十岁仍在边防对峙。" }), true);
  assert.deepEqual(buildNarrativeStoryHistory(run.narrative).episodes.map((entry) => entry.id), [after.id]);
  assert.equal(applyNarrativeMemoryCuration(run, first, { summary: "旧结果" }), false);
  run.narrative = ensureNarrativeRunState(JSON.parse(JSON.stringify(run.narrative)), true);
  assert.equal(run.narrative.memoryDigests[0].throughAge, 20);
  run.narrative.episodes = run.narrative.episodes.filter((entry) => entry.age > 20);
  add(29);
  assert.equal(prepareNarrativeMemoryCuration(run), undefined, "原覆盖记录退出保留窗口也不丢覆盖年龄");
  add(30);
  assert.equal(prepareNarrativeMemoryCuration(run)!.throughAge, 30);
  const interval = makeRun();
  commitNarrativeEpisode(interval, { callId: "whole-interval", sourceEventId: "whole-interval",
    turnKind: "background", ageFrom: 8, age: 12, storyDelta: "八至十二岁间随家人守边，战事并未结束。" });
  const intervalWork = prepareNarrativeMemoryCuration(interval)!;
  assert.equal(intervalWork.throughAge, 12);
  assert.deepEqual(intervalWork.episodes.map(({ ageFrom, age }) => [ageFrom, age]), [[8, 12]], "跨十年边界仍压缩整段已提交经历");
});

test("观察器只判断生成大纲的当前改变，不混入另一套静态 IF 目标", async (t) => {
  const base = (await loadNarrativeWorldDefinition("ancient"))!;
  const pack = (await loadNarrativeStoryPack(base, "ancient.frontier-commander"))!;
  const run = makeRun(); run.storyPackSnapshot = pack;
  const act = pack.acts[2];
  const outline = outlineForTest(act.id);
  const recentStory = "46岁：击退眼前一队敌骑，但敌军主力仍在关外。";
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
    const text = payload.messages.map((entry: any) => entry.content).join("\n");
    assert.ok(text.includes(outline.beats.payoff.change));
    for (const goal of [act.objective, act.beatOutline.payoff, act.payoffMeaning, outline.beats.setup.change]) assert.equal(text.includes(goal), false);
    assert.ok(text.includes(recentStory));
    assert.equal(text.includes(pack.acts[0].beatOutline.setup), false);
    assert.deepEqual(Object.keys(payload.tools[0].function.parameters.properties), ["beatDecision", "evidence", "missing"]);
    return { choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "goals", type: "function", function: {
      name: "observe_story_beat", arguments: JSON.stringify(observationReplyForTest("hold"))
    } }] } }] };
  });
  const observation = await observeNarrativeBeat(run, world, { callId: "goals", actId: act.id, beat: "payoff", outline, recentStory },
    { ...memoryTestContext(run), apiKey: "not-sent" });
  assert.equal(observation.decision, "hold", "只验证目标和判断交接，不以模拟返回证明模型语义正确");
});

test("身世空人物与抉择空间指令在原生工具、解析器中使用同一协议", async (t) => {
  const run = makeRun(); run.age = 20;
  let directive: Record<string, string> = { mode: "move", purpose: "前往山口求援" };
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string; parameters: any } }> }) => {
    const tool = payload.tools.find((entry) => entry.function.name === "render_origin" || entry.function.name === "render_choice_prose")!.function;
    if (tool.name === "render_origin") {
      assert.ok(tool.parameters.required.includes("participants"));
      assert.deepEqual(Object.keys(tool.parameters.properties.participants.items.properties), ["characterRef", "name"]);
    } else {
      assert.equal(tool.parameters.properties.continuityRefs, undefined);
      const location = tool.parameters.properties.optionOverrides.items.properties.locationDirective;
      assert.deepEqual(location.anyOf.find((branch: any) => branch.properties.mode.const === "move").required, ["purpose"]);
      assert.deepEqual(location.anyOf.find((branch: any) => branch.properties.mode.const === "revisit").required, ["locationRef"]);
    }
    const args = tool.name === "render_origin" ? {
      narrative: "你出生在北方的一户寻常人家，家中以放牧维持生活。", summary: "来自北方牧户的孩子。", participants: [], assetUpdates: { locations: [], abilities: [] }
    } : {
      narrative: "敌骑逼近山口，守军等着你决定如何求援。", background: "你需要在不同求援方式之间作出取舍。", storyDelta: "敌军逼近，求援方式待选", decisionBrief: { question: "如何向守军求援？", stakes: "求援路线与人身风险将改变" },
      assetActivity: { locationIds: [], abilityIds: [] },
      optionOverrides: ["safe", "balanced", "risky"].map((id) => ({ id, label: "前往山口", description: "向守军寻求援助。", abilityRefs: [], locationDirective: directive }))
    , participants: [], assetUpdates: { locations: [], abilities: [] }, factUpdates: { introduce: [], updates: [] } };
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: tool.name, type: "function", function: { name: tool.name, arguments: JSON.stringify(args) } }] } }] };
  });
  const ctx = { ...memoryTestContext(run), apiKey: "not-sent" };
  assert.deepEqual((await generateNarrativeOrigin(run, world, ctx)).participants, []);
  const input: DynamicNarrativeSceneInput = {
    act: { id: "contract", label: "守关", prompt: "守住关口" }, beat: "pressure", presentation: "choice", allowedTurnKinds: ["scene"],
    sceneAge: 20, backgroundAgeRange: { fromAge: 21, toAge: 21 }, storyPatterns: [], socialForces: [], knownCharacters: [],
    statTiers: resolveNarrativeStatTiers(run.stats), attributePolicy: dynamicSceneAttributePolicy(), backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run)
  };
  const result = await generateDynamicNarrativeScene(run, world, input, ctx);
  assert.equal(result.milestoneCopy!.optionOverrides[0].locationDirective?.purpose, "前往山口求援");
  directive = { mode: "move" };
  await assert.rejects(generateDynamicNarrativeScene(run, world, input, ctx),
    (error: unknown) => error instanceof NarrativeOutcomeError && error.validation?.rule === "choice_location_purpose_required");
  directive = { mode: "stay" };
  assert.ok((await generateDynamicNarrativeScene(run, world, input, ctx)).milestoneCopy);
});

test("资产增量不携带旧快照，同一 ID 多次更新依次累积且其他资产保持最新", () => {
  const initial = applyNarrativeAssetUpdates(undefined, { locations: [], abilities: ["骑射", "夜行", "急救"].map((name) => ({
    ref: "new", name, description: `${name}的能力说明`, usage: `${name}的实际用途`, source: "军中所学", mastery: "初通"
  })) }, { age: 12 }).assets;
  const id = initial.abilities[0].id;
  const delta = parseNarrativeAssetUpdates({ locations: [], abilities: [
    { ref: id, mastery: "精通" }, { ref: id, usage: "奔马中连续射击" }
  ] }, initial)!;
  assert.deepEqual(delta.abilities, [{ ref: id, mastery: "精通" }, { ref: id, usage: "奔马中连续射击" }]);
  const latest = structuredClone(initial);
  latest.abilities[0].description = "较新回合已经补充的能力说明";
  latest.abilities[1].mastery = "熟练";
  const committed = applyNarrativeAssetUpdates(latest, delta, { age: 13 }).assets;
  assert.equal(committed.abilities[0].mastery, "精通");
  assert.equal(committed.abilities[0].usage, "奔马中连续射击");
  assert.equal(committed.abilities[0].description, latest.abilities[0].description);
  assert.deepEqual(committed.abilities.slice(1), latest.abilities.slice(1));
  assert.equal(initial.abilities[0].mastery, "初通");
});

test("三种回合的连续性归并贯通使用记录、最终状态、新资产、公开快照和下一轮目录", async (t) => {
  let proposal: Record<string, unknown> = {};
  let identities: string[] = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string; parameters: any } }>; messages: Array<{ content: string }> }) => {
    const tool = payload.tools[0].function;
    assert.equal(tool.name, "sync_narrative_continuity");
    assert.ok(tool.parameters.required.includes("identityMerges"));
    const prompt = payload.messages.map((entry) => entry.content).join("\n");
    for (const id of identities) assert.ok(prompt.includes(id));
    assert.doesNotMatch(prompt, /unavailable/);
    assert.match(prompt, /identityMerges/);
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: tool.name, type: "function", function: { name: tool.name, arguments: JSON.stringify(proposal) } }] } }] };
  });
  for (const source of ["background", "scene", "decision"] as const) {
    const run = makeRun(); run.age = 20; run.narrative.enabled = true;
    run.narrative.assets = applyNarrativeAssetUpdates(undefined, { locations: [], abilities: [
      { ref: "new", name: "听风", description: "原有听风能力", usage: "辨声", source: "幼年所学", mastery: "初通" },
      { ref: "new", name: "听风辨位", description: "同一能力的进阶记录", usage: "辨认远方脚步", source: "军中练习", mastery: "熟练" }
    ] }, { age: 12 }).assets;
    const [retained, duplicate] = run.narrative.assets.abilities;
    identities = [retained.id, duplicate.id];
    proposal = {
      factIntroductions: [], factUpdates: [], relationshipUpdates: [], identityMerges: [{ kind: "ability", sourceRef: duplicate.id, targetRef: retained.id }],
      locationUpdates: [{ ref: "new", name: "河湾军营", description: "本轮抵达的独立营地", spatialDescription: "河岸边的军营", current: true }],
      abilityUpdates: [
        { ref: retained.id, mastery: "精通" },
        { ref: duplicate.id, description: "恢复并整合后的听风能力", usage: "辨认远方敌军脚步和方位" },
        { ref: "new", name: "包扎", description: "已经学会并为同伴包扎", usage: "止血包扎", source: "在军营中向医者学得", mastery: "初学" }
      ]
    };
    const rollbackRun = structuredClone(run), rollbackBefore = structuredClone(run);
    const { result: ids } = await runNarrativeTurnTransaction(run, async (working) => {
      const changes = await synchronizeNarrativeContinuity(working, world, {
        callId: `identity:${source}`, source, subject: "抵营并整合能力",
        narrative: "你凭听风辨位找到河湾军营，听风能力在运用中恢复并精进。医者教你包扎，你当场替同伴止血。",
        writeSet: { factIds: [], characterIds: [], locationIds: [], abilityIds: [] }, continuityRequired: true
      }, { ...memoryTestContext(working), apiKey: "not-sent" });
      applyNarrativeIdentityMerges(working, changes.identityMerges);
      const canonical = canonicalizeNarrativeReferences(working.narrative, { changes, activity: { locationIds: [], abilityIds: [duplicate.id] } });
      const applied = applyNarrativeAssetUpdates(applyNarrativeAssetActivity(working.narrative.assets, canonical.activity, { age: 20 }), canonical.changes.assetUpdates, { age: 20 });
      const committed = commitNarrativeAssets(working.narrative, applied, { age: 20 }, {}, source);
      commitNarrativeEpisode(working, { callId: source, sourceEventId: source, turnKind: source, age: 20,
        abilityIds: [...canonical.activity.abilityIds, ...committed.abilityIds], locationIds: committed.locationIds });
      appendPublicTurnRecord(working, { entryId: source, kind: source === "background" ? "passage" : source === "decision" ? "choice_outcome" : "scene",
        age: 20, ageStage: { label: "青年" }, narrative: "你抵达河湾军营，掌握包扎，并以听风辨位救回同伴。", statChanges: {} });
      return committed;
    });
    const assets = run.narrative.assets!;
    assert.equal(assets.abilities.length, 2);
    assert.equal(assets.abilities[0].id, retained.id);
    assert.equal(assets.abilities[0].mastery, "精通");
    assert.equal(Object.hasOwn(assets.abilities[0], "status"), false);
    assert.equal(assets.abilities[0].usage, "辨认远方敌军脚步和方位");
    assert.equal(assets.abilities[0].source, "幼年所学");
    assert.deepEqual(run.narrative.episodes.at(-1)!.abilityIds, ids.abilityIds);
    assert.equal(toClientRun(run).narrativeAssets!.currentLocationId, ids.locationIds[0]);
    assert.equal(toClientRun(run).narrativeAssets!.abilities.length, 2);
    assert.ok(narrativeAbilityDirectory(assets).some((entry) => entry.id === retained.id && entry.label.startsWith("听风（精通）")));
    assert.ok(narrativeLocationDirectory(assets).some((entry) => entry.id === ids.locationIds[0]));
    const usedAgain = applyNarrativeAssetActivity(assets, { locationIds: [], abilityIds: [retained.id] }, { age: 21 });
    assert.deepEqual(usedAgain.abilities[0], assets.abilities[0], "仅使用能力不会重写能力档案");
    await assert.rejects(runNarrativeTurnTransaction(rollbackRun, async (working) => {
      applyNarrativeIdentityMerges(working, [{ kind: "ability", sourceRef: duplicate.id, targetRef: retained.id }]);
      applyNarrativeAssetActivity(working.narrative.assets, { locationIds: [], abilityIds: ["ability:another-run"] }, { age: 20 });
    }), /ability_activity_reference_invalid/);
    assert.deepEqual(rollbackRun, rollbackBefore);
  }
});

test("人物当前阵营通过唯一更新入口传入前端和下一轮身份目录", async (t) => {
  const run = makeRun(); run.narrative.enabled = true;
  const forces = [{ id: "army", label: "边军", summary: "边军" }, { id: "court", label: "朝廷", summary: "朝廷" }];
  const person = registerNarrativeParticipants(run, [{ characterRef: "new", name: "陆平", factionId: "army", role: "军士", description: "主角的同伴", recurring: true }], "origin")[0].character;
  let raw: Record<string, unknown> = {};
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string; parameters: any } }> }) => {
    const tool = payload.tools[0].function;
    assert.equal(Object.hasOwn(tool.parameters.properties, "participants"), false);
    assert.ok(tool.parameters.properties.relationshipUpdates.items.properties.factionId);
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: tool.name, type: "function", function: { name: tool.name, arguments: JSON.stringify(raw) } }] } }] };
  });
  const cases = [
    { updates: [{ characterRef: person.id, factionId: "court", role: "侍卫" }, { characterRef: person.id }], expected: "court", role: "侍卫" },
    { updates: [{ characterRef: person.id, factionId: "" }], expected: undefined, role: "侍卫" },
    { updates: [{ characterRef: person.id, factionId: "army", description: "重新驻边" }], expected: "army", role: "侍卫" },
    { updates: [{ characterRef: person.id, factionId: "" }], expected: undefined, role: "侍卫" },
    { updates: [{ characterRef: person.id, factionId: "court" }], expected: "court", role: "侍卫" }
  ];
  for (const [index, entry] of cases.entries()) {
    raw = { relationshipUpdates: entry.updates, locationUpdates: [], abilityUpdates: [], factIntroductions: [], factUpdates: [], identityMerges: [] };
    const changes = await synchronizeNarrativeContinuity(run, world, {
      callId: `faction:${index}`, source: "scene", subject: "人物归属变化", narrative: "陆平的去向已经有了新的变化。",
      writeSet: { factIds: [], characterIds: [person.id], locationIds: [], abilityIds: [] }, continuityRequired: true, socialForces: forces
    }, { ...memoryTestContext(run), apiKey: "not-sent" });
    applyNarrativeRelationshipUpdates(run, changes.relationshipUpdates);
    appendPublicTurnRecord(run, { entryId: `faction:${index}`, kind: "scene", age: index + 1, ageStage: { label: "青年" }, narrative: "陆平的去向发生变化。", statChanges: {} });
    const current = run.narrative.dynamicCharacters.find((entry) => entry.id === person.id)!;
    assert.equal(current.factionId, entry.expected);
    assert.equal(current.role, entry.role, "后续未返回职位的条目不能恢复旧职位");
    assert.equal(toClientRun(run).narrativeCharacters![0].factionId, entry.expected);
    assert.equal(narrativeCharacterDirectory(run.narrative)[0].factionId, entry.expected);
  }
  const candidate = prepareRoundParticipants(run, "candidate", [{ characterRef: "new", name: "新同伴", factionId: "army", role: "斥候", description: "本轮相识", recurring: true }])[0];
  const partial = parseDynamicNarrativeParticipants([{ characterRef: candidate.characterRef }], forces, roundCharacterDirectory(run, { sourceEventId: "candidate", characters: [candidate] }))!;
  const preserved = prepareRoundParticipants(run, "candidate", partial, [candidate]);
  assert.equal(preserved[0].factionId, "army");
  assert.equal(preserved[0].role, "斥候");
  assert.throws(() => parseDynamicNarrativeParticipants([{ characterRef: person.id, factionId: "missing" }], forces, narrativeCharacterDirectory(run.narrative)), NarrativeOutcomeError);
  assert.throws(() => parseRelationshipUpdates([{ characterRef: person.id, factionId: null }], [person.id], ["army", "court"]), /faction_reference_invalid/);
});

test("轻量登记经读档保留身份，周期同步按正文补齐资料并统一重复地点引用", async (t) => {
  const run = makeRun(); run.age = 12; run.narrative.enabled = true;
  const firstBody = "你在河口渡与阿岚相识，她教你观风辨向，凭风向识别渡河的安全时机。";
  stageNarrativeAssetRound(run, { sourceEventId: "light:one", source: "scene", age: 12, subject: "过河", narrative: firstBody }, {
    participants: [{ characterRef: "new", name: "阿岚", recurring: true }],
    assetUpdates: { locations: [{ ref: "new", name: "河口渡", current: true }], abilities: [{ ref: "new", name: "观风辨向" }] }
  }, { age: 12 });
  const placeId = run.narrative.assets!.currentLocationId!;
  const skillId = run.narrative.assets!.abilities[0].id;
  const personId = run.narrative.dynamicCharacters[0].id;
  assert.equal(run.narrative.memoryEntries.length, 0, "登记不创建替代真实正文的占位经历");
  commitNarrativeEpisode(run, { callId: "light", sourceEventId: "light:one", turnKind: "scene", age: 12, storyDelta: firstBody });
  const snapshot = publicNarrativeAssetsSnapshot(run.narrative.assets);
  const restored = JSON.parse(JSON.stringify(run)) as typeof run;
  restored.narrative = ensureNarrativeRunState(restored.narrative, true, 12);
  assert.ok(restored.narrative.assets!.locations[0].pendingDetails);
  assert.ok(restored.narrative.assets!.abilities[0].pendingDetails);
  assert.ok(restored.narrative.dynamicCharacters[0].pendingDetails);
  assert.equal(narrativeAbilityDirectory(restored.narrative.assets)[0].id, skillId, "待整理本领已可供下轮选材");
  const secondBody = "你又回到人称下河渡的河口渡，与阿岚沿河查看水势。";
  stageNarrativeAssetRound(restored, { sourceEventId: "light:two", source: "scene", age: 12, subject: "查看水势", narrative: secondBody }, {
    assetUpdates: { locations: [{ ref: "new", name: "下河渡", current: true }], abilities: [] }
  }, { age: 12 });
  const duplicateId = restored.narrative.assets!.currentLocationId!;
  commitNarrativeEpisode(restored, { callId: "light", sourceEventId: "light:two", turnKind: "scene", age: 12, storyDelta: secondBody, locationIds: [duplicateId] });
  restored.age = 13;
  const thirdBody = "你与阿岚在同一渡口凭观风辨向避开逆风，平安送人过河。";
  stageNarrativeAssetRound(restored, { sourceEventId: "light:three", source: "scene", age: 13, subject: "送人过河", narrative: thirdBody }, {
    assetUpdates: { locations: [{ ref: duplicateId }], abilities: [{ ref: skillId }] }
  }, { age: 13 });
  let requests = 0;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { messages: Array<{ content: string }> }) => {
    requests++;
    const text = payload.messages.map((entry) => entry.content).join("\n");
    for (const value of ["12岁", "13岁", firstBody, secondBody, thirdBody, placeId, duplicateId, personId, skillId]) assert.ok(text.includes(value));
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "sync", type: "function", function: {
      name: "sync_narrative_continuity", arguments: JSON.stringify({ factIntroductions: [], factUpdates: [],

        locationUpdates: [{ ref: placeId, description: "阿岚常年摆渡之处", spatialDescription: "河流下游的渡口，又称下河渡", pendingDetails: false }],
        abilityUpdates: [{ ref: skillId, description: "能依风势选择渡河时机", usage: "观察风向风力判断行船时机", source: "阿岚传授", mastery: "初通", pendingDetails: false }],
        identityMerges: [{ kind: "location", sourceRef: duplicateId, targetRef: placeId }], relationshipUpdates: [{ characterRef: personId, role: "渡船人", description: "熟知河流风势的渡船人", pendingDetails: false }]
      })
    } }] } }] };
  });
  await synchronizeNarrativeAssetBatch(restored, world, { ...memoryTestContext(restored), apiKey: "not-sent" }, "light:batch");
  assert.equal(requests, 1);
  assert.equal(restored.narrative.assetBuffer, undefined);
  assert.deepEqual(restored.narrative.assets!.locations.map((entry) => entry.id), [placeId]);
  assert.equal(restored.narrative.assets!.currentLocationId, placeId);
  assert.deepEqual(restored.narrative.episodes.at(-1)!.locationIds, [placeId]);
  assert.equal(restored.narrative.dynamicCharacters[0].id, personId);
  assert.equal(restored.narrative.assets!.abilities[0].id, skillId);
  assert.equal(restored.narrative.dynamicCharacters[0].pendingDetails, false);
  assert.equal(restored.narrative.assets!.locations[0].pendingDetails, false);
  assert.equal(restored.narrative.assets!.abilities[0].pendingDetails, false);
  assert.equal(restored.narrative.assets!.abilities[0].introduced.age, 12);
  assert.equal(snapshot!.abilities[0].description, undefined, "后续整理不会改写当时的公开快照");
  assert.equal(recentCommittedNarrativeChanges(restored.narrative)[0], `12岁：\n${firstBody}`);
});

test("暂存资产即时沿用原目录和前端接口，恢复后第三轮语义整理保留身份与未改动字段", async (t) => {
  const run = makeRun(); run.narrative.enabled = true; run.age = 20;
  const initial = applyNarrativeAssetUpdates(undefined, { locations: [], abilities: [
    { ref: "new", name: "骑射", description: "能在马上稳定发箭", usage: "骑乘时射击移动目标", source: "边营习得", mastery: "初通" },
    { ref: "new", name: "止血包扎", description: "处理外伤", usage: "战场止血与固定伤口", source: "军医传授", mastery: "熟练" }
  ] }, { age: 19 });
  commitNarrativeAssets(run.narrative, initial, { age: 19 });
  const bowId = initial.abilityIds[0];
  const unchanged = structuredClone(initial.assets.abilities[1]);
  const round = (id: string, source: "background" | "scene" | "decision", narrative: string) => ({ sourceEventId: id, source, age: 20, subject: "边地行军", narrative });
  const first = round("batch:one", "background", "你随队抵达北岭营，在军医带领下学会用药辨毒。");
  stageNarrativeAssetRound(run, first, { assetUpdates: {
    locations: [{ ref: "new", name: "北岭营", description: "新驻地", spatialDescription: "山口内可驻骑兵的营寨", current: true }],
    abilities: [{ ref: "new", name: "用药辨毒", description: "识别和处理常见毒伤", usage: "辨认毒物并选药缓解毒伤", source: "营中军医传授", mastery: "初通" }]
  }, participants: [{ characterRef: "new", name: "陆医师", role: "军医", description: "营中的医师", recurring: true }] }, { age: 20 });
  appendPublicTurnRecord(run, { entryId: first.sourceEventId, kind: "passage", age: 20, ageStage: { label: "青年" }, narrative: first.narrative, statChanges: {} });
  const publicBefore = JSON.parse(JSON.stringify(run.turnRecords.at(-1)!));
  const restored = JSON.parse(JSON.stringify(run)) as typeof run;
  restored.narrative = ensureNarrativeRunState(restored.narrative, true);
  const campId = restored.narrative.assets!.currentLocationId!;
  const medicineId = restored.narrative.assets!.abilities.find((entry) => entry.name === "用药辨毒")!.id;
  const doctorId = restored.narrative.dynamicCharacters[0].id;
  assert.equal(toClientRun(restored).narrativeAssets!.currentLocationId, campId);
  assert.ok(narrativeAbilityDirectory(restored.narrative.assets!).some((entry) => entry.id === medicineId));
  assert.ok(narrativeLocationDirectory(restored.narrative.assets!).some((entry) => entry.id === campId));
  assert.equal(restored.narrative.assetBuffer!.rounds.length, 1);
  stageNarrativeAssetRound(restored, round("batch:two", "scene", "你在北岭营练习骑射，已能在疾驰中连射。"), {
    assetUpdates: { locations: [], abilities: [{ ref: bowId, mastery: "熟练" }] }
  }, { age: 20 });
  let calls = 0;
  let duplicateId = "";
  const ctx = { ...memoryTestContext(restored), apiKey: "not-sent" };
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string; parameters: { properties: Record<string, unknown> } } }>; messages: Array<{ content: string }> }) => {
    calls++;
    const tool = payload.tools[0].function;
    assert.equal(tool.name, "sync_narrative_continuity");
    assert.equal(Object.hasOwn(tool.parameters.properties, "factIntroductions"), true, "事件与其他资产共用同步批次");
    const text = payload.messages.map((entry) => entry.content).join("\n");
    assert.equal(text.split(first.narrative).length - 1, 1);
    assert.ok(text.includes("山口内可驻骑兵的营寨") && text.includes("骑乘时射击移动目标"), "整理读取已有资产状态，不能只看到新正文");
    assert.doesNotMatch(text, /本幕完整发展大纲/);
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "batch", type: "function", function: { name: tool.name, arguments: JSON.stringify({
      factIntroductions: [], factUpdates: [], relationshipUpdates: [{ characterRef: doctorId, description: "随军医师，已带主角处理毒伤", status: "resolved" }], locationUpdates: [],
      abilityUpdates: [{ ref: bowId, mastery: "精通", usage: "疾驰中连续射击并选择敌军薄弱处" }],
      identityMerges: [{ kind: "ability", sourceRef: duplicateId, targetRef: bowId }]
    }) } }] } }] };
  });
  assert.equal((await synchronizeNarrativeAssetBatch(restored, world, ctx, "before-third")).status, "skipped");
  assert.equal(calls, 0);
  const thirdChanges: Parameters<typeof stageNarrativeAssetRound>[2] = {
    handoff: { sourceEventId: "batch:three", characters: [] },
    participants: [{ characterRef: doctorId, name: "陆医师", role: "军医", description: "本次在旁照看伤员", recurring: true }],
    assetUpdates: { locations: [], abilities: [{ ref: "new", name: "马上连射", description: "在疾驰中连射", usage: "骑乘时射击移动目标", source: "骑射实战", mastery: "熟练" }] }
  };
  const touches = stageNarrativeAssetRound(restored, round("batch:three", "decision", "你选择侧翼驰射击退追兵，骑射技巧进一步成熟。"), thirdChanges, { age: 20 });
  duplicateId = touches!.abilities[0].ref;
  assert.equal(restored.narrative.assetBuffer!.rounds.length, 3, "同年回合也计入三轮");
  assert.equal((await synchronizeNarrativeAssetBatch(restored, world, ctx, "third")).status, "requested_changed");
  assert.equal(calls, 1);
  assert.equal(restored.narrative.assetBuffer, undefined);
  assert.equal(restored.narrative.assets!.abilities.length, 3);
  assert.equal(restored.narrative.identityAliases![duplicateId], bowId);
  assert.deepEqual(restored.narrative.assets!.abilities.find((entry) => entry.id === unchanged.id), unchanged);
  const bow = restored.narrative.assets!.abilities.find((entry) => entry.id === bowId)!;
  assert.equal(bow.mastery, "精通");
  assert.equal(bow.source, "边营习得");
  // Replaying the original submission links must not overwrite the batch's newer archive.
  commitNarrativeAssets(restored.narrative, applyNarrativeAssetUpdates(restored.narrative.assets, canonicalizeNarrativeReferences(restored.narrative, touches), { age: 20 }), { age: 20 });
  registerNarrativeParticipants(restored, thirdChanges.participants, "batch:three", [], thirdChanges.handoff?.characters, !thirdChanges.handoff?.participantsRegistered);
  assert.equal(restored.narrative.assets!.abilities.find((entry) => entry.id === bowId)!.mastery, "精通");
  assert.equal(restored.narrative.dynamicCharacters[0].description, "随军医师，已带主角处理毒伤");
  assert.equal(restored.narrative.dynamicCharacters[0].status, "resolved");
  assert.deepEqual(restored.turnRecords[0], publicBefore, "批次整理不重写已经展示的历史快照");
  restored.ended = true;
  assert.equal(toClientRun(restored).narrativeAssets!.abilities.find((entry) => entry.id === bowId)!.mastery, "精通", "结局呈现最后整理后的档案，历史快照保留原样");
});

test("第三轮同步失败保留前两轮暂存，结束不足三轮也能整理且不重复生成资产", async (t) => {
  const run = makeRun(); run.narrative.enabled = true;
  for (let i = 1; i <= 2; i++) stageNarrativeAssetRound(run, {
    sourceEventId: `short:${i}`, source: i === 1 ? "background" : "scene", age: 1, subject: "初到边营", narrative: `已发生的第${i}项经历。`
  }, { assetUpdates: { locations: i === 1 ? [{ ref: "new", name: "边营", description: "最初落脚处", spatialDescription: "边镇内的营寨", current: true }] : [], abilities: [] } }, { age: 1 });
  const before = structuredClone(run);
  let fail = true; let requests = 0;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string } }> }) => {
    requests++;
    if (fail) throw new Error("batch_request_failed");
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "batch", type: "function", function: { name: payload.tools[0].function.name, arguments: JSON.stringify({ locationUpdates: [], abilityUpdates: [], identityMerges: [], relationshipUpdates: [], factIntroductions: [], factUpdates: [] }) } }] } }] };
  });
  const ctx = { ...memoryTestContext(run), apiKey: "not-sent" };
  await assert.rejects(runNarrativeTurnTransaction(run, async (working) => {
    stageNarrativeAssetRound(working, { sourceEventId: "short:three", source: "decision", age: 1, subject: "行动", narrative: "你学会借地势隐藏踪迹。" }, {
      assetUpdates: { locations: [], abilities: [{ ref: "new", name: "藏踪", description: "借地势藏匿", usage: "回避追踪和侦察", source: "本次实践", mastery: "初通" }] }
    }, { age: 1 });
    await synchronizeNarrativeAssetBatch(working, world, ctx, "failed-third");
  }));
  assert.deepEqual(run, before, "失败不发布第三轮候选，也不清空前两轮暂存");
  fail = false;
  run.ended = true;
  assert.equal((await synchronizeNarrativeAssetBatch(run, world, ctx, "ending", [], true)).status, "requested_empty");
  assert.equal(requests, 2);
  assert.equal(run.narrative.assetBuffer, undefined);
  assert.equal(run.narrative.assets!.locations[0].id, before.narrative.assets!.locations[0].id);
  assert.equal((await synchronizeNarrativeAssetBatch(run, world, ctx, "ending-again", [], true)).status, "skipped");
  assert.equal(requests, 2, "已确认批次不会重复整理");
});

test("已摘要的旧幕不会反复压缩，新幕完成后独立提交下一区间", () => {
  const run = makeRun(); run.narrative.enabled = true;
  const add = (id: string, actId: string) => commitNarrativeEpisode(run, { callId: id, sourceEventId: id, turnKind: "scene", age: 20, actId, beat: "pressure", storyDelta: "战局变化后，你进入新的阵营与敌军交锋并建立自己的威望。".repeat(180) });
  add("closed-act", "act.one");
  commitNarrativeActCanon(run, { actId: "act.one", sourceEventId: "closed-act", resolvedAge: 20 });
  const first = prepareNarrativeMemoryCuration(run)!;
  assert.ok(first);
  applyNarrativeMemoryCuration(run, first, { summary: "主角结束第一段军旅磨砺，转入新的阵营。" });
  for (let i = 0; i < 6; i++) add(`new-act:${i}`, "act.two");
  assert.equal(prepareNarrativeMemoryCuration(run), undefined);
  commitNarrativeActCanon(run, { actId: "act.two", sourceEventId: "new-act:5", resolvedAge: 20 });
  const next = prepareNarrativeMemoryCuration(run)!;
  assert.ok(next);
  assert.deepEqual(next.episodeIds, [0, 1, 2, 3, 4, 5].map((i) => `episode:new-act:${i}`));
  assert.equal(next.previousSummary, "主角结束第一段军旅磨砺，转入新的阵营。");
});

test("旧默认输出预算升级，显式自定义预算不被覆盖", () => {
  assert.equal(upgradeProviderOutputBudget({ maxTokens: 1824 }).maxTokens, 18240);
  assert.equal(upgradeProviderOutputBudget({ maxTokens: 30000 }).maxTokens, 30000);
});

test("摘要失败区间在资产归并后按最新身份重试，不扩入新回合也不永远卡在旧 revision", () => {
  const run = makeRun(); run.narrative.enabled = true; run.ended = true;
  const people = registerNarrativeParticipants(run, [
    { characterRef: "new", name: "军医陆平", role: "军医", description: "随营军医", recurring: true },
    { characterRef: "new", name: "陆医师", role: "医师", description: "同一位随营军医", recurring: true }
  ], "origin");
  for (let i = 1; i <= 2; i++) commitNarrativeEpisode(run, {
    callId: `retry:${i}`, sourceEventId: `retry:${i}`, turnKind: "scene", age: i, characterIds: [people[1].character.id], storyDelta: "你随陆医师处理军中伤病。"
  });
  const failed = prepareNarrativeMemoryCuration(run)!;
  applyNarrativeIdentityMerges(run, [{ kind: "character", sourceRef: people[1].character.id, targetRef: people[0].character.id }]);
  commitNarrativeEpisode(run, { callId: "retry:new", sourceEventId: "retry:new", turnKind: "scene", age: 3, storyDelta: "你开始另一项新的经历。" });
  const retry = prepareNarrativeMemoryCuration(run, failed.episodeIds)!;
  assert.deepEqual(retry.episodeIds, failed.episodeIds);
  assert.equal(retry.revision, run.narrative.memoryRevision);
  assert.ok(retry.episodes.every((episode) => episode.narrative.includes("陆医师")));
  assert.equal(applyNarrativeMemoryCuration(run, retry, { summary: "主角曾跟随陆医师处理营中伤病。" }), true);
  assert.deepEqual(prepareNarrativeMemoryCuration(run)!.episodeIds, ["episode:retry:new"]);
});

test("超过240回合后原文与记录共同保留，读档不冻结提交进度和世界卡冷却", async () => {
  const base = await loadNarrativeExperienceForTest("fantasy");
  const definition: NarrativeWorldDefinition = { ...base, worldCards: [
    { id: "test.long-run", kind: "setting", content: "新的环境材料", priority: 1, activation: { tasks: ["planning"] } }
  ] };
  const run = makeRun();
  run.worldId = "fantasy";
  run.narrative.enabled = true;
  const append = (index: number) => {
    const sourceEventId = `retention:${index}`;
    commitNarrativeMemory(run.narrative, { id: `memory:${sourceEventId}`, age: 20, text: `第${index}回合的完整正文`, factionIds: [], characterIds: [], factIds: [] });
    return commitNarrativeEpisode(run, { callId: sourceEventId, sourceEventId, turnKind: "scene", age: 20, storyDelta: `第${index}项进展` });
  };
  for (let index = 0; index < 245; index++) append(index);
  run.narrative.worldCardActivations = [{ cardId: "test.long-run", lastActivatedSequence: 245, stickyUntilSequence: 245, cooldownUntilSequence: 248 }];
  run.narrative = ensureNarrativeRunState(JSON.parse(JSON.stringify(run.narrative)), true);
  assert.equal(run.narrative.episodes.length, 240);
  assert.equal(run.narrative.memoryEntries.length, 240);
  assert.equal(run.narrative.episodes[0].id, "episode:retention:5");
  assert.ok(run.narrative.episodes.every((episode) => episode.memoryIds.every((id) => run.narrative.memoryEntries.some((entry) => entry.id === id))));
  assert.equal(run.narrative.committedEpisodeSequence, 245);
  assert.equal(selectNarrativeWorldCards(run, definition, { task: "planning" }).length, 0);
  append(244);
  assert.equal(run.narrative.committedEpisodeSequence, 245, "重复提交不会加快生命周期计时");
  for (let index = 245; index < 248; index++) append(index);
  assert.equal(run.narrative.committedEpisodeSequence, 248);
  assert.deepEqual(selectNarrativeWorldCards(run, definition, { task: "planning" }).map((card) => card.id), ["test.long-run"]);
  assert.equal(run.narrative.episodes.length, 240);
  assert.equal(run.narrative.memoryEntries.length, 240);
});

test("规划候选不消耗冷却，正文只消费所选卡且待选场景将其交接给作答", async () => {
  const base = await loadNarrativeExperienceForTest("fantasy");
  const cards = Array.from({ length: 8 }, (_, index) => ({
    id: `test.material.${index}`, title: `领域${index}`, kind: "setting" as const,
    content: `材料${index}：${"具有独立叙事用途的完整内容".repeat(130)}结束${index}`,
    priority: index, activation: { tasks: ["planning", "rendering", "decision"] as const }, cooldownTurns: 3
  }));
  const definition: NarrativeWorldDefinition = { ...base, worldCards: cards.map((card) => ({ ...card, activation: { tasks: [...card.activation.tasks] } })) };
  const run = makeRun(); run.worldId = "fantasy"; run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, 20);
  const actId = run.narrative.actRuntime!.actId;
  const candidates = buildNarrativePromptPlan(run, definition, null, "planning")!.activeWorldCardSources!;
  assert.equal(candidates.length, 8);
  const chosen = cards[7];
  const renderPlan = buildNarrativePromptPlan(run, definition, null, "rendering", { focusIds: [chosen.id], worldCardCandidates: candidates })!;
  const writer = composeNarrativeContext({ task: "rendering", taskPrompt: "执行选中材料", plan: renderPlan });
  assert.ok(writer.renderedContext.includes(chosen.content));
  assert.ok(cards.slice(0, 7).every((card) => !writer.renderedContext.includes(card.content)));
  const attemptId = "attempt:material";
  run.narrative.agentAttempts.push(
    { id: "attempt:material:plan", callId: "material", attemptId, task: "planning", source: "scene", stage: "plan", createdAt: 1,
      contextFragmentIds: candidates.map((card) => `recall:world-card:${card.id}|0|3|direct`) },
    { id: "attempt:material:render", callId: "material", attemptId, task: "rendering", source: "scene", stage: "render", createdAt: 2,
      worldCardIds: [chosen.id], contextFragmentIds: writer.manifest.fragments.map((fragment) => fragment.id) }
  );
  const episode = commitNarrativeEpisode(run, { callId: "material", sourceEventId: "material", turnKind: "scene", age: 20 });
  commitNarrativeAgentTurn(run, attemptId, episode.id);
  assert.deepEqual(run.narrative.worldCardActivations?.map((entry) => entry.cardId), [chosen.id]);
  run.pendingDynamicScene = { id: "material", mainlineActId: actId, beat: "setup", patternIds: [], forceIds: [], worldCardIds: [chosen.id] };
  const restored = JSON.parse(JSON.stringify(run)) as typeof run;
  restored.narrative = ensureNarrativeRunState(restored.narrative, true);
  const decision = buildNarrativePromptPlan(restored, definition, null, "decision")!;
  const result = composeNarrativeContext({ task: "decision", taskPrompt: "写选定行动的结果", plan: decision });
  assert.ok(result.renderedContext.includes(chosen.content), "作答沿用场景材料，不受场景提交后冷却再次否决");
  assert.ok(cards.slice(0, 7).every((card) => !result.renderedContext.includes(card.content)));
});

test("回放原日志：已有本领更新、变化引用与返回住处在四类正文入口共同通过", async (t) => {
  const baseWorld = await loadNarrativeWorldDefinition("ancient"); assert.ok(baseWorld);
  const pack = await loadNarrativeStoryPack(baseWorld, "ancient.frontier-commander"); assert.ok(pack);
  const definition = resolveNarrativeExperience(baseWorld, pack);
  const act = definition.mainlineActs![0];
  const abilityId = "ability:5dcd4545-b073-47d2-83a2-a83dea8e180e";
  const trailId = "location:eb77841a-6701-4a5b-aded-a3bff21a285f";
  const homeId = "location:f09899f8-ea0d-4db2-8236-ee997a398cec";
  const fatherId = "character:d9d0811b-c7f6-4be6-9620-dc825e04e4da";
  const teacherId = "character:64239c12-d2cd-467f-a895-390887c29ec6";
  const args = {
    narrative: '三年里你随赵老卒把哨道走熟了，碎石坡的断痕、水口的夜货、驼队的口音，都能分出个大概。石墩轮值城头回来，总把哨骑的消息塞给你；母亲那边听来的商队话，也常与你路上所见对得上。父亲不再问你应不应，只在你回宅时扫一眼马腿上的沙，问一句"今日风从哪边来"。',
    storyDelta: "十四至十六岁间，主角长期随赵老卒巡黑石滩哨道，练出从痕迹、口音与商队消息互相印证的眼力；石墩与母亲各自带来一路见闻，父亲以问风向的方式考察其判断，家中关系渐稳。",
    participants: [
      { characterRef: fatherId, role: "雁回关屯田兼商队验牒官", description: "不再明言约束，改以问风向、看马腿沙土的方式考察主角判断。", relationship: { stance: "friendly", summary: "认可主角巡哨积累的眼力，转为以日常考问考察其分寸。" } },
      { characterRef: teacherId, role: "雁回关巡骑老卒", description: "三年来带主角走熟哨道，教其辨痕、认口音、看商队路数，视如子侄。", relationship: { stance: "friendly", summary: "由作保转为长久带教，遇事肯听主角的判断。" } }
    ],
    assetUpdates: { locations: [], abilities: [{ ref: abilityId, name: "辨边情",
      description: "从哨道痕迹、蹄铁与口音、商队消息互证，判断边地往来与异动来路的眼力；由随赵老卒巡哨道三年积累而成。",
      usage: "在哨道或关口勘察时可依痕迹、口音与多方消息推知人马来路与去向；需现场实证，且须与商队消息互证，单凭一说易误判。",
      source: "随赵老卒巡黑石滩哨道三年，兼采母亲商队见闻与石墩转述的哨骑消息。", mastery: "渐熟" }] },
    factUpdates: { introduce: [], updates: [] },
    continuityRefs: { factIds: [], characterIds: [fatherId, teacherId], locationIds: [], abilityIds: [abilityId] },
    assetActivity: { locationIds: [trailId, homeId], abilityIds: [], currentLocationId: homeId },
    continuityRequired: true
  };
  for (const entry of ["background", "scene", "decision"] as const) {
    await t.test(entry, async (replay) => {
      const run = makeRun(); run.age = 13; run.worldId = "ancient"; run.narrative.enabled = true;
      run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
      run.narrative.assets = {
        locations: [
          { id: trailId, name: "黑石滩哨道", description: "随老卒巡行的哨道", spatialDescription: "关外沿碎石坡和水口延伸的巡哨道路", introduced: { age: 10 }, lastSeen: { age: 13 } },
          { id: homeId, name: "雁回关家宅", description: "巡哨后返回的住处", spatialDescription: "关内父母居住的院落", introduced: { age: 0 }, lastSeen: { age: 10 } }
        ],
        abilities: [{ id: abilityId, name: "辨边情", description: "随老卒辨识哨道痕迹", usage: "从现场痕迹分辨人马来路，须经多方见闻印证", source: "随老卒巡哨习得", mastery: "初通", introduced: { age: 10 }, updated: { age: 13 } }],
        currentLocationId: trailId
      };
      run.narrative.dynamicCharacters = [
        { id: fatherId, name: "父亲", role: "验牒官", description: "考察主角判断", status: "active", importance: "recurring", introducedAge: 0, lastSeenAge: 13, relatedFactIds: [], relatedRouteIds: [] },
        { id: teacherId, name: "赵老卒", role: "巡骑老卒", description: "教主角巡哨", status: "active", importance: "recurring", introducedAge: 10, lastSeenAge: 13, relatedFactIds: [], relatedRouteIds: [] }
      ];
      commitNarrativeEpisode(run, { callId: "replay:previous", sourceEventId: "replay:previous", turnKind: "scene", age: 13,
        characterIds: [teacherId], locationIds: [trailId], abilityIds: [abilityId], storyDelta: "随老卒巡哨，初学辨边情" });
      const context = { ...memoryTestContext(run, [trailId]), apiKey: "not-sent" };
      const toolName = entry === "background" ? "render_background_prose" : entry === "scene" ? "render_scene_prose"
        : "render_decision_outcome";
      const scripts = [
        { name: toolName, args },
        ...(entry === "background" ? [{ name: "resolve_background_outcome", args: { effects: [{ stat: "intelligence", direction: "up", band: "light" }] } }] : [])
      ];
      replay.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string } }>; messages: Array<{ content: string }> }) => {
        const step = nextNarrativeScript(scripts, payload); assert.ok(step, "只回放本次正文及其必要结算请求");
        assert.ok(payload.tools.some((tool) => tool.function.name === step.name));
        if (step.name === toolName) {
          const text = payload.messages.map((message) => message.content).join("\n");
          assert.ok(text.includes(abilityId) && text.includes(homeId), "原输出中的合法身份已提供给模型");
          if (entry === "background") assert.ok(text.includes("辨边情（初通）"), "普通年份接到近期本领名称和熟练程度");
        }
        return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "replay:original", type: "function", function: { name: step.name, arguments: JSON.stringify(step.args) } }] } }] };
      });
      const plan = { callId: "replay", turnKind: "scene" as const, presentation: "scene" as const, patternIds: [], forceIds: [], conflictRefs: [], abilityRefs: [],
         clockRequest: "advance" as const, materials: [{ id: trailId, kind: "location" as const, label: "黑石滩哨道" }] };
      const renderInput = { act, beat: "setup" as const, presentation: "scene" as const, allowedTurnKinds: ["scene" as const], sceneAge: 14,
        backgroundAgeRange: { fromAge: 14, toAge: 16 }, storyPatterns: [], socialForces: [], knownCharacters: [],
        statTiers: resolveNarrativeStatTiers(run.stats), attributePolicy: dynamicSceneAttributePolicy(), backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run), plan };
      const result = entry === "background"
        ? (await runNarrativeAgentTurn({ run, world, narrativeWorld: definition, context,
            envelope: { callId: "replay", source: "background", worldId: run.worldId, currentAge: 13,
              backgroundAgeRange: renderInput.backgroundAgeRange, act, beat: "setup", actOutline: outlineForTest(act.id), capabilities: ["background"], storyPatterns: [], socialForces: [], focusReferences: [],
              statTiers: renderInput.statTiers, clock: { mode: "advance", sameAgeTurnCount: 0, maxSameAgeTurns: 3 } },
            buildRenderInput: (selected) => ({ ...renderInput, allowedTurnKinds: ["background"], presentation: selected.presentation }) })).scene
        : entry === "scene" ? await generateDynamicNarrativeScene(run, world, renderInput, context)
        : await renderDirectedDecisionNarrative(run, world, { decision: "balanced", label: "随老卒巡哨", description: "在哨道历练后回家" }, context);
      assert.equal(result.assetUpdates!.abilities[0].ref, abilityId);
      assert.equal(result.assetActivity.currentLocationId, homeId);
      assert.deepEqual(result.assetActivity.locationIds, [trailId, homeId]);
      const staged = stageNarrativeAssetRound(run, { sourceEventId: `replay:${entry}`, source: entry === "background" ? "background" : "scene", age: 16,
        subject: "随老卒巡哨", narrative: result.narrative }, result, { age: 16 });
      const application = applyNarrativeAssetUpdates(applyNarrativeAssetActivity(run.narrative.assets, result.assetActivity, { age: 16 }), staged, { age: 16 });
      commitNarrativeAssets(run.narrative, application, { age: 16 }, {}, `replay:${entry}`);
      assert.deepEqual(result.assetUpdates!.abilities, [{ ref: abilityId }], "正文入口只交接身份，不与同步争抢详情维护");
      assert.equal(run.narrative.assets!.abilities[0].mastery, "初通");
      assert.equal(run.narrative.assets!.abilities[0].usage, "从现场痕迹分辨人马来路，须经多方见闻印证");
      assert.equal(run.narrative.assets!.currentLocationId, homeId);
      assert.equal(scripts.length, 0);
    });
  }
});

test("正文、审校按本局身份核对引用，规划材料仅提供选中本领的用途", () => {
  const run = makeRun(); run.narrative.enabled = true;
  const application = applyNarrativeAssetUpdates(run.narrative.assets, { locations: [], abilities: [
    { ref: "new", name: "御风", description: "早年的获得经历", usage: "能够借风跃过沟壑，但不能长途飞行。", source: "师承", mastery: "熟练" },
    { ref: "new", name: "驭火", description: "另一次获得经历", usage: "操纵火焰逼退近敌，但不能用于水下。", source: "修习", mastery: "初通" }
  ] }, { age: 20 });
  run.narrative.assets = application.assets;
  const [selected, other] = application.assets.abilities;
  const ctx = memoryTestContext(run, [selected.id]);
  for (const task of ["rendering", "decision"] as const) {
    const prepared = prepareNarrativeOutcomeRequest(run, world, structuredClone(ctx), narrativeDecisionRenderTool(), "只处理本轮材料", {
      task, contracts: { references: true, assets: true }
    });
    assert.deepEqual(prepared.allowedAssets.abilities.map((entry) => entry.id), [selected.id, other.id]);
    assert.deepEqual(prepared.allowedActivityRefs.abilityIds, [selected.id, other.id]);
    const text = prepared.history.map((entry) => entry.content).join("\n");
    assert.ok(text.includes(other.id), "全局身份目录仍可帮助辨认重复对象");
    assert.ok(!text.includes(other.usage!), "未选中技能的使用方式不进入正文请求");
    if (task === "rendering") assert.equal(text.split(`${selected.id}=${selected.name}（${selected.mastery}）`).length - 1, 1);
    assert.ok(!text.includes(selected.usage!), "已选中技能也不携带展示策略进入正文");
  }
});


test("原日志回放：新地点位置与节拍字段各自纠正一次，前序故事不重跑且真实位置提交", async (t) => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  const run = makeRun(); run.worldId = "ancient"; run.age = 43; run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  run.narrative.actRuntime!.beat = "pressure";
  const act = definition.mainlineActs![0];
  const oldLocationId = "location:1b56167a-2bdb-4aee-8a56-d4016cc6961e";
  const abilityIds = ["ability:1e71dad2-788b-440d-a663-db29d6df5bdc", "ability:7e10f5ef-b3ae-4def-9672-701bb32c3cab"];
  run.narrative.assets = {
    locations: [{ id: oldLocationId, name: "营中点验院", description: "原驻地", spatialDescription: "军营内的院落", introduced: { age: 40 }, lastSeen: { age: 43 } }],
    abilities: abilityIds.map((id, i) => ({ id, name: ["骑射", "侦察"][i], description: "已掌握的军中技艺", usage: "骑马巡哨、辨认敌踪", source: "军中训练", mastery: "熟练", introduced: { age: 40 }, updated: { age: 43 } })),
    currentLocationId: oldLocationId
  };
  const factId = "dynamic:78ca889fee0ed2b4";
  const [registeredFactId] = applyNarrativeFactUpdates(run, { introduce: [{ kind: "open_question", label: "敌军主力尚待击退" }], touchFactIds: [], resolveFactIds: [] }, { sourceEventId: "invasion", actId: act.id });
  run.story.factLedger!.facts.find((fact) => fact.id === registeredFactId)!.id = factId;
  const badRender = {
    narrative: "你从营中点验院出发，带骑兵抵达西边道远哨。夜色中敌军主力仍在集结，你留下巡骑继续侦察。",
    storyDelta: "已抵达西边道远哨，敌军主力仍在集结。", participants: [], continuityRequired: true,
    continuityRefs: { factIds: [], characterIds: [], locationIds: [], abilityIds: [] },
    assetUpdates: { locations: [{ ref: "new", name: "西边道远哨", description: "本轮实际抵达的远哨", spatialDescription: "西边道外的骑兵哨所", current: true }], abilities: [] },
    factUpdates: { introduce: [], updates: [] },
    assetActivity: { locationIds: [oldLocationId], abilityIds, currentLocationId: "location:new" }
  };
  const goodRender = { ...badRender, assetActivity: { locationIds: [oldLocationId], abilityIds } };
  const scripts = [
    { name: "plan_scene_turn", args: {  actWorldCard: actWorldCardForTest({ goal: "应对敌军入侵", completionMeaning: "敌军主力已被击退" }), clockRequest: "hold", conflictRefs: [], abilityRefs: [], forceIds: [], locationDirective: { mode: "move", purpose: "移防远哨" } } },
    { name: "render_scene_prose", args: badRender },
    { name: "render_scene_prose", args: goodRender },
    { name: "resolve_scene_outcome", args: { effects: [{ stat: "intelligence", direction: "up", band: "light" }] } },
    { name: "observe_story_beat", args: { beatDecision: "unknown" } },
    { name: "observe_story_beat", args: { beatDecision: "hold",  resolutions: [] } }
  ];
  const calls: string[] = [];
  let stagedLocationId: string | undefined;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string; parameters: any } }>; messages: Array<{ content: string }> }) => {
    const step = nextNarrativeScript(scripts, payload); assert.ok(step); assert.ok(payload.tools.some((tool) => tool.function.name === step.name));
    calls.push(step.name);
    const text = payload.messages.map((entry) => entry.content).join("\n");
    if (calls.at(-1) === "render_scene_prose" && calls.filter((name) => name === "render_scene_prose").length === 2) {
      const correction = JSON.parse(payload.messages.at(-1)!.content.split("\n").at(-1)!);
      assert.equal(correction.validation.path, "assetActivity.currentLocationId");
      assert.deepEqual(correction.originalToolArguments, badRender);
      assert.match(payload.tools[0].function.parameters.properties.assetActivity.properties.currentLocationId.description, /新地点.*省略/);
    }
    if (step.name === "observe_story_beat") {
      assert.ok(text.includes("敌军主力仍在集结"));
      assert.equal(Object.hasOwn(payload.tools[0].function.parameters.properties, "carryFactIds"), false);
      const current = run.narrative.assets!.currentLocationId;
      assert.notEqual(current, oldLocationId);
      if (stagedLocationId) assert.equal(current, stagedLocationId, "观察纠正不重建暂存资产");
      stagedLocationId = current;
      if (calls.filter((name) => name === "observe_story_beat").length === 2) {
        const correction = JSON.parse(payload.messages.at(-1)!.content.split("\n").at(-1)!);
        assert.equal(correction.validation.path, "beatDecision");
        assert.deepEqual(correction.validation.expected, ["hold", "advance"]);
      }
    }
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: `replay:${calls.length}`, type: "function", function: { name: step.name, arguments: JSON.stringify(step.args) } }] } }] };
  });
  const context = { ...memoryTestContext(run), apiKey: "not-sent", narrativePlan: buildNarrativePromptPlan(run, definition, null, "planning") };
  const turn = await runNarrativeAgentTurn({ run, world, narrativeWorld: definition, context,
    envelope: { callId: "original-log", source: "scene", worldId: run.worldId, currentAge: 43, backgroundAgeRange: { fromAge: 44, toAge: 44 }, act, beat: "pressure", capabilities: ["scene"], storyPatterns: [], socialForces: [], focusReferences: [], statTiers: resolveNarrativeStatTiers(run.stats), clock: { mode: "hold", sameAgeTurnCount: 0, maxSameAgeTurns: 3 } },
    buildRenderInput: (plan) => ({ act, beat: "pressure", presentation: plan.presentation, allowedTurnKinds: ["scene"], sceneAge: 43, backgroundAgeRange: { fromAge: 44, toAge: 44 }, storyPatterns: [], socialForces: [], knownCharacters: [], statTiers: resolveNarrativeStatTiers(run.stats), attributePolicy: dynamicSceneAttributePolicy(), backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run) }) });
  assert.deepEqual(calls, ["plan_scene_turn", "plan_scene_turn", "render_scene_prose", "render_scene_prose", "resolve_scene_outcome", "observe_story_beat", "observe_story_beat"]);
  assert.equal(turn.scene.narrative, goodRender.narrative);
  assert.deepEqual(turn.scene.assetUpdates!.locations, [{ ref: stagedLocationId, current: true }]);
  const assets = applyNarrativeAssetUpdates(applyNarrativeAssetActivity(run.narrative.assets, turn.scene.assetActivity, { age: 43 }), turn.scene.assetUpdates, { age: 43 });
  commitNarrativeAssets(run.narrative, assets, { age: 43 });
  assert.equal(toClientRun(run).narrativeAssets!.currentLocationId, stagedLocationId);
  assert.equal(run.narrative.assets!.locations.length, 2);
  assert.equal(run.story.factLedger!.facts.find((fact) => fact.id === factId)!.status, "open");
  assert.equal(scripts.length, 0);
});

test("普通与 payoff 观察都只裁定节拍，非法返回仅纠正当前请求", async (t) => {
  const run = makeRun();
  const scripts = [observationReplyForTest("unknown"), observationReplyForTest("hold"), observationReplyForTest("advance")];
  let calls = 0;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
    const tool = payload.tools[0].function;
    assert.deepEqual(Object.keys(tool.parameters.properties), ["beatDecision", "evidence", "missing"]);
    calls++;
    return { choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "observe", type: "function", function: { name: tool.name, arguments: JSON.stringify(scripts.shift()) } }] } }] };
  });
  const context = { ...memoryTestContext(run), apiKey: "not-sent" };
  const input = { callId: "observe", actId: "act.one", beat: "pressure" as const, recentStory: "敌军还未撤退。", outline: outlineForTest("act.one") };
  assert.equal((await observeNarrativeBeat(run, world, input, context)).decision, "hold");
  assert.equal((await observeNarrativeBeat(run, world, { ...input, beat: "payoff" }, context)).decision, "advance");
  assert.equal(calls, 3);
});

test("事件整理失败不清空批次或发布事实，修正后能从原批次提交", async (t) => {
  const run = makeRun(); run.age = 12;
  stageNarrativeAssetRound(run, { sourceEventId: "r12", source: "scene", age: 12, actId: "act.one", subject: "学艺", narrative: "你完成了查账，启程随军。" }, {}, { age: 12 });
  let valid = false;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => ({
    choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "sync", type: "function", function: {
      name: payload.tools[0].function.name, arguments: JSON.stringify({
        locationUpdates: [], abilityUpdates: [], identityMerges: [], relationshipUpdates: [], factUpdates: [],
        factIntroductions: [{ kind: "experience", label: "查账结束后随军", status: "finish", sourceEventId: valid ? "r12" : "unknown-source" }]
      })
    } }] } }]
  }));
  const before = structuredClone(run);
  await assert.rejects(runNarrativeTurnTransaction(run, (working) =>
    synchronizeNarrativeAssetBatch(working, world, { ...memoryTestContext(working), apiKey: "not-sent" }, "flush", [], true)), NarrativeOutcomeError);
  assert.deepEqual(run, before);
  valid = true;
  await synchronizeNarrativeAssetBatch(run, world, { ...memoryTestContext(run), apiKey: "not-sent" }, "flush", [], true);
  assert.equal(run.narrative.assetBuffer, undefined);
  assert.equal(run.story.factLedger!.facts[0].status, "resolved");
  assert.equal(run.story.factLedger!.facts[0].sourceEventId, "r12");
});

test("同步工具跨来源和人物目录保持固定结构，年龄幕间由来源映射且只更新选中事件", async (t) => {
  const run = makeRun(); run.narrative.enabled = true; run.age = 30;
  const schemas: unknown[] = [];
  let round = 0;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
    const tool = payload.tools[0].function;
    schemas.push(tool.parameters);
    const source = round++ === 0 ? "story:first" : "story:second";
    const body = payload.messages.map((message: any) => message.content).join("\n");
    assert.ok(body.includes(source));
    assert.equal(Object.hasOwn(tool.parameters.properties.factIntroductions.items.properties.sourceEventId, "enum"), false);
    assert.ok(tool.parameters.required.includes("relationshipUpdates"));
    return { choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "sync", type: "function", function: {
      name: tool.name, arguments: JSON.stringify({ locationUpdates: [], abilityUpdates: [], relationshipUpdates: [], identityMerges: [], factUpdates: [],
        factIntroductions: [{ kind: "experience", label: source === "story:first" ? "学艺已经完成" : "护送已经完成", status: "finish", sourceEventId: source }] })
    } }] } }] };
  });
  const events: string[] = [];
  for (const [index, sourceEventId] of ["story:first", "story:second"].entries()) {
    if (index === 1) registerNarrativeParticipants(run, [{ characterRef: "new", name: "同袍", role: "军士", description: "护送中结识", recurring: true }], sourceEventId);
    const changes = await synchronizeNarrativeContinuity(run, world, { callId: `batch:${index}`, source: "scene", subject: "整理已发生经历",
      narrative: `${20 + index}岁：事情已经完成。`, eventSources: [{ sourceEventId, age: 20 + index, actId: `act.${index}` }],
      writeSet: { factIds: [], characterIds: run.narrative.dynamicCharacters.map((entry) => entry.id), locationIds: [], abilityIds: [] }, continuityRequired: true
    }, { ...memoryTestContext(run), apiKey: "not-sent" });
    events.push(...applyNarrativeFactUpdates(run, changes.factUpdates, { sourceEventId: `batch:${index}` }));
  }
  assert.deepEqual(schemas[0], schemas[1]);
  assert.deepEqual(events.map((id) => {
    const fact = run.story.factLedger!.facts.find((entry) => entry.id === id)!;
    return [fact.introducedAge, fact.actId, fact.sourceEventId, fact.status];
  }), [[20, "act.0", "story:first", "resolved"], [21, "act.1", "story:second", "resolved"]]);
});

test("正文结构检查允许自然语义和现代型号，但拒绝序列化内部字段", () => {
  for (const narrative of [
    "你把M3型相机交还同伴，在街边谈起这段求学生活。",
    "老师讲解状态机，你终于明白程序如何记住已经发生的事。",
    "朋友说，故事终于结束了，又翻开一本新的小说。",
    "你回家休息。</p><p>第二天照常去学堂。"
  ]) assert.equal(isNarrativePlainText(normalizeNarrativeText(narrative), 10), true);
  for (const text of [
    "正文<assetUpdates><locations/></assetUpdates>",
    '叙事结束。{"assetUpdates":{"locations":[]}}',
    '{"narrative":"正文","effects":[]}',
    '正文\n"factUpdates": {"introduce":[]}',
    '```json\n{"tool_calls":[]}\n```'
  ]) assert.equal(isNarrativePlainText(text), false);
});

test("有效工具字段缺失或非法引用不会被默认成空数组、原地停留或静默过滤", () => {
  const envelope: NarrativeTurnEnvelope = {
    callId: "strict:plan", source: "scene", worldId: "ancient", currentAge: 20,
    backgroundAgeRange: { fromAge: 21, toAge: 22 }, act: { id: "act.one", label: "防务", prompt: "守住边境" },
    beat: "pressure", capabilities: ["scene", "choice"], storyPatterns: [], socialForces: [],
    focusReferences: [{ id: "ability:bow", kind: "ability", label: "骑射" }],
    statTiers: resolveNarrativeStatTiers(makeRun().stats),
    clock: { mode: "hold", sameAgeTurnCount: 2, maxSameAgeTurns: 3 }, actOutline: outlineForTest("act.one")
  };
  const args = planningReplyForTest({ clockRequest: "hold", conflictRefs: [], abilityRefs: ["ability:bow"], forceIds: [], locationDirective: { mode: "stay" } });
  const { abilityRefs: _omitted, ...missing } = args;
  assert.throws(() => parseNarrativeTurnPlan(missing, "plan_scene_turn", envelope),
    (error: unknown) => error instanceof NarrativeOutcomeError && error.validation?.path === "abilityRefs");
  assert.throws(() => parseNarrativeTurnPlan({ ...args, forceIds: [{ ref: "unregistered", purpose: "支援" }] }, "plan_scene_turn", envelope),
    (error: unknown) => error instanceof NarrativeOutcomeError && error.validation?.path === "forceIds[0].ref");
  const choices = ["safe", "balanced", "risky"].map((id) => ({ id, label: "守住河口", description: "改变防守部署", abilityRefs: [], locationDirective: { mode: "stay" } }));
  assert.throws(() => normalizeMilestoneOptionOverrides(choices.map((row) => ({ ...row, locationDirective: { mode: "unknown" } })), true),
    (error: unknown) => error instanceof NarrativeOutcomeError && error.validation?.rule === "choice_location_mode_invalid");
});

test("幕初世界卡的协议错误只纠正该请求，普通年保存后不重复规划", async (t) => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  const run = makeRun(); run.worldId = "ancient"; run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  const envelope: NarrativeTurnEnvelope = {
    callId: "initial-card", source: "background", worldId: "ancient", currentAge: run.age,
    backgroundAgeRange: { fromAge: run.age + 1, toAge: run.age + 1 }, act: definition.mainlineActs![0], beat: "setup",
    capabilities: ["background"], storyPatterns: [], socialForces: [], focusReferences: [],
    statTiers: resolveNarrativeStatTiers(run.stats), clock: { mode: "advance", sameAgeTurnCount: 0, maxSameAgeTurns: 3 }
  };
  let calls = 0;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string; parameters: { required: string[] } } }>; messages: Array<{ content: string }> }) => {
    calls++;
    assert.deepEqual(payload.tools[0].function.parameters.required, ["actWorldCard"]);
    if (calls === 2) {
      const correction = JSON.parse(payload.messages.at(-1)!.content.split("\n").at(-1)!);
      assert.equal(correction.reason, "narrative_act_outline_invalid");
      assert.equal(correction.validation.path, "actWorldCard");
    }
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: `initial:${calls}`, type: "function",
      function: { name: "plan_scene_turn", arguments: JSON.stringify({ actWorldCard: calls === 1 ? { beats: {} } : actWorldCardForTest() }) } }] } }] };
  });
  const ctx = { ...memoryTestContext(run), apiKey: "not-sent", narrativePlan: buildNarrativePromptPlan(run, definition, null, "planning") };
  const first = await generateNarrativeTurnPlan(run, world, envelope, ctx);
  commitNarrativeActOutline(run.narrative, first.actOutline!);
  const restored = ensureNarrativeRunState(JSON.parse(JSON.stringify(run.narrative)), true, run.age);
  const next = await generateNarrativeTurnPlan(run, world, { ...envelope, actOutline: restored.actRuntime!.outline }, ctx);
  assert.equal(calls, 2);
  assert.equal(next.turnKind, "background");
  assert.deepEqual(next.actOutline, first.actOutline);
  assert.equal(JSON.stringify(run).includes("originalToolArguments"), false);
});

test("原人物同步故障回放：八人只更新关系说明，父亲离场，不要求补写态度且整批一次提交", async (t) => {
  const run = makeRun(); run.age = 61; run.narrative.enabled = true;
  const people = registerNarrativeParticipants(run, Array.from({ length: 10 }, (_, index) => ({
    characterRef: "new", name: index === 7 ? "父亲" : `故人${index}`, role: "边镇故人", description: "沉稳寡言，长期居住边镇", recurring: true,
    relationship: { stance: "guarded" as const, summary: "彼此仍有所保留" }
  })), "earlier").map(({ character }) => character);
  people[7].lastSeenAge = 54;
  const untouched = structuredClone(people.slice(8));
  for (const age of [59, 60, 61]) stageNarrativeAssetRound(run, {
    sourceEventId: `maintenance:${age}`, source: "scene", age, actId: "act.one", subject: "边镇生活",
    narrative: age === 61 ? "父亲病故，粮案也已经结清。其他故人各有归处。" : "你与边镇故人生活往来。"
  }, {}, { age });
  let calls = 0;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string; parameters: any } }> }) => {
    calls++;
    const tool = payload.tools[0].function;
    assert.deepEqual(tool.parameters.properties.relationshipUpdates.items.required, ["characterRef"]);
    assert.equal(tool.parameters.properties.relationshipUpdates.items.anyOf, undefined);
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "maintain", type: "function", function: { name: tool.name, arguments: JSON.stringify({
      locationUpdates: [], abilityUpdates: [], identityMerges: [], factUpdates: [],
      factIntroductions: [{ kind: "experience", label: "粮案已经结清", status: "finish", sourceEventId: "maintenance:61" }],
      relationshipUpdates: people.slice(0, 8).map((person, index) => ({ characterRef: person.id,
        summary: index === 7 ? "父亲已经病故，留下的教诲仍影响你" : "旧日交情尚在，各自生活已安定",
        ...(index === 7 ? { status: "gone", description: "边镇老军士，性情沉稳，已经病故" } : {})
      }))
    }) } }] } }] };
  });
  await synchronizeNarrativeAssetBatch(run, world, { ...memoryTestContext(run), apiKey: "not-sent" }, "original-relationship-failure");
  assert.equal(calls, 1, "原返回已经符合增量协议，不依赖纠正请求补齐未变化字段");
  const father = run.narrative.dynamicCharacters[7];
  assert.equal(father.relationship!.stance, "guarded");
  assert.match(father.relationship!.summary!, /已经病故/);
  assert.equal(father.lastSeenAge, 54, "整理人物不等于人物再次出场");
  assert.equal(father.status, "gone");
  assert.ok(!run.narrative.activeCharacterIds.includes(father.id));
  assert.deepEqual(run.narrative.dynamicCharacters.slice(8), untouched);
  const event = run.story.factLedger!.facts.find((fact) => fact.label === "粮案已经结清")!;
  assert.equal(event.status, "resolved");
  assert.ok(run.narrative.dynamicCharacters.every((person) => !person.relationship?.relatedFactIds.includes(event.id)), "同批事件不自动归给全部人物关系");
  const restored = structuredClone(run);
  restored.narrative = ensureNarrativeRunState(JSON.parse(JSON.stringify(run.narrative)), true, run.age);
  assert.equal(restored.narrative.dynamicCharacters[7].relationship!.stance, "guarded");
  assert.ok(!selectDynamicNarrativeContext(restored, { task: "planning" }).characters.some((entry) => entry.id === father.id));
  assert.ok(selectDynamicNarrativeContext(restored, { task: "rendering", characterIds: [father.id] }).characters[0].relationship?.includes("父亲已经病故"));
  const turn = appendPublicTurnRecord(restored, { entryId: "maintenance:61", age: 61, ageStage: { label: "老年" }, kind: "passage", narrative: "你送别父亲。", statChanges: {} });
  assert.equal(turn.narrativeCharactersSnapshot!.length, 10, "档案不能按最后八人淘汰早期人物");
  assert.match(turn.narrativeCharactersSnapshot![7].relationship!, /父亲已经病故/);
  assert.equal(run.narrative.assetBuffer, undefined);
});

test("关系增量可从单个已知维度建立，恢复与后续更新保留其他最新字段", () => {
  const run = makeRun(); run.age = 15;
  const [first, second] = registerNarrativeParticipants(run, ["军医", "押队"].map((name) => ({ characterRef: "new", name, recurring: true })), "encounter");
  const ids = [first.character.id, second.character.id];
  applyNarrativeRelationshipUpdates(run, parseRelationshipUpdates([
    { characterRef: ids[0], summary: "愿意传授急救", role: "随军医师" },
    { characterRef: ids[1], stance: "guarded", factionId: "army" }
  ], ids, ["army"]));
  const restored = ensureNarrativeRunState(JSON.parse(JSON.stringify(run.narrative)), true, 15);
  assert.equal(restored.dynamicCharacters[0].relationship!.stance, undefined);
  assert.equal(restored.dynamicCharacters[0].relationship!.summary, "愿意传授急救");
  assert.equal(restored.dynamicCharacters[1].relationship!.summary, undefined);
  run.narrative = restored;
  applyNarrativeRelationshipUpdates(run, parseRelationshipUpdates([
    { characterRef: ids[0], stance: "friendly" }, { characterRef: ids[1], factionId: "", description: "已脱离军队的旧押队" }
  ], ids, ["army"]));
  assert.equal(run.narrative.dynamicCharacters[0].relationship!.summary, "愿意传授急救");
  assert.equal(run.narrative.dynamicCharacters[1].relationship!.stance, "guarded");
  assert.equal(run.narrative.dynamicCharacters[1].factionId, undefined);
  const text = selectDynamicNarrativeContext(run, { task: "rendering", characterIds: ids }).characters.map((person) => person.relationship).join("\n");
  assert.doesNotMatch(text, /undefined/);
  applyNarrativeRelationshipUpdates(run, parseRelationshipUpdates([{ characterRef: ids[0], summary: "" }], ids));
  assert.equal(run.narrative.dynamicCharacters[0].relationship!.summary, undefined);
  assert.equal(run.narrative.dynamicCharacters[0].relationship!.stance, "friendly", "清除关系说明不覆盖未提交的态度");
});

test("轻登记在三轮后按原 ID 补充已知资料，未知字段不强填，使用和回访不重写介绍", async (t) => {
  const run = makeRun(); run.age = 5; run.narrative.enabled = true;
  const first = stageNarrativeAssetRound(run, { sourceEventId: "fill:3", source: "background", age: 3, subject: "初学", narrative: "你随军医在营地学会包扎。" }, {
    participants: [{ characterRef: "new", name: "林医师", recurring: true }],
    assetUpdates: { locations: [{ ref: "new", name: "医帐", current: true }], abilities: [{ ref: "new", name: "包扎" }] }
  }, { age: 3 })!;
  const locationId = first.locations[0].ref, abilityId = first.abilities[0].ref, personId = run.narrative.dynamicCharacters[0].id;
  const saved = JSON.parse(JSON.stringify(run)) as typeof run;
  saved.narrative = ensureNarrativeRunState(saved.narrative, true, 5);
  for (const age of [4, 5]) stageNarrativeAssetRound(saved, { sourceEventId: `fill:${age}`, source: "background", age, subject: "日常", narrative: "你在营中安稳生活。" }, {}, { age });
  let calls = 0;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string } }> }) => {
    calls++;
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "fill", type: "function", function: { name: payload.tools[0].function.name, arguments: JSON.stringify({
      locationUpdates: [{ ref: locationId, spatialDescription: "军营内用于医治伤员的帐篷" }],
      abilityUpdates: [{ ref: abilityId, usage: "清理伤口并包裹，能处理轻伤", mastery: "初学" }],
      relationshipUpdates: [{ characterRef: personId, role: "随军医师", summary: "你的包扎老师" }],
      identityMerges: [], factIntroductions: [], factUpdates: []
    }) } }] } }] };
  });
  await synchronizeNarrativeAssetBatch(saved, world, { ...memoryTestContext(saved), apiKey: "not-sent" }, "first-fill");
  assert.equal(calls, 1);
  assert.deepEqual(saved.narrative.assets!.locations.map((entry) => entry.id), [locationId]);
  assert.deepEqual(saved.narrative.assets!.abilities.map((entry) => entry.id), [abilityId]);
  assert.equal(saved.narrative.dynamicCharacters[0].id, personId);
  assert.equal(saved.narrative.dynamicCharacters[0].pendingDetails, true, "补充角色但未明确完成，不由引擎推断已完善");
  assert.equal(saved.narrative.assets!.locations[0].pendingDetails, true);
  assert.equal(saved.narrative.assets!.abilities[0].pendingDetails, true);
  assert.equal(saved.narrative.assets!.abilities[0].source, undefined, "未知来历不由引擎虚构");
  assert.equal(saved.narrative.dynamicCharacters[0].relationship!.stance, undefined);
  assert.equal(saved.narrative.assets!.locations[0].lastSeen.age, 3, "五岁整理旧地点不算五岁到访");
  const abilityBefore = structuredClone(saved.narrative.assets!.abilities[0]);
  saved.narrative.assets = applyNarrativeAssetActivity(saved.narrative.assets, { locationIds: [locationId], currentLocationId: locationId, abilityIds: [abilityId] }, { age: 6 });
  saved.narrative.assets = applyNarrativeAssetUpdates(saved.narrative.assets, first, { age: 6 }).assets;
  assert.deepEqual(saved.narrative.assets.abilities[0], abilityBefore, "最终提交引用不制造本领成长，也不回放旧字段");
  assert.equal(saved.narrative.assets.locations[0].lastSeen.age, 6);
  assert.equal(publicNarrativeAssetsSnapshot(saved.narrative.assets).locations[0].spatialDescription, "军营内用于医治伤员的帐篷");
  const recalled = formatNarrativeAssets(saved.narrative.assets);
  assert.match(recalled, /包扎（初学）/);
  assert.doesNotMatch(recalled, /清理伤口并包裹/);
});

test("归并暂存对象后同一响应的整合字段落在保留 ID，保存恢复不会带回重复记录", () => {
  const run = makeRun(); run.age = 12; run.narrative.enabled = true;
  for (const [age, suffix] of [[10, "原"], [12, "重复"]] as const) stageNarrativeAssetRound(run, {
    sourceEventId: `merge:${age}`, source: "scene", age, subject: "军旅", narrative: "你在北营跟随教习练习骑射。"
  }, { participants: [{ characterRef: "new", name: `${suffix}教习`, recurring: true }],
    assetUpdates: { locations: [{ ref: "new", name: `${suffix}北营` }], abilities: [{ ref: "new", name: `${suffix}骑射` }] }
  }, { age });
  const [person, duplicatePerson] = run.narrative.dynamicCharacters;
  const [place, duplicatePlace] = run.narrative.assets!.locations;
  const [skill, duplicateSkill] = run.narrative.assets!.abilities;
  const changes = {
    identityMerges: [
      { kind: "character" as const, sourceRef: duplicatePerson.id, targetRef: person.id },
      { kind: "location" as const, sourceRef: duplicatePlace.id, targetRef: place.id },
      { kind: "ability" as const, sourceRef: duplicateSkill.id, targetRef: skill.id }
    ],
    relationshipUpdates: [{ characterRef: duplicatePerson.id, role: "骑兵教习", description: "沉稳的老骑兵，负责教授骑射", summary: "你的骑射老师" }],
    assetUpdates: { locations: [{ ref: duplicatePlace.id, name: "北营", spatialDescription: "关城北面的骑兵营寨" }], abilities: [{ ref: duplicateSkill.id,
      name: "骑射", description: "骑乘中射击的技艺", usage: "在奔马上射击近距目标", mastery: "熟练", source: "十岁起由北营教习传授" }] }
  };
  applyNarrativeIdentityMerges(run, changes.identityMerges);
  const canonical = canonicalizeNarrativeReferences(run.narrative, changes);
  applyNarrativeRelationshipUpdates(run, canonical.relationshipUpdates);
  commitNarrativeAssets(run.narrative, applyNarrativeAssetUpdates(run.narrative.assets, canonical.assetUpdates, { age: 12 }), { age: 12 });
  const restored = ensureNarrativeRunState(JSON.parse(JSON.stringify(run.narrative)), true, 12);
  assert.deepEqual(restored.assetBuffer!.characters.map((entry) => entry.id), [person.id]);
  assert.deepEqual(restored.assetBuffer!.locations.map((entry) => entry.id), [place.id]);
  assert.deepEqual(restored.assetBuffer!.abilities.map((entry) => entry.id), [skill.id]);
  assert.equal(restored.assets!.abilities[0].name, "骑射");
  assert.equal(restored.assets!.abilities[0].source, "十岁起由北营教习传授");
  assert.equal(restored.assets!.locations[0].spatialDescription, "关城北面的骑兵营寨");
  assert.equal(restored.dynamicCharacters[0].relationship!.summary, "你的骑射老师");
  assert.equal(restored.dynamicCharacters.length, 1);
  assert.equal(restored.identityAliases![duplicateSkill.id], skill.id);
});

test("同一经历由持续转为完成，保留发生幕间和来源年龄，下一幕不再作为待办", () => {
  const run = makeRun(); run.age = 30;
  const initial = parseFactUpdates({ introduce: [{ kind: "experience", label: "随队学习营中救护", status: "stay", sourceEventId: "event:20" }] },
    factUpdateContract([], [{ sourceEventId: "event:20", age: 20, actId: "act.one" }]))!;
  const [id] = applyNarrativeFactUpdates(run, initial, { sourceEventId: "batch:last", actId: "act.one" });
  const finished = parseFactUpdates({ updates: [{ factId: id, status: "finish", summary: "随队救护学习已经完成，具备了处理轻伤的经验", sourceEventId: "event:23" }] },
    factUpdateContract([id], [{ sourceEventId: "event:23", age: 23, actId: "act.two" }]))!;
  applyNarrativeFactUpdates(run, finished, { sourceEventId: "batch:last", actId: "act.two" });
  const fact = run.story.factLedger!.facts.find((entry) => entry.id === id)!;
  assert.equal(fact.actId, "act.one");
  assert.equal(fact.sourceEventId, "event:20");
  assert.equal(fact.introducedAge, 20);
  assert.equal(fact.resolvedAge, 23);
  assert.equal(fact.lastSourceEventId, "event:23");
  assert.equal(fact.status, "resolved");
  assert.equal(run.story.factLedger!.facts.filter((entry) => entry.id === id).length, 1);
  assert.ok(!narrativeContinuityFacts(run.story.factLedger!.facts, "act.two").some((entry) => entry.id === id));
  assert.ok(!selectDynamicNarrativeContext(run, { task: "planning" }).facts.some((entry) => entry.id === id));
});

test("正文实际请求只读统一历史与最新角色面板，技能经历不随资产再次回传", async () => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  const run = makeRun(); run.worldId = "ancient"; run.age = 20; run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  commitNarrativeActOutline(run.narrative, outlineForTest(run.narrative.actRuntime!.actId));
  const [companion] = registerNarrativeParticipants(run, [{ characterRef: "new", name: "石墩", role: "巡防同袍", description: "沉稳寡言的老斥候",
    recurring: true, relationship: { stance: "friendly", summary: "愿意协助巡防" } }], "origin");
  run.narrative.assets = applyNarrativeAssetUpdates(undefined, { locations: [{ ref: "new", name: "边关", current: true,
    spatialDescription: "山口的关城与哨道", description: "控制山口的边防关城" }], abilities: [{ ref: "new", name: "骑射", mastery: "熟练", source: "旧师传授",
    description: "十岁出征救人的展示经历", usage: "上次从西坡绕袭后冲锋的详细策略" }] }, { age: 10 }).assets;
  const skill = run.narrative.assets.abilities[0];
  for (const [id, age, body] of [["origin", 0, "生于边镇，与家人相依。"], ["rescue", 20, "救回同袍后，追兵已经远去。"]] as const) {
    commitNarrativeMemory(run.narrative, { id: `memory:${id}`, age, text: body, characterIds: [], factionIds: [], factIds: [] });
    commitNarrativeEpisode(run, { callId: id, sourceEventId: id, turnKind: id === "origin" ? "origin" : "scene", age });
  }
  run.aiConversation = { year: { headCore: "", systemHash: "", headMemory: "不应走这条摘要旁路", archive: [], history: [
    { role: "user", content: "旧对话任务", turnId: "memory:rescue" }, { role: "assistant", content: "不应混入的旧会话文本" }
  ] } };
  const ctx = { ...memoryTestContext(run), narrativePlan: buildNarrativePromptPlan(run, definition, null, "rendering", { focusIds: [skill.id, companion.character.id] }) };
  const request = prepareNarrativeOutcomeRequest(run, world, ctx, narrativeDecisionRenderTool(), "叙述21岁的经历", { task: "rendering", contracts: { assets: true, references: true } });
  const text = request.history.map((message) => message.content).join("\n");
  assert.equal(text.split("救回同袍后，追兵已经远去。").length - 1, 1);
  assert.ok(text.indexOf("生于边镇") < text.indexOf("救回同袍后"));
  assert.ok(text.indexOf("救回同袍后") < text.indexOf("当前年龄：20岁"));
  assert.ok(text.indexOf("当前年龄：20岁") < text.indexOf("叙述21岁的经历"));
  assert.ok(text.indexOf("救回同袍后") < text.indexOf("山口的关城与哨道"));
  assert.ok(text.indexOf("救回同袍后") < text.indexOf("叙述21岁的经历"));
  assert.match(text, /骑射（熟练）/);
  assert.match(text, /石墩.*巡防同袍/);
  assert.match(text, /愿意协助巡防/);
  assert.match(text, /边关.*山口的关城与哨道/);
  assert.match(text, /沉稳寡言的老斥候/);
  assert.match(text, /控制山口的边防关城/);
  for (const unwanted of ["不应混入的旧会话文本", "不应走这条摘要旁路", skill.description!, skill.usage!]) assert.ok(!text.includes(unwanted));
  const legacy = { ...skill, status: "unavailable" };
  assert.equal(normalizeNarrativeAssets({ locations: [], abilities: [legacy] }).abilities.length, 1);
  assert.equal(Object.hasOwn(normalizeNarrativeAssets({ locations: [], abilities: [legacy] }).abilities[0], "status"), false);
});

// Exercise the real persistence queue without opening or changing a player's archive.
function replayStore(t: TestContext) {
  let saved: { runs: Array<{ run: ReturnType<typeof makeRun>; generationFailures?: any[] }> } = { runs: [] };
  const readFile = fs.readFile.bind(fs), writeFile = fs.writeFile.bind(fs);
  const mkdir = fs.mkdir.bind(fs), rename = fs.rename.bind(fs);
  const isStore = (file: unknown) => String(file).includes("anonymous-game-store.json");
  t.mock.method(fs, "readFile", async (...args: Parameters<typeof fs.readFile>) => {
    if (isStore(args[0])) throw Object.assign(new Error("replay store starts empty"), { code: "ENOENT" });
    return readFile(...args);
  });
  t.mock.method(fs, "writeFile", async (...args: Parameters<typeof fs.writeFile>) => {
    if (isStore(args[0])) { saved = JSON.parse(String(args[1])); return; }
    return writeFile(...args);
  });
  t.mock.method(fs, "mkdir", async (...args: Parameters<typeof fs.mkdir>) => {
    if (String(args[0]).replaceAll("\\", "/").endsWith("/storage")) return undefined;
    return mkdir(...args);
  });
  t.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
    if (isStore(args[0])) return;
    return rename(...args);
  });
  return (runId: string) => {
    const record = saved.runs.find((entry) => entry.run.runId === runId);
    assert.ok(record);
    return record;
  };
}

test("本次原故障回放：新人物漏 characterRef 在分配身份前纠正，诊断留存且成功资产只提交一次", async (t) => {
  const stored = replayStore(t);
  const { session } = await resolveAnonymousSession();
  const run = makeRun(); run.age = 8; run.worldId = "ancient"; run.narrative.enabled = true;
  const definition = await loadNarrativeExperienceForTest("ancient");
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  const characterId = "character:f0dc006e-c556-4735-9b2f-777240893a25";
  const abilityId = "ability:24461dcd-47c2-44b7-a5d8-8575bd4492ff";
  const locationId = "location:b2bce661-9fa2-406e-bd8f-630965781ee1";
  const [mentor] = registerNarrativeParticipants(run, [{ characterRef: "new", name: "温衡", role: "外祖", description: "在山上教你辨药", recurring: true }], "origin");
  mentor.character.id = characterId;
  run.narrative.assets = {
    currentLocationId: locationId,
    locations: [{ id: locationId, name: "山观", description: "出生后居住的山观", spatialDescription: "山上的道观和药房", introduced: { age: 0 }, lastSeen: { age: 8 } }],
    abilities: [{ id: abilityId, name: "辨药识性", description: "已识常见药材", usage: "按形色气味辨认常见药材", source: "外祖督课", mastery: "初通", introduced: { age: 5 }, updated: { age: 8 } }]
  };
  await saveRun(structuredClone(run), session.id);
  const before = structuredClone(run);
  const bad = {
    narrative: "九岁那年秋，山下妇人抱来一个泻得脱了形的孩子。外祖开柜取药，叫你在旁一味一味指认、复述药性。你报得清楚，还说了句\"这味炮过才不伤脾胃\"。妇人怔住，问：这么小的娃也懂药？外祖只答：先记着。此后山下有人上山，总要多看你两眼。",
    storyDelta: "山下村民抱腹泻脱水的孩子来求治，外祖让主角在旁指认药包、复述药性；主角辨得分明，还指出某味须炮制才不伤脾胃。求治的妇人惊讶议论，主角的辨药第一次被外人看见，山下渐有口碑。",
    participants: [{ name: "陈阿嫂", role: "山下村民", description: "邻村妇人，抱泻得脱形的孩子上山求治，见九岁的主角能指认药包、说出炮制之理，惊讶之余把这事带下山去传。", recurring: true, factionId: "ancient.faith", relationship: { stance: "friendly", summary: "对这观里的小娃会辨药觉得稀奇，愿意信他几分。" } }],
    assetUpdates: { locations: [], abilities: [{ ref: abilityId, name: "辨药识性", description: "由认药三年积下的形、色、气味、炮制功夫推进而来，已能在指认药包之外，判断某味是否合用、该炮还是生用、剂量轻重与几样常见禁忌。", usage: "面对已识的常见药材，可当场指认品类、判断合不合用、说出炮制与剂量的初步道理；未识之药、复杂配伍与重剂仍不能断，且外祖明令不得自己动手取药。", source: "外祖温衡自五岁起督课认药，九年积功，第一次被山下求治的村民当场检验。", mastery: "初识方理" }] },
    factUpdates: { introduce: [], updates: [] },
    continuityRefs: { factIds: [], characterIds: [characterId], locationIds: [], abilityIds: [abilityId] },
    assetActivity: { locationIds: [locationId], abilityIds: [abilityId], currentLocationId: locationId },
    continuityRequired: true
  };
  const good = { ...bad, participants: bad.participants.map((entry) => ({ ...entry, characterRef: "new" })) };
  let calls = 0;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string; parameters: any } }>; messages: Array<{ content: string }> }) => {
    calls++;
    assert.ok(calls <= 2);
    const tool = payload.tools[0].function;
    assert.equal(tool.name, "render_background_prose");
    assert.ok(tool.parameters.properties.participants.items.required.includes("characterRef"));
    assert.deepEqual(Object.keys(tool.parameters.properties.participants.items.properties), ["characterRef", "name"]);
    assert.equal(tool.parameters.properties.assetUpdates.properties.abilities.items.properties.usage, undefined);
    assert.equal(tool.parameters.properties.factUpdates, undefined);
    if (calls === 2) {
      const correction = JSON.parse(payload.messages.at(-1)!.content.split("\n").at(-1)!);
      assert.equal(correction.validation.rule, "character_reference_invalid");
      assert.equal(correction.validation.path, "participants[0].characterRef");
      assert.deepEqual(correction.originalToolArguments, bad);
      assert.deepEqual(run, before);
      assert.deepEqual((await getRun(run.runId))!, before);
      assert.equal(stored(run.runId).generationFailures!.length, 1);
    }
    return { id: `participant-response:${calls}`, choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: `participant-call:${calls}`, type: "function", function: { name: tool.name, arguments: JSON.stringify(calls === 1 ? bad : good) } }] } }] };
  });
  const context = { ...memoryTestContext(run), apiKey: "not-sent", requestId: "participant-step", callId: "participant-replay", usageScope: { sessionId: session.id, runId: run.runId, worldId: run.worldId } };
  const act = definition.mainlineActs![0];
  const { result } = await runNarrativeTurnTransaction(run, async (working) => {
    const rendered = await generateDynamicNarrativeScene(working, world, {
      act, beat: "setup", presentation: "summary", allowedTurnKinds: ["background"], sceneAge: 9,
      backgroundAgeRange: { fromAge: 9, toAge: 9 }, storyPatterns: [],
      socialForces: [{ id: "ancient.faith", label: "教门", summary: "民间医药与信仰" }], knownCharacters: [],
      statTiers: resolveNarrativeStatTiers(working.stats), attributePolicy: dynamicSceneAttributePolicy(), backgroundAttributePolicy: dynamicBackgroundAttributePolicy(working)
    }, context);
    assert.deepEqual(working, before, "解析和纠正期间不登记资产或推进年龄");
    stageNarrativeAssetRound(working, { sourceEventId: rendered.handoff!.sourceEventId, source: "background", subject: "九岁辨药", age: 9, narrative: rendered.narrative }, rendered, { age: 9 });
    working.age = 9;
    return rendered;
  });
  await saveRun(run, session.id);
  assert.equal(calls, 2);
  assert.equal(result.narrative, bad.narrative);
  assert.match(result.participants[0].characterRef, /^character:/);
  assert.equal(run.narrative.dynamicCharacters.filter((entry) => entry.name === "陈阿嫂").length, 1);
  assert.equal(run.narrative.assets!.abilities.length, 1);
  assert.equal(run.narrative.assets!.abilities[0].mastery, "初通", "正文中已发生的变化留在待整理正文，登记不直接改写本领字段");
  const diagnostic = stored(run.runId).generationFailures!;
  assert.equal(diagnostic.length, 1, "后续成功保存保留原失败证据，不重复登记外层日志");
  assert.equal(diagnostic[0].committedAge, 8);
  assert.equal(diagnostic[0].age, 9);
  assert.deepEqual(diagnostic[0].ageRange, { fromAge: 9, toAge: 9 });
  assert.equal(diagnostic[0].requestId, "participant-step");
  assert.equal(diagnostic[0].responseId, "participant-response:1");
  assert.equal(diagnostic[0].toolCallId, "participant-call:1");
  assert.equal(diagnostic[0].originalToolArguments, JSON.stringify(bad));
  assert.equal(JSON.stringify(run).includes("originalToolArguments"), false);
});

test("本次原故障回放：郝敬人物 ID 抄错在具名目录内纠正，原正文和抉择正常提交", async (t) => {
  const background = {
  "narrative": "二十四年上，镇里没起大警。你清早到厅上生火盆，誊完轮值册便去渠口点出工，午后又替郝敬核一遍哨粮。白氏磨面时仍唤你记草束，孙韩二人下墙来，蹲在厅阶上啃干粮，问一句北面的路。祖父算盘声一日轻似一日，母亲仍不盖严那本悬名册。",
  "participants": [
    {
      "characterRef": "character:701ecf5a-0129-4db9-9fcf-623c909f43e4"
    },
    {
      "characterRef": "character:34bb3acd-9b30-4eb6-9781-f3045f853f9e"
    },
    {
      "characterRef": "character:67007ff3-12b3-4fd2-b838-ad0ec16fcc0f"
    }
  ],
  "assetUpdates": {
    "locations": [
      {
        "ref": "location:7676918c-3efe-4340-bba7-7272dc8fee31",
        "current": true
      },
      {
        "ref": "location:13b2acb7-d774-4c3a-9d31-1533053cdf94"
      }
    ],
    "abilities": [
      {
        "ref": "ability:0f6a66fa-9c31-49f3-af9d-24e783357516"
      }
    ]
  },
  "assetActivity": {
    "locationIds": [
      "location:7676918c-3efe-4340-bba7-7272dc8fee31",
      "location:13b2acb7-d774-4c3a-9d31-1533053cdf94"
    ],
    "abilityIds": [
      "ability:0f6a66fa-9c31-49f3-af9d-24e783357516"
    ],
    "currentLocationId": "location:7676918c-3efe-4340-bba7-7272dc8fee31"
  }
};
  const choice = {
  "narrative": "入九月，风一日紧似一日。第二燧该在辰时正发平安号，你在厅下数到日头偏西，北面那道烟始终没起。你翻轮值册：今日当班的是白家老二，替班记的是韩家，两处墨迹新旧不一。你把册子摊到郝敬案前，只说了一句：“辰时该有号，没有。”\n\n午后东面烟墩倒先起了烟，三股、又断，是求援不是报警。哨探回来说，东沟外见了裹布蹄印，往东斜去，不止一拨，数目比去年你报的还多。厅里火盆烧到二更，屯田经手人咬着牙根说征不出粮，援兵得等府里回文。\n\n郝敬把短刀往案上一搁，看你：“第二燧失联，东面马队已在道上。你去哪一头，带谁走，我看着。”\n\n厅外孙家老大与韩家独子都候着，衣裳单薄，枪却是擦过的。",
  "decisionBrief": {
    "question": "第二燧失联、东面马队压来，你向郝敬要哪一头的差事、带谁出镇？",
    "stakes": "取哪一头，决定你先摸到失联真相还是先堵住马队；所带人手与粮秣的多寡，决定小队能否回得来；郝敬据此看你是否堪当部众。"
  },
  "background": "定远镇守备厅，火盆烧到二更。第二燧辰时平安号未发，东面烟墩断号求援，哨探报裹布蹄印往东斜去不止一拨。厅中粮秣支绌，援兵待府里回文。郝敬将短刀搁在案上，等你作答。",
  "optionOverrides": [
    {
      "id": "safe",
      "label": "领第二燧一路，只要孙韩二人与一匹驮马",
      "description": "据轮值册先定失联是号误还是人失，轻装北上探燧，遇变即退不硬拼。争的是先弄清真相、把人手带回来；风险是东路无人管，马队若真断道，镇子先挨一记。",
      "abilityRefs": [
        "ability:0f6a66fa-9c31-49f3-af9d-24e783357516"
      ],
      "locationDirective": {
        "mode": "move",
        "purpose": "北去第二燧旧址查失联实情"
      }
    },
    {
      "id": "balanced",
      "label": "要十人分两拨：一拨登第二燧查号，一拨守东沟口",
      "description": "向郝敬请十人、两日口粮，分兵兼顾两头，以旗鼓呼应。争的是既不弃燧也不放道；风险是人手本就单薄，一分便都薄，且厅里粮秣未必肯给足。",
      "abilityRefs": [
        "ability:0f6a66fa-9c31-49f3-af9d-24e783357516"
      ],
      "locationDirective": {
        "mode": "move",
        "purpose": "先赴东沟口择地设望，兼顾北燧与东路"
      }
    },
    {
      "id": "risky",
      "label": "请郝敬把东墙能抽的壮丁全数交你，直扑东沟马队",
      "description": "认准裹布蹄印是实据，趁马队尚未合势先咬住其一路，夺马、捉俘口问路。争的是一举摸清北面军势；风险是壮丁皆新、你手上带队功夫尚生，败则定远东路尽空。",
      "abilityRefs": [
        "ability:0f6a66fa-9c31-49f3-af9d-24e783357516"
      ],
      "locationDirective": {
        "mode": "move",
        "purpose": "出东沟口追蹑裹布蹄印的马队"
      }
    }
  ],
  "participants": [
    {
      "characterRef": "character:701ecf5a-0129-4db9-9fcf-623c909f43e4"
    }
  ],
  "assetUpdates": {
    "locations": [
      {
        "ref": "location:7676918c-3efe-4340-bba7-7272dc8fee31",
        "current": true
      }
    ],
    "abilities": []
  },
  "assetActivity": {
    "locationIds": [
      "location:7676918c-3efe-4340-bba7-7272dc8fee31"
    ],
    "currentLocationId": "location:7676918c-3efe-4340-bba7-7272dc8fee31",
    "abilityIds": [
      "ability:0f6a66fa-9c31-49f3-af9d-24e783357516"
    ]
  }
};
  const characters = [{"id":"character:701ecf5a-0129-4db4-9fcf-623c909f43e4","name":"郝敬"},{"id":"character:3f524268-8021-487b-812b-95ec305720e0","name":"方父"},{"id":"character:23e2ca68-8cfc-499c-ba81-0e7048024d0f","name":"窦氏"},{"id":"character:34bb3acd-9b30-4eb6-9781-f3045f853f9e","name":"祖父"},{"id":"character:67007ff3-12b3-4fd2-b838-ad0ec16fcc0f","name":"白家寡妇"}];
  const locations = [{"id":"location:e9e1ad04-934e-4729-9e86-406c2c61b1de","name":"定远镇"},{"id":"location:7676918c-3efe-4340-bba7-7272dc8fee31","name":"定远镇守备厅"},{"id":"location:36834b48-60bf-4ee7-acc0-b2b071e2bc80","name":"镇北烽燧"},{"id":"location:13b2acb7-d774-4c3a-9d31-1533053cdf94","name":"屯田渠水"}];
  const ability = {"id":"ability:0f6a66fa-9c31-49f3-af9d-24e783357516","name":"辨旗鼓号令"};
  const correctId = characters.find((entry) => entry.name === "郝敬")!.id;
  const currentLocationId = background.assetActivity.currentLocationId;
  const scenarios = [
    { name: "普通年份纠正后提交", original: background, toolName: "render_background_prose", isChoice: false, remainsInvalid: false },
    { name: "抉择纠正后保留原选项并提交", original: choice, toolName: "render_choice_prose", isChoice: true, remainsInvalid: false },
    { name: "抉择纠正后仍写错 ID，保持原存档", original: choice, toolName: "render_choice_prose", isChoice: true, remainsInvalid: true }
  ];
  for (const scenario of scenarios) await t.test(scenario.name, async (t) => {
    const stored = replayStore(t);
    const { session } = await resolveAnonymousSession();
    const baseWorld = await loadNarrativeWorldDefinition("ancient"); assert.ok(baseWorld);
    const pack = await loadNarrativeStoryPack(baseWorld, "ancient.frontier-commander"); assert.ok(pack);
    const definition = resolveNarrativeExperience(baseWorld, pack);
    const run = makeRun(); run.worldId = "ancient"; run.age = scenario.isChoice ? 24 : 23; run.narrative.enabled = true;
    run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
    run.narrative.actRuntime!.beat = "climax";
    for (const entry of characters) {
      const [registered] = registerNarrativeParticipants(run, [{ characterRef: "new", name: entry.name, recurring: true }], "origin");
      registered.character.id = entry.id;
    }
    run.narrative.assets = {
      currentLocationId,
      locations: locations.map((entry) => ({ ...entry, introduced: { age: 0 }, lastSeen: { age: run.age } })),
      abilities: [{ ...ability, mastery: "能辨旗鼓号令", introduced: { age: 11 }, updated: { age: 21 } }]
    };
    await saveRun(structuredClone(run), session.id);
    const before = structuredClone(run);
    const corrected = structuredClone(scenario.original);
    corrected.participants[0].characterRef = correctId;
    let calls = 0;
    t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: {
      tools: Array<{ function: { name: string; parameters: any } }>;
      tool_choice: unknown; messages: Array<{ content: string }>;
    }) => {
      calls++;
      assert.ok(calls <= 2, "只纠正原请求一次");
      const tool = payload.tools.find((entry) => entry.function.name === scenario.toolName)!.function;
      assert.equal(tool.parameters.properties.participants.items.properties.characterRef.enum, undefined,
        "具体人物 ID 留在请求目录，新增人物不改变工具定义；完整引用仍由解析器核对");
      const messages = payload.messages.map((entry) => entry.content).join("\n");
      assert.ok(messages.includes(correctId + "=郝敬"));
      if (calls === 2) {
        assert.deepEqual(payload.tool_choice, { type: "function", function: { name: scenario.toolName } });
        const correction = JSON.parse(payload.messages.at(-1)!.content.split("\n").at(-1)!);
        assert.equal(correction.validation.path, "participants[0].characterRef");
        assert.equal(correction.validation.received, scenario.original.participants[0].characterRef);
        assert.deepEqual(correction.allowedCharacters, characters);
        assert.deepEqual(correction.originalToolArguments, scenario.original);
        assert.deepEqual(run, before, "第一次失败尚未登记人物或提交故事");
        assert.deepEqual((await getRun(run.runId))!, before);
        assert.equal(stored(run.runId).generationFailures!.length, 1);
      }
      const args = calls === 1 || scenario.remainsInvalid ? scenario.original : corrected;
      return { id: "character-id-response:" + calls, choices: [{ finish_reason: "tool_calls", message: {
        content: null, tool_calls: [{ id: "character-id-call:" + calls, type: "function",
          function: { name: scenario.toolName, arguments: JSON.stringify(args) } }]
      } }] };
    });
    const execute = () => runNarrativeTurnTransaction(run, async (working) => {
      const context = { ...memoryTestContext(working), apiKey: "not-sent", requestId: "character-id-replay",
        usageScope: { sessionId: session.id, runId: run.runId, worldId: run.worldId } };
      const rendered = await generateDynamicNarrativeScene(working, world, {
        act: definition.mainlineActs![0], beat: "climax",
        presentation: scenario.isChoice ? "scene" : "summary",
        allowedTurnKinds: scenario.isChoice ? ["scene"] : ["background"],
        sceneAge: 24, backgroundAgeRange: { fromAge: 24, toAge: 24 },
        storyPatterns: [], socialForces: definition.socialForces ?? [], knownCharacters: [],
        statTiers: resolveNarrativeStatTiers(working.stats),
        attributePolicy: dynamicSceneAttributePolicy(), backgroundAttributePolicy: dynamicBackgroundAttributePolicy(working),
        plan: { callId: "character-id-replay", turnKind: scenario.isChoice ? "scene" : "background",
          presentation: scenario.isChoice ? "scene" : "summary", patternIds: [], forceIds: [],
          conflictRefs: [correctId], abilityRefs: [ability.id], clockRequest: scenario.isChoice ? "hold" : "advance" }
      }, context);
      assert.deepEqual(working, before, "成功解析后才进入原登记与提交步骤");
      assert.equal(rendered.narrative, normalizeNarrativeText(scenario.original.narrative));
      assert.equal(rendered.createsDecision === true, scenario.isChoice);
      if (scenario.isChoice) assert.deepEqual(rendered.milestoneCopy!.optionOverrides, choice.optionOverrides);
      stageNarrativeAssetRound(working, { sourceEventId: rendered.handoff!.sourceEventId,
        source: scenario.isChoice ? "scene" : "background", subject: "人物引用原故障回放",
        age: 24, narrative: rendered.narrative }, rendered, { age: 24 });
      if (scenario.isChoice) advanceWithDynamicNarrativeScene(working, world, definition, {
        ...rendered, beat: "climax", beatDecision: "hold", sceneAge: 24
      });
      else working.age = 24;
      appendPublicTurnRecord(working, { entryId: rendered.handoff!.sourceEventId, age: 24,
        ageStage: { label: "青年" }, kind: "passage", narrative: rendered.narrative, statChanges: {} });
      return rendered;
    });
    if (scenario.remainsInvalid) {
      await assert.rejects(execute(), (error: unknown) => error instanceof NarrativeOutcomeError &&
        error.validation?.rule === "character_reference_invalid");
      assert.deepEqual(run, before);
      assert.deepEqual((await getRun(run.runId))!, before);
      assert.equal(stored(run.runId).generationFailures!.length, 2);
    } else {
      const { result } = await execute();
      await saveRun(run, session.id);
      assert.equal(run.age, 24);
      assert.deepEqual(run.narrative.dynamicCharacters.map((entry) => entry.id), characters.map((entry) => entry.id));
      assert.equal(run.narrative.dynamicCharacters.filter((entry) => entry.name === "郝敬").length, 1);
      assert.equal(run.narrative.assetBuffer!.rounds.length, 1);
      assert.equal((await getRun(run.runId))!.turnRecords!.at(-1)!.narrative, result.narrative);
      if (scenario.isChoice) assert.ok(run.nextMilestoneChoice, "纠正后的抉择进入既有待选状态");
      assert.equal(stored(run.runId).generationFailures!.length, 1);
    }
    assert.equal(calls, 2);
    assert.equal(stored(run.runId).generationFailures![0].originalToolArguments, JSON.stringify(scenario.original),
      "诊断保留原始字符串；纠正请求使用解析对象");
    assert.equal(JSON.stringify(run).includes("originalToolArguments"), false);
  });
});

test("抉择的真实情景和选择贯通结果、提交前观察、保存恢复与区间压缩", async (t) => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  const run = makeRun(); run.worldId = definition.worldId; run.age = 20; run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, 20);
  const runtime = run.narrative.actRuntime!;
  runtime.beat = "pressure";
  const outline = outlineForTest(runtime.actId, { goal: "抵御外敌", completionMeaning: "敌军退却",
    fork: { question: "守城还是突围？", stakes: "守军将承担不同风险", openingSituation: "敌军主力逼近关城" } });
  commitNarrativeActOutline(run.narrative, outline);
  const prose = "追击途中，同袍坠入沟底，你停在岔路口。";
  const background = "救援会失去追踪敌军的时机，追击则使同袍失去照应。";
  advanceWithDynamicNarrativeScene(run, world, definition, { patternIds: [], forceIds: [], beat: "pressure", beatDecision: "hold",
    narrative: prose, participants: [], createsDecision: true, sceneAge: 20, sceneClockMode: "hold",
    decisionBrief: { question: "救人还是继续追踪？", stakes: "同袍生死与军情去向" } });
  applyDirectedMilestonePresentation(run, { background, optionOverrides: [
    { id: "safe", label: "救回同袍", description: "放弃追击，背回伤员。" },
    { id: "balanced", label: "召来援手", description: "派人回营求援，再继续追踪。" },
    { id: "risky", label: "全力追敌", description: "丢下伤员，独自追赶敌军。" }
  ] });
  run.nextMilestoneChoice!.check = prepareChoiceCheck(run, definition);
  const roll = rollChoice(run, "safe");
  const verdict = roll.success ? "成功" : "失败";
  const resultProse = roll.success ? "你放弃追击，将负伤同袍带回营地。敌军退去，军中重新部署哨线。"
    : "你放弃追击，试图救人，却未能攀下塌落的沟壁。同袍没能回来，军中重新部署哨线。";
  const choice = toPublicMilestoneChoice(run)!;
  const sceneId = run.narrative.scene.lastEventId!;
  const episode = commitNarrativeEpisode(run, { callId: "choice", sourceEventId: sceneId, turnKind: "scene", age: 20, actId: runtime.actId, beat: "pressure" });
  const choiceRecord = appendPublicTurnRecord(run, { entryId: sceneId, kind: "scene", narrative: prose, age: 20, ageStage: { label: "青年" }, statChanges: {} }, choice);
  episode.turnId = choiceRecord.turnId;
  assert.equal(run.narrative.memoryEntries.find((entry) => entry.id === `memory:${sceneId}`)!.text, prose);
  const selected = choice.options[0];
  const calls: string[] = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string; parameters: any } }>; messages: Array<{ content: string }> }) => {
    const tool = payload.tools[0].function;
    const text = payload.messages.map((message) => message.content).join("\n");
    calls.push(tool.name);
    assert.equal(choiceRecord.choiceOutcome, undefined, "请求中不能提前把选择记作已提交");
    if (tool.name === "render_decision_outcome") {
      assert.equal(text.split(background).length - 1, 1);
      assert.ok(text.includes(selected.label) && text.includes(selected.description));
      assert.ok(JSON.stringify(tool.parameters.properties.assetUpdates.properties.abilities).includes(NARRATIVE_ABILITY_DEFINITION));
      assert.doesNotMatch(text, /召来援手|全力追敌|丢下伤员/);
    }
    if (tool.name === "observe_story_beat") {
      for (const value of [prose, background, `玩家已选行动：${selected.label}`, resultProse]) assert.equal(text.split(value).length - 1, 1);
      assert.equal(text.split(`本次行动检定：${verdict}`).length - 1, 1);
      assert.doesNotMatch(text, /召来援手|全力追敌/);
    }
    if (tool.name === "sync_narrative_continuity") assert.ok(text.includes(`行动结果（检定${verdict}）：${resultProse}`));
    const args = tool.name === "render_decision_outcome"
      ? { narrative: resultProse, participants: [], assetUpdates: { locations: [], abilities: [] }, assetActivity: { locationIds: [], abilityIds: [] } }
      : tool.name === "resolve_decision_outcome" ? { effects: [{ stat: "fortune", direction: "up", band: "light" }] }
      : tool.name === "sync_narrative_continuity" ? { locationUpdates: [], abilityUpdates: [], identityMerges: [], relationshipUpdates: [], factIntroductions: [], factUpdates: [] }
      : observationReplyForTest("hold");
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: tool.name, type: "function", function: { name: tool.name, arguments: JSON.stringify(args) } }] } }] };
  });
  const result = await runNarrativeAgentDecision({ run, world, narrativeWorld: definition, choice,
    callId: "choice:result", context: { ...memoryTestContext(run), apiKey: "not-sent" },
    decision: { decision: "safe", label: selected.label, description: selected.description, decisionBrief: run.pendingDynamicScene?.decisionBrief,
      attributePolicy: { allowedStats: ["fortune"], allowedDirections: ["up"], allowedBands: ["light"], minEffects: 1, maxEffects: 1 } }
  });
  assert.equal(choiceRecord.choiceOutcome, undefined);
  const settled = applyMilestoneDecisionAndAdvance(run, world, difficulty, "safe", { narrativeWorld: definition,
    narrative: result.outcome.narrative, narrativeOutcome: { effects: result.outcome.effects }, deferCompletion: true });
  const observation = await finishNarrativeAgentDecision({ run, world, narrativeWorld: definition, context: { ...memoryTestContext(run), apiKey: "not-sent" }, callId: "choice:result", attemptId: result.attemptId, choice, decision: selected, outcome: result.outcome });
  completeMilestoneDecision(run, settled.decisionEvent, settled.sourceEventId, settled.factIds, { narrativeWorld: definition, beatDecision: observation.decision });
  resolveTurnRecordChoice(run, choice, selected);
  const resultEpisode = commitNarrativeEpisode(run, { callId: "choice:result", sourceEventId: settled.sourceEventId, turnKind: "decision",
    age: 20, actId: runtime.actId, beat: "pressure" });
  const resultRecord = appendPublicTurnRecord(run, { entryId: settled.sourceEventId, kind: "choice_outcome", narrative: resultProse,
    age: 20, ageStage: { label: "青年" }, statChanges: settled.decisionEvent.statChanges });
  resultRecord.decisionResult = { sceneId: choice.sceneId, revision: choice.revision, roll, status: "settled" };
  resultEpisode.turnId = resultRecord.turnId;
  assert.deepEqual(run.narrative.actRuntime!.outline, outline, "临时救援分歧的答案不删除大纲中的守城分歧");
  assert.equal(run.narrative.actRuntime!.beat, "pressure");
  assert.equal(choiceRecord.choice!.options.length, 3);
  assert.deepEqual(calls, ["render_decision_outcome", "resolve_decision_outcome", "sync_narrative_continuity", "observe_story_beat"]);
  const restored = JSON.parse(JSON.stringify(run)) as typeof run;
  const changes = recentCommittedNarrativeChanges(restored.narrative, 3, restored.turnRecords).join("\n");
  assert.ok(changes.indexOf(background) < changes.indexOf("玩家已选行动："));
  assert.ok(changes.indexOf("玩家已选行动：") < changes.indexOf(resultProse));
  assert.equal(changes.split(`本次行动检定：${verdict}`).length - 1, 1);
  // A completed interval is supplied to the existing compressor; it reads the same exchange.
  commitNarrativeActCanon(restored, { actId: runtime.actId, sourceEventId: settled.sourceEventId, resolvedAge: 20 });
  const work = prepareNarrativeMemoryCuration(restored)!;
  assert.ok(work);
  const compressedInput = memoryCurationPrompt(work);
  for (const value of [background, `玩家已选行动：${selected.label}`, resultProse]) assert.equal(compressedInput.split(value).length - 1, 1);
  assert.equal(compressedInput.split(`本次行动检定：${verdict}`).length - 1, 1);
  assert.doesNotMatch(compressedInput, /召来援手|全力追敌/);
  assert.equal(applyNarrativeMemoryCuration(restored, work, { summary: `20岁放弃追敌救援同袍，检定${verdict}，此后军中重设哨线。` }), true);
  assert.deepEqual(recentCommittedNarrativeChanges(restored.narrative, 3, restored.turnRecords), []);
});

test("同步提示词的事件目录与工具解析使用同一动态事件范围", async (t) => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  const run = makeRun(); run.age = 20; run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  const actId = run.narrative.actRuntime!.actId;
  const [openId, finishedId, blockedId] = applyNarrativeFactUpdates(run, { introduce: [
    { kind: "experience", label: "修复城防" }, { kind: "experience", label: "夜袭已退" }, { kind: "experience", label: "已失效事项" }
  ], touchFactIds: [], resolveFactIds: [] }, { sourceEventId: "before", actId });
  applyNarrativeFactUpdates(run, { introduce: [], touchFactIds: [], resolveFactIds: [finishedId] }, { sourceEventId: "finished", actId });
  run.story.factLedger!.facts.find((fact) => fact.id === blockedId)!.status = "blocked";
  const [oldFinishedId] = applyNarrativeFactUpdates(run, { introduce: [{ kind: "experience", label: "旧幕已结束经历" }], touchFactIds: [], resolveFactIds: [] }, { sourceEventId: "old", actId: "old.act" });
  applyNarrativeFactUpdates(run, { introduce: [], touchFactIds: [], resolveFactIds: [oldFinishedId] }, { sourceEventId: "old-end", actId: "old.act" });
  run.story.factLedger!.facts.push({ id: "world:setting", kind: "open_question", label: "静态世界设定标记", status: "open", sourceEventId: "world", introducedAge: 0, lastTouchedAge: 0 });
  for (let index = 0; index < 3; index++) stageNarrativeAssetRound(run, {
    sourceEventId: `events:${index}`, source: "scene", age: 18 + index, actId, subject: "城防", narrative: "你修好城防，夜袭早已结束。"
  }, {}, { age: 18 + index });
  let requests = 0;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string; parameters: any } }>; messages: Array<{ content: string }> }) => {
    requests++;
    const text = payload.messages.map((message) => message.content).join("\n");
    const line = text.split("\n").find((entry) => entry.startsWith("可更新事件："))!;
    const directory = JSON.parse(line.slice("可更新事件：".length)) as Array<{ id: string }>;
    assert.deepEqual(directory.map((entry) => entry.id), [openId, finishedId]);
    const contract = factUpdateContract(directory.map((entry) => entry.id));
    assert.deepEqual(contract.factIds, directory.map((entry) => entry.id));
    assert.deepEqual(contract.mutableIds, contract.factIds);
    assert.doesNotMatch(text, /静态世界设定标记|旧幕已结束经历|已失效事项/);
    assert.ok(JSON.stringify(payload.tools[0].function.parameters.properties.abilityUpdates).includes(NARRATIVE_ABILITY_DEFINITION));
    const args = { locationUpdates: [], abilityUpdates: [], relationshipUpdates: [], identityMerges: [], factIntroductions: [],
      factUpdates: [{ factId: openId, status: "finish", summary: "城防修复完成。", sourceEventId: "events:2" }] };
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "sync", type: "function", function: { name: "sync_narrative_continuity", arguments: JSON.stringify(args) } }] } }] };
  });
  await synchronizeNarrativeAssetBatch(run, world, { ...memoryTestContext(run), apiKey: "not-sent" }, "events:sync");
  assert.equal(requests, 1);
  assert.equal(run.story.factLedger!.facts.find((fact) => fact.id === openId)!.status, "resolved");
  assert.equal(run.story.factLedger!.facts.find((fact) => fact.id === openId)!.actId, actId);
  assert.equal(run.story.factLedger!.facts.find((fact) => fact.id === oldFinishedId)!.actId, "old.act");
  assert.equal(run.story.factLedger!.facts.find((fact) => fact.id === "world:setting")!.status, "open");
  assert.equal(run.narrative.assetBuffer, undefined);
});

test("本次原故障回放：势力错入 conflictRefs 由规划请求纠正，重复失败保留证据但不提交", async (t) => {
  const stored = replayStore(t);
  const { session } = await resolveAnonymousSession();
  const run = makeRun(); run.age = 10; run.worldId = "ancient"; run.narrative.enabled = true;
  await saveRun(structuredClone(run), session.id);
  const characterId = "character:f0dc006e-c556-4735-9b2f-777240893a25";
  const abilityId = "ability:24461dcd-47c2-44b7-a5d8-8575bd4492ff";
  const cardId = "ancient.domain.faith.disaster_healing";
  const envelope: NarrativeTurnEnvelope = {
    callId: "planner-replay", source: "scene", worldId: "ancient", currentAge: 10,
    backgroundAgeRange: { fromAge: 11, toAge: 11 }, act: { id: "faith.first", label: "问诊入世", prompt: "在求治中认识民间" },
    beat: "pressure", capabilities: ["scene"], storyPatterns: [],
    actOutline: outlineForTest("faith.first", { goal: "独立问症并接受外祖检验", completionMeaning: "第一次问症形成结果" }),
    socialForces: [{ id: "ancient.faith", label: "教门", summary: "施药治病" }, { id: "ancient.commoners", label: "乡民", summary: "上山求治" }],
    focusReferences: [{ id: characterId, kind: "character", label: "温衡" }, { id: cardId, kind: "world_card", label: "灾病与医药" }, { id: abilityId, kind: "ability", label: "辨药识性" }, { id: "dynamic:51418147459740e2", kind: "fact", label: "学习问症" }],
    statTiers: resolveNarrativeStatTiers(run.stats), clock: { mode: "advance", sameAgeTurnCount: 0, maxSameAgeTurns: 3 }
  };
  const bad = planningReplyForTest({
    conflictRefs: [characterId, cardId, "ancient.faith"], abilityRefs: [abilityId],
    assetNeeds: [{ kind: "character", purpose: "一位带着具体病症上山求治的乡民（或携病孩的妇人与同行的邻人），作为主角第一次独立问症的活教材，并能带回山下教门活动的消息" }],
    locationDirective: { mode: "stay" },

    clockRequest: "advance", forceIds: ["ancient.faith", "ancient.commoners"], actWorldCard: null
  });
  const good = { ...bad, conflictRefs: bad.conflictRefs.slice(0, 2) };
  let calls = 0;
  const payloads: string[] = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string; parameters: any } }>; messages: Array<{ content: string }> }) => {
    calls++;
    const tool = payload.tools[0].function;
    assert.equal(tool.name, "plan_scene_turn");
    const prompt = payload.messages.at(calls === 2 || calls === 4 ? -2 : -1)!.content;
    const conflictLine = prompt.split("\n").find((line) => line.startsWith("conflictRefs 目录"));
    assert.ok(conflictLine);
    assert.ok(conflictLine.includes(cardId) && conflictLine.includes("dynamic:51418147459740e2"));
    assert.equal(conflictLine.includes('"ancient.faith"'), false);
    assert.ok(prompt.split("\n").find((line) => line.startsWith("forceIds 目录"))?.includes('"ancient.faith"'));
    assert.match(tool.parameters.properties.conflictRefs.items.properties.ref.description, /社会力量填写 forceIds/);
    if (calls === 2 || calls === 4) {
      const correction = JSON.parse(payload.messages.at(-1)!.content.split("\n").at(-1)!);
      assert.equal(correction.validation.path, "conflictRefs[2].ref");
      assert.equal(correction.validation.received, "ancient.faith");
      assert.deepEqual(correction.validation.expected, [characterId, cardId, "dynamic:51418147459740e2"]);
      assert.deepEqual(correction.originalToolArguments, bad);
    }
    payloads.push(JSON.stringify(payload));
    const args = calls === 2 || calls === 5 ? good : bad;
    return { id: `planner-response:${calls}`, choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: `planner-call:${calls}`, type: "function", function: { name: tool.name, arguments: JSON.stringify(args) } }] } }] };
  });
  const context = { ...memoryTestContext(run), apiKey: "not-sent", requestId: "planner-step", usageScope: { sessionId: session.id, runId: run.runId, worldId: run.worldId } };
  const plan = await generateNarrativeTurnPlan(run, world, envelope, context);
  assert.deepEqual(plan.conflictRefs, [characterId, cardId]);
  assert.deepEqual(plan.forceIds, ["ancient.faith", "ancient.commoners"]);
  assert.equal(plan.assetNeeds!.length, 1);
  assert.equal(calls, 2);
  const before = structuredClone(run);
  await assert.rejects(runNarrativeTurnTransaction(run, async (working) => {
    await generateNarrativeTurnPlan(working, world, { ...envelope, callId: "planner-still-invalid" }, context);
    working.age++;
  }), (error: unknown) => error instanceof NarrativeOutcomeError && error.validation?.path === "conflictRefs[2].ref");
  assert.equal(calls, 4);
  assert.deepEqual(run, before);
  assert.deepEqual((await getRun(run.runId))!, before);
  assert.equal(stored(run.runId).generationFailures!.length, 3);
  await generateNarrativeTurnPlan(run, world, { ...envelope, callId: "planner-next-request" }, context);
  assert.equal(calls, 5);
  assert.equal(payloads[4].includes("originalToolArguments"), false, "纠正材料只存在于失败子请求的局部 history");
  await saveRun(run, session.id);
  const failures = stored(run.runId).generationFailures!;
  assert.deepEqual(failures.map((entry) => entry.attempt), [0, 0, 1]);
  assert.ok(failures.every((entry) => entry.reason === "narrative_turn_plan_material_invalid" && entry.toolName === "plan_scene_turn" && entry.age === 10));
  assert.equal(failures[0].actId, envelope.act.id);
  assert.equal(failures[0].beat, envelope.beat);
  assert.equal(JSON.stringify(run).includes("originalToolArguments"), false);
});
