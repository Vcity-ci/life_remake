import type {
  EndingBlueprint,
  EventDefinition,
  NarrativeArcPhase,
  NarrativeComponentDefinition,
  NarrativeComponentRunState,
  NarrativeComponentStatus,
  NarrativeEndingState,
  NarrativeRunState,
  NarrativeThreadState,
  NarrativeWorldDefinition,
  Stats,
  StoryFactLedger,
  StoryDirectorState
} from "@reroll/shared";

export interface NarrativePromptSource {
  worldId: string;
  age: number;
  personaPrompt: string;
  stats?: Stats;
  cards: Array<{ name: string; tags: string[] }>;
  items: Array<{ name: string; tags?: string[] }>;
  story: StoryDirectorState;
  narrative: NarrativeRunState;
}

export interface ClosureReadiness {
  eligible: boolean;
  reason?: "no_mainline" | "mainline_incomplete" | "missing_arc" | "missing_decision_consequence" | "active_conflict" | "unresolved_core_fact" | "missing_blueprint";
  directionId?: string;
  requiredThreadIds?: string[];
}

export interface NarrativePromptPlan {
  storyBible: string;
  mainlineSkeleton?: string;
  styleRules: string[];
  activeLore: string[];
  plotEssentials: string[];
  activeThreads: string[];
  activeCharacters: string[];
  scene: string;
  authorNote: string;
  ending: string;
  /** Local, deterministic context budget. Never exposes identifiers to the model. */
  contextLayers?: {
    essentials: string[];
    shortTerm: string[];
    lore: string[];
  };
}

