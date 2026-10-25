import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { createDefaultGameplayTuning, type WorldConfig, type DifficultyConfig } from "@reroll/shared";
import { choiceProbability, prepareChoiceCheck, rollChoice, canOpenChoiceSurvival } from "./choice-check.js";
import { createRun, advanceWithDynamicNarrativeScene, appendPublicTurnRecord, applyMilestoneDecisionAndAdvance,
  completeMilestoneDecision, resolveTurnRecordChoice, toPublicMilestoneChoice, toClientRun,
  dynamicDecisionPolicies, openChoiceSurvivalCrisis, resolveSurvivalCrisis } from "./engine.js";
import { settleChoiceResultRecord } from "./engine.js";
import { loadNarrativeWorldDefinition } from "./content.js";
import { loadNarrativeStoryPack } from "./story-packs.js";
import { resolveNarrativeExperience } from "./narrative-experience.js";
import { ensureNarrativeActRuntime, buildNarrativePromptPlan } from "./narrative.js";
import { runNarrativeAgentDecision, finishNarrativeAgentDecision } from "./narrative/runtime.js";
import { stageNarrativeAssetRound, narrativeAssetBatchReady } from "./narrative/asset-buffer.js";
import { validateNarrativeEffects } from "./narrative-attributes.js";
import type { NarrativeContext } from "./ai.js";

const world: WorldConfig = { id: "ancient", name: "边地", intro: "边地人生", stylePrompt: "具体叙事", milestoneAges: [], endAgeRange: { min: 90, max: 90 }, yearlyEventHints: [] };
const difficulty: DifficultyConfig = { id: "test", name: "测试", yearlyVolatility: 0, growthBias: 0, riskRewardMultiplier: 1, failurePenaltyMultiplier: 1, description: "测试" };
const context: NarrativeContext = { apiKey: "mock-only", promptPack: {}, providerConfig: { provider: "openai-compatible", baseUrl: "https://example.invalid", model: "mock", apiPath: "/chat/completions", temperature: 0.7, maxTokens: 2000, timeoutMs: 1000 } };
const emptySync = { locationUpdates: [], abilityUpdates: [], identityMerges: [], relationshipUpdates: [], factIntroductions: [], factUpdates: [] };

async function fixture(beat: "pressure" | "payoff" = "pressure") {
  const base = (await loadNarrativeWorldDefinition("ancient"))!;
  const pack = (await loadNarrativeStoryPack(base, "ancient.sovereign-rise"))!;
  const definition = resolveNarrativeExperience(base, pack);
  const tuning = createDefaultGameplayTuning(); tuning.bootstrap.selectedCardMin = 0;
  const run = createRun({ world, difficulty, tuning, cards: [], narrativeEnabled: true }, {
    clientId: "choice-handoff", worldId: world.id, storyPackId: pack.id, difficultyId: difficulty.id,
    personaPrompt: "边地求生的人", talentPointTotal: 25,
    stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 }, selectedCardIds: []
  });
  run.age = 20; run.narrative = ensureNarrativeActRuntime(run.narrative, definition, 20);
  run.narrative.actRuntime!.beat = beat;
  run.narrative.opening = { status: "ready" };
  const actId = run.narrative.actRuntime!.actId;
  stageNarrativeAssetRound(run, { sourceEventId: "previous", source: "scene", age: 19, actId, subject: "巡防", narrative: "你此前在边堡巡防。" }, {
    participants: [{ characterRef: "new", name: "陈统领", recurring: true }],
    assetUpdates: { locations: [{ ref: "new", name: "永安堡", current: true }], abilities: [{ ref: "new", name: "北语听音" }] }
  }, { age: 19 });
  const background = "河桥损毁，陈统领陷在对岸，救援尚待你决定。";
  advanceWithDynamicNarrativeScene(run, world, definition, { patternIds: [], forceIds: [], beat, beatDecision: "hold",
    sceneAge: 20, sceneClockMode: "hold", narrative: background, participants: [], createsDecision: true });
  run.nextMilestoneChoice!.check = prepareChoiceCheck(run, definition);
  const choice = toPublicMilestoneChoice(run)!;
  const selected = choice.options[2];
  const record = appendPublicTurnRecord(run, { entryId: "choice-scene", kind: "scene", age: 20,
    ageStage: { label: "青年" }, narrative: background, statChanges: {} }, choice);
  stageNarrativeAssetRound(run, { sourceEventId: run.pendingDynamicScene!.id, source: "scene", age: 20, actId,
    subject: "待选", narrative: background }, { pendingChoice: true }, { age: 20 });
  return { run, definition, actId, choice, selected, record, background };
}

