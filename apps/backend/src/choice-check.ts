import { randomUUID } from "node:crypto";
import seedrandom from "seedrandom";
import type { ChoiceCheck, ChoiceRoll, DecisionType, NarrativeWorldDefinition } from "@reroll/shared";
import type { InternalRunState } from "./engine.js";
import { resolveNarrativeStageGate } from "./narrative.js";

export function choiceProbability(value: number, threshold: number, risk: number): number {
  const ratio = Math.max(0, value) / threshold;
  const opportunity = ratio * (1 - risk);
  return opportunity + risk === 0 ? 0 : opportunity / (opportunity + risk);
}

export function prepareChoiceCheck(run: InternalRunState, world: NarrativeWorldDefinition): ChoiceCheck {
  const id = `choice:${randomUUID()}`;
  const stats = ["family", "intelligence", "charisma", "fortune"] as const;
  const rng = seedrandom(`${run.seed}:${id}:attribute`);
  const stat = stats[Math.floor(rng() * stats.length)]!;
  const beat = run.narrative.actRuntime?.beat ?? "setup";
  const stage = beat === "setup" ? "opening" : beat === "payoff" ? "climax" : beat;
  const gate = resolveNarrativeStageGate(run, world, stage);
  if (!gate || !Number.isFinite(gate.threshold) || gate.threshold <= 0) throw new Error("decision_gate_missing");
  return {
    id, stat, value: run.stats[stat], threshold: gate.threshold,
    actId: run.narrative.actRuntime?.actId, beat,
    probabilities: Object.fromEntries((["safe", "balanced", "risky"] as const).map((decision) => [
      decision, choiceProbability(run.stats[stat], gate.threshold, run.tuningSnapshot.decision.profiles[decision].risk)
    ])) as ChoiceCheck["probabilities"]
  };
}

export function rollChoice(run: InternalRunState, decision: DecisionType): ChoiceRoll {
  const choice = run.nextMilestoneChoice;
  if (!choice?.check) throw new Error("decision_check_missing");
  const existing = run.choiceExecution;
  if (existing) {
    if (existing.choiceId !== choice.check.id || existing.roll.decision !== decision) throw new Error("decision_already_selected");
    return existing.roll;
  }
  const roll = seedrandom(`${run.seed}:${choice.check.id}:roll`)();
  const probability = choice.check.probabilities[decision];
  const result = { decision, roll, probability, success: roll < probability };
  run.choiceExecution = { choiceId: choice.check.id, roll: result };
  return result;
}

export function canOpenChoiceSurvival(check: ChoiceCheck, roll: ChoiceRoll): boolean {
  return roll.decision === "risky" && !roll.success && check.value < check.threshold / 2;
}

export const choiceRewardGuide: Record<DecisionType, string> = {
  safe: "稳健：争取有限成果或保全核心，失败承担较小损失或错失机会。",
  balanced: "适中：争取正常推进和处境改善，失败承担中等代价。",
  risky: "冒险：争取突破或关键机会，失败可能失去重要筹码。"
};
