import { z } from "zod";
import type { InternalRunState } from "../engine.js";

const value = z.string().trim().min(1);
const characterStates = ["健在", "负伤", "被俘", "死亡", "离场"] as const;
const locationStates = ["可用", "受威胁", "交战", "受损", "失守", "荒废"] as const;
const relationships = ["家人", "师长", "同伴", "部属", "上级", "盟友", "敌对", "疏远"] as const;
const masteryStates = ["未学", "入门", "熟练", "精通"] as const;
const itemStates = ["他人持有", "本人持有", "已交付", "损坏", "丢失", "已消耗"] as const;
export const eventAssetChangesSchema = z.object({ introductions: z.array(z.object({ roleId: value, name: value.optional() }).strict()), updates: z.array(z.object({
  roleId: value, condition: z.enum([...characterStates, ...locationStates]).optional(), relationship: z.enum(relationships).optional(),
  mastery: z.enum(masteryStates).optional(), itemState: z.enum(itemStates).optional(), current: z.boolean().optional(), retired: z.boolean().optional()
}).strict()) }).strict();
export type EventAssetChanges = z.infer<typeof eventAssetChangesSchema>;
type Batch = NonNullable<InternalRunState["narrative"]["assetBuffer"]>;

export function usesPresetEventAssets(run: InternalRunState): boolean {
  return run.narrative.version === 20 && Boolean(run.storyPackSnapshot?.eventFlow);
}

export function eventAssetCandidates(run: InternalRunState, batch: Batch) {
  const definition = run.storyPackSnapshot!.eventFlow!;
  const roleIds = new Set(definition.originRoles ?? []);
  for (const round of batch.rounds) {
    const group = definition.groups.find((entry) => entry.id === round.flowId);
    for (const id of group?.assetRoles ?? []) roleIds.add(id);
  }
  return definition.roles.filter((role) => roleIds.has(role.id)).map((role) => {
    const id = `event-asset:${role.id}`;
    const record = role.kind === "character" ? run.narrative.dynamicCharacters.find((entry) => entry.id === id)
      : role.kind === "location" ? run.narrative.assets?.locations.find((entry) => entry.id === id)
      : run.narrative.assets?.abilities.find((entry) => entry.id === id);
    return { ...role, registered: Boolean(record), name: record?.name ?? run.narrative.eventFlow?.bindings[role.id] ?? role.name,
      writableFields: role.kind === "character" ? ["condition", "relationship", "retired"]
        : role.kind === "location" ? ["condition", "current", "retired"] : role.kind === "item" ? ["itemState", "retired"] : ["mastery", "retired"],
      currentState: record ? role.kind === "character" ? {
        condition: (record as import("@reroll/shared").NarrativeDynamicCharacter).condition,
        relationship: (record as import("@reroll/shared").NarrativeDynamicCharacter).relationship?.summary, retired: record.retired
      } : role.kind === "location" ? { condition: (record as import("@reroll/shared").NarrativeLocation).features?.find((entry) => entry.id === "condition")?.state,
        current: run.narrative.assets?.currentLocationId === id, retired: record.retired }
        : { [role.kind === "item" ? "itemState" : "mastery"]: (record as import("@reroll/shared").NarrativeAbility).mastery,
          retired: record.retired } : undefined };
  });
}