test("按当前幕节拍门槛检查四属性，概率与保存后的掷点保持一致", async () => {
  for (const [ratio, expected] of [[1, [.8, .55, .25]], [.5, [2 / 3, 11 / 29, 1 / 7]], [2, [8 / 9, 22 / 31, .4]]] as const) {
    [.2, .45, .75].forEach((risk, index) => assert.ok(Math.abs(choiceProbability(ratio * 20, 20, risk) - expected[index]) < 1e-12));
  }
  const { run, definition } = await fixture();
  for (const [beat, stage] of [["setup", "opening"], ["escalation", "escalation"], ["pressure", "pressure"], ["climax", "climax"], ["payoff", "climax"]] as const) {
    run.narrative.actRuntime!.beat = beat;
    const check = prepareChoiceCheck(run, definition);
    assert.ok(["family", "intelligence", "charisma", "fortune"].includes(check.stat));
    assert.equal(check.threshold, definition.progression!.actGateThresholds![0][stage]);
    assert.equal(check.value, run.stats[check.stat]);
  }
  const first = rollChoice(run, "risky");
  const restored = JSON.parse(JSON.stringify(run)) as typeof run;
  restored.history.push({ age: 20, title: "unrelated", summary: "保存恢复不改变检定", tags: [], statChanges: {} });
  assert.deepEqual(rollChoice(restored, "risky"), first);
  assert.equal(toPublicMilestoneChoice(restored)!.sceneId, toPublicMilestoneChoice(run)!.sceneId);
  assert.throws(() => rollChoice(restored, "safe"), /decision_already_selected/);
  for (const policy of Object.values(dynamicDecisionPolicies())) assert.equal(validateNarrativeEffects([], policy).ok, true);
  assert.equal(validateNarrativeEffects([{ stat: "physique", direction: "down", band: "light" }], dynamicDecisionPolicies().safe).ok, true);
});

