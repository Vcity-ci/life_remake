import type { NarrativeWorldDefinition, WorldConfig } from "@reroll/shared";
import { observeNarrativeAct, planNextEventFlow, planNextEventUnit, type NarrativeContext } from "../ai.js";
import { finalizeNarrativeActEvent, type InternalRunState } from "../engine.js";
import { narrativeObservationHistory } from "./observation.js";
import { synchronizeNarrativeAssetBatch } from "./runtime.js";
import { currentEventFlowStep, eventFlowResult, applyEventFlowResultItems, availableNextEventFlows, availableNextEventUnits, bindEventFlowText } from "./event-flow.js";

/** Resume only the recorded event; this never generates prose or rolls again. */
export async function finishPendingNarrativeActEvent(
  run: InternalRunState, world: WorldConfig, definition: NarrativeWorldDefinition,
  context: NarrativeContext, checkpoint: () => Promise<void>
): Promise<void> {
  const pending = run.pendingActFinalization;
  if (!pending || run.survivalCrisis || run.nextMilestoneChoice || run.choiceExecution) return;
  if (run.ended) { run.pendingActFinalization = undefined; return; }
  const runtime = run.narrative.actRuntime;
  const memory = run.narrative.memoryEntries.find((entry) => entry.id === "memory:" + pending.sourceEventId);
  if (runtime?.actId !== pending.actId || !runtime.outline || !memory) throw new Error("act_finalization_source_missing");
  if (pending.eventFlow) {
    await finishPendingEventFlow(run, world, definition, context, checkpoint);
    return;
  }
  if (!pending.observation) {
    const rescue = run.history.at(-1);
    const narrative = memory.text + (rescue?.tags.includes("survival_recovered") ? "\n" + rescue.summary : "");
    const episode = run.narrative.episodes.find((entry) => entry.sourceEventId === pending.sourceEventId);
    const record = episode?.turnId ? run.turnRecords.find((entry) => entry.turnId === episode.turnId) : undefined;
    pending.observation = await observeNarrativeAct(run, world, {
      callId: "finalize:" + pending.sourceEventId, actId: pending.actId, sourceEventId: pending.sourceEventId,
      outline: runtime.outline,
      recentStory: narrativeObservationHistory(run, {
        actId: pending.actId, age: memory.age, sourceEventId: pending.sourceEventId, narrative,
        decisionResult: record?.decisionResult ? (record.decisionResult.roll.success ? "success" : "failure") : undefined
      })
    }, context);
    await checkpoint();
  }
  if (pending.observation.decision !== "ongoing") {
    await synchronizeNarrativeAssetBatch(run, world, context, "act-end:" + pending.sourceEventId, definition.socialForces, true);
  }
  finalizeNarrativeActEvent(run, definition, pending.observation);
  await checkpoint();
}

