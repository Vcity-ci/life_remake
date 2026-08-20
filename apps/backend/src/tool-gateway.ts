import type { NarrativeIntent, NarrativeWorldDefinition } from "@reroll/shared";
import type { DirectedStoryTurnResult } from "./ai.js";
import {
  applyDirectedClosureRequest,
  type DirectedClosureOutcome,
  type InternalRunState
} from "./engine.js";

export interface ApprovedStoryIntent {
  intent: NarrativeIntent;
  routeId?: string;
  focusComponentId?: string;
  scenePacing?: "continuous" | "spanning";
  source: "model";
}

export function approveStoryIntent(
  run: InternalRunState,
  allowedIntents: NarrativeIntent[],
  turn: DirectedStoryTurnResult,
  focusOptions: Array<{ id: string }> = [],
  routeOptions: Array<{ id: string }> = []
): ApprovedStoryIntent {
  if (run.narrative.enabled && run.story.closureState === "guiding") {
    return {
      intent: "payoff",
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
  const route = turn.routeId ? routeOptions.find((option) => option.id === turn.routeId) : undefined;
  const routeId = route?.id;
  if (!routeId) return { intent: "continue", source: "model" };
  const focusComponentId = turn?.focusComponentId && focusOptions.some((option) => option.id === turn.focusComponentId)
    ? turn.focusComponentId
    : undefined;
  return {
    intent,
    routeId,
    focusComponentId,
    scenePacing: turn.scenePacing,
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
