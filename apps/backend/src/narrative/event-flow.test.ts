import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { createDefaultGameplayTuning, type WorldConfig, type DifficultyConfig } from "@reroll/shared";
import { createRun, advanceWithDynamicNarrativeScene, applyDirectedClosureRequest, dynamicBackgroundAttributePolicy, approveNarrativeAttributeOutcome, settleNarrativeBackgroundOutcomes, toPublicMilestoneChoice, applyDirectNarrativeDecision, completeMilestoneDecision } from "../engine.js";
import { loadNarrativeWorldDefinition } from "../content.js";
import { loadNarrativeStoryPack } from "../story-packs.js";
import { resolveNarrativeExperience } from "../narrative-experience.js";
import { ensureNarrativeActRuntime, ensureNarrativeRunState, buildNarrativePromptPlan } from "../narrative.js";
import { generateDynamicNarrativeScene, generateNarrativeActWorldCard, observeNarrativeAct, planNextEventFlow, planNextEventUnit, settleDynamicNarrativeScene, type NarrativeContext } from "../ai.js";
import { prepareChoiceCheck, rollChoice, selectDirectChoice } from "../choice-check.js";
import { currentEventFlowStep, eventFlowRoles, eventFlowRenderInput, eventFlowResult, applyEventFlowResultItems,
  availableNextEventFlows, availableNextEventUnits, validateEventFlowBindings, validateNarrativeEventFlow } from "./event-flow.js";
import { eventFlowRuntimeVersion, canAdvanceEventFlowVersion } from "./event-flow.js";
import { prepareEventFlowEntry, prepareEventFlowLifeInterval } from "./event-flow.js";
import { eventAssetCandidates, applyEventAssetChanges } from "./event-assets.js";
import { stageNarrativeAssetRound } from "./asset-buffer.js";
import { runNarrativeAgentTurn, runNarrativeAgentDecision, synchronizeNarrativeAssetBatch } from "./runtime.js";
import { commitNarrativeActOutline, parseNarrativeActWorldCard } from "./act-outline.js";
import { ensureCurrentEventFlow, finishPendingNarrativeActEvent } from "./finalization.js";
import { hostingFixture } from "./hosting-fixture.js";
import { dynamicSceneAttributePolicy } from "../engine.js";

const world: WorldConfig = { id: "ancient", name: "边境", intro: "边境", milestoneAges: [], endAgeRange: { min: 90, max: 90 }, yearlyEventHints: [] };
const difficulty: DifficultyConfig = { id: "test", name: "测试", yearlyVolatility: 0, growthBias: 0, riskRewardMultiplier: 1, failurePenaltyMultiplier: 1, description: "测试" };
const context: NarrativeContext = { apiKey: "mock-only", promptPack: {}, providerConfig: { provider: "openai-compatible", baseUrl: "https://example.invalid", model: "event-flow-test", apiPath: "/chat/completions", temperature: .7, maxTokens: 2000, timeoutMs: 1000 } };
const reply = (name: string, args: unknown) => ({ choices: [{ finish_reason: "tool_calls", message: { content: null,
  tool_calls: [{ id: name, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] });

test("生活间隔按素材选定并保存，失败重试不消耗年数，完成后不重新抽取", async () => {
  const { run } = await fixture(1, "company-training"); run.narrative.version = 20;
  const first = prepareEventFlowLifeInterval(run)!;
  assert.ok(first.remainingYears >= 3 && first.remainingYears <= 5);
  const state = structuredClone(run.narrative.eventFlow);
  assert.deepEqual(prepareEventFlowLifeInterval(run), first);
  assert.deepEqual(run.narrative.eventFlow, state);
  const restored = ensureNarrativeRunState(JSON.parse(JSON.stringify(run.narrative)), true);
  run.narrative = restored;
  assert.deepEqual(prepareEventFlowLifeInterval(run), first);
  run.age += 1;
  assert.equal(prepareEventFlowLifeInterval(run)!.remainingYears, first.remainingYears - 1);
  run.age = first.throughAge;
  assert.equal(prepareEventFlowLifeInterval(run), undefined);
  assert.equal(prepareEventFlowLifeInterval(run), undefined);
  assert.equal(currentEventFlowStep(run)!.event.id, "soldier-service");
  assert.deepEqual(run.narrative.eventFlow!.completed, []);
});

test("组前准备所经历的年份计入同一生活间隔，达标不跳过剩余生活", async () => {
  const { run } = await fixture(1, "company-training"); run.narrative.version = 20;
  const life = prepareEventFlowLifeInterval(run)!;
  assert.ok(prepareEventFlowEntry(run));
  run.age += 1;
  run.stats.physique = 30; run.stats.intelligence = 30;
  assert.equal(prepareEventFlowEntry(run), undefined);
  assert.equal(prepareEventFlowLifeInterval(run)!.remainingYears, life.remainingYears - 1);
  run.age = life.throughAge;
  assert.equal(prepareEventFlowLifeInterval(run), undefined);
});

test("连续危机的单元没有生活间隔，新单元的间隔按自身身份建立", async () => {
  const { run } = await fixture(0, "ridge-scouts"); run.narrative.version = 20;
  const discovery = prepareEventFlowLifeInterval(run)!;
  assert.ok(discovery.remainingYears);
  run.narrative.eventFlow!.eventIndex = 1;
  assert.equal(prepareEventFlowLifeInterval(run), undefined);
  assert.equal(currentEventFlowStep(run)!.event.id, "ridge-warning");
  run.narrative.eventFlow!.flowId = "formal-enlistment";
  run.narrative.eventFlow!.eventIndex = 0;
  const training = prepareEventFlowLifeInterval(run)!;
  assert.equal(training.nodeId, "recruit-training");
  assert.equal(training.fromAge, run.age);
  assert.notEqual(training.nodeId, discovery.nodeId);
});

test("生活配置拒绝倒置与小数范围，不修改没有配置间隔的旧素材", async () => {
  const { pack } = await fixture();
  const raw = structuredClone(pack.eventFlow!);
  raw.groups[0].events[0].lifeBefore = { minYears: 3, maxYears: 2, context: "日常生活" };
  assert.throws(() => validateNarrativeEventFlow(raw, pack));
  raw.groups[0].events[0].lifeBefore = { minYears: 1.5, maxYears: 2, context: "日常生活" };
  assert.throws(() => validateNarrativeEventFlow(raw, pack));
  delete raw.groups[0].events[0].lifeBefore;
  assert.ok(validateNarrativeEventFlow(raw, pack));
});

test("普通生活只写生活并结算，不执行待开始事件；两种传输的固定职责不随年龄改变", async (t) => {
  for (const apiPath of ["/chat/completions", "/responses"] as const) await t.test(apiPath, async (t) => {
    const { run, definition, act } = await fixture(1, "company-training"); run.narrative.version = 20;
    const step = currentEventFlowStep(run)!;
    if (step.event.kind !== "life") throw new Error("fixture_kind_invalid");
    step.event.outcome.result = "UNSTARTED_EVENT_RESULT";
    const before = structuredClone({ completed: run.narrative.eventFlow!.completed, items: run.items });
    const captures: any[] = [], calls: string[] = [];
    const respond = async (payload: any) => {
      const tool = payload.tools[0].function ?? payload.tools[0]; calls.push(tool.name);
      const args = tool.name === "render_background_prose"
        ? { narrative: "你照常轮值，与家人往来，日子平静。" }
        : { effects: [{ stat: "physique", direction: "up", band: "light" }] };
      assert.ok(["render_background_prose", "resolve_background_outcome"].includes(tool.name));
      assert.ok(!JSON.stringify(payload).includes("UNSTARTED_EVENT_RESULT"));
      if (tool.name === "render_background_prose") captures.push(payload);
      return apiPath === "/responses" ? { output: [{ type: "function_call", name: tool.name, arguments: JSON.stringify(args), call_id: "life" }] }
        : reply(tool.name, args);
    };
    if (apiPath === "/responses") t.mock.method(OpenAI.Responses.prototype, "create", respond);
    else t.mock.method(OpenAI.Chat.Completions.prototype, "create", respond);
    for (const age of [20, 22]) {
      run.age = age;
      const envelope = { callId: "life:" + age, source: "background", worldId: run.worldId, currentAge: age,
        backgroundAgeRange: { fromAge: age + 1, toAge: age + 2 }, act, capabilities: ["background"],
        storyPatterns: [], socialForces: [], focusReferences: [], statTiers: {},
        preparation: { mode: "life_interval", context: "照常轮值，与家人生活。", deficits: [] },
        clock: { ...run.narrative.sceneClock } } as any;
      const result = await runNarrativeAgentTurn({ run, world, narrativeWorld: definition,
        context: { ...context, providerConfig: { ...context.providerConfig, apiPath } }, envelope,
        buildRenderInput: () => ({ act, presentation: "summary", allowedTurnKinds: ["background"],
          socialForces: [], storyPatterns: [], knownCharacters: [], knownFactIds: [],
          preparation: envelope.preparation, statTiers: envelope.statTiers,
          backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run) }) });
      assert.equal(result.scene.turnKind, "background");
      assert.equal(result.scene.flowSource, undefined);
      assert.equal(run.pendingActFinalization, undefined);
      assert.deepEqual({ completed: run.narrative.eventFlow!.completed, items: run.items }, before);
    }
    assert.deepEqual(calls, ["render_background_prose", "resolve_background_outcome", "render_background_prose", "resolve_background_outcome"]);
    const system = (payload: any) => payload.instructions ?? payload.messages.filter((message: any) => message.role === "system");
    assert.deepEqual(system(captures[0]), system(captures[1]));
    assert.deepEqual(captures[0].tools, captures[1].tools);
    assert.match(JSON.stringify(captures[0]), /这一阶段的普通生活/);
  });
});

test("组前准备分别检查属性，入组后属性下降不打断，下一组重新准备", async () => {
  const { run } = await fixture(1, "company-training"); run.narrative.version = 20;
  const first = prepareEventFlowEntry(run)!;
  assert.equal(first.flowId, "company-training");
  assert.ok(first.deficits.some((entry) => entry.stat === "physique"));
  const requirements = run.storyPackSnapshot!.eventFlow!.groups.find(group => group.id === "company-training")!.entryRequirements!;
  run.stats.physique = requirements.physique!; run.stats.intelligence = requirements.intelligence!;
  assert.equal(prepareEventFlowEntry(run), undefined);
  run.stats.physique = 1;
  assert.equal(prepareEventFlowEntry(run), undefined);
  run.narrative.eventFlow!.flowId = "border-campaign";
  assert.equal(prepareEventFlowEntry(run)!.flowId, "border-campaign");
  assert.deepEqual(JSON.parse(JSON.stringify(run)).narrative.eventFlow.admittedFlows, ["company-training"]);
});

test("普通年份中度成长按实际年度结算，场景和旧运行版收益不随之放大", async () => {
  const { run } = await fixture(1, "company-training"); run.narrative.version = 20; run.age = 18;
  const policy = dynamicBackgroundAttributePolicy(run);
  const effects = [{ stat: "intelligence" as const, direction: "up" as const, band: "medium" as const }];
  assert.equal(approveNarrativeAttributeOutcome(run, world, { effects }, "background", policy)!.intelligence, 2);
  assert.equal(approveNarrativeAttributeOutcome(run, world, { effects }, "background", dynamicSceneAttributePolicy())!.intelligence, 1);
  const original = run.stats.intelligence;
  const ages = [16, 17, 18];
  run.history = ages.map(age => ({ age, title: "普通生活", summary: "操练与学习", statChanges: {}, tags: [] }));
  assert.equal(settleNarrativeBackgroundOutcomes(run, world, ages.map(age => ({ age, effects })), ages, new Map(ages.map(age => [age, policy]))), true);
  assert.equal(run.stats.intelligence, original + 6);
  run.narrative.version = 18;
  assert.equal(approveNarrativeAttributeOutcome(run, world, { effects }, "background", dynamicBackgroundAttributePolicy(run))!.intelligence, 1);
});

test("身世只登记预设身份，首次即以零岁登记；角色卡不接收经历或使用指导", async () => {
  const { run } = await fixture(); run.narrative.version = 20;
  run.narrative.eventFlow = { actId: run.narrative.actRuntime!.actId, eventIndex: 0,
    bindings: Object.fromEntries(run.storyPackSnapshot!.eventFlow!.originRoles!.map((id) => [id, "身世" + id])), completed: [], completedFlows: [] };
  stageNarrativeAssetRound(run, { sourceEventId: "origin", source: "origin", age: 0, subject: "身世", narrative: "你生于边地军户。" }, {}, { age: 0 });
  assert.equal(run.narrative.dynamicCharacters.length, 3);
  assert.ok(run.narrative.dynamicCharacters.every((entry) => entry.introducedAge === 0 && entry.condition === undefined));
  assert.equal(run.narrative.assets!.abilities[0].usage, undefined);
  assert.equal(run.narrative.assets!.abilities[0].source, undefined);
  assert.throws(() => applyEventAssetChanges(run, run.narrative.assetBuffer!, {
    introductions: [{ roleId: "father", condition: "曾在城头守夜" }], updates: []
  }));
});

test("预设资产之外的正文登记不入库；同步仅接收本组候选，整批校验失败不部分写入", async () => {
  const { run } = await fixture(1, "company-training"); run.narrative.version = 20;
  currentEventFlowStep(run);
  stageNarrativeAssetRound(run, { sourceEventId: "preset-test", source: "scene", age: 22,
    subject: "练兵", narrative: "你与伙伴完成长枪操练。" }, {
    participants: [{ name: "临时路人" } as any], assetUpdates: { locations: [], abilities: [{ ref: "new:绳结诀窍", name: "绳结诀窍" }] }
  }, { age: 22 });
  assert.equal(run.narrative.dynamicCharacters.length, 0);
  assert.equal(run.narrative.assets?.abilities.length ?? 0, 0);
  const batch = run.narrative.assetBuffer!;
  assert.equal(batch.rounds[0].flowId, "company-training");
  assert.ok(!eventAssetCandidates(run, batch).some((entry) => entry.id === "enemyCommander"));
  const before = JSON.stringify(run);
  assert.throws(() => applyEventAssetChanges(run, batch, { introductions: [
    { roleId: "spear" }, { roleId: "invented", name: "新诀窍" }
  ], updates: [] }), /scope_invalid/);
  assert.equal(JSON.stringify(run), before);
  assert.ok(applyEventAssetChanges(run, batch, { introductions: [{ roleId: "spear" }], updates: [] }));
  assert.ok(applyEventAssetChanges(run, batch, { introductions: [], updates: [{ roleId: "spear", mastery: "熟练" }] }));
  assert.equal(run.narrative.assets!.abilities[0].name, "实名spear");
  assert.equal(applyEventAssetChanges(run, batch, { introductions: [], updates: [{ roleId: "spear", mastery: "熟练" }] }), false);
  assert.throws(() => applyEventAssetChanges(run, batch, { introductions: [], updates: [{ roleId: "spear", mastery: "二十岁与伙伴操练后懂得分路传警" }] }));
  assert.throws(() => applyEventAssetChanges(run, batch, { introductions: [], updates: [{ roleId: "spear", usage: "先检查绳结，再调整队形" }] }));
  assert.throws(() => applyEventAssetChanges(run, batch, { introductions: [], updates: [{ roleId: "spear", condition: "负伤" }] }));
  assert.ok(applyEventAssetChanges(run, batch, { introductions: [{ roleId: "pass" }], updates: [{ roleId: "pass", condition: "可用", current: true, retired: true }] }));
  assert.equal(run.narrative.assets!.currentLocationId, "event-asset:pass");
  assert.equal(run.narrative.assets!.locations[0].retired, false, "当前所在地保留最简身份");
  assert.throws(() => applyEventAssetChanges(run, batch, { introductions: [], updates: [{ roleId: "pass", current: true }, { roleId: "pass", current: false }] }), /duplicate_operation/);
});

test("新版正文不被追加登记工具，展示同步仅供应预设身份；两种 provider 同样生效", async (t) => {
  for (const apiPath of ["/chat/completions", "/responses"] as const) await t.test(apiPath, async (t) => {
    const { run, definition, act } = await fixture(1, "company-training"); run.narrative.version = 20;
    const step = currentEventFlowStep(run)!;
    let sync = false;
    const syncRequests: any[] = [];
    const respond = (payload: any) => {
      const tools = payload.tools.map((entry: any) => entry.function ?? entry);
      const tool = tools[0];
      if (sync) {
        syncRequests.push(payload);
        assert.equal(tool.name, "sync_event_assets");
        assert.deepEqual(tool.parameters.required, ["introductions", "updates"]);
        assert.ok(!JSON.stringify(payload).includes("本轮身份目录"));
      } else {
        for (const name of ["participants", "assetUpdates", "assetActivity"]) assert.ok(!(name in tool.parameters.properties));
      }
      const args = sync ? syncRequests.length === 1
        ? { introductions: [{ roleId: "spear" }], updates: [] }
        : { introductions: [], updates: [{ roleId: "spear", mastery: "熟练" }] }
        : { narrative: "你挥动长枪，带同伍练习接敌。", nextClock: "hold" };
      return apiPath === "/responses" ? { output: [{ type: "function_call", name: tool.name, arguments: JSON.stringify(args), call_id: "preset" }] }
        : reply(tool.name, args);
    };
    if (apiPath === "/responses") t.mock.method(OpenAI.Responses.prototype, "create", async (payload: any) => respond(payload));
    else t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => respond(payload));
    const ctx = { ...context, providerConfig: { ...context.providerConfig, apiPath }, narrativePlan: buildNarrativePromptPlan(run, definition, null, "rendering")! };
    const prose = await generateDynamicNarrativeScene(run, world, { act, presentation: "scene", allowedTurnKinds: ["scene"],
      sceneAge: run.age, backgroundAgeRange: { fromAge: run.age, toAge: run.age }, socialForces: [], storyPatterns: [],
      knownCharacters: [], knownFactIds: [], flowEvent: eventFlowRenderInput(run, step) } as any, ctx);
    assert.deepEqual(prose.participants, []);
    stageNarrativeAssetRound(run, { sourceEventId: "preset", source: "scene", age: 20, subject: "操练", narrative: prose.narrative }, prose, { age: 20 });
    sync = true;
    assert.equal((await synchronizeNarrativeAssetBatch(run, world, ctx, "sync", [], true)).status, "requested_changed");
    assert.equal(run.narrative.assets!.abilities.length, 1);
    assert.equal(run.narrative.assetBuffer, undefined);
    run.age = 23;
    stageNarrativeAssetRound(run, { sourceEventId: "preset-later", source: "scene", age: 23,
      subject: "接敌", narrative: "你在实战后已经熟练掌握长枪与盾阵。" }, {}, { age: 23 });
    await synchronizeNarrativeAssetBatch(run, world, ctx, "sync-later", [], true);
    assert.equal(run.narrative.assets!.abilities[0].mastery, "熟练");
    const system = (payload: any) => apiPath === "/responses" ? payload.instructions : payload.messages.filter((entry: any) => entry.role === "system");
    assert.deepEqual(system(syncRequests[0]), system(syncRequests[1]));
    assert.deepEqual(syncRequests[0].tools, syncRequests[1].tools, "候选登记、现状和年龄变化不改工具 schema");
    assert.ok(!JSON.stringify(syncRequests[0].tools).includes("event-asset:spear"));
  });
});

async function fixture(actIndex = 0, flowId?: string, packId = "ancient.frontier-commander", currentProtocol = false) {
  const base = (await loadNarrativeWorldDefinition("ancient"))!, pack = (await loadNarrativeStoryPack(base, packId))!;
  // Existing v19/v20 tests exercise the legacy router. New-protocol tests below
  // keep the published entries and continuations and run as v22.
  if (!currentProtocol && packId === "ancient.frontier-commander") {
    delete pack.eventFlow!.protocolVersion;
    delete pack.eventFlow!.actEntries;
    for (const group of pack.eventFlow!.groups) for (const node of group.events) {
      const results = node.kind === "choice" ? node.options.flatMap(option => [option.success, option.failure])
        : node.kind === "decision" ? node.options.map(option => option.outcome) : node.kind === "settlement" ? node.rules : [node.outcome];
      for (const result of results) { delete result.nextEventIds; delete result.nextFlowIds; }
    }
  }
  const definition = resolveNarrativeExperience(base, pack), tuning = createDefaultGameplayTuning(); tuning.bootstrap.selectedCardMin = 0;
  const run = createRun({ world, difficulty, tuning, cards: [], narrativeEnabled: true, storyPack: pack }, {
    clientId: "flow-test", worldId: world.id, storyPackId: pack.id, difficultyId: difficulty.id, personaPrompt: "军户孩子",
    talentPointTotal: 25, stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 }, selectedCardIds: [] });
  run.age = 20; run.narrative.version = currentProtocol ? 22 : 19;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, 20);
  const act = definition.mainlineActs![actIndex];
  run.narrative.actRuntime!.actId = act.id; run.narrative.actRuntime!.admittedAtAge = 20;
  const groups = pack.eventFlow!.groups.filter(group => group.actIds.includes(act.id));
  commitNarrativeActOutline(run.narrative, parseNarrativeActWorldCard({ ...hostingFixture(),
    flowBindings: eventFlowRoles(pack.eventFlow!, act.id).map(role => ({ roleId: role.id, name: "实名" + role.id }))
  }, act.id, { objective: act.objective!, closureMeaning: act.closureMeaning! }));
  run.narrative.eventFlow = { actId: act.id, eventIndex: 0, bindings: {},
    flowId: flowId ?? groups[0].id, completed: [], completedFlows: [] };
  return { run, definition, act, pack };
}

