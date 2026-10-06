import type { NarrativeRunState, NarrativeStageTask } from "@reroll/shared";

export function normalizeNarrativeStageTask(value: unknown): NarrativeStageTask | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const goal = typeof raw.goal === "string" ? raw.goal.trim() : "";
  const completionMeaning = typeof raw.completionMeaning === "string" ? raw.completionMeaning.trim() : "";
  if (!goal || !completionMeaning) return undefined;
  if (raw.fork === undefined) return { goal, completionMeaning };
  if (!raw.fork || typeof raw.fork !== "object" || Array.isArray(raw.fork)) return undefined;
  const fork = raw.fork as Record<string, unknown>;
  const question = typeof fork.question === "string" ? fork.question.trim() : "";
  const stakes = typeof fork.stakes === "string" ? fork.stakes.trim() : "";
  const openingSituation = typeof fork.openingSituation === "string" ? fork.openingSituation.trim() : "";
  return question && stakes && openingSituation
    ? { goal, completionMeaning, fork: { question, stakes, openingSituation } }
    : undefined;
}

/** Called inside the existing successful-round transaction, before beat advancement. */
export function commitNarrativeStageTask(
  state: NarrativeRunState,
  scope: { actId: string; beat: string },
  task: NarrativeStageTask | undefined
): void {
  const runtime = state.actRuntime;
  if (task && runtime?.actId === scope.actId && runtime.beat === scope.beat) {
    runtime.stageTask = structuredClone(task);
  }
}

/** An answered fork is consumed even when its consequences keep the beat on hold. */
export function consumeNarrativeStageFork(state: NarrativeRunState, scope: { actId?: string; beat: string }): void {
  const runtime = state.actRuntime;
  if (runtime && runtime.actId === scope.actId && runtime.beat === scope.beat && runtime.stageTask?.fork) {
    const { fork: _fork, ...task } = runtime.stageTask;
    runtime.stageTask = task;
  }
}
