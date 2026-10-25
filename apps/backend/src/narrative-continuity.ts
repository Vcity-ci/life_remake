import type { NarrativeEventSource, NarrativeFactResolution, NarrativeMainlineActDefinition, NarrativeFactUpdates, NarrativeRelationshipUpdate, NarrativeRunState, StoryFactRecord } from "@reroll/shared";
import { createHash } from "node:crypto";

/** Allocate new event identities once, using the actual source passage. */
export function prepareNarrativeFactUpdates(runId: string, sourceEventId: string, updates?: NarrativeFactUpdates): NarrativeFactUpdates | undefined {
  if (!updates) return undefined;
  return { ...updates, introduce: updates.introduce.map((fact, index) => ({ ...fact,
    id: fact.id ?? `dynamic:${createHash("sha256").update(`${runId}:${fact.sourceEventId ?? sourceEventId}:${index}:${fact.kind}:${fact.label}`).digest("hex").slice(0, 16)}`
  })) };
}

export const relationshipStances = ["friendly", "guarded", "hostile", "indebted", "dependent", "competitive"] as const;
export class NarrativeContinuityValidationError extends Error {
  constructor(readonly rule: string, readonly path: string) { super(rule); }
}
const factKinds = ["open_question", "stake", "commitment", "cost", "relationship_change", "experience"] as const;

export function isNarrativeFactModelMutable(id: string): boolean {
  return id.startsWith("dynamic:") || id.startsWith("carry:") || /^act:.+:continuation$/.test(id);
}

/** The directory offered for maintenance uses the same ownership rule as the update contract. */
export function narrativeContinuityFacts(facts: StoryFactRecord[], actId?: string): StoryFactRecord[] {
  return facts.filter((fact) => isNarrativeFactModelMutable(fact.id) && fact.status !== "blocked" &&
    (fact.status === "open" || fact.actId === actId));
}

export function normalizeNarrativeHandoffFact(fact: StoryFactRecord): StoryFactRecord {
  if (fact.status !== "open" || fact.kind !== "cost" || !/^act:.+:consequence$/.test(fact.id)) return fact;
  return {
    ...fact, status: "resolved", resolvedAge: fact.lastTouchedAge,
    resolutionSummary: fact.resolutionSummary ?? fact.progressSummary ?? fact.label
  };
}

/** Occurrence ownership never moves; completed acts are not automatically injected again. */
export function narrativeActFacts(state: Pick<NarrativeRunState, "actRuntime" | "actCanon">, facts: StoryFactRecord[], actId = state.actRuntime?.actId): StoryFactRecord[] {
  return facts.filter((fact) => !actId || !fact.actId || fact.actId === actId);
}

export function factUpdateContract(factIds: string[], sources: Array<NarrativeEventSource & { sourceEventId: string }> = [], directory?: {
  characterIds: string[]; locationIds: string[]; abilityIds: string[]; factionIds: string[];
}) {
  const mutableIds = factIds.filter(isNarrativeFactModelMutable);
  const linkProperties = Object.fromEntries(["characterIds", "locationIds", "abilityIds", "factionIds"].map((key) => [key, {
    type: "array", items: { type: "string" }, description: "直接关联对象的本局完整 ID；省略保留，提交数组替换，[] 清除。"
  }]));
  const sourceProperty = { sourceEventId: { type: "string", description: "原样复制正文来源目录中对应的完整 ID，作为这次进展或结果的年龄与幕间依据。" } };
  const changes = { type: "array", items: {
    type: "object", additionalProperties: false, required: ["factId", "status", "summary", "sourceEventId"],
    properties: {
      ...sourceProperty,
      ...linkProperties,
      factId: { type: "string", description: "使用本轮可更新事项中给出的事实 ID。" },
      status: { type: "string", enum: ["stay", "finish"], description: "经历仍在持续为 stay；已经发生并结束为 finish，作为背景结果，不再待办。" },
      summary: { type: "string", minLength: 1, description: "整合后的当前进展或实际结果，替换该事项原有表述，不追加逐年过程。" }
    }
  }};
  return {
    factIds: mutableIds, mutableIds, sources, directory,
    schema: {
      type: "object", additionalProperties: false,
      required: ["introduce", "updates"],
      description: "维护需要独立保留的经历或事件；同一事项复用 ID，持续为 stay，结束为 finish。已结束事件可完善结果，不重新开放。已体现在人物、地点、本领字段中的变化不重复摘录成事件；普通使用、到访不自动建档。无变化填空数组。",
      properties: {
        introduce: { type: "array", items: {
          type: "object", additionalProperties: false, required: ["kind", "label", "status", "sourceEventId"],
          properties: { ...sourceProperty, ...linkProperties, kind: { type: "string", enum: factKinds }, label: { type: "string", minLength: 1 }, status: { type: "string", enum: ["stay", "finish"] }, priority: { type: "integer", minimum: 1, maximum: 4 } }
        }},
        updates: changes
      }
    }
  };
}

