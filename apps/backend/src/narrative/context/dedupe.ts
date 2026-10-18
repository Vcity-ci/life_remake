import type { NarrativeContextFragment } from "./types.js";

export interface NarrativeContextDedupeResult {
  fragments: NarrativeContextFragment[];
  droppedFragmentIds: string[];
  duplicateSourceIds: string[];
}

export function dedupeNarrativeContextFragments(fragments: NarrativeContextFragment[]): NarrativeContextDedupeResult {
  const kept: NarrativeContextFragment[] = [];
  const contents = new Set<string>();
  const sourceIds = new Set<string>();
  const droppedFragmentIds: string[] = [];
  const duplicateSourceIds = new Set<string>();
  for (const fragment of [...fragments].sort((a, b) => a.order - b.order)) {
    const contentKey = JSON.stringify([fragment.layer, fragment.section, fragment.content]);
    const history = fragment.placement === "message_history";
    const repeatedSources = history ? [] : fragment.sourceIds.filter((id) => sourceIds.has(id));
    repeatedSources.forEach((id) => duplicateSourceIds.add(id));
    if (!history && contents.has(contentKey)) {
      droppedFragmentIds.push(fragment.id);
      continue;
    }
    kept.push(fragment);
    contents.add(contentKey);
    fragment.sourceIds.forEach((id) => sourceIds.add(id));
  }
  return { fragments: kept, droppedFragmentIds, duplicateSourceIds: Array.from(duplicateSourceIds).sort() };
}
