import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultGameplayTuning } from "@reroll/shared";
import type { BackgroundCard, DifficultyConfig, EventDefinition, ItemDefinition, NarrativeWorldDefinition, StoryDirectionDefinition, WorldConfig } from "@reroll/shared";
import {
  advanceWithDirectedEvent,
  applyDirectedClosureRequest,
  applyDirectedMilestonePresentation,
  appendPublicTurnRecord,
  approveNarrativeAttributeOutcome,
  applyMilestoneDecisionAndAdvance,
  autoAdvanceToCheckpoint,
  buildDirectedEventCandidates,
  selectDirectedCandidateForIntent,
  createDirectedMilestoneChoice,
  createRun,
  ensureVisibleTurnRecords,
  settleNarrativeBackgroundOutcomes,
  toPublicTimelineEntryFromEvent,
  toClientRun
} from "./engine.js";
import { assessClosureReadiness, ensureNarrativeRunState, getNarrativeRouteProgress, refreshNarrativeMainlineCompletion } from "./narrative.js";
import { loadEventDefinitions, loadNarrativeWorldDefinition } from "./content.js";

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
    attributeOutcome: { effects: [{ stat: "intelligence", direction: "up", band: "light" }] }
  });
  const escalation = candidateFor("escalation");
  assert.equal(escalation?.kind, "normal");
  advanceWithDirectedEvent(run, world, escalation!, "你逐渐察觉到证词彼此抵触。", undefined, undefined, pacedWorld, {
    attributeOutcome: { effects: [{ stat: "intelligence", direction: "up", band: "light" }] }
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
    attributeOutcome: { effects: [{ stat: "intelligence", direction: "up", band: "light" }] }
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
          ? { effects: [{ stat: "intelligence", direction: "up", band: "light" }] }
          : undefined,
        completeMainlineAct: candidate?.definition.narrativeBeat === "payoff"
      });
      run.nextMilestoneChoice = undefined;
    }
    assert.ok(run.narrative.completedScenes.some((scene) => scene.mainlineActId === actId));
    if (actId !== "reckoning") {
      assert.equal(getNarrativeRouteProgress(run.narrative, direction.id), undefined);
      assert.equal(getNarrativeRouteProgress(run.narrative, parallelDirection.id)?.phase, "setup");
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

test("古代世界包的具体素材均有可用情境层与世界主线事实", async () => {
  const [definitions, ancientWorld] = await Promise.all([
    loadEventDefinitions("ancient"),
    loadNarrativeWorldDefinition("ancient")
  ]);
  assert.ok(ancientWorld);
  const archetypeIds = new Set(ancientWorld.sceneArchetypes?.map((item) => item.id));
  assert.ok(ancientWorld.mainlineFacts && ancientWorld.mainlineFacts.length >= 3);
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

test("古代世界可在初始年份以普通叙事接触旧案，六条路线均可由状态机选材", async () => {
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
    assert.equal(selected?.definition.narrativeBeat, "setup", `${route.directionId} 缺少初始年份的开场承接`);
    assert.equal(selected?.kind, "normal", `${route.directionId} 的旧案接触不应成为早期抉择`);
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
  }]), true);
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
