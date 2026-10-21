import type { NarrativeActOutline, NarrativeBeat, NarrativeRunState, NarrativeStageTask } from "@reroll/shared";
import { normalizeNarrativeStageTask } from "./stage-task.js";

export type NarrativeActBeat = Exclude<NarrativeBeat, "ending">;
export const NARRATIVE_ACT_OUTLINE_BEATS: NarrativeActBeat[] = ["setup", "escalation", "pressure", "climax", "payoff"];

export function narrativeOutlinePurpose(outline: NarrativeActOutline | undefined, needsRevision?: boolean): "initial" | "revise" | "execute" {
  return !outline ? "initial" : needsRevision ? "revise" : "execute";
}

type OutlineNode = NarrativeActOutline["beats"][NarrativeActBeat];

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function normalizeNode(value: unknown): OutlineNode | undefined {
  const raw = record(value);
  const task = normalizeNarrativeStageTask(value);
  const story = typeof raw?.story === "string" ? raw.story.trim() : "";
  return task && story ? { story, ...task } : undefined;
}

/** Normalize saved engine-owned metadata and the complete five-beat story. */
export function normalizeNarrativeActOutline(value: unknown, actId?: string): NarrativeActOutline | undefined {
  const raw = record(value);
  const id = typeof raw?.actId === "string" ? raw.actId.trim() : "";
  const beats = record(raw?.beats);
  if (!id || (actId !== undefined && id !== actId) || !Number.isInteger(raw?.revision) || Number(raw?.revision) < 1 || !beats) return undefined;
  const nodes = {} as NarrativeActOutline["beats"];
  for (const beat of NARRATIVE_ACT_OUTLINE_BEATS) {
    const node = normalizeNode(beats[beat]);
    if (!node) return undefined;
    nodes[beat] = node;
  }
  return { actId: id, revision: Number(raw!.revision), beats: nodes };
}

/** Parse only authored nodes; run identity and revision stay under engine ownership. */
export function applyNarrativeActOutlineUpdate(
  existing: NarrativeActOutline | undefined,
  update: unknown,
  scope: { actId: string; beat: NarrativeActBeat; requiresRevision?: boolean }
): NarrativeActOutline {
  const fail = (rule: string): never => { throw new Error(`narrative_act_outline_invalid:${rule}`); };
  const prior = existing ? normalizeNarrativeActOutline(existing, scope.actId) : undefined;
  if (existing && !prior) return fail("existing_outline");
  if (update === undefined || update === null) {
    if (!prior) return fail("initial_outline_required");
    if (scope.requiresRevision) return fail("revision_required");
    return structuredClone(prior);
  }
  if (prior && !scope.requiresRevision) return fail("outline_update_not_requested");
  const raw = record(update);
  const beats = record(raw?.beats);
  if (!beats) return fail("beats_required");
  const entries = Object.entries(beats);
  if (!entries.length) return fail("empty_update");
  const current = NARRATIVE_ACT_OUTLINE_BEATS.indexOf(scope.beat);
  if (current < 0) return fail("current_beat");
  const nodes = prior ? structuredClone(prior.beats) : {} as NarrativeActOutline["beats"];
  for (const [key, value] of entries) {
    const index = NARRATIVE_ACT_OUTLINE_BEATS.indexOf(key as NarrativeActBeat);
    if (index < 0) return fail("unknown_beat");
    if (prior && index < current) return fail("completed_beat_update");
    const node = normalizeNode(value);
    if (!node) return fail(`node_${key}`);
    nodes[key as NarrativeActBeat] = node;
  }
  if (NARRATIVE_ACT_OUTLINE_BEATS.some((beat) => !nodes[beat])) return fail("initial_outline_incomplete");
  return { actId: scope.actId, revision: (prior?.revision ?? 0) + 1, beats: nodes };
}

export function narrativeStageTaskForOutline(outline: NarrativeActOutline | undefined, beat: NarrativeActBeat): NarrativeStageTask | undefined {
  const node = outline?.beats[beat];
  return node ? normalizeNarrativeStageTask(node) : undefined;
}

/** Called in the existing successful-turn transaction, before observed beat advancement. */
export function commitNarrativeActOutline(state: NarrativeRunState, outline: NarrativeActOutline): void {
  const runtime = state.actRuntime;
  if (!runtime || runtime.actId !== outline.actId) return;
  runtime.outline = structuredClone(outline);
  runtime.stageTask = narrativeStageTaskForOutline(outline, runtime.beat);
  runtime.outlineNeedsRevision = false;
}

/** A committed choice asks the next planning call to revise only the unfinished story. */
export function markNarrativeActOutlineForRevision(state: NarrativeRunState, actId: string): void {
  const runtime = state.actRuntime;
  if (runtime?.actId === actId && runtime.outline) runtime.outlineNeedsRevision = true;
}

export function formatNarrativeActOutline(outline: NarrativeActOutline | undefined, currentBeat: NarrativeActBeat): string {
  if (!outline) return "";
  const current = NARRATIVE_ACT_OUTLINE_BEATS.indexOf(currentBeat);
  return [
    `本幕具体故事大纲（第${outline.revision}版；均为规划意图，不是已发生事实）：`,
    ...NARRATIVE_ACT_OUTLINE_BEATS.slice(current).map((beat, index) => {
      const node = outline.beats[beat];
      const status = index === 0 ? "当前阶段" : "未发生阶段";
      const timeframe = node.timeframe ? `\n计划年龄：${node.timeframe.fromAge}—${node.timeframe.toAge}岁（随实际成长与选择结果修订，不是准入期限）` : "";
      return `${beat}【${status}】剧情：${node.story}${timeframe}\n阶段目标：${node.goal}\n完成含义：${node.completionMeaning}${node.fork ? `\n潜在分歧窗口：${node.fork.openingSituation}；${node.fork.question}；取舍影响：${node.fork.stakes}` : "\n未预设分歧，不要求强行提问"}`;
    })
  ].join("\n");
}
