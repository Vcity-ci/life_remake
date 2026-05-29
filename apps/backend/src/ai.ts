import OpenAI from "openai";
import { createHash } from "node:crypto";
import type { InternalRunState } from "./engine.js";
import type { AiMilestoneOptions, DecisionType, ProviderConfig, Stats, WorldConfig, YearEvent } from "@reroll/shared";

interface NarrativeContext {
  providerConfig: ProviderConfig;
  apiKey: string;
  promptPack: Record<string, string>;
  worldlineSummary?: string;
  factionSummary?: string;
  eventPoolSummary?: string;
  talentHookSummary?: string;
}

type ChatContentPart = { type?: string; text?: string };
const debugModel = process.env.DEBUG_MODEL_CALLS === "1";
const promptCache = new Map<string, { text: string; ts: number }>();
const PROMPT_CACHE_TTL_MS = 10 * 60 * 1000;
const PROMPT_CACHE_MAX = 600;
const clientCache = new Map<string, OpenAI>();
const CLIENT_CACHE_MAX = 64;

function buildPromptCacheKey(
  provider: ProviderConfig,
  systemPrompt: string,
  userPrompt: string
): string {
  return createHash("sha256")
    .update(`${provider.baseUrl}|${provider.model}|${provider.apiPath}\n${systemPrompt}\n${userPrompt}`)
    .digest("hex");
}

function buildClientCacheKey(ctx: NarrativeContext): string {
  return createHash("sha256")
    .update(`${ctx.providerConfig.baseUrl}|${ctx.providerConfig.timeoutMs}|${ctx.apiKey}`)
    .digest("hex");
}

function getOpenAIClient(ctx: NarrativeContext): OpenAI {
  const key = buildClientCacheKey(ctx);
  const cached = clientCache.get(key);
  if (cached) return cached;

  if (clientCache.size >= CLIENT_CACHE_MAX) {
    const first = clientCache.keys().next().value;
    if (first) clientCache.delete(first);
  }

  const client = new OpenAI({
    apiKey: ctx.apiKey,
    baseURL: ctx.providerConfig.baseUrl,
    timeout: ctx.providerConfig.timeoutMs
  });
  clientCache.set(key, client);
  return client;
}

function readPromptCache(key: string): string | null {
  const hit = promptCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > PROMPT_CACHE_TTL_MS) {
    promptCache.delete(key);
    return null;
  }
  return hit.text;
}

function writePromptCache(key: string, text: string): void {
  const normalized = text.trim();
  if (!normalized) return;
  if (promptCache.size >= PROMPT_CACHE_MAX) {
    const first = promptCache.keys().next().value;
    if (first) promptCache.delete(first);
  }
  promptCache.set(key, { text: normalized, ts: Date.now() });
}

function debugError(tag: string, error: unknown): void {
  if (!debugModel) return;
  const maybe = error as { message?: string; status?: number; code?: string; error?: unknown };
  console.log(`[model-debug:${tag}:error]`, {
    message: maybe?.message ?? String(error),
    status: maybe?.status,
    code: maybe?.code
  });
}

function fallbackLine(event: YearEvent): string {
  if (event.tags.includes("milestone")) return "命运在此刻拐弯。";
  if (event.tags.includes("special")) return "这一年突生变故。";
  return "这一年平平无奇。";
}

function isLikelyTruncated(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return !/[。！？!?…】）)」』]$/.test(t);
}

async function continueNarrative(
  ctx: NarrativeContext,
  systemPrompt: string,
  partialText: string
): Promise<string> {
  const continuationPrompt = [
    "【任务】上一段叙事可能被截断，请续写并自然收束。",
    "【要求】只输出续写内容；不重复前文；20~40字；必须以句号/问号/叹号结束。",
    `【前文】${partialText}`
  ].join("\n");
  return callModel(ctx, systemPrompt, continuationPrompt);
}

