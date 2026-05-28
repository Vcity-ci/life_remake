import type { ProviderLimits } from "@reroll/shared";

export const providerLimits: ProviderLimits = {
  temperature: { min: 0, max: 2 },
  maxTokens: {
    min: 64,
    max: 4000,
    note: "建议单次在 256~2000；越高费用越高且响应更慢。"
  },
  timeoutMs: { min: 5000, max: 120000 },
  apiPathOptions: ["/chat/completions", "/responses"]
};
