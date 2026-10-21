import type { NarrativeAssetMoment, NarrativeAssetUpdates, NarrativeRunState } from "@reroll/shared";
import type { InternalRunState } from "../engine.js";
import { applyNarrativeAssetUpdates, commitNarrativeAssets } from "../narrative-assets.js";
import { registerNarrativeParticipants } from "../narrative-characters.js";
import type { NarrativeParticipant } from "../narrative-characters.js";
import type { NarrativeRoundHandoff } from "./handoff.js";

export const NARRATIVE_ASSET_SYNC_ROUNDS = 3;
type Buffer = NonNullable<NarrativeRunState["assetBuffer"]>;

/** Keep the original asset interfaces as a materialized view of saved + staged objects.
 * The buffer owns unsynchronized revisions and their source prose, not a second identity pool.
 * The caller's existing run transaction publishes the view and journal together.
 */
export function stageNarrativeAssetRound(
  run: InternalRunState,
  round: Buffer["rounds"][number],
  changes: { assetUpdates?: NarrativeAssetUpdates; participants?: NarrativeParticipant[]; handoff?: NarrativeRoundHandoff },
  when: NarrativeAssetMoment
): NarrativeAssetUpdates | undefined {
  const buffer = run.narrative.assetBuffer ??= { locations: [], abilities: [], characters: [], rounds: [] };
  const application = applyNarrativeAssetUpdates(run.narrative.assets, changes.assetUpdates, when, true);
  // IDs are allocated here once. All later links refer to these exact records.
  commitNarrativeAssets(run.narrative, application, when, {}, round.sourceEventId);
  const characters = registerNarrativeParticipants({ ...run, age: when.age }, changes.participants, round.sourceEventId, [], changes.handoff?.characters);
  if (changes.handoff) changes.handoff.participantsRegistered = true;
  const upsert = <T extends { id: string }>(previous: T[], next: T[]) =>
    [...new Map([...previous, ...next].map((entry) => [entry.id, structuredClone(entry)])).values()];
  buffer.locations = upsert(buffer.locations, application.assets.locations.filter((entry) => application.locationIds.includes(entry.id)));
  buffer.abilities = upsert(buffer.abilities, application.assets.abilities.filter((entry) => application.abilityIds.includes(entry.id)));
  buffer.characters = upsert(buffer.characters, characters.map(({ character }) => character));
  if (!buffer.rounds.some((entry) => entry.sourceEventId === round.sourceEventId)) buffer.rounds.push({ ...round });
  const currentLocationId = changes.assetUpdates?.locations.some((entry) => entry.current === true)
    ? application.assets.currentLocationId : undefined;
  // Commit paths still add fact/character links via their original API, but never replay
  // stale field values over a batch's newer revision or allocate a second identity.
  return changes.assetUpdates ? {
    locations: application.locationIds.map((ref) => ({ ref, ...(ref === currentLocationId ? { current: true } : {}) })),
    abilities: application.abilityIds.map((ref) => ({ ref }))
  } : undefined;
}

export function narrativeAssetBatchReady(state: NarrativeRunState, flush = false): boolean {
  const count = state.assetBuffer?.rounds.length ?? 0;
  return count >= NARRATIVE_ASSET_SYNC_ROUNDS || (flush && count > 0);
}

export function acknowledgeNarrativeAssetBatch(state: NarrativeRunState, sourceIds: string[]): void {
  const buffer = state.assetBuffer;
  if (!buffer) return;
  // A response acknowledges only the batch that was actually submitted.
  if (buffer.rounds.every((entry) => sourceIds.includes(entry.sourceEventId))) state.assetBuffer = undefined;
}
