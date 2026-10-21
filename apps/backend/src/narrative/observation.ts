import type { NarrativeBeat, NarrativeFactUpdates } from "@reroll/shared";
import type { InternalRunState } from "../engine.js";
import { normalizeNarrativeHandoffFact } from "../narrative-continuity.js";
import { narrativeExperienceText, formatNarrativeExperience } from "../narrative-memory.js";

export interface NarrativeObservationFact {
  id: string;
  label?: string;
  state: string;
  actId?: string;
  kind?: string;
  completionEvidence?: string;
}

export interface NarrativeActProgress {
  summary?: string;
  changes: Array<{ beat: Exclude<NarrativeBeat, "ending">; changes: string[] }>;
}

/** Feedback belongs only to the act and beat that were actually observed. */
export function narrativeStageProgressGap(run: InternalRunState, scope: { actId: string; beat: string }): string | undefined {
  const observation = run.narrative.lastBeatObservation;
  return observation?.decision === "hold" && observation.actId === scope.actId && observation.beat === scope.beat
    ? observation.progressGap?.trim() || undefined
    : undefined;
}

/** Covered history comes from the current act's digest; fresh deltas remain authoritative. */
export function narrativeActProgress(run: InternalRunState, actId: string): NarrativeActProgress {
  const episodes = run.narrative.episodes.filter((episode) => episode.actId === actId);
  const digest = run.narrative.memoryDigests
    .filter((entry) => entry.scope === "act" && entry.scopeId === actId && entry.format === "effective_facts")
    .sort((a, b) => b.revision - a.revision)[0];
  const covered = new Set(digest?.coveredEpisodeIds ?? []);
  const beats = ["setup", "escalation", "pressure", "climax", "payoff"] as const;
  return {
    summary: digest?.summary,
    changes: beats.map((beat) => ({
      beat,
      changes: Array.from(new Set(episodes
        .filter((episode) => episode.beat === beat && !covered.has(episode.id))
        .flatMap((episode) => {
          const prose = narrativeExperienceText(run.narrative, episode);
          return prose ? [formatNarrativeExperience(episode, prose)] : [];
        })
        .filter((delta): delta is string => Boolean(delta))))
    }))
  };
}

/** The observer receives open matters for this act and the round's completion evidence. */
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
    ...(updates?.resolutions?.map((entry) => entry.factId) ?? []),
    ...(updates?.introduce ?? []).flatMap((entry) => entry.id ? [entry.id] : [])
  ]);
  const facts = (run.story.factLedger?.facts ?? []).map(normalizeNarrativeHandoffFact)
    .filter((fact) => fact.status === "open" && (!fact.actId || fact.actId === actId));
  for (const entry of updates?.introduce ?? []) {
    if (!entry.id || entry.status === "resolved" || facts.some((fact) => fact.id === entry.id)) continue;
    facts.push({ ...entry, id: entry.id, priority: entry.priority ?? 2, status: "open", actId,
      introducedAge: run.age, lastTouchedAge: run.age, sourceEventId: "" });
  }
  const mandatory = facts.filter((fact) => involved.has(fact.id));
  const supplementary = facts.filter((fact) => !involved.has(fact.id));
  return [...mandatory, ...supplementary].map((fact) => {
    const completion = updates?.resolutions?.find((entry) => entry.factId === fact.id)?.summary;
    const progress = updates?.progress?.find((entry) => entry.factId === fact.id)?.summary;
    return {
      id: fact.id, label: fact.label, actId: fact.actId, kind: fact.kind,
      state: progress ?? fact.progressSummary ?? fact.label,
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
