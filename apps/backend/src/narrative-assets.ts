import { randomUUID } from "node:crypto";
import { z } from "zod";
import { commitNarrativeMemory } from "./narrative-memory.js";
import type { NarrativeAssetActivity, NarrativeAssetLinks, NarrativeAssetMoment, NarrativeAssets, NarrativeAssetUpdates, NarrativeRunState, PublicNarrativeAssets } from "@reroll/shared";

const text = z.string().trim().min(1);
const moment = z.object({ ageFrom: z.number().nonnegative().optional(), age: z.number().nonnegative() });
const location = z.object({ id: text, name: text, description: text, spatialDescription: text.optional(), introduced: moment, lastSeen: moment });
const ability = z.object({
  id: text, name: text, description: text, usage: text.optional(), source: text, mastery: text,
  status: z.enum(["available", "unavailable"]), introduced: moment, updated: moment
});
const updates = z.object({
  locations: z.array(z.object({ ref: text, name: text.optional(), description: text.optional(), spatialDescription: text.optional(), current: z.boolean().optional() })).default([]),
  abilities: z.array(z.object({
    ref: text, name: text.optional(), description: text.optional(), usage: text.optional(), source: text.optional(), mastery: text.optional(),
    status: z.enum(["available", "unavailable"]).optional()
  })).default([])
});

export function normalizeNarrativeAssets(raw?: NarrativeAssets): NarrativeAssets {
  const locations = (Array.isArray(raw?.locations) ? raw.locations : []).filter((entry) => location.safeParse(entry).success);
  const abilities = (Array.isArray(raw?.abilities) ? raw.abilities : []).filter((entry) => ability.safeParse(entry).success);
  return {
    locations, abilities,
    currentLocationId: locations.some((entry) => entry.id === raw?.currentLocationId) ? raw?.currentLocationId : undefined
  };
}

export function publicNarrativeAssetsSnapshot(raw?: NarrativeAssets): PublicNarrativeAssets {
  const assets = normalizeNarrativeAssets(raw);
  return structuredClone({
    currentLocationId: assets.currentLocationId,
    locations: assets.locations.map(({ id, name, description, introduced, lastSeen }) => ({ id, name, description, introduced, lastSeen })),
    abilities: assets.abilities.map(({ id, name, description, source, mastery, status, introduced, updated }) => ({ id, name, description, source, mastery, status, introduced, updated }))
  });
}

/** Planning sees capabilities; acquisition and use histories stay in the archive. */
export function narrativeAbilityDirectory(raw?: NarrativeAssets): Array<{ id: string; label: string }> {
  return normalizeNarrativeAssets(raw).abilities
    .filter((entry) => entry.status === "available")
    .map((entry) => ({ id: entry.id, label: `${entry.name}${entry.usage ? `：${entry.usage}` : ""}` }));
}

export function narrativeLocationDirectory(raw?: NarrativeAssets): Array<{ id: string; label: string }> {
  const assets = normalizeNarrativeAssets(raw);
  return assets.locations.map((entry) => ({
    id: entry.id,
    label: `${entry.name}${entry.id === assets.currentLocationId ? "（当前所在）" : ""}`
  }));
}

/** The actual end position also belongs to this turn's visited locations. */
export function normalizeNarrativeAssetActivity(activity: NarrativeAssetActivity): NarrativeAssetActivity {
  return {
    locationIds: Array.from(new Set([
      ...activity.locationIds,
      ...(activity.currentLocationId ? [activity.currentLocationId] : [])
    ])),
    ...(activity.currentLocationId ? { currentLocationId: activity.currentLocationId } : {}),
    abilityIds: Array.from(new Set(activity.abilityIds))
  };
}

/** Applies deterministic visit/use bookkeeping without rewriting the asset archive. */
export function applyNarrativeAssetActivity(
  previous: NarrativeAssets | undefined,
  activity: NarrativeAssetActivity | undefined,
  when: NarrativeAssetMoment
): NarrativeAssets {
  const assets = structuredClone(normalizeNarrativeAssets(previous));
  if (!activity) return assets;
  const normalized = normalizeNarrativeAssetActivity(activity);
  for (const id of normalized.locationIds) {
    const location = assets.locations.find((entry) => entry.id === id);
    if (!location) throw new Error("location_activity_reference_invalid");
    location.lastSeen = { ...when };
  }
  for (const id of normalized.abilityIds) {
    if (!assets.abilities.some((entry) => entry.id === id && entry.status === "available")) {
      throw new Error("ability_activity_reference_invalid");
    }
  }
  if (normalized.currentLocationId) assets.currentLocationId = normalized.currentLocationId;
  return assets;
}

