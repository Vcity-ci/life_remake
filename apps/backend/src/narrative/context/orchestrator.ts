import { buildConversationPromptMessages } from "../../conversation.js";
import { collectNarrativePlanFragments, defaultNarrativeContextProviders } from "./collectors.js";
import { dedupeNarrativeContextFragments } from "./dedupe.js";
import { narrativeContentId, narrativeContextFragment } from "./fragments.js";
import { formatNarrativeContextFragments } from "./formatter.js";
import { narrativeTaskContextProfile } from "./task-profiles.js";
import type { NarrativeContextComposeInput, NarrativeContextComposition, NarrativeContextFragment, NarrativeContextLayer } from "./types.js";

const LAYERS: NarrativeContextLayer[] = ["stable", "runtime", "active", "recall", "history", "task"];

export function composeNarrativeContext(input: NarrativeContextComposeInput): NarrativeContextComposition {
  const profile = narrativeTaskContextProfile(input.task, input.planningPurpose);
  const historyMessages = input.conversation ? buildConversationPromptMessages(input.conversation, profile.history) : [];
  const providers = input.providers ?? defaultNarrativeContextProviders;
  const allowedSections = new Set(profile.allowedSections);
  const planFragments = collectNarrativePlanFragments({ plan: input.plan, taskPrompt: input.taskPrompt, task: input.task, historyMessages }, providers)
    .filter((fragment) => allowedSections.has(fragment.section));
  const historyFragments = historyMessages.map((message, index) => narrativeContextFragment({
    id: narrativeContentId(`history:${index}:${message.role}`, message.content),
    layer: "history",
    section: "history",
    placement: "message_history",
    sourceType: "conversation",
    sourceIds: [message.sourceId ?? narrativeContentId("conversation", message.content)],
    priority: 80 + index,
    content: message.content,
    required: message.required ?? false,
    groupId: message.groupId,
    order: planFragments.length + index
  })).filter((entry): entry is NarrativeContextFragment => Boolean(entry));
  const deduped = dedupeNarrativeContextFragments([...planFragments, ...historyFragments]);
  const fragments = deduped.fragments;
  const layerEstimatedTokens = Object.fromEntries(LAYERS.map((layer) => [
    layer,
    fragments.filter((entry) => entry.layer === layer).reduce((sum, entry) => sum + entry.estimatedTokens, 0)
  ])) as Record<NarrativeContextLayer, number>;
  const selectedHistoryIds = new Set(fragments.filter((entry) => entry.placement === "message_history").map((entry) => entry.id));
  const selectedHistoryMessages = historyMessages.filter((message, index) => selectedHistoryIds.has(narrativeContentId(`history:${index}:${message.role}`, message.content)));
  const droppedFragmentIds = deduped.droppedFragmentIds;
  const stableContext = formatNarrativeContextFragments(fragments, new Set(["stable"]));
  const runtimeContext = formatNarrativeContextFragments(fragments, new Set(["runtime"]));
  const activeContext = formatNarrativeContextFragments(fragments, new Set(["active", "recall"]));
  const taskContext = formatNarrativeContextFragments(fragments, new Set(["task"]));
  return {
    renderedContext: [stableContext, runtimeContext, activeContext, taskContext].filter(Boolean).join("\n"),
    stableContext,
    runtimeContext,
    activeContext,
    taskContext,
    historyMessages: selectedHistoryMessages,
    manifest: {
      callId: input.callId,
      source: input.source,
      worldId: input.worldId,
      focusIds: input.focusIds,
      task: input.task,
      fragments,
      totalEstimatedTokens: Object.values(layerEstimatedTokens).reduce((sum, value) => sum + value, 0),
      layerEstimatedTokens,
      droppedFragmentIds,
      duplicateSourceIds: deduped.duplicateSourceIds,
      historyMessageCount: selectedHistoryMessages.length,
      conversationArchiveCount: input.conversation?.archive.length ?? 0,
      summaryThroughMemoryId: input.conversation?.summaryThroughMemoryId,
      providerIds: providers.map((provider) => provider.id),
      worldCardDiagnostics: input.plan?.worldCardDiagnostics ?? []
    }
  };
}
