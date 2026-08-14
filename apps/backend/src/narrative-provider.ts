import type { WorldConfig } from "@reroll/shared";
import {
  generateDirectedStoryRender,
  generateDirectedStoryTurn,
  type DirectedStoryRenderInput,
  type DirectedStoryRenderResult,
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

export interface NarrativeRenderRequest {
  run: InternalRunState;
  world: WorldConfig;
  input: DirectedStoryRenderInput;
  context: NarrativeContext;
}

/**
 * The provider boundary is deliberately local. The project borrows layered
 * context ideas from narrative tools, while its engine remains authoritative.
 */
export async function generateNarrativeTurn(request: NarrativeTurnRequest): Promise<DirectedStoryTurnResult> {
  return generateDirectedStoryTurn(request.run, request.world, request.input, request.context);
}

export async function generateNarrativeRender(request: NarrativeRenderRequest): Promise<DirectedStoryRenderResult> {
  return generateDirectedStoryRender(request.run, request.world, request.input, request.context);
}
