import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { createDefaultGameplayTuning, type DifficultyConfig, type WorldConfig } from "@reroll/shared";
import { createRun, applyNarrativeRelationshipUpdates, appendPublicTurnRecord, dynamicBackgroundAttributePolicy, resolveNarrativeStatTiers } from "./engine.js";
import { loadNarrativeWorldDefinition } from "./content.js";
import { loadNarrativeStoryPack } from "./story-packs.js";
import { resolveNarrativeExperience } from "./narrative-experience.js";
import { buildNarrativePromptPlan, ensureNarrativeRunState, ensureNarrativeActRuntime, selectDynamicNarrativeContext } from "./narrative.js";
import { applyNarrativeAssetActivity, applyNarrativeAssetUpdates, narrativeAbilityDirectory, narrativeLocationDirectory, parseNarrativeAssetDeclarations, parseNarrativeContinuityAssetUpdates, publicNarrativeAssetsSnapshot } from "./narrative-assets.js";
import { applyNarrativeIdentityMerges, formatNarrativeIdentityDirectory } from "./narrative-identities.js";
import { parseRelationshipUpdates } from "./narrative-continuity.js";
import { stageNarrativeAssetRound } from "./narrative/asset-buffer.js";
import { synchronizeNarrativeAssetBatch } from "./narrative/runtime.js";
import { composeNarrativeContext } from "./narrative/context/orchestrator.js";
import { dynamicNarrativeRenderPrompt, parseNarrativeTurnPlan, prepareNarrativeOutcomeRequest, type DynamicNarrativeSceneInput, type NarrativeContext } from "./ai.js";
import type { NarrativeTurnEnvelope } from "./narrative/turn.js";

const world: WorldConfig = { id: "ancient", name: "边地", intro: "边地人生", stylePrompt: "具体叙事", milestoneAges: [], endAgeRange: { min: 90, max: 90 }, yearlyEventHints: [] };
const difficulty: DifficultyConfig = { id: "test", name: "测试", yearlyVolatility: 0, growthBias: 0, riskRewardMultiplier: 1, failurePenaltyMultiplier: 1, description: "测试" };
function makeRun() {
  const tuning = createDefaultGameplayTuning(); tuning.bootstrap.selectedCardMin = 0;
  return createRun({ world, difficulty, tuning, cards: [] }, { clientId: "asset-handoff", worldId: world.id, storyPackId: "test", difficultyId: difficulty.id,
    personaPrompt: "边地通译", talentPointTotal: 25, stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 }, selectedCardIds: [] });
}
const context: NarrativeContext = { apiKey: "mock-only", promptPack: {}, providerConfig: { provider: "openai-compatible", baseUrl: "https://example.invalid", model: "mock", apiPath: "/chat/completions", temperature: 0.7, maxTokens: 2000, timeoutMs: 1000 } };

