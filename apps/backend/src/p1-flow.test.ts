import assert from "node:assert/strict";
import { hostingFixture } from "./narrative/hosting-fixture.js";
import test from "node:test";
import OpenAI from "openai";
import { createDefaultGameplayTuning, type WorldConfig, type DifficultyConfig } from "@reroll/shared";
import { dynamicBackgroundAttributePolicy, resolveNarrativeStatTiers, createRun, advanceWithDynamicNarrativeScene, finalizeNarrativeActEvent, openChoiceSurvivalCrisis, resolveSurvivalCrisis, canRequestDirectedClosure } from "./engine.js";
import { ensureNarrativeActRuntime, buildNarrativePromptPlan } from "./narrative.js";
import { parseNarrativeActWorldCard, commitNarrativeActOutline } from "./narrative/act-outline.js";
import { finishPendingNarrativeActEvent } from "./narrative/finalization.js";
import { loadNarrativeWorldDefinition } from "./content.js";
import { loadNarrativeStoryPack } from "./story-packs.js";
import { resolveNarrativeExperience } from "./narrative-experience.js";
import { parseNarrativeActObservation, prepareNarrativeOutcomeRequest, dynamicNarrativeRenderTools, parseDynamicNarrativeProse, renderDirectedDecisionNarrative, generateNarrativeActWorldCard, generateNarrativeTurnPlan, generateDynamicNarrativeScene, observeNarrativeAct, type NarrativeContext } from "./ai.js";
import type { NarrativeTurnEnvelope } from "./narrative/turn.js";
import { prepareChoiceCheck } from "./choice-check.js";

