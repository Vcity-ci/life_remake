import type {
  EndingPolarity,
  EndingBlueprint,
  GameplayTuning,
  EventDefinition,
  NarrativeArcPhase,
  NarrativeComponentDefinition,
  NarrativeComponentRunState,
  NarrativeComponentStatus,
  NarrativeActRuntime,
  NarrativeBeat,
  NarrativeDynamicCharacter,
  NarrativeGrowthFocusDefinition,
  NarrativeMemoryEntry,
  NarrativeEndingState,
  NarrativeRouteProgress,
  NarrativeRunState,
  NarrativeStatTierConfig,
  NarrativeProgressGateStage,
  NarrativeThreadState,
  NarrativeWorldDefinition,
  Stats,
  StoryFactLedger,
  StoryDirectorState,
  YearEvent
} from "@reroll/shared";
import { createDefaultGameplayTuning } from "@reroll/shared";

export interface NarrativePromptSource {
  worldId: string;
  age: number;
  personaPrompt: string;
  stats?: Stats;
  fame?: number;
  history?: YearEvent[];
  tuning?: GameplayTuning;
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
  /**
   * Route detail is deliberately absent from the planning call. It is attached
   * only after the model selects a route, so a previous foreground route never
   * narrows the next planning choice.
   */
  selectedRoute?: {
    label: string;
    summary: string;
    perspective?: string;
    escalation?: string;
    crisis?: string;
    payoffFocus?: string;
    characters: string[];
    lore: string[];
    materials: string[];
  };
  /** Local, deterministic context budget. Never exposes identifiers to the model. */
  contextLayers?: {
    essentials: string[];
    shortTerm: string[];
    lore: string[];
  };
}

export interface EndingAssessment {
  eligible: boolean;
  polarity?: EndingPolarity;
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
    version: 6,
    enabled,
    arcPhase: "setup",
    climaxCount: 0,
    payoffCount: 0,
    threads: [],
    routeProgress: [],
    dynamicCharacters: [],
    memoryEntries: [],
    components: [],
    activeCharacterIds: [],
    scene: defaultScene(),
    sceneClock: {
      mode: "advance",
      sameAgeTurnCount: 0,
      maxSameAgeTurns: 3
    },
    completedScenes: [],
    endingState: "open",
    setbackCount: 0
  };
}

