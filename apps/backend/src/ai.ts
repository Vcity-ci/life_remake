import { validateNarrativeEffects, narrativeEffectsSchema, describeNarrativeAttributePolicy, type NarrativeValidationIssue } from "./narrative-attributes.js";
import { buildConversationPromptMessages, keepRecentConversationRounds, projectConversationUserPrompt } from "./conversation.js";
import OpenAI from "openai";
import { ZodError } from "zod";
import { factUpdateContract, parseFactUpdates, relationshipStances, relationshipUpdatesSchema, parseRelationshipUpdates, normalizeNarrativeHandoffFact } from "./narrative-continuity.js";
import type { NarrativeRelationshipUpdate } from "@reroll/shared";
import { resolvePromptPack, narrativeToolRule, normalizeNarrativeText, isNarrativePlainText, type PromptPackResolved, type NarrativeTask } from "./narrative-prompts.js";
import { createHash, randomUUID } from "node:crypto";
import type { InternalRunState } from "./engine.js";
import type { ConversationPromptMessage, ChatConversationState, ChatHistoryMessage, ToolCallRecord } from "./conversation.js";
import type { AiMilestoneOptions, DecisionType, EventStoryPosition, ModelUsageOperation, NarrativeActHandoff, NarrativeAttributeEffect, NarrativeAttributePolicy, NarrativeBeat, NarrativeCharacterRelationship, NarrativeEndingBrief, NarrativeFactUpdates, NarrativeFactResolution, NarrativeHorizonPlan, NarrativeIntent, NarrativeStatTier, ProviderConfig, StatKey, Stats, WorldConfig, YearEvent } from "@reroll/shared";
import { formatNarrativePromptPlan, type NarrativePromptPlan } from "./narrative.js";
import { composeNarrativeContext } from "./narrative/context/orchestrator.js";
import type { NarrativeContextComposeInput, NarrativeContextManifest } from "./narrative/context/types.js";
import { narrativeContextTrace } from "./narrative/context/trace.js";
import { recordModelUsage, commitRunMemoryCuration, commitRunScopedMemoryCuration, getRun } from "./store.js";
import type { NarrativeAssets, NarrativeAssetUpdates } from "@reroll/shared";
import { narrativeAssetUpdatesSchema, parseNarrativeAssetUpdates } from "./narrative-assets.js";
import type { NarrativeHorizonInput, NarrativeTurnEnvelope, NarrativeTurnPlan } from "./narrative/turn.js";
import {
  prepareNarrativeMemoryCuration,
  type NarrativeMemoryCurationResult,
  type NarrativeMemoryCurationWork
} from "./narrative/curator.js";

export interface NarrativeContext {
  callId?: string;
  providerConfig: ProviderConfig;
  apiKey: string;
  usageScope?: {
    sessionId: string;
    runId?: string;
    worldId?: string;
  };
  promptPack: Record<string, string>;
  worldlineSummary?: string;
  factionSummary?: string;
  eventPoolSummary?: string;
  talentHookSummary?: string;
  recentNarratives?: string[];
  conversation?: ChatConversationState;
  narrativePlan?: NarrativePromptPlan;
  lastContextManifest?: NarrativeContextManifest;
}

type ChatContentPart = { type?: string; text?: string };
interface StructuredOutputSpec {
  name: string;
  schema: Record<string, unknown>;
  description?: string;
}
interface CallModelOptions {
  structuredOutput?: StructuredOutputSpec;
  jsonMode?: boolean;
  conversation?: ChatConversationState;
  historyMessages?: ConversationPromptMessage[];
  usageOperation?: ModelUsageOperation;
}
interface ModelCallResult {
  text: string;
  truncated: boolean;
  truncateReason?: string;
}

interface ProviderReportedUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

type ModelUsageOperationInput = ModelUsageOperation | {
  fallback: ModelUsageOperation;
  resolve: (response: unknown) => ModelUsageOperation;
};

function reportedTokenValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : undefined;
}

function extractProviderUsage(response: unknown, transport: "chat" | "responses"): ProviderReportedUsage | undefined {
  const usage = (response as {
    usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      input_tokens?: unknown;
      output_tokens?: unknown;
      total_tokens?: unknown;
    };
  }).usage;
  if (!usage || typeof usage !== "object") return undefined;
  return {
    inputTokens: reportedTokenValue(transport === "chat" ? usage.prompt_tokens : usage.input_tokens),
    outputTokens: reportedTokenValue(transport === "chat" ? usage.completion_tokens : usage.output_tokens),
    totalTokens: reportedTokenValue(usage.total_tokens)
  };
}

function recordProviderUsage(
  ctx: NarrativeContext,
  operation: ModelUsageOperationInput,
  transport: "chat" | "responses",
  input: { success?: boolean; cacheHit?: boolean; durationMs: number; response?: unknown }
): void {
  const scope = ctx.usageScope;
  if (!scope?.sessionId) return;
  const resolvedOperation = typeof operation === "string"
    ? operation
    : input.response
      ? operation.resolve(input.response)
      : operation.fallback;
  void recordModelUsage(scope.sessionId, {
    runId: scope.runId,
    worldId: scope.worldId,
    model: ctx.providerConfig.model,
    transport,
    operation: resolvedOperation,
    success: input.success,
    cacheHit: input.cacheHit,
    durationMs: input.durationMs,
    usage: input.response ? extractProviderUsage(input.response, transport) : undefined
  }).catch((error) => debugError("model-usage", error));
}

async function createTrackedChatCompletion(
  ctx: NarrativeContext,
  client: OpenAI,
  payload: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  operation: ModelUsageOperationInput
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const startedAt = Date.now();
  try {
    const response = await client.chat.completions.create(payload);
    recordProviderUsage(ctx, operation, "chat", { success: true, durationMs: Date.now() - startedAt, response });
    return response;
  } catch (error) {
    recordProviderUsage(ctx, operation, "chat", { success: false, durationMs: Date.now() - startedAt });
    throw error;
  }
}

async function createTrackedResponse(
  ctx: NarrativeContext,
  client: OpenAI,
  payload: Parameters<OpenAI["responses"]["create"]>[0],
  operation: ModelUsageOperationInput
): Promise<Awaited<ReturnType<OpenAI["responses"]["create"]>>> {
  const startedAt = Date.now();
  try {
    const response = await client.responses.create(payload);
    recordProviderUsage(ctx, operation, "responses", { success: true, durationMs: Date.now() - startedAt, response });
    return response;
  } catch (error) {
    recordProviderUsage(ctx, operation, "responses", { success: false, durationMs: Date.now() - startedAt });
    throw error;
  }
}
interface YearNarrativeOptions {
  avoidNarratives?: string[];
  background?: {
    ageFrom: number;
    ageTo: number;
    progressionGoal: string;
    aftermath: string;
    livingDetails: string[];
  };
}

export interface DirectedFocusInput {
  id: string;
  storyPosition?: EventStoryPosition;
  candidateCount: number;
}

export interface DirectedFocusSelection {
  focusTag: string;
  conversationTurn: {
    userPrompt: string;
    toolCall: ToolCallRecord;
  };
}

export interface DirectedNarrativeInput {
  id: string;
  title: string;
  factionId?: string;
  tags: string[];
  promptHook: string;
  outcomeHint: string;
  focusTag: string;
}

export interface DirectedNarrativeResult {
  narrative: string;
  milestoneCopy?: {
    background: string;
    optionOverrides: Array<{
      id: DecisionType;
      label: string;
      description: string;
    }>;
  };
}

export interface DirectedStoryMaterial extends DirectedNarrativeInput {
  directionIds: string[];
}

export interface DirectedStoryDirectionInput {
  id: string;
  label: string;
  summary: string;
  focusTags: string[];
  storyPosition?: EventStoryPosition;
  materialIds: string[];
}

export interface DirectedStoryChoiceDirection {
  decision: DecisionType;
  directionId: string;
  label: string;
  summary: string;
}

export interface DirectedStoryTurnInput {
  callId?: string;
  allowedIntents: NarrativeIntent[];
  /** The complete, world-owned route catalog. */
  routeOptions: Array<{
    id: string;
    label: string;
    summary: string;
  }>;
  focusOptions?: Array<{
    id: string;
    label: string;
    hint: string;
  }>;
  allowClosureRequest: boolean;
  /** The engine has completed the mainline; no new scene may be proposed. */
  closureRequired?: boolean;
  /** The model may choose scene-local time pacing, bounded by the engine. */
  allowScenePacing?: boolean;
  /** Route proposals rejected by the engine during this planning transaction. */
  rejectedRouteIds?: string[];
}

export interface DirectedStoryTurnResult {
  intent?: NarrativeIntent;
  routeId?: string;
  focusComponentId?: string;
  scenePacing?: "continuous" | "spanning";
  closureRequest?: "guide";
  toolCall: ToolCallRecord;
  continuation: DirectedStoryContinuation;
}

export interface DirectedStoryContinuation {
  protocol: "chat" | "responses";
  systemPrompt: string;
  userPrompt: string;
  responseId?: string;
}

export interface DirectedStoryRenderInput {
  kind: "normal" | "milestone";
  intent: NarrativeIntent;
  eventId: string;
  eventTitle: string;
  premise: string;
  outcomeHint: string;
  sceneHint?: string;
  focus?: {
    label: string;
    hint: string;
  };
  decision?: {
    background: string;
    options: Array<{
      id: DecisionType;
      label: string;
      description: string;
    }>;
  };
  attributePolicy?: NarrativeAttributePolicy;
  turn: DirectedStoryTurnResult;
}

export interface DirectedStoryRenderResult {
  narrative: string;
  toolResult: string;
  attributeEffects?: NarrativeAttributeEffect[];
  milestoneCopy?: {
    background: string;
    optionOverrides: Array<{
      id: DecisionType;
      label: string;
      description: string;
    }>;
  };
}

export interface DirectedDecisionSettlement {
  assetUpdates?: NarrativeAssetUpdates;
  factUpdates?: NarrativeFactUpdates;
  relationshipUpdates?: NarrativeRelationshipUpdate[];
  effects: NarrativeAttributeEffect[];
  factResolution?: NarrativeFactResolution;
}

export interface DirectedDecisionNarrativeOutcome extends DirectedDecisionSettlement {
  narrative: string;
}

export interface NarrativeOriginOutcome {
  assetUpdates?: NarrativeAssetUpdates;
  narrative: string;
  profile: {
    summary: string;
    seedHints: string[];
  };
}

export interface DynamicNarrativeSceneInput {
  plan?: NarrativeTurnPlan;
  storyArc?: string;
  act: { id: string; label: string; prompt: string; factLabel?: string };
  beat: Exclude<NarrativeBeat, "ending">;
  presentation: NarrativeTurnPlan["presentation"];
  allowedTurnKinds: Array<"scene" | "background">;
  /** Age facts are projected by the engine before the model is called. */
  sceneAge: number;
  backgroundAgeRange: { fromAge: number; toAge: number };
  routes: Array<{ id: string; label: string; summary: string; perspective?: string }>;
  factions: Array<{ id: string; label: string; summary: string }>;
  knownCharacters: Array<{ id: string; name: string; factionId?: string; role: string; description: string; relationship?: string }>;
  attributePolicy?: NarrativeAttributePolicy;
  backgroundAttributePolicy: NarrativeAttributePolicy;
  growthFocus?: { label: string; description: string };
  statTiers: Record<StatKey, NarrativeStatTier>;
  lifeStage?: {
    label: string;
    maxAge: number;
  };
}

export interface DynamicNarrativeSceneResult {
  assetUpdates?: NarrativeAssetUpdates;
  factUpdates?: NarrativeFactUpdates;
  relationshipUpdates?: NarrativeRelationshipUpdate[];
  turnKind: "scene" | "background";
  routeId?: string;
  factionId?: string;
  narrative: string;
  scenePacing?: "continuous" | "spanning";
  participants: Array<{ characterRef: string; name: string; factionId?: string; role: string; description: string; recurring: boolean; relationship?: Pick<NarrativeCharacterRelationship, "stance" | "summary"> }>;
  milestoneCopy?: DirectedNarrativeResult["milestoneCopy"];
  createsDecision?: boolean;
  attributeEffects?: NarrativeAttributeEffect[];
  actHandoff?: NarrativeActHandoff;
  /** One engine-approved growth intent, applied across this fixed background span. */
  backgroundAttributeEffects?: NarrativeAttributeEffect[];
}

export function narrativeHorizonTool(input: NarrativeHorizonInput): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: "plan_narrative_horizon",
      description: "提出当前世界幕接下来数个回合的叙事意图。它是建议，不选择、锁定或排除路线。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["dramaticQuestion", "developingTension", "nearTermIntents", "focusRefs", "payoffShape"],
        properties: {
          dramaticQuestion: { type: "string", minLength: 1, maxLength: 220 },
          developingTension: { type: "string", minLength: 1, maxLength: 260 },
          nearTermIntents: { type: "array", minItems: 2, maxItems: 4, items: { type: "string", minLength: 1, maxLength: 180 } },
          focusRefs: {
            type: "array",
            maxItems: 5,
            items: input.focusReferences.length
              ? { type: "string", enum: input.focusReferences.map((entry) => entry.id) }
              : { type: "string", enum: ["none"] }
          },
          payoffShape: { type: "string", minLength: 1, maxLength: 220 }
        }
      }
    }
  };
}

function narrativeHorizonPrompt(input: NarrativeHorizonInput): string {
  return [
    `当前世界幕：${input.act.label}。${input.act.prompt}`,
    `当前节拍：${input.beat}。`,
    `世界包路线目录：${input.routes.map((route) => `${route.id}=${route.label}：${compactText(route.summary, 80)}`).join(" | ")}`,
    `阵营目录：${input.factions.map((faction) => `${faction.id}=${faction.label}：${compactText(faction.summary, 60)}`).join(" | ")}`,
    input.previousCanon.length ? `此前幕间结果：${input.previousCanon.map((canon) => `${canon.actId}=${canon.text}`).join("；")}` : "",
    input.memoryDigests.length ? `长期经历：${input.memoryDigests.map((digest) => `${digest.id}=${digest.text}`).join("；")}` : "",
    input.focusReferences.length ? `可关注引用：${input.focusReferences.map((entry) => `${entry.id}=${entry.label}`).join(" | ")}` : "",
    "规划当前幕未来数个回合值得发展的张力、问题和可能形成的阶段结果。所有路线持续开放；不要决定下一回合选哪条路线，不要创造具体事件、人物身份或结局。",
    "必须调用 plan_narrative_horizon，不写玩家可见正文。"
  ].filter(Boolean).join("\n");
}

export async function generateNarrativeHorizonPlan(
  run: InternalRunState,
  world: WorldConfig,
  input: NarrativeHorizonInput,
  ctx: NarrativeContext
): Promise<NarrativeHorizonPlan> {
  const result = await requestNarrativeOutcomeTool(run, world, ctx, narrativeHorizonTool(input), narrativeHorizonPrompt(input), {
    task: "horizon",
    callId: input.callId,
    source: "scene",
    focusIds: input.focusReferences.map((entry) => entry.id)
  });
  const text = (value: unknown, max: number): string => typeof value === "string" ? compactText(normalizeNarrativeText(value), max) : "";
  const dramaticQuestion = text(result.raw.dramaticQuestion, 220);
  const developingTension = text(result.raw.developingTension, 260);
  const payoffShape = text(result.raw.payoffShape, 220);
  const nearTermIntents = Array.isArray(result.raw.nearTermIntents)
    ? result.raw.nearTermIntents.map((entry) => text(entry, 180)).filter(Boolean).slice(0, 4)
    : [];
  const focusRefs = Array.isArray(result.raw.focusRefs)
    ? Array.from(new Set(result.raw.focusRefs.filter((id): id is string => typeof id === "string" && id !== "none" && input.focusReferences.some((entry) => entry.id === id)))).slice(0, 5)
    : [];
  if (!dramaticQuestion || !developingTension || !payoffShape || nearTermIntents.length < 2) {
    throw invalidNarrativeOutcome("narrative_horizon_invalid");
  }
  return {
    id: `horizon:${input.act.id}:${input.nextRevision}`,
    actId: input.act.id,
    revision: input.nextRevision,
    throughEpisodeId: input.throughEpisodeId,
    dramaticQuestion,
    developingTension,
    nearTermIntents,
    focusRefs,
    payoffShape,
    status: "active",
    createdAt: Date.now()
  };
}

export interface NarrativeProseReviewInput {
  callId: string;
  task: "scene" | "choice" | "decision" | "ending";
  ageLabel: string;
  sceneGoal: string;
  narrative: string;
  background?: string;
  maxLength?: number;
}

export function narrativeProseReviewTool(input: NarrativeProseReviewInput): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: "refine_narrative_prose",
      description: "整理已经生成的玩家正文，只修正文连贯性、重复、身份一致性和内部结构泄露，不改变游戏结果。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["narrative", ...(input.background === undefined ? [] : ["background"])],
        properties: {
          narrative: { type: "string", minLength: 10, ...(input.maxLength ? { maxLength: input.maxLength } : {}) },
          ...(input.background === undefined ? {} : { background: { type: "string", minLength: 10 } })
        }
      }
    }
  };
}

export async function refineNarrativeProse(
  run: InternalRunState,
  world: WorldConfig,
  input: NarrativeProseReviewInput,
  ctx: NarrativeContext
): Promise<{ narrative: string; background?: string }> {
  const prompt = [
    `正文对应${input.ageLabel}；任务=${input.task}；已批准目标=${input.sceneGoal}。`,
    "整理正文，使人物身份、行动、地点和时间与已发生经历一致；移除工具结构、内部标签和面向模型的说明；避免用重复悬念句强行承上启下。",
    "保留已经生成的事件结果、人物关系、事实含义、选项语义和结局定性，不新增结构化变化。",
    input.maxLength ? `成稿不得超过${input.maxLength}字。` : "",
    `正文：${input.narrative}`,
    input.background === undefined ? "" : `抉择背景：${input.background}`,
    "必须调用 refine_narrative_prose。"
  ].filter(Boolean).join("\n");
  const result = await requestNarrativeOutcomeTool(run, world, ctx, narrativeProseReviewTool(input), prompt, {
    task: "reviewing",
    callId: `${input.callId}:review`,
    source: input.task === "ending" ? "ending" : input.task === "decision" || input.task === "choice" ? "decision" : "scene"
  });
  const narrative = normalizeNarrativeText(result.raw.narrative);
  const background = input.background === undefined ? undefined : normalizeNarrativeText(result.raw.background);
  if (!isSafePlayerNarrative(narrative) || (input.maxLength && narrative.length > input.maxLength) || (input.background !== undefined && !isSafePlayerNarrative(background ?? ""))) {
    throw invalidNarrativeOutcome("narrative_review_invalid");
  }
  return { narrative, background };
}

export function narrativeTurnPlanTools(input: NarrativeTurnEnvelope): Record<string, unknown>[] {
  const commonProperties: Record<string, unknown> = {
    focusRefs: {
      type: "array",
      maxItems: 3,
      items: input.focusReferences.length
        ? { type: "string", enum: input.focusReferences.map((entry) => entry.id) }
        : { type: "string", enum: ["none"] }
    },
    sceneGoal: { type: "string", minLength: 1, maxLength: 180 },
    clockRequest: { type: "string", enum: ["advance", "hold"] }
  };
  const tool = (name: string, description: string, scene: boolean): Record<string, unknown> => {
    const properties = scene
      ? {
          ...commonProperties,
          routeId: { type: "string", enum: input.routes.map((entry) => entry.id) },
          factionId: { type: "string", enum: input.factions.map((entry) => entry.id) }
        }
      : commonProperties;
    return {
      type: "function",
      function: {
        name,
        description,
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["focusRefs", "sceneGoal", "clockRequest", ...(scene ? ["routeId", "factionId"] : [])],
          properties
        }
      }
    };
  };
  return input.capabilities.map((capability) => capability === "background"
    ? tool("plan_background_turn", "规划一段普通人生背景。只提出目标，不写正文或改变游戏状态。", false)
    : capability === "choice"
      ? tool("plan_choice_turn", "规划一个真正需要玩家取舍的场景。只提出目标，不写正文或改变游戏状态。", true)
      : tool("plan_scene_turn", "规划一个无需玩家选择、直接展开并形成结果的场景。只提出目标，不写正文或改变游戏状态。", true));
}

function narrativeTurnPlanningPrompt(input: NarrativeTurnEnvelope): string {
  return [
    `回合=${input.callId}；当前年龄=${input.currentAge}岁；场景年龄=${input.sceneAge}岁；背景年龄=${input.backgroundAgeRange.fromAge}-${input.backgroundAgeRange.toAge}岁。`,
    `当前世界幕：${input.act.label}。${input.act.prompt}`,
    `当前节拍=${input.beat}；本轮可用形式=${input.capabilities.join("、")}。`,
    `路线目录：${input.routes.map((entry) => `${entry.id}=${entry.label}：${compactText(entry.summary, 80)}`).join(" | ")}`,
    `阵营目录：${input.factions.map((entry) => `${entry.id}=${entry.label}：${compactText(entry.summary, 60)}`).join(" | ")}`,
    input.focusReferences.length ? `可承接对象：${input.focusReferences.map((entry) => `${entry.id}=${entry.kind}:${entry.label}`).join(" | ")}` : "",
    input.growthFocus ? `人物当前成长侧重：${input.growthFocus.label}。${input.growthFocus.description}` : "",
    input.horizon ? `当前幕短程意图（建议而非路线门槛）：核心问题=${input.horizon.dramaticQuestion}；正在发展的张力=${input.horizon.developingTension}；近期意图=${input.horizon.nearTermIntents.join("、")}；建议关注=${input.horizon.focusRefs.join("、") || "无"}；可能形成的阶段结果=${input.horizon.payoffShape}` : "",
    `人物能力档位：${Object.entries(input.statTiers).map(([key, value]) => `${key}=${value}`).join("；")}`,
    "根据已发生经历与当前世界幕，从本轮提供的规划工具中选择一种。场景工具需要从路线与阵营目录各选一个；背景工具不指定路线和阵营。focusRefs 只引用本轮确实需要承接的对象，可以为空。",
    "clockRequest 只表达该场景是否适合同年连续发展，最终由引擎执行。必须调用一个规划工具；不要写玩家可见正文。"
  ].filter(Boolean).join("\n");
}

