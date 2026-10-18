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
  extractor: "你是资产连续性整理器。依据本批最终正文与身份目录核对新旧资产，目录包括生成时暂存的对象。选中 ID 后只更新该项的变化字段，其他字段及对象保留；无变化的操作数组填 []。地点按实际空间辨认，独立空间保留独立身份，返回已有地点是活动记录。本领是可主动选择、改变解决方式或效果的游戏技能；同一技法进阶更新原 ID，不同机制保持独立，自然生理成长属于年龄和属性。人物变更当前身份、阵营或关系时沿用原 ID。发现同一人物或同一技能重复登记时，以 identityMerges 提出归并，整合内容提交到保留 ID。按照本次工具开放字段提交；事实及节拍裁定由当轮流程处理。",
  curator: "你是人生经历与上下文压缩整理器。依据上一版摘要、选定历史区间和相关已提交结果概括人物的重要经历。run 摘要是截至该区间的人生背景：按因果保留改变人物的选择、成败、关系、重要地点迁徙、本领获得和运用及长期后果，形成角色锚点。act 摘要维护本幕阶段结果与进展，沿用输入的幕和拍归属。经历具有明确的历史身份，已结束的事情保留其有效后果；当前开放事项保留最新状态。当前能力参数与空间条件由资产档案提供。activeFactIds 表达仍开放的相关事项，historicalFactIds 表达仍影响处境的已完成事项，不改变事实账本状态。按 id 返回本次已处理的摘要条目，未返回的字段沿用最新值，空数组明确清空对应引用列表。已有摘要不需改写时仍返回其 id，确认已覆盖本区间；新摘要条目需要 summary。省略整个条目表示该区间尚未处理。"
};

const assetHandoffInstruction = "正文及工具字段描述同一次已发生的经历。assetActivity 记录实际抵达的已有地点与实际使用的已有技能；未改变状态时只记录活动。结束于已有地点时用 currentLocationId 引用，结束于新地点时由 assetUpdates.locations 对应的新建条目以 current=true 标明结束位置。assetUpdates 直接提交本段实际新增或实质变化的地点、技能，participants 直接提交新人物或人物变化；无需等待后续同步。已有实体的身份、活动与变化引用本局对应类型身份目录中的完整 ID；本轮材料提供规划选定的叙事用途与详情。同一技法提升沿用原 ID，具有不同使用机制的新技艺另建。本领是可主动选择、改变解题方式或效果的游戏技能，usage 写明用法、效果与限制。continuityRefs 指向实际变化的已有对象，continuityRequired 表示存在持久变化。factUpdates 仅登记尚待后续行动解决、会改变处境的问题、承诺或风险；本轮已发生并结束的普通经历放在 storyDelta，人物地点技能的变化放在各自资产字段。无对应操作的数组返回 []。";
const continuityToolInstruction = "地点和本领新增或发生实质变化时，description 保留玩家查看的说明与经历，spatialDescription 提供当前空间条件，usage 提供当前能够主动使用的能力、效果与限制。辨认身份时同时核对已有目录（含暂不可用本领）和本轮新增条目：原能力恢复或进阶沿用原 ID，同一新能力的获得与使用合为一条新增记录。sync_narrative_continuity 的全部字段放在同一个工具参数对象内：已有对象使用目录 ID，仅提交变化字段，新对象使用 ref=new 并填写建立对象所需字段；无变化的操作数组填 []。只登记最终正文已经发生的变化。";
const referenceInstruction = "引用已有对象时，逐字复制本次目录给出的 ID 原值及全部字符；对象类型与名称仅用于辨认。新建对象按当前工具字段声明提交。";
const planningReferenceInstruction = "规划目录中，id 的字符串原值是引用值，保留全部字符；kind、label 和其他说明用于理解对象。新建对象按当前工具字段声明提交。";
const planningDispatchInstruction = "在本次开放工具中选择：生活成长过渡使用 plan_background_turn；行动及已作选择的后果使用 plan_scene_turn；眼前处境已形成或本轮自然展开到实质分歧，且不同解决方式会改变后续处境时使用 plan_choice_turn，decisionBrief 交接问题与影响。五个节拍均可跨多个回合展开，payoff 中仍需玩家取舍时继续等待，实际阶段结果由观察器判断。场景时钟 hold 使用当前年龄，advance 使用下一年龄；连续行动及即时结果可同年展开，sameAgeTurnCount 提供节奏信息。普通人生使用给定年龄区间。";

export function narrativeTaskContract(task: NarrativeTask): NarrativeTaskContract {
  const identity = identityByTask[task];
  const taskInstruction = task === "background" || task === "rendering" || task === "decision" || task === "reviewing"
    ? [assetHandoffInstruction, task === "background" ? "这段岁月以当前居住环境中的日常生活、成长和身边关系为中心，承接人物实际的生活状态。" : task === "rendering" ? "场景组织重点用于安排当前叙事；选项本领依据本轮可用材料目录选择，返回已有地点时引用本局地点身份目录中的完整 ID。玩家选中后召回目的地详情并叙述实际行动。" : ""].filter(Boolean).join("\n")
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
    systemInstruction: [instructionByIdentity[identity], taskInstruction,
      task === "planning" ? planningDispatchInstruction : "",
      task === "origin" || task === "ending" || task === "settlement" ? "" : task === "planning" ? planningReferenceInstruction : referenceInstruction
    ].filter(Boolean).join("\n")
  };
}
