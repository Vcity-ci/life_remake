import seedrandom from "seedrandom";
import type {
  AgeThreshold,
  AscensionState,
  BackgroundCard,
  DecisionType,
  DifficultyConfig,
  GameplayTuning,
  MilestoneChoice,
  RunState,
  StartRunRequest,
  StatKey,
  Stats,
  TimelineEntry,
  WorldConfig,
  YearEvent
} from "@reroll/shared";
import { createDefaultGameplayTuning } from "@reroll/shared";

interface EngineContext {
  world: WorldConfig;
  difficulty: DifficultyConfig;
  cards: BackgroundCard[];
  tuning: GameplayTuning;
}

type Rng = () => number;
type CoreStatKey = "intelligence" | "charisma" | "family" | "fortune";
const coreStatKeys: CoreStatKey[] = ["intelligence", "charisma", "family", "fortune"];
const allStatKeys: StatKey[] = [...coreStatKeys, "physique"];
const negativeStatLabel: Record<CoreStatKey, string> = {
  intelligence: "智力",
  charisma: "魅力",
  family: "家境",
  fortune: "气运"
};

export interface InternalRunState extends RunState {
  seed: number;
  endAge: number;
  negativeStreaks: Record<CoreStatKey, number>;
  yearsSinceLastMilestone: number;
  tuningSnapshot: GameplayTuning;
}

const defaultAgeThresholds: AgeThreshold[] = [
  { id: "child", label: "幼年", min: 0, max: 12 },
  { id: "youth", label: "青年", min: 13, max: 29 },
  { id: "prime", label: "壮年", min: 30, max: 44 },
  { id: "middle", label: "中年", min: 45, max: 59 },
  { id: "elder", label: "老年", min: 60, max: 120 }
];

function clamp(num: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, num));
}

function cloneStats(stats: Stats): Stats {
  return {
    intelligence: stats.intelligence,
    charisma: stats.charisma,
    family: stats.family,
    fortune: stats.fortune,
    physique: stats.physique
  };
}

function randomInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pickOne<T>(rng: Rng, list: T[]): T {
  return list[Math.floor(rng() * list.length)];
}

function milestoneTriggerRate(stageId: AgeThreshold["id"], tuning: GameplayTuning): number {
  const rate = tuning.milestone.triggerRateByStage[stageId];
  return clamp(rate, 0, 1);
}

function pickMilestoneSeedEvent(rng: Rng, pool: string[]): string {
  if (pool.length === 0) return "你被卷入一场无法回避的关键事件。";
  return pickOne(rng, pool);
}

function resolveAgeThresholds(world: WorldConfig): AgeThreshold[] {
  if (world.ageThresholds && world.ageThresholds.length > 0) {
    return [...world.ageThresholds].sort((a, b) => a.min - b.min);
  }
  return defaultAgeThresholds;
}

function resolveAgeStage(age: number, world: WorldConfig): AgeThreshold {
  const thresholds = resolveAgeThresholds(world);
  const found = thresholds.find((t) => age >= t.min && age <= t.max);
  return found ?? thresholds[thresholds.length - 1];
}

function validateStats(stats: Stats): void {
  const entries = Object.entries(stats) as Array<[StatKey, number]>;
  for (const [, value] of entries) {
    if (value < 0 || value > 10) {
      throw new Error("属性必须在0-10之间");
    }
  }
}

interface StatBinEffect {
  growthBias: number;
  decayBias: number;
  growthBonusChance: number;
  extraDecayChance: number;
}

function resolveStageDeltaCap(stageId: AgeThreshold["id"], tuning: GameplayTuning): number {
  return tuning.stage.deltaCapByStage[stageId];
}

function resolveDeltaBand(absDelta: number, stageCap: number, tuning: GameplayTuning): "light" | "medium" | "heavy" {
  const lightMax = Math.max(1, Math.ceil(stageCap * tuning.stage.lightBandRatio));
  const mediumMax = Math.max(2, Math.ceil(stageCap * tuning.stage.mediumBandRatio));
  if (absDelta <= lightMax) return "light";
  if (absDelta <= mediumMax) return "medium";
  return "heavy";
}

