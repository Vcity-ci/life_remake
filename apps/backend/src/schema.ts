import { z } from "zod";
import type { AdminConfigPayload, ContentBundle, ProviderConfig } from "@reroll/shared";
import { providerLimits } from "./constants.js";

const statsSchema = z
  .object({
    intelligence: z.number().int().min(0).max(10),
    charisma: z.number().int().min(0).max(10),
    family: z.number().int().min(0).max(10),
    fortune: z.number().int().min(0).max(10),
    physique: z.number().int().min(0).max(10)
  });

const providerSchema: z.ZodType<ProviderConfig> = z.object({
  provider: z.literal("openai-compatible"),
  baseUrl: z.string().url(),
  model: z
    .string()
    .min(1)
    .refine((value) => /[A-Za-z]/.test(value), "model 需要是有效模型名，不能仅为数字"),
  apiPath: z.enum(["/chat/completions", "/responses"]),
  temperature: z.number().min(providerLimits.temperature.min).max(providerLimits.temperature.max),
  maxTokens: z.number().int().min(providerLimits.maxTokens.min).max(providerLimits.maxTokens.max),
  timeoutMs: z.number().int().min(providerLimits.timeoutMs.min).max(providerLimits.timeoutMs.max)
});

export const adminConfigSchema: z.ZodType<AdminConfigPayload> = z.object({
  runtime: z.object({
    runtimeMode: z.enum(["cloud", "local"]),
    cloud: providerSchema
  })
});

export const gameEnvSchema = z.object({
  clientId: z.string().min(1),
  localApiKey: z.string().optional(),
  localProviderConfig: providerSchema.optional()
});

export const startRunSchema = z.object({
  clientId: z.string().min(1),
  worldId: z.string().min(1),
  difficultyId: z.string().min(1),
  personaPrompt: z.string().min(4).max(500),
  talentPointTotal: z.number().int().min(1).max(200),
  stats: statsSchema,
  selectedCardIds: z.array(z.string()).min(1).max(12)
});

export const stepRunSchema = z.object({
  runId: z.string().min(1),
  decision: z.enum(["safe", "balanced", "risky"]).optional()
});

const ageThresholdSchema = z.object({
  id: z.enum(["child", "youth", "prime", "middle", "elder"]),
  label: z.string().min(1),
  min: z.number().int().min(0).max(140),
  max: z.number().int().min(0).max(160)
});

const worldSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  intro: z.string().min(1),
  stylePrompt: z.string().min(1),
  milestoneAges: z.array(z.number().int().min(1).max(120)).min(1).optional(),
  endAgeRange: z.object({
    min: z.number().int().min(20).max(120),
    max: z.number().int().min(20).max(140)
  }),
  yearlyEventHints: z.array(z.string().min(1)).min(1),
  ageThresholds: z.array(ageThresholdSchema).min(1).optional()
}).superRefine((value, ctx) => {
  if (value.endAgeRange.max < value.endAgeRange.min) {
    ctx.addIssue({
      code: "custom",
      message: "endAgeRange.max 必须 >= min"
    });
  }
  if (value.ageThresholds && value.ageThresholds.length > 0) {
    const sorted = [...value.ageThresholds].sort((a, b) => a.min - b.min);
    for (let i = 0; i < sorted.length; i += 1) {
      if (sorted[i].max < sorted[i].min) {
        ctx.addIssue({ code: "custom", message: `年龄阈值 ${sorted[i].label} max 必须 >= min` });
      }
      if (i > 0 && sorted[i].min > sorted[i - 1].max + 1) {
        ctx.addIssue({ code: "custom", message: "年龄阈值区间存在断档" });
      }
    }
  }
});

const cardSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rarity: z.enum(["common", "rare", "epic", "legendary"]),
  description: z.string().min(1),
  modifiers: z.object({
    intelligence: z.number().int().min(-5).max(5).optional(),
    charisma: z.number().int().min(-5).max(5).optional(),
    family: z.number().int().min(-5).max(5).optional(),
    fortune: z.number().int().min(-5).max(5).optional()
  }),
  tags: z.array(z.string().min(1))
});

const difficultySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  yearlyVolatility: z.number().min(0).max(1),
  growthBias: z.number().min(-0.5).max(0.5),
  riskRewardMultiplier: z.number().min(0.5).max(2),
  failurePenaltyMultiplier: z.number().min(0.5).max(2),
  description: z.string().min(1)
});

const stageRateSchema = z.object({
  child: z.number().min(0).max(1),
  youth: z.number().min(0).max(1),
  prime: z.number().min(0).max(1),
  middle: z.number().min(0).max(1),
  elder: z.number().min(0).max(1)
});

const stageIntSchema = z.object({
  child: z.number().int().min(1).max(30),
  youth: z.number().int().min(1).max(30),
  prime: z.number().int().min(1).max(30),
  middle: z.number().int().min(1).max(30),
  elder: z.number().int().min(1).max(30)
});