function buildSystemPrompt(
  promptPack: Record<string, string>,
  world: WorldConfig,
  ctx: NarrativeContext
): string {
  return [
    promptPack.systemCore,
    `【世界观】${world.name}`,
    `【风格要求】${world.stylePrompt}`,
    ctx.worldlineSummary ? `【世界线设定】${ctx.worldlineSummary}` : "",
    ctx.factionSummary ? `【阵营设定】${ctx.factionSummary}` : "",
    ctx.eventPoolSummary ? `【阵营事件池】${ctx.eventPoolSummary}` : "",
    ctx.talentHookSummary ? `【天赋卡叙事钩子】${ctx.talentHookSummary}` : "",
    promptPack.immersionRules,
    promptPack.storyConstraint,
    promptPack.endingHint
  ].filter(Boolean).join("\n\n");
}

function summarizeRecent(events: YearEvent[]): string {
  return events.map((e) => `${e.age}岁 ${e.title}：${e.summary}`).join(" | ");
}

function summarizeBlankYears(events: YearEvent[]): string {
  const blank = events.filter((e) => e.title.includes("平年"));
  if (blank.length === 0) return "无空过年份";
  const ages = blank.map((e) => `${e.age}`).join("、");
  return `空过年份共${blank.length}个：${ages}岁`;
}

function hasBlankYears(events: YearEvent[]): boolean {
  return events.some((e) => e.title.includes("平年"));
}

function formatDelta(changes: Partial<Record<keyof Stats, number>>): string {
  const keys = ["intelligence", "charisma", "family", "fortune", "physique"] as const;
  const label: Record<(typeof keys)[number], string> = {
    intelligence: "智力",
    charisma: "魅力",
    family: "家境",
    fortune: "气运",
    physique: "体魄"
  };
  const parts: string[] = [];
  for (const k of keys) {
    const delta = changes[k];
    if (!delta) continue;
    parts.push(`${label[k]}${delta > 0 ? "+" : ""}${delta}`);
  }
  return parts.length ? parts.join("，") : "无变化";
}

function fameGrade(fame: number): string {
  if (fame < 20) return "寂寂无闻";
  if (fame < 40) return "渐有其名";
  if (fame < 60) return "声名鹊起";
  if (fame < 80) return "名震一方";
  return "举世闻名";
}

function riskLevelFromEvent(event: YearEvent): string {
  if (event.tags.includes("safe")) return "A-低风险低收益";
  if (event.tags.includes("balanced")) return "B-中风险中收益";
  if (event.tags.includes("risky")) return "C-高风险高收益";
  if (event.tags.includes("tone_critical_negative")) return "危机年";
  if (event.tags.includes("tone_negative")) return "逆风年";
  if (event.tags.includes("tone_positive")) return "顺风年";
  if (event.tags.includes("tone_mixed")) return "起伏年";
  if (event.tags.includes("special")) return "小事件年";
  if (event.title.includes("平年")) return "空过平年";
  return "普通年";
}

function coreStatInsight(
  value: number,
  cfg: {
    low: string;
    mid: string;
    high: string;
  }
): string {
  if (value < 0) return cfg.low;
  if (value <= 15) return cfg.mid;
  return cfg.high;
}

function physiqueInsight(value: number): string {
  if (value < 3) return "你的身体处在高危边缘，行动稍有偏差就可能崩溃。";
  if (value <= 15) return "你的体魄维持在常态，能应对大多数日常与冲突。";
  return "你的体魄强韧，恢复与承压能力明显高于常人。";
}

