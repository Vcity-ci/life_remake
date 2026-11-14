import { z } from "zod";
import seedrandom from "seedrandom";
import type { NarrativeActOutline, NarrativeEventFlowDefinition, NarrativeEventFlowGroup, NarrativeEventNode,
  NarrativeEventResult, NarrativeStoryPackDefinition } from "@reroll/shared";
import type { InternalRunState } from "../engine.js";

const text = z.string().trim().min(1);
const lifeBeforeSchema = z.object({ minYears: z.number().int().nonnegative(),
  maxYears: z.number().int().nonnegative(), context: text }).strict()
  .refine((range) => range.maxYears >= range.minYears, "life_interval_range_invalid");
const resultSchema = z.object({ result: text, grantItems: z.array(text).optional(),
  consumeItems: z.array(text).optional(), endsFlow: z.boolean().optional(),
  nextEventIds: z.array(text).optional(), nextFlowIds: z.array(text).optional() }).strict();
const eventSchema = z.union([
  z.object({ id: text, kind: z.enum(["life", "scene"]), entry: text.optional(), lifeBefore: lifeBeforeSchema.optional(), situation: text, outcome: resultSchema }).strict(),
  z.object({ id: text, kind: z.literal("choice"), entry: text.optional(), lifeBefore: lifeBeforeSchema.optional(), situation: text, question: text, stakes: text,
    check: z.object({ stat: z.enum(["intelligence", "charisma", "family", "fortune", "physique"]), difficulty: z.number().positive() }).strict(),
    options: z.array(z.object({ id: z.enum(["safe", "balanced", "risky"]), label: text, action: text,
      success: resultSchema, failure: resultSchema }).strict()).length(3) }).strict(),
  z.object({ id: text, kind: z.literal("decision"), entry: text.optional(), lifeBefore: lifeBeforeSchema.optional(), situation: text, question: text, stakes: text,
    options: z.array(z.object({ id: text, label: text, action: text, outcome: resultSchema }).strict()).min(2) }).strict(),
  z.object({ id: text, kind: z.literal("settlement"), entry: text.optional(), lifeBefore: lifeBeforeSchema.optional(), situation: text,
    rules: z.array(z.object({ id: text, condition: text, disposition: text, grantItems: z.array(text).optional(),
      consumeItems: z.array(text).optional(), endsFlow: z.boolean().optional(), nextEventIds: z.array(text).optional(), nextFlowIds: z.array(text).optional() }).strict()).min(1) }).strict()
]);
const flowSchema = z.object({ id: text, revision: text,
  protocolVersion: z.literal(2).optional(),
  actEntries: z.record(z.array(text).min(1)).optional(),
  roles: z.array(z.object({ id: text, kind: z.enum(["character", "location", "item", "ability"]), identity: text, name: text.optional() }).strict()),
  originRoles: z.array(text).optional(),
  items: z.array(z.object({ id: text, roleId: text, description: text }).strict()),
  groups: z.array(z.object({ id: text, actIds: z.array(text).min(1), narrativeRole: text, label: text,
    entry: text, requiresItems: z.array(text).optional(), assetRoles: z.array(text).optional(),
    entryRequirements: z.object({ intelligence: z.number().nonnegative().optional(), charisma: z.number().nonnegative().optional(),
      family: z.number().nonnegative().optional(), fortune: z.number().nonnegative().optional(), physique: z.number().nonnegative().optional() }).strict().optional(),
    preparation: text.optional(), routing: z.literal("planned").optional(), events: z.array(eventSchema).min(1) }).strict()).min(1)
}).strict();