async function finishPendingEventFlow(
  run: InternalRunState, world: WorldConfig, definition: NarrativeWorldDefinition,
  context: NarrativeContext, checkpoint: () => Promise<void>
): Promise<void> {
  const pending = run.pendingActFinalization!;
  const source = pending.eventFlow!;
  const step = currentEventFlowStep(run);
  if (!step || step.flow.id !== source.flowId || step.eventIndex !== source.eventIndex || step.event.id !== source.nodeId) throw new Error("event_flow_finalization_identity_invalid");
  const result = eventFlowResult(run, source.outcome);
  const state = run.narrative.eventFlow!;
  if (!state.completed.some((entry) => entry.sourceEventId === pending.sourceEventId)) {
    // The result prose and its numeric settlement are already saved. Apply its
    // inventory exactly once before choosing groups that can use those items.
    const draft = structuredClone(run);
    applyEventFlowResultItems(draft, result);
    draft.narrative.eventFlow!.completed.push({ ...source, sourceEventId: pending.sourceEventId,
      actId: pending.actId, age: run.age });
    run.items = draft.items;
    state.completed = draft.narrative.eventFlow!.completed;
    const episode = run.narrative.episodes.find((entry) => entry.sourceEventId === pending.sourceEventId);
    const record = run.turnRecords.find((entry) => entry.turnId === episode?.turnId);
    if (record) record.itemsSnapshot = structuredClone(run.items);
    await checkpoint();
  }
  const complete = result.endsFlow === true || (step.flow.routing !== "planned" && step.eventIndex === step.flow.events.length - 1);
  const groupResult = { id: step.flow.id, label: step.flow.label, narrativeRole: step.flow.narrativeRole,
    result: bindEventFlowText(result.result, state.bindings) };
  const history = () => {
    const memory = run.narrative.memoryEntries.find((entry) => entry.id === "memory:" + pending.sourceEventId)!;
    const rescue = run.history.at(-1);
    const narrative = memory.text + (rescue?.tags.includes("survival_recovered") ? "\n" + rescue.summary : "");
    const episode = run.narrative.episodes.find((entry) => entry.sourceEventId === pending.sourceEventId);
    const record = run.turnRecords.find((entry) => entry.turnId === episode?.turnId);
    return narrativeObservationHistory(run, { actId: pending.actId, age: memory.age,
      sourceEventId: pending.sourceEventId, narrative,
      decisionResult: record?.decisionResult ? record.decisionResult.roll.success ? "success" : "failure" : undefined });
  };
  if (complete && !pending.observation) {
    pending.observation = await observeNarrativeAct(run, world, {
      callId: "flow:" + pending.sourceEventId, actId: pending.actId, sourceEventId: pending.sourceEventId,
      outline: run.narrative.actRuntime!.outline!,
      recentStory: history(), eventFlow: groupResult
    }, context);
    await checkpoint();
  }
  const observation = pending.observation;
  if (complete && !observation) throw new Error("event_flow_observation_missing");
  if (!complete && observation && observation.decision !== "ongoing" && observation.decision !== "run_ended") throw new Error("event_flow_unfinished_group");
  if (!complete && step.flow.routing === "planned" && observation?.decision !== "run_ended") {
    const candidates = availableNextEventUnits(run, step);
    if (!pending.nextEventId) {
      pending.nextEventId = await planNextEventUnit(run, world, { callId: "unit:" + pending.sourceEventId,
        actId: pending.actId, outline: run.narrative.actRuntime!.outline!, recentStory: history(),
        group: { id: step.flow.id, label: step.flow.label, narrativeRole: step.flow.narrativeRole }, candidates }, context);
      await checkpoint();
    }
    if (!candidates.some((event) => event.id === pending.nextEventId)) throw new Error("event_unit_destination_invalid");
  }
  if (complete && observation?.decision === "ongoing") {
    const candidates = availableNextEventFlows(run);
    if (!pending.nextFlowId) {
      pending.nextFlowId = await planNextEventFlow(run, world, {
        callId: "flow:" + pending.sourceEventId, actId: pending.actId,
        outline: run.narrative.actRuntime!.outline!, recentStory: history(), previous: groupResult,
        candidates: candidates.map(({ id, label, narrativeRole, entry }) => ({ id, label, narrativeRole,
          entry: bindEventFlowText(entry, state.bindings) }))
      }, context);
      await checkpoint();
    }
    if (!candidates.some((group) => group.id === pending.nextFlowId)) throw new Error("event_flow_destination_invalid");
  }
  if (complete || observation?.decision === "run_ended") {
    if (!state.completedFlows.some((entry) => entry.flowId === step.flow.id)) state.completedFlows.push({
      flowId: step.flow.id, sourceEventId: pending.sourceEventId, actId: pending.actId
    });
  }
  if (observation?.decision === "act_closed" || observation?.decision === "run_ended") {
    await synchronizeNarrativeAssetBatch(run, world, context, "act-end:" + pending.sourceEventId, definition.socialForces, true);
    if (observation.decision === "run_ended") run.narrative.eventFlow!.ending = { sourceEventId: pending.sourceEventId,
      polarity: observation.endingPolarity!, evidence: observation.evidence! };
    finalizeNarrativeActEvent(run, definition, observation);
  } else {
    if (observation) run.narrative.lastActObservation = observation;
    if (complete) { state.flowId = pending.nextFlowId; state.eventIndex = 0; }
    else if (step.flow.routing === "planned") state.eventIndex = step.flow.events.findIndex((event) => event.id === pending.nextEventId);
    else state.eventIndex += 1;
    run.narrative.sceneClock = { ...run.narrative.sceneClock, mode: pending.nextClock, sameAgeTurnCount: 0 };
    run.pendingActFinalization = undefined;
  }
  await checkpoint();
}
