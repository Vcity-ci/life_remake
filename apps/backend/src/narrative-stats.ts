import type { NarrativeStatTier, NarrativeStatTierBounds, NarrativeStatTierConfig, NarrativeStatTierPresentation, NarrativeSurvivalStatTier, StatKey, Stats } from "@reroll/shared";

const statKeys: StatKey[] = ["intelligence", "charisma", "family", "fortune", "physique"];

export function normalizeNarrativeStatTierConfig(value: unknown): NarrativeStatTierConfig | undefined {
  const normalizeBounds = (raw: unknown): NarrativeStatTierBounds | undefined => {
    const bounds = raw as NarrativeStatTierBounds | undefined;
    if (!bounds || !Number.isFinite(bounds.lowMax) || !Number.isFinite(bounds.highMin) || bounds.lowMax < 0 || bounds.highMin <= bounds.lowMax) return undefined;
    const result: NarrativeStatTierBounds = { lowMax: Math.trunc(bounds.lowMax), highMin: Math.trunc(bounds.highMin) };
    if (Number.isFinite(bounds.developingMax) && Number.isFinite(bounds.steadyMax) &&
        bounds.developingMax! > result.lowMax && bounds.steadyMax! > bounds.developingMax! && bounds.steadyMax! < result.highMin) {
      result.developingMax = Math.trunc(bounds.developingMax!);
      result.steadyMax = Math.trunc(bounds.steadyMax!);
    }
    return result;
  };
  const raw = value as NarrativeStatTierConfig | undefined;
  const base = normalizeBounds(raw);
  if (!base) return undefined;
  const config: NarrativeStatTierConfig = { ...base };
  for (const stat of statKeys) {
    const bounds = normalizeBounds(raw?.overrides?.[stat]);
    if (bounds) (config.overrides ??= {})[stat] = bounds;
  }
  const survival = normalizeBounds(raw?.survival);
  if (survival) {
    config.survival = { lowMax: survival.lowMax, highMin: survival.highMin };
    for (const stat of statKeys) {
      const bounds = normalizeBounds(raw?.survival?.overrides?.[stat]);
      if (bounds) (config.survival.overrides ??= {})[stat] = { lowMax: bounds.lowMax, highMin: bounds.highMin };
    }
  }
  return config;
}

export function resolveNarrativeStatTierBounds(stat: StatKey, config?: NarrativeStatTierConfig): NarrativeStatTierBounds {
  return { lowMax: config?.lowMax ?? 8, highMin: config?.highMin ?? 22,
    developingMax: config?.developingMax, steadyMax: config?.steadyMax, ...config?.overrides?.[stat] };
}

export function resolveNarrativeSurvivalTierBounds(stat: StatKey, config?: NarrativeStatTierConfig): { lowMax: number; highMin: number } {
  const bounds = config?.survival ?? config;
  return bounds?.overrides?.[stat] ?? { lowMax: bounds?.lowMax ?? 8, highMin: bounds?.highMin ?? 22 };
}

export function resolveNarrativeSurvivalTier(stats: Stats, stat: StatKey, config?: NarrativeStatTierConfig): NarrativeSurvivalStatTier {
  const bounds = resolveNarrativeSurvivalTierBounds(stat, config);
  return stats[stat] <= bounds.lowMax ? "low" : stats[stat] >= bounds.highMin ? "high" : "steady";
}

export function resolveNarrativeStatTiers(stats: Stats, config?: NarrativeStatTierConfig): Record<StatKey, NarrativeStatTier> {
  return Object.fromEntries(statKeys.map((stat) => {
    const bounds = resolveNarrativeStatTierBounds(stat, config);
    const tier: NarrativeStatTier = stats[stat] <= bounds.lowMax ? "low" : stats[stat] >= bounds.highMin ? "high"
      : bounds.developingMax !== undefined && stats[stat] <= bounds.developingMax ? "developing"
      : bounds.steadyMax !== undefined && stats[stat] > bounds.steadyMax ? "advanced" : "steady";
    return [stat, tier];
  })) as Record<StatKey, NarrativeStatTier>;
}

export function resolveNarrativeStatLabels(stats: Stats, config?: NarrativeStatTierConfig, presentation?: NarrativeStatTierPresentation): Record<StatKey, string> {
  const tiers = resolveNarrativeStatTiers(stats, config);
  const defaults: Record<NarrativeStatTier, string> = { low: "积累中", developing: "已有基础", steady: "运用自如", advanced: "颇有造诣", high: "出众" };
  return Object.fromEntries(statKeys.map((stat) => [stat, presentation?.[stat]?.[tiers[stat]] ?? defaults[tiers[stat]]])) as Record<StatKey, string>;
}
