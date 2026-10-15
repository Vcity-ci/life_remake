import { randomUUID } from "node:crypto";
import { z } from "zod";
import { commitNarrativeMemory } from "./narrative-memory.js";
import type { NarrativeAbility, NarrativeLocation, NarrativeAssetActivity, NarrativeAssetLinks, NarrativeAssetMoment, NarrativeAssets, NarrativeAssetUpdates, NarrativeRunState, PublicNarrativeAssets } from "@reroll/shared";

const text = z.string().trim().min(1);
const moment = z.object({ ageFrom: z.number().nonnegative().optional(), age: z.number().nonnegative() });
const location = z.object({ id: text, name: text, description: text, spatialDescription: text.optional(), introduced: moment, lastSeen: moment });
const ability = z.object({
  id: text, name: text, description: text, usage: text.optional(), source: text, mastery: text,
  status: z.enum(["available", "unavailable"]), introduced: moment, updated: moment
});
const updates = z.object({
  locations: z.array(z.object({ ref: text, name: text.optional(), description: text.optional(), spatialDescription: text.optional(), current: z.boolean().optional() })),
  abilities: z.array(z.object({
    ref: text, name: text.optional(), description: text.optional(), usage: text.optional(), source: text.optional(), mastery: text.optional(),
    status: z.enum(["available", "unavailable"]).optional()
  }))
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
    if (!assets.abilities.some((entry) => entry.id === id)) {
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
      if (!known) { text.parse(entry.name); text.parse(entry.description); text.parse(entry.spatialDescription); }
      return entry;
    }),
    abilities: result.abilities.map((entry) => {
      const known = assets?.abilities.find((item) => item.id === entry.ref);
      if (entry.ref !== "new" && !known) throw new Error("ability_reference_invalid");
      if (!known) {
        text.parse(entry.name); text.parse(entry.description); text.parse(entry.source); text.parse(entry.mastery);
        text.parse(entry.usage);
        z.enum(["available", "unavailable"]).parse(entry.status);
      }
      return entry;
    })
  };
}

export function narrativeAssetUpdatesSchema(_assets?: NarrativeAssets): Record<string, unknown> {
  const string = { type: "string", minLength: 1 };
  return {
    type: "object",
    description: "同步登记正文中已经发生的地点与本领变化；对应类型无变化时数组为空。已有对象用 ref 引用，新对象用 new；地点是实际空间，本领是主角已经学会的能力。不得登记尚未选择的奖励、计划或他人的能力。",
    additionalProperties: false,
    required: ["locations", "abilities"],
    properties: {
      locations: {
        type: "array", items: {
          type: "object", additionalProperties: false,
          required: ["ref"],
          anyOf: [
            { properties: { ref: { const: "new" } }, required: ["name", "description", "spatialDescription"] },
            { properties: { ref: { not: { const: "new" } } } }
          ],
          description: "新增可辨认的实际空间或更新真实的空间变化。仅抵达已有地点由 assetActivity 记录。已有地点用 ref 引用，新地点另需 name 和空间描述；其发生的事件保存在经历中。",
          properties: {
            ref: { type: "string", description: "完整复制目录中的已有地点 ID，包含 location: 前缀；新建地点使用 new。" },
            name: { ...string, description: "新地点的稳定名称；更新已有地点保留原名称。" }, description: string,
            spatialDescription: { type: "string", description: "供后续叙事使用的当前空间与稳定环境条件；新地点填写，空间实质变化时更新。事件经过留在 description 与经历记录中。" },
            current: { type: "boolean", description: "本段结束时主角实际所在的地点为 true；仅提及或曾经路过为 false。" }
          }
        }
      },
      abilities: {
        type: "array", items: {
          type: "object", additionalProperties: false,
          required: ["ref"],
          anyOf: [
            { properties: { ref: { const: "new" } }, required: ["name", "description", "usage", "source", "mastery", "status"] },
            { properties: { ref: { not: { const: "new" } } } }
          ],
          description: "本领是游戏技能：主角学会后能主动选择使用，改变解决困难的方式或效果的具体技艺、战法、秘法。填写使用方式、效果与限制。同一技法进阶更新原 ID；不同机制新建。普通行走、生理成长、身份职位分别由生活、属性、人物表达。",
          properties: {
            ref: { type: "string", description: "完整复制目录中的已有本领 ID，包含 ability: 前缀；新建本领使用 new。" },
            name: { type: "string", minLength: 1, description: "新本领的稳定、简短名称，也是档案标题；已有本领沿用原名称。" },
            description: { type: "string", minLength: 1, description: "供玩家查看的能力说明与实际获得、使用经历。" },
            usage: { type: "string", description: "当前能怎样主动使用这项能力、实际效果、掌握程度与限制；新本领填写，能力实质变化时更新。只写当前可用状态。" },
            source: { type: "string", minLength: 1, description: "已经发生的获得来历；更新时保留原来历。" },
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

export interface NarrativeAssetApplication {
  assets: NarrativeAssets;
  locationIds: string[];
  abilityIds: string[];
}

/** Work on a copy so rejected updates cannot leave a partially changed archive. */
export function applyNarrativeAssetUpdates(
  previous: NarrativeAssets | undefined,
  changes: NarrativeAssetUpdates | undefined,
  when: NarrativeAssetMoment
): NarrativeAssetApplication {
  const assets = structuredClone(normalizeNarrativeAssets(previous));
  const applied: NarrativeAssetApplication = { assets, locationIds: [], abilityIds: [] };
  if (!changes) return applied;
  const normalized = parseNarrativeAssetUpdates(changes, assets)!;
  for (const entry of normalized.locations) {
    const known = assets.locations.find((item) => item.id === entry.ref);
    const record: NarrativeLocation = known ?? { id: `location:${randomUUID()}`, name: text.parse(entry.name), description: text.parse(entry.description), introduced: { ...when }, lastSeen: { ...when } };
    if (entry.description !== undefined) record.description = entry.description;
    if (entry.spatialDescription !== undefined) record.spatialDescription = entry.spatialDescription;
    record.lastSeen = { ...when };
    if (!known) assets.locations.push(record);
    applied.locationIds.push(record.id);
    if (entry.current) assets.currentLocationId = record.id;
  }
  for (const entry of normalized.abilities) {
    const known = assets.abilities.find((item) => item.id === entry.ref);
    const record: NarrativeAbility = known ?? { id: `ability:${randomUUID()}`, name: text.parse(entry.name), description: text.parse(entry.description), source: text.parse(entry.source), mastery: text.parse(entry.mastery), status: z.enum(["available", "unavailable"]).parse(entry.status), introduced: { ...when }, updated: { ...when } };
    for (const key of ["description", "usage", "mastery", "status"] as const) {
      if (entry[key] !== undefined) Object.assign(record, { [key]: entry[key] });
    }
    record.updated = { ...when };
    if (!known) assets.abilities.push(record);
    applied.abilityIds.push(record.id);
  }
  return applied;
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
  application: NarrativeAssetApplication,
  when: NarrativeAssetMoment,
  links: NarrativeAssetLinks = {},
  sourceEventId?: string
): { locationIds: string[]; abilityIds: string[] } {
  const { assets } = application;
  const locations = assets.locations.filter((entry) => application.locationIds.includes(entry.id));
  const abilities = assets.abilities.filter((entry) => application.abilityIds.includes(entry.id));
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