export function validateNarrativeEventFlow(raw: unknown, pack: Pick<NarrativeStoryPackDefinition, "id" | "acts" | "eventFlowId">): NarrativeEventFlowDefinition {
  const flow = flowSchema.parse(raw);
  if (flow.protocolVersion === 2 && !flow.actEntries) throw new Error("event_flow_act_entry_missing");
  if (flow.id !== pack.eventFlowId || flow.id !== pack.id) throw new Error("event_flow_identity_invalid");
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  const actIds = new Set(pack.acts.map((act) => act.id));
  const roleIds = new Set(flow.roles.map((role) => role.id));
  const itemIds = new Set(flow.items.map((item) => item.id));
  if (!unique(flow.roles.map((role) => role.id)) || !unique(flow.items.map((item) => item.id)) ||
      !unique(flow.groups.map((group) => group.id)) || !unique(flow.groups.flatMap((group) => group.events.map((event) => event.id)))) throw new Error("event_flow_duplicate_identity");
  if (flow.items.some((item) => !roleIds.has(item.roleId))) throw new Error("event_flow_item_role_invalid");
  if (flow.originRoles?.some((id) => !roleIds.has(id))) throw new Error("event_flow_origin_role_invalid");
  for (const group of flow.groups) {
    if (group.actIds.some((id) => !actIds.has(id)) || group.requiresItems?.some((id) => !itemIds.has(id)) ||
      group.assetRoles?.some((id) => !roleIds.has(id))) throw new Error("event_flow_group_reference_invalid");
    let hasExit = false;
    for (const event of group.events) {
      const results = event.kind === "decision" ? event.options.map((option) => option.outcome)
        : event.kind === "choice" ? event.options.flatMap((option) => [option.success, option.failure])
        : event.kind === "settlement" ? event.rules : [event.outcome];
      if ((event.kind === "choice" || event.kind === "decision") && !unique(event.options.map((option) => option.id))) throw new Error("event_flow_options_invalid");
      if (event.kind === "settlement" && !unique(event.rules.map((rule) => rule.id))) throw new Error("event_flow_rules_invalid");
      if (group.routing === "planned" && !event.entry) throw new Error("event_flow_unit_entry_missing");
      hasExit ||= results.some((result) => result.endsFlow === true);
      if (results.some((result) => [...(result.grantItems ?? []), ...(result.consumeItems ?? [])].some((id) => !itemIds.has(id)))) throw new Error("event_flow_result_item_invalid");
      for (const result of results) {
        if (result.nextEventIds?.some((id) => !group.events.some((node) => node.id === id)) ||
            result.nextFlowIds?.some((id) => !flow.groups.some((candidate) => candidate.id === id && candidate.actIds.some((act) => group.actIds.includes(act))))) throw new Error("event_flow_continuation_invalid");
        if (flow.actEntries && (result.endsFlow ? result.nextEventIds !== undefined || result.nextFlowIds === undefined
          : result.nextEventIds === undefined || result.nextEventIds.length === 0 || result.nextFlowIds !== undefined)) throw new Error("event_flow_continuation_missing");
      }
    }
    if (group.routing === "planned" && !hasExit) throw new Error("event_flow_exit_missing");
  }
  if (pack.acts.some((act) => !flow.groups.some((group) => group.actIds.includes(act.id)))) throw new Error("event_flow_act_empty");
  if (flow.actEntries && (Object.keys(flow.actEntries).some((id) => !actIds.has(id)) || pack.acts.some((act) =>
    !flow.actEntries![act.id]?.length || flow.actEntries![act.id].some((id) => !flow.groups.some((group) => group.id === id && group.actIds.includes(act.id)))))) throw new Error("event_flow_act_entry_invalid");
  // `eventFlowRoles` grants originRoles to the act that owns the first group.
  // Keep the authored order contract explicit: the first group is the opening act.
  if (!flow.groups[0].actIds.includes(pack.acts[0].id)) throw new Error("event_flow_first_group_act_invalid");
  return flow;
}

/** Runtime capability is authored by the protocol, never selected by a route ID. */
export function eventFlowRuntimeVersion(definition?: NarrativeEventFlowDefinition): 18 | 20 | 22 {
  return definition?.protocolVersion === 2 ? 22 : definition ? 20 : 18;
}

