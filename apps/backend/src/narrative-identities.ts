import type { NarrativeIdentityMerge, NarrativeRunState } from "@reroll/shared";
import type { InternalRunState } from "./engine.js";
import { formatNarrativeRelationship } from "./narrative-characters.js";

export function canonicalNarrativeIdentity(state: NarrativeRunState, ref: string): string {
  return state.identityAliases?.[ref] ?? ref;
}

/** Rewrite exact stored references, leaving prose and immutable public turns intact. */
export function canonicalizeNarrativeReferences<T>(state: NarrativeRunState, value: T): T {
  const visit = (item: unknown): unknown => {
    if (typeof item === "string") return canonicalNarrativeIdentity(state, item);
    if (Array.isArray(item)) {
      const mapped = item.map(visit);
      return item.some((entry) => typeof entry === "string" && state.identityAliases?.[entry]) && mapped.every((entry) => typeof entry === "string")
        ? Array.from(new Set(mapped)) : mapped;
    }
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, visit(entry)]));
    return item;
  };
  return visit(value) as T;
}

export function narrativeIdentityMergesSchema() {
  return {
    type: "array", description: "同一人物、实际空间或本领重复登记时，归并到保留 ID，并通过相应更新字段提交整合内容。",
    items: { type: "object", additionalProperties: false, required: ["kind", "sourceRef", "targetRef"], properties: {
      kind: { type: "string", enum: ["character", "location", "ability"] },
      sourceRef: { type: "string", description: "本局身份目录中重复的档案 ID。" },
      targetRef: { type: "string", description: "本局身份目录中保留的身份 ID，优先保留最初获得或相识的档案。" }
    } }
  };
}

export function parseNarrativeIdentityMerges(raw: unknown, state: NarrativeRunState): NarrativeIdentityMerge[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error("identity_merges_invalid");
  return raw.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("identity_merge_invalid");
    const { kind, sourceRef, targetRef } = entry as Record<string, unknown>;
    if (!["character", "location", "ability"].includes(kind as string) || typeof sourceRef !== "string" || typeof targetRef !== "string") throw new Error("identity_merge_invalid");
    const records = kind === "character" ? state.dynamicCharacters : kind === "location" ? state.assets?.locations ?? [] : state.assets?.abilities ?? [];
    if (![sourceRef, targetRef].every((ref) => records.some((record) => record.id === canonicalNarrativeIdentity(state, ref)))) throw new Error("identity_merge_reference_invalid");
    return { kind: kind as NarrativeIdentityMerge["kind"], sourceRef, targetRef };
  });
}

