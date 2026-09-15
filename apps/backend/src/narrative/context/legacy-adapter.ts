import { formatNarrativePromptPlan, type NarrativePromptPlan } from "../../narrative.js";
import { narrativeContextFragment } from "./fragments.js";
import type { NarrativeContextFragment } from "./types.js";

/** Temporary migration adapter for world definitions that do not use task plans. */
export function legacyNarrativePlanFragment(plan: NarrativePromptPlan): NarrativeContextFragment[] {
  const fragment = narrativeContextFragment({
    id: "legacy:narrative-plan",
    layer: "active",
    section: "raw",
    sourceType: "legacy-plan",
    sourceIds: ["legacy:narrative-plan"],
    priority: 100,
    content: formatNarrativePromptPlan(plan),
    required: true,
    order: 0
  });
  return fragment ? [fragment] : [];
}