function buildDeltaBinTags(changes: Partial<Record<StatKey, number>>, stageCap: number, tuning: GameplayTuning): string[] {
  const tags: string[] = [];
  let total = 0;
  let positiveCount = 0;
  let negativeCount = 0;
  let maxLoss = 0;

  for (const key of allStatKeys) {
    const delta = changes[key] ?? 0;
    if (delta === 0) {
      tags.push(`delta_${key}_steady`);
      continue;
    }
    const absDelta = Math.abs(delta);
    const band = resolveDeltaBand(absDelta, stageCap, tuning);
    const direction = delta > 0 ? "up" : "down";
    tags.push(`delta_${key}_${direction}_${band}`);
    total += delta;
    if (delta > 0) positiveCount += 1;
    if (delta < 0) {
      negativeCount += 1;
      if (absDelta > maxLoss) maxLoss = absDelta;
    }
  }

  if (positiveCount === 0 && negativeCount === 0) {
    tags.push("delta_overall_flat");
  } else if (positiveCount > 0 && negativeCount > 0) {
    tags.push("delta_overall_mixed");
  } else if (positiveCount > 0) {
    tags.push("delta_overall_positive");
  } else {
    tags.push("delta_overall_negative");
  }

  if (total >= Math.ceil(stageCap * tuning.stage.overallExtremeRatio)) tags.push("delta_overall_surge");
  if (total <= -Math.ceil(stageCap * tuning.stage.overallExtremeRatio)) tags.push("delta_overall_crash");
  if (maxLoss >= Math.ceil(stageCap * tuning.stage.overallExtremeRatio)) tags.push("delta_overall_shock");

  return tags;
}

function classifyEventTone(changes: Partial<Record<StatKey, number>>, stageCap: number, tuning: GameplayTuning): "positive" | "negative" | "mixed" | "flat" | "critical" {
  let total = 0;
  let pos = 0;
  let neg = 0;
  let maxLoss = 0;

  for (const key of allStatKeys) {
    const delta = changes[key] ?? 0;
    total += delta;
    if (delta > 0) pos += 1;
    if (delta < 0) {
      neg += 1;
      maxLoss = Math.max(maxLoss, Math.abs(delta));
    }
  }

  if (pos === 0 && neg === 0) return "flat";
  if (
    maxLoss >= Math.ceil(stageCap * tuning.stage.overallExtremeRatio) ||
    total <= -Math.ceil(stageCap * tuning.stage.overallExtremeRatio)
  ) return "critical";
  if (pos > 0 && neg > 0) return "mixed";
  return total >= 0 ? "positive" : "negative";
}

function worldNegativeGuideTags(worldId: string, tone: "positive" | "negative" | "mixed" | "flat" | "critical", rng: Rng): string[] {
  if (tone !== "negative" && tone !== "critical") return [];
  const poolByWorld: Record<string, string[]> = {
    modern: [
      "guide_workplace_intrigue",
      "guide_public_opinion_backlash",
      "guide_capital_pressure",
      "guide_relationship_betrayal",
      "guide_health_overdraft"
    ],
    ancient: [
      "guide_court_intrigue",
      "guide_faction_purge",
      "guide_clan_suppression",
      "guide_frontier_turmoil",
      "guide_grain_crisis"
    ],
    fantasy: [
      "guide_arcane_backlash",
      "guide_cult_hunt",
      "guide_old_god_whisper",
      "guide_guild_betrayal",
      "guide_contamination_outbreak"
    ]
  };
  const pool = poolByWorld[worldId] ?? ["guide_generic_crisis"];
  const picked = pickOne(rng, pool);
  return tone === "critical"
    ? ["tone_critical_negative", picked, "guide_fatal_pressure"]
    : ["tone_negative", picked];
}

function resolveCoreStatBinEffect(value: number): StatBinEffect {
  if (value <= -21) return { growthBias: -0.22, decayBias: 0.3, growthBonusChance: 0, extraDecayChance: 0.35 };
  if (value <= -11) return { growthBias: -0.14, decayBias: 0.2, growthBonusChance: 0.04, extraDecayChance: 0.26 };
  if (value <= -1) return { growthBias: -0.06, decayBias: 0.12, growthBonusChance: 0.08, extraDecayChance: 0.18 };
  if (value <= 10) return { growthBias: 0.04, decayBias: 0, growthBonusChance: 0.12, extraDecayChance: 0.08 };
  if (value <= 20) return { growthBias: 0.12, decayBias: -0.06, growthBonusChance: 0.18, extraDecayChance: 0.05 };
  return { growthBias: 0.2, decayBias: -0.12, growthBonusChance: 0.24, extraDecayChance: 0.03 };
}