export function applyNarrativeIdentityMerges(run: InternalRunState, changes: NarrativeIdentityMerge[] | undefined): void {
  const merges = parseNarrativeIdentityMerges(changes, run.narrative);
  if (!merges.length) return;
  const state = run.narrative;
  let changed = false;
  const union = (a: string[] | undefined, b: string[] | undefined) => Array.from(new Set([...(a ?? []), ...(b ?? [])]));
  for (const merge of merges) {
    const sourceRef = canonicalNarrativeIdentity(state, merge.sourceRef);
    const targetRef = canonicalNarrativeIdentity(state, merge.targetRef);
    if (sourceRef === targetRef) continue;
    changed = true;
    if (merge.kind === "ability") {
      const source = state.assets!.abilities.find((entry) => entry.id === sourceRef)!;
      const target = state.assets!.abilities.find((entry) => entry.id === targetRef)!;
      if (source.introduced.age < target.introduced.age) {
        target.introduced = { ...source.introduced };
        target.source = source.source;
      }
      state.assets!.abilities = state.assets!.abilities.filter((entry) => entry.id !== sourceRef);
    } else if (merge.kind === "location") {
      const source = state.assets!.locations.find((entry) => entry.id === sourceRef)!;
      const target = state.assets!.locations.find((entry) => entry.id === targetRef)!;
      if (source.introduced.age < target.introduced.age) target.introduced = { ...source.introduced };
      if (source.lastSeen.age > target.lastSeen.age) target.lastSeen = { ...source.lastSeen };
      state.assets!.locations = state.assets!.locations.filter((entry) => entry.id !== sourceRef);
    } else {
      const source = state.dynamicCharacters.find((entry) => entry.id === sourceRef)!;
      const target = state.dynamicCharacters.find((entry) => entry.id === targetRef)!;
      target.introducedAge = Math.min(target.introducedAge, source.introducedAge);
      target.lastSeenAge = Math.max(target.lastSeenAge, source.lastSeenAge);
      target.relatedFactIds = union(target.relatedFactIds, source.relatedFactIds);
      target.relatedRouteIds = union(target.relatedRouteIds, source.relatedRouteIds);
      const relationship = target.relationship ?? source.relationship;
      if (relationship) target.relationship = { ...relationship, relatedFactIds: union(target.relationship?.relatedFactIds, source.relationship?.relatedFactIds) };
      state.dynamicCharacters = state.dynamicCharacters.filter((entry) => entry.id !== sourceRef);
    }
    state.identityAliases = Object.fromEntries(Object.entries(state.identityAliases ?? {}).map(([key, ref]) => [key, ref === sourceRef ? targetRef : ref]));
    state.identityAliases[sourceRef] = targetRef;
  }
  if (!changed) return;
  for (const key of ["dynamicCharacters", "assets", "assetBuffer", "memoryEntries", "episodes", "memoryDigests", "horizonPlan", "actCanon", "lastBeatObservation", "activeCharacterIds", "activeScene", "scene", "endingBrief", "agentAttempts"] as const) {
    Object.assign(state, { [key]: canonicalizeNarrativeReferences(state, state[key]) });
  }
  // Buffered objects are references to the current records, not saved revisions
  // that may recreate a deleted source identity after a merge or restore.
  if (state.assetBuffer) {
    const current = <T extends { id: string }>(buffered: T[], records: T[]): T[] => {
      const ids = new Set(buffered.map((entry) => entry.id));
      return records.filter((entry) => ids.has(entry.id)).map((entry) => structuredClone(entry));
    };
    state.assetBuffer.characters = current(state.assetBuffer.characters, state.dynamicCharacters);
    state.assetBuffer.locations = current(state.assetBuffer.locations, state.assets?.locations ?? []);
    state.assetBuffer.abilities = current(state.assetBuffer.abilities, state.assets?.abilities ?? []);
  }
  const digests = new Map<string, NarrativeRunState["memoryDigests"][number]>();
  for (const digest of state.memoryDigests) {
    const id = digest.scopeId ? `${digest.scope}:${digest.scopeId}` : digest.scope;
    const previous = digests.get(id);
    const latest = previous && previous.updatedAt > digest.updatedAt ? previous : digest;
    digests.set(id, { ...latest, id,
      coveredEpisodeIds: union(previous?.coveredEpisodeIds, digest.coveredEpisodeIds),
      activeFactIds: union(previous?.activeFactIds, digest.activeFactIds),
      historicalFactIds: union(previous?.historicalFactIds, digest.historicalFactIds),
      characterIds: union(previous?.characterIds, digest.characterIds)
    });
  }
  state.memoryDigests = Array.from(digests.values());
  state.memoryRevision += 1;
  run.story = canonicalizeNarrativeReferences(state, run.story);
  if (run.pendingDynamicScene) run.pendingDynamicScene = canonicalizeNarrativeReferences(state, run.pendingDynamicScene);
  if (run.choiceExecution) run.choiceExecution = canonicalizeNarrativeReferences(state, run.choiceExecution);
  if (run.nextMilestoneChoice) run.nextMilestoneChoice = canonicalizeNarrativeReferences(state, run.nextMilestoneChoice);
}

/** Identity lookup is independent of which records need detailed story recall. */
export function narrativeCharacterDirectory(state: NarrativeRunState) {
  return state.dynamicCharacters.map((entry) => ({
    id: entry.id, name: entry.name, factionId: entry.factionId, role: entry.role, relationship: formatNarrativeRelationship(entry.relationship),
    status: entry.status, condition: entry.condition
  }));
}

export function formatNarrativeIdentityDirectory(state: NarrativeRunState, compact = false): string {
  if (!compact) return [
    "人物资产：" + JSON.stringify(state.dynamicCharacters.map(({ id, name, factionId, role, description, condition, status, relationship, pendingDetails }) => ({ id, name, factionId, role, description, condition, status, relationship, pendingDetails }))),
    "地点资产：" + JSON.stringify((state.assets?.locations ?? []).map(({ id, name, description, spatialDescription, parentLocationId, features, actors, pendingDetails }) => ({ id, name, description, spatialDescription, parentLocationId, features, actors, pendingDetails }))),
    "本领资产：" + JSON.stringify((state.assets?.abilities ?? []).map(({ id, name, description, usage, source, mastery, pendingDetails }) => ({ id, name, description, usage, source, mastery, pendingDetails })))
  ].join("\n");
  return [
    "人物身份目录：" + state.dynamicCharacters.map(({ id, name }) => id + "=" + name).join("；"),
    "地点身份目录：" + (state.assets?.locations ?? []).map(({ id, name }) => id + "=" + name).join("；"),
    "本领身份目录：" + (state.assets?.abilities ?? []).map(({ id, name }) => id + "=" + name).join("；")
  ].join("\n");
}
