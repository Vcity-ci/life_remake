import assert from "node:assert/strict";
import test from "node:test";
import { narrativeTaskContract } from "./narrative/task-contracts.js";
import OpenAI from "openai";
import { createDefaultGameplayTuning, type DifficultyConfig, type WorldConfig } from "@reroll/shared";
import {
  dynamicNarrativeRenderTools, dynamicNarrativeSceneTools, dynamicNarrativeRenderPrompt,
  generateDynamicNarrativeScene, parseDynamicNarrativeProse, NarrativeOutcomeError,
  type DynamicNarrativeSceneInput, type NarrativeContext
} from "./ai.js";
import { createRun, dynamicSceneAttributePolicy } from "./engine.js";
import type { NarrativeTurnPlan } from "./narrative/turn.js";

function sceneInput(presentation: "scene" | "choice" | "summary" = "scene"): DynamicNarrativeSceneInput {
  const policy = dynamicSceneAttributePolicy();
  return {
    presentation, act: { id: "act.one", label: "第一幕", prompt: "护送失散同袍归营" }, beat: "payoff",
    allowedTurnKinds: presentation === "summary" ? ["background"] : ["scene"], sceneAge: 20, backgroundAgeRange: { fromAge: 20, toAge: 21 },
    storyPatterns: [], socialForces: [], knownCharacters: [], attributePolicy: policy, backgroundAttributePolicy: policy,
    statTiers: { intelligence: "low", charisma: "low", family: "low", fortune: "low", physique: "low" }
  };
}

function plan(presentation: "scene" | "choice" = "scene"): NarrativeTurnPlan {
  return {
    callId: "writer-test", turnKind: "scene", presentation, patternIds: [], forceIds: [], conflictRefs: [],
    abilityRefs: ["ability:horsemanship"], locationDirective: { mode: "stay" },  clockRequest: "hold",
    decisionBrief: { question: "旧规划中的问题", stakes: "旧规划中的影响" },
    materials: [{ id: "ability:horsemanship", kind: "ability", label: "骑术" }]
  };
}

function choiceRaw(): Record<string, unknown> {
  return {
    narrative: "渡船只能再载一人。负伤同袍靠着桥柱，追兵的火光已照上河岸。你还没有登船。",
    storyDelta: "抵达渡口，载重不足与追兵逼近形成取舍。",
    decisionBrief: { question: "如何带同袍渡河？", stakes: "同袍的生死和归营时机将因此改变。" },
    background: "船夫等你决定如何安排有限的渡船。",
    optionOverrides: [
      { id: "safe", label: "先送同袍", description: "让渡船先载伤员，自己寻找掩护。", abilityRefs: [], locationDirective: { mode: "stay" } },
      { id: "balanced", label: "骑马绕行", description: "扶伤员上马，返回旧渡口。", abilityRefs: ["ability:horsemanship"], locationDirective: { mode: "revisit", locationRef: "location:old-ferry" } },
      { id: "risky", label: "抢渡浅滩", description: "带伤员寻找尚未探明的浅滩。", abilityRefs: [], locationDirective: { mode: "move", purpose: "寻找能够涉渡的浅滩" } }
    ]
  };
}

test("场景工具同时开放自然结果与实际抉择，普通年份保持独立工具", () => {
  for (const presentation of ["scene", "choice"] as const) {
    const tools = dynamicNarrativeRenderTools(sceneInput(presentation));
    assert.deepEqual(tools.names, ["render_scene_prose", "render_choice_prose"]);
    const choice = tools.tools[1].function as { parameters: { required: string[]; properties: Record<string, unknown> } };
    assert.ok(choice.parameters.required.includes("decisionBrief"));
    assert.ok(choice.parameters.required.includes("optionOverrides"));
    assert.ok(dynamicNarrativeSceneTools(sceneInput(presentation)).names.includes("resolve_scene_outcome"), "实际普通正文可以结算，不受原规划形式阻断");
  }
  assert.deepEqual(dynamicNarrativeRenderTools(sceneInput("summary")).names, ["render_background_prose"]);
  const prompt = dynamicNarrativeRenderPrompt({ ...sceneInput(), plan: plan() }, 20);
  assert.match(prompt, /本次叙述年龄：20岁/);
  assert.match(prompt, /本段与上段同年/);
  const nextYear = dynamicNarrativeRenderPrompt({ ...sceneInput(), sceneAge: 21 }, 20);
  assert.match(nextYear, /本段已进入下一岁/);
  assert.match(nextYear, /交代上段处境经过这段时间如何延续或变化/);
  const backgroundPrompt = dynamicNarrativeRenderPrompt(sceneInput("summary"), 19);
  assert.match(backgroundPrompt, /20-21岁/);
  assert.match(backgroundPrompt, /日常生活与积累，允许平静/);
  assert.match(backgroundPrompt, /已有处境怎样随时间延续或变化/);
  assert.doesNotMatch(backgroundPrompt, /五节拍具体故事|当前执行节拍/);
});