export interface EndingAssessment {
  eligible: boolean;
  polarity?: "good" | "bad";
  score?: number;
  blueprint?: EndingBlueprint;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function uniqueRecent(values: string[], max: number): string[] {
  return Array.from(new Set(values.filter(Boolean))).slice(-max);
}

function compactText(value: string, maxLen: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLen - 1))}…`;
}

function defaultScene() {
  return {
    place: "未定",
    conflict: "主线尚在展开",
    aftermath: "无"
  };
}

export function createNarrativeRunState(enabled = false): NarrativeRunState {
  return {
    version: 2,
    enabled,
    arcPhase: "setup",
    climaxCount: 0,
    payoffCount: 0,
    threads: [],
    components: [],
    activeCharacterIds: [],
    scene: defaultScene(),
    endingState: "open",
    setbackCount: 0
  };
}

export function ensureNarrativeRunState(
  state: NarrativeRunState | undefined,
  enabled = state?.enabled ?? false
): NarrativeRunState {
  const defaults = createNarrativeRunState(enabled);
  if (!state || (state.version !== 1 && state.version !== 2)) return defaults;
  const endingStates: NarrativeEndingState[] = ["open", "eligible", "locked", "guiding", "finished"];
  const phase: NarrativeArcPhase[] = ["setup", "rising", "pressure", "climax", "aftermath", "ending"];
  const sceneBeats: Exclude<EventDefinition["narrativeBeat"], "ending" | undefined>[] = [
    "setup", "escalation", "pressure", "climax", "payoff"
  ];
  const activeScene = state.activeScene &&
    typeof state.activeScene.id === "string" &&
    typeof state.activeScene.threadId === "string" &&
    sceneBeats.includes(state.activeScene.phase)
    ? {
        id: compactText(state.activeScene.id, 120),
        threadId: compactText(state.activeScene.threadId, 120),
        phase: state.activeScene.phase,
        openedAge: Math.max(0, Math.min(120, Number(state.activeScene.openedAge) || 0)),
        lastTouchedAge: Math.max(0, Math.min(120, Number(state.activeScene.lastTouchedAge) || 0))
      }
    : undefined;
  const componentStatuses: Array<Exclude<NarrativeComponentStatus, "dormant">> = [
    "introduced", "active", "escalated", "payable", "resolved"
  ];
  const normalizedComponents = Array.isArray(state.components)
    ? state.components
      .filter((component): component is NarrativeComponentRunState => Boolean(
        component?.id && componentStatuses.includes(component.status)
      ))
      .slice(-32)
      .map((component) => ({
        id: compactText(component.id, 120),
        status: component.status,
        introducedAge: Math.max(0, Math.min(120, Number(component.introducedAge) || 0)),
        lastTouchedAge: Math.max(0, Math.min(120, Number(component.lastTouchedAge) || 0)),
        facts: Array.isArray(component.facts)
          ? uniqueRecent(component.facts.map((fact) => compactText(String(fact), 120)), 6)
          : []
      }))
    : [];
  const componentsById = new Map<string, NarrativeComponentRunState>();
  for (const component of normalizedComponents) {
    const previous = componentsById.get(component.id);
    if (!previous || component.lastTouchedAge >= previous.lastTouchedAge) {
      componentsById.set(component.id, component);
    }
  }
  const components = Array.from(componentsById.values())
    .sort((a, b) => a.introducedAge - b.introducedAge || a.id.localeCompare(b.id))
    .slice(-32);
  return {
    ...defaults,
    ...state,
    version: 2,
    enabled: enabled && state.enabled !== false,
    arcPhase: phase.includes(state.arcPhase) ? state.arcPhase : defaults.arcPhase,
    climaxCount: Math.max(0, Math.min(8, Number(state.climaxCount) || 0)),
    payoffCount: Math.max(0, Math.min(8, Number(state.payoffCount) || 0)),
    threads: Array.isArray(state.threads)
      ? state.threads
        .filter((thread): thread is NarrativeThreadState => Boolean(thread?.id))
        .slice(-12)
      : [],
    activeCharacterIds: uniqueRecent(Array.isArray(state.activeCharacterIds) ? state.activeCharacterIds : [], 8),
    components,
    scene: {
      ...defaultScene(),
      ...(state.scene ?? {})
    },
    activeScene,
    lastResolvedSceneAge: Number.isFinite(state.lastResolvedSceneAge)
      ? Math.max(0, Math.min(120, Number(state.lastResolvedSceneAge)))
      : undefined,
    endingState: endingStates.includes(state.endingState) ? state.endingState : defaults.endingState,
    endingBlueprintId: state.endingBlueprintId?.trim() || undefined,
    endingPolarity: state.endingPolarity === "good" || state.endingPolarity === "bad"
      ? state.endingPolarity
      : undefined,
    endingScore: typeof state.endingScore === "number" ? state.endingScore : undefined,
    setbackCount: Math.max(0, Math.min(8, Number(state.setbackCount) || 0))
  };
}

function componentActivationMatches(
  definition: NarrativeComponentDefinition,
  state: NarrativeRunState,
  age: number,
  phase: NarrativeArcPhase | null,
  storyFlags: string[]
): boolean {
  const activation = definition.activation;
  if (!activation) return true;
  if (activation.minAge !== undefined && age < activation.minAge) return false;
  if (activation.maxAge !== undefined && age > activation.maxAge) return false;
  if (activation.phases?.length && (!phase || !activation.phases.includes(phase))) return false;
  if (activation.requiresFlags?.some((flag) => !storyFlags.includes(flag))) return false;
  if (activation.requiresThreadIds?.some((id) => !state.threads.some((thread) => thread.id === id && thread.status !== "resolved"))) {
    return false;
  }
  return true;
}

export function canAdvanceNarrativeComponent(
  current: NarrativeComponentRunState | undefined,
  target: NarrativeComponentRunState["status"]
): boolean {
  if (!current) return target === "introduced";
  if (current.status === "resolved") return false;
  if (target === "introduced") return current.status === "introduced";
  if (target === "active") return current.status === "introduced" || current.status === "active";
  if (target === "escalated") return current.status === "introduced" || current.status === "active" || current.status === "escalated";
  if (target === "payable") return current.status === "introduced" || current.status === "active" || current.status === "escalated" || current.status === "payable";
  return true;
}

function applyNarrativeComponentTransitions(
  state: NarrativeRunState,
  definition: EventDefinition,
  age: number,
  componentDefinitions: NarrativeComponentDefinition[] | undefined,
  storyFlags: string[]
): void {
  const transitions = definition.narrativeComponentTransitions ?? [];
  if (transitions.length === 0 || !componentDefinitions?.length) return;
  const definitionsById = new Map(componentDefinitions.map((component) => [component.id, component]));
  const phase = nextArcPhase(definition.narrativeBeat);
  const states = new Map(state.components.map((component) => [component.id, component]));

  for (const transition of transitions) {
    const component = definitionsById.get(transition.componentId);
    if (!component || !componentActivationMatches(component, state, age, phase, storyFlags)) continue;
    const current = states.get(component.id);
    if (!canAdvanceNarrativeComponent(current, transition.status)) continue;
    const facts = uniqueRecent([
      ...(current?.facts ?? []),
      ...(current ? [] : component.facts ?? []),
      ...(transition.fact ? [transition.fact] : [])
    ].map((fact) => compactText(fact, 120)), 6);
    states.set(component.id, {
      id: component.id,
      status: transition.status,
      introducedAge: current?.introducedAge ?? age,
      lastTouchedAge: age,
      facts
    });
  }
  state.components = Array.from(states.values())
    .sort((a, b) => a.introducedAge - b.introducedAge || a.id.localeCompare(b.id))
    .slice(-32);
}

function nextArcPhase(beat: EventDefinition["narrativeBeat"] | undefined): NarrativeArcPhase | null {
  switch (beat) {
    case "setup": return "setup";
    case "escalation": return "rising";
    case "pressure": return "pressure";
    case "climax": return "climax";
    case "payoff": return "aftermath";
    case "ending": return "ending";
    default: return null;
  }
}

function upsertThread(
  threads: NarrativeThreadState[],
  id: string,
  age: number,
  status: NarrativeThreadState["status"]
): void {
  const current = threads.find((thread) => thread.id === id);
  if (current) {
    current.status = status;
    current.lastTouchedAge = age;
    return;
  }
  threads.push({ id, status, openedAge: age, lastTouchedAge: age });
}

function eventThreadIds(definition: EventDefinition): string[] {
  return Array.from(new Set([
    ...(definition.narrativeThreadIds ?? []),
    ...(definition.opensThreads ?? []),
    ...(definition.resolvesThreads ?? [])
  ])).filter(Boolean);
}

export function applyNarrativeEvent(
  state: NarrativeRunState,
  definition: EventDefinition,
  age: number,
  componentDefinitions?: NarrativeComponentDefinition[],
  storyFlags: string[] = []
): NarrativeRunState {
  if (!state.enabled) return state;
  const next = ensureNarrativeRunState(state);
  const beat = definition.narrativeBeat;
  const targets = eventThreadIds(definition);
  const opened = definition.opensThreads ?? [];
  const resolved = definition.resolvesThreads ?? [];

  if (beat === "setup") {
    for (const id of targets) {
      upsertThread(next.threads, id, age, "seeded");
    }
  } else {
    for (const id of opened) {
      upsertThread(next.threads, id, age, "seeded");
    }
  }
  if (beat === "escalation" || beat === "pressure") {
    for (const id of targets) {
      const thread = next.threads.find((item) => item.id === id);
      if (thread && thread.status !== "resolved" && thread.status !== "climax") {
        thread.status = "escalating";
        thread.lastTouchedAge = age;
      }
    }
  }
  if (beat === "climax") {
    let reachedClimax = false;
    for (const id of targets) {
      const thread = next.threads.find((item) => item.id === id);
      if (thread && thread.status !== "resolved") {
        reachedClimax ||= thread.status !== "climax";
        thread.status = "climax";
        thread.lastTouchedAge = age;
      }
    }
    if (reachedClimax) next.climaxCount = Math.min(8, next.climaxCount + 1);
  }
  if (beat === "payoff") {
    const payoffTargets = resolved.length > 0 ? resolved : targets;
    let paid = false;
    for (const id of payoffTargets) {
      const thread = next.threads.find((item) => item.id === id);
      if (thread && thread.status === "climax") paid = true;
      if (thread) upsertThread(next.threads, id, age, "resolved");
    }
    if (paid) next.payoffCount = Math.min(8, next.payoffCount + 1);
  }

  const sceneThreadId = targets[0];
  if (beat === "setup" && sceneThreadId) {
    next.activeScene = {
      id: `${definition.id}:${age}`,
      threadId: sceneThreadId,
      phase: "setup",
      openedAge: age,
      lastTouchedAge: age
    };
  } else if (next.activeScene && sceneThreadId === next.activeScene.threadId && beat && beat !== "ending") {
    if (beat === "payoff") {
      next.lastResolvedSceneAge = age;
      next.activeScene = undefined;
    } else {
      next.activeScene = {
        ...next.activeScene,
        phase: beat,
        lastTouchedAge: age
      };
    }
  }

  const phase = nextArcPhase(beat);
  if (phase) next.arcPhase = phase;
  next.activeCharacterIds = uniqueRecent([
    ...next.activeCharacterIds,
    ...(definition.narrativeCharacterIds ?? [])
  ], 8);
  next.scene = {
    place: definition.factionId ? `${definition.factionId}相关场域` : next.scene.place,
    conflict: definition.promptHook || definition.title,
    aftermath: beat === "payoff" ? "一条旧线索已经兑现，余波仍在延续。" : "本年后果将带入下一段经历。",
    lastEventId: definition.id
  };
  applyNarrativeComponentTransitions(next, definition, age, componentDefinitions, storyFlags);
  return next;
}

export function recordNarrativeSetback(state: NarrativeRunState, cause: string): NarrativeRunState {
  if (!state.enabled) return state;
  const next = ensureNarrativeRunState(state);
  next.setbackCount = Math.min(8, next.setbackCount + 1);
  next.arcPhase = "pressure";
  next.scene = {
    ...next.scene,
    conflict: cause || "一场重大挫折改变了原本的安排。",
    aftermath: "这不是故事的终点，而是需要被承担的代价。"
  };
  return next;
}

function currentDirectionId(source: NarrativePromptSource): string | undefined {
  return source.story.activeDirectionId ?? source.story.contract.initialDirectionId;
}

function hasDecisionConsequence(ledger: StoryFactLedger | undefined): boolean {
  // A prudent commitment is still a consequence. Risky branches may add a
  // separate cost, but safe play must not make the ending structurally unreachable.
  return ledgerHasOpenKind(ledger, "commitment") || ledgerHasOpenKind(ledger, "cost");
}

function hasResolvedCoreFacts(
  source: NarrativePromptSource,
  world: NarrativeWorldDefinition
): boolean {
  const directionId = currentDirectionId(source);
  const coreThreadIds = world.routeArcs.find((route) => route.directionId === directionId)?.coreThreadIds
    ?? source.story.contract.coreThreadIds;
  if (coreThreadIds.length === 0) return false;
  const resolvedThreads = new Set(source.narrative.threads
    .filter((thread) => thread.status === "resolved")
    .map((thread) => thread.id));
  return coreThreadIds.every((threadId) => (
    resolvedThreads.has(threadId) && resolvedFactsForThreads(source.story.factLedger, [threadId])
  ));
}

/**
 * Progress gates are world data, not calendar switches. Before a gate is met
 * the engine keeps the current beat available so normal-year growth can matter.
 */
export function isNarrativeStageReady(
  source: NarrativePromptSource,
  world: NarrativeWorldDefinition | null | undefined,
  stage: "opening" | "pressure" | "climax",
  directionIdOverride?: string
): boolean {
  const directionId = directionIdOverride ?? currentDirectionId(source);
  const gate = world?.progression?.routes
    .find((route) => route.directionId === directionId)
    ?.gates?.[stage];
  if (!gate || !source.stats) return true;
  return weightedStatScore(source.stats, gate.weights) >= gate.threshold;
}

/**
 * Latches a completed mainline only after the world-defined dramatic contract
 * is actually satisfied. This remains internal; it merely authorizes a model
 * to request the ending tool on a later turn.
 */
export function refreshNarrativeMainlineCompletion(
  source: NarrativePromptSource,
  world: NarrativeWorldDefinition | null | undefined
): boolean {
  if (!source.narrative.enabled) return true;
  if (source.story.mainlineCompleted) return true;
  const directionId = currentDirectionId(source);
  if (!directionId || !source.story.contract.initialDirectionId || source.story.committedDirectionIds.length === 0) {
    return false;
  }

  const rule = world?.progression?.completion;
  if (!rule) {
    const complete = source.narrative.climaxCount >= 1 && source.narrative.payoffCount >= 1;
    if (complete) {
      source.story.mainlineCompleted = true;
      source.story.mainlineCompletedAge = source.age;
    }
    return complete;
  }
  if (rule.requireCommittedDirection !== false && source.story.committedDirectionIds.length === 0) return false;
  if (rule.requireDecisionConsequence !== false && !hasDecisionConsequence(source.story.factLedger)) return false;
  if (rule.requireClimax !== false && source.narrative.climaxCount < 1) return false;
  if (rule.requirePayoff !== false && source.narrative.payoffCount < 1) return false;
  if (rule.requireNoActiveScene !== false && source.narrative.activeScene) return false;
  if (rule.requireResolvedCoreFacts !== false && world && !hasResolvedCoreFacts(source, world)) return false;

  source.story.mainlineCompleted = true;
  source.story.mainlineCompletedAge = source.age;
  return true;
}

export function isNarrativeEndingEligible(
  story: StoryDirectorState,
  narrative: NarrativeRunState
): boolean {
  if (!narrative.enabled) return true;
  if (story.mainlineCompleted) return true;
  return Boolean(
    story.contract.initialDirectionId &&
    story.committedDirectionIds.length > 0 &&
    narrative.climaxCount >= 1 &&
    narrative.payoffCount >= 1
  );
}

function ledgerHasOpenKind(ledger: StoryFactLedger | undefined, kind: "commitment" | "cost"): boolean {
  return ledger?.facts.some((fact) => fact.kind === kind && fact.status !== "blocked") ?? false;
}

function resolvedFactsForThreads(ledger: StoryFactLedger | undefined, threadIds: string[]): boolean {
  if (threadIds.length === 0) return false;
  return threadIds.every((threadId) => ledger?.facts.some((fact) => (
    fact.threadId === threadId && fact.status === "resolved"
  )));
}

/** Story completion decides whether ending may begin. It never scores stats. */
export function assessClosureReadiness(
  source: NarrativePromptSource,
  world: NarrativeWorldDefinition | null
): ClosureReadiness {
  const directionId = source.story.activeDirectionId ?? source.story.contract.initialDirectionId;
  if (!source.narrative.enabled) return { eligible: true, directionId };
  if (!directionId || !source.story.contract.initialDirectionId) return { eligible: false, reason: "no_mainline" };
  if (!refreshNarrativeMainlineCompletion(source, world)) return { eligible: false, reason: "mainline_incomplete" };
  if (!isNarrativeEndingEligible(source.story, source.narrative)) return { eligible: false, reason: "missing_arc" };
  if (!hasDecisionConsequence(source.story.factLedger)) {
    return { eligible: false, reason: "missing_decision_consequence" };
  }
  if (source.narrative.activeScene) return { eligible: false, reason: "active_conflict" };
  const blueprints = world?.endingBlueprints.filter((item) => item.directionId === directionId) ?? [];
  const good = blueprints.find((item) => item.polarity === "good");
  const bad = blueprints.find((item) => item.polarity === "bad");
  if (!good || !bad) return { eligible: false, reason: "missing_blueprint" };
  const resolvedThreads = new Set(source.narrative.threads.filter((thread) => thread.status === "resolved").map((thread) => thread.id));
  if (!good.requiredThreadIds.every((id) => resolvedThreads.has(id)) || !resolvedFactsForThreads(source.story.factLedger, good.requiredThreadIds)) {
    return { eligible: false, reason: "unresolved_core_fact", requiredThreadIds: good.requiredThreadIds };
  }
  return { eligible: true, directionId, requiredThreadIds: good.requiredThreadIds };
}

function weightedStatScore(stats: Stats, weights: EndingBlueprint["statWeights"]): number {
  const entries = Object.entries(weights) as Array<[keyof Stats, number]>;
  const weightTotal = entries.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
  if (weightTotal <= 0) return 0;
  return entries.reduce((sum, [stat, weight]) => sum + clamp(stats[stat], 0, 100) * Math.max(0, weight), 0) / weightTotal;
}

function flagScore(flags: string[], blueprint: EndingBlueprint): number {
  const present = new Set(flags);
  const favorable = (blueprint.favorableFlags ?? []).filter((flag) => present.has(flag)).length;
  const adverse = (blueprint.adverseFlags ?? []).filter((flag) => present.has(flag)).length;
  return favorable * 1.5 - adverse * 2;
}

function affinityScore(source: NarrativePromptSource, blueprint: EndingBlueprint): number {
  const routeTag = blueprint.directionId.split(".")[1] ?? "";
  const tags = new Set([
    ...source.cards.flatMap((card) => card.tags),
    ...source.items.flatMap((item) => item.tags ?? [])
  ]);
  return tags.has(routeTag) ? 1.5 : 0;
}

export function assessEnding(
  source: NarrativePromptSource & { stats: Stats; difficultyId: string },
  world: NarrativeWorldDefinition | null
): EndingAssessment {
  const readiness = assessClosureReadiness(source, world);
  const directionId = readiness.directionId;
  if (!readiness.eligible || !directionId) return { eligible: false };
  const blueprints = world?.endingBlueprints.filter((item) => item.directionId === directionId) ?? [];
  const good = blueprints.find((item) => item.polarity === "good");
  const bad = blueprints.find((item) => item.polarity === "bad");
  if (!good || !bad) return { eligible: false };
  const score = weightedStatScore(source.stats, good.statWeights)
    + flagScore(source.story.flags, good)
    + affinityScore(source, good)
    - source.narrative.setbackCount * 1.75;
  const threshold = source.difficultyId === "casual"
    ? 16
    : source.difficultyId === "hardcore"
      ? 21
      : 18.5;
  return {
    eligible: true,
    polarity: score >= threshold ? "good" : "bad",
    score: Math.round(score * 10) / 10,
    blueprint: score >= threshold ? good : bad
  };
}

export function lockNarrativeEnding(
  state: NarrativeRunState,
  assessment: EndingAssessment
): NarrativeRunState {
  if (!state.enabled || !assessment.eligible || !assessment.blueprint || !assessment.polarity) return state;
  const next = ensureNarrativeRunState(state);
  if (next.endingState !== "open" && next.endingState !== "eligible") return next;
  next.endingState = "locked";
  next.endingBlueprintId = assessment.blueprint.id;
  next.endingPolarity = assessment.polarity;
  next.endingScore = assessment.score;
  next.arcPhase = "ending";
  return next;
}

export function setNarrativeEndingState(
  state: NarrativeRunState,
  endingState: NarrativeEndingState
): NarrativeRunState {
  if (!state.enabled) return state;
  const next = ensureNarrativeRunState(state);
  next.endingState = endingState;
  if (endingState === "guiding" || endingState === "finished") next.arcPhase = "ending";
  return next;
}

function componentHintForStatus(
  definition: NarrativeComponentDefinition,
  status: NarrativeComponentRunState["status"]
): string {
  if (status === "introduced") return definition.introHint;
  if (status === "active") return definition.activeHint;
  if (status === "escalated") return definition.escalationHint;
  return definition.payoffHint;
}

function componentPromptText(
  definition: NarrativeComponentDefinition,
  state: NarrativeComponentRunState
): string {
  const facts = state.facts.slice(-2).join("；");
  return `${definition.label}：${componentHintForStatus(definition, state.status)}${facts ? ` 已知事实：${facts}` : ""}`;
}

function buildAuthorNote(
  source: NarrativePromptSource,
  focus: { definition: NarrativeComponentDefinition; state: NarrativeComponentRunState } | undefined
): string {
  if (!focus) {
    return source.narrative.activeScene
      ? "本段只承接当前矛盾，不引入额外主线；让人物的行动留下可见后果。"
      : "本段可用日常、关系余波或主人公的自省放缓节奏，但只埋入一条可回收的具体线索，不提前给出结论。";
  }
  if (focus.state.status === "payable") {
    return `本段优先回应“${focus.definition.label}”，给出真实代价或兑现，但不要凭空扩展新的支线。`;
  }
  if (focus.state.status === "escalated") {
    return `本段围绕“${focus.definition.label}”加重选择的代价，使矛盾更具体，不提前收束。`;
  }
  return `本段围绕“${focus.definition.label}”自然推进，让人物、行动和后果彼此相连。`;
}

function factPromptText(fact: NonNullable<StoryDirectorState["factLedger"]>["facts"][number]): string {
  const kind = fact.kind === "commitment"
    ? "既有承诺"
    : fact.kind === "cost"
      ? "既有代价"
      : fact.kind === "relationship_change"
        ? "关系变化"
        : fact.kind === "stake"
          ? "关键筹码"
          : "待回应的问题";
  return `${kind}：${fact.label}`;
}

function factContextEntries(source: NarrativePromptSource, directionId: string | undefined): string[] {
  const activeThreadId = source.narrative.activeScene?.threadId;
  return (source.story.factLedger?.facts ?? [])
    .filter((fact) => fact.status === "open")
    .filter((fact) => !fact.routeIds?.length || !directionId || fact.routeIds.includes(directionId))
    .sort((a, b) => {
      const aScene = a.threadId === activeThreadId ? 1 : 0;
      const bScene = b.threadId === activeThreadId ? 1 : 0;
      if (aScene !== bScene) return bScene - aScene;
      const aKind = a.kind === "commitment" || a.kind === "cost" ? 1 : 0;
      const bKind = b.kind === "commitment" || b.kind === "cost" ? 1 : 0;
      if (aKind !== bKind) return bKind - aKind;
      if ((a.priority ?? 0) !== (b.priority ?? 0)) return (b.priority ?? 0) - (a.priority ?? 0);
      return b.lastTouchedAge - a.lastTouchedAge;
    })
    .slice(0, 5)
    .map(factPromptText);
}

export function buildNarrativePromptPlan(
  source: NarrativePromptSource,
  world: NarrativeWorldDefinition | null
): NarrativePromptPlan | undefined {
  if (!source.narrative.enabled || !world || world.worldId !== source.worldId) return undefined;
  const directionId = source.story.activeDirectionId ?? source.story.contract.initialDirectionId;
  const threadIds = new Set(source.narrative.threads.filter((thread) => thread.status !== "resolved").map((thread) => thread.id));
  const activeThreads = source.narrative.threads
    .filter((thread) => thread.status !== "resolved")
    .map((thread) => {
      const definition = world.threads.find((item) => item.id === thread.id);
      return definition ? `${definition.label}：${definition.payoffHint}` : "一条尚未兑现的旧线索";
    })
    .slice(-3);
  const activeCharacters = source.narrative.activeCharacterIds
    .map((id) => world.characters.find((character) => character.id === id))
    .filter((character): character is NonNullable<typeof character> => Boolean(character))
    .map((character) => `${character.label}(${character.role})：${character.description}`)
    .slice(-4);
  const activeLore = world.lore
    .filter((entry) => {
      const directionMatches = !entry.directionIds?.length || Boolean(directionId && entry.directionIds.includes(directionId));
      const phaseMatches = !entry.phases?.length || entry.phases.includes(source.narrative.arcPhase);
      const threadMatches = !entry.threadIds?.length || entry.threadIds.some((id) => threadIds.has(id));
      return directionMatches && phaseMatches && threadMatches;
    })
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    .slice(0, 4)
    .map((entry) => entry.text);
  const activeSceneThreadId = source.narrative.activeScene?.threadId;
  const activeComponents = source.narrative.components
    .filter((state) => state.status !== "resolved")
    .map((state) => ({ definition: (world.components ?? []).find((component) => component.id === state.id), state }))
    .filter((entry): entry is { definition: NarrativeComponentDefinition; state: NarrativeComponentRunState } => Boolean(entry.definition))
    .filter(({ definition }) => {
      const directionMatches = !definition.directionIds?.length || !directionId || definition.directionIds.includes(directionId);
      const threadMatches = !definition.threadIds?.length || definition.threadIds.some((id) => threadIds.has(id));
      return directionMatches && threadMatches;
    })
    .sort((a, b) => {
      const aScene = a.definition.threadIds?.includes(activeSceneThreadId ?? "") ? 1 : 0;
      const bScene = b.definition.threadIds?.includes(activeSceneThreadId ?? "") ? 1 : 0;
      if (aScene !== bScene) return bScene - aScene;
      const rank: Record<NarrativeComponentRunState["status"], number> = {
        introduced: 1,
        active: 2,
        escalated: 3,
        payable: 4,
        resolved: 0
      };
      if (rank[a.state.status] !== rank[b.state.status]) return rank[b.state.status] - rank[a.state.status];
      if (a.definition.priority !== b.definition.priority) return b.definition.priority - a.definition.priority;
      return b.state.lastTouchedAge - a.state.lastTouchedAge;
    })
    .slice(0, 4);
  const plotEssentials = activeComponents.map(({ definition, state }) => componentPromptText(definition, state));
  const factEssentials = factContextEntries(source, directionId);
  const ending = source.narrative.endingBlueprintId
    ? world.endingBlueprints.find((item) => item.id === source.narrative.endingBlueprintId)
    : undefined;
  const skeletonFocus = !world.mainlineSkeleton
    ? ""
    : source.narrative.endingState === "guiding" || source.narrative.endingState === "finished"
      ? `${world.mainlineSkeleton.payoff} 结局必须沿向：${world.mainlineSkeleton.goodEndingDirection}；${world.mainlineSkeleton.badEndingDirection}`
      : source.narrative.activeScene?.phase === "climax"
        ? world.mainlineSkeleton.payoff
        : source.narrative.activeScene?.phase === "pressure"
          ? world.mainlineSkeleton.climax
          : source.narrative.activeScene
            ? world.mainlineSkeleton.pressure
            : world.mainlineSkeleton.opening;
  return {
    storyBible: world.storyBible,
    mainlineSkeleton: world.mainlineSkeleton
      ? compactText([
        `总冲突：${world.mainlineSkeleton.premise}`,
        `当前骨架节点：${skeletonFocus}`
      ].join("\n"), 380)
      : undefined,
    styleRules: world.styleRules.slice(0, 4),
    activeLore,
    plotEssentials: Array.from(new Set([...factEssentials, ...plotEssentials])).slice(0, 6),
    activeThreads,
    activeCharacters,
    scene: `场景=${source.narrative.scene.place}；冲突=${source.narrative.scene.conflict}；余波=${source.narrative.scene.aftermath}`,
    authorNote: buildAuthorNote(source, activeComponents[0]),
    ending: ending
      ? `结局大纲=${ending.title}/${ending.polarity}；终局冲突=${ending.finalConflict}；回收=${ending.payoffFocus}；余响=${ending.epilogueFocus}`
      : "",
    contextLayers: {
      essentials: Array.from(new Set([...factEssentials, ...activeThreads])).slice(0, 5),
      shortTerm: [source.narrative.scene.conflict, source.narrative.scene.aftermath].filter(Boolean).slice(0, 2),
      lore: activeLore.slice(0, 3)
    }
  };
}

export type NarrativePromptProjection = "planning" | "narration" | "ending";

/**
 * A terminal outline is privileged material: only an engine-approved ending
 * renderer may receive it. Ordinary scenes must remain open-ended.
 */
export function formatNarrativePromptPlan(
  plan: NarrativePromptPlan | undefined,
  projection: NarrativePromptProjection = "narration"
): string {
  if (!plan) return "";
  const lore = compactText((plan.contextLayers?.lore ?? plan.activeLore).map((entry) => compactText(entry, 78)).join("；"), 240);
  const essentials = compactText((plan.contextLayers?.essentials ?? plan.plotEssentials).map((entry) => compactText(entry, 112)).join("；"), 360);
  const shortTerm = compactText((plan.contextLayers?.shortTerm ?? []).map((entry) => compactText(entry, 100)).join("；"), 200);
  const threads = compactText(plan.activeThreads.map((entry) => compactText(entry, 88)).join("；"), 220);
  const characters = compactText(plan.activeCharacters.map((entry) => compactText(entry, 72)).join("；"), 220);
  return [
    plan.mainlineSkeleton ? `必须遵循的主线因果：${plan.mainlineSkeleton}` : "",
    lore ? `相关世界事实：${lore}` : "",
    essentials ? `已确立的关键事实：${essentials}` : "",
    threads ? `仍待回应的旧事：${threads}` : "",
    characters ? `此刻相关的人物：${characters}` : "",
    plan.scene ? compactText(plan.scene, 180) : "",
    shortTerm ? `近期余波：${shortTerm}` : "",
    plan.authorNote ? `写作重点：${compactText(plan.authorNote, 140)}` : "",
    projection === "ending" && plan.ending ? compactText(plan.ending, 220) : ""
  ].filter(Boolean).join("\n");
}