export function ensureNarrativeRunState(
  state: NarrativeRunState | undefined,
  enabled = state?.enabled ?? false,
  currentAge?: number
): NarrativeRunState {
  const defaults = createNarrativeRunState(enabled);
  if (!state || (state.version !== 1 && state.version !== 2 && state.version !== 3 && state.version !== 4 && state.version !== 5 && state.version !== 6)) return defaults;
  const normalizeAge = (value: unknown): number => {
    const age = Number(value);
    if (!Number.isFinite(age)) return 0;
    // Earlier versions persisted several narrative timestamps as 120 after
    // the calendar continued. An active legacy timestamp cannot be recovered
    // exactly, so treat it as current rather than as a fictitious long idle.
    if (state.version !== 3 && age === 120 && (currentAge ?? 0) > 120) return Math.max(0, currentAge ?? 0);
    return Math.max(0, Math.trunc(age));
  };
  const endingStates: NarrativeEndingState[] = ["open", "eligible", "locked", "guiding", "finished"];
  const phase: NarrativeArcPhase[] = ["setup", "rising", "pressure", "climax", "aftermath", "ending"];
  const sceneBeats: Exclude<EventDefinition["narrativeBeat"], "ending" | undefined>[] = [
    "setup", "escalation", "pressure", "climax", "payoff"
  ];
  const routeBeats: NarrativeRouteProgress["phase"][] = ["setup", "escalation", "pressure", "climax"];
  const activeScene = state.activeScene &&
    typeof state.activeScene.id === "string" &&
    typeof state.activeScene.threadId === "string" &&
    sceneBeats.includes(state.activeScene.phase)
      ? {
        id: compactText(state.activeScene.id, 120),
        threadId: compactText(state.activeScene.threadId, 120),
        phase: state.activeScene.phase,
        openedAge: normalizeAge(state.activeScene.openedAge),
        lastTouchedAge: normalizeAge(state.activeScene.lastTouchedAge),
        mainlineActId: state.activeScene.mainlineActId?.trim() || undefined,
        decisionCount: Math.max(0, Math.min(16, Number(state.activeScene.decisionCount) || 0))
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
        introducedAge: normalizeAge(component.introducedAge),
        lastTouchedAge: normalizeAge(component.lastTouchedAge),
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
  const completedScenes = Array.isArray(state.completedScenes)
    ? state.completedScenes
      .filter((scene): scene is NonNullable<NarrativeRunState["completedScenes"]>[number] => Boolean(scene?.id && scene?.threadId))
      .slice(-12)
      .map((scene) => ({
        id: compactText(scene.id, 120),
        experienceId: scene.experienceId?.trim() || undefined,
        threadId: compactText(scene.threadId, 120),
        mainlineActId: scene.mainlineActId?.trim() || undefined,
        openedAge: normalizeAge(scene.openedAge),
        resolvedAge: normalizeAge(scene.resolvedAge),
        decisionCount: Math.max(0, Math.min(16, Number(scene.decisionCount) || 0))
      }))
    : [];
  const routeProgressById = new Map<string, NarrativeRouteProgress>();
  for (const progress of Array.isArray(state.routeProgress) ? state.routeProgress : []) {
    if (!progress?.routeId || !routeBeats.includes(progress.phase)) continue;
    const normalized: NarrativeRouteProgress = {
      routeId: compactText(progress.routeId, 120),
      phase: progress.phase,
      lastTouchedAge: normalizeAge(progress.lastTouchedAge),
      lastEventId: progress.lastEventId ? compactText(progress.lastEventId, 120) : undefined
    };
    const previous = routeProgressById.get(normalized.routeId);
    if (!previous || normalized.lastTouchedAge >= previous.lastTouchedAge) {
      routeProgressById.set(normalized.routeId, normalized);
    }
  }
  const routeProgress = Array.from(routeProgressById.values())
    .sort((a, b) => a.lastTouchedAge - b.lastTouchedAge || a.routeId.localeCompare(b.routeId))
    .slice(-32);
  const dynamicCharacters: NarrativeDynamicCharacter[] = Array.isArray(state.dynamicCharacters)
    ? state.dynamicCharacters
      .filter((character): character is NarrativeDynamicCharacter => Boolean(
        character?.id && character?.name && character?.role
      ))
      .slice(-24)
      .map((character) => ({
        id: compactText(character.id, 80),
        name: compactText(character.name, 60),
        factionId: character.factionId ? compactText(character.factionId, 80) : undefined,
        role: compactText(character.role, 100),
        description: compactText(character.description, 240),
        relatedFactIds: uniqueRecent(character.relatedFactIds ?? [], 8),
        relatedRouteIds: uniqueRecent(character.relatedRouteIds ?? [], 8),
        introducedAge: normalizeAge(character.introducedAge),
        lastSeenAge: normalizeAge(character.lastSeenAge),
        importance: character.importance === "core" || character.importance === "recurring" ? character.importance : "momentary",
        status: character.status === "resolved" || character.status === "gone" ? character.status : "active"
      }))
    : [];
  const memoryEntries = Array.isArray(state.memoryEntries)
    ? state.memoryEntries
      .filter((entry): entry is NarrativeMemoryEntry => Boolean(entry?.id && entry?.text))
      .slice(-80)
      .map((entry) => ({
        id: compactText(entry.id, 120),
        age: normalizeAge(entry.age),
        routeId: entry.routeId ? compactText(entry.routeId, 80) : undefined,
        factionIds: uniqueRecent(entry.factionIds ?? [], 8),
        characterIds: uniqueRecent(entry.characterIds ?? [], 8),
        factIds: uniqueRecent(entry.factIds ?? [], 8),
        text: compactText(entry.text, 480)
      }))
    : [];
  const validBeats: Array<Exclude<NarrativeBeat, "ending">> = ["setup", "escalation", "pressure", "climax", "payoff"];
  const normalizeGrowthFocuses = (value: unknown): NarrativeGrowthFocusDefinition[] => Array.isArray(value)
    ? value.filter((focus): focus is NarrativeGrowthFocusDefinition => Boolean(
      focus && typeof focus === "object" &&
      typeof (focus as NarrativeGrowthFocusDefinition).id === "string" &&
      typeof (focus as NarrativeGrowthFocusDefinition).label === "string" &&
      typeof (focus as NarrativeGrowthFocusDefinition).description === "string" &&
      Array.isArray((focus as NarrativeGrowthFocusDefinition).primaryStats)
    )).slice(0, 8).map((focus) => ({
      id: compactText(focus.id, 80),
      label: compactText(focus.label, 60),
      description: compactText(focus.description, 180),
      primaryStats: focus.primaryStats.filter((stat): stat is keyof Stats => ["intelligence", "charisma", "family", "fortune", "physique"].includes(stat)).slice(0, 3),
      secondaryStats: focus.secondaryStats?.filter((stat): stat is keyof Stats => ["intelligence", "charisma", "family", "fortune", "physique"].includes(stat)).slice(0, 3)
    })).filter((focus) => focus.id && focus.label && focus.description && focus.primaryStats.length > 0)
    : [];
  const normalizeStatTierConfig = (value: unknown): NarrativeStatTierConfig | undefined => {
    const config = value as Partial<NarrativeStatTierConfig> | undefined;
    const lowMax = Number(config?.lowMax);
    const highMin = Number(config?.highMin);
    return Number.isFinite(lowMax) && Number.isFinite(highMin) && lowMax >= 0 && highMin > lowMax
      ? { lowMax: Math.trunc(lowMax), highMin: Math.trunc(highMin) }
      : undefined;
  };
  const actRuntime = state.actRuntime && typeof state.actRuntime.actId === "string" && validBeats.includes(state.actRuntime.beat)
    ? {
      actId: compactText(state.actRuntime.actId, 120),
      beat: state.actRuntime.beat,
      enteredAge: normalizeAge(state.actRuntime.enteredAge),
      lastAdvancedAge: normalizeAge(state.actRuntime.lastAdvancedAge),
      selectedRouteIds: uniqueRecent(state.actRuntime.selectedRouteIds ?? [], 12),
      decisionCount: Math.max(0, Math.min(32, Number(state.actRuntime.decisionCount) || 0)),
      growthFocusId: state.actRuntime.growthFocusId?.trim() || undefined,
      growthFocusOptions: normalizeGrowthFocuses(state.actRuntime.growthFocusOptions)
    } satisfies NarrativeActRuntime
    : undefined;
  const rawClock = state.sceneClock;
  const sceneClock = rawClock && (rawClock.mode === "advance" || rawClock.mode === "hold")
    ? {
        mode: rawClock.mode,
        sameAgeTurnCount: Math.max(0, Math.min(8, Number(rawClock.sameAgeTurnCount) || 0)),
        maxSameAgeTurns: Math.max(1, Math.min(5, Number(rawClock.maxSameAgeTurns) || defaults.sceneClock.maxSameAgeTurns))
      }
    : defaults.sceneClock;
  return {
    ...defaults,
    ...state,
    version: 6,
    enabled: enabled && state.enabled !== false,
    arcPhase: phase.includes(state.arcPhase) ? state.arcPhase : defaults.arcPhase,
    climaxCount: Math.max(0, Math.min(8, Number(state.climaxCount) || 0)),
    payoffCount: Math.max(0, Math.min(8, Number(state.payoffCount) || 0)),
    threads: Array.isArray(state.threads)
      ? state.threads
        .filter((thread): thread is NarrativeThreadState => Boolean(thread?.id))
        .slice(-12)
      : [],
    routeProgress,
    actRuntime,
    dynamicCharacters,
    memoryEntries,
    activeCharacterIds: uniqueRecent(Array.isArray(state.activeCharacterIds) ? state.activeCharacterIds : [], 8),
    components,
    scene: {
      ...defaultScene(),
      ...(state.scene ?? {})
    },
    activeScene,
    sceneClock,
    completedScenes,
    activeMainlineActId: state.activeMainlineActId?.trim() || activeScene?.mainlineActId || undefined,
    lastResolvedSceneAge: Number.isFinite(state.lastResolvedSceneAge)
      ? normalizeAge(state.lastResolvedSceneAge)
      : undefined,
    endingState: endingStates.includes(state.endingState) ? state.endingState : defaults.endingState,
    endingBlueprintId: state.endingBlueprintId?.trim() || undefined,
    endingPolarity: state.endingPolarity === "good" || state.endingPolarity === "normal" || state.endingPolarity === "bad"
      ? state.endingPolarity
      : undefined,
    endingScore: typeof state.endingScore === "number" ? state.endingScore : undefined,
    setbackCount: Math.max(0, Math.min(8, Number(state.setbackCount) || 0)),
    statTierConfig: normalizeStatTierConfig(state.statTierConfig)
  };
}

const actBeats: Array<Exclude<NarrativeBeat, "ending">> = ["setup", "escalation", "pressure", "climax", "payoff"];

function growthFocusesForWorld(world: NarrativeWorldDefinition | null | undefined): NarrativeGrowthFocusDefinition[] {
  return (world?.progression?.growthFocuses ?? []).map((focus) => ({
    ...focus,
    primaryStats: [...focus.primaryStats],
    secondaryStats: focus.secondaryStats ? [...focus.secondaryStats] : undefined
  }));
}

export function ensureNarrativeActRuntime(
  state: NarrativeRunState,
  world: NarrativeWorldDefinition | null | undefined,
  age: number
): NarrativeRunState {
  const next = ensureNarrativeRunState(state, state.enabled, age);
  if (world?.progression?.statTiers) next.statTierConfig = { ...world.progression.statTiers };
  if (!next.enabled || !world?.mainlineActs?.length || next.actRuntime) return next;
  const act = world.mainlineActs[0];
  next.actRuntime = {
    actId: act.id,
    beat: "setup",
    enteredAge: age,
    lastAdvancedAge: age,
    selectedRouteIds: [],
    decisionCount: 0,
    growthFocusOptions: growthFocusesForWorld(world)
  };
  next.activeMainlineActId = act.id;
  return next;
}

export function getNarrativeActRuntime(
  state: NarrativeRunState,
  world: NarrativeWorldDefinition | null | undefined,
  age: number
): NarrativeActRuntime | undefined {
  return ensureNarrativeActRuntime(state, world, age).actRuntime;
}

export function advanceNarrativeActBeat(
  state: NarrativeRunState,
  world: NarrativeWorldDefinition,
  age: number,
  options?: { selectedRouteId?: string; decision?: boolean }
): { state: NarrativeRunState; completedActId?: string } {
  const next = ensureNarrativeActRuntime(state, world, age);
  const runtime = next.actRuntime;
  if (!runtime) return { state: next };
  const currentIndex = actBeats.indexOf(runtime.beat);
  const selectedRouteIds = options?.selectedRouteId
    ? uniqueRecent([...runtime.selectedRouteIds, options.selectedRouteId], 12)
    : runtime.selectedRouteIds;
  if (runtime.beat !== "payoff") {
    next.actRuntime = {
      ...runtime,
      beat: actBeats[Math.min(actBeats.length - 1, currentIndex + 1)],
      lastAdvancedAge: age,
      selectedRouteIds,
      decisionCount: runtime.decisionCount + (options?.decision ? 1 : 0)
    };
    return { state: next };
  }
  const completedActId = runtime.actId;
  const acts = world.mainlineActs ?? [];
  const nextAct = acts[acts.findIndex((act) => act.id === runtime.actId) + 1];
  if (nextAct) {
    next.actRuntime = {
      actId: nextAct.id,
      beat: "setup",
      enteredAge: age,
      lastAdvancedAge: age,
      selectedRouteIds: [],
      decisionCount: 0,
      growthFocusOptions: growthFocusesForWorld(world)
    };
    next.activeMainlineActId = nextAct.id;
    // The previous per-route marker is legacy state; a new act never inherits it.
    next.routeProgress = [];
  }
  return { state: next, completedActId };
}

/** Records the player's ordinary-year growth emphasis without advancing time. */
export function selectNarrativeGrowthFocus(
  state: NarrativeRunState,
  world: NarrativeWorldDefinition | null | undefined,
  focusId: string
): NarrativeRunState {
  const next = ensureNarrativeActRuntime(state, world, 0);
  const runtime = next.actRuntime;
  if (!runtime || runtime.growthFocusId) return next;
  const options = runtime.growthFocusOptions?.length ? runtime.growthFocusOptions : growthFocusesForWorld(world);
  if (!options.some((focus) => focus.id === focusId)) return next;
  next.actRuntime = { ...runtime, growthFocusId: focusId, growthFocusOptions: options };
  return next;
}

export function getNarrativeRouteProgress(
  state: NarrativeRunState,
  routeId: string
): NarrativeRouteProgress | undefined {
  return state.routeProgress.find((progress) => progress.routeId === routeId);
}

export function resetNarrativeRouteProgress(
  state: NarrativeRunState,
  routeId: string
): NarrativeRunState {
  if (!state.enabled) return state;
  const next = ensureNarrativeRunState(state);
  next.routeProgress = next.routeProgress.filter((progress) => progress.routeId !== routeId);
  return next;
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
  // Narrative worlds have no terminal age. Authoring maxAge remains useful for
  // event ranking, but it must not silently retire a core component in a long run.
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
  storyFlags: string[] = [],
  options?: { mainlineActId?: string; experienceId?: string; routeId?: string }
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
    let reachedClimax = targets.length === 0;
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
    let paid = payoffTargets.length === 0;
    for (const id of payoffTargets) {
      const thread = next.threads.find((item) => item.id === id);
      if (thread && thread.status === "climax") paid = true;
      if (thread) upsertThread(next.threads, id, age, "resolved");
    }
    if (paid) next.payoffCount = Math.min(8, next.payoffCount + 1);
  }

  const sceneThreadId = targets[0] ?? options?.routeId;
  if (sceneThreadId && beat && beat !== "ending") {
    const previousScene = next.activeScene?.threadId === sceneThreadId
      ? next.activeScene
      : undefined;
    if (beat === "payoff") {
      const completedScene = previousScene ?? {
        id: `${definition.id}:${age}`,
        threadId: sceneThreadId,
        phase: "climax" as const,
        openedAge: age,
        lastTouchedAge: age,
        mainlineActId: options?.mainlineActId ?? next.activeMainlineActId,
        decisionCount: 0
      };
      next.lastResolvedSceneAge = age;
      next.completedScenes = [
        ...next.completedScenes,
        {
          id: completedScene.id,
          experienceId: options?.experienceId,
          threadId: completedScene.threadId,
          mainlineActId: completedScene.mainlineActId ?? next.activeMainlineActId,
          openedAge: completedScene.openedAge,
          resolvedAge: age,
          decisionCount: completedScene.decisionCount ?? 0
        }
      ].slice(-12);
      next.sceneClock = { ...next.sceneClock, mode: "advance", sameAgeTurnCount: 0 };
      next.activeScene = undefined;
    } else {
      // This is a presentation and clock projection for the route selected on
      // this turn. Eligibility comes from routeProgress, so selecting another
      // route cannot erase or advance the previous route's local beat.
      next.activeScene = {
        id: previousScene?.id ?? `${definition.id}:${age}`,
        threadId: sceneThreadId,
        phase: beat,
        openedAge: previousScene?.openedAge ?? age,
        lastTouchedAge: age,
        mainlineActId: options?.mainlineActId ?? previousScene?.mainlineActId ?? next.activeMainlineActId,
        decisionCount: previousScene?.decisionCount ?? 0
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
  if (options?.routeId && beat && beat !== "payoff" && beat !== "ending") {
    const progress: NarrativeRouteProgress = {
      routeId: options.routeId,
      phase: beat,
      lastTouchedAge: age,
      lastEventId: definition.id
    };
    next.routeProgress = [
      ...next.routeProgress.filter((item) => item.routeId !== progress.routeId),
      progress
    ].slice(-32);
  }
  return next;
}

export function recordNarrativeSceneDecision(state: NarrativeRunState): NarrativeRunState {
  if (!state.enabled || !state.activeScene) return state;
  const next = ensureNarrativeRunState(state);
  if (!next.activeScene) return next;
  next.activeScene = {
    ...next.activeScene,
    decisionCount: Math.min(16, (next.activeScene.decisionCount ?? 0) + 1)
  };
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
  return source.story.foregroundExperienceId
    ?? source.story.activeDirectionId
    ?? source.story.contract.initialDirectionId;
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
  if (source.narrative.actRuntime && world.mainlineActs?.length) {
    const requiredFactIds = world.mainlineActs.flatMap((act) => Array.from(new Set([
      ...(act.factId ? [act.factId] : []),
      ...(act.resolveFactIds ?? [])
    ])));
    return requiredFactIds.every((id) => source.story.factLedger?.facts.some((fact) => fact.id === id && fact.status === "resolved"));
  }
  const directionId = source.story.closureExperienceId ?? currentDirectionId(source);
  const coreThreadIds = world.routeArcs.find((route) => route.directionId === directionId)?.coreThreadIds
    ?? source.story.contract.coreThreadIds;
  if (coreThreadIds.length === 0) return false;
  const resolvedThreads = new Set(source.narrative.threads
    .filter((thread) => thread.status === "resolved")
    .map((thread) => thread.id));
  const experienceResolved = coreThreadIds.every((threadId) => (
    resolvedThreads.has(threadId) && resolvedFactsForThreads(source.story.factLedger, [threadId])
  ));
  const mainlineFacts = world.mainlineFacts ?? [];
  const mainlineEstablished = mainlineFacts.every((definition) => (
    source.story.factLedger?.facts.some((fact) => fact.id === definition.id && fact.status === "resolved")
  ));
  return experienceResolved && mainlineEstablished;
}

/**
 * Progress gates are world data, not calendar switches. Before a gate is met
 * the engine keeps the current beat available so normal-year growth can matter.
 */
export function isNarrativeStageReady(
  source: NarrativePromptSource,
  world: NarrativeWorldDefinition | null | undefined,
  stage: NarrativeProgressGateStage,
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
 * A world-act gate is satisfied when the character has enough preparation to
 * advance through at least one of its open life perspectives. This keeps the
 * six routes selectable without turning a route-specific score into a route
 * lock, while retaining attribute-driven pacing.
 */
export function isNarrativeWorldStageReady(
  source: NarrativePromptSource,
  world: NarrativeWorldDefinition | null | undefined,
  stage: NarrativeProgressGateStage
): boolean {
  const routes = world?.progression?.routes ?? [];
  if (routes.length === 0) return isNarrativeStageReady(source, world, stage);
  return routes.some((route) => isNarrativeStageReady(source, world, stage, route.directionId));
}

/**
 * A world act may have a different admission threshold from the pressure and
 * climax beats inside the scene it starts. The act controls when its material
 * may enter the story; the scene still follows its own five-beat pacing.
 */
export function isNarrativeMainlineActEntryReady(
  source: NarrativePromptSource,
  world: NarrativeWorldDefinition | null | undefined
): boolean {
  const activeAct = source.narrative.activeMainlineActId
    ? world?.mainlineActs?.find((act) => act.id === source.narrative.activeMainlineActId)
    : undefined;
  return isNarrativeWorldStageReady(source, world, activeAct?.readinessStage ?? "opening");
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
  const dynamicWorldMode = Boolean(source.narrative.actRuntime && world?.mainlineActs?.length);
  if (dynamicWorldMode) {
    const completedActIds = new Set(source.narrative.completedScenes.map((scene) => scene.mainlineActId));
    const allActsCompleted = world!.mainlineActs!.every((act) => completedActIds.has(act.id));
    const complete = allActsCompleted &&
      source.narrative.payoffCount >= world!.mainlineActs!.length &&
      source.narrative.climaxCount >= world!.mainlineActs!.length &&
      hasDecisionConsequence(source.story.factLedger) &&
      !source.narrative.activeScene &&
      hasResolvedCoreFacts(source, world!);
    if (complete) {
      source.story.mainlineCompleted = true;
      source.story.mainlineCompletedAge = source.age;
    }
    return complete;
  }
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
  const completedScenes = source.narrative.completedScenes.filter((scene) => scene.decisionCount > 0);
  if (completedScenes.length < Math.max(1, rule.minCompletedSceneInstances ?? 1)) return false;
  if (rule.requireAllMainlineActs !== false && world?.mainlineActs?.length) {
    const completedActIds = new Set(completedScenes.map((scene) => scene.mainlineActId));
    if (world.mainlineActs.some((act) => !completedActIds.has(act.id))) return false;
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
  const directionId = source.story.closureExperienceId ?? currentDirectionId(source);
  if (!source.narrative.enabled) return { eligible: true, directionId };
  if (source.narrative.actRuntime && world?.mainlineActs?.length) {
    // Dynamic world acts own their route choice in closureExperienceId. The
    // legacy contract is not created by this mode and must not block closure.
    if (!directionId) return { eligible: false, reason: "no_mainline" };
    if (!refreshNarrativeMainlineCompletion(source, world)) return { eligible: false, reason: "mainline_incomplete" };
    const blueprints = world.endingBlueprints.filter((item) => item.directionId === directionId);
    const good = blueprints.find((item) => item.polarity === "good");
    const normal = blueprints.find((item) => item.polarity === "normal");
    const bad = blueprints.find((item) => item.polarity === "bad");
    return good && normal && bad
      ? { eligible: true, directionId }
      : { eligible: false, reason: "missing_blueprint" };
  }
  if (!directionId || !source.story.contract.initialDirectionId) return { eligible: false, reason: "no_mainline" };
  if (!refreshNarrativeMainlineCompletion(source, world)) return { eligible: false, reason: "mainline_incomplete" };
  if (!isNarrativeEndingEligible(source.story, source.narrative)) return { eligible: false, reason: "missing_arc" };
  if (!hasDecisionConsequence(source.story.factLedger)) {
    return { eligible: false, reason: "missing_decision_consequence" };
  }
  if (source.narrative.activeScene) return { eligible: false, reason: "active_conflict" };
  const blueprints = world?.endingBlueprints.filter((item) => item.directionId === directionId) ?? [];
  const good = blueprints.find((item) => item.polarity === "good");
  const normal = blueprints.find((item) => item.polarity === "normal");
  const bad = blueprints.find((item) => item.polarity === "bad");
  if (!good || !normal || !bad) return { eligible: false, reason: "missing_blueprint" };
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

function trajectoryScore(history: YearEvent[] | undefined): {
  score: number;
  hasBreakthrough: boolean;
} {
  const decisions = (history ?? []).filter((event) => event.tags.includes("milestone"));
  const breakthroughs = decisions.filter((event) => event.tags.includes("decision_outcome_breakthrough")).length;
  const setbacks = decisions.filter((event) => event.tags.includes("decision_outcome_setback")).length;
  const balanced = decisions.filter((event) => event.tags.includes("decision_outcome_balanced")).length;
  return {
    score: breakthroughs * 1.5 + balanced * 0.25 - setbacks * 2,
    hasBreakthrough: breakthroughs > 0
  };
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
  const normal = blueprints.find((item) => item.polarity === "normal");
  const bad = blueprints.find((item) => item.polarity === "bad");
  if (!good || !normal || !bad) return { eligible: false };
  const tuning = source.tuning ?? createDefaultGameplayTuning();
  const trajectory = trajectoryScore(source.history);
  const score = weightedStatScore(source.stats, good.statWeights)
    + flagScore(source.story.flags, good)
    + affinityScore(source, good)
    + trajectory.score
    + ((source.fame ?? 0) - 50) * tuning.ending.narrativeFameWeight
    - source.narrative.setbackCount * 1.75;
  const difficultyOffset = source.difficultyId === "casual"
    ? -2.5
    : source.difficultyId === "hardcore"
      ? 2.5
      : 0;
  const normalThreshold = tuning.ending.narrativeNormalScore + difficultyOffset;
  const goodThreshold = tuning.ending.narrativeGoodScore + difficultyOffset;
  const polarity: EndingPolarity = score >= goodThreshold && trajectory.hasBreakthrough
    ? "good"
    : score >= normalThreshold
      ? "normal"
      : "bad";
  return {
    eligible: true,
    polarity,
    score: Math.round(score * 10) / 10,
    blueprint: polarity === "good" ? good : polarity === "normal" ? normal : bad
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
  world: NarrativeWorldDefinition | null,
  selectedRouteId?: string | null
): NarrativePromptPlan | undefined {
  if (!source.narrative.enabled || !world || world.worldId !== source.worldId) return undefined;
  // `undefined` preserves the caller's current-route view for ordinary and
  // ending narration; `null` deliberately means global-only planning context.
  const directionId = selectedRouteId === undefined ? currentDirectionId(source) : selectedRouteId;
  const selectedRoute = directionId
    ? world.routeArcs.find((route) => route.directionId === directionId)
    : undefined;
  const threadIds = new Set(source.narrative.threads.filter((thread) => thread.status !== "resolved").map((thread) => thread.id));
  const activeThreads = source.narrative.threads
    .filter((thread) => thread.status !== "resolved")
    .map((thread) => {
      const definition = world.threads.find((item) => item.id === thread.id);
      return definition ? `${definition.label}：${definition.payoffHint}` : "一条尚未兑现的旧线索";
    })
    .slice(-3);
  const staticActiveCharacters = source.narrative.activeCharacterIds
    .map((id) => world.characters.find((character) => character.id === id))
    .filter((character): character is NonNullable<typeof character> => Boolean(character))
    .map((character) => `${character.label}(${character.role})：${character.description}`)
    .slice(-4);
  const dynamicActiveCharacters = source.narrative.dynamicCharacters
    .filter((character) => character.status === "active" && source.narrative.activeCharacterIds.includes(character.id))
    .map((character) => `${character.name}(${character.role})：${character.description}`)
    .slice(-4);
  const routeCharacters = (selectedRoute?.characterIds ?? [])
    .map((id) => world.characters.find((character) => character.id === id))
    .filter((character): character is NonNullable<typeof character> => Boolean(character))
    .map((character) => `${character.label}(${character.role})：${character.description}`)
    .slice(0, 3);
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
  const factEssentials = factContextEntries(source, directionId ?? undefined);
  const ending = source.narrative.endingBlueprintId
    ? world.endingBlueprints.find((item) => item.id === source.narrative.endingBlueprintId)
    : undefined;
  const idleSkeletonFocus = !world.mainlineSkeleton
    ? ""
    : source.narrative.arcPhase === "setup"
      ? world.mainlineSkeleton.opening
      : source.narrative.arcPhase === "rising"
        ? world.mainlineSkeleton.pressure
        : source.narrative.arcPhase === "pressure"
          ? world.mainlineSkeleton.climax
          : source.narrative.arcPhase === "climax" || source.narrative.arcPhase === "aftermath"
      ? world.mainlineSkeleton.payoff
            : world.mainlineSkeleton.payoff;
  const activeActId = source.narrative.activeMainlineActId;
  const activeMainlineAct = activeActId
    ? world.mainlineActs?.find((act) => act.id === activeActId)
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
            : idleSkeletonFocus;
  const routeLore = (selectedRoute?.loreIds ?? [])
    .map((id) => world.lore.find((entry) => entry.id === id)?.text)
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 2);
  return {
    storyBible: world.storyBible,
    mainlineSkeleton: world.mainlineSkeleton
      ? compactText([
        `总冲突：${world.mainlineSkeleton.premise}`,
        `当前骨架节点：${skeletonFocus}`,
        activeMainlineAct ? `当前世界推进：${activeMainlineAct.prompt}` : ""
      ].join("\n"), 380)
      : undefined,
    styleRules: world.styleRules.slice(0, 4),
    activeLore,
    plotEssentials: Array.from(new Set([...factEssentials, ...plotEssentials])).slice(0, 6),
    activeThreads,
    activeCharacters: Array.from(new Set([...staticActiveCharacters, ...dynamicActiveCharacters, ...routeCharacters])).slice(0, 5),
    scene: `场景=${source.narrative.scene.place}；冲突=${source.narrative.scene.conflict}；余波=${source.narrative.scene.aftermath}`,
    authorNote: buildAuthorNote(source, activeComponents[0]),
    ending: ending
      ? `结局大纲=${ending.title}/${ending.polarity}；终局冲突=${ending.finalConflict}；回收=${ending.payoffFocus}；余响=${ending.epilogueFocus}`
      : "",
    selectedRoute: selectedRoute ? {
      label: selectedRoute.label || selectedRoute.directionId,
      summary: selectedRoute.summary,
      perspective: selectedRoute.perspective,
      escalation: selectedRoute.escalation,
      crisis: selectedRoute.crisis,
      payoffFocus: selectedRoute.payoffFocus,
      characters: routeCharacters,
      lore: routeLore,
      materials: []
    } : undefined,
    contextLayers: {
      essentials: Array.from(new Set([...factEssentials, ...activeThreads])).slice(0, 5),
      shortTerm: [source.narrative.scene.conflict, source.narrative.scene.aftermath].filter(Boolean).slice(0, 2),
      lore: activeLore.slice(0, 3)
    }
  };
}

/**
 * A small hybrid retriever for one run. Exact act/fact/route metadata wins;
 * word overlap only breaks ties. It deliberately returns prose, never a state
 * transition or a candidate list.
 */
export function retrieveNarrativeMemories(
  source: NarrativePromptSource,
  query: { routeId?: string; factionIds?: string[]; factIds?: string[]; text?: string },
  limit = 4
): string[] {
  const words = new Set((query.text ?? "").toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []);
  return source.narrative.memoryEntries
    .map((entry) => {
      let score = entry.age / 10_000;
      if (query.routeId && entry.routeId === query.routeId) score += 8;
      score += (query.factionIds ?? []).filter((id) => entry.factionIds.includes(id)).length * 5;
      score += (query.factIds ?? []).filter((id) => entry.factIds.includes(id)).length * 7;
      const entryWords = entry.text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
      score += entryWords.filter((word) => words.has(word)).length;
      return { text: entry.text, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.text);
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
  const route = plan.selectedRoute;
  const routeDetail = route && projection !== "planning"
    ? compactText([
      `当前路线视角：${route.summary}`,
      route.perspective ? `人物落点：${route.perspective}` : "",
      route.escalation ? `可加重的矛盾：${route.escalation}` : "",
      route.crisis ? `与世界危机的连接：${route.crisis}` : "",
      route.payoffFocus ? `可回收方向：${route.payoffFocus}` : "",
      route.materials.length ? `既有素材：${route.materials.join("；")}` : ""
    ].filter(Boolean).join("\n"), 520)
    : "";
  return [
    plan.mainlineSkeleton ? `必须遵循的主线因果：${plan.mainlineSkeleton}` : "",
    lore ? `相关世界事实：${lore}` : "",
    essentials ? `已确立的关键事实：${essentials}` : "",
    threads ? `仍待回应的旧事：${threads}` : "",
    characters ? `此刻相关的人物：${characters}` : "",
    plan.scene ? compactText(plan.scene, 180) : "",
    shortTerm ? `近期余波：${shortTerm}` : "",
    routeDetail,
    plan.authorNote ? `写作重点：${compactText(plan.authorNote, 140)}` : "",
    projection === "ending" && plan.ending ? compactText(plan.ending, 220) : ""
  ].filter(Boolean).join("\n");
}