test("三轮身份暂存经真实同步入口维护结构字段，保存后选材、正文和公开快照都读到最新内容", async (t) => {
  const run = makeRun(); run.age = 18; run.narrative.enabled = true;
  const declared = stageNarrativeAssetRound(run, { sourceEventId: "source:16", source: "scene", age: 16, subject: "抵达", narrative: "你抵达永安堡，遇见陈统领，跟随父亲学习北语。" }, {
    participants: [{ characterRef: "new", name: "陈统领", recurring: true }],
    assetUpdates: { locations: [{ ref: "new", name: "永安堡", current: true }, { ref: "new", name: "干沟旧窖" }], abilities: [{ ref: "new", name: "北语听音" }] }
  }, { age: 16 })!;
  const fort = declared.locations[0].ref, cellar = declared.locations[1].ref, skill = declared.abilities[0].ref;
  const person = run.narrative.dynamicCharacters[0].id;
  applyNarrativeRelationshipUpdates(run, [{ characterRef: person, condition: "暂被扣押", role: "军中统领" }]);
  run.narrative.assets = applyNarrativeAssetUpdates(run.narrative.assets, { abilities: [], locations: [{ ref: cellar,
    description: "荒滩旧窖", spatialDescription: "堡北干沟的沙土窖", features: [{ name: "窖内", state: "扣有三人与一头骡子" }] }] }, { age: 16 }).assets;
  const earlier = appendPublicTurnRecord(run, { entryId: "entry:16", age: 16, ageStage: { label: "少年" }, kind: "passage", narrative: "你初到边堡。", statChanges: {} });
  for (const age of [17, 18]) stageNarrativeAssetRound(run, { sourceEventId: `source:${age}`, source: "scene", age, subject: "行动", narrative: age === 18
    ? "陈统领获释，辽骑兵仍驻永安堡；俘虏与骡子已带走。桥烧毁尚未修复，无法由此渡河。你用北语辨明人数，与陈统领商议合作，尚未谈定。" : "你在堡中生活。" }, {}, { age });
  let requests = 0;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { messages: Array<{ content: string }>; tools: Array<{ function: { name: string; parameters: any } }> }) => {
    requests++;
    const prompt = payload.messages.map((message) => message.content).join("\n");
    assert.match(prompt, /source:16.*|source:18/);
    assert.match(prompt, /暂被扣押/);
    const fields = payload.tools[0].function.parameters.properties;
    assert.ok(fields.locationUpdates.items.properties.actors);
    assert.ok(fields.relationshipUpdates.items.properties.condition);
    assert.ok(fields.factIntroductions.items.properties.locationIds);
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "structured-sync", type: "function", function: {
      name: "sync_narrative_continuity", arguments: JSON.stringify({ identityMerges: [],
        relationshipUpdates: [{ characterRef: person, condition: "", description: "熟悉边地战事的军官", factionId: "ancient.military", summary: "认可你的通译本领" }],
        locationUpdates: [
          { ref: fort, description: "边防军堡", spatialDescription: "干沟南面的关堡", actors: [{ characterIds: [person], factionId: "ancient.military", organizationName: "辽骑兵", relation: "陈统领率领的边防军长期驻守" }], features: [{ name: "河桥", state: "已经烧毁，尚未修复，无法由此渡河" }] },
          { ref: cellar, parentLocationId: fort, features: [{ name: "窖内", state: "俘虏和骡子已带走，目前空置" }], actors: [] }
        ],
        abilityUpdates: [{ ref: skill, description: "听辨与理解北地语言", usage: "辨别北语口音、问答与暗语", mastery: "熟练", source: "父亲传授，随军练习" }],
        factIntroductions: [
          { kind: "experience", label: "旧窖营救已经完成", status: "finish", sourceEventId: "source:18", characterIds: [person], locationIds: [cellar], abilityIds: [skill], factionIds: ["ancient.military"] },
          { kind: "open_question", label: "两军合作尚未谈定", status: "stay", sourceEventId: "source:18", characterIds: [person], locationIds: [fort], factionIds: ["ancient.military"] }
        ], factUpdates: []
      })
    } }] } }] };
  });
  await synchronizeNarrativeAssetBatch(run, world, { ...context }, "batch", [{ id: "ancient.military", label: "边军", summary: "军镇" }]);
  assert.equal(requests, 1);
  assert.equal(run.narrative.assetBuffer, undefined);
  assert.equal(run.narrative.dynamicCharacters[0].condition, undefined);
  assert.equal(run.narrative.assets!.locations.length, 2);
  assert.equal(run.narrative.assets!.abilities[0].id, skill);
  const finished = run.story.factLedger!.facts.find((fact) => fact.label === "旧窖营救已经完成")!;
  assert.deepEqual(finished.locationIds, [cellar]);
  assert.equal(finished.resolvedAge, 18);
  assert.equal(finished.status, "resolved");
  const restored = JSON.parse(JSON.stringify(run)) as typeof run;
  restored.narrative = ensureNarrativeRunState(restored.narrative, true, 18);
  const names = { characters: restored.narrative.dynamicCharacters, factions: [{ id: "ancient.military", label: "边军" }] };
  const places = narrativeLocationDirectory(restored.narrative.assets, names);
  assert.match(places[0].label, /辽骑兵.*陈统领.*边军/);
  assert.match(places[0].label, /已经烧毁，尚未修复，无法由此渡河/);
  assert.match(places[1].label, /所属：永安堡.*目前空置/);
  assert.doesNotMatch(places[1].label, /扣有三人/);
  assert.match(narrativeAbilityDirectory(restored.narrative.assets)[0].label, /听辨与理解北地语言.*辨别北语口音/);
  assert.doesNotMatch(narrativeAbilityDirectory(restored.narrative.assets)[0].label, /父亲传授/);
  const selectedFacts = selectDynamicNarrativeContext(restored, { task: "planning", names }).facts;
  assert.match(selectedFacts.find((fact) => fact.label.startsWith("两军合作尚未谈定"))!.label, /关联：陈统领、永安堡、边军/);
  const base = (await loadNarrativeWorldDefinition("ancient"))!;
  const definition = resolveNarrativeExperience(base, (await loadNarrativeStoryPack(base, "ancient.frontier-commander"))!);
  restored.narrative = ensureNarrativeActRuntime(restored.narrative, definition, restored.age);
  const plan = buildNarrativePromptPlan(restored, definition, null, "rendering", { focusIds: [fort, person, skill], factionIds: ["ancient.military"] });
  const composed = composeNarrativeContext({ task: "rendering", plan, taskPrompt: "叙述十九岁的经历" }).renderedContext;
  assert.match(composed, /辽骑兵.*陈统领/);
  assert.match(composed, /已经烧毁，尚未修复，无法由此渡河/);
  assert.match(composed, /认可你的通译本领/);
  assert.match(composed, /北语听音（熟练）/);
  assert.doesNotMatch(composed, /父亲传授，随军练习|旧窖营救已经完成/);
  const latest = appendPublicTurnRecord(restored, { entryId: "entry:18", age: 18, ageStage: { label: "青年" }, kind: "passage", narrative: "你返回堡中。", statChanges: {} });
  assert.equal(latest.narrativeCharactersSnapshot![0].condition, undefined);
  assert.equal(latest.narrativeAssetsSnapshot!.locations[0].actors![0].organizationName, "辽骑兵");
  assert.equal(earlier.narrativeAssetsSnapshot!.locations[0].features, undefined, "后续整理不重写旧回合快照");
  assert.equal(earlier.narrativeCharactersSnapshot![0].condition, "暂被扣押");
});

