import assert from "node:assert/strict";
import test from "node:test";
import type { NarrativeEpisodeRecord, NarrativeMemoryDigest, TurnRecord } from "@reroll/shared";
import type { ChatConversationState, ConversationPromptMessage } from "../conversation.js";
import type { NarrativePromptPlan } from "../narrative.js";
import { composeNarrativeContext } from "./context/orchestrator.js";
import { buildNarrativeStoryHistory, projectNarrativeStoryHistory } from "./story-history.js";
import { recentCommittedNarrativeChanges } from "./turn.js";

function episode(index: number): NarrativeEpisodeRecord {
  return {
    id: `episode:story:${index}`, callId: `call:${index}`, sourceEventId: `story:${index}`, turnKind: "scene", age: index,
    memoryIds: [`memory:story:${index}`], factIds: [], characterIds: [], locationIds: [], abilityIds: [],
    storyDelta: `变化${index}已发生`, createdAt: index
  };
}

function digest(coveredEpisodeIds: string[], summary = "此前已经守住村落"): NarrativeMemoryDigest {
  return {
    id: "run", format: "effective_facts", scope: "run", revision: 1,
    throughEpisodeId: coveredEpisodeIds.at(-1)!, coveredEpisodeIds, summary,
    activeFactIds: [], historicalFactIds: [], characterIds: [], updatedAt: 1
  };
}

function record(index: number, overrides: Partial<TurnRecord>): TurnRecord {
  return {
    turnId: `turn:${index}`, sequence: index, kind: "scene", age: 20, ageStage: { label: "青年" },
    narrative: "", statChanges: {}, statsSnapshot: { intelligence: 5, charisma: 5, family: 5, fortune: 5, physique: 5 },
    itemsSnapshot: [], fameSnapshot: 0, createdAt: index, ...overrides
  };
}

function plan(storyHistory: ReturnType<typeof buildNarrativeStoryHistory>): NarrativePromptPlan {
  return {
    task: "rendering", storyHistory, storyBible: "世界背景", styleRules: [], activeLore: [], plotEssentials: [],
    activeThreads: [], activeCharacters: [], scene: "村落", authorNote: "", ending: ""
  };
}

function conversation(episodes: NarrativeEpisodeRecord[]): ChatConversationState {
  return {
    systemHash: "", headCore: "", headMemory: "", archive: [],
    history: episodes.flatMap((entry) => [
      { role: "user" as const, content: `岁月推进至${entry.age}岁。`, turnId: `memory:${entry.sourceEventId}` },
      { role: "assistant" as const, content: `原文${entry.age}的完整经历` }
    ])
  };
}

test("正文统一从提交记录取得未压缩原文，不再叠加近期会话", () => {
  const episodes = Array.from({ length: 8 }, (_, index) => episode(index + 1));
  const storyHistory = buildNarrativeStoryHistory({ episodes, memoryDigests: [digest(episodes.slice(0, 2).map((entry) => entry.id))] });
  const recent = conversation(episodes);
  for (const task of ["background", "rendering", "dynamic", "decision"] as const) {
    const result = composeNarrativeContext({ plan: { ...plan(storyHistory), task }, task, taskPrompt: "继续故事", conversation: recent });
    assert.ok(result.renderedContext.includes("此前已经守住村落"));
    assert.deepEqual(result.manifest.fragments.filter((entry) => entry.sourceType === "story-change").map((entry) => entry.sourceIds[0]),
      episodes.slice(2).map((entry) => entry.id));
    assert.deepEqual(result.historyMessages, []);
    assert.ok(!result.renderedContext.includes("变化1已发生"));
    assert.equal(result.renderedContext.split("变化6已发生").length - 1, 1);
  }
  const planning = composeNarrativeContext({ plan: { ...plan(storyHistory), task: "planning" }, task: "planning", taskPrompt: "规划", conversation: recent });
  assert.equal(planning.historyMessages.length, 0);
  assert.deepEqual(planning.manifest.fragments.filter((entry) => entry.sourceType === "story-change").map((entry) => entry.sourceIds[0]),
    episodes.slice(2).map((entry) => entry.id));
});

