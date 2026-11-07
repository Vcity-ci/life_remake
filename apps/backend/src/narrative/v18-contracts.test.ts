import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { createDefaultGameplayTuning, type WorldConfig, type DifficultyConfig } from "@reroll/shared";
import { createRun, applyNarrativeFactUpdates, applyNarrativeRelationshipUpdates, advanceWithDynamicNarrativeScene,
  finalizeNarrativeActEvent, applyDirectedClosureRequest, canRequestDirectedClosure } from "../engine.js";
import { loadNarrativeWorldDefinition } from "../content.js";
import { loadNarrativeStoryPack } from "../story-packs.js";
import { resolveNarrativeExperience } from "../narrative-experience.js";
import { ensureNarrativeActRuntime, ensureNarrativeRunState, buildNarrativePromptPlan, assessEnding } from "../narrative.js";
import { parseNarrativeActObservation, observeNarrativeAct, generateDynamicNarrativeScene, type DynamicNarrativeSceneInput, type NarrativeContext } from "../ai.js";
import { applyNarrativeAssetUpdates } from "../narrative-assets.js";
import { narrativeContinuityFacts } from "../narrative-continuity.js";
import { stageNarrativeAssetRound } from "./asset-buffer.js";
import { applyNarrativeAssetBatch, synchronizeNarrativeAssetBatch } from "./runtime.js";
import { finishPendingNarrativeActEvent } from "./finalization.js";
import { commitNarrativeActOutline, parseNarrativeActWorldCard } from "./act-outline.js";
import { hostingFixture } from "./hosting-fixture.js";
import { dynamicBackgroundAttributePolicy, dynamicSceneAttributePolicy, resolveNarrativeStatTiers } from "../engine.js";
import { narrativeObservationHistory } from "./observation.js";
import { retireNarrativeAssets } from "./asset-scope.js";

