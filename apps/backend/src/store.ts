import type { ProviderConfig } from "@reroll/shared";
import type { InternalRunState } from "./engine.js";

interface StoredGameEnv {
  runtimeMode: "cloud" | "local";
  localApiKey?: string;
  localProviderConfig?: ProviderConfig;
}

const runs = new Map<string, InternalRunState>();
const runClient = new Map<string, string>();
const envByClient = new Map<string, StoredGameEnv>();

export function saveRun(run: InternalRunState, clientId: string): void {
  runs.set(run.runId, run);
  runClient.set(run.runId, clientId);
}

export function getRun(runId: string): InternalRunState | undefined {
  return runs.get(runId);
}

export function getRunClientId(runId: string): string | undefined {
  return runClient.get(runId);
}

export function clearAllRuns(): void {
  runs.clear();
  runClient.clear();
}

export function saveGameEnv(clientId: string, env: StoredGameEnv): void {
  envByClient.set(clientId, env);
}

export function getGameEnv(clientId: string): StoredGameEnv | undefined {
  return envByClient.get(clientId);
}

export function clearGameEnv(clientId: string): void {
  envByClient.delete(clientId);
}
