import type { NarrativeEpisodeRecord, NarrativeMemoryDigest } from "@reroll/shared";
import type { ChatConversationState } from "../conversation.js";
import type { InternalRunState } from "../engine.js";
import { formatNarrativeDialogue, narrativeExperienceContent } from "../narrative-memory.js";
import { buildNarrativeStoryHistory } from "./story-history.js";

export interface NarrativeMemoryCurationWork {
  revision: number;
  throughEpisodeId: string;
  throughAge: number;
  episodeIds: string[];
  fromAge: number;
  episodes: Array<{ ageFrom?: number; age: number; narrative: string }>;
}

export interface NarrativeMemoryCurationResult { summary: string }

/** Compress complete committed experiences at act endings, or after ten story years. */
function compressionWindow(run: InternalRunState, uncovered: NarrativeEpisodeRecord[], previous?: NarrativeMemoryDigest): NarrativeEpisodeRecord[] {
  const episodes = run.narrative.episodes;
  if (run.ended) return uncovered;
  const coveredAge = previous?.throughAge
    ?? episodes.find((episode) => episode.id === previous?.throughEpisodeId)?.age
    ?? 0;
  if (uncovered.length && uncovered.at(-1)!.age - coveredAge >= 10) return uncovered;
  const fresh = new Set(uncovered.map((episode) => episode.id));
  const completions = new Set(run.narrative.actCanon.map((canon) => canon.sourceEventId));
  const completedEnd = episodes.reduce((last, episode, index) => fresh.has(episode.id) && completions.has(episode.sourceEventId) ? index : last, -1);
  return completedEnd < 0 ? [] : uncovered.filter((episode) => episodes.indexOf(episode) <= completedEnd);
}

export function prepareNarrativeMemoryCuration(run: InternalRunState, retryEpisodeIds?: string[]): NarrativeMemoryCurationWork | undefined {
  if (run.story.mainlineCompleted && !run.ended) return undefined;
  const digests = run.narrative.memoryDigests.filter((digest) => digest.scope === "run" && digest.format === "effective_facts");
  const previous = digests.at(-1);
  const covered = new Set(digests.flatMap((digest) => digest.coveredEpisodeIds));
  const uncovered = run.narrative.episodes.filter((episode) => !covered.has(episode.id));
  const window = retryEpisodeIds ? uncovered.filter((episode) => retryEpisodeIds.includes(episode.id)) : compressionWindow(run, uncovered, previous);
  const selected = window.map((episode) => ({ episode,
    narrative: formatNarrativeDialogue(narrativeExperienceContent(run.narrative, episode, run.turnRecords))
  }))
    .filter(({ narrative }) => narrative.trim());
  if (!selected.length) return undefined;
  return {
    revision: run.narrative.memoryRevision,
    throughEpisodeId: selected.at(-1)!.episode.id,
    throughAge: selected.at(-1)!.episode.age,
    episodeIds: selected.map(({ episode }) => episode.id),
    fromAge: selected[0].episode.ageFrom ?? selected[0].episode.age,
    episodes: selected.map(({ episode, narrative }) => ({ ageFrom: episode.ageFrom, age: episode.age, narrative }))
  };
}

export function applyNarrativeMemoryCuration(run: InternalRunState, work: NarrativeMemoryCurationWork, result: NarrativeMemoryCurationResult): boolean {
  if (run.narrative.memoryRevision !== work.revision || !result.summary.trim()) return false;
  if (work.episodeIds.some((id) => !run.narrative.episodes.some((episode) => episode.id === id))) return false;
  const coveredEpisodeIds = [...work.episodeIds];
  const digest: NarrativeMemoryDigest = {
    id: "period:" + work.throughEpisodeId, scope: "run", format: "effective_facts", revision: work.revision + 1,
    throughEpisodeId: work.throughEpisodeId, fromAge: work.fromAge, throughAge: work.throughAge, coveredEpisodeIds,
    originCovered: coveredEpisodeIds.some((id) => run.narrative.episodes.some((entry) => entry.id === id && entry.turnKind === "origin")) || undefined,
    summary: result.summary.trim(), activeFactIds: [], historicalFactIds: [], characterIds: [], updatedAt: Date.now()
  };
  run.narrative.memoryDigests.push(digest);
  run.narrative.memoryRevision += 1;
  projectRunDigestToConversations(run);
  return true;
}

function projectConversationDigest(
  conversation: ChatConversationState | undefined,
  summary: string,
  coveredMemoryIds: Set<string>
): void {
  if (!conversation) return;
  conversation.headMemory = summary;
  conversation.archive = conversation.archive.filter((round) => !round.id || !coveredMemoryIds.has(round.id));
  conversation.summaryRevision = (conversation.summaryRevision ?? 0) + 1;
  conversation.summaryThroughMemoryId = Array.from(coveredMemoryIds).at(-1) ?? conversation.summaryThroughMemoryId;
  conversation.summarizedMemoryIds = Array.from(new Set([
    ...(conversation.summarizedMemoryIds ?? []),
    ...coveredMemoryIds
  ]));
}

function projectRunDigestToConversations(run: InternalRunState): void {
  const summary = buildNarrativeStoryHistory(run.narrative, run.turnRecords).summary;
  if (!summary) return;
  const coveredEpisodeIds = new Set(summary.coveredEpisodeIds);
  const coveredMemoryIds = new Set(run.narrative.episodes
    .filter((episode) => coveredEpisodeIds.has(episode.id))
    .flatMap((episode) => episode.memoryIds));
  projectConversationDigest(run.aiConversation?.year, summary.text, coveredMemoryIds);
  projectConversationDigest(run.aiConversation?.milestone, summary.text, coveredMemoryIds);
  projectConversationDigest(run.aiConversation?.ending, summary.text, coveredMemoryIds);
}