test("维护的省略、替换、清除，以及归并后新增嵌套引用使用同一身份", () => {
  const run = makeRun();
  const staged = stageNarrativeAssetRound(run, { sourceEventId: "identity", source: "scene", age: 20, subject: "遇见", narrative: "你在堡中遇见陈统领。" }, {
    participants: [{ characterRef: "new", name: "陈统领", recurring: true }, { characterRef: "new", name: "陈将军", recurring: true }],
    assetUpdates: { locations: [{ ref: "new", name: "永安堡" }, { ref: "new", name: "永安军堡" }, { ref: "new", name: "旧窖" }], abilities: [] }
  }, { age: 20 })!;
  const [fort, duplicate, cellar] = staged.locations.map((entry) => entry.ref);
  const [person, alias] = run.narrative.dynamicCharacters.map((entry) => entry.id);
  const parsed = parseNarrativeContinuityAssetUpdates({ locationUpdates: [
    { ref: cellar, parentLocationId: duplicate, actors: [{ characterIds: [alias], factionId: "ancient.military", organizationName: "辽骑兵", relation: "驻防" }], features: [{ name: "入口", state: "已封闭" }] }
  ], abilityUpdates: [] }, run.narrative.assets!, { characterIds: [person, alias], factionIds: ["ancient.military"] });
  run.narrative.assets = applyNarrativeAssetUpdates(run.narrative.assets, parsed, { age: 20 }).assets;
  applyNarrativeIdentityMerges(run, [{ kind: "character", sourceRef: alias, targetRef: person }, { kind: "location", sourceRef: duplicate, targetRef: fort }]);
  const current = run.narrative.assets!.locations.find((entry) => entry.id === cellar)!;
  assert.equal(current.parentLocationId, fort);
  assert.deepEqual(current.actors![0].characterIds, [person]);
  run.narrative.assets = applyNarrativeAssetUpdates(run.narrative.assets, { locations: [{ ref: cellar, description: "堡外仓窖" }], abilities: [] }, { age: 21 }).assets;
  assert.deepEqual(run.narrative.assets.locations.find((entry) => entry.id === cellar)!.features, current.features);
  run.narrative.assets = applyNarrativeAssetUpdates(run.narrative.assets, { locations: [{ ref: cellar, parentLocationId: "", actors: [], features: [], description: "" }], abilities: [] }, { age: 22 }).assets;
  const cleared = run.narrative.assets.locations.find((entry) => entry.id === cellar)!;
  assert.equal(cleared.parentLocationId, undefined); assert.equal(cleared.description, undefined);
  assert.deepEqual(cleared.actors, []); assert.deepEqual(cleared.features, []);
  applyNarrativeRelationshipUpdates(run, parseRelationshipUpdates([{ characterRef: person, condition: "负伤", summary: "互信", role: "统领" }], [person]));
  applyNarrativeRelationshipUpdates(run, parseRelationshipUpdates([{ characterRef: person, condition: "", summary: "" }], [person]));
  assert.equal(run.narrative.dynamicCharacters[0].condition, undefined);
  assert.equal(run.narrative.dynamicCharacters[0].role, "统领");
  assert.equal(run.narrative.dynamicCharacters[0].relationship!.summary, undefined);
  assert.doesNotMatch(formatNarrativeIdentityDirectory(run.narrative), /负伤|永安军堡/);
});

