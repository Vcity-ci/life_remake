import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ProviderConfig, SaveSlotSummary } from "@reroll/shared";
import type { InternalRunState } from "./engine.js";
import { resolveProjectRoot } from "./project-root.js";

interface StoredGameEnv {
  runtimeMode: "cloud" | "local";
  localApiKey?: string;
  localProviderConfig?: ProviderConfig;
}

export interface AnonymousSession {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

interface StoredRunRecord {
  sessionId: string;
  run: InternalRunState;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

interface StoredSaveSlot extends SaveSlotSummary {
  ownerSessionId: string;
  createdAt: number;
  expiresAt: number;
  recoveryHash: string;
  snapshot: InternalRunState;
}

interface PersistedAnonymousStore {
  version: 1;
  sessions: AnonymousSession[];
  runs: StoredRunRecord[];
  saves: StoredSaveSlot[];
  environments: Array<{
    sessionId: string;
    runtimeMode: "cloud" | "local";
    localProviderConfig?: ProviderConfig;
  }>;
}

const projectRoot = resolveProjectRoot(import.meta.url);
const storageDir = path.resolve(projectRoot, "storage");
const storePath = path.resolve(storageDir, "anonymous-game-store.json");
export const anonymousSessionTtlMs = daysToMs(process.env.ANONYMOUS_SESSION_TTL_DAYS, 30, 1, 90);
const RUN_TTL_MS = daysToMs(process.env.ANONYMOUS_RUN_TTL_DAYS, 7, 1, 30);
const SAVE_TTL_MS = daysToMs(process.env.ANONYMOUS_SAVE_TTL_DAYS, 180, 7, 365);
const MAX_SAVES_PER_SESSION = boundedInt(process.env.ANONYMOUS_SAVE_SLOT_LIMIT, 5, 1, 12);
const MAX_DECISION_CHECKPOINTS_PER_SESSION = 12;

const runs = new Map<string, StoredRunRecord>();
const sessions = new Map<string, AnonymousSession>();
const envBySession = new Map<string, StoredGameEnv>();
const saves = new Map<string, StoredSaveSlot>();
const runLocks = new Map<string, Promise<void>>();
const sessionLocks = new Map<string, Promise<void>>();
let loadPromise: Promise<void> | null = null;
let persistQueue: Promise<void> = Promise.resolve();

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function daysToMs(value: string | undefined, fallback: number, min: number, max: number): number {
  return boundedInt(value, fallback, min, max) * 24 * 60 * 60 * 1000;
}

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function makeSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function makeRecoveryCode(saveId: string): { code: string; hash: string } {
  const secret = randomBytes(24).toString("base64url");
  return { code: `${saveId}.${secret}`, hash: hashSecret(`${saveId}:${secret}`) };
}

function serializeStore(): PersistedAnonymousStore {
  return {
    version: 1,
    sessions: Array.from(sessions.values()),
    runs: Array.from(runs.values()),
    saves: Array.from(saves.values()),
    // API keys are deliberately process-only and never written to disk.
    environments: Array.from(envBySession.entries()).map(([sessionId, env]) => ({
      sessionId,
      runtimeMode: env.runtimeMode,
      localProviderConfig: env.localProviderConfig
    }))
  };
}

async function writeStore(): Promise<void> {
  await fs.mkdir(storageDir, { recursive: true });
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(serializeStore()), "utf8");
  await fs.rename(tempPath, storePath);
}

function queuePersist(): Promise<void> {
  const next = persistQueue.catch(() => undefined).then(writeStore);
  persistQueue = next;
  return next;
}

function isInternalRunState(value: unknown): value is InternalRunState {
  return Boolean(value && typeof value === "object" && typeof (value as { runId?: unknown }).runId === "string");
}

function cleanupExpired(now = Date.now()): boolean {
  let changed = false;
  for (const [id, session] of sessions) {
    if (session.expiresAt > now) continue;
    sessions.delete(id);
    envBySession.delete(id);
    changed = true;
  }
  for (const [runId, record] of runs) {
    if (record.expiresAt > now && sessions.has(record.sessionId)) continue;
    runs.delete(runId);
    runLocks.delete(runId);
    changed = true;
  }
  for (const [saveId, save] of saves) {
    if (save.expiresAt > now) continue;
    saves.delete(saveId);
    changed = true;
  }
  return changed;
}

async function loadStore(): Promise<void> {
  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedAnonymousStore>;
    if (parsed.version !== 1) return;
    for (const session of parsed.sessions ?? []) {
      if (!session?.id || !Number.isFinite(session.expiresAt)) continue;
      sessions.set(session.id, session);
    }
    for (const record of parsed.runs ?? []) {
      if (!record?.sessionId || !isInternalRunState(record.run) || !Number.isFinite(record.expiresAt)) continue;
      runs.set(record.run.runId, record);
    }
    for (const source of parsed.saves ?? []) {
      if (!source?.id || !source.ownerSessionId || !isInternalRunState(source.snapshot)) continue;
      const save: StoredSaveSlot = {
        ...source,
        kind: source.kind === "decision" ? "decision" : "manual",
        recoveryHash: source.recoveryHash ?? ""
      };
      saves.set(save.id, save);
    }
    for (const environment of parsed.environments ?? []) {
      if (!environment?.sessionId || !environment.runtimeMode) continue;
      envBySession.set(environment.sessionId, {
        runtimeMode: environment.runtimeMode,
        localProviderConfig: environment.localProviderConfig
      });
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code !== "ENOENT") console.error("[anonymous-store:load]", error);
  }
  if (cleanupExpired()) await writeStore();
}

