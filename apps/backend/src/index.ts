import "dotenv/config";
import cors from "cors";
import express from "express";
import type {
  AdminConfigPayload,
  ContentBundle,
  DifficultyConfig,
  GameEnvConfigRequest,
  ProviderConfig,
  StartRunRequest,
  StepRunRequest,
  WorldConfig
} from "@reroll/shared";
import { generateMilestoneOptions, generateYearNarrative } from "./ai.js";
import { providerLimits } from "./constants.js";
import { getCloudApiKey, getDeployMode, readRuntimeConfig, writeRuntimeConfig } from "./config.js";
import {
  loadCards,
  loadDifficulties,
  loadFactionEvents,
  loadFactions,
  loadPromptPack,
  loadTalentPromptHooks,
  loadWorldlineSetting,
  loadWorlds,
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

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? "http://localhost:5173"
  })
);
app.use(express.json({ limit: "2mb" }));

async function resolveWorld(worldId: string): Promise<WorldConfig> {
  const worlds = await loadWorlds();
  const found = worlds.find((w) => w.id === worldId);
  if (!found) {
    throw new Error("world_not_found");
  }
  return found;
}

async function resolveDifficulty(id: string): Promise<DifficultyConfig> {
  const list = await loadDifficulties();
  const found = list.find((d) => d.id === id);
  if (!found) {
    throw new Error("difficulty_not_found");
  }
  return found;
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

app.get("/api/meta/bootstrap", async (_req, res) => {
  const [worlds, cards, difficulties, runtime] = await Promise.all([
    loadWorlds(),
    loadCards(),
    loadDifficulties(),
    readRuntimeConfig()
  ]);

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
  const env = getGameEnv(body.clientId);
  if (!env) {
    return res.status(400).json({ error: "missing_game_environment_config" });
  }
  if (env.runtimeMode !== deployMode) {
    return res.status(400).json({ error: "deploy_mode_env_mismatch" });
  }

  let world: WorldConfig;
  let difficulty: DifficultyConfig;
  try {
    [world, difficulty] = await Promise.all([
      resolveWorld(body.worldId),
      resolveDifficulty(body.difficultyId)
    ]);
  } catch (error) {
    return res.status(400).json({ error: String(error) });
  }

  const [cards, runtime, promptPack, worldline, factions, factionEvents, talentHooks] = await Promise.all([
    loadCards(),
    readRuntimeConfig(),
    loadPromptPack(),
    loadWorldlineSetting(body.worldId),
    loadFactions(),
    loadFactionEvents(body.worldId),
    loadTalentPromptHooks()
  ]);

  const run = createRun(
    {
      world,
      difficulty,
      cards
    },
    body
  );

  const advanced = autoAdvanceToCheckpoint(run, world, difficulty);
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

  const narratedChunk: typeof advanced.chunk = [];
  if (debugModel) {
    console.log("[model-debug:start-chunk-before-ai]", {
      rawChunkCount: advanced.chunk.length,
      ages: advanced.chunk.map((e) => e.age)
    });
  }
  for (const event of advanced.chunk) {
    let narrative = "";
    try {
      narrative = await generateYearNarrative(advanced.updated, world, event, {
        providerConfig,
        apiKey,
        promptPack,
        worldlineSummary,
        factionSummary,
        eventPoolSummary,
        talentHookSummary
      });
    } catch {
      narrative = "";
    }
    if (narrative.trim().length > 0) {
      narratedChunk.push({
        ...event,
        summary: narrative
      });
    }
  }
  if (debugModel) {
    console.log("[model-debug:start-chunk-after-ai]", {
      narratedChunkCount: narratedChunk.length,
      sample: narratedChunk[0]?.summary?.slice(0, 80) ?? ""
    });
  }

  if (advanced.updated.nextMilestoneChoice) {
    let aiOptions = {
      background: "前路骤然分岔。",
      optionOverrides: [
        { id: "safe", label: "A", description: "稳步试探，低风险低收益。" },
        { id: "balanced", label: "B", description: "择机投入，中风险中收益。" },
        { id: "risky", label: "C", description: "孤注一掷，高风险高收益。" }
      ]
    };
    try {
      aiOptions = await generateMilestoneOptions(advanced.updated, world, narratedChunk, {
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
    advanced.updated.nextMilestoneChoice.background = aiOptions.background;
    advanced.updated.nextMilestoneChoice.options = advanced.updated.nextMilestoneChoice.options.map((opt) => ({
      ...opt,
      label: optionMap.get(opt.id)?.label ?? opt.label,
      description: optionMap.get(opt.id)?.description ?? opt.description
    }));
  }

  const cutCount = advanced.chunk.length;
  advanced.updated.history = [
    ...advanced.updated.history.slice(0, advanced.updated.history.length - cutCount),
    ...narratedChunk
  ];

  attachTimelineChunk(advanced.updated, world, narratedChunk);
  const timelineChunk = advanced.updated.timelineChunk ?? [];
  saveRun(advanced.updated, body.clientId);

  return res.json({ run: toClientRun(advanced.updated), timelineChunk });
});

app.post("/api/game/step", async (req, res) => {
  const parsed = stepRunSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const body = parsed.data as StepRunRequest;
  const run = getRun(body.runId) as InternalRunState | undefined;
  if (!run) {
    return res.status(404).json({ error: "run_not_found" });
  }

  if (run.ended) {
    return res.json({ run: toClientRun(run) });
  }

  const clientId = getRunClientId(body.runId);
  if (!clientId) {
    return res.status(400).json({ error: "run_client_missing" });
  }
  const env = getGameEnv(clientId);
  if (!env) {
    return res.status(400).json({ error: "missing_game_environment_config" });
  }
  if (env.runtimeMode !== deployMode) {
    return res.status(400).json({ error: "deploy_mode_env_mismatch" });
  }

  if (run.nextMilestoneChoice && !body.decision) {
    return res.status(400).json({ error: "decision_required" });
  }

  let world: WorldConfig;
  let difficulty: DifficultyConfig;
  try {
    [world, difficulty] = await Promise.all([
      resolveWorld(run.worldId),
      resolveDifficulty(run.difficultyId)
    ]);
  } catch (error) {
    return res.status(400).json({ error: String(error) });
  }

  const [runtime, promptPack, worldline, factions, factionEvents, talentHooks] = await Promise.all([
    readRuntimeConfig(),
    loadPromptPack(),
    loadWorldlineSetting(run.worldId),
    loadFactions(),
    loadFactionEvents(run.worldId),
    loadTalentPromptHooks()
  ]);

  let updatedRun: InternalRunState;
  let rawChunk: typeof run.history = [];

  if (run.nextMilestoneChoice) {
    const stepped = applyMilestoneDecisionAndAdvance(
      run,
      world,
      difficulty,
      body.decision as "safe" | "balanced" | "risky"
    );
    updatedRun = stepped.updated;
    rawChunk = stepped.chunk;
    if (debugModel) {
      console.log("[model-debug:step-branch]", { branch: "decision", chunkCount: rawChunk.length });
    }
  } else {
    const advanced = autoAdvanceToCheckpoint(run, world, difficulty);
    updatedRun = advanced.updated;
    rawChunk = advanced.chunk;
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

  const narratedChunk: typeof rawChunk = [];
  if (debugModel) {
    console.log("[model-debug:step-chunk-before-ai]", {
      rawChunkCount: rawChunk.length,
      ages: rawChunk.map((e) => e.age)
    });
  }
  for (const event of rawChunk) {
    let narrative = "";
    try {
      narrative = await generateYearNarrative(updatedRun, world, event, {
        providerConfig,
        apiKey,
        promptPack,
        worldlineSummary,
        factionSummary,
        eventPoolSummary,
        talentHookSummary
      });
    } catch {
      narrative = "";
    }
    if (narrative.trim().length > 0) {
      narratedChunk.push({
        ...event,
        summary: narrative
      });
    }
  }
  if (debugModel) {
    console.log("[model-debug:step-chunk-after-ai]", {
      narratedChunkCount: narratedChunk.length,
      sample: narratedChunk[0]?.summary?.slice(0, 80) ?? ""
    });
  }

  if (updatedRun.nextMilestoneChoice) {
    let aiOptions = {
      background: "前路骤然分岔。",
      optionOverrides: [
        { id: "safe", label: "A", description: "稳步试探，低风险低收益。" },
        { id: "balanced", label: "B", description: "择机投入，中风险中收益。" },
        { id: "risky", label: "C", description: "孤注一掷，高风险高收益。" }
      ]
    };
    try {
      aiOptions = await generateMilestoneOptions(updatedRun, world, narratedChunk, {
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
    updatedRun.nextMilestoneChoice.background = aiOptions.background;
    updatedRun.nextMilestoneChoice.options = updatedRun.nextMilestoneChoice.options.map((opt) => ({
      ...opt,
      label: optionMap.get(opt.id)?.label ?? opt.label,
      description: optionMap.get(opt.id)?.description ?? opt.description
    }));
  }

  const cutCount = rawChunk.length;
  updatedRun.history = [
    ...updatedRun.history.slice(0, updatedRun.history.length - cutCount),
    ...narratedChunk
  ];

  attachTimelineChunk(updatedRun, world, narratedChunk);
  const timelineChunk = updatedRun.timelineChunk ?? [];
  saveRun(updatedRun, clientId);

  return res.json({ run: toClientRun(updatedRun), timelineChunk });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`backend listening at http://localhost:${port}`);
});
