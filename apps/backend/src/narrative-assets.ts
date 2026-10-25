import { randomUUID } from "node:crypto";
import { z } from "zod";
import { commitNarrativeMemory } from "./narrative-memory.js";
import { NARRATIVE_ABILITY_DEFINITION } from "./narrative-prompts.js";
import type { NarrativeAbility, NarrativeLocation, NarrativeAssetActivity, NarrativeAssetLinks, NarrativeAssetMoment, NarrativeAssets, NarrativeAssetUpdates, NarrativeRunState, PublicNarrativeAssets } from "@reroll/shared";

const text = z.string().trim().min(1);
const changeText = z.string().trim();
const moment = z.object({ ageFrom: z.number().nonnegative().optional(), age: z.number().nonnegative() });
const placeFields = {
  parentLocationId: changeText.optional(),
  features: z.array(z.object({ name: text, state: text })).optional(),
  actors: z.array(z.object({ characterIds: z.array(text).optional(), factionId: changeText.optional(), organizationName: changeText.optional(), relation: text })).optional()
};
const location = z.object({ id: text, name: text, description: changeText.optional(), pendingDetails: z.boolean().optional(), spatialDescription: changeText.optional(), ...placeFields, introduced: moment, lastSeen: moment });
const ability = z.object({
  id: text, name: text, description: text.optional(), pendingDetails: z.boolean().optional(), usage: text.optional(), source: text.optional(), mastery: text.optional(),
  introduced: moment, updated: moment
});
const updates = z.object({
  locations: z.array(z.object({ ref: text, name: text.optional(), pendingDetails: z.boolean().optional(), description: changeText.optional(), spatialDescription: changeText.optional(), ...placeFields, current: z.boolean().optional() })),
  abilities: z.array(z.object({
    ref: text, name: text.optional(), pendingDetails: z.boolean().optional(), description: changeText.optional(), usage: changeText.optional(), source: changeText.optional(), mastery: changeText.optional()
  }))
});
const assetDeclarations = z.object({
  locations: z.array(z.object({ ref: text, name: text.optional(), current: z.boolean().optional() })),
  abilities: z.array(z.object({ ref: text, name: text.optional() }))
});

export function normalizeNarrativeAssets(raw?: NarrativeAssets): NarrativeAssets {
  const locations = (Array.isArray(raw?.locations) ? raw.locations : []).filter((entry) => location.safeParse(entry).success);
  const abilities = (Array.isArray(raw?.abilities) ? raw.abilities : []).filter((entry) => ability.safeParse(entry).success)
    .map((entry) => { const { status: _legacyStatus, ...record } = entry as NarrativeAbility & { status?: unknown }; return record; });
  return {
    locations, abilities,
    currentLocationId: locations.some((entry) => entry.id === raw?.currentLocationId) ? raw?.currentLocationId : undefined
  };
}

export function publicNarrativeAssetsSnapshot(raw?: NarrativeAssets): PublicNarrativeAssets {
  const assets = normalizeNarrativeAssets(raw);
  return structuredClone({
    currentLocationId: assets.currentLocationId,
    locations: assets.locations.map(({ id, name, description, spatialDescription, parentLocationId, features, actors, introduced, lastSeen }) => ({ id, name, description, spatialDescription, parentLocationId, features, actors, introduced, lastSeen })),
    abilities: assets.abilities.map(({ id, name, description, usage, source, mastery, introduced, updated }) => ({ id, name, description, usage, source, mastery, introduced, updated }))
  });
}

/** Planning sees current effects and conditions; acquisition histories stay in the archive. */
export function narrativeAbilityDirectory(raw?: NarrativeAssets): Array<{ id: string; label: string }> {
  return normalizeNarrativeAssets(raw).abilities
    .map((entry) => ({ id: entry.id, label: [narrativeAbilityLabel(entry), entry.description, entry.usage ? `使用：${entry.usage}` : ""].filter(Boolean).join("；") }));
}

export function narrativeAbilityLabel(ability: Pick<NarrativeAbility, "name" | "mastery">): string {
  return `${ability.name}${ability.mastery ? `（${ability.mastery}）` : ""}`;
}

export interface NarrativeAssetNames {
  characters?: Array<{ id: string; name: string }>;
  factions?: Array<{ id: string; label: string }>;
  locations?: Array<{ id: string; name: string }>;
}