export async function ensureStoreReady(): Promise<void> {
  if (!loadPromise) {
    loadPromise = loadStore().catch((error) => {
      loadPromise = null;
      throw error;
    });
  }
  await loadPromise;
}

export async function resolveAnonymousSession(rawToken?: string): Promise<{
  session: AnonymousSession;
  token?: string;
}> {
  await ensureStoreReady();
  const now = Date.now();
  const id = rawToken ? hashSecret(rawToken) : "";
  const existing = id ? sessions.get(id) : undefined;
  if (existing && existing.expiresAt > now) {
    existing.lastSeenAt = now;
    existing.expiresAt = now + anonymousSessionTtlMs;
    await queuePersist();
    return { session: existing };
  }

  const token = makeSessionToken();
  const session: AnonymousSession = {
    id: hashSecret(token),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + anonymousSessionTtlMs
  };
  sessions.set(session.id, session);
  await queuePersist();
  return { session, token };
}

export async function saveRun(run: InternalRunState, sessionId: string): Promise<void> {
  await ensureStoreReady();
  const now = Date.now();
  runs.set(run.runId, {
    sessionId,
    run,
    createdAt: runs.get(run.runId)?.createdAt ?? now,
    updatedAt: now,
    expiresAt: now + RUN_TTL_MS
  });
  await queuePersist();
}

export async function getRun(runId: string): Promise<InternalRunState | undefined> {
  await ensureStoreReady();
  const record = runs.get(runId);
  if (!record || record.expiresAt <= Date.now()) return undefined;
  return record.run;
}

export async function getRunSessionId(runId: string): Promise<string | undefined> {
  await ensureStoreReady();
  const record = runs.get(runId);
  if (!record || record.expiresAt <= Date.now()) return undefined;
  return record.sessionId;
}

export async function getLatestRun(sessionId: string): Promise<InternalRunState | undefined> {
  await ensureStoreReady();
  const now = Date.now();
  return Array.from(runs.values())
    .filter((record) => record.sessionId === sessionId && record.expiresAt > now)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.run;
}

export async function withRunLock<T>(runId: string, work: () => Promise<T>): Promise<T> {
  const previous = runLocks.get(runId) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  runLocks.set(runId, current);
  await previous;
  try {
    return await work();
  } finally {
    release?.();
    if (runLocks.get(runId) === current) runLocks.delete(runId);
  }
}

/** Serializes mutations for one anonymous game space without blocking other sessions. */
export async function withSessionLock<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
  const previous = sessionLocks.get(sessionId) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  sessionLocks.set(sessionId, current);
  await previous;
  try {
    return await work();
  } finally {
    release?.();
    if (sessionLocks.get(sessionId) === current) sessionLocks.delete(sessionId);
  }
}

export async function saveGameEnv(sessionId: string, env: StoredGameEnv): Promise<void> {
  await ensureStoreReady();
  envBySession.set(sessionId, env);
  await queuePersist();
}

export async function getGameEnv(sessionId: string): Promise<StoredGameEnv | undefined> {
  await ensureStoreReady();
  return envBySession.get(sessionId);
}

export async function createSaveSlot(
  sessionId: string,
  run: InternalRunState,
  title?: string
): Promise<{ save: SaveSlotSummary; recoveryCode: string }> {
  await ensureStoreReady();
  const owned = Array.from(saves.values())
    .filter((save) => save.ownerSessionId === sessionId && save.expiresAt > Date.now())
    .sort((a, b) => a.createdAt - b.createdAt);
  if (owned.length >= MAX_SAVES_PER_SESSION) throw new Error("save_limit_reached");

  const now = Date.now();
  const id = `save_${randomUUID()}`;
  const recovery = makeRecoveryCode(id);
  const save: StoredSaveSlot = {
    id,
    ownerSessionId: sessionId,
    title: title?.trim().slice(0, 40) || `${run.age}岁的人生记录`,
    worldId: run.worldId,
    age: run.age,
    ended: run.ended,
    kind: "manual",
    createdAt: now,
    updatedAt: now,
    expiresAt: now + SAVE_TTL_MS,
    recoveryHash: recovery.hash,
    snapshot: structuredClone(run)
  };
  saves.set(id, save);
  await queuePersist();
  return { save: toSaveSummary(save), recoveryCode: recovery.code };
}