/** A newly published protocol makes its old saves read-only, without migrating them. */
export function canAdvanceEventFlowVersion(version: number, published?: NarrativeEventFlowDefinition): boolean {
  return version === eventFlowRuntimeVersion(published);
}

export function eventFlowRoles(definition: NarrativeEventFlowDefinition, actId: string) {
  const authored = JSON.stringify(definition.groups.filter((group) => group.actIds.includes(actId)));
  const explicit = definition.groups.filter((group) => group.actIds.includes(actId)).flatMap((group) => group.assetRoles ?? []);
  if (definition.groups[0]?.actIds.includes(actId)) explicit.push(...(definition.originRoles ?? []));
  return definition.roles.filter((role) => explicit.includes(role.id) || authored.includes("{{" + role.id + "}}") ||
    definition.items.some((item) => item.roleId === role.id && authored.includes('"' + item.id + '"')));
}

export function eventFlowCatalog(definition: NarrativeEventFlowDefinition, actId: string) {
  return definition.groups.filter((group) => group.actIds.includes(actId)).map((group) => ({
    id: group.id, label: group.label, narrativeRole: group.narrativeRole, entry: group.entry,
    requiresItems: group.requiresItems ?? []
  }));
}

/** The act card owns run-local role names only; flow selection is a routing concern. */
export function validateEventFlowBindings(run: InternalRunState, card: NarrativeActOutline): void {
  const definition = run.narrative.version >= 19 ? run.storyPackSnapshot?.eventFlow : undefined;
  if (!definition) return;
  const bindings = card.flowBindings ?? [];
  const roles = eventFlowRoles(definition, card.actId);
  if (new Set(bindings.map((binding) => binding.roleId)).size !== bindings.length ||
      bindings.some((binding) => !roles.some((role) => role.id === binding.roleId) || !binding.name.trim()) ||
      roles.some((role) => !bindings.some((binding) => binding.roleId === role.id))) throw new Error("event_flow_bindings_invalid");
  for (const binding of bindings) {
    const previous = run.narrative.eventFlow?.bindings[binding.roleId];
    if (previous && previous !== binding.name) throw new Error("event_flow_binding_changed");
  }
}

export function bindEventFlowText(text: string, bindings: Record<string, string>): string {
  let bound = text;
  for (const [role, name] of Object.entries(bindings)) bound = bound.replaceAll("{{" + role + "}}", name);
  if (bound.includes("{{")) throw new Error("event_flow_unbound_role");
  return bound;
}

function itemInstanceId(run: InternalRunState, itemId: string): string { return run.storyPackSnapshot!.id + ":item:" + itemId; }
export function hasEventFlowItem(run: InternalRunState, itemId: string): boolean {
  return run.items.some((item) => item.id === itemInstanceId(run, itemId));
}

export interface EventFlowStep {
  flow: NarrativeEventFlowGroup;
  event: NarrativeEventNode;
  eventIndex: number;
}

/** One group remains active until its complete result has been observed. */
export function currentEventFlowStep(run: InternalRunState): EventFlowStep | undefined {
  const definition = run.narrative.version >= 19 ? run.storyPackSnapshot?.eventFlow : undefined;
  const runtime = run.narrative.actRuntime;
  if (!definition || !runtime?.outline || runtime.admittedAtAge === undefined) return;
  validateEventFlowBindings(run, runtime.outline);
  const state = run.narrative.eventFlow ??= { actId: runtime.actId, eventIndex: 0, bindings: {}, completed: [], completedFlows: [] };
  Object.assign(state.bindings, Object.fromEntries(runtime.outline.flowBindings!.map((binding) => [binding.roleId, binding.name])));
  if (state.actId !== runtime.actId) {
    state.actId = runtime.actId; state.flowId = undefined; state.eventIndex = 0; state.lifeInterval = undefined;
  }
  // A group is opened only by the in-act router. No act card pre-selects it.
  if (!state.flowId) return undefined;
  const flow = definition.groups.find((group) => group.id === state.flowId && group.actIds.includes(runtime.actId));
  if (!flow ||
      state.completedFlows.some((entry) => entry.flowId === flow.id) ||
      (!state.completed.some((entry) => entry.flowId === flow.id) &&
        flow.requiresItems?.some((id) => !hasEventFlowItem(run, id)))) throw new Error("event_flow_active_group_invalid");
  const event = flow.events[state.eventIndex];
  if (!event) throw new Error("event_flow_event_missing");
  return { flow, event, eventIndex: state.eventIndex };
}

