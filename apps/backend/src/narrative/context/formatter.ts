import type { NarrativeContextFragment, NarrativeContextSection } from "./types.js";

const SECTION_ORDER: NarrativeContextSection[] = [
  "raw", "persona", "talents", "seedHints", "origin", "world", "palette", "mainline", "route", "handoff",
  "lore", "characters", "factDirectory", "facts", "resolvedFacts", "locations", "abilities",
  "assets", "digests", "memories", "styleExamples", "ending", "authorNote", "task"
];

function renderSection(section: NarrativeContextSection, values: string[]): string {
  if (!values.length) return "";
  switch (section) {
    case "raw":
    case "assets":
    case "task": return values.join("\n");
    case "persona": return `人物设定：${values[0]}`;
    case "talents": return `本局天赋：${values.join("；")}`;
    case "seedHints": return `可选身世线索（尚非已发生事实）：${values.join("；")}`;
    case "origin": return `人物来处：${values[0]}`;
    case "world": return `世界常量：${values.join("\n")}`;
    case "palette": return `本轮可借用的叙事质地：${values.join("；")}`;
    case "mainline": return `故事发展脉络：${values[0]}`;
    case "route": return `当前经历视角：${values[0]}`;
    case "handoff": return `前幕形成的处境：${values.join("；")}`;
    case "lore": return `相关世界知识：${values.join("；")}`;
    case "styleExamples": return `本轮表达样例（只模仿节奏与观察方式，不复刻专名和情节）：${values.join("\n")}`;
    case "authorNote": return `当前场景关注：${values.join("；")}`;
    case "characters": return `人物档案：${values.join("；")}`;
    case "factDirectory": return `事项引用目录：${values.join("；")}`;
    case "facts": return `当前相关事实：${values.join("；")}`;
    case "resolvedFacts": return `已发生的结果：${values.join("；")}`;
    case "locations": return `地点档案：${values.join("；")}`;
    case "abilities": return `本领档案：${values.join("；")}`;
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
    userFragments.filter((entry) => entry.section === section).sort((a, b) => a.order - b.order).map((entry) => entry.content)
  )).filter(Boolean).join("\n");
}