function resolvePhysiqueBinEffect(value: number): StatBinEffect {
  if (value <= 2) return { growthBias: -0.08, decayBias: 0.18, growthBonusChance: 0.02, extraDecayChance: 0.22 };
  if (value <= 10) return { growthBias: 0, decayBias: 0.06, growthBonusChance: 0.08, extraDecayChance: 0.12 };
  if (value <= 20) return { growthBias: 0.08, decayBias: -0.04, growthBonusChance: 0.14, extraDecayChance: 0.08 };
  return { growthBias: 0.14, decayBias: -0.08, growthBonusChance: 0.2, extraDecayChance: 0.05 };
}

function calcBaseGrowth(
  stats: Stats,
  diff: DifficultyConfig,
  rng: Rng,
  tuning: GameplayTuning
): Partial<Record<StatKey, number>> {
  const result: Partial<Record<StatKey, number>> = {};
  for (const key of allStatKeys) {
    const now = stats[key];
    const effect = key === "physique"
      ? resolvePhysiqueBinEffect(now)
      : resolveCoreStatBinEffect(now);
    const growthChance = clamp(
      tuning.growth.baseGrowthChance + diff.growthBias + effect.growthBias,
      tuning.growth.growthChanceClampMin,
      tuning.growth.growthChanceClampMax
    );
    const decayChance = clamp(
      tuning.growth.baseDecayChance + diff.yearlyVolatility * tuning.growth.decayVolatilityFactor + effect.decayBias,
      tuning.growth.decayChanceClampMin,
      tuning.growth.decayChanceClampMax
    );
    const roll = rng();
    if (roll < growthChance) {
      const bonus = rng() < effect.growthBonusChance ? 1 : 0;
      result[key] = 1 + bonus;
    } else if (roll < growthChance + decayChance * tuning.growth.decayBranchFactor) {
      const penalty = rng() < effect.extraDecayChance ? 1 : 0;
      result[key] = -1 - penalty;
    } else {
      result[key] = 0;
    }
  }
  return result;
}

function clampYearlyChangesByStage(
  changes: Partial<Record<StatKey, number>>,
  stageCap: number
): Partial<Record<StatKey, number>> {
  const next: Partial<Record<StatKey, number>> = {};
  for (const key of allStatKeys) {
    const delta = changes[key] ?? 0;
    next[key] = clamp(delta, -stageCap, stageCap);
  }
  return next;
}

function calcSpecialEventChanges(
  _stats: Stats,
  difficulty: DifficultyConfig,
  rng: Rng,
  tuning: GameplayTuning
): Partial<Record<StatKey, number>> {
  const focus = pickOne(rng, allStatKeys);
  const mirror = pickOne(rng, allStatKeys.filter((k) => k !== focus));
  const positive = rng() < tuning.growth.specialPositiveBaseChance + difficulty.growthBias * tuning.growth.specialPositiveGrowthBiasFactor;

  if (positive) {
    return {
      [focus]: 2,
      [mirror]: 1
    };
  }
  return {
    [focus]: -2,
    [mirror]: -1
  };
}

function applyChanges(stats: Stats, changes: Partial<Record<StatKey, number>>): Stats {
  const next = cloneStats(stats);
  for (const key of coreStatKeys) {
    const delta = changes[key] ?? 0;
    next[key] = clamp(next[key] + delta, -30, 30);
  }
  next.physique = clamp(next.physique + (changes.physique ?? 0), 0, 30);
  return next;
}

