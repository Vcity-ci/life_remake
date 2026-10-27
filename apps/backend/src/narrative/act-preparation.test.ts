import assert from "node:assert/strict";
import test from "node:test";
import type { DifficultyConfig, WorldConfig, NarrativeActOutline } from "@reroll/shared";
import { createDefaultGameplayTuning } from "@reroll/shared";
import { createRun, appendPublicTurnRecord, toClientRun, dynamicBackgroundAttributePolicy, type InternalRunState } from "../engine.js";
import { ensureNarrativeActRuntime, ensureNarrativeRunState, refreshNarrativeActAdmission, narrativeActDeficits, advanceNarrativeActBeat, isNarrativeWorldStageReady, buildNarrativePromptPlan } from "../narrative.js";
import { loadNarrativeWorldDefinition } from "../content.js";
import { loadNarrativeStoryPack, loadNarrativeStoryPacksForWorld } from "../story-packs.js";
import { resolveNarrativeExperience } from "../narrative-experience.js";
import { ActPreparationJobs, prepareActRequest, recordActTransition, actPreparationMode, applyActPreparationResult } from "./act-preparation.js";
import { protagonistParts, protagonistIntroduction } from "./protagonist.js";
import { parseNarrativeActWorldCard } from "./act-outline.js";
import { generateNarrativeTurnPlan, dynamicNarrativeRenderPrompt } from "../ai.js";
import { stepRunSchema } from "../schema.js";
import { composeNarrativeContext } from "./context/orchestrator.js";
import type { NarrativeTurnEnvelope } from "./turn.js";

const world: WorldConfig = { id: "ancient", name: "古代", intro: "边境", stylePrompt: "主持", milestoneAges: [], endAgeRange: { min: 100, max: 100 }, yearlyEventHints: [] };
const difficulty: DifficultyConfig = { id: "test", name: "测试", description: "测试", yearlyVolatility: 0, growthBias: 0, riskRewardMultiplier: 1, failurePenaltyMultiplier: 1 };

async function fixture(worldId = "ancient", packId = "ancient.frontier-commander") {
  const base = (await loadNarrativeWorldDefinition(worldId))!;
  const pack = (await loadNarrativeStoryPack(base, packId))!;
  assert.ok(pack);
  const definition = resolveNarrativeExperience(base, pack);
  const tuning = createDefaultGameplayTuning(); tuning.bootstrap.selectedCardMin = 0;
  const run = createRun({ world: { ...world, id: worldId }, difficulty, cards: [], tuning, narrativeEnabled: true, storyPack: pack }, {
    clientId: "new-act-test", worldId, storyPackId: pack.id, difficultyId: "test", personaPrompt: "愿意保护同伴、谨慎求证的人",
    talentPointTotal: 25, stats: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 }, selectedCardIds: []
  });
  run.narrative = ensureNarrativeActRuntime(run.narrative, definition, 0);
  run.narrative.opening = { status: "ready", profile: { summary: "你出生于边境一个普通家庭。", seedHints: [] } };
  return { run, definition, pack };
}

