import type { NarrativeTask } from "../narrative-prompts.js";

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

const host = "你是人生叙事游戏的主持人。依据本幕局势、当前人物和实际历史继续故事，推演主角行动、各方主动行动及其后果。需要玩家决定一件完整事件的关键取舍时，调用 render_choice_prose 并等待回答。";
const duties: Partial<Record<NarrativeTask, string>> = {
  origin: "写出符合这条 IF 入口的出生环境与家庭，给出一件相关实物和一条社会关系。天赋影响行事方式，不替换家庭身份与生计。停在出生时。",
  background: "按给定年龄或区间写人物的日常生活，允许平静与积累。",
  rendering: host,
  dynamic: host,
  decision: "依据已选行动和确定的检定结果，裁定并结束这次事件。",
  ending: "用一段简短的文字总结并评价本局人生。",
  continuity: "对照本批实际对话，判断相关对象是否仍有持续作用，并维护其现状。只提交真正改变的字段、条目或关系；合并同一身份，撤下没有持续作用的登记。未变或无依据的内容省略，不转写经过。",
  curation: "将这一时期的正文压缩成简短的大事记，供后续续写。用两三句话概括重要转折与已经落定的结果，省略日常动作、对话和办理过程。不补充原文没有的事实。",
  observation: "依据本幕目的、收束含义及 IF 整体方向与结局标准，判断实际历史应继续当前幕（ongoing）、结束本幕进入下一幕（act_closed），还是整局已经形成结局（run_ended）。收束提交实际结果依据；整局结束同时提交结局等级。局部受挫不自动判负，已经符合结局标准的实际结果也不因未来仍可能翻盘而强行继续。未来安排不是已发生的证据，最后一幕收束须同时判断整局结局。",
  settlement: "根据本轮最终正文与属性规则提取实际变化。"
};

export function narrativeTaskContract(task: NarrativeTask, planningPurpose?: "initial" | "execute" | "continuation", eventFlow = false, presetAssets = false): NarrativeTaskContract {
  const identity = identities[task];
  let duty = task === "planning"
    ? planningPurpose === "initial"
      ? "依据 IF 素材与实际历史，为本幕准备可运行的局势。确定行动方的目的、力量和关系，组织关键地点、持续压力及所涉利益。压力说明无人干预时的世界发展；玩家行动与结果由实际游戏产生。"
      : "从目录选择与当前局势相关的对象和知识引用。没有相关材料可以为空，无需安排剧情。"
    : duties[task] ?? "依据本次实际材料与规则提交判断。";
  if (eventFlow && task === "planning" && planningPurpose === "initial") duty = "依据 IF 素材组织本幕人物、地点、压力与利益。实际历史用于承接已形成的处境；压力来自各方目的、力量与既定局势。从人工事件组中选出本幕可用的组和开场组，绑定角色名称。事件组内的行动与结果骨架由素材提供，不另写事件树。";
  if (task === "planning" && planningPurpose === "continuation") duty = "依据已提交结果与当前处境，从候选素材选择接续的事件单元或事件组。只提交路由身份，不改写材料、不裁定奖惩、不重新判断收束。";
  if (eventFlow && (task === "rendering" || task === "dynamic")) duty = "你是人生叙事游戏的主持人。依据本幕局势、当前人物和实际历史，讲述本段事件中主角与各方的行动。已给定的本段结果由这次正文落实；开放抉择时停在玩家作答前。";
  if (eventFlow && task === "observation") duty = "依据实际历史、本幕目的与收束标准判断整幕结果，事件组结束不等于本幕收束。尚未收束返回 ongoing；本幕结果已成立且还有下一幕时返回 act_closed；整局已符合 IF 结局标准时返回 run_ended，并确认结局等级与主角生死。";
  if (presetAssets && task === "continuity") duty = "对照新增实际对话，只整理本批候选中的预设资产。记录它们已经改变的现状；没有出现或没有变化的对象省略，不整理经过，不增加候选以外的资产。";
  return { task, identity, usesNarratorVoice: identity === "writer",
    producesPlayerProse: identity === "writer",
    memoryAccess: identity === "extractor" ? "read_delta" : identity === "curator" ? "summarize" : "read",
    systemInstruction: identity === "writer" ? `${duty}以第二人称“你”叙述玩家人物。` : duty! };
}