function generateMilestoneChoice(age: number, seedEvent: string, tuning: GameplayTuning): MilestoneChoice {
  return {
    age,
    background: seedEvent.trim() || "命运的岔路在你面前展开。",
    options: [
      {
        id: "safe",
        label: "稳健",
        risk: tuning.decision.profiles.safe.risk,
        reward: tuning.decision.profiles.safe.reward,
        description: "优先保底，收益稳定但上限偏低。"
      },
      {
        id: "balanced",
        label: "适中",
        risk: tuning.decision.profiles.balanced.risk,
        reward: tuning.decision.profiles.balanced.reward,
        description: "平衡风险与成长，容易获得中等收益。"
      },
      {
        id: "risky",
        label: "冒险",
        risk: tuning.decision.profiles.risky.risk,
        reward: tuning.decision.profiles.risky.reward,
        description: "高风险高收益，失败惩罚也更显著。"
      }
    ]
  };
}

function applyDecision(
  stats: Stats,
  decision: DecisionType,
  difficulty: DifficultyConfig,
  rng: Rng,
  tuning: GameplayTuning
): { statChanges: Partial<Record<StatKey, number>>; deathRollBonus: number } {
  const primary = pickOne(rng, allStatKeys);
  const secondary = pickOne(rng, allStatKeys.filter((k) => k !== primary));

  const setup = tuning.decision.profiles[decision];

  const successRate = clamp(
    setup.successRate - difficulty.yearlyVolatility * tuning.decision.successRateVolatilityFactor,
    tuning.decision.successRateClampMin,
    tuning.decision.successRateClampMax
  );
  const success = rng() < successRate;
  const baseGain = Math.round(setup.gain * difficulty.riskRewardMultiplier);
  const baseLoss = Math.round(setup.loss * difficulty.failurePenaltyMultiplier);

  if (success) {
    return {
      statChanges: {
      [primary]: clamp(baseGain, tuning.decision.gainClampMin, tuning.decision.gainClampMax),
      [secondary]: tuning.decision.secondarySuccessDelta
      },
      deathRollBonus: setup.deathBonus
    };
  }

  return {
    statChanges: {
    [primary]: clamp(baseLoss, tuning.decision.lossClampMin, tuning.decision.lossClampMax),
    [secondary]: tuning.decision.secondaryFailureDelta
    },
    deathRollBonus: setup.deathBonus
  };
}

function buildEventTitle(world: WorldConfig, age: number, rng: Rng, special: boolean, tuning: GameplayTuning): string {
  const topic = pickOne(rng, world.yearlyEventHints);
  const blankYear = rng() < tuning.pacing.blankYearChance;
  if (blankYear) {
    return `${age}岁·平年·${topic}`;
  }
  if (special) {
    return `${age}岁·异动·${topic}`;
  }
  return `${age}岁·${topic}`;
}

function summarizeStatDelta(changes: Partial<Record<StatKey, number>>): string {
  const mapping: Record<StatKey, string> = {
    intelligence: "智力",
    charisma: "魅力",
    family: "家境",
    fortune: "气运",
    physique: "体魄"
  };
  const parts: string[] = [];
  for (const key of Object.keys(mapping) as StatKey[]) {
    const delta = changes[key] ?? 0;
    if (delta > 0) parts.push(`${mapping[key]}+${delta}`);
    if (delta < 0) parts.push(`${mapping[key]}${delta}`);
  }
  return parts.length ? parts.join("，") : "平稳无明显变化";
}

function computeFame(stats: Stats): number {
  return computeFameWithTuning(stats, createDefaultGameplayTuning());
}

function computeFameWithTuning(stats: Stats, tuning: GameplayTuning): number {
  const weight = tuning.fame;
  const denominator =
    weight.intelligenceWeight +
    weight.charismaWeight +
    weight.familyWeight +
    weight.fortuneWeight +
    weight.physiqueWeight;
  if (denominator <= 0) {
    return weight.min;
  }
  const weighted =
    stats.intelligence * weight.intelligenceWeight +
    stats.charisma * weight.charismaWeight +
    stats.family * weight.familyWeight +
    stats.fortune * weight.fortuneWeight +
    stats.physique * weight.physiqueWeight;
  const normalized = weighted / denominator;
  const fame = (normalized / weight.maxStatValue) * (weight.max - weight.min) + weight.min;
  return Math.max(weight.min, Math.min(weight.max, Number(fame.toFixed(1))));
}

function updateNegativeStreaks(run: InternalRunState): void {
  if (run.age < run.tuningSnapshot.death.minAge) {
    for (const key of coreStatKeys) {
      run.negativeStreaks[key] = 0;
    }
    return;
  }
  for (const key of coreStatKeys) {
    run.negativeStreaks[key] = run.stats[key] < 0 ? run.negativeStreaks[key] + 1 : 0;
  }
}

