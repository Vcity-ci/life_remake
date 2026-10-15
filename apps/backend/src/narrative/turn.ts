import type { NarrativeActCanon, NarrativeBeat, NarrativeDecisionBrief, NarrativeEpisodeRecord, NarrativeStageTask, NarrativeStatTier, StatKey } from "@reroll/shared";

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
  stageTask?: NarrativeStageTask;
  progressGap?: string;
  capabilities: NarrativeTurnCapability[];
  storyPatterns: Array<{ id: string; label: string; summary: string }>;
  socialForces: NarrativeSocialForceReference[];
  focusReferences: NarrativeTurnFocusReference[];
  currentLocationId?: string;
  statTiers: Record<StatKey, NarrativeStatTier>;
  statTierLabels?: Record<StatKey, string>;
  recentChanges?: string[];
  actSummary?: string;
  actProgress?: Array<{ beat: Exclude<NarrativeBeat, "ending">; changes: string[] }>;
  previousActResult?: string;
  growthFocus?: { id: string; label: string; description: string };
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
  assetNeeds?: Array<{ kind: "character" | "location" | "ability"; purpose: string; ref?: string }>;
  /** Planner-selected objects, with their current narrative uses. */
  materials?: Array<{ id: string; kind: "character" | "location" | "ability"; label: string; description?: string }>;
  locationDirective?: {
    mode: "stay" | "revisit" | "move";
    locationRef?: string;
    purpose?: string;
  };
  sceneGoal: string;
  presentation: "summary" | "scene" | "choice";
  decisionBrief?: NarrativeDecisionBrief;
  stageTask?: NarrativeStageTask;
  clockRequest: "advance" | "hold";
}

export interface NarrativeTurnTime {
  sceneAge: number;
  backgroundAgeRange: NarrativeTurnEnvelope["backgroundAgeRange"];
}

/** Resolve the current turn once, after planning and before any prose is written. */
export function resolveNarrativeTurnTime(envelope: NarrativeTurnEnvelope, plan: NarrativeTurnPlan): NarrativeTurnTime {
  return {
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

export function recentCommittedNarrativeChanges(episodes: NarrativeEpisodeRecord[], limit = 3): string[] {
  return episodes.filter((episode) => episode.storyDelta?.trim()).slice(-limit)
    .map((episode) => `${episode.age}岁：${episode.storyDelta!.trim()}`);
}

export function narrativePreviousActResult(canon: NarrativeActCanon | undefined): string | undefined {
  return canon ? `已结束的矛盾：${canon.resolvedTension}；持续得失：${canon.lastingConsequence}；由此形成的处境：${canon.continuation}` : undefined;
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