function buildStatInsightPrompt(stats: Stats): string {
  const intelligence = coreStatInsight(stats.intelligence, {
    low: "你无法理解世界万物，认知常常断裂且难以连贯。",
    mid: "你以常人的认知理解事件并作出判断。",
    high: "你对事件有超乎常人的洞察力，能看到深层结构与因果。"
  });
  const charisma = coreStatInsight(stats.charisma, {
    low: "你很难被他人信任或理解，社交关系经常失控。",
    mid: "你的人际影响力处于常态，沟通基本顺畅。",
    high: "你具备强烈的感染力与号召力，能迅速影响他人立场。"
  });
  const family = coreStatInsight(stats.family, {
    low: "你的家境持续拖累选择，资源匮乏且后援薄弱。",
    mid: "你的家境处于普通水平，资源支持有限但可维持。",
    high: "你的家境提供稳定资源与人脉支撑，试错成本更低。"
  });
  const fortune = coreStatInsight(stats.fortune, {
    low: "你总在关键节点遭遇逆风，偶然事件常向坏处发展。",
    mid: "你的运势整体平稳，机遇与阻碍大致均衡。",
    high: "你常在关键时刻获得偏向性的机遇，偶然事件更易利好。"
  });
  const physique = physiqueInsight(stats.physique);

  return [
    `智力：${intelligence}`,
    `魅力：${charisma}`,
    `家境：${family}`,
    `气运：${fortune}`,
    `体魄：${physique}`
  ].join(" | ");
}

function getTag(event: YearEvent, prefix: string): string | undefined {
  return event.tags.find((t) => t.startsWith(prefix));
}

function parseDeltaTag(
  tag: string
): { stat: string; direction: "up" | "down" | "steady"; band: "light" | "medium" | "heavy" | "steady" } | null {
  const m = tag.match(/^delta_(intelligence|charisma|family|fortune|physique)_(up|down|steady)(?:_(light|medium|heavy))?$/);
  if (!m) return null;
  const [, stat, direction, band] = m;
  if (direction === "steady") {
    return { stat, direction, band: "steady" };
  }
  return {
    stat,
    direction: direction as "up" | "down",
    band: (band as "light" | "medium" | "heavy") ?? "light"
  };
}

function labelStat(stat: string): string {
  const map: Record<string, string> = {
    intelligence: "智力",
    charisma: "魅力",
    family: "家境",
    fortune: "气运",
    physique: "体魄"
  };
  return map[stat] ?? stat;
}

function deltaToneText(direction: "up" | "down" | "steady", band: "light" | "medium" | "heavy" | "steady"): string {
  if (direction === "steady") return "基本持平";
  if (direction === "up") {
    if (band === "light") return "小幅提升";
    if (band === "medium") return "中幅提升";
    return "大幅提升";
  }
  if (band === "light") return "小幅下滑";
  if (band === "medium") return "中幅下滑";
  return "大幅下滑";
}

function summarizeDeltaBins(event: YearEvent): string {
  const deltaTags = event.tags
    .filter((t) => t.startsWith("delta_"))
    .map(parseDeltaTag)
    .filter(Boolean) as Array<{ stat: string; direction: "up" | "down" | "steady"; band: "light" | "medium" | "heavy" | "steady" }>;
  if (deltaTags.length === 0) return "无分箱信息";

  const statLines = deltaTags
    .filter((x) => x.stat !== "overall")
    .map((x) => `${labelStat(x.stat)}：${deltaToneText(x.direction, x.band)}`);

  const overallTags = event.tags.filter((t) => t.startsWith("delta_overall_"));
  const overall = overallTags.length > 0 ? overallTags.join(" / ") : "delta_overall_unknown";
  return `${statLines.join("；")} | 总体：${overall}`;
}

function worldGuidePrompt(event: YearEvent): string {
  const guideMap: Record<string, string> = {
    guide_workplace_intrigue: "倾向写职场权力博弈、背锅与资源排挤。",
    guide_public_opinion_backlash: "倾向写舆论反噬、名誉受损与关系降温。",
    guide_capital_pressure: "倾向写资金链紧张、合约压迫与交易失衡。",
    guide_relationship_betrayal: "倾向写盟友背刺、信任崩塌与合作破裂。",
    guide_health_overdraft: "倾向写长期透支、慢性损耗与身心崩盘前兆。",
    guide_court_intrigue: "倾向写朝堂构陷、奏章攻讦与立场清洗。",
    guide_faction_purge: "倾向写党争清洗、上位者切割与阵营反噬。",
    guide_clan_suppression: "倾向写宗族牵连、门第压制与家势下坠。",
    guide_frontier_turmoil: "倾向写边地失守、军情失利与战时征耗。",
    guide_grain_crisis: "倾向写荒年欠收、赋税重压与民生动荡。",
    guide_arcane_backlash: "倾向写法术反噬、灵性污染与施法代价。",
    guide_cult_hunt: "倾向写教团追猎、身份暴露与地下围剿。",
    guide_old_god_whisper: "倾向写旧日低语、精神侵蚀与认知错乱。",
    guide_guild_betrayal: "倾向写公会背约、任务陷阱与利益反转。",
    guide_contamination_outbreak: "倾向写异化扩散、封锁失效与群体恐慌。",
    guide_fatal_pressure: "危机强度高，优先突出不可逆后果与生存压力。"
  };
  const guides = event.tags
    .filter((t) => t.startsWith("guide_"))
    .map((t) => guideMap[t] ?? "")
    .filter(Boolean);
  return guides.length > 0 ? guides.join(" ") : "无额外世界负面引导";
}

