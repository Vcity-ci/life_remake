import type { NarrativeContextFragment } from "./types.js";

export interface NarrativeContextDedupeResult {
  fragments: NarrativeContextFragment[];
  droppedFragmentIds: string[];
  duplicateSourceIds: string[];
}

export function dedupeNarrativeContextFragments(fragments: NarrativeContextFragment[]): NarrativeContextDedupeResult {
  const kept: NarrativeContextFragment[] = [];
  const ids = new Set<string>();
  const contents = new Set<string>();
  const sourceIds = new Set<string>();
  const droppedFragmentIds: string[] = [];
  const duplicateSourceIds = new Set<string>();
  for (const fragment of [...fragments].sort((a, b) => a.order - b.order)) {
    const contentKey = fragment.content.replace(/\s+/g, " ").trim();
    const history = fragment.placement === "message_history";
    const repeatedSources = history ? [] : fragment.sourceIds.filter((id) => sourceIds.has(id));
    if (ids.has(fragment.id) || (!history && contents.has(contentKey)) || repeatedSources.length > 0) {
      droppedFragmentIds.push(fragment.id);
      repeatedSources.forEach((id) => duplicateSourceIds.add(id));
      continue;
    }
    kept.push(fragment);
    ids.add(fragment.id);
    contents.add(contentKey);
    fragment.sourceIds.forEach((id) => sourceIds.add(id));
  }
  return { fragments: kept, droppedFragmentIds, duplicateSourceIds: Array.from(duplicateSourceIds).sort() };
}
