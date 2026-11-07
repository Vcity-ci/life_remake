import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { createDefaultGameplayTuning, type WorldConfig, type DifficultyConfig } from "@reroll/shared";
import { createRun, dynamicBackgroundAttributePolicy, resolveNarrativeStatTiers } from "../engine.js";
import { loadNarrativeWorldDefinition } from "../content.js";
import { loadNarrativeStoryPack } from "../story-packs.js";
import { resolveNarrativeExperience } from "../narrative-experience.js";
import { buildNarrativePromptPlan, ensureNarrativeActRuntime, ensureNarrativeRunState } from "../narrative.js";
import { applyNarrativeAssetUpdates, applyNarrativeAssetActivity, parseNarrativeContinuityAssetUpdates, narrativeContinuityAssetContract } from "../narrative-assets.js";
import { generateEndingNarrative, generateNarrativeOrigin, generateNarrativeTurnPlan, dynamicNarrativeRenderTools, prepareNarrativeOutcomeRequest, parseDynamicNarrativeProse, type NarrativeContext } from "../ai.js";
import type { NarrativeTurnEnvelope } from "./turn.js";
import { stageNarrativeAssetRound } from "./asset-buffer.js";
import { continuityDetailIds, retireNarrativeAssets } from "./asset-scope.js";
import { synchronizeNarrativeAssetBatch } from "./runtime.js";
import { narrativeTaskContract } from "./task-contracts.js";
import { parseNarrativeActWorldCard, commitNarrativeActOutline } from "./act-outline.js";
import { hostingFixture } from "./hosting-fixture.js";

const world: WorldConfig = { id: "ancient", name: "边地", intro: "边地", milestoneAges: [], endAgeRange: { min: 90, max: 90 }, yearlyEventHints: [] };
const difficulty: DifficultyConfig = { id: "test", name: "测试", yearlyVolatility: 0, growthBias: 0, riskRewardMultiplier: 1, failurePenaltyMultiplier: 1, description: "测试" };
const context: NarrativeContext = { apiKey: "mock-only", promptPack: {}, providerConfig: { provider: "openai-compatible", baseUrl: "https://example.invalid", model: "v17-mock", apiPath: "/chat/completions", temperature: 0.7, maxTokens: 2000, timeoutMs: 1000 } };
async function fixture() {
  const tuning = createDefaultGameplayTuning(); tuning.bootstrap.selectedCardMin = 0;
  const run = createRun({ world, difficulty, tuning, cards: [] }, { clientId: "v17-test", worldId: world.id, storyPackId: "ancient.frontier-commander", difficultyId: difficulty.id,
    personaPrompt: "边地军户之子", talentPointTotal: 25, stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 }, selectedCardIds: [] });
  const base = (await loadNarrativeWorldDefinition("ancient"))!;
  const pack = (await loadNarrativeStoryPack(base, "ancient.frontier-commander"))!;
  const definition = resolveNarrativeExperience(base, pack); run.storyPackSnapshot = pack;
  run.narrative.enabled = true; run.narrative = ensureNarrativeActRuntime(run.narrative, definition, 0);
  return { run, definition };
}
const emptySync = { locationUpdates: [], abilityUpdates: [], relationshipUpdates: [], factIntroductions: [], factUpdates: [], identityMerges: [], retirements: [] };

test("幕内不发起资产召回，事项身份和详情均不进入正文", async (t) => {
  const { run, definition } = await fixture();
  const act = definition.mainlineActs![0];
  commitNarrativeActOutline(run.narrative, parseNarrativeActWorldCard(hostingFixture("边军需要组织训练"), act.id, { objective: act.objective!, closureMeaning: act.closureMeaning! }));
  const id = "fact:training";
  run.story.factLedger = { version: 1, facts: [{ id, kind: "commitment", label: "训练职责", status: "open", actId: act.id,
    introducedAge: 10, lastTouchedAge: 10, sourceEventId: "s1", progressSummary: "SELECTED_CURRENT_STATE" }],
    openQuestion: [], stakes: [], commitment: [], cost: [], relationshipChange: [], resolvedFactIds: [], blockedFactIds: [] };
  const plan = buildNarrativePromptPlan(run, definition, null, "planning")!;
  const input: NarrativeTurnEnvelope = { callId: "recall-index", source: "scene", worldId: run.worldId, currentAge: 10, sceneAge: 11,
    backgroundAgeRange: { fromAge: 11, toAge: 11 }, act, actOutline: run.narrative.actRuntime!.outline, capabilities: ["scene", "choice"],
    storyPatterns: [], socialForces: [], focusReferences: plan.recall!.facts.map((fact) => ({ ...fact, kind: "fact" })),
    statTiers: resolveNarrativeStatTiers(run.stats), clock: { ...run.narrative.sceneClock } };
  let calls = 0;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
    calls++;
    const text = payload.messages.map((message: any) => message.content).join("\n");
    assert.match(text, /训练职责（open）/); assert.doesNotMatch(text, /SELECTED_CURRENT_STATE/);
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "recall", type: "function", function: { name: "recall_scene_assets", arguments: JSON.stringify({ recallRefs: [id] }) } }] } }] };
  });
  const recalled = await generateNarrativeTurnPlan(run, world, input, { ...context, narrativePlan: plan });
  assert.equal(calls, 0); assert.deepEqual(recalled.recallRefs, []);
  const prosePlan = buildNarrativePromptPlan(run, definition, null, "rendering", { focusIds: [id] })!;
  assert.deepEqual(prosePlan.recall!.facts, []);
});