function calcDeathRisk(
  run: InternalRunState,
  _world: WorldConfig,
  extraBonus = 0
): { risk: number; cause?: string } {
  const deathTuning = run.tuningSnapshot.death;
  if (run.age < deathTuning.minAge) {
    return { risk: 0 };
  }

  const lowPhysique = run.stats.physique < deathTuning.lowPhysiqueThreshold;
  const physiqueRisk = lowPhysique
    ? clamp(
      deathTuning.physiqueBaseRisk +
      ((deathTuning.lowPhysiqueThreshold - run.stats.physique) / deathTuning.lowPhysiqueThreshold) * deathTuning.physiqueMissingRiskFactor,
      deathTuning.physiqueRiskClampMin,
      deathTuning.physiqueRiskClampMax
    )
    : 0;

  let longNegativeRisk = 0;
  let longNegativeCause: string | undefined;
  for (const key of coreStatKeys) {
    const streak = run.negativeStreaks[key];
    if (run.stats[key] >= 0 || streak < deathTuning.negativeStreakTrigger) continue;
    const valueSeverity = clamp(Math.abs(run.stats[key]) / 30, 0, 1);
    const streakSeverity = clamp((streak - deathTuning.negativeStreakTrigger + 1) / deathTuning.longNegativeStreakDivisor, 0, 1);
    const risk = clamp(
      deathTuning.longNegativeBaseRisk +
      valueSeverity * deathTuning.longNegativeValueFactor +
      streakSeverity * deathTuning.longNegativeStreakFactor,
      deathTuning.longNegativeRiskClampMin,
      deathTuning.longNegativeRiskClampMax
    );
    if (risk > longNegativeRisk) {
      longNegativeRisk = risk;
      longNegativeCause = `${negativeStatLabel[key]}长期低迷反噬`;
    }
  }

  const hasTrigger = lowPhysique || longNegativeRisk > 0;
  if (!hasTrigger) return { risk: 0 };

  const cause = physiqueRisk >= longNegativeRisk ? "体魄衰竭" : longNegativeCause;
  const risk = clamp(
    Math.max(physiqueRisk, longNegativeRisk) + extraBonus,
    deathTuning.finalRiskClampMin,
    deathTuning.finalRiskClampMax
  );
  return { risk, cause };
}

function checkAscension(run: InternalRunState): AscensionState {
  const threshold = run.tuningSnapshot.ascension.deterministicStatThreshold;
  const byStat: Array<{ key: keyof Stats; title: string; desc: string; type: AscensionState["type"] }> = [
    { key: "intelligence", title: "智识飞升", desc: "你的思维突破了凡人的认知边界。", type: "eternal_youth" },
    { key: "charisma", title: "众望飞升", desc: "你的意志可聚拢时代人心。", type: "immortality" },
    { key: "fortune", title: "命运飞升", desc: "你与命运的偏转达成同调。", type: "rejuvenation" },
    { key: "physique", title: "体魄飞升", desc: "你的躯体抵达超凡阈值。", type: "immortality" }
  ];
  for (const item of byStat) {
    if (run.stats[item.key] >= threshold) {
      return {
        unlocked: true,
        type: item.type,
        title: item.title,
        description: item.desc,
        unlockedAge: run.age
      };
    }
  }
  return run.ascension;
}

