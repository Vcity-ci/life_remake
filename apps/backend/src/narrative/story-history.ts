import type { NarrativeEpisodeRecord, NarrativeMemoryDigest, NarrativeRunState } from "@reroll/shared";
import type { ConversationPromptMessage } from "../conversation.js";

export interface NarrativeStoryHistory {
  summary?: { id: string; text: string; coveredEpisodeIds: string[] };
  episodes: Array<Pick<NarrativeEpisodeRecord, "id" | "sourceEventId" | "turnId" | "memoryIds" | "ageFrom" | "age" | "storyDelta">>;
}

export interface NarrativeStoryHistoryProjection {
  summary?: NarrativeStoryHistory["summary"];
  changes: NarrativeStoryHistory["episodes"];
}

/** The run digest is the sole coverage authority for the shared story background. */
export function buildNarrativeStoryHistory(
  state: Pick<NarrativeRunState, "episodes" | "memoryDigests">
): NarrativeStoryHistory {
  const digest: NarrativeMemoryDigest | undefined = state.memoryDigests.find((entry) =>
    entry.id === "run" && entry.format === "effective_facts" && entry.summary.trim().length > 0);
  const covered = new Set(digest?.coveredEpisodeIds ?? []);
  return {
    summary: digest ? { id: digest.id, text: digest.summary, coveredEpisodeIds: [...digest.coveredEpisodeIds] } : undefined,
    episodes: state.episodes.filter((episode) => !covered.has(episode.id) && episode.storyDelta?.trim()).map((episode) => ({
      id: episode.id,
      sourceEventId: episode.sourceEventId,
      turnId: episode.turnId,
      memoryIds: [...episode.memoryIds],
      ageFrom: episode.ageFrom,
      age: episode.age,
      storyDelta: episode.storyDelta
    }))
  };
}

/** Exclude only episodes whose committed prose is actually present in this request. */
export function projectNarrativeStoryHistory(
  history: NarrativeStoryHistory,
  recentMessages: ConversationPromptMessage[]
): NarrativeStoryHistoryProjection {
  const proseSourceIds = new Set(recentMessages.filter((message) => message.role === "assistant" && message.sourceId)
    .map((message) => message.sourceId!));
  const covered = new Set(history.summary?.coveredEpisodeIds ?? []);
  return {
    summary: history.summary,
    changes: history.episodes.filter((episode) => {
      if (covered.has(episode.id)) return false;
      // commitNarrativeEpisode and pushHistory both derive memory:<sourceEventId>.
      const identities = [episode.id, episode.sourceEventId, episode.turnId, `memory:${episode.sourceEventId}`, ...episode.memoryIds];
      return !identities.some((id) => id !== undefined && proseSourceIds.has(id));
    })
  };
}
