import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import seedrandom from "seedrandom";
import { once } from "node:events";
import path from "node:path";
import type {
  AgeThreshold,
  AdminConfigPayload,
  BackgroundCard,
  ContentBundle,
  DecisionType,
  DifficultyConfig,
  GameplayTuning,
  GameEnvConfigRequest,
  NarrativeAttributePolicy,
  NarrativeIntent,
  NarrativeComponentDefinition,
  NarrativeWorldDefinition,
  PublicMilestoneChoice,
  PublicTimelineEntry,
  TurnRecord,
  ProviderConfig,
  StepAction,
  StartAllocationConfig,
  StartRunRequest,
  StepRunRequest,
  StoryDirectionDefinition,
  WorldConfig,
  YearEvent
} from "@reroll/shared";
import { createDefaultGameplayTuning } from "@reroll/shared";
import {
  generateEndingNarrative,
  generateDynamicNarrativeScene,
  generateDirectedDecisionNarrativeOutcome,
  generateMilestoneOptions,
  generateNarrativeOrigin,
  generateYearNarrative,
  isDirectedToolAvailable,
  NarrativeOutcomeError,
  recordDirectedDecisionOutcome,
  recordDirectedStoryTurnOutcome
} from "./ai.js";
import { generateNarrativeRender, generateNarrativeTurn } from "./narrative-provider.js";
import { approveStoryClosure, approveStoryIntent } from "./tool-gateway.js";
import { providerLimits } from "./constants.js";
import { getCloudApiKey, getDeployMode, readRuntimeConfig, writeRuntimeConfig } from "./config.js";
import {
  loadFactionEvents,
  loadFactions,
  loadEventDefinitions,
  loadItemDefinitions,
  loadNarrativeWorldDefinition,
  loadWorldlineSetting,
  readContentBundle,
  writeContentBundle
} from "./content.js";
import { buildNarrativePromptPlan, ensureNarrativeActRuntime, isNarrativeEarlyLife, isNarrativeMainlineActEntryReady, isNarrativeWorldStageReady, retrieveNarrativeMemories, selectNarrativeGrowthFocus } from "./narrative.js";
import {
  attachTimelineChunk,
  applyDirectedMilestonePresentation,
  advanceWithDirectedEvent,
  advanceWithDynamicNarrativeScene,
  autoAdvanceToCheckpoint,
  applyMilestoneDecisionAndAdvance,
  appendPublicTurnRecord,
  buildDirectedEventCandidates,
  buildDirectedDecisionDirections,
  buildDirectedStoryDirections,
  buildDirectedNarrativeComponentFocuses,
  canRequestDirectedClosure,
  createRun,
  createDirectedMilestoneChoice,
  getPendingDirectedDecisionPolicy,
  getDirectedEventAttributePolicy,
  dynamicBackgroundAttributePolicy,
  dynamicSceneAttributePolicy,
  hasPendingRequestId,
  markRunPhase,
  queueTimelineEntries,
  rememberRequestId,
  revealNextTimelineEntry,
  toClientRun,
  toPublicMilestoneChoice,
  toPublicTimelineEntry,
  toPublicTimelineEntryFromEvent,
  toPresentationTimelineEntries,
  resolvePublicDecisionOption,
  resolveNarrativeStatTiers,
  resolveDynamicNarrativeTurnAges,
  resolveSurvivalCrisis,
  resolveTurnRecordChoice,
  settleNarrativeBackgroundOutcomes,
  selectDirectedCandidateForIntent,
  ensureVisibleTurnRecords,
  type InternalRunState
} from "./engine.js";
import {
  adminConfigSchema,
  contentBundleSchema,
  createSaveSchema,
  gameEnvSchema,
  recoverSaveSchema,
  restoreSaveSchema,
  startRunSchema,
  stepRunSchema
} from "./schema.js";
import {
  anonymousSessionTtlMs,
  clearSessionRuns,
  createDecisionCheckpoint,
  createSaveSlot,
  deleteSaveSlot,
  ensureStoreReady,
  getGameEnv,
  getLatestRun,
  getModelUsageSummary,
  getRun,
  getRunSessionId,
  listSaveSlots,
  resolveAnonymousSession,
  resetAnonymousGameData,
  restoreSaveByRecoveryCode,
  restoreSaveSlot,
  saveGameEnv,
  saveRun,
  withRunLock,
  withSessionLock,
  type AnonymousSession
} from "./store.js";

dotenv.config({
  path: path.join(process.cwd(), ".env")
});

const app = express();
const port = Number(process.env.PORT ?? "4000");
const deployMode = getDeployMode();
const debugModel = process.env.DEBUG_MODEL_CALLS === "1";
const anonymousSessionCookie = "reroll_session";
type NarrativeCallContext = Parameters<typeof generateYearNarrative>[3];
type TimelineEntryChunk = NonNullable<InternalRunState["timelineChunk"]>;
type TimelineEntryItem = PublicTimelineEntry;
type StreamDonePayload = { run: ReturnType<typeof toClientRun>; timelineChunk: PublicTimelineEntry[]; turns?: TurnRecord[] };
type GameRequest = express.Request & { anonymousSession?: AnonymousSession };
type GameStreamEvent =
  | {
      type: "meta";
      data: {
        branch: "start" | "step";
        runId: string;
        rawChunkCount: number;
        fromAge: number;
        toAge: number;
        tuning: StartAllocationConfig;
      };
    }
  | { type: "started"; data: { run: ReturnType<typeof toClientRun> } }
  | { type: "turn"; data: { index: number; total: number; record: TurnRecord } }
  | { type: "done"; data: StreamDonePayload }
  | { type: "error"; data: { message: string } };

class ServerBusyError extends Error {
  constructor(message = "服务器繁忙，请稍后重试") {
    super(message);
    this.name = "ServerBusyError";
  }
}

interface QueueTicket {
  resolve: () => void;
  reject: (error: Error) => void;
}

const globalFlowConcurrency = (() => {
  const parsed = Number(process.env.GLOBAL_FLOW_CONCURRENCY ?? "10");
  if (!Number.isFinite(parsed)) return 10;
  return Math.max(1, Math.min(32, Math.floor(parsed)));
})();
const globalFlowQueueWaitMs = 20_000;
let activeGlobalFlows = 0;
const globalFlowQueue: QueueTicket[] = [];

function pumpGlobalFlowQueue(): void {
  while (activeGlobalFlows < globalFlowConcurrency && globalFlowQueue.length > 0) {
    const next = globalFlowQueue.shift();
    if (!next) break;
    activeGlobalFlows += 1;
    next.resolve();
  }
}

async function acquireGlobalFlowSlot(): Promise<() => void> {
  if (activeGlobalFlows < globalFlowConcurrency) {
    activeGlobalFlows += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeGlobalFlows = Math.max(0, activeGlobalFlows - 1);
      pumpGlobalFlowQueue();
    };
  }

  let timeoutHandle: NodeJS.Timeout | null = null;
  let ticketRef: QueueTicket | null = null;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const ticket: QueueTicket = {
      resolve: () => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        resolve();
      },
      reject: (error) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        reject(error);
      }
    };
    ticketRef = ticket;
    globalFlowQueue.push(ticket);
    timeoutHandle = setTimeout(() => {
      const index = globalFlowQueue.indexOf(ticket);
      if (index >= 0) {
        globalFlowQueue.splice(index, 1);
      }
      ticket.reject(new ServerBusyError());
    }, globalFlowQueueWaitMs);
    pumpGlobalFlowQueue();
  });

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeGlobalFlows = Math.max(0, activeGlobalFlows - 1);
    pumpGlobalFlowQueue();
    ticketRef = null;
  };
}

function isServerBusyError(error: unknown): error is ServerBusyError {
  return error instanceof ServerBusyError || (error as Error | undefined)?.name === "ServerBusyError";
}

const narrativeConcurrency = (() => {
  const parsed = Number(process.env.NARRATIVE_CONCURRENCY ?? "1");
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(1, Math.min(4, Math.floor(parsed)));
})();

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function initNdjsonResponse(res: express.Response): void {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }
}

async function writeNdjsonEvent(res: express.Response, event: GameStreamEvent): Promise<void> {
  const line = `${JSON.stringify(event)}\n`;
  if (!res.write(line)) {
    await once(res, "drain");
  }
}

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
    credentials: true
  })
);
app.use(express.json({ limit: "2mb" }));

if (deployMode === "cloud") {
  app.set("trust proxy", 1);
}

function readCookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const prefix = `${name}=`;
  for (const item of header.split(";")) {
    const value = item.trim();
    if (!value.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(value.slice(prefix.length));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function requireAnonymousSession(req: express.Request): AnonymousSession {
  const session = (req as GameRequest).anonymousSession;
  if (!session) throw new Error("anonymous_session_missing");
  return session;
}

app.use("/api/game", async (req, res, next) => {
  try {
    const requestToken = readCookieValue(req.headers.cookie, anonymousSessionCookie);
    const resolved = await resolveAnonymousSession(requestToken);
    (req as GameRequest).anonymousSession = resolved.session;
    const cookieToken = resolved.token ?? requestToken;
    if (cookieToken) {
      res.cookie(anonymousSessionCookie, cookieToken, {
        httpOnly: true,
        secure: deployMode === "cloud",
        sameSite: "lax",
        maxAge: anonymousSessionTtlMs,
        path: "/"
      });
    }
    next();
  } catch (error) {
    next(error);
  }
});

function resolveWorld(worlds: WorldConfig[], worldId: string): WorldConfig {
  const found = worlds.find((w) => w.id === worldId);
  if (!found) {
    throw new Error("world_not_found");
  }
  return found;
}

function resolveDifficulty(list: DifficultyConfig[], id: string): DifficultyConfig {
  const found = list.find((d) => d.id === id);
  if (!found) {
    throw new Error("difficulty_not_found");
  }
  return found;
}

const defaultAgeThresholds: AgeThreshold[] = [
  { id: "child", label: "幼年", min: 0, max: 12 },
  { id: "youth", label: "青年", min: 13, max: 29 },
  { id: "prime", label: "壮年", min: 30, max: 44 },
  { id: "middle", label: "中年", min: 45, max: 59 },
  { id: "elder", label: "老年", min: 60, max: 120 }
];

function resolveAgeStageForStream(age: number, world: WorldConfig): AgeThreshold {
  const thresholds = world.ageThresholds && world.ageThresholds.length > 0
    ? [...world.ageThresholds].sort((a, b) => a.min - b.min)
    : defaultAgeThresholds;
  const found = thresholds.find((t) => age >= t.min && age <= t.max);
  return found ?? thresholds[thresholds.length - 1];
}

function toTimelineEntryForStream(run: InternalRunState, event: YearEvent, world: WorldConfig): TimelineEntryItem {
  return toPublicTimelineEntryFromEvent(run, event, world);
}

function resolveProviderConfig(
  env: { runtimeMode: "cloud" | "local"; localProviderConfig?: ProviderConfig },
  runtimeCfgCloud: ProviderConfig
): ProviderConfig {
  if (env.runtimeMode === "local" && env.localProviderConfig) {
    const localModel = env.localProviderConfig.model?.trim() ?? "";
    if (/[A-Za-z]/.test(localModel)) {
      return env.localProviderConfig;
    }
  }
  return runtimeCfgCloud;
}

function resolveApiKey(
  env: { runtimeMode: "cloud" | "local"; localApiKey?: string }
): string {
  if (env.runtimeMode === "local") {
    return env.localApiKey?.trim() ?? "";
  }
  return getCloudApiKey();
}

function summarizeWorldline(worldline: unknown): string {
  if (!worldline || typeof worldline !== "object") return "";
  const w = worldline as {
    eraName?: string;
    timeframe?: string;
    coreConflict?: string;
    socialOrder?: string;
    taboos?: string[];
    mainlineStages?: Array<{ stage?: string; ageRange?: string; goal?: string }>;
  };
  const stages = Array.isArray(w.mainlineStages)
    ? w.mainlineStages
        .map((stage) => {
          const name = stage.stage?.trim();
          const ageRange = stage.ageRange?.trim();
          const goal = stage.goal?.trim();
          if (!name && !ageRange && !goal) return "";
          return `${name || "阶段"}${ageRange ? `(${ageRange})` : ""}${goal ? `=${goal}` : ""}`;
        })
        .filter(Boolean)
        .join("；")
    : "";
  return [
    w.eraName ? `时代:${w.eraName}` : "",
    w.timeframe ? `时间:${w.timeframe}` : "",
    w.coreConflict ? `主冲突:${w.coreConflict}` : "",
    w.socialOrder ? `秩序:${w.socialOrder}` : "",
    w.taboos?.length ? `禁忌:${w.taboos.join("、")}` : "",
    stages ? `阶段:${stages}` : ""
  ].filter(Boolean).join(" | ");
}

interface PublicGameError {
  status: number;
  code: string;
  message: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toPublicGameError(error: unknown): PublicGameError {
  if (isServerBusyError(error)) {
    return { status: 503, code: "server_busy", message: "服务器繁忙，请稍后重试。" };
  }
  const message = errorMessage(error);
  if (message === "run_not_found" || message === "run_client_missing") {
    return { status: 404, code: "run_not_found", message: "本局记录不存在或已失效，请重新开始。" };
  }
  if (message === "anonymous_session_missing") {
    return { status: 503, code: "session_unavailable", message: "本局会话暂不可用，请稍后重试。" };
  }
  if (message === "save_not_found") {
    return { status: 404, code: "save_not_found", message: "存档不存在、已过期，或不属于当前浏览器会话。" };
  }
  if (message === "recovery_code_invalid") {
    return { status: 404, code: "recovery_code_invalid", message: "恢复码无效或对应存档已过期。" };
  }
  if (message === "save_limit_reached") {
    return { status: 409, code: "save_limit_reached", message: "当前会话的存档数量已达上限，请先删除不需要的存档。" };
  }
  if (message === "missing_game_environment_config" || message === "deploy_mode_env_mismatch") {
    return { status: 409, code: "game_environment_invalid", message: "本局环境已失效，请重新确认后继续。" };
  }
  if (message === "decision_required" || message === "当前没有可用的关键抉择") {
    return { status: 409, code: "decision_unavailable", message: "当前抉择状态已变化，请刷新后重试。" };
  }
  if (
    message === "directed_story_turn_unavailable" ||
    message === "directed_story_turn_invalid_output" ||
    message === "directed_story_tools_unavailable" ||
    message === "directed_story_render_unavailable" ||
    message === "directed_story_render_invalid_output"
  ) {
    return { status: 503, code: "narrative_unavailable", message: "叙事服务暂时不可用，请稍后重试。" };
  }
  if (
    message === "天赋点超出当前配置允许范围" ||
    message === "选卡数量超出当前配置允许范围" ||
    message === "属性分配总和必须等于本局可用天赋点"
  ) {
    return { status: 400, code: "invalid_start_request", message: "开局参数无效，请重新检查后开始。" };
  }
  return { status: 500, code: "game_unavailable", message: "游戏服务暂时不可用，请稍后重试。" };
}

function logGameFlowError(operation: string, error: unknown): void {
  console.error(`[game-flow:${operation}]`, error);
}

function logNarrativeOutcomeFailure(
  options: Pick<DirectedSegmentOptions, "run" | "providerConfig">,
  error: unknown,
  tool = "dynamic_narrative_scene"
): void {
  if (!debugModel || !(error instanceof NarrativeOutcomeError)) return;
  console.error("[model-debug:narrative-outcome]", {
    reason: error.reason ?? "unspecified",
    tool,
    model: options.providerConfig.model,
    apiPath: options.providerConfig.apiPath,
    actId: options.run.narrative.actRuntime?.actId,
    beat: options.run.narrative.actRuntime?.beat
  });
}

function summarizeFactions(
  factions: Array<{ name: string; values: string[]; behavior: string; eventBias?: string[]; intelStyle?: string }>
): string {
  return factions
    .slice(0, 6)
    .map((f) => {
      const values = f.values?.join("/") ?? "无";
      const bias = f.eventBias && f.eventBias.length > 0 ? f.eventBias.join("/") : "无";
      const intel = f.intelStyle?.trim() || "未知";
      return `${f.name}[价值观:${values};行为:${f.behavior};偏好:${bias};情报风格:${intel}]`;
    })
    .join(" | ");
}

function eventTitle(event: string | { title: string }): string {
  return typeof event === "string" ? event : event.title;
}

function summarizeFactionEvents(events: Array<{ factionId: string; events: Array<string | { title: string }> }>): string {
  return events
    .slice(0, 8)
    .map((x) => `${x.factionId}:${x.events.slice(0, 3).map(eventTitle).join("；")}`)
    .join(" | ");
}

function flattenMilestoneEventPool(events: Array<{ events: Array<string | { title: string }> }>): string[] {
  return events
    .flatMap((x) => x.events ?? [])
    .map(eventTitle)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function summarizeTalentHooks(cards: BackgroundCard[]): string {
  return cards
    .slice(0, 3)
    .map((card) => {
      const narrative = card.narrative;
      const affinity = narrative?.affinities?.length ? `；倾向=${narrative.affinities.join("/")}` : "";
      const riskTone = narrative?.riskTone ? `；取舍=${narrative.riskTone}` : "";
      return `${card.name}：${narrative?.bias ?? card.description}${affinity}${riskTone}`;
    })
    .join(" | ");
}

interface GameResources {
  content: ContentBundle;
  runtime: Awaited<ReturnType<typeof readRuntimeConfig>>;
  worldline: Awaited<ReturnType<typeof loadWorldlineSetting>>;
  factions: Awaited<ReturnType<typeof loadFactions>>;
  factionEvents: Awaited<ReturnType<typeof loadFactionEvents>>;
  eventDefinitions: Awaited<ReturnType<typeof loadEventDefinitions>>;
  itemDefinitions: Awaited<ReturnType<typeof loadItemDefinitions>>;
  narrativeWorld: NarrativeWorldDefinition | null;
}

async function loadGameResources(worldId: string): Promise<GameResources> {
  const [content, runtime, worldline, factions, factionEvents, eventDefinitions, itemDefinitions, narrativeWorld] = await Promise.all([
    readContentBundle(),
    readRuntimeConfig(),
    loadWorldlineSetting(worldId),
    loadFactions(),
    loadFactionEvents(worldId),
    loadEventDefinitions(worldId),
    loadItemDefinitions(),
    loadNarrativeWorldDefinition(worldId)
  ]);
  return {
    content,
    runtime,
    worldline,
    factions,
    factionEvents,
    eventDefinitions,
    itemDefinitions,
    narrativeWorld
  };
}

function resolveGameplayTuning(content: ContentBundle): GameplayTuning {
  return content.gameplayTuning ?? createDefaultGameplayTuning();
}

function toStartAllocationConfig(tuning: GameplayTuning): StartAllocationConfig {
  return {
    talentPointMin: tuning.bootstrap.talentPointMin,
    talentPointMax: tuning.bootstrap.talentPointMax,
    selectedCardMin: tuning.bootstrap.selectedCardMin,
    selectedCardMax: tuning.bootstrap.selectedCardMax
  };
}

const emptyNarrativeFallbacks = ["平平无奇的一年", "平凡但充实的一年"] as const;
const shortNarrativeFallbacks = [
  "这一年起伏虽小，却在反复试探与收束中让你更稳，许多变化都悄悄落在了来年的起点上。",
  "这一年看似平缓，实则在琐碎与波折间慢慢塑形，你学会了克制、判断，也为下一步蓄了力。"
] as const;

function isLikelyBlankYearEvent(event: YearEvent): boolean {
  return event.title.includes("平年");
}

function isLikelyLowQualityNarrative(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return true;
  if (normalized.length < 10) return true;
  if (!/[。！？!?…】）)」』]$/.test(normalized)) return true;
  return false;
}

function resolveNarrativeWithFallback(
  run: InternalRunState,
  event: YearEvent,
  narrative: string
): string {
  const trimmed = narrative.trim();
  const shouldForceBlankYearFallback = isLikelyBlankYearEvent(event) && isLikelyLowQualityNarrative(trimmed);
  if (trimmed.length > 0 && !shouldForceBlankYearFallback) {
    return trimmed;
  }
  const rng = seedrandom(`${run.seed}:narrative-fallback:${event.age}`);
  if (event.tags.includes("milestone")) {
    return emptyNarrativeFallbacks[rng() < 0.5 ? 0 : 1];
  }
  return shortNarrativeFallbacks[rng() < 0.5 ? 0 : 1];
}

async function narrateChunkWithConcurrency(
  run: InternalRunState,
  world: WorldConfig,
  chunk: InternalRunState["history"],
  narrativeCtx: NarrativeCallContext,
  onNarrated?: (event: YearEvent, index: number, total: number) => Promise<void> | void
): Promise<InternalRunState["history"]> {
  if (chunk.length === 0) return [];

  const narratedChunk = new Array(chunk.length) as InternalRunState["history"];
  let nextIndex = 0;
  let nextEmitIndex = 0;
  const workerCount = Math.min(narrativeConcurrency, chunk.length);
  const historyBeforeChunk = run.history
    .slice(0, Math.max(0, run.history.length - chunk.length))
    ;
  const baseRecentNarratives = historyBeforeChunk
    .slice(-6)
    .map((item) => item.summary?.trim() ?? "")
    .filter(Boolean);
  const seenNarratives = new Set<string>(baseRecentNarratives);

  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= chunk.length) return;

      const event = chunk[index];
      let narrative = "";
      try {
        const avoidNarratives = Array.from(seenNarratives).slice(-8);
        const chunkHistoryForPrompt = chunk
          .slice(0, index + 1)
          .map((item, idx) => (idx < index ? narratedChunk[idx] ?? item : item));
        const promptRun: InternalRunState = {
          ...run,
          age: event.age,
          ageStage: resolveAgeStageForStream(event.age, world),
          history: [...historyBeforeChunk, ...chunkHistoryForPrompt]
        };
        const callCtx: NarrativeCallContext = narrativeCtx.conversation
          ? narrativeCtx
          : {
              ...narrativeCtx,
              conversation: undefined
            };
        narrative = await generateYearNarrative(promptRun, world, event, callCtx, {
          avoidNarratives
        });
      } catch {
        narrative = "";
      }
      const resolvedSummary = resolveNarrativeWithFallback(run, event, narrative);
      narratedChunk[index] = {
        ...event,
        summary: resolvedSummary
      };
      if (resolvedSummary.trim()) {
        seenNarratives.add(resolvedSummary.trim());
      }

      if (onNarrated) {
        while (nextEmitIndex < chunk.length && narratedChunk[nextEmitIndex]) {
          const ready = narratedChunk[nextEmitIndex];
          nextEmitIndex += 1;
          await onNarrated(ready, nextEmitIndex - 1, chunk.length);
        }
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return narratedChunk;
}

interface StartFlowResult {
  updatedRun: InternalRunState;
  timelineChunk: PublicTimelineEntry[];
  rawChunkCount: number;
  fromAge: number;
  toAge: number;
  tuning: StartAllocationConfig;
}

interface GenerationOutput {
  run: InternalRunState;
  generatedChunk: TimelineEntryChunk;
  fromAge: number;
  toAge: number;
  rawChunkCount: number;
}

interface RunYearFlowOptions {
  branch: "start" | "step";
  rawChunk: YearEvent[];
  currentRun: InternalRunState;
  sessionId: string;
  world: WorldConfig;
  providerConfig: ProviderConfig;
  apiKey: string;
  promptPack: Record<string, string>;
  worldlineSummary: string;
  factionSummary: string;
  eventPoolSummary: string;
  talentHookSummary: string;
  narrativeWorld?: NarrativeWorldDefinition | null;
  skipEndingNarrative?: boolean;
}

async function runYearFlow(options: RunYearFlowOptions): Promise<{ updatedRun: InternalRunState; timelineChunk: TimelineEntryChunk }> {
  const {
    branch,
    rawChunk,
    currentRun,
    sessionId,
    world,
    providerConfig,
    apiKey,
    promptPack,
    worldlineSummary,
    factionSummary,
    eventPoolSummary,
    talentHookSummary,
    narrativeWorld,
    skipEndingNarrative
  } = options;

  const narrativeCtx: NarrativeCallContext = {
    providerConfig,
    apiKey,
    usageScope: { sessionId, runId: currentRun.runId, worldId: currentRun.worldId },
    promptPack,
    worldlineSummary,
    factionSummary,
    eventPoolSummary,
    talentHookSummary,
    narrativePlan: buildNarrativePromptPlan(currentRun, narrativeWorld ?? null),
    conversation: currentRun.aiConversation?.year
  };
  const useConversationChain = narrativeConcurrency === 1;
  if (!useConversationChain) {
    narrativeCtx.conversation = undefined;
  }
  if (debugModel) {
    console.log(`[model-debug:${branch}-chunk-before-ai]`, {
      rawChunkCount: rawChunk.length,
      ages: rawChunk.map((e) => e.age)
    });
  }

  const narratedChunk = await narrateChunkWithConcurrency(
    currentRun,
    world,
    rawChunk,
    narrativeCtx
  );

  if (debugModel) {
    console.log(`[model-debug:${branch}-chunk-after-ai]`, {
      narratedChunkCount: narratedChunk.length,
      sample: narratedChunk[0]?.summary?.slice(0, 80) ?? ""
    });
  }

  if (currentRun.nextMilestoneChoice) {
    let aiOptions = {
      background: "前路骤然分岔。",
      optionOverrides: [
        { id: "safe", label: "A", description: "稳步试探，低风险低收益。" },
        { id: "balanced", label: "B", description: "择机投入，中风险中收益。" },
        { id: "risky", label: "C", description: "孤注一掷，高风险高收益。" }
      ]
    };
    try {
      const milestoneCtx: NarrativeCallContext = {
        providerConfig,
        apiKey,
        usageScope: { sessionId, runId: currentRun.runId, worldId: currentRun.worldId },
        promptPack,
        worldlineSummary,
        factionSummary,
        eventPoolSummary,
        talentHookSummary,
        narrativePlan: buildNarrativePromptPlan(currentRun, narrativeWorld ?? null),
        conversation: currentRun.aiConversation?.milestone
      };
      if (!useConversationChain) {
        milestoneCtx.conversation = undefined;
      }
      aiOptions = await generateMilestoneOptions(currentRun, world, narratedChunk, milestoneCtx);
      currentRun.aiConversation = currentRun.aiConversation ?? {};
      currentRun.aiConversation.milestone = milestoneCtx.conversation;
    } catch {
      // fallback above
    }
    const optionMap = new Map(aiOptions.optionOverrides.map((o) => [o.id, o]));
    currentRun.nextMilestoneChoice.background = aiOptions.background;
    currentRun.nextMilestoneChoice.options = currentRun.nextMilestoneChoice.options.map((opt) => ({
      ...opt,
      label: optionMap.get(opt.id)?.label ?? opt.label,
      description: optionMap.get(opt.id)?.description ?? opt.description
    }));
  }

  const cutCount = rawChunk.length;
  currentRun.history = [
    ...currentRun.history.slice(0, currentRun.history.length - cutCount),
    ...narratedChunk
  ];

  if (currentRun.ended && !skipEndingNarrative) {
    try {
      const endingCtx: NarrativeCallContext = {
        ...narrativeCtx,
        narrativePlan: buildNarrativePromptPlan(currentRun, narrativeWorld ?? null),
        conversation: currentRun.aiConversation?.ending
      };
      if (!useConversationChain) {
        endingCtx.conversation = undefined;
      }
      const endingNarrative = await generateEndingNarrative(currentRun, world, endingCtx);
      currentRun.aiConversation = currentRun.aiConversation ?? {};
      currentRun.aiConversation.ending = endingCtx.conversation;
      if (endingNarrative.trim()) {
        currentRun.endingSummary = endingNarrative.trim();
      }
    } catch {
      // keep engine fallback ending summary
    }
  }

  currentRun.aiConversation = currentRun.aiConversation ?? {};
  currentRun.aiConversation.year = narrativeCtx.conversation;

  attachTimelineChunk(currentRun, world, narratedChunk);
  const timelineChunk = currentRun.timelineChunk ?? [];
  return { updatedRun: currentRun, timelineChunk };
}

function buildVisibleTimelineEntry(run: InternalRunState, world: WorldConfig, event: YearEvent): TimelineEntryItem {
  return toTimelineEntryForStream(run, event, world);
}

/**
 * Dynamic turns may settle several internal yearly events, but the reader sees
 * their single projected narrative entry. Publish that projection exactly once
 * before the reservoir can reveal any raw history.
 */
function publishTimelineChunk(
  run: InternalRunState,
  world: WorldConfig,
  chunk: YearEvent[]
): TimelineEntryChunk {
  attachTimelineChunk(run, world, chunk);
  const entries = run.timelineChunk ?? [];
  queueTimelineEntries(run, entries);
  return entries;
}

function revealOneEntryFromReservoir(
  run: InternalRunState,
  world: WorldConfig
): TimelineEntryItem | null {
  const queued = revealNextTimelineEntry(run);
  if (queued) return toPublicTimelineEntry(run, queued);
  const nextEvent = run.history[run.narrativeReservoir.revealedCount];
  if (!nextEvent) return null;
  const mapped = buildVisibleTimelineEntry(run, world, nextEvent);
  run.narrativeReservoir.revealedCount += 1;
  run.narrativeReservoir.revealedAge = mapped.age;
  run.narrativeReservoir.revealedAgeStage = resolveAgeStageForStream(mapped.age, world);
  return mapped;
}

function syncRunPhase(run: InternalRunState): void {
  if (run.survivalCrisis) {
    markRunPhase(run, "waiting_decision");
    return;
  }
  if (run.narrativeReservoir.queued.length > 0) {
    markRunPhase(run, "ready");
    return;
  }
  if (run.nextMilestoneChoice) {
    markRunPhase(run, "waiting_decision");
    return;
  }
  if (run.ended) {
    markRunPhase(run, "ended");
    return;
  }
  markRunPhase(run, "ready");
}

function resolveEventStoryDirection(
  run: InternalRunState,
  candidate: ReturnType<typeof buildDirectedEventCandidates>[number],
  directions: StoryDirectionDefinition[]
): StoryDirectionDefinition | undefined {
  const candidateIds = new Set(candidate.definition.storyDirectionIds ?? []);
  const active = run.story.activeDirectionId
    ? directions.find((direction) => direction.id === run.story.activeDirectionId)
    : undefined;
  if (active && candidateIds.has(active.id)) return active;
  return directions.find((direction) => candidateIds.has(direction.id));
}

interface DirectedNarrativeFocusMaterial {
  label: string;
  type: NarrativeComponentDefinition["type"];
  hint: string;
}

function narrativeComponentHint(
  definition: NarrativeComponentDefinition,
  status: InternalRunState["narrative"]["components"][number]["status"]
): string {
  if (status === "introduced") return definition.introHint;
  if (status === "active") return definition.activeHint;
  if (status === "escalated") return definition.escalationHint;
  return definition.payoffHint;
}

function resolveDirectedNarrativeFocus(
  run: InternalRunState,
  narrativeWorld: NarrativeWorldDefinition | null | undefined,
  componentId: string | undefined
): DirectedNarrativeFocusMaterial | undefined {
  if (!componentId) return undefined;
  const state = run.narrative.components.find((component) => component.id === componentId && component.status !== "resolved");
  const definition = narrativeWorld?.components?.find((component) => component.id === componentId);
  if (!state || !definition) return undefined;
  return {
    label: definition.label,
    type: definition.type,
    hint: narrativeComponentHint(definition, state.status)
  };
}

function buildBackgroundPassageFallback(run: InternalRunState, first: YearEvent, last: YearEvent): string {
  const rawAftermath = run.narrative.scene.aftermath.trim();
  const aftermath = rawAftermath && rawAftermath !== "无"
    ? rawAftermath
    : "此前的经历仍在日常中留下痕迹";
  return `${first.age}岁至${last.age}岁间，${aftermath}。你在日常奔忙中慢慢积累，也察觉有些事情尚未真正结束。`;
}

async function generateApprovedDirectedEnding(
  run: InternalRunState,
  world: WorldConfig,
  narrativeCtx: NarrativeCallContext,
  narrativeWorld?: NarrativeWorldDefinition | null
): Promise<void> {
  if (!run.ended || run.story.closureState !== "finished") return;

  run.aiConversation = run.aiConversation ?? {};
  const endingCtx: NarrativeCallContext = {
    ...narrativeCtx,
    // Ending is rendered only after the engine has locked its route and may use
    // that route's detailed world material.
    narrativePlan: buildNarrativePromptPlan(run, narrativeWorld ?? null),
    conversation: run.aiConversation.ending
  };
  try {
    const endingNarrative = await generateEndingNarrative(run, world, endingCtx);
    run.aiConversation.ending = endingCtx.conversation;
    if (endingNarrative.trim()) {
      run.endingSummary = endingNarrative.trim();
    }
  } catch {
    // Keep the engine-approved ending summary.
  }
}

interface DirectedSegmentOptions {
  run: InternalRunState;
  world: WorldConfig;
  difficulty: DifficultyConfig;
  sessionId: string;
  providerConfig: ProviderConfig;
  apiKey: string;
  promptPack: Record<string, string>;
  worldlineSummary: string;
  factionSummary: string;
  eventPoolSummary: string;
  talentHookSummary: string;
  eventDefinitions: Awaited<ReturnType<typeof loadEventDefinitions>>;
  itemDefinitions: Awaited<ReturnType<typeof loadItemDefinitions>>;
  storyDirections: StoryDirectionDefinition[];
  narrativeWorld?: NarrativeWorldDefinition | null;
}

interface OpeningGenerationOptions {
  run: InternalRunState;
  world: WorldConfig;
  narrativeWorld?: NarrativeWorldDefinition | null;
  sessionId: string;
  providerConfig: ProviderConfig;
  apiKey: string;
  promptPack: Record<string, string>;
  worldlineSummary: string;
  factionSummary: string;
  eventPoolSummary: string;
  talentHookSummary: string;
}

async function generateOpeningForRun(options: OpeningGenerationOptions): Promise<TurnRecord | undefined> {
  const {
    run,
    world,
    narrativeWorld,
    sessionId,
    providerConfig,
    apiKey,
    promptPack,
    worldlineSummary,
    factionSummary,
    eventPoolSummary,
    talentHookSummary
  } = options;
  if (!narrativeWorld || !run.narrative.enabled || run.narrative.opening?.status === "ready") return undefined;

  const narrativeCtx: NarrativeCallContext = {
    providerConfig,
    apiKey,
    usageScope: { sessionId, runId: run.runId, worldId: run.worldId },
    promptPack,
    worldlineSummary,
    factionSummary,
    eventPoolSummary,
    talentHookSummary,
    narrativePlan: buildNarrativePromptPlan(run, narrativeWorld, null),
    conversation: run.aiConversation?.year
  };
  let opening: Awaited<ReturnType<typeof generateNarrativeOrigin>>;
  try {
    opening = await generateNarrativeOrigin(run, world, narrativeCtx);
  } catch (error) {
    logNarrativeOutcomeFailure(options, error, "render_origin");
    throw error;
  }
  run.narrative = {
    ...run.narrative,
    opening: { status: "ready", profile: opening.profile }
  };
  run.aiConversation = run.aiConversation ?? {};
  run.aiConversation.year = narrativeCtx.conversation;
  return appendPublicTurnRecord(run, {
    entryId: "origin",
    age: 0,
    ageStage: { label: resolveAgeStageForStream(0, world).label },
    kind: "origin",
    narrative: opening.narrative,
    statChanges: {}
  });
}

async function generateDirectedSegmentForRun(options: DirectedSegmentOptions): Promise<GenerationOutput> {
  const runBeforeTurn = structuredClone(options.run);
  try {
    return await generateDirectedSegmentForRunUnsafe(options);
  } catch (error) {
    logNarrativeOutcomeFailure(options, error);
    Object.assign(options.run, runBeforeTurn);
    throw error;
  }
}

/*
 * Retired static director implementation. Dynamic world packages no longer
 * compile or invoke this EventDefinition candidate path; it is retained here
 * temporarily only as historical source context while the static content
 * authoring files are still used by non-narrative data tooling.
 *
async function generateStaticDirectedSegmentForRunUnsafe(options: DirectedSegmentOptions): Promise<GenerationOutput> {
  const {
    run,
    world,
    difficulty,
    sessionId,
    providerConfig,
    apiKey,
    promptPack,
    worldlineSummary,
    factionSummary,
    eventPoolSummary,
    talentHookSummary,
    eventDefinitions,
    itemDefinitions,
    storyDirections,
    narrativeWorld
  } = options;
  markRunPhase(run, "generating");
  const candidates = buildDirectedEventCandidates(
    run,
    world,
    difficulty,
    eventDefinitions,
    itemDefinitions,
    storyDirections,
    narrativeWorld
  );
  const narrativeCtx: NarrativeCallContext = {
    providerConfig,
    apiKey,
    usageScope: { sessionId, runId: run.runId, worldId: run.worldId },
    promptPack,
    worldlineSummary,
    factionSummary,
    eventPoolSummary,
    talentHookSummary,
    narrativePlan: buildNarrativePromptPlan(run, narrativeWorld ?? null, null),
    conversation: run.aiConversation?.year
  };
  // The readiness check may latch `mainlineCompleted` for a migrated or
  // freshly recovered run, so it must execute before we decide the tool set.
  const closureRequestEligible = canRequestDirectedClosure(run, narrativeWorld ?? null);
  const closureRequired = run.narrative.enabled && run.story.mainlineCompleted &&
    run.story.closureState === "open" && closureRequestEligible;
  const directionOptions = buildDirectedStoryDirections(candidates, storyDirections);
  const decisionDirections = candidates.some((candidate) => candidate.kind === "milestone")
    ? buildDirectedDecisionDirections(run, directionOptions, storyDirections)
    : undefined;
  const focusOptions = closureRequired ? [] : buildDirectedNarrativeComponentFocuses(run, candidates, narrativeWorld ?? null);
  const routeOptions = (narrativeWorld?.routeArcs ?? []).map((route) => ({
    id: route.directionId,
    label: route.label || route.directionId,
    summary: route.summary
  }));
  const allowedIntents: NarrativeIntent[] = closureRequired
    ? []
    : ["continue", "pressure", "payoff"];
  const canRequestClosure = closureRequired || closureRequestEligible;
  const rejectedRouteIds = new Set<string>();
  let turn: Awaited<ReturnType<typeof generateNarrativeTurn>>;
  let closureOutcome: ReturnType<typeof approveStoryClosure>;
  let approvedIntent: ReturnType<typeof approveStoryIntent>;
  let selectedDirection: StoryDirectionDefinition | undefined;
  let selected: ReturnType<typeof selectDirectedCandidateForIntent>;
  while (true) {
    const turnInput = {
      allowedIntents,
      routeOptions,
      focusOptions,
      allowClosureRequest: canRequestClosure,
      closureRequired,
      allowScenePacing: run.narrative.enabled && !run.narrative.activeScene && !closureRequired,
      rejectedRouteIds: Array.from(rejectedRouteIds)
    };
    turn = await generateNarrativeTurn({ run, world, input: turnInput, context: narrativeCtx });
    closureOutcome = approveStoryClosure(run, turn.closureRequest, narrativeWorld ?? null);
    approvedIntent = approveStoryIntent(run, allowedIntents, turn, focusOptions, routeOptions);
    const closureCandidates = closureOutcome === "guiding"
      ? buildDirectedEventCandidates(run, world, difficulty, eventDefinitions, itemDefinitions, storyDirections, narrativeWorld)
      : candidates;
    selectedDirection = approvedIntent.routeId
      ? storyDirections.find((direction) => direction.id === approvedIntent.routeId)
      : undefined;
    selected = closureOutcome === "guiding"
      ? closureCandidates.find((candidate) => candidate.definition.narrativeBeat === "ending")
      : selectedDirection
        ? selectDirectedCandidateForIntent(
          run,
          candidates,
          approvedIntent.intent,
          approvedIntent.focusComponentId,
          undefined,
          narrativeWorld,
          approvedIntent.routeId
        )
        : undefined;
    if (selected || closureOutcome === "guiding" || !approvedIntent.routeId) break;
    rejectedRouteIds.add(approvedIntent.routeId);
    if (rejectedRouteIds.size >= routeOptions.length) {
      throw new Error("directed_route_selection_exhausted");
    }
  }
  if (!selected) {
    markRunPhase(run, "ready");
    return { run, generatedChunk: [], fromAge: run.age, toAge: run.age, rawChunkCount: 0 };
  }
  const eventDirection = selectedDirection ?? resolveEventStoryDirection(run, selected, storyDirections);
  // A decision changes how the current experience is handled. It must not
  // silently select an unrelated life route simply because the option is risky.
  const selectedDecisionDirections = eventDirection
    ? { safe: eventDirection, balanced: eventDirection, risky: eventDirection }
    : decisionDirections;
  const focus = closureOutcome === "guiding"
    ? undefined
    : resolveDirectedNarrativeFocus(run, narrativeWorld, approvedIntent.focusComponentId);
  const decisionSeed = selected.kind === "milestone"
    ? createDirectedMilestoneChoice(run.age + 1, selected.definition, run.tuningSnapshot)
    : undefined;
  if (approvedIntent.routeId) {
    narrativeCtx.narrativePlan = buildNarrativePromptPlan(run, narrativeWorld ?? null, approvedIntent.routeId);
  }
  const rendered = await generateNarrativeRender({
    run,
    world,
    input: {
      kind: selected.kind,
      intent: approvedIntent.intent,
      eventId: selected.definition.id,
      eventTitle: selected.definition.title,
      premise: selected.definition.promptHook || selected.definition.title,
      outcomeHint: focus?.hint || "这件事会留下需要在后续面对的真实后果。",
      sceneHint: run.narrative.scene.conflict,
      focus: focus ? { label: focus.label, hint: focus.hint } : undefined,
      decision: decisionSeed ? {
        background: decisionSeed.background ?? (selected.definition.promptHook || selected.definition.title),
        options: decisionSeed.options.map((option) => ({
          id: option.id,
          label: option.label,
          description: option.description
        }))
      } : undefined,
      attributePolicy: selected.kind === "normal" && selected.definition.narrativeBeat !== "ending"
        ? getDirectedEventAttributePolicy(selected.definition)
        : undefined,
      turn
    },
    context: narrativeCtx
  });
  const advanced = advanceWithDirectedEvent(
    run,
    world,
    selected,
    rendered.narrative,
    eventDirection,
    selectedDecisionDirections,
    narrativeWorld ?? null,
    {
      attributeOutcome: rendered.attributeEffects ? { effects: rendered.attributeEffects } : undefined,
      attributePolicy: selected.kind === "normal" && selected.definition.narrativeBeat !== "ending"
        ? getDirectedEventAttributePolicy(selected.definition)
        : undefined,
      experienceId: approvedIntent.routeId,
      sceneClockMode: approvedIntent.scenePacing === "continuous" ? "hold" : approvedIntent.scenePacing === "spanning" ? "advance" : undefined,
      completeMainlineAct: selected.definition.narrativeBeat === "payoff" && Boolean(approvedIntent.routeId)
    }
  );
  applyDirectedMilestonePresentation(advanced.updated, rendered.milestoneCopy);
  const engineApprovedClosureBeat = selected.definition.narrativeBeat === "ending" &&
    run.story.closureState === "guiding";
  const settledClosureOutcome = engineApprovedClosureBeat
    ? approveStoryClosure(advanced.updated, "finish", narrativeWorld ?? null)
    : undefined;
  const settledEvent = advanced.chunk[0];
  recordDirectedStoryTurnOutcome(narrativeCtx, run, {
    kind: selected.kind,
    narrative: settledEvent?.summary ?? rendered.narrative,
    statChanges: settledEvent?.statChanges ?? selected.preview.statChanges,
    turn,
    toolResult: rendered.toolResult
  });
  run.aiConversation = run.aiConversation ?? {};
  run.aiConversation.year = narrativeCtx.conversation;
  if (settledClosureOutcome === "finished") {
    await generateApprovedDirectedEnding(run, world, narrativeCtx, narrativeWorld);
  }
  attachTimelineChunk(advanced.updated, world, advanced.chunk);
  const timelineChunk = advanced.updated.timelineChunk ?? [];
  return {
    run: advanced.updated,
    generatedChunk: timelineChunk,
    fromAge: advanced.fromAge,
    toAge: advanced.toAge,
    rawChunkCount: advanced.chunk.length
  };
}
*/

/**
 * The active director does not receive concrete event candidates. It receives
 * the complete world route catalog and composes one scene for the global act
 * beat. The engine approves only world data, facts, time and attributes.
 */
async function generateDirectedSegmentForRunUnsafe(options: DirectedSegmentOptions): Promise<GenerationOutput> {
  const {
    run,
    world,
    difficulty,
    sessionId,
    providerConfig,
    apiKey,
    promptPack,
    worldlineSummary,
    factionSummary,
    eventPoolSummary,
    talentHookSummary,
    narrativeWorld
  } = options;
  if (!narrativeWorld) throw new Error("narrative_world_required");
  markRunPhase(run, "generating");
  run.narrative = ensureNarrativeActRuntime(run.narrative, narrativeWorld, run.age);
  const narrativeCtx: NarrativeCallContext = {
    providerConfig,
    apiKey,
    usageScope: { sessionId, runId: run.runId, worldId: run.worldId },
    promptPack,
    worldlineSummary,
    factionSummary,
    eventPoolSummary,
    talentHookSummary,
    narrativePlan: buildNarrativePromptPlan(run, narrativeWorld, null),
    conversation: run.aiConversation?.year
  };
  const closureRequestEligible = canRequestDirectedClosure(run, narrativeWorld);
  if (run.story.mainlineCompleted && run.story.closureState === "open" && closureRequestEligible) {
    const turn = await generateNarrativeTurn({
      run,
      world,
      input: {
        allowedIntents: [],
        routeOptions: narrativeWorld.routeArcs.map((route) => ({ id: route.directionId, label: route.label || route.directionId, summary: route.summary })),
        allowClosureRequest: true,
        closureRequired: true,
        allowScenePacing: false
      },
      context: narrativeCtx
    });
    const closure = approveStoryClosure(run, turn.closureRequest, narrativeWorld);
    if (closure !== "guiding") throw new Error("story_closure_request_required");
    const finished = approveStoryClosure(run, "finish", narrativeWorld);
    if (finished !== "finished") throw new Error("story_closure_finish_unavailable");
    await generateApprovedDirectedEnding(run, world, narrativeCtx, narrativeWorld);
    run.aiConversation = run.aiConversation ?? {};
    run.aiConversation.year = narrativeCtx.conversation;
    return { run, generatedChunk: [], fromAge: run.age, toAge: run.age, rawChunkCount: 0 };
  }

  const runtime = run.narrative.actRuntime;
  const act = runtime ? narrativeWorld.mainlineActs?.find((item) => item.id === runtime.actId) : undefined;
  if (!runtime || !act) throw new Error("dynamic_world_act_unavailable");
  const factId = act.factId ?? act.introduceFactIds?.[0];
  const factLabel = factId ? narrativeWorld.mainlineFacts?.find((fact) => fact.id === factId)?.label : undefined;
  const narrativeSource = {
    worldId: run.worldId,
    age: run.age,
    personaPrompt: run.personaPrompt,
    stats: run.stats,
    fame: run.fame,
    history: run.history,
    tuning: run.tuningSnapshot,
    cards: run.cards,
    items: run.items,
    story: run.story,
    narrative: run.narrative
  };
  const earlyLife = isNarrativeEarlyLife(narrativeWorld, run.age);
  const canEnterAct = !earlyLife && isNarrativeMainlineActEntryReady(narrativeSource, narrativeWorld);
  const gateStage = runtime.beat === "escalation"
    ? "escalation"
    : runtime.beat === "pressure"
      ? "pressure"
      : runtime.beat === "climax"
        ? "climax"
        : undefined;
  const canAdvanceBeat = runtime.beat === "setup"
    ? canEnterAct
    : runtime.beat === "payoff" || !gateStage || isNarrativeWorldStageReady(narrativeSource, narrativeWorld, gateStage);
  const backgroundPacing = narrativeWorld.progression?.backgroundPacing ?? { minYears: 1, maxYears: 1 };
  const backgroundMinYears = Math.max(1, Math.trunc(backgroundPacing.minYears));
  const configuredBackgroundMaxYears = Math.max(backgroundMinYears, Math.trunc(backgroundPacing.maxYears));
  const earlyLifeMaxAge = narrativeWorld.opening?.earlyLife?.maxAge;
  const backgroundMaxYears = earlyLife && Number.isInteger(earlyLifeMaxAge)
    ? Math.max(1, Math.min(configuredBackgroundMaxYears, (earlyLifeMaxAge as number) - run.age))
    : configuredBackgroundMaxYears;
  const backgroundAttributePolicy = dynamicBackgroundAttributePolicy(run);
  const turnAges = resolveDynamicNarrativeTurnAges(run, {
    min: Math.min(backgroundMinYears, backgroundMaxYears),
    max: backgroundMaxYears
  });
  const decisionMode = earlyLife
    ? "none"
    : runtime.beat === "pressure" || runtime.beat === "climax"
    ? "required"
    : runtime.beat === "escalation"
      ? "optional"
      : "none";
  const recall = retrieveNarrativeMemories({
    worldId: run.worldId,
    age: run.age,
    personaPrompt: run.personaPrompt,
    stats: run.stats,
    fame: run.fame,
    history: run.history,
    tuning: run.tuningSnapshot,
    cards: run.cards,
    items: run.items,
    story: run.story,
    narrative: run.narrative
  }, { factIds: factId ? [factId] : [], text: `${act.prompt} ${run.narrative.scene.conflict}` });
  narrativeCtx.recentNarratives = recall;
  const scene = await generateDynamicNarrativeScene(run, world, {
    act: { id: act.id, label: act.label, prompt: act.prompt, factLabel },
    beat: runtime.beat,
    decisionMode,
    allowedTurnKinds: earlyLife
      ? ["background"]
      : runtime.beat === "setup"
        ? canEnterAct ? ["scene"] : ["background"]
        : canAdvanceBeat
          ? ["background", "scene"]
          : ["background"],
    sceneAge: turnAges.sceneAge,
    backgroundAgeRange: turnAges.backgroundAgeRange,
    routes: narrativeWorld.routeArcs.map((route) => ({
      id: route.directionId,
      label: route.label || route.directionId,
      summary: route.summary,
      perspective: route.perspective
    })),
    factions: (narrativeWorld.narrativeFactions ?? []).map((faction) => ({
      id: faction.id,
      label: faction.label,
      summary: faction.summary
    })),
    knownCharacters: run.narrative.dynamicCharacters
      .filter((character) => character.status === "active")
      .slice(-6)
      .map((character) => ({ id: character.id, name: character.name, factionId: character.factionId, role: character.role, description: character.description })),
    attributePolicy: runtime.beat === "pressure" || runtime.beat === "climax" ? undefined : dynamicSceneAttributePolicy(),
    backgroundAttributePolicy,
    statTiers: resolveNarrativeStatTiers(run.stats, run.narrative.statTierConfig),
    lifeStage: earlyLife && Number.isInteger(earlyLifeMaxAge)
      ? { label: "早年依赖期", maxAge: earlyLifeMaxAge as number }
      : undefined
  }, narrativeCtx);
  if (scene.turnKind === "background") {
    if (!scene.backgroundAttributeEffects) throw new Error("dynamic_background_outcome_missing");
    const backgroundYears = turnAges.backgroundAgeRange.toAge - run.age;
    const advanced = autoAdvanceToCheckpoint(run, world, difficulty, {
      targetYears: backgroundYears,
      maxTargetYears: backgroundMaxYears,
      allowRandomMilestone: false,
      deferNarrativeAttributeEffects: true,
      narrativeWorld
    });
    const outcomes = advanced.chunk.map((event) => ({
      age: event.age,
      effects: scene.backgroundAttributeEffects!
    }));
    const policiesByAge = new Map(advanced.chunk.map((event) => [event.age, backgroundAttributePolicy]));
    if (!settleNarrativeBackgroundOutcomes(run, world, outcomes, advanced.chunk.map((event) => event.age), policiesByAge, narrativeWorld)) {
      throw new Error("dynamic_background_outcome_rejected");
    }
    if (run.survivalCrisis) {
      const resolvedChunk = advanced.chunk.filter((event) => event.age <= run.age);
      advanced.chunk.splice(0, advanced.chunk.length, ...resolvedChunk);
      advanced.toAge = run.age;
    }
    advanced.chunk.forEach((event, index) => {
      event.summary = index === advanced.chunk.length - 1 ? scene.narrative : "";
    });
    recordDirectedStoryTurnOutcome(narrativeCtx, run, {
      kind: "normal",
      narrative: scene.narrative,
      statChanges: advanced.chunk.reduce<Partial<Record<keyof InternalRunState["stats"], number>>>((total, event) => {
        for (const [stat, value] of Object.entries(event.statChanges)) {
          const key = stat as keyof InternalRunState["stats"];
          total[key] = (total[key] ?? 0) + (value ?? 0);
        }
        return total;
      }, {})
    });
    run.aiConversation = run.aiConversation ?? {};
    run.aiConversation.year = narrativeCtx.conversation;
    const timelineChunk = publishTimelineChunk(advanced.updated, world, advanced.chunk);
    return {
      run: advanced.updated,
      generatedChunk: timelineChunk,
      fromAge: advanced.fromAge,
      toAge: advanced.toAge,
      rawChunkCount: advanced.chunk.length
    };
  }
  if (!scene.routeId) throw new Error("dynamic_scene_route_missing");
  const advanced = advanceWithDynamicNarrativeScene(run, world, narrativeWorld, {
    routeId: scene.routeId,
    factionId: scene.factionId,
    beat: runtime.beat,
    narrative: scene.narrative,
    participants: scene.participants,
    attributeOutcome: scene.attributeEffects ? { effects: scene.attributeEffects } : undefined,
    attributePolicy: runtime.beat === "pressure" || runtime.beat === "climax" ? undefined : dynamicSceneAttributePolicy(),
    actHandoff: scene.actHandoff,
    sceneClockMode: scene.scenePacing === "continuous" ? "hold" : scene.scenePacing === "spanning" ? "advance" : undefined,
    createsDecision: scene.createsDecision
  });
  applyDirectedMilestonePresentation(advanced.updated, scene.milestoneCopy);
  recordDirectedStoryTurnOutcome(narrativeCtx, run, {
    kind: scene.createsDecision ? "milestone" : "normal",
    narrative: scene.narrative,
    statChanges: advanced.chunk[0]?.statChanges ?? {}
  });
  run.aiConversation = run.aiConversation ?? {};
  run.aiConversation.year = narrativeCtx.conversation;
  const timelineChunk = publishTimelineChunk(advanced.updated, world, advanced.chunk);
  return {
    run: advanced.updated,
    generatedChunk: timelineChunk,
    fromAge: advanced.fromAge,
    toAge: advanced.toAge,
    rawChunkCount: advanced.chunk.length
  };
}

async function generateSegmentForRun(
  run: InternalRunState,
  world: WorldConfig,
  difficulty: DifficultyConfig,
  sessionId: string,
  providerConfig: ProviderConfig,
  apiKey: string,
  promptPack: Record<string, string>,
  worldlineSummary: string,
  factionSummary: string,
  eventPoolSummary: string,
  talentHookSummary: string,
  milestoneEventPool: string[],
  eventDefinitions: Awaited<ReturnType<typeof loadEventDefinitions>>,
  itemDefinitions: Awaited<ReturnType<typeof loadItemDefinitions>>,
  storyDirections: StoryDirectionDefinition[],
  narrativeWorld?: NarrativeWorldDefinition | null
): Promise<GenerationOutput> {
  if (run.ended) {
    markRunPhase(run, "ended");
    return {
      run,
      generatedChunk: [],
      fromAge: run.age,
      toAge: run.age,
      rawChunkCount: 0
    };
  }

  let rawChunk: YearEvent[] = [];
  let fromAge = run.age;
  let toAge = run.age;
  if (run.nextMilestoneChoice) {
    markRunPhase(run, "waiting_decision");
    return {
      run,
      generatedChunk: [],
      fromAge,
      toAge,
      rawChunkCount: 0
    };
  }

  const usesNarrativeDirector = Boolean(narrativeWorld && run.narrative.enabled && narrativeWorld.routeArcs.length > 0);
  if (usesNarrativeDirector && narrativeWorld) {
    run.narrative = ensureNarrativeActRuntime(run.narrative, narrativeWorld, run.age);
    if (run.narrative.opening?.status === "pending") {
      markRunPhase(run, "ready");
      return { run, generatedChunk: [], fromAge, toAge, rawChunkCount: 0 };
    }
    const runtime = run.narrative.actRuntime;
    if (runtime && (runtime.growthFocusOptions?.length ?? 0) > 0 && !runtime.growthFocusId) {
      markRunPhase(run, "ready");
      return { run, generatedChunk: [], fromAge, toAge, rawChunkCount: 0 };
    }
  }
  const useDirectedTurn = usesNarrativeDirector;
  if (usesNarrativeDirector) {
    // Refresh completion before background pacing so migrated saves that have
    // already resolved their mainline cannot receive one extra ordinary year.
    canRequestDirectedClosure(run, narrativeWorld ?? null);
    // Completion waits for the explicit closing tool request. It must never be
    // converted into a background passage merely because no normal event is
    // currently legal.
    if (run.story.mainlineCompleted && run.story.closureState === "open") {
      return generateDirectedSegmentForRun({
        run,
        world,
        difficulty,
        sessionId,
        providerConfig,
        apiKey,
        promptPack,
        worldlineSummary,
        factionSummary,
        eventPoolSummary,
        talentHookSummary,
        eventDefinitions,
        itemDefinitions,
        storyDirections,
        narrativeWorld
      });
    }
  }
  if (useDirectedTurn) {
    return generateDirectedSegmentForRun({
      run,
      world,
      difficulty,
      sessionId,
      providerConfig,
      apiKey,
      promptPack,
      worldlineSummary,
      factionSummary,
      eventPoolSummary,
      talentHookSummary,
      eventDefinitions,
      itemDefinitions,
      storyDirections,
      narrativeWorld
    });
  }

  markRunPhase(run, "generating");
  const advanced = autoAdvanceToCheckpoint(run, world, difficulty, { milestoneEventPool });
  rawChunk = advanced.chunk;
  fromAge = advanced.fromAge;
  toAge = advanced.toAge;

  const flow = await runYearFlow({
    branch: "start",
    rawChunk,
    currentRun: advanced.updated,
    sessionId,
    world,
    providerConfig,
    apiKey,
    promptPack,
    worldlineSummary,
    factionSummary,
    eventPoolSummary,
    talentHookSummary,
    narrativeWorld
  });

  queueTimelineEntries(flow.updatedRun, flow.timelineChunk);
  syncRunPhase(flow.updatedRun);
  return {
    run: flow.updatedRun,
    generatedChunk: flow.timelineChunk,
    fromAge,
    toAge,
    rawChunkCount: rawChunk.length
  };
}

async function runStartFlow(
  body: StartRunRequest,
  sessionId: string,
  hooks?: {
    onStarted?: (run: ReturnType<typeof toClientRun>) => Promise<void> | void;
    onTurn?: (record: TurnRecord) => Promise<void> | void;
  }
): Promise<StartFlowResult> {
  return withSessionLock(sessionId, () => runStartFlowUnlocked(body, sessionId, hooks));
}

async function runStartFlowUnlocked(
  body: StartRunRequest,
  sessionId: string,
  hooks?: {
    onStarted?: (run: ReturnType<typeof toClientRun>) => Promise<void> | void;
    onTurn?: (record: TurnRecord) => Promise<void> | void;
  }
): Promise<StartFlowResult> {
  const env = await getGameEnv(sessionId);
  if (!env) {
    throw new Error("missing_game_environment_config");
  }
  if (env.runtimeMode !== deployMode) {
    throw new Error("deploy_mode_env_mismatch");
  }

  const resources = await loadGameResources(body.worldId);
  const { content, runtime, worldline, factions, factionEvents, eventDefinitions, itemDefinitions, narrativeWorld } = resources;
  const tuning = resolveGameplayTuning(content);
  const allocation = toStartAllocationConfig(tuning);
  const world = resolveWorld(content.worlds, body.worldId);
  const difficulty = resolveDifficulty(content.difficulties, body.difficultyId);
  const milestoneEventPool = flattenMilestoneEventPool(factionEvents);

  await clearSessionRuns(sessionId);
  const run = createRun(
    {
      world,
      difficulty,
      cards: content.cards,
      tuning,
      narrativeEnabled: Boolean(narrativeWorld)
    },
    body
  );
  const providerConfig = resolveProviderConfig(env, runtime.cloud);
  const apiKey = resolveApiKey(env);
  if (debugModel) {
    console.log("[model-debug:start]", {
      deployMode,
      envRuntimeMode: env.runtimeMode,
      hasApiKey: Boolean(apiKey),
      baseUrl: providerConfig.baseUrl,
      model: providerConfig.model,
      apiPath: providerConfig.apiPath
    });
  }

  const worldlineSummary = summarizeWorldline(worldline);
  const factionSummary = summarizeFactions(factions);
  const eventPoolSummary = summarizeFactionEvents(factionEvents);
  const talentHookSummary = summarizeTalentHooks(run.cards);

  if (narrativeWorld) {
    run.narrative = ensureNarrativeActRuntime(run.narrative, narrativeWorld, run.age);
  }
  markRunPhase(run, "generating");
  await saveRun(run, sessionId);
  const startedRun = toClientRun(run);
  if (hooks?.onStarted) {
    await hooks.onStarted({
      ...startedRun,
      nextMilestoneChoice: undefined
    });
  }
  const timelineChunk: PublicTimelineEntry[] = [];
  try {
    const openingRecord = await generateOpeningForRun({
      run,
      world,
      narrativeWorld,
      sessionId,
      providerConfig,
      apiKey,
      promptPack: content.promptPack,
      worldlineSummary,
      factionSummary,
      eventPoolSummary,
      talentHookSummary
    });
    if (openingRecord && hooks?.onTurn) {
      await hooks.onTurn(openingRecord);
    }
  } catch (error) {
    markRunPhase(run, "ready");
    await saveRun(run, sessionId);
    throw error;
  }
  syncRunPhase(run);
  await saveRun(run, sessionId);
  return {
    updatedRun: run,
    timelineChunk,
    rawChunkCount: 0,
    fromAge: run.age,
    toAge: run.age,
    tuning: allocation
  };
}

interface StepFlowResult {
  updatedRun: InternalRunState;
  timelineChunk: PublicTimelineEntry[];
  rawChunkCount: number;
  fromAge: number;
  toAge: number;
  tuning: StartAllocationConfig;
  action: StepAction;
}

async function runStepFlow(
  body: StepRunRequest,
  sessionId: string,
  onTurn?: (record: TurnRecord, index: number, total: number) => Promise<void> | void
): Promise<StepFlowResult> {
  return withSessionLock(sessionId, () => withRunLock(body.runId, () => runStepFlowUnlocked(body, sessionId, onTurn)));
}

async function runStepFlowUnlocked(
  body: StepRunRequest,
  sessionId: string,
  onTurn?: (record: TurnRecord, index: number, total: number) => Promise<void> | void
): Promise<StepFlowResult> {
  const run = await getRun(body.runId) as InternalRunState | undefined;
  if (!run) {
    throw new Error("run_not_found");
  }

  const ownerSessionId = await getRunSessionId(body.runId);
  if (!ownerSessionId || ownerSessionId !== sessionId) {
    throw new Error("run_not_found");
  }
  const env = await getGameEnv(sessionId);
  if (!env) {
    throw new Error("missing_game_environment_config");
  }
  if (env.runtimeMode !== deployMode) {
    throw new Error("deploy_mode_env_mismatch");
  }

  const action: StepAction = body.action ?? (body.decision ? "decide" : "consume");
  if (hasPendingRequestId(run, body.requestId)) {
    const tuning = resolveGameplayTuning((await loadGameResources(run.worldId)).content);
    return {
      updatedRun: run,
      timelineChunk: [],
      rawChunkCount: 0,
      fromAge: run.age,
      toAge: run.age,
      tuning: toStartAllocationConfig(tuning),
      action
    };
  }
  const resources = await loadGameResources(run.worldId);
  const { content, runtime, worldline, factions, factionEvents, eventDefinitions, itemDefinitions, narrativeWorld } = resources;
  const tuning = resolveGameplayTuning(content);
  const allocation = toStartAllocationConfig(tuning);
  if (run.ended && run.narrativeReservoir.queued.length === 0) {
    markRunPhase(run, "ended");
    return { updatedRun: run, timelineChunk: [], rawChunkCount: 0, fromAge: run.age, toAge: run.age, tuning: allocation, action };
  }
  const world = resolveWorld(content.worlds, run.worldId);
  const difficulty = resolveDifficulty(content.difficulties, run.difficultyId);
  const milestoneEventPool = flattenMilestoneEventPool(factionEvents);

  if (action === "select_growth_focus") {
    if (!body.growthFocusId) throw new Error("growth_focus_required");
    if (run.narrative.opening?.status === "pending") throw new Error("opening_not_ready");
    run.narrative = selectNarrativeGrowthFocus(run.narrative, narrativeWorld, body.growthFocusId);
    syncRunPhase(run);
    rememberRequestId(run, body.requestId);
    await saveRun(run, sessionId);
    return {
      updatedRun: run,
      timelineChunk: [],
      rawChunkCount: 0,
      fromAge: run.age,
      toAge: run.age,
      tuning: allocation,
      action
    };
  }

  const providerConfig = resolveProviderConfig(env, runtime.cloud);
  const apiKey = resolveApiKey(env);
  if (debugModel) {
    console.log("[model-debug:step]", {
      deployMode,
      envRuntimeMode: env.runtimeMode,
      hasApiKey: Boolean(apiKey),
      baseUrl: providerConfig.baseUrl,
      model: providerConfig.model,
      apiPath: providerConfig.apiPath
    });
  }

  const worldlineSummary = summarizeWorldline(worldline);
  const factionSummary = summarizeFactions(factions);
  const eventPoolSummary = summarizeFactionEvents(factionEvents);
  const talentHookSummary = summarizeTalentHooks(run.cards);

  if (action === "generate_opening") {
    if (!narrativeWorld || !run.narrative.enabled) throw new Error("opening_unavailable");
    run.narrative = ensureNarrativeActRuntime(run.narrative, narrativeWorld, run.age);
    markRunPhase(run, "generating");
    let openingRecord: TurnRecord | undefined;
    try {
      openingRecord = await generateOpeningForRun({
        run,
        world,
        narrativeWorld,
        sessionId,
        providerConfig,
        apiKey,
        promptPack: content.promptPack,
        worldlineSummary,
        factionSummary,
        eventPoolSummary,
        talentHookSummary
      });
    } catch (error) {
      markRunPhase(run, "ready");
      await saveRun(run, sessionId);
      throw error;
    }
    syncRunPhase(run);
    rememberRequestId(run, body.requestId);
    await saveRun(run, sessionId);
    if (openingRecord && onTurn) await onTurn(openingRecord, 0, 1);
    return {
      updatedRun: run,
      timelineChunk: [],
      rawChunkCount: 0,
      fromAge: run.age,
      toAge: run.age,
      tuning: allocation,
      action
    };
  }
  let generatedChunk: TimelineEntryChunk = [];
  let fromAge = run.age;
  let toAge = run.age;
  let rawChunkCount = 0;
  let resolvedChoice: PublicMilestoneChoice | undefined;
  let resolvedChoiceOutcome: TurnRecord["choiceOutcome"] | undefined;

  if (action === "resolve_survival") {
    if (!body.survivalChoice) throw new Error("survival_choice_required");
    if (!run.survivalCrisis) throw new Error("survival_crisis_unavailable");
    // A rescue is a real branch: preserve the state immediately before the player commits.
    await createDecisionCheckpoint(sessionId, run);
    run.narrativeReservoir.queued = [];
    const resolution = resolveSurvivalCrisis(run, narrativeWorld, body.survivalChoice, body.survivalCrisisId);
    run.history.push(resolution.event);
    if (!resolution.recovered) {
      try {
        const endingCtx: NarrativeCallContext = {
          providerConfig,
          apiKey,
          usageScope: { sessionId, runId: run.runId, worldId: run.worldId },
          promptPack: content.promptPack,
          worldlineSummary,
          factionSummary,
          eventPoolSummary,
          talentHookSummary,
          narrativePlan: buildNarrativePromptPlan(run, narrativeWorld),
          conversation: run.aiConversation?.ending
        };
        const endingNarrative = await generateEndingNarrative(run, world, endingCtx);
        run.aiConversation = run.aiConversation ?? {};
        run.aiConversation.ending = endingCtx.conversation;
        if (endingNarrative.trim()) run.endingSummary = endingNarrative.trim();
      } catch {
        // The deterministic cause and engine ending remain valid when narration is unavailable.
      }
    }
    generatedChunk = publishTimelineChunk(run, world, [resolution.event]);
    fromAge = run.age;
    toAge = run.age;
    rawChunkCount = 1;
  } else if (action === "decide") {
    if (run.narrativeReservoir.queued.length > 0) {
      // Decision flow should render immediately; stale queued entries would block reveal order.
      run.narrativeReservoir.queued = [];
    }
    const decisionChoice = run.nextMilestoneChoice;
    if (!decisionChoice) {
      syncRunPhase(run);
      await saveRun(run, sessionId);
      return {
        updatedRun: run,
        timelineChunk: [],
        rawChunkCount: 0,
        fromAge: run.age,
        toAge: run.age,
        tuning: allocation,
        action
      };
    }
    if (typeof body.decisionAge === "number" && body.decisionAge !== decisionChoice.age) {
      syncRunPhase(run);
      await saveRun(run, sessionId);
      return {
        updatedRun: run,
        timelineChunk: [],
        rawChunkCount: 0,
        fromAge: run.age,
        toAge: run.age,
        tuning: allocation,
        action
      };
    }
    const publicChoice = toPublicMilestoneChoice(run);
    if (
      (body.sceneId && body.sceneId !== publicChoice?.sceneId) ||
      (typeof body.sceneRevision === "number" && body.sceneRevision !== publicChoice?.revision)
    ) {
      syncRunPhase(run);
      await saveRun(run, sessionId);
      return {
        updatedRun: run,
        timelineChunk: [],
        rawChunkCount: 0,
        fromAge: run.age,
        toAge: run.age,
        tuning: allocation,
        action
      };
    }
    if (!body.decision) {
      throw new Error("decision_required");
    }
    const resolvedDecision = resolvePublicDecisionOption(run, body.decision);
    if (!resolvedDecision) {
      syncRunPhase(run);
      await saveRun(run, sessionId);
      return {
        updatedRun: run,
        timelineChunk: [],
        rawChunkCount: 0,
        fromAge: run.age,
        toAge: run.age,
        tuning: allocation,
        action
      };
    }
    const wasDirectedMilestone = run.history[run.history.length - 1]?.tags.includes("director") === true;
    const usesStoryDirectionDecision = Boolean(run.pendingDirectedDecisionDirections || run.pendingDynamicScene);
    const selectedOption = decisionChoice.options.find((option) => option.id === resolvedDecision);
    resolvedChoice = publicChoice;
    resolvedChoiceOutcome = selectedOption ? {
      optionId: selectedOption.id,
      label: selectedOption.label,
      description: selectedOption.description
    } : undefined;
    await createDecisionCheckpoint(sessionId, run);
    let directedDecisionNarrative: string | undefined;
    let directedDecisionContext: NarrativeCallContext | undefined;
    let narrativeOutcome: { effects: import("@reroll/shared").NarrativeAttributeEffect[] } | undefined;
    let factResolution: import("@reroll/shared").NarrativeFactResolution | undefined;
    if (wasDirectedMilestone && usesStoryDirectionDecision) {
      const policy = getPendingDirectedDecisionPolicy(run, resolvedDecision);
      if (!policy) throw new Error("decision_outcome_policy_missing");
      directedDecisionContext = {
        providerConfig,
        apiKey,
        usageScope: { sessionId, runId: run.runId, worldId: run.worldId },
        promptPack: content.promptPack,
        worldlineSummary,
        factionSummary,
        eventPoolSummary,
        talentHookSummary,
        narrativePlan: buildNarrativePromptPlan(run, narrativeWorld),
        conversation: run.aiConversation?.year
      };
      const pendingDynamicScene = run.pendingDynamicScene;
      const activeAct = pendingDynamicScene
        ? narrativeWorld?.mainlineActs?.find((act) => act.id === pendingDynamicScene.mainlineActId)
        : undefined;
      const outcome = await generateDirectedDecisionNarrativeOutcome(run, world, {
        decision: resolvedDecision,
        label: selectedOption?.label ?? "已选抉择",
        description: selectedOption?.description ?? "人物作出了会改变后续处境的取舍。",
        attributePolicy: policy,
        factResolutionModes: pendingDynamicScene?.beat === "climax" ? activeAct?.resolutionModes : undefined
      }, directedDecisionContext);
      directedDecisionNarrative = outcome.narrative;
      narrativeOutcome = { effects: outcome.effects };
      factResolution = outcome.factResolution;
    }
    const stepped = applyMilestoneDecisionAndAdvance(
      run,
      world,
      difficulty,
      resolvedDecision,
      {
        milestoneEventPool,
        narrativeOutcome,
        factResolution,
        narrativeWorld
      }
    );
    resolveTurnRecordChoice(run, publicChoice, selectedOption);
    if (directedDecisionNarrative) {
      stepped.decisionEvent.summary = directedDecisionNarrative;
    }
    if (debugModel) {
      console.log("[model-debug:step-branch]", { branch: "decision", chunkCount: stepped.chunk.length });
    }
    if (wasDirectedMilestone && usesStoryDirectionDecision) {
      const closureCtx = directedDecisionContext!;
      recordDirectedDecisionOutcome(closureCtx, stepped.updated, {
        decision: resolvedDecision,
        label: selectedOption?.label ?? "已选抉择",
        narrative: directedDecisionNarrative ?? stepped.decisionEvent.summary
      });
      stepped.updated.aiConversation = stepped.updated.aiConversation ?? {};
      stepped.updated.aiConversation.year = closureCtx.conversation;
      generatedChunk = publishTimelineChunk(stepped.updated, world, stepped.chunk);
      fromAge = stepped.fromAge;
      toAge = stepped.toAge;
      rawChunkCount = stepped.chunk.length;
    } else {
      const flow = await runYearFlow({
        branch: "step",
        rawChunk: stepped.chunk,
        currentRun: stepped.updated,
        sessionId,
        world,
        providerConfig,
        apiKey,
        promptPack: content.promptPack,
        worldlineSummary,
        factionSummary,
        eventPoolSummary,
        talentHookSummary,
        narrativeWorld,
        skipEndingNarrative: providerConfig.directorMode !== "legacy"
      });
      generatedChunk = flow.timelineChunk;
      fromAge = stepped.fromAge;
      toAge = stepped.toAge;
      rawChunkCount = stepped.chunk.length;
    }
  } else if (run.narrativeReservoir.queued.length === 0 && !run.nextMilestoneChoice && !run.survivalCrisis && !run.ended) {
    const generated = await generateSegmentForRun(
      run,
      world,
      difficulty,
      sessionId,
      providerConfig,
      apiKey,
      content.promptPack,
      worldlineSummary,
      factionSummary,
      eventPoolSummary,
      talentHookSummary,
      milestoneEventPool,
      eventDefinitions,
      itemDefinitions,
      worldline?.storyDirections ?? [],
      narrativeWorld
    );
    generatedChunk = generated.generatedChunk;
    fromAge = generated.fromAge;
    toAge = generated.toAge;
    rawChunkCount = generated.rawChunkCount;
  }

  const timelineChunk: PublicTimelineEntry[] = [];
  const turnRecords: TurnRecord[] = [];
  const revealed = revealOneEntryFromReservoir(run, world);
  if (revealed) {
    timelineChunk.push(revealed);
    const pendingChoice = toPublicMilestoneChoice(run);
    turnRecords.push(appendPublicTurnRecord(
      run,
      revealed,
      resolvedChoice ?? (
        pendingChoice?.age === revealed.age
          ? pendingChoice
          : undefined
      ),
      resolvedChoiceOutcome
    ));
  }

  syncRunPhase(run);

  rememberRequestId(run, body.requestId);
  await saveRun(run, sessionId);
  if (onTurn) {
    for (const [index, record] of turnRecords.entries()) {
      await onTurn(record, index, turnRecords.length);
    }
  }
  return {
    updatedRun: run,
    timelineChunk,
    rawChunkCount: rawChunkCount || generatedChunk.length,
    fromAge,
    toAge,
    tuning: allocation,
    action
  };
}

app.get("/api/meta/bootstrap", async (_req, res) => {
  const [content, runtime] = await Promise.all([readContentBundle(), readRuntimeConfig()]);
  const { worlds, cards, difficulties } = content;
  const tuning = resolveGameplayTuning(content);
  const allocation = toStartAllocationConfig(tuning);

  const shuffled = [...cards].sort(() => Math.random() - 0.5);
  const cardPool = shuffled.slice(0, 6);
  const talentPointTotal = randomInt(tuning.bootstrap.talentPointMin, tuning.bootstrap.talentPointMax);

  res.json({
    deployMode,
    worlds: worlds.map((world) => ({ id: world.id, name: world.name, intro: world.intro })),
    difficulties: difficulties.map((difficulty) => ({
      id: difficulty.id,
      name: difficulty.name,
      description: difficulty.description
    })),
    cardPool: cardPool.map((card) => ({
      id: card.id,
      name: card.name,
      rarity: card.rarity,
      description: card.description,
      modifiers: card.modifiers
    })),
    talentPointTotal,
    startAllocation: allocation,
    runtime,
    limits: providerLimits
  });
});

app.post("/api/game/env", async (req, res) => {
  const parsed = gameEnvSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_game_environment", message: "本局环境配置无效，请重新检查。" });
  }

  const payload = parsed.data as GameEnvConfigRequest;
  const runtimeMode = deployMode;

  if (runtimeMode === "cloud" && payload.localApiKey) {
    return res.status(400).json({ error: "cloud_mode_disallows_local_key" });
  }
  if (runtimeMode === "local" && !payload.localApiKey?.trim()) {
    return res.status(400).json({ error: "local_mode_requires_local_key" });
  }

  const session = requireAnonymousSession(req);
  await saveGameEnv(session.id, {
    runtimeMode,
    localApiKey: payload.localApiKey,
    localProviderConfig: payload.localProviderConfig
  });

  const runtime = await readRuntimeConfig();
  const effectiveProvider = resolveProviderConfig(
    {
      runtimeMode,
      localProviderConfig: payload.localProviderConfig
    },
    runtime.cloud
  );

  return res.json({
    clientId: payload.clientId,
    runtimeMode,
    hasLocalApiKey: Boolean(payload.localApiKey?.trim()),
    effectiveProvider,
    limits: providerLimits
  });
});

async function currentGameRunPayload(sessionId: string): Promise<{
  run: ReturnType<typeof toClientRun> | null;
  timeline: TimelineEntryItem[];
  turns: TurnRecord[];
  environmentReady: boolean;
}> {
  const [run, env] = await Promise.all([getLatestRun(sessionId), getGameEnv(sessionId)]);
  const environmentReady = Boolean(env && (env.runtimeMode === "cloud" || env.localApiKey?.trim()));
  if (!run) {
    return { run: null, timeline: [], turns: [], environmentReady };
  }

  const { content } = await loadGameResources(run.worldId);
  const world = resolveWorld(content.worlds, run.worldId);
  const internalRun = run as InternalRunState;
  const hadTurnRecords = internalRun.turnRecords?.length ?? 0;
  const turns = ensureVisibleTurnRecords(internalRun, world);
  if (hadTurnRecords === 0 && turns.length > 0) {
    await saveRun(internalRun, sessionId);
  }
  return {
    run: toClientRun(internalRun),
    timeline: turns.map((turn) => ({
      entryId: turn.turnId,
      ageFrom: turn.ageFrom,
      age: turn.age,
      ageStage: turn.ageStage,
      kind: turn.kind,
      narrative: turn.narrative,
      statChanges: turn.statChanges
    })),
    turns,
    environmentReady
  };
}

app.get("/api/game/current", async (req, res) => {
  try {
    const session = requireAnonymousSession(req);
    return res.json(await currentGameRunPayload(session.id));
  } catch (error) {
    logGameFlowError("current", error);
    const publicError = toPublicGameError(error);
    return res.status(publicError.status).json({ error: publicError.code, message: publicError.message });
  }
});

app.get("/api/game/usage", async (req, res) => {
  try {
    const session = requireAnonymousSession(req);
    return res.json(await getModelUsageSummary(session.id));
  } catch (error) {
    logGameFlowError("model-usage", error);
    const publicError = toPublicGameError(error);
    return res.status(publicError.status).json({ error: publicError.code, message: publicError.message });
  }
});

app.get("/api/game/saves", async (req, res) => {
  try {
    const session = requireAnonymousSession(req);
    return res.json({ saves: await listSaveSlots(session.id) });
  } catch (error) {
    logGameFlowError("list-saves", error);
    const publicError = toPublicGameError(error);
    return res.status(publicError.status).json({ error: publicError.code, message: publicError.message });
  }
});

app.post("/api/game/saves", async (req, res) => {
  const parsed = createSaveSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_save_request", message: "存档参数无效，请稍后重试。" });
  }

  try {
    const session = requireAnonymousSession(req);
    const created = await withSessionLock(session.id, () => withRunLock(parsed.data.runId, async () => {
      const [run, ownerSessionId] = await Promise.all([
        getRun(parsed.data.runId),
        getRunSessionId(parsed.data.runId)
      ]);
      if (!run || ownerSessionId !== session.id) throw new Error("run_not_found");
      return createSaveSlot(session.id, run, parsed.data.title);
    }));
    return res.status(201).json(created);
  } catch (error) {
    logGameFlowError("create-save", error);
    const publicError = toPublicGameError(error);
    return res.status(publicError.status).json({ error: publicError.code, message: publicError.message });
  }
});

app.post("/api/game/saves/restore", async (req, res) => {
  const parsed = restoreSaveSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_save_request", message: "存档参数无效，请稍后重试。" });
  }

  let release: (() => void) | null = null;
  try {
    const session = requireAnonymousSession(req);
    release = await acquireGlobalFlowSlot();
    const payload = await withSessionLock(session.id, async () => {
      const restored = await restoreSaveSlot(session.id, parsed.data.saveId);
      if (!restored) throw new Error("save_not_found");
      return currentGameRunPayload(session.id);
    });
    return res.json(payload);
  } catch (error) {
    logGameFlowError("restore-save", error);
    const publicError = toPublicGameError(error);
    return res.status(publicError.status).json({ error: publicError.code, message: publicError.message });
  } finally {
    release?.();
  }
});