function outline(run: InternalRunState): NarrativeActOutline {
  return parseNarrativeActWorldCard({ background: "敌方斥候正在探查关门，巡哨长辈能接应报信。", beats: Object.fromEntries(
    ["setup", "escalation", "pressure", "climax", "payoff"].map((beat) => [beat, { change: `敌情与守军的实际处境发生改变：${beat}`, props: ["斥候", "巡哨长辈"], timeframe: null }])) }, run.narrative.actRuntime!.actId);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("所有 IF 加载具体冒险与独立关键项；不同题材不依赖军事任务", async () => {
  for (const worldId of ["ancient", "fantasy", "modern"]) {
    const base = (await loadNarrativeWorldDefinition(worldId))!;
    const packs = await loadNarrativeStoryPacksForWorld(base);
    assert.equal(packs.length, 6);
    for (const pack of packs) for (const act of pack.acts) {
      assert.ok(act.adventureSeeds.length);
      assert.equal(Object.keys(act.entryRequirements).length, 2);
      const resolved = resolveNarrativeExperience(base, pack);
      assert.deepEqual(resolved.mainlineActs!.find((item) => item.id === act.id)!.entryRequirements, act.entryRequirements);
    }
  }
});

test("关键属性不能互相抵消；达标后降属性和推进节拍不撤销资格，新幕重置", async () => {
  const { run, definition, pack } = await fixture();
  const targets = Object.entries(pack.acts[0].entryRequirements);
  for (const [key, target] of targets) run.stats[key as keyof typeof run.stats] = target;
  run.stats[targets[0][0] as keyof typeof run.stats] = 100;
  run.stats[targets[1][0] as keyof typeof run.stats] = targets[1][1] - 1;
  assert.equal(refreshNarrativeActAdmission(run, definition), false);
  assert.equal(narrativeActDeficits(run, definition).length, 1);
  run.stats[targets[1][0] as keyof typeof run.stats]++;
  run.age = 12;
  assert.equal(refreshNarrativeActAdmission(run, definition), true);
  assert.equal(run.narrative.actRuntime!.admittedAtAge, 12);
  run.stats = { intelligence: 0, charisma: 0, family: 0, fortune: 0, physique: 0 };
  run.narrative = ensureNarrativeRunState(JSON.parse(JSON.stringify(run.narrative)), true, 12);
  for (const beat of ["opening", "escalation", "pressure", "climax"] as const) assert.equal(isNarrativeWorldStageReady(run, definition, beat), true);
  run.narrative.actRuntime!.beat = "payoff";
  run.narrative = advanceNarrativeActBeat(run.narrative, definition, 13).state;
  assert.equal(run.narrative.actRuntime!.admittedAtAge, undefined);
  assert.equal(refreshNarrativeActAdmission(run, definition), false);
  assert.equal(run.narrative.actRuntime!.outline, undefined);
});

test("慢规划与生活提交并行；去重捕获一次，返回只合并卡，不覆盖新经历、成长、资产和记忆", async () => {
  const { run } = await fixture();
  const jobs = new ActPreparationJobs();
  const token = prepareActRequest(run)!;
  const actId = run.narrative.actRuntime!.actId;
  const started = deferred<void>(); const response = deferred<NarrativeActOutline>();
  let calls = 0;
  const start = () => jobs.start(`${run.runId}:${actId}`, async () => structuredClone(run), async (snapshot) => {
    calls++; assert.equal(snapshot.age, 0); started.resolve(); return response.promise;
  }, async (card) => applyActPreparationResult(run, actId, token, card));
  const first = start(), duplicate = start();
  assert.equal(first, duplicate);
  await started.promise;
  run.age = 3; run.stats.intelligence++;
  run.narrative.memoryRevision++;
  run.history.push({ age: 3, title: "生活", summary: "你和伙伴完成练习。", statChanges: { intelligence: 1 }, tags: [] });
  run.narrative.assets = { currentLocationId: "new-home", locations: [{ id: "new-home", name: "新住处", description: "当下居所", introduced: { age: 3 }, lastSeen: { age: 3 } }], abilities: [] };
  recordActTransition(run, actId);
  const during = structuredClone(run);
  response.resolve(outline(run)); await first;
  assert.equal(calls, 1);
  assert.equal(run.age, during.age);
  assert.deepEqual(run.stats, during.stats);
  assert.deepEqual(run.history, during.history);
  assert.deepEqual(run.narrative.assets, during.narrative.assets);
  assert.equal(run.narrative.memoryRevision, during.narrative.memoryRevision);
  assert.equal(run.narrative.actRuntime!.preparation!.bufferedTurns, 1);
  assert.equal(actPreparationMode(run), "ready");
  assert.equal(prepareActRequest(run), undefined);
});

test("缓冲两次即等待；查询不启动任务，失败重试和保存恢复保留次数，过期结果不能写入", async () => {
  const { run, definition } = await fixture();
  const token = prepareActRequest(run)!; const actId = run.narrative.actRuntime!.actId;
  assert.equal(actPreparationMode(run), "transition");
  recordActTransition(run, actId);
  assert.equal(toClientRun(run).actPlanning!.bufferedTurns, 1);
  recordActTransition(run, actId);
  const age = run.age;
  assert.equal(actPreparationMode(run), "waiting");
  assert.equal(toClientRun(run).actPlanning!.status, "pending");
  assert.equal(run.age, age);
  applyActPreparationResult(run, actId, token);
  assert.equal(actPreparationMode(run), "failed");
  assert.equal(prepareActRequest(run), undefined);
  const retryToken = prepareActRequest(run, true)!;
  assert.notEqual(token, retryToken);
  run.narrative = ensureNarrativeRunState(JSON.parse(JSON.stringify(run.narrative)), true, run.age);
  assert.equal(prepareActRequest(run), retryToken, "恢复沿用同一待处理任务身份");
  assert.equal(run.narrative.actRuntime!.preparation!.bufferedTurns, 2);
  assert.equal(applyActPreparationResult(run, actId, token, outline(run)), false);
  assert.equal(applyActPreparationResult(run, "other-act", retryToken, outline(run)), false);
  assert.equal(applyActPreparationResult(run, actId, retryToken, outline(run)), true);
  assert.equal(actPreparationMode(run), "ready");
  run.narrative.actRuntime!.beat = "payoff";
  run.narrative = advanceNarrativeActBeat(run.narrative, definition, run.age).state;
  assert.equal(run.narrative.actRuntime!.preparation, undefined);
  assert.equal(applyActPreparationResult(run, actId, retryToken, outline(run)), false);
  assert.ok(stepRunSchema.safeParse({ runId: run.runId, action: "prepare_act" }).success);
});

test("死亡后规划结果失效；后台异常登记失败后允许显式重试", async () => {
  const { run } = await fixture(); const actId = run.narrative.actRuntime!.actId;
  const token = prepareActRequest(run)!; const jobs = new ActPreparationJobs();
  await jobs.start("failure", async () => run, async () => { throw new Error("provider timeout"); }, async (card) => applyActPreparationResult(run, actId, token, card));
  assert.equal(actPreparationMode(run), "failed");
  const next = prepareActRequest(run, true)!;
  run.ended = true;
  assert.equal(applyActPreparationResult(run, actId, next, outline(run)), false);
  assert.equal(prepareActRequest(run, true), undefined);
});

test("未就绪的普通生活不调用规划；准备输入有不足项与流派，模型与前端角色来源一致", async () => {
  const { run, definition } = await fixture();
  const envelope: NarrativeTurnEnvelope = { callId: "transition", source: "background", worldId: run.worldId, currentAge: 0,
    backgroundAgeRange: { fromAge: 1, toAge: 3 }, act: definition.mainlineActs![0], beat: "setup", capabilities: ["background"],
    storyPatterns: [], socialForces: [], focusReferences: [], statTiers: { intelligence: "low", charisma: "low", family: "low", fortune: "low", physique: "low" }, clock: { mode: "advance", sameAgeTurnCount: 0, maxSameAgeTurns: 3 } };
  const plan = await generateNarrativeTurnPlan(run, world, envelope, { apiKey: "", promptPack: {}, providerConfig: { provider: "openai-compatible", baseUrl: "https://example.invalid", model: "unused", apiPath: "/chat/completions", temperature: .7, maxTokens: 2000, timeoutMs: 100 } });
  assert.equal(plan.turnKind, "background");
  assert.equal(plan.actOutline, undefined);
  const context = buildNarrativePromptPlan(run, definition, null, "background")!;
  const projected = composeNarrativeContext({ plan: context, task: "background", taskPrompt: "过渡生活" });
  assert.ok(projected.renderedContext.includes(definition.worldCore!.identity));
  assert.equal(projected.renderedContext.includes(run.storyPackSnapshot!.acts[0].objective), false);
  run.narrative.actRuntime!.growthFocusId = run.narrative.actRuntime!.growthFocusOptions![1].id;
  assert.deepEqual(buildNarrativePromptPlan(run, definition, null, "rendering")!.protagonist, protagonistParts(run));
  assert.equal(toClientRun(run).protagonistIntroduction, protagonistIntroduction(run));
  assert.ok(protagonistIntroduction(run).includes(run.narrative.opening!.profile!.summary));
  const record = appendPublicTurnRecord(run, { entryId: "origin", age: 0, ageStage: { label: "幼年" }, kind: "origin", narrative: "你出生了。", statChanges: {} });
  const shown = record.protagonistIntroductionSnapshot;
  run.age = 30; run.stats.physique = 60;
  assert.equal(toClientRun(run).protagonistIntroduction, shown);
  const prompt = dynamicNarrativeRenderPrompt({ act: envelope.act, beat: "setup", presentation: "summary", sceneAge: 3,
    allowedTurnKinds: ["background"], backgroundAttributePolicy: dynamicBackgroundAttributePolicy(run),
    backgroundAgeRange: { fromAge: 1, toAge: 3 }, storyPatterns: [], socialForces: [], knownCharacters: [], statTiers: envelope.statTiers,
    growthFocus: { label: "协作互助", description: "通过合作学习" }, preparation: { mode: "prepare", deficits: [{ stat: "physique", label: "体魄", value: 5, target: 9 }] } }, 0);
  assert.ok(prompt.includes("体魄（现有5，所需9）"));
  assert.ok(protagonistParts(run).currentState.includes(run.narrative.actRuntime!.growthFocusOptions![1].description));
  assert.ok(prompt.includes("1-3岁"));
});
