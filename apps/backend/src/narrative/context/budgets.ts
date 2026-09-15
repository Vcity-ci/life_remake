import type { NarrativeContextFragment, NarrativeTaskContextProfile } from "./types.js";

const LAYERS = ["stable", "runtime", "active", "recall", "history", "task"] as const;

export interface NarrativeContextBudgetResult {
  fragments: NarrativeContextFragment[];
  droppedFragmentIds: string[];
}

/**
 * Keeps required and provider-message history fragments intact. Optional user
 * context first uses its layer share, then borrows any unused global budget.
 */
export function applyNarrativeContextBudget(
  fragments: NarrativeContextFragment[],
  profile: NarrativeTaskContextProfile
): NarrativeContextBudgetResult {
  const required = fragments.filter((entry) => entry.required);
  const optional = fragments.filter((entry) => !entry.required);
  const selected = new Set(required.map((entry) => entry.id));
  const usedByLayer = Object.fromEntries(LAYERS.map((layer) => [layer, required.filter((entry) => entry.layer === layer).reduce((sum, entry) => sum + entry.estimatedTokens, 0)])) as Record<(typeof LAYERS)[number], number>;
  let used = required.reduce((sum, entry) => sum + entry.estimatedTokens, 0);
  const sorted = [...optional].sort((a, b) => b.priority - a.priority || b.order - a.order);

  const trySelectGroup = (fragment: NarrativeContextFragment, layerLimit?: number): boolean => {
    const group = fragment.groupId
      ? sorted.filter((entry) => entry.groupId === fragment.groupId && !selected.has(entry.id))
      : [fragment];
    if (!group.length) return false;
    const groupTokens = group.reduce((sum, entry) => sum + entry.estimatedTokens, 0);
    const groupLayerTokens = group.filter((entry) => entry.layer === fragment.layer).reduce((sum, entry) => sum + entry.estimatedTokens, 0);
    if (layerLimit !== undefined && usedByLayer[fragment.layer] + groupLayerTokens > layerLimit) return false;
    if (used + groupTokens > profile.budget.maxEstimatedTokens) return false;
    for (const entry of group) {
      selected.add(entry.id);
      usedByLayer[entry.layer] += entry.estimatedTokens;
      used += entry.estimatedTokens;
    }
    return true;
  };

  for (const layer of LAYERS) {
    const share = Math.floor(profile.budget.maxEstimatedTokens * profile.budget.layerRatios[layer]);
    for (const fragment of sorted.filter((entry) => entry.layer === layer)) {
      if (selected.has(fragment.id)) continue;
      trySelectGroup(fragment, share);
    }
  }

  for (const fragment of sorted) {
    if (selected.has(fragment.id)) continue;
    trySelectGroup(fragment);
  }

  return {
    fragments: fragments.filter((entry) => selected.has(entry.id)),
    droppedFragmentIds: fragments.filter((entry) => !selected.has(entry.id)).map((entry) => entry.id)
  };
}
