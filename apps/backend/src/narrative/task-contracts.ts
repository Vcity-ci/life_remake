import { NARRATIVE_ABILITY_DEFINITION, type NarrativeTask } from "../narrative-prompts.js";

export type NarrativeTaskIdentity = "planner" | "adjudicator" | "writer" | "extractor" | "curator";
export type NarrativeInteractionState = "none" | "choice_pending" | "choice_resolved" | "ending_pending" | "ending_locked";
export interface NarrativeTaskContract {
  task: NarrativeTask;
  identity: NarrativeTaskIdentity;
  usesNarratorVoice: boolean;
  producesPlayerProse: boolean;
  memoryAccess: "read" | "read_delta" | "summarize";
  systemInstruction: string;
}

const identities: Record<NarrativeTask, NarrativeTaskIdentity> = {
  origin: "writer", background: "writer", planning: "planner", observation: "adjudicator",
  curation: "curator", horizon: "planner", settlement: "adjudicator", continuity: "extractor",
  rendering: "writer", dynamic: "writer", decision: "writer",
  closure: "adjudicator", ending: "writer"
};

const instructions: Record<NarrativeTaskIdentity, string> = {
  planner: "你组织游戏主持所需的材料，不写玩家正文。",
  writer: "你是这一回合的人生叙事游戏主持人，以第二人称讲述。依据本幕选定的局势，推演行动与各方反应；各方有自己的目标和依靠，主角的状态与能力决定如何应对。玩家决定主角的重要行动与取舍。人物、地点和本领是行动条件，用它们推动故事，不介绍档案。历史承接已经形成的处境，实际结果优先于尚未发生的安排。",
  adjudicator: "依据本次提供的实际经历与规则，通过工具提交判断。",
  extractor: "你是叙事状态的维护者，不是作者。本批正文已经发生，你只使状态表与它一致。只写现在是什么，不转写动作、对话或经过；字段用状态话表达。只提交因本批正文改变的值，未变或判断不了的字段省略。新对象先登记身份和已知现状，资料不足保留 pendingDetails，不推测来历、用法或评价。",
  curator: "将上一版记忆与新增的已发生正文贯通压缩，以重要年龄区间概括人物主要经历和因果，取代所覆盖原文。保留重要结果和仍在持续的问题，合并重复过程，不逐岁缩写，也不另行维护资产档案。"
};

const registration = `${NARRATIVE_ABILITY_DEFINITION}正文涉及的新人物、地点、本领仅登记 ID 与名称；已有对象沿用目录完整 ID。assetActivity 记录实际抵达的地点和使用的本领；currentLocationId 或新地点的 current 标明停留位置。详情由连续性同步依据正文整理，无操作数组填 []。`;
const routing: Partial<Record<NarrativeTask, string>> = {
  planning: `幕初从素材选定本局具体局势与五节拍。幕内只依据本幕世界卡与实际进展召回资产和知识、交接时间。${NARRATIVE_ABILITY_DEFINITION}已有对象原样复制完整 ID，名称和说明用于理解；缺少时可提出用途。`,
  origin: `${registration} 你在给这条 IF 线布置入口，不是写人物传记。家庭身份、生计与关系必须使进入第一幕核心场合可信。给出一件与本线相关的实物和一条社会关系作为后续把手；普通实物通过人物现状或地点设施承接，宝物沿用本领登记。天赋只影响做事方式，不替换家庭的社会位置和生计。停在出生时。`,
  background: `${registration} 按给定年龄写这个世界中的日常生活。允许平静、安稳的一年。`,
  rendering: `${registration} 围绕本轮承接的冲突，写清行动、各方回应与改变后的处境，再停在新处境或待选行动前。一轮可有连续动作，不必完成整拍。遇到需要玩家决定的重要行动或取舍，调用 render_choice_prose，不能替玩家回答。抉择应有真实后果；只有实际存在时才写期限。`,
  dynamic: registration,
  decision: `${registration} 写已选行动的实际结果，落实后果。`,
  continuity: `sync_narrative_continuity 提交一个参数对象，无变化数组填 []。人物的身份、阵营、处境和关系维护当前值；地点维护性质、空间、设施资源与关联方现状；本领维护当前作用和使用条件，技艺另记简短熟练程度，宝物不填熟练程度；来历仅留简要信息。${NARRATIVE_ABILITY_DEFINITION} 事件仅登记持续事项、有效限制或重要结果，同一事项复用 ID，持续用 stay，实际结束用 finish。使用与到访只留活动记录，不自动建事件。未变字段省略；明确解除才用空字符串或 []。语义重复通过 identityMerges 保留一个 ID 后更新整合状态。pendingDetails 在本批实际揭示所需资料后才改为 false，不能为填满资料而补写。`,
  observation: "只判断本拍的改变在实际正文里发生了没有。发生则 advance 并引正文作证；未发生则 hold 并说明缺少的反应、条件或代价。局部事情告一段落不等于本拍完成。成功、失败或付出代价都可能完成一拍。不要评价文笔或规划下一步。",
  settlement: "仅根据本轮最终正文与属性规则结算实际变化。"
};

export function narrativeTaskContract(task: NarrativeTask): NarrativeTaskContract {
  const identity = identities[task];
  return { task, identity, usesNarratorVoice: identity === "writer",
    producesPlayerProse: identity === "writer",
    memoryAccess: identity === "extractor" ? "read_delta" : identity === "curator" ? "summarize" : "read",
    systemInstruction: [instructions[identity], routing[task]].filter(Boolean).join("\n") };
}