export async function generateNarrativeTurnPlan(
  run: InternalRunState,
  world: WorldConfig,
  input: NarrativeTurnEnvelope,
  ctx: NarrativeContext
): Promise<NarrativeTurnPlan> {
  const result = await requestNarrativeOutcomeTool(
    run,
    world,
    ctx,
    narrativeTurnPlanTools(input),
    narrativeTurnPlanningPrompt(input),
    { task: "planning", callId: input.callId, source: input.source, focusIds: input.focusReferences.map((entry) => entry.id) }
  );
  const raw = result.raw;
  const presentation = result.toolName === "plan_background_turn"
    ? "summary"
    : result.toolName === "plan_scene_turn"
      ? "scene"
      : result.toolName === "plan_choice_turn"
        ? "choice"
        : undefined;
  const turnKind = presentation === "summary" ? "background" : presentation ? "scene" : undefined;
  if (!turnKind || !presentation) throw invalidNarrativeOutcome("narrative_turn_plan_kind_invalid");
  const focusRefs = Array.isArray(raw.focusRefs)
    ? Array.from(new Set(raw.focusRefs.filter((id): id is string => typeof id === "string" && input.focusReferences.some((entry) => entry.id === id)))).slice(0, 3)
    : [];
  const sceneGoal = normalizeNarrativeText(raw.sceneGoal);
  const clockRequest = raw.clockRequest === "hold" || raw.clockRequest === "advance" ? raw.clockRequest : undefined;
  if (!sceneGoal || !clockRequest) throw invalidNarrativeOutcome("narrative_turn_plan_content_invalid");
  if (turnKind === "background") {
    return { callId: input.callId, turnKind, focusRefs, sceneGoal, presentation, clockRequest: "advance" };
  }
  const routeId = typeof raw.routeId === "string" && input.routes.some((entry) => entry.id === raw.routeId) ? raw.routeId : undefined;
  const factionId = typeof raw.factionId === "string" && input.factions.some((entry) => entry.id === raw.factionId) ? raw.factionId : undefined;
  if (!routeId || !factionId) throw invalidNarrativeOutcome("narrative_turn_plan_identity_invalid");
  return { callId: input.callId, turnKind, routeId, factionId, focusRefs, sceneGoal, presentation, clockRequest };
}

export class DirectedStoryTurnError extends Error {
  constructor(code: "directed_story_turn_unavailable" | "directed_story_turn_invalid_output" | "directed_story_tools_unavailable") {
    super(code);
    this.name = "DirectedStoryTurnError";
  }
}

export class DirectedStoryRenderError extends Error {
  constructor(code: "directed_story_render_unavailable" | "directed_story_render_invalid_output") {
    super(code);
    this.name = "DirectedStoryRenderError";
  }
}

export class NarrativeOutcomeError extends Error {
  constructor(
    code: "narrative_outcome_unavailable" | "narrative_outcome_invalid",
    public readonly reason?: string,
    public readonly validation?: NarrativeValidationIssue
  ) {
    super(code);
    this.name = "NarrativeOutcomeError";
  }
}

function invalidNarrativeOutcome(reason: string, validation?: NarrativeValidationIssue): NarrativeOutcomeError {
  return new NarrativeOutcomeError("narrative_outcome_invalid", reason, validation);
}

function nestedValidationIssue(error: unknown, path: string): NarrativeValidationIssue {
  if (error instanceof ZodError && error.issues[0]) {
    const issue = error.issues[0];
    return { rule: issue.code, path: [path, ...issue.path].join(".") };
  }
  return {
    rule: error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "invalid_value",
    path
  };
}

type SystemPromptMode = "year" | "milestone" | "ending";
function debugModelEnabled(): boolean {
  return process.env.DEBUG_MODEL_CALLS === "1";
}
const promptCache = new Map<string, { text: string; ts: number }>();
const PROMPT_CACHE_TTL_MS = 60 * 1000;
const PROMPT_CACHE_MAX = 600;
const CHAT_WINDOW_ROUNDS = 3;
const CHAT_TOOL_CALL_ARGUMENT_MAX_LEN = 800;
const CHAT_TOOL_RESULT_MAX_LEN = 260;
const CHAT_TOOL_NAME_MAX_LEN = 64;
const CHAT_TOOL_CALL_ID_MAX_LEN = 80;
const SHORT_YEAR_MIN_CHARS = 50;
const SHORT_YEAR_MAX_CHARS = 80;
const memoryCuratorJobs = new Map<string, Promise<void>>();
const SEMANTIC_CACHE_MIN_SIMILARITY = Number(process.env.SEMANTIC_CACHE_MIN_SIMILARITY ?? "0.93");
const SEMANTIC_CACHE_MIN_SIMILARITY_MILESTONE = Number(process.env.SEMANTIC_CACHE_MIN_SIMILARITY_MILESTONE ?? "0.96");
const SEMANTIC_CACHE_MIN_SIMILARITY_ENDING = Number(process.env.SEMANTIC_CACHE_MIN_SIMILARITY_ENDING ?? "0.97");
const SEMANTIC_CACHE_MODEL = process.env.SEMANTIC_CACHE_EMBED_MODEL?.trim() || "text-embedding-3-small";
const SEMANTIC_CACHE_ENABLED = process.env.SEMANTIC_CACHE_ENABLED !== "0";
const SEMANTIC_CACHE_MAX = Number(process.env.SEMANTIC_CACHE_MAX ?? "500");
const clientCache = new Map<string, OpenAI>();
const CLIENT_CACHE_MAX = 64;
const toolSupportCache = new Map<string, boolean>();
type JsonOutputMode = "json-schema" | "json-object" | "plain";
const structuredOutputSupportCache = new Map<string, JsonOutputMode>();
const milestoneStructuredOutput: StructuredOutputSpec = {
  name: "milestone_options",
  description: "关键抉择节点文本，必须包含背景与safe/balanced/risky三个选项。",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["background", "optionOverrides"],
    properties: {
      background: { type: "string" },
      optionOverrides: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "label", "description"],
          properties: {
            id: {
              type: "string",
              enum: ["safe", "balanced", "risky"]
            },
            label: { type: "string" },
            description: { type: "string" }
          }
        }
      }
    }
  }
};

interface SemanticCacheEntry {
  key: string;
  text: string;
  grams: string[];
  ts: number;
  task: SystemPromptMode;
  systemHash: string;
}

const semanticCache = new Map<string, SemanticCacheEntry>();

function normalizePromptPackForModel(promptPack: Record<string, string>): PromptPackResolved {
  return resolvePromptPack(promptPack);
}

function compactText(text: string | undefined, maxLen: number): string {
  if (!text) return "";
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLen - 1))}…`;
}

function compactPipeSummary(
  text: string | undefined,
  options: { maxSegments: number; maxSegmentLen: number; maxTotalLen: number }
): string {
  if (!text) return "";
  const parts = text
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, options.maxSegments)
    .map((x) => compactText(x, options.maxSegmentLen))
    .filter(Boolean);
  return compactText(parts.join(" | "), options.maxTotalLen);
}

function normalizeNarrativeForCompare(text: string): string {
  return text
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .trim();
}

function hashSystemPrompt(systemPrompt: string): string {
  return createHash("sha256").update(systemPrompt).digest("hex");
}

function hasValidConversation(
  conversation: ChatConversationState | undefined,
  expectedSystemHash: string
): conversation is ChatConversationState {
  if (!conversation) return false;
  if (conversation.systemHash !== expectedSystemHash) return false;
  if (!conversation.headCore.trim()) return false;
  if (!Array.isArray(conversation.history)) return false;
  return true;
}

function normalizeChatText(input: string, maxLen: number): string {
  return compactText(normalizeNarrativeText(input), maxLen);
}

function normalizeConversationText(input: string): string {
  return normalizeNarrativeText(input);
}

function createConversationState(systemHash: string, headCore: string): ChatConversationState {
  return {
    systemHash,
    headCore: normalizeChatText(headCore, 2600),
    headMemory: "",
    history: [],
    archive: [],
    summarizedMemoryIds: []
  };
}

function normalizeToolArguments(input: unknown): string {
  let source = "";
  if (typeof input === "string") {
    source = input.trim();
  } else if (input && typeof input === "object") {
    try {
      source = JSON.stringify(input);
    } catch {
      source = "";
    }
  }
  if (!source) return "{}";
  if (source.length <= CHAT_TOOL_CALL_ARGUMENT_MAX_LEN) return source;
  return JSON.stringify({ truncated: true, preview: compactText(source, CHAT_TOOL_CALL_ARGUMENT_MAX_LEN - 80) });
}

function normalizeChatHistoryMessage(input: unknown): ChatHistoryMessage | null {
  if (!input || typeof input !== "object") return null;
  const value = input as {
    role?: unknown;
    content?: unknown;
    turnId?: string;
    toolCall?: { id?: unknown; name?: unknown; arguments?: unknown };
    toolCallId?: unknown;
    name?: unknown;
  };
  if (value.role === "assistant" && value.toolCall) {
    const id = normalizeChatText(typeof value.toolCall.id === "string" ? value.toolCall.id : "", CHAT_TOOL_CALL_ID_MAX_LEN);
    const name = normalizeChatText(typeof value.toolCall.name === "string" ? value.toolCall.name : "", CHAT_TOOL_NAME_MAX_LEN);
    if (!id || !name) return null;
    return {
      role: "assistant",
      toolCall: {
        id,
        name,
        arguments: normalizeToolArguments(value.toolCall.arguments)
      }
    };
  }
  if (value.role === "tool") {
    const toolCallId = normalizeChatText(typeof value.toolCallId === "string" ? value.toolCallId : "", CHAT_TOOL_CALL_ID_MAX_LEN);
    const name = normalizeChatText(typeof value.name === "string" ? value.name : "", CHAT_TOOL_NAME_MAX_LEN);
    const content = normalizeChatText(typeof value.content === "string" ? value.content : "", CHAT_TOOL_RESULT_MAX_LEN);
    return toolCallId && name && content ? { role: "tool", toolCallId, name, content } : null;
  }
  if (value.role === "user" || value.role === "assistant") {
    const content = normalizeConversationText(typeof value.content === "string" ? value.content : "");
    return content ? { role: value.role, content: value.role === "user" ? projectConversationUserPrompt(content) : content, turnId: value.turnId } : null;
  }
  return null;
}

function ensureConversationState(
  conversation: ChatConversationState | undefined,
  systemHash: string,
  headCore: string
): ChatConversationState {
  if (!conversation || !hasValidConversation(conversation, conversation.systemHash)) {
    return createConversationState(systemHash, headCore);
  }
  return {
    systemHash,
    headCore: normalizeChatText(headCore, 2600),
    summaryRevision: conversation.summaryRevision ?? 0,
    summaryThroughMemoryId: conversation.summaryThroughMemoryId,
    summarizedMemoryIds: Array.isArray(conversation.summarizedMemoryIds)
      ? Array.from(new Set(conversation.summarizedMemoryIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim())))).slice(-240)
      : [],
    headMemory: normalizeConversationText(conversation.headMemory || ""),
    history: conversation.history
      .map(normalizeChatHistoryMessage)
      .filter((item): item is ChatHistoryMessage => item !== null),
    archive: Array.isArray(conversation.archive)
      ? conversation.archive
        .filter((x) => x && typeof x.user === "string" && typeof x.assistant === "string")
        .map((x) => ({
          id: x.id,
          user: projectConversationUserPrompt(normalizeConversationText(x.user)),
          assistant: normalizeConversationText(x.assistant)
        }))
        .filter((x) => x.user && x.assistant)
      : []
  };
}

function buildSystemMessage(conversation: ChatConversationState): string {
  return conversation.headCore;
}

function buildSemanticGrams(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, " ")
    .trim();
  if (!normalized) return [];
  const chars = normalized.replace(/\s+/g, "");
  const grams: string[] = [];
  for (let i = 0; i < chars.length - 1; i += 1) {
    grams.push(chars.slice(i, i + 2));
  }
  const words = normalized.split(/\s+/g).slice(0, 48);
  grams.push(...words);
  return grams.slice(0, 200);
}

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const token of setA) {
    if (setB.has(token)) inter += 1;
  }
  const union = setA.size + setB.size - inter;
  if (union <= 0) return 0;
  return inter / union;
}

function semanticThresholdForTask(task: SystemPromptMode): number {
  if (task === "milestone") return SEMANTIC_CACHE_MIN_SIMILARITY_MILESTONE;
  if (task === "ending") return SEMANTIC_CACHE_MIN_SIMILARITY_ENDING;
  return SEMANTIC_CACHE_MIN_SIMILARITY;
}

function buildSemanticNamespace(provider: ProviderConfig, task: SystemPromptMode, systemHash: string): string {
  return `${provider.baseUrl}|${provider.model}|${provider.apiPath}|${task}|${systemHash}`;
}

function readSemanticCache(
  provider: ProviderConfig,
  task: SystemPromptMode,
  systemHash: string,
  semanticQuery: string
): string | null {
  if (!SEMANTIC_CACHE_ENABLED) return null;
  const grams = buildSemanticGrams(semanticQuery);
  if (grams.length === 0) return null;
  const namespace = buildSemanticNamespace(provider, task, systemHash);
  const threshold = semanticThresholdForTask(task);
  let best: { score: number; text: string } | null = null;
  for (const entry of semanticCache.values()) {
    if (Date.now() - entry.ts > PROMPT_CACHE_TTL_MS) continue;
    if (entry.key !== namespace) continue;
    const score = jaccardSimilarity(grams, entry.grams);
    if (score < threshold) continue;
    if (!best || score > best.score) {
      best = { score, text: entry.text };
    }
  }
  return best?.text ?? null;
}

function writeSemanticCache(
  provider: ProviderConfig,
  task: SystemPromptMode,
  systemHash: string,
  semanticQuery: string,
  text: string
): void {
  if (!SEMANTIC_CACHE_ENABLED) return;
  const normalized = text.trim();
  if (!normalized) return;
  const grams = buildSemanticGrams(semanticQuery);
  if (grams.length === 0) return;
  if (semanticCache.size >= SEMANTIC_CACHE_MAX) {
    const first = semanticCache.keys().next().value;
    if (first) semanticCache.delete(first);
  }
  const key = `${buildSemanticNamespace(provider, task, systemHash)}#${Date.now()}#${Math.random().toString(36).slice(2, 8)}`;
  semanticCache.set(key, {
    key: buildSemanticNamespace(provider, task, systemHash),
    text: normalized,
    grams,
    ts: Date.now(),
    task,
    systemHash
  });
}

function pushHistory(conversation: ChatConversationState, role: "user" | "assistant", content: string, sourceEventId?: string): void {
  const normalized = normalizeConversationText(content);
  if (!normalized) return;
  conversation.history.push({ role, content: normalized, ...(role === "user" ? { turnId: sourceEventId ? `memory:${sourceEventId}` : randomUUID() } : {}) });
}

function pushToolCall(conversation: ChatConversationState, toolCall: ToolCallRecord): void {
  const id = normalizeChatText(toolCall.id, CHAT_TOOL_CALL_ID_MAX_LEN);
  const name = normalizeChatText(toolCall.name, CHAT_TOOL_NAME_MAX_LEN);
  if (!id || !name) return;
  conversation.history.push({
    role: "assistant",
    toolCall: {
      id,
      name,
      arguments: normalizeToolArguments(toolCall.arguments)
    }
  });
}

function pushToolResult(
  conversation: ChatConversationState,
  toolCall: ToolCallRecord,
  content: string
): void {
  const toolCallId = normalizeChatText(toolCall.id, CHAT_TOOL_CALL_ID_MAX_LEN);
  const name = normalizeChatText(toolCall.name, CHAT_TOOL_NAME_MAX_LEN);
  const normalized = normalizeChatText(content, CHAT_TOOL_RESULT_MAX_LEN);
  if (!toolCallId || !name || !normalized) return;
  conversation.history.push({ role: "tool", toolCallId, name, content: normalized });
}

function keepRecentRounds(conversation: ChatConversationState): void {
  keepRecentConversationRounds(conversation, CHAT_WINDOW_ROUNDS);
}

export function memoryCurationTool(
  work: NarrativeMemoryCurationWork,
  scopes = work.scopes
): Record<string, unknown> {
  const factIds = work.validFactIds.length ? work.validFactIds : ["none"];
  const characterIds = work.validCharacterIds.length ? work.validCharacterIds : ["none"];
  return {
    type: "function",
    function: {
      name: "curate_narrative_memory",
      description: "把已经提交的经历整理为有来源覆盖范围的长期记忆视图，不创造新事实。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["digests"],
        properties: {
          digests: {
            type: "array",
            minItems: 1,
            maxItems: scopes.length,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "summary", "activeFactIds", "historicalFactIds", "characterIds"],
              properties: {
                id: { type: "string", enum: scopes.map((scope) => scope.id) },
                summary: { type: "string", minLength: 1, maxLength: 600 },
                activeFactIds: { type: "array", maxItems: 8, items: { type: "string", enum: factIds } },
                historicalFactIds: { type: "array", maxItems: 8, items: { type: "string", enum: factIds } },
                characterIds: { type: "array", maxItems: 6, items: { type: "string", enum: characterIds } }
              }
            }
          }
        }
      }
    }
  };
}

function memoryCurationPrompt(work: NarrativeMemoryCurationWork, scopes: NarrativeMemoryCurationWork["scopes"]): string {
  return [
    scopes.some((scope) => scope.id === "run")
      ? "整理以下已经提交的经历，只返回 run 长期摘要。"
      : "为确实被本批经历改变的对象更新长期视图；没有变化的对象可以不返回。",
    "run 摘要写成当前局势：保留人物身份、当下处境、主要关系、能力、不可逆变化与尚未兑现的承诺，不按年份复述流水账。对象摘要只保留该对象目前有效的状态。未完成事实放入 activeFactIds；已解决事实放入 historicalFactIds并只保留其结果。只能引用目录中的 ID。",
    `作用域：${scopes.map((scope) => `${scope.id}；此前摘要=${scope.previousSummary || "无"}；本批=${scope.episodeIds.join("、")}`).join("\n")}`,
    `事实目录：${work.validFactIds.join("、") || "无"}；其中已解决：${work.resolvedFactIds.join("、") || "无"}。`,
    `人物目录：${work.validCharacterIds.join("、") || "无"}。`,
    ...work.episodes.map((episode) => [
      `${episode.id}｜${episode.ageFrom === undefined || episode.ageFrom === episode.age ? `${episode.age}岁` : `${episode.ageFrom}-${episode.age}岁`}｜${episode.turnKind}｜幕=${episode.actId ?? "无"}｜拍=${episode.beat ?? "无"}｜路线=${episode.routeId ?? "无"}｜阵营=${episode.factionId ?? "无"}`,
      `事实=${episode.factIds.join("、") || "无"}；人物=${episode.characterIds.join("、") || "无"}`,
      episode.text
    ].join("\n"))
  ].join("\n");
}

async function generateNarrativeMemoryCuration(
  ctx: NarrativeContext,
  run: InternalRunState,
  world: WorldConfig,
  work: NarrativeMemoryCurationWork,
  scopes: NarrativeMemoryCurationWork["scopes"],
  requireEveryScope: boolean
): Promise<NarrativeMemoryCurationResult> {
  const result = await requestNarrativeOutcomeTool(run, world, ctx, memoryCurationTool(work, scopes), memoryCurationPrompt(work, scopes), {
    task: "curation",
    callId: `curation:${run.runId}:${work.revision}`
  });
  const rawDigests = Array.isArray(result.raw.digests) ? result.raw.digests : [];
  const validScopeIds = new Set(scopes.map((scope) => scope.id));
  const digests = rawDigests.map((value) => {
    const entry = value as Record<string, unknown>;
    const id = typeof entry.id === "string" ? entry.id : "";
    const summary = normalizeNarrativeText(entry.summary);
    const ids = (input: unknown): string[] => Array.isArray(input)
      ? Array.from(new Set(input.filter((item): item is string => typeof item === "string" && item !== "none")))
      : [];
    return {
      id,
      summary,
      activeFactIds: ids(entry.activeFactIds),
      historicalFactIds: ids(entry.historicalFactIds),
      characterIds: ids(entry.characterIds)
    };
  }).filter((entry) => validScopeIds.has(entry.id) && entry.summary.length <= 600 && isNarrativePlainText(entry.summary, 1));
  if (!digests.length || (requireEveryScope && !scopes.every((scope) => digests.some((entry) => entry.id === scope.id)))) {
    throw invalidNarrativeOutcome("narrative_curation_scope_missing");
  }
  return { digests };
}

