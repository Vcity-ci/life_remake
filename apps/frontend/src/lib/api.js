const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
export class ApiError extends Error {
    status;
    code;
    constructor(message, status, code) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.code = code;
    }
}
async function parseJson(res) {
    if (!res.ok) {
        const body = await res.text();
        let parsed = null;
        try {
            parsed = JSON.parse(body);
        }
        catch {
            parsed = null;
        }
        if (parsed) {
            const message = parsed.message?.trim() || parsed.error?.trim() || `HTTP ${res.status}`;
            throw new ApiError(message, res.status, parsed.error);
        }
        const fallback = body || `HTTP ${res.status}`;
        if (fallback.includes("\"error\":\"server_busy\"") || fallback.includes("服务器繁忙")) {
            throw new ApiError("服务器繁忙，请稍后重试", res.status, "server_busy");
        }
        throw new ApiError(fallback, res.status);
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
async function readNdjsonStream(res, onEvent) {
    if (!res.ok) {
        const body = await res.text();
        let parsed = null;
        try {
            parsed = JSON.parse(body);
        }
        catch {
            parsed = null;
        }
        if (parsed) {
            const message = parsed.message?.trim() || parsed.error?.trim() || `HTTP ${res.status}`;
            throw new ApiError(message, res.status, parsed.error);
        }
        const fallback = body || `HTTP ${res.status}`;
        if (fallback.includes("\"error\":\"server_busy\"") || fallback.includes("服务器繁忙")) {
            throw new ApiError("服务器繁忙，请稍后重试", res.status, "server_busy");
        }
        throw new ApiError(fallback, res.status);
    }
    if (!res.body) {
        throw new Error("stream_body_missing");
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
        const { value, done } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        while (true) {
            const newline = buffer.indexOf("\n");
            if (newline < 0)
                break;
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line)
                continue;
            const event = JSON.parse(line);
            await onEvent(event);
        }
    }
    const tail = buffer.trim();
    if (tail) {
        const event = JSON.parse(tail);
        await onEvent(event);
    }
}
export async function startRunStream(payload, onEvent) {
    const res = await fetch(`${API_BASE}/api/game/start/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    await readNdjsonStream(res, onEvent);
}
export async function stepRunStream(payload, onEvent) {
    const res = await fetch(`${API_BASE}/api/game/step/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    await readNdjsonStream(res, onEvent);
}
