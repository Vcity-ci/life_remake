export interface ToolCallRecord {
  id: string;
  name: string;
  arguments: string;
}

export type ChatHistoryMessage =
  | { role: "user" | "assistant"; content: string; turnId?: string }
  | { role: "assistant"; toolCall: ToolCallRecord }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface ChatConversationState {
  systemHash: string;
  headCore: string;
  headMemory: string;
  history: ChatHistoryMessage[];
  archive: Array<{ id?: string; user: string; assistant: string }>;
  summaryRevision?: number;
}

export interface AiConversationState {
  year?: ChatConversationState;
  milestone?: ChatConversationState;
  ending?: ChatConversationState;
}

export interface ConversationSummaryWork {
  revision: number;
  previousSummary: string;
  rounds: Array<{ id?: string; user: string; assistant: string }>;
}

export function applyConversationSummary(
  conversation: ChatConversationState, work: ConversationSummaryWork, summary: string
): boolean {
  if (!summary.trim() || (conversation.summaryRevision ?? 0) !== work.revision ||
      conversation.headMemory !== work.previousSummary || !work.rounds.length) return false;
  const pending = conversation.archive.slice(0, work.rounds.length);
  if (pending.length !== work.rounds.length || pending.some((round, index) => {
    const expected = work.rounds[index];
    return round.id !== expected.id || round.user !== expected.user || round.assistant !== expected.assistant;
  })) return false;
  conversation.headMemory = summary.trim();
  conversation.archive = conversation.archive.slice(work.rounds.length);
  conversation.summaryRevision = work.revision + 1;
  return true;
}


export function pendingConversationContext(conversation: ChatConversationState): string {
  if (!conversation.archive.length) return "";
  return "尚未合并入摘要的已发生经历：\n" + conversation.archive.map((round) =>
    `${round.user}\n${round.assistant.length > 160 ? round.assistant.slice(0, 160) + "…" : round.assistant}`
  ).join("\n");
}

export function representedConversationMemoryIds(conversation?: ChatConversationState): string[] {
  if (!conversation) return [];
  return [
    ...conversation.history.flatMap((message) => "turnId" in message && message.turnId ? [message.turnId] : []),
    ...conversation.archive.flatMap((round) => round.id ? [round.id] : [])
  ];
}
