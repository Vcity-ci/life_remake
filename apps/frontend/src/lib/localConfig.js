const PROVIDER_KEY = "reroll_local_provider_config";
const CLIENT_ID_KEY = "reroll_client_id";
export function readLocalProviderConfig() {
    try {
        const raw = localStorage.getItem(PROVIDER_KEY);
        if (!raw)
            return null;
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export function writeLocalProviderConfig(config) {
    localStorage.setItem(PROVIDER_KEY, JSON.stringify(config));
}
export function getOrCreateClientId() {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing)
        return existing;
    const created = (globalThis.crypto?.randomUUID?.() ?? `cid_${Date.now()}_${Math.floor(Math.random() * 100000)}`);
    localStorage.setItem(CLIENT_ID_KEY, created);
    return created;
}
