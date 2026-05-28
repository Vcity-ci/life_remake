import type { ProviderConfig } from "@reroll/shared";

const PROVIDER_KEY = "reroll_local_provider_config";
const CLIENT_ID_KEY = "reroll_client_id";

export function readLocalProviderConfig(): ProviderConfig | null {
  try {
    const raw = localStorage.getItem(PROVIDER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ProviderConfig;
  } catch {
    return null;
  }
}

export function writeLocalProviderConfig(config: ProviderConfig): void {
  localStorage.setItem(PROVIDER_KEY, JSON.stringify(config));
}

export function getOrCreateClientId(): string {
  const existing = localStorage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;
  const created = (globalThis.crypto?.randomUUID?.() ?? `cid_${Date.now()}_${Math.floor(Math.random() * 100000)}`);
  localStorage.setItem(CLIENT_ID_KEY, created);
  return created;
}
