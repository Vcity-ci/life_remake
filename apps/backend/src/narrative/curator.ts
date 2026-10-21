import type {
  NarrativeEpisodeRecord,
  NarrativeMemoryDigest,
  NarrativeMemoryDigestScope
} from "@reroll/shared";
import type { ChatConversationState } from "../conversation.js";
import type { InternalRunState } from "../engine.js";
import { canonicalNarrativeIdentity } from "../narrative-identities.js";
import { narrativeExperienceText } from "../narrative-memory.js";

export interface NarrativeMemoryCurationScope {
  id: string;
  scope: NarrativeMemoryDigestScope;
  scopeId?: string;
  previousSummary: string;
  activeFactIds?: string[];
  historicalFactIds?: string[];
  characterIds?: string[];
  currentState?: string;
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
  narrative: string;
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
  facts: Array<{ id: string; status: string; state: string; actId?: string }>;
  actResults: Array<{ actId: string; result: string; consequence: string; continuation: string }>;
  assets?: Array<{ id: string; name: string }>;
  origin?: { episodeId: string; summary: string };
  organizingContext?: { actId: string; objective?: string; beat: string; beatMeaning?: string; stageGoal?: string };
}

export interface NarrativeMemoryDigestProposal {
  id: string;
  summary?: string;
  activeFactIds?: string[];
  historicalFactIds?: string[];
  characterIds?: string[];
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

function currentScopeState(run: InternalRunState, scope: NarrativeMemoryDigestScope, value?: string): string | undefined {
  if (scope !== "act") return undefined;
  const canon = run.narrative.actCanon.find((entry) => entry.actId === value);
  return canon ? [canon.resolvedTension, canon.lastingConsequence, canon.continuation].join("；") : undefined;
}

function curationScopes(run: InternalRunState, episodes: NarrativeEpisodeRecord[]): NarrativeMemoryCurationScope[] {
  const candidates: Array<{ scope: NarrativeMemoryDigestScope; value?: string }> = [
    { scope: "run" }
  ];
  return candidates.map(({ scope, value }) => {
    const id = scopeId(scope, value);
    const previous = run.narrative.memoryDigests.find((digest) => digest.id === id);
    return {
      id,
      scope,
      scopeId: value,
      previousSummary: previous?.format === "effective_facts" ? previous.summary : "",
      activeFactIds: previous?.activeFactIds ?? [],
      historicalFactIds: previous?.historicalFactIds ?? [],
      characterIds: previous?.characterIds ?? [],
      currentState: currentScopeState(run, scope, value),
      episodeIds: episodesForScope(episodes, scope, value)
        .filter((episode) => !previous?.coveredEpisodeIds.includes(episode.id)).map((episode) => episode.id)
    };
  }).filter((scope) => scope.episodeIds.length > 0);
}

/** Compress completed acts as whole intervals. Current-act prose remains authoritative. */
function compressionWindow(run: InternalRunState, uncovered: NarrativeEpisodeRecord[]): NarrativeEpisodeRecord[] {
  const episodes = run.narrative.episodes;
  if (run.ended) return uncovered;
  const fresh = new Set(uncovered.map((episode) => episode.id));
  const completions = new Set(run.narrative.actCanon.map((canon) => canon.sourceEventId));
  const completedEnd = episodes.reduce((last, episode, index) => fresh.has(episode.id) && completions.has(episode.sourceEventId) ? index : last, -1);
  return completedEnd < 0 ? [] : uncovered.filter((episode) => episodes.indexOf(episode) <= completedEnd);
}

export function prepareNarrativeMemoryCuration(run: InternalRunState, retryEpisodeIds?: string[]): NarrativeMemoryCurationWork | undefined {
  // Do not start a terminal interval before its ending prose is committed.
  // A job already running holds its own work snapshot and is unaffected.
  if (run.story.mainlineCompleted && !run.ended) return undefined;
  const runDigest = run.narrative.memoryDigests.find((digest) => digest.id === "run");
  const covered = new Set(runDigest?.coveredEpisodeIds ?? []);
  const uncovered = run.narrative.episodes.filter((episode) => !covered.has(episode.id));
  const window = retryEpisodeIds ? uncovered.filter((episode) => retryEpisodeIds.includes(episode.id)) : compressionWindow(run, uncovered);
  if (!window.length) return undefined;
  const availableScopes = curationScopes(run, window);
  const requestedEpisodeIds = new Set(availableScopes.flatMap((scope) => scope.episodeIds));
  const selected = window.filter((episode) => requestedEpisodeIds.has(episode.id));
  if (!selected.length) return undefined;
  const selectedIds = new Set(selected.map((episode) => episode.id));
  const scopes = availableScopes.map((scope) => ({ ...scope, episodeIds: scope.episodeIds.filter((id) => selectedIds.has(id)) }))
    .filter((scope) => scope.episodeIds.length > 0);
  const facts = run.story.factLedger?.facts ?? [];
  const factIds = new Set(facts.map((fact) => fact.id));
  const characterIds = new Set(run.narrative.dynamicCharacters.map((character) => character.id));
  const priorDigests = run.narrative.memoryDigests.filter((digest) => scopes.some((scope) => scope.id === digest.id));
  const relevantFactIds = new Set([
    ...selected.flatMap((episode) => episode.factIds),
    ...priorDigests.flatMap((digest) => [...digest.activeFactIds, ...digest.historicalFactIds])
  ]);
  const relevantCharacterIds = new Set([
    ...selected.flatMap((episode) => episode.characterIds),
    ...priorDigests.flatMap((digest) => digest.characterIds)
  ]);
  const runtime = run.narrative.actRuntime;
  const storyAct = run.storyPackSnapshot?.acts.find((act) => act.id === runtime?.actId);
  const premiseArc = run.narrative.sessionPremise?.arcs.find((arc) => arc.actId === runtime?.actId);
  const originEpisode = run.narrative.episodes.find((episode) => episode.turnKind === "origin");
  const originSummary = run.narrative.opening?.profile?.summary?.trim();
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
      narrative: narrativeExperienceText(run.narrative, episode)
    })),
    scopes,
    origin: !runDigest?.originCovered && originEpisode && originSummary && scopes.some((scope) => scope.id === "run")
      ? { episodeId: originEpisode.id, summary: originSummary } : undefined,
    organizingContext: runtime ? {
      actId: runtime.actId,
      objective: storyAct?.objective ?? premiseArc?.dramaticQuestion,
      beat: runtime.beat,
      beatMeaning: storyAct?.beatOutline[runtime.beat],
      stageGoal: runtime.stageTask?.goal
    } : undefined,
    validFactIds: Array.from(factIds).filter((id) => relevantFactIds.has(id)),
    resolvedFactIds: facts.filter((fact) => fact.status === "resolved" && relevantFactIds.has(fact.id)).map((fact) => fact.id),
    validCharacterIds: Array.from(characterIds).filter((id) => relevantCharacterIds.has(id)),
    facts: facts.filter((fact) => relevantFactIds.has(fact.id)).map((fact) => ({ id: fact.id,
      status: fact.status, actId: fact.actId,
      state: fact.status === "resolved" ? fact.resolutionSummary ?? fact.progressSummary ?? fact.label : fact.progressSummary ?? fact.label })),
    actResults: run.narrative.actCanon.filter((canon) => selected.some((episode) => episode.sourceEventId === canon.sourceEventId))
      .map((canon) => ({ actId: canon.actId, result: canon.resolvedTension,
        consequence: canon.lastingConsequence, continuation: canon.continuation })),
    assets: [
      ...run.narrative.dynamicCharacters.filter((entry) => relevantCharacterIds.has(entry.id)),
      ...(run.narrative.assets?.locations ?? []).filter((entry) => selected.some((episode) => episode.locationIds.includes(entry.id))),
      ...(run.narrative.assets?.abilities ?? []).filter((entry) => selected.some((episode) => episode.abilityIds.includes(entry.id)))
    ].map(({ id, name }) => ({ id, name }))
  };
}

