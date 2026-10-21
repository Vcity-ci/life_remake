import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultGameplayTuning, type DifficultyConfig, type WorldConfig } from "@reroll/shared";
import { narrativeTurnPlanTools, parseNarrativeTurnPlan, narrativeTurnPlanningPrompt, NarrativeOutcomeError } from "./ai.js";
import { loadNarrativeWorldDefinition } from "./content.js";
import { createRun } from "./engine.js";
import { loadNarrativeStoryPack } from "./story-packs.js";
import { resolveNarrativeExperience } from "./narrative-experience.js";
import { buildNarrativePromptPlan, ensureNarrativeActRuntime } from "./narrative.js";
import { composeNarrativeContext } from "./narrative/context/orchestrator.js";
import {
  commitNarrativeActOutline, markNarrativeActOutlineForRevision,
  formatNarrativeActOutline, NARRATIVE_ACT_OUTLINE_BEATS
} from "./narrative/act-outline.js";
import { commitNarrativeEpisode } from "./narrative/commit.js";
import { commitNarrativeMemory } from "./narrative-memory.js";
import { narrativeTurnKindsForReadiness, type NarrativeTurnEnvelope } from "./narrative/turn.js";

function envelope(): NarrativeTurnEnvelope {
  return {
    callId: "planning-handoff", source: "scene", worldId: "ancient", currentAge: 20, sceneAge: 20,
    backgroundAgeRange: { fromAge: 21, toAge: 21 }, act: { id: "act.one", label: "军中立足", prompt: "在边境冲突中立足" },
    beat: "setup", capabilities: ["scene", "choice"], storyPatterns: [], socialForces: [],
    focusReferences: [
      { id: "ability:riding", kind: "ability", label: "骑术" },
      { id: "ability:scouting", kind: "ability", label: "侦察" },
      { id: "location:camp", kind: "location", label: "军营" }
    ],
    currentLocationId: "location:camp",
    statTiers: { intelligence: "low", charisma: "low", family: "low", fortune: "low", physique: "low" },
    clock: { mode: "hold", sameAgeTurnCount: 0, maxSameAgeTurns: 3 }
  };
}

function nodes() {
  return Object.fromEntries(NARRATIVE_ACT_OUTLINE_BEATS.map((beat) => [beat, {
    story: `具体剧情-${beat}`, goal: `节点目标-${beat}`, completionMeaning: `实际结果-${beat}`,
    fork: beat === "pressure" ? { question: "先救同袍还是追击？", stakes: "同袍和军情的去向不同", openingSituation: "追击途中发现同袍被困" } : null
  }]));
}

function rawPlan(outlineUpdate: unknown) {
  return {
    outlineUpdate, conflictRefs: [], abilityRefs: ["ability:riding"], forceIds: [],
    locationDirective: { mode: "stay" }, sceneGoal: "抵达渡口，完成此段护送", clockRequest: "hold"
  };
}

function outlineSchema(input: NarrativeTurnEnvelope) {
  const tool = narrativeTurnPlanTools(input).find((entry) => (entry.function as { name: string }).name === "plan_scene_turn")!;
  const definition = tool.function as {
    parameters: { properties: { outlineUpdate: { anyOf: Array<{ type: string; properties?: { beats: { required?: string[]; properties: Record<string, unknown> } } }> } } }
  };
  return definition.parameters.properties.outlineUpdate;
}

function beatsSchema(input: NarrativeTurnEnvelope) {
  return outlineSchema(input).anyOf.find((entry) => entry.type === "object")!.properties!.beats;
}

