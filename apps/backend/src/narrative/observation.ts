import type { NarrativeBeat, NarrativeFactUpdates } from "@reroll/shared";
import type { InternalRunState } from "../engine.js";
import { normalizeNarrativeHandoffFact } from "../narrative-continuity.js";

export interface NarrativeObservationFact {
  id: string;
  label?: string;
  state: string;
  actId?: string;
  completionEvidence?: string;
}

export interface NarrativeActProgress {
  summary?: string;
  changes: Array<{ beat: Exclude<NarrativeBeat, "ending">; changes: string[] }>;
}

/** Covered history comes from the current act's digest; fresh deltas remain authoritative. */
export function narrativeActProgress(run: InternalRunState, actId: string): NarrativeActProgress {
  const episodes = run.narrative.episodes.filter((episode) => episode.actId === actId);
  const digest = run.narrative.memoryDigests
    .filter((entry) => entry.scope === "act" && entry.scopeId === actId)
    .sort((a, b) => b.revision - a.revision)[0];
  const covered = new Set(digest?.coveredEpisodeIds ?? []);
  const beats = ["setup", "escalation", "pressure", "climax", "payoff"] as const;
  return {
    summary: digest?.summary,
    changes: beats.map((beat) => ({
      beat,
      changes: Array.from(new Set(episodes
        .filter((episode) => episode.beat === beat && !covered.has(episode.id))
        .map((episode) => episode.storyDelta?.trim())
        .filter((delta): delta is string => Boolean(delta))))
    }))
  };
}

/** Actual round references are mandatory; the detail allowance applies only to extra facts. */
export function narrativeObservationFacts(
  run: InternalRunState,
  actId: string,
  updates?: NarrativeFactUpdates,
  involvedFactIds: string[] = []
): NarrativeObservationFact[] {
  const involved = new Set([
    ...involvedFactIds,
    ...(updates?.touchFactIds ?? []),
    ...(updates?.progress?.map((entry) => entry.factId) ?? []),
    ...(updates?.resolveFactIds ?? []),
    ...(updates?.resolutions?.map((entry) => entry.factId) ?? [])
  ]);
  const facts = (run.story.factLedger?.facts ?? []).map(normalizeNarrativeHandoffFact)
    .filter((fact) => fact.status === "open" && (!fact.actId || fact.actId === actId));
  const mandatory = facts.filter((fact) => involved.has(fact.id));
  const supplementary = facts.filter((fact) => !involved.has(fact.id))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || b.lastTouchedAge - a.lastTouchedAge)
    .slice(0, Math.max(0, 12 - mandatory.length));
  return [...mandatory, ...supplementary].map((fact) => {
    const completion = updates?.resolutions?.find((entry) => entry.factId === fact.id)?.summary;
    const progress = updates?.progress?.find((entry) => entry.factId === fact.id)?.summary;
    return {
      id: fact.id, label: fact.label, actId: fact.actId,
      state: completion ?? progress ?? fact.progressSummary ?? fact.label,
      completionEvidence: completion
    };
  });
}

export function hasNarrativeFactCompletion(updates?: NarrativeFactUpdates): boolean {
  return Boolean(updates?.resolveFactIds.length || updates?.resolutions?.length);
}

/** Existing fact closure belongs to the observer; preserve the proposed result as progress. */
export function narrativeFactProgressForCommit(updates?: NarrativeFactUpdates): NarrativeFactUpdates | undefined {
  if (!updates) return undefined;
  const progress = new Map((updates.progress ?? []).map((entry) => [entry.factId, entry.summary]));
  for (const entry of updates.resolutions ?? []) progress.set(entry.factId, entry.summary);
  return {
    ...updates,
    touchFactIds: Array.from(new Set([...updates.touchFactIds, ...updates.resolveFactIds, ...progress.keys()])),
    progress: Array.from(progress, ([factId, summary]) => ({ factId, summary })),
    resolveFactIds: [],
    resolutions: []
  };
}