test("协议能力决定运行版本，两条样本旧局只读，其他路线保留旧协议", async () => {
  const base = (await loadNarrativeWorldDefinition("ancient"))!;
  for (const id of ["ancient.frontier-commander", "ancient.sovereign-rise"]) {
    const pack = (await loadNarrativeStoryPack(base, id))!;
    assert.equal(pack.eventFlow!.protocolVersion, 2);
    assert.equal(eventFlowRuntimeVersion(pack.eventFlow), 22);
    for (const old of [18, 19, 20, 21]) assert.equal(canAdvanceEventFlowVersion(old, pack.eventFlow), false);
    assert.equal(canAdvanceEventFlowVersion(22, pack.eventFlow), true);
    const renamed = structuredClone(pack.eventFlow!); renamed.id = "another-world.another-story";
    assert.ok(validateNarrativeEventFlow(renamed, { ...pack, id: renamed.id, eventFlowId: renamed.id }));
    assert.equal(eventFlowRuntimeVersion(renamed), 22);
    delete renamed.actEntries;
    assert.throws(() => validateNarrativeEventFlow(renamed, { ...pack, id: renamed.id, eventFlowId: renamed.id }), /act_entry_missing/);
  }
  const legacy = (await loadNarrativeStoryPack(base, "ancient.jianghu-master"))!;
  assert.equal(eventFlowRuntimeVersion(legacy.eventFlow), 20);
  assert.equal(canAdvanceEventFlowVersion(20, legacy.eventFlow), true);
  assert.equal(canAdvanceEventFlowVersion(18), true);
});

test("边境非授将结果接直接去留，不抽取晋升补考或其他全幕单元", async () => {
  const { run, pack } = await fixture(1, "border-campaign", "ancient.frontier-commander", true);
  const state = run.narrative.eventFlow!;
  const group = pack.eventFlow!.groups.find(group => group.id === state.flowId)!;
  state.eventIndex = group.events.findIndex(node => node.id === "general-commission");
  const step = currentEventFlowStep(run)!;
  for (const outcome of ["settlement:retain-command", "settlement:reduce-command"]) {
    state.completed = [{ sourceEventId: outcome, actId: state.actId, flowId: group.id, nodeId: step.event.id, outcome, age: run.age }];
    assert.equal(eventFlowResult(run, outcome).endsFlow, undefined);
    assert.deepEqual(availableNextEventUnits(run, step).map(node => node.id), ["service-direction"]);
  }
  state.eventIndex = group.events.findIndex(node => node.id === "service-direction");
  state.completed.push({ sourceEventId: "leave", actId: state.actId, flowId: group.id, nodeId: "service-direction", outcome: "decision:leave", age: run.age });
  assert.deepEqual(availableNextEventFlows(run).map(group => group.id), ["retired-life"]);
  const input = eventFlowRenderInput(run, currentEventFlowStep(run)!);
  assert.equal(input.kind, "decision");
  assert.ok(!JSON.stringify(input).includes("nextFlowIds"));
  assert.ok(!JSON.stringify(input).includes("归乡后的生活尚待展开"), "未选结果不提前发送正文");
});

