import type { WorldConfig } from "@reroll/shared";
import {

  generateDirectedStoryTurn,

  type DirectedStoryTurnInput,
  type DirectedStoryTurnResult,
  type NarrativeContext
} from "./ai.js";
import type { InternalRunState } from "./engine.js";

export interface NarrativeTurnRequest {
  run: InternalRunState;
  world: WorldConfig;
  input: DirectedStoryTurnInput;
  context: NarrativeContext;
}


/**
 * The provider boundary is deliberately local. The project borrows layered
 * context ideas from narrative tools, while its engine remains authoritative.
 */
export async function generateNarrativeTurn(request: NarrativeTurnRequest): Promise<DirectedStoryTurnResult> {
  return generateDirectedStoryTurn(request.run, request.world, request.input, request.context);
}
