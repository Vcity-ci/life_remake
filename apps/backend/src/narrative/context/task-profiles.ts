import type { NarrativeTask } from "../../narrative-prompts.js";
import type { NarrativeContextSection, NarrativeTaskContextProfile } from "./types.js";

const ALL_SECTIONS: NarrativeContextSection[] = [
  "persona", "protagonist", "talents", "seedHints", "origin", "world", "worldSituation", "actWorld", "mainline", "route", "lore",
  "styleExamples", "authorNote",
  "characters", "factDirectory", "facts", "resolvedFacts", "locations", "abilities", "assets",
  "memories", "digests", "ending", "history", "storyHistory", "raw", "task"
];

const TASK_SECTIONS: Record<NarrativeTask, NarrativeContextSection[]> = {
  origin: ["persona", "talents", "seedHints", "origin", "world", "worldSituation", "lore", "task"],
  curation: ["task"],
  horizon: ["persona", "origin", "world", "mainline", "route", "lore", "characters", "facts", "history", "task"],
  settlement: ["task"],
  continuity: ["task"],
  planning: ["protagonist", "world", "worldSituation", "mainline", "route", "lore", "storyHistory", "task"],
  observation: ["task"],
  background: ["actWorld", "route", "protagonist", "lore", "characters", "facts", "locations", "abilities", "styleExamples", "storyHistory", "task"],
  rendering: ["actWorld", "route", "protagonist", "lore", "characters", "facts", "locations", "abilities", "styleExamples", "storyHistory", "task"],
  dynamic: ["actWorld", "route", "protagonist", "lore", "characters", "facts", "locations", "abilities", "styleExamples", "storyHistory", "task"],
  decision: ["actWorld", "route", "protagonist", "lore", "characters", "facts", "locations", "abilities", "styleExamples", "storyHistory", "task"],
  closure: ["protagonist", "storyHistory", "task"],
  ending: ["actWorld", "protagonist", "storyHistory", "ending", "task"]
};

const TASK_HISTORY: Record<NarrativeTask, NarrativeTaskContextProfile["history"]> = {
  origin: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  curation: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  horizon: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 1, requiredRecentRounds: 1 },
  settlement: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  continuity: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  planning: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  observation: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  background: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  rendering: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  dynamic: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  decision: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  closure: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  ending: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 }
};

export function narrativeTaskContextProfile(task: NarrativeTask, planningPurpose?: "initial" | "execute"): NarrativeTaskContextProfile {
  return {
    task,
    allowedSections: task === "planning" && planningPurpose
      ? planningPurpose === "initial" ? ["protagonist", "world", "worldSituation", "mainline", "route", "lore", "storyHistory", "task"] : ["task"]
      : [...(TASK_SECTIONS[task] ?? ALL_SECTIONS), ...(["planning", "background", "rendering", "dynamic", "decision"].includes(task) ? ["protagonist" as const] : [])],
    history: { ...TASK_HISTORY[task] }
  };
}
