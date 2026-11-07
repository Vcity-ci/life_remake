import type { NarrativeContextFragment, NarrativeContextSection } from "./types.js";
import type { NarrativePromptPlan } from "../../narrative.js";

export function formatNarrativeProtagonistParts(plan: NarrativePromptPlan | undefined): { identity: string; experience: string; currentState: string } {
  if (!plan?.protagonist) return { identity: "", experience: "", currentState: "" };
  return {
    identity: plan.protagonist.identity,
    experience: "",
    currentState: plan.protagonist.currentState
  };
}

const SECTION_ORDER: NarrativeContextSection[] = [
  "raw", "persona", "talents", "world", "worldSituation", "actWorld", "mainline", "route",
  "lore", "protagonist", "characters", "factDirectory", "facts", "resolvedFacts", "locations", "abilities",
  "assets", "digests", "memories", "storyHistory", "ending", "authorNote", "task"
];

function renderSection(section: NarrativeContextSection, values: string[]): string {
  if (!values.length) return "";
  switch (section) {
    case "raw":
    case "assets":
    case "task": return values.join("\n");
    case "persona": return `人物设定：${values[0]}`;
    case "protagonist": return `当前主角（行动与应对困难的依据）：\n${values.join("\n")}`;
    case "talents": return `本局天赋：${values.join("；")}`;
    case "world": return `世界设定：${values.join("\n")}`;
    case "worldSituation": return `故事起点的世界局势（用于选定本幕冲突；当前现状以已发生经历为准）：${values.join("\n")}`;
    case "actWorld": return `本幕故事背景（幕初局势与发展方向，实际变化以已发生经历为准）：\n${values.join("\n")}`;
    case "mainline": return `故事发展脉络：${values[0]}`;
    case "route": return `当前经历视角：${values[0]}`;
    case "lore": return `相关世界知识（势力背景与行动参考）：\n${values.join("\n")}`;
    case "authorNote": return `当前场景关注：${values.join("；")}`;
    case "characters": return `相关人物：${values.join("；")}`;
    case "factDirectory": return `事项引用目录：${values.join("；")}`;
    case "facts": return `当前有效事项：${values.join("；")}`;
    case "storyHistory": return `已经发生的故事背景：\n${values.join("\n")}`;
    case "resolvedFacts": return `已发生的结果：${values.join("；")}`;
    case "locations": return `地点条件：${values.join("；")}`;
    case "abilities": return `本领与使用条件：${values.join("；")}`;
    case "digests": return `长期经历脉络：${values.join("；")}`;
    case "memories": return `相关经历：${values.join("；")}`;
    case "ending": return values.join("\n");
    case "history": return "";
  }
}

export function formatNarrativeContextFragments(
  fragments: NarrativeContextFragment[],
  layers?: Set<NarrativeContextFragment["layer"]>
): string {
  const userFragments = fragments.filter((entry) => entry.placement === "user_context" && (!layers || layers.has(entry.layer)));
  return SECTION_ORDER.map((section) => renderSection(
    section,
    userFragments.filter((entry) => entry.section === section).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map((entry) => entry.content)
  )).filter(Boolean).join("\n");
}