const world: WorldConfig = { id: "ancient", name: "边地", intro: "边地", milestoneAges: [], endAgeRange: { min: 90, max: 90 }, yearlyEventHints: [] };
const difficulty: DifficultyConfig = { id: "test", name: "测试", yearlyVolatility: 0, growthBias: 0, riskRewardMultiplier: 1, failurePenaltyMultiplier: 1, description: "测试" };
const context: NarrativeContext = { apiKey: "mock-only", promptPack: {}, providerConfig: { provider: "openai-compatible", baseUrl: "https://example.invalid", model: "v18-test", apiPath: "/chat/completions", temperature: .7, maxTokens: 2000, timeoutMs: 1000 } };
const emptySync = { locationUpdates: [], abilityUpdates: [], relationshipUpdates: [], factIntroductions: [], factUpdates: [], identityMerges: [], retirements: [] };
const reply = (name: string, args: unknown) => ({ choices: [{ finish_reason: "tool_calls", message: { content: null,
  tool_calls: [{ id: name, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] });
async function fixture() {
  const base = (await loadNarrativeWorldDefinition("ancient"))!, pack = (await loadNarrativeStoryPack(base, "ancient.frontier-commander"))!;
  const definition = resolveNarrativeExperience(base, pack), tuning = createDefaultGameplayTuning(); tuning.bootstrap.selectedCardMin = 0;
  const run = createRun({ world, difficulty, tuning, cards: [], narrativeEnabled: true, storyPack: pack }, {
    clientId: "v18", worldId: world.id, storyPackId: pack.id, difficultyId: difficulty.id, personaPrompt: "边地军户之子",
    talentPointTotal: 25, stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 }, selectedCardIds: [] });
  run.age = 20; run.narrative = ensureNarrativeActRuntime(run.narrative, definition, 20);
  const act = definition.mainlineActs![0];
  commitNarrativeActOutline(run.narrative, parseNarrativeActWorldCard(hostingFixture(), act.id, { objective: act.objective!, closureMeaning: act.closureMeaning! }));
  return { run, definition, act };
}

test("事项名称与现状分别到达最终请求；各事项独立 finish，结束后退出默认待处理供应", async (t) => {
  const { run, act } = await fixture();
  const [repair, approval, debt] = applyNarrativeFactUpdates(run, { introduce: [
    { kind: "commitment", label: "替官家修滩", status: "open" },
    { kind: "open_question", label: "船户认不认这滩与这活", status: "open" },
    { kind: "cost", label: "三日内还半斗黍米", status: "open" }
  ], touchFactIds: [], resolveFactIds: [] }, { sourceEventId: "before", actId: act.id });
  run.story.factLedger!.facts[0].progressSummary = "活已完";
  run.story.factLedger!.facts[1].progressSummary = "船户已认";
  stageNarrativeAssetRound(run, { sourceEventId: "bridge:done", source: "scene", age: 20, actId: act.id,
    subject: "修滩", relatedIds: [repair, approval, debt], narrative: "跳板架好，船户认了这滩。粮债尚未偿还，官差正在过来。" }, {}, { age: 20 });
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
    const tool = payload.tools[0].function;
    const text = payload.messages.map((entry: any) => entry.content).join("\n");
    const rows = JSON.parse(text.split("\n").find((line: string) => line.startsWith("可更新事项：")).slice("可更新事项：".length));
    if (rows.find((row: any) => row.id === repair)?.status === "resolved") {
      assert.equal(rows.find((row: any) => row.id === repair).label, "替官家修滩");
      assert.equal(rows.find((row: any) => row.id === repair).result, "修滩完成");
      assert.equal(Object.hasOwn(rows.find((row: any) => row.id === repair), "currentState"), false);
      assert.equal(rows.some((row: any) => row.id === approval), false, "其他已结束事项不会一起回来");
      return reply(tool.name, emptySync);
    }
    assert.equal(rows.find((row: any) => row.id === repair).label, "替官家修滩");
    assert.equal(rows.find((row: any) => row.id === repair).status, "open");
    assert.equal(rows.find((row: any) => row.id === repair).currentState, "活已完");
    assert.equal(rows.find((row: any) => row.id === approval).currentState, "船户已认");
    assert.equal(text.split("跳板架好，船户认了这滩。").length - 1, 1);
    assert.match(tool.parameters.description, /各数组没有变化填 \[\]/);
    assert.match(tool.parameters.properties.factIntroductions.description, /下一步怎么办/);
    assert.match(tool.parameters.properties.factUpdates.items.properties.status.description, /原事项/);
    assert.match(tool.parameters.properties.locationUpdates.items.properties.featureChanges.description, /设施、资源或障碍/);
    return reply(tool.name, { ...emptySync, factUpdates: [repair, approval].map(factId => ({ factId, status: "finish", summary: factId === repair ? "修滩完成" : "船户认可", sourceEventId: "bridge:done" })) });
  });
  assert.equal((await synchronizeNarrativeAssetBatch(run, world, { ...context }, "replay", [], true)).status, "requested_changed");
  assert.equal(run.story.factLedger!.facts.find(f => f.id === debt)!.status, "open");
  assert.deepEqual(narrativeContinuityFacts(run.story.factLedger!.facts, act.id).map(f => f.id), [debt]);
  assert.deepEqual(narrativeContinuityFacts(run.story.factLedger!.facts, act.id, [repair]).map(f => f.id), [repair, debt]);
  stageNarrativeAssetRound(run, { sourceEventId: "repair:check", source: "scene", age: 20, actId: act.id,
    subject: "旧滩", relatedIds: [repair], narrative: "官差确认修好的滩并无损坏。" }, {}, { age: 20 });
  assert.equal((await synchronizeNarrativeAssetBatch(run, world, { ...context }, "explicit:finished", [], true)).status, "requested_empty");
});

test("重复 ID、名称或相同字段不复活撤下资产，也不刷新关系和本领变化时间", async () => {
  const { run } = await fixture();
  run.narrative.assets = applyNarrativeAssetUpdates(undefined, { locations: [{ ref: "new", name: "旧营" }],
    abilities: [{ ref: "new", name: "骑术", mastery: "初通" }] }, { age: 10 }).assets;
  const location = run.narrative.assets.locations[0], ability = run.narrative.assets.abilities[0];
  location.retired = true; ability.retired = true;
  const original = structuredClone(run.narrative.assets);
  const noChange = applyNarrativeAssetUpdates(original, { locations: [{ ref: location.id, name: location.name }],
    abilities: [{ ref: ability.id, name: ability.name, mastery: ability.mastery }] }, { age: 20 }).assets;
  assert.deepEqual(noChange, original);
  const changed = applyNarrativeAssetUpdates(noChange, { locations: [{ ref: location.id, description: "重新驻防" }],
    abilities: [{ ref: ability.id, mastery: "熟练" }] }, { age: 20 }).assets;
  assert.equal(changed.locations[0].retired, undefined); assert.equal(changed.abilities[0].retired, undefined);
  assert.equal(changed.abilities[0].updated.age, 20);
  run.narrative.dynamicCharacters.push({ id: "character:old", name: "旧友", retired: true, status: "active", importance: "recurring",
    relatedFactIds: [], relatedRouteIds: [], introducedAge: 2, lastSeenAge: 5, relationship: { summary: "旧友", relatedFactIds: [], lastChangedAge: 5 } });
  applyNarrativeRelationshipUpdates(run, [{ characterRef: "character:old", summary: "旧友" }]);
  assert.equal(run.narrative.dynamicCharacters[0].relationship!.lastChangedAge, 5);
  assert.equal(run.narrative.dynamicCharacters[0].retired, true);
});

test("整批应用失败不能留下部分归并或修改", async () => {
  const { run } = await fixture();
  stageNarrativeAssetRound(run, { sourceEventId: "atomic", source: "scene", age: 20, subject: "营地", narrative: "你返回旧营。" },
    { assetUpdates: { locations: [{ ref: "new", name: "旧营" }, { ref: "new", name: "同一旧营" }], abilities: [] } }, { age: 20 });
  const [first, second] = run.narrative.assets!.locations;
  const before = structuredClone(run);
  assert.throws(() => applyNarrativeAssetBatch(run, run.narrative.assetBuffer!, {
    handoff: { sourceEventId: "atomic", characters: [] },
    identityMerges: [{ kind: "location", sourceRef: first.id, targetRef: second.id }],
    assetUpdates: { locations: [{ ref: second.id, featureChanges: [{ id: "missing", state: "已修复" }] }], abilities: [] }
  }));
  assert.deepEqual(run, before);
});

test("失败批次同次推进不重试；读档后的处理机会合并重试且来源不丢失", async (t) => {
  const { run } = await fixture();
  stageNarrativeAssetRound(run, { sourceEventId: "saved", source: "scene", age: 20, subject: "实际经历", narrative: "这段故事已经成立。" }, {}, { age: 20 });
  let calls = 0, fail = true;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
    calls++; if (fail) throw new Error("offline"); return reply(payload.tools[0].function.name, emptySync);
  });
  const step = { ...context, continuityAttempts: new Set<string>() };
  assert.equal((await synchronizeNarrativeAssetBatch(run, world, step, "first", [], true)).status, "failed");
  assert.equal((await synchronizeNarrativeAssetBatch(run, world, { ...step }, "act-end", [], true)).status, "skipped");
  assert.equal(calls, 1); assert.equal(run.narrative.assetBuffer!.rounds[0].narrative, "这段故事已经成立。");
  const restored = JSON.parse(JSON.stringify(run)) as typeof run; fail = false;
  stageNarrativeAssetRound(restored, { sourceEventId: "later", source: "scene", age: 20, subject: "后来", narrative: "后来你去了边堡。" }, {}, { age: 20 });
  assert.equal((await synchronizeNarrativeAssetBatch(restored, world, { ...context }, "later", [], true)).status, "requested_empty");
  assert.equal(calls, 2); assert.equal(restored.narrative.assetBuffer, undefined);
});

