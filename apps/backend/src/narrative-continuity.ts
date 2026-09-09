import type { NarrativeFactResolution, NarrativeMainlineActDefinition, NarrativeFactUpdates, NarrativeRelationshipUpdate, StoryFactRecord } from "@reroll/shared";

export const relationshipStances = ["friendly", "guarded", "hostile", "indebted", "dependent", "competitive"] as const;
const factKinds = ["open_question", "stake", "commitment", "cost", "relationship_change"] as const;

export function normalizeNarrativeHandoffFact(fact: StoryFactRecord): StoryFactRecord {
  if (fact.status !== "open" || fact.kind !== "cost" || !/^act:.+:consequence$/.test(fact.id)) return fact;
  return {
    ...fact, status: "resolved", resolvedAge: fact.lastTouchedAge,
    resolutionSummary: fact.resolutionSummary ?? fact.progressSummary ?? fact.label
  };
}

export function factUpdateContract(factIds: string[]) {
  const mutableIds = factIds.filter((id) => id.startsWith("dynamic:") || /^act:.+:continuation$/.test(id));
  const references = (ids: string[]) => ({ type: "array", items: ids.length ? { type: "string", enum: ids } : { type: "string" }, ...(ids.length ? {} : { maxItems: 0 }) });
  const changes = { type: "array", items: {
    type: "object", additionalProperties: false, required: ["factId", "summary"],
    properties: { factId: { type: "string", ...(mutableIds.length ? { enum: mutableIds } : {}) }, summary: { type: "string" } }
  }, ...(mutableIds.length ? {} : { maxItems: 0 }) };
  return {
    factIds, mutableIds,
    schema: {
      type: "object", additionalProperties: false,
      description: "同步本段实际建立、发展或解决的事实。进展与结果使用已有引用；无变化可省略。世界幕事实的结算由对应幕工具处理。",
      properties: {
        introduce: { type: "array", items: {
          type: "object", additionalProperties: false, required: ["kind", "label"],
          properties: { kind: { type: "string", enum: factKinds }, label: { type: "string" }, priority: { type: "integer", minimum: 1, maximum: 4 } }
        }},
        touchFactIds: references(factIds), resolveFactIds: references(mutableIds),
        progress: changes, resolutions: changes
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

export function parseFactUpdates(raw: unknown, contract: ReturnType<typeof factUpdateContract>): NarrativeFactUpdates | undefined {
  if (raw === undefined) return undefined;
  const source = object(raw);
  const refs = (raw: unknown, allowed: string[]) => Array.from(new Set(rows(raw).map((entry) => {
    const id = text(entry);
    if (!allowed.includes(id)) throw new Error("fact_reference_invalid");
    return id;
  })));
  const summaries = (raw: unknown) => rows(raw).map((entry) => {
    const row = object(entry), factId = text(row.factId);
    if (!contract.mutableIds.includes(factId)) throw new Error("fact_reference_invalid");
    return { factId, summary: text(row.summary) };
  });
  return {
    introduce: rows(source.introduce).map((entry) => {
      const row = object(entry), kind = text(row.kind);
      if (!factKinds.includes(kind as typeof factKinds[number])) throw new Error("fact_kind_invalid");
      if (row.priority !== undefined && (typeof row.priority !== "number" || !Number.isInteger(row.priority) || row.priority < 1 || row.priority > 4)) throw new Error("fact_priority_invalid");
      return { kind: kind as typeof factKinds[number], label: text(row.label), priority: row.priority as number | undefined };
    }),
    touchFactIds: refs(source.touchFactIds, contract.factIds),
    resolveFactIds: refs(source.resolveFactIds, contract.mutableIds),
    progress: summaries(source.progress), resolutions: summaries(source.resolutions)
  };
}

export function relationshipUpdatesSchema(characterIds: string[]) {
  return { type: "array", ...(characterIds.length ? {} : { maxItems: 0 }), items: {
    type: "object", additionalProperties: false, required: ["characterRef", "stance", "summary"],
    properties: {
      characterRef: { type: "string", ...(characterIds.length ? { enum: characterIds } : {}) },
      stance: { type: "string", enum: relationshipStances }, summary: { type: "string" }
    }
  }};
}

export function parseRelationshipUpdates(raw: unknown, characterIds: string[]): NarrativeRelationshipUpdate[] | undefined {
  if (raw === undefined) return undefined;
  return rows(raw).map((entry) => {
    const row = object(entry), characterRef = text(row.characterRef), stance = text(row.stance);
    if (!characterIds.includes(characterRef) || !relationshipStances.includes(stance as typeof relationshipStances[number])) throw new Error("relationship_reference_invalid");
    return { characterRef, stance: stance as typeof relationshipStances[number], summary: text(row.summary) };
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