/** Ordinary years are counted by committed age, never by generation attempts. */
export function prepareEventFlowLifeInterval(run: InternalRunState) {
  if (run.narrative.version < 20) return undefined;
  const step = currentEventFlowStep(run);
  if (!step?.event.lifeBefore) return undefined;
  const state = run.narrative.eventFlow!;
  const { minYears, maxYears, context } = step.event.lifeBefore;
  let interval = state.lifeInterval;
  if (!interval || interval.actId !== state.actId || interval.flowId !== step.flow.id || interval.nodeId !== step.event.id) {
    const random = seedrandom(`${run.seed}:event-life:${state.actId}:${step.flow.id}:${step.event.id}`)();
    const years = minYears + Math.floor(random * (maxYears - minYears + 1));
    interval = state.lifeInterval = { actId: state.actId, flowId: step.flow.id, nodeId: step.event.id,
      fromAge: run.age, throughAge: run.age + years };
  }
  const remainingYears = Math.max(0, interval.throughAge - run.age);
  return remainingYears ? { ...interval, remainingYears,
    context: bindEventFlowText(context, state.bindings) } : undefined;
}

/** Admission is latched at group entry, independently of the once-per-act admission. */
export function prepareEventFlowEntry(run: InternalRunState) {
  if (run.narrative.version < 20) return undefined;
  const step = currentEventFlowStep(run);
  if (!step) return undefined;
  const state = run.narrative.eventFlow!;
  const admitted = state.admittedFlows ??= [];
  if (admitted.includes(step.flow.id)) return undefined;
  const deficits = Object.entries(step.flow.entryRequirements ?? {}).flatMap(([stat, target]) => {
    const key = stat as keyof typeof run.stats;
    return run.stats[key] < target! ? [{ stat: key, value: run.stats[key], target: target! }] : [];
  });
  if (!deficits.length) { admitted.push(step.flow.id); return undefined; }
  return { flowId: step.flow.id, label: step.flow.label, context: step.flow.preparation ?? step.flow.entry, deficits };
}

export interface EventFlowRenderInput {
  flowId: string;
  label: string;
  narrativeRole: string;
  eventIndex: number;
  kind: NarrativeEventNode["kind"];
  situation: string;
  result?: string;
  question?: string;
  stakes?: string;
  options?: Array<{ id: string; label: string; action: string }>;
  rules?: Array<{ id: string; condition: string; disposition: string }>;
}

export function eventFlowRenderInput(run: InternalRunState, step: EventFlowStep): EventFlowRenderInput {
  const bind = (text: string) => bindEventFlowText(text, run.narrative.eventFlow!.bindings);
  const event = step.event;
  return { flowId: step.flow.id, label: step.flow.label, narrativeRole: step.flow.narrativeRole,
    eventIndex: step.eventIndex, kind: event.kind, situation: bind(event.situation),
    ...(event.kind === "choice" || event.kind === "decision" ? { question: bind(event.question), stakes: bind(event.stakes),
      options: event.options.map((option) => ({ id: option.id, label: bind(option.label), action: bind(option.action) })) }
      : event.kind === "settlement" ? { rules: event.rules.map((rule) => ({ id: rule.id,
        condition: bind(rule.condition), disposition: bind(rule.disposition) })) }
      : { result: bind(event.outcome.result) }) };
}