test("维护失败不阻止已保存事件观察、换幕；重试不会重新生成事件", async (t) => {
  const { run, definition } = await fixture();
  advanceWithDynamicNarrativeScene(run, world, definition, { patternIds: [], forceIds: [], narrative: "你已经入伍。", participants: [], nextClock: "hold", attributeOutcome: { effects: [] } });
  const source = run.pendingActFinalization!.sourceEventId;
  stageNarrativeAssetRound(run, { sourceEventId: source, source: "scene", age: run.age, subject: "入伍", narrative: "你已经入伍。" }, {}, { age: run.age });
  const ctx = { ...context, continuityAttempts: new Set<string>() }, order: string[] = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
    const name = payload.tools[0].function.name; order.push(name);
    if (name === "sync_narrative_continuity") throw new Error("offline");
    return reply(name, { decision: "act_closed", evidence: "你已成功入伍" });
  });
  await synchronizeNarrativeAssetBatch(run, world, ctx, "committed", [], true);
  await finishPendingNarrativeActEvent(run, world, definition, ctx, async () => { order.push("checkpoint"); });
  assert.deepEqual(order, ["sync_narrative_continuity", "observe_act_closure", "checkpoint", "checkpoint"]);
  assert.equal(run.narrative.actCanon.length, 1); assert.equal(run.narrative.assetBuffer!.rounds[0].sourceEventId, source);
});

