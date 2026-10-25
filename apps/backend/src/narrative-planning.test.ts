import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultGameplayTuning, type DifficultyConfig, type WorldConfig } from "@reroll/shared";
import { narrativeTurnPlanTools, parseNarrativeTurnPlan, narrativeTurnPlanningPrompt } from "./ai.js";
import { loadNarrativeWorldDefinition } from "./content.js";
import { createRun } from "./engine.js";
import { loadNarrativeStoryPack } from "./story-packs.js";
import { resolveNarrativeExperience } from "./narrative-experience.js";
import { buildNarrativePromptPlan, ensureNarrativeActRuntime } from "./narrative.js";
import { composeNarrativeContext } from "./narrative/context/orchestrator.js";
import {
  commitNarrativeActOutline, parseNarrativeActWorldCard,
  formatNarrativeActOutline, formatNarrativeActStory, NARRATIVE_ACT_OUTLINE_BEATS
} from "./narrative/act-outline.js";
import { commitNarrativeEpisode } from "./narrative/commit.js";
import { commitNarrativeMemory } from "./narrative-memory.js";
import { narrativeTurnKindsForReadiness, type NarrativeTurnEnvelope } from "./narrative/turn.js";

function envelope(): NarrativeTurnEnvelope {
  return {
    callId: "planning-handoff", source: "scene", worldId: "ancient", currentAge: 20,
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
    change: `阶段改变-${beat}`, props: ["同袍", "敌军"], timeframe: null
  }]));
}

function rawPlan() {
  return { beatChange: "承担侦察责任", timeScope: "同年完成一次紧迫侦察", note: "", conflictRefs: [], abilityRefs: [{ ref: "ability:riding", purpose: "借骑术追踪敌军" }], assetNeeds: [], forceIds: [],
    locationDirective: { mode: "stay" }, clockRequest: "hold" };
}

test("幕初只组织世界卡，幕内工具只交接选材和时间，普通年沿用卡", () => {
  const input = envelope();
  const first = narrativeTurnPlanTools(input)[0].function as { parameters: { required: string[]; properties: Record<string, unknown> } };
  assert.deepEqual(first.parameters.required, ["actWorldCard"]);
  const outline = parseNarrativeActWorldCard({ background: "边境军营正遭敌军袭扰。", beats: nodes() }, input.act.id);
  const current = { ...input, actOutline: outline };
  const tool = narrativeTurnPlanTools(current)[0].function as typeof first;
  assert.equal(Object.hasOwn(tool.parameters.properties, "outlineUpdate"), false);
  assert.equal(Object.hasOwn(tool.parameters.properties, "decisionBrief"), false);
  const plan = parseNarrativeTurnPlan(rawPlan(), "plan_scene_turn", current);
  assert.deepEqual(plan.actOutline, outline);
  assert.deepEqual(plan.abilityRefs, ["ability:riding"]);
  assert.deepEqual(narrativeTurnPlanTools({ ...current, source: "background", capabilities: ["background"] }), []);
  assert.equal(narrativeTurnPlanTools({ ...input, source: "background", capabilities: ["background"] }).length, 1, "普通年也只在缺失时建立本幕背景");
});

test("年龄安排只作故事参考，场景准入仍由已有属性规则决定", () => {
  const beats = nodes();
  const outline = parseNarrativeActWorldCard({ background: "边军立足。", beats: { ...beats, setup: { ...beats.setup, timeframe: { fromAge: 20, toAge: 24 } } } }, "act.one");
  assert.match(formatNarrativeActOutline(outline, "setup"), /计划年龄：20—24岁/);
  const plan = parseNarrativeTurnPlan(rawPlan(), "plan_scene_turn", { ...envelope(), currentAge: 26, actOutline: outline });
  assert.deepEqual(plan.actOutline, outline);
  assert.deepEqual(narrativeTurnKindsForReadiness(false, true), ["scene"]);
  assert.deepEqual(narrativeTurnKindsForReadiness(false, false), ["background"]);
});