app.post("/api/game/saves/recover", async (req, res) => {
  const parsed = recoverSaveSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_recovery_code", message: "恢复码格式无效。" });
  }

  let release: (() => void) | null = null;
  try {
    const session = requireAnonymousSession(req);
    release = await acquireGlobalFlowSlot();
    const payload = await withSessionLock(session.id, async () => {
      const restored = await restoreSaveByRecoveryCode(session.id, parsed.data.recoveryCode);
      if (!restored) throw new Error("recovery_code_invalid");
      return currentGameRunPayload(session.id);
    });
    return res.json(payload);
  } catch (error) {
    logGameFlowError("recover-save", error);
    const publicError = toPublicGameError(error);
    return res.status(publicError.status).json({ error: publicError.code, message: publicError.message });
  } finally {
    release?.();
  }
});

app.post("/api/game/reset", async (req, res) => {
  let release: (() => void) | null = null;
  try {
    const session = requireAnonymousSession(req);
    release = await acquireGlobalFlowSlot();
    await withSessionLock(session.id, () => clearSessionRuns(session.id));
    return res.status(204).end();
  } catch (error) {
    logGameFlowError("reset-run", error);
    const publicError = toPublicGameError(error);
    return res.status(publicError.status).json({ error: publicError.code, message: publicError.message });
  } finally {
    release?.();
  }
});