test("观察确认的提前败局不补造后续幕完成，高属性不能把坏结局改成好结局", async () => {
  const { run, definition } = await fixture();
  for (const key of Object.keys(run.stats) as Array<keyof typeof run.stats>) run.stats[key] = 100;
  advanceWithDynamicNarrativeScene(run, world, definition, { patternIds: [], forceIds: [], narrative: "你和部曲被诱杀，守边事业至此败亡。", participants: [], nextClock: "hold", attributeOutcome: { effects: [] } });
  const pending = run.pendingActFinalization!;
  const observation = parseNarrativeActObservation({ decision: "run_ended", evidence: "你和部曲被诱杀", endingPolarity: "bad" }, pending.actId, pending.sourceEventId);
  assert.equal(finalizeNarrativeActEvent(run, definition, observation), true);
  assert.equal(run.story.mainlineCompleted, false); assert.equal(run.narrative.actCanon.length, 0);
  assert.equal(run.narrative.endingPolarity, "bad"); assert.equal(canRequestDirectedClosure(run, definition), true);
  assert.equal(run.narrative.sceneClock.mode, "hold");
  const restored = structuredClone(run); restored.narrative = ensureNarrativeRunState(restored.narrative, true);
  assert.equal(assessEnding(restored, definition).polarity, "bad");
  assert.equal(applyDirectedClosureRequest(restored, "finish", definition), "finished");
  assert.equal(restored.ended, true); assert.equal(finalizeNarrativeActEvent(restored, definition, observation), false);
  assert.throws(() => parseNarrativeActObservation({ decision: "run_ended", evidence: "败亡" }, pending.actId, pending.sourceEventId));
  assert.equal(parseNarrativeActObservation({ decision: "ongoing", evidence: "本幕仍在发展", endingPolarity: "bad" }, pending.actId, pending.sourceEventId).endingPolarity, undefined);
});

test("两种 provider 的观察工具与固定前缀一致，IF 结局边界在动态输入且最后一幕不能只换幕", async (t) => {
  for (const apiPath of ["/chat/completions", "/responses"]) await t.test(apiPath, async (t) => {
    const { run, definition } = await fixture();
    const captured: any[] = [];
    let finalAct = false, correction = false;
    const respond = (payload: any) => {
      captured.push(structuredClone(payload));
      const tool = apiPath === "/responses" ? payload.tools[0] : payload.tools[0].function;
      assert.deepEqual(tool.parameters.properties.decision.enum, ["ongoing", "act_closed", "run_ended"]);
      const text = JSON.stringify(apiPath === "/responses" ? payload.input : payload.messages);
      assert.ok(text.includes(run.storyPackSnapshot!.endingDirections.closureBoundary!));
      const args = !finalAct ? { decision: "ongoing", evidence: null }
        : !correction ? { decision: "act_closed", evidence: "外敌已退，边境局势已定" }
        : { decision: "run_ended", evidence: "守住一方但边患未尽", endingPolarity: "normal" };
      if (finalAct) correction = true;
      return apiPath === "/responses" ? { id: "response", output: [{ type: "function_call", call_id: "call", name: tool.name, arguments: JSON.stringify(args) }] } : reply(tool.name, args);
    };
    if (apiPath === "/responses") t.mock.method(OpenAI.Responses.prototype, "create", async (payload: any) => respond(payload));
    else t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => respond(payload));
    const ctx = { ...context, providerConfig: { ...context.providerConfig, apiPath }, narrativePlan: buildNarrativePromptPlan(run, definition, null, "observation")! };
    for (const age of [20, 21]) { run.age = age; await observeNarrativeAct(run, world, { callId: "observe", actId: run.narrative.actRuntime!.actId,
      sourceEventId: "source:" + age, outline: run.narrative.actRuntime!.outline!, recentStory: "当年经历 " + age }, ctx); }
    assert.deepEqual(captured[0].tools, captured[1].tools);
    const fixed = (payload: any) => apiPath === "/responses" ? payload.instructions : payload.messages[0].content;
    assert.equal(fixed(captured[0]), fixed(captured[1]));
    assert.equal(String(fixed(captured[0])).includes(run.storyPackSnapshot!.endingDirections.closureBoundary!), false);
    const last = definition.mainlineActs!.at(-1)!;
    const outline = parseNarrativeActWorldCard(hostingFixture(), last.id, { objective: last.objective!, closureMeaning: last.closureMeaning! });
    finalAct = true;
    const terminal = await observeNarrativeAct(run, world, { callId: "final", actId: last.id, sourceEventId: "final:source",
      outline, recentStory: "守住一方但边患未尽" }, ctx);
    assert.equal(terminal.decision, "run_ended"); assert.equal(terminal.endingPolarity, "normal");
    assert.equal(captured.length, 4, "最后一幕错误返回沿用一次协议纠正，不追加评判请求");
    assert.equal(fixed(captured[2]), fixed(captured[3])); assert.deepEqual(captured[2].tools, captured[3].tools);
    assert.match(JSON.stringify(captured[3]), /final_act_has_no_next_act/);
    assert.match(JSON.stringify(captured[3]), /ongoing/);
  });
});

