import type { NarrativeRunState } from "@reroll/shared";

export const NARRATIVE_HISTORY_LIMIT = 240;

/** Retention is a window; committed progress must keep advancing beyond it. */
export function committedNarrativeSequence(state: NarrativeRunState): number {
  return Math.max(state.episodes.length, Math.trunc(state.committedEpisodeSequence ?? 0));
}