app.post("/api/game/anonymous/reset", async (req, res) => {
  let release: (() => void) | null = null;
  try {
    const session = requireAnonymousSession(req);
    release = await acquireGlobalFlowSlot();
    await withSessionLock(session.id, () => resetAnonymousGameData(session.id));
    return res.status(204).end();
  } catch (error) {
    logGameFlowError("reset-anonymous-game-data", error);
    const publicError = toPublicGameError(error);
    return res.status(publicError.status).json({ error: publicError.code, message: publicError.message });
  } finally {
    release?.();
  }
});

app.delete("/api/game/saves/:saveId", async (req, res) => {
  try {
    const session = requireAnonymousSession(req);
    const deleted = await withSessionLock(session.id, () => deleteSaveSlot(session.id, req.params.saveId));
    if (!deleted) throw new Error("save_not_found");
    return res.status(204).end();
  } catch (error) {
    logGameFlowError("delete-save", error);
    const publicError = toPublicGameError(error);
    return res.status(publicError.status).json({ error: publicError.code, message: publicError.message });
  }
});

app.get("/api/admin/content", async (_req, res) => {
  if (deployMode === "cloud") {
    return res.status(403).json({ error: "cloud_mode_admin_locked" });
  }
  const content = await readContentBundle();
  res.json(content);
});