const gameplayTuningSchema = z.object({
  bootstrap: z.object({
    talentPointMin: z.number().int().min(1).max(200),
    talentPointMax: z.number().int().min(1).max(200),
    selectedCardMin: z.number().int().min(1).max(12),
    selectedCardMax: z.number().int().min(1).max(12)
  }),
  pacing: z.object({
    maxYearsPerChunk: z.number().int().min(1).max(12),
    specialYearChance: z.number().min(0).max(1),
    blankYearChance: z.number().min(0).max(1)
  }),
  milestone: z.object({
    minEligibleAge: z.number().int().min(0).max(120),
    guaranteeYears: z.number().int().min(1).max(120),
    triggerRateByStage: stageRateSchema
  }),
  stage: z.object({
    deltaCapByStage: stageIntSchema,
    lightBandRatio: z.number().gt(0).lt(1),
    mediumBandRatio: z.number().gt(0).lt(1),
    overallExtremeRatio: z.number().gt(0).lte(1)
  }),
  growth: z.object({
    baseGrowthChance: z.number().min(0).max(1),
    baseDecayChance: z.number().min(0).max(1),
    decayVolatilityFactor: z.number().min(0).max(3),
    growthChanceClampMin: z.number().min(0).max(1),
    growthChanceClampMax: z.number().min(0).max(1),
    decayChanceClampMin: z.number().min(0).max(1),
    decayChanceClampMax: z.number().min(0).max(1),
    decayBranchFactor: z.number().min(0).max(1),
    specialPositiveBaseChance: z.number().min(0).max(1),
    specialPositiveGrowthBiasFactor: z.number().min(0).max(3)
  }),
  decision: z.object({
    profiles: z.object({
      safe: z.object({
        successRate: z.number().min(0).max(1),
        gain: z.number().int().min(1).max(20),
        loss: z.number().int().min(-20).max(-1),
        deathBonus: z.number().min(0).max(1),
        risk: z.number().min(0).max(1),
        reward: z.number().min(0).max(1)
      }),
      balanced: z.object({
        successRate: z.number().min(0).max(1),
        gain: z.number().int().min(1).max(20),
        loss: z.number().int().min(-20).max(-1),
        deathBonus: z.number().min(0).max(1),
        risk: z.number().min(0).max(1),
        reward: z.number().min(0).max(1)
      }),
      risky: z.object({
        successRate: z.number().min(0).max(1),
        gain: z.number().int().min(1).max(20),
        loss: z.number().int().min(-20).max(-1),
        deathBonus: z.number().min(0).max(1),
        risk: z.number().min(0).max(1),
        reward: z.number().min(0).max(1)
      })
    }),
    successRateVolatilityFactor: z.number().min(0).max(2),
    successRateClampMin: z.number().min(0).max(1),
    successRateClampMax: z.number().min(0).max(1),
    gainClampMin: z.number().int().min(1).max(30),
    gainClampMax: z.number().int().min(1).max(30),
    lossClampMin: z.number().int().min(-30).max(-1),
    lossClampMax: z.number().int().min(-30).max(-1),
    secondarySuccessDelta: z.number().int().min(-5).max(10),
    secondaryFailureDelta: z.number().int().min(-10).max(5)
  }),
  death: z.object({
    minAge: z.number().int().min(0).max(120),
    negativeStreakTrigger: z.number().int().min(1).max(60),
    lowPhysiqueThreshold: z.number().int().min(1).max(30),
    physiqueBaseRisk: z.number().min(0).max(1),
    physiqueMissingRiskFactor: z.number().min(0).max(1),
    physiqueRiskClampMin: z.number().min(0).max(1),
    physiqueRiskClampMax: z.number().min(0).max(1),
    longNegativeBaseRisk: z.number().min(0).max(1),
    longNegativeValueFactor: z.number().min(0).max(1),
    longNegativeStreakDivisor: z.number().positive().max(100),
    longNegativeStreakFactor: z.number().min(0).max(1),
    longNegativeRiskClampMin: z.number().min(0).max(1),
    longNegativeRiskClampMax: z.number().min(0).max(1),
    finalRiskClampMin: z.number().min(0).max(1),
    finalRiskClampMax: z.number().min(0).max(1)
  }),
  ascension: z.object({
    deterministicStatThreshold: z.number().int().min(1).max(60),
    chanceA: z.number().min(0).max(1),
    chanceB: z.number().min(0).max(1),
    chanceC: z.number().min(0).max(1),
    highStatsThresholdA: z.number().int().min(1).max(5),
    highStatsThresholdC: z.number().int().min(1).max(5),
    fortuneThresholdA: z.number().int().min(0).max(30),
    legendaryCountThresholdB: z.number().int().min(0).max(10),
    intelligenceThresholdB: z.number().int().min(0).max(30)
  }),
  fame: z.object({
    intelligenceWeight: z.number().min(0).max(3),
    charismaWeight: z.number().min(0).max(3),
    familyWeight: z.number().min(0).max(3),
    fortuneWeight: z.number().min(0).max(3),
    physiqueWeight: z.number().min(0).max(3),
    maxStatValue: z.number().int().min(1).max(100),
    min: z.number().min(0).max(100),
    max: z.number().min(0).max(100)
  }),
  ending: z.object({
    greatScore: z.number().min(0).max(200),
    goodScore: z.number().min(0).max(200),
    normalScore: z.number().min(0).max(200)
  })
}).superRefine((value, ctx) => {
  if (value.bootstrap.talentPointMax < value.bootstrap.talentPointMin) {
    ctx.addIssue({ code: "custom", message: "bootstrap.talentPointMax 必须 >= talentPointMin" });
  }
  if (value.bootstrap.selectedCardMax < value.bootstrap.selectedCardMin) {
    ctx.addIssue({ code: "custom", message: "bootstrap.selectedCardMax 必须 >= selectedCardMin" });
  }
  if (value.stage.mediumBandRatio < value.stage.lightBandRatio) {
    ctx.addIssue({ code: "custom", message: "stage.mediumBandRatio 必须 >= lightBandRatio" });
  }
  if (value.growth.growthChanceClampMax < value.growth.growthChanceClampMin) {
    ctx.addIssue({ code: "custom", message: "growth.growthChanceClampMax 必须 >= growthChanceClampMin" });
  }
  if (value.growth.decayChanceClampMax < value.growth.decayChanceClampMin) {
    ctx.addIssue({ code: "custom", message: "growth.decayChanceClampMax 必须 >= decayChanceClampMin" });
  }
  if (value.decision.successRateClampMax < value.decision.successRateClampMin) {
    ctx.addIssue({ code: "custom", message: "decision.successRateClampMax 必须 >= successRateClampMin" });
  }
  if (value.decision.gainClampMax < value.decision.gainClampMin) {
    ctx.addIssue({ code: "custom", message: "decision.gainClampMax 必须 >= gainClampMin" });
  }
  if (value.decision.lossClampMax < value.decision.lossClampMin) {
    ctx.addIssue({ code: "custom", message: "decision.lossClampMax 必须 >= lossClampMin" });
  }
  if (value.death.physiqueRiskClampMax < value.death.physiqueRiskClampMin) {
    ctx.addIssue({ code: "custom", message: "death.physiqueRiskClampMax 必须 >= physiqueRiskClampMin" });
  }
  if (value.death.longNegativeRiskClampMax < value.death.longNegativeRiskClampMin) {
    ctx.addIssue({ code: "custom", message: "death.longNegativeRiskClampMax 必须 >= longNegativeRiskClampMin" });
  }
  if (value.death.finalRiskClampMax < value.death.finalRiskClampMin) {
    ctx.addIssue({ code: "custom", message: "death.finalRiskClampMax 必须 >= finalRiskClampMin" });
  }
  if (value.fame.max < value.fame.min) {
    ctx.addIssue({ code: "custom", message: "fame.max 必须 >= fame.min" });
  }
  if (value.ending.greatScore < value.ending.goodScore || value.ending.goodScore < value.ending.normalScore) {
    ctx.addIssue({ code: "custom", message: "ending 阈值必须满足 great >= good >= normal" });
  }
});

