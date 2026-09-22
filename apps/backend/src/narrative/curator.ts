import type {
  NarrativeEpisodeRecord,
  NarrativeMemoryDigest,
  NarrativeMemoryDigestScope
} from "@reroll/shared";
import type { ChatConversationState } from "../conversation.js";
import type { InternalRunState } from "../engine.js";

const CURATION_BATCH_SIZE = 6;
const CURATION_MIN_EPISODES = 4;

export interface NarrativeMemoryCurationScope {
  id: string;
  scope: NarrativeMemoryDigestScope;
  scopeId?: string;
  previousSummary: string;
  episodeIds: string[];
}

export interface NarrativeMemoryCurationEpisode {
  id: string;
  turnKind: NarrativeEpisodeRecord["turnKind"];
  ageFrom?: number;
  age: number;
  actId?: string;
  beat?: NarrativeEpisodeRecord["beat"];
  routeId?: string;
  factionId?: string;
  factIds: string[];
  characterIds: string[];
  locationIds: string[];
  abilityIds: string[];
  text: string;
}

export interface NarrativeMemoryCurationWork {
  revision: number;
  throughEpisodeId: string;
  episodeIds: string[];
  episodes: NarrativeMemoryCurationEpisode[];
  scopes: NarrativeMemoryCurationScope[];
  validFactIds: string[];
  resolvedFactIds: string[];
  validCharacterIds: string[];
}

export interface NarrativeMemoryDigestProposal {
  id: string;
  summary: string;
  activeFactIds: string[];
  historicalFactIds: string[];
  characterIds: string[];
}

