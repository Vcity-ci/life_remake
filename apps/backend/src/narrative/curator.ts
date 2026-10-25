import type { NarrativeEpisodeRecord, NarrativeMemoryDigest } from "@reroll/shared";
import type { ChatConversationState } from "../conversation.js";
import type { InternalRunState } from "../engine.js";
import { formatNarrativeDialogue, narrativeExperienceContent } from "../narrative-memory.js";

export interface NarrativeMemoryCurationWork {
  revision: number;
  throughEpisodeId: string;
  throughAge: number;
  episodeIds: string[];
  previousSummary: string;
  episodes: Array<{ ageFrom?: number; age: number; narrative: string }>;
  origin?: { episodeId: string; summary: string };
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
  const previous = run.narrative.memoryDigests.find((digest) => digest.id === "run" && digest.format === "effective_facts");
  const covered = new Set(previous?.coveredEpisodeIds ?? []);
  const uncovered = run.narrative.episodes.filter((episode) => !covered.has(episode.id));
  const window = retryEpisodeIds ? uncovered.filter((episode) => retryEpisodeIds.includes(episode.id)) : compressionWindow(run, uncovered, previous);
  const originEpisode = run.narrative.episodes.find((episode) => episode.turnKind === "origin");
  const originSummary = run.narrative.opening?.profile?.summary?.trim();
  const origin = !previous?.originCovered && originEpisode && originSummary
    ? { episodeId: originEpisode.id, summary: originSummary } : undefined;
  const selected = window.map((episode) => ({ episode,
    narrative: formatNarrativeDialogue(narrativeExperienceContent(run.narrative, episode, run.turnRecords))
  }))
    .filter(({ episode, narrative }) => narrative.trim() || episode.id === origin?.episodeId);
  if (!selected.length) return undefined;
  return {
    revision: run.narrative.memoryRevision,
    throughEpisodeId: selected.at(-1)!.episode.id,
    throughAge: selected.at(-1)!.episode.age,
    episodeIds: selected.map(({ episode }) => episode.id),
    previousSummary: previous?.summary ?? "",
    episodes: selected.filter(({ episode }) => episode.id !== origin?.episodeId)
      .map(({ episode, narrative }) => ({ ageFrom: episode.ageFrom, age: episode.age, narrative })),
    origin
  };
}

export function applyNarrativeMemoryCuration(run: InternalRunState, work: NarrativeMemoryCurationWork, result: NarrativeMemoryCurationResult): boolean {
  if (run.narrative.memoryRevision !== work.revision || !result.summary.trim()) return false;
  if (work.episodeIds.some((id) => !run.narrative.episodes.some((episode) => episode.id === id))) return false;
  const previous = run.narrative.memoryDigests.find((digest) => digest.id === "run");
  const coveredEpisodeIds = Array.from(new Set([...(previous?.format === "effective_facts" ? previous.coveredEpisodeIds : []), ...work.episodeIds]));
  const digest: NarrativeMemoryDigest = {
    id: "run", scope: "run", format: "effective_facts", revision: (previous?.revision ?? 0) + 1,
    throughEpisodeId: work.throughEpisodeId, throughAge: work.throughAge, coveredEpisodeIds,
    originCovered: previous?.originCovered || Boolean(work.origin) || undefined,
    summary: result.summary.trim(), activeFactIds: [], historicalFactIds: [], characterIds: [], updatedAt: Date.now()
  };
  run.narrative.memoryDigests = [...run.narrative.memoryDigests.filter((entry) => entry.id !== "run"), digest];
  run.narrative.memoryRevision += 1;
  projectRunDigestToConversations(run, digest);
  return true;
}

function projectConversationDigest(
  conversation: ChatConversationState | undefined,
  digest: NarrativeMemoryDigest,
  coveredMemoryIds: Set<string>
): void {
  if (!conversation) return;
  conversation.headMemory = digest.summary;
  conversation.archive = conversation.archive.filter((round) => !round.id || !coveredMemoryIds.has(round.id));
  conversation.summaryRevision = (conversation.summaryRevision ?? 0) + 1;
  conversation.summaryThroughMemoryId = Array.from(coveredMemoryIds).at(-1) ?? conversation.summaryThroughMemoryId;
  conversation.summarizedMemoryIds = Array.from(new Set([
    ...(conversation.summarizedMemoryIds ?? []),
    ...coveredMemoryIds
  ]));
}

function projectRunDigestToConversations(run: InternalRunState, digest: NarrativeMemoryDigest | undefined): void {
  if (!digest) return;
  const coveredEpisodeIds = new Set(digest.coveredEpisodeIds);
  const coveredMemoryIds = new Set(run.narrative.episodes
    .filter((episode) => coveredEpisodeIds.has(episode.id))
    .flatMap((episode) => episode.memoryIds));
  projectConversationDigest(run.aiConversation?.year, digest, coveredMemoryIds);
  projectConversationDigest(run.aiConversation?.milestone, digest, coveredMemoryIds);
  projectConversationDigest(run.aiConversation?.ending, digest, coveredMemoryIds);
}
