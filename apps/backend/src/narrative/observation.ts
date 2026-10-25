import type { NarrativeBeat, PublicMilestoneChoice } from "@reroll/shared";
import type { InternalRunState } from "../engine.js";
import { formatNarrativeDialogue, formatNarrativeExperience, narrativeExperienceContent } from "../narrative-memory.js";

/** Only the latest unmet change of the same act and beat is actionable feedback. */
export function narrativeObservationGap(run: InternalRunState, actId: string, beat: Exclude<NarrativeBeat, "ending">): string | undefined {
  const observation = run.narrative.lastBeatObservation;
  return observation?.decision === "hold" && observation.actId === actId && observation.beat === beat ? observation.missing : undefined;
}

/** Three story years, including every same-year action; append the uncommitted passage once. */
export function narrativeObservationHistory(
  run: InternalRunState,
  current: { actId: string; age: number; sourceEventId: string; narrative: string;
    decisionResult?: "success" | "failure";
    selection?: { choice: PublicMilestoneChoice; label: string; description: string } }
): string {
  const episodes = run.narrative.episodes.filter((episode) =>
    episode.actId === current.actId && episode.age >= current.age - 2 && episode.age <= current.age &&
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
  return [...history, formatNarrativeExperience(current, formatNarrativeDialogue({ narrative: current.narrative, decisionResult: current.decisionResult }))].join("\n\n");
}