test("两种 provider 的维护空更新协议一致，动态来源不改写 system 或工具", async (t) => {
  for (const apiPath of ["/chat/completions", "/responses"]) await t.test(apiPath, async (t) => {
    const { run } = await fixture(), captured: any[] = [];
    const respond = (payload: any) => {
      captured.push(structuredClone(payload));
      const tool = apiPath === "/responses" ? payload.tools[0] : payload.tools[0].function;
      assert.deepEqual([...tool.parameters.required].sort(), Object.keys(emptySync).sort());
      assert.match(tool.parameters.description, /各数组没有变化填 \[\]/);
      assert.match(tool.parameters.properties.factIntroductions.description, /本批首次成立/);
      assert.match(tool.parameters.properties.locationUpdates.items.properties.actorChanges.description, /当前.*关系/);
      return apiPath === "/responses" ? { id: "sync", output: [{ type: "function_call", call_id: "sync", name: tool.name, arguments: JSON.stringify(emptySync) }] }
        : reply(tool.name, emptySync);
    };
    if (apiPath === "/responses") t.mock.method(OpenAI.Responses.prototype, "create", async (payload: any) => respond(payload));
    else t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => respond(payload));
    const ctx = { ...context, providerConfig: { ...context.providerConfig, apiPath } };
    for (const age of [20, 21]) {
      run.age = age;
      stageNarrativeAssetRound(run, { sourceEventId: "real:" + age, source: "scene", age, subject: "生活", narrative: age + "岁的生活。" }, {}, { age });
      assert.equal((await synchronizeNarrativeAssetBatch(run, world, ctx, "sync:" + age, [], true)).status, "requested_empty");
      assert.equal(run.narrative.assetBuffer, undefined);
    }
    const fixed = (payload: any) => apiPath === "/responses" ? payload.instructions : payload.messages[0].content;
    assert.equal(fixed(captured[0]), fixed(captured[1])); assert.deepEqual(captured[0].tools, captured[1].tools);
    assert.equal(JSON.stringify(captured[0]).includes("real:20"), true);
    assert.equal(JSON.stringify(captured[1]).includes("real:20"), false, "已确认批次不重复供应");
  });
});