export function parseNarrativeAssetUpdates(raw: unknown, assets?: NarrativeAssets): NarrativeAssetUpdates | undefined {
  if (raw === undefined) return undefined;
  const result = updates.parse(raw);
  return {
    locations: result.locations.map((entry) => {
      const known = assets?.locations.find((item) => item.id === entry.ref);
      if (entry.ref !== "new" && !known) throw new Error("location_reference_invalid");
      return {
        ref: entry.ref, name: text.parse(known?.name ?? entry.name),
        description: text.parse(entry.description ?? known?.description),
        spatialDescription: entry.spatialDescription ?? known?.spatialDescription,
        current: entry.current ?? false
      };
    }),
    abilities: result.abilities.map((entry) => {
      const known = assets?.abilities.find((item) => item.id === entry.ref);
      if (entry.ref !== "new" && !known) throw new Error("ability_reference_invalid");
      return {
        ref: entry.ref, name: text.parse(known?.name ?? entry.name),
        description: text.parse(entry.description ?? known?.description),
        usage: entry.usage ?? known?.usage,
        source: text.parse(known?.source ?? entry.source),
        mastery: text.parse(entry.mastery ?? known?.mastery),
        status: z.enum(["available", "unavailable"]).parse(entry.status ?? known?.status)
      };
    })
  };
}

export function narrativeAssetUpdatesSchema(_assets?: NarrativeAssets): Record<string, unknown> {
  const string = { type: "string", minLength: 1 };
  return {
    type: "object",
    description: "同步登记正文中已经发生的地点与本领变化；对应类型无变化时数组为空。已有对象用 ref 引用，新对象用 new；地点是实际空间，本领是主角已经学会的能力。不得登记尚未选择的奖励、计划或他人的能力。",
    additionalProperties: false,
    properties: {
      locations: {
        type: "array", items: {
          type: "object", additionalProperties: false,
          required: ["ref"],
          description: "地点是可辨认的实际空间。已有地点用 ref 引用，新地点另需 name 和空间描述；其发生的事件保存在经历中。",
          properties: {
            ref: { type: "string", description: "使用本轮上下文中的已有地点 ID，或使用 new 新建地点。" },
            name: string, description: string,
            spatialDescription: { type: "string", description: "供后续叙事使用的当前空间与稳定环境条件；新地点填写，空间实质变化时更新。事件经过留在 description 与经历记录中。" },
            current: { type: "boolean", description: "本段结束时主角实际所在的地点为 true；仅提及或曾经路过为 false。" }
          }
        }
      },
      abilities: {
        type: "array", items: {
          type: "object", additionalProperties: false,
          required: ["ref"],
          description: "本领是可以主动运用、训练或传授的独立能力。熟练提升更新原 ID，独立的新能力新建；自然成长体现为年龄与属性，身份职位保存在人物中。",
          properties: {
            ref: { type: "string", description: "使用本轮上下文中的已有本领 ID，或使用 new 新建本领。" },
            name: { type: "string", minLength: 1, description: "稳定、简短的本领名称，也是档案标题。" },
            description: { type: "string", description: "供玩家查看的能力说明与实际获得、使用经历。" },
            usage: { type: "string", description: "当前能怎样主动使用这项能力、实际效果、掌握程度与限制；新本领填写，能力实质变化时更新。只写当前可用状态。" },
            source: { type: "string", description: "已经发生的获得来历；更新时保留原来历。" },
            mastery: { type: "string", minLength: 1, description: "当前掌握状态的简短称谓，不写经历、来历或整段能力说明。" },
            status: { type: "string", enum: ["available", "unavailable"] }
          }
        }
      }
    }
  };
}

export function narrativeContinuityAssetContract(_assets: NarrativeAssets): {
  properties: Record<string, unknown>;
  required: string[];
} {
  const schema = narrativeAssetUpdatesSchema() as { properties: Record<string, unknown> };
  return {
    properties: {
      locationUpdates: schema.properties.locations,
      abilityUpdates: schema.properties.abilities
    },
    required: ["locationUpdates", "abilityUpdates"]
  };
}

export function parseNarrativeContinuityAssetUpdates(
  raw: Record<string, unknown>, assets: NarrativeAssets
): NarrativeAssetUpdates {
  const contract = narrativeContinuityAssetContract(assets);
  for (const field of contract.required) {
    if (!Object.hasOwn(raw, field)) throw new Error(`${field}_required`);
  }
  return parseNarrativeAssetUpdates({
    locations: raw.locationUpdates,
    abilities: raw.abilityUpdates
  }, assets)!;
}

const identity = (value: string): string => value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase();