const promptPackSchema = z.object({
  systemCore: z.string().min(1),
  immersionRules: z.string().min(1),
  yearNormalRule: z.string().min(1),
  yearMinorRule: z.string().min(1),
  milestoneRule: z.string().min(1),
  storyConstraint: z.string().min(1),
  endingHint: z.string().min(1)
}).catchall(z.string());

export const contentBundleSchema: z.ZodType<ContentBundle> = z.object({
  worlds: z.array(worldSchema).min(1),
  cards: z.array(cardSchema).min(1),
  difficulties: z.array(difficultySchema).min(1),
  promptPack: promptPackSchema,
  gameplayTuning: gameplayTuningSchema.optional()
}).superRefine((value, ctx) => {
  const checkUnique = (items: Array<{ id: string }>, section: string): void => {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.id)) {
        ctx.addIssue({
          code: "custom",
          message: `${section} 存在重复 id: ${item.id}`
        });
      }
      seen.add(item.id);
    }
  };

  checkUnique(value.worlds, "worlds");
  checkUnique(value.cards, "cards");
  checkUnique(value.difficulties, "difficulties");

  const requiredWorlds = ["modern", "ancient", "fantasy"];
  for (const req of requiredWorlds) {
    if (!value.worlds.some((w) => w.id === req)) {
      ctx.addIssue({
        code: "custom",
        message: `必须保留基础世界观: ${req}`
      });
    }
  }
});
