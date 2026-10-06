import { dynamicNarrativeSceneTools, narrativeTurnPlanTools, narrativeTurnPlanningPrompt, narrativeDecisionOutcomeTool, narrativeDecisionRenderTool, narrativeHorizonTool, narrativeBeatObservationPrompt, narrativeProseReviewPrompt, narrativeProseReviewTool, normalizeMilestoneOptionOverrides, parseDynamicNarrativeParticipants, parseDynamicNarrativeActHandoff, NarrativeOutcomeError, NARRATIVE_SCENE_PARTICIPANT_LIMIT, prepareNarrativeOutcomeRequest, interruptedBackgroundTask, recordDirectedDecisionOutcome, recordDirectedStoryTurnOutcome, shouldRefineNarrativeProse, buildNarrativeContinuityWriteSet, narrativeContinuityReadSet, narrativeContinuityWritableSet, hasNarrativeContinuityWork, validateNarrativeContinuityToolArguments, extractProviderUsage, type NarrativeContext } from "./ai.js";
import { factUpdateContract, parseFactUpdates, parseRelationshipUpdates, narrativeFactResolutionModes } from "./narrative-continuity.js";
import { parseNarrativeTurnPlan } from "./ai.js";
import { applyObserverFactResolutions } from "./engine.js";
import { narrativeActProgress, narrativeFactProgressForCommit, narrativeObservationFacts } from "./narrative/observation.js";
import { pendingConversationContext, applyConversationSummary, buildConversationPromptMessages, keepRecentConversationRounds, summarizedConversationMemoryIds, type ChatConversationState } from "./conversation.js";
import { commitNarrativeMemory, narrativeTextOverlap } from "./narrative-memory.js";
import { validateNarrativeEffects, narrativeEffectsSchema } from "./narrative-attributes.js";
import { normalizeNarrativeText, isNarrativePlainText, narrativeProseProfile } from "./narrative-prompts.js";
import assert from "node:assert/strict";
import { dynamicNarrativeRenderPrompt, dynamicNarrativeScenePrompt, memoryCurationPrompt, narrativeOriginPrompt, type DynamicNarrativeSceneInput } from "./ai.js";
import { retrieveNarrativeMemories } from "./narrative.js";
import test from "node:test";
import OpenAI from "openai";
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
  toPublicTimelineEntryFromEvent,
  toClientRun
} from "./engine.js";
import { advanceNarrativeActBeat, formatNarrativePromptPlan, buildNarrativePromptPlan, narrativeRouteBeatGuidance, narrativeStoryPackWorldCardDirectory, selectDynamicNarrativeContext, selectNarrativeWorldCards, formatTaskNarrativeContext, assessClosureReadiness, assessEnding, ensureNarrativeActRuntime, ensureNarrativeRunState, getNarrativeRouteProgress, isNarrativeEarlyLife, isNarrativeMainlineActEntryReady, refreshNarrativeMainlineCompletion } from "./narrative.js";
import { loadEventDefinitions, loadNarrativeWorldDefinition, validateNarrativeWorldFactContract } from "./content.js";
import { applyNarrativeAssetActivity, applyNarrativeAssetUpdates, commitNarrativeAssets, formatNarrativeAssets, narrativeAbilityDirectory, narrativeContinuityAssetContract, narrativeLocationDirectory, narrativeAssetUpdatesSchema, normalizeNarrativeAssets, parseNarrativeAssetUpdates, parseNarrativeContinuityAssetUpdates } from "./narrative-assets.js";
import { composeNarrativeContext } from "./narrative/context/orchestrator.js";
import { commitNarrativeActCanon, commitNarrativeEpisode, runNarrativeTurnTransaction } from "./narrative/commit.js";
import { selectNarrativeEpisodeRecall } from "./narrative/episodes.js";
import { applyNarrativeMemoryCuration, applyNarrativeScopedMemoryCuration, prepareNarrativeMemoryCuration } from "./narrative/curator.js";
import { commitNarrativeAgentTurn, runNarrativeAgentTurn, runNarrativeAgentDecision } from "./narrative/runtime.js";
import { commitNarrativeStageTask } from "./narrative/stage-task.js";
import { defaultNarrativeContextProviders } from "./narrative/context/collectors.js";
import { narrativeTurnCapabilities, recentCommittedNarrativeChanges, type NarrativeTurnEnvelope } from "./narrative/turn.js";
import { narrativeTaskContract } from "./narrative/task-contracts.js";
import { loadNarrativeStoryPack, loadNarrativeStoryPacksForWorld, validateNarrativeStoryPack } from "./story-packs.js";
import { resolveNarrativeExperience } from "./narrative-experience.js";
import { applyNarrativeIdentityMerges, canonicalizeNarrativeReferences, narrativeCharacterDirectory, parseNarrativeIdentityMerges } from "./narrative-identities.js";
import { resolveNarrativeStatTiers } from "./engine.js";

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
    locations: [{ ref: "new", name: "山中书院", description: "临溪的学舍与演练庭院。", current: true }],
    abilities: [{ ref: "new", name: "观息", description: "从呼吸辨认疲惫与动作间隙。", source: "在书院练习中学得。", mastery: "初窥门径", status: "available" }]
  });
  commitNarrativeAssets(run.narrative, applyNarrativeAssetUpdates(undefined, changes, { ageFrom: 120, age: 123 }), changes, { ageFrom: 120, age: 123 }, { factionIds: ["academy"] });
  const original = structuredClone(run.narrative.assets!);
  assert.equal(run.narrative.scene.place, "山中书院");
  assert.equal(run.narrative.memoryEntries.at(-1)?.abilityIds?.[0], original.abilities[0].id);
  assert.deepEqual(original.locations[0].factionIds, ["academy"]);
  appendPublicTurnRecord(run, { entryId: "study", ageFrom: 120, age: 123, ageStage: { label: "成年" }, kind: "passage", narrative: "你在书院学习观息，渐渐辨认出动作的间隙。", statChanges: {} });
  const saved = JSON.parse(JSON.stringify(run));
  const returned = applyNarrativeAssetUpdates(original, { ...changes!, abilities: [] }, { age: 124 });
  assert.equal(returned.locations.length, 1);
  assert.equal(returned.locations[0].id, original.locations[0].id);
  const trained = parseNarrativeAssetUpdates({
    locations: [],
    abilities: [{ ...changes!.abilities[0], ref: original.abilities[0].id, mastery: "运用自如" }]
  }, original);
  run.narrative.assets = applyNarrativeAssetUpdates(original, trained, { age: 124 });
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
  assert.ok(message.includes(original.abilities[0].id) && message.includes("运用自如"));
  assert.ok(message.includes(original.locations[0].id));
  assert.equal(JSON.stringify(narrativeAssetUpdatesSchema(run.narrative.assets)), JSON.stringify(narrativeAssetUpdatesSchema()));
  assert.throws(() => parseNarrativeAssetUpdates({ locations: [{ ref: "missing", name: "远方", description: "一片山谷。", current: true }] }, original));
  assert.deepEqual(original, saved.narrative.assets);
});

test("地点本领未提交更新不改变状态，也不提前投影到历史回合", () => {
  const run = makeRun();
  appendPublicTurnRecord(run, { entryId: "before-choice", age: 10, ageStage: { label: "幼年" }, kind: "scene", narrative: "你站在书院门外，尚未决定是否求学。", statChanges: {} });
  assert.deepEqual(applyNarrativeAssetUpdates(undefined, undefined, { age: 10 }), { locations: [], abilities: [], currentLocationId: undefined });
  assert.equal(parseNarrativeAssetUpdates(undefined), undefined);
  assert.equal(toClientRun(run).narrativeAssets?.abilities.length, 0);
  const changes = { locations: [], abilities: [{ ref: "new", name: "观息", description: "辨别呼吸的变化。", source: "求学所得。", mastery: "初学", status: "available" as const }] };
  run.narrative.assets = applyNarrativeAssetUpdates(undefined, changes, { age: 10 });
  assert.equal(toClientRun(run).narrativeAssets?.abilities.length, 0);
  appendPublicTurnRecord(run, { entryId: "after-choice", age: 10, ageStage: { label: "幼年" }, kind: "choice_outcome", narrative: "你决定留下求学，开始练习辨别呼吸的变化。", statChanges: {} });
  assert.equal(toClientRun(run).narrativeAssets?.abilities.length, 1);
});

test("本领规划目录只暴露可用本领的稳定引用与熟练度", () => {
  const assets = applyNarrativeAssetUpdates(undefined, {
    locations: [],
    abilities: [
      { ref: "new", name: "听风诀", description: "分辨远处声息", source: "旅途中习得", mastery: "熟练", status: "available" },
      { ref: "new", name: "旧印术", description: "已经无法施展", source: "旧日传承", mastery: "残缺", status: "unavailable" }
    ]
  }, { age: 12 });
  assert.deepEqual(narrativeAbilityDirectory(assets), [{ id: assets.abilities[0]!.id, label: "听风诀（熟练）" }]);
});

test("资产活动只记录到访和使用，不重写稳定档案", () => {
  const run = makeRun();
  const created = applyNarrativeAssetUpdates(undefined, {
    locations: [{ ref: "new", name: "北营校场", description: "边军操练与点兵的校场。", current: false }],
    abilities: [{ ref: "new", name: "骑射", description: "在奔马中稳定开弓。", source: "随边军操练习得。", mastery: "初通", status: "available" }]
  }, { age: 12 });
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
  assert.deepEqual(narrativeLocationDirectory(active), [{ id: location.id, label: "北营校场（当前所在）" }]);
});

test("连续性同步由持久变化信号触发", () => {
  const emptyWriteSet = { factIds: [], characterIds: [], locationIds: [], abilityIds: [] };
  assert.equal(hasNarrativeContinuityWork(emptyWriteSet, false), false);
  assert.equal(hasNarrativeContinuityWork(emptyWriteSet, true), true);
});

test("连续性资产工具始终开放稳定的数组式差量协议", () => {
  const assets = applyNarrativeAssetUpdates(undefined, {
    locations: [{ ref: "new", name: "营地", description: "驻军营地", current: true }],
    abilities: [{ ref: "new", name: "骑射", description: "骑马开弓", source: "军中习得", mastery: "初通", status: "available" }]
  }, { age: 12 });
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
      { ref: "new", name: "北营校场", description: "驻军操练的校场", current: false },
      { ref: "new", name: "河湾小哨", description: "俯瞰河道的前沿哨所", current: true }
    ],
    abilityUpdates: [
      { ref: "new", name: "骑射", description: "在奔马中开弓", source: "随边军练习习得", mastery: "初通", status: "available" }
    ]
  }, normalizeNarrativeAssets());
  assert.deepEqual(changes.locations.map((entry) => entry.ref), ["new", "new"]);
  assert.deepEqual(changes.abilities.map((entry) => entry.ref), ["new"]);
  const committed = commitNarrativeAssets(run.narrative, applyNarrativeAssetUpdates(run.narrative.assets, changes, { age: 12 }), changes, { age: 12 }, {}, "scene:12");
  const episode = commitNarrativeEpisode(run, {
    callId: "scene:12", sourceEventId: "scene:12", turnKind: "scene", age: 12,
    locationIds: committed.locationIds, abilityIds: committed.abilityIds
  });
  assert.equal(run.narrative.assets?.currentLocationId, committed.locationIds[1]);
  assert.deepEqual(episode.locationIds, committed.locationIds);
  assert.deepEqual(episode.abilityIds, committed.abilityIds);
  assert.deepEqual(narrativeLocationDirectory(run.narrative.assets).map((entry) => entry.id), committed.locationIds);
  assert.equal(narrativeAbilityDirectory(run.narrative.assets)[0]?.id, committed.abilityIds[0]);
  const recalled = formatNarrativeAssets(run.narrative.assets, {
    locationIds: [committed.locationIds[1]!], abilityIds: committed.abilityIds
  });
  assert.match(recalled, /河湾小哨/);
  assert.match(recalled, /骑射/);
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
  assert.match(prompt, /出生前的家族历史、出生时的生活环境/);
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
        assert.ok(selected.length <= 6);
        assert.ok(selected.reduce((total, card) => total + card.content.length, 0) <= 1400);
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
  assert.equal(balanced?.charisma, 2);
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

