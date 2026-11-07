import { validateNarrativeEffects, narrativeEffectsSchema, describeNarrativeAttributePolicy, type NarrativeValidationIssue } from "./narrative-attributes.js";
import { buildConversationPromptMessages, keepRecentConversationRounds, projectConversationUserPrompt } from "./conversation.js";
import OpenAI from "openai";
import { ZodError } from "zod";
import { factUpdateContract, parseFactUpdates, relationshipStances, relationshipUpdatesSchema, parseRelationshipUpdates, normalizeNarrativeHandoffFact, isNarrativeFactModelMutable, narrativeActFacts, narrativeContinuityFacts, NarrativeContinuityValidationError } from "./narrative-continuity.js";
import type { ChoiceCheck, ChoiceRoll, NarrativeActOutline, NarrativeDecisionBrief, NarrativeIdentityMerge, NarrativeRelationshipUpdate } from "@reroll/shared";
import { NARRATIVE_ABILITY_DEFINITION, resolvePromptPack,  narrativeToolRule, narrativeProseProfile, narrativeProseProfileInstruction, normalizeNarrativeText, isNarrativePlainText, type PromptPackResolved, type NarrativeTask } from "./narrative-prompts.js";
import { createHash, randomUUID } from "node:crypto";
import { parseAssetRetirements } from "./narrative/asset-scope.js";
import { usesPresetEventAssets, eventAssetTool, eventAssetCandidates, applyEventAssetChanges, type EventAssetChanges } from "./narrative/event-assets.js";
import { resolveNarrativeStatTiers, type InternalRunState } from "./engine.js";
import type { ConversationPromptMessage, ChatConversationState, ChatHistoryMessage, ToolCallRecord } from "./conversation.js";
import type { AiMilestoneOptions, DecisionType, EventStoryPosition, ModelUsageOperation, NarrativeAttributeEffect, NarrativeAttributePolicy, NarrativeBeat, NarrativeActObservation, NarrativeCharacterRelationship,  NarrativeFactUpdates, NarrativeHorizonPlan, NarrativeIntent, NarrativeStatTier, NarrativeWorldDefinition, ProviderConfig, StatKey, Stats, WorldConfig, YearEvent } from "@reroll/shared";
import { formatNarrativePromptPlan, type NarrativePromptPlan } from "./narrative.js";
import { composeNarrativeContext } from "./narrative/context/orchestrator.js";
import type { NarrativeContextComposeInput, NarrativeContextManifest } from "./narrative/context/types.js";
import { narrativeContextTrace } from "./narrative/context/trace.js";
import { recordModelUsage, recordRunGenerationFailure, commitRunMemoryCuration, getRun } from "./store.js";
import type { NarrativeAssetActivity, NarrativeAssets, NarrativeAssetUpdates } from "@reroll/shared";
import { narrativeAbilityDirectory, narrativeAssetDeclarationsSchema, narrativeAssetUpdatesSchema, narrativeContinuityAssetContract, narrativeLocationDirectory, normalizeNarrativeAssetActivity, parseNarrativeAssetUpdates, parseNarrativeAssetDeclarations, parseNarrativeContinuityAssetUpdates } from "./narrative-assets.js";
import { narrativeTurnPlanFocusIds, recentCommittedNarrativeChanges, type NarrativeHorizonInput, type NarrativeSocialForceReference, type NarrativeTurnEnvelope, type NarrativeTurnPlan } from "./narrative/turn.js";
import { parseNarrativeActWorldCard, formatNarrativeActOutline } from "./narrative/act-outline.js";
import { eventFlowCatalog, eventFlowRoles, validateEventFlowPreparation, type EventFlowRenderInput } from "./narrative/event-flow.js";
import { committedNarrativeSequence } from "./narrative/history.js";
import {
  prepareNarrativeMemoryCuration,
  type NarrativeMemoryCurationResult,
  type NarrativeMemoryCurationWork
} from "./narrative/curator.js";
import { narrativeTaskContract, type NarrativeInteractionState } from "./narrative/task-contracts.js";
import { canonicalizeNarrativeReferences, formatNarrativeIdentityDirectory, narrativeIdentityMergesSchema, parseNarrativeIdentityMerges } from "./narrative-identities.js";
import { formatNarrativeExperience, narrativeExperienceText } from "./narrative-memory.js";
import { narrativeProtagonistAnchor, type NarrativeParticipant } from "./narrative-characters.js";
import { prepareRoundParticipants, roundIdentityState, type NarrativeRoundHandoff } from "./narrative/handoff.js";

export interface NarrativeContext {
  callId?: string;
  requestId?: string;
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
  /** Shared only within one step, including its act/ending flushes. */
  continuityAttempts?: Set<string>;
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
  promptMessages?: ConversationPromptMessage[];
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
  cachedInputTokens?: number;
  uncachedInputTokens?: number;
  providerCacheReported?: boolean;
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

export function extractProviderUsage(response: unknown, transport: "chat" | "responses"): ProviderReportedUsage | undefined {
  const usage = (response as {
    usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      input_tokens?: unknown;
      output_tokens?: unknown;
      total_tokens?: unknown;
      prompt_cache_hit_tokens?: unknown;
      prompt_cache_miss_tokens?: unknown;
      input_tokens_details?: { cached_tokens?: unknown };
      prompt_tokens_details?: { cached_tokens?: unknown };
    };
  }).usage;
  if (!usage || typeof usage !== "object") return undefined;
  const inputTokens = reportedTokenValue(transport === "chat" ? usage.prompt_tokens : usage.input_tokens);
  const explicitCached = reportedTokenValue(usage.prompt_cache_hit_tokens);
  const explicitUncached = reportedTokenValue(usage.prompt_cache_miss_tokens);
  const detailedCached = reportedTokenValue(
    transport === "chat"
      ? usage.prompt_tokens_details?.cached_tokens
      : usage.input_tokens_details?.cached_tokens
  );
  const cachedInputTokens = explicitCached ?? detailedCached;
  const uncachedInputTokens = explicitUncached ?? (
    cachedInputTokens !== undefined && inputTokens !== undefined
      ? Math.max(0, inputTokens - cachedInputTokens)
      : undefined
  );
  const providerCacheReported = explicitCached !== undefined || explicitUncached !== undefined || detailedCached !== undefined;
  return {
    inputTokens,
    outputTokens: reportedTokenValue(transport === "chat" ? usage.completion_tokens : usage.output_tokens),
    totalTokens: reportedTokenValue(usage.total_tokens),
    cachedInputTokens,
    uncachedInputTokens,
    providerCacheReported
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
  messages: ConversationPromptMessage[];
  responseId?: string;
}


export interface DirectedDecisionSettlement {
  effects: NarrativeAttributeEffect[];

}

export interface NarrativeContinuityChanges {
  retirements?: import("@reroll/shared").NarrativeAssetRetirement[];

  handoff?: NarrativeRoundHandoff;
  participants?: NarrativeParticipant[];
  assetUpdates?: NarrativeAssetUpdates;
  factUpdates?: NarrativeFactUpdates;
  relationshipUpdates?: NarrativeRelationshipUpdate[];
  identityMerges?: NarrativeIdentityMerge[];
}

export interface NarrativeContinuityWriteSet {
  factIds: string[];
  characterIds: string[];
  locationIds: string[];
  abilityIds: string[];
}

export interface NarrativeContinuityRefs extends NarrativeContinuityWriteSet {}

const emptyNarrativeAssetActivity = (): NarrativeAssetActivity => ({
  locationIds: [],
  abilityIds: []
});

export function narrativeContinuityReadSet(plan: NarrativePromptPlan | undefined): NarrativeContinuityRefs {
  return {
    factIds: Array.from(new Set([
      ...(plan?.recall?.facts ?? []).map((entry) => entry.id),
      ...(plan?.recall?.resolvedFacts ?? []).map((entry) => entry.id)
    ])),
    characterIds: Array.from(new Set((plan?.recall?.characters ?? []).map((entry) => entry.id))),
    locationIds: Array.from(new Set((plan?.recall?.assetSources ?? []).filter((entry) => entry.kind === "location").map((entry) => entry.id))),
    abilityIds: Array.from(new Set((plan?.recall?.assetSources ?? []).filter((entry) => entry.kind === "ability").map((entry) => entry.id)))
  };
}

/**
 * The narrator may read historical canon, but continuity can only mutate open
 * run-local facts belonging to the current act (or unscoped legacy facts).
 */
export function narrativeContinuityWritableSet(
  run: InternalRunState,
  plan: NarrativePromptPlan | undefined
): NarrativeContinuityRefs {
  const readSet = narrativeContinuityReadSet(plan);
  const writableFactIds = new Set(narrativeActFacts(run.narrative, run.story.factLedger?.facts ?? [])
    .map(normalizeNarrativeHandoffFact)
    .filter((fact) => fact.status === "open" && isNarrativeFactModelMutable(fact.id))
    .map((fact) => fact.id));
  return {
    factIds: readSet.factIds.filter((id) => writableFactIds.has(id)),
    characterIds: run.narrative.dynamicCharacters.map((entry) => entry.id),
    locationIds: (run.narrative.assets?.locations ?? []).map((entry) => entry.id),
    abilityIds: (run.narrative.assets?.abilities ?? []).map((entry) => entry.id)
  };
}

export function buildNarrativeContinuityWriteSet(
  run: InternalRunState,
  writableSet: NarrativeContinuityRefs,
  declaredRefs: NarrativeContinuityRefs,
  participantIds: string[] = []
): NarrativeContinuityWriteSet {
  const intersect = (allowed: string[], declared: string[]) => {
    const allow = new Set(allowed);
    return new Set(declared.filter((id) => allow.has(id)));
  };
  const factIds = intersect(writableSet.factIds, declaredRefs.factIds);
  const characterIds = intersect(writableSet.characterIds, declaredRefs.characterIds);
  const locationIds = intersect(writableSet.locationIds, declaredRefs.locationIds);
  const abilityIds = intersect(writableSet.abilityIds, declaredRefs.abilityIds);
  const participantSet = new Set(participantIds);
  return {
    factIds: (run.story.factLedger?.facts ?? [])
      .filter((entry) => factIds.has(entry.id))
      .map((entry) => entry.id),
    characterIds: run.narrative.dynamicCharacters
      .filter((entry) => characterIds.has(entry.id) || participantSet.has(entry.id))
      .map((entry) => entry.id),
    locationIds: (run.narrative.assets?.locations ?? [])
      .filter((entry) => locationIds.has(entry.id))
      .map((entry) => entry.id),
    abilityIds: (run.narrative.assets?.abilities ?? [])
      .filter((entry) => abilityIds.has(entry.id))
      .map((entry) => entry.id)
  };
}

export function hasNarrativeContinuityWork(
  writeSet: NarrativeContinuityWriteSet,
  continuityRequired = false
): boolean {
  return continuityRequired || writeSet.factIds.length > 0 || writeSet.characterIds.length > 0 ||
    writeSet.locationIds.length > 0 || writeSet.abilityIds.length > 0;
}

export interface DirectedDecisionNarrativeOutcome extends DirectedDecisionSettlement, NarrativeContinuityChanges {
  narrative: string;
  assetActivity: NarrativeAssetActivity;
  survivalThreat?: string;
  nextClock?: "hold" | "advance";
}

export interface NarrativeOriginOutcome {
  originBindings?: Record<string, string>;
  participants?: NarrativeParticipant[];
  assetUpdates?: NarrativeAssetUpdates;
  narrative: string;

}

/**
 * Semantic helper calls must not inherit the renderer's recall set or mutate its
 * conversation window. Their complete input lives in the dedicated task prompt.
 */
function isolatedNarrativeTaskContext(ctx: NarrativeContext, task: NarrativeTask = "planning"): NarrativeContext {
  return {
    ...ctx,
    conversation: undefined,
    narrativePlan: {
      task,
      storyBible: "",
      activeLore: [],
      plotEssentials: [],
      activeThreads: [],
      activeCharacters: [],
      scene: "",
      authorNote: "",
      ending: "",
      recall: {
        assetContext: "",
        characters: [],
        facts: [],
        memories: []
      }
    }
  };
}

export interface DynamicNarrativeSceneInput {
  flowEvent?: EventFlowRenderInput;
  choiceCheck?: ChoiceCheck;
  handoff?: NarrativeRoundHandoff;
  protagonistAnchor?: string;
  plan?: NarrativeTurnPlan;
  act: { id: string; label: string; prompt: string; factLabel?: string };
  presentation: NarrativeTurnPlan["presentation"];
  allowedTurnKinds: Array<"scene" | "background">;
  /** Age facts are projected by the engine before the model is called. */
  sceneAge: number;
  backgroundAgeRange: { fromAge: number; toAge: number };
  storyPatterns: Array<{ id: string; label: string; summary: string }>;
  socialForces: NarrativeSocialForceReference[];
  knownCharacters: Array<{ id: string; name: string; factionId?: string; role?: string; description?: string; relationship?: string }>;
  knownFactIds?: string[];
  attributePolicy?: NarrativeAttributePolicy;
  backgroundAttributePolicy: NarrativeAttributePolicy;
  growthFocus?: { label: string; description: string };
  preparation?: NarrativeTurnEnvelope["preparation"];
  statTiers: Record<StatKey, NarrativeStatTier>;
  statTierLabels?: Record<StatKey, string>;
  recentChanges?: string[];
  lifeStage?: {
    label: string;
    maxAge: number;
  };
}

export interface DynamicNarrativeSceneResult {
  flowSource?: import("@reroll/shared").NarrativeEventFlowSource;
  resolutionId?: string;
  choiceCheck?: ChoiceCheck;
  handoff?: NarrativeRoundHandoff;
  identityMerges?: NarrativeIdentityMerge[];
  assetUpdates?: NarrativeAssetUpdates;
  factUpdates?: NarrativeFactUpdates;
  relationshipUpdates?: NarrativeRelationshipUpdate[];
  turnKind: "scene" | "background";
  patternIds: string[];
  forceIds: string[];
  /** Engine-facing fact decisions made by the isolated beat observer. */
  narrative: string;
  nextClock?: "hold" | "advance";
  participants: NarrativeParticipant[];
  milestoneCopy?: AiMilestoneOptions;
  createsDecision?: boolean;
  decisionBrief?: NarrativeDecisionBrief;
  attributeEffects?: NarrativeAttributeEffect[];

