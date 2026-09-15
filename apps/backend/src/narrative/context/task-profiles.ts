import type { NarrativeTask } from "../../narrative-prompts.js";
import type { NarrativeContextLayer, NarrativeTaskContextProfile } from "./types.js";

const TASK_BUDGETS: Record<NarrativeTask, number> = {
  origin: 3_000,
  background: 3_600,
  planning: 4_200,
  curation: 7_000,
  horizon: 5_200,
  reviewing: 5_000,
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
  curation: { stable: .02, runtime: .03, active: .05, recall: .10, history: .05, task: .75 },
  horizon: { stable: .10, runtime: .26, active: .24, recall: .22, history: .10, task: .08 },
  reviewing: { stable: .06, runtime: .08, active: .28, recall: .18, history: .08, task: .32 },
  rendering: { stable: .14, runtime: .13, active: .25, recall: .24, history: .14, task: .10 },
  dynamic: { stable: .14, runtime: .14, active: .22, recall: .24, history: .16, task: .10 },
  decision: { stable: .10, runtime: .10, active: .28, recall: .25, history: .17, task: .10 },
  closure: { stable: .08, runtime: .25, active: .30, recall: .17, history: .10, task: .10 },
  ending: { stable: .10, runtime: .15, active: .25, recall: .25, history: .15, task: .10 }
};

export function narrativeTaskContextProfile(task: NarrativeTask): NarrativeTaskContextProfile {
  return {
    task,
    budget: {
      maxEstimatedTokens: TASK_BUDGETS[task],
      layerRatios: { ...TASK_LAYER_RATIOS[task] }
    }
  };
}