const world: WorldConfig = { id: "ancient", name: "边地", intro: "边地人生", milestoneAges: [], endAgeRange: { min: 90, max: 90 }, yearlyEventHints: [] };
const difficulty: DifficultyConfig = { id: "test", name: "测试", yearlyVolatility: 0, growthBias: 0, riskRewardMultiplier: 1, failurePenaltyMultiplier: 1, description: "测试" };
const context: NarrativeContext = { apiKey: "mock-only", promptPack: {}, providerConfig: { provider: "openai-compatible", baseUrl: "https://example.invalid", model: "mock", apiPath: "/chat/completions", temperature: .7, maxTokens: 2000, timeoutMs: 1000 } };
async function fixture() {
 const base = (await loadNarrativeWorldDefinition("ancient"))!, pack = (await loadNarrativeStoryPack(base, "ancient.frontier-commander"))!;
 const definition = resolveNarrativeExperience(base, pack), tuning = createDefaultGameplayTuning(); tuning.bootstrap.selectedCardMin = 0;
 const run = createRun({ world, difficulty, tuning, cards: [], narrativeEnabled: true, storyPack: pack }, { clientId: "p1", worldId: "ancient", storyPackId: pack.id, difficultyId: "test", personaPrompt: "边地的人", talentPointTotal: 25, stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 }, selectedCardIds: [] });
 run.age = 20; for (const key of Object.keys(run.stats) as Array<keyof typeof run.stats>) run.stats[key] = 50;
 run.narrative = ensureNarrativeActRuntime(run.narrative, definition, 20);
 const installCard = () => { const act = definition.mainlineActs!.find(a => a.id === run.narrative.actRuntime!.actId)!;
   commitNarrativeActOutline(run.narrative, parseNarrativeActWorldCard(hostingFixture("敌军据山口，边堡守军接应百姓"), act.id, { objective: act.objective!, closureMeaning: act.closureMeaning! })); };
 installCard(); return { run, definition, installCard };
}
function submit(run: Awaited<ReturnType<typeof fixture>>["run"], definition: Awaited<ReturnType<typeof fixture>>["definition"], nextClock: "hold" | "advance" = "advance", createsDecision = false) {
 return advanceWithDynamicNarrativeScene(run, world, definition, { patternIds: [], forceIds: [], narrative: "你与同伴行动，敌军撤离了山口。", participants: [], createsDecision, nextClock, ...(!createsDecision ? { attributeOutcome: { effects: [] } } : {}) });
}
function observe(run: Awaited<ReturnType<typeof fixture>>["run"], decision: "ongoing" | "act_closed" | "run_ended") {
 const pending = run.pendingActFinalization!;
 return parseNarrativeActObservation({ decision, evidence: decision !== "ongoing" ? "本幕危机已有实际结果" : null, ...(decision === "run_ended" ? { endingPolarity: "good" } : {}) }, pending.actId, pending.sourceEventId);
}
test("明确交接同年或跨年；遗漏交接拒绝且不改变年龄", async () => {
 const { run, definition } = await fixture();
 submit(run, definition, "hold"); assert.equal(run.age, 21);
 finalizeNarrativeActEvent(run, definition, observe(run, "ongoing"));
 assert.equal(run.narrative.sceneClock.mode, "hold");
 const restored = JSON.parse(JSON.stringify(run)) as typeof run;
 restored.narrative.activeScene = undefined;
 submit(restored, definition, "advance"); assert.equal(restored.age, 21);
 finalizeNarrativeActEvent(restored, definition, observe(restored, "ongoing"));
 submit(restored, definition, "hold"); assert.equal(restored.age, 22);
 assert.throws(() => parseDynamicNarrativeProse({ narrative: "事情落定。" }, "render_scene_prose"), /narrative_outcome_invalid/);
 assert.equal(parseDynamicNarrativeProse({ narrative: "训练继续。", nextClock: "hold" }, "render_scene_prose").nextClock, "hold");
 const invalid = structuredClone(run), age = invalid.age;
 assert.throws(() => advanceWithDynamicNarrativeScene(invalid, world, definition, { patternIds: [], forceIds: [], narrative: "未交接", participants: [], attributeOutcome: { effects: [] } }), /narrative_next_clock_required/);
 assert.equal(invalid.age, age);
});
test("ongoing 不换幕；closed 按来源只完成一次，三个幕完成不受高潮收尾计数否决", async () => {
 const { run, definition, installCard } = await fixture();
 for (let i = 0; i < 3; i++) {
   assert.equal(prepareChoiceCheck(run, definition).threshold, [16,25,34][i]);
   submit(run, definition, "hold");
   const actId = run.narrative.actRuntime!.actId;
   finalizeNarrativeActEvent(run, definition, observe(run, "ongoing"));
   assert.equal(run.narrative.actRuntime!.actId, actId);
   submit(run, definition, "hold");
   // The legacy display index is not an independent completion authority.
   run.narrative.completedScenes.push({ id: `display:${actId}`, mainlineActId: actId, threadId: `arc:${actId}`, openedAge: run.age, resolvedAge: run.age, decisionCount: 0 });
   const closed = observe(run, i < 2 ? "act_closed" : "run_ended"); finalizeNarrativeActEvent(run, definition, closed);
   const count = run.narrative.actCanon.length;
   assert.equal(finalizeNarrativeActEvent(run, definition, closed), false); assert.equal(run.narrative.actCanon.length, count);
   assert.equal(run.narrative.sceneClock.mode, "hold");
   if (i < 2) installCard();
 }
 run.narrative.climaxCount = 0; run.narrative.payoffCount = 0;
 assert.equal(run.narrative.actCanon.length, 2); assert.equal(canRequestDirectedClosure(run, definition), true);
});
test("待选事件不观察收束，求生和观察失败后都恢复原事件", async (t) => {
 const { run, definition } = await fixture();
 submit(run, definition);
 const source = run.pendingActFinalization!.sourceEventId, age = run.age;
 run.survivalCrisis = { id: "rescue:event", age: run.age, stageId: run.ageStage.id, stageLabel: run.ageStage.label, lowPhysiqueMax: 8, lowPhysiqueYears: 0, triggerRisk: 1, cause: "山洪围困", source: "choice", narrative: "山洪冲断退路。", action: "穿越山谷" };
 let calls = 0;
 t.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => {
   calls++; assert.equal(payload.tools[0].function.name, "observe_act_closure");
   assert.ok(payload.messages.some((m: any) => String(m.content).includes("山洪")));
   return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "obs", type: "function", function: { name: "observe_act_closure", arguments: JSON.stringify({ decision: "ongoing", evidence: null }) } }] } }] };
 });
 await finishPendingNarrativeActEvent(run, world, definition, context, async () => {});
 assert.equal(calls, 0); assert.equal(run.pendingActFinalization!.sourceEventId, source);
 run.stats.intelligence = 100;
 const rescue = resolveSurvivalCrisis(run, definition, "self_rescue", run.survivalCrisis!.id); assert.equal(rescue.recovered, true); run.history.push(rescue.event);
 await assert.rejects(finishPendingNarrativeActEvent(run, world, definition, context, async () => { throw new Error("checkpoint interruption"); }), /checkpoint interruption/);
 const restored = JSON.parse(JSON.stringify(run)) as typeof run;
 await finishPendingNarrativeActEvent(restored, world, definition, context, async () => {});
 assert.equal(calls, 1); assert.equal(restored.age, age); assert.equal(restored.pendingActFinalization, undefined);
 const pendingChoice = await fixture(); submit(pendingChoice.run, pendingChoice.definition, undefined, true);
 assert.equal(pendingChoice.run.pendingActFinalization, undefined);
 await finishPendingNarrativeActEvent(pendingChoice.run, world, pendingChoice.definition, context, async () => {});
 assert.equal(calls, 1);
});
test("最终请求固定前缀不受年龄、结果或求生权限改变，旧文风不换位置回流", async () => {
 const { run, definition } = await fixture();
 const dirtyWorld = { ...world, stylePrompt: "STYLE_SENTINEL" };
 const dirtyDefinition = { ...definition, styleRules: ["RULE_SENTINEL"] };
 const ctx = { ...context, promptPack: { immersionRules: "IMMERSION_SENTINEL" }, narrativePlan: buildNarrativePromptPlan(run, dirtyDefinition, null, "rendering") };
 const input = { act: definition.mainlineActs![0], presentation: "scene" as const, allowedTurnKinds: ["scene" as const], sceneAge: 21, backgroundAgeRange: { fromAge: 21, toAge: 21 }, storyPatterns: [], socialForces: [], knownCharacters: [], backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run), statTiers: resolveNarrativeStatTiers(run.stats) };
 const tool = dynamicNarrativeRenderTools(input).tools;
 const a = prepareNarrativeOutcomeRequest(run, dirtyWorld, ctx, tool, "年龄21", { task: "rendering" });
 run.age = 32; run.stats.charisma = 71;
 const b = prepareNarrativeOutcomeRequest(run, dirtyWorld, { ...ctx, narrativePlan: buildNarrativePromptPlan(run, dirtyDefinition, null, "rendering") }, tool, "年龄32", { task: "rendering" });
 assert.equal(a.conversation.headCore, b.conversation.headCore); assert.deepEqual(a.tools, b.tools);
 assert.equal(a.conversation.headCore.includes("人生叙事游戏"), true);
 const full = JSON.stringify(a);
 assert.doesNotMatch(full, /STYLE_SENTINEL|RULE_SENTINEL|IMMERSION_SENTINEL|成败.*收益|成功可以有代价|失败也可以有收获/);
});

