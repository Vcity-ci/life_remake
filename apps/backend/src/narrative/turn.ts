import type { NarrativeBeat, NarrativeHorizonPlan, NarrativeStatTier, StatKey } from "@reroll/shared";

export type NarrativeTurnKind = "background" | "scene";
export type NarrativeTurnSource = "background" | "scene" | "closure";
export type NarrativeFocusKind = "fact" | "character" | "location" | "ability";

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
  allowedTurnKinds: NarrativeTurnKind[];
  decisionMode: "none" | "optional" | "required";
  routes: Array<{ id: string; label: string; summary: string }>;
  factions: Array<{ id: string; label: string; summary: string }>;
  focusReferences: NarrativeTurnFocusReference[];
  statTiers: Record<StatKey, NarrativeStatTier>;
  growthFocus?: { id: string; label: string; description: string };
  clock: { mode: "advance" | "hold"; sameAgeTurnCount: number; maxSameAgeTurns: number };
  horizon?: Pick<NarrativeHorizonPlan, "revision" | "dramaticQuestion" | "developingTension" | "nearTermIntents" | "focusRefs" | "payoffShape">;
}

export interface NarrativeHorizonInput {
  callId: string;
  worldId: string;
  act: { id: string; label: string; prompt: string };
  beat: Exclude<NarrativeBeat, "ending">;
  routes: Array<{ id: string; label: string; summary: string }>;
  factions: Array<{ id: string; label: string; summary: string }>;
  focusReferences: NarrativeTurnFocusReference[];
  previousCanon: Array<{ actId: string; text: string }>;
  memoryDigests: Array<{ id: string; text: string }>;
  throughEpisodeId?: string;
  nextRevision: number;
}

/** Model-authored proposal. The engine still owns all state transitions and settlement. */
export interface NarrativeTurnPlan {
  callId: string;
  turnKind: NarrativeTurnKind;
  routeId?: string;
  factionId?: string;
  focusRefs: string[];
  sceneGoal: string;
  presentation: "summary" | "scene" | "choice";
  clockRequest: "advance" | "hold";
}