test("边境直接去留保存恢复后无掷点，接受现职换幕，离军接生活", async t => {
  for (const selected of ["remain", "leave"] as const) await t.test(selected, async t => {
    const { run, definition, pack } = await fixture(1, "border-campaign", "ancient.frontier-commander", true);
    const flow = pack.eventFlow!.groups.find(group => group.id === "border-campaign")!;
    run.narrative.eventFlow!.eventIndex = flow.events.findIndex(node => node.id === "service-direction");
    const step = currentEventFlowStep(run)!;
    advanceWithDynamicNarrativeScene(run, world, definition, { patternIds: [], forceIds: [], participants: [],
      narrative: "你已留任校尉，面对继续服役与交接离军的去留。", createsDecision: true,
      eventFlow: { flowId: flow.id, eventIndex: step.eventIndex, nodeId: step.event.id, outcome: "pending" } });
    const choice = toPublicMilestoneChoice(run)!;
    assert.equal(choice.mode, "direct"); assert.equal(choice.check, undefined);
    assert.ok(choice.options.every(option => option.probability === undefined));
    selectDirectChoice(run, selected);
    const restored = JSON.parse(JSON.stringify(run)) as typeof run;
    restored.narrative = ensureNarrativeRunState(restored.narrative, true);
    selectDirectChoice(restored, selected); assert.equal(restored.choiceExecution!.roll, undefined);
    restored.choiceExecution!.outcome = { narrative: selected === "remain" ? "你接受校尉现职继续服役。" : "你已交清军职离军，归乡生活尚未展开。",
      effects: [], nextClock: "hold", assetActivity: { locationIds: [], abilityIds: [] } };
    const options = { narrative: restored.choiceExecution!.outcome.narrative, narrativeOutcome: { effects: [] }, narrativeWorld: definition, deferCompletion: true };
    const committed = applyDirectNarrativeDecision(restored, world, selected, options);
    completeMilestoneDecision(restored, committed.decisionEvent, committed.sourceEventId, [], { narrativeWorld: definition });
    t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
      assert.equal(payload.tools[0].function.name, "observe_act_closure", "单候选不额外请求路由");
      return reply("observe_act_closure", selected === "remain" ? { decision: "act_closed", evidence: "带队实践及军议已完成，你接受现职继续服役。" } : { decision: "ongoing", evidence: "" });
    });
    await finishPendingNarrativeActEvent(restored, world, definition, context, async () => {});
    assert.equal(restored.narrative.sceneClock.mode, "hold");
    assert.equal(restored.pendingActFinalization, undefined);
    if (selected === "remain") assert.equal(restored.narrative.actRuntime!.actId, pack.acts[2].id);
    else assert.equal(currentEventFlowStep(restored)!.flow.id, "retired-life");
    assert.equal(restored.narrative.eventFlow!.ending, undefined);
  });
});

test("战后去向、失败后续和交图使用显式接续，退役生活共享且不重置前情", async () => {
  const { run, pack } = await fixture(2, "postwar-direction", "ancient.frontier-commander", true);
  const state = run.narrative.eventFlow!;
  for (const [outcome, next] of [["decision:serve", "peace-service"], ["decision:retire", "retired-life"]]) {
    state.completed = [{ sourceEventId: outcome, actId: state.actId, flowId: state.flowId!, nodeId: "postwar-choice", outcome, age: run.age }];
    assert.deepEqual(availableNextEventFlows(run).map(group => group.id), [next]);
  }
  state.flowId = "decisive-frontier-war"; state.eventIndex = 1;
  state.completed = [{ sourceEventId: "war-failure", actId: state.actId, flowId: state.flowId, nodeId: "war-decision", outcome: "balanced:failure", age: run.age }];
  assert.deepEqual(availableNextEventFlows(run).map(group => group.id), ["last-frontier-line"]);
  assert.deepEqual(eventFlowResult(run, "risky:failure").nextFlowIds, []);
  const retired = pack.eventFlow!.groups.find(group => group.id === "retired-life")!;
  assert.deepEqual(retired.actIds, [pack.acts[1].id, pack.acts[2].id]);
  state.flowId = "retired-life"; state.eventIndex = 1;
  const before = structuredClone(state.completed);
  assert.ok(prepareEventFlowLifeInterval(run)!.remainingYears >= 6);
  assert.deepEqual(state.completed, before);
  assert.ok(!pack.eventFlow!.groups.find(group => group.id === "invasion-arrival")!.requiresItems?.includes("command-banner"));
  assert.ok(!pack.eventFlow!.groups.find(group => group.id === "invasion-arrival")!.entry.includes("已经实际成为将军"));
});

test("生活请求同时标出保存的整个间隔与本次覆盖，动态区间不改变职责", async t => {
  const { run, definition, act } = await fixture(1, "company-training", "ancient.frontier-commander", true);
  const captures: any[] = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
    captures.push(payload);
    return reply("render_background_prose", { narrative: "你照常服役，与亲友相处。" });
  });
  for (const range of [{ fromAge: 21, toAge: 23 }, { fromAge: 24, toAge: 25 }]) {
    const input: any = { act, presentation: "summary", sceneAge: range.toAge, backgroundAgeRange: range,
      socialForces: [], storyPatterns: [],
      preparation: { mode: "life_interval", context: "以实际军职服役，与同伍和亲友生活。", lifeRange: { fromAge: 20, throughAge: 25 }, deficits: [] },
      statTiers: {}, backgroundAttributePolicy: {}, allowedTurnKinds: ["background"] };
    await generateDynamicNarrativeScene(run, world, input, { ...context,
      narrativePlan: buildNarrativePromptPlan(run, definition, null, "background") });
  }
  for (const [index, capture] of captures.entries()) {
    const tasks = capture.messages.filter((message: any) => message.content?.startsWith("【当前任务】"));
    assert.equal(tasks.length, 1);
    const text = tasks[0].content;
    assert.ok(text.includes(index === 0 ? "整段普通生活：20—25岁；本次覆盖：21—23岁" : "整段普通生活：20—25岁；本次覆盖：24—25岁"));
    assert.ok(!text.includes("本段年龄区间"));
    assert.ok(!text.includes("本段结果"));
  }
  assert.equal(captures.length, 2);
  assert.deepEqual(captures[0].messages.filter((message: any) => message.role === "system"), captures[1].messages.filter((message: any) => message.role === "system"));
  assert.deepEqual(captures[0].tools, captures[1].tools);
});

test("显式后续不被观察器换幕或提前总结跳过，真实败局仍能结束", async t => {
  for (const decision of ["act_closed", "run_ended", "defeat"] as const) await t.test(decision, async t => {
    const { run } = await fixture(0, "border-childhood", "ancient.frontier-commander", true);
    const captures: any[] = [];
    t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
      captures.push(payload);
      return reply("observe_act_closure", captures.length > 1 ? { decision: "ongoing", evidence: "" }
        : decision === "act_closed" ? { decision, evidence: "童年阶段结束。" }
        : { decision: "run_ended", evidence: decision === "defeat" ? "主角实际战死。" : "可以总结人生。",
          endingPolarity: decision === "defeat" ? "bad" : "normal", lifeStatus: decision === "defeat" ? "dead" : "alive",
          ...(decision === "defeat" ? { deathCause: "战死" } : {}) });
    });
    const observation = await observeNarrativeAct(run, world, { callId: decision, actId: run.narrative.actRuntime!.actId,
      sourceEventId: "closure-test", recentStory: "主角实际已经发生的经历。", outline: run.narrative.actRuntime!.outline!,
      eventFlow: { id: "group", label: "本组", narrativeRole: "成长", result: "本组实际结果" }, actContinuationPending: true }, context);
    assert.equal(observation.decision, decision === "defeat" ? "run_ended" : "ongoing");
    assert.equal(captures.length, decision === "defeat" ? 1 : 2);
    if (captures.length === 2) {
      assert.deepEqual(captures[0].tools, captures[1].tools);
      assert.deepEqual(captures[0].messages.filter((message: any) => message.role === "system"), captures[1].messages.filter((message: any) => message.role === "system"));
    }
  });
});

test("布衣直接选择不检定，保存恢复后只提交一次并承接同年下一单元", async (t) => {
  const { run, definition } = await fixture(0, "join-rebels", "ancient.sovereign-rise");
  run.narrative.version = 21;
  run.narrative.eventFlow!.eventIndex = 1;
  const step = currentEventFlowStep(run)!;
  advanceWithDynamicNarrativeScene(run, world, definition, { patternIds: [], forceIds: [], participants: [],
    narrative: "三支人马向你说明各自收留条件。", createsDecision: true,
    eventFlow: { flowId: step.flow.id, eventIndex: step.eventIndex, nodeId: step.event.id, outcome: "pending" } });
  const choice = toPublicMilestoneChoice(run)!;
  assert.equal(choice.mode, "direct");
  assert.equal(choice.check, undefined);
  assert.ok(choice.options.every(option => option.probability === undefined));
  selectDirectChoice(run, "provisioned");
  const restored = JSON.parse(JSON.stringify(run)) as typeof run;
  restored.narrative = ensureNarrativeRunState(restored.narrative, true);
  selectDirectChoice(restored, "provisioned");
  assert.equal(restored.choiceExecution!.roll, undefined);
  assert.throws(() => selectDirectChoice(restored, "disciplined"), /decision_already_selected/);
  assert.throws(() => rollChoice(restored, "safe"));
  restored.choiceExecution!.outcome = { narrative: "你接受粮械充足的队伍收留，旧人按约接受调遣。", effects: [], nextClock: "hold", assetActivity: { locationIds: [], abilityIds: [] } };
  const options = { narrative: restored.choiceExecution!.outcome!.narrative, narrativeOutcome: { effects: [] }, narrativeWorld: definition, deferCompletion: true };
  const committed = applyDirectNarrativeDecision(restored, world, "provisioned", options);
  const count = restored.history.length;
  assert.deepEqual(applyDirectNarrativeDecision(restored, world, "provisioned", options).sourceEventId, committed.sourceEventId);
  assert.equal(restored.history.length, count);
  completeMilestoneDecision(restored, committed.decisionEvent, committed.sourceEventId, [], { narrativeWorld: definition });
  assert.equal(restored.pendingActFinalization!.eventFlow!.outcome, "decision:provisioned");
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async () => { throw new Error("singleton_must_not_request"); });
  await finishPendingNarrativeActEvent(restored, world, definition, context, async () => {});
  assert.equal(currentEventFlowStep(restored)!.event.id, "join-life");
  assert.equal(restored.narrative.sceneClock.mode, "hold");
  assert.equal(restored.pendingActFinalization, undefined);
});

test("布衣结果限制接续范围：失败进入重整，留守不能回到入京候选", async () => {
  const { run, pack } = await fixture(0, "self-rise", "ancient.sovereign-rise");
  run.narrative.version = 21;
  const state = run.narrative.eventFlow!;
  state.eventIndex = 1;
  state.completed.push({ flowId: "self-rise", nodeId: "rise-choice", outcome: "balanced:failure", sourceEventId: "failed", actId: state.actId, age: run.age });
  assert.deepEqual(availableNextEventFlows(run).map(group => group.id), ["scattered-band"]);
  state.actId = pack.acts[2].id; run.narrative.actRuntime!.actId = state.actId;
  state.flowId = "future-road"; state.eventIndex = 0;
  state.completed.push({ flowId: "future-road", nodeId: "future-choice", outcome: "decision:west", sourceEventId: "west", actId: state.actId, age: run.age });
  assert.deepEqual(availableNextEventFlows(run).map(group => group.id), ["western-settlement"]);
  Object.assign(state.bindings, Object.fromEntries(eventFlowRoles(pack.eventFlow!, state.actId).map(role => [role.id, "实名" + role.id])));
  const future = eventFlowRenderInput(run, currentEventFlowStep(run)!);
  assert.equal(future.options!.length, 2);
  assert.ok(!JSON.stringify(future).includes("nextFlowIds"));
  const bad = structuredClone(pack.eventFlow!);
  bad.actEntries![state.actId] = ["nonexistent"];
  assert.throws(() => validateNarrativeEventFlow(bad, pack));
});