const object = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("object_required");
  return raw as Record<string, unknown>;
};
const rows = (raw: unknown): unknown[] => {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error("array_required");
  return raw;
};
const text = (raw: unknown): string => {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("text_required");
  return raw.trim();
};

export function parseFactUpdates(raw: unknown, contract: ReturnType<typeof factUpdateContract>, stored = false): NarrativeFactUpdates | undefined {
  if (raw === undefined) return undefined;
  const source = object(raw);
  const provenance = (row: Record<string, unknown>): NarrativeEventSource => {
    if (stored) return { ...(typeof row.sourceEventId === "string" ? { sourceEventId: row.sourceEventId } : {}), ...(typeof row.age === "number" ? { age: row.age } : {}), ...(typeof row.actId === "string" ? { actId: row.actId } : {}) };
    if (!contract.sources.length) return {};
    const entry = contract.sources.find((entry) => entry.sourceEventId === row.sourceEventId);
    if (!entry) throw new Error("fact_source_invalid");
    return { ...entry };
  };
  const state = (value: unknown): "open" | "resolved" => {
    if (value === "stay" || (stored && value === "open")) return "open";
    if (value === "finish" || (stored && value === "resolved")) return "resolved";
    throw new Error("fact_status_invalid");
  };
  const refs = (raw: unknown, allowed: string[]) => Array.from(new Set(rows(raw).map((entry) => {
    const id = text(entry);
    if (!allowed.includes(id)) throw new Error("fact_reference_invalid");
    return id;
  })));
  const links = (row: Record<string, unknown>) => Object.fromEntries(
    (["characterIds", "locationIds", "abilityIds", "factionIds"] as const).filter((key) => row[key] !== undefined).map((key) => {
      const ids = rows(row[key]).map(text);
      if (contract.directory && ids.some((id) => !contract.directory![key].includes(id))) throw new Error(`${key}_reference_invalid`);
      return [key, Array.from(new Set(ids))];
    })
  );
  const summaries = (raw: unknown) => rows(raw).map((entry) => {
    const row = object(entry), factId = text(row.factId);
    if (!contract.mutableIds.includes(factId)) throw new Error("fact_reference_invalid");
    return { factId, summary: text(row.summary), ...provenance(row), ...links(row) };
  });
  // Translate state-and-content operations to the existing engine effects.
  const updates = rows(source.updates).map((entry) => {
    const row = object(entry), factId = text(row.factId), status = state(row.status);
    if (!contract.mutableIds.includes(factId)) throw new Error("fact_reference_invalid");
    return { factId, status, summary: text(row.summary), ...provenance(row), ...links(row) };
  });
  return {
    introduce: rows(source.introduce).map((entry) => {
      const row = object(entry), kind = text(row.kind);
      if (!factKinds.includes(kind as typeof factKinds[number])) throw new Error("fact_kind_invalid");
      if (row.priority !== undefined && (typeof row.priority !== "number" || !Number.isInteger(row.priority) || row.priority < 1 || row.priority > 4)) throw new Error("fact_priority_invalid");
      return { kind: kind as typeof factKinds[number], label: text(row.label), priority: row.priority as number | undefined, ...(row.status !== undefined ? { status: state(row.status) } : {}), ...provenance(row), ...links(row), ...(typeof row.id === "string" ? { id: row.id } : {}) };
    }),
    touchFactIds: refs(source.touchFactIds, contract.factIds),
    resolveFactIds: refs(source.resolveFactIds, contract.mutableIds),
    progress: [...summaries(source.progress), ...updates.filter((entry) => entry.status === "open").map(({ status, ...entry }) => entry)],
    resolutions: [...summaries(source.resolutions), ...updates.filter((entry) => entry.status === "resolved").map(({ status, ...entry }) => entry)]
  };
}