  /** One engine-approved growth intent, applied across this fixed background span. */
  backgroundAttributeEffects?: NarrativeAttributeEffect[];
  /** Existing assets actually visited or used, plus explicit new-asset signals. */
  assetActivity: NarrativeAssetActivity;
}


export async function observeNarrativeAct(
  run: InternalRunState, world: WorldConfig,
  input: { callId: string; actId: string; sourceEventId: string; recentStory: string; outline: NarrativeActOutline;
    eventFlow?: { id: string; label: string; narrativeRole: string; result: string } },
  ctx: NarrativeContext
): Promise<NarrativeActObservation> {
  const taskContext = isolatedNarrativeTaskContext(ctx, "observation");
  taskContext.narrativePlan!.eventFlowMode = Boolean(input.eventFlow);
  taskContext.narrativePlan!.actBackground = formatNarrativeActOutline(input.outline, true);
  const result = await requestNarrativeOutcomeTool(run, world, taskContext, narrativeActObservationTool(Boolean(input.eventFlow)),
    narrativeActObservationPrompt({ ...input, storyPack: run.storyPackSnapshot }), {
      task: "observation", callId: input.callId + ":act-observer", source: "scene", actId: input.actId,
      parseResult: (raw) => {
        const parsed = parseNarrativeActObservation(raw, input.actId, input.sourceEventId);
        if (input.eventFlow && parsed.decision === "run_ended" && (!parsed.lifeStatus ||
            (parsed.lifeStatus === "dead" && !parsed.deathCause))) throw invalidNarrativeOutcome("narrative_act_observation_invalid", { rule: "ending_life_status_required", path: "lifeStatus", received: raw.lifeStatus });
        if (parsed.decision === "act_closed" && run.storyPackSnapshot?.acts.at(-1)?.id === input.actId) {
          throw invalidNarrativeOutcome("narrative_act_observation_invalid", { rule: "final_act_has_no_next_act", path: "decision", expected: ["ongoing", "run_ended"], received: parsed.decision });
        }
        return parsed;
      }
    });
  return result.parsed!;
}

export function narrativeActObservationTool(eventFlow = false) {
  return { type: "function", function: {
    name: "observe_act_closure", description: "本幕及整局收束判断。",
    parameters: { type: "object", additionalProperties: false, required: ["decision", "evidence"], properties: {
      decision: { type: "string", enum: ["ongoing", "act_closed", "run_ended"],
        description: "ongoing：整幕结果尚未成立；act_closed：整幕结果成立并进入下一幕；run_ended：实际人生已符合 IF 结局标准。" },
      evidence: { type: ["string", "null"], description: "收束时填写实际结果依据；继续时可以为空。" },
      endingPolarity: { type: "string", enum: ["good", "normal", "bad"], description: "仅 run_ended 时填写 IF 标准对应的结局等级。" },
      ...(eventFlow ? { lifeStatus: { type: "string", enum: ["alive", "dead"], description: "整局结束时，主角实际存活还是已经死亡。" },
        deathCause: { type: "string", description: "仅主角已经死亡时填写实际死因。" } } : {})
    } }
  } };
}

export function parseNarrativeActObservation(raw: Record<string, unknown>, actId: string, sourceEventId: string): NarrativeActObservation {
  if (raw.decision !== "ongoing" && raw.decision !== "act_closed" && raw.decision !== "run_ended") throw invalidNarrativeOutcome("narrative_act_observation_invalid",
    { rule: "invalid_value", path: "decision", received: raw.decision });
  if (raw.decision !== "ongoing" && (typeof raw.evidence !== "string" || !raw.evidence.trim())) {
    throw invalidNarrativeOutcome("narrative_act_observation_invalid", { rule: "invalid_value", path: "evidence", received: raw.evidence });
  }
  if (raw.decision === "run_ended" && !["good", "normal", "bad"].includes(String(raw.endingPolarity))) {
    throw invalidNarrativeOutcome("narrative_act_observation_invalid", { rule: "invalid_value", path: "endingPolarity", received: raw.endingPolarity });
  }
  return { decision: raw.decision, evidence: raw.decision !== "ongoing" && typeof raw.evidence === "string" ? raw.evidence.trim() : undefined,
    ...(raw.decision === "run_ended" ? { endingPolarity: raw.endingPolarity as NarrativeActObservation["endingPolarity"] } : {}),
    ...(raw.decision === "run_ended" && (raw.lifeStatus === "alive" || raw.lifeStatus === "dead") ? {
      lifeStatus: raw.lifeStatus, ...(raw.lifeStatus === "dead" && typeof raw.deathCause === "string" ? { deathCause: raw.deathCause.trim() } : {}) } : {}),
    actId, sourceEventId, createdAt: Date.now() };
}

export function narrativeActObservationPrompt(input: { recentStory: string; actId?: string; storyPack?: InternalRunState["storyPackSnapshot"]; eventFlow?: { id: string; label: string; narrativeRole: string; result: string } }): string {
  const pack = input.storyPack;
  return [pack ? "IF 人生成长方向：" + JSON.stringify({ name: pack.name, protagonistTrajectory: pack.protagonistTrajectory }) : "",
    pack ? "IF 结局标准：" + JSON.stringify(pack.endingDirections) : "",
    pack ? "本幕序位：" + (pack.acts.findIndex((act) => act.id === input.actId) + 1) + "/" + pack.acts.length : "",
    input.eventFlow ? "已提交事件组及确定结果：" + JSON.stringify(input.eventFlow) : "",
    "实际历史（含本次完整事件）：\n" + input.recentStory].filter(Boolean).join("\n");
}

export function nextEventFlowTool() {
  return { type: "function", function: { name: "plan_next_event_flow", description: "下一事件组选择。",
    parameters: { type: "object", additionalProperties: false, required: ["nextFlowId"], properties: {
      nextFlowId: { type: "string", description: "候选事件组的完整 ID。" }
    } } } };
}

export async function planNextEventFlow(
  run: InternalRunState, world: WorldConfig,
  input: { callId: string; actId: string; outline: NarrativeActOutline; recentStory: string;
    previous: { id: string; label: string; narrativeRole: string; result: string };
    candidates: Array<{ id: string; label: string; narrativeRole: string; entry: string }> },
  ctx: NarrativeContext
): Promise<string> {
  if (!input.candidates.length) throw new Error("event_flow_candidates_empty");
  const taskContext = isolatedNarrativeTaskContext(ctx, "planning");
  taskContext.narrativePlan!.eventFlowMode = true;
  taskContext.narrativePlan!.actBackground = formatNarrativeActOutline(input.outline);
  const result = await requestNarrativeOutcomeTool(run, world, taskContext, nextEventFlowTool(), [
    "当前人物状态：" + JSON.stringify({ age: run.age, stats: run.stats }),
    "上一事件组及确定结果：" + JSON.stringify(input.previous),
    "实际历史：\n" + input.recentStory,
    "后续候选（尚未发生）：" + JSON.stringify(input.candidates)
  ].join("\n"), {
    task: "planning", planningPurpose: "continuation", callId: input.callId + ":next-flow", actId: input.actId,
    parseResult: (raw) => {
      if (typeof raw.nextFlowId !== "string" || !input.candidates.some((group) => group.id === raw.nextFlowId)) {
        throw invalidNarrativeOutcome("narrative_next_flow_invalid", { rule: "reference_invalid", path: "nextFlowId", received: raw.nextFlowId });
      }
      return raw.nextFlowId;
    }
  });
  return result.parsed!;
}

export function nextEventUnitTool() {
  return { type: "function", function: { name: "route_event_unit", description: "选择同组内接续的完整事件单元。",
    parameters: { type: "object", additionalProperties: false, required: ["nextEventId"], properties: {
      nextEventId: { type: "string", description: "候选单元的完整 ID。" }
    } } } };
}

export async function planNextEventUnit(
  run: InternalRunState, world: WorldConfig,
  input: { callId: string; actId: string; outline: NarrativeActOutline; recentStory: string;
    group: { id: string; label: string; narrativeRole: string };
    candidates: Array<{ id: string; kind: string; entry: string; situation: string }> },
  ctx: NarrativeContext
): Promise<string> {
  if (!input.candidates.length) throw new Error("event_unit_candidates_empty");
  const taskContext = isolatedNarrativeTaskContext(ctx, "planning");
  taskContext.narrativePlan!.eventFlowMode = true;
  taskContext.narrativePlan!.actBackground = formatNarrativeActOutline(input.outline);
  const result = await requestNarrativeOutcomeTool(run, world, taskContext, nextEventUnitTool(), [
    "当前事件组：" + JSON.stringify(input.group),
    "实际历史：\n" + input.recentStory,
    "后续单元候选（尚未发生）：" + JSON.stringify(input.candidates)
  ].join("\n"), { task: "planning", planningPurpose: "continuation", callId: input.callId + ":next-unit", actId: input.actId,
    parseResult: (raw) => {
      if (typeof raw.nextEventId !== "string" || !input.candidates.some((event) => event.id === raw.nextEventId)) {
        throw invalidNarrativeOutcome("narrative_next_event_invalid", { rule: "reference_invalid", path: "nextEventId", received: raw.nextEventId });
      }
      return raw.nextEventId;
    }
  });
  return result.parsed!;
}

function narrativeTurnReferenceCatalog(input: NarrativeTurnEnvelope) {
  return [...input.focusReferences, ...input.socialForces.map((force) => ({
    id: force.id, kind: "force" as const, label: force.label, summary: force.summary
  }))];
}

export function narrativeTurnPlanTools(input: NarrativeTurnEnvelope): Record<string, unknown>[] {
  if (!input.actOutline) return [{ type: "function", function: {
    name: "plan_act_world_card", description: "本幕稳定的主持资料。",
    parameters: { type: "object", additionalProperties: false, required: ["situation", "actors", "locations", "pressures", "stakes", "worldRuleRefs", ...(input.eventFlowPreparation ? ["flowBindings", "eventFlows"] : [])],
      properties: {
        worldRuleRefs: { type: "array", items: { type: "string" }, description: "从已提供的世界规则目录选择本幕适用的完整 ID；规则原文由引擎保存，不改写规则。没有适用规则时填 []。" },
        situation: { type: "string", minLength: 1 },
        actors: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "identity", "goal", "forces", "relationships"], properties: Object.fromEntries(["name", "identity", "goal", "forces", "relationships"].map((key) => [key, { type: "string", minLength: 1 }])) } },
        locations: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "conditions", "resources", "obstacles", "connections"], properties: Object.fromEntries(["name", "conditions", "resources", "obstacles", "connections"].map((key) => [key, { type: "string", minLength: 1 }])) } },
        pressures: { type: "array", items: { type: "object", additionalProperties: false, required: ["source", "condition", "development"], properties: Object.fromEntries(["source", "condition", "development"].map((key) => [key, { type: "string", minLength: 1 }])) } },
        stakes: { type: "array", items: { type: "string", minLength: 1 } },
        ...(input.eventFlowPreparation ? {
          flowBindings: { type: "array", description: "只为需要具象化的角色绑定本局名称，包括尚未出现的道具名称；没有新角色时填 []。已有名称由引擎复用，不重复提交；名称绑定不表示道具已取得。", items: {
            type: "object", additionalProperties: false, required: ["roleId", "name"], properties: { roleId: { type: "string" }, name: { type: "string" } }
          } },
          eventFlows: { type: "object", additionalProperties: false, required: ["openingFlowId", "availableFlowIds"],
            description: "本幕开场组与可用事件组。相同叙事地位可选适合本局的一组，保留不同地位的成长、失败后续和本幕结果组。这里只引用骨架，不写事件树。",
            properties: { openingFlowId: { type: "string", description: "本幕开场组；其 requiresItems 必须已在实际库存中。" }, availableFlowIds: { type: "array", items: { type: "string" } } } }
        } : {})
      } }
  } }];
  if (!input.capabilities.includes("scene")) return [];
  return [{ type: "function", function: {
    name: "recall_scene_assets", description: "相关引用。",
    parameters: { type: "object", additionalProperties: false, required: ["recallRefs"], properties: {
      recallRefs: { type: "array", items: { type: "string", description: "目录完整 ID。" } }
    } }
  } }];
}

export function narrativeTurnPlanningPrompt(input: NarrativeTurnEnvelope, plan?: NarrativePromptPlan): string {
  if (!input.actOutline) return [
    "本幕：" + input.act.label,
    "当前年龄：" + input.currentAge,
    "可选世界规则目录（原文见世界设定）：" + JSON.stringify((plan?.activeWorldCardSources ?? [])
      .filter((card) => card.kind === "world_rule").map((card) => ({ id: card.id, title: card.title }))),
    input.eventFlowPreparation ? "需要具象化的角色：" + JSON.stringify(input.eventFlowPreparation.roles) : "",
    input.eventFlowPreparation ? "已成立的名称绑定：" + JSON.stringify(input.eventFlowPreparation.existingBindings) : "",
    input.eventFlowPreparation ? "实际持有的事件道具（候选素材不是已取得物品）：" + JSON.stringify(input.eventFlowPreparation.inventory) : "",
    input.eventFlowPreparation ? "人工事件组（候选素材，尚未发生）：" + JSON.stringify(input.eventFlowPreparation.groups) : ""
  ].filter(Boolean).join("\n");
  return [
    "本段年龄：" + input.sceneAge + "岁",
    "查询目录：" + JSON.stringify(narrativeTurnReferenceCatalog(input)),
    !plan?.storyHistory && (input.recentChanges ?? []).length ? "近期实际经历：\n" + input.recentChanges!.join("\n\n") : ""
  ].filter(Boolean).join("\n");
}

/** Used exclusively by the background act preparation job. */
export async function generateNarrativeActWorldCard(
  run: InternalRunState, world: WorldConfig, input: NarrativeTurnEnvelope, ctx: NarrativeContext
): Promise<NarrativeActOutline> {
  const definition = run.narrative.version >= 19 ? run.storyPackSnapshot?.eventFlow : undefined;
  const roles = definition ? eventFlowRoles(definition, input.act.id) : [];
  const existingBindings = Object.fromEntries(roles.flatMap((role) => {
    const name = run.narrative.eventFlow?.bindings[role.id] ?? role.name;
    return name ? [[role.id, name]] : [];
  }));
  const planningInput: NarrativeTurnEnvelope = { ...input, ...(definition ? { eventFlowPreparation: {
    roles: roles.filter((role) => !existingBindings[role.id]), existingBindings,
    inventory: definition.items.filter((item) => run.items.some((owned) => owned.id === run.storyPackSnapshot!.id + ":item:" + item.id))
      .map((item) => ({ id: item.id, name: run.items.find((owned) => owned.id === run.storyPackSnapshot!.id + ":item:" + item.id)!.name })),
    groups: eventFlowCatalog(definition, input.act.id)
  } } : {}) };
  const result = await requestNarrativeOutcomeTool(run, world, ctx, narrativeTurnPlanTools(planningInput),
    narrativeTurnPlanningPrompt(planningInput, ctx.narrativePlan), {
      task: "planning", planningPurpose: "initial", callId: input.callId + ":outline", source: input.source,
      age: input.currentAge, actId: input.act.id,
      parseResult: (raw) => {
        try { const card = parseNarrativeActWorldCard(raw, input.act.id, {
          objective: input.act.objective ?? input.act.prompt, closureMeaning: input.act.closureMeaning ?? input.act.prompt
        }, (ctx.narrativePlan?.activeWorldCardSources ?? []).filter((source) => source.kind === "world_rule")
          .map((source) => ({ id: source.id, title: source.title ?? source.id, text: source.text })));
          if (definition) card.flowBindings = [
            ...Object.entries(existingBindings).map(([roleId, name]) => ({ roleId, name })),
            ...(card.flowBindings ?? [])
          ];
          validateEventFlowPreparation(run, card, true); return card;
        } catch { throw invalidNarrativeOutcome("narrative_act_outline_invalid", { rule: "invalid_value", path: "hostingMaterials", received: raw }); }
      }
    });
  return result.parsed!;
}

