import type { NarrativeFactResolution, NarrativeMainlineActDefinition, NarrativeFactUpdates, NarrativeRelationshipUpdate, StoryFactRecord } from "@reroll/shared";

export const relationshipStances = ["friendly", "guarded", "hostile", "indebted", "dependent", "competitive"] as const;
const factKinds = ["open_question", "stake", "commitment", "cost", "relationship_change"] as const;

export function isNarrativeFactModelMutable(id: string): boolean {
  return id.startsWith("dynamic:") || /^act:.+:continuation$/.test(id);
}

export function normalizeNarrativeHandoffFact(fact: StoryFactRecord): StoryFactRecord {
  if (fact.status !== "open" || fact.kind !== "cost" || !/^act:.+:consequence$/.test(fact.id)) return fact;
  return {
    ...fact, status: "resolved", resolvedAge: fact.lastTouchedAge,
    resolutionSummary: fact.resolutionSummary ?? fact.progressSummary ?? fact.label
  };
}

export function factUpdateContract(factIds: string[]) {
  const mutableIds = factIds.filter(isNarrativeFactModelMutable);
  const changes = { type: "array", items: {
    type: "object", additionalProperties: false, required: ["factId", "status", "summary"],
    properties: {
      factId: { type: "string", ...(mutableIds.length ? { enum: mutableIds } : {}) },
      status: { type: "string", enum: ["open", "resolved"], description: "仍有待处理内容为 open；事情已有结果、义务已履行或不再需要处理为 resolved。" },
      summary: { type: "string", description: "这件事情现在的进展或实际结果。" }
    }
  }, ...(mutableIds.length ? {} : { maxItems: 0 }) };
  return {
    factIds, mutableIds,
    schema: {
      type: "object", additionalProperties: false,
      description: "同步本段发生变化的事项；同一件事情复用已有引用更新状态与内容。新的待处理事项和已形成的历史结果分别标记状态。世界幕完成仍由幕工具结算。",
      properties: {
        introduce: { type: "array", items: {
          type: "object", additionalProperties: false, required: ["kind", "label", "status"],
          properties: { kind: { type: "string", enum: factKinds }, label: { type: "string" }, status: { type: "string", enum: ["open", "resolved"] }, priority: { type: "integer", minimum: 1, maximum: 4 } }
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
  // Translate state-and-content operations to the existing engine effects.
  const updates = rows(source.updates).map((entry) => {
    const row = object(entry), factId = text(row.factId), status = text(row.status);
    if (!contract.mutableIds.includes(factId)) throw new Error("fact_reference_invalid");
    if (status !== "open" && status !== "resolved") throw new Error("fact_status_invalid");
    return { factId, status, summary: text(row.summary) };
  });
  return {
    introduce: rows(source.introduce).map((entry) => {
      const row = object(entry), kind = text(row.kind);
      if (!factKinds.includes(kind as typeof factKinds[number])) throw new Error("fact_kind_invalid");
      if (row.priority !== undefined && (typeof row.priority !== "number" || !Number.isInteger(row.priority) || row.priority < 1 || row.priority > 4)) throw new Error("fact_priority_invalid");
      if (row.status !== undefined && row.status !== "open" && row.status !== "resolved") throw new Error("fact_status_invalid");
      return { kind: kind as typeof factKinds[number], label: text(row.label), priority: row.priority as number | undefined, ...(row.status ? { status: row.status as "open" | "resolved" } : {}) };
    }),
    touchFactIds: refs(source.touchFactIds, contract.factIds),
    resolveFactIds: refs(source.resolveFactIds, contract.mutableIds),
    progress: [...summaries(source.progress), ...updates.filter((entry) => entry.status === "open").map(({ factId, summary }) => ({ factId, summary }))],
    resolutions: [...summaries(source.resolutions), ...updates.filter((entry) => entry.status === "resolved").map(({ factId, summary }) => ({ factId, summary }))]
  };
}

export function relationshipUpdatesSchema(characterIds: string[]) {
  return { type: "array", ...(characterIds.length ? {} : { maxItems: 0 }), items: {
    type: "object", additionalProperties: false, required: ["characterRef", "stance", "summary"],
    properties: {
      characterRef: { type: "string", ...(characterIds.length ? { enum: characterIds } : {}) },
      stance: { type: "string", enum: relationshipStances }, summary: { type: "string" },
      status: { type: "string", enum: ["active", "resolved", "gone"], description: "人物仍在场、这段交往已告一段落、或已经离场（包括死亡）；具体处境写入 description。" },
      description: { type: "string", description: "人物当前身份与处境，替换已过时的档案描述。" }
    }
  }};
}

export function parseRelationshipUpdates(raw: unknown, characterIds: string[]): NarrativeRelationshipUpdate[] | undefined {
  if (raw === undefined) return undefined;
  return rows(raw).map((entry) => {
    const row = object(entry), characterRef = text(row.characterRef), stance = text(row.stance);
    if (!characterIds.includes(characterRef) || !relationshipStances.includes(stance as typeof relationshipStances[number])) throw new Error("relationship_reference_invalid");
    if (row.status !== undefined && !["active", "resolved", "gone"].includes(row.status as string)) throw new Error("character_status_invalid");
    return { characterRef, stance: stance as typeof relationshipStances[number], summary: text(row.summary),
      ...(row.status ? { status: row.status as "active" | "resolved" | "gone" } : {}),
      ...(row.description !== undefined ? { description: text(row.description) } : {}) };
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