test("动态场景的同年计数逐轮累积，到配置上限后恢复年龄推进", () => {
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
  assert.equal(advance().toAge, 31);
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
  assert.equal(escalation.updated.narrative.dynamicCharacters[0]?.role, "递来旧档的书吏");
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
  assert.match((decisionContext.conversation.history.find((entry) => entry.role === "user") as { content: string }).content, /隐瞒来历.*如今已说明/);
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
    observerResolvedFactIds: ["act.fact"]
  });
  assert.equal(run.narrative.actRuntime?.beat, "payoff");
  assert.equal(run.story.factLedger?.facts.find((fact) => fact.id === "act.fact")?.status, "resolved");
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
            { kind: "commitment" as const, label: "会延续到以后的人物承诺" }
          ],
          touchFactIds: [], resolveFactIds: []
        }
      } : {}),
      ...(beat === "payoff" ? {
        actHandoff: {
          resolvedTension: "人物已为本幕冲突作出无法撤回的处理。",
          lastingConsequence: "这次处理改变了人物在关系与局势中的位置。",
          continuation: "此前结识的人与承担的责任会进入下一幕。",
          carryFactIds: (run.story.factLedger?.facts ?? [])
            .filter((fact) => fact.status === "open" && fact.kind === "commitment" && fact.actId === run.narrative.actRuntime?.actId)
            .map((fact) => fact.id)
        }
      } : {})
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
  assert.equal(run.story.factLedger?.facts.find((fact) => fact.label === "本幕尚待回答的问题")?.status, "resolved");
  assert.equal(run.story.factLedger?.facts.find((fact) => fact.label === "会延续到以后的人物承诺" && fact.actId === "act.one")?.status, "resolved");
  assert.ok(run.story.factLedger?.facts.some((fact) =>
    fact.id.startsWith("carry:act.two:") && fact.label === "会延续到以后的人物承诺" && fact.status === "open"
  ));
  const carriedFactId = run.story.factLedger?.facts.find((fact) => fact.id.startsWith("carry:act.two:"))?.id;
  assert.ok(carriedFactId);
  commitNarrativeActCanon(run, {
    actId: "act.one",
    sourceEventId: "event.payoff.act.one",
    resolvedAge: run.age,
    factIds: [carriedFactId],
    handoff: {
      resolvedTension: "人物已为第一幕冲突作出处理。",
      lastingConsequence: "处理结果改变了人物在局势中的位置。",
      continuation: "明确留下的承担进入下一幕。",
      carryFactIds: [carriedFactId]
    }
  });
  const handoffPlan = buildNarrativePromptPlan(run, dynamicWorld, null, "dynamic")!;
  assert.deepEqual(handoffPlan.actHandoff, []);
  assert.deepEqual(handoffPlan.actCanon, []);
  assert.ok(handoffPlan.recall?.facts.some((fact) => fact.id === carriedFactId));
  assert.ok(!handoffPlan.factDirectory?.some((fact) => fact.id.startsWith("act:act.one:")));
  const horizonPlan = buildNarrativePromptPlan(run, dynamicWorld, null, "horizon")!;
  assert.equal(horizonPlan.actCanon?.length, 1);
  assert.equal(horizonPlan.actCanon?.[0]?.actId, "act.one");
  const saved = JSON.parse(JSON.stringify(run)) as typeof run;
  const savedPlan = buildNarrativePromptPlan(saved, dynamicWorld, null, "dynamic")!;
  assert.deepEqual(savedPlan.actHandoff, []);
  assert.deepEqual(savedPlan.actCanon, []);
  assert.ok(savedPlan.recall?.facts.some((fact) => fact.id === carriedFactId));
  playAct("route.two", "route.one");
  assert.equal(run.narrative.actRuntime?.actId, "act.three");
  assert.equal(run.narrative.actRuntime?.beat, "setup");
  playAct("route.one", "route.two");

  assert.equal(run.narrative.completedScenes.length, 3);
  assert.deepEqual(run.narrative.completedScenes.map((item) => item.mainlineActId), ["act.one", "act.two", "act.three"]);
  assert.equal(run.narrative.climaxCount, 3);
  assert.equal(run.narrative.payoffCount, 3);
  assert.ok(run.story.factLedger?.facts.some((fact) => fact.id === "act:act.one:payoff" && fact.status === "resolved"));
  assert.ok(run.story.factLedger?.facts.some((fact) => fact.id === "act:act.two:continuation" && fact.status === "resolved"));
  assert.ok(run.narrative.memoryEntries.some((entry) => entry.factIds.includes("act:act.two:continuation")));
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
    locations: [], abilities: [{ ref: "new", name: "辨蹄声", description: "从声响分辨马队", source: "早年习得", mastery: "初通", status: "available" }]
  }, { age: 5 });
  const abilityId = run.narrative.assets.abilities[0].id;
  const ctx = memoryTestContext(run);
  assert.equal(ctx.narrativePlan?.recall?.characters.length, 0);
  const rendering = prepareNarrativeOutcomeRequest(run, world, ctx, narrativeDecisionRenderTool(), "故人重新参与事情", {
    task: "rendering", contracts: { references: true }
  });
  assert.ok(rendering.allowedContinuityRefs.characterIds.includes("character:escort"));
  assert.match(rendering.history.map((entry) => entry.content).join("\n"), /character:escort（郑押队）/);
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
  assert.equal(updates.abilities[0].name, "辨蹄声");
  assert.equal(parseRelationshipUpdates([{ characterRef: "character:escort", stance: "friendly", summary: "再次同行" }], prepared.characterIds)?.length, 1);
  assert.throws(() => parseRelationshipUpdates([{ characterRef: "character:other-run", stance: "friendly", summary: "不属于本局" }], prepared.characterIds));
  assert.equal(run.narrative.dynamicCharacters[0].status, "gone");
});

test("人物实际参与才恢复在场，明确离场变化在提交后仍有效", () => {
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
  assert.equal(run.narrative.dynamicCharacters[0].status, "active");
  advance([{ characterRef: "character:return", stance: "friendly", summary: "忙完后再度远行", status: "gone" }]);
  assert.equal(run.narrative.dynamicCharacters.length, 1);
  assert.equal(run.narrative.dynamicCharacters[0].status, "gone");
});