test("展示档案变化不改变最终正文请求；唯一同名登记和实际活动由引擎识别", async (t) => {
  const { run, definition, act } = await fixture();
  run.narrative.assets = { locations: [{ id: "location:hidden", name: "旧营", description: "档案秘密甲", introduced: { age: 0 }, lastSeen: { age: 0 } }],
    abilities: [{ id: "ability:hidden", name: "骑术", usage: "档案秘密乙", introduced: { age: 0 }, updated: { age: 0 } }], currentLocationId: "location:hidden" };
  run.narrative.dynamicCharacters.push({ id: "character:hidden", name: "故友", description: "档案秘密丙", role: "旧职", status: "active", importance: "recurring", relatedFactIds: [], relatedRouteIds: [], introducedAge: 0, lastSeenAge: 0 });
  applyNarrativeFactUpdates(run, { introduce: [{ kind: "open_question", label: "档案秘密丁" }], touchFactIds: [], resolveFactIds: [] }, { sourceEventId: "past", actId: act.id });
  const captured: any[] = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
    captured.push(structuredClone(payload));
    const choice = payload.tools.find((tool: any) => tool.function.name === "render_choice_prose").function;
    assert.deepEqual(choice.parameters.properties.optionOverrides.items.required, ["id", "label", "description"]);
    assert.equal(choice.parameters.properties.optionOverrides.items.properties.abilityRefs, undefined);
    return reply("render_scene_prose", { narrative: "你与故友骑马离营。", nextClock: "hold", participants: [{ characterRef: "new", name: "故友" }],
      assetUpdates: { locations: [{ ref: "new", name: "旧营", current: true }], abilities: [{ ref: "new", name: "骑术" }] },
      assetActivity: { locationIds: ["旧营"], abilityIds: ["骑术"], currentLocationId: "旧营" } });
  });
  const input: DynamicNarrativeSceneInput = { act, presentation: "scene", allowedTurnKinds: ["scene"], sceneAge: 20,
    backgroundAgeRange: { fromAge: 20, toAge: 20 }, storyPatterns: [], socialForces: [], knownCharacters: [], statTiers: resolveNarrativeStatTiers(run.stats),
    attributePolicy: dynamicSceneAttributePolicy(), backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run) };
  const generate = () => generateDynamicNarrativeScene(run, world, input, { ...context, narrativePlan: buildNarrativePromptPlan(run, definition, null, "rendering") });
  const first = await generate();
  assert.equal(first.participants[0].characterRef, "character:hidden");
  assert.equal(first.assetUpdates!.locations[0].ref, "location:hidden");
  assert.equal(first.assetUpdates!.abilities[0].ref, "ability:hidden");
  assert.deepEqual(first.assetActivity, { locationIds: ["location:hidden"], abilityIds: ["ability:hidden"], currentLocationId: "location:hidden" });
  run.narrative.dynamicCharacters[0].description = "替换秘密甲";
  run.narrative.assets.locations[0].description = "替换秘密乙";
  run.narrative.assets.abilities[0].usage = "替换秘密丙";
  run.story.factLedger!.facts[0].progressSummary = "替换秘密丁";
  await generate();
  assert.deepEqual(captured[0], captured[1], "展示维护不改变叙事输入、system、工具和稳定前缀");
  assert.doesNotMatch(JSON.stringify(captured[0]), /档案秘密|替换秘密|character:hidden|location:hidden|ability:hidden/);
  assert.match(captured[0].messages[0].content, /以第二人称“你”/);
});

test("正文活动纠正不补回前端全目录；伪造 ID 仍被拒绝", async (t) => {
  const { run, definition, act } = await fixture();
  run.narrative.assets = { locations: ["one", "two"].map(id => ({ id: `location:${id}`, name: "旧营", introduced: { age: 0 }, lastSeen: { age: 0 } })), abilities: [] };
  const captured: any[] = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
    captured.push(payload);
    return reply("render_scene_prose", { narrative: "你到达旧营。", nextClock: "advance", participants: [],
      assetUpdates: { locations: [], abilities: [] },
      assetActivity: { locationIds: captured.length === 1 ? ["location:invented"] : [], abilityIds: [] } });
  });
  const result = await generateDynamicNarrativeScene(run, world, { act, presentation: "scene", allowedTurnKinds: ["scene"], sceneAge: 20,
    backgroundAgeRange: { fromAge: 20, toAge: 20 }, storyPatterns: [], socialForces: [], knownCharacters: [], statTiers: resolveNarrativeStatTiers(run.stats),
    attributePolicy: dynamicSceneAttributePolicy(), backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run) },
    { ...context, narrativePlan: buildNarrativePromptPlan(run, definition, null, "rendering") });
  assert.equal(captured.length, 2);
  assert.deepEqual(result.assetUpdates!.locations, []);
  assert.doesNotMatch(JSON.stringify(captured), /location:one|location:two/);
  assert.match(JSON.stringify(captured[1]), /reference_invalid/);
});