app.post("/api/admin/content", async (req, res) => {
  if (deployMode === "cloud") {
    return res.status(403).json({ error: "cloud_mode_admin_locked" });
  }
  const parsed = contentBundleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const payload = parsed.data as ContentBundle;
  const written = await writeContentBundle(payload);
  return res.json(written);
});

app.get("/api/admin/config", async (_req, res) => {
  if (deployMode === "cloud") {
    return res.status(403).json({ error: "cloud_mode_admin_locked" });
  }
  const runtime = await readRuntimeConfig();
  res.json({ runtime, limits: providerLimits });
});

app.post("/api/admin/config", async (req, res) => {
  if (deployMode === "cloud") {
    return res.status(403).json({ error: "cloud_mode_admin_locked" });
  }
  const parsed = adminConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const payload = parsed.data as AdminConfigPayload;
  const runtime = await writeRuntimeConfig(payload);
  return res.json({ runtime, limits: providerLimits });
});

app.post("/api/game/start", async (req, res) => {
  const parsed = startRunSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_start_request", message: "开局参数无效，请重新检查后开始。" });
  }

  const body = parsed.data as StartRunRequest;
  let release: (() => void) | null = null;
  try {
    const session = requireAnonymousSession(req);
    release = await acquireGlobalFlowSlot();
    const result = await runStartFlow(body, session.id);
    return res.json({
      run: toClientRun(result.updatedRun),
      timelineChunk: result.timelineChunk,
      turns: result.updatedRun.turnRecords,
      startAllocation: result.tuning
    });
  } catch (error) {
    logGameFlowError("start", error);
    const publicError = toPublicGameError(error);
    return res.status(publicError.status).json({ error: publicError.code, message: publicError.message });
  } finally {
    release?.();
  }
});