test("本批和一跳关联提供详情，其余身份可被引用但不泄漏档案", async (t) => {
  const { run } = await fixture();
  const registered = stageNarrativeAssetRound(run, { sourceEventId: "s1", source: "scene", age: 10, subject: "到营", narrative: "你回到营中，陆教头开始主持操练。" }, {
    participants: [{ characterRef: "new", name: "陆教头", recurring: true }],
    assetUpdates: { locations: [{ ref: "new", name: "边营", current: true }], abilities: [] }
  }, { age: 10 })!;
  const person = run.narrative.dynamicCharacters[0].id;
  const location = registered.locations[0].ref;
  run.narrative.assets = applyNarrativeAssetUpdates(run.narrative.assets, { locations: [{ ref: location, spatialDescription: "DETAIL_CURRENT", actors: [{ characterIds: [person], relation: "负责操练" }] }], abilities: [
    { ref: "new", name: "旧剑法", description: "UNRELATED_DETAIL", usage: "UNRELATED_USAGE", source: "ARCHIVE_SOURCE", mastery: "初通" }
  ] }, { age: 10 }).assets;
  const unrelated = run.narrative.assets.abilities[0].id;
  for (const id of ["s2", "s3"]) stageNarrativeAssetRound(run, { sourceEventId: id, source: "scene", age: 10, subject: "操练", narrative: "你跟随陆教头操练。" }, {
    participants: [{ characterRef: person, name: "陆教头", recurring: true }], assetActivity: { locationIds: [location], abilityIds: [] }
  }, { age: 10 });
  assert.ok(continuityDetailIds(run).includes(location)); assert.ok(continuityDetailIds(run).includes(person));
  assert.ok(!continuityDetailIds(run).includes(unrelated));
  let calls = 0;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
    calls++;
    const text = payload.messages.map((message: any) => message.content).join("\n");
    assert.match(text, /DETAIL_CURRENT/); assert.ok(text.includes(unrelated + "=旧剑法"));
    assert.doesNotMatch(text, /UNRELATED_DETAIL|UNRELATED_USAGE|ARCHIVE_SOURCE/);
    assert.equal(payload.tools[0].function.parameters.properties.locationUpdates.items.properties.features, undefined);
    assert.ok(payload.tools[0].function.parameters.properties.locationUpdates.items.properties.featureChanges);
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "sync", type: "function", function: { name: "sync_narrative_continuity", arguments: JSON.stringify(emptySync) } }] } }] };
  });
  await synchronizeNarrativeAssetBatch(run, world, { ...context }, "scope");
  assert.equal(calls, 1); assert.equal(run.narrative.assetBuffer, undefined);
});

