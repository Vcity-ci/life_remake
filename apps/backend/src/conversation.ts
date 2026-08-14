export interface ToolCallRecord {
  id: string;
  name: string;
  arguments: string;
}

export type ChatHistoryMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "assistant"; toolCall: ToolCallRecord }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface StoryConversationState {
  version: 1;
  persona: string;
  /** Human-readable projection only; never persist internal route or event ids. */
  currentConflict: string;
  recentAftermath: string;
  closureState: "open" | "guiding" | "finished";
  narrative?: {
    arcPhase: "setup" | "rising" | "pressure" | "climax" | "aftermath" | "ending";
    climaxCount: number;
    payoffCount: number;
    endingState: "open" | "eligible" | "locked" | "guiding" | "finished";
  };
}

export interface ChatConversationState {
  systemHash: string;
  headCore: string;
  headMemory: string;
  storyState?: StoryConversationState;
  history: ChatHistoryMessage[];
  archive: Array<{ user: string; assistant: string }>;
}

export interface AiConversationState {
  year?: ChatConversationState;
  milestone?: ChatConversationState;
  ending?: ChatConversationState;
}
