import { dynamicNarrativeSceneTools, narrativeTurnPlanTools, narrativeDecisionOutcomeTool, narrativeDecisionRenderTool, narrativeHorizonTool, narrativeProseReviewTool, normalizeMilestoneOptionOverrides, parseDynamicNarrativeParticipants, parseDynamicNarrativeActHandoff, NarrativeOutcomeError, prepareNarrativeOutcomeRequest, interruptedBackgroundTask, recordDirectedDecisionOutcome, recordDirectedStoryTurnOutcome, type NarrativeContext } from "./ai.js";
import { factUpdateContract, parseFactUpdates, parseRelationshipUpdates, narrativeFactResolutionModes } from "./narrative-continuity.js";
import { pendingConversationContext, applyConversationSummary, keepRecentConversationRounds, summarizedConversationMemoryIds, type ChatConversationState } from "./conversation.js";
import { commitNarrativeMemory, narrativeTextOverlap } from "./narrative-memory.js";
import { validateNarrativeEffects, narrativeEffectsSchema } from "./narrative-attributes.js";
import { normalizeNarrativeText, isNarrativePlainText } from "./narrative-prompts.js";
import assert from "node:assert/strict";
import { dynamicNarrativeScenePrompt, type DynamicNarrativeSceneInput } from "./ai.js";
import { retrieveNarrativeMemories } from "./narrative.js";
import test from "node:test";
import { createDefaultGameplayTuning } from "@reroll/shared";
import type { BackgroundCard, DifficultyConfig, EventDefinition, ItemDefinition, NarrativeAttributePolicy, NarrativeWorldDefinition, StoryDirectionDefinition, WorldConfig } from "@reroll/shared";
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
  settleNarrativeBackgroundOutcomes,
  resolveSurvivalCrisis,
  toPublicTimelineEntryFromEvent,
  toClientRun
} from "./engine.js";
import { formatNarrativePromptPlan, buildNarrativePromptPlan, narrativeRouteBeatGuidance, selectDynamicNarrativeContext, selectNarrativeWorldCards, formatTaskNarrativeContext, assessClosureReadiness, assessEnding, ensureNarrativeActRuntime, ensureNarrativeRunState, getNarrativeRouteProgress, isNarrativeEarlyLife, refreshNarrativeMainlineCompletion } from "./narrative.js";
import { loadEventDefinitions, loadNarrativeWorldDefinition, validateNarrativeWorldFactContract } from "./content.js";
import { applyNarrativeAssetUpdates, commitNarrativeAssets, formatNarrativeAssets, narrativeAssetUpdatesSchema, normalizeNarrativeAssets, parseNarrativeAssetUpdates } from "./narrative-assets.js";
import { composeNarrativeContext } from "./narrative/context/orchestrator.js";
import { commitNarrativeActCanon, commitNarrativeEpisode, runNarrativeTurnTransaction } from "./narrative/commit.js";
import { selectNarrativeEpisodeRecall } from "./narrative/episodes.js";
import { applyNarrativeMemoryCuration, applyNarrativeScopedMemoryCuration, prepareNarrativeMemoryCuration } from "./narrative/curator.js";
import { commitNarrativeAgentTurn, invalidateNarrativeHorizon } from "./narrative/runtime.js";
import { defaultNarrativeContextProviders } from "./narrative/context/collectors.js";
import { narrativeTurnCapabilities, type NarrativeTurnEnvelope } from "./narrative/turn.js";

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
      { id: "balanced", label: "交换证词", description: "以让步换取转机。" },
      { id: "risky", label: "公开旧信", description: "押上名声逼出真相。" }
    ]
  });

  assert.equal(run.nextMilestoneChoice.background, "一封旧信把你推到无从回避的取舍前。");
  assert.deepEqual(
    run.nextMilestoneChoice.options.map((option) => ({ id: option.id, risk: option.risk, reward: option.reward })),
    original
  );
  assert.equal(run.nextMilestoneChoice.options[2]?.label, "公开旧信");
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
  assert.ok(JSON.stringify(narrativeAssetUpdatesSchema(run.narrative.assets)).includes(original.abilities[0].id));
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

test("古代世界包以开放幕间职责和路线目录驱动动态叙事", async () => {
  const [definitions, ancientWorld] = await Promise.all([
    loadEventDefinitions("ancient"),
    loadNarrativeWorldDefinition("ancient")
  ]);
  assert.ok(ancientWorld);
  const archetypeIds = new Set(ancientWorld.sceneArchetypes?.map((item) => item.id));
  assert.equal(ancientWorld.mainlineFacts?.length ?? 0, 0);
  assert.equal(ancientWorld.mainlineActs?.length, 3);
  assert.ok(definitions.length >= 60);
  const eventIds = new Set(definitions.map((definition) => definition.id));
  assert.ok(ancientWorld.routeArcs.every((route) => (
    route.materialEventIds?.length && route.materialEventIds.every((eventId) => eventIds.has(eventId))
  )));
  assert.ok(definitions.every((definition) => (
    Boolean(definition.narrativeBeat) &&
    Boolean(definition.sceneArchetypeId) &&
    archetypeIds.has(definition.sceneArchetypeId!)
  )));
});