test("区域战果只接权力安排，受挫后守住剩余力量才接去向", async () => {
  const { run, pack } = await fixture(1, "fight-warlord", "ancient.sovereign-rise", true);
  const state = run.narrative.eventFlow!;
  state.eventIndex = 2;
  state.completed.push({ flowId: state.flowId!, nodeId: "warlord-return", outcome: "experience", sourceEventId: "remaining-base", actId: state.actId, age: run.age });
  assert.deepEqual(availableNextEventFlows(run).map(group => group.id), ["regional-lord"]);
  state.flowId = "regional-lord";
  state.eventIndex = pack.eventFlow!.groups.find(group => group.id === state.flowId)!.events.findIndex(node => node.id === "regional-aftermath");
  state.completed.push({ flowId: state.flowId!, nodeId: "regional-aftermath", outcome: "experience", sourceEventId: "regional-result", actId: state.actId, age: run.age });
  assert.deepEqual(availableNextEventFlows(run), [], "一方成果成立后不降格为残部或回抽扩张");
  state.completed = [];
  state.flowId = "lost-territory";
  state.eventIndex = pack.eventFlow!.groups.find(group => group.id === state.flowId)!.events.findIndex(node => node.id === "lost-return");
  state.completed.push({ flowId: state.flowId!, nodeId: "lost-return", outcome: "experience", sourceEventId: "preserved-base", actId: state.actId, age: run.age });
  assert.deepEqual(availableNextEventFlows(run).map(group => group.id), ["reduced-future"]);
  state.flowId = "reduced-future"; state.eventIndex = 0;
  const local = eventFlowResult(run, "decision:local");
  assert.deepEqual(local.nextEventIds, ["reduced-local-life"]);
  assert.equal(local.grantItems, undefined);
  assert.deepEqual(eventFlowResult(run, "decision:last-campaign").nextEventIds, ["reduced-breakout"]);
  assert.deepEqual(eventFlowResult(run, "decision:submit").nextFlowIds, []);
  state.completed.push({ flowId: state.flowId, nodeId: "reduced-choice", outcome: "decision:local", sourceEventId: "local-choice", actId: state.actId, age: run.age });
  assert.deepEqual(availableNextEventUnits(run, currentEventFlowStep(run)!).map(node => node.id), ["reduced-local-life"]);
  state.eventIndex = 1;
  for (const option of ["safe", "balanced", "risky"]) {
    const failed = eventFlowResult(run, option + ":failure");
    assert.equal(failed.endsFlow, true);
    assert.deepEqual(failed.nextFlowIds, []);
    assert.equal(failed.grantItems, undefined);
  }
});

test("最后突破取得区域后只接尚未处理的一方政治安排，不重问已完成选择", async () => {
  const { run } = await fixture(1, "reduced-future", "ancient.sovereign-rise");
  run.narrative.version = 21;
  const state = run.narrative.eventFlow!;
  state.completed.push({ flowId: state.flowId!, nodeId: "reduced-aftermath", outcome: "experience",
    sourceEventId: "new-region", actId: state.actId, age: run.age });
  assert.deepEqual(availableNextEventFlows(run).map(group => group.id), ["regional-lord"]);
  state.completedFlows.push({ flowId: "regional-lord", sourceEventId: "prior-arrangement", actId: state.actId });
  assert.deepEqual(availableNextEventFlows(run), []);
});

test("京畿失利后保住地方与基业覆亡分流，只有保全分支继续交接生活", async () => {
  const { run } = await fixture(2, "last-stand", "ancient.sovereign-rise");
  run.narrative.version = 21;
  const state = run.narrative.eventFlow!;
  state.eventIndex = 1;
  assert.deepEqual(eventFlowResult(run, "settlement:line-preserved").nextEventIds, ["last-aftermath"]);
  for (const rule of ["line-broken", "line-extinguished"]) {
    const result = eventFlowResult(run, "settlement:" + rule);
    assert.equal(result.endsFlow, true);
    assert.deepEqual(result.nextFlowIds, []);
    assert.equal(result.nextEventIds, undefined);
  }
  state.eventIndex = 2;
  state.completed.push({ flowId: state.flowId!, nodeId: "last-aftermath", outcome: "experience", sourceEventId: "preserved", actId: state.actId, age: run.age });
  assert.deepEqual(availableNextEventFlows(run).map(group => group.id), ["western-succession"]);
});

test("夺宫不发帝印或跳到新朝，天下行动及失利后不同战事分别接实际处置", async () => {
  const { run, pack } = await fixture(2, "decisive-capital", "ancient.sovereign-rise", true);
  const state = run.narrative.eventFlow!;
  const group = pack.eventFlow!.groups.find(group => group.id === state.flowId)!;
  const at = (id: string) => { state.eventIndex = group.events.findIndex(node => node.id === id); assert.ok(state.eventIndex >= 0); };
  at("capital-reckoning");
  const capital = eventFlowResult(run, "settlement:capital-held");
  assert.deepEqual(capital.nextEventIds, ["realm-front"]);
  assert.equal(capital.grantItems, undefined);
  at("realm-campaign");
  for (const option of ["safe", "balanced", "risky"]) {
    assert.deepEqual(eventFlowResult(run, option + ":success").nextEventIds, ["realm-reckoning"]);
    assert.deepEqual(eventFlowResult(run, option + ":failure").nextEventIds, ["realm-reverse"]);
  }
  at("realm-reverse");
  assert.deepEqual(eventFlowResult(run, "experience").nextEventIds, ["realm-counterstroke"]);
  at("realm-counterstroke");
  assert.deepEqual(eventFlowResult(run, "safe:failure").nextFlowIds, ["last-stand"]);
  at("realm-reckoning");
  for (const rule of ["campaign-won", "core-defended"]) {
    assert.deepEqual(eventFlowResult(run, "settlement:" + rule).nextEventIds, ["realm-foundation"]);
  }
  at("realm-foundation");
  const result = eventFlowResult(run, "settlement:throne-established");
  assert.equal(result.endsFlow, undefined);
  assert.deepEqual(result.nextEventIds, ["new-court"]);
  applyEventFlowResultItems(run, result);
  state.completed.push({ flowId: state.flowId!, nodeId: "realm-foundation", outcome: "settlement:throne-established", sourceEventId: "new-court", actId: state.actId, age: run.age });
  assert.deepEqual(availableNextEventUnits(run, currentEventFlowStep(run)!).map(node => node.id), ["new-court"]);
});

test("逐鹿各幕从显式入口可达全部单元，辅助经历不产生回环或要求跑完全部组", async () => {
  const { pack } = await fixture(0, "family-ruin", "ancient.sovereign-rise", true);
  const flow = pack.eventFlow!;
  for (const act of pack.acts) {
    const groups = flow.groups.filter(group => group.actIds.includes(act.id));
    const edges = new Map<string, string[]>();
    for (const group of groups) for (const node of group.events) {
      const results = node.kind === "choice" ? node.options.flatMap(option => [option.success, option.failure])
        : node.kind === "decision" ? node.options.map(option => option.outcome)
        : node.kind === "settlement" ? node.rules : [node.outcome];
      edges.set(node.id, results.flatMap(result => result.endsFlow
        ? (result.nextFlowIds ?? []).map(id => groups.find(candidate => candidate.id === id)!.events[0].id)
        : result.nextEventIds ?? []));
    }
    const visited = new Set<string>(), stack = new Set<string>();
    const walk = (id: string) => {
      assert.ok(!stack.has(id), "已结束经历不能形成回环：" + id);
      if (visited.has(id)) return;
      stack.add(id);
      for (const next of edges.get(id) ?? []) walk(next);
      stack.delete(id); visited.add(id);
    };
    for (const id of flow.actEntries![act.id]) walk(groups.find(group => group.id === id)!.events[0].id);
    assert.deepEqual([...visited].sort(), [...edges.keys()].sort(), act.id + "不能存在孤立素材");
  }
});

test("布衣结算校验进入现有单次纠错，不放宽属性、不重写正文、不污染后续请求", async (t) => {
  for (const apiPath of ["/chat/completions", "/responses"] as const) await t.test(apiPath, async (t) => {
    const { run, act } = await fixture(2, "western-succession", "ancient.sovereign-rise");
    run.narrative.version = 21;
    const captures: any[] = [];
    const respond = async (payload: any) => {
      captures.push(payload);
      const args = { effects: [{ stat: captures.length === 1 ? "physique" : "family", direction: captures.length === 1 ? "down" : "up", band: "light" }] };
      return apiPath === "/responses" ? { output: [{ type: "function_call", name: "resolve_background_outcome", arguments: JSON.stringify(args), call_id: "settlement" }] }
        : reply("resolve_background_outcome", args);
    };
    if (apiPath === "/responses") t.mock.method(OpenAI.Responses.prototype, "create", respond);
    else t.mock.method(OpenAI.Chat.Completions.prototype, "create", respond);
    const input = { act, presentation: "summary", allowedTurnKinds: ["background"], backgroundAgeRange: { fromAge: 51, toAge: 52 },
      socialForces: [], storyPatterns: [], knownCharacters: [], knownFactIds: [], backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run) } as any;
    const scene = { turnKind: "background", createsDecision: false, narrative: "你与家人生活，偶有小病，休息后继续相处。" } as any;
    const before = structuredClone({ age: run.age, stats: run.stats, history: run.history });
    const ctx = { ...context, providerConfig: { ...context.providerConfig, apiPath } };
    const result = await settleDynamicNarrativeScene(run, world, input, scene, ctx);
    assert.equal(result.narrative, scene.narrative);
    assert.deepEqual(result.backgroundAttributeEffects, [{ stat: "family", direction: "up", band: "light" }]);
    assert.equal(captures.length, 2);
    const text = (request: any) => JSON.stringify(apiPath === "/responses" ? request.input : request.messages);
    assert.ok(text(captures[1]).includes("direction_not_allowed"));
    await settleDynamicNarrativeScene(run, world, input, scene, ctx);
    assert.equal(captures.length, 3);
    assert.ok(!text(captures[2]).includes("originalToolArguments"));
    assert.deepEqual(captures[0].tools, captures[2].tools);
    assert.deepEqual({ age: run.age, stats: run.stats, history: run.history }, before);
  });
});

test("两种传输的直接结果只接收已选道路，不补成功率、掷点或未来分支", async (t) => {
  for (const apiPath of ["/chat/completions", "/responses"] as const) await t.test(apiPath, async (t) => {
    const captures: any[] = [];
    const respond = async (payload: any) => {
      const tool = payload.tools[0].function ?? payload.tools[0];
      if (tool.name === "render_decision_outcome") captures.push(payload);
      const args = tool.name === "render_decision_outcome" ? { narrative: "你向旧部说明自己选定的道路。", nextClock: "hold" } : { effects: [] };
      return apiPath === "/responses" ? { output: [{ type: "function_call", name: tool.name, arguments: JSON.stringify(args), call_id: "direct" }] } : reply(tool.name, args);
    };
    if (apiPath === "/responses") t.mock.method(OpenAI.Responses.prototype, "create", respond);
    else t.mock.method(OpenAI.Chat.Completions.prototype, "create", respond);
    for (const selected of ["west", "capital"]) {
      const { run, definition } = await fixture(2, "future-road", "ancient.sovereign-rise");
      run.narrative.version = 21;
      const step = currentEventFlowStep(run)!;
      advanceWithDynamicNarrativeScene(run, world, definition, { patternIds: [], forceIds: [], participants: [],
        narrative: "京畿邀约与故土责任都在眼前。", createsDecision: true,
        eventFlow: { flowId: step.flow.id, eventIndex: step.eventIndex, nodeId: step.event.id, outcome: "pending" } });
      const choice = toPublicMilestoneChoice(run)!;
      selectDirectChoice(run, selected);
      const option = run.nextMilestoneChoice!.options.find(option => option.id === selected)!;
      await runNarrativeAgentDecision({ run, world, narrativeWorld: definition, context: { ...context, providerConfig: { ...context.providerConfig, apiPath } },
        callId: "direct:" + selected, choice, decision: { decision: selected, label: option.label, description: option.description,
          attributePolicy: { allowedStats: ["charisma"], allowedBands: ["light"], allowedDirections: ["up", "down"], minEffects: 0, maxEffects: 2 } } });
      assert.equal(run.choiceExecution!.roll, undefined);
    }
    assert.equal(captures.length, 2);
    const system = (payload: any) => apiPath === "/responses" ? payload.instructions : payload.messages.filter((m: any) => m.role === "system");
    assert.deepEqual(system(captures[0]), system(captures[1]));
    assert.deepEqual(captures[0].tools, captures[1].tools);
    for (const request of captures) {
      const content = JSON.stringify(apiPath === "/responses" ? request.input : request.messages);
      assert.ok(content.includes("本次确定的事件结果"));
      assert.ok(!content.includes("检定结果：失败"));
      assert.ok(!content.includes("检定结果：成功"));
      assert.ok(!content.includes("nextFlowIds"));
    }
  });
});