export function eventFlowResult(run: InternalRunState, outcome: string): NarrativeEventResult {
  const step = currentEventFlowStep(run);
  if (!step) throw new Error("event_flow_step_missing");
  return nodeResult(step.event, outcome);
}

function nodeResult(event: NarrativeEventNode, outcome: string): NarrativeEventResult {
  if (event.kind === "settlement") {
    const rule = event.rules.find((entry) => outcome === "settlement:" + entry.id);
    if (!rule) throw new Error("event_flow_resolution_invalid");
    return { ...rule, result: rule.disposition };
  }
  if (event.kind === "decision") {
    const option = event.options.find((option) => outcome === "decision:" + option.id);
    if (!option) throw new Error("event_flow_decision_invalid");
    return option.outcome;
  }
  if (event.kind !== "choice") {
    if (outcome !== "experience") throw new Error("event_flow_result_invalid");
    return event.outcome;
  }
  const [optionId, result] = outcome.split(":");
  const option = event.options.find((option) => option.id === optionId);
  if (!option || (result !== "success" && result !== "failure")) throw new Error("event_flow_result_invalid");
  return option[result];
}

/** The planner sees applicability and selects an identity; it cannot rewrite outcomes. */
export function availableNextEventUnits(run: InternalRunState, step: EventFlowStep) {
  const completed = new Set(run.narrative.eventFlow!.completed.filter((entry) => entry.flowId === step.flow.id).map((entry) => entry.nodeId));
  const source = run.narrative.eventFlow!.completed.filter((entry) => entry.flowId === step.flow.id).at(-1);
  const allowed = source ? nodeResult(step.flow.events.find(event => event.id === source.nodeId)!, source.outcome).nextEventIds : undefined;
  return step.flow.events.filter((event) => !completed.has(event.id) && (!allowed || allowed.includes(event.id))).map((event) => ({
    id: event.id, kind: event.kind, entry: bindEventFlowText(event.entry!, run.narrative.eventFlow!.bindings),
    situation: bindEventFlowText(event.situation, run.narrative.eventFlow!.bindings)
  }));
}

export function availableNextEventFlows(run: InternalRunState) {
  const definition = run.storyPackSnapshot!.eventFlow!;
  const state = run.narrative.eventFlow!;
  const completed = new Set(state.completedFlows.map((entry) => entry.flowId));
  const source = state.completed.filter(entry => entry.flowId === state.flowId).at(-1);
  const previous = source && definition.groups.find(group => group.id === source.flowId)?.events.find(event => event.id === source.nodeId);
  const allowed = !state.flowId ? definition.actEntries?.[run.narrative.actRuntime!.actId]
    : previous && source ? nodeResult(previous, source.outcome).nextFlowIds : undefined;
  return eventFlowCatalog(definition, run.narrative.actRuntime!.actId).filter((group) =>
    group.id !== state.flowId && !completed.has(group.id) && (!allowed || allowed.includes(group.id)) && group.requiresItems.every((id) => hasEventFlowItem(run, id)));
}

/** Numeric inventory is never supplied by, or writable through, continuity maintenance. */
export function applyEventFlowResultItems(run: InternalRunState, result: NarrativeEventResult): void {
  const definition = run.storyPackSnapshot!.eventFlow!;
  for (const itemId of result.consumeItems ?? []) {
    if (!hasEventFlowItem(run, itemId)) throw new Error("event_flow_delivery_item_missing");
    run.items = run.items.filter((item) => item.id !== itemInstanceId(run, itemId));
  }
  for (const itemId of result.grantItems ?? []) {
    if (hasEventFlowItem(run, itemId)) continue;
    const item = definition.items.find((item) => item.id === itemId)!;
    run.items.push({ id: itemInstanceId(run, itemId), name: run.narrative.eventFlow!.bindings[item.roleId]!,
      rarity: "rare", description: item.description, obtainedAge: run.age, effects: [] });
  }
}