export interface NarrativeMemoryCurationResult {
  digests: NarrativeMemoryDigestProposal[];
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function scopeId(scope: NarrativeMemoryDigestScope, value?: string): string {
  return scope === "run" ? "run" : `${scope}:${value}`;
}

function episodesForScope(episodes: NarrativeEpisodeRecord[], scope: NarrativeMemoryDigestScope, value?: string): NarrativeEpisodeRecord[] {
  if (scope === "run") return episodes;
  if (scope === "act") return episodes.filter((episode) => episode.actId === value);
  if (scope === "route") return episodes.filter((episode) => episode.routeId === value);
  if (scope === "faction") return episodes.filter((episode) => episode.factionId === value);
  if (scope === "character") return episodes.filter((episode) => episode.characterIds.includes(value ?? ""));
  if (scope === "location") return episodes.filter((episode) => episode.locationIds.includes(value ?? ""));
  return episodes.filter((episode) => episode.abilityIds.includes(value ?? ""));
}

function curationScopes(run: InternalRunState, episodes: NarrativeEpisodeRecord[]): NarrativeMemoryCurationScope[] {
  const candidates: Array<{ scope: NarrativeMemoryDigestScope; value?: string }> = [
    { scope: "run" },
    ...unique(episodes.map((episode) => episode.actId)).map((value) => ({ scope: "act" as const, value })),
    ...unique(episodes.map((episode) => episode.routeId)).map((value) => ({ scope: "route" as const, value })),
    ...unique(episodes.map((episode) => episode.factionId)).map((value) => ({ scope: "faction" as const, value })),
    ...unique(episodes.flatMap((episode) => episode.characterIds)).map((value) => ({ scope: "character" as const, value })),
    ...unique(episodes.flatMap((episode) => episode.locationIds)).map((value) => ({ scope: "location" as const, value })),
    ...unique(episodes.flatMap((episode) => episode.abilityIds)).map((value) => ({ scope: "ability" as const, value }))
  ];
  return candidates.map(({ scope, value }) => {
    const id = scopeId(scope, value);
    const previous = run.narrative.memoryDigests.find((digest) => digest.id === id);
    return {
      id,
      scope,
      scopeId: value,
      previousSummary: previous?.summary ?? "",
      episodeIds: episodesForScope(episodes, scope, value).map((episode) => episode.id)
    };
  }).filter((scope) => scope.episodeIds.length > 0);
}

export function prepareNarrativeMemoryCuration(run: InternalRunState): NarrativeMemoryCurationWork | undefined {
  const covered = new Set(run.narrative.memoryDigests.find((digest) => digest.id === "run")?.coveredEpisodeIds ?? []);
  const uncovered = run.narrative.episodes.filter((episode) => !covered.has(episode.id));
  const payoffPending = uncovered.some((episode) => episode.beat === "payoff" || episode.turnKind === "ending");
  if (uncovered.length < CURATION_MIN_EPISODES && !payoffPending) return undefined;
  const selected = uncovered.slice(0, CURATION_BATCH_SIZE);
  const memoryById = new Map(run.narrative.memoryEntries.map((memory) => [memory.id, memory]));
  const facts = run.story.factLedger?.facts ?? [];
  const factIds = new Set(facts.map((fact) => fact.id));
  const resolvedFactIds = facts.filter((fact) => fact.status === "resolved").map((fact) => fact.id);
  const characterIds = new Set(run.narrative.dynamicCharacters.map((character) => character.id));
  return {
    revision: run.narrative.memoryRevision,
    throughEpisodeId: selected.at(-1)!.id,
    episodeIds: selected.map((episode) => episode.id),
    episodes: selected.map((episode) => ({
      id: episode.id,
      turnKind: episode.turnKind,
      ageFrom: episode.ageFrom,
      age: episode.age,
      actId: episode.actId,
      beat: episode.beat,
      routeId: episode.routeId,
      factionId: episode.factionId,
      factIds: episode.factIds.filter((id) => factIds.has(id)),
      characterIds: episode.characterIds.filter((id) => characterIds.has(id)),
      locationIds: episode.locationIds,
      abilityIds: episode.abilityIds,
      text: episode.memoryIds.map((id) => memoryById.get(id)?.text ?? "").filter(Boolean).join("\n")
    })),
    scopes: curationScopes(run, selected),
    validFactIds: Array.from(factIds),
    resolvedFactIds,
    validCharacterIds: Array.from(characterIds)
  };
}

function mergeCovered(previous: string[], next: string[]): string[] {
  return Array.from(new Set([...previous, ...next])).slice(-120);
}

export function applyNarrativeMemoryCuration(
  run: InternalRunState,
  work: NarrativeMemoryCurationWork,
  result: NarrativeMemoryCurationResult
): boolean {
  if (run.narrative.memoryRevision !== work.revision) return false;
  if (work.episodeIds.some((id) => !run.narrative.episodes.some((episode) => episode.id === id))) return false;
  const scopeById = new Map(work.scopes.map((scope) => [scope.id, scope]));
  const proposals = result.digests.filter((proposal, index, all) =>
    scopeById.has(proposal.id) && proposal.summary.trim().length > 0 && proposal.summary.trim().length <= 600 &&
    all.findIndex((entry) => entry.id === proposal.id) === index
  );
  if (!proposals.some((proposal) => proposal.id === "run")) return false;
  const validFacts = new Set(work.validFactIds);
  const resolvedFacts = new Set(work.resolvedFactIds);
  const validCharacters = new Set(work.validCharacterIds);
  mergeDigestProposals(run, work, proposals, validFacts, resolvedFacts, validCharacters);
  run.narrative.memoryRevision += 1;
  projectRunDigestToConversations(run, run.narrative.memoryDigests.find((digest) => digest.id === "run"));
  return true;
}

function mergeDigestProposals(
  run: InternalRunState,
  work: NarrativeMemoryCurationWork,
  proposals: NarrativeMemoryDigestProposal[],
  validFacts = new Set(work.validFactIds),
  resolvedFacts = new Set(work.resolvedFactIds),
  validCharacters = new Set(work.validCharacterIds)
): void {
  const scopeById = new Map(work.scopes.map((scope) => [scope.id, scope]));
  const now = Date.now();
  const nextDigests = [...run.narrative.memoryDigests];
  for (const proposal of proposals) {
    const scope = scopeById.get(proposal.id)!;
    const previous = nextDigests.find((digest) => digest.id === proposal.id);
    const coveredEpisodeIds = mergeCovered(previous?.coveredEpisodeIds ?? [], scope.episodeIds);
    const digest: NarrativeMemoryDigest = {
      id: proposal.id,
      scope: scope.scope,
      scopeId: scope.scopeId,
      revision: (previous?.revision ?? 0) + 1,
      throughEpisodeId: scope.episodeIds.at(-1)!,
      coveredEpisodeIds,
      summary: proposal.summary.trim(),
      activeFactIds: unique(proposal.activeFactIds).filter((id) => validFacts.has(id) && !resolvedFacts.has(id)),
      historicalFactIds: unique(proposal.historicalFactIds).filter((id) => resolvedFacts.has(id)),
      characterIds: unique(proposal.characterIds).filter((id) => validCharacters.has(id)),
      updatedAt: now
    };
    const index = nextDigests.findIndex((entry) => entry.id === digest.id);
    if (index >= 0) nextDigests[index] = digest;
    else nextDigests.push(digest);
  }
  run.narrative.memoryDigests = nextDigests.slice(-64);
}

/** Commits optional object views after the run digest has already secured coverage. */
export function applyNarrativeScopedMemoryCuration(
  run: InternalRunState,
  work: NarrativeMemoryCurationWork,
  result: NarrativeMemoryCurationResult
): boolean {
  const runDigest = run.narrative.memoryDigests.find((digest) => digest.id === "run");
  if (!runDigest || work.episodeIds.some((id) => !runDigest.coveredEpisodeIds.includes(id))) return false;
  const allowed = new Set(work.scopes.filter((scope) => scope.id !== "run").map((scope) => scope.id));
  const proposals = result.digests.filter((proposal, index, all) =>
    allowed.has(proposal.id) && proposal.summary.trim().length > 0 && proposal.summary.trim().length <= 600 &&
    all.findIndex((entry) => entry.id === proposal.id) === index
  );
  if (!proposals.length) return false;
  mergeDigestProposals(run, work, proposals);
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
  ])).slice(-240);
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
