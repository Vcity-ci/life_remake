import type { BackgroundCard, NarrativeRunState, Stats } from "@reroll/shared";
import { resolveNarrativeStatLabels } from "../narrative-stats.js";

export const statNames: Record<keyof Stats, string> = { intelligence: "智力", charisma: "魅力", family: "家境", fortune: "气运", physique: "体魄" };

interface ProtagonistSource {
  age: number;
  ageStage?: { label: string };
  personaPrompt: string;
  stats?: Stats;
  cards: Array<Pick<BackgroundCard, "name"> & Partial<Pick<BackgroundCard, "description" | "narrative">>>;
  narrative: NarrativeRunState;
}

/** One data projection, split by update frequency for the model's stable prefix. */
export function protagonistParts(source: ProtagonistSource, options: { includeLocation?: boolean } = {}) {
  const runtime = source.narrative.actRuntime;
  const focus = runtime?.growthFocusOptions?.find((item) => item.id === runtime.growthFocusId);
  const assets = source.narrative.assets;
  const location = assets?.locations.find((entry) => entry.id === assets.currentLocationId);
  const labels = source.stats ? resolveNarrativeStatLabels(source.stats, source.narrative.statTierConfig, source.narrative.statTierPresentation) : undefined;
  return {
    identity: [
      source.personaPrompt ? `你是这样的人：${source.personaPrompt}` : "",
      source.cards.length ? `你的天赋与行事特点：${source.cards.map((card) => `${card.name}：${card.narrative?.bias ?? card.description ?? ""}`).join("；")}` : ""
    ].filter(Boolean).join("\n"),
    currentState: [
      `你目前${source.age}岁${source.ageStage ? `，处在人生的${source.ageStage.label}阶段` : ""}。`,
      options.includeLocation !== false && location ? `你目前在${location.name}。` : "",
      labels ? `你的能力基础：${Object.entries(labels).map(([key, label]) => `${statNames[key as keyof Stats]}：${label}`).join("；")}。` : "",
      focus ? `你的学习与行动方式：${focus.label}——${focus.description}` : ""
    ].filter(Boolean).join("\n")
  };
}

export function protagonistIntroduction(source: ProtagonistSource): string {
  const parts = protagonistParts(source);
  // This projection belongs to public snapshots only. Narrative requests use
  // protagonistParts without display-maintained location or abilities.
  const abilities = source.narrative.assets?.abilities ?? [];
  const capabilities = abilities.length ? `你已有的具体本事与凭借：${abilities.map((ability) => `${ability.name}${ability.mastery ? `（${ability.mastery}）` : ""}`).join("；")}。` : "";
  return [parts.identity, parts.currentState, capabilities].filter(Boolean).join("\n\n");
}
