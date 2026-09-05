import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { NarrativeAssetLinks, NarrativeAssetMoment, NarrativeAssets, NarrativeAssetUpdates, NarrativeRunState, PublicNarrativeAssets } from "@reroll/shared";

const text = z.string().trim().min(1);
const moment = z.object({ ageFrom: z.number().nonnegative().optional(), age: z.number().nonnegative() });
const location = z.object({ id: text, name: text, description: text, introduced: moment, lastSeen: moment });
const ability = z.object({
  id: text, name: text, description: text, source: text, mastery: text,
  status: z.enum(["available", "unavailable"]), introduced: moment, updated: moment
});
const updates = z.object({
  locations: z.array(z.object({ ref: text, name: text, description: text, current: z.boolean() })).default([]),
  abilities: z.array(z.object({
    ref: text, name: text, description: text, source: text, mastery: text,
    status: z.enum(["available", "unavailable"])
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

export function parseNarrativeAssetUpdates(raw: unknown, assets?: NarrativeAssets): NarrativeAssetUpdates | undefined {
  if (raw === undefined) return undefined;
  const result = updates.parse(raw);
  for (const entry of result.locations) {
    if (entry.ref !== "new" && !assets?.locations.some((known) => known.id === entry.ref)) {
      throw new Error("location_reference_invalid");
    }
  }
  for (const entry of result.abilities) {
    if (entry.ref !== "new" && !assets?.abilities.some((known) => known.id === entry.ref)) {
      throw new Error("ability_reference_invalid");
    }
  }
  return result;
}

export function narrativeAssetUpdatesSchema(assets?: NarrativeAssets): Record<string, unknown> {
  const string = { type: "string" };
  return {
    type: "object",
    description: "同步登记正文中已经发生的地点与本领变化；无变化可省略。已有对象用 ref 引用，新对象用 new；地点是实际空间，本领是主角已经学会的能力。不得登记尚未选择的奖励、计划或他人的能力。",
    additionalProperties: false,
    required: ["locations", "abilities"],
    properties: {
      locations: {
        type: "array", items: {
          type: "object", additionalProperties: false,
          required: ["ref", "name", "description", "current"],
          properties: {
            ref: { type: "string", enum: ["new", ...(assets?.locations ?? []).map((entry) => entry.id)] },
            name: string, description: string,
            current: { type: "boolean", description: "本段结束时主角实际所在的地点为 true；仅提及或曾经路过为 false。" }
          }
        }
      },
      abilities: {
        type: "array", items: {
          type: "object", additionalProperties: false,
          required: ["ref", "name", "description", "source", "mastery", "status"],
          properties: {
            ref: { type: "string", enum: ["new", ...(assets?.abilities ?? []).map((entry) => entry.id)] },
            name: string, description: { type: "string", description: "能力的具体用途及适用情境。" },
            source: { type: "string", description: "已经发生的获得来历；更新时保留原来历。" },
            mastery: { type: "string", description: "简短自然语言描述当前掌握情况。" },
            status: { type: "string", enum: ["available", "unavailable"] }
          }
        }
      }
    }
  };
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
  parseNarrativeAssetUpdates(changes, assets);
  for (const entry of changes.locations) {
    const known = entry.ref === "new"
      ? assets.locations.find((item) => identity(item.name) === identity(entry.name))
      : assets.locations.find((item) => item.id === entry.ref);
    const record = known ?? { id: `location:${randomUUID()}`, name: entry.name, description: entry.description, introduced: { ...when }, lastSeen: { ...when } };
    record.name = entry.name;
    record.description = entry.description;
    record.lastSeen = { ...when };
    if (!known) assets.locations.push(record);
    if (entry.current) assets.currentLocationId = record.id;
  }
  for (const entry of changes.abilities) {
    const known = entry.ref === "new"
      ? assets.abilities.find((item) => identity(item.name) === identity(entry.name))
      : assets.abilities.find((item) => item.id === entry.ref);
    const record = known ?? { id: `ability:${randomUUID()}`, name: entry.name, description: entry.description, source: entry.source, mastery: entry.mastery, status: entry.status, introduced: { ...when }, updated: { ...when } };
    Object.assign(record, { name: entry.name, description: entry.description, mastery: entry.mastery, status: entry.status, updated: { ...when } });
    if (!known) assets.abilities.push(record);
  }
  return assets;
}

export function formatNarrativeAssets(assets?: NarrativeAssets): string {
  if (!assets) return "";
  const current = assets.locations.find((entry) => entry.id === assets.currentLocationId);
  // Compact identities remain referenceable; detailed descriptions favor recent experience.
  const recentLocations = new Set(assets.locations.slice().sort((a, b) => b.lastSeen.age - a.lastSeen.age).slice(0, 4).map((entry) => entry.id));
  return [
    current ? `当前所在：${current.name}。${current.description.slice(0, 160)}` : "",
    assets.locations.length ? `已知地点：${assets.locations.map((entry) => `${entry.id}=${entry.name}${recentLocations.has(entry.id) ? `（${entry.description.slice(0, 80)}）` : ""}`).join("；")}` : "",
    assets.abilities.length ? `本领档案：${assets.abilities.map((entry) => `${entry.id}=${entry.name}（${entry.mastery.slice(0, 50)}；${entry.status === "available" ? "可用" : "当前不可用"}）：${entry.description.slice(0, 100)}`).join("；")}` : ""
  ].filter(Boolean).join("\n");
}

/** Archive and recall indexes are committed together, before a public turn is made. */
export function commitNarrativeAssets(
  state: NarrativeRunState,
  assets: NarrativeAssets,
  changes: NarrativeAssetUpdates | undefined,
  when: NarrativeAssetMoment,
  links: NarrativeAssetLinks = {}
): void {
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
  if (!locations.length && !abilities.length) return;
  state.memoryEntries = [...state.memoryEntries, {
    id: `memory:${randomUUID()}`,
    age: when.age,
    routeId: links.routeIds?.[0],
    factionIds: links.factionIds ?? [], characterIds: links.characterIds ?? [], factIds: links.factIds ?? [],
    locationIds: locations.map((entry) => entry.id), abilityIds: abilities.map((entry) => entry.id),
    text: [
      when.ageFrom !== undefined ? `${when.ageFrom}-${when.age}岁间` : `${when.age}岁`,
      ...locations.map((entry) => `${entry.name}：${entry.description}`),
      ...abilities.map((entry) => `${entry.name}：${entry.mastery}，${entry.description}`)
    ].join("；").slice(0, 480)
  }].slice(-80);
}