export function scheduleCommittedNarrativeCuration(ctx: NarrativeContext, run: InternalRunState, world: WorldConfig): void {
  const sessionId = ctx.usageScope?.sessionId;
  if (!sessionId || ctx.usageScope?.runId !== run.runId) return;
  const work = prepareNarrativeMemoryCuration(run);
  const key = run.runId;
  if (!work || memoryCuratorJobs.has(key)) return;
  const snapshot = structuredClone(run);
  const runScope = work.scopes.filter((scope) => scope.id === "run");
  const objectScopes = work.scopes.filter((scope) => scope.id !== "run");
  const task = generateNarrativeMemoryCuration(ctx, snapshot, world, work, runScope, true)
    .then(async (result) => {
      const committed = await commitRunMemoryCuration(run.runId, sessionId, work, result);
      if (!committed || !objectScopes.length) return committed;
      try {
        const scoped = await generateNarrativeMemoryCuration(ctx, snapshot, world, work, objectScopes, false);
        await commitRunScopedMemoryCuration(run.runId, sessionId, work, scoped);
      } catch (error) {
        debugError("memory-curator-scoped", error);
      }
      return committed;
    })
    .catch((error) => { debugError("memory-curator", error); return false; })
    .then(async (committed) => {
      memoryCuratorJobs.delete(key);
      if (committed) {
        const latest = await getRun(run.runId);
        if (latest) scheduleCommittedNarrativeCuration(ctx, latest, world);
      }
    })
    .catch((error) => { memoryCuratorJobs.delete(key); debugError("memory-curator", error); });
  memoryCuratorJobs.set(key, task);
}

function compactConversationWindow(_ctx: NarrativeContext, conversation: ChatConversationState): void {
  keepRecentRounds(conversation);
}

function stripMilestoneOptionArtifacts(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (!/选项\s*[ABC]|选项[：:]\s*[ABC]|^[ABC][：:、.]\s*/i.test(normalized)) {
    return normalized;
  }

  const markers = [
    "选项A",
    "选项B",
    "选项C",
    "A：",
    "A:",
    "B：",
    "B:",
    "C：",
    "C:"
  ];
  let cutAt = -1;
  for (const marker of markers) {
    const idx = normalized.indexOf(marker);
    if (idx >= 0 && (cutAt < 0 || idx < cutAt)) {
      cutAt = idx;
    }
  }
  if (cutAt < 0) return normalized;
  return normalized.slice(0, cutAt).trim().replace(/[，、；：,:;]+$/, "。");
}

function isNarrativeNearDuplicate(text: string, candidates: string[]): boolean {
  const normalized = normalizeNarrativeForCompare(text);
  if (!normalized || normalized.length < 24) return false;
  for (const candidate of candidates) {
    const other = normalizeNarrativeForCompare(candidate);
    if (!other || other.length < 24) continue;
    if (normalized === other) return true;
    const minLen = Math.min(normalized.length, other.length);
    if (minLen >= 24 && (normalized.includes(other) || other.includes(normalized))) {
      return true;
    }
  }
  return false;
}

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
  if (!debugModelEnabled()) return;
  const maybe = error as { message?: string; status?: number; code?: string; name?: string; type?: string; reason?: string; error?: unknown };
  console.log(`[model-debug:${tag}:error]`, {
    message: maybe?.message ?? String(error),
    status: maybe?.status,
    code: maybe?.code,
    name: maybe?.name,
    type: maybe?.type,
    reason: maybe?.reason
  });
}

function fallbackLine(event: YearEvent): string {
  if (event.tags.includes("milestone")) return "命运在此刻拐弯。";
  if (event.tags.includes("special")) return "这一年突生变故，你在波折里更稳。";
  return "这一年平静而充实，你也在悄悄成长。";
}

function debugDirectedStoryTurn(
  status: "success" | "truncated" | "invalid" | "error",
  startedAt: number,
  structuredOutput: boolean,
  error?: unknown
): void {
  if (!debugModelEnabled()) return;
  console.log("[model-debug:directed-story-turn]", {
    status,
    elapsedMs: Date.now() - startedAt,
    structuredOutput,
    failure: error
      ? isLikelyStructuredOutputUnsupported(error)
        ? "structured_output_unsupported"
        : isRetryableModelError(error)
          ? "transient"
          : "provider"
      : undefined
  });
}

function buildToolSupportCacheKey(ctx: NarrativeContext): string {
  return `${ctx.providerConfig.baseUrl}|${ctx.providerConfig.model}|${ctx.providerConfig.apiPath}`;
}

export function isDirectedToolAvailable(provider: ProviderConfig): boolean {
  if (provider.apiPath !== "/chat/completions" && provider.apiPath !== "/responses") return false;
  const key = `${provider.baseUrl}|${provider.model}|${provider.apiPath}`;
  return toolSupportCache.get(key) !== false;
}

function isLikelyToolUnsupported(error: unknown): boolean {
  const maybe = error as { status?: number; message?: string; code?: string; type?: string };
  if (maybe?.status !== 400 && maybe?.status !== 404 && maybe?.status !== 422) return false;
  const text = `${maybe?.code ?? ""} ${maybe?.type ?? ""} ${maybe?.message ?? ""}`.toLowerCase();
  return /tool_calls|tools|function calling|function_call|tool choice/.test(text) && /unsupported|unknown|invalid|not found|not permitted/.test(text);
}

function isLikelyToolTranscriptUnsupported(error: unknown): boolean {
  const maybe = error as { status?: number; message?: string; code?: string; type?: string };
  if (maybe?.status !== 400 && maybe?.status !== 422) return false;
  const text = `${maybe?.code ?? ""} ${maybe?.type ?? ""} ${maybe?.message ?? ""}`.toLowerCase();
  return /tool_call_id|role.*tool|messages.*tool|tool_calls.*message/.test(text);
}

function isLikelyTruncated(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return !/[。！？!?…】）)」』]$/.test(t);
}

async function continueNarrative(
  ctx: NarrativeContext,
  systemPrompt: string,
  partialText: string,
  options?: { conversation?: ChatConversationState }
): Promise<ModelCallResult> {
  const continuationPrompt = [
    "T:C 续写收束。",
    "R:C 仅续写20-40字；不复述前文；以句号/问号/叹号结束。",
    `S0 ${compactText(partialText, 180)}`
  ].join("\n");
  return callModel(ctx, systemPrompt, continuationPrompt, {
    mode: "year",
    conversation: options?.conversation,
    usageOperation: "continuation",
    semanticQuery: continuationPrompt
  });
}

function buildSystemPrompt(
  promptPack: PromptPackResolved,
  world: WorldConfig,
  ctx: NarrativeContext,
  mode: SystemPromptMode,
  task?: NarrativeTask
): string {
  const yearMode = mode === "year";
  const milestoneMode = mode === "milestone";
  const endingMode = mode === "ending";
  const worldlineSummary = compactText(ctx.worldlineSummary, endingMode ? 260 : 120);
  const factionSummary = compactPipeSummary(ctx.factionSummary, {
    maxSegments: 3,
    maxSegmentLen: 42,
    maxTotalLen: 160
  });
  const eventPoolSummary = compactPipeSummary(ctx.eventPoolSummary, {
    maxSegments: milestoneMode ? 3 : 1,
    maxSegmentLen: 48,
    maxTotalLen: milestoneMode ? 150 : 72
  });
  const talentHookSummary = compactPipeSummary(ctx.talentHookSummary, {
    maxSegments: 3,
    maxSegmentLen: 40,
    maxTotalLen: 120
  });
  const modeRule = task ? "" : yearMode
    ? compactText(`${promptPack.yearNormalRule} ${promptPack.yearMinorRule}`, 140)
    : milestoneMode
      ? compactText(promptPack.milestoneRule, 140)
      : compactText(promptPack.endingHint, 120);

  const modeAddon = task ? "" : yearMode
    ? compactText(promptPack.factionForeshadowRule, 96)
    : endingMode
      ? "R:E2 只做收束，不扩展新支线；结合本局主线、世界规则与前史说明人物为何走到此处，结果一句带过。"
      : "";

  const worldBackground = [
    compactText(world.name, 24),
    compactText(world.stylePrompt, endingMode ? 96 : 64),
    worldlineSummary,
    !ctx.narrativePlan ? factionSummary : "",
    ctx.narrativePlan?.talents?.length ? "" : talentHookSummary
  ].filter(Boolean).join("；");
  const narrativeBible = ctx.narrativePlan?.storyBible
    ? `世界设定：${compactText(ctx.narrativePlan.storyBible, 260)}`
    : "";
  const narrativeStyle = ctx.narrativePlan?.styleRules.length
    ? `文风要求：${compactText(ctx.narrativePlan.styleRules.join("；"), 220)}`
    : "";

  return [
    "故事正文使用纯文本与自然换行；结构化变化放入对应工具字段。",
    compactText(promptPack.systemCore, 120),
    compactText(promptPack.immersionRules, 100),
    compactText(promptPack.userInputGuardRule, 96),
    compactText(promptPack.restrictedContentRule, 80),
    compactText(promptPack.storyConstraint, 120),
    `世界背景：${worldBackground}`,
    narrativeBible,
    narrativeStyle,
    modeRule ? `本轮要求：${modeRule}` : "",
    modeAddon
  ].filter(Boolean).join("\n");
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
  if (event.tags.includes("safe")) return "risk_safe";
  if (event.tags.includes("balanced")) return "risk_balanced";
  if (event.tags.includes("risky")) return "risk_risky";
  if (event.tags.includes("tone_critical_negative")) return "tone_critical";
  if (event.tags.includes("tone_negative")) return "tone_negative";
  if (event.tags.includes("tone_positive")) return "tone_positive";
  if (event.tags.includes("tone_mixed")) return "tone_mixed";
  if (event.tags.includes("special")) return "event_special";
  if (event.title.includes("平年")) return "event_blank";
  return "event_normal";
}

function summarizeStatsShort(stats: Stats): string {
  return `i${stats.intelligence} c${stats.charisma} f${stats.family} l${stats.fortune} p${stats.physique}`;
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
  if (direction === "steady") return "S0";
  if (direction === "up") {
    if (band === "light") return "U1";
    if (band === "medium") return "U2";
    return "U3";
  }
  if (band === "light") return "D1";
  if (band === "medium") return "D2";
  return "D3";
}

function summarizeDeltaBins(event: YearEvent): string {
  const deltaTags = event.tags
    .filter((t) => t.startsWith("delta_"))
    .map(parseDeltaTag)
    .filter(Boolean) as Array<{ stat: string; direction: "up" | "down" | "steady"; band: "light" | "medium" | "heavy" | "steady" }>;
  if (deltaTags.length === 0) return "none";

  const statLines = deltaTags
    .filter((x) => x.stat !== "overall")
    .map((x) => `${labelStat(x.stat)}=${deltaToneText(x.direction, x.band)}`);

  const overallTags = event.tags.filter((t) => t.startsWith("delta_overall_"));
  const overall = overallTags.length > 0 ? overallTags.join("/") : "delta_overall_unknown";
  return `${statLines.join(";")}|overall=${overall}`;
}

function worldGuidePrompt(event: YearEvent): string {
  const guides = event.tags.filter((t) => t.startsWith("guide_")).slice(0, 2);
  if (guides.length === 0) return "none";
  return guides.join("/");
}

function stageCapPrompt(event: YearEvent): string {
  const tag = getTag(event, "stage_cap_");
  if (!tag) return "none";
  const cap = tag.replace("stage_cap_", "");
  return `cap=${cap}`;
}

function summarizeLatestDecision(run: InternalRunState, event: YearEvent): string {
  const found = [...run.history]
    .reverse()
    .find((item) => item.tags.includes("milestone") && item.age <= event.age);
  if (!found) return "";
  const choice = found.tags.includes("safe")
    ? "safe/稳健"
    : found.tags.includes("balanced")
      ? "balanced/适中"
      : found.tags.includes("risky")
        ? "risky/冒险"
        : "unknown";
  return `age=${found.age} choice=${choice} delta=${formatDelta(found.statChanges as Partial<Record<keyof Stats, number>>)}`;
}

function buildYearPrompt(
  run: InternalRunState,
  event: YearEvent,
  promptPack: PromptPackResolved,
  narrativePlan?: NarrativePromptPlan,
  background?: YearNarrativeOptions["background"]
): string {
  if (background) {
    const livingDetails = background.livingDetails
      .map((detail) => compactText(detail, 64))
      .filter(Boolean)
      .slice(0, 2)
      .join("；");
    return [
      "T:B 人生背景段任务。",
      `S0 ages=${background.ageFrom}-${background.ageTo} stage=${run.ageStage.label} fame=${run.fame}(${fameGrade(run.fame)})`,
      `S1 stats=${summarizeStatsShort(run.stats)} delta=${formatDelta(event.statChanges as Partial<Record<keyof InternalRunState["stats"], number>>)}`,
      `S2 progression_goal=${compactText(background.progressionGoal, 140)}`,
      `S3 aftermath=${compactText(background.aftermath, 120)}`,
      livingDetails ? `S4 lived_details=${livingDetails}` : "",
      `S5 persona=${compactText(run.personaPrompt, 80)}`,
      formatNarrativePromptPlan(narrativePlan),
      "R:B 这是一段承接主线的岁月背景，不是新的独立事件。围绕S2推进，并从S3/S4择一两项落到人物行动、关系或心境。",
      "R:B 不得复述内部标签、标题、数值、路线或规则；不得凭空开启新主线；主线未完成时不得写结局式收束。",
      "R:BOUT 只输出一段90-140字的自然叙事，不写标题、年份清单、选项或创作说明。"
    ].filter(Boolean).join("\n");
  }
  const cards = run.cards.map((c) => `${c.name}(${c.rarity})`).join("、") || "无";
  const rule = event.tags.includes("special")
    ? promptPack.yearMinorRule
    : promptPack.yearNormalRule;
  const milestoneGuard = event.tags.includes("milestone")
    ? "R:YM 本轮仅年度叙事，禁止输出A/B/C选项与选项字样。"
    : "";
  const eventTitle = event.title.replace(/^\d+岁[·\s]*/, "").trim();
  const recent = summarizeRecent(run.history.slice(-3));
  const latestDecision = summarizeLatestDecision(run, event);

  const isMilestoneYear = event.tags.includes("milestone");
  const yearLenRule = isMilestoneYear
    ? "R:YLEN 60-80字；只保留一种表达，不做同义重复解释。"
    : `R:YLEN 用${SHORT_YEAR_MIN_CHARS}-${SHORT_YEAR_MAX_CHARS}字，根据E0与S1总结本年变化；保留一条主线，不铺陈，不复述。`;

  return [
    "T:Y 年度叙事任务。",
    `S0 age=${event.age} stage=${run.ageStage.label} fame=${run.fame}(${fameGrade(run.fame)}) risk=${riskLevelFromEvent(event)}`,
    `S1 stats=${summarizeStatsShort(run.stats)} delta=${formatDelta(event.statChanges as Partial<Record<keyof InternalRunState["stats"], number>>)}`,
    `S2 bins=${summarizeDeltaBins(event)} stage=${stageCapPrompt(event)} guide=${worldGuidePrompt(event)}`,
    `S3 cards=${compactText(cards, 48)} blank=${hasBlankYears(run.history.slice(-12)) ? "Y" : "N"} blankLog=${compactText(summarizeBlankYears(run.history.slice(-12)), 36)}`,
    `S4 persona=${compactText(run.personaPrompt, 80)}`,
    recent ? `S5 recent=${compactText(recent, 90)}` : "",
    latestDecision ? `S6 decision=${compactText(latestDecision, 64)}` : "",
    `E0 title=${compactText(eventTitle, 24)} summary=${compactText(event.summary, 54)}`,
    formatNarrativePromptPlan(narrativePlan),
    run.narrative.enabled && !run.story.mainlineCompleted
      ? "R:YEND 主线尚未完成；不得暗示故事、人生或命运即将结束，也不得写结局式收束。"
      : "",
    yearLenRule,
    `R:YMAIN 先写本年关键变化，再点出直接后果。`,
    `R:YAGE 若出现年龄词，必须与S0一致，只能写${event.age}岁；禁止写上一年或下一年。`,
    `R:YOUT 只输出最终叙事文本。`,
    `R:YRULE ${compactText(rule, 120)}`,
    milestoneGuard,
    "R:YREP 不得复用近年完整句，尤其相同开头或收束句。"
  ].join("\n");
}

function buildYearDedupeRetryPrompt(
  basePrompt: string,
  duplicatedText: string,
  avoidNarratives: string[]
): string {
  const compareSamples = avoidNarratives
    .slice(-2)
    .map((line, idx) => `S${idx + 1}:${compactText(line, 42)}`)
    .join(" | ");
  return [
    basePrompt,
    "R0 去重重写：保留当年事件与属性变化语义，但换句式与动作。",
    compareSamples ? `R1 对比样本:${compareSamples}` : "",
    `R2 上版禁复用:${compactText(duplicatedText, 72)}`,
    `R3 长度${SHORT_YEAR_MIN_CHARS}-${SHORT_YEAR_MAX_CHARS}字；只输出重写后文本。`
  ].filter(Boolean).join("\n");
}

function buildMilestoneOptionsPrompt(
  run: InternalRunState,
  recent: YearEvent[],
  promptPack: PromptPackResolved,
  narrativePlan?: NarrativePromptPlan
): string {
  return [
    "T:M 抉择节点任务。",
    `S0 age=${run.age} stage=${run.ageStage.label} fame=${run.fame}(${fameGrade(run.fame)})`,
    `S1 stats=${summarizeStatsShort(run.stats)} blank=${hasBlankYears(run.history.slice(-12)) ? "Y" : "N"}`,
    `S2 persona=${compactText(run.personaPrompt, 80)}`,
    `S3 recent=${compactText(summarizeRecent(recent.slice(-4)), 120)}`,
    formatNarrativePromptPlan(narrativePlan),
    `R:M ${compactText(promptPack.milestoneRule, 120)}`,
    "R:MOUT 只返回JSON:{background,optionOverrides[3]}",
    "R:MLEN background 60-80字；description <=20字；仅一种表达，不做同义复述。"
  ].join("\n");
}