test("展示归并、撤下或同名歧义不阻塞正文的名称活动登记", async (t) => {
  const { run, definition, act } = await fixture();
  const requests: any[] = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
    requests.push(payload);
    return reply("render_scene_prose", { narrative: "你与周什长回到西岭关马道口。", nextClock: "advance", participants: [{ characterRef: "周什长" }],
      assetUpdates: { locations: [], abilities: [] },
      assetActivity: { locationIds: ["西岭关马道口"], currentLocationId: "西岭关马道口", abilityIds: [] } });
  });
  const generate = () => generateDynamicNarrativeScene(run, world, { act, presentation: "scene", allowedTurnKinds: ["scene"], sceneAge: 20,
    backgroundAgeRange: { fromAge: 20, toAge: 20 }, storyPatterns: [], socialForces: [], knownCharacters: [], statTiers: resolveNarrativeStatTiers(run.stats),
    attributePolicy: dynamicSceneAttributePolicy(), backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run) },
    { ...context, narrativePlan: buildNarrativePromptPlan(run, definition, null, "rendering") });
  for (const locations of [[], ["one", "two"].map(id => ({ id: `location:${id}`, name: "西岭关马道口", introduced: { age: 0 }, lastSeen: { age: 0 } }))]) {
    run.narrative.assets = { locations, abilities: [] };
    run.narrative.dynamicCharacters = locations.map((entry) => ({ id: entry.id.replace("location:", "character:"), name: "周什长", importance: "recurring", status: "active", relatedFactIds: [], relatedRouteIds: [], introducedAge: 0, lastSeenAge: 0 }));
    const result = await generate();
    assert.ok(!["character:one", "character:two"].includes(result.participants[0].characterRef), "同样不根据前端人物目录猜测身份");
    assert.equal(result.participants[0].name, "周什长");
    assert.deepEqual(result.assetUpdates!.locations, [{ ref: "new", name: "西岭关马道口", current: true }]);
    assert.deepEqual(result.assetActivity!.locationIds, [], "不猜测任何一个旧身份");
  }
  assert.equal(requests.length, 2, "两种目录状态都不需要纠正正文");
  assert.deepEqual(requests[0], requests[1], "展示目录变化不影响请求");
});

test("展示状态也不能经世界素材的准入条件间接影响幕初组织", async () => {
  const { run, definition } = await fixture();
  run.narrative.actRuntime!.outline = undefined;
  definition.worldCards = [...(definition.worldCards ?? []), { id: "test:display-trigger", title: "展示状态触发", kind: "world_rule", priority: 100,
    contextRole: "knowledge", content: "不应通过展示事实触发的素材", activation: { tasks: ["planning"], factStatuses: ["open"] } }];
  const before = buildNarrativePromptPlan(run, definition, null, "planning")!;
  applyNarrativeFactUpdates(run, { introduce: [{ kind: "cost", label: "仅供前端的债务" }], touchFactIds: [], resolveFactIds: [] }, { sourceEventId: "past" });
  run.narrative.assets = { locations: [{ id: "location:display-only", name: "前端地点", description: "前端详情", introduced: { age: 0 }, lastSeen: { age: 0 } }], abilities: [], currentLocationId: "location:display-only" };
  const after = buildNarrativePromptPlan(run, definition, null, "planning")!;
  assert.deepEqual(after.activeWorldCardSources, before.activeWorldCardSources);
  assert.equal(after.activeWorldCardSources?.some(card => card.id === "test:display-trigger"), false);
  assert.deepEqual(after.protagonist, before.protagonist);
  assert.deepEqual(after.recall, before.recall);
});

