import type {
  AdminConfigPayload,
  ContentBundle,
  DecisionType,
  DifficultyConfig,
  GameEnvConfigResponse,
  ProviderConfig,
  ProviderLimits,
  RunState,
  StartAllocationConfig,
  StartRunResponse,
  StepRunResponse,
  WorldConfig,
  BackgroundCard
} from "@reroll/shared";

const API_BASE = "http://localhost:4000";

export interface BootstrapPayload {
  deployMode: "local" | "cloud";
  worlds: WorldConfig[];
  difficulties: DifficultyConfig[];
  cardPool: BackgroundCard[];
  talentPointTotal: number;
  startAllocation: StartAllocationConfig;
  runtime: AdminConfigPayload["runtime"];
  limits: ProviderLimits;
}

export type GameStreamEvent =
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
  | {
      type: "started";
      data: { run: RunState };
    }
  | {
      type: "timeline";
      data: {
        index: number;
        total: number;
        entry: RunState["timelineChunk"] extends Array<infer T> ? T : never;
      };
    }
  | {
      type: "milestone";
      data: NonNullable<RunState["nextMilestoneChoice"]>;
    }
  | {
      type: "done";
      data: { run: RunState; timelineChunk: NonNullable<RunState["timelineChunk"]> };
    }
  | { type: "error"; data: { message: string } };

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchBootstrap(): Promise<BootstrapPayload> {
  const res = await fetch(`${API_BASE}/api/meta/bootstrap`);
  return parseJson<BootstrapPayload>(res);
}

export async function fetchAdminConfig(): Promise<{ runtime: AdminConfigPayload["runtime"]; limits: ProviderLimits }> {
  const res = await fetch(`${API_BASE}/api/admin/config`);
  return parseJson<{ runtime: AdminConfigPayload["runtime"]; limits: ProviderLimits }>(res);
}

export async function saveAdminConfig(payload: AdminConfigPayload): Promise<{ runtime: AdminConfigPayload["runtime"]; limits: ProviderLimits }> {
  const res = await fetch(`${API_BASE}/api/admin/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseJson<{ runtime: AdminConfigPayload["runtime"]; limits: ProviderLimits }>(res);
}

export async function fetchAdminContent(): Promise<ContentBundle> {
  const res = await fetch(`${API_BASE}/api/admin/content`);
  return parseJson<ContentBundle>(res);
}

export async function saveAdminContent(payload: ContentBundle): Promise<ContentBundle> {
  const res = await fetch(`${API_BASE}/api/admin/content`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseJson<ContentBundle>(res);
}

export async function saveGameEnvironment(payload: {
  clientId: string;
  localApiKey?: string;
  localProviderConfig?: ProviderConfig;
}): Promise<GameEnvConfigResponse> {
  const res = await fetch(`${API_BASE}/api/game/env`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseJson<GameEnvConfigResponse>(res);
}

export async function startRun(payload: {
  clientId: string;
  worldId: string;
  difficultyId: string;
  personaPrompt: string;
  talentPointTotal: number;
  stats: RunState["stats"];
  selectedCardIds: string[];
}): Promise<StartRunResponse> {
  const res = await fetch(`${API_BASE}/api/game/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseJson<StartRunResponse>(res);
}

export async function stepRun(payload: {
  runId: string;
  decision: DecisionType;
}): Promise<StepRunResponse> {
  const res = await fetch(`${API_BASE}/api/game/step`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseJson<StepRunResponse>(res);
}

async function readNdjsonStream(
  res: Response,
  onEvent: (event: GameStreamEvent) => void | Promise<void>
): Promise<void> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `HTTP ${res.status}`);
  }
  if (!res.body) {
    throw new Error("stream_body_missing");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line) as GameStreamEvent;
      await onEvent(event);
    }
  }
  const tail = buffer.trim();
  if (tail) {
    const event = JSON.parse(tail) as GameStreamEvent;
    await onEvent(event);
  }
}

export async function startRunStream(
  payload: {
    clientId: string;
    worldId: string;
    difficultyId: string;
    personaPrompt: string;
    talentPointTotal: number;
    stats: RunState["stats"];
    selectedCardIds: string[];
  },
  onEvent: (event: GameStreamEvent) => void | Promise<void>
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/game/start/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  await readNdjsonStream(res, onEvent);
}

export async function stepRunStream(
  payload: {
    runId: string;
    decision: DecisionType;
  },
  onEvent: (event: GameStreamEvent) => void | Promise<void>
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/game/step/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  await readNdjsonStream(res, onEvent);
}