test("结果成稿先交付；恢复不重写不重掷，结算后完整经历立即维护资产再观察", async (t) => {
  const original = await fixture();
  let run = original.run;
  const { definition, choice, selected, background, actId } = original;
  // An actual failed rescue, with retreat and a changed relationship, not a fake
  // reward for a failed roll. Profiles are maintained by the real sync parser.
  run.nextMilestoneChoice!.check!.value = 0;
  run.nextMilestoneChoice!.check!.probabilities.risky = 0;
  const roll = rollChoice(run, "risky");
  resolveTurnRecordChoice(run, choice, selected);
  assert.equal(toClientRun(run).nextMilestoneChoice, undefined);
  assert.equal(toClientRun(run).pendingChoice?.status, "selected");
  assert.equal(run.narrative.assetBuffer!.rounds.length, 1, "待选背景不计作完成经历");
  assert.equal(narrativeAssetBatchReady(run.narrative), false);
  const narrative = "救援失败，陈统领被俘。你退回永安堡，河桥彻底烧毁，只能另寻渡口。";
  const person = run.narrative.dynamicCharacters[0].id;
  const location = run.narrative.assets!.locations[0].id;
  const ability = run.narrative.assets!.abilities[0].id;
  const calls: string[] = [];
  let beforeSettlement = run.stats.charisma;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
    const name = payload.tools[0].function.name;
    calls.push(name);
    const text = payload.messages.map((message: any) => message.content).join("\n");
    let args: object;
    if (name === "render_decision_outcome") {
      assert.match(text, /引擎检定已确定.*失败/);
      args = { narrative, participants: [], assetUpdates: { locations: [], abilities: [] }, assetActivity: { locationIds: [location], abilityIds: [ability], currentLocationId: location } };
    } else if (name === "resolve_decision_outcome") {
      args = { effects: [{ stat: "charisma", direction: "down", band: "light" }] };
    } else if (name === "sync_narrative_continuity") {
      assert.equal(run.stats.charisma, beforeSettlement - 1, "同步收到的故事已完成属性结算");
      for (const textPart of [background, selected.label, narrative, "你此前在边堡巡防。", "20岁"]) assert.ok(text.includes(textPart));
      assert.equal(text.split(background).length - 1, 1);
      assert.equal(text.split(narrative).length - 1, 1);
      assert.equal(run.narrative.actRuntime!.actId, actId);
      args = { ...emptySync,
        relationshipUpdates: [{ characterRef: person, condition: "被俘", summary: "救援失败后等待再会" }],
        locationUpdates: [{ ref: location, features: [{ name: "河桥", state: "烧毁，尚未修复，不能渡河" }] }],
        abilityUpdates: [{ ref: ability, mastery: "初通" }],
        factIntroductions: [{ kind: "experience", label: "这次救援已经失败，陈统领被俘", status: "finish", sourceEventId: `${run.nextMilestoneChoice!.check!.id}:result`, characterIds: [person], locationIds: [location], abilityIds: [ability] }]
      };
    } else {
      assert.equal(name, "observe_story_beat");
      assert.equal(run.narrative.dynamicCharacters[0].condition, "被俘");
      args = { beatDecision: "hold", evidence: null, missing: "被俘同袍的处境尚未形成阶段结果" };
    }
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: name, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] };
  });
  const makeInput = () => ({ run, world, narrativeWorld: definition, context: { ...context }, callId: "complete-choice", choice,
    decision: { decision: "risky" as const, label: selected.label, description: selected.description, attributePolicy: dynamicDecisionPolicies().risky } });
  await assert.rejects(runNarrativeAgentDecision({ ...makeInput(), onRendered: () => {
    assert.equal(run.stats.charisma, beforeSettlement);
    const provisional = appendPublicTurnRecord(run, { entryId: "choice-result", kind: "choice_outcome", age: 20,
      ageStage: { label: "青年" }, narrative, statChanges: {} });
    provisional.decisionResult = { sceneId: choice.sceneId, revision: choice.revision, roll, status: "rendered" };
    run.choiceExecution!.resultTurnId = provisional.turnId;
    throw new Error("simulate-interruption-after-prose");
  } }), /simulate-interruption/);
  assert.deepEqual(calls, ["render_decision_outcome"]);
  run = JSON.parse(JSON.stringify(run)) as typeof run;
  const result = await runNarrativeAgentDecision(makeInput());
  assert.deepEqual(run.choiceExecution!.roll, roll);
  assert.deepEqual(calls, ["render_decision_outcome", "resolve_decision_outcome"]);
  // A saved old policy must not reinstate the former mandatory positive gain
  // after the settlement tool has already accepted the current risk policy.
  run.pendingDirectedDecisionPolicy!.risky = { ...dynamicDecisionPolicies().risky, requirePositive: true };
  const settled = applyMilestoneDecisionAndAdvance(run, world, difficulty, "risky", { narrative: result.outcome.narrative,
    narrativeOutcome: result.outcome, narrativeWorld: definition, deferCompletion: true });
  const historyLength = run.history.length;
  applyMilestoneDecisionAndAdvance(run, world, difficulty, "risky", { narrativeOutcome: result.outcome, deferCompletion: true });
  assert.equal(run.history.length, historyLength);
  assert.equal(run.stats.charisma, beforeSettlement - 1);
  const finish = () => finishNarrativeAgentDecision({ ...makeInput(), attemptId: result.attemptId, outcome: run.choiceExecution!.outcome! });
  const observation = await finish();
  assert.deepEqual(calls, ["render_decision_outcome", "resolve_decision_outcome", "sync_narrative_continuity", "observe_story_beat"]);
  await finish();
  assert.equal(calls.filter((name) => name === "sync_narrative_continuity").length, 1);
  const resultTurn = run.turnRecords.find((record) => record.turnId === run.choiceExecution!.resultTurnId)!;
  completeMilestoneDecision(run, settled.decisionEvent, settled.sourceEventId, settled.factIds, { narrativeWorld: definition, beatDecision: observation.decision });
  settleChoiceResultRecord(run, resultTurn, settled.decisionEvent);
  assert.equal(run.turnRecords[0].narrativeCharactersSnapshot![0].condition, undefined, "抉择前快照仍是当时状态");
  assert.equal(run.choiceExecution, undefined);
  assert.equal(run.nextMilestoneChoice, undefined);
  assert.equal(run.narrative.assetBuffer, undefined);
  assert.equal(run.story.factLedger!.facts.find((fact) => fact.label.includes("这次救援"))!.status, "resolved");
  const restored = JSON.parse(JSON.stringify(run)) as typeof run;
  const next = buildNarrativePromptPlan(restored, definition, null, "rendering", { focusIds: [person, location, ability] })!;
  assert.ok(JSON.stringify(next).includes("烧毁，尚未修复，不能渡河"));
  assert.equal(toClientRun(restored).narrativeCharacters![0].condition, "被俘");
});

