import type { NarrativeActOutline, NarrativeBeat, NarrativeRunState } from "@reroll/shared";

export type NarrativeActBeat = Exclude<NarrativeBeat, "ending">;
export const NARRATIVE_ACT_OUTLINE_BEATS: NarrativeActBeat[] = ["setup", "escalation", "pressure", "climax", "payoff"];

export function narrativeOutlinePurpose(outline: NarrativeActOutline | undefined): "initial" | "execute" {
  return outline ? "execute" : "initial";
}

type OutlineNode = NarrativeActOutline["beats"][NarrativeActBeat];

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function normalizeNode(value: unknown): OutlineNode | undefined {
  const raw = record(value);
  const change = typeof raw?.change === "string" ? raw.change.trim() : "";
  if (!change || !Array.isArray(raw?.props) || raw.props.some((prop) => typeof prop !== "string" || !prop.trim())) return undefined;
  const node: OutlineNode = { change, props: raw.props.map((prop: string) => prop.trim()) };
  if (raw?.timeframe !== undefined && raw.timeframe !== null) {
    const range = record(raw.timeframe);
    if (!range || !Number.isInteger(range.fromAge) || !Number.isInteger(range.toAge) ||
        Number(range.fromAge) < 0 || Number(range.toAge) < Number(range.fromAge)) return undefined;
    node.timeframe = { fromAge: Number(range.fromAge), toAge: Number(range.toAge) };
  }
  return node;
}

export function normalizeNarrativeActOutline(value: unknown, actId?: string): NarrativeActOutline | undefined {
  const raw = record(value);
  const id = typeof raw?.actId === "string" ? raw.actId.trim() : "";
  const background = typeof raw?.background === "string" ? raw.background.trim() : "";
  const beats = record(raw?.beats);
  if (!id || !background || (actId !== undefined && id !== actId) || !Number.isInteger(raw?.revision) || Number(raw?.revision) < 1 || !beats) return undefined;
  const nodes = {} as NarrativeActOutline["beats"];
  for (const beat of NARRATIVE_ACT_OUTLINE_BEATS) {
    const node = normalizeNode(beats[beat]);
    if (!node) return undefined;
    nodes[beat] = node;
  }
  return { actId: id, revision: Number(raw!.revision), background, beats: nodes };
}

/** Compose once per act. Choices change actual history rather than rewriting the card. */
export function parseNarrativeActWorldCard(value: unknown, actId: string): NarrativeActOutline {
  const outline = normalizeNarrativeActOutline({ ...record(value), actId, revision: 1 }, actId);
  if (!outline) throw new Error("narrative_act_outline_invalid:background_and_five_beats_required");
  return outline;
}

export function commitNarrativeActOutline(state: NarrativeRunState, outline: NarrativeActOutline): void {
  if (state.actRuntime?.actId === outline.actId) state.actRuntime.outline = structuredClone(outline);
}

export function formatNarrativeActOutline(outline: NarrativeActOutline | undefined, currentBeat: NarrativeActBeat): string {
  if (!outline) return "";
  return [`本幕世界卡：\n${outline.background}`, formatNarrativeActStory(outline, currentBeat)].join("\n");
}

export function formatNarrativeActStory(outline: NarrativeActOutline, currentBeat: NarrativeActBeat): string {
  const current = NARRATIVE_ACT_OUTLINE_BEATS.indexOf(currentBeat);
  return [
    "本幕简要故事：实际经历与玩家决定是当前处境；以下节拍承接选定冲突，实际应对、成败与所得由游戏产生，已改变的条件不恢复。",
    ...NARRATIVE_ACT_OUTLINE_BEATS.slice(current).map((beat, index) => {
      const node = outline.beats[beat];
      const status = index === 0 ? "当前阶段" : "未发生阶段";
      const timeframe = node.timeframe ? `\n计划年龄：${node.timeframe.fromAge}—${node.timeframe.toAge}岁（参考安排，实际年龄以当前主角为准）` : "";
      return `${beat}【${status}】应形成的改变：${node.change}\n所需对象：${node.props.join("；") || "按实际发展引入"}${timeframe}`;
    })
  ].join("\n");
}