function maybeUnlockAscension(run: InternalRunState, rng: Rng): AscensionState {
  if (run.ascension.unlocked) return run.ascension;
  const deterministic = checkAscension(run);
  if (deterministic.unlocked) return deterministic;

  const ascensionTuning = run.tuningSnapshot.ascension;
  const stats = run.stats;
  const highThreshold = Math.min(ascensionTuning.fortuneThresholdA, ascensionTuning.intelligenceThresholdB);
  const highStats = [stats.intelligence, stats.charisma, stats.family, stats.fortune].filter((v) => v >= highThreshold).length;
  const legendaryCount = run.cards.filter((c) => c.rarity === "legendary").length;
  const ascensionRoll = rng();

  if (
    highStats >= ascensionTuning.highStatsThresholdA &&
    stats.fortune >= ascensionTuning.fortuneThresholdA &&
    ascensionRoll < ascensionTuning.chanceA
  ) {
    return {
      unlocked: true,
      type: "immortality",
      title: "长生不老",
      description: "你突破了寿限束缚，生命节律发生根本变化。",
      unlockedAge: run.age
    };
  }
  if (
    legendaryCount >= ascensionTuning.legendaryCountThresholdB &&
    stats.intelligence >= ascensionTuning.intelligenceThresholdB &&
    ascensionRoll < ascensionTuning.chanceB
  ) {
    return {
      unlocked: true,
      type: "rejuvenation",
      title: "返老还童",
      description: "你的生命状态被重塑，躯体回归巅峰阶段。",
      unlockedAge: run.age
    };
  }
  if (highStats >= ascensionTuning.highStatsThresholdC && ascensionRoll < ascensionTuning.chanceC) {
    return {
      unlocked: true,
      type: "eternal_youth",
      title: "青春永驻",
      description: "岁月不再在你身上留下明显痕迹。",
      unlockedAge: run.age
    };
  }

  return run.ascension;
}

function calcEnding(run: InternalRunState): string {
  if (run.outcome === "dead") {
    return `你在${run.age}岁因${run.deathCause ?? "意外"}离世。最终名望：${run.fame}。`;
  }
  const endingTuning = run.tuningSnapshot.ending;
  const { intelligence, charisma, family, fortune } = run.stats;
  const score = intelligence * 1.1 + charisma + family * 0.95 + fortune * 1.2;

  if (run.ascension.unlocked) {
    return `你触发了“${run.ascension.title}”，在人世规则之外延展了命运。`;
  }
  if (score >= endingTuning.greatScore) return "你的人生在多个领域达到了高峰，留下了跨时代的影响力。";
  if (score >= endingTuning.goodScore) return "你拥有稳固而体面的结局，在时代中留下了清晰的足迹。";
  if (score >= endingTuning.normalScore) return "你的人生起伏并存，虽未登顶，但也活出了自己的厚度。";
  return "你的人生历经坎坷，最终以平凡甚至艰难收场，但故事依然完整。";
}

function toTimelineEntry(event: YearEvent, stage: AgeThreshold): TimelineEntry {
  const titlePrefix = `${event.age}岁`;
  const normalizedTitle = event.title.startsWith(titlePrefix)
    ? event.title.slice(titlePrefix.length).replace(/^·/, "").trim()
    : event.title;
  return {
    age: event.age,
    ageStage: stage,
    title: normalizedTitle,
    narrative: event.summary,
    tags: event.tags,
    statChanges: event.statChanges
  };
}

export function createRun(ctx: EngineContext, req: StartRunRequest): InternalRunState {
  validateStats(req.stats);
  if (req.talentPointTotal < ctx.tuning.bootstrap.talentPointMin || req.talentPointTotal > ctx.tuning.bootstrap.talentPointMax) {
    throw new Error("天赋点超出当前配置允许范围");
  }
  if (
    req.selectedCardIds.length < ctx.tuning.bootstrap.selectedCardMin ||
    req.selectedCardIds.length > ctx.tuning.bootstrap.selectedCardMax
  ) {
    throw new Error("选卡数量超出当前配置允许范围");
  }
  const allocated =
    req.stats.intelligence + req.stats.charisma + req.stats.family + req.stats.fortune + req.stats.physique;
  if (allocated !== req.talentPointTotal) {
    throw new Error("属性分配总和必须等于本局可用天赋点");
  }

  const seed = Date.now() + Math.floor(Math.random() * 100000);
  const rng = seedrandom(String(seed));

  const selected = ctx.cards.filter((c) => req.selectedCardIds.includes(c.id));
  let stats = cloneStats(req.stats);
  for (const card of selected) {
    stats = applyChanges(stats, card.modifiers);
  }

  const endAge = randomInt(rng, ctx.world.endAgeRange.min, ctx.world.endAgeRange.max);

  return {
    runId: `run_${seed}`,
    worldId: ctx.world.id,
    difficultyId: ctx.difficulty.id,
    age: 0,
    ageStage: resolveAgeStage(0, ctx.world),
    personaPrompt: req.personaPrompt,
    stats,
    cards: selected,
    history: [],
    timelineChunk: [],
    ended: false,
    ascension: { unlocked: false },
    fame: computeFameWithTuning(stats, ctx.tuning),
    outcome: "ongoing",
    negativeStreaks: {
      intelligence: 0,
      charisma: 0,
      family: 0,
      fortune: 0
    },
    yearsSinceLastMilestone: 0,
    tuningSnapshot: ctx.tuning,
    seed,
    endAge
  };
}