app.post("/api/game/step", async (req, res) => {
  const parsed = stepRunSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_step_request", message: "推进请求无效，请刷新后重试。" });
  }

  const body = parsed.data as StepRunRequest;
  let release: (() => void) | null = null;
  try {
    const session = requireAnonymousSession(req);
    release = await acquireGlobalFlowSlot();
    const result = await runStepFlow(body, session.id);
    return res.json({
      run: toClientRun(result.updatedRun),
      timelineChunk: result.timelineChunk,
      turns: result.updatedRun.turnRecords,
      startAllocation: result.tuning
    });
  } catch (error) {
    logGameFlowError("step", error);
    const publicError = toPublicGameError(error);
    return res.status(publicError.status).json({ error: publicError.code, message: publicError.message });
  } finally {
    release?.();
  }
});

app.post("/api/game/start/stream", async (req, res) => {
  const parsed = startRunSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_start_request", message: "开局参数无效，请重新检查后开始。" });
  }

  const body = parsed.data as StartRunRequest;
  const session = requireAnonymousSession(req);
  let release: (() => void) | null = null;
  try {
    release = await acquireGlobalFlowSlot();
  } catch (error) {
    logGameFlowError("start-stream-queue", error);
    const publicError = toPublicGameError(error);
    return res.status(publicError.status).json({ error: publicError.code, message: publicError.message });
  }
  initNdjsonResponse(res);
  try {
    const result = await runStartFlow(body, session.id, {
      onStarted: async (run) => {
        await writeNdjsonEvent(res, {
          type: "started",
          data: { run }
        });
      },
      onTurn: async (record) => {
        await writeNdjsonEvent(res, {
          type: "turn",
          data: { index: 0, total: 1, record }
        });
      }
    });

    await writeNdjsonEvent(res, {
      type: "meta",
      data: {
        branch: "start",
        runId: result.updatedRun.runId,
        rawChunkCount: result.rawChunkCount,
        fromAge: result.fromAge,
        toAge: result.toAge,
        tuning: result.tuning
      }
    });

    await writeNdjsonEvent(res, {
      type: "done",
      data: { run: toClientRun(result.updatedRun), timelineChunk: result.timelineChunk, turns: result.updatedRun.turnRecords }
    });
  } catch (error) {
    logGameFlowError("start-stream", error);
    const publicError = toPublicGameError(error);
    await writeNdjsonEvent(res, {
      type: "error",
      data: { message: publicError.message }
    });
  } finally {
    release?.();
    res.end();
  }
});