test("布衣空接续不退回全幕抽取，保留已提交来源", async (t) => {
  const { run, definition } = await fixture(2, "western-succession", "ancient.sovereign-rise");
  run.narrative.version = 21; run.narrative.eventFlow!.eventIndex = 2;
  const step = currentEventFlowStep(run)!;
  advanceWithDynamicNarrativeScene(run, world, definition, { patternIds: [], forceIds: [], participants: [],
    narrative: "你已交出职责，地方依旧有序，晚年旧人各有归处。", nextClock: "hold", attributeOutcome: { effects: [] },
    eventFlow: { flowId: step.flow.id, eventIndex: step.eventIndex, nodeId: step.event.id, outcome: "experience" } });
  const source = run.pendingActFinalization!.sourceEventId;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async () => reply("observe_act_closure", { decision: "ongoing", evidence: null }));
  await assert.rejects(finishPendingNarrativeActEvent(run, world, definition, context, async () => {}), /event_flow_candidates_empty/);
  assert.equal(run.pendingActFinalization!.sourceEventId, source);
  assert.deepEqual(availableNextEventFlows(run), []);
  assert.equal(run.narrative.eventFlow!.flowId, "western-succession");
});

test("事件素材按可复用组加载，幕初绑定持久化，正文只取得当前经历且不取得未来结果", async () => {
  const { run, definition, pack } = await fixture(0, "ridge-scouts");
  validateEventFlowBindings(run, run.narrative.actRuntime!.outline!);
  const first = currentEventFlowStep(run)!;
  assert.equal(first.event.id, "ridge-discovery");
  assert.ok(!JSON.stringify(first.flow).includes('"next"'));
  run.narrative.eventFlow!.eventIndex = 1;
  const step = currentEventFlowStep(run)!, projection = eventFlowRenderInput(run, step);
  assert.equal(projection.options!.length, 3);
  assert.ok(!JSON.stringify(projection).includes("grantItems"));
  assert.ok(!JSON.stringify(projection).includes("endsFlow"));
  const check = prepareChoiceCheck(run, definition, (step.event as Extract<typeof step.event, {kind: "choice"}>).check);
  assert.equal(check.stat, "intelligence"); assert.equal(check.threshold, 16);
  const restored = JSON.parse(JSON.stringify(run));
  restored.narrative = ensureNarrativeRunState(restored.narrative, true);
  assert.deepEqual(currentEventFlowStep(restored), step);
  assert.deepEqual(restored.storyPackSnapshot.eventFlow, pack.eventFlow);
  const card = structuredClone(run.narrative.actRuntime!.outline!);
  card.flowBindings![0].name = "另一个名字";
  assert.throws(() => validateEventFlowBindings(run, card), /binding_changed/);
  const withoutExit = structuredClone(pack.eventFlow!);
  withoutExit.groups[0].events.forEach(event => {
    if (event.kind === "life" || event.kind === "scene") delete event.outcome.endsFlow;
  });
  assert.throws(() => validateNarrativeEventFlow(withoutExit, pack), /event_flow_exit_missing/);
});

test("换幕只请求新名称，既有绑定由引擎复用；两种 provider 使用固定工具", async (t) => {
  for (const apiPath of ["/chat/completions", "/responses"]) await t.test(apiPath, async (t) => {
    const { run, definition, act } = await fixture(2, "invasion-arrival");
    const roles = eventFlowRoles(run.storyPackSnapshot!.eventFlow!, act.id);
    const fresh = roles[roles.length - 1];
    const existing = Object.fromEntries(roles.filter(role => role.id !== fresh.id).map(role => [role.id, "已有" + role.id]));
    run.narrative.eventFlow = { actId: act.id, eventIndex: 0, bindings: existing, completed: [], completedFlows: [] };
    const respond = (payload: any) => {
      const content = JSON.stringify(payload);
      const marker = "需要具象化的角色：";
      const messages = apiPath === "/responses" ? payload.input : payload.messages;
      const task = messages.map((message: any) => message.content).join("\n");
      const roleLine = task.split("\n").find((line: string) => line.includes(marker))!;
      assert.deepEqual(JSON.parse(roleLine.slice(roleLine.indexOf(marker) + marker.length)), [fresh]);
      assert.ok(content.includes("已有名称由引擎复用"));
      const args = { ...hostingFixture(), flowBindings: [{ roleId: fresh.id, name: "新名字" }] };
      return apiPath === "/responses" ? { output: [{ type: "function_call", name: "plan_act_world_card", arguments: JSON.stringify(args), call_id: "plan" }] }
        : reply("plan_act_world_card", args);
    };
    if (apiPath === "/responses") t.mock.method(OpenAI.Responses.prototype, "create", async (payload: any) => respond(payload));
    else t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => respond(payload));
    const card = await generateNarrativeActWorldCard(run, world, { callId: "new-act", source: "scene", worldId: world.id,
      currentAge: run.age, backgroundAgeRange: { fromAge: run.age, toAge: run.age }, act, capabilities: ["scene"],
      storyPatterns: [], socialForces: [], focusReferences: [], statTiers: {}, clock: { mode: "hold", sameAgeTurnCount: 0, maxSameAgeTurns: 0 } } as any,
      { ...context, providerConfig: { ...context.providerConfig!, apiPath: apiPath as any }, narrativePlan: buildNarrativePromptPlan(run, definition, null, "planning")! });
    assert.deepEqual(Object.fromEntries(card.flowBindings!.map(binding => [binding.roleId, binding.name])), { ...existing, [fresh.id]: "新名字" });
  });
});

test("同年提交也前进组内经历；完整组先观察收束，再由独立规划承接", async (t) => {
  const { run, definition } = await fixture();
  const step = currentEventFlowStep(run)!;
  advanceWithDynamicNarrativeScene(run, world, definition, { patternIds: [], forceIds: [], participants: [],
    narrative: "你和伙伴玩闹，已熟悉山路。", nextClock: "hold", attributeOutcome: { effects: [] },
    eventFlow: { flowId: step.flow.id, eventIndex: step.eventIndex, nodeId: step.event.id, outcome: "experience" } });
  const age = run.age;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
    const tool = payload.tools[0].function;
    const text = JSON.stringify(payload.messages);
    if (tool.name === "route_event_unit") {
      const nextEventId = run.narrative.eventFlow!.completed.some(entry => entry.nodeId === "childhood-drills")
        ? "childhood-household" : "childhood-drills";
      return reply(tool.name, { nextEventId });
    }
    if (tool.name === "observe_act_closure") {
      assert.deepEqual(tool.parameters.properties.decision.enum, ["ongoing", "act_closed", "run_ended"]);
      assert.ok(!text.includes("后续候选"));
      assert.ok(!text.includes("可用的后续事件组"));
      assert.ok(text.includes("已提交事件组及确定结果"));
      return reply(tool.name, { decision: "ongoing", evidence: null });
    }
    assert.equal(tool.name, "plan_next_event_flow");
    assert.ok(text.includes("上一事件组及确定结果"));
    assert.ok(text.includes("后续候选"));
    assert.ok(!text.includes("收束含义："));
    return reply(tool.name, { nextFlowId: "ridge-scouts" });
  });
  await finishPendingNarrativeActEvent(run, world, definition, { ...context }, async () => {});
  assert.equal(run.age, age); assert.equal(run.narrative.sceneClock.mode, "hold");
  assert.equal(currentEventFlowStep(run)!.event.id, "childhood-drills");
  const drills = currentEventFlowStep(run)!;
  advanceWithDynamicNarrativeScene(run, world, definition, { patternIds: [], forceIds: [], participants: [],
    narrative: "你已掌握初步警戒和兵器基础。", nextClock: "advance", attributeOutcome: { effects: [] },
    eventFlow: { flowId: drills.flow.id, eventIndex: drills.eventIndex, nodeId: drills.event.id, outcome: "experience" } });
  await finishPendingNarrativeActEvent(run, world, definition, { ...context }, async () => {});
  const last = currentEventFlowStep(run)!;
  assert.equal(last.event.id, "childhood-household");
  advanceWithDynamicNarrativeScene(run, world, definition, { patternIds: [], forceIds: [], participants: [],
    narrative: "你已能独自照料家中，与伙伴共同承担外出劳作。", nextClock: "advance", attributeOutcome: { effects: [] },
    eventFlow: { flowId: last.flow.id, eventIndex: last.eventIndex, nodeId: last.event.id, outcome: "experience" } });
  await finishPendingNarrativeActEvent(run, world, definition, { ...context }, async () => {});
  assert.equal(run.narrative.eventFlow!.flowId, "ridge-scouts");
  assert.equal(currentEventFlowStep(run)!.event.id, "ridge-discovery");
  assert.ok(!availableNextEventFlows(run).some(group => group.id === "border-childhood"));
});

test("交付只改玩法库存一次；观察失败重试不丢道具结果、不重做正文", async (t) => {
  const { run, definition } = await fixture(1, "map-delivery");
  // Bind identities before granting a legitimately owned item from an earlier result.
  run.narrative.eventFlow = { actId: run.narrative.actRuntime!.actId, eventIndex: 0, bindings: Object.fromEntries(
    run.narrative.actRuntime!.outline!.flowBindings!.map(binding => [binding.roleId, binding.name])),
    flowId: "map-delivery", completed: [], completedFlows: [] };
  assert.throws(() => currentEventFlowStep(run), /event_flow_active_group_invalid/);
  applyEventFlowResultItems(run, { result: "早年实际侦察所得", grantItems: ["border-map"] });
  validateEventFlowBindings(run, run.narrative.actRuntime!.outline!);
  const step = currentEventFlowStep(run)!;
  advanceWithDynamicNarrativeScene(run, world, definition, { patternIds: [], forceIds: [], participants: [],
    narrative: "你已把边道图交给邻军，获赠佩刀。", nextClock: "hold", attributeOutcome: { effects: [] },
    eventFlow: { flowId: step.flow.id, eventIndex: step.eventIndex, nodeId: step.event.id, outcome: "experience" } });
  let fail = true;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
    if (fail) throw new Error("offline");
    const name = payload.tools[0].function.name;
    return reply(name, name === "observe_act_closure" ? { decision: "ongoing", evidence: null } : { nextFlowId: "company-training" });
  });
  await assert.rejects(finishPendingNarrativeActEvent(run, world, definition, { ...context }, async () => {}));
  assert.equal(run.items.length, 1); assert.match(run.items[0].id, /service-blade$/);
  const restored = JSON.parse(JSON.stringify(run)); fail = false;
  await finishPendingNarrativeActEvent(restored, world, definition, { ...context }, async () => {});
  assert.equal(restored.items.length, 1); assert.equal(restored.narrative.eventFlow.completed.length, 1);
  assert.equal(currentEventFlowStep(restored)!.flow.id, "company-training");
});