function stageCapPrompt(event: YearEvent): string {
  const tag = getTag(event, "stage_cap_");
  if (!tag) return "无阶段幅度信息";
  const cap = tag.replace("stage_cap_", "");
  return `当前年龄阶段单年属性波动上限约为 ±${cap}`;
}

function buildYearPrompt(run: InternalRunState, event: YearEvent, promptPack: Record<string, string>): string {
  const cards = run.cards.map((c) => `${c.name}(${c.rarity})`).join("、") || "无";
  const rule = event.tags.includes("milestone")
    ? promptPack.milestoneRule
    : event.tags.includes("special")
      ? promptPack.yearMinorRule
      : promptPack.yearNormalRule;
  const statInsight = buildStatInsightPrompt(run.stats);

  return [
    `【目标】按节点类型生成文本，并以“本年份属性变化”作为叙事主轴。`,
    `【人设输入】${run.personaPrompt}`,
    `【当前年龄】${event.age}岁`,
    `【年龄阶段】${run.ageStage.label}`,
    `【当前名望】${run.fame}（${fameGrade(run.fame)}）`,
    `【当前风险等级】${riskLevelFromEvent(event)}`,
    `【属性】智力${run.stats.intelligence} 魅力${run.stats.charisma} 家境${run.stats.family} 气运${run.stats.fortune} 体魄${run.stats.physique}`,
    `【属性分箱状态】${statInsight}`,
    `【阶段波动范围】${stageCapPrompt(event)}`,
    `【当年变化分箱标签】${summarizeDeltaBins(event)}`,
    `【世界负面引导】${worldGuidePrompt(event)}`,
    `【当年属性变化(delta)】${formatDelta(event.statChanges as Partial<Record<keyof InternalRunState["stats"], number>>)}`,
    `【是否经过空过年份】${hasBlankYears(run.history.slice(-12)) ? "是" : "否"}`,
    `【天赋卡】${cards}`,
    `【本年事件】${event.title}；${event.summary}`,
    `【空过年份记录】${summarizeBlankYears(run.history.slice(-12))}`,
    `【节点类型规则】${rule}`,
    `【硬性长度】年度/事件背景必须在80-150字；如出现对话，单句对话不超过20字；必须体现当年属性变化。`,
    `【主轴约束】开头或前两句必须先交代当年属性变化带来的直接后果，再展开事件细节。`,
    `【输出限制】只输出文本内容，不加解释。`
  ].join("\n");
}

function buildMilestoneOptionsPrompt(run: InternalRunState, recent: YearEvent[], promptPack: Record<string, string>): string {
  const statInsight = buildStatInsightPrompt(run.stats);
  return [
    `【目标】基于事件背景生成A/B/C选项`,
    `【人设输入】${run.personaPrompt}`,
    `【当前年龄】${run.age}岁`,
    `【年龄阶段】${run.ageStage.label}`,
    `【当前名望】${run.fame}（${fameGrade(run.fame)}）`,
    `【属性分箱状态】${statInsight}`,
    `【最近事件】${summarizeRecent(recent.slice(-5))}`,
    `【是否经过空过年份】${hasBlankYears(run.history.slice(-12)) ? "是" : "否"}`,
    `【空过年份记录】${summarizeBlankYears(run.history.slice(-12))}`,
    `【规则】${promptPack.milestoneRule}`,
    `【输出要求】返回 JSON：{ "background":"80-150字背景", "optionOverrides": [{"id":"safe|balanced|risky","label":"A|B|C","description":"<=20字选项文本"}] }`
  ].join("\n");
}