test("语义归并贯通资产、待选引用、回合索引和召回，保留旧公开快照并隔离对局", () => {
  const run = makeRun();
  const updates = { locations: [], abilities: [
    { ref: "new", name: "识蹄辨马", description: "分辨马队的蹄声", source: "早年随行", mastery: "初通", status: "available" as const },
    { ref: "new", name: "辨蹄声知来路", description: "已能分辨马队远近和来向", source: "后来随队", mastery: "熟练", status: "available" as const }
  ] };
  run.narrative.assets = applyNarrativeAssetUpdates(undefined, { ...updates, abilities: [updates.abilities[0]] }, { age: 5 });
  run.narrative.assets = applyNarrativeAssetUpdates(run.narrative.assets, { ...updates, abilities: [updates.abilities[1]] }, { age: 9 });
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
  run.narrative.assets = applyNarrativeAssetUpdates(run.narrative.assets, canonicalizeNarrativeReferences(normalized, { locations: [], abilities: [{ ref: source.id, name: "识蹄辨马", description: "可用于判断人数", source: "早年随行", mastery: "精通", status: "available" as const }] }), { age: 10 });
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
    for (const [body, expected] of [[4, "low"], [5, "steady"], [21, "steady"], [22, "high"]] as const) {
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

test("归并后的异步对象摘要沿用保留身份，旧任务不能重新写回重复档案", () => {
  const run = makeRun();
  const person = { name: "故人", role: "同伴", description: "同行者", status: "active" as const, importance: "recurring" as const, introducedAge: 1, lastSeenAge: 1, relatedFactIds: [], relatedRouteIds: [] };
  run.narrative.dynamicCharacters = [{ ...person, id: "character:original" }, { ...person, id: "character:duplicate" }];
  for (let i = 1; i <= 3; i++) {
    commitNarrativeMemory(run.narrative, { id: `memory:merge-${i}`, age: i, text: "你与旧日同伴再次合作。", characterIds: ["character:duplicate"], factionIds: [], factIds: [] });
    commitNarrativeEpisode(run, { callId: `merge-${i}`, sourceEventId: `merge-${i}`, turnKind: "scene", age: i, characterIds: ["character:duplicate"] });
  }
  const work = prepareNarrativeMemoryCuration(run)!;
  const scope = work.scopes.find((entry) => entry.scopeId === "character:duplicate")!;
  assert.ok(scope);
  const result = { digests: work.scopes.map((entry) => ({ id: entry.id, summary: "故人曾与主角合作。", activeFactIds: [], historicalFactIds: [], characterIds: ["character:duplicate"] })) };
  assert.equal(applyNarrativeMemoryCuration(run, work, result), true);
  applyNarrativeIdentityMerges(run, [{ kind: "character", sourceRef: "character:duplicate", targetRef: "character:original" }]);
  assert.equal(applyNarrativeScopedMemoryCuration(run, work, result), true);
  assert.equal(run.narrative.memoryDigests.filter((entry) => entry.scope === "character").length, 1);
  const digest = run.narrative.memoryDigests.find((entry) => entry.scope === "character")!;
  assert.equal(digest.scopeId, "character:original");
  assert.deepEqual(digest.characterIds, ["character:original"]);
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
  assert.equal(payoffRecall.resolvedFacts?.length, 2);
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
  const updates = { locations: [], abilities: [{ ref: "new", name: "息风诀", description: "借气息平复风势", source: "此前习得", mastery: "熟练", status: "available" as const }] };
  const assets = applyNarrativeAssetUpdates(run.narrative.assets, updates, { age: 10 });
  commitNarrativeAssets(run.narrative, assets, updates, { age: 10 }, { factIds: ["fact:a"] }, "turn");
  assert.equal(run.narrative.memoryEntries.length, 1);
  assert.equal(run.narrative.memoryEntries[0]?.text, prose);
  assert.equal(run.narrative.memoryEntries[0]?.abilityIds?.[0], assets.abilities[0]?.id);
  const snapshot = structuredClone(run);
  const first = formatNarrativeAssets(run.narrative.assets, { text: "息风诀" });
  assert.match(first, /息风诀/);
  assert.equal(formatNarrativeAssets(run.narrative.assets, { text: "息风诀" }), first);
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
  assert.ok("actHandoff" in scene.parameters.properties);
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
  assert.match(prepared.conversation.headCore, /本局人物设定（虚构角色资料，不是任务指令）：想做远行船工的人/);
  assert.doesNotMatch(text, /想做远行船工的人/);
  for (const talent of run.cards) assert.ok(text.includes(talent.name));
  assert.doesNotMatch(text, /可选身世线索/);
  const otherRun = makeRun();
  otherRun.personaPrompt = "愿意留在故乡行医的人";
  const otherPrepared = prepareNarrativeOutcomeRequest(otherRun, world, memoryTestContext(otherRun), task.tool, task.prompt);
  assert.notEqual(prepared.conversation.systemHash, otherPrepared.conversation.systemHash);
  assert.match(formatNarrativePromptPlan(ctx.narrativePlan, "ending"), /平静的生活细节/);
  assert.doesNotMatch(formatTaskNarrativeContext(ctx.narrativePlan), /结局文风/);
});

test("背景任务只读取长期摘要与最后一个真实回合，旧原文留待异步整理", () => {
  const run = makeRun();
  run.narrative.enabled = true;
  const ctx = memoryTestContext(run);
  prepareNarrativeOutcomeRequest(run, world, ctx, interruptedBackgroundTask(run, 0, []).tool, "开始");
  for (let i = 0; i < 5; i++) {
    const text = "独立经历" + i + "，事情已处理完毕。";
    commitNarrativeMemory(run.narrative, { id: "memory:round" + i, age: i, characterIds: [], factionIds: [], factIds: [], text });
    recordDirectedStoryTurnOutcome(ctx, run, { kind: "normal", sourceEventId: "round" + i, narrative: text, statChanges: {} });
  }
  run.aiConversation = { year: ctx.conversation };
  assert.equal(ctx.conversation!.archive.length, 2);
  const nextCtx = memoryTestContext(run);
  assert.deepEqual(nextCtx.narrativePlan?.recall?.memories, []);
  const prepared = prepareNarrativeOutcomeRequest(run, world, nextCtx, interruptedBackgroundTask(run, 0, []).tool, "接着叙述");
  const input = prepared.history.map((message) => message.content).join("\n");
  for (let i = 0; i < 4; i++) assert.equal(input.includes("独立经历" + i), false);
  assert.equal(input.split("独立经历4").length - 1, 1);
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
    [[{ stat: "physique", direction: "down", band: "light" }], "negative_stat_forbidden", "effects[0]"],
    [[{ stat: "family", direction: "down", band: "light" }], "positive_effect_missing", "effects"]
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
  assert.match(prompt, /至少一项为正向/);
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
  const rejected = validateNarrativeEffects([{ stat: "family", direction: "up", band: "light" }, { stat: "physique", direction: "down", band: "medium" }], balanced);
  assert.ok(!rejected.ok);
  assert.equal(rejected.issue.rule, "negative_band_exceeded");

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
  assert.deepEqual(renderSchema.required, ["narrative", "storyDelta"]);
  assert.deepEqual(Object.keys(renderSchema.properties), ["narrative", "storyDelta"]);
});

test("选项仅按明确ID映射，重复和未知ID不会改派到其他风险档", () => {
  const options = [
    { id: "risky", label: "独自前往", description: "先行探明情况" },
    { id: "safe", label: "请人打听", description: "留在熟悉之处" },
    { id: "balanced", label: "结伴前往", description: "与同伴相互照应" }
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
  const prompt = dynamicNarrativeScenePrompt(sceneInput);
  assert.match(prompt, /本轮人物引用目录/);
  assert.match(prompt, /character:one=小林（旧日同窗）/);
  assert.match(prompt, /完整复制左侧 ID，包括 character: 前缀/);
  assert.match(prompt, /不得返回人物名、前缀后的片段或自行改写的 ID/);
  assert.match(prompt, /首次出现的人物使用 new/);
  const renderPrompt = dynamicNarrativeRenderPrompt(
    { ...sceneInput, presentation: "choice", recentChanges: ["11岁：已经答应同伴同行"] },
    { scenePacing: "continuous", participants: [] }
  );
  assert.match(renderPrompt, /render_choice_prose/);
  assert.match(renderPrompt, /本轮叙事重点/);
  assert.match(renderPrompt, /留给后续回合/);
  assert.match(renderPrompt, /人物当前能力/);
  assert.match(renderPrompt, /已经答应同伴同行/);
  assert.doesNotMatch(renderPrompt, /safe|balanced|risky|continuityRefs|continuityRequired|风险标签|尚未选择/);
  const characterRefEnum = (input: DynamicNarrativeSceneInput) => {
    const tool = dynamicNarrativeSceneTools(input).tools[0] as {
      function: { parameters: { properties: { participants: { items: { properties: { characterRef: { enum: string[] } } } } } } };
    };
    return tool.function.parameters.properties.participants.items.properties.characterRef.enum;
  };
  assert.deepEqual(characterRefEnum(sceneInput), ["new", "character:one"]);
  const otherSceneInput = { ...sceneInput, knownCharacters: [{ ...known[0], id: "character:two", name: "小周" }] };
  assert.deepEqual(characterRefEnum(otherSceneInput), ["new", "character:two"]);
  assert.notEqual(JSON.stringify(dynamicNarrativeSceneTools(sceneInput).tools), JSON.stringify(dynamicNarrativeSceneTools(otherSceneInput).tools));
  const parsed = parseDynamicNarrativeParticipants([{
    characterRef: known[0].id, name: "陌生称谓", factionId: "school",
    relationship: { stance: "friendly", summary: "和好" }
  }], factions, known)!;
  assert.equal(parsed[0].name, "小林");
  assert.equal(parsed[0].role, "旧日同窗");
  assert.equal(parsed[0].factionId, undefined);
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
  const ensemble = Array.from({ length: NARRATIVE_SCENE_PARTICIPANT_LIMIT }, (_, index) => ({
    characterRef: "new", name: `人物${index}`, role: `角色${index}`, description: `参与场景${index}`, recurring: false
  }));
  assert.equal(parseDynamicNarrativeParticipants(ensemble, factions, known)?.length, NARRATIVE_SCENE_PARTICIPANT_LIMIT);
  assert.throws(
    () => parseDynamicNarrativeParticipants([...ensemble, { characterRef: "new", name: "超额人物", role: "旁观者", description: "超过协议上限", recurring: false }], factions, known),
    (error: unknown) => error instanceof NarrativeOutcomeError &&
      error.reason === "dynamic_scene_identity_or_participants_invalid" &&
      error.validation?.rule === "participant_count_exceeded" &&
      error.validation.received === NARRATIVE_SCENE_PARTICIPANT_LIMIT + 1
  );
  assert.deepEqual(characterRefEnum({ ...sceneInput, knownCharacters: [] }), ["new"]);
});

test("地点与本领可按引用只更新变化字段，不重写身份与获得来历", () => {
  const original = applyNarrativeAssetUpdates(undefined, parseNarrativeAssetUpdates({
    locations: [{ ref: "new", name: "河岸", description: "清静的渡口", current: true }],
    abilities: [{ ref: "new", name: "游水", description: "能顺水游过河道", source: "跟父亲学会", mastery: "初学", status: "available" }]
  }), { age: 8 });
  const before = structuredClone(original);
  const changes = parseNarrativeAssetUpdates({
    locations: [{ ref: original.locations[0].id, description: "雨后水涨的渡口" }],
    abilities: [{ ref: original.abilities[0].id, name: "别名", source: "新来历", mastery: "熟练" }]
  }, original);
  const updated = applyNarrativeAssetUpdates(original, changes, { age: 9 });
  assert.equal(updated.locations[0].name, "河岸");
  assert.equal(updated.currentLocationId, original.currentLocationId);
  assert.equal(updated.abilities[0].name, "游水");
  assert.equal(updated.abilities[0].source, "跟父亲学会");
  assert.equal(updated.abilities[0].mastery, "熟练");
  assert.deepEqual(original, before);
  assert.deepEqual(parseNarrativeAssetUpdates({}, original), { locations: [], abilities: [] });
  assert.throws(() => parseNarrativeAssetUpdates({ abilities: [{ ref: "new", mastery: "熟练" }] }, original));
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
  assert.deepEqual(parseDynamicNarrativeActHandoff({ resolvedTension: "案件了结", lastingConsequence: "结下友谊", continuation: "新的工作" }),
    { resolvedTension: "案件了结", lastingConsequence: "结下友谊", continuation: "新的工作" });
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
  assert.equal(tool.parameters.required.includes("factResolution"), false);
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
  assert.deepEqual(definition.parameters.required, ["locationUpdates", "abilityUpdates", "factIntroductions", "factUpdates", "relationshipUpdates"]);
  validateNarrativeContinuityToolArguments({ locationUpdates: [], abilityUpdates: [], factIntroductions: [], factUpdates: [], relationshipUpdates: [] }, definition.parameters);
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
  assert.deepEqual(definition.parameters.required, ["locationUpdates", "abilityUpdates"]);
  assert.match(prepared.conversation.headCore, /ref=new/);
  validateNarrativeContinuityToolArguments({
    locationUpdates: [
      { ref: "new", name: "营地", description: "可回访的驻地", current: false },
      { ref: "new", name: "河湾哨", description: "沿河设置的哨所", current: true }
    ],
    abilityUpdates: [{ ref: "new", name: "骑射", description: "马上开弓", source: "随军习得", mastery: "初通", status: "available" }]
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
  assert.deepEqual(parameters.required, ["locationUpdates", "abilityUpdates", "relationshipUpdates"]);
  assert.match(prepared.conversation.headCore, /同一个工具参数对象/);
  assert.match(prepared.history.map((entry) => entry.content).join("\n"), /同级必填字段=locationUpdates、abilityUpdates、relationshipUpdates/);

  const valid = {
    locationUpdates: [{ ref: locationId, description: "边镇新设巡防营地" }],
    abilityUpdates: [],
    relationshipUpdates: [{ characterRef: characterIds[0], stance: "friendly", summary: "共同守护边镇" }]
  };
  validateNarrativeContinuityToolArguments(valid, parameters);
  validateNarrativeContinuityToolArguments({ locationUpdates: [], abilityUpdates: [], relationshipUpdates: [] }, parameters);
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
    locations: [{ id: "location:reference-contract", name: "临河旧宅", description: "此前见证此事的旧宅", introduced: { age: 1 }, lastSeen: { age: 1 } }],
    abilities: [{ id: "ability:reference-contract", name: "辨痕", description: "辨认旧物痕迹", source: "早年习得", mastery: "熟练", status: "available", introduced: { age: 1 }, updated: { age: 1 } }],
    currentLocationId: "location:reference-contract"
  };
  const focusIds = [factId, characterId, "location:reference-contract", "ability:reference-contract"];
  const ctx = memoryTestContext(run, focusIds);
  const prepared = prepareNarrativeOutcomeRequest(run, world, ctx, narrativeDecisionRenderTool(), "写正文", {
    task: "rendering", contracts: { references: true }
  });
  const definition = prepared.tools[0].function as { parameters: { required: string[]; properties: Record<string, any> } };
  assert.ok(definition.parameters.required.includes("continuityRefs"));
  assert.ok(definition.parameters.required.includes("continuityRequired"));
  assert.equal(definition.parameters.properties.continuityRefs.properties.factIds.items.enum, undefined);
  const requestText = prepared.history.map((entry) => entry.content).join("\n");
  assert.match(requestText, /本轮 continuityRefs 可引用目录/);
  assert.match(requestText, new RegExp(`${factId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}（需要承接的疑问）`));
  assert.match(requestText, new RegExp(`${characterId}（沈砚）`));
  assert.match(requestText, /location:reference-contract（临河旧宅）/);
  assert.match(requestText, /ability:reference-contract（辨痕）/);
  assert.match(requestText, /本轮 assetActivity 已有资产目录/);
  assert.deepEqual(prepared.allowedActivityRefs.locationIds, ["location:reference-contract"]);
  assert.deepEqual(prepared.allowedActivityRefs.abilityIds, ["ability:reference-contract"]);

  const otherRun = makeRun();
  otherRun.narrative.enabled = true;
  const [otherFactId] = applyNarrativeFactUpdates(otherRun, {
    introduce: [{ kind: "open_question", label: "另一件需要承接的事" }], touchFactIds: [], resolveFactIds: []
  }, { sourceEventId: "reference-contract-other" });
  const otherPrepared = prepareNarrativeOutcomeRequest(otherRun, world, memoryTestContext(otherRun, [otherFactId]), narrativeDecisionRenderTool(), "写正文", {
    task: "rendering", contracts: { references: true }
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
  assert.doesNotMatch(prepared.history.map((entry) => entry.content).join("\n"), /本轮 continuityRefs 可引用目录/);
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

test("本局前提保持稳定，完整 IF 路线只进入规划而不在正文和结算重复注入", async () => {
  for (const worldId of ["ancient", "modern", "fantasy"]) {
    const definition = await loadNarrativeExperienceForTest(worldId);
    assert.ok(definition.mainlineActs?.length);
    const run = makeRun();
    run.worldId = definition.worldId;
    run.narrative.enabled = true;
    run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
    run.narrative.actRuntime!.beat = "climax";
    run.narrative.sessionPremise = {
      protagonistAnchor: "人物拒绝让出自己的身份", centralTension: "自我意志与外部秩序冲突",
      storyPromise: "人物将以自己的选择改变处境", keywords: ["身份", "反抗"],
      arcs: definition.mainlineActs!.map((act) => ({ actId: act.id, dramaticQuestion: "人物如何保住自我", pressureSource: "外部力量不断索取", payoffPossibility: "形成自己的道路" }))
    };
    const horizonPlan = buildNarrativePromptPlan(run, definition, null, "horizon")!;
    assert.match(horizonPlan.mainlineSkeleton ?? "", /人物如何保住自我/);
    const planningPlan = buildNarrativePromptPlan(run, definition, null, "planning")!;
    assert.equal(planningPlan.mainlineSkeleton, undefined);
    assert.match(planningPlan.routeGuidance ?? "", /人物将以自己的选择改变处境/);
    assert.doesNotMatch(planningPlan.routeGuidance ?? "", /人物如何保住自我/);
    assert.match(planningPlan.routeGuidance ?? "", new RegExp((definition as ResolvedNarrativeExperience).storyPack.name));
    const plan = buildNarrativePromptPlan(run, definition, null, "rendering")!;
    assert.deepEqual(plan.activeLore, []);
    assert.equal(plan.routeGuidance, undefined);
    assert.equal(plan.mainlineSkeleton, undefined);
    run.pendingDynamicScene = {
      id: "pending", patternIds: [], forceIds: [],
      beat: "climax", mainlineActId: definition.mainlineActs![0].id, characterIds: []
    };
    const decisionPlan = buildNarrativePromptPlan(run, definition, null, "decision")!;
    assert.equal(decisionPlan.routeGuidance, undefined);
    assert.equal(decisionPlan.mainlineSkeleton, undefined);
    assert.doesNotMatch(formatTaskNarrativeContext(decisionPlan), new RegExp((definition as ResolvedNarrativeExperience).storyPack.acts[0].dramaticQuestion));
    const backgroundPlan = buildNarrativePromptPlan(run, definition, null, "background")!;
    assert.match(backgroundPlan.routeGuidance ?? "", new RegExp((definition as ResolvedNarrativeExperience).storyPack.name));
    assert.doesNotMatch(backgroundPlan.routeGuidance ?? "", /人物如何保住自我/);
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
      socialForces: definition.socialForces!, knownCharacters: [], backgroundAttributePolicy: dynamicSceneAttributePolicy(),
      statTiers: { intelligence: "low", charisma: "low", family: "low", fortune: "low", physique: "low" }
    };
    for (const allowedTurnKinds of [["background"], ["background", "scene"], ["scene"]] as DynamicNarrativeSceneInput["allowedTurnKinds"][]) {
      input.allowedTurnKinds = allowedTurnKinds;
      input.presentation = allowedTurnKinds.includes("background") ? "summary" : "choice";
      const tools = dynamicNarrativeSceneTools(input);
      const ctx = memoryTestContext(run);
      const contextTask = input.presentation === "summary" ? "background" : "planning";
      ctx.narrativePlan = buildNarrativePromptPlan(run, definition, null, contextTask, { backgroundAllowed: allowedTurnKinds.includes("background") });
      const taskPrompt = dynamicNarrativeScenePrompt(input);
      const request = prepareNarrativeOutcomeRequest(run, world, ctx, tools.tools, taskPrompt, { task: ctx.narrativePlan!.task });
      const text = request.history.map((entry) => entry.content).join("\n");
      const routeLore = new Set(definition.lore.filter((entry) => entry.directionIds?.length).map((entry) => entry.text));
      assert.equal(taskPrompt.includes(input.act.prompt), input.presentation !== "summary");
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
          assert.match(fn.description, /人生背景/);
          assert.match(text, /20岁至22岁/);
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

test("事实详情按背景或混合任务取用，引用权限仍覆盖全部开放事实", () => {
  const run = makeRun();
  const ids = applyNarrativeFactUpdates(run, {
    introduce: Array.from({ length: 5 }, (_, index) => ({ kind: "open_question" as const, label: `当前事务${index}` })),
    touchFactIds: [], resolveFactIds: []
  }, { sourceEventId: "current" });
  assert.equal(selectDynamicNarrativeContext(run, { task: "background", factIds: ids }).facts.length, 1);
  assert.equal(selectDynamicNarrativeContext(run, { task: "dynamic", backgroundAllowed: true, factIds: ids }).facts.length, 2);
  assert.equal(selectDynamicNarrativeContext(run, { task: "dynamic", factIds: ids }).facts.length, 4);
  assert.deepEqual(factUpdateContract(run.story.factLedger!.facts.map((fact) => fact.id)).mutableIds, ids);
});

test("事实状态与内容同步提交，已发生结果不进入开放问题目录", () => {
  const run = makeRun();
  const introduced = parseFactUpdates({ introduce: [
    { kind: "commitment", label: "归还借来的书", status: "open" },
    { kind: "cost", label: "修屋耗去了积蓄", status: "resolved" }
  ] }, factUpdateContract([]))!;
  const ids = applyNarrativeFactUpdates(run, introduced, { sourceEventId: "begin" });
  assert.equal(run.story.factLedger!.facts.find((fact) => fact.id === ids[1])?.status, "resolved");
  const contract = factUpdateContract([ids[0], "world:chapter"]);
  const update = parseFactUpdates({ updates: [{ factId: ids[0], status: "resolved", summary: "书已归还，借阅的约定履行完毕" }] }, contract)!;
  applyNarrativeFactUpdates(run, update, { sourceEventId: "returned" });
  assert.equal(run.story.factLedger!.facts.find((fact) => fact.id === ids[0])?.resolutionSummary, "书已归还，借阅的约定履行完毕");
  assert.equal(run.story.factLedger!.facts.filter((fact) => fact.status === "open").length, 0);
  assert.throws(() => parseFactUpdates({ updates: [{ factId: "world:chapter", status: "resolved", summary: "结束" }] }, contract));
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
  assert.match(run.turnRecords.at(-1)!.narrativeCharactersSnapshot![0].description, /已离场.*病故/);
  assert.deepEqual(run.turnRecords[0], earlier[0]);
  assert.equal(run.narrative.dynamicCharacters.length, 1);
  assert.match(selectDynamicNarrativeContext(run, { task: "background", text: "老师" }).characters[0].description!, /已离场.*病故/);
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
  assert.match(composition.renderedContext, /事项引用目录：fact:debt=仍欠一笔人情/);
  assert.ok(composition.renderedContext.endsWith("场景发生年龄：18岁。可选路线：study、career。"));
  assert.equal(composition.historyMessages.some((entry) => entry.content.includes("此前已经离开故乡")), false);
  assert.equal(composition.manifest.summaryThroughMemoryId, "memory:home");
});

test("静态前缀不吸收主线运行态，动态世界卡也不伪装成长期设定", () => {
  const basePlan = {
    task: "planning" as const, storyBible: "固定世界切片", styleRules: [], activeLore: [], plotEssentials: [], activeThreads: [],
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
  assert.equal(first.stableContext, background.stableContext);
  assert.match(first.activeContext, /场景调色板/);
  assert.match(background.activeContext, /生活调色板/);
});

test("世界核心与叙事调色板独立投影，不再被 storyBible 长度吞掉", async () => {
  const definition = await loadNarrativeExperienceForTest("fantasy");
  const run = makeRun();
  run.worldId = "fantasy";
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  const scenePlan = buildNarrativePromptPlan(run, definition, null, "rendering")!;
  const scene = composeNarrativeContext({ task: "rendering", taskPrompt: "写当前场景", plan: scenePlan });
  assert.match(scene.stableContext, /修行文明与诡异生态并存/);
  assert.match(scene.activeContext, /改写规则/);
  assert.match(scene.activeContext, /天地规则与诸界/);
  const backgroundPlan = buildNarrativePromptPlan(run, definition, null, "background")!;
  const background = composeNarrativeContext({ task: "background", taskPrompt: "写普通岁月", plan: backgroundPlan });
  assert.match(background.activeContext, /修行日常/);
  assert.doesNotMatch(background.activeContext, /改写规则/);
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

test("上下文预算保留当前任务并优先裁剪低优先召回", () => {
  const activeLore = Array.from({ length: 80 }, (_, index) => `世界知识${index}：${"遥远地区的风俗与传闻".repeat(20)}`);
  const composition = composeNarrativeContext({
    task: "background",
    taskPrompt: "叙述10岁至12岁的生活与成长。",
    plan: {
      task: "background", storyBible: "", styleRules: [], activeLore, plotEssentials: [], activeThreads: [], activeCharacters: [],
      scene: "", authorNote: "", ending: "", persona: "一个正在成长的人"
    }
  });
  assert.ok(composition.manifest.droppedFragmentIds.some((id) => id.startsWith("recall:lore:")));
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
      sceneGoal: "让人物面对眼前局势", presentation: "scene", clockRequest: "advance"
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
  assert.match(dynamicNarrativeScenePrompt(input), new RegExp(force.methods[0]!));
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
  assert.equal(planning.memoryDigests?.some((entry) => entry.id === "route:obsolete"), false);
  assert.match(planning.routeGuidance ?? "", /人物将从自身处境进入天下乱局/);
  const rendering = buildNarrativePromptPlan(run, definition, null, "rendering", { patternIds: [], factionIds: [forceId] })!;
  assert.deepEqual(rendering.memoryDigests, []);
  const horizon = buildNarrativePromptPlan(run, definition, null, "horizon")!;
  assert.deepEqual(horizon.memoryDigests?.map((entry) => entry.id), [`act:${currentActId}`]);
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
  run.narrative.sessionPremise = {
    protagonistAnchor: "人物正在认识自己的处境", centralTension: "选择与代价互相牵动", storyPromise: "寻找自己的道路",
    keywords: ["道路"],
    arcs: definition.mainlineActs!.map((act) => ({ actId: act.id, dramaticQuestion: "如何前进", pressureSource: "未知", payoffPossibility: "形成自己的答案" }))
  };
  const runtime = run.narrative.actRuntime!;
  run.narrative.horizonPlan = {
    id: `horizon:${runtime.actId}:1`, actId: runtime.actId, revision: 1,
    dramaticQuestion: "如何前进", developingTension: "灵力传承正在显露代价",
    intents: [{ id: `horizon:${runtime.actId}:1:intent:1`, goal: "理解玄衡印留下的痕迹", status: "active" }], focusRefs: [], payoffShape: "人物形成自己的答案",
    status: "active", createdAt: 1
  };
  run.narrative.lastBeatObservation = { decision: "hold", resolvedFactIds: [], carryFactIds: [], actId: runtime.actId, beat: runtime.beat, createdAt: 1 };
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
  assert.deepEqual(narrativeTurnCapabilities(true, "setup", ["background"]), ["background"]);
  assert.deepEqual(narrativeTurnCapabilities(false, "setup", ["scene"]), ["scene", "choice"]);
  assert.deepEqual(narrativeTurnCapabilities(false, "escalation", ["background", "scene"]), ["background", "scene", "choice"]);
  assert.deepEqual(narrativeTurnCapabilities(false, "pressure", ["background", "scene"]), ["background", "scene", "choice"]);
  assert.deepEqual(narrativeTurnCapabilities(false, "climax", ["scene"]), ["scene", "choice"]);
  assert.deepEqual(narrativeTurnCapabilities(false, "payoff", ["background", "scene"]), ["background", "scene"]);
});

test("规划工具目录与能力目录使用同一协议，不再暴露返回后会被拒绝的呈现", () => {
  const envelope: NarrativeTurnEnvelope = {
    callId: "turn:contract", source: "scene", worldId: "ancient", currentAge: 20, sceneAge: 21,
    backgroundAgeRange: { fromAge: 21, toAge: 22 }, act: { id: "act.one", label: "第一幕", prompt: "推进本幕" },
    beat: "payoff", capabilities: ["background", "scene"],
    storyPatterns: [{ id: "pattern.a", label: "经历", summary: "人物经历" }],
    socialForces: [{ id: "force.a", label: "力量", summary: "相关人物" }],
    focusReferences: [],
    statTiers: { intelligence: "steady", charisma: "steady", family: "steady", fortune: "steady", physique: "steady" },
    clock: { mode: "advance", sameAgeTurnCount: 0, maxSameAgeTurns: 3 }
  };
  const tools = narrativeTurnPlanTools(envelope).map((tool) => tool.function as {
    name: string; parameters: { required: string[]; properties: Record<string, unknown> }
  });
  assert.deepEqual(tools.map((tool) => tool.name), ["plan_background_turn", "plan_scene_turn"]);
  assert.ok(!tools.some((tool) => tool.name === "plan_choice_turn"));
  const scene = tools.find((tool) => tool.name === "plan_scene_turn")!;
  assert.equal(scene.parameters.required.includes("patternIds"), false);
  assert.equal("patternIds" in scene.parameters.properties, false);
  assert.ok(scene.parameters.required.includes("forceIds"));
  assert.equal("presentation" in scene.parameters.properties, false);
  const planningPrompt = narrativeTurnPlanningPrompt(envelope);
  assert.match(planningPrompt, /conflictRefs/);
  assert.match(planningPrompt, /abilityRefs/);
  assert.match(planningPrompt, /locationDirective/);
  assert.match(planningPrompt, /需要在同一年继续处理当前事情时用 hold/);
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
  commitNarrativeActCanon(run, {
    actId: "act.one", sourceEventId, resolvedAge: 20, routeId: "route.one", factIds: episode.factIds,
    handoff: { resolvedTension: "矛盾落定", lastingConsequence: "人物承担代价", continuation: "新的处境已经形成" }
  });
  assert.deepEqual(episode.memoryIds, [`memory:${sourceEventId}`]);
  assert.equal("text" in episode, false);
  const recall = selectNarrativeEpisodeRecall(run.narrative, { actId: "act.two", routeId: "route.one", focusIds: ["fact.one"] });
  assert.equal(recall.memoryIds.includes(`memory:${sourceEventId}`), false);
  assert.equal(recall.canon[0]?.sourceEventId, sourceEventId);
});

test("异步记忆整理只覆盖已提交 Episode，并以 revision 原子提交", () => {
  const run = makeRun();
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
  assert.equal(applyNarrativeMemoryCuration(run, work, {
    digests: [
      { id: "run", summary: "人物在四年生活中逐渐成长。", activeFactIds: [], historicalFactIds: [], characterIds: [] },
      { id: "act:act.one", summary: "当前幕仍在开场。", activeFactIds: [], historicalFactIds: [], characterIds: [] }
    ]
  }), true);
  assert.equal(run.narrative.memoryRevision, 1);
  assert.equal(run.narrative.memoryDigests.find((entry) => entry.id === "run")?.coveredEpisodeIds.length, 4);
  assert.equal(run.aiConversation.year?.headMemory, "人物在四年生活中逐渐成长。");
  assert.equal(run.aiConversation.year?.archive.length, 0);
  assert.equal(applyNarrativeMemoryCuration(run, work, { digests: [] }), false);
});

test("已提交的剧情变化经状态规范化保留，并作为长期记忆的增量输入", () => {
  const run = makeRun();
  for (let index = 0; index < 3; index += 1) {
    const sourceEventId = `delta:${index}`;
    commitNarrativeMemory(run.narrative, {
      id: `memory:${sourceEventId}`, age: index + 1, factionIds: [], characterIds: [], factIds: [],
      text: `这是一段不应再次传给长期记忆整理器的完整正文${index}。`
    });
    commitNarrativeEpisode(run, {
      callId: `call:${index}`, sourceEventId, turnKind: "scene", age: index + 1,
      storyDelta: `人物完成了第${index + 1}项行动`
    });
  }
  const normalized = ensureNarrativeRunState(run.narrative, true);
  assert.equal(normalized.episodes[0]?.storyDelta, "人物完成了第1项行动");
  assert.deepEqual(recentCommittedNarrativeChanges(normalized.episodes), [
    "1岁：人物完成了第1项行动", "2岁：人物完成了第2项行动", "3岁：人物完成了第3项行动"
  ]);
  run.narrative = normalized;
  const work = prepareNarrativeMemoryCuration(run)!;
  const prompt = memoryCurationPrompt(work, work.scopes);
  assert.match(prompt, /人物完成了第3项行动/);
  assert.doesNotMatch(prompt, /这是一段不应再次传给长期记忆整理器的完整正文/);
});

test("核心摘要先取得覆盖权，附属视图可在同一批次独立提交", () => {
  const run = makeRun();
  run.narrative.enabled = true;
  for (let index = 0; index < 4; index++) {
    const sourceEventId = `scope:${index}`;
    commitNarrativeMemory(run.narrative, {
      id: `memory:${sourceEventId}`, age: index, routeId: "route.one", factionIds: [], characterIds: [], factIds: [],
      locationIds: ["location.one"], abilityIds: ["ability.one"], text: `第${index}段经历`
    });
    commitNarrativeEpisode(run, { callId: `call:${index}`, sourceEventId, turnKind: "scene", age: index, routeId: "route.one", storyDelta: `第${index}段剧情变化` });
  }
  const work = prepareNarrativeMemoryCuration(run)!;
  assert.ok(work.scopes.some((scope) => scope.id === "location:location.one"));
  assert.ok(work.scopes.some((scope) => scope.id === "ability:ability.one"));
  const runPrompt = memoryCurationPrompt(work, work.scopes.filter((scope) => scope.id === "run"));
  const objectPrompt = memoryCurationPrompt(work, work.scopes.filter((scope) => scope.id !== "run"));
  assert.match(runPrompt, /第0段剧情变化/);
  assert.doesNotMatch(runPrompt, /第0段经历/);
  assert.doesNotMatch(objectPrompt, /第0段经历/);
  assert.match(objectPrompt, /第0段剧情变化/);
  assert.equal(applyNarrativeMemoryCuration(run, work, { digests: [{
    id: "run", summary: "四段经历已经发生。", activeFactIds: [], historicalFactIds: [], characterIds: []
  }] }), true);
  assert.equal(run.narrative.memoryRevision, 1);
  assert.equal(applyNarrativeScopedMemoryCuration(run, work, { digests: [{
    id: "route:route.one", summary: "这条经历形成了连续变化。", activeFactIds: [], historicalFactIds: [], characterIds: []
  }] }), true);
  assert.equal(run.narrative.memoryRevision, 1);
  assert.equal(run.narrative.memoryDigests.find((digest) => digest.id === "route:route.one")?.coveredEpisodeIds.length, 4);
  assert.equal(applyNarrativeScopedMemoryCuration(run, work, { digests: [{
    id: "location:location.one", summary: "此地留下了连续经历。", activeFactIds: [], historicalFactIds: [], characterIds: []
  }, {
    id: "ability:ability.one", summary: "这项本领在实践中逐渐稳定。", activeFactIds: [], historicalFactIds: [], characterIds: []
  }] }), true);
  assert.ok(selectNarrativeEpisodeRecall(run.narrative, { focusIds: ["location.one", "ability.one"] }).digests.some((digest) => digest.id === "location:location.one"));
});

test("单次整理返回的全局与对象摘要按各自提交边界只写入一次", () => {
  const run = makeRun();
  for (let index = 0; index < 3; index += 1) {
    const sourceEventId = `combined:${index}`;
    commitNarrativeMemory(run.narrative, {
      id: `memory:${sourceEventId}`, age: index + 1, factionIds: [], characterIds: [], factIds: [],
      locationIds: ["location.one"], text: `人物到访地点的第${index + 1}段经历`
    });
    commitNarrativeEpisode(run, { callId: `call:${index}`, sourceEventId, turnKind: "scene", age: index + 1 });
  }
  const work = prepareNarrativeMemoryCuration(run)!;
  const result = { digests: [
    { id: "run", summary: "人物连续到访同一地点。", activeFactIds: [], historicalFactIds: [], characterIds: [] },
    { id: "location:location.one", summary: "此地留下新的经历。", activeFactIds: [], historicalFactIds: [], characterIds: [] }
  ] };
  assert.equal(applyNarrativeMemoryCuration(run, work, result), true);
  assert.equal(run.narrative.memoryDigests.some((digest) => digest.id === "location:location.one"), false);
  assert.equal(applyNarrativeScopedMemoryCuration(run, work, result), true);
  assert.equal(run.narrative.memoryDigests.find((digest) => digest.id === "location:location.one")?.revision, 1);
});

test("对象摘要只在首次出现、累计变化或幕间收束时更新", () => {
  const run = makeRun();
  run.narrative.enabled = true;
  run.narrative.memoryDigests = [{
    id: "location:known", scope: "location", scopeId: "known", revision: 1,
    throughEpisodeId: "episode:old", coveredEpisodeIds: ["episode:old"], summary: "旧地点状态。",
    activeFactIds: [], historicalFactIds: [], characterIds: [], updatedAt: 1
  }];
  for (let index = 0; index < 3; index++) {
    const sourceEventId = `paced-scope:${index}`;
    commitNarrativeMemory(run.narrative, {
      id: `memory:${sourceEventId}`, age: index + 1, factionIds: [], characterIds: [], factIds: [],
      locationIds: index === 0 ? ["known"] : [], abilityIds: index === 0 ? ["new-ability"] : [], text: `第${index + 1}段变化`
    });
    commitNarrativeEpisode(run, { callId: `call:paced:${index}`, sourceEventId, turnKind: "scene", age: index + 1 });
  }
  const work = prepareNarrativeMemoryCuration(run)!;
  assert.equal(work.scopes.some((scope) => scope.id === "location:known"), false);
  assert.equal(work.scopes.some((scope) => scope.id === "ability:new-ability"), true);
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
  for (const task of ["reviewing", "continuity"] as const) {
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

test("IF 路线每幕保留有界素材锚点，当前语义继续补充召回", async () => {
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
  assert.ok(selectedAnchorIds.length <= 2);
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
  }, 12, 4000);
  assert.ok(selected.some((card) => card.id === "fantasy.setting.weird_ecology"));
  assert.equal(selected.some((card) => card.id === "fantasy.practice.combat_exchange"), false);
});

test("已整理 Episode 默认由 Digest 代表，显式关注仍可追溯原文", () => {
  const run = makeRun();
  const sourceEventId = "dynamic:one";
  commitNarrativeMemory(run.narrative, {
    id: `memory:${sourceEventId}`, age: 18, factionIds: [], characterIds: ["person.one"], factIds: [], text: "人物与故人重逢。"
  });
  const episode = commitNarrativeEpisode(run, { callId: "call:one", sourceEventId, turnKind: "scene", age: 18, actId: "act.one", beat: "setup", characterIds: ["person.one"] });
  run.narrative.memoryDigests = [{
    id: "run", scope: "run", revision: 1, throughEpisodeId: episode.id, coveredEpisodeIds: [episode.id],
    summary: "人物与故人重逢。", activeFactIds: [], historicalFactIds: [], characterIds: [], updatedAt: 1
  }];
  const ordinary = selectNarrativeEpisodeRecall(run.narrative, { actId: "act.one" });
  assert.deepEqual(ordinary.memoryIds, []);
  assert.equal(ordinary.digests[0]?.id, "run");
  const focused = selectNarrativeEpisodeRecall(run.narrative, { actId: "act.one", focusIds: ["person.one"] });
  assert.deepEqual(focused.memoryIds, [`memory:${sourceEventId}`]);
  commitNarrativeActCanon(run, {
    actId: "act.one",
    sourceEventId,
    resolvedAge: 18,
    factIds: [],
    handoff: {
      resolvedTension: "旧事已经处理",
      lastingConsequence: "人物关系已经改变",
      continuation: "人物带着结果进入下一幕"
    }
  });
  const prose = selectNarrativeEpisodeRecall(run.narrative, {
    actId: "act.two",
    focusIds: ["person.one"],
    mode: "prose"
  });
  assert.deepEqual(prose.memoryIds, []);
  assert.deepEqual(prose.digests, []);
  assert.deepEqual(prose.canon, []);
  const horizon = selectNarrativeEpisodeRecall(run.narrative, { actId: "act.two", mode: "horizon" });
  assert.deepEqual(horizon.memoryIds, []);
  assert.equal(horizon.canon[0]?.actId, "act.one");
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
    "legacy-plan", "stable-character", "story-runtime", "world-cards", "world-lore", "characters", "facts",
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
  const review = narrativeProseReviewTool({
    callId: "call:one", task: "choice", ageLabel: "18岁", sceneGoal: "面对取舍", narrative: "正文", background: "抉择背景"
  }).function as { parameters: { properties: Record<string, unknown> } };
  assert.deepEqual(Object.keys(review.parameters.properties).sort(), ["background", "narrative"]);
});

test("任务契约隔离调度、结算、正文、审校与记忆职责", () => {
  assert.equal(narrativeTaskContract("planning").identity, "planner");
  assert.equal(narrativeTaskContract("settlement").identity, "adjudicator");
  assert.equal(narrativeTaskContract("rendering").usesNarratorVoice, true);
  assert.equal(narrativeTaskContract("reviewing").identity, "editor");
  assert.match(narrativeTaskContract("rendering").systemInstruction, /玩家可见文本只写故事内容/);
  assert.match(narrativeTaskContract("rendering").systemInstruction, /assetActivity.*continuityRefs/);
  assert.match(narrativeTaskContract("decision").systemInstruction, /assetActivity.*continuityRefs/);
  assert.match(narrativeTaskContract("background").systemInstruction, /assetActivity.*continuityRefs/);
  assert.match(narrativeTaskContract("continuity").systemInstruction, /locationUpdates|更新数组/);
  assert.match(narrativeTaskContract("reviewing").systemInstruction, /停在人物作出选择之前/);
  assert.equal(narrativeTaskContract("continuity").memoryAccess, "read_delta");
  assert.equal(narrativeTaskContract("curation").identity, "curator");
  const tool = {
    type: "function", function: {
      name: "test_task_contract", description: "测试任务身份",
      parameters: { type: "object", additionalProperties: false, properties: {} }
    }
  };
  const run = makeRun();
  const planning = prepareNarrativeOutcomeRequest(run, world, memoryTestContext(run), tool, "选择计划", { task: "planning" });
  assert.match(planning.conversation.headCore, /叙事调度器/);
  assert.doesNotMatch(planning.conversation.headCore, /故事的旁白/);
  const rendering = prepareNarrativeOutcomeRequest(run, world, memoryTestContext(run), structuredClone(tool), "撰写正文", { task: "rendering" });
  assert.match(rendering.conversation.headCore, /故事的旁白/);
});

test("正文审校只在过长、泄露、重复或越过未决抉择时触发", () => {
  const base = {
    callId: "review:one", task: "choice" as const, ageLabel: "18岁", sceneGoal: "面对取舍",
    narrative: "来人把三条去路摆到你面前，众人等着你的答复。",
    background: "院中安静下来，尚无人替你作答。",
    interactionState: "choice_pending" as const
  };
  assert.equal(shouldRefineNarrativeProse(base), false);
  assert.equal(shouldRefineNarrativeProse({ ...base, narrative: "你当即选择了暂缓，并已经离开院子。" }), true);
  assert.equal(shouldRefineNarrativeProse({ ...base, narrative: "正文<assetUpdates>内部字段</assetUpdates>" }), true);
  const choiceProfile = narrativeProseProfile("choice", "pressure");
  const profiled = {
    ...base,
    targetMinLength: choiceProfile.targetMinLength,
    targetMaxLength: choiceProfile.targetMaxLength,
    reviewAtLength: choiceProfile.reviewAtLength,
    maxLength: choiceProfile.hardMaxLength,
    backgroundTargetMaxLength: choiceProfile.backgroundTargetMaxLength,
    backgroundMaxLength: choiceProfile.backgroundHardMaxLength
  };
  assert.equal(shouldRefineNarrativeProse({ ...profiled, narrative: "很长".repeat(400) }), true);
  assert.equal(shouldRefineNarrativeProse({ ...profiled, narrative: "处境".repeat(130) }), true);
  const prompt = narrativeProseReviewPrompt(profiled);
  assert.match(prompt, /正文对应18岁/);
  assert.match(prompt, /建议成稿保持在110-190字/);
  assert.doesNotMatch(prompt, /choice_pending|safe|balanced|risky|玩家尚未选择|不得把任何一项/);
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
  assert.match(climax.instruction, /同年分成多轮/);
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

test("关联世界卡服从冷却、互斥组和上下文预算", async () => {
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
  assert.deepEqual(selectNarrativeWorldCards(run, definition, { task: "dynamic", text: "触发" }, 6, 100).map((entry) => entry.id), ["test.parent"]);
  run.narrative.worldCardActivations = [];
  definition.worldCards![0].inclusionGroup = "one";
  definition.worldCards![1].inclusionGroup = "one";
  assert.deepEqual(selectNarrativeWorldCards(run, definition, { task: "dynamic", text: "触发" }).map((entry) => entry.id), ["test.parent"]);
  definition.worldCards![1].inclusionGroup = "two";
  assert.deepEqual(selectNarrativeWorldCards(run, definition, { task: "dynamic", text: "触发" }, 1, 100).map((entry) => entry.id), ["test.parent"]);
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

test("IF 当前幕世界卡先进入轻量目录，选中后才载入正文", async () => {
  const base = await loadNarrativeWorldDefinition("ancient");
  assert.ok(base);
  const pack = await loadNarrativeStoryPack(base, "ancient.frontier-commander");
  assert.ok(pack);
  const definition = resolveNarrativeExperience(base, pack);
  const firstAct = pack.acts[0];
  const directory = narrativeStoryPackWorldCardDirectory(definition, firstAct.id);
  assert.deepEqual(directory.map((entry) => entry.id), firstAct.worldCardRefs);
  assert.ok(directory.every((entry) => entry.label && !entry.label.includes("\n")));

  const run = makeRun();
  run.worldId = "ancient";
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  const militaryCardId = firstAct.worldCardRefs!.find((id) => id.includes("military"))!;
  const focused = buildNarrativePromptPlan(run, definition, null, "rendering", { focusIds: [militaryCardId], semanticQuery: "展开本轮行动" })!;
  assert.equal(focused.activeWorldCardSources?.some((entry) => entry.id === militaryCardId), true);
});

test("动态事实按幕隔离，只有显式续接事实进入下一幕", () => {
  const run = makeRun();
  const [firstActFact] = applyNarrativeFactUpdates(run, {
    introduce: [{ kind: "open_question", label: "同一处境仍待回答" }], touchFactIds: [], resolveFactIds: []
  }, { sourceEventId: "act-one", actId: "act.one" });
  const [secondActFact] = applyNarrativeFactUpdates(run, {
    introduce: [{ kind: "open_question", label: "同一处境仍待回答" }], touchFactIds: [], resolveFactIds: []
  }, { sourceEventId: "act-two", actId: "act.two" });
  const ordinary = selectDynamicNarrativeContext(run, { task: "dynamic", actId: "act.two", text: "同一处境" });
  assert.deepEqual(ordinary.facts.map((fact) => fact.id), [secondActFact]);
  const carried = selectDynamicNarrativeContext(run, { task: "dynamic", actId: "act.two", factIds: [firstActFact], text: "同一处境" });
  assert.ok(carried.facts.some((fact) => fact.id === firstActFact));
  assert.deepEqual(parseDynamicNarrativeActHandoff({
    resolvedTension: "本幕已有结果",
    lastingConsequence: "人物的位置发生变化",
    continuation: "新的处境由此开始",
    carryFactIds: [firstActFact, "missing"]
  }, [firstActFact]), {
    resolvedTension: "本幕已有结果",
    lastingConsequence: "人物的位置发生变化",
    continuation: "新的处境由此开始",
    carryFactIds: [firstActFact]
  });
});

test("节拍观察同时核对幕目标与阶段结果", () => {
  const prompt = narrativeBeatObservationPrompt({
    beat: "payoff",
    arcQuestion: "人物能否承担一方责任？",
    actObjective: "实际指挥人员与资源应对危机",
    payoffMeaning: "人物的决断已经产生一方攻守的后果",
    beatOutline: { payoff: "让本幕核心矛盾形成明确结果" },
    actProgress: [{ beat: "setup", changes: ["人物进入当前处境。"] }],
    currentDelta: "人物核验了数份文书。",
    activeFacts: []
  }, "当前事情已有明确结果，并形成后续生活的新处境");
  assert.match(prompt, /实际指挥人员与资源/);
  assert.match(prompt, /产生一方攻守的后果/);
  assert.match(prompt, /局部事务、手续或信息整理/);
});

test("抉择上下文精确继承场景地点与本领，风格卡只在声明任务出现", async () => {
  const definition = await loadNarrativeExperienceForTest("fantasy");
  const run = makeRun();
  run.worldId = "fantasy";
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  run.narrative.assets = {
    locations: [{ id: "location:gate", name: "石门", description: "潮湿石门", introduced: { age: 8 }, lastSeen: { age: 8 } }],
    abilities: [{ id: "ability:seal", name: "封息诀", description: "收束气息", source: "旧师传授", mastery: "初学", status: "available", introduced: { age: 8 }, updated: { age: 8 } }],
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

test("完成提案先合并进展，观察器关闭后退出普通召回且保留证据和资产", () => {
  const run = makeRun();
  const [factId] = applyNarrativeFactUpdates(run, {
    introduce: [{ kind: "open_question", label: "是否迁往新城" }], touchFactIds: [], resolveFactIds: []
  }, { sourceEventId: "arrival-question", actId: "act.one" });
  const assets = applyNarrativeAssetUpdates(run.narrative.assets, {
    locations: [{ ref: "new", name: "新城", description: "已经抵达的新居", current: true }], abilities: []
  }, { age: 12 });
  commitNarrativeAssets(run.narrative, assets, undefined, { age: 12 });
  const before = structuredClone(run);
  const proposal = parseFactUpdates({ updates: [{ factId, status: "resolved", summary: "人物已经迁入新城并开始生活。" }] }, factUpdateContract([factId]))!;
  const input = narrativeObservationFacts(run, "act.one", proposal);
  assert.equal(input[0]?.completionEvidence, "人物已经迁入新城并开始生活。");
  assert.equal(input[0]?.state, input[0]?.completionEvidence);
  assert.deepEqual(run, before, "观察器准备只读，不提前关闭事实");
  applyNarrativeFactUpdates(run, narrativeFactProgressForCommit(proposal), { sourceEventId: "arrival-result", actId: "act.one" });
  assert.equal(run.story.factLedger!.facts.find((fact) => fact.id === factId)?.status, "open");
  applyObserverFactResolutions(run, [factId], "act.one", "arrival-result");
  const fact = run.story.factLedger!.facts.find((entry) => entry.id === factId)!;
  assert.equal(fact.status, "resolved");
  assert.equal(fact.resolutionSummary, "人物已经迁入新城并开始生活。");
  assert.equal(fact.lastSourceEventId, "arrival-result");
  assert.equal(selectDynamicNarrativeContext(run, { task: "planning", actId: "act.one", factIds: [factId], text: "是否迁往新城" }).facts.length, 0);
  assert.equal(run.narrative.assets!.locations[0]?.name, "新城");
  assert.equal(run.narrative.assets!.currentLocationId, assets.currentLocationId);
});

test("观察器保留实际涉及事实，完成留待裁定时可继续使用最新进展", () => {
  const run = makeRun();
  const ids = applyNarrativeFactUpdates(run, {
    introduce: Array.from({ length: 15 }, (_, index) => ({ kind: "open_question" as const, label: `事项${index}`, priority: index < 12 ? 4 : 1 })),
    touchFactIds: [], resolveFactIds: []
  }, { sourceEventId: "many-facts", actId: "act.one" });
  const proposal = parseFactUpdates({ updates: [{ factId: ids[14], status: "resolved", summary: "已经答复并履行该事项。" }] }, factUpdateContract(ids))!;
  assert.ok(narrativeObservationFacts(run, "act.one", proposal).some((fact) => fact.id === ids[14] && fact.completionEvidence));
  assert.equal(narrativeObservationFacts(run, "act.one", undefined, ids).length, 15, "细节预算不截掉本轮实际引用");
  applyNarrativeFactUpdates(run, narrativeFactProgressForCommit(proposal), { sourceEventId: "answer", actId: "act.one" });
  assert.equal(narrativeObservationFacts(run, "act.one", undefined, [ids[14]]).find((fact) => fact.id === ids[14])?.state, "已经答复并履行该事项。");
  const other = applyNarrativeFactUpdates(run, { introduce: [{ kind: "open_question", label: "其他幕的疑问" }], touchFactIds: [], resolveFactIds: [] }, { sourceEventId: "other", actId: "act.two" })[0];
  assert.deepEqual(applyObserverFactResolutions(run, [other], "act.one", "wrong-act"), []);
  const prompt = narrativeBeatObservationPrompt({
    beat: "pressure", arcQuestion: "主线大问题", actProgress: [], currentDelta: "人物答复了这一事项。",
    activeFacts: narrativeObservationFacts(run, "act.one", proposal), factsOnly: true
  }, "压力");
  assert.match(prompt, /beatDecision=hold/);
  assert.doesNotMatch(prompt, /主线大问题/);
});

test("跨幕承接引用可持续更新并退场，不被重新创建成同一事项", () => {
  const run = makeRun();
  const [id] = applyNarrativeFactUpdates(run, { introduce: [{ kind: "commitment", label: "约定仍待履行" }], touchFactIds: [], resolveFactIds: [] }, { sourceEventId: "handoff", actId: "act.two" });
  const fact = run.story.factLedger!.facts.find((entry) => entry.id === id)!;
  fact.id = "carry:act.two:promise";
  const contract = factUpdateContract([fact.id]);
  assert.deepEqual(contract.mutableIds, [fact.id]);
  const progress = parseFactUpdates({ updates: [{ factId: fact.id, status: "open", summary: "约定已履行大半，只剩最后一项。" }] }, contract)!;
  applyNarrativeFactUpdates(run, progress, { sourceEventId: "progress", actId: "act.two" });
  const completion = parseFactUpdates({ updates: [{ factId: fact.id, status: "resolved", summary: "约定已全部履行，双方交往进入新阶段。" }] }, contract)!;
  applyNarrativeFactUpdates(run, narrativeFactProgressForCommit(completion), { sourceEventId: "complete", actId: "act.two" });
  applyObserverFactResolutions(run, [fact.id], "act.two", "complete");
  assert.equal(run.story.factLedger!.facts.length, 1);
  assert.equal(run.story.factLedger!.facts[0]?.resolutionSummary, "约定已全部履行，双方交往进入新阶段。");
  assert.deepEqual(narrativeObservationFacts(run, "act.two"), []);
});

test("当前幕观察与规划共用摘要覆盖范围，不丢失三轮之前的有效选择", () => {
  const run = makeRun();
  const episodes = ["已形成立场", "已选择迁移", "继续前行", "抵达途中", "获得协助", "进入新城"].map((delta, index) =>
    commitNarrativeEpisode(run, { callId: `call:${index}`, sourceEventId: `round:${index}`, turnKind: index === 1 ? "decision" : "scene", age: 12, actId: "act.one", beat: "pressure", storyDelta: delta }));
  commitNarrativeEpisode(run, { callId: "other", sourceEventId: "other", turnKind: "scene", age: 10, actId: "act.other", beat: "pressure", storyDelta: "其他幕的事情" });
  run.narrative.memoryDigests = [{
    id: "act:act.one", scope: "act", scopeId: "act.one", revision: 2, throughEpisodeId: episodes[0].id,
    coveredEpisodeIds: ["episode:older-evicted-round", episodes[0].id], summary: "人物已明确自己的立场。",
    activeFactIds: [], historicalFactIds: [], characterIds: [], updatedAt: 2
  }];
  const progress = narrativeActProgress(run, "act.one");
  assert.equal(progress.summary, "人物已明确自己的立场。");
  assert.deepEqual(progress.changes.find((entry) => entry.beat === "pressure")?.changes, ["已选择迁移", "继续前行", "抵达途中", "获得协助", "进入新城"]);
  const envelope: NarrativeTurnEnvelope = {
    callId: "plan", source: "scene", worldId: world.id, currentAge: 12, sceneAge: 12,
    backgroundAgeRange: { fromAge: 13, toAge: 13 }, act: { id: "act.one", label: "第一幕", prompt: "人生进展" }, beat: "pressure",
    capabilities: ["scene", "choice"], storyPatterns: [], socialForces: [], focusReferences: [],
    statTiers: { intelligence: "steady", charisma: "steady", family: "steady", fortune: "steady", physique: "steady" },
    clock: { mode: "hold", sameAgeTurnCount: 0, maxSameAgeTurns: 3 }, actSummary: progress.summary, actProgress: progress.changes
  };
  const planning = narrativeTurnPlanningPrompt(envelope);
  assert.match(planning, /已选择迁移/);
  assert.equal(planning.split(progress.summary!).length - 1, 1);
  assert.doesNotMatch(planning, /其他幕的事情/);
});

test("规划工具决定抉择，问题与后果意图保留到待选存档和结果提交", async () => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  const run = makeRun();
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, 20);
  run.narrative.actRuntime!.beat = "pressure";
  run.age = 20;
  run.stats = { intelligence: 50, charisma: 50, family: 50, fortune: 50, physique: 100 };
  const act = definition.mainlineActs![0];
  const envelope: NarrativeTurnEnvelope = {
    callId: "choice-plan", source: "scene", worldId: run.worldId, currentAge: 20, sceneAge: 21,
    backgroundAgeRange: { fromAge: 21, toAge: 21 }, act: { id: act.id, label: act.label, prompt: act.prompt }, beat: "pressure",
    capabilities: narrativeTurnCapabilities(false, "pressure", ["scene"]), storyPatterns: [], socialForces: [], focusReferences: [],
    statTiers: { intelligence: "steady", charisma: "steady", family: "steady", fortune: "steady", physique: "steady" },
    clock: { mode: "advance", sameAgeTurnCount: 0, maxSameAgeTurns: 3 }
  };
  const raw = { conflictRefs: [], abilityRefs: [], forceIds: [], locationDirective: { mode: "stay" }, sceneGoal: "选择下一步去向", clockRequest: "hold", stageTask: { goal: "建立新的立足之处", completionMeaning: "人物在取舍后已经开始建立自己的生活" }, decisionBrief: { question: "留在故地还是迁居？", stakes: "决定以后生活的位置和交往圈子。" } };
  const tools = narrativeTurnPlanTools(envelope).map((tool) => tool.function as { name: string; parameters: { required: string[] } });
  assert.ok(tools.find((tool) => tool.name === "plan_choice_turn")!.parameters.required.includes("decisionBrief"));
  assert.ok(!tools.find((tool) => tool.name === "plan_scene_turn")!.parameters.required.includes("decisionBrief"));
  const plan = parseNarrativeTurnPlan(raw, "plan_choice_turn", envelope);
  commitNarrativeStageTask(run.narrative, { actId: act.id, beat: "pressure" }, plan.stageTask);
  advanceWithDynamicNarrativeScene(run, world, definition, {
    patternIds: [], forceIds: [], beat: "pressure", beatDecision: "hold", narrative: "新的去处已有落脚机会，你需要决定是否启程。",
    participants: [], createsDecision: plan.presentation === "choice", decisionBrief: plan.decisionBrief
  });
  assert.ok(run.nextMilestoneChoice);
  const restored = JSON.parse(JSON.stringify(run)) as ReturnType<typeof makeRun>;
  restored.narrative = ensureNarrativeRunState(restored.narrative, true);
  assert.deepEqual(restored.narrative.actRuntime?.stageTask, plan.stageTask);
  assert.deepEqual(restored.pendingDynamicScene?.decisionBrief, raw.decisionBrief);
  const [factId] = applyNarrativeFactUpdates(restored, { introduce: [{ kind: "open_question", label: "去向尚未确定" }], touchFactIds: [], resolveFactIds: [] }, { sourceEventId: "choice-question", actId: act.id });
  const proposal = parseFactUpdates({ updates: [{ factId, status: "resolved", summary: "人物已经选择迁居并启程。" }] }, factUpdateContract([factId]))!;
  applyMilestoneDecisionAndAdvance(restored, world, difficulty, "safe", {
    narrativeWorld: definition, narrativeOutcome: { effects: [{ stat: "family", direction: "up", band: "light" }] },
    narrative: "你已经启程，故地的来往至此告一段落。", narrativeFactUpdates: narrativeFactProgressForCommit(proposal), observerResolvedFactIds: [factId], beatDecision: "advance"
  });
  assert.equal(restored.pendingDynamicScene, undefined);
  assert.equal(restored.nextMilestoneChoice, undefined);
  assert.equal(restored.narrative.actRuntime!.beat, "climax");
  assert.equal(restored.narrative.actRuntime!.stageTask, undefined);
  assert.equal(restored.story.factLedger!.facts.find((fact) => fact.id === factId)?.resolutionSummary, "人物已经选择迁居并启程。");
  assert.ok(restored.stats.family > run.stats.family);
  assert.equal(run.pendingDynamicScene?.decisionBrief?.question, raw.decisionBrief.question, "另一份快照未被结果提交污染");
});

test("阶段任务跨背景与同年回合保留，失败不提交，五拍切换清除旧任务", async () => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  const run = makeRun();
  run.worldId = definition.worldId;
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, 20);
  run.age = 20;
  const task = { goal: "形成可持续的立足之处", completionMeaning: "人物已经形成新的处境", fork: { question: "选择哪种解决方式？", stakes: "改变下一步的处境", openingSituation: "两种方式均已具备实施条件" } };
  const scope = { actId: run.narrative.actRuntime!.actId, beat: run.narrative.actRuntime!.beat };
  await assert.rejects(runNarrativeTurnTransaction(run, async (working) => {
    commitNarrativeStageTask(working.narrative, scope, task);
    throw new Error("生成失败");
  }), /生成失败/);
  assert.equal(run.narrative.actRuntime!.stageTask, undefined);
  commitNarrativeStageTask(run.narrative, scope, task);
  settleQuietYearForTest(run, definition);
  assert.deepEqual(run.narrative.actRuntime!.stageTask, task);
  const envelope: NarrativeTurnEnvelope = {
    callId: "reuse", source: "scene", worldId: run.worldId, currentAge: run.age, sceneAge: run.age,
    backgroundAgeRange: { fromAge: run.age + 1, toAge: run.age + 1 }, act: { id: scope.actId, label: "当前幕", prompt: "阶段目标" },
    beat: "setup", stageTask: task, capabilities: ["background", "scene", "choice"], storyPatterns: [], socialForces: [], focusReferences: [],
    statTiers: resolveNarrativeStatTiers(run.stats), clock: { mode: "hold", sameAgeTurnCount: 0, maxSameAgeTurns: 3 }
  };
  const raw = { conflictRefs: [], abilityRefs: [], forceIds: [], locationDirective: { mode: "stay" }, sceneGoal: "完成其中一步", clockRequest: "hold" };
  assert.deepEqual(parseNarrativeTurnPlan(raw, "plan_scene_turn", envelope).stageTask, task);
  assert.deepEqual(parseNarrativeTurnPlan(raw, "plan_background_turn", envelope).stageTask, task);
  assert.throws(() => parseNarrativeTurnPlan(raw, "plan_scene_turn", { ...envelope, stageTask: undefined }), /narrative_outcome_invalid/);
  assert.throws(() => parseNarrativeTurnPlan({ ...raw, stageTask: { goal: "不完整" } }, "plan_scene_turn", envelope), /narrative_outcome_invalid/);
  const initialTool = narrativeTurnPlanTools({ ...envelope, stageTask: undefined })[1].function as { parameters: { required: string[] } };
  assert.ok(initialTool.parameters.required.includes("stageTask"));
  for (const beat of ["setup", "escalation", "pressure", "climax", "payoff"] as const) {
    run.narrative.actRuntime!.beat = beat;
    commitNarrativeStageTask(run.narrative, { actId: scope.actId, beat }, task);
    run.narrative = advanceNarrativeActBeat(run.narrative, definition, run.age).state;
    assert.equal(run.narrative.actRuntime!.stageTask, undefined);
  }
  assert.notEqual(run.narrative.actRuntime!.actId, scope.actId);
  commitNarrativeStageTask(run.narrative, scope, task);
  assert.equal(run.narrative.actRuntime!.stageTask, undefined, "旧幕异步或迟到提案不能覆盖新幕");
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
  run.narrative.memoryDigests = [{ id: `act:${actId}`, scope: "act", scopeId: actId, revision: 1, throughEpisodeId: covered.id, coveredEpisodeIds: [covered.id], summary: "已有的阶段历史结果", activeFactIds: [], historicalFactIds: [], characterIds: [], updatedAt: 1 }];
  const progress = narrativeActProgress(run, actId);
  const envelope: NarrativeTurnEnvelope = {
    callId: "clean", source: "scene", worldId: run.worldId, currentAge: 20, sceneAge: 20, backgroundAgeRange: { fromAge: 21, toAge: 21 },
    act: { id: actId, label: "当前幕", prompt: "重复的幕提示" }, beat: "setup", capabilities: ["scene"], storyPatterns: [], socialForces: [], focusReferences: [],
    statTiers: resolveNarrativeStatTiers(run.stats), clock: { mode: "hold", sameAgeTurnCount: 0, maxSameAgeTurns: 3 }, actSummary: progress.summary, actProgress: progress.changes
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
  assert.equal(text.split(progress.summary!).length - 1, 1);
  assert.equal(text.split("玩家选择已改变去向").length - 1, 1);
  assert.doesNotMatch(text, /已被摘要替代的过程|重复的幕提示|另一份历史摘要|原历史输入|最近的历史输入/);
  assert.equal(request.contextManifest.historyMessageCount, 0);
  assert.equal(request.contextManifest.fragments.filter((entry) => entry.section === "route").length, 1);
  const actOutline = (definition as ResolvedNarrativeExperience).storyPack.acts[0].beatOutline;
  assert.ok(text.includes(actOutline.setup) && text.includes(actOutline.payoff));
});

test("原生工具全链路交接阶段任务、待选岔路口、作答后资产和下一轮规划", async (t) => {
  const definition = await loadNarrativeExperienceForTest("ancient");
  const run = makeRun();
  run.worldId = definition.worldId;
  run.age = 20; run.stats = { intelligence: 50, charisma: 50, family: 50, fortune: 50, physique: 100 };
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  run.narrative.actRuntime!.beat = "pressure";
  const act = definition.mainlineActs![0];
  run.narrative.activeScene = { id: "current-scene", threadId: `arc:${act.id}`, phase: "pressure", mainlineActId: act.id, openedAge: 20, lastTouchedAge: 20 };
  run.narrative.sceneClock.mode = "hold";
  const task = { goal: "改变人物在当前矛盾中的位置", completionMeaning: "取舍后的新处境已实际形成", fork: { question: "如何回应眼前困难？", stakes: "下一步的去向与依仗将改变", openingSituation: "不同解决方式已经具备实际代价" } };
  const brief = { question: task.fork.question, stakes: task.fork.stakes };
  const base = { conflictRefs: [], abilityRefs: [], forceIds: [], locationDirective: { mode: "stay" }, sceneGoal: "为解决当前问题迈出一步", clockRequest: "hold" };
  const activity = { locationIds: [], abilityIds: [] };
  const scripts: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: "plan_scene_turn", args: { ...base, stageTask: task } },
    { name: "resolve_scene_outcome", args: { participants: [], effects: [{ stat: "intelligence", direction: "up", band: "light" }] } },
    { name: "render_scene_prose", args: { narrative: "你完成先前的一步行动，眼前的困难由此有了新的变化。", storyDelta: "已形成可取舍的处境", assetActivity: activity, continuityRequired: false } },
    { name: "observe_story_beat", args: { beatDecision: "hold", resolvedFactIds: [], carryFactIds: [] } },
    { name: "plan_choice_turn", args: { ...base, decisionBrief: brief } },
    { name: "resolve_choice_scene", args: { participants: [] } },
    { name: "render_choice_prose", args: { narrative: "事情走到一个分岔之处，不同的解决方式各有自己的代价。", background: "你需要决定下一步采用哪种方式面对眼前的困难。", storyDelta: "解决方式等待玩家决定", assetActivity: activity, continuityRequired: false, optionOverrides: ["safe", "balanced", "risky"].map((id) => ({ id, label: id === "safe" ? "稳妥前行" : id === "balanced" ? "权衡前行" : "冒险前行", description: "作出取舍并改变下一步去向。", abilityRefs: [], locationDirective: { mode: "stay" } })) } },
    { name: "resolve_decision_outcome", args: { effects: [{ stat: "family", direction: "up", band: "light" }] } },
    { name: "render_decision_outcome", args: { narrative: "你按选定的方式来到新的落脚之处，并学会了处理眼前困难的方法。", storyDelta: "选择已改变去向并获得新的本领", assetActivity: activity, continuityRequired: true } },
    { name: "sync_narrative_continuity", args: { locationUpdates: [{ ref: "new", name: "新的落脚处", description: "人物本次行动抵达的地方", current: true }], abilityUpdates: [{ ref: "new", name: "应对之法", description: "本次行动中掌握的方法", source: "本次取舍后习得", mastery: "初通", status: "available" }], factIntroductions: [], factUpdates: [] } },
    { name: "observe_story_beat", args: { beatDecision: "hold", resolvedFactIds: [], carryFactIds: [] } }
  ];
  const calls: Array<{ name: string; text: string }> = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string } }>; messages: Array<{ content: string }> }) => {
    const step = scripts.shift();
    assert.ok(step, "不能产生计划之外的模型请求");
    assert.ok(payload.tools.some((tool) => tool.function.name === step.name));
    calls.push({ name: step.name, text: payload.messages.map((entry) => entry.content).join("\n") });
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: `mock:${calls.length}`, type: "function", function: { name: step.name, arguments: JSON.stringify(step.args) } }] } }] };
  });
  const context = () => ({ ...memoryTestContext(run), apiKey: "not-sent", narrativePlan: buildNarrativePromptPlan(run, definition, null, "planning") });
  const envelope = (): NarrativeTurnEnvelope => ({
    callId: "native", source: "scene", worldId: run.worldId, currentAge: run.age, sceneAge: run.age,
    backgroundAgeRange: { fromAge: run.age + 1, toAge: run.age + 1 }, act, beat: "pressure", stageTask: run.narrative.actRuntime!.stageTask,
    capabilities: ["scene", "choice"], storyPatterns: [], socialForces: [], focusReferences: [], statTiers: resolveNarrativeStatTiers(run.stats), clock: { mode: "hold", sameAgeTurnCount: 0, maxSameAgeTurns: 3 }
  });
  const generate = () => runNarrativeAgentTurn({ run, world, narrativeWorld: definition, context: context(), envelope: envelope(), buildRenderInput: (plan) => ({
    act, beat: "pressure", presentation: plan.presentation, allowedTurnKinds: ["scene"], sceneAge: run.age, backgroundAgeRange: envelope().backgroundAgeRange,
    storyPatterns: [], socialForces: [], knownCharacters: [], knownFactIds: [], statTiers: resolveNarrativeStatTiers(run.stats), backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run), attributePolicy: plan.presentation === "scene" ? dynamicSceneAttributePolicy() : undefined
  }) });
  const commitScene = (turn: Awaited<ReturnType<typeof generate>>) => {
    commitNarrativeStageTask(run.narrative, { actId: act.id, beat: "pressure" }, turn.plan.stageTask);
    advanceWithDynamicNarrativeScene(run, world, definition, { ...turn.scene, beat: "pressure", beatDecision: turn.scene.beatDecision ?? "hold", decisionBrief: turn.plan.decisionBrief, attributeOutcome: turn.scene.attributeEffects ? { effects: turn.scene.attributeEffects } : undefined, attributePolicy: turn.plan.presentation === "scene" ? dynamicSceneAttributePolicy() : undefined, sceneClockMode: "hold" });
    commitNarrativeEpisode(run, { callId: "native", sourceEventId: run.narrative.scene.lastEventId!, turnKind: "scene", age: run.age, actId: act.id, beat: "pressure", storyDelta: turn.scene.storyDelta });
  };
  const first = await generate();
  assert.equal(Boolean(run.narrative.actRuntime!.stageTask), false, "生成提案尚未提交");
  commitScene(first);
  assert.deepEqual(run.narrative.actRuntime!.stageTask, task);
  assert.equal(run.nextMilestoneChoice, undefined, "预想的岔路口不会提前弹出抉择");
  const choice = await generate(); commitScene(choice);
  assert.deepEqual(run.pendingDynamicScene!.decisionBrief, brief);
  const pending = structuredClone(run.pendingDynamicScene);
  const decisionContext = { ...context(), narrativePlan: buildNarrativePromptPlan(run, definition, null, "decision") };
  const result = await runNarrativeAgentDecision({ run, world, narrativeWorld: definition, context: decisionContext, callId: "answer", decision: {
    decision: "safe", label: "稳妥前行", description: "进入新的地方掌握新的方法", stageTask: run.narrative.actRuntime!.stageTask, decisionBrief: brief,
    locationDirective: { mode: "move", purpose: "开始新的生活" }, attributePolicy: { allowedStats: ["family"], allowedDirections: ["up"], allowedBands: ["light"], minEffects: 1, maxEffects: 1 }
  } });
  const settled = applyMilestoneDecisionAndAdvance(run, world, difficulty, "safe", { narrativeWorld: definition, narrativeOutcome: { effects: result.outcome.effects }, narrative: result.outcome.narrative, beatDecision: result.observation.decision });
  const assets = commitNarrativeAssets(run.narrative, applyNarrativeAssetUpdates(run.narrative.assets, result.outcome.assetUpdates, { age: run.age }), result.outcome.assetUpdates, { age: run.age }, {}, settled.sourceEventId);
  commitNarrativeEpisode(run, { callId: "answer", sourceEventId: settled.sourceEventId, turnKind: "decision", age: run.age, actId: act.id, beat: "pressure", storyDelta: result.outcome.storyDelta, ...assets });
  appendPublicTurnRecord(run, { entryId: settled.sourceEventId, kind: "choice_outcome", narrative: result.outcome.narrative, age: run.age, ageStage: { label: "青年" }, statChanges: settled.decisionEvent.statChanges });
  assert.equal(run.age, 20, "作答后仍在同年");
  assert.equal(run.narrative.actRuntime!.beat, "pressure");
  assert.equal(run.narrative.actRuntime!.stageTask!.fork, undefined);
  assert.equal(run.narrative.actRuntime!.stageTask!.goal, task.goal);
  assert.equal(run.pendingDynamicScene, undefined);
  assert.equal(pending!.decisionBrief!.question, brief.question);
  assert.equal(toClientRun(run).narrativeAssets!.locations.length, 1);
  assert.equal(toClientRun(run).narrativeAssets!.abilities.length, 1);
  const nextProgress = narrativeActProgress(run, act.id);
  assert.ok(nextProgress.changes.some((entry) => entry.changes.includes(result.outcome.storyDelta)));
  const nextEnvelope = { ...envelope(), actSummary: nextProgress.summary, actProgress: nextProgress.changes };
  const nextContext = context();
  const nextRequest = prepareNarrativeOutcomeRequest(run, world, nextContext, narrativeTurnPlanTools(nextEnvelope), narrativeTurnPlanningPrompt(nextEnvelope), { task: "planning" });
  const nextText = nextRequest.history.map((entry) => entry.content).join("\n");
  assert.ok(nextText.includes(task.goal) && nextText.includes(result.outcome.storyDelta));
  assert.ok(nextText.includes(assets.locationIds[0]) && nextText.includes(assets.abilityIds[0]), "正式提交的资产进入下一轮目录");
  assert.equal(nextEnvelope.stageTask!.fork, undefined, "下一轮不会再次接到已回答的岔路口");
  assert.ok(calls.find((entry) => entry.name === "render_scene_prose")!.text.includes(task.goal));
  assert.ok(calls.find((entry) => entry.name === "observe_story_beat")!.text.includes(task.completionMeaning));
  const continuityCall = calls.find((entry) => entry.name === "sync_narrative_continuity")!.text;
  assert.ok(continuityCall.includes(result.outcome.narrative));
  assert.ok(!continuityCall.includes(task.goal), "连续性仅提取实际正文，不接收规划任务");
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