test("接组失败后保留收束观察，恢复只重试独立规划；无候选不会逼观察器改判收束", async (t) => {
  const { run, definition } = await fixture(1, "map-delivery");
  run.narrative.eventFlow = { actId: run.narrative.actRuntime!.actId, eventIndex: 0, bindings: Object.fromEntries(
    run.narrative.actRuntime!.outline!.flowBindings!.map(binding => [binding.roleId, binding.name])),
    flowId: "map-delivery", completed: [], completedFlows: [] };
  applyEventFlowResultItems(run, { result: "实际侦察所得", grantItems: ["border-map"] });
  const step = currentEventFlowStep(run)!;
  advanceWithDynamicNarrativeScene(run, world, definition, { patternIds: [], forceIds: [], participants: [],
    narrative: "你交付地图，获赠佩刀，接下来仍需实际指挥部伍。", nextClock: "hold", attributeOutcome: { effects: [] },
    eventFlow: { flowId: step.flow.id, eventIndex: step.eventIndex, nodeId: step.event.id, outcome: "experience" } });
  const calls: string[] = [];
  let fail = true;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
    const name = payload.tools[0].function.name; calls.push(name);
    if (name === "observe_act_closure") return reply(name, { decision: "ongoing", evidence: null });
    assert.equal(name, "plan_next_event_flow");
    if (fail) throw new Error("planning_offline");
    return reply(name, { nextFlowId: "company-training" });
  });
  await assert.rejects(finishPendingNarrativeActEvent(run, world, definition, context, async () => {}));
  assert.equal(run.pendingActFinalization!.observation!.decision, "ongoing");
  assert.equal(run.pendingActFinalization!.nextFlowId, undefined);
  const restored = JSON.parse(JSON.stringify(run)); fail = false; calls.length = 0;
  await finishPendingNarrativeActEvent(restored, world, definition, context, async () => {});
  assert.deepEqual(calls, ["plan_next_event_flow"]);
  assert.equal(restored.narrative.eventFlow.completed.length, 1);
  assert.equal(restored.items.length, 1);
  assert.equal(restored.narrative.sceneClock.mode, "hold");
  const noCandidates = structuredClone(run);
  const actId = noCandidates.narrative.actRuntime!.actId;
  noCandidates.narrative.eventFlow!.completedFlows = noCandidates.storyPackSnapshot!.eventFlow!.groups
    .filter(group => group.actIds.includes(actId) && group.id !== step.flow.id)
    .map(group => ({ flowId: group.id, sourceEventId: "test", actId }));
  calls.length = 0;
  await assert.rejects(finishPendingNarrativeActEvent(noCandidates, world, definition, context, async () => {}), /event_flow_candidates_empty/);
  assert.deepEqual(calls, [], "候选缺失是接组问题，不能用纠正请求重做收束判断");
  assert.equal(noCandidates.pendingActFinalization!.observation!.decision, "ongoing");
  assert.equal(noCandidates.narrative.actCanon.length, 0);
});

test("独立接组两种 provider 使用相同固定协议，变化只进入动态输入", async (t) => {
  for (const apiPath of ["/chat/completions", "/responses"]) await t.test(apiPath, async (t) => {
    const { run } = await fixture(1, "company-training");
    const requests: any[] = [];
    const respond = (payload: any) => {
      requests.push(payload);
      const text = JSON.stringify(payload);
      assert.ok(text.includes("上一事件组及确定结果"));
      assert.ok(text.includes("当前人物状态"));
      assert.ok(!text.includes("本幕收束含义"));
      const args = { nextFlowId: "wolves-rescue" };
      return apiPath === "/responses" ? { output: [{ type: "function_call", name: "plan_next_event_flow", arguments: JSON.stringify(args), call_id: "next" }] }
        : reply("plan_next_event_flow", args);
    };
    if (apiPath === "/responses") t.mock.method(OpenAI.Responses.prototype, "create", async (payload: any) => respond(payload));
    else t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => respond(payload));
    const ctx = { ...context, providerConfig: { ...context.providerConfig!, apiPath: apiPath as any } };
    for (const age of [20, 21]) {
      run.age = age;
      assert.equal(await planNextEventFlow(run, world, { callId: "next:" + age, actId: run.narrative.actRuntime!.actId,
        outline: run.narrative.actRuntime!.outline!, recentStory: "你已经编成部伍。",
        previous: { id: "company-training", label: "编练部伍", narrativeRole: "起点", result: "你已经取得小队指挥权。" },
        candidates: [{ id: "wolves-rescue", label: "救援", narrativeRole: "实践", entry: "已掌握小队" }] }, ctx), "wolves-rescue");
    }
    const system = (p: any) => apiPath === "/responses" ? p.instructions : p.messages.filter((m: any) => m.role === "system");
    assert.deepEqual(system(requests[0]), system(requests[1]));
    assert.deepEqual(requests[0].tools, requests[1].tools);
    const worldPrefix = (p: any) => (apiPath === "/responses" ? p.input : p.messages).find((m: any) =>
      typeof m.content === "string" ? m.content.includes("【长期设定】") : JSON.stringify(m.content).includes("【长期设定】"));
    assert.deepEqual(worldPrefix(requests[0]), worldPrefix(requests[1]), "世界卡稳定前缀相同");
  });
});

test("节点体魄检定沿用概率和一次掷点；实际战死经观察写入且结局不覆盖", async (t) => {
  const { run, definition } = await fixture(2, "last-frontier-line");
  const step = currentEventFlowStep(run)!;
  assert.equal(step.event.kind, "choice"); if (step.event.kind !== "choice") return;
  const check = prepareChoiceCheck(run, definition, step.event.check);
  assert.equal(check.stat, "physique"); assert.equal(check.threshold, 30);
  run.nextMilestoneChoice = { age: run.age, check, options: [], sceneId: "test", revision: 1 } as any;
  const roll = rollChoice(run, "risky"), restored = structuredClone(run);
  assert.deepEqual(rollChoice(restored, "risky"), roll);
  run.nextMilestoneChoice = undefined; run.choiceExecution = undefined;
  advanceWithDynamicNarrativeScene(run, world, definition, { patternIds: [], forceIds: [], participants: [],
    narrative: "你率最后部曲反击，战死，边境陷落。", nextClock: "hold", attributeOutcome: { effects: [] },
    eventFlow: { flowId: step.flow.id, eventIndex: step.eventIndex, nodeId: step.event.id, outcome: "risky:failure" } });
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async () => reply("observe_act_closure", {
    decision: "run_ended", evidence: "主角与部曲战死，最后防线陷落", endingPolarity: "bad", lifeStatus: "dead", deathCause: "最后反击中战死" }));
  await finishPendingNarrativeActEvent(run, world, definition, { ...context }, async () => {});
  assert.equal(run.outcome, "dead"); assert.equal(run.narrative.endingPolarity, "bad");
  assert.equal(applyDirectedClosureRequest(run, "finish", definition), "finished");
  assert.equal(run.outcome, "dead"); assert.equal(run.deathCause, "最后反击中战死");
});

test("两种 provider 的已编写选项只传行动，动态事件变化不改写固定职责或工具", async (t) => {
  for (const apiPath of ["/chat/completions", "/responses"]) await t.test(apiPath, async (t) => {
    const { run, definition, act } = await fixture(0, "ridge-scouts"); currentEventFlowStep(run);
    run.narrative.eventFlow!.eventIndex = 1;
    const step = currentEventFlowStep(run)!, flowEvent = eventFlowRenderInput(run, step);
    const inputs: any[] = [];
    const respond = (payload: any) => {
      inputs.push(payload);
      const tool = apiPath === "/responses" ? payload.tools[0] : payload.tools[0].function;
      assert.equal(tool.name, "render_choice_prose");
      assert.ok(!Object.hasOwn(tool.parameters.properties, "optionOverrides"));
      const args = { narrative: "你与伙伴躲在山沟里，敌人正在搜山，守军尚未得到消息。", participants: [], assetActivity: { locationIds: [], abilityIds: [] }, assetUpdates: { locations: [], abilities: [] } };
      return apiPath === "/responses" ? { output: [{ type: "function_call", name: tool.name, arguments: JSON.stringify(args), call_id: "render" }] } : reply(tool.name, args);
    };
    if (apiPath === "/responses") t.mock.method(OpenAI.Responses.prototype, "create", async (payload: any) => respond(payload));
    else t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => respond(payload));
    for (const age of [20, 21]) {
      const ctx = { ...context, providerConfig: { ...context.providerConfig!, apiPath: apiPath as any },
        narrativePlan: buildNarrativePromptPlan(run, definition, null, "rendering")! };
      const result = await generateDynamicNarrativeScene(run, world, { act, presentation: "scene", sceneAge: age,
        backgroundAgeRange: { fromAge: age, toAge: age }, socialForces: definition.socialForces, flowEvent,
        attributePolicy: dynamicSceneAttributePolicy() } as any, ctx);
      assert.equal(result.createsDecision, true);
      assert.deepEqual(result.milestoneCopy!.optionOverrides!.map(option => option.description), flowEvent.options!.map(option => option.action));
    }
    const system = (p: any) => apiPath === "/responses" ? p.instructions : p.messages.filter((m: any) => m.role === "system");
    assert.deepEqual(system(inputs[0]), system(inputs[1])); assert.deepEqual(inputs[0].tools, inputs[1].tools);
    assert.ok(!JSON.stringify(inputs).includes("被追兵击伤并俘获"), "未选结果不预先进入选项请求");
  });
});

test("试点完整单元提交后由规划只路由，接通失败恢复不重写正文或重交来源", async (t) => {
  const { run, definition } = await fixture(1, "border-campaign"); run.narrative.version = 20;
  const step = currentEventFlowStep(run)!;
  advanceWithDynamicNarrativeScene(run, world, definition, { patternIds: [], forceIds: [], participants: [],
    sceneAge: run.age, narrative: "你完成邻堡数队合编，伙伴领一队，弓手和骑哨已能接应。", nextClock: "hold", attributeOutcome: { effects: [] },
    eventFlow: { flowId: step.flow.id, eventIndex: step.eventIndex, nodeId: step.event.id, outcome: "experience" } });
  let offline = true;
  const calls: string[] = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
    const tool = payload.tools[0].function; calls.push(tool.name);
    assert.equal(tool.name, "route_event_unit");
    assert.deepEqual(Object.keys(tool.parameters.properties), ["nextEventId"]);
    const task = JSON.stringify(payload.messages);
    assert.match(task, /你完成邻堡数队合编/);
    assert.doesNotMatch(task, /收束含义：/);
    if (offline) throw new Error("unit_route_offline");
    return reply(tool.name, { nextEventId: "campaign-first-defense" });
  });
  await assert.rejects(finishPendingNarrativeActEvent(run, world, definition, context, async () => {}));
  assert.equal(run.narrative.eventFlow!.completed.length, 1);
  assert.equal(run.narrative.eventFlow!.eventIndex, 0);
  const restored = JSON.parse(JSON.stringify(run)); offline = false;
  await finishPendingNarrativeActEvent(restored, world, definition, context, async () => {});
  assert.equal(restored.narrative.eventFlow.completed.length, 1);
  assert.equal(restored.history.length, 1);
  assert.equal(currentEventFlowStep(restored)!.event.id, "campaign-first-defense");
  assert.equal(restored.narrative.sceneClock.mode, "hold");
  assert.equal(restored.pendingActFinalization, undefined);
  assert.ok(calls.every((name) => name === "route_event_unit"));
  assert.ok(!availableNextEventUnits(restored, currentEventFlowStep(restored)!).some((unit) => unit.id === "campaign-formation"));
});

test("单元路由只选 ID，两种传输不因实际胜败改变固定职责或工具", async (t) => {
  for (const apiPath of ["/chat/completions", "/responses"] as const) await t.test(apiPath, async (t) => {
    const { run } = await fixture(1, "border-campaign"); currentEventFlowStep(run);
    const captured: any[] = [];
    const respond = (payload: any) => {
      captured.push(payload);
      const tool = apiPath === "/responses" ? payload.tools[0] : payload.tools[0].function;
      assert.equal(tool.name, "route_event_unit");
      assert.deepEqual(tool.parameters.required, ["nextEventId"]);
      const args = { nextEventId: "campaign-aftermath" };
      return apiPath === "/responses" ? { output: [{ type: "function_call", name: tool.name, arguments: JSON.stringify(args), call_id: "route" }] }
        : reply(tool.name, args);
    };
    if (apiPath === "/responses") t.mock.method(OpenAI.Responses.prototype, "create", async (payload: any) => respond(payload));
    else t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => respond(payload));
    for (const recentStory of ["你攻破敌营，带回俘虏。", "你攻营失败，带余部撤回，失去军械。"])
      assert.equal(await planNextEventUnit(run, world, { callId: "route", actId: run.narrative.actRuntime!.actId,
        outline: run.narrative.actRuntime!.outline!, recentStory, group: { id: "border-campaign", label: "出击", narrativeRole: "统军" },
        candidates: [{ id: "campaign-aftermath", kind: "scene", entry: "此次出击已结束，主角存活。", situation: "处置实际死伤与所得。" }]
      }, { ...context, providerConfig: { ...context.providerConfig, apiPath } }), "campaign-aftermath");
    const system = (payload: any) => apiPath === "/responses" ? payload.instructions : payload.messages.filter((entry: any) => entry.role === "system");
    assert.deepEqual(system(captured[0]), system(captured[1]));
    assert.deepEqual(captured[0].tools, captured[1].tools);
    assert.ok(!JSON.stringify(captured[0].tools).includes("campaign-aftermath"));
  });
});