/** Work on a copy so rejected updates cannot leave a partially changed archive. */
export function applyNarrativeAssetUpdates(
  previous: NarrativeAssets | undefined,
  changes: NarrativeAssetUpdates | undefined,
  when: NarrativeAssetMoment
): NarrativeAssets {
  const assets = structuredClone(normalizeNarrativeAssets(previous));
  if (!changes) return assets;
  const normalized = parseNarrativeAssetUpdates(changes, assets)!;
  for (const entry of normalized.locations) {
    const known = entry.ref === "new"
      ? assets.locations.find((item) => identity(item.name) === identity(entry.name))
      : assets.locations.find((item) => item.id === entry.ref);
    const record = known ?? { id: `location:${randomUUID()}`, name: entry.name, description: entry.description, introduced: { ...when }, lastSeen: { ...when } };
    record.name = entry.name;
    record.description = entry.description;
    if (entry.spatialDescription) record.spatialDescription = entry.spatialDescription;
    record.lastSeen = { ...when };
    if (!known) assets.locations.push(record);
    if (entry.current) assets.currentLocationId = record.id;
  }
  for (const entry of normalized.abilities) {
    const known = entry.ref === "new"
      ? assets.abilities.find((item) => identity(item.name) === identity(entry.name))
      : assets.abilities.find((item) => item.id === entry.ref);
    const record = known ?? { id: `ability:${randomUUID()}`, name: entry.name, description: entry.description, source: entry.source, mastery: entry.mastery, status: entry.status, introduced: { ...when }, updated: { ...when } };
    Object.assign(record, { name: entry.name, description: entry.description, mastery: entry.mastery, status: entry.status, updated: { ...when } });
    if (entry.usage) record.usage = entry.usage;
    if (!known) assets.abilities.push(record);
  }
  return assets;
}

export interface NarrativeAssetContextQuery {
  locationIds?: string[];
  abilityIds?: string[];
  includeCurrentLocation?: boolean;
}

/** Looks up the selected identities without choosing their narrative relevance again. */
export function selectNarrativeAssets(assets: NarrativeAssets, query: NarrativeAssetContextQuery): NarrativeAssets {
  const locationIds = new Set([
    ...(query.includeCurrentLocation !== false && assets.currentLocationId ? [assets.currentLocationId] : []),
    ...(query.locationIds ?? [])
  ]);
  const abilityIds = new Set(query.abilityIds ?? []);
  return {
    locations: assets.locations.filter((entry) => locationIds.has(entry.id)),
    abilities: assets.abilities.filter((entry) => abilityIds.has(entry.id)),
    currentLocationId: locationIds.has(assets.currentLocationId ?? "") ? assets.currentLocationId : undefined
  };
}

export function formatNarrativeAssets(assets?: NarrativeAssets): string {
  if (!assets) return "";
  return [
    assets.locations.length ? `地点档案：${assets.locations.map((entry) =>
      `${entry.id}=${entry.name}${entry.id === assets.currentLocationId ? "（当前所在）" : ""}${entry.spatialDescription ? `：${entry.spatialDescription}` : ""}`).join("；")}` : "",
    assets.abilities.length ? `本领档案：${assets.abilities.map((entry) =>
      `${entry.id}=${entry.name}（${entry.status === "available" ? "可用" : "不可用"}）${entry.usage ? `：${entry.usage}` : ""}`).join("；")}` : ""
  ].filter(Boolean).join("\n");
}

/** Archive and recall indexes are committed together, before a public turn is made. */
export function commitNarrativeAssets(
  state: NarrativeRunState,
  assets: NarrativeAssets,
  changes: NarrativeAssetUpdates | undefined,
  when: NarrativeAssetMoment,
  links: NarrativeAssetLinks = {},
  sourceEventId?: string
): { locationIds: string[]; abilityIds: string[] } {
  const locations = assets.locations.filter((entry) => changes?.locations.some((change) => change.ref === entry.id || (change.ref === "new" && identity(change.name) === identity(entry.name))));
  const abilities = assets.abilities.filter((entry) => changes?.abilities.some((change) => change.ref === entry.id || (change.ref === "new" && identity(change.name) === identity(entry.name))));
  for (const entry of [...locations, ...abilities]) {
    for (const key of ["characterIds", "factionIds", "routeIds", "factIds"] as const) {
      entry[key] = Array.from(new Set([...(entry[key] ?? []), ...(links[key] ?? [])]));
    }
  }
  state.assets = assets;
  const current = assets.locations.find((entry) => entry.id === assets.currentLocationId);
  if (current) state.scene.place = current.name;
  const committed = {
    locationIds: locations.map((entry) => entry.id),
    abilityIds: abilities.map((entry) => entry.id)
  };
  if (!locations.length && !abilities.length) return committed;
  const memoryId = `memory:${sourceEventId ?? randomUUID()}`;
  const existing = state.memoryEntries.find((entry) => entry.id === memoryId);
  commitNarrativeMemory(state, {
    id: memoryId,
    age: when.age,
    routeId: links.routeIds?.[0],
    factionIds: links.factionIds ?? [], characterIds: links.characterIds ?? [], factIds: links.factIds ?? [],
    locationIds: committed.locationIds, abilityIds: committed.abilityIds,
    text: existing?.text ?? [
      when.ageFrom !== undefined ? `${when.ageFrom}-${when.age}岁间` : `${when.age}岁`,
      ...locations.map((entry) => `${entry.name}：${entry.description}`),
      ...abilities.map((entry) => `${entry.name}：${entry.mastery}，${entry.description}`)
    ].join("；")
  });
  return committed;
}