test("现有用途交接按名称进入正文，正文工具仍只登记身份", () => {
  const run = makeRun();
  const envelope: NarrativeTurnEnvelope = { callId: "purpose", source: "scene", worldId: "ancient", currentAge: 20,
    backgroundAgeRange: { fromAge: 21, toAge: 21 }, act: { id: "act.one", label: "边军", prompt: "守卫边地" }, beat: "pressure",
    capabilities: ["scene", "choice"], storyPatterns: [], socialForces: [],
    focusReferences: [{ id: "ability:language", kind: "ability", label: "北语听音" }, { id: "location:fort", kind: "location", label: "永安堡" }],
    statTiers: resolveNarrativeStatTiers(run.stats), clock: { mode: "advance", sameAgeTurnCount: 0, maxSameAgeTurns: 3 } };
  const plan = parseNarrativeTurnPlan({ beatChange: "争取驻军合作抗敌", timeScope: "经过一年准备后正式商议", note: "陈统领尚未答复合作",
    conflictRefs: [], forceIds: [], abilityRefs: [{ ref: "ability:language", purpose: "用北语与当地驻军交涉" }], assetNeeds: [],
    locationDirective: { mode: "revisit", locationRef: "location:fort", purpose: "向陈统领商议抗敌" }, clockRequest: "advance" }, "plan_scene_turn", envelope);
  const input: DynamicNarrativeSceneInput = { presentation: "scene", sceneAge: 21, backgroundAgeRange: { fromAge: 21, toAge: 21 }, beat: "pressure",
    act: { id: "act.one", label: "边军", prompt: "守卫边地" }, allowedTurnKinds: ["scene"], storyPatterns: [], socialForces: [], knownCharacters: [],
    backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run), statTiers: resolveNarrativeStatTiers(run.stats),
    plan: { ...plan,
      materials: [{ id: "ability:language", kind: "ability", label: "北语听音" }, { id: "location:fort", kind: "location", label: "永安堡" }] }
  };
  const prompt = dynamicNarrativeRenderPrompt(input, 20);
  assert.match(prompt, /北语听音：用北语与当地驻军交涉/);
  assert.match(prompt, /永安堡；返回已有地点；向陈统领商议抗敌/);
  assert.ok(prompt.includes(plan.beatChange!) && prompt.includes(plan.timeScope!) && prompt.includes(plan.note!));
  assert.doesNotMatch(prompt, /ability:language|location:fort/);
  const tool = { type: "function", function: { name: "render_scene_prose", parameters: { properties: { narrative: { type: "string" } }, required: ["narrative"] } } };
  const request = prepareNarrativeOutcomeRequest(run, world, { ...context }, tool, prompt, { task: "rendering", contracts: { assets: "declarations", activity: true } });
  const fields = (request.tools[0].function as any).parameters.properties;
  assert.deepEqual(Object.keys(fields.assetUpdates.properties.abilities.items.properties).sort(), ["name", "ref"]);
  assert.equal(fields.participants.items.properties.description, undefined);
});