test("统一军议按实际功过适用处置规则；未授将不发将旗，重试不重复发奖", async (t) => {
  for (const apiPath of ["/chat/completions", "/responses"] as const) await t.test(apiPath, async (t) => {
    const { run, definition, act } = await fixture(1, "border-campaign"); run.narrative.version = 20;
    currentEventFlowStep(run);
    run.narrative.eventFlow!.eventIndex = run.storyPackSnapshot!.eventFlow!.groups.find((group) => group.id === "border-campaign")!.events.findIndex((event) => event.id === "general-commission");
    const step = currentEventFlowStep(run)!, flowEvent = eventFlowRenderInput(run, step);
    assert.equal(flowEvent.result, undefined);
    assert.equal(flowEvent.rules!.length, 3);
    let resolutionId = "retain-command";
    const requests: any[] = [];
    const respond = (payload: any) => {
      requests.push(payload);
      const tool = apiPath === "/responses" ? payload.tools[0] : payload.tools[0].function;
      assert.equal(tool.name, "render_event_settlement");
      assert.ok(tool.parameters.required.includes("resolutionId"));
      assert.equal(tool.parameters.properties.resolutionId.enum, undefined);
      const args = { narrative: resolutionId === "retain-command" ? "你受命留任校尉，本阶段军议结束，没有获授将旗。" : "镇将授你偏将，交付将旗与一翼防区。", resolutionId, nextClock: "hold" };
      return apiPath === "/responses" ? { output: [{ type: "function_call", name: tool.name, arguments: JSON.stringify(args), call_id: "settlement" }] } : reply(tool.name, args);
    };
    if (apiPath === "/responses") t.mock.method(OpenAI.Responses.prototype, "create", async (payload: any) => respond(payload));
    else t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => respond(payload));
    const render = () => generateDynamicNarrativeScene(run, world, { act, presentation: "scene", allowedTurnKinds: ["scene"],
      sceneAge: run.age, backgroundAgeRange: { fromAge: run.age, toAge: run.age }, socialForces: [], storyPatterns: [],
      knownCharacters: [], flowEvent } as any, { ...context, providerConfig: { ...context.providerConfig, apiPath },
        narrativePlan: buildNarrativePromptPlan(run, definition, null, "rendering")! });
    const retained = await render();
    applyEventFlowResultItems(run, eventFlowResult(run, "settlement:" + retained.resolutionId));
    assert.equal(run.items.length, 0);
    resolutionId = "appoint-general";
    const promoted = await render();
    const result = eventFlowResult(run, "settlement:" + promoted.resolutionId);
    applyEventFlowResultItems(run, result); applyEventFlowResultItems(run, result);
    assert.equal(run.items.length, 1); assert.match(run.items[0].id, /command-banner$/);
    assert.equal(result.endsFlow, true);
    assert.deepEqual(requests[0].tools, requests[1].tools);
    resolutionId = "invented-award";
    await assert.rejects(render(), /narrative_outcome_invalid/);
  });
});

test("战争胜败先承接战后处置和生活，完整组结束才观察整局", async (t) => {
  for (const scenario of [
    { flow: "decisive-frontier-war", choice: "safe:success", settlement: "war-reckoning", rule: "war-frontier-secured", aftermath: "war-homecoming", polarity: "good" },
    { flow: "decisive-frontier-war", choice: "safe:failure", settlement: "war-reckoning", rule: "war-limited-peace", aftermath: "war-homecoming", polarity: "normal" },
    { flow: "last-frontier-line", choice: "balanced:success", settlement: "last-defense-reckoning", rule: "last-defense-preserved", aftermath: "last-defense-resettlement", polarity: "normal" }
  ] as const) await t.test(scenario.flow + ":" + scenario.choice, async (t) => {
    const { run, definition } = await fixture(2, scenario.flow);
    run.narrative.version = 20;
    currentEventFlowStep(run);
    const flow = run.storyPackSnapshot!.eventFlow!.groups.find(group => group.id === scenario.flow)!;
    run.narrative.eventFlow!.eventIndex = flow.events.findIndex(event => event.kind === "choice");
    const calls: string[] = [];
    t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
      const name = payload.tools[0].function.name;
      calls.push(name);
      if (name === "route_event_unit") return reply(name, { nextEventId:
        currentEventFlowStep(run)!.event.kind === "choice" ? scenario.settlement : scenario.aftermath });
      assert.equal(name, "observe_act_closure");
      return reply(name, { decision: "run_ended", evidence: "战争、军议和军民战后去处已经实际落定。",
        endingPolarity: scenario.polarity, lifeStatus: "alive" });
    });
    const commit = async (outcome: string, narrative: string) => {
      const step = currentEventFlowStep(run)!;
      advanceWithDynamicNarrativeScene(run, world, definition, { patternIds: [], forceIds: [], participants: [],
        sceneAge: run.age, narrative, nextClock: "hold", attributeOutcome: { effects: [] },
        eventFlow: { flowId: step.flow.id, eventIndex: step.eventIndex, nodeId: step.event.id, outcome } });
      await finishPendingNarrativeActEvent(run, world, definition, context, async () => {});
    };
    await commit(scenario.choice, "这次军事行动已经按实际成败结束，主角和幸存部众返回驻地。");
    assert.equal(currentEventFlowStep(run)!.event.id, scenario.settlement);
    assert.deepEqual(calls, ["route_event_unit"], "战斗结果不提前跳过军议与战后生活");
    await commit("settlement:" + scenario.rule, "镇将已按实际功过处理军职和防区，军议结束。");
    assert.equal(currentEventFlowStep(run)!.event.id, scenario.aftermath);
    assert.deepEqual(calls, ["route_event_unit", "route_event_unit"]);
    await commit("experience", "幸存军民与部众已经安顿，你回到实际驻地，接回战后的生活。");
    assert.deepEqual(calls, ["route_event_unit", "route_event_unit", "observe_act_closure"]);
    assert.equal(run.narrative.eventFlow!.ending!.polarity, scenario.polarity);
    assert.equal(run.narrative.eventFlow!.completed.length, 3);
    assert.equal(run.narrative.sceneClock.mode, "hold");
  });
});

test("决战战死直接交给结局观察，不路由到存活者军议", async (t) => {
  const { run, definition } = await fixture(2, "decisive-frontier-war"); run.narrative.version = 20;
  currentEventFlowStep(run);
  run.narrative.eventFlow!.eventIndex = run.storyPackSnapshot!.eventFlow!.groups.find(group => group.id === "decisive-frontier-war")!.events.findIndex(event => event.id === "war-decision");
  const step = currentEventFlowStep(run)!;
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
    assert.equal(payload.tools[0].function.name, "observe_act_closure");
    return reply("observe_act_closure", { decision: "run_ended", evidence: "主角已在敌后战死，所属主力覆灭，关城陷落。",
      endingPolarity: "bad", lifeStatus: "dead", deathCause: "敌后中伏战死" });
  });
  advanceWithDynamicNarrativeScene(run, world, definition, { patternIds: [], forceIds: [], participants: [],
    sceneAge: run.age, narrative: "你在敌后中伏战死，所属主力覆灭，关城陷落。", nextClock: "hold", attributeOutcome: { effects: [] },
    eventFlow: { flowId: step.flow.id, eventIndex: step.eventIndex, nodeId: step.event.id, outcome: "risky:failure" } });
  await finishPendingNarrativeActEvent(run, world, definition, context, async () => {});
  assert.equal(run.narrative.eventFlow!.completed.length, 1);
  assert.equal(run.narrative.eventFlow!.ending!.polarity, "bad");
  assert.equal(run.outcome, "dead");
});

test("旧顺序组快照不随新素材切换为规划路由", async () => {
  const { run, definition } = await fixture();
  const flow = run.storyPackSnapshot!.eventFlow!.groups[0];
  delete flow.routing;
  flow.events = flow.events.slice(0, 2);
  const restored = JSON.parse(JSON.stringify(run));
  const step = currentEventFlowStep(restored)!;
  advanceWithDynamicNarrativeScene(restored, world, definition, { patternIds: [], forceIds: [], participants: [],
    narrative: "你已经与伙伴共同长大。", nextClock: "hold", attributeOutcome: { effects: [] },
    eventFlow: { flowId: step.flow.id, eventIndex: step.eventIndex, nodeId: step.event.id, outcome: "experience" } });
  await finishPendingNarrativeActEvent(restored, world, definition, context, async () => {});
  assert.equal(currentEventFlowStep(restored)!.event.id, "childhood-drills");
  assert.equal(restored.storyPackSnapshot.eventFlow.groups[0].routing, undefined);
});

test("首组由幕内路由在需要时选择，世界卡不预选且重复调用不重复请求", async (t) => {
  const { run, act, pack } = await fixture(0);
  run.narrative.version = 20;
  run.narrative.eventFlow = { actId: act.id, eventIndex: 0, bindings: {}, completed: [], completedFlows: [] };
  const requests: any[] = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
    requests.push(payload);
    assert.equal(payload.tools[0].function.name, "plan_next_event_flow");
    const text = JSON.stringify(payload.messages);
    assert.ok(!text.includes("人工事件组"));
    assert.ok(!text.includes("候选素材，尚未发生"));
    assert.ok(text.includes("后续候选（尚未发生）"));
    return reply("plan_next_event_flow", { nextFlowId: "border-childhood" });
  });
  assert.ok(!("eventFlows" in run.narrative.actRuntime!.outline!));
  await ensureCurrentEventFlow(run, world, pack.eventFlow, { ...context }, async () => {});
  assert.equal(run.narrative.eventFlow!.flowId, "border-childhood");
  assert.equal(currentEventFlowStep(run)!.event.id, "childhood-games");
  await ensureCurrentEventFlow(run, world, pack.eventFlow, { ...context }, async () => {});
  assert.equal(requests.length, 1);
});

test("旧世界卡的 openingFlowId 迁移到运行态一次，规范化后不再保留名单", async () => {
  const { run, act } = await fixture(0);
  const legacy = JSON.parse(JSON.stringify(run.narrative));
  legacy.actRuntime.outline.eventFlows = { openingFlowId: "ridge-scouts", availableFlowIds: ["ridge-scouts"] };
  legacy.eventFlow = { actId: act.id, eventIndex: 0, bindings: {}, completed: [], completedFlows: [] };
  const restored = ensureNarrativeRunState(legacy, true);
  assert.equal(restored.eventFlow!.flowId, "ridge-scouts");
  assert.ok(!("eventFlows" in restored.actRuntime!.outline!));
});

test("江湖宗师事件组覆盖三幕，首组属于第一幕并可进入首个单元", async () => {
  const base = (await loadNarrativeWorldDefinition("ancient"))!;
  const pack = (await loadNarrativeStoryPack(base, "ancient.jianghu-master"))!;
  assert.ok(pack.eventFlow);
  const actIds = pack.acts.map((act) => act.id);
  for (const actId of actIds) {
    assert.ok(pack.eventFlow!.groups.some((group) => group.actIds.includes(actId)), actId);
  }
  assert.ok(pack.eventFlow!.groups[0].actIds.includes(actIds[0]));
  const definition = resolveNarrativeExperience(base, pack);
  const tuning = createDefaultGameplayTuning();
  tuning.bootstrap.selectedCardMin = 0;
  const run = createRun({ world, difficulty, tuning, cards: [], narrativeEnabled: true, storyPack: pack }, {
    clientId: "jianghu-flow", worldId: world.id, storyPackId: pack.id, difficultyId: difficulty.id,
    personaPrompt: "山脚村镇的少年，跟着师父学剑。", talentPointTotal: 25,
    stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 }, selectedCardIds: []
  });
  run.age = 20;
  run.narrative.version = 20;
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, 20);
  const act = definition.mainlineActs![0];
  run.narrative.actRuntime!.actId = act.id;
  run.narrative.actRuntime!.admittedAtAge = 20;
  commitNarrativeActOutline(run.narrative, parseNarrativeActWorldCard({
    ...hostingFixture(),
    flowBindings: eventFlowRoles(pack.eventFlow!, act.id).map((role) => ({ roleId: role.id, name: `实名${role.id}` }))
  }, act.id, { objective: act.objective!, closureMeaning: act.closureMeaning! }));
  const opening = pack.eventFlow!.groups.find((group) => group.actIds.includes(act.id))!;
  run.narrative.eventFlow = { actId: act.id, eventIndex: 0, bindings: {}, flowId: opening.id, completed: [], completedFlows: [] };
  const step = currentEventFlowStep(run)!;
  assert.equal(step.flow.id, opening.id);
  assert.ok(step.event.entry);
  const actGroupIds = new Set(pack.eventFlow!.groups.filter((group) => group.actIds.includes(act.id)).map((group) => group.id));
  assert.ok(availableNextEventFlows(run).every((group) => group.id !== opening.id));
  assert.ok(availableNextEventFlows(run).every((group) => actGroupIds.has(group.id)));
});

