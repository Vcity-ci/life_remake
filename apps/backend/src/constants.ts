import type { ProviderLimits } from "@reroll/shared";

export const providerLimits: ProviderLimits = {
  temperature: { min: 0, max: 2 },
  maxTokens: {
    min: 64,
    max: 65536,
    note: "输出上限用于容纳完整的结构化结果；正文篇幅由各任务提示词控制。"
  },
  timeoutMs: { min: 5000, max: 120000 },
  apiPathOptions: ["/chat/completions", "/responses"]
};