test("摘要覆盖前移或确认沿用摘要后，过渡变化自然退出，不额外调用压缩", () => {
  const episodes = Array.from({ length: 8 }, (_, index) => episode(index + 1));
  const memoryDigests = [digest(episodes.slice(0, 2).map((entry) => entry.id))];
  const before = projectNarrativeStoryHistory(buildNarrativeStoryHistory({ episodes, memoryDigests }), []);
  assert.equal(before.changes.length, 6);
  // A curation acknowledgement may retain text while advancing exact coverage.
  memoryDigests[0] = digest(episodes.slice(0, 5).map((entry) => entry.id));
  const after = projectNarrativeStoryHistory(buildNarrativeStoryHistory({ episodes, memoryDigests }), []);
  assert.equal(after.summary?.text, before.summary?.text);
  assert.deepEqual(after.changes.map((entry) => entry.id), episodes.slice(5).map((entry) => entry.id));
  const noRecent = composeNarrativeContext({ plan: plan(buildNarrativeStoryHistory({ episodes, memoryDigests })), task: "rendering", taskPrompt: "继续" });
  assert.equal(noRecent.historyMessages.length, 0);
  assert.equal(noRecent.manifest.fragments.filter((entry) => entry.sourceType === "story-change").length, 3);
});

test("追加经历保留此前原文前缀，最新处境标记置后，诊断与模型消息顺序相同", () => {
  const first = episode(1), second = episode(2);
  const state = { episodes: [first], memoryDigests: [] as NarrativeMemoryDigest[] };
  const currentPlan = () => ({ ...plan(buildNarrativeStoryHistory(state)),
    protagonist: { identity: "人物设定：守信。", currentState: "当前年龄：2岁。" },
    activeLore: ["本轮召回材料"], actBackground: "固定本幕背景" });
  const before = composeNarrativeContext({ plan: currentPlan(), task: "rendering", taskPrompt: "本轮任务" });
  state.episodes.push(second);
  const after = composeNarrativeContext({ plan: currentPlan(), task: "rendering", taskPrompt: "本轮任务" });
  const previousProse = before.runtimeContext.slice(0, before.runtimeContext.indexOf("【最新已提交处境】"));
  assert.ok(after.runtimeContext.startsWith(previousProse), "新增经历不移走旧段落前的标记而改写历史前缀");
  assert.equal(before.stableContext, after.stableContext);
  for (const request of [before, after]) {
    assert.equal(request.renderedContext, request.messages.map((message) => message.content).join("\n"));
    assert.ok(request.renderedContext.indexOf(first.storyDelta!) < request.renderedContext.indexOf("本轮召回材料"));
    assert.ok(request.renderedContext.indexOf("本轮召回材料") < request.renderedContext.indexOf("本轮任务"));
    assert.equal(request.renderedContext.split(first.storyDelta!).length - 1, 1);
    assert.ok(request.runtimeContext.endsWith("【最新已提交处境】见以上最后一段。"));
  }
  assert.ok(after.runtimeContext.indexOf(second.storyDelta!) < after.runtimeContext.indexOf("【最新已提交处境】"));
});