/**
 * Decision checkpoints are local branch points, not user-created cloud saves.
 * They never consume the manual slot quota or expose a recovery code.
 */
export async function createDecisionCheckpoint(sessionId: string, run: InternalRunState): Promise<void> {
  await ensureStoreReady();
  const existing = Array.from(saves.values())
    .filter((save) => save.ownerSessionId === sessionId && save.kind === "decision" && save.expiresAt > Date.now())
    .sort((a, b) => a.createdAt - b.createdAt);
  while (existing.length >= MAX_DECISION_CHECKPOINTS_PER_SESSION) {
    const oldest = existing.shift();
    if (oldest) saves.delete(oldest.id);
  }

  const now = Date.now();
  const save: StoredSaveSlot = {
    id: `checkpoint_${randomUUID()}`,
    ownerSessionId: sessionId,
    title: `${run.age}岁·抉择前`,
    worldId: run.worldId,
    age: run.age,
    ended: false,
    kind: "decision",
    createdAt: now,
    updatedAt: now,
    expiresAt: now + SAVE_TTL_MS,
    recoveryHash: "",
    snapshot: structuredClone(run)
  };
  saves.set(save.id, save);
  await queuePersist();
}

export async function listSaveSlots(sessionId: string): Promise<SaveSlotSummary[]> {
  await ensureStoreReady();
  return Array.from(saves.values())
    .filter((save) => save.ownerSessionId === sessionId && save.expiresAt > Date.now())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(toSaveSummary);
}

export async function restoreSaveSlot(sessionId: string, saveId: string): Promise<InternalRunState | undefined> {
  await ensureStoreReady();
  const save = saves.get(saveId);
  if (!save || save.ownerSessionId !== sessionId || save.expiresAt <= Date.now()) return undefined;
  return restoreSnapshot(sessionId, save);
}

export async function restoreSaveByRecoveryCode(sessionId: string, recoveryCode: string): Promise<InternalRunState | undefined> {
  await ensureStoreReady();
  const [saveId, secret] = recoveryCode.trim().split(".", 2);
  if (!saveId || !secret) return undefined;
  const save = saves.get(saveId);
  if (!save || save.kind !== "manual" || save.expiresAt <= Date.now()) return undefined;
  const expected = Buffer.from(save.recoveryHash, "hex");
  const actual = Buffer.from(hashSecret(`${saveId}:${secret}`), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined;
  return restoreSnapshot(sessionId, save);
}

export async function deleteSaveSlot(sessionId: string, saveId: string): Promise<boolean> {
  await ensureStoreReady();
  const save = saves.get(saveId);
  if (!save || save.ownerSessionId !== sessionId) return false;
  saves.delete(saveId);
  await queuePersist();
  return true;
}

function toSaveSummary(save: StoredSaveSlot): SaveSlotSummary {
  return {
    id: save.id,
    title: save.title,
    worldId: save.worldId,
    age: save.age,
    ended: save.ended,
    updatedAt: save.updatedAt,
    kind: save.kind
  };
}

/** Clear active runs for this anonymous session while preserving all save slots. */
export async function clearSessionRuns(sessionId: string): Promise<void> {
  await ensureStoreReady();
  let changed = false;
  for (const [runId, record] of runs) {
    if (record.sessionId !== sessionId) continue;
    runs.delete(runId);
    runLocks.delete(runId);
    changed = true;
  }
  if (changed) await queuePersist();
}

/**
 * Clears all game data owned by an anonymous session while retaining its session and
 * local runtime environment. The latter keeps local model configuration available
 * after the player starts over.
 */
export async function resetAnonymousGameData(sessionId: string): Promise<void> {
  await ensureStoreReady();
  let changed = false;
  for (const [runId, record] of runs) {
    if (record.sessionId !== sessionId) continue;
    runs.delete(runId);
    runLocks.delete(runId);
    changed = true;
  }
  for (const [saveId, save] of saves) {
    if (save.ownerSessionId !== sessionId) continue;
    saves.delete(saveId);
    changed = true;
  }
  if (changed) await queuePersist();
}

async function restoreSnapshot(sessionId: string, save: StoredSaveSlot): Promise<InternalRunState> {
  const restored = structuredClone(save.snapshot);
  restored.runId = `run_restore_${randomUUID()}`;
  restored.narrativeReservoir.pendingRequestIds = [];
  // A session has one active life. The saved snapshot remains the durable
  // branch point; removing stale live records avoids timestamp-tie restores.
  await clearSessionRuns(sessionId);
  await saveRun(restored, sessionId);
  return restored;
}