export function autoAdvanceToCheckpoint(
  run: InternalRunState,
  world: WorldConfig,
  difficulty: DifficultyConfig,
  options?: { milestoneEventPool?: string[] }
): { updated: InternalRunState; fromAge: number; toAge: number; chunk: YearEvent[] } {
  if (run.ended || run.nextMilestoneChoice) {
    return { updated: run, fromAge: run.age, toAge: run.age, chunk: [] };
  }

  const fromAge = run.age;
  const chunk: YearEvent[] = [];
  const milestoneEventPool = options?.milestoneEventPool ?? [];
  const tuning = run.tuningSnapshot ?? createDefaultGameplayTuning();

  const MAX_YEARS_PER_CHUNK = tuning.pacing.maxYearsPerChunk;
  while (!run.ended && !run.nextMilestoneChoice) {
    run.age += 1;
    const rng = seedrandom(`${run.seed}:${run.age}:${run.history.length}`);
    const currentStage = resolveAgeStage(run.age, world);
    const stageCap = resolveStageDeltaCap(currentStage.id, tuning);

    const special = rng() < tuning.pacing.specialYearChance;
    const rawChanges = special
      ? calcSpecialEventChanges(run.stats, difficulty, rng, tuning)
      : calcBaseGrowth(run.stats, difficulty, rng, tuning);
    const changes = clampYearlyChangesByStage(rawChanges, stageCap);
    const tone = classifyEventTone(changes, stageCap, tuning);
    const deltaTags = buildDeltaBinTags(changes, stageCap, tuning);
    const worldGuides = worldNegativeGuideTags(world.id, tone, rng);

    run.stats = applyChanges(run.stats, changes);
    run.ageStage = resolveAgeStage(run.age, world);
    run.fame = computeFameWithTuning(run.stats, tuning);
    updateNegativeStreaks(run);

    const yearlyEvent: YearEvent = {
      age: run.age,
      title: buildEventTitle(world, run.age, rng, special, tuning),
      summary: special
        ? `这一年出现了超出常态的突发事件：${summarizeStatDelta(changes)}。`
        : `这一年里你经历了许多变化：${summarizeStatDelta(changes)}。`,
      statChanges: changes,
      tags: [
        "yearly",
        run.ageStage.id,
        special ? "special" : "normal",
        `stage_cap_${stageCap}`,
        `tone_${tone}`,
        ...deltaTags,
        ...worldGuides
      ]
    };

    run.history.push(yearlyEvent);
    chunk.push(yearlyEvent);
    run.ascension = maybeUnlockAscension(run, rng);

    const deathCheck = calcDeathRisk(run, world, 0);
    if (deathCheck.risk > 0 && rng() < deathCheck.risk) {
      run.ended = true;
      run.outcome = "dead";
      run.deathCause = deathCheck.cause ?? "意外灾祸";
      run.endingSummary = calcEnding(run);
      break;
    }

    if (run.ascension.unlocked) {
      run.ended = true;
      run.outcome = "ascended";
      run.endingSummary = calcEnding(run);
      break;
    }

    const yearsWithoutMilestone = run.yearsSinceLastMilestone + 1;
    const milestoneEligible = run.age >= tuning.milestone.minEligibleAge;
    const forceMilestone = milestoneEligible && yearsWithoutMilestone >= tuning.milestone.guaranteeYears;
    const milestoneByChance = milestoneEligible && rng() < milestoneTriggerRate(run.ageStage.id, tuning);
    if (forceMilestone || milestoneByChance) {
      const seedEvent = pickMilestoneSeedEvent(rng, milestoneEventPool);
      run.nextMilestoneChoice = generateMilestoneChoice(run.age, seedEvent, tuning);
      run.yearsSinceLastMilestone = 0;
      break;
    }
    run.yearsSinceLastMilestone = yearsWithoutMilestone;

    if (chunk.length >= MAX_YEARS_PER_CHUNK) {
      break;
    }

    if (run.age >= run.endAge) {
      run.ended = true;
      run.endingSummary = calcEnding(run);
      break;
    }
  }

  return { updated: run, fromAge, toAge: run.age, chunk };
}

