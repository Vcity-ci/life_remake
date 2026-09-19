import type { NarrativeTask } from "../narrative-prompts.js";

export type NarrativeTaskIdentity =
  | "planner"
  | "adjudicator"
  | "writer"
  | "editor"
  | "extractor"
  | "curator";

export type NarrativeInteractionState =
  | "none"
  | "choice_pending"
  | "choice_resolved"
  | "ending_pending"
  | "ending_locked";

export interface NarrativeTaskContract {
  task: NarrativeTask;
  identity: NarrativeTaskIdentity;
  /** Only writer calls inherit the world's prose voice and immersion rules. */
  usesNarratorVoice: boolean;
  /** The task may emit player-visible prose through its selected tool. */
  producesPlayerProse: boolean;
  /** Persisted material is reference context, never an implicit write set. */
  memoryAccess: "read" | "read_delta" | "summarize";
  systemInstruction: string;
}

const identityByTask: Record<NarrativeTask, NarrativeTaskIdentity> = {
  origin: "writer",
  background: "writer",
  planning: "planner",
  curation: "curator",
  horizon: "planner",
  settlement: "adjudicator",
  continuity: "extractor",
  reviewing: "editor",
  rendering: "writer",
  dynamic: "writer",
  decision: "writer",
  closure: "adjudicator",
  ending: "writer"
};

const instructionByIdentity: Record<NarrativeTaskIdentity, string> = {
  planner: "你是叙事调度器。依据引擎提供的状态与候选，通过本次开放的工具提交计划；工具结果是本次请求的唯一输出。",
  adjudicator: "你是游戏状态结算器。依据已经批准的计划、玩家行动和引擎状态，通过本次开放的工具提交已经形成的结构化结果。",
  writer: "你是中文人生故事的旁白，以第二人称叙述人物的经历。结构化结算与交互状态是不可改写的事实边界。",
  editor: "你是玩家正文编辑器。只整理本次提供的正文与背景，保持已审批结果、未决交互边界和选项语义不变。",
  extractor: "你是连续性差量提取器。只登记本轮最终正文相对既有状态实际新增或改变的内容；未变化的对象不输出。",
  curator: "你是长期记忆整理器。只概括已经提交的经历及其来源范围，不创造新事件，也不续写故事。"
};

export function narrativeTaskContract(task: NarrativeTask): NarrativeTaskContract {
  const identity = identityByTask[task];
  return {
    task,
    identity,
    usesNarratorVoice: identity === "writer",
    producesPlayerProse: identity === "writer" || identity === "editor",
    memoryAccess: identity === "extractor" ? "read_delta" : identity === "curator" ? "summarize" : "read",
    systemInstruction: instructionByIdentity[identity]
  };
}
