import type { NarrativeActHandoff, NarrativeActCanon, NarrativeEpisodeRecord } from "@reroll/shared";
import type { InternalRunState } from "../engine.js";

export interface NarrativeCommitDraft {
  callId: string;
  sourceEventId: string;
  turnKind: NarrativeEpisodeRecord["turnKind"];
  ageFrom?: number;
  age: number;
  actId?: string;
  beat?: NarrativeEpisodeRecord["beat"];
  routeId?: string;
  factionId?: string;
  factIds?: string[];
  characterIds?: string[];
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

/** Records references only after engine settlement, memory and assets have all succeeded. */
export function commitNarrativeEpisode(run: InternalRunState, draft: NarrativeCommitDraft): NarrativeEpisodeRecord {
  const memoryId = `memory:${draft.sourceEventId}`;
  const memory = run.narrative.memoryEntries.find((entry) => entry.id === memoryId);
  const record: NarrativeEpisodeRecord = {
    id: `episode:${draft.sourceEventId}`,
    callId: draft.callId,
    sourceEventId: draft.sourceEventId,
    turnKind: draft.turnKind,
    ageFrom: draft.ageFrom,
    age: draft.age,
    actId: draft.actId,
    beat: draft.beat,
    routeId: draft.routeId,
    factionId: draft.factionId,
    memoryIds: memory ? [memory.id] : [],
    factIds: unique([...(draft.factIds ?? []), ...(memory?.factIds ?? [])]),
    characterIds: unique([...(draft.characterIds ?? []), ...(memory?.characterIds ?? [])]),
    locationIds: unique(memory?.locationIds ?? []),
    abilityIds: unique(memory?.abilityIds ?? []),
    createdAt: Date.now()
  };
  run.narrative.episodes = [...run.narrative.episodes.filter((entry) => entry.id !== record.id), record].slice(-120);
  return record;
}

export function commitNarrativeActCanon(
  run: InternalRunState,
  input: { actId: string; sourceEventId: string; resolvedAge: number; routeId?: string; handoff: NarrativeActHandoff; factIds?: string[] }
): NarrativeActCanon {
  const canon: NarrativeActCanon = {
    actId: input.actId,
    sourceEventId: input.sourceEventId,
    resolvedAge: input.resolvedAge,
    routeId: input.routeId,
    resolvedTension: input.handoff.resolvedTension,
    lastingConsequence: input.handoff.lastingConsequence,
    continuation: input.handoff.continuation,
    factIds: unique(input.factIds ?? [])
  };
  run.narrative.actCanon = [...run.narrative.actCanon.filter((entry) => entry.actId !== canon.actId), canon].slice(-12);
  return canon;
}

/** Executes one generated turn against a clone and publishes it only on success. */
export async function runNarrativeTurnTransaction<T>(
  run: InternalRunState,
  execute: (working: InternalRunState) => Promise<T>
): Promise<{ result: T; committed: InternalRunState }> {
  const working = structuredClone(run);
  const result = await execute(working);
  Object.assign(run, working);
  return { result, committed: run };
}

