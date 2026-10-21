import assert from "node:assert/strict";
import test from "node:test";
import type { NarrativeEpisodeRecord, NarrativeMemoryDigest } from "@reroll/shared";
import type { ChatConversationState, ConversationPromptMessage } from "../conversation.js";
import type { NarrativePromptPlan } from "../narrative.js";
import { composeNarrativeContext } from "./context/orchestrator.js";
import { buildNarrativeStoryHistory, projectNarrativeStoryHistory } from "./story-history.js";

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

test("摘要、未压缩变化、实际近期原文连续覆盖，规划不依赖近期原文", () => {
  const episodes = Array.from({ length: 8 }, (_, index) => episode(index + 1));
  const storyHistory = buildNarrativeStoryHistory({ episodes, memoryDigests: [digest(episodes.slice(0, 2).map((entry) => entry.id))] });
  const recent = conversation(episodes);
  for (const task of ["background", "rendering", "dynamic", "decision"] as const) {
    const result = composeNarrativeContext({ plan: { ...plan(storyHistory), task }, task, taskPrompt: "继续故事", conversation: recent });
    assert.ok(result.renderedContext.includes("此前已经守住村落"));
    assert.deepEqual(result.manifest.fragments.filter((entry) => entry.sourceType === "story-change").map((entry) => entry.sourceIds[0]),
      episodes.slice(2, 5).map((entry) => entry.id));
    assert.deepEqual(result.historyMessages.filter((entry) => entry.role === "assistant").map((entry) => entry.sourceId),
      episodes.slice(5).map((entry) => `memory:${entry.sourceEventId}`));
    assert.ok(!result.renderedContext.includes("变化1已发生"));
    assert.ok(!result.renderedContext.includes("变化6已发生"));
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
  assert.equal(observation.renderedContext, "判断当前阶段");
  assert.equal(observation.manifest.fragments.some((entry) => entry.section === "storyHistory"), false);
});

test("待修订大纲取得已提交选择结果，近期正文已有同一结果时不再重传", () => {
  const chosen = { ...episode(1), turnKind: "decision" as const, actId: "act.one", storyDelta: "你救回同袍，失去追踪敌军的机会。" };
  const current = { ...episode(2), actId: "act.one", storyDelta: "同袍归营作证，军中正等待对延误的裁断。" };
  const state = {
    episodes: [chosen, current], memoryDigests: [digest([chosen.id])],
    actRuntime: { actId: "act.one", beat: "pressure" as const, enteredAge: 1, lastAdvancedAge: 1, selectedRouteIds: [], decisionCount: 1, outlineNeedsRevision: true }
  };
  const history = buildNarrativeStoryHistory(state);
  const planning = composeNarrativeContext({ plan: { ...plan(history), task: "planning" }, task: "planning", taskPrompt: "修订剩余发展" });
  assert.equal(planning.renderedContext.split(chosen.storyDelta).length - 1, 1);
  assert.ok(planning.renderedContext.includes("本次修订依据：玩家选择已产生的实际结果"));
  assert.ok(planning.renderedContext.includes(`【最新已提交处境】2岁：${current.storyDelta}`));
  const recent: ConversationPromptMessage[] = [{ role: "assistant", content: "救援结果正文", sourceId: chosen.memoryIds[0] }];
  assert.deepEqual(projectNarrativeStoryHistory(history, recent).changes.map((entry) => entry.id), [current.id]);
  state.actRuntime.outlineNeedsRevision = false;
  assert.deepEqual(buildNarrativeStoryHistory(state).episodes.map((entry) => entry.id), [current.id]);
});