export function applyMilestoneDecisionAndAdvance(
  run: InternalRunState,
  world: WorldConfig,
  difficulty: DifficultyConfig,
  decision: DecisionType,
  options?: { milestoneEventPool?: string[] }
): { updated: InternalRunState; fromAge: number; toAge: number; chunk: YearEvent[]; decisionEvent: YearEvent } {
  if (!run.nextMilestoneChoice) {
    throw new Error("当前没有可用的关键抉择");
  }

  const tuning = run.tuningSnapshot ?? createDefaultGameplayTuning();
  const rng = seedrandom(`${run.seed}:decision:${run.age}:${run.history.length}`);
  const decisionResult = applyDecision(run.stats, decision, difficulty, rng, tuning);
  const stageCap = resolveStageDeltaCap(run.ageStage.id, tuning);
  const decisionChanges = clampYearlyChangesByStage(decisionResult.statChanges, stageCap);
  const tone = classifyEventTone(decisionChanges, stageCap, tuning);
  const deltaTags = buildDeltaBinTags(decisionChanges, stageCap, tuning);
  const worldGuides = worldNegativeGuideTags(world.id, tone, rng);
  run.stats = applyChanges(run.stats, decisionChanges);
  run.fame = computeFameWithTuning(run.stats, tuning);
  updateNegativeStreaks(run);

  const decisionEvent: YearEvent = {
    age: run.age,
    title: `${run.age}岁·关键抉择`,
    summary: `你选择了${decision === "safe" ? "稳健" : decision === "balanced" ? "适中" : "冒险"}路线，结果：${summarizeStatDelta(decisionChanges)}。`,
    statChanges: decisionChanges,
    tags: [
      "milestone",
      decision,
      `stage_cap_${stageCap}`,
      `tone_${tone}`,
      ...deltaTags,
      ...worldGuides
    ]
  };
  run.history.push(decisionEvent);
  run.nextMilestoneChoice = undefined;

  const deathCheck = calcDeathRisk(run, world, decisionResult.deathRollBonus);
  if (deathCheck.risk > 0 && rng() < deathCheck.risk) {
    run.ended = true;
    run.outcome = "dead";
    run.deathCause = deathCheck.cause ?? (decision === "risky" ? "冒险失败" : "决策反噬");
    run.endingSummary = calcEnding(run);
    return {
      updated: run,
      fromAge: decisionEvent.age,
      toAge: run.age,
      chunk: [decisionEvent],
      decisionEvent
    };
  }

  run.ascension = maybeUnlockAscension(run, rng);
  if (run.ascension.unlocked) {
    run.ended = true;
    run.outcome = "ascended";
    run.endingSummary = calcEnding(run);
    return {
      updated: run,
      fromAge: decisionEvent.age,
      toAge: run.age,
      chunk: [decisionEvent],
      decisionEvent
    };
  }

  const advanced = autoAdvanceToCheckpoint(run, world, difficulty, options);
  return {
    updated: advanced.updated,
    fromAge: decisionEvent.age,
    toAge: advanced.toAge,
    chunk: [decisionEvent, ...advanced.chunk],
    decisionEvent
  };
}

export function toClientRun(run: InternalRunState): RunState {
  const {
    seed: _seed,
    endAge: _endAge,
    negativeStreaks: _negativeStreaks,
    yearsSinceLastMilestone: _yearsSinceLastMilestone,
    tuningSnapshot: _tuningSnapshot,
    ...clientRun
  } = run;
  return clientRun;
}

export function attachTimelineChunk(run: InternalRunState, world: WorldConfig, chunk: YearEvent[]): InternalRunState {
  const mapped = chunk.map((event) => toTimelineEntry(event, resolveAgeStage(event.age, world)));
  run.timelineChunk = mapped.filter((item) => item.narrative.trim().length > 0);
  return run;
}
