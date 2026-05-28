import type {
  AdminConfigPayload,
  ContentBundle,
  DecisionType,
  DifficultyConfig,
  GameEnvConfigResponse,
  ProviderConfig,
  ProviderLimits,
  RunState,
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
  runtime: AdminConfigPayload["runtime"];
  limits: ProviderLimits;
}

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