test("江湖宗师按边境线生命周期补齐缺位与厚度", async () => {
  const base = (await loadNarrativeWorldDefinition("ancient"))!;
  const pack = (await loadNarrativeStoryPack(base, "ancient.jianghu-master"))!;
  const flow = pack.eventFlow!;
  assert.equal(flow.groups.length, 12);
  assert.equal(flow.groups.reduce((total, group) => total + group.events.length, 0), 37);
  const actIds = pack.acts.map((act) => act.id);
  assert.deepEqual(actIds.map((actId) => flow.groups.filter((group) => group.actIds.includes(actId)).length), [3, 5, 4]);
  for (const group of flow.groups) {
    const events = group.events as any[];
    const exits = (event: any) => event.kind === "choice"
      ? event.options.some((option: any) => option.success.endsFlow || option.failure.endsFlow)
      : event.kind === "settlement"
        ? event.rules.some((rule: any) => rule.endsFlow)
        : Boolean(event.outcome.endsFlow);
    assert.ok(exits(events[events.length - 1]), group.id + " exit");
    for (const event of events.slice(0, -1)) assert.ok(!exits(event), group.id + ":" + event.id);
  }
  assert.ok(flow.groups.find((group) => group.id === "sect-rebuild")?.actIds.includes(actIds[1]));
  assert.ok(flow.groups.find((group) => group.id === "last-sect-line")?.actIds.includes(actIds[2]));
  for (const [groupId, eventId] of [
    ["official-arrest", "yamen-visit"], ["official-arrest", "arrest-aftermath"],
    ["tournament", "tournament-aftermath"], ["sect-siege", "siege-pressure"], ["sect-siege", "siege-aftermath"]
  ]) {
    assert.ok(flow.groups.find((group) => group.id === groupId)!.events.some((event) => event.id === eventId), groupId + ":" + eventId);
  }
  const testEvent = flow.groups.find((group) => group.id === "apprentice-test")!.events.find((event) => event.id === "sect-test") as any;
  assert.ok(testEvent.lifeBefore);
  const verdict = flow.groups.find((group) => group.id === "apprentice-test")!.events.find((event) => event.id === "sect-verdict") as any;
  assert.ok(verdict.rules.every((rule: any) => rule.endsFlow));
  assert.ok(!JSON.stringify(verdict).includes("不放你独行"));
  const escort = flow.groups.find((group) => group.id === "jianghu-first-errand")!.events.find((event) => event.id === "errand-escort") as any;
  assert.ok(escort.outcome.grantItems?.includes("escort-letter"));
  const amnesty = flow.groups.find((group) => group.id === "amnesty-offer")!.events[0] as any;
  assert.ok(amnesty.options.every((option: any) => option.id !== "safe" || !option.success.consumeItems));
  assert.ok(flow.roles.some((role) => role.id === "father") && flow.roles.some((role) => role.id === "mother"));
  assert.ok(flow.originRoles?.includes("father") && flow.originRoles?.includes("mother"));
  assert.ok(flow.groups.find((group) => group.id === "jianghu-first-errand")!.assetRoles?.includes("father"));
});

test("庙堂权臣按生命周期覆盖三幕、失败后续与道具链路", async () => {
  const base = (await loadNarrativeWorldDefinition("ancient"))!;
  const pack = (await loadNarrativeStoryPack(base, "ancient.court-minister"))!;
  const flow = pack.eventFlow!;
  assert.equal(flow.groups.length, 14);
  assert.equal(flow.groups.reduce((total, group) => total + group.events.length, 0), 43);
  const actIds = pack.acts.map((act) => act.id);
  assert.deepEqual(actIds.map((actId) => flow.groups.filter((group) => group.actIds.includes(actId)).length), [5, 5, 4]);
  for (const group of flow.groups) {
    const events = group.events as any[];
    const exits = (event: any) => event.kind === "choice"
      ? event.options.some((option: any) => option.success.endsFlow || option.failure.endsFlow)
      : event.kind === "settlement"
        ? event.rules.some((rule: any) => rule.endsFlow)
        : Boolean(event.outcome.endsFlow);
    assert.ok(exits(events[events.length - 1]), group.id + " exit");
    for (const event of events.slice(0, -1)) assert.ok(!exits(event), group.id + ":" + event.id);
  }
  const networkIds = new Set(flow.groups.filter((group) => group.actIds.includes(actIds[1])).map((group) => group.id));
  for (const id of ["river-works", "faction-struggle", "palace-plot", "faction-purge", "policy-power"]) {
    assert.ok(networkIds.has(id), id);
  }
  const grants = new Set<string>();
  const consumes = new Set<string>();
  for (const group of flow.groups) {
    for (const event of group.events as any[]) {
      const results = event.kind === "choice" ? event.options.flatMap((option: any) => [option.success, option.failure])
        : event.kind === "settlement" ? event.rules : [event.outcome];
      for (const result of results) {
        for (const id of result.grantItems ?? []) grants.add(id);
        for (const id of result.consumeItems ?? []) consumes.add(id);
      }
    }
  }
  assert.ok(grants.has("recommendation-letter") && consumes.has("recommendation-letter"));
  assert.ok(grants.has("official-seal") && grants.has("memorial-draft"));
  assert.ok(flow.originRoles?.includes("father") && flow.originRoles?.includes("mother") && flow.originRoles?.includes("mentor"));
  const entry = flow.groups.find((group) => group.id === "bureaucrat-entry")!;
  assert.ok(entry.assetRoles?.includes("father") && entry.assetRoles?.includes("mother"));
  const basics = entry.events.find((event) => event.id === "entry-basics") as any;
  assert.ok(basics.lifeBefore);
  const verdict = flow.groups.find((group) => group.id === "first-post")!.events.find((event) => event.id === "post-verdict") as any;
  assert.ok(verdict.rules.every((rule: any) => rule.endsFlow));
});

test("商贾世家按生命周期覆盖三幕、商路行会行为与道具链路", async () => {
  const base = (await loadNarrativeWorldDefinition("ancient"))!;
  const pack = (await loadNarrativeStoryPack(base, "ancient.merchant-house"))!;
  const flow = pack.eventFlow!;
  assert.equal(flow.groups.length, 14);
  assert.equal(flow.groups.reduce((total, group) => total + group.events.length, 0), 43);
  const actIds = pack.acts.map((act) => act.id);
  assert.deepEqual(actIds.map((actId) => flow.groups.filter((group) => group.actIds.includes(actId)).length), [5, 5, 4]);
  for (const group of flow.groups) {
    const events = group.events as any[];
    const exits = (event: any) => event.kind === "choice"
      ? event.options.some((option: any) => option.success.endsFlow || option.failure.endsFlow)
      : event.kind === "settlement"
        ? event.rules.some((rule: any) => rule.endsFlow)
        : Boolean(event.outcome.endsFlow);
    assert.ok(exits(events[events.length - 1]), group.id + " exit");
    for (const event of events.slice(0, -1)) assert.ok(!exits(event), group.id + ":" + event.id);
  }
  const creditIds = new Set(flow.groups.filter((group) => group.actIds.includes(actIds[0])).map((group) => group.id));
  for (const id of ["middleman-dispute", "road-blockade", "credit-collapse", "credit-established"]) assert.ok(creditIds.has(id), id);
  const networkIds = new Set(flow.groups.filter((group) => group.actIds.includes(actIds[1])).map((group) => group.id));
  for (const id of ["guild-war", "ferry-rights", "state-gray-trade", "guild-sanction", "trade-network"]) assert.ok(networkIds.has(id), id);
  const grants = new Set<string>();
  const consumes = new Set<string>();
  for (const group of flow.groups) {
    for (const event of group.events as any[]) {
      const results = event.kind === "choice" ? event.options.flatMap((option: any) => [option.success, option.failure])
        : event.kind === "settlement" ? event.rules : [event.outcome];
      for (const result of results) {
        for (const id of result.grantItems ?? []) grants.add(id);
        for (const id of result.consumeItems ?? []) consumes.add(id);
      }
    }
  }
  assert.ok(grants.has("trade-contract") && consumes.has("trade-contract"));
  assert.ok(grants.has("account-ledger") && consumes.has("account-ledger"));
  assert.ok(grants.has("house-seal"));
  assert.ok(flow.originRoles?.includes("father") && flow.originRoles?.includes("mother") && flow.originRoles?.includes("partner"));
  const entry = flow.groups.find((group) => group.id === "first-contract")!;
  assert.ok(entry.assetRoles?.includes("father") && entry.assetRoles?.includes("mother"));
  const basics = entry.events.find((event) => event.id === "contract-basics") as any;
  assert.ok(basics.lifeBefore);
  const established = flow.groups.find((group) => group.id === "credit-established")!;
  const establishedExit = established.events[established.events.length - 1] as any;
  assert.equal(establishedExit.id, "established-aftermath");
  assert.ok(establishedExit.outcome.endsFlow);
});

test("方术教门按生命周期覆盖三幕、疫病教团行为与道具链路", async () => {
  const base = (await loadNarrativeWorldDefinition("ancient"))!;
  const pack = (await loadNarrativeStoryPack(base, "ancient.mystic-order"))!;
  const flow = pack.eventFlow!;
  assert.equal(flow.groups.length, 14);
  assert.equal(flow.groups.reduce((total, group) => total + group.events.length, 0), 43);
  const actIds = pack.acts.map((act) => act.id);
  assert.deepEqual(actIds.map((actId) => flow.groups.filter((group) => group.actIds.includes(actId)).length), [5, 5, 4]);
  for (const group of flow.groups) {
    const events = group.events as any[];
    const exits = (event: any) => event.kind === "choice"
      ? event.options.some((option: any) => option.success.endsFlow || option.failure.endsFlow)
      : event.kind === "settlement"
        ? event.rules.some((rule: any) => rule.endsFlow)
        : Boolean(event.outcome.endsFlow);
    assert.ok(exits(events[events.length - 1]), group.id + " exit");
    for (const event of events.slice(0, -1)) assert.ok(!exits(event), group.id + ":" + event.id);
  }
  const inheritanceIds = new Set(flow.groups.filter((group) => group.actIds.includes(actIds[0])).map((group) => group.id));
  for (const id of ["plague-village", "false-elixir", "heresy-trial", "lineage-recognized"]) assert.ok(inheritanceIds.has(id), id);
  const influenceIds = new Set(flow.groups.filter((group) => group.actIds.includes(actIds[1])).map((group) => group.id));
  for (const id of ["court-debate", "popular-movement", "seal-taboo", "suppression", "influence-established"]) assert.ok(influenceIds.has(id), id);
  const grants = new Set<string>();
  const consumes = new Set<string>();
  for (const group of flow.groups) {
    for (const event of group.events as any[]) {
      const results = event.kind === "choice" ? event.options.flatMap((option: any) => [option.success, option.failure])
        : event.kind === "settlement" ? event.rules : [event.outcome];
      for (const result of results) {
        for (const id of result.grantItems ?? []) grants.add(id);
        for (const id of result.consumeItems ?? []) consumes.add(id);
      }
    }
  }
  assert.ok(grants.has("medical-scroll"));
  assert.ok(grants.has("remedy-formula") && consumes.has("remedy-formula"));
  assert.ok(grants.has("faith-seal"));
  assert.ok(flow.originRoles?.includes("father") && flow.originRoles?.includes("mother") && flow.originRoles?.includes("mentor"));
  const entry = flow.groups.find((group) => group.id === "first-rite")!;
  assert.ok(entry.assetRoles?.includes("father") && entry.assetRoles?.includes("mother"));
  const basics = entry.events.find((event) => event.id === "rite-basics") as any;
  assert.ok(basics.lifeBefore);
  const lineage = flow.groups.find((group) => group.id === "lineage-recognized")!;
  const lineageExit = lineage.events[lineage.events.length - 1] as any;
  assert.equal(lineageExit.id, "lineage-aftermath");
  assert.ok(lineageExit.outcome.endsFlow);
});
