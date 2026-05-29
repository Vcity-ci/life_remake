export type WorldId = string;
export type StatKey = "intelligence" | "charisma" | "family" | "fortune" | "physique";
export type DecisionType = "safe" | "balanced" | "risky";
export type CardRarity = "common" | "rare" | "epic" | "legendary";
export type AgeStageId = "child" | "youth" | "prime" | "middle" | "elder";

export type AgeStageRateMap = Record<AgeStageId, number>;
export type AgeStageIntMap = Record<AgeStageId, number>;

export interface Stats {
  intelligence: number;
  charisma: number;
  family: number;
  fortune: number;
  physique: number;
}

export interface BackgroundCard {
  id: string;
  name: string;
  rarity: CardRarity;
  description: string;
  modifiers: Partial<Record<StatKey, number>>;
  tags: string[];
}

export interface AgeThreshold {
  id: AgeStageId;
  label: string;
  min: number;
  max: number;
}

export interface WorldConfig {
  id: WorldId;
  name: string;
  intro: string;
  stylePrompt: string;
  milestoneAges?: number[];
  endAgeRange: {
    min: number;
    max: number;
  };
  yearlyEventHints: string[];
  ageThresholds?: AgeThreshold[];
}

export interface GameplayTuning {
  bootstrap: {
    talentPointMin: number;
    talentPointMax: number;
    selectedCardMin: number;
    selectedCardMax: number;
  };
  pacing: {
    maxYearsPerChunk: number;
    specialYearChance: number;
    blankYearChance: number;
  };
  milestone: {
    minEligibleAge: number;
    guaranteeYears: number;
    triggerRateByStage: AgeStageRateMap;
  };
  stage: {
    deltaCapByStage: AgeStageIntMap;
    lightBandRatio: number;
    mediumBandRatio: number;
    overallExtremeRatio: number;
  };
  growth: {
    baseGrowthChance: number;
    baseDecayChance: number;
    decayVolatilityFactor: number;
    growthChanceClampMin: number;
    growthChanceClampMax: number;
    decayChanceClampMin: number;
    decayChanceClampMax: number;
    decayBranchFactor: number;
    specialPositiveBaseChance: number;
    specialPositiveGrowthBiasFactor: number;
  };
  decision: {
    profiles: Record<
      DecisionType,
      {
        successRate: number;
        gain: number;
        loss: number;
        deathBonus: number;
        risk: number;
        reward: number;
      }
    >;
    successRateVolatilityFactor: number;
    successRateClampMin: number;
    successRateClampMax: number;
    gainClampMin: number;
    gainClampMax: number;
    lossClampMin: number;
    lossClampMax: number;
    secondarySuccessDelta: number;
    secondaryFailureDelta: number;
  };
  death: {
    minAge: number;
    negativeStreakTrigger: number;
    lowPhysiqueThreshold: number;
    physiqueBaseRisk: number;
    physiqueMissingRiskFactor: number;
    physiqueRiskClampMin: number;
    physiqueRiskClampMax: number;
    longNegativeBaseRisk: number;
    longNegativeValueFactor: number;
    longNegativeStreakDivisor: number;
    longNegativeStreakFactor: number;
    longNegativeRiskClampMin: number;
    longNegativeRiskClampMax: number;
    finalRiskClampMin: number;
    finalRiskClampMax: number;
  };
  ascension: {
    deterministicStatThreshold: number;
    chanceA: number;
    chanceB: number;
    chanceC: number;
    highStatsThresholdA: number;
    highStatsThresholdC: number;
    fortuneThresholdA: number;
    legendaryCountThresholdB: number;
    intelligenceThresholdB: number;
  };
  fame: {
    intelligenceWeight: number;
    charismaWeight: number;
    familyWeight: number;
    fortuneWeight: number;
    physiqueWeight: number;
    maxStatValue: number;
    min: number;
    max: number;
  };
  ending: {
    greatScore: number;
    goodScore: number;
    normalScore: number;
  };
}

export interface StartAllocationConfig {
  talentPointMin: number;
  talentPointMax: number;
  selectedCardMin: number;
  selectedCardMax: number;
}