export async function generateNarrativeTurnPlan(
  run: InternalRunState, world: WorldConfig, input: NarrativeTurnEnvelope, ctx: NarrativeContext
): Promise<NarrativeTurnPlan> {
  const scene = input.capabilities.includes("scene");
  if (scene && !input.actOutline) throw new Error("narrative_act_outline_not_ready");
  // Asset maintenance currently serves the archive UI only. Keep the engine's
  // turn/time handoff, without a recall request or maintained archive material.
  return {
    callId: input.callId, turnKind: scene ? "scene" : "background",
    patternIds: [], forceIds: [], conflictRefs: [], abilityRefs: [],
    locationRefs: [], recallRefs: [], presentation: scene ? "scene" : "summary",
    actOutline: input.actOutline
  };
}

export function parseNarrativeTurnPlan(raw: Record<string, unknown>, toolName: string, input: NarrativeTurnEnvelope): NarrativeTurnPlan {
  if (toolName !== "recall_scene_assets" || !input.capabilities.includes("scene")) throw invalidNarrativeOutcome("narrative_turn_plan_kind_invalid");
  if (Object.keys(raw).some((key) => key !== "recallRefs") || !Array.isArray(raw.recallRefs)) {
    throw invalidNarrativeOutcome("narrative_turn_plan_material_invalid", { rule: "invalid_shape", path: "recallRefs" });
  }
  const catalog = narrativeTurnReferenceCatalog(input);
  const recallRefs = Array.from(new Set(raw.recallRefs.map((ref, index) => {
    if (typeof ref !== "string" || !catalog.some((candidate) => candidate.id === ref)) throw invalidNarrativeOutcome("narrative_turn_plan_material_invalid",
      { rule: "reference_invalid", path: "recallRefs[" + index + "]", received: ref });
    return ref;
  })));
  const refs = (kinds: string[]) => recallRefs.filter((ref) => kinds.includes(catalog.find((entry) => entry.id === ref)!.kind));
  return { callId: input.callId, turnKind: "scene", presentation: "scene", patternIds: [],
    recallRefs, conflictRefs: refs(["fact","character","world_card"]),
    abilityRefs: refs(["ability"]), locationRefs: refs(["location"]), forceIds: refs(["force"]),
    actOutline: input.actOutline };
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
  if (error instanceof NarrativeContinuityValidationError) {
    return { rule: error.rule, path: [path, error.path].filter(Boolean).join(".") };
  }
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
const CHAT_TOOL_NAME_MAX_LEN = 64;
const CHAT_TOOL_CALL_ID_MAX_LEN = 80;
const SHORT_YEAR_MIN_CHARS = 50;
const SHORT_YEAR_MAX_CHARS = 80;
const memoryCuratorJobs = new Map<string, Promise<void>>();
const memoryCuratorPending = new Map<string, { work: NarrativeMemoryCurationWork; lastAttemptSequence: number }>();
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
  options: { maxSegments: number }
): string {
  if (!text) return "";
  const parts = text
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, options.maxSegments);
  return parts.join(" | ");
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
    headCore: headCore.trim(),
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
  return source;
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
    const content = typeof value.content === "string" ? value.content.trim() : "";
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
    headCore: headCore.trim(),
    summaryRevision: conversation.summaryRevision ?? 0,
    summaryThroughMemoryId: conversation.summaryThroughMemoryId,
    summarizedMemoryIds: Array.isArray(conversation.summarizedMemoryIds)
      ? Array.from(new Set(conversation.summarizedMemoryIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))))
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
  const normalized = content.trim();
  if (!toolCallId || !name || !normalized) return;
  conversation.history.push({ role: "tool", toolCallId, name, content: normalized });
}

function keepRecentRounds(conversation: ChatConversationState): void {
  keepRecentConversationRounds(conversation, CHAT_WINDOW_ROUNDS);
}

export function memoryCurationTool(_work: NarrativeMemoryCurationWork): Record<string, unknown> {
  return { type: "function", function: {
    name: "curate_narrative_memory", description: "历史压缩结果。",
    parameters: { type: "object", additionalProperties: false, required: ["summary"], properties: {
      summary: { type: "string", minLength: 1, description: "本时段的大事概要。" }
    } }
  } };
}

export function memoryCurationPrompt(work: NarrativeMemoryCurationWork): string {
  return [
    `本时段：${work.fromAge}—${work.throughAge}岁`,
    "实际对话：\n" + work.episodes.map((episode) => episode.narrative).join("\n\n")
  ].filter(Boolean).join("\n");
}

async function generateNarrativeMemoryCuration(ctx: NarrativeContext, run: InternalRunState, world: WorldConfig, work: NarrativeMemoryCurationWork): Promise<NarrativeMemoryCurationResult> {
  const result = await requestNarrativeOutcomeTool(run, world, ctx, memoryCurationTool(work), memoryCurationPrompt(work), {
    task: "curation", callId: "curation:" + run.runId + ":" + work.revision,
    parseResult: (raw) => parseNarrativeMemoryCuration(raw, work)
  });
  return result.parsed!;
}

export function parseNarrativeMemoryCuration(raw: Record<string, unknown>, _work: NarrativeMemoryCurationWork): NarrativeMemoryCurationResult {
  const summary = normalizeNarrativeText(raw.summary);
  if (!isNarrativePlainText(summary, 1)) throw invalidNarrativeOutcome("narrative_curation_invalid", { rule: "text_required", path: "summary" });
  return { summary };
}

export function scheduleCommittedNarrativeCuration(ctx: NarrativeContext, run: InternalRunState, world: WorldConfig): void {
  const sessionId = ctx.usageScope?.sessionId;
  if (!sessionId || ctx.usageScope?.runId !== run.runId) return;
  const key = run.runId;
  if (memoryCuratorJobs.has(key)) return;
  const pending = memoryCuratorPending.get(key);
  if (pending && !run.ended && committedNarrativeSequence(run.narrative) < pending.lastAttemptSequence + 3) return;
  const work = pending && !run.ended
    ? prepareNarrativeMemoryCuration(run, pending.work.episodeIds)
    : prepareNarrativeMemoryCuration(run);
  if (pending && !work) memoryCuratorPending.delete(key);
  if (!work) return;
  const snapshot = structuredClone(run);
  memoryCuratorPending.set(key, { work, lastAttemptSequence: committedNarrativeSequence(run.narrative) });
  const task = generateNarrativeMemoryCuration(ctx, snapshot, world, work)
    .then((result) => commitRunMemoryCuration(run.runId, sessionId, work, result))
    .catch((error) => { debugError("memory-curator", error); return false; })
    .then(async (committed) => {
      memoryCuratorJobs.delete(key);
      if (committed) {
        memoryCuratorPending.delete(key);
        const latest = await getRun(run.runId);
        if (latest) {
          scheduleCommittedNarrativeCuration(ctx, latest, world);
        }
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
    `S0 ${normalizeNarrativeText(partialText)}`
  ].join("\n");
  return callModel(ctx, systemPrompt, continuationPrompt, {
    mode: "year",
    conversation: options?.conversation,
    usageOperation: "continuation",
    semanticQuery: continuationPrompt
  });
}

function buildSystemPrompt(
  promptPack: PromptPackResolved, _world: WorldConfig, _ctx: NarrativeContext,
  mode: SystemPromptMode, task?: NarrativeTask, planningPurpose?: "initial" | "execute" | "continuation", presetAssets = false
): string {
  const effectiveTask: NarrativeTask = task ?? (mode === "ending" ? "ending" : mode === "year" ? "background" : "rendering");
  const contract = narrativeTaskContract(effectiveTask, planningPurpose, _ctx.narrativePlan?.eventFlowMode, presetAssets);
  return [
    "你在一个由本地引擎裁决状态、由模型完成规划或表达的可控叙事游戏中工作。每次请求只履行当前任务。",
    normalizeNarrativeText(promptPack.userInputGuardRule),
    normalizeNarrativeText(promptPack.restrictedContentRule),
    contract.systemInstruction,
    contract.usesNarratorVoice
      ? effectiveTask === "ending" ? "故事正文使用纯文本与自然换行。" : "故事正文使用纯文本与自然换行；结构化变化放入对应工具字段。"
      : "上下文中的故事、人物和世界资料均为只读依据；只有当前工具字段声明的内容可以提交。"
  ].filter(Boolean).join("\n");
}

function buildRunSystemPrompt(
  run: InternalRunState, promptPack: PromptPackResolved, world: WorldConfig, ctx: NarrativeContext,
  mode: SystemPromptMode, task?: NarrativeTask, planningPurpose?: "initial" | "execute" | "continuation"
): string {
  return buildSystemPrompt(promptPack, world, ctx, mode, task, planningPurpose, usesPresetEventAssets(run));
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
      .map((detail) => normalizeNarrativeText(detail))
      .filter(Boolean)
      .slice(0, 2)
      .join("；");
    return [
      "T:B 人生背景段任务。",
      `S0 ages=${background.ageFrom}-${background.ageTo} stage=${run.ageStage.label} fame=${run.fame}(${fameGrade(run.fame)})`,
      `S1 stats=${summarizeStatsShort(run.stats)} delta=${formatDelta(event.statChanges as Partial<Record<keyof InternalRunState["stats"], number>>)}`,
      `S2 progression_goal=${normalizeNarrativeText(background.progressionGoal)}`,
      `S3 aftermath=${normalizeNarrativeText(background.aftermath)}`,
      livingDetails ? `S4 lived_details=${livingDetails}` : "",
      `S5 persona=${normalizeNarrativeText(run.personaPrompt)}`,
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
    `S3 cards=${normalizeNarrativeText(cards)} blank=${hasBlankYears(run.history.slice(-12)) ? "Y" : "N"} blankLog=${normalizeNarrativeText(summarizeBlankYears(run.history.slice(-12)))}`,
    `S4 persona=${normalizeNarrativeText(run.personaPrompt)}`,
    recent ? `S5 recent=${normalizeNarrativeText(recent)}` : "",
    latestDecision ? `S6 decision=${normalizeNarrativeText(latestDecision)}` : "",
    `E0 title=${normalizeNarrativeText(eventTitle)} summary=${normalizeNarrativeText(event.summary)}`,
    formatNarrativePromptPlan(narrativePlan),
    run.narrative.enabled && !run.story.mainlineCompleted
      ? "R:YEND 主线尚未完成；不得暗示故事、人生或命运即将结束，也不得写结局式收束。"
      : "",
    yearLenRule,
    `R:YMAIN 先写本年关键变化，再点出直接后果。`,
    `R:YAGE 若出现年龄词，必须与S0一致，只能写${event.age}岁；禁止写上一年或下一年。`,
    `R:YOUT 只输出最终叙事文本。`,
    `R:YRULE ${normalizeNarrativeText(rule)}`,
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
    .map((line, idx) => `S${idx + 1}:${normalizeNarrativeText(line)}`)
    .join(" | ");
  return [
    basePrompt,
    "R0 去重重写：保留当年事件与属性变化语义，但换句式与动作。",
    compareSamples ? `R1 对比样本:${compareSamples}` : "",
    `R2 上版禁复用:${normalizeNarrativeText(duplicatedText)}`,
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
    `S2 persona=${normalizeNarrativeText(run.personaPrompt)}`,
    `S3 recent=${normalizeNarrativeText(summarizeRecent(recent.slice(-4)))}`,
    formatNarrativePromptPlan(narrativePlan),
    `R:M ${normalizeNarrativeText(promptPack.milestoneRule)}`,
    "R:MOUT 只返回JSON:{background,optionOverrides[3]}",
    "R:MLEN background 建议60-80字；description 简述行动；仅一种表达，不做同义复述。"
  ].join("\n");
}

function buildEndingPrompt(run: InternalRunState): string {
  return [
    `已确认结局：${run.narrative.endingPolarity ?? run.outcome}；本局结束年龄：${run.age}岁。`,
    run.narrative.lastActObservation?.decision === "run_ended" ? "已确认的实际结局依据：" + run.narrative.lastActObservation.evidence : "",
    run.outcome === "dead" ? "已发生的死亡事实：" + (run.deathCause ?? "意外") : ""
  ].filter(Boolean).join("\n");
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
    const promptMessages = options?.promptMessages ?? [
      ...(convo ? buildConversationPromptMessages(convo) : []),
      { role: "user" as const, content: userPrompt }
    ];
    if (ctx.providerConfig.apiPath === "/responses") {
      const format = options?.structuredOutput
        ? { type: "json_schema", name: options.structuredOutput.name, description: options.structuredOutput.description, schema: options.structuredOutput.schema, strict: true }
        : options?.jsonMode ? { type: "json_object" } : undefined;
      const response = await createTrackedResponse(ctx, client, {
        model: ctx.providerConfig.model, instructions: systemMessage, input: promptMessages,
        temperature: ctx.providerConfig.temperature, max_output_tokens: ctx.providerConfig.maxTokens,
        ...(format ? { text: { format } } : {})
      } as never, usageOperation) as { output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>; status?: string; incomplete_details?: { reason?: string } };
      const text = (response.output ?? []).filter((item) => item.type === "message")
        .flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("").trim();
      return { text, truncated: response.status === "incomplete", truncateReason: response.incomplete_details?.reason };
    }
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
        ...promptMessages
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


function narrativeOriginOutcomeTool(): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: "render_origin",
      description: "提交身世正文与身份登记。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["narrative", "participants"],
        properties: {
          narrative: { type: "string", minLength: 1 },
          participants: narrativeParticipantsSchema()
        }
      }
    }
  };
}

export function narrativeDecisionOutcomeTool(policy: NarrativeAttributePolicy): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: "resolve_decision_outcome",
      description: "本轮实际属性变化。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["effects"],
        properties: {
          effects: narrativeEffectsSchema(policy)
        }
      }
    }
  };
}

function decisionSettlementContract(policy: NarrativeAttributePolicy) {
  return {
    tool: narrativeDecisionOutcomeTool(policy),
    parse(raw: Record<string, unknown>): DirectedDecisionSettlement {
      const effects = parseNarrativeEffects(raw.effects, policy, "decision_outcome_invalid");
      return { effects };
    }
  };
}

export function narrativeDecisionRenderTool(): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: "render_decision_outcome",
      description: "本次事件的结果正文。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["narrative", "nextClock"],
        properties: {
          narrative: { type: "string", minLength: 1 },
          nextClock: nextClockSchema(),
          survivalThreat: { type: "string", description: "获准且正文实际出现生命威胁时填写该威胁；否则省略。不直接判定死亡。" }
        }
      }
    }
  };
}

function narrativeContinuityTool(): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: "sync_narrative_continuity",
      description: "本批现状差量、身份归并与撤下。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {}
      }
    }
  };
}

export function validateNarrativeContinuityToolArguments(
  raw: Record<string, unknown>, parameters: { properties: Record<string, unknown>; required: string[] }
): void {
  for (const field of Object.keys(raw)) {
    if (!Object.hasOwn(parameters.properties, field)) {
      throw invalidNarrativeOutcome("tool_arguments_invalid", { rule: "unexpected_field", path: field });
    }
  }
  for (const field of parameters.required) {
    if (!Object.hasOwn(raw, field)) {
      throw invalidNarrativeOutcome("tool_arguments_invalid", { rule: "required_field_missing", path: field });
    }
  }
}

