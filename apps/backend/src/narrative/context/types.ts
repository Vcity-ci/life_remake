import type { ChatConversationState, ConversationPromptMessage, ConversationProjectionPolicy } from "../../conversation.js";
import type { NarrativePromptPlan } from "../../narrative.js";
import type { NarrativeTask } from "../../narrative-prompts.js";

export type NarrativeContextLayer = "stable" | "runtime" | "active" | "recall" | "history" | "task";

export type NarrativeContextSection =
  | "persona"
  | "talents"
  | "seedHints"
  | "origin"
  | "mainline"
  | "route"
  | "handoff"
  | "lore"
  | "styleExamples"
  | "authorNote"
  | "characters"
  | "factDirectory"
  | "facts"
  | "resolvedFacts"
  | "locations"
  | "abilities"
  | "assets"
  | "memories"
  | "digests"
  | "ending"
  | "history"
  | "raw"
  | "task";

export type NarrativeContextPlacement = "user_context" | "message_history";

export interface NarrativeContextFragment {
  id: string;
  layer: NarrativeContextLayer;
  section: NarrativeContextSection;
  placement: NarrativeContextPlacement;
  sourceType: string;
  sourceIds: string[];
  priority: number;
  content: string;
  estimatedTokens: number;
  required: boolean;
  expiresAfterTurn?: boolean;
  order: number;
  /** A semantic unit (normally one user/assistant round) that is budgeted atomically. */
  groupId?: string;
  /** Debug-only explanation for conditional recall. Never rendered to the model. */
  activationReason?: string;
  /** Authoring placement resolved into the final context layer/section. */
  injectionPosition?: string;
  /** Debug/lifecycle metadata for a selected world card. */
  worldCardActivationKind?: "direct" | "related" | "sticky";
  worldCardStickyTurns?: number;
  worldCardCooldownTurns?: number;
  worldCardLastActivatedSequence?: number;
  worldCardRemainingStickyTurns?: number;
  worldCardRemainingCooldownTurns?: number;
}

export interface NarrativeContextBudgetProfile {
  maxEstimatedTokens: number;
  layerRatios: Record<NarrativeContextLayer, number>;
}

export interface NarrativeTaskContextProfile {
  task: NarrativeTask;
  budget: NarrativeContextBudgetProfile;
  allowedSections: NarrativeContextSection[];
  history: ConversationProjectionPolicy;
}

export interface NarrativeContextManifest {
  callId?: string;
  source?: NarrativeContextComposeInput["source"];
  worldId?: string;
  focusIds?: string[];
  task: NarrativeTask;
  fragments: NarrativeContextFragment[];
  totalEstimatedTokens: number;
  layerEstimatedTokens: Record<NarrativeContextLayer, number>;
  droppedFragmentIds: string[];
  duplicateSourceIds: string[];
  historyMessageCount: number;
  conversationArchiveCount: number;
  summaryThroughMemoryId?: string;
  providerIds: string[];
  worldCardDiagnostics: Array<{ id: string; reason: string }>;
}

export interface NarrativeContextComposition {
  renderedContext: string;
  historyMessages: ConversationPromptMessage[];
  manifest: NarrativeContextManifest;
}

export interface NarrativeContextProviderInput {
  plan?: NarrativePromptPlan;
  task: NarrativeTask;
  taskPrompt: string;
}

export interface NarrativeContextProvider {
  id: string;
  collect(input: NarrativeContextProviderInput): NarrativeContextFragment[];
}

export interface NarrativeContextComposeInput {
  plan?: NarrativePromptPlan;
  task: NarrativeTask;
  taskPrompt: string;
  conversation?: ChatConversationState;
  callId?: string;
  source?: "opening" | "background" | "scene" | "decision" | "closure" | "ending";
  worldId?: string;
  focusIds?: string[];
  providers?: NarrativeContextProvider[];
}