test("完整幕间故事首次建立、普通回合沿用、选择落地后只修订未完成节点", () => {
  const initialEnvelope = envelope();
  const toolNames = narrativeTurnPlanTools(initialEnvelope).map((entry) => (entry.function as { name: string }).name);
  assert.deepEqual(toolNames, ["plan_scene_turn"]);
  assert.deepEqual(narrativeTurnPlanTools({ ...initialEnvelope, source: "background", capabilities: ["background"] }), []);
  assert.equal(outlineSchema(initialEnvelope).anyOf.some((entry) => entry.type === "null"), false);
  assert.deepEqual(beatsSchema(initialEnvelope).required, NARRATIVE_ACT_OUTLINE_BEATS);
  const initial = parseNarrativeTurnPlan(rawPlan({ beats: nodes() }), "plan_scene_turn", initialEnvelope);
  assert.equal(initial.actOutline?.revision, 1);
  assert.equal(initial.stageTask?.goal, initial.actOutline?.beats.setup.goal);
  const nextEnvelope = { ...initialEnvelope, beat: "pressure" as const, actOutline: initial.actOutline };
  assert.equal(outlineSchema(nextEnvelope), undefined);
  assert.equal(outlineSchema({ ...nextEnvelope, outlineNeedsRevision: true }).anyOf.some((entry) => entry.type === "null"), false);
  const reused = parseNarrativeTurnPlan({ ...rawPlan(null), abilityRefs: ["ability:scouting"], sceneGoal: "探明追兵位置后归营", clockRequest: "advance" }, "plan_scene_turn", nextEnvelope);
  assert.deepEqual(reused.actOutline, initial.actOutline);
  assert.deepEqual(reused.abilityRefs, ["ability:scouting"]);
  assert.equal(reused.clockRequest, "advance");
  assert.equal(reused.sceneGoal, initial.actOutline!.beats.pressure.story);
  assert.deepEqual(reused.stageTask, {
    goal: "节点目标-pressure", completionMeaning: "实际结果-pressure",
    fork: { question: "先救同袍还是追击？", stakes: "同袍和军情的去向不同", openingSituation: "追击途中发现同袍被困" }
  });
  assert.equal(reused.decisionBrief, undefined, "阶段分歧不提前变成本轮已经到达的问题");
  assert.deepEqual(Object.keys(beatsSchema({ ...nextEnvelope, outlineNeedsRevision: true }).properties), ["pressure", "climax", "payoff"]);
  assert.throws(() => parseNarrativeTurnPlan(rawPlan({ beats: nodes() }), "plan_scene_turn", nextEnvelope),
    (error: unknown) => error instanceof NarrativeOutcomeError && error.validation?.rule === "narrative_act_outline_invalid:outline_update_not_requested",
    "正常执行的工具与解析都不接受重写大纲");
  const state = { actRuntime: { actId: nextEnvelope.act.id, beat: "pressure", outline: reused.actOutline } } as Parameters<typeof markNarrativeActOutlineForRevision>[0];
  markNarrativeActOutlineForRevision(state, nextEnvelope.act.id);
  assert.equal(state.actRuntime?.outlineNeedsRevision, true);
  const updated = parseNarrativeTurnPlan(rawPlan({ beats: {
    pressure: { story: "玩家已经救回同袍，放走追兵；接下来承担军令后果", goal: "让救援结果改变军中处境", completionMeaning: "军令后果已经落定", fork: null },
    payoff: { story: "带着失去敌踪的代价保住同袍并重新归营", goal: "形成救援之后的归属", completionMeaning: "人物得到明确任用或处分", fork: null }
  } }), "plan_scene_turn", { ...nextEnvelope, outlineNeedsRevision: state.actRuntime!.outlineNeedsRevision });
  assert.equal(updated.actOutline?.revision, 2);
  assert.deepEqual(updated.actOutline?.beats.setup, initial.actOutline?.beats.setup);
  assert.deepEqual(updated.actOutline?.beats.escalation, initial.actOutline?.beats.escalation);
  assert.deepEqual(updated.actOutline?.beats.climax, initial.actOutline?.beats.climax);
  assert.equal(updated.stageTask?.fork, undefined);
  assert.equal(updated.stageTask?.goal, "让救援结果改变军中处境");
  commitNarrativeActOutline(state, updated.actOutline!);
  assert.equal(state.actRuntime?.outlineNeedsRevision, false);
  assert.deepEqual(state.actRuntime?.stageTask, updated.stageTask);
});