function shrinkPromptText(text: string, maxLen: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLen - 1))}…`;
}

function endingBriefText(brief: NarrativeEndingBrief): string {
  return `结局定性=${brief.polarity}；人生主题=${brief.lifeTheme}；完成之事=${brief.achievement}；付出代价=${brief.cost}；留下影响=${brief.legacy}`;
}

function endingAnchorCatalog(run: InternalRunState): Array<{ id: string; label: string }> {
  const anchors: Array<{ id: string; label: string }> = [];
  if (run.outcome === "dead") anchors.push({ id: "death:cause", label: `死因：${run.deathCause ?? "意外"}` });
  anchors.push(...run.narrative.actCanon.slice(-3).map((canon) => ({
    id: `canon:${canon.actId}`,
    label: `${canon.resolvedTension}；${canon.lastingConsequence}`
  })));
  anchors.push(...(run.story.factLedger?.facts ?? []).filter((fact) => fact.status === "resolved").slice(-4).map((fact) => ({
    id: `fact:${fact.id}`,
    label: fact.resolutionSummary ?? fact.label
  })));
  anchors.push(...run.narrative.dynamicCharacters.filter((character) => character.importance !== "momentary").slice(-3).map((character) => ({
    id: `character:${character.id}`,
    label: `${character.name}：${character.relationship?.summary ?? character.description}`
  })));
  return anchors.filter((anchor, index, all) => all.findIndex((entry) => entry.id === anchor.id) === index).slice(-12);
}

function endingBriefTool(run: InternalRunState, anchors: Array<{ id: string; label: string }>): Record<string, unknown> {
  const anchorIds = anchors.length ? anchors.map((anchor) => anchor.id) : ["none"];
  const polarity = run.narrative.endingPolarity ?? "bad";
  return {
    type: "function",
    function: {
      name: "distill_life_verdict",
      description: "把已经锁定的游戏结局提炼为一次人生评价提要，不改变引擎裁定。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["polarity", "lifeTheme", "achievement", "cost", "legacy", "anchorIds"],
        properties: {
          polarity: { type: "string", enum: [polarity] },
          lifeTheme: { type: "string", minLength: 2, maxLength: 120 },
          achievement: { type: "string", minLength: 2, maxLength: 180 },
          cost: { type: "string", minLength: 2, maxLength: 180 },
          legacy: { type: "string", minLength: 2, maxLength: 180 },
          anchorIds: { type: "array", maxItems: 3, items: { type: "string", enum: anchorIds } }
        }
      }
    }
  };
}

async function ensureEndingBrief(run: InternalRunState, world: WorldConfig, ctx: NarrativeContext): Promise<NarrativeEndingBrief> {
  if (run.narrative.endingBrief && run.narrative.endingBrief.polarity === run.narrative.endingPolarity) {
    return run.narrative.endingBrief;
  }
  const anchors = endingAnchorCatalog(run);
  const prompt = [
    `引擎已锁定结局=${run.narrative.endingPolarity ?? "bad"}；人生终点=${run.age}岁；名望=${run.fame}。`,
    `最终属性=${summarizeStatsShort(run.stats)}；天赋=${run.cards.map((card) => card.name).join("、") || "无"}。`,
    anchors.length ? `可引用的人生锚点：${anchors.map((anchor) => `${anchor.id}=${compactText(anchor.label, 100)}`).join(" | ")}` : "本局没有额外锚点。",
    run.outcome === "dead" ? `死亡事实必须保留：${run.deathCause ?? "意外"}。` : "",
    "提炼其一生完成了什么、付出什么、留下什么。只调用 distill_life_verdict，不展开场景，不续写新剧情。"
  ].filter(Boolean).join("\n");
  const result = await requestNarrativeOutcomeTool(run, world, ctx, endingBriefTool(run, anchors), prompt, {
    task: "closure",
    callId: `${ctx.callId ?? `ending:${run.runId}:${run.age}`}:brief`,
    source: "closure"
  });
  const raw = result.raw;
  const validIds = new Set(anchors.map((anchor) => anchor.id));
  const selectedAnchorIds = Array.isArray(raw.anchorIds)
    ? Array.from(new Set(raw.anchorIds.filter((id): id is string => typeof id === "string" && validIds.has(id)))).slice(0, 3)
    : [];
  if (run.outcome === "dead" && validIds.has("death:cause") && !selectedAnchorIds.includes("death:cause")) {
    selectedAnchorIds.unshift("death:cause");
    selectedAnchorIds.splice(3);
  }
  const brief: NarrativeEndingBrief = {
    polarity: run.narrative.endingPolarity ?? "bad",
    lifeTheme: normalizeNarrativeText(raw.lifeTheme),
    achievement: normalizeNarrativeText(raw.achievement),
    cost: normalizeNarrativeText(raw.cost),
    legacy: normalizeNarrativeText(raw.legacy),
    anchorIds: selectedAnchorIds,
    createdAt: Date.now()
  };
  if (![brief.lifeTheme, brief.achievement, brief.cost, brief.legacy].every((value) => isNarrativePlainText(value, 2)) ||
      (run.outcome === "dead" && !brief.anchorIds.includes("death:cause"))) {
    throw invalidNarrativeOutcome("ending_brief_invalid");
  }
  run.narrative.endingBrief = brief;
  return brief;
}

function buildEndingPrompt(run: InternalRunState, brief?: NarrativeEndingBrief): string {
  const legacyAscensionInfo = !run.narrative.enabled && run.ascension.unlocked
    ? `${run.ascension.title ?? "未知称号"} / ${run.ascension.type ?? "unknown"} / ${run.ascension.unlockedAge ?? run.age}岁`
    : "";
  const endingQuality = run.narrative.endingPolarity === "good"
    ? "好结局：人物克服主要代价，留下明确且可被后人承接的成果。"
    : run.narrative.endingPolarity === "normal"
      ? "普通结局：人物完成主线但保留真实遗憾，收获有限而可信。"
      : "坏结局：人物完成主线却未能化解核心代价，不得将其写成死亡。";
  const outcomeRule = run.outcome === "dead"
    ? "必须明确死亡原因，不得改写死亡年龄与名望。"
    : run.outcome === "ascended"
      ? "必须点明飞升称号或类型；重点写原因而非结果：结合系统BG中的世界背景、主线冲突、阶段目标，以及最近经历/属性/天赋，解释为何此人会走到飞升；结果一句带过并写出代价或余韵。"
      : run.outcome === "completed"
        ? `必须按引擎锁定的${endingQuality}写出人生收束与总体评价；不得更改结局等级，不得把坏结局擅自写成死亡，也不得新增支线。`
        : "必须点明人生收束与总体评价。";
  return [
    "T:E 结局收束任务。",
    `S0 type=${run.outcome} age=${run.age} fame=${run.fame}(${fameGrade(run.fame)}) ending=${run.narrative.endingPolarity ?? "none"} score=${run.narrative.endingScore ?? "none"}`,
    `S1 stats=${summarizeStatsShort(run.stats)} death=${compactText(run.deathCause ?? "none", 32)}${legacyAscensionInfo ? ` asc=${compactText(legacyAscensionInfo, 56)}` : ""}`,
    brief ? `S2 ${endingBriefText(brief)}` : "S2 人生评价提要已在本次上下文中给出。",
    `R:E ${outcomeRule}`,
    "R:ELEN 120-180字，最多240字，2-4句；这是对一生的评价，不复述逐幕案情，不罗列事实，不开启新事件。"
  ].join("\n");
}

function isRetryableModelError(error: unknown): boolean {
  const maybe = error as {
    status?: number;
    code?: string;
    name?: string;
    type?: string;
    message?: string;
  };
  const status = maybe?.status;
  if (status === 408 || status === 409 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }

  const code = String(maybe?.code ?? "").toUpperCase();
  if (
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_BODY_TIMEOUT"
  ) {
    return true;
  }

  const name = String(maybe?.name ?? "");
  const type = String(maybe?.type ?? "");
  const message = String(maybe?.message ?? "");
  return /timeout|api.?connection|connect|network|fetch|abort/i.test(`${name} ${type} ${message}`);
}

function isLikelyStructuredOutputUnsupported(error: unknown): boolean {
  const maybe = error as { status?: number; message?: string; code?: string; type?: string };
  if (maybe?.status !== 400 && maybe?.status !== 422) return false;
  const text = `${maybe?.code ?? ""} ${maybe?.type ?? ""} ${maybe?.message ?? ""}`.toLowerCase();
  const namesStructuredOutput = /response_format|json_schema|json schema|structured output|json mode/.test(text);
  const rejectsStructuredOutput = /unsupported|not support|unknown|invalid|not permitted/.test(text);
  return namesStructuredOutput && rejectsStructuredOutput;
}

function isLikelyReasoningEffortUnsupported(error: unknown): boolean {
  const maybe = error as { status?: number; message?: string; code?: string; type?: string };
  if (maybe?.status !== 400 && maybe?.status !== 422) return false;
  const text = `${maybe?.code ?? ""} ${maybe?.type ?? ""} ${maybe?.message ?? ""}`.toLowerCase();
  return text.includes("reasoning_effort") || text.includes("reasoning effort");
}

function isLikelyThinkingUnsupported(error: unknown): boolean {
  const maybe = error as { status?: number; message?: string; code?: string; type?: string };
  if (maybe?.status !== 400 && maybe?.status !== 422) return false;
  const text = `${maybe?.code ?? ""} ${maybe?.type ?? ""} ${maybe?.message ?? ""}`.toLowerCase();
  if (!text.includes("thinking")) return false;
  return (
    text.includes("unsupported") ||
    text.includes("invalid") ||
    text.includes("not permitted") ||
    text.includes("unknown")
  );
}

function reasoningEffortForSdk(
  value: ProviderConfig["reasoningEffort"] | undefined
): "low" | "medium" | "high" {
  const normalized = (value ?? "minimal").toLowerCase();
  if (normalized === "high") return "high";
  if (normalized === "medium") return "medium";
  return "low";
}

async function callModel(
  ctx: NarrativeContext,
  systemPrompt: string,
  userPrompt: string,
  options?: CallModelOptions & {
    mode?: SystemPromptMode;
    semanticQuery?: string;
    skipCache?: boolean;
  }
): Promise<ModelCallResult> {
  const mode = options?.mode ?? "year";
  const usageOperation = options?.usageOperation ?? "narrative";
  const canUseLocalPromptCache = !options?.skipCache;
  const semanticQuery = options?.semanticQuery ?? userPrompt;
  const convo = options?.conversation;
  const systemMessage = convo ? buildSystemMessage(convo) : systemPrompt;
  const cacheKey = buildPromptCacheKey(
    ctx.providerConfig,
    systemMessage,
    userPrompt
  );
  if (canUseLocalPromptCache) {
    const semanticHit = readSemanticCache(ctx.providerConfig, mode, hashSystemPrompt(systemMessage), semanticQuery);
    if (semanticHit !== null) {
      if (debugModelEnabled()) {
        console.log("[model-debug:semantic-cache-hit]", { len: semanticHit.length, mode });
      }
      recordProviderUsage(ctx, usageOperation, "chat", { cacheHit: true, durationMs: 0 });
      return { text: semanticHit, truncated: false };
    }
    const cached = readPromptCache(cacheKey);
    if (cached !== null) {
      if (debugModelEnabled()) {
        console.log("[model-debug:cache-hit]", { len: cached.length });
      }
      recordProviderUsage(ctx, usageOperation, "chat", { cacheHit: true, durationMs: 0 });
      return { text: cached, truncated: false };
    }
  }

  const client = getOpenAIClient(ctx);

  const attempt = async (): Promise<ModelCallResult> => {
    const historyMessages = options?.historyMessages ?? (convo ? buildConversationPromptMessages(convo) : []);
    const requestBase = {
      model: ctx.providerConfig.model,
      temperature: ctx.providerConfig.temperature,
      max_tokens: ctx.providerConfig.maxTokens,
      response_format: options?.structuredOutput
        ? {
            type: "json_schema" as const,
            json_schema: {
              name: options.structuredOutput.name,
              description: options.structuredOutput.description,
              schema: options.structuredOutput.schema,
              strict: true
            }
          }
        : options?.jsonMode
          ? { type: "json_object" as const }
          : undefined,
      messages: [
        { role: "system" as const, content: systemMessage },
        ...historyMessages,
        { role: "user" as const, content: userPrompt }
      ]
    };
    const reasoningEffort = reasoningEffortForSdk(ctx.providerConfig.reasoningEffort);
    const requestVariants: Array<Record<string, unknown>> = [
      {
        ...requestBase,
        thinking: { type: "disabled" }
      },
      {
        ...requestBase,
        thinking: { type: "disabled" },
        reasoning_effort: reasoningEffort
      },
      {
        ...requestBase,
        reasoning_effort: reasoningEffort
      },
      {
        ...requestBase
      }
    ];
    let chat: OpenAI.Chat.Completions.ChatCompletion | null = null;
    let lastVariantError: unknown = null;
    for (const payload of requestVariants) {
      try {
        chat = await createTrackedChatCompletion(ctx, client, payload as never, usageOperation);
        break;
      } catch (error) {
        lastVariantError = error;
        if (isLikelyThinkingUnsupported(error) || isLikelyReasoningEffortUnsupported(error)) {
          continue;
        }
        throw error;
      }
    }
    if (!chat) {
      throw lastVariantError ?? new Error("chat_completion_request_failed");
    }

    const content = chat.choices[0]?.message?.content;
    let text = "";
    if (typeof content === "string") {
      text = content.trim();
    } else if (Array.isArray(content)) {
      const parts = content as ChatContentPart[];
      text = parts.map((part) => part.text ?? "").join("").trim();
    }
    const finishReason = chat.choices[0]?.finish_reason ?? undefined;
    const truncated = finishReason === "length";
    return {
      text,
      truncated,
      truncateReason: finishReason
    };
  };

  let lastError: unknown;
  const backoffMs = [300, 900, 1800];
  for (let i = 0; i < backoffMs.length + 1; i += 1) {
    try {
      const result = await attempt();
      if (canUseLocalPromptCache) {
        writePromptCache(cacheKey, result.text);
        writeSemanticCache(
          ctx.providerConfig,
          mode,
          hashSystemPrompt(systemMessage),
          semanticQuery,
          result.text
        );
      }
      return result;
    } catch (error) {
      lastError = error;
      const shouldRetry = isRetryableModelError(error);
      if (!shouldRetry || i >= backoffMs.length) break;
      await new Promise((resolve) => setTimeout(resolve, backoffMs[i]));
    }
  }
  throw lastError;
}

async function callModelAsJson(
  ctx: NarrativeContext,
  systemPrompt: string,
  userPrompt: string,
  structuredOutput: StructuredOutputSpec,
  options: {
    mode: SystemPromptMode;
    conversation?: ChatConversationState;
    semanticQuery: string;
    skipCache: boolean;
    usageOperation?: ModelUsageOperation;
  }
): Promise<{ result: ModelCallResult; outputMode: JsonOutputMode }> {
  const supportKey = buildToolSupportCacheKey(ctx);
  let outputMode = structuredOutputSupportCache.get(supportKey) ?? "json-schema";
  while (true) {
    try {
      const result = await callModel(ctx, systemPrompt, userPrompt, {
        ...options,
          structuredOutput: outputMode === "json-schema" ? structuredOutput : undefined,
          jsonMode: outputMode === "json-object",
          usageOperation: options.usageOperation
      });
      structuredOutputSupportCache.set(supportKey, outputMode);
      return { result, outputMode };
    } catch (error) {
      if (outputMode === "plain" || !isLikelyStructuredOutputUnsupported(error)) throw error;
      outputMode = outputMode === "json-schema" ? "json-object" : "plain";
      structuredOutputSupportCache.set(supportKey, outputMode);
    }
  }
}

function directedFocusToolDefinition(focusTags: string[]): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: "select_event_focus",
      description: "选择本年最适合人物处境和故事阶段的事件方向。具体事件由引擎从该方向中确定。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["focusTag"],
        properties: {
          focusTag: { type: "string", enum: focusTags }
        }
      }
    }
  };
}

function directedStoryTools(input: DirectedStoryTurnInput): Record<string, unknown>[] {
  if (input.closureRequired) {
    return [{
      type: "function",
      function: {
        name: "request_story_closure",
        description: "主线已经完成。请求由引擎锁定结局蓝图并进入结算。",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: [],
          properties: {}
        }
      }
    }];
  }
  const argumentProperties: Record<string, unknown> = {
    intent: { type: "string", enum: input.allowedIntents },
    routeId: {
      type: "string",
      enum: input.routeOptions.map((option) => option.id),
      description: "从当前世界提供的路线目录中选择一个路线 ID。"
    }
  };
  if (input.focusOptions?.length) {
    argumentProperties.focusComponentId = {
      type: "string",
      enum: input.focusOptions.map((option) => option.id)
    };
  }
  if (input.allowScenePacing) {
    argumentProperties.scenePacing = { type: "string", enum: ["continuous", "spanning"] };
  }
  const tools: Record<string, unknown>[] = [
    {
      type: "function",
      function: {
        name: "propose_story_intent",
        description: "从世界路线目录中选择本段经历，并提出下一段故事的叙事意图。具体素材由世界数据提供。",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["intent", "routeId"],
          properties: argumentProperties
        }
      }
    }
  ];
  if (input.allowClosureRequest) {
    tools.push({
      type: "function",
      function: {
        name: "request_story_closure",
        description: "仅当已有主线冲突完成回收时，申请由引擎审查是否进入结局引导。",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: [],
          properties: {}
        }
      }
    });
  }
  return tools;
}

function directedStoryResponseTools(input: DirectedStoryTurnInput): Record<string, unknown>[] {
  return directedStoryTools(input).map((tool) => {
    const functionTool = tool.function as {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
    return {
      type: "function",
      name: functionTool.name,
      description: functionTool.description,
      parameters: functionTool.parameters,
      strict: true
    };
  });
}

function directedStoryRenderTool(input: DirectedStoryRenderInput): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    narrative: { type: "string" }
  };
  const required = ["narrative"];
  if (input.kind === "normal" && input.attributePolicy) {
    properties.effects = narrativeEffectsSchema(input.attributePolicy);
    required.push("effects");
  }
  if (input.kind === "milestone") {
    properties.background = { type: "string" };
    properties.optionOverrides = {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "description"],
        properties: {
          id: { type: "string", enum: ["safe", "balanced", "risky"] },
          label: { type: "string" },
          description: { type: "string" }
        }
      }
    };
    required.push("background", "optionOverrides");
  }
  return {
    type: "function",
    function: {
      name: "render_story_turn",
      description: input.kind === "milestone"
        ? "提交已批准抉择场景的正文、背景和三个玩家可见选项。"
        : "提交已批准故事场景的玩家可见正文。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required,
        properties
      }
    }
  };
}

function directedStoryRenderResponseTool(input: DirectedStoryRenderInput): Record<string, unknown> {
  const tool = directedStoryRenderTool(input).function as {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: true
  };
}

function narrativeOriginOutcomeTool(): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: "render_origin",
      description: "提交身世正文与精炼的身世摘要。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["narrative", "summary"],
        properties: {
          narrative: { type: "string", minLength: 80, maxLength: 560 },
          summary: { type: "string", minLength: 20, maxLength: 180 },
          seedHints: {
            type: "array",
            minItems: 0,
            items: { type: "string", minLength: 1 }
          }
        }
      }
    }
  };
}

export function narrativeDecisionOutcomeTool(policy: NarrativeAttributePolicy, factResolutionModes?: NarrativeFactResolution[]): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: "resolve_decision_outcome",
      description: "提交玩家抉择已经造成的受控属性、事实、关系与叙事资产变化；不写玩家正文。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["effects", ...(factResolutionModes?.length ? ["factResolution"] : [])],
        properties: {
          ...(factResolutionModes?.length ? { factResolution: { type: "string", enum: factResolutionModes } } : {}),
          effects: narrativeEffectsSchema(policy)
        }
      }
    }
  };
}

export function narrativeDecisionRenderTool(): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: "render_decision_outcome",
      description: "依据已经审批的抉择结算写玩家可见正文，不新增或修改结构化结果。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["narrative"],
        properties: {
          narrative: { type: "string", minLength: 10, maxLength: 600 }
        }
      }
    }
  };
}

type DynamicNarrativeToolName = "resolve_background_outcome" | "resolve_scene_outcome" | "resolve_choice_scene";
type DynamicNarrativeRenderToolName = "render_background_prose" | "render_scene_prose" | "render_choice_prose";

interface DynamicNarrativeToolSet {
  tools: Record<string, unknown>[];
  names: DynamicNarrativeToolName[];
}

export function dynamicNarrativeSceneTools(input: DynamicNarrativeSceneInput): DynamicNarrativeToolSet {
  const factionIds = input.plan?.factionId ? [input.plan.factionId] : input.factions.map((faction) => faction.id);
  const characterRefs = ["new", ...input.knownCharacters.map((character) => character.id)];
  const effectsSchema = narrativeEffectsSchema;
  const participants = {
    type: "array",
    maxItems: 3,
    items: {
      type: "object",
      additionalProperties: false,
      required: ["characterRef"],
      description: "已有角色只需characterRef；可提交本轮description或relationship变化。新角色用new，并填写name、factionId、role、description、recurring。",
      properties: {
        characterRef: { type: "string", enum: characterRefs },
        name: { type: "string" },
        factionId: { type: "string", enum: factionIds },
        role: { type: "string" },
        description: { type: "string" },
        recurring: { type: "boolean" },
        relationship: {
          type: "object",
          description: "仅在本段改变该常驻人物对主角的态度时提交。",
          additionalProperties: false,
          required: ["stance", "summary"],
          properties: {
            stance: { type: "string", enum: relationshipStances },
            summary: { type: "string", minLength: 1, maxLength: 160 }
          }
        }
      }
    }
  };
  const scenePacing = {
    type: "string",
    enum: input.plan
      ? [input.plan.clockRequest === "hold" ? "continuous" : "spanning"]
      : ["none", "continuous", "spanning"]
  };
  const actHandoff = {
    type: "object",
    description: "本幕收束时记录实际形成的结果与人物的新处境。仍待完成的承诺或问题通过 factUpdates 同步。",
    additionalProperties: false,
    required: ["resolvedTension", "lastingConsequence", "continuation"],
    properties: {
      resolvedTension: { type: "string", minLength: 1, maxLength: 180, description: "本幕矛盾实际如何落定，包括成功、妥协或失败。" },
      lastingConsequence: { type: "string", minLength: 1, maxLength: 180, description: "已经发生并持续影响人物的得失与变化。" },
      continuation: { type: "string", minLength: 1, maxLength: 180, description: "由此形成的新处境与发展可能，作为后续经历的起点。" }
    }
  };
  const sceneTask = [
    input.storyArc,
    `${input.act.label}：${input.act.prompt}`,
    `本次场景节拍：${input.beat}。`,
    input.act.factLabel ? `本幕处境：${input.act.factLabel}` : "",
    input.beat === "setup" ? "开场以世界变化、见闻与他人处境进入人物生活。" : "",
    input.beat === "payoff" ? "呈现本幕事情的实际结果，以及人物由此形成的生活处境。" : ""
  ].filter(Boolean).join("\n");
  const backgroundTool: Record<string, unknown> = {
    type: "function",
    function: {
      name: "resolve_background_outcome",
      description: "提交这段普通人生背景已经形成的成长与记忆变化，不写玩家正文。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["effects"],
        properties: {
          effects: effectsSchema(input.backgroundAttributePolicy)
        }
      }
    }
  };
  const sceneTool = (attributePolicy: NarrativeAttributePolicy): Record<string, unknown> => ({
    type: "function",
    function: {
      name: "resolve_scene_outcome",
      description: `提交本次场景已经形成的结构化结果，不写玩家正文。\n${sceneTask}`,
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["scenePacing", "participants", "effects", ...(input.beat === "payoff" ? ["actHandoff"] : [])],
        properties: {
          scenePacing,
          participants,
          effects: effectsSchema(attributePolicy),
          actHandoff
        }
      }
    }
  });
  const choiceSceneTool: Record<string, unknown> = {
    type: "function",
    function: {
      name: "resolve_choice_scene",
      description: `提交抉择出现前已经形成的场景状态，不结算尚未选择的行动，也不写玩家正文。\n${sceneTask}`,
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["scenePacing", "participants"],
        properties: {
          scenePacing,
          participants
        }
      }
    }
  };
  const tools: Record<string, unknown>[] = [];
  const names: DynamicNarrativeToolName[] = [];
  if (input.allowedTurnKinds.includes("background") && input.presentation === "summary") {
    tools.push(backgroundTool);
    names.push("resolve_background_outcome");
  }
  if (input.allowedTurnKinds.includes("scene")) {
    if (input.attributePolicy && input.presentation === "scene") {
      tools.push(sceneTool(input.attributePolicy));
      names.push("resolve_scene_outcome");
    }
    if (input.presentation === "choice") {
      tools.push(choiceSceneTool);
      names.push("resolve_choice_scene");
    }
  }
  return { tools, names };
}

function dynamicNarrativeRenderTool(input: DynamicNarrativeSceneInput): { tool: Record<string, unknown>; name: DynamicNarrativeRenderToolName } {
  const optionOverrides = {
    type: "array", minItems: 3, maxItems: 3,
    description: "safe、balanced、risky各对应一个选项，分别表达稳健、权衡和冒险；每个ID只出现一次。",
    items: {
      type: "object", additionalProperties: false, required: ["id", "label", "description"],
      properties: {
        id: { type: "string", enum: ["safe", "balanced", "risky"] },
        label: { type: "string" }, description: { type: "string" }
      }
    }
  };
  const name: DynamicNarrativeRenderToolName = input.presentation === "summary"
    ? "render_background_prose"
    : input.presentation === "choice"
      ? "render_choice_prose"
      : "render_scene_prose";
  const choice = input.presentation === "choice";
  return {
    name,
    tool: {
      type: "function",
      function: {
        name,
        description: choice ? "依据已审批场景写玩家可见的抉择背景与三个选项。" : "依据已审批结果写玩家可见正文。",
        parameters: {
          type: "object", additionalProperties: false,
          required: ["narrative", ...(choice ? ["background", "optionOverrides"] : [])],
          properties: {
            narrative: { type: "string", minLength: 10 },
            ...(choice ? { background: { type: "string", minLength: 10 }, optionOverrides } : {})
          }
        }
      }
    }
  };
}

function responseTool(tool: Record<string, unknown>): Record<string, unknown> {
  const functionTool = tool.function as { name: string; description: string; parameters: Record<string, unknown> };
  return { type: "function", name: functionTool.name, description: functionTool.description, parameters: functionTool.parameters, strict: true };
}

function findResponseFunctionCall(
  response: { output?: unknown[] },
  toolName: string
): { toolCall: ToolCallRecord; rawArguments: unknown } | null {
  const call = response.output?.find((item) => {
    const value = item as { type?: unknown; name?: unknown };
    return value.type === "function_call" && value.name === toolName;
  }) as { call_id?: unknown; name?: unknown; arguments?: unknown } | undefined;
  if (!call || typeof call.call_id !== "string" || call.name !== toolName) return null;
  const argumentsText = normalizeToolArguments(call.arguments);
  return {
    toolCall: {
      id: normalizeChatText(call.call_id, CHAT_TOOL_CALL_ID_MAX_LEN),
      name: toolName,
      arguments: argumentsText
    },
    rawArguments: call.arguments
  };
}

function parseDirectedToolArguments(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string") return null;

  let source = raw.trim();
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) source = fenced[1].trim();
  if (!source) return null;

  try {
    let parsed: unknown = JSON.parse(source);
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function directedToolArgumentsFailure(raw: unknown): { reason: string; validation: NarrativeValidationIssue } {
  if (typeof raw !== "string" || !raw.trim()) {
    return {
      reason: "tool_contract_invalid",
      validation: { rule: "object_required", path: "arguments", received: raw === null ? "null" : typeof raw }
    };
  }
  let source = raw.trim();
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) source = fenced[1].trim();
  try {
    let parsed: unknown = JSON.parse(source);
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    return {
      reason: "tool_contract_invalid",
      validation: { rule: "object_required", path: "arguments", received: Array.isArray(parsed) ? "array" : typeof parsed }
    };
  } catch (error) {
    return {
      reason: "tool_arguments_json_invalid",
      validation: {
        rule: "json_parse_error",
        path: "arguments",
        received: error instanceof Error ? error.message.slice(0, 180) : "invalid_json"
      }
    };
  }
}

function findDirectedToolCall(
  message: unknown,
  toolName: string
): { toolCall: ToolCallRecord; rawArguments: unknown } | null {
  const value = message as {
    tool_calls?: Array<{
      id?: unknown;
      type?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    }>;
    function_call?: { name?: unknown; arguments?: unknown };
  };
  const call = Array.isArray(value?.tool_calls)
    ? value.tool_calls.find((item) => item.function?.name === toolName)
    : undefined;
  if (call?.function) {
    const argumentsText = normalizeToolArguments(call.function.arguments);
    const id = normalizeChatText(
      typeof call.id === "string" ? call.id : `director_${createHash("sha256").update(`${toolName}:${argumentsText}`).digest("hex").slice(0, 16)}`,
      CHAT_TOOL_CALL_ID_MAX_LEN
    );
    return {
      toolCall: { id, name: toolName, arguments: argumentsText },
      rawArguments: call.function.arguments
    };
  }
  if (value?.function_call?.name === toolName) {
    const argumentsText = normalizeToolArguments(value.function_call.arguments);
    return {
      toolCall: {
        id: `director_${createHash("sha256").update(`${toolName}:${argumentsText}`).digest("hex").slice(0, 16)}`,
        name: toolName,
        arguments: argumentsText
      },
      rawArguments: value.function_call.arguments
    };
  }
  return null;
}

function readDirectedFocusSelection(raw: unknown, focusTags: string[]): string | null {
  const parsed = parseDirectedToolArguments(raw);
  if (!parsed) return null;
  const focusTag = typeof parsed.focusTag === "string" ? parsed.focusTag.trim() : "";
  return focusTags.includes(focusTag) ? focusTag : null;
}

function readDirectedStoryIntent(
  raw: unknown,
  input: DirectedStoryTurnInput
): Pick<DirectedStoryTurnResult, "intent" | "routeId" | "focusComponentId" | "scenePacing"> | null {
  const parsed = parseDirectedToolArguments(raw);
  if (!parsed) return null;
  const intent = typeof parsed.intent === "string" ? parsed.intent.trim() as NarrativeIntent : undefined;
  if (!intent || !input.allowedIntents.includes(intent)) return null;
  const routeId = typeof parsed.routeId === "string" ? parsed.routeId.trim() : "";
  const routeOption = input.routeOptions.find((option) => option.id === routeId);
  if (!routeOption) return null;
  const rawFocus = typeof parsed.focusComponentId === "string" ? parsed.focusComponentId.trim() : "";
  const focusComponentId = input.focusOptions?.some((option) => option.id === rawFocus)
    ? rawFocus
    : undefined;
  const scenePacing = input.allowScenePacing && (parsed.scenePacing === "continuous" || parsed.scenePacing === "spanning")
    ? parsed.scenePacing
    : undefined;
  return { intent, routeId, focusComponentId, scenePacing };
}

function directedStoryToolCallId(toolName: string, argumentsText: string, nonce: string): string {
  return normalizeChatText(
    `story_${createHash("sha256").update(`${toolName}:${argumentsText}:${nonce}`).digest("hex").slice(0, 20)}`,
    CHAT_TOOL_CALL_ID_MAX_LEN
  );
}

function parseDirectedMilestoneNarrative(text: string): DirectedNarrativeResult | null {
  const cleaned = stripCodeFence(text);
  const candidates = [cleaned, extractFirstJsonObject(cleaned)].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as {
        narrative?: unknown;
        background?: unknown;
        optionOverrides?: unknown;
      };
      const narrative = typeof parsed.narrative === "string" ? parsed.narrative.trim() : "";
      if (narrative.length < 10 || isLikelyTruncated(narrative)) continue;
      const optionOverrides = normalizeMilestoneOptionOverrides(parsed.optionOverrides);
      const background = typeof parsed.background === "string" ? parsed.background.trim() : "";
      return {
        narrative,
        milestoneCopy: optionOverrides && background
          ? { background, optionOverrides }
          : undefined
      };
    } catch {
      // Try the next JSON candidate.
    }
  }
  return null;
}

function buildDirectedNarrativePrompt(
  run: InternalRunState,
  input: DirectedNarrativeInput,
  kind: "normal" | "milestone"
): string {
  const items = run.items.map((item) => item.name).join("、") || "无";
  const recent = summarizeRecent(run.history.slice(-2));
  const material = {
    id: input.id,
    title: compactText(input.title, 42),
    faction: input.factionId ?? "无",
    focusTag: input.focusTag,
    tags: input.tags.slice(0, 5),
    premise: compactText(input.promptHook, 80),
    outcome: compactText(input.outcomeHint, 64)
  };
  const outputRule = kind === "milestone"
    ? "R 仅输出JSON:{narrative,background,optionOverrides[3]}。narrative为本年叙事；optionOverrides 的 id 必须为 safe、balanced、risky。"
    : "R 只输出60-100字的自然人生叙事，不要标题、JSON、选项或系统说明。";
  return [
    `T:D2 ${kind === "milestone" ? "关键转向渲染" : "年度事件渲染"}`,
    `S0 age=${run.age + 1} persona=${compactText(run.personaPrompt, 80)}`,
    `S1 stats=${summarizeStatsShort(run.stats)} cards=${compactText(run.cards.map((card) => card.name).join("、"), 64)} items=${compactText(items, 48)}`,
    recent ? `S2 recent=${compactText(recent, 120)}` : "",
    `M engine_material=${JSON.stringify(material)}`,
    "D 引擎已确定具体事件与数值后果。只能渲染该素材的因果，不得改写事件、属性、掉落或结局。",
    outputRule
  ].filter(Boolean).join("\n");
}

function buildDirectedToolResultContent(
  input: DirectedNarrativeInput,
  kind: "normal" | "milestone"
): string {
  return JSON.stringify({
    status: "material_ready",
    focusTag: input.focusTag,
    event: {
      id: input.id,
      title: compactText(input.title, 42),
      faction: input.factionId ?? "none",
      tags: input.tags.slice(0, 5),
      premise: compactText(input.promptHook, 80),
      outcomeHint: compactText(input.outcomeHint, 64)
    },
    task: kind === "milestone"
      ? "根据该事件渲染叙事、背景和三个风险梯度选项。"
      : "根据该事件渲染自然的人生叙事。",
    outputRule: kind === "milestone"
      ? "仅输出合法JSON:{narrative,background,optionOverrides[3]}；optionOverrides 的 id 必须为 safe、balanced、risky。"
      : "只输出60-100字的自然人生叙事，不要标题、JSON、选项或系统说明。"
  });
}

function readChatCompletionText(message: unknown): string {
  const content = (message as { content?: unknown })?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return (content as ChatContentPart[]).map((part) => part.text ?? "").join("").trim();
}

export function recordDirectedFocusOutcome(
  ctx: NarrativeContext,
  selection: DirectedFocusSelection | null,
  outcome: {
    focusTag: string;
    eventId: string;
    title: string;
    kind: "normal" | "milestone";
    narrative: string;
    statChanges: Partial<Record<keyof Stats, number>>;
    itemName?: string;
    tags: string[];
    promptHook: string;
  }
): void {
  if (!selection || !ctx.conversation) return;
  const conversation = ctx.conversation;
  pushHistory(
    conversation,
    "user",
    `人物继续面对当时的主要矛盾。${outcome.kind === "milestone" ? "新的取舍已经出现。" : "既有处境得到推进。"}`
  );
  pushHistory(conversation, "assistant", outcome.narrative);
  compactConversationWindow(ctx, conversation);
}

export async function generateDirectedFocusSelection(
  run: InternalRunState,
  world: WorldConfig,
  focusOptions: DirectedFocusInput[],
  ctx: NarrativeContext,
  kind: "normal" | "milestone"
): Promise<DirectedFocusSelection | null> {
  if (!ctx.apiKey.trim() || focusOptions.length === 0) return null;
  if (ctx.providerConfig.apiPath !== "/chat/completions") return null;
  const supportKey = buildToolSupportCacheKey(ctx);
  if (toolSupportCache.get(supportKey) === false) return null;

  const promptPack = normalizePromptPackForModel(ctx.promptPack);
  const systemPrompt = buildSystemPrompt(promptPack, world, ctx, "year");
  const conversation = ensureConversationState(ctx.conversation, hashSystemPrompt(systemPrompt), systemPrompt);
  ctx.conversation = conversation;
  const recent = summarizeRecent(run.history.slice(-2));
  const items = run.items.map((item) => item.name).join("、") || "无";
  const focusBlock = focusOptions.map((option) => ({
    id: option.id,
    storyPosition: option.storyPosition ?? "ordinary",
    candidateCount: option.candidateCount
  }));
  const userPrompt = [
    `T:D1 ${kind === "milestone" ? "关键转向方向" : "年度方向"}`,
    `S0 age=${run.age + 1} persona=${compactText(run.personaPrompt, 80)}`,
    `S1 stats=${summarizeStatsShort(run.stats)} cards=${compactText(run.cards.map((card) => card.name).join("、"), 64)} items=${compactText(items, 48)}`,
    recent ? `S2 recent=${compactText(recent, 120)}` : "",
    `C focus_options=${JSON.stringify(focusBlock)}`,
    "D0 你是人生小说的事件导演。只能选择一个事件方向，具体事件由引擎从该方向中确定。",
    "D1 不得提前结束故事，不得编造数值、掉落、事件或结局。",
    "R 根据人物处境、最近经历和当前故事位置，调用工具选择最自然的方向。"
  ].filter(Boolean).join("\n");
  const toolName = "select_event_focus";
  const tool = directedFocusToolDefinition(focusOptions.map((option) => option.id));

  try {
    const client = getOpenAIClient(ctx);
    // This request only selects a direction; event material and narrative are handled by the next stage.
    const completion = await createTrackedChatCompletion(ctx, client, {
      model: ctx.providerConfig.model,
      temperature: ctx.providerConfig.temperature,
      max_tokens: ctx.providerConfig.maxTokens,
      messages: [
        { role: "system", content: buildSystemMessage(conversation) },
        ...buildConversationPromptMessages(conversation),
        { role: "user", content: userPrompt }
      ],
      tools: [tool as never],
      tool_choice: { type: "function", function: { name: toolName } }
    } as never, "director");
    const directedToolCall = findDirectedToolCall(completion.choices[0]?.message, toolName);
    if (!directedToolCall) return null;
    toolSupportCache.set(supportKey, true);
    const focusTag = readDirectedFocusSelection(directedToolCall.rawArguments, focusOptions.map((option) => option.id));
    return focusTag
      ? {
          focusTag,
          conversationTurn: {
            userPrompt,
            toolCall: directedToolCall.toolCall
          }
        }
      : null;
  } catch (error) {
    if (isLikelyToolUnsupported(error)) toolSupportCache.set(supportKey, false);
    debugError("director-tool", error);
    return null;
  }
}

export async function generateDirectedNarrative(
  run: InternalRunState,
  world: WorldConfig,
  input: DirectedNarrativeInput,
  selection: DirectedFocusSelection,
  ctx: NarrativeContext,
  kind: "normal" | "milestone"
): Promise<DirectedNarrativeResult | null> {
  if (!ctx.apiKey.trim()) return null;
  const promptPack = normalizePromptPackForModel(ctx.promptPack);
  const systemPrompt = buildSystemPrompt(promptPack, world, ctx, "year");
  const conversation = ensureConversationState(ctx.conversation, hashSystemPrompt(systemPrompt), systemPrompt);
  ctx.conversation = conversation;
  const userPrompt = buildDirectedNarrativePrompt(run, input, kind);
  const toolResultContent = buildDirectedToolResultContent(input, kind);

  const parseResult = (text: string): DirectedNarrativeResult | null => {
    if (kind === "milestone") return parseDirectedMilestoneNarrative(text);
    const narrative = stripMilestoneOptionArtifacts(text).trim();
    return narrative && !isLikelyTruncated(narrative) ? { narrative } : null;
  };

  try {
    compactConversationWindow(ctx, conversation);
    const client = getOpenAIClient(ctx);
    const completion = await createTrackedChatCompletion(ctx, client, {
      model: ctx.providerConfig.model,
      temperature: ctx.providerConfig.temperature,
      max_tokens: ctx.providerConfig.maxTokens,
      messages: [
        { role: "system", content: buildSystemMessage(conversation) },
        ...buildConversationPromptMessages(conversation),
        { role: "user", content: selection.conversationTurn.userPrompt },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: selection.conversationTurn.toolCall.id,
              type: "function",
              function: {
                name: selection.conversationTurn.toolCall.name,
                arguments: selection.conversationTurn.toolCall.arguments
              }
            }
          ]
        },
        {
          role: "tool",
          tool_call_id: selection.conversationTurn.toolCall.id,
          content: toolResultContent
        }
      ]
    } as never, "render");
    return parseResult(readChatCompletionText(completion.choices[0]?.message));
  } catch (error) {
    if (!isLikelyToolTranscriptUnsupported(error)) {
      debugError("director-render", error);
      return null;
    }
    try {
      const fallback = await callModel(ctx, systemPrompt, userPrompt, {
        mode: "year",
        conversation,
        usageOperation: "render",
        semanticQuery: `director-render|${run.age + 1}|${input.id}|${input.focusTag}|${run.personaPrompt}`
      });
      return parseResult(fallback.text);
    } catch (fallbackError) {
      debugError("director-render-fallback", fallbackError);
      return null;
    }
  }
}

function buildDirectedStoryTurnPrompt(
  run: InternalRunState,
  input: DirectedStoryTurnInput,
  narrativePlan?: NarrativePromptPlan
): string {
  if (input.closureRequired) {
    return [
      `T:C age=${run.age}`,
      formatNarrativePromptPlan(narrativePlan, "planning"),
      "C 主线已由引擎确认完成，且不再存在活动矛盾。不得开启、延续或评论新的主线。",
      "R 必须且只能调用 request_story_closure；不要输出给玩家看的正文、结论、说明或结局措辞。"
    ].filter(Boolean).join("\n");
  }
  const plannedAge = run.narrative.activeScene
    && run.narrative.sceneClock.mode === "hold"
    && run.narrative.sceneClock.sameAgeTurnCount < run.narrative.sceneClock.maxSameAgeTurns
    ? run.age
    : run.age + 1;
  return [
    `T:I age=${plannedAge}`,
    `C allowed_intents=${input.allowedIntents.join(",")}`,
    `C world_routes=${input.routeOptions.map((option) => `${option.id}=${compactText(option.label, 24)}(${compactText(option.summary, 96)})`).join(" | ")}`,
    input.rejectedRouteIds?.length
      ? `C rejected_routes=${input.rejectedRouteIds.join(",")};这些路线此刻没有可回收的既有事实，须改选另一条路线。`
      : "",
    input.focusOptions?.length
      ? `C focus_components=${input.focusOptions.map((option) => `${option.id}=${compactText(option.label, 24)}(${compactText(option.hint, 52)})`).join(" | ")}`
      : "",
    input.allowScenePacing
      ? "C scene_pacing=continuous 表示该重大矛盾可在同一年连续发展；spanning 表示适合跨年推进。引擎会限制连续同龄回合。"
      : "",
    input.allowClosureRequest
      ? "C closure_request=仅当主线已完成至少一次高潮与回收、且不再有当前矛盾时，才可调用 request_story_closure；由引擎决定是否进入结局流程。"
      : "",
    formatNarrativePromptPlan(narrativePlan, "planning"),
    run.narrative.enabled && !run.story.mainlineCompleted
      ? "C 主线尚未完成；不得暗示故事、人生或命运即将结束，也不得在正文或说明中表现结局意图。"
      : "",
    "D0 根据最近叙事、事实与世界主线，自主选择 world_routes 中的一个 routeId，并提出下一步叙事意图。continue 表示延续，pressure 表示加压，payoff 表示尝试收束伏笔。",
    "D1 routeId 必须逐字使用 world_routes 中的 ID；六条路线均可自由选择。引擎会依据当前因果拍点选择具体事件，过早的 payoff 不会直接结束故事。可选 scenePacing 只决定当前场景的时间节拍，不得暂停年龄以规避后果。可选 focusComponentId 只能从 focus_components 选择，用来承接既有线索。不得选择事件、属性、道具或结局。",
    input.rejectedRouteIds?.length
      ? "D2 若本次有 rejected_routes，保留世界主线与当前矛盾，改选一条已有事实可以承接的路线；不要重复被拒绝的路线。"
      : "",
    "R 必须调用 propose_story_intent；不要输出给玩家看的正文、结论或说明。"
  ].filter(Boolean).join("\n");
}

export async function generateDirectedStoryTurn(
  run: InternalRunState,
  world: WorldConfig,
  input: DirectedStoryTurnInput,
  ctx: NarrativeContext
): Promise<DirectedStoryTurnResult> {
  if (!ctx.apiKey.trim() || (!input.closureRequired && input.allowedIntents.length === 0)) {
    throw new DirectedStoryTurnError("directed_story_turn_unavailable");
  }
  const promptPack = normalizePromptPackForModel(ctx.promptPack);
  const planningContext: NarrativeContext = {
    ...ctx,
    narrativePlan: ctx.narrativePlan
      ? { ...ctx.narrativePlan, styleRules: ctx.narrativePlan.styleRules.slice(0, 1) }
      : undefined
  };
  const contextTask: NarrativeTask = input.closureRequired ? "closure" : "planning";
  const systemPrompt = buildSystemPrompt(promptPack, world, planningContext, "year", contextTask);
  const conversation = ensureConversationState(ctx.conversation, hashSystemPrompt(systemPrompt), systemPrompt);
  ctx.conversation = conversation;

  const taskPrompt = buildDirectedStoryTurnPrompt(run, input, ctx.narrativePlan);
  const composition = composeNarrativeContext({
    plan: ctx.narrativePlan,
    task: contextTask,
    taskPrompt,
    conversation,
    callId: input.callId ?? ctx.callId,
    source: input.closureRequired ? "closure" : "scene",
    worldId: run.worldId
  });
  const userPrompt = composition.renderedContext;
  const startedAt = Date.now();
  const supportKey = buildToolSupportCacheKey(ctx);
  if (toolSupportCache.get(supportKey) === false) {
    throw new DirectedStoryTurnError("directed_story_tools_unavailable");
  }

  try {
    compactConversationWindow(ctx, conversation);
    const client = getOpenAIClient(ctx);
    const isResponsesApi = ctx.providerConfig.apiPath === "/responses";
    const toolChoice = input.closureRequired
      ? { type: "function", function: { name: "request_story_closure" } }
      : input.allowClosureRequest
        ? "required"
        : { type: "function", function: { name: "propose_story_intent" } };
    const responseToolChoice = input.closureRequired
      ? { type: "function", name: "request_story_closure" }
      : input.allowClosureRequest
        ? "required"
        : { type: "function", name: "propose_story_intent" };
    const completion = isResponsesApi
      ? await createTrackedResponse(ctx, client, {
          model: ctx.providerConfig.model,
          instructions: buildSystemMessage(conversation),
          input: [
            ...composition.historyMessages,
            { role: "user", content: userPrompt }
          ],
          temperature: ctx.providerConfig.temperature,
          max_output_tokens: ctx.providerConfig.maxTokens,
          tools: directedStoryResponseTools(input) as never,
          tool_choice: responseToolChoice,
          parallel_tool_calls: false
        } as never, "planning")
      : await createTrackedChatCompletion(ctx, client, {
          model: ctx.providerConfig.model,
          temperature: ctx.providerConfig.temperature,
          max_tokens: ctx.providerConfig.maxTokens,
          messages: [
            { role: "system", content: buildSystemMessage(conversation) },
            ...composition.historyMessages,
            { role: "user", content: userPrompt }
          ],
          tools: directedStoryTools(input) as never,
          tool_choice: toolChoice,
          parallel_tool_calls: false,
          thinking: { type: "disabled" },
          reasoning_effort: reasoningEffortForSdk(ctx.providerConfig.reasoningEffort)
        } as never, "planning");
    const closureCall = input.allowClosureRequest ? (isResponsesApi
      ? findResponseFunctionCall(completion as { output?: unknown[] }, "request_story_closure")
      : findDirectedToolCall((completion as { choices?: Array<{ message?: unknown }> }).choices?.[0]?.message, "request_story_closure")) : null;
    const intentCall = isResponsesApi
      ? findResponseFunctionCall(completion as { output?: unknown[] }, "propose_story_intent")
      : findDirectedToolCall((completion as { choices?: Array<{ message?: unknown }> }).choices?.[0]?.message, "propose_story_intent");
    if (input.closureRequired && !closureCall) {
      debugDirectedStoryTurn("invalid", startedAt, true);
      throw new DirectedStoryTurnError("directed_story_turn_invalid_output");
    }
    if (!intentCall && !closureCall) {
      debugDirectedStoryTurn("invalid", startedAt, true);
      throw new DirectedStoryTurnError("directed_story_turn_invalid_output");
    }
    const parsed = intentCall ? readDirectedStoryIntent(intentCall.rawArguments, input) : { intent: undefined, routeId: undefined, focusComponentId: undefined };
    if (intentCall && !parsed) {
      debugDirectedStoryTurn("invalid", startedAt, true);
      throw new DirectedStoryTurnError("directed_story_turn_invalid_output");
    }
    const selectedCall = closureCall ?? intentCall!;
    const closureRequest = closureCall ? "guide" as const : undefined;
    const argumentsText = normalizeToolArguments(selectedCall.toolCall.arguments);
    const toolCall: ToolCallRecord = {
      id: selectedCall.toolCall.id || directedStoryToolCallId(selectedCall.toolCall.name, argumentsText, `${run.runId}:${run.age}`),
      name: selectedCall.toolCall.name,
      arguments: argumentsText
    };
    toolSupportCache.set(supportKey, true);
    debugDirectedStoryTurn("success", startedAt, true);
    return {
      ...parsed,
      closureRequest,
      toolCall,
      continuation: {
        protocol: isResponsesApi ? "responses" : "chat",
        systemPrompt,
        userPrompt,
        responseId: isResponsesApi ? (completion as { id?: string }).id : undefined
      }
    };
  } catch (error) {
    if (isLikelyToolUnsupported(error)) toolSupportCache.set(supportKey, false);
    debugDirectedStoryTurn("error", startedAt, true, error);
    debugError("directed-story-turn", error);
    if (error instanceof DirectedStoryTurnError) throw error;
    throw new DirectedStoryTurnError(isLikelyToolUnsupported(error)
      ? "directed_story_tools_unavailable"
      : "directed_story_turn_unavailable");
  }
}

function buildDirectedStoryRenderPrompt(run: InternalRunState, input: DirectedStoryRenderInput): string {
  const renderedAge = run.narrative.activeScene
    && run.narrative.sceneClock.mode === "hold"
    && run.narrative.sceneClock.sameAgeTurnCount < run.narrative.sceneClock.maxSameAgeTurns
    ? run.age
    : run.age + 1;
  const decisionMaterial = input.decision
    ? input.decision.options
      .map((option) => `${option.id}=${compactText(option.label, 28)}(${compactText(option.description, 48)})`)
      .join(" | ")
    : "";
  return [
    `请写人物在${renderedAge}岁经历的${input.kind === "milestone" ? "一个抉择场景" : "一段人生经历"}。`,
    `引擎已批准事件：${compactText(input.eventTitle, 80)}。`,
    `眼前发生的事：${compactText(input.premise, 160)}`,
    input.focus ? `这段经历应自然回应：${compactText(input.focus.label, 36)}。${compactText(input.focus.hint, 120)}` : "",
    input.sceneHint ? `必须承接的处境：${compactText(input.sceneHint, 160)}` : "",
    input.outcomeHint ? `这件事会留下的后果：${compactText(input.outcomeHint, 80)}` : "",
    decisionMaterial ? `引擎锁定的抉择语义：${decisionMaterial}` : "",
    run.narrative.enabled && !run.story.mainlineCompleted
      ? "主线尚未完成；不得使用结局、落幕、终局、收束等完成式表述，也不得暗示故事将结束。"
      : "",
    "正文只写故事本身，不写路线、数值、规则、提示、工具、请求或创作说明。以仍会影响后续的行动、消息或代价结束本段。",
    input.kind === "milestone"
      ? "必须调用 render_story_turn：narrative 写场景正文；background 写人物来到取舍前的自然引导；三个选项必须分别对应引擎锁定的 safe、balanced、risky 语义，但可依据当前人物处境改写为具体行动。"
      : input.attributePolicy
        ? `必须调用 render_story_turn，提交正文和 effects。effects 需提交${input.attributePolicy.minEffects}-${input.attributePolicy.maxEffects}项，只能影响${input.attributePolicy.allowedStats.join("、")}，方向只能为${input.attributePolicy.allowedDirections.join("、")}，幅度只能为${input.attributePolicy.allowedBands.join("、")}${input.attributePolicy.requirePositive ? "，且至少一项为正向" : ""}${describeNarrativeAttributePolicy(input.attributePolicy)}；不在正文中写数值。`
        : "必须调用 render_story_turn，提交这段经历的正文；不写总结或人生结论。"
  ].filter(Boolean).join("\n");
}

const isSafePlayerText = isNarrativePlainText;

function isSafePlayerNarrative(text: string): boolean {
  return isSafePlayerText(text, 10);
}

export function isDirectedStoryRenderSafe(
  result: DirectedStoryRenderResult,
  _input: DirectedStoryRenderInput
): boolean {
  return isSafePlayerNarrative(result.narrative);
}

function parseDirectedStoryRender(raw: unknown, input: DirectedStoryRenderInput): DirectedStoryRenderResult | null {
  const parsed = parseDirectedToolArguments(raw);
  if (!parsed) return null;
  const narrative = typeof parsed.narrative === "string" ? stripCodeFence(parsed.narrative).trim() : "";
  if (!narrative || isLikelyTruncated(narrative)) return null;
  const result: DirectedStoryRenderResult = { narrative, toolResult: "" };
  if (!isDirectedStoryRenderSafe(result, input)) return null;
  if (input.kind !== "milestone") {
    if (!input.attributePolicy) return result;
    const effects = parseNarrativeEffects(parsed.effects, input.attributePolicy);
    return effects ? { ...result, attributeEffects: effects } : null;
  }
  const background = typeof parsed.background === "string" ? parsed.background.trim() : "";
  const optionOverrides = normalizeMilestoneOptionOverrides(parsed.optionOverrides);
  if (!background || !optionOverrides) return null;
  return {
    ...result,
    milestoneCopy: { background, optionOverrides }
  };
}

export async function generateDirectedStoryRender(
  run: InternalRunState,
  world: WorldConfig,
  input: DirectedStoryRenderInput,
  ctx: NarrativeContext
): Promise<DirectedStoryRenderResult> {
  if (!ctx.apiKey.trim()) throw new DirectedStoryRenderError("directed_story_render_unavailable");
  const { turn } = input;
  const conversation = ctx.conversation;
  if (!conversation) throw new DirectedStoryRenderError("directed_story_render_unavailable");
  ctx.conversation = conversation;
  const userPrompt = buildDirectedStoryRenderPrompt(run, input);
  const renderToolName = "render_story_turn";
  const resultPayload = JSON.stringify({
    status: "approved_scene",
    requestedTool: turn.toolCall.name,
    event: {
      id: input.eventId,
      title: compactText(input.eventTitle, 80)
    },
    kind: input.kind,
    premise: compactText(input.premise, 160),
    outcomeHint: compactText(input.outcomeHint, 80),
    sceneHint: input.sceneHint ? compactText(input.sceneHint, 160) : undefined,
    decision: input.decision ? {
      background: compactText(input.decision.background, 120),
      options: input.decision.options.map((option) => ({
        id: option.id,
        label: compactText(option.label, 36),
        description: compactText(option.description, 60)
      }))
    } : undefined,
    instruction: input.kind === "milestone"
      ? "调用 render_story_turn，返回正文、抉择背景与三个选项。选项 id 和风险层级必须与引擎材料一致。"
      : "调用 render_story_turn，返回场景正文。"
  });
  try {
    compactConversationWindow(ctx, conversation);
    const client = getOpenAIClient(ctx);
    const completion = turn.continuation.protocol === "responses"
      ? await createTrackedResponse(ctx, client, {
          model: ctx.providerConfig.model,
          instructions: turn.continuation.systemPrompt,
          previous_response_id: turn.continuation.responseId,
          input: [
            { type: "function_call_output", call_id: turn.toolCall.id, output: resultPayload },
            { role: "user", content: userPrompt }
          ],
          temperature: ctx.providerConfig.temperature,
          max_output_tokens: ctx.providerConfig.maxTokens,
          reasoning: { effort: reasoningEffortForSdk(ctx.providerConfig.reasoningEffort) },
          tools: [directedStoryRenderResponseTool(input)] as never,
          tool_choice: { type: "function", name: renderToolName },
          parallel_tool_calls: false
        } as never, "render")
      : await createTrackedChatCompletion(ctx, client, {
          model: ctx.providerConfig.model,
          temperature: ctx.providerConfig.temperature,
          max_tokens: ctx.providerConfig.maxTokens,
          messages: [
            { role: "system", content: turn.continuation.systemPrompt },
            ...buildConversationPromptMessages(conversation),
            { role: "user", content: turn.continuation.userPrompt },
            {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: turn.toolCall.id,
                type: "function",
                function: { name: turn.toolCall.name, arguments: turn.toolCall.arguments }
              }]
            },
            { role: "tool", tool_call_id: turn.toolCall.id, content: resultPayload },
            { role: "user", content: userPrompt }
          ],
          thinking: { type: "disabled" },
          reasoning_effort: reasoningEffortForSdk(ctx.providerConfig.reasoningEffort),
          tools: [directedStoryRenderTool(input)] as never,
          tool_choice: { type: "function", function: { name: renderToolName } },
          parallel_tool_calls: false
        } as never, "render");
    const incomplete = turn.continuation.protocol === "responses"
      ? Boolean((completion as { incomplete_details?: unknown }).incomplete_details)
      : (completion as { choices?: Array<{ finish_reason?: string | null }> }).choices?.[0]?.finish_reason === "length";
    const renderCall = turn.continuation.protocol === "responses"
      ? findResponseFunctionCall(completion as { output?: unknown[] }, renderToolName)
      : findDirectedToolCall((completion as { choices?: Array<{ message?: unknown }> }).choices?.[0]?.message, renderToolName);
    const parsed = incomplete || !renderCall ? null : parseDirectedStoryRender(renderCall.rawArguments, input);
    if (!parsed) throw new DirectedStoryRenderError("directed_story_render_invalid_output");
    return { ...parsed, toolResult: resultPayload };
  } catch (error) {
    debugError("directed-story-render", error);
    if (error instanceof DirectedStoryRenderError) throw error;
    throw new DirectedStoryRenderError("directed_story_render_unavailable");
  }
}

function parseNarrativeEffects(raw: unknown, policy: NarrativeAttributePolicy, reason = "attribute_effects_invalid"): NarrativeAttributeEffect[] {
  const result = validateNarrativeEffects(raw, policy);
  if (!result.ok) throw invalidNarrativeOutcome(reason, result.issue);
  return result.effects;
}

function narrativeToolUsageOperation(toolNames: string[]): ModelUsageOperation {
  if (toolNames.some((name) => name === "plan_background_turn" || name === "plan_scene_turn" || name === "plan_choice_turn")) return "planning";
  if (toolNames.includes("curate_narrative_memory")) return "curation";
  if (toolNames.includes("plan_narrative_horizon")) return "horizon";
  if (toolNames.includes("refine_narrative_prose")) return "review";
  if (toolNames.includes("render_origin")) return "origin";
  if (toolNames.includes("render_background_segment")) return "background";
  if (toolNames.includes("resolve_background_outcome") || toolNames.includes("render_background_prose")) return "background";
  if (toolNames.includes("resolve_choice_scene") || toolNames.includes("render_choice_prose")) return "choice";
  if (toolNames.includes("resolve_scene_outcome") || toolNames.includes("render_scene_prose")) return "scene";
  if (toolNames.includes("render_choice_scene")) return "choice";
  if (toolNames.includes("render_scene")) return "scene";
  if (toolNames.includes("render_decision_outcome")) return "render";
  if (toolNames.includes("resolve_decision_outcome")) return "decision";
  return "narrative";
}

export function prepareNarrativeOutcomeRequest(
  run: InternalRunState, world: WorldConfig, ctx: NarrativeContext,
  toolInput: Record<string, unknown> | Record<string, unknown>[], prompt: string,
  options?: { task?: NarrativeTask; callId?: string; source?: NarrativeContextComposeInput["source"]; focusIds?: string[] }
) {
  const task = options?.task ?? ctx.narrativePlan?.task ?? "dynamic";
  const systemPrompt = buildSystemPrompt(normalizePromptPackForModel(ctx.promptPack), world, ctx, "year", task);
  const conversation = ensureConversationState(ctx.conversation, hashSystemPrompt(systemPrompt), systemPrompt);
  ctx.conversation = conversation;
  const tools = Array.isArray(toolInput) ? toolInput : [toolInput];
  const assetTools = new Set(["render_origin", "render_background_segment", "resolve_background_outcome", "resolve_scene_outcome", "resolve_choice_scene", "resolve_decision_outcome"]);
  const factTools = new Set(["render_background_segment", "resolve_background_outcome", "resolve_scene_outcome", "resolve_choice_scene", "resolve_decision_outcome"]);
  const recalledFactIds = new Set([
    ...(ctx.narrativePlan?.recall?.facts ?? []).map((entry) => entry.id),
    ...(ctx.narrativePlan?.factDirectory ?? []).map((entry) => entry.id)
  ]);
  const openFactIds = (run.story.factLedger?.facts ?? [])
    .map(normalizeNarrativeHandoffFact)
    .filter((fact) => fact.status === "open" && recalledFactIds.has(fact.id))
    .map((fact) => fact.id);
  const factContract = factUpdateContract(openFactIds);
  const characterIds = (ctx.narrativePlan?.recall?.characters ?? []).map((entry) => entry.id);
  const locationIds = new Set((ctx.narrativePlan?.recall?.assetSources ?? []).filter((entry) => entry.kind === "location").map((entry) => entry.id));
  const abilityIds = new Set((ctx.narrativePlan?.recall?.assetSources ?? []).filter((entry) => entry.kind === "ability").map((entry) => entry.id));
  const allowedAssets: NarrativeAssets = {
    locations: (run.narrative.assets?.locations ?? []).filter((entry) => locationIds.has(entry.id)),
    abilities: (run.narrative.assets?.abilities ?? []).filter((entry) => abilityIds.has(entry.id)),
    currentLocationId: locationIds.has(run.narrative.assets?.currentLocationId ?? "") ? run.narrative.assets?.currentLocationId : undefined
  };
  for (const tool of tools) {
    const definition = tool.function as { name: string; parameters: { properties: Record<string, unknown> } };
    if (assetTools.has(definition.name)) {
      if (definition.parameters.properties.narrative) {
        definition.parameters.properties.narrative = { type: "string", minLength: 10, description: narrativeToolRule(definition.name, resolvePromptPack(ctx.promptPack)) };
      }
      definition.parameters.properties.assetUpdates = narrativeAssetUpdatesSchema(allowedAssets);
    }
    if (factTools.has(definition.name)) {
      definition.parameters.properties.factUpdates = factContract.schema;
      definition.parameters.properties.relationshipUpdates = relationshipUpdatesSchema(characterIds);
    }
  }
  const toolNames = tools.map((tool) => (tool.function as { name?: unknown }).name).filter((name): name is string => typeof name === "string");
  if (tools.length === 0 || toolNames.length !== tools.length) {
    throw invalidNarrativeOutcome("tool_catalog_invalid");
  }
  const toolChoice = tools.length === 1
    ? { type: "function", function: { name: toolNames[0] } }
    : "required";
  compactConversationWindow(ctx, conversation);
  const composition = composeNarrativeContext({
    plan: ctx.narrativePlan,
    task,
    taskPrompt: prompt,
    conversation,
    callId: options?.callId ?? ctx.callId,
    source: options?.source,
    worldId: run.worldId,
    focusIds: options?.focusIds
  });
  const requestPrompt = composition.renderedContext;
  const history = [...composition.historyMessages, { role: "user" as const, content: requestPrompt }];
  if (debugModelEnabled()) console.log("[model-debug:narrative-context]", {
    ...narrativeContextTrace(composition.manifest),
    toolNames,
    toolSchemaEstimatedTokens: Math.ceil(JSON.stringify(tools).length / 4),
    allowedReferences: {
      facts: factContract.mutableIds,
      characters: characterIds,
      locations: allowedAssets.locations.map((entry) => entry.id),
      abilities: allowedAssets.abilities.map((entry) => entry.id)
    }
  });
  return { conversation, tools, toolNames, toolChoice, factContract, characterIds, allowedAssets, assetTools, factTools, history, contextManifest: composition.manifest };
}

async function requestNarrativeOutcomeTool(
  run: InternalRunState,
  world: WorldConfig,
  ctx: NarrativeContext,
  toolInput: Record<string, unknown> | Record<string, unknown>[],
  prompt: string,
  options?: { task?: NarrativeTask; callId?: string; source?: NarrativeContextComposeInput["source"]; focusIds?: string[] }
): Promise<{
  raw: Record<string, unknown>;
  toolCall: ToolCallRecord;
  toolName: string;
  assetUpdates?: NarrativeAssetUpdates;
  factUpdates?: NarrativeFactUpdates;
  relationshipUpdates?: NarrativeRelationshipUpdate[];
}> {
  if (!ctx.apiKey.trim()) throw new NarrativeOutcomeError("narrative_outcome_unavailable", "api_key_missing");
  const { conversation, tools, toolNames, toolChoice, factContract, characterIds, allowedAssets, assetTools, factTools, history, contextManifest } = prepareNarrativeOutcomeRequest(run, world, ctx, toolInput, prompt, options);
  ctx.lastContextManifest = contextManifest;
  const isResponsesApi = ctx.providerConfig.apiPath === "/responses";
  const usageOperation: ModelUsageOperationInput = {
    // A failed multi-tool request has no actual tool choice to classify.
    fallback: tools.length === 1 ? narrativeToolUsageOperation(toolNames) : "narrative",
    resolve: (response) => {
      const selected = isResponsesApi
        ? toolNames.map((toolName) => findResponseFunctionCall(response as { output?: unknown[] }, toolName)).find(Boolean)
        : toolNames.map((toolName) => findDirectedToolCall((response as { choices?: Array<{ message?: unknown }> }).choices?.[0]?.message, toolName)).find(Boolean);
      return selected ? narrativeToolUsageOperation([selected.toolCall.name]) : "narrative";
    }
  };
  try {
    compactConversationWindow(ctx, conversation);
    const client = getOpenAIClient(ctx);
    const completion = isResponsesApi
      ? await createTrackedResponse(ctx, client, {
          model: ctx.providerConfig.model,
          instructions: buildSystemMessage(conversation),
          input: history,
          temperature: ctx.providerConfig.temperature,
          max_output_tokens: ctx.providerConfig.maxTokens,
          tools: tools.map(responseTool) as never,
          tool_choice: tools.length === 1 ? { type: "function", name: toolNames[0] } : "required",
          parallel_tool_calls: false
        } as never, usageOperation)
      : await createTrackedChatCompletion(ctx, client, {
          model: ctx.providerConfig.model,
          temperature: ctx.providerConfig.temperature,
          max_tokens: ctx.providerConfig.maxTokens,
          messages: [{ role: "system", content: buildSystemMessage(conversation) }, ...history],
          thinking: { type: "disabled" },
          reasoning_effort: reasoningEffortForSdk(ctx.providerConfig.reasoningEffort),
          tools: tools as never,
          tool_choice: toolChoice as never,
          parallel_tool_calls: false
        } as never, usageOperation);
    if (debugModelEnabled()) {
      console.log("[model-debug:narrative-outcome-raw]");
      console.dir(completion, { depth: null, maxArrayLength: null, maxStringLength: null, colors: false });
    }
    const call = isResponsesApi
      ? toolNames.map((toolName) => findResponseFunctionCall(completion as { output?: unknown[] }, toolName)).find(Boolean)
      : toolNames.map((toolName) => findDirectedToolCall((completion as { choices?: Array<{ message?: unknown }> }).choices?.[0]?.message, toolName)).find(Boolean);
    const finishReason = isResponsesApi
      ? (completion as { status?: unknown; incomplete_details?: unknown }).status
      : (completion as { choices?: Array<{ finish_reason?: string | null }> }).choices?.[0]?.finish_reason;
    const incomplete = isResponsesApi
      ? finishReason === "incomplete" || Boolean((completion as { incomplete_details?: unknown }).incomplete_details)
      : finishReason === "length";
    if (debugModelEnabled()) console.log("[model-debug:narrative-outcome]", {
      task: options?.task ?? ctx.narrativePlan?.task ?? "dynamic",
      toolNames,
      selectedTool: call?.toolCall.name,
      finishReason,
      incomplete,
      rawArgumentCharacters: typeof call?.rawArguments === "string" ? call.rawArguments.length : undefined
    });
    if (incomplete) throw invalidNarrativeOutcome("tool_arguments_truncated", { rule: "provider_output_incomplete", path: "arguments", expected: toolNames });
    const raw = call ? parseDirectedToolArguments(call.rawArguments) : null;
    if (!call) throw invalidNarrativeOutcome("tool_call_missing");
    if (!raw) {
      const failure = directedToolArgumentsFailure(call.rawArguments);
      throw invalidNarrativeOutcome(failure.reason, failure.validation);
    }
    let assetUpdates: NarrativeAssetUpdates | undefined;
    let factUpdates: NarrativeFactUpdates | undefined;
    let relationshipUpdates: NarrativeRelationshipUpdate[] | undefined;
    if (assetTools.has(call.toolCall.name)) {
      try {
        assetUpdates = parseNarrativeAssetUpdates(raw.assetUpdates, allowedAssets);
        const descriptions = [
          ...(assetUpdates?.locations ?? []).flatMap((entry) => [entry.name, entry.description]),
          ...(assetUpdates?.abilities ?? []).flatMap((entry) => [entry.name, entry.description, entry.source, entry.mastery])
        ];
        if (descriptions.some((value) => !isSafePlayerText(value, 1))) throw new Error("asset_text_invalid");
      } catch (error) {
        throw invalidNarrativeOutcome("narrative_asset_updates_invalid", nestedValidationIssue(error, "assetUpdates"));
      }
    }
    if (factTools.has(call.toolCall.name)) {
      try {
        factUpdates = parseFactUpdates(raw.factUpdates, factContract);
      } catch (error) {
        throw invalidNarrativeOutcome("narrative_fact_updates_invalid", nestedValidationIssue(error, "factUpdates"));
      }
      try {
        relationshipUpdates = parseRelationshipUpdates(raw.relationshipUpdates, characterIds);
      } catch (error) {
        throw invalidNarrativeOutcome("narrative_relationship_updates_invalid", nestedValidationIssue(error, "relationshipUpdates"));
      }
    }
    return { raw, toolCall: call.toolCall, toolName: call.toolCall.name, assetUpdates, factUpdates, relationshipUpdates };
  } catch (error) {
    debugError("narrative-outcome", error);
    if (error instanceof NarrativeOutcomeError) throw error;
    throw new NarrativeOutcomeError("narrative_outcome_unavailable", "provider_request_failed");
  }
}

export function interruptedBackgroundTask(run: InternalRunState, fromAge: number, events: YearEvent[]) {
  const tool = {
    type: "function", function: {
      name: "render_background_segment",
      description: "叙述已经结算的岁月及其终点处境，同步其中实际发生的记忆变化。",
      parameters: {
        type: "object", additionalProperties: false, required: ["narrative"],
        properties: { narrative: { type: "string" } }
      }
    }
  };
  const prompt = [
    `本段实际经历从${fromAge}岁至${run.age}岁。`,
    `已结算的年度变化：${events.map((event) => `${event.age}岁：${formatDelta(event.statChanges)}`).join("；")}。`,
    `这段岁月止于濒死处境：${run.survivalCrisis?.cause ?? ""}。人物尚待作出求生选择。`,
    "依据这些已经发生的结果叙述生活经过，在本段终点停下。"
  ].join("\n");
  return { tool, prompt };
}

export async function renderInterruptedBackground(
  run: InternalRunState, world: WorldConfig, ctx: NarrativeContext,
  fromAge: number, events: YearEvent[]
): Promise<Pick<DynamicNarrativeSceneResult, "narrative" | "assetUpdates" | "factUpdates" | "relationshipUpdates">> {
  const { tool, prompt } = interruptedBackgroundTask(run, fromAge, events);
  const result = await requestNarrativeOutcomeTool(run, world, ctx, tool, prompt, { task: "background" });
  const narrative = normalizeNarrativeText(result.raw.narrative);
  if (!isSafePlayerNarrative(narrative)) throw invalidNarrativeOutcome("background_result_narrative_invalid");
  return { narrative, assetUpdates: result.assetUpdates, factUpdates: result.factUpdates, relationshipUpdates: result.relationshipUpdates };
}

export async function generateNarrativeOrigin(
  run: InternalRunState,
  world: WorldConfig,
  ctx: NarrativeContext
): Promise<NarrativeOriginOutcome> {
  const statSummary = Object.entries(run.stats).map(([stat, value]) => `${stat}=${value}`).join("；");
  const prompt = [
    "为一名出生前的人物写身世。",
    `初始属性：${statSummary}。用于把握人物来处与生活条件。`,
    "交代家庭、生活环境与人物的来处，让天赋自然体现在身世中。",
    "summary 提炼身世中的确定信息；有值得保留的潜在线索时可填写 seedHints。",
    "不得写规则、数值、内部标签、工具或结局。必须调用 render_origin。"
  ].join("\n");
  const result = await requestNarrativeOutcomeTool(run, world, ctx, narrativeOriginOutcomeTool(), prompt, { task: "origin" });
  const narrative = normalizeNarrativeText(result.raw.narrative);
  const summary = typeof result.raw.summary === "string" ? compactText(result.raw.summary, 180) : "";
  const seedHints = Array.isArray(result.raw.seedHints)
    ? result.raw.seedHints
      .filter((hint): hint is string => typeof hint === "string")
      .map((hint) => compactText(hint, 90))
      .filter((hint) => isSafePlayerNarrative(hint))

    : [];
  if (!isSafePlayerNarrative(narrative) || !isSafePlayerNarrative(summary)) {
    throw invalidNarrativeOutcome("origin_narrative_or_profile_invalid");
  }
  return { narrative, profile: { summary, seedHints }, assetUpdates: result.assetUpdates };
}

export async function generateDirectedDecisionSettlement(
  run: InternalRunState,
  world: WorldConfig,
  input: { decision: DecisionType; label: string; description: string; attributePolicy: NarrativeAttributePolicy; factResolutionModes?: NarrativeFactResolution[] },
  ctx: NarrativeContext
): Promise<DirectedDecisionSettlement> {
  const prompt = [
    `人物在${run.age}岁选择了“${compactText(input.label, 36)}”：${compactText(input.description, 90)}。`,
    "判断这项行动已经造成的结构化后果，并在对应字段提交本次真正发生的变化。",
    input.factResolutionModes?.length ? `本次正处于世界幕高潮，必须同时选择一个事实收束方式：${input.factResolutionModes.join("、")}。` : "",
    "本次只结算结果，不生成玩家正文。",
    "必须调用 resolve_decision_outcome。"
  ].filter(Boolean).join("\n");
  const tool = narrativeDecisionOutcomeTool(input.attributePolicy, input.factResolutionModes);
  const result = await requestNarrativeOutcomeTool(run, world, ctx, tool, prompt, {
    task: "settlement",
    callId: `${ctx.callId ?? `decision:${run.runId}:${run.age}`}:settlement`,
    source: "decision"
  });
  const effects = parseNarrativeEffects(result.raw.effects, input.attributePolicy, "decision_outcome_invalid");
  const rawResolution = typeof result.raw.factResolution === "string" ? result.raw.factResolution : undefined;
  const factResolution = input.factResolutionModes?.includes(rawResolution as NarrativeFactResolution)
    ? rawResolution as NarrativeFactResolution
    : undefined;
  if (input.factResolutionModes?.length && !factResolution) throw invalidNarrativeOutcome("decision_outcome_invalid", { rule: "fact_resolution_required", path: "factResolution", expected: input.factResolutionModes });
  return { effects, factResolution, assetUpdates: result.assetUpdates, relationshipUpdates: result.relationshipUpdates, factUpdates: result.factUpdates };
}

function decisionSettlementForPrompt(settlement: DirectedDecisionSettlement): string {
  return JSON.stringify({
    effects: settlement.effects.map((effect) => ({
      stat: labelStat(effect.stat),
      direction: effect.direction === "up" ? "上升" : "下降",
      band: effect.band === "light" ? "轻度" : effect.band === "medium" ? "中度" : "显著"
    })),
    factResolution: settlement.factResolution,
    facts: settlement.factUpdates,
    relationships: settlement.relationshipUpdates,
    assets: settlement.assetUpdates
  });
}

export async function renderDirectedDecisionNarrative(
  run: InternalRunState,
  world: WorldConfig,
  input: { decision: DecisionType; label: string; description: string },
  settlement: DirectedDecisionSettlement,
  ctx: NarrativeContext
): Promise<string> {
  const prompt = [
    `人物在${run.age}岁选择了“${compactText(input.label, 36)}”：${compactText(input.description, 90)}。`,
    `已审批结算：${decisionSettlementForPrompt(settlement)}`,
    "依据抉择前处境和已审批结算，写清行动经过、直接结果与人物当下处境。结构化结算是事实边界，不要照抄字段、标签或内部标识。",
    "必须调用 render_decision_outcome。"
  ].join("\n");
  const result = await requestNarrativeOutcomeTool(run, world, ctx, narrativeDecisionRenderTool(), prompt, {
    task: "decision",
    callId: `${ctx.callId ?? `decision:${run.runId}:${run.age}`}:render`,
    source: "decision"
  });
  const narrative = normalizeNarrativeText(result.raw.narrative);
  if (!isSafePlayerNarrative(narrative)) {
    throw invalidNarrativeOutcome("decision_narrative_invalid", { rule: "narrative_text_invalid", path: "narrative" });
  }
  return narrative;
}

function parseParticipantRelationship(raw: unknown): Pick<NarrativeCharacterRelationship, "stance" | "summary"> | null | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const stance = typeof source.stance === "string" && relationshipStances.includes(source.stance as typeof relationshipStances[number])
    ? source.stance as NarrativeCharacterRelationship["stance"]
    : undefined;
  const summary = typeof source.summary === "string" ? compactText(source.summary, 160) : "";
  return stance && isSafePlayerText(summary, 1) ? { stance, summary } : null;
}

export function parseDynamicNarrativeParticipants(
  raw: unknown,
  factions: DynamicNarrativeSceneInput["factions"],
  knownCharacters: DynamicNarrativeSceneInput["knownCharacters"]
): DynamicNarrativeSceneResult["participants"] | null {
  const invalid = (rule: string, path: string) => {
    throw invalidNarrativeOutcome("dynamic_scene_identity_or_participants_invalid", { rule, path });
  };
  if (!Array.isArray(raw) || raw.length > 3) return invalid("participant_count", "participants");
  const participants: DynamicNarrativeSceneResult["participants"] = [];
  for (const [index, value] of raw.entries()) {
    const path = `participants[${index}]`;
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("object_required", path);
    const item = value as Record<string, unknown>;
    const characterRef = typeof item.characterRef === "string" ? item.characterRef.trim() : "";
    const known = characterRef === "new" ? undefined : knownCharacters.find((character) => character.id === characterRef);
    if (!characterRef || (characterRef !== "new" && !known)) return invalid("character_reference_invalid", `${path}.characterRef`);
    const relationship = parseParticipantRelationship(item.relationship);
    if (relationship === null) return invalid("relationship_invalid", `${path}.relationship`);
    const name = known?.name ?? normalizeNarrativeText(item.name);
    const factionId = known ? known.factionId : (typeof item.factionId === "string" ? item.factionId.trim() : "");
    const role = known?.role ?? normalizeNarrativeText(item.role);
    const description = normalizeNarrativeText(item.description);
    if (!known) {
      if (!isSafePlayerText(name, 1)) return invalid("text_required", `${path}.name`);
      if (!isSafePlayerText(role, 1)) return invalid("text_required", `${path}.role`);
      if (!factions.some((faction) => faction.id === factionId)) return invalid("faction_reference_invalid", `${path}.factionId`);
      if (typeof item.recurring !== "boolean") return invalid("boolean_required", `${path}.recurring`);
    }
    if ((!known || item.description !== undefined) && !isSafePlayerText(description, 1)) return invalid("text_required", `${path}.description`);
    participants.push({ characterRef, name, factionId, role, description, recurring: known ? true : item.recurring === true, relationship });
  }
  return participants;
}

export function parseDynamicNarrativeActHandoff(raw: unknown): NarrativeActHandoff | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const resolvedTension = typeof source.resolvedTension === "string" ? compactText(source.resolvedTension, 180) : "";
  const lastingConsequence = typeof source.lastingConsequence === "string" ? compactText(source.lastingConsequence, 180) : "";
  const continuation = typeof source.continuation === "string" ? compactText(source.continuation, 180) : "";
  if (
    !isSafePlayerText(resolvedTension, 1) ||
    !isSafePlayerText(lastingConsequence, 1) ||
    !isSafePlayerText(continuation, 1)
  ) return null;
  return { resolvedTension, lastingConsequence, continuation };
}

export function dynamicNarrativeScenePrompt(
  input: DynamicNarrativeSceneInput,
  toolSet = dynamicNarrativeSceneTools(input)
): string {
  const sceneAllowed = input.allowedTurnKinds.includes("scene");
  if (sceneAllowed && (input.routes.length === 0 || input.factions.length === 0)) {
    throw invalidNarrativeOutcome("dynamic_scene_catalog_missing");
  }
  if (toolSet.tools.length === 0) throw invalidNarrativeOutcome("dynamic_scene_tools_missing");
  const resolvesBackground = toolSet.names.includes("resolve_background_outcome");
  const resolvesScene = toolSet.names.includes("resolve_scene_outcome");
  const resolvesChoice = toolSet.names.includes("resolve_choice_scene");
  const prompt = [
    input.plan ? `已批准回合计划：目标=${input.plan.sceneGoal}；呈现=${input.plan.presentation}；时间请求=${input.plan.clockRequest}。` : "",
    sceneAllowed ? `场景发生年龄：${input.sceneAge}岁。` : "",
    input.lifeStage ? `当前处于${input.lifeStage.label}（至${input.lifeStage.maxAge}岁）：主角尚不具备独立社会行动能力。以照料者、家庭、感官和成长环境为叙事主体；不得写谋划、交涉、实质抉择或主线推进。` : "",
    `人物能力档位（仅用于判断，不写入正文）：${Object.entries(input.statTiers).map(([stat, tier]) => `${stat}=${tier}`).join("；")}`,
    sceneAllowed ? "人物已具备展开当前节拍经历的条件。结合眼前处境选择适合的经历视角；生活片段用于表现实际的成长与生活变化，场景用于展开当下可以发生的相遇、行动或取舍。" : "",
    sceneAllowed ? `本轮经历视角：${input.routes.filter((route) => !input.plan?.routeId || route.id === input.plan.routeId).map((route) => `${route.id}=${route.label}：${compactText(route.summary, 88)}${route.perspective ? `；本拍视角：${compactText(route.perspective, 88)}` : ""}`).join(" | ")}` : "",
    sceneAllowed ? `本轮相关阵营：${input.factions.filter((faction) => !input.plan?.factionId || faction.id === input.plan.factionId).map((faction) => `${faction.id}=${faction.label}：${compactText(faction.summary, 60)}`).join(" | ")}` : "",
    resolvesBackground && input.growthFocus ? `这段人生的成长侧重：${input.growthFocus.label}。${input.growthFocus.description}` : "",
    resolvesBackground
      ? `本次结算覆盖${input.backgroundAgeRange.fromAge}岁至${input.backgroundAgeRange.toAge}岁。提交一组轻度或中度成长标签，引擎会将其应用于其中每个实际年龄。`
      : "",
    resolvesScene
      ? `本次场景推进当前节拍，必须提交${input.attributePolicy?.minEffects ?? 1}-${input.attributePolicy?.maxEffects ?? 2}项受控属性后果。`
      : "",
    resolvesChoice
      ? "本次只登记抉择出现前已经发生的人物、事实、关系与叙事资产变化；尚未选择的行动不产生属性后果。"
      : "",
    "路线是观察和人物经历的视角，不是独占分支；不得生成世界包之外的路线或阵营 ID。已有角色再次出场时用 characterRef 引用档案，按实际经历更新处境与关系；只有首次出现的人物使用 characterRef=new，并提交创建信息。只有 recurring=true 的新人物才会进入命运人物档案。人物对主角的态度确实改变时，可在 participant.relationship 写入变化。事实与关系的实际变化放入 factUpdates 和 relationshipUpdates。",
    `本轮通过${toolSet.names.join("、")}提交结构化结果，不写玩家正文。`
  ].filter(Boolean).join("\n");
  return prompt;
}

function dynamicNarrativeRenderPrompt(input: DynamicNarrativeSceneInput, settlement: Record<string, unknown>): string {
  const age = input.presentation === "summary"
    ? `${input.backgroundAgeRange.fromAge}-${input.backgroundAgeRange.toAge}岁`
    : `${input.sceneAge}岁`;
  return [
    `已批准回合计划：目标=${input.plan?.sceneGoal ?? "延续人物经历"}；呈现=${input.presentation}；年龄=${age}。`,
    `已审批结构化结果：${JSON.stringify(settlement)}。`,
    input.presentation === "choice"
      ? "写清取舍前已经发生的处境，并给出safe、balanced、risky三个自然语言行动选项；不要写风险标签或尚未选择的结果。"
      : "依据已审批结果写人物经历与当下结果；不要照抄字段、标签或内部标识。",
    `必须调用${dynamicNarrativeRenderTool(input).name}。`
  ].join("\n");
}

export async function generateDynamicNarrativeScene(
  run: InternalRunState,
  world: WorldConfig,
  input: DynamicNarrativeSceneInput,
  ctx: NarrativeContext,
  onSettlementComplete?: () => Promise<void> | void
): Promise<DynamicNarrativeSceneResult> {
  const toolSet = dynamicNarrativeSceneTools(input);
  const sceneAllowed = input.allowedTurnKinds.includes("scene");
  const resolvesBackground = toolSet.names.includes("resolve_background_outcome");
  const resolvesScene = toolSet.names.includes("resolve_scene_outcome");
  const resolvesChoice = toolSet.names.includes("resolve_choice_scene");
  const settlement = await requestNarrativeOutcomeTool(run, world, ctx, toolSet.tools,
    dynamicNarrativeScenePrompt(input, toolSet), {
      task: "settlement",
      callId: `${input.plan?.callId ?? `turn:${run.runId}:${run.age}`}:settlement`,
      source: input.plan?.turnKind === "background" ? "background" : "scene",
      focusIds: input.plan?.focusRefs
    });
  await onSettlementComplete?.();
  const render = dynamicNarrativeRenderTool(input);
  const rendered = await requestNarrativeOutcomeTool(run, world, ctx, render.tool,
    dynamicNarrativeRenderPrompt(input, settlement.raw), {
      task: input.presentation === "summary" ? "background" : "rendering",
      callId: `${input.plan?.callId ?? `turn:${run.runId}:${run.age}`}:render`,
      source: input.plan?.turnKind === "background" ? "background" : "scene",
      focusIds: input.plan?.focusRefs
    });
  const narrative = normalizeNarrativeText(rendered.raw.narrative);
  if (!isSafePlayerNarrative(narrative)) throw invalidNarrativeOutcome("dynamic_scene_narrative_unsafe", { rule: "narrative_text_invalid", path: "narrative" });

  if (settlement.toolName === "resolve_background_outcome") {
    if (!resolvesBackground) throw invalidNarrativeOutcome("dynamic_background_tool_disallowed");
    const effects = parseNarrativeEffects(settlement.raw.effects, input.backgroundAttributePolicy, "dynamic_background_effects_invalid");
    return {
      turnKind: "background",
      assetUpdates: settlement.assetUpdates,
      relationshipUpdates: settlement.relationshipUpdates, factUpdates: settlement.factUpdates,
      narrative,
      participants: [],
      backgroundAttributeEffects: effects
    };
  }

  const routeId = input.plan?.routeId ?? "";
  const factionId = input.plan?.factionId ?? "";
  const participants = parseDynamicNarrativeParticipants(settlement.raw.participants, input.factions, input.knownCharacters);
  const scenePacing = settlement.raw.scenePacing === "continuous" || settlement.raw.scenePacing === "spanning"
    ? settlement.raw.scenePacing
    : undefined;
  const actHandoff = input.beat === "payoff"
    ? parseDynamicNarrativeActHandoff(settlement.raw.actHandoff) ?? undefined
    : undefined;
  if (
    !sceneAllowed ||
    !input.routes.some((route) => route.id === routeId) ||
    !input.factions.some((faction) => faction.id === factionId) ||
    (input.plan?.routeId && input.plan.routeId !== routeId) ||
    (input.plan?.factionId && input.plan.factionId !== factionId) ||
    !participants
  ) {
    throw invalidNarrativeOutcome("dynamic_scene_identity_or_participants_invalid");
  }

  if (settlement.toolName === "resolve_scene_outcome") {
    const attributeEffects = input.attributePolicy ? parseNarrativeEffects(settlement.raw.effects, input.attributePolicy, "dynamic_scene_effects_invalid") : null;
    if (!resolvesScene || !attributeEffects) throw invalidNarrativeOutcome("dynamic_scene_effects_invalid");
    if (input.beat === "payoff" && !actHandoff) throw invalidNarrativeOutcome("dynamic_scene_act_handoff_invalid");
    return { turnKind: "scene", routeId, factionId, narrative, scenePacing, participants, createsDecision: false, attributeEffects, actHandoff, assetUpdates: settlement.assetUpdates, relationshipUpdates: settlement.relationshipUpdates, factUpdates: settlement.factUpdates };
  }

  if (settlement.toolName === "resolve_choice_scene") {
    const background = normalizeNarrativeText(rendered.raw.background);
    const optionOverrides = normalizeMilestoneOptionOverrides(rendered.raw.optionOverrides, true);
    if (!resolvesChoice || !isSafePlayerNarrative(background) || !optionOverrides) {
      throw invalidNarrativeOutcome("dynamic_choice_presentation_invalid");
    }
    return {
      turnKind: "scene",
      assetUpdates: settlement.assetUpdates,
      relationshipUpdates: settlement.relationshipUpdates, factUpdates: settlement.factUpdates,
      routeId,
      factionId,
      narrative,
      scenePacing,
      participants,
      createsDecision: true,
      milestoneCopy: { background, optionOverrides },
      actHandoff: undefined
    };
  }

  throw invalidNarrativeOutcome("dynamic_scene_tool_unknown");
}

function committedNarrativeDigest(run: InternalRunState, sourceEventId: string | undefined): string {
  const memory = sourceEventId ? run.narrative.memoryEntries.find((entry) => entry.id === `memory:${sourceEventId}`) : undefined;
  const changes = memory ? [
    ...(run.story.factLedger?.facts ?? []).filter((fact) => memory.factIds.includes(fact.id) &&
      (fact.lastSourceEventId ?? fact.sourceEventId) === sourceEventId)
      .map((fact) => fact.status === "resolved" ? fact.resolutionSummary ?? fact.label : fact.progressSummary ?? fact.label),
    ...run.narrative.dynamicCharacters.filter((person) => memory.characterIds.includes(person.id))
      .map((person) => `${person.name}：${person.relationship?.summary ?? person.description}`),
    ...(run.narrative.assets?.locations ?? []).filter((place) => memory.locationIds?.includes(place.id)).map((place) => `${place.name}：${place.description}`),
    ...(run.narrative.assets?.abilities ?? []).filter((ability) => memory.abilityIds?.includes(ability.id)).map((ability) => `${ability.name}：${ability.mastery}`)
  ] : [];
  // Prose remains in the assistant message; this is the committed change record.
  return changes.length ? `本段记事：${Array.from(new Set(changes)).join("；")}` : "";
}

export function recordDirectedStoryTurnOutcome(
  ctx: NarrativeContext,
  run: InternalRunState,
  outcome: {
    kind: "origin" | "normal" | "milestone";
    sourceEventId?: string;
    narrative: string;
    statChanges: Partial<Record<keyof Stats, number>>;
    turn?: DirectedStoryTurnResult;
    toolResult?: string;
  }
): void {
  if (!ctx.conversation) return;
  const conversation = ctx.conversation;
  if (outcome.turn) {
    pushHistory(conversation, "user", projectConversationUserPrompt(outcome.turn.continuation.userPrompt));
    pushToolCall(conversation, outcome.turn.toolCall);
    pushToolResult(conversation, outcome.turn.toolCall, outcome.toolResult ?? "已批准并生成下一段故事素材。");
  }
  const delta = formatDelta(outcome.statChanges);
  pushHistory(
    conversation,
    "user",
    outcome.kind === "origin" ? "人物的身世与来处。" : `岁月推进至${run.age}岁。${committedNarrativeDigest(run, outcome.sourceEventId)}${delta ? ` 此段变化：${delta}。` : ""}`,
    outcome.sourceEventId
  );
  pushHistory(conversation, "assistant", outcome.narrative);
  compactConversationWindow(ctx, conversation);
}

export function recordDirectedDecisionOutcome(
  ctx: NarrativeContext,
  run: InternalRunState,
  outcome: {
    sourceEventId?: string;
    decision: DecisionType;
    label: string;
    narrative: string;
  }
): void {
  if (!ctx.conversation) return;
  const conversation = ctx.conversation;
  pushHistory(
    conversation,
    "user",
    `人物作出取舍：${outcome.label}。${committedNarrativeDigest(run, outcome.sourceEventId)}`,
    outcome.sourceEventId
  );
  pushHistory(conversation, "assistant", outcome.narrative);
  compactConversationWindow(ctx, conversation);
}

export async function generateYearNarrative(
  run: InternalRunState,
  world: WorldConfig,
  event: YearEvent,
  ctx: NarrativeContext,
  options?: YearNarrativeOptions
): Promise<string> {
  if (!ctx.apiKey.trim()) return "";
  const promptPack = normalizePromptPackForModel(ctx.promptPack);
  const systemPrompt = buildSystemPrompt(promptPack, world, ctx, "year");
  const systemHash = hashSystemPrompt(systemPrompt);
  const conversation = ensureConversationState(ctx.conversation, systemHash, systemPrompt);
  ctx.conversation = conversation;
  const userPrompt = buildYearPrompt(run, event, promptPack, ctx.narrativePlan, options?.background);
  const avoidNarratives = options?.avoidNarratives ?? [];
  const isMilestoneYear = event.tags.includes("milestone");
  if (debugModelEnabled()) {
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
    compactConversationWindow(ctx, conversation);
    pushHistory(conversation, "user", projectConversationUserPrompt(userPrompt));
    let callResult = await callModel(ctx, systemPrompt, userPrompt, {
      mode: "year",
      conversation,
      semanticQuery: `${event.age}|${event.title}|${formatDelta(event.statChanges as Partial<Record<keyof Stats, number>>)}|${run.personaPrompt}`
    });
    let text = stripMilestoneOptionArtifacts(callResult.text);

    let continuationCount = 0;
    if (isMilestoneYear) {
      while (continuationCount < 2) {
        const likelyTruncated = callResult.truncated || isLikelyTruncated(text);
        if (!likelyTruncated) break;
        const tailResult = await continueNarrative(ctx, systemPrompt, text.slice(-180), {
          conversation
        });
        const tail = stripMilestoneOptionArtifacts(tailResult.text);
        if (!tail) break;
        text = `${text}${tail}`.trim();
        callResult = {
          text,
          truncated: tailResult.truncated,
          truncateReason: tailResult.truncateReason
        };
        continuationCount += 1;
      }
    }
    if (callResult.truncated || isLikelyTruncated(text)) text = "";
    if (isMilestoneYear && text && isNarrativeNearDuplicate(text, avoidNarratives)) {
      const retryPrompt = buildYearDedupeRetryPrompt(userPrompt, text, avoidNarratives);
      const retried = await callModel(ctx, systemPrompt, retryPrompt, {
        mode: "year",
        conversation,
        semanticQuery: retryPrompt,
        skipCache: true
      });
      let rewritten = stripMilestoneOptionArtifacts(retried.text);
      if (retried.truncated || isLikelyTruncated(rewritten)) rewritten = "";
      if (rewritten) {
        text = rewritten;
      }
    }
    pushHistory(conversation, "assistant", text || "");
    keepRecentRounds(conversation);
    if (debugModelEnabled()) {
      console.log("[model-debug:year-narrative]", {
        hasText: Boolean(text?.trim()),
        len: text?.length ?? 0,
        truncated: callResult.truncated,
        truncateReason: callResult.truncateReason,
        continuationCount,
        preview: text?.slice(0, 120) ?? ""
      });
    }
    return text || "";
  } catch (error) {
    keepRecentRounds(conversation);
    debugError("year-narrative", error);
    if (debugModelEnabled()) {
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

function fallbackDecisionDescription(id: DecisionType): string {
  if (id === "safe") return "优先保全眼前局面，代价较小。";
  if (id === "balanced") return "承担可控代价，争取更稳的推进。";
  return "押上现有筹码，换取一次突破机会。";
}

function fallbackFromChoice(choice: NonNullable<InternalRunState["nextMilestoneChoice"]>): AiMilestoneOptions {
  return {
    background: (choice.background ?? "").trim() || "命运的岔路在你面前展开。",
    optionOverrides: choice.options.map((opt) => ({
      id: opt.id,
      label: (opt.label ?? "").trim() || (opt.id === "safe" ? "A" : opt.id === "balanced" ? "B" : "C"),
      description: (opt.description ?? "").trim() || fallbackDecisionDescription(opt.id)
    }))
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

function fallbackDecisionLabel(id: DecisionType): string {
  if (id === "safe") return "A";
  if (id === "balanced") return "B";
  return "C";
}

function normalizeDecisionId(value: unknown): DecisionType | null {
  if (typeof value !== "string") return null;
  const token = value
    .trim()
    .toLowerCase()
    .replace(/[\s_\-：:]/g, "");
  if (!token) return null;

  if (
    token === "safe" ||
    token === "a" ||
    token === "optiona" ||
    token === "choicea" ||
    token === "选项a" ||
    token === "方案a" ||
    token === "稳健" ||
    token === "保守" ||
    token === "低风险" ||
    token === "谨慎"
  ) {
    return "safe";
  }

  if (
    token === "balanced" ||
    token === "b" ||
    token === "optionb" ||
    token === "choiceb" ||
    token === "选项b" ||
    token === "方案b" ||
    token === "适中" ||
    token === "平衡" ||
    token === "均衡" ||
    token === "中风险" ||
    token === "中庸"
  ) {
    return "balanced";
  }

  if (
    token === "risky" ||
    token === "c" ||
    token === "optionc" ||
    token === "choicec" ||
    token === "选项c" ||
    token === "方案c" ||
    token === "冒险" ||
    token === "激进" ||
    token === "高风险" ||
    token === "高回报"
  ) {
    return "risky";
  }

  return null;
}

export function normalizeMilestoneOptionOverrides(
  raw: unknown, reportFailure = false
): AiMilestoneOptions["optionOverrides"] | null {
  const invalid = (rule: string, path: string, received?: unknown) => {
    if (reportFailure) throw invalidNarrativeOutcome("dynamic_choice_presentation_invalid", { rule, path, received });
    return null;
  };
  if (!Array.isArray(raw) || raw.length !== 3) return invalid("choice_count", "optionOverrides", Array.isArray(raw) ? raw.length : typeof raw);
  const byId = new Map<DecisionType, AiMilestoneOptions["optionOverrides"][number]>();
  for (const [index, item] of raw.entries()) {
    const path = `optionOverrides[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) return invalid("object_required", path);
    const id = normalizeDecisionId(item.id);
    if (!id) return invalid("choice_id_invalid", `${path}.id`);
    if (byId.has(id)) return invalid("duplicate_choice_id", `${path}.id`, id);
    const label = normalizeNarrativeText(item.label);
    const description = normalizeNarrativeText(item.description);
    if (!isSafePlayerText(label, 1)) return invalid("choice_text_invalid", `${path}.label`);
    if (!isSafePlayerText(description, 1)) return invalid("choice_text_invalid", `${path}.description`);
    byId.set(id, { id, label, description });
  }
  return (["safe", "balanced", "risky"] as const).map((id) => byId.get(id)!);
}

