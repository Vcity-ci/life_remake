import type { NarrativeIntent, NarrativeWorldDefinition } from "@reroll/shared";
import type { DirectedStoryTurnResult } from "./ai.js";
import {
  applyDirectedClosureRequest,
  candidateAdvancesNarrativeComponent,
  selectDirectedCandidateForIntent,
  type DirectedClosureOutcome,
  type DirectedEventCandidate,
  type InternalRunState
} from "./engine.js";

export interface ApprovedStoryIntent {
  intent: NarrativeIntent;
  focusComponentId?: string;
  candidate?: DirectedEventCandidate;
  source: "model";
}

export function approveStoryIntent(
  run: InternalRunState,
  candidates: DirectedEventCandidate[],
  allowedIntents: NarrativeIntent[],
  turn: DirectedStoryTurnResult,
  focusOptions: Array<{ id: string }> = [],
  narrativeWorld?: NarrativeWorldDefinition | null
): ApprovedStoryIntent {
  if (run.narrative.enabled && run.story.closureState === "guiding") {
    return {
      intent: "payoff",
      candidate: candidates.find((candidate) => candidate.definition.narrativeBeat === "ending"),
      source: "model"
    };
  }
  if (run.narrative.enabled && run.story.mainlineCompleted) {
    // The closing request is handled separately. A regular planning result is
    // never allowed to restart the completed mainline.
    return { intent: "continue", source: "model" };
  }
  if (!turn.intent || !allowedIntents.includes(turn.intent)) {
    return { intent: "continue", source: "model" };
  }
  const intent = turn.intent;
  const focusComponentId = turn?.focusComponentId && focusOptions.some((option) => option.id === turn.focusComponentId)
    ? turn.focusComponentId
    : undefined;
  const candidate = selectDirectedCandidateForIntent(run, candidates, intent, focusComponentId, narrativeWorld);
  const appliedFocusComponentId = focusComponentId && candidate && candidateAdvancesNarrativeComponent(run, candidate, focusComponentId)
    ? focusComponentId
    : undefined;
  return {
    intent,
    focusComponentId: appliedFocusComponentId,
    candidate,
    source: "model"
  };
}

export function approveStoryClosure(
  run: InternalRunState,
  action: "guide" | "finish" | undefined,
  narrativeWorld?: NarrativeWorldDefinition | null
): DirectedClosureOutcome | undefined {
  return action ? applyDirectedClosureRequest(run, action, narrativeWorld) : undefined;
}
