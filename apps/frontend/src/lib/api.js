const API_BASE = "http://localhost:4000";
async function parseJson(res) {
    if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `HTTP ${res.status}`);
    }
    return (await res.json());
}
export async function fetchBootstrap() {
    const res = await fetch(`${API_BASE}/api/meta/bootstrap`);
    return parseJson(res);
}
export async function fetchAdminConfig() {
    const res = await fetch(`${API_BASE}/api/admin/config`);
    return parseJson(res);
}
export async function saveAdminConfig(payload) {
    const res = await fetch(`${API_BASE}/api/admin/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    return parseJson(res);
}
export async function fetchAdminContent() {
    const res = await fetch(`${API_BASE}/api/admin/content`);
    return parseJson(res);
}
export async function saveAdminContent(payload) {
    const res = await fetch(`${API_BASE}/api/admin/content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    return parseJson(res);
}
export async function saveGameEnvironment(payload) {
    const res = await fetch(`${API_BASE}/api/game/env`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    return parseJson(res);
}
export async function startRun(payload) {
    const res = await fetch(`${API_BASE}/api/game/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    return parseJson(res);
}
export async function stepRun(payload) {
    const res = await fetch(`${API_BASE}/api/game/step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    return parseJson(res);
}
