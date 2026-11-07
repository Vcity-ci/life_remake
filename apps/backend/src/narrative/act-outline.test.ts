import assert from "node:assert/strict";
import { hostingFixture } from "./hosting-fixture.js";
import test from "node:test";
import type { NarrativeWorldDefinition } from "@reroll/shared";
import { parseNarrativeActObservation } from "../ai.js";
import { advanceNarrativeAct, createNarrativeRunState, ensureNarrativeActRuntime, ensureNarrativeRunState } from "../narrative.js";
import { parseNarrativeActWorldCard, commitNarrativeActOutline, formatNarrativeActOutline } from "./act-outline.js";
const world: NarrativeWorldDefinition = { version: 10, worldId: "ancient", storyBible: "边防", threads: [], characters: [], lore: [], eventBindings: [], endingBlueprints: [],
  mainlineActs: [{ id: "frontier", label: "守边", prompt: "守边" }, { id: "capital", label: "入京", prompt: "入京" }] };
const standards = { objective: "守住边疆", closureMeaning: "外敌入侵已有实际结果" };
test("模型具象化结构化主持资料，目的和收束含义保持 IF 原值", () => {
  const card = parseNarrativeActWorldCard(hostingFixture("敌军逼近关门"), "frontier", standards);
  assert.equal(card.objective, standards.objective); assert.equal(card.closureMeaning, standards.closureMeaning);
  assert.throws(() => parseNarrativeActWorldCard({}, "frontier", standards), /narrative_act_outline_invalid/);
  assert.throws(() => parseNarrativeActWorldCard({ ...hostingFixture("敌军逼近关门"), objective: "改写 IF 目的" }, "frontier", standards), /narrative_act_outline_invalid/);
  assert.throws(() => parseNarrativeActWorldCard({ ...hostingFixture("敌军逼近关门"), closureMeaning: "另立收束标准" }, "frontier", standards), /narrative_act_outline_invalid/);
  assert.doesNotMatch(formatNarrativeActOutline(card), /外敌入侵已有实际结果/);
  assert.match(formatNarrativeActOutline(card, true), /外敌入侵已有实际结果/);
});
test("幕卡不可反复改写，保存恢复保留整幕卡，换幕清理旧卡", () => {
  const state = ensureNarrativeActRuntime(createNarrativeRunState(true), world, 12);
  const card = parseNarrativeActWorldCard(hostingFixture("敌军逼近关门"), "frontier", standards);
  commitNarrativeActOutline(state, card); commitNarrativeActOutline(state, { ...card, situation: "另写局势", revision: 2 });
  const restored = ensureNarrativeRunState(JSON.parse(JSON.stringify(state)), true, 20);
  assert.deepEqual(restored.actRuntime?.outline, card); assert.equal(restored.actRuntime?.beat, undefined);
  const next = advanceNarrativeAct(restored, world, 20).state;
  assert.equal(next.actRuntime?.actId, "capital"); assert.equal(next.actRuntime?.outline, undefined);
});
test("幕初只引用已供应规则，原文随幕卡保存且不被模型改写", () => {
  const rule = { id: "world.rule", title: "军职", text: "第一段。\n\n第二段原文。" };
  const card = parseNarrativeActWorldCard({ ...hostingFixture("关城局势"), worldRuleRefs: [rule.id, rule.id] }, "frontier", standards, [rule]);
  assert.deepEqual(card.worldRules, [rule]);
  rule.text = "配置后来修改";
  assert.equal(card.worldRules![0].text, "第一段。\n\n第二段原文。");
  const state = ensureNarrativeActRuntime(createNarrativeRunState(true), world, 12);
  commitNarrativeActOutline(state, card);
  const restored = ensureNarrativeRunState(JSON.parse(JSON.stringify(state)), true, 12);
  assert.deepEqual(restored.actRuntime!.outline!.worldRules, card.worldRules);
  assert.equal(formatNarrativeActOutline(card).split(card.worldRules![0].text).length - 1, 1);
  assert.throws(() => parseNarrativeActWorldCard({ ...hostingFixture("关城局势"), worldRuleRefs: ["unavailable"] }, "frontier", standards, [rule]), /world_rule_reference_invalid/);
});
test("整幕观察没有 missing 反馈，收束必须给出实际结果依据", () => {
  const ongoing = parseNarrativeActObservation({ decision: "ongoing", evidence: null }, "frontier", "scene:one");
  assert.equal(ongoing.decision, "ongoing"); assert.equal(Object.hasOwn(ongoing, "missing"), false);
  const closed = parseNarrativeActObservation({ decision: "act_closed", evidence: "敌军撤退，边境重开" }, "frontier", "scene:two");
  assert.equal(closed.sourceEventId, "scene:two");
  assert.throws(() => parseNarrativeActObservation({ decision: "act_closed", evidence: null }, "frontier", "scene:two"));
});