test("古代世界在 opening 属性门槛不足时不会由旧候选器提前启动 setup", async () => {
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
  for (const route of ancientWorld.routeArcs) {
    const direction: StoryDirectionDefinition = {
      id: route.directionId,
      label: route.label || route.directionId,
      summary: route.summary,
      focusTags: [],
      factionIds: [],
      openingThreadIds: route.coreThreadIds,
      closureTags: []
    };
    const selected = selectDirectedCandidateForIntent(
      ancientRun,
      candidates,
      "continue",
      undefined,
      undefined,
      ancientWorld,
      direction.id
    );
    assert.equal(selected, undefined, `${route.directionId} 不应绕过普通年份缓冲提前进入 setup`);
  }
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
      difficultyId: difficulty.id,
      personaPrompt: "在旧案中寻找出路的人",
      talentPointTotal: 25,
      stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 },
      selectedCardIds: [card.id]
    }
  );
  const dynamicWorld: NarrativeWorldDefinition = {
    ...narrativeWorld,
    version: 4,
    mainlineFacts: [{ id: "act.fact", kind: "open_question", label: "一份旧档的矛盾" }],
    mainlineActs: [{ id: "act.one", label: "旧案显形", prompt: "让旧档进入人物生活", factId: "act.fact" }],
    narrativeFactions: [{ id: "court", label: "朝局", summary: "掌握文书与人情" }],
    routeArcs: [
      { directionId: "route.one", label: "家门", summary: "从家门看见旧案", coreThreadIds: ["thread.one"] },
      { directionId: "route.two", label: "朝局", summary: "从朝局看见旧案", coreThreadIds: ["thread.two"] }
    ]
  };
  const setup = advanceWithDynamicNarrativeScene(run, world, dynamicWorld, {
    routeId: "route.one",
    factionId: "court",
    beat: "setup",
    narrative: "你从一页被改写的账目里，看见家门旧事与朝局之间的裂缝。",
    factUpdates: { introduce: [{ kind: "open_question", label: "沈衡为何隐瞒来历" }], touchFactIds: [], resolveFactIds: [] },
    participants: [{ characterRef: "new", name: "沈衡", factionId: "court", role: "递来旧档的书吏", description: "谨慎地试探你的立场", recurring: true, relationship: { stance: "guarded", summary: "愿意交谈，但仍试探你的立场。" } }],
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
    routeId: "route.two",
    factionId: "court",
    beat: "escalation",
    narrative: "沈衡带来的口供迫使你把家门的隐忧放到朝局的目光之下。",
    relationshipUpdates: [{ characterRef: shenHengId, stance: "friendly", summary: "你们因共同处境逐渐信任。" }],
    participants: [{ characterRef: shenHengId, name: "临时称谓", factionId: "court", role: "被改写的身份", description: "", recurring: false }],
    attributeOutcome: { effects: [{ stat: "charisma", direction: "up", band: "light" }] },
    attributePolicy: { allowedStats: ["charisma"], allowedBands: ["light"], allowedDirections: ["up"], minEffects: 1, maxEffects: 1 }
  });
  assert.equal(escalation.updated.narrative.actRuntime?.beat, "pressure");
  assert.deepEqual(escalation.updated.narrative.actRuntime?.selectedRouteIds, ["route.one", "route.two"]);
  assert.equal(escalation.updated.narrative.dynamicCharacters.length, 1);
  assert.equal(escalation.updated.narrative.dynamicCharacters[0]?.name, "沈衡");
  assert.equal(escalation.updated.narrative.dynamicCharacters[0]?.role, "递来旧档的书吏");
  assert.equal(escalation.updated.narrative.dynamicCharacters[0]?.description, "谨慎地试探你的立场");
  assert.equal(toClientRun(run).narrativeCharacters?.[0]?.name, "沈衡");
  assert.equal(run.narrative.dynamicCharacters[0]?.relationship?.stance, "friendly");
  advanceWithDynamicNarrativeScene(run, world, dynamicWorld, {
    routeId: "route.one", factionId: "court", beat: "pressure",
    narrative: "旧档牵连的人被带到堂前，你必须决定先保全谁的性命与名节。",
    participants: [],
    sceneClockMode: "hold",
    createsDecision: true
  });
  const pressureDecision = applyMilestoneDecisionAndAdvance(run, world, difficulty, "safe", {
    narrativeOutcome: { effects: [{ stat: "family", direction: "up", band: "light" }] },
    narrativeWorld: dynamicWorld,
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
    routeId: "route.two", factionId: "court", beat: "climax",
    narrative: "证词与账册终于合在一处，任何署名都会改变此后谁还能开口。",
    participants: [],
    createsDecision: true
  });
  applyMilestoneDecisionAndAdvance(run, world, difficulty, "balanced", {
    narrativeOutcome: { effects: [{ stat: "intelligence", direction: "up", band: "medium" }] },
    factResolution: "exposed",
    narrativeWorld: dynamicWorld
  });
  assert.equal(run.narrative.actRuntime?.beat, "payoff");
  assert.equal(run.story.factLedger?.facts.find((fact) => fact.id === "act.fact")?.status, "resolved");
});

