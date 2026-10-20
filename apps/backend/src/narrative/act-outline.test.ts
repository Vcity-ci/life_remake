import assert from "node:assert/strict";
import test from "node:test";
import type { NarrativeActOutline, NarrativeWorldDefinition } from "@reroll/shared";
import { advanceNarrativeActBeat, createNarrativeRunState, ensureNarrativeActRuntime, ensureNarrativeRunState } from "../narrative.js";
import {
  applyNarrativeActOutlineUpdate,
  commitNarrativeActOutline,
  formatNarrativeActOutline,
  markNarrativeActOutlineForRevision,
  NARRATIVE_ACT_OUTLINE_BEATS
} from "./act-outline.js";
import { commitNarrativeStageTask, consumeNarrativeStageFork } from "./stage-task.js";

const world: NarrativeWorldDefinition = {
  version: 10,
  worldId: "ancient",
  storyBible: "边军正在面对外敌入侵。",
  styleRules: [],
  mainlineActs: [
    { id: "frontier", label: "守边", prompt: "击退敌军并决定战后去向。" },
    { id: "capital", label: "入京", prompt: "带着守边所得面对朝局。" }
  ],
  threads: [],
  characters: [],
  lore: [],
  eventBindings: [],
  endingBlueprints: []
};

function firstOutline(): NarrativeActOutline {
  const stories = ["发现敌军沿旧道逼近。", "组织村民撤离并建立哨线。", "援兵未至，守军必须决定守城还是突围。", "按照已选战略应对敌军主攻。", "战果落实，交代幸存者与部队的去向。"];
  const beats = Object.fromEntries(NARRATIVE_ACT_OUTLINE_BEATS.map((beat, index) => [beat, {
    story: stories[index],
    goal: `完成${stories[index]}`,
    completionMeaning: `已经形成可继续发展的结果：${stories[index]}`,
    fork: beat === "pressure" ? { question: "守城还是突围？", stakes: "百姓与部队将承担不同的风险。", openingSituation: "敌军主力将至而援兵未到。" } : null
  }]));
  return applyNarrativeActOutlineUpdate(undefined, { beats }, { actId: "frontier", beat: "setup" });
}

test("具体大纲在保存恢复及节拍推进后保留，当前任务始终来自对应节点", () => {
  const state = ensureNarrativeActRuntime(createNarrativeRunState(true), world, 12);
  const outline = firstOutline();
  commitNarrativeActOutline(state, outline);
  commitNarrativeStageTask(state, { actId: "frontier", beat: "setup" }, { goal: "无关的局部目标", completionMeaning: "局部完成" });
  assert.equal(state.actRuntime?.stageTask?.goal, outline.beats.setup.goal);

  const restored = ensureNarrativeRunState(JSON.parse(JSON.stringify(state)), true, 12);
  assert.deepEqual(restored.actRuntime?.outline, outline);
  const advanced = advanceNarrativeActBeat(restored, world, 13).state;
  assert.equal(advanced.actRuntime?.beat, "escalation");
  assert.equal(advanced.actRuntime?.outline?.revision, 1);
  assert.equal(advanced.actRuntime?.stageTask?.goal, outline.beats.escalation.goal);
  assert.equal(advanced.actRuntime?.stageTask?.fork, undefined);
  assert.deepEqual(applyNarrativeActOutlineUpdate(outline, null, { actId: "frontier", beat: "escalation" }), outline);
});

test("选择结果落定后只修订尚未发生的剧情，并在成功交接后清除待修订状态", () => {
  const state = ensureNarrativeActRuntime(createNarrativeRunState(true), world, 12);
  const outline = firstOutline();
  commitNarrativeActOutline(state, outline);
  state.actRuntime!.beat = "pressure";
  state.actRuntime!.stageTask = structuredClone(outline.beats.pressure);
  consumeNarrativeStageFork(state, { actId: "frontier", beat: "pressure" });
  markNarrativeActOutlineForRevision(state, "frontier");
  const restored = ensureNarrativeRunState(JSON.parse(JSON.stringify(state)), true, 14);
  assert.equal(restored.actRuntime?.outlineNeedsRevision, true);
  assert.equal(restored.actRuntime?.stageTask?.fork, undefined, "恢复不能重新投影已经回答的分歧窗口");
  assert.equal(restored.actRuntime?.outline?.beats.pressure.fork, undefined);
  assert.equal(restored.actRuntime?.stageTask?.goal, outline.beats.pressure.goal, "只消费分歧，不删除阶段目标");
  assert.throws(() => applyNarrativeActOutlineUpdate(outline, null, { actId: "frontier", beat: "pressure", requiresRevision: true }), /revision_required/);

  const revised = applyNarrativeActOutlineUpdate(outline, { beats: {
    pressure: { story: "主角已决定带百姓突围，部队开始撤离。", goal: "完成突围部署", completionMeaning: "撤离队列与掩护职责已经落实", fork: null },
    climax: { story: "以骑兵引开敌军，保护撤离队列。", goal: "护送百姓脱离追兵", completionMeaning: "撤离结果与实际代价落定", fork: null }
  } }, { actId: "frontier", beat: "pressure", requiresRevision: true });
  assert.deepEqual(revised.beats.setup, outline.beats.setup);
  assert.deepEqual(revised.beats.escalation, outline.beats.escalation);
  assert.equal(revised.beats.pressure.fork, undefined);
  commitNarrativeActOutline(restored, revised);
  assert.equal(restored.actRuntime?.outlineNeedsRevision, false);
  assert.equal(restored.actRuntime?.stageTask?.goal, "完成突围部署");
  assert.equal(restored.actRuntime?.outline?.revision, 2);
  assert.throws(() => applyNarrativeActOutlineUpdate(revised, { beats: { setup: outline.beats.setup } }, { actId: "frontier", beat: "pressure", requiresRevision: true }), /completed_beat_update/);
});

test("进入新幕时不继承旧幕规划，提示文本明确区分规划与实际历史", () => {
  const state = ensureNarrativeActRuntime(createNarrativeRunState(true), world, 12);
  const outline = firstOutline();
  commitNarrativeActOutline(state, outline);
  state.actRuntime!.beat = "payoff";
  markNarrativeActOutlineForRevision(state, "frontier");
  const next = advanceNarrativeActBeat(state, world, 20).state;
  assert.equal(next.actRuntime?.actId, "capital");
  assert.equal(next.actRuntime?.outline, undefined);
  assert.equal(next.actRuntime?.outlineNeedsRevision, undefined);
  assert.equal(next.actRuntime?.stageTask, undefined);
  const text = formatNarrativeActOutline(outline, "pressure");
  assert.match(text, /规划意图，不是已发生事实/);
  assert.match(text, /已过阶段，仅供理解因果；实际经过以历史为准/);
  assert.match(text, /pressure【当前阶段】/);
  assert.match(text, /climax【未发生阶段】/);
});
