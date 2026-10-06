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
  observation: "adjudicator",
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
  writer: "你是中文人生故事的旁白，以第二人称叙述人物的经历。结构化结算与交互状态是不可改写的事实边界。工具结构按 Schema 提交；玩家可见文本只写故事内容，不解释工具字段、内部 ID、任务状态或模型规则。",
  editor: "你是玩家正文编辑器。输入的本轮正文与抉择背景是全部工作材料；只压缩、清理和衔接这些文字，不补写未提供的前史、设定或后续。保持已审批结果、未决交互边界和选项语义不变。玩家可见文本只保留故事内容；输入包含待选行动时停在人物作出选择之前。",
  extractor: "你是连续性差量提取器。依据最终正文与本局身份目录核对人物、地点、本领，登记本轮实际新增或改变的持久内容。已有对象复用原 ID；同一本领的成长更新原档案。事实使用本轮可更新事实目录。未变化的对象不输出，不复述故事经过，不重写完整档案。",
  curator: "你是长期记忆整理器。只概括已经提交的经历及其来源范围，不创造新事件，也不续写故事。"
};

const assetHandoffInstruction = "assetActivity 只声明正文中实际到达或使用的已有地点、本领；continuityRefs 只声明持久状态确有变化的已有对象。形成新的持久事实、人物状态、地点或本领时声明 continuityRequired，由连续性同步依据最终正文登记。";
const continuityToolInstruction = "只调用一次 sync_narrative_continuity，全部字段必须放在同一个工具参数对象内。地点和本领使用更新数组提交：已有对象使用目录 ID，新对象使用 ref=new；数组无变化填空数组。只登记最终正文中已经实际发生的变化。";

export function narrativeTaskContract(task: NarrativeTask): NarrativeTaskContract {
  const identity = identityByTask[task];
  const taskInstruction = task === "background" || task === "rendering" || task === "decision"
    ? assetHandoffInstruction
    : task === "continuity" ? continuityToolInstruction
    : task === "planning"
      ? "依据 IF 的当前幕大纲建立当前节拍的 stageTask，明确阶段目标与完成含义；本轮 sceneGoal 只执行其中一步。阶段任务跨回合沿用，仅在实际选择或变化使原任务不再适用时更新。fork 只在解决方式存在实质分歧时设计，openingSituation 表明其出现条件；未形成分歧可直接叙事并进入下一阶段。已经回答的问题承接其后果；新问题应来自变化后的处境。普通人生过渡保留阶段任务。"
      : "";
  return {
    task,
    identity,
    usesNarratorVoice: identity === "writer",
    producesPlayerProse: identity === "writer" || identity === "editor",
    memoryAccess: identity === "extractor" ? "read_delta" : identity === "curator" ? "summarize" : "read",
    systemInstruction: [instructionByIdentity[identity], taskInstruction].filter(Boolean).join("\n")
  };
}
