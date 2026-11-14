import { randomUUID } from "node:crypto";
import seedrandom from "seedrandom";
import type { ChoiceCheck, ChoiceRoll, DecisionType, NarrativeWorldDefinition, StatKey } from "@reroll/shared";
import type { InternalRunState } from "./engine.js";

export function choiceProbability(value: number, threshold: number, risk: number): number {
  const ratio = Math.max(0, value) / threshold;
  const opportunity = ratio * (1 - risk);
  return opportunity + risk === 0 ? 0 : opportunity / (opportunity + risk);
}

export function prepareChoiceCheck(run: InternalRunState, world: NarrativeWorldDefinition, authored?: { stat: StatKey; difficulty: number }): ChoiceCheck {
  const id = `choice:${randomUUID()}`;
  const stats = ["family", "intelligence", "charisma", "fortune"] as const;
  const rng = seedrandom(`${run.seed}:${id}:attribute`);
  const stat = authored?.stat ?? stats[Math.floor(rng() * stats.length)]!;
  const actId = run.narrative.actRuntime?.actId;
  const actIndex = world.mainlineActs?.findIndex((act) => act.id === actId) ?? -1;
  const threshold = authored?.difficulty ?? world.progression?.choiceDifficulties?.[actIndex];
  if (!threshold || !Number.isFinite(threshold)) throw new Error("decision_difficulty_missing");
  return {
    id, stat, value: run.stats[stat], threshold: threshold,
    actId,
    probabilities: Object.fromEntries((["safe", "balanced", "risky"] as const).map((decision) => [
      decision, choiceProbability(run.stats[stat], threshold, run.tuningSnapshot.decision.profiles[decision].risk)
    ])) as ChoiceCheck["probabilities"]
  };
}

export function rollChoice(run: InternalRunState, decision: DecisionType): ChoiceRoll {
  const choice = run.nextMilestoneChoice;
  if (!choice?.check) throw new Error("decision_check_missing");
  const existing = run.choiceExecution;
  if (existing) {
    if (existing.choiceId !== choice.check.id || !existing.roll || existing.roll.decision !== decision) throw new Error("decision_already_selected");
    return existing.roll;
  }
  const roll = seedrandom(`${run.seed}:${choice.check.id}:roll`)();
  const probability = choice.check.probabilities[decision];
  const result = { decision, roll, probability, success: roll < probability };
  run.choiceExecution = { choiceId: choice.check.id, roll: result };
  return result;
}

export function selectDirectChoice(run: InternalRunState, optionId: string): void {
  const choice = run.nextMilestoneChoice;
  if (choice?.mode !== "direct" || !choice.options.some((option) => option.id === optionId)) throw new Error("direct_choice_invalid");
  const choiceId = choice.publicIdentity!;
  if (run.choiceExecution) {
    if (run.choiceExecution.mode !== "direct" || run.choiceExecution.choiceId !== choiceId || run.choiceExecution.optionId !== optionId) throw new Error("decision_already_selected");
    return;
  }
  run.choiceExecution = { choiceId, mode: "direct", optionId };
}

export function canOpenChoiceSurvival(check: ChoiceCheck, roll: ChoiceRoll): boolean {
  return roll.decision === "risky" && !roll.success && check.value < check.threshold / 2;
}
