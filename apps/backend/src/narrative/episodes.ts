import type { NarrativeRunState } from "@reroll/shared";

export interface NarrativeEpisodeRecall {
  memoryIds: string[];
  canon: Array<{ actId: string; sourceEventId: string; text: string; factIds: string[] }>;
  digests: Array<{ id: string; text: string; sourceIds: string[] }>;
}

function overlaps(values: string[], focusIds: Set<string>): boolean {
  return values.some((value) => focusIds.has(value));
}

/** Deterministic ordering: active scene, explicit focus, current act, prior act canon, then route history. */
export function selectNarrativeEpisodeRecall(
  state: NarrativeRunState,
  input: { actId?: string; routeId?: string; focusIds?: string[] },
  limit = 5
): NarrativeEpisodeRecall {
  const focusIds = new Set(input.focusIds ?? []);
  const activeSourceId = state.activeScene ? state.scene.lastEventId : undefined;
  const relevantDigests = state.memoryDigests.filter((digest) =>
    digest.scope === "run" ||
    (digest.scope === "act" && digest.scopeId === input.actId) ||
    (digest.scope === "route" && digest.scopeId === input.routeId) ||
    (digest.scope === "character" && digest.scopeId && focusIds.has(digest.scopeId)) ||
    (digest.scope === "faction" && digest.scopeId && focusIds.has(digest.scopeId))
  ).sort((a, b) => {
    const scopePriority = (scope: typeof a.scope) => scope === "act" ? 4 : scope === "route" ? 3 : scope === "character" || scope === "faction" ? 2 : 1;
    return scopePriority(b.scope) - scopePriority(a.scope) || b.updatedAt - a.updatedAt;
  }).slice(0, 4);
  const coveredEpisodeIds = new Set(state.memoryDigests.find((digest) => digest.id === "run")?.coveredEpisodeIds ?? []);
  const canon = state.actCanon
    .filter((entry) => entry.actId !== input.actId)
    .slice(-2)
    .map((entry) => ({
      actId: entry.actId,
      sourceEventId: entry.sourceEventId,
      factIds: entry.factIds,
      text: `${entry.resolvedTension}；${entry.lastingConsequence}；${entry.continuation}`
    }));
  const canonSourceIds = new Set(canon.map((entry) => entry.sourceEventId));
  const ranked = state.episodes.filter((episode) => !canonSourceIds.has(episode.sourceEventId)).map((episode, index) => {
    let score = index / Math.max(1, state.episodes.length);
    const isActive = Boolean(activeSourceId && episode.sourceEventId === activeSourceId);
    const isFocused = overlaps([
      ...episode.factIds,
      ...episode.characterIds,
      ...episode.locationIds,
      ...episode.abilityIds
    ], focusIds);
    if (coveredEpisodeIds.has(episode.id) && !isActive && !isFocused) return { episode, score: -1 };
    if (isActive) score += 100;
    if (isFocused) score += 80;
    if (input.actId && episode.actId === input.actId) score += 40;
    if (input.routeId && episode.routeId === input.routeId) score += 20;
    return { episode, score };
  }).filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.episode.age - a.episode.age)
    .slice(0, limit);
  const memoryIds = Array.from(new Set(ranked.flatMap(({ episode }) => episode.memoryIds)));
  return {
    memoryIds,
    canon,
    digests: relevantDigests.map((digest) => ({
      id: digest.id,
      text: digest.summary,
      sourceIds: [digest.id, ...digest.coveredEpisodeIds]
    }))
  };
}