test("真实驿亭故障回放：本次新登记与当前活动同名时只分配一次身份", async (t) => {
  const { run, definition, act } = await fixture();
  run.narrative.dynamicCharacters.push({ id: "character:zhou", name: "周什长", importance: "recurring", status: "active", relatedFactIds: [], relatedRouteIds: [], introducedAge: 0, lastSeenAge: 0 });
  run.narrative.assets = { locations: [{ id: "location:gate", name: "马道口", introduced: { age: 0 }, lastSeen: { age: 0 } }], abilities: [] };
  let requests = 0;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async () => {
    requests++;
    return reply("render_scene_prose", { narrative: "你与周什长从马道口到达关外驿亭。", nextClock: "hold", participants: [{ characterRef: "周什长", name: "周什长" }],
      assetUpdates: { locations: [{ ref: "马道口" }, { ref: "关外驿亭" }], abilities: [] },
      assetActivity: { locationIds: ["马道口", "关外驿亭"], abilityIds: [], currentLocationId: "关外驿亭" } });
  });
  const result = await generateDynamicNarrativeScene(run, world, { act, presentation: "scene", allowedTurnKinds: ["scene"], sceneAge: 20,
    backgroundAgeRange: { fromAge: 20, toAge: 20 }, storyPatterns: [], socialForces: [], knownCharacters: [], statTiers: resolveNarrativeStatTiers(run.stats),
    attributePolicy: dynamicSceneAttributePolicy(), backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run) },
    { ...context, narrativePlan: buildNarrativePromptPlan(run, definition, null, "rendering") });
  assert.equal(requests, 1, "不为已声明的同名活动重新请求正文");
  assert.equal(result.participants[0].characterRef, "character:zhou");
  assert.equal(result.assetUpdates!.locations[0].ref, "location:gate");
  assert.equal(result.assetUpdates!.locations[1].current, true);
  assert.deepEqual(result.assetActivity!.locationIds, ["location:gate"]);
  const applied = applyNarrativeAssetUpdates(run.narrative.assets, result.assetUpdates, { age: 20 });
  assert.equal(applied.assets.locations.length, 2);
  assert.equal(applied.assets.locations.find(entry => entry.id === applied.assets.currentLocationId)!.name, "关外驿亭");
});

test("观察覆盖本幕全部未压缩经历，不再丢弃三年前的结果或重复当前正文", async () => {
  const { run, act } = await fixture();
  const mk = (id: string, age: number, storyDelta: string) => ({ id, callId: id, sourceEventId: id, age, actId: act.id,
    turnKind: "scene" as const, memoryIds: [], factIds: [], characterIds: [], locationIds: [], abilityIds: [], storyDelta, createdAt: age });
  run.narrative.episodes = [mk("covered", 1, "已由摘要覆盖"), mk("old", 2, "多年前已经入伍"), mk("recent", 19, "近期带队"), mk("current", 20, "当前事件")];
  run.narrative.memoryDigests = [{ id: "run", format: "effective_facts", scope: "run", revision: 1, summary: "此前经历", throughEpisodeId: "covered", coveredEpisodeIds: ["covered"], activeFactIds: [], historicalFactIds: [], characterIds: [], updatedAt: 1 }];
  const text = narrativeObservationHistory(run, { actId: act.id, sourceEventId: "current", age: 20, narrative: "当前事件" });
  assert.match(text, /多年前已经入伍/); assert.match(text, /近期带队/);
  assert.doesNotMatch(text, /已由摘要覆盖/); assert.equal(text.split("当前事件").length - 1, 1);
});

test("已结束事项不永久保护撤下身份，当前所在地仍保留最小身份", async () => {
  const { run, act } = await fixture();
  run.narrative.assets = { locations: [{ id: "location:current", name: "临时营", description: "不再需要的细节", introduced: { age: 0 }, lastSeen: { age: 0 } },
    { id: "location:past", name: "过路亭", description: "过去细节", introduced: { age: 0 }, lastSeen: { age: 0 } }], abilities: [], currentLocationId: "location:current" };
  applyNarrativeFactUpdates(run, { introduce: [{ kind: "commitment", label: "送信已完", status: "resolved", locationIds: ["location:past"] }], touchFactIds: [], resolveFactIds: [] }, { sourceEventId: "done", actId: act.id });
  retireNarrativeAssets(run, [{ kind: "location", ref: "location:past" }, { kind: "location", ref: "location:current" }]);
  assert.deepEqual(run.narrative.assets.locations.map(entry => entry.id), ["location:current"]);
  assert.equal(run.narrative.assets.locations[0].description, undefined);
  run.narrative.assets.currentLocationId = undefined;
  retireNarrativeAssets(run);
  assert.deepEqual(run.narrative.assets.locations, []);
});