type DynamicNarrativeToolName = "resolve_background_outcome" | "resolve_scene_outcome";
type DynamicNarrativeRenderToolName = "render_background_prose" | "render_scene_prose" | "render_choice_prose" | "render_event_settlement";

interface DynamicNarrativeToolSet {
  tools: Record<string, unknown>[];
  names: DynamicNarrativeToolName[];
}

function narrativeParticipantsSchema(declarations = false) {
  if (declarations) return { type: "array", description: "主角由对局保存，不作为 participants 登记。这里只登记需要保留身份的具体人物。", items: {
    type: "object", additionalProperties: false, required: ["characterRef"],
    anyOf: [{ properties: { characterRef: { const: "new" } }, required: ["name"] }, { properties: { characterRef: { not: { const: "new" } } } }],
    properties: {
      characterRef: { type: "string", description: "人物准确名称或已知完整 ID，也可用 new＋name 登记。引擎复用唯一同名身份，未识别名称形成候选，歧义留待整理。" },
      name: { type: "string", minLength: 1, description: "人物名称。" }
    }
  } };
  return {
    type: "array",
    description: "主角之外，需要维持身份与后续连续性的具体人物；没有时返回 []。主角由对局保存，不作为 participants 登记；无名人群只写入正文。",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["characterRef"],
      anyOf: [
        { properties: { characterRef: { const: "new" } }, required: ["name", "role", "description", "recurring"] },
        { properties: { characterRef: { not: { const: "new" } } } }
      ],
      description: '每个人物均填写 characterRef。新角色使用 {"characterRef":"new"} 并填写 name、role、description、recurring；已有角色完整复制其 character: ID，身份或处境变化时更新 role、description。无人物登记或变化时返回 []。',
      properties: {
        characterRef: {
          type: "string",
          description: "已有角色必须完整复制本轮人物引用目录中的 ID，包括 character: 前缀；首次出现的人物使用 new。"
        },
        name: { type: "string", minLength: 1 },
        factionId: { type: "string", description: "当前所属阵营，使用本轮社会力量 ID；变化时更新，空字符串表示退出，省略保持最新归属。" },
        role: { type: "string", minLength: 1, description: "当前简短身份或职位，随实际身份变化更新。" },
        description: { type: "string", minLength: 1 },
        recurring: { type: "boolean" },
        relationship: {
          type: "object",
          description: "仅在本段改变该常驻人物对主角的态度时提交。",
          additionalProperties: false,
          properties: {
            stance: { type: "string", enum: relationshipStances },
            summary: { type: "string", minLength: 1 }
          }
        }
      }
    }
  };
}



export function dynamicNarrativeSceneTools(input: DynamicNarrativeSceneInput): DynamicNarrativeToolSet {
  const background = input.presentation === "summary" && input.allowedTurnKinds.includes("background");
  const scene = input.presentation !== "summary" && input.allowedTurnKinds.includes("scene") && input.attributePolicy;
  if (!background && !scene) return { tools: [], names: [] };
  const name = background ? "resolve_background_outcome" : "resolve_scene_outcome";
  return {
    names: [name],
    tools: [{
      type: "function", function: {
        name, description: "依据本轮最终正文提交已经发生的受控属性变化。",
        parameters: { type: "object", additionalProperties: false, required: ["effects"],
          properties: { effects: narrativeEffectsSchema(background ? input.backgroundAttributePolicy : input.attributePolicy!) } }
      }
    }]
  };
}

export function dynamicNarrativeRenderTools(input: DynamicNarrativeSceneInput): { tools: Record<string, unknown>[]; names: DynamicNarrativeRenderToolName[] } {
  const optionOverrides = {
    type: "array", minItems: 3, maxItems: 3,
    description: "safe、balanced、risky 各一个选项，每个 ID 只出现一次。围绕当前事件，按风险由低到高给出三种具体行动。",
    items: {
      type: "object", additionalProperties: false, required: ["id", "label", "description"],
      properties: {
        id: { type: "string", enum: ["safe", "balanced", "risky"] },
        label: { type: "string" }, description: { type: "string" }
      }
    }
  };
  const names: DynamicNarrativeRenderToolName[] = input.presentation === "summary"
    ? ["render_background_prose"] : input.flowEvent
      ? [input.flowEvent.kind === "choice" ? "render_choice_prose" : input.flowEvent.kind === "settlement" ? "render_event_settlement" : "render_scene_prose"]
      : ["render_scene_prose", "render_choice_prose"];
  return { names, tools: names.map((name) => {
    const choice = name === "render_choice_prose";
    const settlement = name === "render_event_settlement";
    const authoredChoice = choice && Boolean(input.flowEvent);
    return {
      type: "function",
      function: {
        name,
        description: choice ? "写出一件完整事件关键取舍前的处境与三种行动，停在玩家作答前。" : "本段实际经历正文。",
        parameters: {
          type: "object", additionalProperties: false,
          required: ["narrative", ...(choice ? authoredChoice ? [] : ["decisionBrief", "background", "optionOverrides"] : name === "render_scene_prose" || settlement ? ["nextClock"] : []), ...(settlement ? ["resolutionId"] : [])],
          properties: {
            narrative: { type: "string", minLength: 1 },
            ...(choice && !authoredChoice ? {
              decisionBrief: {
                type: "object", additionalProperties: false, required: ["question", "stakes"],
                description: "本次事件与当前利害。",
                properties: {
                  question: { type: "string", minLength: 1, description: "需要玩家决定的完整事件。" },
                  stakes: { type: "string", minLength: 1, description: "当前涉及的人、利益与危险。" }
                }
              },
              background: { type: "string", minLength: 1 }, optionOverrides
            } : name === "render_scene_prose" || settlement ? { nextClock: nextClockSchema() } : {}),
            ...(settlement ? { resolutionId: { type: "string", description: "根据实际历史适用的处置规则 ID；正文落实这条规则对应的处置。" } } : {})
          }
        }
      }
    };
  }) };
}

function responseTool(tool: Record<string, unknown>): Record<string, unknown> {
  const functionTool = tool.function as { name: string; description: string; parameters: Record<string, unknown> };
  return { type: "function", name: functionTool.name, description: functionTool.description, parameters: functionTool.parameters, strict: false };
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


function readDirectedStoryIntent(raw: unknown, input: DirectedStoryTurnInput): Pick<DirectedStoryTurnResult, "intent" | "routeId" | "focusComponentId" | "scenePacing"> | null {
  const parsed = parseDirectedToolArguments(raw);
  if (!parsed) return null;
  const intent = typeof parsed.intent === "string" ? parsed.intent.trim() as NarrativeIntent : undefined;
  if (!intent || !input.allowedIntents.includes(intent)) return null;
  const routeId = typeof parsed.routeId === "string" ? parsed.routeId.trim() : "";
  if (!input.routeOptions.some((option) => option.id === routeId)) return null;
  const rawFocus = typeof parsed.focusComponentId === "string" ? parsed.focusComponentId.trim() : "";
  const focusComponentId = input.focusOptions?.some((option) => option.id === rawFocus) ? rawFocus : undefined;
  const scenePacing = input.allowScenePacing && (parsed.scenePacing === "continuous" || parsed.scenePacing === "spanning") ? parsed.scenePacing : undefined;
  return { intent, routeId, focusComponentId, scenePacing };
}

function directedStoryToolCallId(toolName: string, argumentsText: string, nonce: string): string {
  return normalizeChatText(
    `story_${createHash("sha256").update(`${toolName}:${argumentsText}:${nonce}`).digest("hex").slice(0, 20)}`,
    CHAT_TOOL_CALL_ID_MAX_LEN
  );
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
    `C world_routes=${input.routeOptions.map((option) => `${option.id}=${normalizeNarrativeText(option.label)}(${normalizeNarrativeText(option.summary)})`).join(" | ")}`,
    input.rejectedRouteIds?.length
      ? `C rejected_routes=${input.rejectedRouteIds.join(",")};这些路线此刻没有可回收的既有事实，须改选另一条路线。`
      : "",
    input.focusOptions?.length
      ? `C focus_components=${input.focusOptions.map((option) => `${option.id}=${normalizeNarrativeText(option.label)}(${normalizeNarrativeText(option.hint)})`).join(" | ")}`
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
  };
  const contextTask: NarrativeTask = input.closureRequired ? "closure" : "planning";
  const systemPrompt = buildRunSystemPrompt(run, promptPack, world, planningContext, "year", contextTask);
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
          input: composition.messages,
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
            ...composition.messages
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
        messages: composition.messages,
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


const isSafePlayerText = isNarrativePlainText;

function isSafePlayerNarrative(text: string): boolean {
  return isSafePlayerText(text);
}


function parseNarrativeEffects(raw: unknown, policy: NarrativeAttributePolicy, reason = "attribute_effects_invalid"): NarrativeAttributeEffect[] {
  const result = validateNarrativeEffects(raw, policy);
  if (!result.ok) throw invalidNarrativeOutcome(reason, result.issue);
  return result.effects;
}

function narrativeToolUsageOperation(toolNames: string[]): ModelUsageOperation {
  if (toolNames.some((name) => name === "plan_act_world_card" || name === "recall_scene_assets")) return "planning";
  if (toolNames.includes("curate_narrative_memory")) return "curation";
  if (toolNames.includes("sync_narrative_continuity")) return "continuity";
  if (toolNames.includes("plan_narrative_horizon")) return "horizon";
  if (toolNames.includes("render_origin")) return "origin";
  if (toolNames.includes("render_background_segment")) return "background";
  if (toolNames.includes("resolve_background_outcome") || toolNames.includes("render_background_prose")) return "background";
  if (toolNames.includes("resolve_choice_scene") || toolNames.includes("render_choice_prose")) return "choice";
  if (toolNames.includes("resolve_scene_outcome") || toolNames.includes("render_scene_prose") || toolNames.includes("render_event_settlement")) return "scene";
  if (toolNames.includes("render_choice_scene")) return "choice";
  if (toolNames.includes("render_scene")) return "scene";
  if (toolNames.includes("render_decision_outcome")) return "render";
  if (toolNames.includes("resolve_decision_outcome")) return "decision";
  return "narrative";
}

function narrativeTaskUsageOperation(task: NarrativeTask | undefined, toolNames: string[]): ModelUsageOperation {
  if (task === "planning") return "planning";
  if (task === "observation") return "observation";
  if (task === "settlement" || task === "closure") return "settlement";
  if (task === "continuity") return "continuity";
  if (task === "curation") return "curation";
  if (task === "horizon") return "horizon";
  if (task === "origin") return "origin";
  if (task === "ending") return "ending";
  if (task === "background" || task === "rendering" || task === "dynamic" || task === "decision") return "render";
  return narrativeToolUsageOperation(toolNames);
}

type NarrativeContractLayout = "nested" | "continuity";

interface NarrativeOutcomeRequestOptions {
  /** Existing task instructions that precede its state directory and new input. */
  taskContextPrefix?: string;
  eventSources?: Array<{ sourceEventId: string; age: number; actId?: string }>;
  planningPurpose?: "initial" | "execute" | "continuation";
  handoff?: NarrativeRoundHandoff;
  task?: NarrativeTask;
  callId?: string;
  age?: number;
  ageRange?: { fromAge: number; toAge: number };
  actId?: string;
  beat?: NarrativeBeat;
  source?: NarrativeContextComposeInput["source"];
  focusIds?: string[];
  writeSet?: NarrativeContinuityWriteSet;
  factionIds?: string[];
  contracts?: {
    assets?: boolean | "declarations";
    facts?: boolean;
    relationships?: boolean;
    references?: boolean;
    activity?: boolean;
    layout?: NarrativeContractLayout;
  };
}

function continuityRefsSchema(_allowed: NarrativeContinuityRefs): Record<string, unknown> {
  const referenceArray = (description: string) => ({
    type: "array",
    maxItems: 6,
    items: { type: "string", description }
  });
  return {
    type: "object",
    additionalProperties: false,
    required: ["factIds", "characterIds", "locationIds", "abilityIds"],
    description: "声明本次正文中状态实际发生持久变化的已有对象；四类数组均须返回，无变化填 []。只是出现或被提及的对象不填入。",
    properties: {
      factIds: referenceArray("从本轮可修改事实目录完整复制 ID，保留类型前缀与全部字符。"),
      characterIds: referenceArray("从本局人物身份目录完整复制 ID，保留 character: 前缀与全部字符。"),
      locationIds: referenceArray("从本局地点身份目录完整复制 ID，保留 location: 前缀与全部字符。"),
      abilityIds: referenceArray("从本局本领身份目录完整复制 ID，保留 ability: 前缀与全部字符。")
    }
  };
}

function narrativeAssetActivitySchema(_allowed: NarrativeContinuityRefs): Record<string, unknown> {
  const referenceArray = () => ({
    type: "array",
    maxItems: 6,
    items: {
      type: "string",
      description: "实际到达或使用的对象：填写已知完整 ID 或准确名称；无法唯一识别的名称由引擎作候选登记。没有实际活动填空数组。"
    }
  });
  return {
    type: "object",
    additionalProperties: false,
    description: "记录正文中实际到达或使用的资产；它不是资产档案更新。",
    required: ["locationIds", "abilityIds"],
    properties: {
      locationIds: referenceArray(),
      currentLocationId: {
        type: "string",
        description: "本段结束地点的已知完整 ID 或准确名称。无法唯一识别的名称由引擎登记候选，并记录为当前位置。"
      },
      abilityIds: referenceArray()
    }
  };
}

function parseNarrativeAssetActivity(raw: unknown, allowed: NarrativeContinuityRefs, assets?: NarrativeAssets, declarations?: NarrativeAssetUpdates): NarrativeAssetActivity {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalidNarrativeOutcome("narrative_asset_activity_invalid", { rule: "object_required", path: "assetActivity", received: raw });
  const source = raw as Record<string, unknown>;
  const resolve = (ref: unknown, key: "locationIds" | "abilityIds", path: string): string | undefined => {
    const allowedIds = new Set(allowed[key]);
    if (typeof ref === "string" && allowedIds.has(ref)) return ref;
    const candidates = key === "locationIds" ? assets?.locations : assets?.abilities;
    const matches = candidates?.filter((entry) => entry.name === ref && allowedIds.has(entry.id)) ?? [];
    if (matches.length === 1) return matches[0].id;
    const pending = key === "locationIds" ? declarations?.locations : declarations?.abilities;
    if (pending && typeof ref === "string" && ref.trim() && !["location:", "ability:", "character:"].some((prefix) => ref.startsWith(prefix))) {
      // Display maintenance may have merged/retired this name since the last
      // story. Names remain valid identity evidence, never a catalogue gate.
      if (!pending.some((entry) => entry.ref === "new" && entry.name === ref)) pending.push({ ref: "new", name: ref });
      return undefined;
    }
    throw invalidNarrativeOutcome("narrative_asset_activity_invalid", {
      rule: key === "locationIds" && path.endsWith("currentLocationId") ? "current_location_id_invalid" : "reference_invalid",
      path, expected: [...allowedIds], received: ref
    });
  };
  const parseRefs = (key: "locationIds" | "abilityIds") => {
    if (!Array.isArray(source[key])) throw invalidNarrativeOutcome("narrative_asset_activity_invalid", { rule: "array_required", path: `assetActivity.${key}`, received: source[key] });
    return Array.from(new Set(source[key].map((ref, index) => resolve(ref, key, `assetActivity.${key}[${index}]`)).filter((ref): ref is string => ref !== undefined)));
  };
  const locationIds = parseRefs("locationIds");
  const abilityIds = parseRefs("abilityIds");
  const currentLocationId = source.currentLocationId === undefined ? undefined
    : resolve(source.currentLocationId, "locationIds", "assetActivity.currentLocationId");
  if (source.currentLocationId !== undefined && currentLocationId === undefined) {
    declarations!.locations.find((entry) => entry.ref === "new" && entry.name === source.currentLocationId)!.current = true;
  }
  return normalizeNarrativeAssetActivity({
    locationIds,
    ...(typeof currentLocationId === "string" ? { currentLocationId } : {}),
    abilityIds
  });
}

function parseContinuityRefs(raw: unknown, allowed: NarrativeContinuityRefs): NarrativeContinuityRefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalidNarrativeOutcome("narrative_continuity_refs_invalid", { rule: "object_required", path: "continuityRefs", received: raw });
  const source = raw as Record<string, unknown>;
  const parse = (key: keyof NarrativeContinuityRefs) => {
    if (!Array.isArray(source[key])) throw invalidNarrativeOutcome("narrative_continuity_refs_invalid", { rule: "array_required", path: `continuityRefs.${key}`, received: source[key] });
    const allow = new Set(allowed[key]);
    const values = source[key];
    values.forEach((id, index) => {
      if (typeof id !== "string" || !allow.has(id)) throw invalidNarrativeOutcome("narrative_continuity_refs_invalid", {
        rule: "reference_invalid", path: `continuityRefs.${key}[${index}]`, expected: [...allow], received: id
      });
    });
    return Array.from(new Set(values as string[]));
  };
  return { factIds: parse("factIds"), characterIds: parse("characterIds"), locationIds: parse("locationIds"), abilityIds: parse("abilityIds") };
}

