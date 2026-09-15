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
  summaryThroughMemoryId?: string;
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

export interface ConversationPromptMessage {
  role: "user" | "assistant";
  content: string;
  /** Keeps a complete semantic exchange together during context budgeting. */
  groupId?: string;
  sourceId?: string;
  required?: boolean;
}

interface ConversationRound {
  id?: string;
  user: string;
  assistant: string;
  messages: ChatHistoryMessage[];
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
  conversation.summaryThroughMemoryId = work.rounds.at(-1)?.id ?? conversation.summaryThroughMemoryId;
  return true;
}


export function pendingConversationContext(conversation: ChatConversationState): string {
  if (!conversation.archive.length) return "";
  const passages: string[] = [];
  for (const round of conversation.archive) {
    const digest = round.user.includes("本段记事：")
      ? round.user.slice(0, 320)
      : `${round.user}\n${round.assistant.length > 240 ? "…" + round.assistant.slice(-240) : round.assistant}`;
    const similar = passages.indexOf(digest);
    if (similar >= 0) passages.splice(similar, 1);
    passages.push(digest);
  }
  return "尚未合并入摘要的经历变化：\n" + passages.join("\n");
}

function isTextHistoryMessage(
  message: ChatHistoryMessage
): message is Extract<ChatHistoryMessage, { role: "user" | "assistant"; content: string }> {
  return "content" in message && (message.role === "user" || message.role === "assistant");
}

function collectConversationRounds(history: ChatHistoryMessage[]): ConversationRound[] {
  const rounds: ConversationRound[] = [];
  let pendingUser = "";
  let pendingId: string | undefined;
  let pendingMessages: ChatHistoryMessage[] = [];
  for (const item of history) {
    if (isTextHistoryMessage(item) && item.role === "user") {
      pendingUser = item.content;
      pendingId = item.turnId;
      pendingMessages = [item];
      continue;
    }
    if (!pendingUser) continue;
    pendingMessages.push(item);
    if (isTextHistoryMessage(item) && item.role === "assistant") {
      rounds.push({ id: pendingId, user: pendingUser, assistant: item.content, messages: pendingMessages });
      pendingUser = "";
      pendingMessages = [];
    }
  }
  return rounds;
}

function formatConversationHistoryMessage(item: ChatHistoryMessage): string {
  if (item.role === "assistant" && "toolCall" in item) return "";
  if (item.role === "tool") return "";
  return item.content;
}

export function projectConversationUserPrompt(prompt: string): string {
  const normalized = prompt.trim();
  const age = normalized.match(/(?:\bS0 age=|\bage=|年龄=)(\d+)/)?.[1] ?? "下一";
  if (/^T:(?:D4|I)\b/.test(normalized)) return `岁月推进至${age}岁，人物继续面对当时的主要矛盾。`;
  if (/^T:Y\b/.test(normalized)) return `岁月推进至${age}岁，叙事承接此前的处境。`;
  if (/^T:M\b/.test(normalized)) return `人物在${age}岁来到一处需要取舍的关口。`;
  if (/^T:E\b/.test(normalized)) return "这一生已经走到结局，请回望已发生的关键后果。";
  return prompt;
}

/**
 * Projects persisted conversation state into provider messages. Tool records
 * remain internal; committed assistant prose and compacted memory retain the
 * conversational continuity seen by the narrator.
 */
export function buildConversationPromptMessages(conversation: ChatConversationState): ConversationPromptMessage[] {
  const memory = conversation.headMemory.trim() ? `已发生经历的摘要：${conversation.headMemory.trim()}` : "";
  const archived = conversation.archive.flatMap((round, index) => {
    const groupId = `archive:${round.id ?? index}`;
    return [
      { role: "user" as const, content: projectConversationUserPrompt(round.user), groupId, sourceId: round.id, required: true },
      { role: "assistant" as const, content: round.assistant, groupId, sourceId: round.id, required: true }
    ];
  });
  return [
    ...(memory ? [{ role: "user" as const, content: memory, groupId: "summary", sourceId: conversation.summaryThroughMemoryId, required: true }] : []),
    ...archived,
    ...collectConversationRounds(conversation.history).flatMap((round, index) => {
      const assistantContent = round.messages.slice(1).map(formatConversationHistoryMessage).filter(Boolean).join("\n");
      const groupId = `recent:${round.id ?? index}`;
      return assistantContent
        ? [
            { role: "user" as const, content: projectConversationUserPrompt(round.user), groupId, sourceId: round.id, required: true },
            { role: "assistant" as const, content: assistantContent, groupId, sourceId: round.id, required: true }
          ]
        : [];
    })
  ];
}

export function summarizedConversationMemoryIds(conversation: ChatConversationState | undefined, orderedIds: string[]): string[] {
  const through = conversation?.summaryThroughMemoryId;
  const index = through ? orderedIds.indexOf(through) : -1;
  return index < 0 ? [] : orderedIds.slice(0, index + 1);
}

export function representedConversationMemoryIds(conversation?: ChatConversationState): string[] {
  if (!conversation) return [];
  return [
    ...conversation.history.flatMap((message) => "turnId" in message && message.turnId ? [message.turnId] : []),
    ...conversation.archive.flatMap((round) => round.id ? [round.id] : [])
  ];
}