export function createDefaultGameplayTuning(): GameplayTuning {
  return {
    bootstrap: {
      talentPointMin: 20,
      talentPointMax: 30,
      selectedCardMin: 1,
      selectedCardMax: 3
    },
    pacing: {
      maxYearsPerChunk: 2,
      specialYearChance: 0.18,
      blankYearChance: 0.22
    },
    milestone: {
      minEligibleAge: 5,
      guaranteeYears: 20,
      triggerRateByStage: {
        child: 0.1,
        youth: 0.2,
        prime: 0.3,
        middle: 0.3,
        elder: 0.3
      }
    },
    stage: {
      deltaCapByStage: {
        child: 2,
        youth: 4,
        prime: 6,
        middle: 8,
        elder: 8
      },
      lightBandRatio: 0.34,
      mediumBandRatio: 0.67,
      overallExtremeRatio: 0.75
    },
    growth: {
      baseGrowthChance: 0.28,
      baseDecayChance: 0.15,
      decayVolatilityFactor: 0.85,
      growthChanceClampMin: 0.06,
      growthChanceClampMax: 0.86,
      decayChanceClampMin: 0.05,
      decayChanceClampMax: 0.82,
      decayBranchFactor: 0.6,
      specialPositiveBaseChance: 0.55,
      specialPositiveGrowthBiasFactor: 0.5
    },
    decision: {
      profiles: {
        safe: {
          successRate: 0.86,
          gain: 2,
          loss: -1,
          deathBonus: 0,
          risk: 0.2,
          reward: 0.4
        },
        balanced: {
          successRate: 0.66,
          gain: 4,
          loss: -2,
          deathBonus: 0.05,
          risk: 0.45,
          reward: 0.65
        },
        risky: {
          successRate: 0.48,
          gain: 7,
          loss: -4,
          deathBonus: 0.12,
          risk: 0.75,
          reward: 0.95
        }
      },
      successRateVolatilityFactor: 0.2,
      successRateClampMin: 0.2,
      successRateClampMax: 0.9,
      gainClampMin: 1,
      gainClampMax: 4,
      lossClampMin: -4,
      lossClampMax: -1,
      secondarySuccessDelta: 1,
      secondaryFailureDelta: -1
    },
    death: {
      minAge: 14,
      negativeStreakTrigger: 4,
      lowPhysiqueThreshold: 3,
      physiqueBaseRisk: 0.08,
      physiqueMissingRiskFactor: 0.22,
      physiqueRiskClampMin: 0.08,
      physiqueRiskClampMax: 0.7,
      longNegativeBaseRisk: 0.03,
      longNegativeValueFactor: 0.2,
      longNegativeStreakDivisor: 6,
      longNegativeStreakFactor: 0.16,
      longNegativeRiskClampMin: 0.03,
      longNegativeRiskClampMax: 0.72,
      finalRiskClampMin: 0.01,
      finalRiskClampMax: 0.85
    },
    ascension: {
      deterministicStatThreshold: 30,
      chanceA: 0.06,
      chanceB: 0.05,
      chanceC: 0.04,
      highStatsThresholdA: 2,
      highStatsThresholdC: 3,
      fortuneThresholdA: 9,
      legendaryCountThresholdB: 1,
      intelligenceThresholdB: 9
    },
    fame: {
      intelligenceWeight: 1,
      charismaWeight: 1,
      familyWeight: 0,
      fortuneWeight: 1,
      physiqueWeight: 1,
      maxStatValue: 30,
      min: 0,
      max: 100
    },
    ending: {
      greatScore: 34,
      goodScore: 27,
      normalScore: 20
    }
  };
}

export interface DifficultyConfig {
  id: string;
  name: string;
  yearlyVolatility: number;
  growthBias: number;
  riskRewardMultiplier: number;
  failurePenaltyMultiplier: number;
  description: string;
}

export interface StartRunRequest {
  clientId: string;
  worldId: WorldId;
  difficultyId: string;
  personaPrompt: string;
  stats: Stats;
  talentPointTotal: number;
  selectedCardIds: string[];
}

export interface StepRunRequest {
  runId: string;
  decision?: DecisionType;
}

export interface YearEvent {
  age: number;
  title: string;
  summary: string;
  statChanges: Partial<Record<StatKey, number>>;
  tags: string[];
}

export interface MilestoneChoice {
  age: number;
  background?: string;
  options: Array<{
    id: DecisionType;
    label: string;
    risk: number;
    reward: number;
    description: string;
  }>;
}

export interface AscensionState {
  unlocked: boolean;
  type?: "immortality" | "rejuvenation" | "eternal_youth";
  title?: string;
  description?: string;
  unlockedAge?: number;
}

export interface TimelineEntry {
  age: number;
  ageStage: AgeThreshold;
  title: string;
  narrative: string;
  tags: string[];
  statChanges: Partial<Record<StatKey, number>>;
}

export interface RunState {
  runId: string;
  worldId: WorldId;
  difficultyId: string;
  age: number;
  ageStage: AgeThreshold;
  personaPrompt: string;
  stats: Stats;
  cards: BackgroundCard[];
  history: YearEvent[];
  timelineChunk?: TimelineEntry[];
  nextMilestoneChoice?: MilestoneChoice;
  ended: boolean;
  endingSummary?: string;
  ascension: AscensionState;
  fame: number;
  outcome: "ongoing" | "dead" | "ascended";
  deathCause?: string;
}

export interface StartRunResponse {
  run: RunState;
  timelineChunk: TimelineEntry[];
}

export interface StepRunResponse {
  run: RunState;
  timelineChunk: TimelineEntry[];
}

export interface ProviderConfig {
  provider: "openai-compatible";
  baseUrl: string;
  model: string;
  apiPath: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}

export interface ProviderLimits {
  temperature: { min: number; max: number };
  maxTokens: { min: number; max: number; note: string };
  timeoutMs: { min: number; max: number };
  apiPathOptions: string[];
}

export interface RuntimeConfig {
  runtimeMode: "cloud" | "local";
  cloud: ProviderConfig;
}

export interface AdminConfigPayload {
  runtime: RuntimeConfig;
}

export interface ContentBundle {
  worlds: WorldConfig[];
  cards: BackgroundCard[];
  difficulties: DifficultyConfig[];
  promptPack: Record<string, string>;
  gameplayTuning?: GameplayTuning;
}

export interface GameEnvConfigRequest {
  clientId: string;
  runtimeMode: "cloud" | "local";
  localApiKey?: string;
  localProviderConfig?: ProviderConfig;
}

export interface GameEnvConfigResponse {
  clientId: string;
  runtimeMode: "cloud" | "local";
  hasLocalApiKey: boolean;
  effectiveProvider: ProviderConfig;
  limits: ProviderLimits;
}

export interface AiMilestoneOptions {
  background: string;
  optionOverrides: Array<{
    id: DecisionType;
    label: string;
    description: string;
  }>;
}
