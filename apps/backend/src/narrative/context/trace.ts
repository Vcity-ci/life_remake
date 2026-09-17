import type { NarrativeContextManifest } from "./types.js";

export function narrativeContextTrace(manifest: NarrativeContextManifest) {
  return {
    callId: manifest.callId,
    source: manifest.source,
    worldId: manifest.worldId,
    focusIds: manifest.focusIds,
    task: manifest.task,
    providers: manifest.providerIds,
    fragmentCount: manifest.fragments.length,
    totalEstimatedTokens: manifest.totalEstimatedTokens,
    layerEstimatedTokens: manifest.layerEstimatedTokens,
    selectedSourceIds: manifest.fragments.flatMap((entry) => entry.sourceIds),
    selectedWorldCards: manifest.fragments.filter((entry) => entry.sourceType === "world-card").map((entry) => ({
      id: entry.sourceIds.find((id) => id.startsWith("world-card:"))?.slice("world-card:".length) ?? entry.id,
      reason: entry.activationReason,
      activationKind: entry.worldCardActivationKind,
      position: entry.injectionPosition,
      stickyTurns: entry.worldCardStickyTurns,
      cooldownTurns: entry.worldCardCooldownTurns,
      lastActivatedSequence: entry.worldCardLastActivatedSequence,
      remainingStickyTurns: entry.worldCardRemainingStickyTurns,
      remainingCooldownTurns: entry.worldCardRemainingCooldownTurns,
      estimatedTokens: entry.estimatedTokens
    })),
    excludedWorldCards: manifest.worldCardDiagnostics,
    droppedFragmentIds: manifest.droppedFragmentIds,
    duplicateSourceIds: manifest.duplicateSourceIds,
    historyMessageCount: manifest.historyMessageCount,
    conversationArchiveCount: manifest.conversationArchiveCount,
    summaryThroughMemoryId: manifest.summaryThroughMemoryId
  };
}