app.post("/api/game/step/stream", async (req, res) => {
  const parsed = stepRunSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_step_request", message: "推进请求无效，请刷新后重试。" });
  }

  const body = parsed.data as StepRunRequest;
  const session = requireAnonymousSession(req);
  let release: (() => void) | null = null;
  try {
    release = await acquireGlobalFlowSlot();
  } catch (error) {
    logGameFlowError("step-stream-queue", error);
    const publicError = toPublicGameError(error);
    return res.status(publicError.status).json({ error: publicError.code, message: publicError.message });
  }
  initNdjsonResponse(res);
  try {
    const result = await runStepFlow(body, session.id, async (record, index, total) => {
      await writeNdjsonEvent(res, {
        type: "turn",
        data: { index, total, record }
      });
    });

    await writeNdjsonEvent(res, {
      type: "meta",
      data: {
        branch: "step",
        runId: result.updatedRun.runId,
        rawChunkCount: result.rawChunkCount,
        fromAge: result.fromAge,
        toAge: result.toAge,
        tuning: result.tuning
      }
    });

    await writeNdjsonEvent(res, {
      type: "done",
      data: { run: toClientRun(result.updatedRun), timelineChunk: result.timelineChunk, turns: result.updatedRun.turnRecords }
    });
  } catch (error) {
    logGameFlowError("step-stream", error);
    const publicError = toPublicGameError(error);
    await writeNdjsonEvent(res, {
      type: "error",
      data: { message: publicError.message }
    });
  } finally {
    release?.();
    res.end();
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logGameFlowError(`unhandled:${req.method} ${req.path}`, error);
  if (req.path.startsWith("/api/game")) {
    if (!res.headersSent) {
      const publicError = toPublicGameError(error);
      res.status(publicError.status).json({ error: publicError.code, message: publicError.message });
    }
    return;
  }
  if (!res.headersSent) {
    res.status(500).json({ error: "server_unavailable" });
  }
});

async function startServer(): Promise<void> {
  try {
    await ensureStoreReady();
    app.listen(port, () => {
      console.log(`backend listening at http://localhost:${port}`);
    });
  } catch (error) {
    console.error("[anonymous-store:startup]", error);
    process.exitCode = 1;
  }
}

void startServer();