test("动态三幕只各自结算一次，并在最终 payoff 后进入结局申请", () => {
  const run = createRun(
    { world, difficulty, cards: [card], tuning: createDefaultGameplayTuning(), narrativeEnabled: true },
    {
      clientId: "three-act-dynamic-world-client",
      worldId: world.id,
      difficultyId: difficulty.id,
      personaPrompt: "愿意承担旧案后果的人",
      talentPointTotal: 25,
      stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 },
      selectedCardIds: [card.id]
    }
  );
  const dynamicWorld: NarrativeWorldDefinition = {
    ...narrativeWorld,
    version: 4,
    mainlineActs: [
      { id: "act.one", label: "旧事入局", prompt: "让人物从自身处境接触被遮蔽的旧事。" },
      { id: "act.two", label: "立身周旋", prompt: "承接前幕后果，让人物进入新的阵营位置。" },
      { id: "act.three", label: "大局担当", prompt: "让积累的身份面对更大范围的危机。" }
    ],
    narrativeFactions: [{ id: "court", label: "朝局", summary: "掌握文书与人情" }],
    routeArcs: [
      { directionId: "route.one", label: "家门", summary: "从家门看见旧案", coreThreadIds: ["thread.one"] },
      { directionId: "route.two", label: "朝局", summary: "从朝局看见旧案", coreThreadIds: ["thread.two"] }
    ],
    endingBlueprints: (["good", "normal", "bad"] as const).map((polarity) => ({
      id: `route.one.${polarity}`,
      worldId: world.id,
      directionId: "route.one",
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
    beat: "setup" | "escalation" | "pressure" | "climax" | "payoff"
  ) => advanceWithDynamicNarrativeScene(run, world, dynamicWorld, {
    routeId,
    factionId: "court",
    beat,
    narrative: `这是${beat}阶段，旧案的后果迫使你作出新的承担。`,
    participants: [],
    ...(beat === "pressure" || beat === "climax" ? { createsDecision: true } : {}),
    ...(beat === "setup" || beat === "escalation" || beat === "payoff"
      ? {
          attributeOutcome: { effects: [{ stat: "intelligence" as const, direction: "up" as const, band: "light" as const }] },
          attributePolicy: growthPolicy
        }
      : {}),
    ...(beat === "payoff" ? {
      actHandoff: {
        resolvedTension: "人物已为本幕冲突作出无法撤回的处理。",
        lastingConsequence: "这次处理改变了人物在关系与局势中的位置。",
        continuation: "此前结识的人与承担的责任会进入下一幕。"
      }
    } : {})
  });
  const playAct = (setupRoute: "route.one" | "route.two", climaxRoute: "route.one" | "route.two") => {
    scene(setupRoute, "setup");
    scene(climaxRoute, "escalation");
    scene(setupRoute, "pressure");
    applyMilestoneDecisionAndAdvance(run, world, difficulty, "safe", {
      narrativeOutcome: { effects: [{ stat: "family", direction: "up", band: "light" }] },
      narrativeWorld: dynamicWorld
    });
    scene(climaxRoute, "climax");
    applyMilestoneDecisionAndAdvance(run, world, difficulty, "balanced", {
      narrativeOutcome: { effects: [{ stat: "intelligence", direction: "up", band: "medium" }] },
      factResolution: "exposed",
      narrativeWorld: dynamicWorld
    });
    scene(setupRoute, "payoff");
  };

  playAct("route.one", "route.two");
  assert.equal(run.narrative.actRuntime?.actId, "act.two");
  assert.equal(run.narrative.actRuntime?.beat, "setup");
  const handoffPlan = buildNarrativePromptPlan(run, dynamicWorld, null, "dynamic")!;
  assert.equal(handoffPlan.actHandoff?.length, 3);
  assert.ok(!handoffPlan.factDirectory?.some((fact) => fact.id.startsWith("act:act.one:")));
  const saved = JSON.parse(JSON.stringify(run)) as typeof run;
  assert.deepEqual(buildNarrativePromptPlan(saved, dynamicWorld, null, "dynamic")?.actHandoff, handoffPlan.actHandoff);
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
});

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
      survival: {
        startAge: 4,
        graceYears: 3,
        stages: [{
          id: "child",
          label: "幼年",
          ageStageIds: ["child"],
          dangerBelowPhysique: 10,
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
  assert.equal(recoveredRun.stats.physique, 15);
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


test("事实工具与提交使用同一引用合同，更新不受新建1条和touch3条限制", () => {
  const run = makeRun();
  const ids = applyNarrativeFactUpdates(run, {
    introduce: Array.from({ length: 5 }, (_, i) => ({ kind: "open_question" as const, label: "事实" + i })),
    touchFactIds: [], resolveFactIds: []
  }, { sourceEventId: "continuity:one" });
  assert.equal(ids.length, 5);
  const update = parseFactUpdates({
    touchFactIds: ids,
    progress: [{ factId: ids[0], summary: "已查明事情的来由" }],
    resolutions: ids.slice(1, 4).map((factId) => ({ factId, summary: "事情已经处理完毕" }))
  }, factUpdateContract(ids))!;
  applyNarrativeFactUpdates(run, update, { sourceEventId: "continuity:two" });
  assert.equal(run.story.factLedger!.facts.filter((fact) => fact.status === "resolved").length, 3);
  assert.equal(run.story.factLedger!.facts[0]?.progressSummary, "已查明事情的来由");
  assert.throws(() => parseFactUpdates({ resolveFactIds: ["world.fact"] }, factUpdateContract(["world.fact"])), /fact_reference/);
  assert.throws(() => parseFactUpdates({ touchFactIds: ["missing"] }, factUpdateContract(ids)), /fact_reference/);
  assert.throws(() => parseRelationshipUpdates([{ characterRef: "missing", stance: "friendly", summary: "熟识" }], []), /relationship_reference/);
  const recall = selectDynamicNarrativeContext(run, { task: "dynamic", text: "事情已经处理完毕" });
  assert.ok(recall.facts.every((fact) => !ids.slice(1, 4).includes(fact.id)));
  assert.ok(recall.resolvedFacts?.length);
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
  for (const id of ids) assert.equal(prepared.history.at(-1)!.content.includes(id), false);
  const focusedCtx = memoryTestContext(run, [ids[5]]);
  const focused = prepareNarrativeOutcomeRequest(run, world, focusedCtx, task.tool, task.prompt, { task: "background" });
  assert.deepEqual(focused.factContract.mutableIds, [ids[5]]);
  assert.ok(focused.history.at(-1)!.content.includes(ids[5]));
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
    routes: [{ id: "route.a", label: "经历", summary: "经历视角" }],
    factions: [{ id: "faction.a", label: "同伴", summary: "熟悉的人" }],
    knownCharacters: [], attributePolicy: policy, backgroundAttributePolicy: policy,
    statTiers: { intelligence: "low", charisma: "low", family: "low", fortune: "low", physique: "low" }
  });
  const prepared = prepareNarrativeOutcomeRequest(run, world, memoryTestContext(run), tools.tools, "按当前任务叙述");
  const definitions = prepared.tools.map((tool) => tool.function as { name: string; parameters: { required: string[]; properties: Record<string, { description?: string }> } });
  const scene = definitions.find((tool) => tool.name === "resolve_scene_outcome")!;
  assert.ok(scene.parameters.required.includes("actHandoff"));
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
  const text = prepared.history.at(-1)!.content;
  assert.match(text, /想做远行船工的人/);
  for (const talent of run.cards) assert.ok(text.includes(talent.name));
  assert.doesNotMatch(text, /可选身世线索/);
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
  const definition = await loadNarrativeWorldDefinition("ancient");
  assert.ok(definition);
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
      routes: [], factions: [], knownCharacters: [], backgroundAttributePolicy: policy,
      statTiers: { intelligence: "low", charisma: "low", family: "low", fortune: "low", physique: "low" }
    });
    const prepared = prepareNarrativeOutcomeRequest(run, world, memoryTestContext(run), tools.tools, "延续成长");
    const tool = prepared.tools[0].function as { parameters: { properties: { effects: { description: string; items: { properties: { stat: { enum: string[] } } } } } } };
    const schema = tool.parameters.properties.effects;
    assert.deepEqual(schema.items.properties.stat.enum, Object.keys(run.stats));
    for (const stat of focus.primaryStats) assert.ok(schema.description.includes(stat));
    assert.match(schema.description, /至少1项/);
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
  const schema = narrativeEffectsSchema(policy);
  assert.match(String(schema.description), /physique只采用正向/);
  assert.match(String(schema.description), /至少一项为正向/);
  assert.match(String(schema.description), /每个属性只出现一次/);
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
    routeId: "test.guardian", factionId: "guardian", beat: "setup", narrative: "你在新学舍认识同伴，并渐渐熟悉周围的人和事。", participants: [],
    attributeOutcome: { effects: [{ stat: "intelligence", direction: "up", band: "light" }] }, attributePolicy: dynamicSceneAttributePolicy()
  });
  advanceWithDynamicNarrativeScene(run, world, definition, {
    routeId: "test.guardian", factionId: "guardian", beat: "escalation", narrative: "同伴遇到了困难，你需要决定是否一起承担这次任务。", participants: [], createsDecision: true
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
  assert.deepEqual(renderSchema.required, ["narrative"]);
  assert.deepEqual(Object.keys(renderSchema.properties), ["narrative"]);
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
  const parsed = parseDynamicNarrativeParticipants([{
    characterRef: known[0].id, name: "陌生称谓", factionId: "school",
    relationship: { stance: "friendly", summary: "和好" }
  }], factions, known)!;
  assert.equal(parsed[0].name, "小林");
  assert.equal(parsed[0].role, "旧日同窗");
  assert.equal(parsed[0].factionId, undefined);
  assert.equal(parsed[0].description, "");
  assert.equal(parsed[0].relationship?.summary, "和好");
  assert.throws(() => parseDynamicNarrativeParticipants([{ characterRef: "character:missing" }], factions, known), NarrativeOutcomeError);
  assert.throws(() => parseDynamicNarrativeParticipants([{ characterRef: "new" }], factions, known), NarrativeOutcomeError);
  assert.equal(parseDynamicNarrativeParticipants([{
    characterRef: "new", name: "小周", factionId: "school", role: "同桌", description: "热心的同学", recurring: true
  }], factions, known)?.length, 1);
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
  assert.ok(tool.parameters.required.includes("factResolution"));
  assert.deepEqual(tool.parameters.properties.factResolution.enum, modes);
});

test("旧幕后果按历史投影，承诺可收束且不开放幕完成事实", () => {
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
  assert.ok(ctx.narrativePlan!.recall!.resolvedFacts?.some((fact) => fact.id === "act:one:consequence"));
  assert.ok(selectDynamicNarrativeContext(run, { task: "background", text: "住处" }).resolvedFacts?.some((fact) => fact.label.includes("失去了原先的住处")));
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

test("规划文脉读取世界配置，第二次召回才绑定模型选中的路线", async () => {
  for (const worldId of ["ancient", "modern", "fantasy"]) {
    const definition = await loadNarrativeWorldDefinition(worldId);
    assert.ok(definition?.mainlineActs?.length);
    const run = makeRun();
    run.worldId = definition.worldId;
    run.narrative.enabled = true;
    run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
    run.narrative.actRuntime!.beat = "climax";
    run.narrative.arcPhase = "setup";
    const testDefinition = { ...definition, lore: [
      { id: "setup-only", text: "开场知识", priority: 100, phases: ["setup" as const] },
      { id: "climax-only", text: "高潮知识", priority: 100, phases: ["climax" as const] }
    ] };
    const plan = buildNarrativePromptPlan(run, testDefinition, definition.routeArcs[0].directionId, "rendering")!;
    assert.deepEqual(plan.activeLore, []);
    assert.ok(plan.activeWorldCardSources?.some((card) => card.id.includes("consequence") || card.id.includes("payoff")));
    assert.ok(plan.routeGuidance?.includes(narrativeRouteBeatGuidance(definition.routeArcs[0], "climax")));
    assert.ok(plan.mainlineSkeleton?.includes(definition.mainlineActs![0].prompt));
    const planningPlan = buildNarrativePromptPlan(run, testDefinition, null, "planning", { backgroundAllowed: true })!;
    assert.equal(planningPlan.routeGuidance, undefined);
    assert.ok(planningPlan.mainlineSkeleton?.includes(definition.mainlineActs![0].prompt));
    for (const route of definition.routeArcs) {
      assert.equal(narrativeRouteBeatGuidance(route, "setup"), route.perspective ?? "");
      assert.equal(narrativeRouteBeatGuidance(route, "climax"), route.crisis ?? route.perspective ?? "");
    }
    run.pendingDynamicScene = {
      id: "pending", routeId: definition.routeArcs.at(-1)!.directionId,
      beat: "climax", mainlineActId: definition.mainlineActs![0].id, characterIds: []
    };
    const decisionPlan = buildNarrativePromptPlan(run, testDefinition, null, "decision")!;
    assert.ok(decisionPlan.routeGuidance?.includes(narrativeRouteBeatGuidance(definition.routeArcs.at(-1)!, "climax")));
    assert.ok(formatTaskNarrativeContext(decisionPlan).includes(definition.mainlineActs![0].prompt));
  }
});

test("三世界的幕任务归属场景工具，纯背景和混合请求保持生活任务独立", async () => {
  for (const worldId of ["ancient", "fantasy", "modern"]) {
    const definition = (await loadNarrativeWorldDefinition(worldId))!;
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
      act: currentAct, storyArc: definition.mainlineSkeleton!.premise,
      beat: "pressure", presentation: "summary", allowedTurnKinds: ["background"],
      sceneAge: 20, backgroundAgeRange: { fromAge: 20, toAge: 22 },
      routes: definition.routeArcs.map((route) => ({ id: route.directionId, label: route.label ?? route.directionId, summary: route.summary })),
      factions: definition.narrativeFactions!, knownCharacters: [], backgroundAttributePolicy: dynamicSceneAttributePolicy(),
      statTiers: { intelligence: "low", charisma: "low", family: "low", fortune: "low", physique: "low" }
    };
    for (const allowedTurnKinds of [["background"], ["background", "scene"], ["scene"]] as DynamicNarrativeSceneInput["allowedTurnKinds"][]) {
      input.allowedTurnKinds = allowedTurnKinds;
      input.presentation = allowedTurnKinds.includes("background") ? "summary" : "choice";
      const tools = dynamicNarrativeSceneTools(input);
      const ctx = memoryTestContext(run);
      const contextTask = allowedTurnKinds.length === 1 && allowedTurnKinds[0] === "background" ? "background" : "planning";
      ctx.narrativePlan = buildNarrativePromptPlan(run, definition, null, contextTask, { backgroundAllowed: allowedTurnKinds.includes("background") });
      const request = prepareNarrativeOutcomeRequest(run, world, ctx, tools.tools, dynamicNarrativeScenePrompt(input), { task: ctx.narrativePlan!.task });
      const text = request.history.at(-1)!.content;
      const routeLore = new Set(definition.lore.filter((entry) => entry.directionIds?.length).map((entry) => entry.text));
      assert.equal(text.includes(input.act.prompt), contextTask === "planning");
      assert.equal(text.includes(input.storyArc!), contextTask === "planning");
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
          assert.ok(fn.description.includes(input.act.prompt));
          assert.ok(fn.description.includes(input.storyArc!));
          assert.equal("routeId" in fn.parameters.properties, false);
        }
      }
    }
  }
});

