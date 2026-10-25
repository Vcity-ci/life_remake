import type { NarrativeContextFragment, NarrativeContextSection } from "./types.js";
import type { NarrativePromptPlan } from "../../narrative.js";

export function formatNarrativeProtagonistParts(plan: NarrativePromptPlan | undefined): { identity: string; experience: string; currentState: string } {
  if (!plan?.protagonist) return { identity: "", experience: "", currentState: "" };
  const summary = plan.storyHistory?.summary;
  return {
    identity: plan.protagonist.identity,
    experience: [
      plan.origin && !summary?.originCovered && !plan.storyHistory?.episodes.some((entry) => entry.sourceEventId === "origin") ? `人物来处：${plan.origin}` : "",
      summary?.text ? `过去的重要经历（已发生的背景）：${summary.text}` : !plan.storyHistory && plan.effectiveBackground ? `已有经历：${plan.effectiveBackground}` : ""
    ].filter(Boolean).join("\n"),
    currentState: plan.protagonist.currentState
  };
}

const SECTION_ORDER: NarrativeContextSection[] = [
  "raw", "persona", "talents", "seedHints", "origin", "world", "worldSituation", "actWorld", "mainline", "route",
  "lore", "styleExamples", "protagonist", "characters", "factDirectory", "facts", "resolvedFacts", "locations", "abilities",
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
    case "seedHints": return `可选身世线索（尚非已发生事实）：${values.join("；")}`;
    case "origin": return `人物来处：${values[0]}`;
    case "world": return `世界常量（故事成立的规律，用于组织本幕世界卡）：${values.join("\n")}`;
    case "worldSituation": return `故事起点的世界局势（用于选定本幕冲突；当前现状以已发生经历为准）：${values.join("\n")}`;
    case "actWorld": return `本幕故事背景（幕初局势与发展方向，实际变化以已发生经历为准）：\n${values.join("\n")}`;
    case "mainline": return `故事发展脉络：${values[0]}`;
    case "route": return `当前经历视角：${values[0]}`;
    case "lore": return `相关世界知识（势力背景与行动参考）：\n${values.join("\n")}`;
    case "styleExamples": return `本轮表达样例（只模仿节奏与观察方式，不复刻专名和情节）：${values.join("\n")}`;
    case "authorNote": return `当前场景关注：${values.join("；")}`;
    case "characters": return `人物条件（据身份、处境与关系写反应，不复述档案）：${values.join("；")}`;
    case "factDirectory": return `事项引用目录：${values.join("；")}`;
    case "facts": return `持续事项与有效后果（遵守已经形成的限制，按本轮发展承接，不必全部推进或结案）：${values.join("；")}`;
    case "storyHistory": return `已经发生的故事背景：\n${values.join("\n")}`;
    case "resolvedFacts": return `已发生的结果：${values.join("；")}`;
    case "locations": return `地点条件（空间、关联方、资源和障碍决定这里能做什么，不能绕过现存限制）：${values.join("；")}`;
    case "abilities": return `行动条件（技艺、能力与宝物；按召回用途使用）：${values.join("；")}`;
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
