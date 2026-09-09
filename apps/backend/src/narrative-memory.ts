import type { NarrativeMemoryEntry, NarrativeRunState } from "@reroll/shared";

export function narrativeTextOverlap(left: string, right: string): number {
  const tokens = (value: string) => {
    const normalized = value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, " ");
    const terms: string[] = normalized.match(/[a-z0-9]{2,}/g) ?? [];
    for (const part of normalized.match(/[\p{Script=Han}]+/gu) ?? []) {
      for (let i = 0; i < part.length - 1; i += 1) terms.push(part.slice(i, i + 2));
    }
    return new Set(terms);
  };
  const a = tokens(left), b = tokens(right);
  if (!a.size || !b.size) return 0;
  return [...a].filter((term) => b.has(term)).length / Math.sqrt(a.size * b.size);
}

/** One recall entry per committed narrative, shared by all state writers. */
export function commitNarrativeMemory(state: NarrativeRunState, entry: NarrativeMemoryEntry): void {
  const previous = state.memoryEntries.find((item) => item.id === entry.id);
  const merged = { ...previous, ...entry };
  for (const key of ["characterIds", "factionIds", "factIds", "locationIds", "abilityIds"] as const) {
    merged[key] = Array.from(new Set([...(previous?.[key] ?? []), ...(entry[key] ?? [])]));
  }
  state.memoryEntries = [...state.memoryEntries.filter((item) => item.id !== entry.id), merged].slice(-80);
}