/** Validation and publication are atomic, including bindings and current location. */
export function applyEventAssetChanges(run: InternalRunState, batch: Batch, raw: unknown): boolean {
  const { introductions, updates } = eventAssetChangesSchema.parse(raw);
  const candidates = eventAssetCandidates(run, batch);
  if (updates.filter((update) => update.current === true).length > 1) throw new Error("event_asset_current_location_ambiguous");
  const introduced = new Set(introductions.map((entry) => entry.roleId));
  if (introduced.size !== introductions.length || new Set(updates.map((entry) => entry.roleId)).size !== updates.length) throw new Error("event_asset_duplicate_operation");
  for (const update of [...introductions, ...updates]) {
    const candidate = candidates.find((entry) => entry.id === update.roleId);
    if (!candidate) throw new Error("event_asset_scope_invalid");
    // Bound names come from the immutable card; prose may use a shortened form.
    // The role ID carries identity, so an alternate supplied name cannot rename it.
    if (!candidate.name && !("name" in update && update.name)) throw new Error("event_asset_name_missing: " + update.roleId);
    if (updates.includes(update as EventAssetChanges["updates"][number]) && !candidate.registered && !introduced.has(update.roleId)) throw new Error("event_asset_not_registered: use introductions for " + update.roleId);
    const permitted = candidate.kind === "character" ? ["condition", "relationship"]
      : candidate.kind === "location" ? ["condition", "current"] : candidate.kind === "item" ? ["itemState"] : ["mastery"];
    if (Object.keys(update).some((key) => !["roleId", "name", "retired", ...permitted].includes(key))) throw new Error("event_asset_field_invalid");
    if ("condition" in update && update.condition && !(candidate.kind === "character" ? characterStates : locationStates).some((state) => state === update.condition)) throw new Error("event_asset_state_invalid");
  }
  const draft = structuredClone(run.narrative);
  const before = JSON.stringify(draft);
  const age = batch.rounds.at(-1)!.age;
  draft.assets ??= { locations: [], abilities: [] };
  const newCurrent = updates.find((update) => update.current === true);
  const finalCurrentId = newCurrent ? `event-asset:${newCurrent.roleId}`
    : updates.some((update) => update.current === false && `event-asset:${update.roleId}` === draft.assets!.currentLocationId) ? undefined : draft.assets.currentLocationId;
  for (const update of [...introductions, ...updates] as Array<EventAssetChanges["updates"][number] & { name?: string }>) {
    const candidate = candidates.find((entry) => entry.id === update.roleId)!;
    const id = `event-asset:${update.roleId}`, name = candidate.name ?? update.name!;
    const assign = (target: object, key: string, next: unknown) => {
      if (next !== undefined && JSON.stringify((target as Record<string, unknown>)[key]) !== JSON.stringify(next)) Object.assign(target, { [key]: next });
    };
    // Existing names are immutable. New ones become the same binding used by future cards.
    draft.eventFlow ??= { actId: draft.actRuntime?.actId ?? "", eventIndex: 0, bindings: {}, completed: [], completedFlows: [] };
    draft.eventFlow.bindings[update.roleId] = name;
    if (candidate.kind === "character") {
      let record = draft.dynamicCharacters.find((entry) => entry.id === id);
      if (!record) { record = { id, name, description: candidate.identity, relatedFactIds: [], relatedRouteIds: [],
        importance: "recurring", status: "active", introducedAge: age, lastSeenAge: age }; draft.dynamicCharacters.push(record); }
      const previous = JSON.stringify(record);
      assign(record, "condition", update.condition);
      if (update.condition !== undefined) record.status = update.condition === "死亡" || update.condition === "离场" ? "gone" : "active";
      if (update.relationship !== undefined && record.relationship?.summary !== update.relationship) record.relationship = {
        summary: update.relationship, relatedFactIds: [], lastChangedAge: age };
      assign(record, "retired", update.retired);
      if (previous !== JSON.stringify(record)) record.lastSeenAge = age;
    } else if (candidate.kind === "location") {
      let record = draft.assets.locations.find((entry) => entry.id === id);
      if (!record) { record = { id, name, description: candidate.identity, introduced: { age }, lastSeen: { age } }; draft.assets.locations.push(record); }
      const previous = JSON.stringify(record);
      if (update.condition !== undefined) record.features = [{ id: "condition", name: "现状", state: update.condition }];
      assign(record, "retired", id === finalCurrentId ? false : update.retired);
      if (update.current === true) draft.assets.currentLocationId = id;
      if (update.current === false && draft.assets.currentLocationId === id) draft.assets.currentLocationId = undefined;
      if (previous !== JSON.stringify(record)) record.lastSeen = { age };
    } else {
      let record = draft.assets.abilities.find((entry) => entry.id === id);
      if (!record) { record = { id, name, description: candidate.identity, introduced: { age }, updated: { age } }; draft.assets.abilities.push(record); }
      const previous = JSON.stringify(record);
      assign(record, "mastery", candidate.kind === "item" ? update.itemState : update.mastery); assign(record, "retired", update.retired);
      if (previous !== JSON.stringify(record)) record.updated = { age };
    }
  }
  const changed = before !== JSON.stringify(draft);
  run.narrative = draft;
  return changed;
}

export const eventAssetTool = () => ({ type: "function", function: {
  name: "sync_event_assets", description: "提交本批实际出现的预设资产现状变化。未出现、未变、不明的对象省略；没有变化时 updates 填 []。",
  parameters: { type: "object", additionalProperties: false, required: ["introductions", "updates"], properties: {
    introductions: { type: "array", description: "本批实际出现、registered 为 false 的预设对象。首次只登记身份，不填写现状档案。", items: {
      type: "object", additionalProperties: false, required: ["roleId"], properties: {
        roleId: { type: "string" }, name: { type: "string", description: "仅候选没有名称时填写实际名称。" }
      }
    } },
    updates: { type: "array", description: "已有对象或本批 introductions 中新登记对象的现状变化。同一对象只提交一次。", items: { type: "object", additionalProperties: false, required: ["roleId"], properties: {
      roleId: { type: "string", description: "当前候选中的预设身份。" },
      condition: { type: "string", enum: [...characterStates, ...locationStates], description: "人物使用健在/负伤/被俘/死亡/离场；地点使用可用/受威胁/交战/受损/失守/荒废。" },
      relationship: { type: "string", enum: relationships, description: "人物与主角的当前关系。" },
      mastery: { type: "string", enum: masteryStates, description: "本领的当前掌握程度。" },
      itemState: { type: "string", enum: itemStates, description: "道具的当前状况。" },
      current: { type: "boolean", description: "地点是否为本批结束时的所在地。" },
      retired: { type: "boolean", description: "对象是否已无持续作用而退出展示。" }
    } } }
  } }
} });