async function callModel(
  ctx: NarrativeContext,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const cacheKey = buildPromptCacheKey(ctx.providerConfig, systemPrompt, userPrompt);
  const cached = readPromptCache(cacheKey);
  if (cached !== null) {
    if (debugModel) {
      console.log("[model-debug:cache-hit]", { len: cached.length });
    }
    return cached;
  }

  const client = getOpenAIClient(ctx);

  const attempt = async (): Promise<string> => {
    if (ctx.providerConfig.apiPath === "/responses") {
      const rsp = await client.responses.create({
        model: ctx.providerConfig.model,
        temperature: ctx.providerConfig.temperature,
        max_output_tokens: ctx.providerConfig.maxTokens,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      });
      return rsp.output_text?.trim() ?? "";
    }

    const chat = await client.chat.completions.create({
      model: ctx.providerConfig.model,
      temperature: ctx.providerConfig.temperature,
      max_tokens: ctx.providerConfig.maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    const content = chat.choices[0]?.message?.content;
    if (typeof content === "string") {
      return content.trim();
    }
    if (Array.isArray(content)) {
      const parts = content as ChatContentPart[];
      return parts.map((part) => part.text ?? "").join("").trim();
    }
    return "";
  };

  let lastError: unknown;
  const backoffMs = [300, 900, 1800];
  for (let i = 0; i < backoffMs.length + 1; i += 1) {
    try {
      const text = await attempt();
      writePromptCache(cacheKey, text);
      return text;
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number }).status;
      const shouldRetry = status === 429 || status === 503;
      if (!shouldRetry || i >= backoffMs.length) break;
      await new Promise((resolve) => setTimeout(resolve, backoffMs[i]));
    }
  }
  throw lastError;
}

export async function generateYearNarrative(
  run: InternalRunState,
  world: WorldConfig,
  event: YearEvent,
  ctx: NarrativeContext
): Promise<string> {
  if (!ctx.apiKey.trim()) return "";
  const systemPrompt = buildSystemPrompt(ctx.promptPack, world, ctx);
  const userPrompt = buildYearPrompt(run, event, ctx.promptPack);
  if (debugModel) {
    console.log("[model-debug:prompt-shape:year]", {
      systemPromptLen: systemPrompt.length,
      userPromptLen: userPrompt.length,
      hasWorldline: Boolean(ctx.worldlineSummary),
      hasFaction: Boolean(ctx.factionSummary),
      hasEventPool: Boolean(ctx.eventPoolSummary),
      hasTalentHooks: Boolean(ctx.talentHookSummary)
    });
  }

  try {
    let text = await callModel(ctx, systemPrompt, userPrompt);
    if (isLikelyTruncated(text)) {
      const tail = await continueNarrative(ctx, systemPrompt, text.slice(-180));
      if (tail.trim()) {
        text = `${text}${tail}`;
      }
    }
    text = text.trim();
    if (debugModel) {
      console.log("[model-debug:year-narrative]", {
        hasText: Boolean(text?.trim()),
        len: text?.length ?? 0,
        preview: text?.slice(0, 120) ?? ""
      });
    }
    return text || "";
  } catch (error) {
    debugError("year-narrative", error);
    if (debugModel) {
      console.log("[model-debug:year-narrative]", { hasText: false, len: 0, fallback: true });
    }
    return "";
  }
}