test("正文新分歧以实际工具和问题为准，保留选项本领与目的地引用规则", () => {
  const parsed = parseDynamicNarrativeProse(choiceRaw(), "render_choice_prose", plan("scene"), ["location:old-ferry"]);
  assert.equal(parsed.createsDecision, true);
  assert.deepEqual(parsed.decisionBrief, choiceRaw().decisionBrief);
  assert.notEqual(parsed.decisionBrief?.question, plan().decisionBrief?.question);
  assert.deepEqual(parsed.milestoneCopy?.optionOverrides?.[1].abilityRefs, ["ability:horsemanship"]);
  assert.equal(parsed.milestoneCopy?.optionOverrides?.[1].locationDirective?.locationRef, "location:old-ferry");
  assert.throws(() => parseDynamicNarrativeProse(choiceRaw(), "render_choice_prose", { ...plan(), materials: [], abilityRefs: [] }, ["location:old-ferry"]),
    (error: unknown) => error instanceof NarrativeOutcomeError && error.validation?.rule === "choice_ability_reference_invalid");
});

test("规划预期抉择但正文已有自然结果时，不继承过期问题或选项", () => {
  const parsed = parseDynamicNarrativeProse({ narrative: "同袍已被巡船接回营中，你向船夫道谢，独自沿岸归营。", storyDelta: "巡船接回伤员，护送已有结果。" }, "render_scene_prose", plan("choice"));
  assert.equal(parsed.createsDecision, false);
  assert.equal(parsed.decisionBrief, undefined);
  assert.equal(parsed.milestoneCopy, undefined);
});

test("抉择缺少实际问题时不以旧规划补造，交回原请求纠正", () => {
  const raw = choiceRaw();
  delete raw.decisionBrief;
  assert.throws(() => parseDynamicNarrativeProse(raw, "render_choice_prose", plan("choice"), ["location:old-ferry"]),
    (error: unknown) => error instanceof NarrativeOutcomeError && error.validation?.path === "decisionBrief.question");
});

test("原场景请求可返回payoff新抉择，正式生成结果保留待选而不结算", async (t) => {
  const world: WorldConfig = {
    id: "writer-world", name: "渡口世界", intro: "同袍返营", stylePrompt: "具体叙事", milestoneAges: [18],
    endAgeRange: { min: 90, max: 90 }, yearlyEventHints: [],
    ageThresholds: [{ id: "youth", label: "青年", min: 0, max: 120 }]
  };
  const difficulty: DifficultyConfig = { id: "test", name: "测试", yearlyVolatility: 0, growthBias: 0, riskRewardMultiplier: 1, failurePenaltyMultiplier: 1, description: "测试" };
  const tuning = createDefaultGameplayTuning();
  tuning.bootstrap.selectedCardMin = 0;
  const run = createRun({ world, difficulty, cards: [], tuning }, {
    clientId: "writer-client", worldId: world.id, storyPackId: "writer-route", difficultyId: difficulty.id,
    personaPrompt: "军中斥候", talentPointTotal: 25, stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 }, selectedCardIds: []
  });
  const input = { ...sceneInput(), plan: { ...plan(), materials: [], abilityRefs: [] } };
  const context: NarrativeContext = {
    apiKey: "mock-only", promptPack: {},
    providerConfig: { provider: "openai-compatible", baseUrl: "https://example.invalid", model: "unused", apiPath: "/chat/completions", temperature: 0.7, maxTokens: 2000, timeoutMs: 1000 }
  };
  let calls = 0;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { tools: Array<{ function: { name: string } }>; tool_choice: string }) => {
    calls++;
    assert.deepEqual(payload.tools.map((tool) => tool.function.name), ["render_scene_prose", "render_choice_prose"]);
    assert.equal(payload.tool_choice, "required");
    const raw = choiceRaw();
    raw.optionOverrides = (raw.optionOverrides as Array<Record<string, unknown>>).map((option) => ({ ...option, abilityRefs: [], locationDirective: { mode: "stay" } }));
    Object.assign(raw, { participants: [], assetUpdates: { locations: [], abilities: [] }, factUpdates: { introduce: [], updates: [] },
      continuityRefs: { factIds: [], characterIds: [], locationIds: [], abilityIds: [] }, assetActivity: { locationIds: [], abilityIds: [] }, continuityRequired: false });
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "new-fork", type: "function", function: { name: "render_choice_prose", arguments: JSON.stringify(raw) } }] } }] };
  });
  const result = await generateDynamicNarrativeScene(run, world, input, context);
  assert.equal(calls, 1);
  assert.equal(result.createsDecision, true);
  assert.equal(result.decisionBrief?.question, "如何带同袍渡河？");
  assert.equal(result.milestoneCopy?.optionOverrides?.length, 3);
  assert.equal(result.attributeEffects, undefined);
  assert.equal(result.beatDecision, undefined, "正文提出抉择不替观察器完成payoff");
});
