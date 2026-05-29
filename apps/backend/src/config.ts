import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AdminConfigPayload, RuntimeConfig } from "@reroll/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");
const storageDir = path.resolve(projectRoot, "storage");
const configPath = path.resolve(storageDir, "runtime-config.json");
const backupDir = path.resolve(storageDir, "backups");

function parseNum(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getDeployMode(): "local" | "cloud" {
  return process.env.DEPLOY_MODE === "cloud" ? "cloud" : "local";
}

export function getDefaultRuntimeConfig(): RuntimeConfig {
  const model = (process.env.DEFAULT_PROVIDER_MODEL ?? "gpt-4.1-mini").trim();
  return {
    runtimeMode: getDeployMode(),
    cloud: {
      provider: "openai-compatible",
      baseUrl: process.env.DEFAULT_PROVIDER_BASE_URL ?? "https://api.openai.com/v1",
      model: model && /[A-Za-z]/.test(model) ? model : "gpt-4.1-mini",
      apiPath: process.env.DEFAULT_PROVIDER_API_PATH ?? "/chat/completions",
      temperature: parseNum(process.env.DEFAULT_PROVIDER_TEMPERATURE, 0.9),
      maxTokens: parseNum(process.env.DEFAULT_PROVIDER_MAX_TOKENS, 420),
      timeoutMs: parseNum(process.env.DEFAULT_PROVIDER_TIMEOUT_MS, 45000)
    }
  };
}

export async function readRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as RuntimeConfig;
    return parsed;
  } catch {
    return getDefaultRuntimeConfig();
  }
}

export async function writeRuntimeConfig(payload: AdminConfigPayload): Promise<RuntimeConfig> {
  await fs.mkdir(storageDir, { recursive: true });
  const normalized: RuntimeConfig = {
    runtimeMode: payload.runtime.runtimeMode,
    cloud: {
      provider: "openai-compatible",
      baseUrl: payload.runtime.cloud.baseUrl.trim(),
      model: payload.runtime.cloud.model.trim(),
      apiPath: payload.runtime.cloud.apiPath.trim() || "/chat/completions",
      temperature: payload.runtime.cloud.temperature,
      maxTokens: payload.runtime.cloud.maxTokens,
      timeoutMs: payload.runtime.cloud.timeoutMs
    }
  };
  await fs.writeFile(configPath, JSON.stringify(normalized, null, 2), "utf8");
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await fs.writeFile(
    path.resolve(backupDir, `runtime-config-${stamp}.json`),
    JSON.stringify(normalized, null, 2),
    "utf8"
  );
  return normalized;
}

export function getCloudApiKey(): string {
  return process.env.CLOUD_MODEL_API_KEY?.trim() ?? "";
}

