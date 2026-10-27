import { randomUUID } from "node:crypto";
import type { NarrativeActOutline } from "@reroll/shared";
import type { InternalRunState } from "../engine.js";

export const ACT_TRANSITION_LIMIT = 2;

/** Called only by a committed mutation, never by state queries. */
export function prepareActRequest(run: InternalRunState, retry = false): string | undefined {
  const runtime = run.narrative.actRuntime;
  if (!runtime || runtime.outline || run.ended || run.story.mainlineCompleted || run.narrative.opening?.status !== "ready") return;
  if (runtime.preparation?.status === "failed" && !retry) return;
  const requestId = runtime.preparation?.status === "pending" ? runtime.preparation.requestId : randomUUID();
  runtime.preparation = { requestId, status: "pending", bufferedTurns: runtime.preparation?.bufferedTurns ?? 0 };
  return requestId;
}

export function actPreparationMode(run: InternalRunState): "ready" | "transition" | "waiting" | "failed" {
  const runtime = run.narrative.actRuntime;
  if (!runtime || runtime.outline) return "ready";
  if (runtime.preparation?.status === "failed") return "failed";
  return (runtime.preparation?.bufferedTurns ?? 0) < ACT_TRANSITION_LIMIT ? "transition" : "waiting";
}

export function recordActTransition(run: InternalRunState, actId: string): void {
  const runtime = run.narrative.actRuntime;
  if (runtime?.actId === actId && !runtime.outline && runtime.preparation?.status === "pending") runtime.preparation.bufferedTurns += 1;
}

/** Merge the card only. Everything committed while the model was running survives. */
export function applyActPreparationResult(run: InternalRunState, actId: string, requestId: string, outline?: NarrativeActOutline): boolean {
  const runtime = run.narrative.actRuntime;
  if (run.ended || run.story.mainlineCompleted || runtime?.actId !== actId || runtime.outline || runtime.preparation?.requestId !== requestId || runtime.preparation.status !== "pending") return false;
  if (outline) {
    if (outline.actId !== actId) return false;
    runtime.outline = structuredClone(outline);
  } else runtime.preparation.status = "failed";
  return true;
}

/** Owns process-local requests; persisted pending state is resumed explicitly after restart. */
export class ActPreparationJobs {
  private readonly jobs = new Map<string, Promise<void>>();

  start<T>(key: string, capture: () => Promise<T | undefined>, generate: (snapshot: T) => Promise<NarrativeActOutline>, commit: (outline?: NarrativeActOutline) => Promise<unknown>, onError: (error: unknown) => void = () => {}): Promise<void> {
    const existing = this.jobs.get(key);
    if (existing) return existing;
    const job = Promise.resolve().then(capture).then(async (snapshot) => {
      if (!snapshot) return;
      let outline: NarrativeActOutline;
      try { outline = await generate(snapshot); }
      catch (error) { onError(error); await commit(); return; }
      await commit(outline);
    }).catch(async (error) => {
      onError(error);
      try { await commit(); } catch (failure) { onError(failure); }
    }).finally(() => { if (this.jobs.get(key) === job) this.jobs.delete(key); });
    this.jobs.set(key, job);
    return job;
  }
}