test("设施与关联按稳定条目增改删，解析先拒绝未知条目，恢复不改 ID", async () => {
  const { run } = await fixture();
  run.narrative.assets = applyNarrativeAssetUpdates(undefined, { locations: [{ ref: "new", name: "边堡", features: [{ name: "桥", state: "完好" }, { name: "井", state: "可用" }], actors: [{ organizationName: "守军", relation: "驻防" }, { organizationName: "商队", relation: "借宿" }] }], abilities: [] }, { age: 10 }).assets;
  const original = structuredClone(run.narrative.assets.locations[0]);
  const parse = (locationUpdates: unknown[]) => parseNarrativeContinuityAssetUpdates({ locationUpdates, abilityUpdates: [] }, run.narrative.assets!);
  const patch = parse([{ ref: original.id, featureChanges: [{ id: original.features![0].id, state: "烧毁" }], actorChanges: [{ id: original.actors![1].id, remove: true }] }]);
  run.narrative.assets = applyNarrativeAssetUpdates(run.narrative.assets, patch, { age: 11 }).assets;
  const current = run.narrative.assets.locations[0];
  assert.equal(current.features![0].state, "烧毁"); assert.equal(current.features![0].name, "桥");
  assert.deepEqual(current.features![1], original.features![1]); assert.deepEqual(current.actors, [original.actors![0]]);
  assert.throws(() => parse([{ ref: original.id, featureChanges: [{ id: "missing", state: "修复" }] }]), /entry_reference_invalid/);
  assert.throws(() => parse([{ ref: original.id, features: [] }]), /entry_delta_required/);
  assert.throws(() => parse([{ ref: original.id, featureChanges: [{ id: "new", state: "可用" }] }]), /entry_new_invalid/);
  const restored = ensureNarrativeRunState(JSON.parse(JSON.stringify(run.narrative)), true, 11);
  assert.deepEqual(restored.assets!.locations, run.narrative.assets.locations);
  assert.deepEqual(narrativeContinuityAssetContract(run.narrative.assets), narrativeContinuityAssetContract({ locations: [], abilities: [] }), "ID 和条目不进入工具定义");
});

test("撤下只保留被当前位置和保留对象引用的最小身份，解除引用后移除", async () => {
  const { run } = await fixture();
  const declared = stageNarrativeAssetRound(run, { sourceEventId: "origin", source: "background", age: 0, subject: "出生", narrative: "你生于边堡。" }, {
    participants: [{ characterRef: "new", name: "故人", recurring: true }],
    assetUpdates: { locations: [{ ref: "new", name: "旧堡", current: true }, { ref: "new", name: "新营" }], abilities: [{ ref: "new", name: "铜牌" }] }
  }, { age: 0 })!;
  const old = declared.locations[0].ref, next = declared.locations[1].ref, person = run.narrative.dynamicCharacters[0].id, ability = declared.abilities[0].ref;
  run.narrative.assets!.abilities[0].characterIds = [person];
  run.narrative.dynamicCharacters[0].description = "OLD_DOSSIER";
  const before = structuredClone(run.turnRecords);
  retireNarrativeAssets(run, [{ kind: "location", ref: old }, { kind: "character", ref: person }]);
  assert.equal(run.narrative.assets!.locations.find((entry) => entry.id === old)!.name, "旧堡");
  assert.equal(run.narrative.dynamicCharacters[0].description, undefined); assert.equal(run.narrative.dynamicCharacters[0].retired, true);
  run.narrative.assets = applyNarrativeAssetActivity(run.narrative.assets, { currentLocationId: next, locationIds: [next], abilityIds: [] }, { age: 10 });
  retireNarrativeAssets(run, [{ kind: "ability", ref: ability }]);
  assert.equal(run.narrative.dynamicCharacters.length, 0); assert.ok(!run.narrative.assets.locations.some((entry) => entry.id === old));
  assert.ok(!run.narrative.assets.abilities.length); assert.deepEqual(run.turnRecords, before);
});

