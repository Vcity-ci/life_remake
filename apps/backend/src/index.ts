import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import seedrandom from "seedrandom";
import { once } from "node:events";
import path from "node:path";
import type {
  AgeThreshold,
  AdminConfigPayload,
  ContentBundle,
  DifficultyConfig,
  GameplayTuning,
  GameEnvConfigRequest,
  ProviderConfig,
  StartAllocationConfig,
  StartRunRequest,
  StepRunRequest,
  WorldConfig,
  YearEvent
} from "@reroll/shared";
import { createDefaultGameplayTuning } from "@reroll/shared";
import { generateEndingNarrative, generateMilestoneOptions, generateYearNarrative } from "./ai.js";
import { providerLimits } from "./constants.js";
import { getCloudApiKey, getDeployMode, readRuntimeConfig, writeRuntimeConfig } from "./config.js";
import {
  loadFactionEvents,
  loadFactions,
  loadTalentPromptHooks,
  loadWorldlineSetting,
  readContentBundle,
  writeContentBundle
} from "./content.js";
import {
  attachTimelineChunk,
  autoAdvanceToCheckpoint,
  applyMilestoneDecisionAndAdvance,
  createRun,
  toClientRun,
  type InternalRunState
} from "./engine.js";
import {
  adminConfigSchema,
  contentBundleSchema,
  gameEnvSchema,
  startRunSchema,
  stepRunSchema
} from "./schema.js";
import { getGameEnv, getRun, getRunClientId, saveGameEnv, saveRun } from "./store.js";

dotenv.config({
  path: path.join(process.cwd(), ".env")
});

const app = express();
const port = Number(process.env.PORT ?? "4000");
const deployMode = getDeployMode();
const debugModel = process.env.DEBUG_MODEL_CALLS === "1";
type NarrativeCallContext = Parameters<typeof generateYearNarrative>[3];
type TimelineEntryChunk = NonNullable<InternalRunState["timelineChunk"]>;
type TimelineEntryItem = TimelineEntryChunk[number];
type MilestoneChoicePayload = NonNullable<InternalRunState["nextMilestoneChoice"]>;
type StreamDonePayload = { run: ReturnType<typeof toClientRun>; timelineChunk: TimelineEntryChunk };
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
  | { type: "timeline"; data: { index: number; total: number; entry: TimelineEntryItem } }
  | { type: "milestone"; data: MilestoneChoicePayload }
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

const globalFlowConcurrency = 1;
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

function toBusyPayload(): { error: string; message: string } {
  return {
    error: "server_busy",
    message: "服务器繁忙，请稍后重试"
  };
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
    origin: process.env.CORS_ORIGIN ?? "http://localhost:5173"
  })
);
app.use(express.json({ limit: "2mb" }));

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

function toTimelineEntryForStream(event: YearEvent, world: WorldConfig): TimelineEntryItem {
  const titlePrefix = `${event.age}岁`;
  const normalizedTitle = event.title.startsWith(titlePrefix)
    ? event.title.slice(titlePrefix.length).replace(/^·/, "").trim()
    : event.title;
  return {
    age: event.age,
    ageStage: resolveAgeStageForStream(event.age, world),
    title: normalizedTitle,
    narrative: event.summary,
    tags: event.tags,
    statChanges: event.statChanges
  };
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
  };
  return [
    w.eraName ? `时代:${w.eraName}` : "",
    w.timeframe ? `时间:${w.timeframe}` : "",
    w.coreConflict ? `主冲突:${w.coreConflict}` : "",
    w.socialOrder ? `秩序:${w.socialOrder}` : "",
    w.taboos?.length ? `禁忌:${w.taboos.join("、")}` : ""
  ].filter(Boolean).join(" | ");
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

function summarizeFactionEvents(events: Array<{ factionId: string; events: string[] }>): string {
  return events
    .slice(0, 8)
    .map((x) => `${x.factionId}:${x.events.slice(0, 3).join("；")}`)
    .join(" | ");
}