test("两种 provider 传输贯通幕初、召回、抉择与结果，确定成败不改变固定前缀", async (t) => {
 for (const apiPath of ["/chat/completions", "/responses"] as const) await t.test(apiPath, async (transport) => {
   const { run, definition } = await fixture();
   const act = definition.mainlineActs![0];
   const ctx: NarrativeContext = { ...context, providerConfig: { ...context.providerConfig, apiPath },
     narrativePlan: buildNarrativePromptPlan(run, definition, null, "planning") };
   const requests: Array<{ name: string; system: string; tools: unknown; messages: Array<{ content: string }> }> = [];
   const declarations = { participants: [], assetUpdates: { locations: [], abilities: [] }, assetActivity: { locationIds: [], abilityIds: [] } };
   const reply = (payload: any) => {
     const tools = apiPath === "/responses" ? payload.tools : payload.tools.map((tool: any) => tool.function);
     const name = tools.some((tool: any) => tool.name === "render_choice_prose") ? "render_choice_prose" : tools[0].name;
     if (apiPath === "/responses") assert.ok(tools.every((tool: any) => tool.strict === false), "保留工具可选字段的省略语义");
     requests.push({ name, system: payload.instructions ?? payload.messages[0].content, tools,
       messages: payload.input ?? payload.messages.slice(1) });
     const args = name === "plan_act_world_card" ? hostingFixture("山口敌军封路，边堡守军需要救回百姓。")
       : name === "recall_scene_assets" ? { recallRefs: ["ancient.outlands"] }
       : name === "render_choice_prose" ? { ...declarations, narrative: "你赶到山口，敌军已截住迁民。", background: "百姓困在山口，你决定如何救援。",
           decisionBrief: { question: "怎样救回被困百姓", stakes: "百姓的性命与守军的安全" },
           optionOverrides: ["safe", "balanced", "risky"].map((id, i) => ({ id, label: ["接应撤离", "绕路引开敌军", "突入敌阵"][i],
             description: "率领同伴救援被困百姓。", abilityRefs: [], locationDirective: { mode: "stay" } })) }
       : name === "render_decision_outcome" ? { ...declarations, nextClock: "advance", narrative: "百姓已经脱困，你带队返回边堡。" }
       : { decision: "ongoing", evidence: null };
     return apiPath === "/responses" ? { id: "response:test", status: "completed", output: [{ type: "function_call", call_id: "call:test", name, arguments: JSON.stringify(args) }] }
       : { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "call:test", type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] };
   };
   if (apiPath === "/responses") transport.mock.method(OpenAI.Responses.prototype, "create", async (payload: any) => reply(payload));
   else transport.mock.method(OpenAI.Chat.Completions.prototype, "create", async (payload: any) => reply(payload));
   const envelope: NarrativeTurnEnvelope = { callId: "provider-test", source: "scene", worldId: "ancient", currentAge: 20, sceneAge: 21,
     backgroundAgeRange: { fromAge: 21, toAge: 21 }, act, capabilities: ["scene", "choice"], storyPatterns: [], focusReferences: [],
     socialForces: [{ id: "ancient.outlands", label: "塞外", summary: "外部敌军" }], statTiers: resolveNarrativeStatTiers(run.stats),
     clock: { mode: "advance", sameAgeTurnCount: 0, maxSameAgeTurns: 3 } };
   const card = await generateNarrativeActWorldCard(run, world, envelope, ctx);
   assert.equal(card.objective, act.objective); assert.equal(card.closureMeaning, act.closureMeaning);
   run.narrative.actRuntime!.outline = card;
   ctx.narrativePlan = buildNarrativePromptPlan(run, definition, null, "planning");
   const plan = await generateNarrativeTurnPlan(run, world, { ...envelope, actOutline: card }, ctx);
   assert.deepEqual(plan.forceIds, []);
   ctx.narrativePlan = buildNarrativePromptPlan(run, definition, null, "rendering");
   const choice = await generateDynamicNarrativeScene(run, world, { act, sceneAge: 21, backgroundAgeRange: envelope.backgroundAgeRange, plan,
     presentation: "scene", allowedTurnKinds: ["scene"], storyPatterns: [], socialForces: envelope.socialForces, knownCharacters: [],
     statTiers: envelope.statTiers, backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run), choiceCheck: prepareChoiceCheck(run, definition) }, ctx);
   assert.equal(choice.createsDecision, true); assert.equal(choice.nextClock, undefined);
   const resultRequests: typeof requests = [];
   for (const success of [true, false]) {
     ctx.narrativePlan = buildNarrativePromptPlan(run, definition, null, "decision");
     const result = await renderDirectedDecisionNarrative(run, world, { decision: "risky", label: "突入敌阵", description: "救回百姓",
       decisionBrief: choice.decisionBrief, allowSurvival: !success,
       roll: { decision: "risky", success, roll: .123456, probability: .654321 } }, ctx);
     assert.equal(result.nextClock, "advance");
     const sent = requests.at(-1)!; resultRequests.push(sent);
     const task = sent.messages.at(-1)!.content;
     assert.ok(task.includes("检定结果：" + (success ? "成功" : "失败")));
     assert.ok(task.includes("求生分支权限：" + (!success ? "允许" : "不允许")));
     assert.doesNotMatch(task, /0\.123456|0\.654321|风险档位|门槛|成功可以有代价|失败也可以有收获/);
     assert.equal(sent.messages.map(m => m.content).join("\n").includes(card.closureMeaning), false);
   }
   assert.equal(resultRequests[0].system, resultRequests[1].system); assert.deepEqual(resultRequests[0].tools, resultRequests[1].tools);
   assert.equal(resultRequests[0].messages[0].content, resultRequests[1].messages[0].content);
   await observeNarrativeAct(run, world, { callId: "observe", actId: act.id, sourceEventId: "event:complete", outline: card, recentStory: "百姓脱困，部伍返回。" }, ctx);
   const observer = requests.at(-1)!;
   assert.ok(observer.messages.map(m => m.content).join("\n").includes(card.closureMeaning));
   assert.doesNotMatch(JSON.stringify(requests), /世界文体|文风要求|beatChange|clockRequest|progressGap|choiceRewardGuide|成功可以有代价|失败也可以有收获/);
   assert.deepEqual(requests.map(r => r.name), ["plan_act_world_card", "render_choice_prose", "render_decision_outcome", "render_decision_outcome", "observe_act_closure"]);
 });
});
