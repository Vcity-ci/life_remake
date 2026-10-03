import type { NarrativeIdentityMerge, NarrativeRunState } from "@reroll/shared";
import type { InternalRunState } from "./engine.js";

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
    type: "array", description: "本轮核对发现既有档案实际是同一人物或同一本领的进阶时，声明归并到保留的原 ID。不同人物、不同能力保持独立。",
    items: { type: "object", additionalProperties: false, required: ["kind", "sourceRef", "targetRef"], properties: {
      kind: { type: "string", enum: ["character", "ability"] },
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
    if ((kind !== "character" && kind !== "ability") || typeof sourceRef !== "string" || typeof targetRef !== "string") throw new Error("identity_merge_invalid");
    const records = kind === "character" ? state.dynamicCharacters : state.assets?.abilities ?? [];
    if (![sourceRef, targetRef].every((ref) => records.some((record) => record.id === canonicalNarrativeIdentity(state, ref)))) throw new Error("identity_merge_reference_invalid");
    return { kind, sourceRef, targetRef };
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
      if (source.updated.age >= target.updated.age) {
        target.description = source.description; target.mastery = source.mastery;
        target.status = source.status; target.updated = { ...source.updated };
      }
      for (const key of ["characterIds", "factionIds", "routeIds", "factIds"] as const) target[key] = union(target[key], source[key]);
      state.assets!.abilities = state.assets!.abilities.filter((entry) => entry.id !== sourceRef);
    } else {
      const source = state.dynamicCharacters.find((entry) => entry.id === sourceRef)!;
      const target = state.dynamicCharacters.find((entry) => entry.id === targetRef)!;
      target.introducedAge = Math.min(target.introducedAge, source.introducedAge);
      if (source.lastSeenAge >= target.lastSeenAge) {
        target.description = source.description; target.status = source.status;
      }
      target.lastSeenAge = Math.max(target.lastSeenAge, source.lastSeenAge);
      target.relatedFactIds = union(target.relatedFactIds, source.relatedFactIds);
      target.relatedRouteIds = union(target.relatedRouteIds, source.relatedRouteIds);
      const relationship = !target.relationship || (source.relationship?.lastChangedAge ?? -1) > target.relationship.lastChangedAge ? source.relationship : target.relationship;
      if (relationship) target.relationship = { ...relationship, relatedFactIds: union(target.relationship?.relatedFactIds, source.relationship?.relatedFactIds) };
      state.dynamicCharacters = state.dynamicCharacters.filter((entry) => entry.id !== sourceRef);
    }
    state.identityAliases = Object.fromEntries(Object.entries(state.identityAliases ?? {}).map(([key, ref]) => [key, ref === sourceRef ? targetRef : ref]));
    state.identityAliases[sourceRef] = targetRef;
  }
  if (!changed) return;
  for (const key of ["dynamicCharacters", "assets", "memoryEntries", "episodes", "memoryDigests", "horizonPlan", "sessionPremise", "actCanon", "lastBeatObservation", "activeCharacterIds", "activeScene", "scene", "endingBrief", "agentAttempts"] as const) {
    Object.assign(state, { [key]: canonicalizeNarrativeReferences(state, state[key]) });
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
}

/** Identity lookup is independent of which records need detailed story recall. */
export function narrativeCharacterDirectory(state: NarrativeRunState) {
  return state.dynamicCharacters.map((entry) => ({
    id: entry.id, name: entry.name, factionId: entry.factionId, role: entry.role,
    description: `${entry.status === "gone" ? "已离场。" : entry.status === "resolved" ? "此前交往已告一段落。" : ""}${entry.description.slice(0, 80)}`
  }));
}

export function formatNarrativeIdentityDirectory(state: NarrativeRunState): string {
  return [
    `人物身份目录：${state.dynamicCharacters.map((entry) => `${entry.id}=${entry.name}（${entry.role}，${entry.status}）`).join("；") || "无"}`,
    `地点身份目录：${(state.assets?.locations ?? []).map((entry) => `${entry.id}=${entry.name}：${entry.description.slice(0, 60)}`).join("；") || "无"}`,
    `本领身份目录：${(state.assets?.abilities ?? []).map((entry) => `${entry.id}=${entry.name}（${entry.mastery}，${entry.status}）：${entry.description.slice(0, 80)}`).join("；") || "无"}`
  ].join("\n");
}