function formatNarrativeContinuityReferenceCatalog(
  run: InternalRunState,
  allowed: NarrativeContinuityRefs
): string {
  const factById = new Map((run.story.factLedger?.facts ?? []).map((entry) => [entry.id, entry.label]));
  const facts = allowed.factIds.map((id) => `${id}（${normalizeNarrativeText(factById.get(id) ?? id)}）`);
  return [
    "本轮 continuityRefs 可修改事实目录：",
    `factIds=${facts.join("、") || "无"}`
  ].join("\n");
}

export function prepareNarrativeOutcomeRequest(
  run: InternalRunState, world: WorldConfig, ctx: NarrativeContext,
  toolInput: Record<string, unknown> | Record<string, unknown>[], prompt: string,
  options?: NarrativeOutcomeRequestOptions
) {
  run = { ...run, narrative: roundIdentityState(run, options?.handoff) };
  const task = options?.task ?? ctx.narrativePlan?.task ?? "dynamic";
  const systemPrompt = buildRunSystemPrompt(run, normalizePromptPackForModel(ctx.promptPack), world, ctx, "year", task, options?.planningPurpose);
  const conversation = ensureConversationState(ctx.conversation, hashSystemPrompt(systemPrompt), systemPrompt);
  ctx.conversation = conversation;
  const tools = Array.isArray(toolInput) ? toolInput : [toolInput];
  const contracts = usesPresetEventAssets(run) && options?.contracts?.assets === "declarations" ? {} : options?.contracts ?? {};
  const contractLayout = contracts.layout ?? "nested";
  const recalledFactIds = new Set([
    ...(ctx.narrativePlan?.recall?.facts ?? []).map((entry) => entry.id),
    ...(ctx.narrativePlan?.factDirectory ?? []).map((entry) => entry.id)
  ]);
  const writeSet = options?.writeSet;
  const writableFactIds = writeSet ? new Set(writeSet.factIds) : recalledFactIds;
  const openFactIds = (run.story.factLedger?.facts ?? [])
    .map(normalizeNarrativeHandoffFact)
    .filter((fact) => (fact.status === "open" || (task === "continuity" && fact.status === "resolved")) && writableFactIds.has(fact.id) && (task === "continuity" || recalledFactIds.has(fact.id)))
    .map((fact) => fact.id);
  const factContract = factUpdateContract(openFactIds, options?.eventSources, {
    characterIds: run.narrative.dynamicCharacters.map((entry) => entry.id),
    locationIds: run.narrative.assets?.locations.map((entry) => entry.id) ?? [],
    abilityIds: run.narrative.assets?.abilities.map((entry) => entry.id) ?? [],
    factionIds: options?.factionIds ?? []
  });
  const recalledCharacterIds = new Set((ctx.narrativePlan?.recall?.characters ?? []).map((entry) => entry.id));
  const continuityDirectory = contractLayout === "continuity";
  const includeIdentityDirectory = continuityDirectory;
  // Decoder authority is internal bookkeeping, not material sent to the writer.
  const characterIds = includeIdentityDirectory || contracts.assets === "declarations" ? run.narrative.dynamicCharacters.map((entry) => entry.id) : writeSet
    ? writeSet.characterIds.filter((id) => recalledCharacterIds.has(id) && run.narrative.dynamicCharacters.some((entry) => entry.id === id))
    : Array.from(recalledCharacterIds);
  const characterDirectory = run.narrative.dynamicCharacters.filter((entry) => characterIds.includes(entry.id));
  const allowedAssets: NarrativeAssets = run.narrative.assets ?? { locations: [], abilities: [] };
  const allowedContinuityRefs = narrativeContinuityWritableSet(run, ctx.narrativePlan);
  if (writeSet) allowedContinuityRefs.factIds = writeSet.factIds;
  const allowedActivityRefs: NarrativeContinuityRefs = {
    factIds: [], characterIds: [],
    locationIds: allowedContinuityRefs.locationIds,
    abilityIds: allowedContinuityRefs.abilityIds
  };
  for (const tool of tools) {
    const definition = tool.function as { name: string; parameters: { properties: Record<string, unknown>; required?: string[] } };
    if (usesPresetEventAssets(run) && options?.contracts?.assets === "declarations") {
      for (const key of ["participants", "assetUpdates", "assetActivity"]) delete definition.parameters.properties[key];
      definition.parameters.required = definition.parameters.required?.filter((key) => !["participants", "assetUpdates", "assetActivity"].includes(key));
      if (definition.name === "render_origin") {
        definition.parameters.properties.originBindings = { type: "array", description: "身世预设身份的实际名称。只登记名称，不写档案。", items: {
          type: "object", additionalProperties: false, required: ["roleId", "name"], properties: { roleId: { type: "string" }, name: { type: "string" } }
        } };
        definition.parameters.required = [...(definition.parameters.required ?? []), "originBindings"];
      }
    }
    if (definition.parameters.properties.narrative) {
      definition.parameters.properties.narrative = { type: "string", minLength: 1, description: narrativeToolRule(definition.name, resolvePromptPack(ctx.promptPack)) };
    }
    if (contracts.assets) {
      if (definition.parameters.properties.narrative) {
        definition.parameters.properties.participants = narrativeParticipantsSchema(contracts.assets === "declarations");
        definition.parameters.required = Array.from(new Set([...(definition.parameters.required ?? []), "participants"]));
      }
      if (contractLayout === "continuity") {
        const assetContract = narrativeContinuityAssetContract(allowedAssets);
        Object.assign(definition.parameters.properties, assetContract.properties);
        definition.parameters.required = Array.from(new Set([...(definition.parameters.required ?? []), ...assetContract.required]));
      } else {
        definition.parameters.properties.assetUpdates = contracts.assets === "declarations" ? narrativeAssetDeclarationsSchema() : narrativeAssetUpdatesSchema(allowedAssets);
        definition.parameters.required = Array.from(new Set([...(definition.parameters.required ?? []), "assetUpdates"]));
      }
    }
    if (contracts.facts) {
      if (contractLayout === "continuity") {
        const factProperties = (factContract.schema as { properties: Record<string, unknown> }).properties;
        definition.parameters.properties.factIntroductions = factProperties.introduce;
        definition.parameters.properties.factUpdates = factProperties.updates;
      } else {
        definition.parameters.properties.factUpdates = factContract.schema;
        definition.parameters.required = Array.from(new Set([...(definition.parameters.required ?? []), "factUpdates"]));
      }
    }
    if (contracts.relationships) {
      definition.parameters.properties.relationshipUpdates = relationshipUpdatesSchema(characterIds);
    }
    if (contracts.activity) {
      definition.parameters.properties.assetActivity = narrativeAssetActivitySchema(allowedActivityRefs);
      definition.parameters.required = [...(definition.parameters.required ?? []), "assetActivity"];
    }
    if (contracts.references) {
      definition.parameters.properties.continuityRefs = continuityRefsSchema(allowedContinuityRefs);
      definition.parameters.properties.assetActivity = narrativeAssetActivitySchema(allowedActivityRefs);
      definition.parameters.properties.continuityRequired = {
        type: "boolean",
        description: "最终正文是否实际新增持久事实、人物、地点或本领，或使已有对象发生实质变化；仅抵达已有地点、使用已有本领而状态未变化时为 false。"
      };
      const required = Array.isArray(definition.parameters.required) ? definition.parameters.required as string[] : [];
      definition.parameters.required = Array.from(new Set([...required, "continuityRefs", "assetActivity", "continuityRequired"]));
    }
    if (contractLayout === "continuity") {
      Object.assign(definition.parameters, { description: "各数组没有变化填 []；单条中未变字段省略。" });
      definition.parameters.properties.identityMerges = narrativeIdentityMergesSchema();
      definition.parameters.properties.retirements = { type: "array", description: "没有持续作用的登记；仍被引用时引擎保留最小身份。", items: { type: "object", additionalProperties: false, required: ["kind", "ref"], properties: { kind: { type: "string", enum: ["character", "location", "ability"] }, ref: { type: "string" } } } };
      definition.parameters.required = Object.keys(definition.parameters.properties);
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
  const identityDirectory = includeIdentityDirectory
    ? formatNarrativeIdentityDirectory({ ...run.narrative, dynamicCharacters: characterDirectory }, !continuityDirectory, continuityDirectory ? options?.focusIds ?? [] : undefined)
    : "";
  const taskPrompt = [
    options?.taskContextPrefix,
    continuityDirectory ? identityDirectory : "",
    prompt,
    !continuityDirectory ? identityDirectory : "",
    contracts.references ? formatNarrativeContinuityReferenceCatalog(run, allowedContinuityRefs) : ""
  ].filter(Boolean).join("\n");
  const composition = composeNarrativeContext({
    planningPurpose: options?.planningPurpose,
    plan: ctx.narrativePlan,
    task,
    taskPrompt,
    conversation,
    callId: options?.callId ?? ctx.callId,
    source: options?.source,
    worldId: run.worldId,
    focusIds: options?.focusIds
  });
  const requestPrompt = composition.renderedContext;
  const history = composition.messages;
  const toolSchemaText = JSON.stringify(tools);
  if (debugModelEnabled()) console.log("[model-debug:narrative-context]", {
    ...narrativeContextTrace(composition.manifest),
    toolNames,
    toolSchemaEstimatedTokens: Math.ceil(toolSchemaText.length / 4),
    toolSchemaHash: createHash("sha256").update(toolSchemaText).digest("hex").slice(0, 12),
    systemPromptHash: createHash("sha256").update(systemPrompt).digest("hex").slice(0, 12),
    systemAndStableContextHash: createHash("sha256").update(`${systemPrompt}\n${composition.stableContext}`).digest("hex").slice(0, 12),
    messageRoles: history.map((message) => message.role),
    orderedMessagesHash: createHash("sha256").update(JSON.stringify(history)).digest("hex").slice(0, 12),
    historyHash: createHash("sha256").update(JSON.stringify(composition.historyMessages)).digest("hex").slice(0, 12),
    contextHash: createHash("sha256").update(requestPrompt).digest("hex").slice(0, 12),
    staticContextHash: createHash("sha256").update(composition.stableContext).digest("hex").slice(0, 12),
    stableContextHash: createHash("sha256").update(composition.stableContext).digest("hex").slice(0, 12),
    runtimeContextHash: createHash("sha256").update(composition.runtimeContext).digest("hex").slice(0, 12),
    activeContextHash: createHash("sha256").update(composition.activeContext).digest("hex").slice(0, 12),
    taskPromptHash: createHash("sha256").update(taskPrompt).digest("hex").slice(0, 12),
    contractLayout,
    continuityReferenceCatalog: contracts.references ? {
      facts: allowedContinuityRefs.factIds,
      characters: allowedContinuityRefs.characterIds,
      locations: allowedContinuityRefs.locationIds,
      abilities: allowedContinuityRefs.abilityIds
    } : undefined,
    allowedReferences: {
      facts: factContract.mutableIds,
      characters: characterIds,
      locations: allowedAssets.locations.map((entry) => entry.id),
      abilities: allowedAssets.abilities.map((entry) => entry.id)
    }
  });
  return { conversation, tools, toolNames, toolChoice, factContract, characterIds, characterDirectory, allowedAssets, allowedContinuityRefs, allowedActivityRefs, contracts, contractLayout, history, contextManifest: composition.manifest };
}

type NarrativeOutcomeParseContext = Pick<ReturnType<typeof prepareNarrativeOutcomeRequest>, "characterDirectory">;

async function requestNarrativeOutcomeTool<T = never>(
  run: InternalRunState,
  world: WorldConfig,
  ctx: NarrativeContext,
  toolInput: Record<string, unknown> | Record<string, unknown>[],
  prompt: string,
  options?: NarrativeOutcomeRequestOptions & { parseResult?: (raw: Record<string, unknown>, toolName: string, context: NarrativeOutcomeParseContext) => T }
): Promise<{
  raw: Record<string, unknown>;
  toolCall: ToolCallRecord;
  toolName: string;
  assetUpdates?: NarrativeAssetUpdates;
  factUpdates?: NarrativeFactUpdates;
  relationshipUpdates?: NarrativeRelationshipUpdate[];
  continuityRefs?: NarrativeContinuityRefs;
  assetActivity?: NarrativeAssetActivity;
  continuityRequired?: boolean;
  parsed?: T;
}> {
  if (!ctx.apiKey.trim()) throw new NarrativeOutcomeError("narrative_outcome_unavailable", "api_key_missing");
  const { conversation, tools, toolNames, toolChoice, factContract, characterIds, characterDirectory, allowedAssets, allowedContinuityRefs, allowedActivityRefs, contracts, contractLayout, history, contextManifest } = prepareNarrativeOutcomeRequest(run, world, ctx, toolInput, prompt, options);
  ctx.lastContextManifest = contextManifest;
  const isResponsesApi = ctx.providerConfig.apiPath === "/responses";
  const usageOperation: ModelUsageOperationInput = {
    // A failed multi-tool request has no actual tool choice to classify.
    fallback: narrativeTaskUsageOperation(options?.task ?? ctx.narrativePlan?.task, toolNames),
    resolve: (response) => {
      const selected = isResponsesApi
        ? toolNames.map((toolName) => findResponseFunctionCall(response as { output?: unknown[] }, toolName)).find(Boolean)
        : toolNames.map((toolName) => findDirectedToolCall((response as { choices?: Array<{ message?: unknown }> }).choices?.[0]?.message, toolName)).find(Boolean);
      return narrativeTaskUsageOperation(options?.task ?? ctx.narrativePlan?.task, selected ? [selected.toolCall.name] : toolNames);
    }
  };
  const systemMessage = buildSystemMessage(conversation);
  let requestHistory = history;
  let correctionToolName: string | undefined;
  for (let attempt = 0; ; attempt += 1) {
    let originalArguments: unknown;
    let responseId: string | undefined;
    let toolCall: ToolCallRecord | undefined;
    try {
      const client = getOpenAIClient(ctx);
      const completion = isResponsesApi
        ? await createTrackedResponse(ctx, client, {
            model: ctx.providerConfig.model,
            instructions: systemMessage,
            input: requestHistory,
            temperature: ctx.providerConfig.temperature,
            max_output_tokens: ctx.providerConfig.maxTokens,
            tools: tools.map(responseTool) as never,
            tool_choice: correctionToolName
              ? { type: "function", name: correctionToolName }
              : tools.length === 1 ? { type: "function", name: toolNames[0] } : "required",
            parallel_tool_calls: false
          } as never, usageOperation)
        : await createTrackedChatCompletion(ctx, client, {
            model: ctx.providerConfig.model,
            temperature: ctx.providerConfig.temperature,
            max_tokens: ctx.providerConfig.maxTokens,
            messages: [{ role: "system", content: systemMessage }, ...requestHistory],
            thinking: { type: "disabled" },
            reasoning_effort: reasoningEffortForSdk(ctx.providerConfig.reasoningEffort),
            tools: tools as never,
            tool_choice: (correctionToolName ? { type: "function", function: { name: correctionToolName } } : toolChoice) as never,
            parallel_tool_calls: false
          } as never, usageOperation);
      if (debugModelEnabled()) {
        console.log("[model-debug:narrative-outcome-raw]");
        console.dir(completion, { depth: null, maxArrayLength: null, maxStringLength: null, colors: false });
      }
      const acceptedToolNames = correctionToolName ? [correctionToolName] : toolNames;
      const call = isResponsesApi
        ? acceptedToolNames.map((toolName) => findResponseFunctionCall(completion as { output?: unknown[] }, toolName)).find(Boolean)
        : acceptedToolNames.map((toolName) => findDirectedToolCall((completion as { choices?: Array<{ message?: unknown }> }).choices?.[0]?.message, toolName)).find(Boolean);
      const finishReason = isResponsesApi
        ? (completion as { status?: unknown; incomplete_details?: unknown }).status
        : (completion as { choices?: Array<{ finish_reason?: string | null }> }).choices?.[0]?.finish_reason;
      originalArguments = call?.rawArguments;
      responseId = (completion as { id?: string }).id;
      toolCall = call?.toolCall;
      const incomplete = isResponsesApi
        ? finishReason === "incomplete" || Boolean((completion as { incomplete_details?: unknown }).incomplete_details)
        : finishReason === "length";
      if (debugModelEnabled()) console.log("[model-debug:narrative-outcome]", {
        task: options?.task ?? ctx.narrativePlan?.task ?? "dynamic",
        toolNames,
        selectedTool: call?.toolCall.name,
        finishReason,
        incomplete,
        rawArgumentCharacters: typeof call?.rawArguments === "string" ? call.rawArguments.length : undefined,
        correctionAttempt: attempt
      });
      if (incomplete) throw invalidNarrativeOutcome("tool_arguments_truncated", { rule: "provider_output_incomplete", path: "arguments", expected: toolNames });
      const parsed = call ? parseDirectedToolArguments(call.rawArguments) : null;
      const raw = parsed ? canonicalizeNarrativeReferences(run.narrative, parsed) : null;
      if (!call) throw invalidNarrativeOutcome("tool_call_missing");
      if (!raw) {
        const failure = directedToolArgumentsFailure(call.rawArguments);
        throw invalidNarrativeOutcome(failure.reason, failure.validation);
      }
      if (contractLayout === "continuity") {
        const definition = tools.find((tool) => (tool.function as { name?: string }).name === call.toolCall.name)?.function as {
          parameters: { properties: Record<string, unknown>; required: string[] }
        } | undefined;
        if (!definition) throw invalidNarrativeOutcome("tool_contract_invalid", { rule: "tool_missing", path: "arguments" });
        validateNarrativeContinuityToolArguments(raw, definition.parameters);
        try {
          parseNarrativeIdentityMerges(raw.identityMerges, roundIdentityState(run, options?.handoff));
        } catch {
          throw invalidNarrativeOutcome("narrative_identity_merges_invalid", { rule: "identity_reference_invalid", path: "identityMerges" });
        }
      }
      let assetUpdates: NarrativeAssetUpdates | undefined;
      let factUpdates: NarrativeFactUpdates | undefined;
      let relationshipUpdates: NarrativeRelationshipUpdate[] | undefined;
      let continuityRefs: NarrativeContinuityRefs | undefined;
      let assetActivity: NarrativeAssetActivity | undefined;
      let continuityRequired: boolean | undefined;
      if (contracts.assets) {
        try {
          if (contractLayout !== "continuity" && !Object.hasOwn(raw, "assetUpdates")) throw new Error("assetUpdates_required");
          assetUpdates = contractLayout === "continuity"
            ? parseNarrativeContinuityAssetUpdates(raw, allowedAssets, { characterIds, factionIds: options?.factionIds ?? [] })
            : contracts.assets === "declarations" ? parseNarrativeAssetDeclarations(raw.assetUpdates, allowedAssets)
              : parseNarrativeAssetUpdates(raw.assetUpdates, allowedAssets);
          const descriptions = [
            ...(assetUpdates?.locations ?? []).flatMap((entry) => [entry.name, entry.description]),
            ...(assetUpdates?.abilities ?? []).flatMap((entry) => [entry.name, entry.description, entry.source, entry.mastery])
          ];
          if (descriptions.some((value) => value !== undefined && value !== "" && !isSafePlayerText(value, 1))) throw new Error("asset_text_invalid");
        } catch (error) {
          throw invalidNarrativeOutcome("narrative_asset_updates_invalid", nestedValidationIssue(error, "assetUpdates"));
        }
      }
      if (contracts.facts) {
        try {
          if (contractLayout !== "continuity") {
            const fields = raw.factUpdates as { introduce?: unknown; updates?: unknown } | undefined;
            if (!fields || !Array.isArray(fields.introduce) || !Array.isArray(fields.updates)) throw new Error("factUpdates_arrays_required");
          }
          factUpdates = parseFactUpdates(contractLayout === "continuity" ? {
            introduce: raw.factIntroductions,
            updates: raw.factUpdates
          } : raw.factUpdates, factContract);
        } catch (error) {
          throw invalidNarrativeOutcome("narrative_fact_updates_invalid", nestedValidationIssue(error, "factUpdates"));
        }
      }
      if (contracts.relationships) {
        try {
          relationshipUpdates = parseRelationshipUpdates(raw.relationshipUpdates, characterIds, options?.factionIds);
        } catch (error) {
          throw invalidNarrativeOutcome("narrative_relationship_updates_invalid", nestedValidationIssue(error, "relationshipUpdates"));
        }
      }
      if (contracts.activity) assetActivity = parseNarrativeAssetActivity(raw.assetActivity, allowedActivityRefs, run.narrative.assets, contracts.assets === "declarations" ? assetUpdates : undefined);
      if (contracts.references) {
        continuityRefs = parseContinuityRefs(raw.continuityRefs, allowedContinuityRefs);
        assetActivity = parseNarrativeAssetActivity(raw.assetActivity, allowedActivityRefs, run.narrative.assets);
        if (typeof raw.continuityRequired !== "boolean") throw invalidNarrativeOutcome("narrative_continuity_refs_invalid", {
          rule: "boolean_required", path: "continuityRequired", received: raw.continuityRequired
        });
        continuityRequired = raw.continuityRequired;
      }
      const parsedResult = options?.parseResult?.(raw, call.toolCall.name, { characterDirectory });
      return { raw, toolCall: call.toolCall, toolName: call.toolCall.name, assetUpdates, factUpdates, relationshipUpdates, continuityRefs, assetActivity, continuityRequired, parsed: parsedResult };
    } catch (error) {
      debugError("narrative-outcome", error);
      if (ctx.usageScope?.runId) {
        try {
          await recordRunGenerationFailure(ctx.usageScope.runId, ctx.usageScope.sessionId, {
            requestId: ctx.requestId, callId: options?.callId ?? ctx.callId, responseId,
            toolCallId: toolCall?.id, toolName: toolCall?.name,
            task: options?.task ?? ctx.narrativePlan?.task ?? "dynamic", source: options?.source,
            attempt, age: options?.age ?? run.age, ageRange: options?.ageRange,
            actId: options?.actId ?? run.narrative.actRuntime?.actId,
            beat: options?.beat ?? run.narrative.actRuntime?.beat,
            reason: error instanceof NarrativeOutcomeError ? error.reason ?? error.message : "provider_request_failed",
            validation: error instanceof NarrativeOutcomeError ? error.validation : undefined,
            originalToolArguments: originalArguments
          });
        } catch (persistenceError) {
          debugError("narrative-failure-persistence", persistenceError);
        }
      }
      if (attempt === 0 && originalArguments !== undefined && error instanceof NarrativeOutcomeError &&
          error.message === "narrative_outcome_invalid" && error.reason !== "tool_arguments_truncated") {
        let correctionArguments = originalArguments;
        if (typeof originalArguments === "string") {
          try { correctionArguments = JSON.parse(originalArguments); } catch { /* Keep malformed JSON verbatim for correction. */ }
        }
        correctionToolName = toolCall?.name;
        const declarationReference = contracts.assets === "declarations" && error.validation?.rule === "character_reference_invalid";
        const privateAssetReference = contracts.assets === "declarations" && (
          error.reason === "narrative_asset_activity_invalid" || error.reason === "narrative_asset_updates_invalid"
        );
        const correction = [
          `本次工具返回未通过协议审核。继续调用 ${correctionToolName}，只纠正下列错误后重新提交完整工具参数；validation.path 标出错误位置，未受影响的字段保持原样。${contracts.assets === "declarations" ? "身份登记与活动引用遵循当前工具字段。" : "引用 ID 沿用原目录逐字复制；语义冲突依据原任务重新裁定。"}`,
          ...(declarationReference ? ["未知人物 ID 使用 new 并填写正文中的名称。"] : error.validation?.rule === "character_reference_invalid" ? ["人物引用从 allowedCharacters 的具名目录逐字复制完整 ID；新人物使用 new 并填写 name，不从错误 ID 推造身份。"] : []),
          ...(privateAssetReference ? ["已有活动对象可以填写正文中的准确名称；新对象在 assetUpdates 使用 new 与名称登记，活动数组不填写新对象引用。"] : []),
          JSON.stringify({ reason: error.reason, validation: declarationReference ? { ...error.validation, expected: ["new"] }
            : privateAssetReference ? { ...error.validation, expected: ["已有对象的准确名称；新对象使用 new 登记"] } : error.validation,
            ...(!declarationReference && error.validation?.rule === "character_reference_invalid" ? {
              allowedCharacters: characterDirectory.map(({ id, name }) => ({ id, name }))
            } : {}), originalToolArguments: correctionArguments })
        ].join("\n");
        requestHistory = [...history, { role: "user", content: correction }];
        if (debugModelEnabled()) console.log("[model-debug:narrative-outcome-correction]", {
          callId: options?.callId ?? ctx.callId, task: options?.task, toolNames, reason: error.reason, validation: error.validation
        });
        continue;
      }
      if (error instanceof NarrativeOutcomeError) throw error;
      throw new NarrativeOutcomeError("narrative_outcome_unavailable", "provider_request_failed");
    }
  }
}

export function interruptedBackgroundTask(run: InternalRunState, fromAge: number, events: YearEvent[]) {
  const tool = {
    type: "function", function: {
      name: "render_background_segment",
      description: "叙述已经结算的岁月及其终点处境。",
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
  fromAge: number, events: YearEvent[], socialForces: NarrativeSocialForceReference[] = []
): Promise<Pick<DynamicNarrativeSceneResult, "handoff" | "narrative" | "assetActivity" | "assetUpdates" | "participants">> {
  const { tool, prompt } = interruptedBackgroundTask(run, fromAge, events);
  const result = await requestNarrativeOutcomeTool(run, world, ctx, tool, prompt, {
    task: "background", age: run.age, ageRange: { fromAge, toAge: run.age },
    contracts: { activity: true, assets: "declarations" },
    parseResult: (raw, _toolName, { characterDirectory }) => usesPresetEventAssets(run) ? [] : parseDynamicNarrativeParticipants(raw.participants, socialForces, characterDirectory, true)!
  });
  const narrative = normalizeNarrativeText(result.raw.narrative);
  if (!isSafePlayerNarrative(narrative)) throw invalidNarrativeOutcome("background_result_narrative_invalid");
  const assetActivity = result.assetActivity!;
  return { ...generationChanges(run, result, result.parsed!, { sourceEventId: `background:${fromAge}:${run.age}:${run.history.length}`, characters: [] }), narrative, assetActivity };
}

export function narrativeOriginPrompt(run: InternalRunState): string {
  const statSummary = Object.entries(run.stats).map(([stat, value]) => `${stat}=${value}`).join("；");
  return [
    usesPresetEventAssets(run) ? "身世预设身份（originBindings 按这些身份登记名称，亲属未具名时用父亲或母亲）：" + JSON.stringify(
      run.storyPackSnapshot!.eventFlow!.roles.filter((role) => run.storyPackSnapshot!.eventFlow!.originRoles?.includes(role.id))) : "",
    run.storyPackSnapshot ? `本局 IF 路线的家庭与环境入口：${run.storyPackSnapshot.name}。${run.storyPackSnapshot.entryLens}` : "",
    `初始属性：${statSummary}。用于把握人物来处与生活条件。`,
  ].filter(Boolean).join("\n");
}

export async function generateNarrativeOrigin(
  run: InternalRunState,
  world: WorldConfig,
  ctx: NarrativeContext,
  socialForces: NarrativeSocialForceReference[] = []
): Promise<NarrativeOriginOutcome> {
  const result = await requestNarrativeOutcomeTool(run, world, ctx, narrativeOriginOutcomeTool(), [narrativeOriginPrompt(run),
    `可用阵营：${socialForces.map((entry) => `${entry.id}=${entry.label}`).join("；") || "无"}。`
  ].join("\n"), {
    task: "origin",
    age: 0,
    contracts: { assets: "declarations" },
    parseResult: (raw, _toolName, { characterDirectory }) => {
      if (!usesPresetEventAssets(run)) return { participants: parseDynamicNarrativeParticipants(raw.participants, socialForces, characterDirectory, true)! };
      const roles = run.storyPackSnapshot!.eventFlow!.originRoles ?? [];
      const bindings = raw.originBindings;
      if (!Array.isArray(bindings) || bindings.length !== roles.length || new Set(bindings.map((entry) => entry.roleId)).size !== roles.length ||
        bindings.some((entry) => !roles.includes(entry.roleId) || typeof entry.name !== "string" || !entry.name.trim())) throw invalidNarrativeOutcome("origin_bindings_invalid", { rule: "origin_role_identity_required", path: "originBindings", expected: roles });
      return { participants: [], originBindings: Object.fromEntries(bindings.map((entry) => [entry.roleId, entry.name.trim()])) };
    }
  });
  const narrative = normalizeNarrativeText(result.raw.narrative);
  if (!isSafePlayerNarrative(narrative)) {
    throw invalidNarrativeOutcome("origin_narrative_invalid");
  }
  return { narrative, assetUpdates: result.assetUpdates, ...result.parsed! };
}

export async function generateDirectedDecisionSettlement(
  run: InternalRunState,
  world: WorldConfig,
  input: { decision: DecisionType; label: string; description: string; narrative: string; attributePolicy: NarrativeAttributePolicy },
  ctx: NarrativeContext
): Promise<DirectedDecisionSettlement> {
  const prompt = [
    `实际年龄：${run.age}岁；玩家已选行动：${input.label}。`,
    `最终正文：${input.narrative}`,
    `属性结算要求：${describeNarrativeAttributePolicy(input.attributePolicy)}`,
  ].filter(Boolean).join("\n");
  const contract = decisionSettlementContract(input.attributePolicy);
  const result = await requestNarrativeOutcomeTool(run, world, isolatedNarrativeTaskContext(ctx, "settlement"), contract.tool, prompt, {
    task: "settlement",
    callId: `${ctx.callId ?? `decision:${run.runId}:${run.age}`}:settlement`,
    source: "decision"
  });
  return contract.parse(result.raw);
}

export async function renderDirectedDecisionNarrative(
  run: InternalRunState,
  world: WorldConfig,
  input: { decision: DecisionType; label: string; description: string; abilityRefs?: string[]; locationDirective?: import("@reroll/shared").MilestoneChoice["options"][number]["locationDirective"]; decisionBrief?: NarrativeDecisionBrief; socialForces?: NarrativeSocialForceReference[]; check?: ChoiceCheck; roll?: ChoiceRoll; allowSurvival?: boolean; eventResult?: string },
  ctx: NarrativeContext
): Promise<NarrativeContinuityChanges & { narrative: string; assetActivity: NarrativeAssetActivity; survivalThreat?: string; nextClock?: "hold" | "advance" }> {
  const prompt = [
    "已选行动：" + input.label + "：" + input.description,
    input.decisionBrief ? "事件背景：" + input.decisionBrief.question + "；" + input.decisionBrief.stakes : "",
    "检定结果：" + (input.roll?.success ? "成功" : "失败"),
    input.eventResult ? "本次确定的事件结果：" + input.eventResult : "",
    "求生分支权限：" + (input.allowSurvival ? "允许" : "不允许")
  ].filter(Boolean).join("\n");
  const result = await requestNarrativeOutcomeTool(run, world, ctx, narrativeDecisionRenderTool(), prompt, {
    task: "decision",
    callId: `${ctx.callId ?? `decision:${run.runId}:${run.age}`}:render`,
    source: "decision",
    contracts: { activity: true, assets: "declarations" },
    parseResult: (raw, _toolName, { characterDirectory }) => usesPresetEventAssets(run) ? [] : parseDynamicNarrativeParticipants(raw.participants, input.socialForces ?? [], characterDirectory, true)!
  });
  const narrative = normalizeNarrativeText(result.raw.narrative);
  if (!isSafePlayerNarrative(narrative)) {
    throw invalidNarrativeOutcome("decision_narrative_invalid", { rule: "narrative_text_invalid", path: "narrative" });
  }
  return {
    ...generationChanges(run, result, result.parsed!, { sourceEventId: run.nextMilestoneChoice?.check ? `${run.nextMilestoneChoice.check.id}:result` : `${run.pendingDynamicScene?.id ?? ctx.callId}:decision:${run.history.length + 1}`, characters: [] }),
    narrative,
    nextClock: parseNextClock(result.raw.nextClock),
    survivalThreat: input.allowSurvival && typeof result.raw.survivalThreat === "string" ? result.raw.survivalThreat.trim() || undefined : undefined,
    assetActivity: result.assetActivity ?? { locationIds: [], abilityIds: [] }
  };
}

export async function synchronizePresetEventAssets(
  run: InternalRunState, world: WorldConfig, batch: NonNullable<InternalRunState["narrative"]["assetBuffer"]>, ctx: NarrativeContext
): Promise<EventAssetChanges> {
  const prompt = ["事件组预设资产及现状：" + JSON.stringify(eventAssetCandidates(run, batch)),
    "新增实际对话：", ...batch.rounds.map((round) => formatNarrativeExperience(round, round.narrative))].join("\n\n");
  const result = await requestNarrativeOutcomeTool(run, world, { ...ctx, conversation: undefined, narrativePlan: undefined }, eventAssetTool(), prompt, {
    task: "continuity", parseResult: (raw) => {
      // Validate through the same application path, without publishing during correction.
      const draft = structuredClone(run);
      try { applyEventAssetChanges(draft, batch, raw); return raw as unknown as EventAssetChanges; }
      catch (error) { throw invalidNarrativeOutcome("event_asset_changes_invalid", { rule: "preset_asset_invalid", path: "updates", received: String(error) }); }
    }
  });
  return result.parsed!;
}

export async function synchronizeNarrativeContinuity(
  run: InternalRunState,
  world: WorldConfig,
  input: {
    callId: string;
    source: NarrativeContextComposeInput["source"];
    subject: string;
    narrative: string;
    focusIds?: string[];
    writeSet: NarrativeContinuityWriteSet;
    continuityRequired: boolean;
    socialForces?: NarrativeSocialForceReference[];
    eventSources?: Array<{ sourceEventId: string; age: number; actId?: string }>;

    handoff?: NarrativeRoundHandoff;
  },
  ctx: NarrativeContext
): Promise<NarrativeContinuityChanges> {
  const facts = narrativeContinuityFacts(run.story.factLedger?.facts ?? [], run.narrative.actRuntime?.actId,
    run.narrative.assetBuffer?.rounds.flatMap((round) => round.relatedIds ?? []))
    .filter((entry) => input.writeSet.factIds.includes(entry.id));
  const writeSet = { ...input.writeSet, factIds: facts.map((entry) => entry.id) };
  const eventSources = input.eventSources?.length ? input.eventSources : [{
    sourceEventId: input.handoff?.sourceEventId ?? input.callId, age: run.age, actId: run.narrative.actRuntime?.actId
  }];
  const taskContextPrefix = [
    `主角身份：${narrativeProtagonistAnchor(run)}。`,
    input.socialForces?.length ? `社会力量类别（人物归属、地点关联与事件引用）：${input.socialForces.map((entry) => `${entry.id}=${entry.label}`).join("；")}。` : ""
  ].filter(Boolean).join("\n");
  const prompt = [
    `可更新事项：${JSON.stringify(facts.filter((entry) => input.focusIds?.includes(entry.id)).map((entry) => ({
      id: entry.id, label: entry.label, actId: entry.actId, status: entry.status,
      ...(entry.status === "resolved" ? { result: entry.resolutionSummary } : { currentState: entry.progressSummary }),
      characterIds: entry.characterIds, locationIds: entry.locationIds, abilityIds: entry.abilityIds, factionIds: entry.factionIds
    })))}`,
    `其他事项索引：${JSON.stringify(facts.filter((entry) => !input.focusIds?.includes(entry.id)).map(({id,label,status}) => ({id,label,status})))}`,
    `正文来源与年龄：${JSON.stringify(eventSources)}`,
    `本轮事项：${normalizeNarrativeText(input.subject)}。`,
    `最终正文：${input.narrative}。`
  ].join("\n");
  const result = await requestNarrativeOutcomeTool(run, world, { ...ctx, conversation: undefined, narrativePlan: undefined }, narrativeContinuityTool(), prompt, {
    task: "continuity",
    taskContextPrefix,
    callId: `${input.callId}:continuity`,
    source: input.source,
    focusIds: input.focusIds,
    writeSet,
    eventSources,
    factionIds: (input.socialForces ?? []).map((entry) => entry.id),
    contracts: {
      assets: true,
      facts: true,
      relationships: true,
      layout: "continuity"
    },
    handoff: input.handoff
  });
  const assetUpdates = result.assetUpdates && (result.assetUpdates.locations.length || result.assetUpdates.abilities.length)
    ? result.assetUpdates
    : undefined;
  const factUpdates = result.factUpdates && (
    result.factUpdates.introduce.length ||
    result.factUpdates.touchFactIds.length ||
    result.factUpdates.progress?.length ||
    result.factUpdates.resolveFactIds.length ||
    result.factUpdates.resolutions?.length
  ) ? result.factUpdates : undefined;
  const sourceEventId = input.handoff?.sourceEventId ?? input.callId;
  return {
    handoff: { sourceEventId, characters: input.handoff?.characters ?? [] },

    assetUpdates, factUpdates,
    relationshipUpdates: result.relationshipUpdates?.length ? result.relationshipUpdates : undefined,
    identityMerges: parseNarrativeIdentityMerges(result.raw.identityMerges, roundIdentityState(run, input.handoff)),
    retirements: parseAssetRetirements(result.raw.retirements, run)
  };
}

function parseParticipantRelationship(raw: unknown): Pick<NarrativeCharacterRelationship, "stance" | "summary"> | null | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  try {
    const update = parseRelationshipUpdates([{ ...raw, characterRef: "participant" }], ["participant"])![0];
    return { ...(update.stance !== undefined ? { stance: update.stance } : {}), ...(update.summary !== undefined ? { summary: update.summary } : {}) };
  } catch { return null; }
}

export function parseDynamicNarrativeParticipants(
  raw: unknown,
  factions: DynamicNarrativeSceneInput["socialForces"],
  knownCharacters: Array<Pick<DynamicNarrativeSceneInput["knownCharacters"][number], "id" | "name" | "factionId" | "role" | "description">>,
  declarations = false
): DynamicNarrativeSceneResult["participants"] | null {
  const invalid = (rule: string, path: string, expected?: unknown, received?: unknown) => {
    throw invalidNarrativeOutcome("dynamic_scene_identity_or_participants_invalid", { rule, path, expected, received });
  };
  if (!Array.isArray(raw)) return invalid("participants_array_invalid", "participants", "array", typeof raw);
  const participants: DynamicNarrativeSceneResult["participants"] = [];
  for (const [index, value] of raw.entries()) {
    const path = `participants[${index}]`;
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("object_required", path);
    const item = value as Record<string, unknown>;
    let characterRef = typeof item.characterRef === "string" ? item.characterRef.trim() : "";
    let known = characterRef === "new" ? undefined : knownCharacters.find((character) => character.id === characterRef);
    if (declarations && characterRef !== "new" && !known) {
      const matches = knownCharacters.filter((character) => character.name === characterRef);
      if (matches.length === 1) { known = matches[0]; characterRef = known.id; }
      else if (characterRef && !["character:", "location:", "ability:"].some((prefix) => characterRef.startsWith(prefix))) {
        participants.push({ characterRef: "new", name: characterRef, recurring: true });
        continue;
      }
    }
    if (!characterRef || (characterRef !== "new" && !known)) {
      return invalid("character_reference_invalid", `${path}.characterRef`, ["new", ...knownCharacters.map((character) => character.id)], characterRef || item.characterRef);
    }
    if (declarations) {
      const name = known?.name ?? normalizeNarrativeText(item.name);
      if (!isSafePlayerText(name, 1)) return invalid("text_required", `${path}.name`);
      const matches = known ? [known] : knownCharacters.filter((entry) => entry.name === name);
      participants.push({ characterRef: matches.length === 1 ? matches[0].id : characterRef, name, recurring: true });
      continue;
    }
    const relationship = parseParticipantRelationship(item.relationship);
    if (relationship === null) return invalid("relationship_invalid", `${path}.relationship`);
    const name = known?.name ?? normalizeNarrativeText(item.name);
    if (item.factionId !== undefined && typeof item.factionId !== "string") return invalid("faction_reference_invalid", `${path}.factionId`);
    const factionId = typeof item.factionId === "string" ? item.factionId.trim() : undefined;
    if (factionId && !factions.some((faction) => faction.id === factionId)) return invalid("faction_reference_invalid", `${path}.factionId`);
    const role = normalizeNarrativeText(item.role);
    const description = normalizeNarrativeText(item.description);
    if (!known) {
      if (!isSafePlayerText(name, 1)) return invalid("text_required", `${path}.name`);
      if (!isSafePlayerText(role, 1)) return invalid("text_required", `${path}.role`);
      if (typeof item.recurring !== "boolean") return invalid("boolean_required", `${path}.recurring`);
    }
    if ((!known || item.description !== undefined) && !isSafePlayerText(description, 1)) return invalid("text_required", `${path}.description`);
    participants.push({ characterRef, name, factionId, role, description, recurring: known ? true : item.recurring === true, relationship });
  }
  return participants;
}



export function dynamicNarrativeScenePrompt(
  input: DynamicNarrativeSceneInput, toolSet = dynamicNarrativeSceneTools(input), narrative = ""
): string {
  const policy = input.presentation === "summary" ? input.backgroundAttributePolicy : input.attributePolicy;
  if (!policy || !toolSet.tools.length) throw invalidNarrativeOutcome("dynamic_scene_tools_missing");
  return [
    input.presentation === "summary"
      ? `本轮实际年龄区间：${input.backgroundAgeRange.fromAge}-${input.backgroundAgeRange.toAge}岁；成长标签逐年应用。`
      : `本轮实际年龄：${input.sceneAge}岁。`,
    `最终正文：${narrative}`,
    `属性工具规则：${describeNarrativeAttributePolicy(policy)}`
  ].join("\n");
}

export function dynamicNarrativeRenderPrompt(input: DynamicNarrativeSceneInput, previousAge: number): string {
  return [
    input.presentation === "summary"
      ? "本段年龄区间：" + input.backgroundAgeRange.fromAge + "—" + input.backgroundAgeRange.toAge + "岁。"
      : "本段年龄：" + input.sceneAge + "岁；" + (input.sceneAge === previousAge
        ? "在当前岁内继续经历。" : "本段覆盖从" + previousAge + "岁到" + input.sceneAge + "岁的岁月。"),
    input.preparation?.mode === "transition" ? "过渡生活：承接实际生活、所在地及上一幕结果，新幕局势尚未发生。" : "",
    input.preparation?.context ? (input.preparation.mode === "life_interval" ? "这一阶段的普通生活：" : "这一阶段的生活与准备：") + input.preparation.context : "",
    input.preparation?.mode === "life_interval" ? "本段为事件之间的普通生活，后续事件另行展开。" : "",
    input.preparation?.mode === "prepare" || input.preparation?.mode === "flow_prepare" ? "准备不足项：" + input.preparation.deficits.map((entry) =>
      entry.label + "（现有" + entry.value + "，所需" + entry.target + "）").join("；") : "",
    input.flowEvent ? "当前完整事件组：" + input.flowEvent.label + "；叙事地位：" + input.flowEvent.narrativeRole : "",
    input.flowEvent ? "本段经历：" + input.flowEvent.situation : "",
    input.flowEvent?.result ? "本段结果（由本次正文呈现）：" + input.flowEvent.result : "",
    input.flowEvent?.options ? "待玩家决定的行动：" + JSON.stringify(input.flowEvent.options) : "",
    input.flowEvent?.rules ? "本次处置规则：" + JSON.stringify(input.flowEvent.rules) : "",
    narrativeProseProfileInstruction(narrativeProseProfile(input.presentation === "summary" ? "summary" : "scene")),
    input.choiceCheck ? "出现抉择时的核查属性：" + {
      family: "家境：资源、信用与背景", intelligence: "智力：理解、推理与判断",
      charisma: "魅力：沟通、影响与信任", fortune: "气运：不确定机会与际遇", physique: "体魄：体能、耐力与战斗执行"
    }[input.choiceCheck.stat] : ""
  ].filter(Boolean).join("\n");
}

function nextClockSchema() {
  return { type: "string", enum: ["hold", "advance"],
    description: "下一段时间方式。hold：当前岁内继续经历，可包含行动、训练或交涉；advance：进入下一岁。" };
}

function parseNextClock(value: unknown): "hold" | "advance" {
  if (value === "advance") return "advance";
  if (value === "hold") return "hold";
  throw invalidNarrativeOutcome("narrative_next_clock_invalid", { rule: "invalid_value", path: "nextClock", received: value });
}

/** Final-prose declarations share the same identities as subsequent bookkeeping. */
function generationChanges(
  run: InternalRunState,
  result: { assetUpdates?: NarrativeAssetUpdates; factUpdates?: NarrativeFactUpdates },
  parsedParticipants: NarrativeParticipant[],
  handoff?: NarrativeRoundHandoff
): NarrativeContinuityChanges & { handoff: NarrativeRoundHandoff; participants: NarrativeParticipant[] } {
  const sourceEventId = handoff?.sourceEventId ?? `story:${run.runId}:${committedNarrativeSequence(run.narrative)}`;
  const participants = prepareRoundParticipants(run, sourceEventId, parsedParticipants, handoff?.characters);
  return { handoff: { sourceEventId, characters: participants }, participants,
    assetUpdates: result.assetUpdates, factUpdates: result.factUpdates };
}

export async function generateDynamicNarrativeScene(
  run: InternalRunState, world: WorldConfig, input: DynamicNarrativeSceneInput, ctx: NarrativeContext
): Promise<DynamicNarrativeSceneResult> {
  const handoff = input.handoff ?? { sourceEventId: `dynamic:${input.act.id}:${input.sceneAge}:${run.history.length + 1}`, characters: [] };
  const render = dynamicNarrativeRenderTools(input);
  const knownLocationIds = (run.narrative.assets?.locations ?? []).map((entry) => entry.id);
  const rendered = await requestNarrativeOutcomeTool(run, world, ctx, render.tools, dynamicNarrativeRenderPrompt(input, run.age), {
    task: input.presentation === "summary" ? "background" : "rendering",
    callId: `${input.plan?.callId ?? `turn:${run.runId}:${run.age}`}:render`,
    source: input.presentation === "summary" ? "background" : "scene",
    age: input.presentation === "summary" ? input.backgroundAgeRange.toAge : input.sceneAge,
    ageRange: input.presentation === "summary" ? input.backgroundAgeRange : undefined,
    actId: input.act.id,
    focusIds: input.plan ? narrativeTurnPlanFocusIds(input.plan) : undefined,
    handoff, contracts: { activity: true, assets: "declarations" },
    parseResult: (raw, toolName, { characterDirectory }) => ({
      ...(input.flowEvent?.kind === "choice" ? parseAuthoredEventChoice(raw, input.flowEvent)
        : input.flowEvent?.kind === "settlement" ? parseEventSettlement(raw, input.flowEvent)
        : parseDynamicNarrativeProse(raw, toolName as DynamicNarrativeRenderToolName, input.plan, knownLocationIds)),
      participants: usesPresetEventAssets(run) ? [] : parseDynamicNarrativeParticipants(raw.participants, input.socialForces, characterDirectory, true)!
    })
  });
  const { narrative, createsDecision, decisionBrief, milestoneCopy, participants } = rendered.parsed!;
  const result: DynamicNarrativeSceneResult = {
    turnKind: input.presentation === "summary" ? "background" : "scene",
    patternIds: input.plan?.patternIds ?? [], forceIds: input.plan?.forceIds ?? [],
    ...generationChanges(run, rendered, participants, handoff),
    narrative,
    assetActivity: rendered.assetActivity ?? { locationIds: [], abilityIds: [] }
  };
  if (result.turnKind === "background") return result;
  result.nextClock = rendered.parsed!.nextClock;
  result.resolutionId = "resolutionId" in rendered.parsed! && typeof rendered.parsed!.resolutionId === "string" ? rendered.parsed!.resolutionId : undefined;
  result.createsDecision = createsDecision;
  result.decisionBrief = decisionBrief;
  result.milestoneCopy = milestoneCopy;
  if (createsDecision) result.choiceCheck = input.choiceCheck;
  return result;
}

function parseEventSettlement(raw: Record<string, unknown>, flow: EventFlowRenderInput) {
  const prose = parseDynamicNarrativeProse(raw, "render_scene_prose");
  if (typeof raw.resolutionId !== "string" || !flow.rules?.some((rule) => rule.id === raw.resolutionId)) {
    throw invalidNarrativeOutcome("event_settlement_resolution_invalid", { rule: "reference_invalid", path: "resolutionId", received: raw.resolutionId });
  }
  return { ...prose, resolutionId: raw.resolutionId };
}

function parseAuthoredEventChoice(raw: Record<string, unknown>, flow: EventFlowRenderInput): Pick<DynamicNarrativeSceneResult, "narrative" | "createsDecision" | "decisionBrief" | "milestoneCopy" | "nextClock"> {
  const narrative = normalizeNarrativeText(raw.narrative);
  if (!isSafePlayerNarrative(narrative)) throw invalidNarrativeOutcome("dynamic_scene_narrative_unsafe", { rule: "narrative_text_invalid", path: "narrative" });
  return { narrative, createsDecision: true,
    decisionBrief: { question: flow.question!, stakes: flow.stakes! },
    milestoneCopy: { background: narrative, optionOverrides: flow.options!.map((option) => ({ id: option.id, label: option.label, description: option.action })) }
  };
}

/** Interpret the tool actually selected by the writer, independently of the planner's suggested form. */
export function parseDynamicNarrativeProse(
  raw: Record<string, unknown>, toolName: DynamicNarrativeRenderToolName,
  plan?: NarrativeTurnPlan, knownLocationIds: readonly string[] = []
): Pick<DynamicNarrativeSceneResult, "narrative" | "createsDecision" | "decisionBrief" | "milestoneCopy" | "nextClock"> {
  const narrative = normalizeNarrativeText(raw.narrative);
  if (!isSafePlayerNarrative(narrative)) throw invalidNarrativeOutcome("dynamic_scene_narrative_unsafe", {
    rule: "narrative_text_invalid", path: "narrative"
  });
  if (toolName === "render_background_prose") return { narrative, createsDecision: false };
  if (toolName === "render_scene_prose") return { narrative, createsDecision: false, nextClock: parseNextClock(raw.nextClock) };
  const brief = raw.decisionBrief && typeof raw.decisionBrief === "object" && !Array.isArray(raw.decisionBrief)
    ? raw.decisionBrief as Record<string, unknown> : {};
  const question = normalizeNarrativeText(brief.question);
  const stakes = normalizeNarrativeText(brief.stakes);
  if (!isSafePlayerText(question, 1) || !isSafePlayerText(stakes, 1)) throw invalidNarrativeOutcome("dynamic_choice_presentation_invalid", {
    rule: "decision_brief_required", path: !isSafePlayerText(question, 1) ? "decisionBrief.question" : "decisionBrief.stakes"
  });
  const background = normalizeNarrativeText(raw.background);
  const optionOverrides = normalizeMilestoneOptionOverrides(raw.optionOverrides, true, plan, knownLocationIds);
  if (!isSafePlayerNarrative(background) || !optionOverrides) throw invalidNarrativeOutcome("dynamic_choice_presentation_invalid", {
    rule: "choice_background_invalid", path: "background"
  });
  return { narrative, createsDecision: true, decisionBrief: { question, stakes }, milestoneCopy: { background, optionOverrides } };
}

export async function settleDynamicNarrativeScene(
  run: InternalRunState, world: WorldConfig, input: DynamicNarrativeSceneInput,
  scene: DynamicNarrativeSceneResult, ctx: NarrativeContext
): Promise<DynamicNarrativeSceneResult> {
  if (scene.createsDecision) return scene;
  const tools = dynamicNarrativeSceneTools(input);
  const settlement = await requestNarrativeOutcomeTool(run, world, isolatedNarrativeTaskContext(ctx, "settlement"),
    tools.tools, dynamicNarrativeScenePrompt(input, tools, scene.narrative), {
      task: "settlement", callId: `${input.plan?.callId ?? run.runId}:settlement`,
      source: scene.turnKind
    });
  if (scene.turnKind === "background") return { ...scene, backgroundAttributeEffects:
    parseNarrativeEffects(settlement.raw.effects, input.backgroundAttributePolicy, "dynamic_background_effects_invalid") };
  return { ...scene, attributeEffects:
    parseNarrativeEffects(settlement.raw.effects, input.attributePolicy!, "dynamic_scene_effects_invalid") };
}

export function recordDirectedStoryTurnOutcome(
  ctx: NarrativeContext,
  run: InternalRunState,
  outcome: {
    kind: "origin" | "normal" | "milestone";
    ageFrom?: number;
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
  pushHistory(
    conversation,
    "user",
    outcome.kind === "origin" ? "人物0岁时的身世与来处。" : `${outcome.ageFrom !== undefined && outcome.ageFrom !== run.age ? `${outcome.ageFrom}—${run.age}` : run.age}岁时的经历。`,
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
    `人物在${run.age}岁作出取舍：${outcome.label}。`,
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
  if (run.narrative.enabled) throw new Error("legacy_year_path_disabled");
  if (!ctx.apiKey.trim()) return "";
  const promptPack = normalizePromptPackForModel(ctx.promptPack);
  const systemPrompt = buildRunSystemPrompt(run, promptPack, world, ctx, "year");
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
        const tailResult = await continueNarrative(ctx, systemPrompt, text, {
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
  raw: unknown, reportFailure = false, plan?: NarrativeTurnPlan, knownLocationIds: readonly string[] = []
): AiMilestoneOptions["optionOverrides"] | null {
  const invalid = (rule: string, path: string, received?: unknown) => {
    if (reportFailure) throw invalidNarrativeOutcome("dynamic_choice_presentation_invalid", { rule, path, received });
    return null;
  };
  if (!Array.isArray(raw) || raw.length !== 3) return invalid("choice_count", "optionOverrides", Array.isArray(raw) ? raw.length : typeof raw);
  const availableAbilities = plan?.materials?.filter((entry) => entry.kind === "ability").map((entry) => entry.id) ?? plan?.abilityRefs ?? [];
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
    if (reportFailure && item.abilityRefs !== undefined && !Array.isArray(item.abilityRefs)) return invalid("invalid_type", `${path}.abilityRefs`, item.abilityRefs);
    if (reportFailure && Array.isArray(item.abilityRefs) && item.abilityRefs.some((ref: unknown) => typeof ref !== "string" || !availableAbilities.includes(ref))) return invalid("choice_ability_reference_invalid", `${path}.abilityRefs`, item.abilityRefs);
    const abilityRefs = Array.isArray(item.abilityRefs)
      ? Array.from(new Set((item.abilityRefs as unknown[]).filter((ref): ref is string => typeof ref === "string" && availableAbilities.includes(ref))))
      : [];
    const rawLocation = item.locationDirective && typeof item.locationDirective === "object" && !Array.isArray(item.locationDirective)
      ? item.locationDirective as Record<string, unknown> : {};
    if (reportFailure && item.locationDirective !== undefined && !["stay", "revisit", "move"].includes(rawLocation.mode as string)) return invalid("choice_location_mode_invalid", `${path}.locationDirective.mode`, rawLocation.mode);
    if (reportFailure && rawLocation.locationRef !== undefined && (typeof rawLocation.locationRef !== "string" || !knownLocationIds.includes(rawLocation.locationRef))) return invalid("choice_location_reference_invalid", `${path}.locationDirective.locationRef`, rawLocation.locationRef);
    const mode: NonNullable<import("@reroll/shared").MilestoneChoice["options"][number]["locationDirective"]>["mode"] = rawLocation.mode === "stay" || rawLocation.mode === "revisit" || rawLocation.mode === "move" ? rawLocation.mode : "stay";
    const requestedLocationRef = typeof rawLocation.locationRef === "string" && knownLocationIds.includes(rawLocation.locationRef)
      ? rawLocation.locationRef : undefined;
    const locationRef = mode === "stay" ? undefined : requestedLocationRef;
    const purpose = normalizeNarrativeText(rawLocation.purpose);
    if (reportFailure && mode === "revisit" && !locationRef) return invalid("choice_location_reference_invalid", `${path}.locationDirective.locationRef`, rawLocation.locationRef);
    if (reportFailure && mode === "move" && !purpose) return invalid("choice_location_purpose_required", `${path}.locationDirective.purpose`);
    byId.set(id, {
      id, label, description, abilityRefs,
      locationDirective: { mode, ...(locationRef ? { locationRef } : {}), ...(purpose ? { purpose } : {}) }
    });
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
  if (run.narrative.enabled) throw new Error("legacy_milestone_path_disabled");

  if (!ctx.apiKey.trim()) {
    return run.nextMilestoneChoice ? fallbackFromChoice(run.nextMilestoneChoice) : defaultOptions();
  }

  const baseChoice = run.nextMilestoneChoice;
  const fallback = baseChoice ? fallbackFromChoice(baseChoice) : defaultOptions();

  const promptPack = normalizePromptPackForModel(ctx.promptPack);
  const systemPrompt = buildRunSystemPrompt(run, promptPack, world, ctx, "milestone");
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



  const promptPack = normalizePromptPackForModel(ctx.promptPack);
  const systemPrompt = buildRunSystemPrompt(run, promptPack, world, ctx, "ending");
  const systemHash = hashSystemPrompt(systemPrompt);
  const conversation = ensureConversationState(ctx.conversation, systemHash, systemPrompt);
  ctx.conversation = conversation;
  compactConversationWindow(ctx, conversation);
  const composition = composeNarrativeContext({
    plan: ctx.narrativePlan,
    task: "ending",
    taskPrompt: buildEndingPrompt(run),
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
      promptMessages: composition.messages,
      usageOperation: "ending"
    });
    const text = normalizeNarrativeText(callResult.text);
    if (!isSafePlayerNarrative(text) || callResult.truncated || isLikelyTruncated(text)) {
      throw new DirectedStoryRenderError("directed_story_render_invalid_output");
    }
    pushHistory(conversation, "assistant", text);
    keepRecentRounds(conversation);
    return text;
  } catch (error) {
    keepRecentRounds(conversation);
    debugError("ending-narrative", error);
    if (error instanceof DirectedStoryRenderError) throw error;
    throw new DirectedStoryRenderError("directed_story_render_unavailable");
  }
}
