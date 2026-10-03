import type { NarrativeTask } from "../../narrative-prompts.js";
import type { NarrativeContextLayer, NarrativeContextSection, NarrativeTaskContextProfile } from "./types.js";

const TASK_BUDGETS: Record<NarrativeTask, number> = {
  origin: 3_000,
  background: 3_600,
  planning: 4_200,
  observation: 1_200,
  curation: 7_000,
  horizon: 5_200,
  settlement: 1_600,
  continuity: 3_000,
  reviewing: 3_200,
  rendering: 6_000,
  dynamic: 6_000,
  decision: 5_200,
  closure: 4_000,
  ending: 7_000
};

const TASK_LAYER_RATIOS: Record<NarrativeTask, Record<NarrativeContextLayer, number>> = {
  origin: { stable: .32, runtime: .08, active: .05, recall: .10, history: .15, task: .30 },
  background: { stable: .18, runtime: .08, active: .08, recall: .12, history: .34, task: .20 },
  planning: { stable: .12, runtime: .22, active: .22, recall: .15, history: .19, task: .10 },
  observation: { stable: 0, runtime: 0, active: 0, recall: 0, history: 0, task: 1 },
  curation: { stable: .02, runtime: .03, active: .05, recall: .10, history: .05, task: .75 },
  horizon: { stable: .10, runtime: .26, active: .24, recall: .22, history: .10, task: .08 },
  settlement: { stable: 0, runtime: 0, active: 0, recall: 0, history: 0, task: 1 },
  continuity: { stable: 0, runtime: 0, active: 0, recall: 0, history: 0, task: 1 },
  reviewing: { stable: 0, runtime: 0, active: 0, recall: 0, history: 0, task: 1 },
  rendering: { stable: .14, runtime: .13, active: .25, recall: .24, history: .14, task: .10 },
  dynamic: { stable: .14, runtime: .14, active: .22, recall: .24, history: .16, task: .10 },
  decision: { stable: .10, runtime: .10, active: .28, recall: .25, history: .17, task: .10 },
  closure: { stable: .08, runtime: .25, active: .30, recall: .17, history: .10, task: .10 },
  ending: { stable: .10, runtime: .15, active: .25, recall: .25, history: .15, task: .10 }
};

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
  continuity: ["characters", "facts", "locations", "abilities", "task"],
  planning: ["persona", "talents", "origin", "world", "palette", "mainline", "route", "lore", "characters", "facts", "locations", "abilities", "history", "authorNote", "task"],
  observation: ["task"],
  background: ["persona", "talents", "origin", "world", "palette", "route", "lore", "characters", "factDirectory", "facts", "locations", "abilities", "styleExamples", "history", "authorNote", "task"],
  rendering: ["persona", "talents", "origin", "world", "palette", "route", "lore", "characters", "factDirectory", "facts", "locations", "abilities", "memories", "styleExamples", "history", "authorNote", "task"],
  dynamic: ["persona", "talents", "origin", "world", "palette", "route", "lore", "characters", "factDirectory", "facts", "locations", "abilities", "memories", "styleExamples", "history", "authorNote", "task"],
  reviewing: ["task"],
  decision: ["persona", "talents", "origin", "world", "palette", "route", "characters", "facts", "locations", "abilities", "memories", "styleExamples", "history", "authorNote", "task"],
  closure: ["persona", "origin", "mainline", "handoff", "facts", "digests", "task"],
  ending: ["persona", "talents", "origin", "world", "ending", "task"]
};

const TASK_HISTORY: Record<NarrativeTask, NarrativeTaskContextProfile["history"]> = {
  origin: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  curation: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  horizon: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 1, requiredRecentRounds: 1 },
  settlement: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  continuity: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  planning: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 1, requiredRecentRounds: 1 },
  observation: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  background: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 1, requiredRecentRounds: 1 },
  rendering: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 2, requiredRecentRounds: 1 },
  dynamic: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 2, requiredRecentRounds: 1 },
  reviewing: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 },
  decision: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 1, requiredRecentRounds: 1 },
  closure: { includeHeadMemory: true, includeArchive: false, recentRoundLimit: 1, requiredRecentRounds: 0 },
  ending: { includeHeadMemory: false, includeArchive: false, recentRoundLimit: 0, requiredRecentRounds: 0 }
};

export function narrativeTaskContextProfile(task: NarrativeTask): NarrativeTaskContextProfile {
  return {
    task,
    allowedSections: [...(TASK_SECTIONS[task] ?? ALL_SECTIONS)],
    history: { ...TASK_HISTORY[task] },
    budget: {
      maxEstimatedTokens: TASK_BUDGETS[task],
      layerRatios: { ...TASK_LAYER_RATIOS[task] }
    }
  };
}