/** One projection of maintained place fields, shared by selection and prose. */
export function narrativeLocationLabel(entry: NarrativeLocation, names: NarrativeAssetNames = {}): string {
  return [
    entry.name,
    entry.description ? `背景：${entry.description}` : "",
    entry.spatialDescription ? `空间：${entry.spatialDescription}` : "",
    entry.parentLocationId ? `所属：${names.locations?.find((item) => item.id === entry.parentLocationId)?.name ?? entry.parentLocationId}` : "",
    entry.features?.length ? `设施与条件：${entry.features.map((feature) => `${feature.name}：${feature.state}`).join("；")}` : "",
    entry.actors?.length ? `当地关联：${entry.actors.map((actor) => [
      actor.organizationName,
      actor.characterIds?.map((id) => names.characters?.find((person) => person.id === id)?.name ?? id).join("、"),
      actor.factionId ? names.factions?.find((force) => force.id === actor.factionId)?.label ?? actor.factionId : "",
      actor.relation
    ].filter(Boolean).join("，")).join("；")}` : ""
  ].filter(Boolean).join("；");
}

export function narrativeLocationDirectory(raw?: NarrativeAssets, names: NarrativeAssetNames = {}): Array<{ id: string; label: string }> {
  const assets = normalizeNarrativeAssets(raw);
  return assets.locations.map((entry) => ({
    id: entry.id,
    label: `${narrativeLocationLabel(entry, { ...names, locations: names.locations ?? assets.locations })}${entry.id === assets.currentLocationId ? "（当前所在）" : ""}`
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

export function parseNarrativeAssetUpdates(raw: unknown, assets?: NarrativeAssets, declarations = false): NarrativeAssetUpdates | undefined {
  if (raw === undefined) return undefined;
  const result = updates.parse(raw);
  return {
    locations: result.locations.map((entry) => {
      const known = assets?.locations.find((item) => item.id === entry.ref);
      if (entry.ref !== "new" && !known) throw new Error("location_reference_invalid");
      if (entry.parentLocationId && !assets?.locations.some((item) => item.id === entry.parentLocationId)) throw new Error("parent_location_reference_invalid");
      if (!known) text.parse(entry.name);
      return entry;
    }),
    abilities: result.abilities.map((entry) => {
      const known = assets?.abilities.find((item) => item.id === entry.ref);
      if (entry.ref !== "new" && !known) throw new Error("ability_reference_invalid");
      if (!known) text.parse(entry.name);
      return entry;
    })
  };
}

/** Writer registration carries identity and position; maintenance owns content. */
export function parseNarrativeAssetDeclarations(raw: unknown, assets: NarrativeAssets): NarrativeAssetUpdates | undefined {
  if (raw === undefined) return undefined;
  const parsed = assetDeclarations.parse(raw);
  return parseNarrativeAssetUpdates({
    locations: parsed.locations.map((entry) => assets.locations.some((record) => record.id === entry.ref)
      ? { ref: entry.ref, ...(entry.current !== undefined ? { current: entry.current } : {}) } : entry),
    abilities: parsed.abilities.map((entry) => assets.abilities.some((record) => record.id === entry.ref) ? { ref: entry.ref } : entry)
  }, assets, true);
}

export function narrativeAssetDeclarationsSchema(): Record<string, unknown> {
  const entries = (kind: string, current = false) => ({ type: "array", items: {
    type: "object", additionalProperties: false, required: ["ref"],
    anyOf: [{ properties: { ref: { const: "new" } }, required: ["name"] }, { properties: { ref: { not: { const: "new" } } } }],
    properties: {
      ref: { type: "string", description: `已有${kind}完整 ID；新对象填 new，由引擎分配正式 ID。` },
      name: { type: "string", minLength: 1, description: "新对象的名称。详细信息由连续性同步从正文提炼。" },
      ...(current ? { current: { type: "boolean", description: "本段结束时实际所在地点。" } } : {})
    }
  } });
  return { type: "object", additionalProperties: false, required: ["locations", "abilities"], properties: {
    locations: entries("地点", true), abilities: { ...entries("本领"), description: NARRATIVE_ABILITY_DEFINITION }
  } };
}

export function narrativeAssetUpdatesSchema(_assets?: NarrativeAssets): Record<string, unknown> {
  const string = { type: "string", description: "省略保持原值；空字符串清除该可选内容。" };
  return {
    type: "object",
    description: "同步登记正文中已经发生的地点与本领变化；对应类型无变化时数组为空。已有对象用 ref 引用，新对象用 new；地点是实际空间。不得登记尚未选择的奖励、计划或他人的能力。",
    additionalProperties: false,
    required: ["locations", "abilities"],
    properties: {
      locations: {
        type: "array", items: {
          type: "object", additionalProperties: false,
          required: ["ref"],
          anyOf: [
            { properties: { ref: { const: "new" } }, required: ["name"] },
            { properties: { ref: { not: { const: "new" } } } }
          ],
          description: "只维护本批正文改变的地点现状；新对象可仅登记名称。仅再次抵达由 assetActivity 记录，同一空间沿用 ID。",
          properties: {
            ref: { type: "string", description: "完整复制本局地点身份目录中的已有地点 ID，包含 location: 前缀；新建地点使用 new。" },
            name: { type: "string", minLength: 1, description: "地点的稳定名称；更正名称仍沿用同一 ID。" },
            pendingDetails: { type: "boolean", description: "仅登记身份或资料尚不足为 true；本批已实际揭示必要资料才提交 false。省略保留。" },
            description: { ...string, description: "地点是什么、用途与稳定背景；不包揽当前局势与到访经历。省略保留，空字符串清除。" },
            spatialDescription: { ...string, description: "地点在哪里、空间布局和通路。省略保留，空字符串清除。" },
            parentLocationId: { ...string, description: "所属的已有地点完整 ID；省略保留，空字符串解除归属。" },
            features: { type: "array", description: "重要设施、资源、障碍的当前状态；整合替换，[] 清除，省略保留。", items: { type: "object", additionalProperties: false, required: ["name", "state"], properties: { name: { type: "string", minLength: 1 }, state: { type: "string", minLength: 1 } } } },
            actors: { type: "array", description: "当前与此地有关的人物、具名组织和势力及其关系；整合替换，[] 清除，省略保留。具体组织用名称，不新造组织 ID。", items: { type: "object", additionalProperties: false, required: ["relation"], properties: { characterIds: { type: "array", items: { type: "string" } }, factionId: { type: "string", description: "已有社会力量类别 ID。" }, organizationName: { type: "string", description: "具体组织名称。" }, relation: { type: "string", minLength: 1, description: "与此地的当前关系，例如驻防、控制、活动。" } } } },
            current: { type: "boolean", description: "本段结束时主角实际所在的地点为 true；结束于新地点时，在该 ref=new 条目填写 true，由引擎分配真实 ID 并更新当前位置。仅提及或曾经路过为 false。" }
          }
        }
      },
      abilities: {
        type: "array", items: {
          type: "object", additionalProperties: false,
          required: ["ref"],
          anyOf: [
            { properties: { ref: { const: "new" } }, required: ["name"] },
            { properties: { ref: { not: { const: "new" } } } }
          ],
          description: `${NARRATIVE_ABILITY_DEFINITION}只填写本批实际揭示或改变的作用与条件；同一技艺进阶或同一宝物变化沿用原 ID，不同对象新建。`,
          properties: {
            ref: { type: "string", description: "完整复制本局本领身份目录中的已有本领 ID，包含 ability: 前缀；新建本领使用 new。" },
            name: { type: "string", minLength: 1, description: "本领的稳定、简短名称；首次登记或确需更正名称时填写，仍沿用同一 ID。" },
            pendingDetails: { type: "boolean", description: "资料尚不足为 true；本批实际揭示必要能力或宝物资料才提交 false。省略保留。" },
            description: { ...string, description: "这项技艺、能力或宝物是什么、能做什么；不编写使用履历。省略保留，空字符串清除。" },
            usage: { ...string, description: "当前使用方式、效果、适用条件与限制，宝物包括当前持有和使用条件；实际揭示或变化时填写，不罗列过去行动。" },
            source: { ...string, description: "获得来历，供档案展示；不追加使用履历。省略保留，空字符串清除。" },
            mastery: { ...string, description: "仅技艺或能力填写当前掌握程度的简短称谓；宝物省略。省略保留，空字符串清除。" }
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
  raw: Record<string, unknown>, assets: NarrativeAssets, directory?: { characterIds: string[]; factionIds: string[] }
): NarrativeAssetUpdates {
  const contract = narrativeContinuityAssetContract(assets);
  for (const field of contract.required) {
    if (!Object.hasOwn(raw, field)) throw new Error(`${field}_required`);
  }
  const parsed = parseNarrativeAssetUpdates({
    locations: raw.locationUpdates,
    abilities: raw.abilityUpdates
  }, assets)!;
  for (const entry of parsed.locations) for (const actor of entry.actors ?? []) {
    if (directory && actor.characterIds?.some((id) => !directory.characterIds.includes(id))) throw new Error("location_character_reference_invalid");
    if (directory && actor.factionId && !directory.factionIds.includes(actor.factionId)) throw new Error("location_faction_reference_invalid");
  }
  return parsed;
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
  when: NarrativeAssetMoment,
  declarations = false
): NarrativeAssetApplication {
  const assets = structuredClone(normalizeNarrativeAssets(previous));
  const applied: NarrativeAssetApplication = { assets, locationIds: [], abilityIds: [] };
  if (!changes) return applied;
  const normalized = parseNarrativeAssetUpdates(changes, assets, declarations)!;
  for (const entry of normalized.locations) {
    const known = assets.locations.find((item) => item.id === entry.ref);
    const record: NarrativeLocation = known ?? { id: `location:${randomUUID()}`, name: text.parse(entry.name), pendingDetails: true, introduced: { ...when }, lastSeen: { ...when } };
    if (entry.name !== undefined) record.name = entry.name;
    for (const key of ["description", "spatialDescription", "parentLocationId"] as const) {
      if (entry[key] !== undefined) record[key] = entry[key] || undefined;
    }
    if (entry.features !== undefined) record.features = structuredClone(entry.features);
    if (entry.actors !== undefined) record.actors = structuredClone(entry.actors);
    if (entry.pendingDetails !== undefined) record.pendingDetails = entry.pendingDetails;
    if (!known) assets.locations.push(record);
    applied.locationIds.push(record.id);
    if (entry.current) assets.currentLocationId = record.id;
  }
  for (const entry of normalized.abilities) {
    const known = assets.abilities.find((item) => item.id === entry.ref);
    const record: NarrativeAbility = known ?? { id: `ability:${randomUUID()}`, name: text.parse(entry.name), pendingDetails: true, introduced: { ...when }, updated: { ...when } };
    let changed = !known;
    for (const key of ["name", "description", "usage", "mastery", "source"] as const) {
      if (entry[key] !== undefined && record[key] !== entry[key]) changed = true;
      if (entry[key] !== undefined) Object.assign(record, { [key]: entry[key] || undefined });
    }
    if (entry.pendingDetails !== undefined) record.pendingDetails = entry.pendingDetails;
    if (changed) record.updated = { ...when };
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

export function formatNarrativeAssets(assets?: NarrativeAssets, names: NarrativeAssetNames = {}): string {
  if (!assets) return "";
  return [
    assets.locations.length ? `地点档案：${assets.locations.map((entry) =>
      `${entry.id}=${narrativeLocationLabel(entry, names)}${entry.id === assets.currentLocationId ? "（当前所在）" : ""}`).join("；")}` : "",
    assets.abilities.length ? `本领档案：${assets.abilities.map((entry) =>
      `${entry.id}=${narrativeAbilityLabel(entry)}`).join("；")}` : ""
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
  state.assets = assets;
  const current = assets.locations.find((entry) => entry.id === assets.currentLocationId);
  if (current) state.scene.place = current.name;
  const committed = {
    locationIds: locations.map((entry) => entry.id),
    abilityIds: abilities.map((entry) => entry.id)
  };
  if ((!locations.length && !abilities.length) || !sourceEventId) return committed;
  const memoryId = `memory:${sourceEventId}`;
  const existing = state.memoryEntries.find((entry) => entry.id === memoryId);
  if (!existing) return committed;
  commitNarrativeMemory(state, {
    id: memoryId,
    age: when.age,
    routeId: links.routeIds?.[0],
    factionIds: links.factionIds ?? [], characterIds: links.characterIds ?? [], factIds: links.factIds ?? [],
    locationIds: committed.locationIds, abilityIds: committed.abilityIds,
    text: existing.text
  });
  return committed;
}