function parseMilestonePayload(text: string): AiMilestoneOptions | null {
  const cleaned = stripCodeFence(text);
  const candidates = [cleaned, extractFirstJsonObject(cleaned)].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as { background?: unknown; optionOverrides?: unknown };
      const optionOverrides = normalizeMilestoneOptionOverrides(parsed.optionOverrides);
      if (!optionOverrides) continue;
      const background = typeof parsed.background === "string" && parsed.background.trim()
        ? parsed.background.trim()
        : "命运在你面前摊开新赌局。";
      return {
        background,
        optionOverrides
      };
    } catch {
      // keep trying
    }
  }
  return parseOptionsFromText(cleaned);
}

function mergeMilestoneOptions(
  base: NonNullable<InternalRunState["nextMilestoneChoice"]>,
  parsed: AiMilestoneOptions | null
): AiMilestoneOptions {
  const fallback = fallbackFromChoice(base);
  if (!parsed || !parsed.optionOverrides || parsed.optionOverrides.length !== 3) return fallback;

  const sourceById = new Map(parsed.optionOverrides.map((o) => [o.id, o]));
  return {
    background: parsed.background?.trim() ? parsed.background.trim() : fallback.background,
    optionOverrides: fallback.optionOverrides.map((baseOption) => {
      const fromModel = sourceById.get(baseOption.id);
      const nextLabel = fromModel?.label?.trim() ? fromModel.label.trim() : baseOption.label;
      const nextDescription = fromModel?.description?.trim() ? fromModel.description.trim() : baseOption.description;
      return {
        id: baseOption.id,
        label: nextLabel,
        description: nextDescription
      };
    })
  };
}

