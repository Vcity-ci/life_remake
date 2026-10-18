import type { NarrativeTask } from "../../narrative-prompts.js";
import type { NarrativeContextSection, NarrativeTaskContextProfile } from "./types.js";

const ALL_SECTIONS: NarrativeContextSection[] = [
  "persona", "talents", "seedHints", "origin", "world", "palette", "mainline", "route", "handoff", "lore",
  "styleExamples", "authorNote",
  "characters", "factDirectory", "facts", "resolvedFacts", "locations", "abilities", "assets",
  "memories", "digests", "ending", "history", "raw", "task"
];

const TASK_SECTIONS: Record<NarrativeTask, NarrativeContextSection[]> = {
  origin: ["persona", "talents", "seedHints", "origin", "world", "task"],
  curation: ["task"],
  horizon: ["persona", "origin", "world", "mainline", "route", "handoff", "lore", "characters", "facts", "history", "task"],
  settlement: ["task"],
  continuity: ["task"],
  planning: ["persona", "talents", "origin", "world", "palette", "mainline", "route", "lore", "facts", "history", "authorNote", "task"],
  observation: ["task"],
  background: ["persona", "talents", "origin", "world", "palette", "route", "lore", "characters", "factDirectory", "facts", "locations", "abilities", "styleExamples", "history", "authorNote", "task"],
  rendering: ["persona", "talents", "origin", "world", "palette", "route", "lore", "characters", "factDirectory", "facts", "locations", "abilities", "styleExamples", "history", "authorNote", "task"],
  dynamic: ["persona", "talents", "origin", "world", "palette", "route", "lore", "characters", "factDirectory", "facts", "locations", "abilities", "styleExamples", "history", "authorNote", "task"],
  reviewing: ["task"],
  decision: ["persona", "talents", "origin", "world", "palette", "route", "lore", "characters", "facts", "locations", "abilities", "styleExamples", "history", "authorNote", "task"],
  closure: ["persona", "origin", "mainline", "handoff", "facts", "digests", "task"],
  ending: ["persona", "talents", "origin", "world", "ending", "task"]
};

const TASK_HISTORY: Record<NarrativeTask, NarrativeTaskContextProfile["history"]> = {
  origin: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  curation: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  horizon: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 1, requiredRecentRounds: 1 },
  settlement: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  continuity: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  planning: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  observation: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  background: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 3, requiredRecentRounds: 3 },
  rendering: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 3, requiredRecentRounds: 3 },
  dynamic: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 3, requiredRecentRounds: 3 },
  reviewing: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  decision: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 3, requiredRecentRounds: 3 },
  closure: { includeHeadMemory: true, includeArchive: false, recentRoundLimit: 1, requiredRecentRounds: 0 },
  ending: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 }
};

export function narrativeTaskContextProfile(task: NarrativeTask): NarrativeTaskContextProfile {
  return {
    task,
    allowedSections: [...(TASK_SECTIONS[task] ?? ALL_SECTIONS)],
    history: { ...TASK_HISTORY[task] }
  };
}
