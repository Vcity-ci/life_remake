import "dotenv/config";
import cors from "cors";
import express from "express";
import seedrandom from "seedrandom";
import { once } from "node:events";
import type {
  AgeThreshold,
  AdminConfigPayload,
  ContentBundle,
  DifficultyConfig,
  GameEnvConfigRequest,
  ProviderConfig,
  StartRunRequest,
  StepRunRequest,
  WorldConfig,
  YearEvent
} from "@reroll/shared";
import { generateMilestoneOptions, generateYearNarrative } from "./ai.js";
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
      data: { branch: "start" | "step"; runId: string; rawChunkCount: number; fromAge: number; toAge: number };
    }
  | { type: "started"; data: { run: ReturnType<typeof toClientRun> } }
  | { type: "timeline"; data: { index: number; total: number; entry: TimelineEntryItem } }
  | { type: "milestone"; data: MilestoneChoicePayload }
  | { type: "done"; data: StreamDonePayload }
  | { type: "error"; data: { message: string } };
const narrativeConcurrency = (() => {
  const parsed = Number(process.env.NARRATIVE_CONCURRENCY ?? "2");
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(1, Math.min(4, Math.floor(parsed)));
})();

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

function summarizeFactions(factions: Array<{ name: string; values: string[]; behavior: string }>): string {
  return factions
    .map((f) => `${f.name}[${f.values.join("/")}]${f.behavior}`)
    .join(" | ");
}

function summarizeFactionEvents(events: Array<{ factionId: string; events: string[] }>): string {
  return events
    .map((x) => `${x.factionId}:${x.events.slice(0, 2).join("；")}`)
    .join(" | ");
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

const emptyNarrativeFallbacks = ["平平无奇的一年", "平凡但充实的一年"] as const;

function resolveNarrativeWithFallback(
  run: InternalRunState,
  event: { age: number },
  narrative: string
): string {
  const trimmed = narrative.trim();
  if (trimmed.length > 0) return trimmed;
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

  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= chunk.length) return;

      const event = chunk[index];
      let narrative = "";
      try {
        narrative = await generateYearNarrative(run, world, event, narrativeCtx);
      } catch {
        narrative = "";
      }
      narratedChunk[index] = {
        ...event,
        summary: resolveNarrativeWithFallback(run, event, narrative)
      };

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
  const world = resolveWorld(content.worlds, body.worldId);
  const difficulty = resolveDifficulty(content.difficulties, body.difficultyId);

  const run = createRun(
    {
      world,
      difficulty,
      cards: content.cards
    },
    body
  );

  const advanced = autoAdvanceToCheckpoint(run, world, difficulty);
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
    await hooks.onStarted(toClientRun(preNarrationRun));
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
    toAge: advanced.toAge
  };
}

interface StepFlowResult {
  updatedRun: InternalRunState;
  timelineChunk: TimelineEntryChunk;
  rawChunkCount: number;
  fromAge: number;
  toAge: number;
}

async function runStepFlow(
  body: StepRunRequest,
  onTimeline?: (entry: TimelineEntryItem, index: number, total: number) => Promise<void> | void
): Promise<StepFlowResult> {
  const run = getRun(body.runId) as InternalRunState | undefined;
  if (!run) {
    throw new Error("run_not_found");
  }
  if (run.ended) {
    return { updatedRun: run, timelineChunk: [], rawChunkCount: 0, fromAge: run.age, toAge: run.age };
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
  const world = resolveWorld(content.worlds, run.worldId);
  const difficulty = resolveDifficulty(content.difficulties, run.difficultyId);

  let updatedRun: InternalRunState;
  let rawChunk: YearEvent[] = [];
  let fromAge = run.age;
  let toAge = run.age;

  if (run.nextMilestoneChoice) {
    const stepped = applyMilestoneDecisionAndAdvance(
      run,
      world,
      difficulty,
      body.decision as "safe" | "balanced" | "risky"
    );
    updatedRun = stepped.updated;
    rawChunk = stepped.chunk;
    fromAge = stepped.fromAge;
    toAge = stepped.toAge;
    if (debugModel) {
      console.log("[model-debug:step-branch]", { branch: "decision", chunkCount: rawChunk.length });
    }
  } else {
    const advanced = autoAdvanceToCheckpoint(run, world, difficulty);
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
    toAge
  };
}

app.get("/api/meta/bootstrap", async (_req, res) => {
  const [content, runtime] = await Promise.all([readContentBundle(), readRuntimeConfig()]);
  const { worlds, cards, difficulties } = content;

  const shuffled = [...cards].sort(() => Math.random() - 0.5);
  const cardPool = shuffled.slice(0, 6);
  const talentPointTotal = 20 + Math.floor(Math.random() * 11);

  res.json({
    deployMode,
    worlds,
    difficulties,
    cardPool,
    talentPointTotal,
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
  const content = await readContentBundle();
  res.json(content);
});

app.post("/api/admin/content", async (req, res) => {
  const parsed = contentBundleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const payload = parsed.data as ContentBundle;
  const written = await writeContentBundle(payload);
  return res.json(written);
});

app.get("/api/admin/config", async (_req, res) => {
  const runtime = await readRuntimeConfig();
  res.json({ runtime, limits: providerLimits });
});

app.post("/api/admin/config", async (req, res) => {
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
  try {
    const result = await runStartFlow(body);
    return res.json({ run: toClientRun(result.updatedRun), timelineChunk: result.timelineChunk });
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message || String(error) });
  }
});

app.post("/api/game/step", async (req, res) => {
  const parsed = stepRunSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const body = parsed.data as StepRunRequest;
  try {
    const result = await runStepFlow(body);
    return res.json({ run: toClientRun(result.updatedRun), timelineChunk: result.timelineChunk });
  } catch (error) {
    const msg = (error as Error).message || String(error);
    if (msg === "run_not_found") return res.status(404).json({ error: msg });
    return res.status(400).json({ error: msg });
  }
});

app.post("/api/game/start/stream", async (req, res) => {
  const parsed = startRunSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const body = parsed.data as StartRunRequest;
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
        toAge: result.toAge
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
    await writeNdjsonEvent(res, {
      type: "error",
      data: { message: (error as Error).message || String(error) }
    });
  } finally {
    res.end();
  }
});

app.post("/api/game/step/stream", async (req, res) => {
  const parsed = stepRunSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const body = parsed.data as StepRunRequest;
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
        toAge: result.toAge
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
    await writeNdjsonEvent(res, {
      type: "error",
      data: { message: (error as Error).message || String(error) }
    });
  } finally {
    res.end();
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`backend listening at http://localhost:${port}`);
});