export async function generateMilestoneOptions(
  run: InternalRunState,
  world: WorldConfig,
  recent: YearEvent[],
  ctx: NarrativeContext
): Promise<AiMilestoneOptions> {
  if (!ctx.apiKey.trim()) {
    return run.nextMilestoneChoice ? fallbackFromChoice(run.nextMilestoneChoice) : defaultOptions();
  }

  const baseChoice = run.nextMilestoneChoice;
  const fallback = baseChoice ? fallbackFromChoice(baseChoice) : defaultOptions();

  const promptPack = normalizePromptPackForModel(ctx.promptPack);
  const systemPrompt = buildSystemPrompt(promptPack, world, ctx, "milestone");
  const systemHash = hashSystemPrompt(systemPrompt);
  const conversation = ensureConversationState(ctx.conversation, systemHash, systemPrompt);
  ctx.conversation = conversation;
  const userPrompt = buildMilestoneOptionsPrompt(run, recent, promptPack, ctx.narrativePlan);
  if (debugModelEnabled()) {
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
    compactConversationWindow(ctx, conversation);
    pushHistory(conversation, "user", projectConversationUserPrompt(userPrompt));
    const first = await callModelAsJson(ctx, systemPrompt, userPrompt, milestoneStructuredOutput, {
      mode: "milestone",
      conversation,
      semanticQuery: `${run.age}|${run.ageStage.label}|${run.personaPrompt}`,
      skipCache: true,
      usageOperation: "choice"
    });
    const text = first.result.text;
    if (debugModelEnabled()) {
      console.log("[model-debug:milestone-options]", {
        hasText: Boolean(text?.trim()),
        len: text?.length ?? 0,
        preview: text?.slice(0, 120) ?? ""
      });
    }
    let parsed = parseMilestonePayload(text);
    if (!parsed) {
      const retryPrompt = [
        userPrompt,
        "R0 上次JSON不可解析，重写。",
        "R1 仅输出合法JSON，不要markdown与解释。",
        "R2 模板:{\"background\":\"...\",\"optionOverrides\":[{\"id\":\"safe\",\"label\":\"A\",\"description\":\"...\"},{\"id\":\"balanced\",\"label\":\"B\",\"description\":\"...\"},{\"id\":\"risky\",\"label\":\"C\",\"description\":\"...\"}]}"
      ].join("\n");
      const retried = await callModelAsJson(ctx, systemPrompt, retryPrompt, milestoneStructuredOutput, {
        mode: "milestone",
        conversation,
        semanticQuery: retryPrompt,
        skipCache: true,
        usageOperation: "choice"
      });
      const retriedText = retried.result.text;
      parsed = parseMilestonePayload(retriedText);
    }

    if (!baseChoice) {
      if (!parsed) return defaultOptions();
      return {
        background: (parsed.background || "命运在你面前摊开新赌局。").trim(),
        optionOverrides: parsed.optionOverrides
      };
    }

    const merged = mergeMilestoneOptions(baseChoice, parsed);
    pushHistory(
      conversation,
      "assistant",
      `${merged.background} | A:${merged.optionOverrides[0]?.description ?? ""} | B:${merged.optionOverrides[1]?.description ?? ""} | C:${merged.optionOverrides[2]?.description ?? ""}`
    );
    keepRecentRounds(conversation);
    return merged;
  } catch (error) {
    keepRecentRounds(conversation);
    debugError("milestone-options", error);
    if (debugModelEnabled()) {
      console.log("[model-debug:milestone-options]", { hasText: false, parseFailed: true, fallback: true });
    }
    return fallback;
  }
}

