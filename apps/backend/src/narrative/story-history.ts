import type { NarrativeEpisodeRecord, NarrativeRunState, TurnRecord } from "@reroll/shared";
import type { ConversationPromptMessage } from "../conversation.js";
import { narrativeExperienceContent, type NarrativeExperienceContent } from "../narrative-memory.js";

export interface NarrativeStoryHistory {
  summary?: { id: string; text: string; coveredEpisodeIds: string[]; originCovered?: boolean };
  latestSituationId?: string;
  episodes: Array<Pick<NarrativeEpisodeRecord, "id" | "sourceEventId" | "turnId" | "memoryIds" | "ageFrom" | "age" | "storyDelta"> & Partial<NarrativeExperienceContent>>;
}

export interface NarrativeStoryHistoryProjection {
  summary?: NarrativeStoryHistory["summary"];
  changes: NarrativeStoryHistory["episodes"];
}

/** Independent period summaries jointly replace exactly their covered dialogue. */
export function buildNarrativeStoryHistory(
  state: Pick<NarrativeRunState, "episodes" | "memoryDigests"> & Partial<Pick<NarrativeRunState, "actRuntime" | "memoryEntries">>,
  turnRecords: readonly TurnRecord[] = []
): NarrativeStoryHistory {
  const digests = state.memoryDigests.filter((entry) =>
    entry.scope === "run" && entry.format === "effective_facts" && entry.summary.trim().length > 0);
  const covered = new Set(digests.flatMap((digest) => digest.coveredEpisodeIds));
  const experiences = state.episodes.map((episode) => ({ episode,
    ...narrativeExperienceContent({ memoryEntries: state.memoryEntries ?? [] }, episode, turnRecords)
  }));
  return {
    summary: digests.length ? { id: "history", text: digests.map((digest) =>
      digest.fromAge === undefined ? digest.summary : `${digest.fromAge}—${digest.throughAge}岁：${digest.summary}`
    ).join("\n\n"), coveredEpisodeIds: [...covered], originCovered: digests.some((digest) => digest.originCovered)
      || state.episodes.some((episode) => episode.turnKind === "origin" && covered.has(episode.id)) } : undefined,
    latestSituationId: experiences.filter((entry) => entry.narrative).at(-1)?.episode.id,
    episodes: experiences.filter(({ episode, narrative }) => !covered.has(episode.id) && narrative).map(({ episode, ...content }) => ({
      id: episode.id,
      sourceEventId: episode.sourceEventId,
      turnId: episode.turnId,
      memoryIds: [...episode.memoryIds],
      ageFrom: episode.ageFrom,
      age: episode.age,
      ...content
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
