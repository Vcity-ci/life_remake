import type { NarrativeTask } from "../narrative-prompts.js";

export type NarrativeTaskIdentity = "planner" | "adjudicator" | "writer" | "editor" | "extractor" | "curator";
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
  reviewing: "editor", rendering: "writer", dynamic: "writer", decision: "writer",
  closure: "adjudicator", ending: "writer"
};

const instructions: Record<NarrativeTaskIdentity, string> = {
  planner: "依据本次任务组织 IF 路线的本幕故事，或为既定故事选择材料与时间。通过开放的工具提交。",
  writer: "以第二人称讲述中文人生故事。世界背景与本幕故事组织方向，当前主角的年龄、能力、处境和可用本领决定实际行动及效果。近期带年龄的正文是已经发生的经历。只把故事写入正文。",
  adjudicator: "依据本次提供的实际经历与规则，通过工具提交判断。",
  editor: "整理本轮正文的措辞与衔接，保留实际事件、结果和待选状态。只返回整理后的正文。",
  extractor: "依据本批带年龄的正文和已有资产整理人物、地点、本领。目录包含暂存对象；沿用同一实体的 ID，只提交变化字段，其余保留。同一实体的重复 ID 用 identityMerges 归并到一个保留 ID，并整合其内容。本领是可主动使用、改变解题方式或效果的游戏技能，地点是实际空间，人物阵营表示当前所属。",
  curator: "将上一版人物经历与本次已结束区间压缩为人物迄今的重要经历背景：这个人经历了什么，因此现在是谁、拥有什么、面对什么。保留主要转折、选择后果、关系与能力来由，合并办理过程和重复细节，不逐年写履历。按条目 ID 确认覆盖；未改字段沿用，空数组清空引用。"
};

const registration = "正文涉及的新人物、地点、本领仅登记 ID 与名称；已有对象沿用目录完整 ID。assetActivity 记录实际抵达的地点和使用的本领；currentLocationId 或新地点的 current 标明停留位置。详情由连续性同步依据正文整理，无操作数组填 []。";
const routing: Partial<Record<NarrativeTask, string>> = {
  planning: "初建时写本幕五节拍简要故事与可调整的年龄安排；选择结果提交后，只修订当前及未结束节点。普通执行只选有关资产并交接时间，不重写剧情。已有资产用完整 ID 选择，名称和说明用于理解；缺少的对象可提出用途。",
  origin: registration,
  background: `${registration} 按给定年龄写这个世界中的日常生活。允许平静、安稳的一年。`,
  rendering: `${registration} 沿当前节点写给定年龄或时间段的经历。遇到会改变后续处境、尚待玩家决定的实质分歧时调用抉择工具，停在作答之前；否则叙述行动及结果。大纲未预列的重要分歧也可提问。`,
  dynamic: registration,
  decision: `${registration} 写已选行动的实际结果，落实后果。`,
  continuity: "sync_narrative_continuity 的字段放在同一个工具参数对象内。暂存对象按正文补充基本信息；已有地点空间条件、技能用法或人物状态真实变化时更新对应字段。description 供展示，spatialDescription 与 usage 供以后使用。",
  observation: "根据本幕五节拍大纲、当前节拍和实际经历判断 stay/end（工具中的 hold/advance）。未完成就保持，已完成才推进；只作判断，不续写故事。",
  settlement: "仅根据本轮最终正文与属性规则结算实际变化。"
};

export function narrativeTaskContract(task: NarrativeTask): NarrativeTaskContract {
  const identity = identities[task];
  return { task, identity, usesNarratorVoice: identity === "writer",
    producesPlayerProse: identity === "writer" || identity === "editor",
    memoryAccess: identity === "extractor" ? "read_delta" : identity === "curator" ? "summarize" : "read",
    systemInstruction: [instructions[identity], routing[task]].filter(Boolean).join("\n") };
}
