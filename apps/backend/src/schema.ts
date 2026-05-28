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
  talentPointTotal: z.number().int().min(20).max(30),
  stats: statsSchema,
  selectedCardIds: z.array(z.string()).min(1).max(3)
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
  milestoneAges: z.array(z.number().int().min(1).max(120)).min(1),
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
  promptPack: promptPackSchema
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