test("仅冒险失败且核查属性低于半门槛才开放实际险境，求生沿用当前事故并优先于payoff", async () => {
  const { run, definition } = await fixture("payoff");
  const check = run.nextMilestoneChoice!.check!;
  check.value = 0; check.probabilities.risky = 0;
  const roll = rollChoice(run, "risky");
  assert.equal(canOpenChoiceSurvival(check, roll), true);
  assert.equal(canOpenChoiceSurvival({ ...check, value: check.threshold / 2 }, roll), false);
  assert.equal(canOpenChoiceSurvival(check, { ...roll, success: true }), false);
  assert.equal(canOpenChoiceSurvival(check, { ...roll, decision: "balanced" }), false);
  const settled = applyMilestoneDecisionAndAdvance(run, world, difficulty, "risky", { narrative: "强渡失败，落水重伤。",
    narrativeOutcome: { effects: [] }, narrativeWorld: definition, deferCompletion: true });
  openChoiceSurvivalCrisis(run, "河桥断裂，落水重伤", "强渡失败，落水重伤。", "强渡救人");
  assert.equal(run.survival.lowPhysiqueYears, 0, "事故不借用多年低体魄的慢性入口");
  assert.equal(toClientRun(run).survivalCrisis, undefined, "完整事件未收尾前不开放下一项操作");
  completeMilestoneDecision(run, settled.decisionEvent, settled.sourceEventId, settled.factIds, { narrativeWorld: definition, beatDecision: "advance" });
  assert.equal(run.narrative.actRuntime!.beat, "payoff");
  assert.equal(run.narrative.payoffCount, 0);
  assert.match(toClientRun(run).survivalCrisis!.summary, /河桥断裂/);
  run.stats.intelligence = 100;
  const recovery = resolveSurvivalCrisis(run, definition, "self_rescue", run.survivalCrisis!.id);
  assert.equal(recovery.recovered, true);
  assert.match(recovery.event.summary, /强渡救人.*河桥断裂/);
  assert.doesNotMatch(recovery.event.summary, /病势|久病/);
});
