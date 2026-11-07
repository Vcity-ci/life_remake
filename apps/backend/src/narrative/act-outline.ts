import type { NarrativeActOutline, NarrativeRunState } from "@reroll/shared";
import { z } from "zod";

const actHostingMaterialsSchema = z.object({
  situation: z.string().trim().min(1),
  actors: z.array(z.object({ name: z.string().min(1), identity: z.string().min(1), goal: z.string().min(1), forces: z.string().min(1), relationships: z.string().min(1) }).strict()),
  locations: z.array(z.object({ name: z.string().min(1), conditions: z.string().min(1), resources: z.string().min(1), obstacles: z.string().min(1), connections: z.string().min(1) }).strict()),
  pressures: z.array(z.object({ source: z.string().min(1), condition: z.string().min(1), development: z.string().min(1) }).strict()),
  stakes: z.array(z.string().min(1)),
  flowBindings: z.array(z.object({ roleId: z.string().min(1), name: z.string().min(1) }).strict()).optional(),
  eventFlows: z.object({ openingFlowId: z.string().min(1), availableFlowIds: z.array(z.string().min(1)).min(1) }).strict().optional()
}).strict();

export const actPreparationSchema = actHostingMaterialsSchema.extend({
  worldRuleRefs: z.array(z.string().trim().min(1))
}).strict();

const worldRuleSnapshotsSchema = z.array(z.object({
  id: z.string().min(1), title: z.string().min(1), text: z.string().min(1)
}).strict());

export function narrativeOutlinePurpose(outline: NarrativeActOutline | undefined): "initial" | "execute" {
  return outline ? "execute" : "initial";
}

export function normalizeNarrativeActOutline(value: unknown, actId?: string): NarrativeActOutline | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const raw = value as Record<string, unknown>;
  if (typeof raw.actId !== "string" || !raw.actId.trim() || (actId !== undefined && raw.actId !== actId) ||
      !Number.isInteger(raw.revision) || Number(raw.revision) < 1) return;
  const preparation = actHostingMaterialsSchema.safeParse(Object.fromEntries(["situation", "actors", "locations", "pressures", "stakes", "flowBindings", "eventFlows"].map((key) => [key, raw[key]])));
  if (!preparation.success || ["objective", "closureMeaning"].some((key) => typeof raw[key] !== "string" || !(raw[key] as string).trim())) return;
  const rules = raw.worldRules === undefined ? undefined : worldRuleSnapshotsSchema.safeParse(raw.worldRules);
  if (rules && !rules.success) return;
  return { ...preparation.data, actId: raw.actId, revision: Number(raw.revision),
    ...(rules?.success ? { worldRules: rules.data } : {}),
    objective: raw.objective as string, closureMeaning: raw.closureMeaning as string };
}

/** Only hosting materials are model-authored; IF standards remain the authority. */
export function parseNarrativeActWorldCard(
  value: unknown, actId: string, standards: { objective: string; closureMeaning: string },
  availableRules: NonNullable<NarrativeActOutline["worldRules"]> = []
): NarrativeActOutline {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const materials = actPreparationSchema.safeParse(raw);
  if (!materials.success) throw new Error("narrative_act_outline_invalid:hosting_materials_required");
  const ruleById = new Map(availableRules.map((rule) => [rule.id, rule]));
  const { worldRuleRefs, ...hosting } = materials.data;
  const worldRules = Array.from(new Set(worldRuleRefs)).map((id) => {
    const rule = ruleById.get(id);
    if (!rule) throw new Error("narrative_act_outline_invalid:world_rule_reference_invalid:" + id);
    return { ...rule };
  });
  const card = normalizeNarrativeActOutline({ ...hosting, worldRules, ...standards, actId, revision: 1 }, actId);
  if (!card) throw new Error("narrative_act_outline_invalid:hosting_materials_required");
  return card;
}

export function commitNarrativeActOutline(state: NarrativeRunState, outline: NarrativeActOutline): void {
  if (state.actRuntime?.actId === outline.actId && !state.actRuntime.outline) state.actRuntime.outline = structuredClone(outline);
}

/** Stable, role-specific projection; actual developments belong to history. */
export function formatNarrativeActOutline(outline: NarrativeActOutline | undefined, includeClosure = false): string {
  if (!outline) return "";
  return [outline.worldRules?.length ? "本幕适用的世界规则（幕初原文；此后的实际变化见故事历史）：\n" +
      outline.worldRules.map((rule) => rule.title + "：" + rule.text).join("\n\n") : "",
    "本幕起始局势与主持资料（开幕条件；此后的实际变化见故事历史）：\n" + outline.situation,
    "行动方：" + JSON.stringify(outline.actors), "关键地点：" + JSON.stringify(outline.locations),
    "持续压力：" + JSON.stringify(outline.pressures), "所涉利益：" + JSON.stringify(outline.stakes),
    "本幕发展方向：" + outline.objective,
    includeClosure ? "本幕收束含义：" + outline.closureMeaning : ""].filter(Boolean).join("\n");
}