test("各任务只接收自己的职责，身世无独立摘要，生活不索取剧情时间交接", async (t) => {
  const { run, definition } = await fixture();
  for (const task of ["origin", "background", "continuity", "curation", "ending"] as const) {
    const request = prepareNarrativeOutcomeRequest(run, world, { ...context }, { type: "function", function: { name: "test", parameters: { type: "object", properties: {} } } }, "任务数据", { task });
    assert.ok(request.conversation.headCore.includes(narrativeTaskContract(task).systemInstruction));
    assert.doesNotMatch(request.conversation.headCore, /调用 render_choice_prose/);
  }
  let calls = 0;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
    calls++;
    const tool = payload.tools[0].function;
    assert.equal(tool.parameters.properties.summary, undefined); assert.equal(tool.parameters.properties.seedHints, undefined);
    assert.match(payload.messages[0].content, /停在出生时/); assert.doesNotMatch(payload.messages[0].content, /participants/);
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "origin", type: "function", function: { name: "render_origin", arguments: JSON.stringify({ narrative: "你生于边堡军户之家，父亲收着一枚铜哨，与守将陆平相识。", participants: [], assetUpdates: { locations: [], abilities: [] } }) } }] } }] };
  });
  const result = await generateNarrativeOrigin(run, world, { ...context });
  assert.equal(calls, 1); assert.equal(Object.hasOwn(result, "profile"), false);
  assert.equal(ensureNarrativeRunState({ ...run.narrative, opening: { status: "ready" } }, true).opening!.status, "ready");
  const oldFields = { ...buildNarrativePromptPlan(run, definition, null, "origin")!, origin: "OLD_ORIGIN_EXTRA", seedHints: ["OLD_SEED_EXTRA"] };
  const request = prepareNarrativeOutcomeRequest(run, world, { ...context, narrativePlan: oldFields }, { type: "function", function: { name: "test", parameters: { type: "object", properties: {} } } }, "任务数据", { task: "origin" });
  assert.doesNotMatch(JSON.stringify(request.history), /OLD_ORIGIN_EXTRA|OLD_SEED_EXTRA/);
  const input = { act: definition.mainlineActs![0], presentation: "summary" as const, allowedTurnKinds: ["background" as const], sceneAge: 2, backgroundAgeRange: { fromAge: 1, toAge: 2 }, storyPatterns: [], socialForces: [], knownCharacters: [], backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run), statTiers: resolveNarrativeStatTiers(run.stats) };
  const life = dynamicNarrativeRenderTools(input).tools[0] as any;
  assert.ok(!life.function.parameters.required.includes("nextClock"));
  assert.equal(parseDynamicNarrativeProse({ narrative: "你在堡中平静长大。" }, "render_background_prose").nextClock, undefined);
  assert.throws(() => parseDynamicNarrativeProse({ narrative: "你继续操练。" }, "render_scene_prose"), /narrative_outcome_invalid/);
});

test("两种传输的结局只请求一次，不读取人生提要、资产经历或未来主持资料", async (t) => {
  for (const apiPath of ["/chat/completions", "/responses"] as const) await t.test(apiPath, async (transport) => {
    const { run, definition } = await fixture();
    commitNarrativeActOutline(run.narrative, parseNarrativeActWorldCard(hostingFixture("FUTURE_ACT_SENTINEL"), definition.mainlineActs![0].id, { objective: "未来目的", closureMeaning: "未来收束" }));
    run.narrative.opening = { status: "ready", profile: { summary: "OLD_ORIGIN_SUMMARY", seedHints: [] } };
    run.narrative.endingBrief = { theme: "OLD_VERDICT", achievements: [], costs: [], impact: [] } as any;
    run.narrative.assets = applyNarrativeAssetUpdates(undefined, { locations: [], abilities: [{ ref: "new", name: "仅展示宝物", source: "DISPLAY_SOURCE" }] }, { age: 30 }).assets;
    run.ended = true; run.outcome = "completed"; run.narrative.endingPolarity = "bad"; run.age = 30;
    run.narrative.lastActObservation = { decision: "run_ended", evidence: "部曲覆灭，守边事业已经败亡", endingPolarity: "bad",
      actId: definition.mainlineActs![0].id, sourceEventId: "actual:ending", createdAt: 1 };
    let calls = 0;
    const reply = (payload: any) => {
      calls++;
      assert.ok(!payload.tools?.length);
      const full = JSON.stringify(payload);
      assert.doesNotMatch(full, /OLD_ORIGIN_SUMMARY|OLD_VERDICT|DISPLAY_SOURCE|FUTURE_ACT_SENTINEL|render_choice_prose|完成主线/);
      assert.match(full, /用一段简短的文字总结并评价本局人生/);
      assert.doesNotMatch(full, /IF 结局标准|路线结局|最新已提交处境|人生终点/);
      assert.doesNotMatch(full, /你的学习与行动方式|你的能力基础|最终属性：|名望：/);
      assert.match(full, /边地军户之子/);
      assert.match(full, /本局结束年龄：30/);
      assert.match(full, /部曲覆灭，守边事业已经败亡/);
      assert.match(full, /已确认结局：bad/);
      return apiPath === "/responses" ? { id: "ending", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "你离开了边军。这段人生留下了未竟的愿望，也留下与你同行的人。" }] }] }
        : { choices: [{ finish_reason: "stop", message: { content: "你离开了边军。这段人生留下了未竟的愿望，也留下与你同行的人。" } }] };
    };
    if (apiPath === "/responses") transport.mock.method(OpenAI.Responses.prototype, "create", async (payload: any) => reply(payload));
    else transport.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => reply(payload));
    await generateEndingNarrative(run, world, { ...context, providerConfig: { ...context.providerConfig, apiPath }, narrativePlan: buildNarrativePromptPlan(run, definition, null, "ending") });
    assert.equal(calls, 1);
  });
});