test("已结束事件以结果召回并降权去重，直接引用与本领用途仍可唤回", () => {
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
  assert.deepEqual(recalled.resolvedFacts, [{ id: factId, label: "双方达成和解，学会御风之术" }]);
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

test("最终请求只投影一次摘要和当前任务，摘要不进入固定规则", () => {
  const run = makeRun();
  run.narrative.enabled = true;
  const ctx = memoryTestContext(run);
  const task = interruptedBackgroundTask(run, 0, []);
  prepareNarrativeOutcomeRequest(run, world, ctx, task.tool, task.prompt);
  ctx.conversation!.headMemory = "已安顿好远行的亲人";
  const prepared = prepareNarrativeOutcomeRequest(run, world, ctx, task.tool, "本轮任务标记");
  const input = prepared.history.map((entry) => entry.content).join("\n");
  assert.equal(input.split("已安顿好远行的亲人").length - 1, 1);
  assert.equal(input.split("本轮任务标记").length - 1, 1);
  assert.doesNotMatch(prepared.conversation.headCore, /已安顿好远行的亲人/);
  assert.ok(input.endsWith("本轮任务标记"));
});

test("上下文编排按来源去重并保持任务与会话投影归属", () => {
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
  assert.equal(composition.historyMessages[0]?.content, "已发生经历的摘要：此前已经离开故乡");
  assert.equal(composition.manifest.summaryThroughMemoryId, "memory:home");
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

test("规划后的渲染工具只暴露已选路线、阵营和呈现类型", async () => {
  const definition = (await loadNarrativeWorldDefinition("ancient"))!;
  const route = definition.routeArcs[1];
  const faction = definition.narrativeFactions![1];
  const input: DynamicNarrativeSceneInput = {
    plan: {
      callId: "call:one", turnKind: "scene", routeId: route.directionId, factionId: faction.id,
      focusRefs: [], sceneGoal: "让人物面对眼前局势", presentation: "scene", clockRequest: "advance"
    },
    act: definition.mainlineActs![0], beat: "setup", presentation: "scene", allowedTurnKinds: ["scene"],
    sceneAge: 16, backgroundAgeRange: { fromAge: 16, toAge: 17 },
    routes: definition.routeArcs.map((entry) => ({ id: entry.directionId, label: entry.label ?? entry.directionId, summary: entry.summary })),
    factions: definition.narrativeFactions!, knownCharacters: [],
    attributePolicy: dynamicSceneAttributePolicy(), backgroundAttributePolicy: dynamicBackgroundAttributePolicy(makeRun()),
    statTiers: { intelligence: "steady", charisma: "steady", family: "steady", fortune: "steady", physique: "steady" }
  };
  const tools = dynamicNarrativeSceneTools(input);
  assert.deepEqual(tools.names, ["resolve_scene_outcome"]);
  const fn = tools.tools[0]!.function as { parameters: { properties: Record<string, unknown> } };
  assert.equal("routeId" in fn.parameters.properties, false);
  assert.equal("factionId" in fn.parameters.properties, false);
});

test("幕间能力目录直接表达背景、场景与抉择边界", () => {
  assert.deepEqual(narrativeTurnCapabilities(true, "setup", ["background"]), ["background"]);
  assert.deepEqual(narrativeTurnCapabilities(false, "setup", ["scene"]), ["scene", "choice"]);
  assert.deepEqual(narrativeTurnCapabilities(false, "escalation", ["background", "scene"]), ["background", "scene", "choice"]);
  assert.deepEqual(narrativeTurnCapabilities(false, "pressure", ["background", "scene"]), ["background", "choice"]);
  assert.deepEqual(narrativeTurnCapabilities(false, "climax", ["scene"]), ["choice"]);
  assert.deepEqual(narrativeTurnCapabilities(false, "payoff", ["background", "scene"]), ["background", "scene"]);
});

test("规划工具目录与能力目录使用同一协议，不再暴露返回后会被拒绝的呈现", () => {
  const envelope: NarrativeTurnEnvelope = {
    callId: "turn:contract", source: "scene", worldId: "ancient", currentAge: 20, sceneAge: 21,
    backgroundAgeRange: { fromAge: 21, toAge: 22 }, act: { id: "act.one", label: "第一幕", prompt: "推进本幕" },
    beat: "payoff", capabilities: ["background", "scene"],
    routes: [{ id: "route.a", label: "经历", summary: "人物经历" }],
    factions: [{ id: "faction.a", label: "阵营", summary: "相关人物" }],
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
  assert.ok(scene.parameters.required.includes("routeId"));
  assert.ok(scene.parameters.required.includes("factionId"));
  assert.equal("presentation" in scene.parameters.properties, false);
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

test("核心摘要先取得覆盖权，附属视图可在同一批次独立提交", () => {
  const run = makeRun();
  run.narrative.enabled = true;
  for (let index = 0; index < 4; index++) {
    const sourceEventId = `scope:${index}`;
    commitNarrativeMemory(run.narrative, {
      id: `memory:${sourceEventId}`, age: index, routeId: "route.one", factionIds: [], characterIds: [], factIds: [], text: `第${index}段经历`
    });
    commitNarrativeEpisode(run, { callId: `call:${index}`, sourceEventId, turnKind: "scene", age: index, routeId: "route.one" });
  }
  const work = prepareNarrativeMemoryCuration(run)!;
  assert.equal(applyNarrativeMemoryCuration(run, work, { digests: [{
    id: "run", summary: "四段经历已经发生。", activeFactIds: [], historicalFactIds: [], characterIds: []
  }] }), true);
  assert.equal(run.narrative.memoryRevision, 1);
  assert.equal(applyNarrativeScopedMemoryCuration(run, work, { digests: [{
    id: "route:route.one", summary: "这条经历形成了连续变化。", activeFactIds: [], historicalFactIds: [], characterIds: []
  }] }), true);
  assert.equal(run.narrative.memoryRevision, 1);
  assert.equal(run.narrative.memoryDigests.find((digest) => digest.id === "route:route.one")?.coveredEpisodeIds.length, 4);
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

test("世界卡按幕、拍点和模型已选路线动态召回", async () => {
  const definition = (await loadNarrativeWorldDefinition("fantasy"))!;
  const run = makeRun();
  run.worldId = "fantasy";
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  run.narrative.actRuntime!.beat = "pressure";
  const selected = selectNarrativeWorldCards(run, definition, {
    task: "rendering",
    actId: "fantasy.growth_and_encounter",
    beat: "pressure",
    routeId: "fantasy.guardian"
  });
  assert.ok(selected.some((card) => card.id === "fantasy.conflict.first_encounter"));
  assert.ok(selected.some((card) => card.id === "fantasy.route.guardian"));
  assert.equal(selected.some((card) => card.id === "fantasy.route.ambition"), false);
  assert.equal(selected.some((card) => card.activation?.actIds?.includes("fantasy.transcendence_and_destination")), false);
});

test("世界卡会扫描当前场景文本并按选择逻辑激活", async () => {
  const definition = (await loadNarrativeWorldDefinition("fantasy"))!;
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
});

test("短程计划只因重大结果失效，上下文 Provider 保持显式顺序", () => {
  const run = makeRun();
  run.narrative.horizonPlan = {
    id: "horizon:act.one:1", actId: "act.one", revision: 1, dramaticQuestion: "人物将如何应对",
    developingTension: "关系正在变化", nearTermIntents: ["观察变化", "面对代价"], focusRefs: [],
    payoffShape: "形成阶段结果", status: "active", createdAt: 1
  };
  invalidateNarrativeHorizon(run);
  assert.equal(run.narrative.horizonPlan.status, "stale");
  assert.deepEqual(defaultNarrativeContextProviders.map((provider) => provider.id), [
    "legacy-plan", "stable-character", "story-runtime", "world-cards", "world-lore", "characters", "facts",
    "narrative-assets", "narrative-memory", "ending", "current-task"
  ]);
  const horizon = narrativeHorizonTool({
    callId: "horizon:one", worldId: "test-world", act: { id: "act.one", label: "第一幕", prompt: "展开第一幕" },
    beat: "setup", routes: [{ id: "route.one", label: "路线", summary: "一种经历视角" }],
    factions: [{ id: "faction.one", label: "阵营", summary: "一种社会立场" }], focusReferences: [],
    previousCanon: [], memoryDigests: [], nextRevision: 1
  }).function as { parameters: { properties: Record<string, unknown> } };
  assert.equal("routeId" in horizon.parameters.properties, false);
  assert.equal("allowedRouteIds" in horizon.parameters.properties, false);
  const review = narrativeProseReviewTool({
    callId: "call:one", task: "choice", ageLabel: "18岁", sceneGoal: "面对取舍", narrative: "正文", background: "抉择背景"
  }).function as { parameters: { properties: Record<string, unknown> } };
  assert.deepEqual(Object.keys(review.parameters.properties).sort(), ["background", "narrative"]);
});

test("世界卡 sticky 只延续指定提交回合且不会自我续期", async () => {
  const base = (await loadNarrativeWorldDefinition("fantasy"))!;
  const definition: NarrativeWorldDefinition = {
    ...base,
    worldCards: [{
      id: "test.sticky", kind: "setting", content: "只在雾出现时直接激活。", priority: 90,
      activation: { keys: ["雾"], tasks: ["dynamic"] }, stickyTurns: 1, cooldownTurns: 2
    }]
  };
  const run = makeRun();
  run.worldId = "fantasy";
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
  const query = { task: "dynamic" as const, actId: definition.mainlineActs![0].id, beat: "setup" as const };
  assert.deepEqual(selectNarrativeWorldCards(run, definition, { ...query, text: "山中起雾" }).map((entry) => entry.id), ["test.sticky"]);

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
  assert.equal(selectNarrativeWorldCards(run, definition, { ...query, text: "山中起雾" }).length, 0);

  for (const index of [3, 4]) {
    const sourceEventId = `cooldown:${index}`;
    commitNarrativeMemory(run.narrative, { id: `memory:${sourceEventId}`, age: index, factionIds: [], characterIds: [], factIds: [], text: "普通回合" });
    commitNarrativeEpisode(run, { callId: `call:cooldown:${index}`, sourceEventId, turnKind: "background", age: index });
  }
  assert.deepEqual(selectNarrativeWorldCards(run, definition, { ...query, text: "山中起雾" }).map((entry) => entry.id), ["test.sticky"]);
});

test("sticky 为零不延续，且 sticky 不跨越世界卡硬作用域", async () => {
  const base = (await loadNarrativeWorldDefinition("fantasy"))!;
  const firstActId = base.mainlineActs![0].id;
  const otherActId = base.mainlineActs![1].id;
  const definition: NarrativeWorldDefinition = {
    ...base,
    worldCards: [{
      id: "test.scope", kind: "setting", content: "仅属于第一幕。", priority: 90,
      activation: { keys: ["门"], actIds: [firstActId], tasks: ["dynamic"] }, stickyTurns: 0
    }]
  };
  const run = makeRun();
  run.worldId = "fantasy";
  run.narrative.enabled = true;
  run.narrative.worldCardActivations = [{ cardId: "test.scope", lastActivatedSequence: 0, stickyUntilSequence: 0, cooldownUntilSequence: 0 }];
  assert.equal(selectNarrativeWorldCards(run, definition, { task: "dynamic", actId: firstActId, beat: "setup", text: "没有关键词" }).length, 0);
  run.narrative.worldCardActivations = [{ cardId: "test.scope", lastActivatedSequence: 0, stickyUntilSequence: 2, cooldownUntilSequence: 2 }];
  assert.equal(selectNarrativeWorldCards(run, definition, { task: "dynamic", actId: otherActId, beat: "setup", text: "门" }).length, 0);
});

test("关联世界卡服从冷却、互斥组和上下文预算", async () => {
  const base = (await loadNarrativeWorldDefinition("fantasy"))!;
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
  const base = (await loadNarrativeWorldDefinition("modern"))!;
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

test("抉择上下文精确继承场景地点与本领，风格卡只在声明任务出现", async () => {
  const definition = (await loadNarrativeWorldDefinition("fantasy"))!;
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
    id: "pending", routeId: definition.routeArcs[0].directionId, beat: "pressure", mainlineActId: definition.mainlineActs![0].id,
    characterIds: [], factIds: [], locationIds: ["location:gate"], abilityIds: ["ability:seal"]
  };
  run.narrative.actRuntime!.beat = "pressure";
  const decision = buildNarrativePromptPlan(run, definition, null, "decision")!;
  assert.deepEqual(decision.recall?.assetSources?.map((entry) => entry.id).sort(), ["ability:seal", "location:gate"]);
  assert.equal(decision.activeWorldCardSources?.some((entry) => entry.id.includes(".example.")), false);
  assert.equal(buildNarrativePromptPlan(run, definition, definition.routeArcs[0].directionId, "rendering")?.activeWorldCardSources?.some((entry) => entry.id === "fantasy.example.choice"), true);
  assert.equal(buildNarrativePromptPlan(run, definition, null, "planning")?.activeWorldCardSources?.some((entry) => entry.id.includes(".example.")), false);
  assert.equal(buildNarrativePromptPlan(run, definition, null, "background")?.activeWorldCardSources?.some((entry) => entry.id === "fantasy.example.background"), true);
});