function mergeCovered(previous: string[], next: string[]): string[] {
  return Array.from(new Set([...previous, ...next]));
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
    scopeById.has(proposal.id) && (proposal.summary === undefined || proposal.summary.trim().length > 0) &&
    all.findIndex((entry) => entry.id === proposal.id) === index
  );
  const validFacts = new Set((run.story.factLedger?.facts ?? []).map((fact) => fact.id));
  const resolvedFacts = new Set((run.story.factLedger?.facts ?? []).filter((fact) => fact.status === "resolved").map((fact) => fact.id));
  const validCharacters = new Set(run.narrative.dynamicCharacters.map((entry) => entry.id));
  const updated = mergeDigestProposals(run, work, proposals, validFacts, resolvedFacts, validCharacters);
  if (!updated.length) return false;
  run.narrative.memoryRevision += 1;
  if (updated.includes("run")) {
    projectRunDigestToConversations(run, run.narrative.memoryDigests.find((digest) => digest.id === "run"));
  }
  return true;
}

function mergeDigestProposals(
  run: InternalRunState,
  work: NarrativeMemoryCurationWork,
  proposals: NarrativeMemoryDigestProposal[],
  validFacts = new Set(work.validFactIds),
  resolvedFacts = new Set(work.resolvedFactIds),
  validCharacters = new Set(work.validCharacterIds)
): string[] {
  const scopeById = new Map(work.scopes.map((scope) => [scope.id, scope]));
  const now = Date.now();
  const nextDigests = [...run.narrative.memoryDigests];
  const updated: string[] = [];
  for (const proposal of proposals) {
    const scope = scopeById.get(proposal.id)!;
    const canonicalScopeId = scope.scopeId ? canonicalNarrativeIdentity(run.narrative, scope.scopeId) : undefined;
    const digestId = scopeId(scope.scope, canonicalScopeId);
    const previous = nextDigests.find((digest) => digest.id === digestId);
    if (!previous && proposal.summary === undefined) continue;
    const episodeIndex = (id: string) => run.narrative.episodes.findIndex((entry) => entry.id === id);
    if (proposal.summary !== undefined && previous && episodeIndex(previous.throughEpisodeId) > episodeIndex(scope.episodeIds.at(-1)!)) continue;
    const coveredEpisodeIds = mergeCovered(previous?.coveredEpisodeIds ?? [], scope.episodeIds);
    const digest: NarrativeMemoryDigest = {
      id: digestId,
      format: "effective_facts",
      scope: scope.scope,
      scopeId: canonicalScopeId,
      revision: (previous?.revision ?? 0) + 1,
      throughEpisodeId: episodeIndex(previous?.throughEpisodeId ?? "") > episodeIndex(scope.episodeIds.at(-1)!) ? previous!.throughEpisodeId : scope.episodeIds.at(-1)!,
      coveredEpisodeIds,
      originCovered: scope.scope === "run" && (previous?.originCovered || (work.origin && proposal.summary !== undefined)) ? true : undefined,
      summary: proposal.summary?.trim() ?? previous!.summary,
      activeFactIds: unique(proposal.activeFactIds ?? previous?.activeFactIds ?? [])
        .filter((id) => validFacts.has(id) && !resolvedFacts.has(id)),
      historicalFactIds: unique(proposal.historicalFactIds ?? previous?.historicalFactIds ?? []).filter((id) => resolvedFacts.has(id)),
      characterIds: unique(unique(proposal.characterIds ?? previous?.characterIds ?? []).map((id) => canonicalNarrativeIdentity(run.narrative, id)).filter((id) => validCharacters.has(id))),
      updatedAt: now
    };
    if (previous && digest.summary === previous.summary && digest.originCovered === previous.originCovered &&
      JSON.stringify([digest.coveredEpisodeIds, digest.activeFactIds, digest.historicalFactIds, digest.characterIds]) ===
      JSON.stringify([previous.coveredEpisodeIds, previous.activeFactIds, previous.historicalFactIds, previous.characterIds])) continue;
    const index = nextDigests.findIndex((entry) => entry.id === digest.id);
    if (index >= 0) nextDigests[index] = digest;
    else nextDigests.push(digest);
    updated.push(digestId);
  }
  run.narrative.memoryDigests = nextDigests.slice(-64);
  return updated;
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