export async function generateEndingNarrative(
  run: InternalRunState,
  world: WorldConfig,
  ctx: NarrativeContext
): Promise<string> {
  if (!run.ended) return (run.endingSummary ?? "").trim();
  if (!ctx.apiKey.trim()) throw new DirectedStoryRenderError("directed_story_render_unavailable");

  const brief = await ensureEndingBrief(run, world, ctx);
  if (ctx.narrativePlan) ctx.narrativePlan.ending = endingBriefText(brief);

  const promptPack = normalizePromptPackForModel(ctx.promptPack);
  const systemPrompt = buildSystemPrompt(promptPack, world, ctx, "ending");
  const systemHash = hashSystemPrompt(systemPrompt);
  const conversation = ensureConversationState(ctx.conversation, systemHash, systemPrompt);
  ctx.conversation = conversation;
  compactConversationWindow(ctx, conversation);
  const composition = composeNarrativeContext({
    plan: ctx.narrativePlan,
    task: "ending",
    taskPrompt: buildEndingPrompt(run, ctx.narrativePlan ? undefined : brief),
    conversation,
    callId: ctx.callId,
    source: "ending",
    worldId: run.worldId
  });
  const userPrompt = composition.renderedContext;
  if (debugModelEnabled()) {
    console.log("[model-debug:prompt-shape:ending]", {
      systemPromptLen: systemPrompt.length,
      userPromptLen: userPrompt.length,
      outcome: run.outcome,
      context: narrativeContextTrace(composition.manifest)
    });
  }

  try {
    pushHistory(conversation, "user", projectConversationUserPrompt(userPrompt));
    const callResult = await callModel(ctx, systemPrompt, userPrompt, {
      mode: "ending",
      conversation,
      semanticQuery: `${run.outcome}|${run.age}|${run.fame}|${run.deathCause ?? ""}`,
      skipCache: true,
      historyMessages: composition.historyMessages,
      usageOperation: "ending"
    });
    const text = normalizeNarrativeText(callResult.text);
    if (!isSafePlayerNarrative(text) || callResult.truncated || isLikelyTruncated(text)) {
      throw new DirectedStoryRenderError("directed_story_render_invalid_output");
    }
    const reviewed = await refineNarrativeProse(run, world, {
      callId: ctx.callId ?? `ending:${run.runId}:${run.age}`,
      task: "ending",
      ageLabel: `${run.age}岁的人生结算`,
      sceneGoal: "依据已经锁定的结局定性回望人物一生并完成收束",
      narrative: text,
      maxLength: 240
    }, ctx);
    pushHistory(conversation, "assistant", reviewed.narrative);
    keepRecentRounds(conversation);
    return reviewed.narrative;
  } catch (error) {
    keepRecentRounds(conversation);
    debugError("ending-narrative", error);
    if (error instanceof DirectedStoryRenderError) throw error;
    throw new DirectedStoryRenderError("directed_story_render_unavailable");
  }
}