test("历史去重依据已提交正文的精确身份，不因同龄、近似文本或只有用户消息而遗漏", () => {
  const first = episode(1);
  first.memoryIds = [];
  first.turnId = "turn:public:1";
  const second = { ...episode(2), age: 1, storyDelta: first.storyDelta };
  const third = episode(3);
  const history = buildNarrativeStoryHistory({ episodes: [first, second, third], memoryDigests: [] });
  const userOnly: ConversationPromptMessage[] = [{ role: "user", content: "选择后继续", sourceId: "memory:story:1" }];
  assert.equal(projectNarrativeStoryHistory(history, userOnly).changes.length, 3);
  const exactProse: ConversationPromptMessage[] = [
    ...userOnly,
    { role: "assistant", content: "完全不同的正文措辞", sourceId: "memory:story:1" },
    { role: "assistant", content: "原文引用", sourceId: "not-this-run:story:2" }
  ];
  assert.deepEqual(projectNarrativeStoryHistory(history, exactProse).changes.map((entry) => entry.id), [second.id, third.id]);
  assert.deepEqual(projectNarrativeStoryHistory(history, [{ role: "assistant", content: "原文", sourceId: first.turnId }]).changes.map((entry) => entry.id), [second.id, third.id]);
  const customMemory = { ...third, memoryIds: ["memory:explicit-3"] };
  assert.equal(projectNarrativeStoryHistory({ episodes: [customMemory] }, [{ role: "assistant", content: "原文", sourceId: "memory:explicit-3" }]).changes.length, 0);
});

test("摘要覆盖按准确 episode 集合判断，观察器不接入新的叙事历史投影", () => {
  const episodes = [episode(1), episode(2), episode(3)];
  const history = buildNarrativeStoryHistory({ episodes, memoryDigests: [digest([episodes[0].id, episodes[2].id])] });
  assert.deepEqual(history.episodes.map((entry) => entry.id), [episodes[1].id]);
  const observation = composeNarrativeContext({ plan: { ...plan(history), task: "observation" }, task: "observation", taskPrompt: "判断当前阶段" });
  assert.deepEqual(observation.messages, [{ role: "user", content: "【当前任务】\n判断当前阶段" }]);
  assert.equal(observation.renderedContext, observation.messages.map((entry) => entry.content).join("\n"));
  assert.equal(observation.manifest.fragments.some((entry) => entry.section === "storyHistory"), false);
});

test("已经压缩的选择结果不再因规划标记恢复原文", () => {
  const chosen = episode(1), current = episode(2);
  const state = { episodes: [chosen, current], memoryDigests: [digest([chosen.id])] };
  const history = buildNarrativeStoryHistory(state);
  assert.deepEqual(history.episodes.map((entry) => entry.id), [current.id]);
  assert.equal(history.summary?.coveredEpisodeIds.includes(chosen.id), true);
});

test("角色背景由成功压缩替换原文，最新面板独立置后且保留玩家已选行动", () => {
  const first = { ...episode(1), turnId: "turn:one", storyDelta: "同袍受困，救人还是追击？" };
  const second = { ...episode(2), turnId: "turn:result", turnKind: "decision" as const, age: 1, storyDelta: "你救回同袍，同年返回营地。" };
  const records = [
    record(1, { turnId: first.turnId, narrative: first.storyDelta, choiceOutcome: { optionId: "safe", label: "先救人", description: "放弃追敌，背回负伤同袍。" } }),
    record(2, { turnId: second.turnId, narrative: second.storyDelta })
  ];
  const state = { episodes: [first, second], memoryDigests: [] as NarrativeMemoryDigest[] };
  const currentPlan = () => ({ ...plan(buildNarrativeStoryHistory(state, records)), protagonist: { identity: "", currentState: "当前年龄：1岁。当前能力基础：体魄=健壮。" }, origin: "边镇出生" });
  const before = composeNarrativeContext({ plan: currentPlan(), task: "rendering", taskPrompt: "写2岁的生活", conversation: conversation([first]) });
  assert.match(before.runtimeContext, /玩家已选行动：先救人/);
  assert.ok(before.runtimeContext.indexOf(first.storyDelta) < before.runtimeContext.indexOf("玩家已选行动：先救人"));
  assert.ok(before.runtimeContext.indexOf("玩家已选行动：先救人") < before.runtimeContext.indexOf(second.storyDelta));
  assert.match(before.runtimeContext, /同年返回营地/);
  assert.doesNotMatch(before.runtimeContext, /当前年龄/);
  assert.match(before.activeContext, /当前年龄：1岁/);
  assert.equal(before.historyMessages.length, 0);
  state.memoryDigests = [digest([first.id], "为救同袍放走追兵，因此被调往后营。")];
  const after = composeNarrativeContext({ plan: currentPlan(), task: "rendering", taskPrompt: "写2岁的生活" });
  assert.match(after.stableContext, /为救同袍放走追兵/);
  assert.doesNotMatch(after.runtimeContext, /救人还是追击|玩家已选行动：先救人/);
  assert.match(after.activeContext, /当前年龄：1岁/);
  assert.deepEqual(after.manifest.fragments.filter((entry) => entry.sourceType === "story-change").map((entry) => entry.sourceIds[0]), [second.id]);
});

