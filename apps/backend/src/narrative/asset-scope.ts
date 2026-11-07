import type { InternalRunState } from "../engine.js";
import type { NarrativeAssetRetirement } from "@reroll/shared";

/** One-hop structural candidates, not prose matching or a second asset store. */
export function continuityDetailIds(run: InternalRunState): string[] {
  const buffer = run.narrative.assetBuffer;
  const ids = new Set([
    ...(buffer?.rounds.flatMap((round) => round.relatedIds ?? []) ?? []),
    ...(buffer?.characters.map((entry) => entry.id) ?? []),
    ...(buffer?.locations.map((entry) => entry.id) ?? []),
    ...(buffer?.abilities.map((entry) => entry.id) ?? []),
    ...(run.narrative.assets?.currentLocationId ? [run.narrative.assets.currentLocationId] : [])
  ]);
  const initial = new Set(ids);
  const connect = (id: string, refs: string[]) => {
    if (initial.has(id) || refs.some((ref) => initial.has(ref))) {
      ids.add(id); refs.forEach((ref) => ids.add(ref));
    }
  };
  for (const person of run.narrative.dynamicCharacters) connect(person.id, [...person.relatedFactIds, ...(person.relationship?.relatedFactIds ?? [])]);
  for (const location of run.narrative.assets?.locations ?? []) connect(location.id, [
    ...(location.parentLocationId ? [location.parentLocationId] : []), ...(location.characterIds ?? []), ...(location.factIds ?? []),
    ...(location.actors?.flatMap((actor) => actor.characterIds ?? []) ?? [])
  ]);
  for (const ability of run.narrative.assets?.abilities ?? []) connect(ability.id, [...(ability.characterIds ?? []), ...(ability.factIds ?? [])]);
  for (const fact of run.story.factLedger?.facts ?? []) connect(fact.id, [...(fact.characterIds ?? []), ...(fact.locationIds ?? []), ...(fact.abilityIds ?? [])]);
  return [...ids];
}

export function parseAssetRetirements(raw: unknown, run: InternalRunState): NarrativeAssetRetirement[] {
  if (!Array.isArray(raw)) throw new Error("asset_retirements_required");
  return raw.map((item) => {
    if (!item || typeof item !== "object" || Object.keys(item).some((key) => key !== "kind" && key !== "ref")) throw new Error("asset_retirement_invalid");
    const { kind, ref } = item;
    const records = kind === "character" ? run.narrative.dynamicCharacters : kind === "location" ? run.narrative.assets?.locations : kind === "ability" ? run.narrative.assets?.abilities : undefined;
    if (typeof ref !== "string" || !records?.some((entry) => entry.id === ref)) throw new Error("asset_retirement_reference_invalid");
    return { kind, ref } as NarrativeAssetRetirement;
  });
}

/** Retired identities survive only while a current structured record needs them. */
export function retireNarrativeAssets(run: InternalRunState, changes: NarrativeAssetRetirement[] = []): void {
  const state = run.narrative;
  const all = [...state.dynamicCharacters, ...(state.assets?.locations ?? []), ...(state.assets?.abilities ?? [])];
  for (const change of changes) {
    const record = all.find((entry) => entry.id === change.ref);
    if (record) record.retired = true;
  }
  const protectedIds = new Set<string>();
  if (state.assets?.currentLocationId) protectedIds.add(state.assets.currentLocationId);
  const add = (refs?: string[]) => refs?.forEach((ref) => protectedIds.add(ref));
  for (const person of state.dynamicCharacters.filter((entry) => !entry.retired)) add(person.relatedFactIds);
  for (const location of (state.assets?.locations ?? []).filter((entry) => !entry.retired)) {
    if (location.parentLocationId) protectedIds.add(location.parentLocationId);
    add(location.characterIds); add(location.factIds);
    location.actors?.forEach((actor) => add(actor.characterIds));
  }
  for (const ability of (state.assets?.abilities ?? []).filter((entry) => !entry.retired)) { add(ability.characterIds); add(ability.factIds); }
  for (const fact of (run.story.factLedger?.facts ?? []).filter((entry) => entry.status === "open")) { add(fact.characterIds); add(fact.locationIds); add(fact.abilityIds); }
  const collect = (value: unknown): void => {
    if (typeof value === "string" && all.some((entry) => entry.id === value)) protectedIds.add(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(run.pendingDynamicScene); collect(run.nextMilestoneChoice); collect(run.choiceExecution);
  const keep = <T extends { id: string; name: string; retired?: boolean }>(record: T): T[] => {
    if (!record.retired) return [record];
    if (!protectedIds.has(record.id)) return [];
    const minimal = { id: record.id, name: record.name, retired: true, pendingDetails: true } as Record<string, unknown>;
    // Bookkeeping is not an asset dossier and remains usable for visible snapshots.
    for (const key of ["introduced", "lastSeen", "updated", "introducedAge", "lastSeenAge", "importance", "status"]) {
      if (key in record) minimal[key] = (record as any)[key];
    }
    if (record.id.startsWith("character:")) { minimal.relatedFactIds = []; minimal.relatedRouteIds = []; }
    return [minimal as T];
  };
  state.dynamicCharacters = state.dynamicCharacters.flatMap(keep);
  state.activeCharacterIds = state.activeCharacterIds.filter((id) => state.dynamicCharacters.some((entry) => entry.id === id && !entry.retired));
  if (state.assets) {
    state.assets.locations = state.assets.locations.flatMap(keep);
    state.assets.abilities = state.assets.abilities.flatMap(keep);
  }
  if (state.assetBuffer) {
    state.assetBuffer.characters = state.dynamicCharacters.filter((entry) => state.assetBuffer!.characters.some((old) => old.id === entry.id));
    state.assetBuffer.locations = (state.assets?.locations ?? []).filter((entry) => state.assetBuffer!.locations.some((old) => old.id === entry.id));
    state.assetBuffer.abilities = (state.assets?.abilities ?? []).filter((entry) => state.assetBuffer!.abilities.some((old) => old.id === entry.id));
  }
}
