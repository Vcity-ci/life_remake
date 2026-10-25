import assert from "node:assert/strict";
import test from "node:test";
import type { NarrativeActOutline, NarrativeWorldDefinition } from "@reroll/shared";
import { parseNarrativeBeatObservation, narrativeTurnPlanningPrompt } from "../ai.js";
import { narrativeObservationGap } from "./observation.js";
import type { NarrativeTurnEnvelope } from "./turn.js";
import { advanceNarrativeActBeat, createNarrativeRunState, ensureNarrativeActRuntime, ensureNarrativeRunState } from "../narrative.js";
import {
  parseNarrativeActWorldCard,
  commitNarrativeActOutline,
  formatNarrativeActOutline,
  NARRATIVE_ACT_OUTLINE_BEATS
} from "./act-outline.js";

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
    change: stories[index], props: ["守军", "入侵敌军"], timeframe: null
  }]));
  return parseNarrativeActWorldCard({ background: "边军与沿旧道入侵的敌军相持，百姓面临迁离。", beats }, "frontier");
}

test("同一份故事大纲经保存恢复和节拍推进保留，没有重复任务副本", () => {
  const state = ensureNarrativeActRuntime(createNarrativeRunState(true), world, 12);
  const outline = firstOutline();
  commitNarrativeActOutline(state, outline);
  const restored = ensureNarrativeRunState(JSON.parse(JSON.stringify(state)), true, 12);
  assert.deepEqual(restored.actRuntime?.outline, outline);
  assert.equal(Object.hasOwn(restored.actRuntime!, "stageTask"), false);
  const advanced = advanceNarrativeActBeat(restored, world, 13).state;
  assert.equal(advanced.actRuntime?.beat, "escalation");
  assert.deepEqual(advanced.actRuntime?.outline, outline);
});

test("换幕不继承旧规划，正文看到的是当前及未来故事而非已发生事实", () => {
  const state = ensureNarrativeActRuntime(createNarrativeRunState(true), world, 12);
  const outline = firstOutline();
  commitNarrativeActOutline(state, outline);
  state.actRuntime!.beat = "payoff";
  const next = advanceNarrativeActBeat(state, world, 20).state;
  assert.equal(next.actRuntime?.actId, "capital");
  assert.equal(next.actRuntime?.outline, undefined);
  const text = formatNarrativeActOutline(outline, "pressure");
  assert.ok(!text.includes(outline.beats.setup.change));
  assert.match(text, /实际经历与玩家决定是当前处境/);
  assert.match(text, /pressure【当前阶段】/);
  assert.match(text, /climax【未发生阶段】/);
});

test("年龄安排保存在大纲中，不代替属性准入或自动完成阶段", () => {
  const state = ensureNarrativeActRuntime(createNarrativeRunState(true), world, 16);
  const outline = firstOutline();
  outline.beats.setup.timeframe = { fromAge: 16, toAge: 20 };
  commitNarrativeActOutline(state, outline);
  const restored = ensureNarrativeRunState(JSON.parse(JSON.stringify(state)), true, 40);
  assert.equal(ensureNarrativeActRuntime(restored, world, 40).actRuntime?.beat, "setup");
  assert.deepEqual(restored.actRuntime?.outline?.beats.setup.timeframe, { fromAge: 16, toAge: 20 });
});

test("未落实改变经保存恢复交给同拍召回，推进后退出且不污染其他幕拍", () => {
  const state = ensureNarrativeActRuntime(createNarrativeRunState(true), world, 20);
  commitNarrativeActOutline(state, firstOutline());
  const missing = "村民尚未得知撤离安排";
  state.lastBeatObservation = parseNarrativeBeatObservation({ beatDecision: "hold", evidence: null, missing }, "frontier", "setup");
  const restored = ensureNarrativeRunState(JSON.parse(JSON.stringify(state)), true, 20);
  const run = { narrative: restored } as Parameters<typeof narrativeObservationGap>[0];
  assert.equal(narrativeObservationGap(run, "frontier", "setup"), missing);
  assert.equal(narrativeObservationGap(run, "frontier", "escalation"), undefined);
  assert.equal(narrativeObservationGap(run, "capital", "setup"), undefined);
  const input = { act: world.mainlineActs![0], beat: "setup", actOutline: restored.actRuntime!.outline,
    currentAge: 20, focusReferences: [], socialForces: [], progressGap: narrativeObservationGap(run, "frontier", "setup") } as unknown as NarrativeTurnEnvelope;
  assert.ok(narrativeTurnPlanningPrompt(input).includes(missing));
  const advanced = advanceNarrativeActBeat(restored, world, 20).state;
  assert.equal(advanced.lastBeatObservation, undefined);
  assert.equal(advanced.actRuntime?.beat, "escalation");
});