test("准入结果唯一决定正文形式，早年或属性未达标时不开放剧情规划", () => {
  assert.deepEqual(narrativeTurnKindsForReadiness(false, true), ["scene"]);
  assert.deepEqual(narrativeTurnKindsForReadiness(false, false), ["background"]);
  assert.deepEqual(narrativeTurnKindsForReadiness(true, true), ["background"]);
  assert.deepEqual(narrativeTurnKindsForReadiness(true, false), ["background"]);
});

test("规划工具的可修订年龄安排经解析传入正文，沿用执行不重写时间", () => {
  const input = envelope();
  const schema = beatsSchema(input).properties.setup as { required: string[]; properties: Record<string, unknown> };
  assert.ok(schema.required.includes("timeframe"));
  assert.ok(schema.properties.timeframe);
  const beats = nodes();
  beats.setup = { ...beats.setup, timeframe: { fromAge: 20, toAge: 24 } } as typeof beats.setup;
  const parsed = parseNarrativeTurnPlan(rawPlan({ beats }), "plan_scene_turn", input);
  assert.deepEqual(parsed.stageTask?.timeframe, { fromAge: 20, toAge: 24 });
  assert.ok(formatNarrativeActOutline(parsed.actOutline, "setup").includes("计划年龄：20—24岁"));
  const later = { ...input, currentAge: 26, actOutline: parsed.actOutline };
  const execution = parseNarrativeTurnPlan(rawPlan(null), "plan_scene_turn", later);
  assert.deepEqual(execution.actOutline, parsed.actOutline);
  assert.deepEqual(execution.stageTask?.timeframe, { fromAge: 20, toAge: 24 });
});

