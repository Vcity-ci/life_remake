import type { PublicMilestoneChoice } from "@reroll/shared";
import type { InternalRunState } from "../engine.js";
import { formatNarrativeDialogue, formatNarrativeExperience, narrativeExperienceContent } from "../narrative-memory.js";
import { buildNarrativeStoryHistory } from "./story-history.js";

/** Use the same exact coverage as story history; no uncovered act experience may fall out by age. */
export function narrativeObservationHistory(
  run: InternalRunState,
  current: { actId: string; age: number; sourceEventId: string; narrative: string;
    decisionResult?: "success" | "failure";
    selection?: { choice: PublicMilestoneChoice; label: string; description: string } }
): string {
  const summary = buildNarrativeStoryHistory(run.narrative, run.turnRecords).summary;
  const covered = new Set(summary?.coveredEpisodeIds ?? []);
  const episodes = run.narrative.episodes.filter((episode) =>
    episode.actId === current.actId && !covered.has(episode.id) && episode.age <= current.age &&
    episode.sourceEventId !== current.sourceEventId
  );
  const seen = new Set<string>();
  let selectionApplied = false;
  const history = episodes.flatMap((episode) => {
    if (seen.has(episode.sourceEventId)) return [];
    seen.add(episode.sourceEventId);
    const content = narrativeExperienceContent(run.narrative, episode, run.turnRecords);
    const record = episode.turnId ? run.turnRecords?.find((entry) => entry.turnId === episode.turnId) : undefined;
    if (current.selection && record?.choice?.sceneId === current.selection.choice.sceneId &&
        record.choice.revision === current.selection.choice.revision) {
      content.selectedAction = `${current.selection.label}：${current.selection.description}`;
      selectionApplied = true;
    }
    const text = formatNarrativeDialogue(content);
    return text ? [formatNarrativeExperience(episode, text)] : [];
  });
  if (current.selection && !selectionApplied) {
    history.push(formatNarrativeExperience(current, formatNarrativeDialogue({ narrative: "",
      choiceBackground: current.selection.choice.background,
      selectedAction: `${current.selection.label}：${current.selection.description}`
    })));
  }
  return [summary?.text, ...history, formatNarrativeExperience(current, formatNarrativeDialogue({ narrative: current.narrative, decisionResult: current.decisionResult }))].filter(Boolean).join("\n\n");
}

/** Committed, uncovered experiences only; used when routing before a current passage exists. */
export function narrativeCommittedHistory(run: InternalRunState): string {
  const history = buildNarrativeStoryHistory(run.narrative, run.turnRecords);
  const episodes = history.episodes.flatMap((entry) => {
    const episode = run.narrative.episodes.find((candidate) => candidate.id === entry.id);
    if (!episode) return [];
    const text = formatNarrativeDialogue(narrativeExperienceContent(run.narrative, episode, run.turnRecords));
    return text ? [formatNarrativeExperience(episode, text)] : [];
  });
  return [history.summary?.text, ...episodes].filter(Boolean).join("\n\n");
}
