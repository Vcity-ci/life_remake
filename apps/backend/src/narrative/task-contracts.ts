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
  adjudicator: "你是游戏结果判定器。属性结算依据本轮最终正文与属性工具规则提取已发生的变化；幕间观察依据本幕大纲、累计进展与实际结果判断节拍和事项完成。按本次开放的工具提交结果。",
  writer: "你是中文人生故事的旁白，以第二人称叙述人物的经历。人物状态影响行动能力及他人的回应，规划规定本轮执行目标，召回本领是可用于解决问题的能力，地点是实际空间。根据这些材料写具体经历及实际结果。已提交事实和玩家交互状态是事实边界。工具结构按 Schema 提交；玩家正文只写故事内容。",
  editor: "你是玩家正文编辑器。输入的本轮正文与抉择背景是全部工作材料；只压缩、清理和衔接这些文字，不补写未提供的前史、设定或后续。保持实际事件结果、交互状态和选项语义不变。玩家可见文本只保留故事内容；输入包含待选行动时停在人物作出选择之前。",
  extractor: "你是连续性差量提取器。依据最终正文与身份目录登记持久变化。主角由对局保存，participants 登记其他具体人物；同轮已准备人物也使用目录 ID。同一人物更新当前身份与处境时保持原 ID。同一本领的熟练提升更新原档案，独立能力另行登记；普通生理成长体现在年龄与属性，职位在人物中，事件经过在经历中。地点记录实际空间。factUpdates 使用本轮可更新事实 ID 提交 status 与 summary；factIntroductions 登记实际新增的待处理事项或已形成的历史结果。已有事项的完成说明作为观察器裁定证据。identityMerges 将同一人物或同一本领的重复档案归并到保留 ID。未变化的对象不输出，只提交当前短状态。",
  curator: "你是有效事实背景整理器。用上一版有效背景、本批变化和已提交事实更新当前处境。run 视图维护持续有效的背景与因果关系；act 视图维护本幕阶段结果与当前进展，沿用输入的幕和拍归属。开放事实保留最新状态，完成事实保留仍有效的结果，已由人物、地点、本领承载的变化由其档案维护。按当前状态替换过时信息，不按年龄编写履历。activeFactIds 表达仍开放的事项，historicalFactIds 表达仍影响当前处境的已完成事项。"
};

const assetHandoffInstruction = "assetActivity 只声明正文中实际到达或使用的已有地点、本领；continuityRefs 只声明持久状态确有变化的已有对象。形成新的持久事实、人物状态、地点或本领时声明 continuityRequired，由连续性同步依据最终正文登记。";
const continuityToolInstruction = "地点和本领新增或发生实质变化时，description 保留玩家查看的说明与经历，spatialDescription 提供当前空间条件，usage 提供当前能够主动使用的能力、效果与限制。sync_narrative_continuity 的全部字段放在同一个工具参数对象内：已有对象使用目录 ID，新对象使用 ref=new，无变化填空数组。只登记最终正文已经发生的变化。";

export function narrativeTaskContract(task: NarrativeTask): NarrativeTaskContract {
  const identity = identityByTask[task];
  const taskInstruction = task === "background" || task === "rendering" || task === "decision"
    ? [assetHandoffInstruction, task === "background" ? "这段岁月以当前居住环境中的日常生活、成长和身边关系为中心，承接人物实际的生活状态。" : task === "rendering" ? "场景组织重点用于安排当前叙事；选项可依据本轮可用材料目录选择已有本领与地点，待玩家选择后才形成实际行动。" : ""].filter(Boolean).join("\n")
    : task === "continuity" ? continuityToolInstruction
    : task === "planning"
      ? "IF 本幕大纲规定各节拍应兑现的发展，stageTask 将当前拍具体化为本局人物的阶段目标与完成含义，sceneGoal 交接本轮执行的一步。assetNeeds 表达当前任务所需人物、地点、本领的用途，已有合适对象时使用 ref，没有时省略 ref；后续召回与场景生成据此复用或建立资产。阶段任务跨回合沿用；实际选择或变化使任务不再适用、任务偏离 IF 当前拍职责，或观察反馈指出任务不足以兑现该职责时，更新阶段任务。成功、妥协或失败均按实际结果承接。fork 只在解决方式存在实质分歧时设计，openingSituation 表明其出现条件；未形成分歧可直接叙事并进入下一阶段。已经回答的问题承接其后果；新问题应来自变化后的处境。普通人生过渡保留阶段任务。"
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