test("真实边将路线经规划大纲、正文和结果请求传递，未来故事与实际历史分开且不重复", async () => {
  const base = await loadNarrativeWorldDefinition("ancient");
  assert.ok(base);
  const pack = await loadNarrativeStoryPack(base, "ancient.frontier-commander");
  assert.ok(pack);
  const experience = resolveNarrativeExperience(base, pack);
  const world: WorldConfig = {
    id: "ancient", name: "古代王朝", intro: "边将路线", stylePrompt: "具体叙事", milestoneAges: [18],
    endAgeRange: { min: 90, max: 90 }, yearlyEventHints: [], ageThresholds: [{ id: "youth", label: "青年", min: 0, max: 120 }]
  };
  const difficulty: DifficultyConfig = { id: "test", name: "测试", yearlyVolatility: 0, growthBias: 0, riskRewardMultiplier: 1, failurePenaltyMultiplier: 1, description: "测试" };
  const tuning = createDefaultGameplayTuning();
  tuning.bootstrap.selectedCardMin = 0;
  const run = createRun({ world, difficulty, cards: [], tuning }, {
    clientId: "planning-client", worldId: "ancient", storyPackId: pack.id, difficultyId: "test", personaPrompt: "想保护同袍的边军斥候",
    talentPointTotal: 25, stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 }, selectedCardIds: []
  });
  run.age = 20;
  run.narrative.enabled = true;
  run.narrative = ensureNarrativeActRuntime(run.narrative, experience, run.age);
  const act = experience.mainlineActs![0];
  const firstEnvelope = { ...envelope(), act };
  const initialPlan = buildNarrativePromptPlan(run, experience, null, "planning");
  const initialRequest = composeNarrativeContext({ plan: initialPlan, task: "planning", taskPrompt: narrativeTurnPlanningPrompt(firstEnvelope) });
  assert.ok(initialRequest.renderedContext.includes(pack.routePromise));
  for (const beat of NARRATIVE_ACT_OUTLINE_BEATS) assert.ok(initialRequest.renderedContext.includes(pack.acts[0].beatOutline[beat]), `规划器看到原IF的${beat}要求`);
  const parsed = parseNarrativeTurnPlan(rawPlan({ beats: nodes() }), "plan_scene_turn", firstEnvelope);
  commitNarrativeActOutline(run.narrative, parsed.actOutline!);
  run.narrative.actRuntime!.beat = "pressure";
  const delta = "选择救援使同袍生还，敌军已脱离追踪，军中开始追问延误的责任。";
  commitNarrativeMemory(run.narrative, { id: "memory:choice:rescue", age: run.age, text: delta, factionIds: [], characterIds: [], factIds: [] });
  commitNarrativeEpisode(run, { callId: "chosen", sourceEventId: "choice:rescue", turnKind: "decision", age: run.age,
    actId: act.id, beat: "pressure" });
  markNarrativeActOutlineForRevision(run.narrative, act.id);
  const outlineText = formatNarrativeActOutline(parsed.actOutline, "pressure");
  for (const task of ["planning", "rendering", "decision"] as const) {
    const plan = buildNarrativePromptPlan(run, experience, null, task);
    assert.ok(plan);
    const request = composeNarrativeContext({ plan, task, taskPrompt: "承接已经提交的救援结果" });
    assert.equal(request.renderedContext.split(outlineText).length - 1, 1, `${task}只传递一份本局具体大纲`);
    assert.equal(request.renderedContext.split(delta).length - 1, 1, `${task}实际后果独立传递一次`);
    assert.equal(request.manifest.fragments.filter((entry) => entry.section === "route").length, 1);
    assert.ok(plan.routeGuidance?.includes("均为规划意图，不是已发生事实"));
    assert.ok(plan.routeGuidance?.includes("climax【未发生阶段】"));
    assert.ok(!plan.routeGuidance?.includes(parsed.actOutline!.beats.setup.story));
    assert.ok(!plan.routeGuidance?.includes(parsed.actOutline!.beats.escalation.story));
    assert.ok(request.manifest.fragments.some((entry) => entry.section === "storyHistory" && entry.content.includes(delta)), "实际历史不靠未来大纲代替");
    if (task !== "planning") {
      assert.equal(request.renderedContext.split(pack.acts[0].objective).length - 1, 1, "正文能看到一次原 IF 本幕职责");
      assert.ok(request.renderedContext.includes(`当前 IF 节拍职责（pressure）：${pack.acts[0].beatOutline.pressure}`));
    } else {
      assert.ok(request.renderedContext.includes("本次修订依据：玩家选择已产生的实际结果"));
      assert.ok(request.renderedContext.includes("最新已提交处境"));
      assert.ok(plan.routeGuidance?.includes("未结束阶段的 IF 职责"));
      assert.ok(!plan.routeGuidance?.includes("本幕完整发展大纲"));
    }
  }
  const revisedEnvelope = { ...firstEnvelope, beat: "pressure" as const, actOutline: parsed.actOutline, outlineNeedsRevision: true };
  const revised = parseNarrativeTurnPlan(rawPlan({ beats: { pressure: {
    story: "面对延误追击的军令后果，依救援实际战果争取新的任用。", goal: "落实军中任用或处分", completionMeaning: "救援之后的军中位置已落定", fork: null
  } } }), "plan_scene_turn", revisedEnvelope);
  commitNarrativeActOutline(run.narrative, revised.actOutline!);
  const executionEnvelope = { ...revisedEnvelope, actOutline: revised.actOutline, outlineNeedsRevision: false };
  const executionPlan = buildNarrativePromptPlan(run, experience, null, "planning");
  const executionRequest = composeNarrativeContext({ plan: executionPlan, task: "planning", taskPrompt: narrativeTurnPlanningPrompt(executionEnvelope) });
  assert.equal(outlineSchema(executionEnvelope), undefined);
  assert.ok(executionRequest.renderedContext.includes(revised.actOutline!.beats.pressure.story));
  assert.ok(!executionPlan?.routeGuidance?.includes("未结束阶段的 IF 职责"));
  assert.ok(!executionPlan?.routeGuidance?.includes(pack.acts[0].beatOutline.climax));
  assert.equal(executionPlan?.storyHistory?.revisionOutcomeId, undefined);
  assert.equal(executionRequest.renderedContext.split(delta).length - 1, 1);
  const background = buildNarrativePromptPlan(run, experience, null, "background");
  assert.equal(background?.routeGuidance, undefined);
  const backgroundRequest = composeNarrativeContext({ plan: background, task: "background", taskPrompt: "叙述日常生活与成长" });
  assert.equal(backgroundRequest.renderedContext.includes(outlineText), false, "普通年不再执行已保存的整幕大纲");
});