export function relationshipUpdatesSchema(_characterIds: string[]) {
  return { type: "array", items: {
    type: "object", additionalProperties: false, required: ["characterRef"],
    properties: {
      characterRef: { type: "string", description: "使用本轮可更新人物中给出的角色 ID。" },
      pendingDetails: { type: "boolean", description: "资料不足保留 true；本批实际揭示必要身份与状态后才提交 false，省略保留。" },
      factionId: { type: "string", description: "当前所属阵营变化时填写本轮社会力量 ID；空字符串表示退出原阵营，省略保持最新归属。" },
      stance: { type: "string", enum: relationshipStances, description: "对主角的当前态度，变化时提交；与其他字段独立更新，省略保持最新值。" },
      summary: { type: "string", description: "与主角现在是什么关系，仅写关系状态，不转写交往经过。省略保留，空字符串清除。" },
      role: { type: "string", description: "当前身份或职位。省略保留，空字符串清除。" },
      status: { type: "string", enum: ["active", "resolved", "gone"], description: "人物仍在场、交往告一段落或已离场（包括死亡）。" },
      condition: { type: "string", description: "影响当前行动的个人处境，例如受伤、被扣押、失踪。省略保留，空字符串清除。" },
      description: { type: "string", description: "人物的稳定特征；已知来历只留简要身份信息，不追加经历。省略保留，空字符串清除。" }
    }
  }};
}

export function parseRelationshipUpdates(raw: unknown, characterIds: string[], factionIds?: string[]): NarrativeRelationshipUpdate[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new NarrativeContinuityValidationError("array_required", "");
  return raw.map((entry, index) => {
    const fail = (rule: string, field?: string): never => { throw new NarrativeContinuityValidationError(rule, [index, field].filter((part) => part !== undefined).join(".")); };
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("object_required");
    const row = entry as Record<string, unknown>;
    const fieldText = (field: string, allowEmpty = false): string => {
      const value = row[field];
      return typeof value === "string" && (allowEmpty || value.trim()) ? value.trim() : fail("text_required", field);
    };
    const characterRef = fieldText("characterRef");
    if (!characterIds.includes(characterRef)) fail("relationship_reference_invalid", "characterRef");
    const stance = row.stance === undefined ? undefined : fieldText("stance");
    if (stance !== undefined && !relationshipStances.includes(stance as typeof relationshipStances[number])) fail("relationship_stance_invalid", "stance");
    if (row.status !== undefined && !["active", "resolved", "gone"].includes(row.status as string)) fail("character_status_invalid", "status");
    if (row.pendingDetails !== undefined && typeof row.pendingDetails !== "boolean") fail("boolean_required", "pendingDetails");
    if (row.factionId !== undefined && (typeof row.factionId !== "string" ||
      (row.factionId.trim() && factionIds && !factionIds.includes(row.factionId.trim())))) fail("faction_reference_invalid", "factionId");
    return { characterRef, ...(typeof row.pendingDetails === "boolean" ? { pendingDetails: row.pendingDetails } : {}), ...(stance !== undefined ? { stance: stance as typeof relationshipStances[number] } : {}),
      ...(row.summary !== undefined ? { summary: fieldText("summary", true) } : {}),
      ...(typeof row.factionId === "string" ? { factionId: row.factionId.trim() } : {}),
      ...(row.role !== undefined ? { role: fieldText("role", true) } : {}),
      ...(row.status ? { status: row.status as "active" | "resolved" | "gone" } : {}),
      ...(row.description !== undefined ? { description: fieldText("description", true) } : {}),
      ...(row.condition !== undefined ? { condition: fieldText("condition", true) } : {}) };
  });
}



export function narrativeFactResolutionModes(
  act: NarrativeMainlineActDefinition | undefined,
  scene: { beat: string; factId?: string } | undefined
): NarrativeFactResolution[] | undefined {
  if (!act || scene?.beat !== "climax" || !scene.factId) return undefined;
  return act.resolutionModes?.length
    ? [...act.resolutionModes]
    : ["exposed", "concealed", "compromised", "sacrificed"];
}