test("抉择情景、玩家已选行动和同年实际结果组成历史，未选行动只留在展示记录", () => {
  const first = { ...episode(1), age: 20, turnId: "turn:choice" };
  const result = { ...episode(2), age: 20, turnId: "turn:result", turnKind: "decision" as const };
  const prose = "追击途中同袍坠入山沟，你勒住马缰。";
  const background = "救援会失去追敌时机，追击会使伤员失去照应。";
  const consequence = "你救回伤员，敌军趁机退去，同年返回营地。";
  const records = [record(1, { turnId: first.turnId, narrative: prose,
    choice: { sceneId: "choice:rescue", revision: 2, age: 20, background, options: [
      { id: "safe", label: "先救同袍", description: "放弃追敌，将伤员带回营地。" },
      { id: "balanced", label: "召来援手", description: "派人回营求援，自己继续追踪。" },
      { id: "risky", label: "全力追击", description: "丢下伤员，独自追赶敌军。" }
    ] }, choiceOutcome: { optionId: "safe", label: "先救同袍", description: "放弃追敌，将伤员带回营地。" }
  }), record(2, { turnId: result.turnId, narrative: consequence, kind: "choice_outcome" })];
  const state = { episodes: [first, result], memoryDigests: [] as NarrativeMemoryDigest[], memoryEntries: [
    { id: first.memoryIds[0], age: 20, text: `${prose}\n可选行动：全力追击。丢下伤员，独自追赶敌军。`, factionIds: [], characterIds: [], factIds: [] },
    { id: result.memoryIds[0], age: 20, text: consequence, factionIds: [], characterIds: [], factIds: [] }
  ] };
  const restored = JSON.parse(JSON.stringify({ state, records })) as { state: typeof state; records: typeof records };
  const history = buildNarrativeStoryHistory(restored.state, restored.records);
  for (const task of ["background", "rendering", "decision"] as const) {
    const request = composeNarrativeContext({ plan: { ...plan(history), task }, task, taskPrompt: "继续" });
    for (const text of [prose, background, "玩家已选行动：先救同袍", consequence]) {
      assert.equal(request.runtimeContext.split(text).length - 1, 1);
    }
    assert.ok(request.runtimeContext.indexOf(background) < request.runtimeContext.indexOf("玩家已选行动：先救同袍"));
    assert.ok(request.runtimeContext.indexOf("玩家已选行动：先救同袍") < request.runtimeContext.indexOf(consequence));
    assert.doesNotMatch(request.runtimeContext, /召来援手|全力追击|丢下伤员|可选行动/);
    assert.equal(request.historyMessages.length, 0);
  }
  assert.equal(restored.records[0].choice!.options.length, 3);
  const changes = recentCommittedNarrativeChanges(restored.state, 3, restored.records).join("\n");
  assert.match(changes, /玩家已选行动：先救同袍/);
  assert.doesNotMatch(changes, /全力追击/);
  restored.state.memoryDigests = [digest([first.id, result.id], "为救同袍放走敌军，已返回营地。")];
  assert.deepEqual(buildNarrativeStoryHistory(restored.state, restored.records).episodes, []);
  assert.deepEqual(recentCommittedNarrativeChanges(restored.state, 3, restored.records), []);
});