function flattenMilestoneEventPool(events: Array<{ events: string[] }>): string[] {
  return events
    .flatMap((x) => x.events ?? [])
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function summarizeTalentHooks(
  selectedCardIds: string[],
  hooks: Array<{ id: string; name: string; promptHooks: { narrativeBias: string; eventAffinity: string[]; riskTone: string } }>
): string {
  const selected = hooks.filter((h) => selectedCardIds.includes(h.id));
  return selected
    .map((h) => `${h.name}:叙事=${h.promptHooks.narrativeBias};事件=${h.promptHooks.eventAffinity.join("/")};风险=${h.promptHooks.riskTone}`)
    .join(" | ");
}

interface GameResources {
  content: ContentBundle;
  runtime: Awaited<ReturnType<typeof readRuntimeConfig>>;
  worldline: Awaited<ReturnType<typeof loadWorldlineSetting>>;
  factions: Awaited<ReturnType<typeof loadFactions>>;
  factionEvents: Awaited<ReturnType<typeof loadFactionEvents>>;
  talentHooks: Awaited<ReturnType<typeof loadTalentPromptHooks>>;
}

async function loadGameResources(worldId: string): Promise<GameResources> {
  const [content, runtime, worldline, factions, factionEvents, talentHooks] = await Promise.all([
    readContentBundle(),
    readRuntimeConfig(),
    loadWorldlineSetting(worldId),
    loadFactions(),
    loadFactionEvents(worldId),
    loadTalentPromptHooks()
  ]);
  return {
    content,
    runtime,
    worldline,
    factions,
    factionEvents,
    talentHooks
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

function isLikelyBlankYearEvent(event: YearEvent): boolean {
  return event.title.includes("平年");
}

function isLikelyLowQualityNarrative(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return true;
  if (normalized.length < 18) return true;
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
  if (trimmed.length > 0 && !shouldForceBlankYearFallback) return trimmed;
  const rng = seedrandom(`${run.seed}:narrative-fallback:${event.age}`);
  return emptyNarrativeFallbacks[rng() < 0.5 ? 0 : 1];
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
  const baseRecentNarratives = run.history
    .slice(0, Math.max(0, run.history.length - chunk.length))
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
        narrative = await generateYearNarrative(run, world, event, narrativeCtx, {
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
  timelineChunk: TimelineEntryChunk;
  rawChunkCount: number;
  fromAge: number;
  toAge: number;
  tuning: StartAllocationConfig;
}

interface RunYearFlowOptions {
  branch: "start" | "step";
  rawChunk: YearEvent[];
  currentRun: InternalRunState;
  world: WorldConfig;
  providerConfig: ProviderConfig;
  apiKey: string;
  promptPack: Record<string, string>;
  worldlineSummary: string;
  factionSummary: string;
  eventPoolSummary: string;
  talentHookSummary: string;
  onTimeline?: (entry: TimelineEntryItem, index: number, total: number) => Promise<void> | void;
}

async function runYearFlow(options: RunYearFlowOptions): Promise<{ updatedRun: InternalRunState; timelineChunk: TimelineEntryChunk }> {
  const {
    branch,
    rawChunk,
    currentRun,
    world,
    providerConfig,
    apiKey,
    promptPack,
    worldlineSummary,
    factionSummary,
    eventPoolSummary,
    talentHookSummary,
    onTimeline
  } = options;

  const narrativeCtx: NarrativeCallContext = {
    providerConfig,
    apiKey,
    promptPack,
    worldlineSummary,
    factionSummary,
    eventPoolSummary,
    talentHookSummary
  };
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
    narrativeCtx,
    onTimeline
      ? async (event, index, total) => {
          const mapped = toTimelineEntryForStream(event, world);
          await onTimeline(mapped, index, total);
        }
      : undefined
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
      aiOptions = await generateMilestoneOptions(currentRun, world, narratedChunk, {
        providerConfig,
        apiKey,
        promptPack,
        worldlineSummary,
        factionSummary,
        eventPoolSummary,
        talentHookSummary
      });
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

  if (currentRun.ended) {
    try {
      const endingNarrative = await generateEndingNarrative(currentRun, world, narrativeCtx);
      if (endingNarrative.trim()) {
        currentRun.endingSummary = endingNarrative.trim();
      }
    } catch {
      // keep engine fallback ending summary
    }
  }

  attachTimelineChunk(currentRun, world, narratedChunk);
  const timelineChunk = currentRun.timelineChunk ?? [];
  return { updatedRun: currentRun, timelineChunk };
}

async function runStartFlow(
  body: StartRunRequest,
  hooks?: {
    onStarted?: (run: ReturnType<typeof toClientRun>) => Promise<void> | void;
    onTimeline?: (entry: TimelineEntryItem, index: number, total: number) => Promise<void> | void;
  }
): Promise<StartFlowResult> {
  const env = getGameEnv(body.clientId);
  if (!env) {
    throw new Error("missing_game_environment_config");
  }
  if (env.runtimeMode !== deployMode) {
    throw new Error("deploy_mode_env_mismatch");
  }

  const resources = await loadGameResources(body.worldId);
  const { content, runtime, worldline, factions, factionEvents, talentHooks } = resources;
  const tuning = resolveGameplayTuning(content);
  const allocation = toStartAllocationConfig(tuning);
  const world = resolveWorld(content.worlds, body.worldId);
  const difficulty = resolveDifficulty(content.difficulties, body.difficultyId);
  const milestoneEventPool = flattenMilestoneEventPool(factionEvents);

  const run = createRun(
    {
      world,
      difficulty,
      cards: content.cards,
      tuning
    },
    body
  );

  const advanced = autoAdvanceToCheckpoint(run, world, difficulty, { milestoneEventPool });
  const preNarrationRun = JSON.parse(JSON.stringify(advanced.updated)) as InternalRunState;
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
  const talentHookSummary = summarizeTalentHooks(body.selectedCardIds, talentHooks);

  if (hooks?.onStarted) {
    const startedRun = toClientRun(preNarrationRun);
    await hooks.onStarted({
      ...startedRun,
      nextMilestoneChoice: undefined
    });
  }

  const { updatedRun, timelineChunk } = await runYearFlow({
    branch: "start",
    rawChunk: advanced.chunk,
    currentRun: advanced.updated,
    world,
    providerConfig,
    apiKey,
    promptPack: content.promptPack,
    worldlineSummary,
    factionSummary,
    eventPoolSummary,
    talentHookSummary,
    onTimeline: hooks?.onTimeline
  });

  saveRun(updatedRun, body.clientId);
  return {
    updatedRun,
    timelineChunk,
    rawChunkCount: advanced.chunk.length,
    fromAge: advanced.fromAge,
    toAge: advanced.toAge,
    tuning: allocation
  };
}

interface StepFlowResult {
  updatedRun: InternalRunState;
  timelineChunk: TimelineEntryChunk;
  rawChunkCount: number;
  fromAge: number;
  toAge: number;
  tuning: StartAllocationConfig;
}

async function runStepFlow(
  body: StepRunRequest,
  onTimeline?: (entry: TimelineEntryItem, index: number, total: number) => Promise<void> | void
): Promise<StepFlowResult> {
  const run = getRun(body.runId) as InternalRunState | undefined;
  if (!run) {
    throw new Error("run_not_found");
  }

  const clientId = getRunClientId(body.runId);
  if (!clientId) {
    throw new Error("run_client_missing");
  }
  const env = getGameEnv(clientId);
  if (!env) {
    throw new Error("missing_game_environment_config");
  }
  if (env.runtimeMode !== deployMode) {
    throw new Error("deploy_mode_env_mismatch");
  }
  if (run.nextMilestoneChoice && !body.decision) {
    throw new Error("decision_required");
  }

  const resources = await loadGameResources(run.worldId);
  const { content, runtime, worldline, factions, factionEvents, talentHooks } = resources;
  const tuning = resolveGameplayTuning(content);
  const allocation = toStartAllocationConfig(tuning);
  if (run.ended) {
    return { updatedRun: run, timelineChunk: [], rawChunkCount: 0, fromAge: run.age, toAge: run.age, tuning: allocation };
  }
  const world = resolveWorld(content.worlds, run.worldId);
  const difficulty = resolveDifficulty(content.difficulties, run.difficultyId);
  const milestoneEventPool = flattenMilestoneEventPool(factionEvents);

  let updatedRun: InternalRunState;
  let rawChunk: YearEvent[] = [];
  let fromAge = run.age;
  let toAge = run.age;

  if (run.nextMilestoneChoice) {
    const stepped = applyMilestoneDecisionAndAdvance(
      run,
      world,
      difficulty,
      body.decision as "safe" | "balanced" | "risky",
      { milestoneEventPool }
    );
    updatedRun = stepped.updated;
    rawChunk = stepped.chunk;
    fromAge = stepped.fromAge;
    toAge = stepped.toAge;
    if (debugModel) {
      console.log("[model-debug:step-branch]", { branch: "decision", chunkCount: rawChunk.length });
    }
  } else {
    const advanced = autoAdvanceToCheckpoint(run, world, difficulty, { milestoneEventPool });
    updatedRun = advanced.updated;
    rawChunk = advanced.chunk;
    fromAge = advanced.fromAge;
    toAge = advanced.toAge;
    if (debugModel) {
      console.log("[model-debug:step-branch]", { branch: "advance", chunkCount: rawChunk.length });
    }
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
  const selectedCardIds = updatedRun.cards.map((c) => c.id);
  const talentHookSummary = summarizeTalentHooks(selectedCardIds, talentHooks);

  const flow = await runYearFlow({
    branch: "step",
    rawChunk,
    currentRun: updatedRun,
    world,
    providerConfig,
    apiKey,
    promptPack: content.promptPack,
    worldlineSummary,
    factionSummary,
    eventPoolSummary,
    talentHookSummary,
    onTimeline
  });

  saveRun(flow.updatedRun, clientId);
  return {
    updatedRun: flow.updatedRun,
    timelineChunk: flow.timelineChunk,
    rawChunkCount: rawChunk.length,
    fromAge,
    toAge,
    tuning: allocation
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
    worlds,
    difficulties,
    cardPool,
    talentPointTotal,
    startAllocation: allocation,
    runtime,
    limits: providerLimits
  });
});

app.post("/api/game/env", async (req, res) => {
  const parsed = gameEnvSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const payload = parsed.data as GameEnvConfigRequest;
  const runtimeMode = deployMode;

  if (runtimeMode === "cloud" && payload.localApiKey) {
    return res.status(400).json({ error: "cloud_mode_disallows_local_key" });
  }
  if (runtimeMode === "local" && !payload.localApiKey?.trim()) {
    return res.status(400).json({ error: "local_mode_requires_local_key" });
  }

  saveGameEnv(payload.clientId, {
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
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const body = parsed.data as StartRunRequest;
  let release: (() => void) | null = null;
  try {
    release = await acquireGlobalFlowSlot();
    const result = await runStartFlow(body);
    return res.json({
      run: toClientRun(result.updatedRun),
      timelineChunk: result.timelineChunk,
      startAllocation: result.tuning
    });
  } catch (error) {
    if (isServerBusyError(error)) {
      return res.status(503).json(toBusyPayload());
    }
    return res.status(400).json({ error: (error as Error).message || String(error) });
  } finally {
    release?.();
  }
});

app.post("/api/game/step", async (req, res) => {
  const parsed = stepRunSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const body = parsed.data as StepRunRequest;
  let release: (() => void) | null = null;
  try {
    release = await acquireGlobalFlowSlot();
    const result = await runStepFlow(body);
    return res.json({
      run: toClientRun(result.updatedRun),
      timelineChunk: result.timelineChunk,
      startAllocation: result.tuning
    });
  } catch (error) {
    if (isServerBusyError(error)) {
      return res.status(503).json(toBusyPayload());
    }
    const msg = (error as Error).message || String(error);
    if (msg === "run_not_found") return res.status(404).json({ error: msg });
    return res.status(400).json({ error: msg });
  } finally {
    release?.();
  }
});

app.post("/api/game/start/stream", async (req, res) => {
  const parsed = startRunSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const body = parsed.data as StartRunRequest;
  let release: (() => void) | null = null;
  try {
    release = await acquireGlobalFlowSlot();
  } catch (error) {
    if (isServerBusyError(error)) {
      return res.status(503).json(toBusyPayload());
    }
    return res.status(500).json({ error: (error as Error).message || String(error) });
  }
  initNdjsonResponse(res);
  try {
    const result = await runStartFlow(body, {
      onStarted: async (run) => {
        await writeNdjsonEvent(res, {
          type: "started",
          data: { run }
        });
      },
      onTimeline: async (entry, index, total) => {
        await writeNdjsonEvent(res, {
          type: "timeline",
          data: { index, total, entry }
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

    if (result.updatedRun.nextMilestoneChoice) {
      await writeNdjsonEvent(res, {
        type: "milestone",
        data: result.updatedRun.nextMilestoneChoice
      });
    }

    await writeNdjsonEvent(res, {
      type: "done",
      data: { run: toClientRun(result.updatedRun), timelineChunk: result.timelineChunk }
    });
  } catch (error) {
    if (isServerBusyError(error)) {
      await writeNdjsonEvent(res, {
        type: "error",
        data: { message: "server_busy" }
      });
      return;
    }
    await writeNdjsonEvent(res, {
      type: "error",
      data: { message: (error as Error).message || String(error) }
    });
  } finally {
    release?.();
    res.end();
  }
});

app.post("/api/game/step/stream", async (req, res) => {
  const parsed = stepRunSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const body = parsed.data as StepRunRequest;
  let release: (() => void) | null = null;
  try {
    release = await acquireGlobalFlowSlot();
  } catch (error) {
    if (isServerBusyError(error)) {
      return res.status(503).json(toBusyPayload());
    }
    return res.status(500).json({ error: (error as Error).message || String(error) });
  }
  initNdjsonResponse(res);
  try {
    const result = await runStepFlow(body, async (entry, index, total) => {
      await writeNdjsonEvent(res, {
        type: "timeline",
        data: { index, total, entry }
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

    if (result.updatedRun.nextMilestoneChoice) {
      await writeNdjsonEvent(res, {
        type: "milestone",
        data: result.updatedRun.nextMilestoneChoice
      });
    }

    await writeNdjsonEvent(res, {
      type: "done",
      data: { run: toClientRun(result.updatedRun), timelineChunk: result.timelineChunk }
    });
  } catch (error) {
    if (isServerBusyError(error)) {
      await writeNdjsonEvent(res, {
        type: "error",
        data: { message: "server_busy" }
      });
      return;
    }
    await writeNdjsonEvent(res, {
      type: "error",
      data: { message: (error as Error).message || String(error) }
    });
  } finally {
    release?.();
    res.end();
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`backend listening at http://localhost:${port}`);
});

