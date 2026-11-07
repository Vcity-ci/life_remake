import type { NarrativeActOutline, NarrativeBeat, NarrativeDecisionBrief, NarrativeEpisodeRecord, NarrativeRunState, NarrativeStatTier, ChoiceCheck, StatKey, TurnRecord } from "@reroll/shared";
import { formatNarrativeDialogue, formatNarrativeExperience } from "../narrative-memory.js";
import { buildNarrativeStoryHistory } from "./story-history.js";

export type NarrativeTurnKind = "background" | "scene";
export type NarrativeTurnCapability = "background" | "scene" | "choice";
export type NarrativeTurnSource = "background" | "scene" | "closure";
export type NarrativeFocusKind = "fact" | "character" | "location" | "ability" | "world_card";

export function narrativeTurnKindsForReadiness(earlyLife: boolean, admitted: boolean): NarrativeTurnKind[] {
  return !earlyLife && admitted ? ["scene"] : ["background"];
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
  eventFlowPreparation?: {
    roles: Array<{ id: string; kind: string; identity: string }>;
    existingBindings: Record<string, string>;
    inventory: Array<{ id: string; name: string }>;
    groups: Array<{ id: string; label: string; narrativeRole: string; entry: string; requiresItems: string[]; events: Array<{ kind: string; situation: string }> }>;
  };
  callId: string;
  source: NarrativeTurnSource;
  worldId: string;
  currentAge: number;
  sceneAge?: number;
  backgroundAgeRange: { fromAge: number; toAge: number };
  act: { id: string; label: string; prompt: string; objective?: string; closureMeaning?: string };
  beat?: Exclude<NarrativeBeat, "ending">;
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
  growthFocus?: { id: string; label: string; description: string };
  preparation?: { mode: "transition" | "prepare" | "flow_prepare" | "life_interval"; context?: string; deficits: Array<{ stat: StatKey; label: string; value: number; target: number }> };
  clock: { mode: "advance" | "hold"; sameAgeTurnCount: number; maxSameAgeTurns: number };
}

export interface NarrativeHorizonInput {
  callId: string;
  worldId: string;
  act: { id: string; label: string; prompt: string; objective?: string; closureMeaning?: string };
  beat?: Exclude<NarrativeBeat, "ending">;
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
  recallRefs: string[];
  locationRefs: string[];
  /** Selected objects projected from their current state, without planner-authored instructions. */
  materials?: Array<{ id: string; kind: "character" | "location" | "ability"; label: string; description?: string }>;
  presentation: "summary" | "scene" | "choice";
  decisionBrief?: NarrativeDecisionBrief;
  actOutline?: NarrativeActOutline;
}

export interface NarrativeTurnTime {
  previousAge: number;
  sceneAge: number;
  backgroundAgeRange: NarrativeTurnEnvelope["backgroundAgeRange"];
}

/** Resolve the current age from the committed next-turn handoff, before recall. */
export function resolveNarrativeTurnTime(envelope: NarrativeTurnEnvelope): NarrativeTurnTime {
  return {
    previousAge: envelope.currentAge,
    sceneAge: envelope.clock.mode === "hold" ? envelope.currentAge : envelope.currentAge + 1,
    backgroundAgeRange: { ...envelope.backgroundAgeRange }
  };
}

export function narrativeTurnPlanFocusIds(plan: NarrativeTurnPlan): string[] {
  return Array.from(new Set([
    ...plan.conflictRefs,
    ...plan.abilityRefs,
    ...plan.locationRefs
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
  allowedTurnKinds: NarrativeTurnKind[]
): NarrativeTurnCapability[] {
  const capabilities: NarrativeTurnCapability[] = [];
  if (allowedTurnKinds.includes("background")) capabilities.push("background");
  if (!earlyLife && allowedTurnKinds.includes("scene")) {
    capabilities.push("scene", "choice");
  }
  return capabilities;
}
