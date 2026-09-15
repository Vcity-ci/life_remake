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
    droppedFragmentIds: manifest.droppedFragmentIds,
    duplicateSourceIds: manifest.duplicateSourceIds,
    historyMessageCount: manifest.historyMessageCount,
    conversationArchiveCount: manifest.conversationArchiveCount,
    summaryThroughMemoryId: manifest.summaryThroughMemoryId
  };
}
