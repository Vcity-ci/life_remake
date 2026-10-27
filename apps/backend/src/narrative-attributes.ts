import type { NarrativeAttributeEffect, NarrativeAttributePolicy, StatKey } from "@reroll/shared";

export interface NarrativeValidationIssue {
  rule: string;
  path: string;
  expected?: unknown;
  received?: unknown;
}

export type AttributeValidation =
  | { ok: true; effects: NarrativeAttributeEffect[] }
  | { ok: false; issue: NarrativeValidationIssue };

const statKeys: StatKey[] = ["intelligence", "charisma", "family", "fortune", "physique"];
const bands = ["light", "medium", "heavy"] as const;
const directions = ["up", "down"] as const;
const diagnosticValue = (value: unknown): unknown => typeof value === "string"
  ? value.slice(0, 32) : value === null ? "null" : typeof value;

export function validateNarrativeEffects(raw: unknown, policy: NarrativeAttributePolicy): AttributeValidation {
  const fail = (rule: string, path: string, expected?: unknown, received?: unknown): AttributeValidation =>
    ({ ok: false, issue: { rule, path, expected, received } });
  if (!Array.isArray(raw)) return fail("array_required", "effects", "array", diagnosticValue(raw));
  if (raw.length < policy.minEffects || raw.length > policy.maxEffects) {
    return fail("effect_count", "effects", { min: policy.minEffects, max: policy.maxEffects }, raw.length);
  }
  const effects: NarrativeAttributeEffect[] = [];
  const used = new Set<StatKey>();
  for (const [index, row] of raw.entries()) {
    const path = `effects[${index}]`;
    if (!row || typeof row !== "object" || Array.isArray(row)) return fail("object_required", path);
    const stat = row.stat as StatKey;
    const direction = row.direction as NarrativeAttributeEffect["direction"];
    const band = row.band as NarrativeAttributeEffect["band"];
    if (!statKeys.includes(stat) || !policy.allowedStats.includes(stat)) return fail("stat_not_allowed", `${path}.stat`, policy.allowedStats, diagnosticValue(row.stat));
    if (used.has(stat)) return fail("duplicate_stat", `${path}.stat`, "one effect per stat", stat);
    if (!directions.includes(direction) || !policy.allowedDirections.includes(direction)) return fail("direction_not_allowed", `${path}.direction`, policy.allowedDirections, diagnosticValue(row.direction));
    if (!bands.includes(band) || !policy.allowedBands.includes(band)) return fail("band_not_allowed", `${path}.band`, policy.allowedBands, diagnosticValue(row.band));
    if (direction === "down" && policy.forbidNegativeStats?.includes(stat)) return fail("negative_stat_forbidden", path, policy.forbidNegativeStats, { stat, direction, band });
    const maxBand = direction === "down" ? policy.maxNegativeBandByStat?.[stat] : undefined;
    if (maxBand && bands.indexOf(band) > bands.indexOf(maxBand)) return fail("negative_band_exceeded", `${path}.band`, maxBand, band);
    effects.push({ stat, direction, band });
    used.add(stat);
  }
  if (policy.requirePositive && !effects.some((effect) => effect.direction === "up")) return fail("positive_effect_missing", "effects", "at least one up", effects);
  return { ok: true, effects };
}

export function describeNarrativeAttributePolicy(policy: NarrativeAttributePolicy): string {
  return [
    `提交${policy.minEffects}-${policy.maxEffects}项，每个属性只出现一次。`,
    `属性：${policy.allowedStats.join("、")}；方向：${policy.allowedDirections.join("、")}；幅度：${policy.allowedBands.join("、")}。`,
    policy.requirePositive ? "至少一项为正向成长（up）。" : "",
    policy.minEffects === 0 ? "仅运用已有能力、处理事务而未形成新成长或损失时，effects 明确返回 []，不用奖励属性来证明行动有效。" : "",
    policy.positiveMagnitudeByBand ? `正向成长由引擎按幅度换算：${Object.entries(policy.positiveMagnitudeByBand).map(([band, value]) => `${band}=${value}`).join("、")}；按实际成长选择标签，不按篇幅或行动次数奖励。` : "",
    policy.forbidNegativeStats?.length ? `${policy.forbidNegativeStats.join("、")}只采用正向变化。` : "",
    ...Object.entries(policy.maxNegativeBandByStat ?? {}).map(([stat, band]) => `${stat}负向变化最高为${band}档。`)
  ].filter(Boolean).join(" ");
}

export function narrativeEffectsSchema(_policy: NarrativeAttributePolicy): Record<string, unknown> {
  return {
    type: "array", minItems: 0, maxItems: statKeys.length,
    description: "提交本轮实际形成的属性变化标签；本轮允许的数量、属性、方向与幅度由当前任务给出，并由引擎审批。",
    items: {
      type: "object", additionalProperties: false, required: ["stat", "direction", "band"],
      properties: {
        stat: { type: "string", enum: statKeys },
        direction: { type: "string", enum: directions },
        band: { type: "string", enum: bands }
      }
    }
  };
}
