import assert from "node:assert/strict";
import { hostingFixture } from "./narrative/hosting-fixture.js";
import test from "node:test";
import { createDefaultGameplayTuning, type WorldConfig, type DifficultyConfig } from "@reroll/shared";
import { narrativeTurnPlanTools, parseNarrativeTurnPlan, narrativeTurnPlanningPrompt } from "./ai.js";
import { loadNarrativeWorldDefinition } from "./content.js";
import { createRun } from "./engine.js";
import { loadNarrativeStoryPack } from "./story-packs.js";
import { resolveNarrativeExperience } from "./narrative-experience.js";
import { buildNarrativePromptPlan, ensureNarrativeActRuntime } from "./narrative.js";
import { composeNarrativeContext } from "./narrative/context/orchestrator.js";
import { commitNarrativeActOutline, parseNarrativeActWorldCard } from "./narrative/act-outline.js";
import type { NarrativeTurnEnvelope } from "./narrative/turn.js";
function envelope(): NarrativeTurnEnvelope {
  return { callId: "recall", source: "scene", worldId: "ancient", currentAge: 20, sceneAge: 21,
    backgroundAgeRange: { fromAge: 21, toAge: 21 }, act: { id: "act.one", label: "守边", prompt: "守边" },
    capabilities: ["scene", "choice"], storyPatterns: [], socialForces: [{ id: "ancient.outlands", label: "塞外", summary: "外部力量", methods: [] }],
    focusReferences: [{ id: "ability:riding", kind: "ability", label: "骑术" }, { id: "location:camp", kind: "location", label: "营地" }],
    statTiers: { intelligence: "low", charisma: "low", family: "low", fortune: "low", physique: "low" },
    clock: { mode: "advance", sameAgeTurnCount: 0, maxSameAgeTurns: 3 } };
}
test("幕初与召回使用固定独立工具，统一引用按目录真实类型分流", () => {
  const first = narrativeTurnPlanTools(envelope())[0].function as any;
  assert.equal(first.name, "plan_act_world_card"); assert.deepEqual(first.parameters.required, ["situation", "actors", "locations", "pressures", "stakes", "worldRuleRefs"]);
  const card = parseNarrativeActWorldCard(hostingFixture("边疆敌情"), "act.one", { objective: "守边", closureMeaning: "危机落定" });
  const input = { ...envelope(), actOutline: card };
  const recall = narrativeTurnPlanTools(input)[0].function as any;
  assert.equal(recall.name, "recall_scene_assets"); assert.deepEqual(Object.keys(recall.parameters.properties), ["recallRefs"]);
  const parsed = parseNarrativeTurnPlan({ recallRefs: [
    "ancient.outlands", "ability:riding", "location:camp"
  ] }, "recall_scene_assets", input);
  assert.deepEqual(parsed.forceIds, ["ancient.outlands"]); assert.deepEqual(parsed.abilityRefs, ["ability:riding"]); assert.deepEqual(parsed.locationRefs, ["location:camp"]);
  assert.deepEqual(parseNarrativeTurnPlan({ recallRefs: [] }, "recall_scene_assets", input).recallRefs, []);
  assert.throws(() => parseNarrativeTurnPlan({ recallRefs: [{ ref: "other-world", purpose: "未知对象" }] }, "recall_scene_assets", input));
});
test("三个题材按职责供应同一幕卡，召回不带收束判据和逐拍任务", async (t) => {
  for (const [worldId, packId] of [["ancient", "ancient.frontier-commander"], ["fantasy", "fantasy.sect-ascendant"], ["modern", "modern.career-maker"]]) await t.test(worldId, async () => {
    const base = (await loadNarrativeWorldDefinition(worldId))!, pack = (await loadNarrativeStoryPack(base, packId))!;
    const definition = resolveNarrativeExperience(base, pack);
    const world: WorldConfig = { id: worldId, name: worldId, intro: "测试", milestoneAges: [], endAgeRange: { min: 90, max: 90 }, yearlyEventHints: [] };
    const difficulty: DifficultyConfig = { id: "test", name: "测试", yearlyVolatility: 0, growthBias: 0, riskRewardMultiplier: 1, failurePenaltyMultiplier: 1, description: "测试" };
    const tuning = createDefaultGameplayTuning(); tuning.bootstrap.selectedCardMin = 0;
    const run = createRun({ world, difficulty, cards: [], tuning, narrativeEnabled: true, storyPack: pack }, { clientId: "planning", worldId, storyPackId: packId, difficultyId: "test", personaPrompt: "测试人物", talentPointTotal: 25, stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 }, selectedCardIds: [] });
    run.narrative = ensureNarrativeActRuntime(run.narrative, definition, run.age);
    const act = definition.mainlineActs![0], card = parseNarrativeActWorldCard(hostingFixture("本局唯一具体背景"), act.id, { objective: pack.acts[0].objective, closureMeaning: pack.acts[0].payoffMeaning });
    commitNarrativeActOutline(run.narrative, card);
    for (const task of ["planning", "rendering", "decision", "observation"] as const) {
      const plan = buildNarrativePromptPlan(run, definition, null, task)!;
      const result = composeNarrativeContext({ plan, task, planningPurpose: task === "planning" ? "execute" : undefined, taskPrompt: "本轮输入" });
      assert.equal(result.renderedContext.split(card.situation).length - 1, 1, task);
      assert.equal(result.renderedContext.includes(card.closureMeaning), task === "observation", task);
    }
    assert.doesNotMatch(narrativeTurnPlanningPrompt({ ...envelope(), act, actOutline: card }), /beatChange|clockRequest|locationDirective|progressGap|下一拍/);
  });
});
