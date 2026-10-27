import type { NarrativeActOutline, NarrativeBeat, NarrativeDecisionBrief, NarrativeEpisodeRecord, NarrativeRunState, NarrativeStatTier, ChoiceCheck, StatKey, TurnRecord } from "@reroll/shared";
import { formatNarrativeDialogue, formatNarrativeExperience } from "../narrative-memory.js";
import { buildNarrativeStoryHistory } from "./story-history.js";

export type NarrativeTurnKind = "background" | "scene";
export type NarrativeTurnCapability = "background" | "scene" | "choice";
export type NarrativeTurnSource = "background" | "scene" | "closure";
export type NarrativeFocusKind = "fact" | "character" | "location" | "ability" | "world_card";

export function narrativeTurnKindsForReadiness(earlyLife: boolean, currentBeatReady: boolean): NarrativeTurnKind[] {
  return !earlyLife && currentBeatReady ? ["scene"] : ["background"];
}

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
  backgroundAgeRange: { fromAge: number; toAge: number };
  act: { id: string; label: string; prompt: string };
  beat: Exclude<NarrativeBeat, "ending">;
  actOutline?: NarrativeActOutline;
  capabilities: NarrativeTurnCapability[];
  storyPatterns: Array<{ id: string; label: string; summary: string }>;
  socialForces: NarrativeSocialForceReference[];
  focusReferences: NarrativeTurnFocusReference[];
  currentLocationId?: string;
  statTiers: Record<StatKey, NarrativeStatTier>;
  statTierLabels?: Record<StatKey, string>;
  recentChanges?: string[];
  choiceCheck?: ChoiceCheck;
  progressGap?: string;
  growthFocus?: { id: string; label: string; description: string };
  preparation?: { mode: "transition" | "prepare"; deficits: Array<{ stat: StatKey; label: string; value: number; target: number }> };
  clock: { mode: "advance" | "hold"; sameAgeTurnCount: number; maxSameAgeTurns: number };
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
  conflictRefs: string[];
  abilityRefs: string[];
  beatChange?: string;
  timeScope?: string;
  note?: string;
  /** Uses parsed from model reference entries; ID arrays above are derived for lookup only. */
  recallUses?: Array<{ ref: string; label: string; purpose: string }>;
  assetNeeds?: Array<{ kind: "character" | "location" | "ability"; purpose: string; ref?: string }>;
  /** Planner-selected objects, with their current narrative uses. */
  materials?: Array<{ id: string; kind: "character" | "location" | "ability"; label: string; description?: string }>;
  locationDirective?: {
    mode: "stay" | "revisit" | "move";
    locationRef?: string;
    purpose?: string;
  };
  presentation: "summary" | "scene" | "choice";
  decisionBrief?: NarrativeDecisionBrief;
  actOutline?: NarrativeActOutline;
  clockRequest: "advance" | "hold";
}

export interface NarrativeTurnTime {
  previousAge: number;
  sceneAge: number;
  backgroundAgeRange: NarrativeTurnEnvelope["backgroundAgeRange"];
}

/** Resolve the current turn once, after planning and before any prose is written. */
export function resolveNarrativeTurnTime(envelope: NarrativeTurnEnvelope, plan: NarrativeTurnPlan): NarrativeTurnTime {
  return {
    previousAge: envelope.currentAge,
    sceneAge: plan.clockRequest === "hold" ? envelope.currentAge : envelope.currentAge + 1,
    backgroundAgeRange: { ...envelope.backgroundAgeRange }
  };
}

export function narrativeTurnPlanFocusIds(plan: NarrativeTurnPlan): string[] {
  return Array.from(new Set([
    ...plan.conflictRefs,
    ...plan.abilityRefs,
    ...(plan.assetNeeds ?? []).flatMap((need) => need.ref ? [need.ref] : []),
    ...(plan.locationDirective?.locationRef ? [plan.locationDirective.locationRef] : [])
  ]));
}

export function recentCommittedNarrativeChanges(
  state: NarrativeEpisodeRecord[] | (Pick<NarrativeRunState, "episodes" | "memoryEntries"> & Partial<Pick<NarrativeRunState, "memoryDigests">>),
  limit = 3,
  turnRecords: readonly TurnRecord[] = []
): string[] {
  const source = Array.isArray(state) ? { episodes: state, memoryEntries: [], memoryDigests: [] } : state;
  return buildNarrativeStoryHistory({ ...source, memoryDigests: source.memoryDigests ?? [] }, turnRecords)
    .episodes.slice(-limit)
    .map((episode) => formatNarrativeExperience(episode, formatNarrativeDialogue({ ...episode, narrative: episode.narrative ?? "" })));
}

export function narrativeTurnCapabilities(
  earlyLife: boolean,
  beat: NarrativeTurnEnvelope["beat"],
  allowedTurnKinds: NarrativeTurnKind[]
): NarrativeTurnCapability[] {
  const capabilities: NarrativeTurnCapability[] = [];
  if (allowedTurnKinds.includes("background")) capabilities.push("background");
  if (!earlyLife && allowedTurnKinds.includes("scene")) {
    capabilities.push("scene", "choice");
  }
  return capabilities;
}