test("同步可仅登记新身份；后续单项改动保留其他资料与待补充状态", () => {
  const initial = parseNarrativeContinuityAssetUpdates({ locationUpdates: [{ ref: "new", name: "南渡口" }],
    abilityUpdates: [{ ref: "new", name: "操舟" }] }, { locations: [], abilities: [] });
  const assets = applyNarrativeAssetUpdates(undefined, initial, { age: 12 }).assets;
  const place = assets.locations[0], skill = assets.abilities[0];
  assert.equal(place.pendingDetails, true);
  assert.equal(skill.pendingDetails, true);
  assert.equal(skill.usage, undefined);
  const updated = applyNarrativeAssetUpdates(assets, parseNarrativeContinuityAssetUpdates({ locationUpdates: [],
    abilityUpdates: [{ ref: skill.id, mastery: "初学" }] }, assets), { age: 13 }).assets;
  assert.deepEqual(updated.locations[0], place);
  assert.equal(updated.abilities[0].id, skill.id);
  assert.equal(updated.abilities[0].mastery, "初学");
  assert.equal(updated.abilities[0].pendingDetails, true);
  assert.equal(updated.abilities[0].source, undefined);
});

test("宝物沿用本领的身份暂存、同步、恢复与召回路径，无需熟练程度且不重复登记", async (t) => {
  const run = makeRun(); run.age = 20; run.narrative.enabled = true;
  const declarations = parseNarrativeAssetDeclarations({ locations: [], abilities: [{ ref: "new", name: "破阵铜镜" }] }, { locations: [], abilities: [] });
  stageNarrativeAssetRound(run, { sourceEventId: "mirror:received", source: "scene", age: 20, subject: "取得铜镜",
    narrative: "守阵人把破阵铜镜交到你手里。你以镜光映出阵门，镜缘随即出现裂纹，暂时不能再照。" }, { assetUpdates: declarations }, { age: 20 });
  const id = run.narrative.assets!.abilities[0].id;
  assert.equal(run.narrative.assets!.abilities[0].pendingDetails, true);
  let calls = 0;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: { messages: Array<{ content: string }> }) => {
    calls++;
    assert.ok(payload.messages.some((message) => message.content.includes(id) && message.content.includes("破阵铜镜")));
    return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "mirror:sync", type: "function", function: {
      name: "sync_narrative_continuity", arguments: JSON.stringify({ identityMerges: [], relationshipUpdates: [], locationUpdates: [],
        abilityUpdates: [{ ref: id, pendingDetails: false, description: "显出阵门的铜镜", usage: "主角持有；镜缘开裂，修复前不能映照阵门" }], factIntroductions: [], factUpdates: [] })
    } }] } }] };
  });
  await synchronizeNarrativeAssetBatch(run, world, { ...context }, "mirror:batch", [], true);
  assert.equal(calls, 1);
  assert.equal(run.narrative.assetBuffer, undefined);
  const restored = JSON.parse(JSON.stringify(run)) as typeof run;
  restored.narrative = ensureNarrativeRunState(restored.narrative, true, 20);
  const mirror = restored.narrative.assets!.abilities[0];
  assert.equal(restored.narrative.assets!.abilities.length, 1);
  assert.equal(mirror.id, id);
  assert.equal(mirror.mastery, undefined);
  assert.equal(mirror.pendingDetails, false);
  assert.match(narrativeAbilityDirectory(restored.narrative.assets)[0].label, /破阵铜镜.*修复前不能映照阵门/);
  const base = (await loadNarrativeWorldDefinition("ancient"))!;
  const definition = resolveNarrativeExperience(base, (await loadNarrativeStoryPack(base, "ancient.mystic-order"))!);
  restored.narrative = ensureNarrativeActRuntime(restored.narrative, definition, restored.age);
  const act = definition.mainlineActs![0];
  const plan = parseNarrativeTurnPlan({ beatChange: "争取修复铜镜的条件", timeScope: "经过一段寻访后抵达修镜人住处", note: "尚未取得修复材料",
    conflictRefs: [], forceIds: [], abilityRefs: [{ ref: id, purpose: mirror.usage! }], assetNeeds: [], locationDirective: { mode: "stay" }, clockRequest: "advance" }, "plan_scene_turn", {
    callId: "mirror:recall", source: "scene", worldId: world.id, currentAge: 20, backgroundAgeRange: { fromAge: 21, toAge: 21 }, act, beat: "setup",
    capabilities: ["scene", "choice"], storyPatterns: [], socialForces: [], statTiers: resolveNarrativeStatTiers(restored.stats),
    focusReferences: narrativeAbilityDirectory(restored.narrative.assets).map((entry) => ({ ...entry, kind: "ability" as const })),
    clock: { mode: "advance", sameAgeTurnCount: 0, maxSameAgeTurns: 3 }
  });
  const taskPrompt = dynamicNarrativeRenderPrompt({ presentation: "scene", sceneAge: 21, backgroundAgeRange: { fromAge: 21, toAge: 21 }, act, beat: "setup",
    allowedTurnKinds: ["scene"], storyPatterns: [], socialForces: [], knownCharacters: [], backgroundAttributePolicy: dynamicBackgroundAttributePolicy(restored),
    statTiers: resolveNarrativeStatTiers(restored.stats), plan }, 20);
  const prompt = composeNarrativeContext({ task: "rendering", plan: buildNarrativePromptPlan(restored, definition, null, "rendering", { focusIds: [id] }), taskPrompt });
  assert.ok(prompt.renderedContext.includes("破阵铜镜"));
  assert.ok(prompt.renderedContext.includes(mirror.usage!), "当前条件通过召回用途交给正文，沿用现有分层而非全量回传档案");
  const reused = parseNarrativeAssetDeclarations({ locations: [], abilities: [{ ref: id }] }, restored.narrative.assets!);
  stageNarrativeAssetRound(restored, { sourceEventId: "mirror:carried", source: "scene", age: 21, subject: "带镜求修", narrative: "你带着破阵铜镜去找修镜人。" }, { assetUpdates: reused }, { age: 21 });
  restored.narrative.assets = applyNarrativeAssetActivity(restored.narrative.assets, { locationIds: [], abilityIds: [id] }, { age: 21 });
  assert.equal(restored.narrative.assets.abilities.length, 1);
  assert.deepEqual(restored.narrative.assets.abilities[0], mirror, "携带与活动不重写当前作用或虚构熟练程度");
  assert.equal(publicNarrativeAssetsSnapshot(restored.narrative.assets).abilities[0].usage, mirror.usage);
});