test("三个世界的幕初材料实际包含 IF 压力方向，后续召回不再次携带静态 IF", async (t) => {
  for (const [worldId, packId] of [
    ["ancient", "ancient.frontier-commander"], ["fantasy", "fantasy.sect-ascendant"], ["modern", "modern.career-maker"]
  ]) await t.test(worldId, async () => {
    const base = (await loadNarrativeWorldDefinition(worldId))!;
    const pack = (await loadNarrativeStoryPack(base, packId))!;
    assert.ok(base && pack);
    const experience = resolveNarrativeExperience(base, pack);
    const world: WorldConfig = { id: worldId, name: worldId, intro: "测试", stylePrompt: "具体叙事", milestoneAges: [], endAgeRange: { min: 90, max: 90 }, yearlyEventHints: [] };
    const difficulty: DifficultyConfig = { id: "test", name: "测试", yearlyVolatility: 0, growthBias: 0, riskRewardMultiplier: 1, failurePenaltyMultiplier: 1, description: "测试" };
    const tuning = createDefaultGameplayTuning(); tuning.bootstrap.selectedCardMin = 0;
    const run = createRun({ world, difficulty, cards: [], tuning }, { clientId: "world-card", worldId, storyPackId: packId, difficultyId: "test", personaPrompt: "本线人物",
      talentPointTotal: 25, stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 }, selectedCardIds: [] });
    run.narrative.enabled = true;
    run.narrative = ensureNarrativeActRuntime(run.narrative, experience, run.age);
    const act = experience.mainlineActs![0];
    const input = { ...envelope(), worldId, act, currentAge: run.age };
    const initial = composeNarrativeContext({ plan: buildNarrativePromptPlan(run, experience, null, "planning"), task: "planning", taskPrompt: narrativeTurnPlanningPrompt(input) });
    assert.ok(initial.renderedContext.includes(pack.acts[0].pressureDirection));
    for (const beat of NARRATIVE_ACT_OUTLINE_BEATS) assert.ok(initial.renderedContext.includes(pack.acts[0].beatOutline[beat]));
    const outline = parseNarrativeActWorldCard({ background: "本局已经选定的具体冲突", beats: nodes() }, act.id);
    commitNarrativeActOutline(run.narrative, outline);
    const plan = buildNarrativePromptPlan(run, experience, null, "planning");
    const recall = composeNarrativeContext({ plan, task: "planning", planningPurpose: "execute", taskPrompt: narrativeTurnPlanningPrompt({ ...input, actOutline: outline }, plan) });
    assert.equal(recall.renderedContext.split(outline.background).length - 1, 1);
    assert.equal(recall.renderedContext.includes(pack.acts[0].pressureDirection), false);
  });
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
  assert.ok(initialRequest.renderedContext.includes(pack.acts[0].pressureDirection), "IF 压力方向进入幕初材料");
  for (const beat of NARRATIVE_ACT_OUTLINE_BEATS) assert.ok(initialRequest.renderedContext.includes(pack.acts[0].beatOutline[beat]), `规划器看到原IF的${beat}要求`);
  const parsed = { actOutline: parseNarrativeActWorldCard({ background: "边军立足之后将卷入军中阵营与外敌的战争。", beats: nodes() }, act.id) };
  const beforeAssets = structuredClone(run.narrative.assets);
  const beforeCharacters = structuredClone(run.narrative.dynamicCharacters);
  commitNarrativeActOutline(run.narrative, parsed.actOutline!);
  assert.deepEqual(run.narrative.assets, beforeAssets, "世界卡安排的未来对象不提前成为主角资产");
  assert.deepEqual(run.narrative.dynamicCharacters, beforeCharacters);
  run.narrative.actRuntime!.beat = "pressure";
  const delta = "选择救援使同袍生还，敌军已脱离追踪，军中开始追问延误的责任。";
  commitNarrativeMemory(run.narrative, { id: "memory:choice:rescue", age: run.age, text: delta, factionIds: [], characterIds: [], factIds: [] });
  commitNarrativeEpisode(run, { callId: "chosen", sourceEventId: "choice:rescue", turnKind: "decision", age: run.age,
    actId: act.id, beat: "pressure" });
  const outlineText = formatNarrativeActStory(parsed.actOutline, "pressure");
  for (const task of ["rendering", "decision"] as const) {
    const plan = buildNarrativePromptPlan(run, experience, null, task);
    assert.ok(plan);
    const request = composeNarrativeContext({ plan, task, taskPrompt: "承接已经提交的救援结果" });
    assert.equal(request.renderedContext.split(outlineText).length - 1, 1, `${task}只传递一份本局具体大纲`);
    assert.equal(request.renderedContext.split(delta).length - 1, 1, `${task}实际后果独立传递一次`);
    assert.equal(request.manifest.fragments.filter((entry) => entry.section === "route").length, 1);
    assert.ok(plan.routeGuidance?.includes("实际经历与玩家决定是当前处境"));
    assert.ok(plan.routeGuidance?.includes("climax【未发生阶段】"));
    assert.ok(!plan.routeGuidance?.includes(parsed.actOutline!.beats.setup.change));
    assert.ok(!plan.routeGuidance?.includes(parsed.actOutline!.beats.escalation.change));
    assert.ok(request.manifest.fragments.some((entry) => entry.section === "storyHistory" && entry.content.includes(delta)), "实际历史不靠未来大纲代替");
    assert.equal(request.renderedContext.includes(pack.acts[0].objective), false);
    assert.equal(request.renderedContext.includes(pack.acts[0].beatOutline.pressure), false);
  }
  const executionEnvelope = { ...firstEnvelope, beat: "pressure" as const, actOutline: parsed.actOutline, recentChanges: [delta] };
  const executionPlan = buildNarrativePromptPlan(run, experience, null, "planning");
  assert.ok(executionPlan?.storyHistory);
  executionPlan.storyHistory.summary = { id: "run", text: "0—19岁：在边镇成长并加入斥候队。", coveredEpisodeIds: [] };
  const executionRequest = composeNarrativeContext({ plan: executionPlan, task: "planning", planningPurpose: "execute", taskPrompt: narrativeTurnPlanningPrompt(executionEnvelope, executionPlan) });
  assert.ok(executionRequest.renderedContext.includes(parsed.actOutline!.beats.pressure.change));
  assert.equal(executionRequest.renderedContext.split(delta).length - 1, 1);
  assert.equal(executionRequest.renderedContext.includes(pack.acts[0].beatOutline.climax), false);
  assert.equal(executionRequest.renderedContext.split(executionPlan.storyHistory.summary.text).length - 1, 1, "幕内召回沿用已压缩的经历背景，不再回放旧幕原文");
  const background = buildNarrativePromptPlan(run, experience, null, "background");
  const backgroundRequest = composeNarrativeContext({ plan: background, task: "background", taskPrompt: "叙述日常生活与成长" });
  assert.equal(backgroundRequest.renderedContext.split(outlineText).length - 1, 1, "普通年沿用同一本幕背景，平静生活不会丢失世界");
  assert.equal(backgroundRequest.renderedContext.includes(experience.worldCore!.identity), false);
  assert.equal(backgroundRequest.renderedContext.includes(experience.storyBible), false);
  assert.equal(backgroundRequest.renderedContext.split(parsed.actOutline!.background).length - 1, 1);

  const force = experience.socialForces![0];
  const knowledge = executionPlan.activeWorldCardSources!.find((card) => card.contextRole === "knowledge");
  assert.ok(knowledge);
  const selectedMaterials = buildNarrativePromptPlan(run, experience, null, "rendering", {
    factionIds: [force.id], focusIds: [knowledge.id], worldCardCandidates: executionPlan.activeWorldCardSources
  })!;
  const writer = composeNarrativeContext({ plan: selectedMaterials, task: "rendering", taskPrompt: "继续本幕" });
  assert.match(initialRequest.stableContext, /世界常量（故事成立的规律，用于组织本幕世界卡）/);
  assert.match(initialRequest.stableContext, /故事起点的世界局势（用于选定本幕冲突；当前现状以已发生经历为准）/);
  assert.match(writer.stableContext, /本幕故事背景（幕初局势与发展方向，实际变化以已发生经历为准）/);
  assert.match(writer.activeContext, /相关世界知识（势力背景与行动参考）/);
  assert.ok(writer.activeContext.includes(force.label) && writer.activeContext.includes(force.summary));
  assert.ok(force.methods.every((method) => writer.activeContext.includes(method)));
  assert.ok(writer.activeContext.includes(knowledge.text));
  if (knowledge.title) assert.ok(writer.activeContext.includes(knowledge.title));
  assert.deepEqual(writer.manifest.fragments.filter((entry) => entry.sourceType === "social-force").map((entry) => entry.sourceIds[0]), [`force:${force.id}`]);
  assert.equal(writer.renderedContext.includes(experience.storyBible), false);
  assert.equal(writer.renderedContext.includes(pack.acts[0].beatOutline.pressure), false);
  run.pendingDynamicScene = { id: "choice:materials", mainlineActId: act.id, beat: "pressure", patternIds: [],
    forceIds: [force.id], worldCardIds: [knowledge.id] };
  const restored = JSON.parse(JSON.stringify(run)) as typeof run;
  const answer = composeNarrativeContext({ plan: buildNarrativePromptPlan(restored, experience, null, "decision"), task: "decision", taskPrompt: "落实已选行动" });
  assert.ok(answer.activeContext.includes(force.summary));
  assert.ok(answer.activeContext.includes(knowledge.text));
  assert.deepEqual(answer.manifest.fragments.filter((entry) => entry.sourceType === "social-force").map((entry) => entry.sourceIds[0]), [`force:${force.id}`]);
});
