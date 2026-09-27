import type { NarrativeBeat, NarrativeEpisodeRecord, NarrativeHorizonPlan, NarrativeStatTier, StatKey } from "@reroll/shared";

export type NarrativeTurnKind = "background" | "scene";
export type NarrativeTurnCapability = "background" | "scene" | "choice";
export type NarrativeTurnSource = "background" | "scene" | "closure";
export type NarrativeFocusKind = "fact" | "character" | "location" | "ability" | "world_card";

export interface NarrativeSocialForceReference {
  id: string;
  label: string;
  summary: string;
  methods?: string[];
  tensions?: string[];
}

export interface NarrativeTurnFocusReference {
  id: string;
  kind: NarrativeFocusKind;
  label: string;
}

/** Engine-owned facts offered to the planner. None of these fields are model-mutable. */
export interface NarrativeTurnEnvelope {
  callId: string;
  source: NarrativeTurnSource;
  worldId: string;
  currentAge: number;
  sceneAge: number;
  backgroundAgeRange: { fromAge: number; toAge: number };
  act: { id: string; label: string; prompt: string };
  beat: Exclude<NarrativeBeat, "ending">;
  capabilities: NarrativeTurnCapability[];
  storyPatterns: Array<{ id: string; label: string; summary: string }>;
  socialForces: NarrativeSocialForceReference[];
  focusReferences: NarrativeTurnFocusReference[];
  statTiers: Record<StatKey, NarrativeStatTier>;
  recentChanges?: string[];
  growthFocus?: { id: string; label: string; description: string };
  clock: { mode: "advance" | "hold"; sameAgeTurnCount: number; maxSameAgeTurns: number };
  horizon?: Pick<NarrativeHorizonPlan, "revision" | "dramaticQuestion" | "developingTension" | "intents" | "focusRefs" | "payoffShape">;
}

export interface NarrativeHorizonInput {
  callId: string;
  worldId: string;
  act: { id: string; label: string; prompt: string };
  beat: Exclude<NarrativeBeat, "ending">;
  storyPatterns: Array<{ id: string; label: string; summary: string }>;
  socialForces: NarrativeSocialForceReference[];
  focusReferences: NarrativeTurnFocusReference[];
  previousCanon: Array<{ actId: string; text: string }>;
  memoryDigests: Array<{ id: string; text: string }>;
  recentChanges?: string[];
  throughEpisodeId?: string;
  nextRevision: number;
}

/** Model-authored proposal. The engine still owns all state transitions and settlement. */
export interface NarrativeTurnPlan {
  callId: string;
  turnKind: NarrativeTurnKind;
  patternIds: string[];
  forceIds: string[];
  focusRefs: string[];
  sceneGoal: string;
  presentation: "summary" | "scene" | "choice";
  clockRequest: "advance" | "hold";
  horizonIntentId?: string;
}

export function recentCommittedNarrativeChanges(episodes: NarrativeEpisodeRecord[], limit = 3): string[] {
  return episodes.filter((episode) => episode.storyDelta?.trim()).slice(-limit)
    .map((episode) => `${episode.age}岁：${episode.storyDelta!.trim()}`);
}

export function narrativeTurnCapabilities(
  earlyLife: boolean,
  beat: NarrativeTurnEnvelope["beat"],
  allowedTurnKinds: NarrativeTurnKind[]
): NarrativeTurnCapability[] {
  const capabilities: NarrativeTurnCapability[] = [];
  if (allowedTurnKinds.includes("background")) capabilities.push("background");
  if (!earlyLife && allowedTurnKinds.includes("scene")) {
    if (beat === "pressure" || beat === "climax") capabilities.push("choice");
    else if (beat === "setup" || beat === "escalation") capabilities.push("scene", "choice");
    else capabilities.push("scene");
  }
  return capabilities;
}