function defaultOptions(): AiMilestoneOptions {
  return {
    background: "前路骤然分岔。",
    optionOverrides: [
      { id: "safe", label: "A", description: "稳步试探，低风险低收益。" },
      { id: "balanced", label: "B", description: "择机投入，中风险中收益。" },
      { id: "risky", label: "C", description: "孤注一掷，高风险高收益。" }
    ]
  };
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```[a-zA-Z]*\n?/, "")
      .replace(/```$/, "")
      .trim();
  }
  return trimmed;
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function parseOptionsFromText(text: string): AiMilestoneOptions | null {
  const lines = text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (lines.length < 3) return null;

  let background = "命运在你面前摊开新赌局。";
  const optionOverrides: AiMilestoneOptions["optionOverrides"] = [];
  for (const line of lines) {
    const safeMatch = line.match(/^A[\.\:：\s-]*(.+)$/i);
    const balMatch = line.match(/^B[\.\:：\s-]*(.+)$/i);
    const riskMatch = line.match(/^C[\.\:：\s-]*(.+)$/i);
    if (safeMatch) {
      optionOverrides.push({ id: "safe", label: "A", description: safeMatch[1].trim() });
      continue;
    }
    if (balMatch) {
      optionOverrides.push({ id: "balanced", label: "B", description: balMatch[1].trim() });
      continue;
    }
    if (riskMatch) {
      optionOverrides.push({ id: "risky", label: "C", description: riskMatch[1].trim() });
      continue;
    }
    if (optionOverrides.length === 0) {
      background = line;
    }
  }
  if (optionOverrides.length !== 3) return null;
  return { background, optionOverrides };
}

function parseMilestonePayload(text: string): AiMilestoneOptions | null {
  const cleaned = stripCodeFence(text);
  const candidates = [cleaned, extractFirstJsonObject(cleaned)].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as AiMilestoneOptions;
      if (parsed.optionOverrides?.length === 3) return parsed;
    } catch {
      // keep trying
    }
  }
  return parseOptionsFromText(cleaned);
}

function isDecisionId(value: string): value is DecisionType {
  return value === "safe" || value === "balanced" || value === "risky";
}

export async function generateMilestoneOptions(
  run: InternalRunState,
  world: WorldConfig,
  recent: YearEvent[],
  ctx: NarrativeContext
): Promise<AiMilestoneOptions> {
  if (!ctx.apiKey.trim()) return defaultOptions();

  const systemPrompt = buildSystemPrompt(ctx.promptPack, world, ctx);
  const userPrompt = buildMilestoneOptionsPrompt(run, recent, ctx.promptPack);
  if (debugModel) {
    console.log("[model-debug:prompt-shape:milestone]", {
      systemPromptLen: systemPrompt.length,
      userPromptLen: userPrompt.length,
      hasWorldline: Boolean(ctx.worldlineSummary),
      hasFaction: Boolean(ctx.factionSummary),
      hasEventPool: Boolean(ctx.eventPoolSummary),
      hasTalentHooks: Boolean(ctx.talentHookSummary)
    });
  }

  try {
    const text = await callModel(ctx, systemPrompt, userPrompt);
    if (debugModel) {
      console.log("[model-debug:milestone-options]", {
        hasText: Boolean(text?.trim()),
        len: text?.length ?? 0,
        preview: text?.slice(0, 120) ?? ""
      });
    }
    const parsed = parseMilestonePayload(text);
    if (!parsed) {
      return defaultOptions();
    }
    if (!parsed.optionOverrides || parsed.optionOverrides.length !== 3) {
      return defaultOptions();
    }
    const safe = parsed.optionOverrides.find((o) => o.id === "safe");
    const balanced = parsed.optionOverrides.find((o) => o.id === "balanced");
    const risky = parsed.optionOverrides.find((o) => o.id === "risky");
    if (!safe || !balanced || !risky) return defaultOptions();

    const normalized = parsed.optionOverrides
      .filter((o) => isDecisionId(o.id))
      .map((o) => ({
        id: o.id,
        label: o.label || "A",
        description: (o.description || "").trim()
      }));
    return {
      background: (parsed.background || "命运在你面前摊开新赌局。").trim(),
      optionOverrides: normalized
    };
  } catch (error) {
    debugError("milestone-options", error);
    if (debugModel) {
      console.log("[model-debug:milestone-options]", { hasText: false, parseFailed: true, fallback: true });
    }
    return defaultOptions();
  }
}
