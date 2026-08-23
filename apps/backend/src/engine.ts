import seedrandom from "seedrandom";
import { createHash } from "node:crypto";
import type {
  AgeThreshold,
  AscensionState,
  BackgroundCard,
  DecisionType,
  DifficultyConfig,
  EventDefinition,
  GameplayTuning,
  ItemDefinition,
  ItemInstance,
  NarrativeComponentDefinition,
  NarrativeAttributeEffect,
  NarrativeAttributePolicy,
  NarrativeDynamicCharacter,
  NarrativeFactResolution,
  NarrativeIntent,
  NarrativeSceneArchetype,
  MilestoneChoice,
  NarrativeRunState,
  NarrativeStatTier,
  NarrativeThreadState,
  NarrativeWorldDefinition,
  PassiveEffect,
  PublicMilestoneChoice,
  PublicRunState,
  PublicTimelineEntry,
  RunPhase,
  RunState,
  StartRunRequest,
  StatKey,
  StoryCompletenessBuffer,
  StoryDirectionDefinition,
  StoryDirectorState,
  StoryFactDefinition,
  StoryFactEffect,
  StoryFactLedger,
  StoryFactRecord,
  Stats,
  TimelineEntry,
  TurnRecord,
  WorldConfig,
  YearEvent
} from "@reroll/shared";
import { createDefaultGameplayTuning } from "@reroll/shared";
import type { AiConversationState } from "./conversation.js";
import {
  applyNarrativeEvent,
  assessEnding,
  assessClosureReadiness,
  canAdvanceNarrativeComponent,
  createNarrativeRunState,
  ensureNarrativeRunState,
  ensureNarrativeActRuntime,
  advanceNarrativeActBeat,
  getNarrativeRouteProgress,
  isNarrativeMainlineActEntryReady,
  isNarrativeStageReady,
  isNarrativeWorldStageReady,
  isNarrativeEndingEligible,
  lockNarrativeEnding,
  recordNarrativeSceneDecision,
  recordNarrativeSetback,
  refreshNarrativeMainlineCompletion,
  resetNarrativeRouteProgress,
  setNarrativeEndingState
} from "./narrative.js";

interface EngineContext {
  world: WorldConfig;
  difficulty: DifficultyConfig;
  cards: BackgroundCard[];
  tuning: GameplayTuning;
  narrativeEnabled?: boolean;
}

type Rng = () => number;
type CoreStatKey = "intelligence" | "charisma" | "family" | "fortune";
interface NarrativeReservoirState {
  queued: TimelineEntry[];
  revealedCount: number;
  revealedAge: number;
  revealedAgeStage: AgeThreshold;
  phase: RunPhase;
  pendingRequestIds: string[];
}

export interface ApprovedNarrativeAttributeOutcome {
  effects: NarrativeAttributeEffect[];
}

export interface PendingDirectedDecisionPolicy extends NarrativeAttributePolicy {}

export function getPendingDirectedDecisionPolicy(
  run: InternalRunState,
  decision: DecisionType
): PendingDirectedDecisionPolicy | undefined {
  return run.pendingDirectedDecisionPolicy?.[decision];
}

interface DirectedDecisionEffect {
  success: Partial<Record<StatKey, number>>;
  failure: Partial<Record<StatKey, number>>;
  deathRisk: number;
}

export interface DirectedEventCandidate {
  definition: EventDefinition;
  /** Route selected by the model for this concrete material. */
  routeId?: string;
  kind: "normal" | "milestone";
  score: number;
  preview: {
    statChanges: Partial<Record<StatKey, number>>;
    item?: ItemInstance;
    decisionEffects?: Record<DecisionType, DirectedDecisionEffect>;
  };
}

export interface DirectedFocusOption {
  id: string;
  storyPosition?: EventDefinition["storyPosition"];
  candidateCount: number;
  weight: number;
}

export interface DirectedNarrativeComponentFocus {
  id: string;
  label: string;
  hint: string;
  candidateCount: number;
  weight: number;
}

export interface DirectedSceneArchetypeOption {
  id: string;
  label: string;
  description: string;
  candidateCount: number;
}

export interface DirectedMilestonePresentation {
  background: string;
  optionOverrides: Array<{
    id: DecisionType;
    label: string;
    description: string;
  }>;
}

export interface DirectedStoryDirection {
  id: string;
  label: string;
  summary: string;
  focusTags: string[];
  storyPosition?: EventDefinition["storyPosition"];
  candidateCount: number;
  weight: number;
}
const coreStatKeys: CoreStatKey[] = ["intelligence", "charisma", "family", "fortune"];
const allStatKeys: StatKey[] = [...coreStatKeys, "physique"];
const storyPositions = ["origin", "accumulation", "pressure", "turn", "resolution"] as const;
const DIRECTOR_EVENT_POOL_SIZE = 16;
const DIRECTOR_FOCUS_OPTION_LIMIT = 6;
const CORE_STAT_MIN = -30;
const STAT_MAX = 100;
const negativeStatLabel: Record<CoreStatKey, string> = {
  intelligence: "智力",
  charisma: "魅力",
  family: "家境",
  fortune: "气运"
};

export interface InternalRunState extends RunState {
  seed: number;
  endAge: number;
  negativeStreaks: Record<CoreStatKey, number>;
  yearsSinceLastMilestone: number;
  tuningSnapshot: GameplayTuning;
  aiConversation?: AiConversationState;
  story: StoryDirectorState;
  narrative: NarrativeRunState;
  /** The world package which enabled the narrative runtime for this run. */
  narrativeWorldId?: string;
  pendingDirectedDecisionEffects?: Record<DecisionType, DirectedDecisionEffect>;
  pendingDirectedDecisionPolicy?: Record<DecisionType, PendingDirectedDecisionPolicy>;
  pendingDirectedDecisionDirections?: Record<DecisionType, StoryDirectionDefinition>;
  pendingDirectedDecisionFactEffects?: Partial<Record<DecisionType, StoryFactEffect>>;
  pendingDynamicScene?: {
    id: string;
    routeId: string;
    factionId?: string;
    beat: Exclude<NonNullable<EventDefinition["narrativeBeat"]>, "ending">;
    mainlineActId: string;
    factId?: string;
  };
  narrativeReservoir: NarrativeReservoirState;
  turnRecords: TurnRecord[];
}

const defaultAgeThresholds: AgeThreshold[] = [
  { id: "child", label: "幼年", min: 0, max: 12 },
  { id: "youth", label: "青年", min: 13, max: 29 },
  { id: "prime", label: "壮年", min: 30, max: 44 },
  { id: "middle", label: "中年", min: 45, max: 59 },
  { id: "elder", label: "老年", min: 60, max: Number.MAX_SAFE_INTEGER }
];

function clamp(num: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, num));
}

function cloneStats(stats: Stats): Stats {
  return {
    intelligence: stats.intelligence,
    charisma: stats.charisma,
    family: stats.family,
    fortune: stats.fortune,
    physique: stats.physique
  };
}

function randomInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function createStoryCompletenessBuffer(): StoryCompletenessBuffer {
  return {
    origin: 0,
    accumulation: 0,
    pressure: 0,
    turn: 0,
    resolution: 0
  };
}

function createStoryFactLedger(): StoryFactLedger {
  return {
    version: 1,
    facts: [],
    openQuestion: [],
    stakes: [],
    commitment: [],
    cost: [],
    relationshipChange: [],
    resolvedFactIds: [],
    blockedFactIds: []
  };
}

function normalizeStoryFactLedger(input: StoryFactLedger | undefined): StoryFactLedger {
  const empty = createStoryFactLedger();
  const source = input?.version === 1 ? input : empty;
  const statuses = new Set(["open", "resolved", "blocked"]);
  const kinds = new Set(["open_question", "stake", "commitment", "cost", "relationship_change"]);
  const facts = Array.isArray(source.facts)
    ? source.facts
      .filter((fact): fact is StoryFactRecord => Boolean(
        fact?.id && fact?.label && fact?.sourceEventId && kinds.has(fact.kind) && statuses.has(fact.status)
      ))
      .map((fact) => ({
        ...fact,
        id: fact.id.trim().slice(0, 120),
        label: fact.label.trim().slice(0, 160),
        sourceEventId: fact.sourceEventId.trim().slice(0, 120),
        introducedAge: Math.max(0, Number(fact.introducedAge) || 0),
        lastTouchedAge: Math.max(0, Number(fact.lastTouchedAge) || 0),
        routeIds: Array.from(new Set(fact.routeIds ?? [])).slice(0, 6),
        characterIds: Array.from(new Set(fact.characterIds ?? [])).slice(0, 6)
      }))
      .slice(-64)
    : [];
  const resolvedFactIds = Array.from(new Set([
    ...(source.resolvedFactIds ?? []),
    ...facts.filter((fact) => fact.status === "resolved").map((fact) => fact.id)
  ])).slice(-64);
  const blockedFactIds = Array.from(new Set([
    ...(source.blockedFactIds ?? []),
    ...facts.filter((fact) => fact.status === "blocked").map((fact) => fact.id)
  ])).slice(-64);
  const openFacts = facts.filter((fact) => fact.status === "open");
  const idsForKind = (kind: StoryFactRecord["kind"]): string[] => openFacts
    .filter((fact) => fact.kind === kind)
    .map((fact) => fact.id)
    .slice(-24);
  return {
    version: 1,
    facts,
    openQuestion: idsForKind("open_question"),
    stakes: idsForKind("stake"),
    commitment: idsForKind("commitment"),
    cost: idsForKind("cost"),
    relationshipChange: idsForKind("relationship_change"),
    resolvedFactIds,
    blockedFactIds
  };
}

function hydrateFactLedgerFromLegacyState(story: StoryDirectorState, narrative: NarrativeRunState): void {
  const ledger = story.factLedger;
  if (!ledger || ledger.facts.length > 0 || (story.seenEventIds?.length ?? 0) === 0) return;
  const facts: StoryFactRecord[] = narrative.threads.map((thread) => ({
    id: `legacy:thread:${thread.id}`,
    kind: "open_question",
    label: "一条已发生、仍会影响后续的旧事。",
    priority: 1,
    threadId: thread.id,
    status: thread.status === "resolved" ? "resolved" : "open",
    introducedAge: thread.openedAge,
    lastTouchedAge: thread.lastTouchedAge,
    sourceEventId: "legacy-save",
    resolvedAge: thread.status === "resolved" ? thread.lastTouchedAge : undefined
  }));
  if (story.committedDirectionIds.length > 0) {
    const directionId = story.activeDirectionId ?? story.committedDirectionIds.at(-1)!;
    const age = story.lastDirectionCommitAge ?? 0;
    facts.push({
      id: `legacy:commitment:${directionId}`,
      kind: "commitment",
      label: "人物曾在关键关口作出承诺。",
      routeIds: [directionId],
      status: "open",
      introducedAge: age,
      lastTouchedAge: age,
      sourceEventId: "legacy-save"
    }, {
      id: `legacy:cost:${directionId}`,
      kind: "cost",
      label: "此前的取舍留下了需要承担的代价。",
      routeIds: [directionId],
      status: "open",
      introducedAge: age,
      lastTouchedAge: age,
      sourceEventId: "legacy-save"
    });
  }
  story.factLedger = normalizeStoryFactLedger({ ...ledger, facts });
}

function applyStoryFactEffect(
  story: StoryDirectorState,
  effect: StoryFactEffect | undefined,
  age: number,
  sourceEventId: string
): void {
  if (!effect) return;
  const ledger = story.factLedger ?? (story.factLedger = createStoryFactLedger());
  const byId = new Map(ledger.facts.map((fact) => [fact.id, fact]));
  for (const source of effect.introduce ?? []) {
    if (!source.id?.trim() || !source.label?.trim()) continue;
    const existing = byId.get(source.id);
    if (existing) {
      if (existing.status === "open") existing.lastTouchedAge = age;
      continue;
    }
    const fact: StoryFactRecord = {
      id: source.id.trim().slice(0, 120),
      kind: source.kind,
      label: source.label.trim().slice(0, 160),
      priority: source.priority,
      threadId: source.threadId,
      routeIds: source.routeIds?.slice(0, 6),
      characterIds: source.characterIds?.slice(0, 6),
      status: "open",
      introducedAge: age,
      lastTouchedAge: age,
      sourceEventId
    };
    ledger.facts.push(fact);
    byId.set(fact.id, fact);
  }
  for (const id of effect.modifyFactIds ?? []) {
    const fact = byId.get(id);
    if (fact?.status === "open") fact.lastTouchedAge = age;
  }
  for (const id of effect.resolveFactIds ?? []) {
    const fact = byId.get(id);
    if (fact?.status === "open") {
      fact.status = "resolved";
      fact.lastTouchedAge = age;
      fact.resolvedAge = age;
    }
  }
  for (const id of effect.blockFactIds ?? []) {
    const fact = byId.get(id);
    if (fact?.status === "open") {
      fact.status = "blocked";
      fact.lastTouchedAge = age;
    }
  }
  story.factLedger = normalizeStoryFactLedger(ledger);
}

function hasOpenFact(story: StoryDirectorState, id: string): boolean {
  return story.factLedger?.facts.some((fact) => fact.id === id && fact.status === "open") ?? false;
}

function hasEstablishedFact(story: StoryDirectorState, id: string): boolean {
  return story.factLedger?.facts.some((fact) => fact.id === id && fact.status !== "blocked") ?? false;
}

function narrativePromptSourceForRun(run: InternalRunState) {
  return {
    worldId: run.worldId,
    age: run.age,
    personaPrompt: run.personaPrompt,
    stats: run.stats,
    fame: run.fame,
    history: run.history,
    tuning: run.tuningSnapshot,
    cards: run.cards,
    items: run.items,
    story: run.story,
    narrative: run.narrative
  };
}

function isClosureEligible(story: StoryDirectorState, narrative?: NarrativeRunState): boolean {
  if (narrative?.enabled) {
    return Boolean(
      story.contract.initialDirectionId &&
      story.committedDirectionIds.length > 0 &&
      isNarrativeEndingEligible(story, narrative)
    );
  }
  const completeness = story.completeness;
  const baseEligible = (
    completeness.origin >= 1 &&
    completeness.accumulation >= 2 &&
    completeness.pressure >= 2 &&
    completeness.turn >= 1 &&
    Boolean(story.contract.initialDirectionId) &&
    story.committedDirectionIds.length > 0
  );
  return baseEligible && (!narrative?.enabled || isNarrativeEndingEligible(story, narrative));
}

function createStoryContract(worldId: string): StoryDirectorState["contract"] {
  return {
    version: 1,
    worldId,
    mainlineId: `${worldId}.mainline`,
    coreThreadIds: []
  };
}

function createStoryDirectorState(worldId: string): StoryDirectorState {
  return {
    contract: createStoryContract(worldId),
    seenEventIds: [],
    cooldowns: {},
    flags: [],
    openThreads: [],
    resolvedThreadIds: [],
    factionTension: {},
    committedDirectionIds: [],
    completeness: createStoryCompletenessBuffer(),
    closureEligible: false,
    closureState: "open",
    blockedFlags: [],
    factLedger: createStoryFactLedger()
  };
}

function ensureStoryDirectorState(run: InternalRunState): StoryDirectorState {
  // Old saves have no package marker; preserve their stored enablement during migration.
  const narrativeEnabled = run.narrativeWorldId === run.worldId || (
    run.narrativeWorldId === undefined && run.narrative?.enabled === true
  );
  run.narrative = ensureNarrativeRunState(run.narrative, narrativeEnabled, run.age);
  run.turnRecords ??= [];
  if (!run.story) {
    run.story = createStoryDirectorState(run.worldId);
    return run.story;
  }

  const story = run.story;
  if (!story.contract || story.contract.version !== 1 || story.contract.worldId !== run.worldId) {
    story.contract = createStoryContract(run.worldId);
  } else {
    story.contract.mainlineId = story.contract.mainlineId?.trim() || `${run.worldId}.mainline`;
    story.contract.coreThreadIds = Array.from(new Set(story.contract.coreThreadIds ?? []));
  }
  story.seenEventIds ??= [];
  story.cooldowns ??= {};
  story.flags ??= [];
  story.openThreads ??= [];
  story.resolvedThreadIds ??= [];
  story.factionTension ??= {};
  story.committedDirectionIds ??= [];
  story.foregroundExperienceId ??= story.activeDirectionId;
  story.closureExperienceId ??= undefined;
  story.blockedFlags ??= [];
  story.factLedger = normalizeStoryFactLedger(story.factLedger);
  hydrateFactLedgerFromLegacyState(story, run.narrative);
  if (story.closureState !== "open" && story.closureState !== "guiding" && story.closureState !== "finished") {
    story.closureState = "open";
  }
  story.completeness = {
    ...createStoryCompletenessBuffer(),
    ...story.completeness
  };
  story.mainlineCompleted = story.mainlineCompleted === true;
  story.mainlineCompletedAge = Number.isFinite(story.mainlineCompletedAge)
    ? Math.max(0, Number(story.mainlineCompletedAge))
    : undefined;
  if (story.lastStoryPosition && !storyPositions.includes(story.lastStoryPosition)) {
    story.lastStoryPosition = undefined;
  }
  story.closureEligible = run.narrative.enabled
    ? Boolean(story.mainlineCompleted)
    : isClosureEligible(story, run.narrative);
  if (story.closureEligible && run.narrative.enabled && run.narrative.endingState === "open") {
    run.narrative.endingState = "eligible";
  }
  return story;
}

function pickOne<T>(rng: Rng, list: T[]): T {
  return list[Math.floor(rng() * list.length)];
}

function highestModifiedStat(card: BackgroundCard): StatKey {
  const entries = allStatKeys.map((key) => ({ key, value: card.modifiers[key] ?? 0 }));
  entries.sort((a, b) => b.value - a.value);
  return entries[0]?.key ?? "fortune";
}

function defaultCardEffects(card: BackgroundCard): PassiveEffect[] {
  const stat = highestModifiedStat(card);
  const amount = card.rarity === "legendary" ? 2 : 1;
  const effects: PassiveEffect[] = [
    {
      type: "candidate_weight",
      tags: [stat],
      amount,
      description: `${card.name}会让相关机遇更容易出现。`
    },
    {
      type: "negative_reduce",
      stat,
      amount: 1,
      description: `${card.name}能缓冲${stat}相关的负面变化。`
    }
  ];
  if (card.rarity === "legendary") {
    effects.push({
      type: "death_risk_reduce",
      amount: 0.04,
      description: `${card.name}会在危局中减轻命数反噬。`
    });
  }
  return effects;
}

function collectPassiveEffects(run: InternalRunState): PassiveEffect[] {
  const cardEffects = run.cards.flatMap((card) => card.effects?.length ? card.effects : defaultCardEffects(card));
  const itemEffects = run.items.flatMap((item) => item.effects ?? []);
  return [...cardEffects, ...itemEffects];
}

function effectMatchesTags(effect: PassiveEffect, tags: string[]): boolean {
  if (!effect.tags || effect.tags.length === 0) return true;
  return effect.tags.some((tag) => tags.includes(tag));
}

function reduceNegativeChanges(
  run: InternalRunState,
  changes: Partial<Record<StatKey, number>>
): Partial<Record<StatKey, number>> {
  const next = { ...changes };
  for (const effect of collectPassiveEffects(run)) {
    if (effect.type !== "negative_reduce") continue;
    const amount = Math.max(0, effect.amount ?? 0);
    const targets = effect.stat ? [effect.stat] : allStatKeys;
    for (const key of targets) {
      const current = next[key] ?? 0;
      if (current >= 0) continue;
      next[key] = Math.min(0, current + amount);
    }
  }
  return next;
}

function reduceDeathRisk(run: InternalRunState, risk: number): number {
  const reduction = collectPassiveEffects(run)
    .filter((effect) => effect.type === "death_risk_reduce")
    .reduce((sum, effect) => sum + Math.max(0, effect.amount ?? 0), 0);
  return Math.max(0, risk - reduction);
}

function milestoneTriggerRate(stageId: AgeThreshold["id"], tuning: GameplayTuning): number {
  const rate = tuning.milestone.triggerRateByStage[stageId];
  return clamp(rate, 0, 1);
}

function pickMilestoneSeedEvent(rng: Rng, pool: string[]): string {
  if (pool.length === 0) return "你被卷入一场无法回避的关键事件。";
  return pickOne(rng, pool);
}

function shouldTriggerRandomMilestone(run: InternalRunState, tuning: GameplayTuning, rng: Rng): boolean {
  if (run.age < tuning.milestone.minEligibleAge) return false;
  const rate = milestoneTriggerRate(run.ageStage.id, tuning);
  const guaranteed = run.yearsSinceLastMilestone >= tuning.milestone.guaranteeYears;
  return guaranteed || rng() < rate;
}

function resolveAgeThresholds(world: WorldConfig): AgeThreshold[] {
  if (world.ageThresholds && world.ageThresholds.length > 0) {
    return [...world.ageThresholds].sort((a, b) => a.min - b.min);
  }
  return defaultAgeThresholds;
}

function resolveAgeStage(age: number, world: WorldConfig): AgeThreshold {
  const thresholds = resolveAgeThresholds(world);
  const found = thresholds.find((t) => age >= t.min && age <= t.max);
  const last = thresholds[thresholds.length - 1];
  return found ?? { ...last, max: Number.MAX_SAFE_INTEGER };
}

export function resolveAgeStageByWorld(world: WorldConfig, age: number): AgeThreshold {
  return resolveAgeStage(age, world);
}

function validateStats(stats: Stats): void {
  const entries = Object.entries(stats) as Array<[StatKey, number]>;
  for (const [, value] of entries) {
    if (value < 0 || value > 10) {
      throw new Error("属性必须在0-10之间");
    }
  }
}

interface StatBinEffect {
  growthBias: number;
  decayBias: number;
  growthBonusChance: number;
  extraDecayChance: number;
}

function resolveStageDeltaCap(stageId: AgeThreshold["id"], tuning: GameplayTuning): number {
  return tuning.stage.deltaCapByStage[stageId];
}

function resolveDeltaBand(absDelta: number, stageCap: number, tuning: GameplayTuning): "light" | "medium" | "heavy" {
  const lightMax = Math.max(1, Math.ceil(stageCap * tuning.stage.lightBandRatio));
  const mediumMax = Math.max(2, Math.ceil(stageCap * tuning.stage.mediumBandRatio));
  if (absDelta <= lightMax) return "light";
  if (absDelta <= mediumMax) return "medium";
  return "heavy";
}

function buildDeltaBinTags(changes: Partial<Record<StatKey, number>>, stageCap: number, tuning: GameplayTuning): string[] {
  const tags: string[] = [];
  let total = 0;
  let positiveCount = 0;
  let negativeCount = 0;
  let maxLoss = 0;

  for (const key of allStatKeys) {
    const delta = changes[key] ?? 0;
    if (delta === 0) {
      tags.push(`delta_${key}_steady`);
      continue;
    }
    const absDelta = Math.abs(delta);
    const band = resolveDeltaBand(absDelta, stageCap, tuning);
    const direction = delta > 0 ? "up" : "down";
    tags.push(`delta_${key}_${direction}_${band}`);
    total += delta;
    if (delta > 0) positiveCount += 1;
    if (delta < 0) {
      negativeCount += 1;
      if (absDelta > maxLoss) maxLoss = absDelta;
    }
  }

  if (positiveCount === 0 && negativeCount === 0) {
    tags.push("delta_overall_flat");
  } else if (positiveCount > 0 && negativeCount > 0) {
    tags.push("delta_overall_mixed");
  } else if (positiveCount > 0) {
    tags.push("delta_overall_positive");
  } else {
    tags.push("delta_overall_negative");
  }

  if (total >= Math.ceil(stageCap * tuning.stage.overallExtremeRatio)) tags.push("delta_overall_surge");
  if (total <= -Math.ceil(stageCap * tuning.stage.overallExtremeRatio)) tags.push("delta_overall_crash");
  if (maxLoss >= Math.ceil(stageCap * tuning.stage.overallExtremeRatio)) tags.push("delta_overall_shock");

  return tags;
}

function classifyEventTone(changes: Partial<Record<StatKey, number>>, stageCap: number, tuning: GameplayTuning): "positive" | "negative" | "mixed" | "flat" | "critical" {
  let total = 0;
  let pos = 0;
  let neg = 0;
  let maxLoss = 0;

  for (const key of allStatKeys) {
    const delta = changes[key] ?? 0;
    total += delta;
    if (delta > 0) pos += 1;
    if (delta < 0) {
      neg += 1;
      maxLoss = Math.max(maxLoss, Math.abs(delta));
    }
  }

  if (pos === 0 && neg === 0) return "flat";
  if (
    maxLoss >= Math.ceil(stageCap * tuning.stage.overallExtremeRatio) ||
    total <= -Math.ceil(stageCap * tuning.stage.overallExtremeRatio)
  ) return "critical";
  if (pos > 0 && neg > 0) return "mixed";
  return total >= 0 ? "positive" : "negative";
}

function worldNegativeGuideTags(worldId: string, tone: "positive" | "negative" | "mixed" | "flat" | "critical", rng: Rng): string[] {
  if (tone !== "negative" && tone !== "critical") return [];
  const poolByWorld: Record<string, string[]> = {
    modern: [
      "guide_workplace_intrigue",
      "guide_public_opinion_backlash",
      "guide_capital_pressure",
      "guide_relationship_betrayal",
      "guide_health_overdraft"
    ],
    ancient: [
      "guide_court_intrigue",
      "guide_faction_purge",
      "guide_clan_suppression",
      "guide_frontier_turmoil",
      "guide_grain_crisis"
    ],
    fantasy: [
      "guide_arcane_backlash",
      "guide_cult_hunt",
      "guide_old_god_whisper",
      "guide_guild_betrayal",
      "guide_contamination_outbreak"
    ]
  };
  const pool = poolByWorld[worldId] ?? ["guide_generic_crisis"];
  const picked = pickOne(rng, pool);
  return tone === "critical"
    ? ["tone_critical_negative", picked, "guide_fatal_pressure"]
    : ["tone_negative", picked];
}

function resolveCoreStatBinEffect(value: number): StatBinEffect {
  if (value <= -21) return { growthBias: -0.22, decayBias: 0.3, growthBonusChance: 0, extraDecayChance: 0.35 };
  if (value <= -11) return { growthBias: -0.14, decayBias: 0.2, growthBonusChance: 0.04, extraDecayChance: 0.26 };
  if (value <= -1) return { growthBias: -0.06, decayBias: 0.12, growthBonusChance: 0.08, extraDecayChance: 0.18 };
  if (value <= 10) return { growthBias: 0.04, decayBias: 0, growthBonusChance: 0.12, extraDecayChance: 0.08 };
  if (value <= 20) return { growthBias: 0.06, decayBias: -0.03, growthBonusChance: 0.14, extraDecayChance: 0.06 };
  // Attributes keep changing at high values, but their automatic growth
  // becomes deliberately slower so that early good fortune does not decide a run.
  return { growthBias: -0.02, decayBias: -0.02, growthBonusChance: 0.1, extraDecayChance: 0.04 };
}

function resolvePhysiqueBinEffect(value: number): StatBinEffect {
  if (value <= 2) return { growthBias: -0.08, decayBias: 0.18, growthBonusChance: 0.02, extraDecayChance: 0.22 };
  if (value <= 10) return { growthBias: 0, decayBias: 0.06, growthBonusChance: 0.08, extraDecayChance: 0.12 };
  if (value <= 20) return { growthBias: 0.08, decayBias: -0.04, growthBonusChance: 0.14, extraDecayChance: 0.08 };
  return { growthBias: -0.01, decayBias: -0.02, growthBonusChance: 0.1, extraDecayChance: 0.05 };
}

function calcBaseGrowth(
  stats: Stats,
  diff: DifficultyConfig,
  rng: Rng,
  tuning: GameplayTuning
): Partial<Record<StatKey, number>> {
  const result: Partial<Record<StatKey, number>> = {};
  for (const key of allStatKeys) {
    const now = stats[key];
    const effect = key === "physique"
      ? resolvePhysiqueBinEffect(now)
      : resolveCoreStatBinEffect(now);
    const growthChance = clamp(
      tuning.growth.baseGrowthChance + diff.growthBias + effect.growthBias,
      tuning.growth.growthChanceClampMin,
      tuning.growth.growthChanceClampMax
    );
    const decayChance = clamp(
      tuning.growth.baseDecayChance + diff.yearlyVolatility * tuning.growth.decayVolatilityFactor + effect.decayBias,
      tuning.growth.decayChanceClampMin,
      tuning.growth.decayChanceClampMax
    );
    const roll = rng();
    if (roll < growthChance) {
      const bonus = rng() < effect.growthBonusChance ? 1 : 0;
      result[key] = 1 + bonus;
    } else if (roll < growthChance + decayChance * tuning.growth.decayBranchFactor) {
      const penalty = rng() < effect.extraDecayChance ? 1 : 0;
      result[key] = -1 - penalty;
    } else {
      result[key] = 0;
    }
  }
  return result;
}

function clampYearlyChangesByStage(
  changes: Partial<Record<StatKey, number>>,
  stageCap: number
): Partial<Record<StatKey, number>> {
  const next: Partial<Record<StatKey, number>> = {};
  for (const key of allStatKeys) {
    const delta = changes[key] ?? 0;
    next[key] = clamp(delta, -stageCap, stageCap);
  }
  return next;
}

function calcSpecialEventChanges(
  _stats: Stats,
  difficulty: DifficultyConfig,
  rng: Rng,
  tuning: GameplayTuning
): Partial<Record<StatKey, number>> {
  const focus = pickOne(rng, allStatKeys);
  const mirror = pickOne(rng, allStatKeys.filter((k) => k !== focus));
  const positive = rng() < tuning.growth.specialPositiveBaseChance + difficulty.growthBias * tuning.growth.specialPositiveGrowthBiasFactor;

  if (positive) {
    return {
      [focus]: 2,
      [mirror]: 1
    };
  }
  return {
    [focus]: -2,
    [mirror]: -1
  };
}

function applyChanges(stats: Stats, changes: Partial<Record<StatKey, number>>): Stats {
  const next = cloneStats(stats);
  for (const key of coreStatKeys) {
    const delta = changes[key] ?? 0;
    next[key] = clamp(next[key] + delta, CORE_STAT_MIN, STAT_MAX);
  }
  next.physique = clamp(next.physique + (changes.physique ?? 0), 0, STAT_MAX);
  return next;
}

function attributeBandMagnitude(band: NarrativeAttributeEffect["band"]): number {
  if (band === "heavy") return 3;
  if (band === "medium") return 2;
  return 1;
}

function isKnownStatKey(value: string): value is StatKey {
  return allStatKeys.includes(value as StatKey);
}

function resolveNarrativeAttributeChanges(
  run: InternalRunState,
  world: WorldConfig,
  effects: NarrativeAttributeEffect[],
  mode: "background" | "decision",
  policy?: NarrativeAttributePolicy
): Partial<Record<StatKey, number>> | null {
  if (!Array.isArray(effects)) return null;
  const maxEffects = policy?.maxEffects ?? (mode === "background" ? 1 : 2);
  const minEffects = policy?.minEffects ?? 0;
  if (effects.length < minEffects || effects.length > maxEffects) return null;
  if (effects.length === 0) return {};
  const unique = new Set<StatKey>();
  const changes: Partial<Record<StatKey, number>> = {};
  for (const effect of effects) {
    if (!effect || !isKnownStatKey(effect.stat) || unique.has(effect.stat)) return null;
    if (effect.direction !== "up" && effect.direction !== "down") return null;
    if (effect.band !== "light" && effect.band !== "medium" && effect.band !== "heavy") return null;
    if (mode === "background" && effect.band === "heavy" && !policy) return null;
    if (policy && (
      !policy.allowedStats.includes(effect.stat) ||
      !policy.allowedBands.includes(effect.band) ||
      !policy.allowedDirections.includes(effect.direction)
    )) {
      return null;
    }
    unique.add(effect.stat);
    const sign = effect.direction === "up" ? 1 : -1;
    changes[effect.stat] = sign * attributeBandMagnitude(effect.band);
  }
  if (policy?.preferredStats?.length && (policy.minPreferredEffects ?? 0) > 0) {
    const preferredCount = effects.filter((effect) => policy.preferredStats!.includes(effect.stat)).length;
    if (preferredCount < (policy.minPreferredEffects ?? 0)) return null;
  }
  if (policy?.requirePositive && !Object.values(changes).some((value) => (value ?? 0) > 0)) return null;
  const stageCap = resolveStageDeltaCap(resolveAgeStage(run.age, world).id, run.tuningSnapshot);
  return reduceNegativeChanges(run, clampYearlyChangesByStage(changes, stageCap));
}

export function approveNarrativeAttributeOutcome(
  run: InternalRunState,
  world: WorldConfig,
  outcome: ApprovedNarrativeAttributeOutcome,
  mode: "background" | "decision",
  policy?: NarrativeAttributePolicy
): Partial<Record<StatKey, number>> | null {
  return resolveNarrativeAttributeChanges(run, world, outcome.effects, mode, policy);
}

/** Applies one model-proposed outcome per background year after its narration is valid. */
export function settleNarrativeBackgroundOutcomes(
  run: InternalRunState,
  world: WorldConfig,
  outcomes: Array<{ age: number; effects: NarrativeAttributeEffect[] }>,
  pendingAges: readonly number[],
  attributePolicies?: Map<number, NarrativeAttributePolicy>
): boolean {
  const byAge = new Map(outcomes.map((outcome) => [outcome.age, outcome]));
  const pendingAgeSet = new Set(pendingAges);
  if (pendingAgeSet.size === 0 || byAge.size !== pendingAgeSet.size || Array.from(pendingAgeSet).some((age) => !byAge.has(age))) return false;
  const pending = run.history.filter((event) => pendingAgeSet.has(event.age));
  if (pending.length !== pendingAgeSet.size) return false;
  const finalAge = run.age;
  for (const event of pending) {
    run.age = event.age;
    const outcome = byAge.get(event.age)!;
    const changes = approveNarrativeAttributeOutcome(run, world, outcome, "background", attributePolicies?.get(event.age));
    if (changes === null) return false;
    event.statChanges = changes;
    run.stats = applyChanges(run.stats, changes);
    run.ageStage = resolveAgeStage(run.age, world);
    refreshRunFame(run);
    updateNegativeStreaks(run);
    const rng = seedrandom(`${run.seed}:background-model-resolve:${run.age}:${event.title}`);
    const deathCheck = calcDeathRisk(run, world, 0);
    const adjustedDeathRisk = reduceDeathRisk(run, deathCheck.risk);
    if (adjustedDeathRisk > 0 && rng() < adjustedDeathRisk) {
      const cause = deathCheck.cause ?? "意外灾祸";
      if (!deferNarrativeCatastrophe(run, cause)) {
        run.ended = true;
        run.outcome = "dead";
        run.deathCause = cause;
        run.endingSummary = calcEnding(run);
        break;
      }
    }
  }
  run.age = finalAge;
  run.ageStage = resolveAgeStage(run.age, world);
  refreshRunFame(run);
  return true;
}

function generateMilestoneChoice(age: number, seedEvent: string, tuning: GameplayTuning): MilestoneChoice {
  return {
    age,
    background: seedEvent.trim() || "命运的岔路在你面前展开。",
    options: [
      {
        id: "safe",
        label: "稳健",
        risk: tuning.decision.profiles.safe.risk,
        reward: tuning.decision.profiles.safe.reward,
        description: "优先保底，收益稳定但上限偏低。"
      },
      {
        id: "balanced",
        label: "适中",
        risk: tuning.decision.profiles.balanced.risk,
        reward: tuning.decision.profiles.balanced.reward,
        description: "平衡风险与成长，容易获得中等收益。"
      },
      {
        id: "risky",
        label: "冒险",
        risk: tuning.decision.profiles.risky.risk,
        reward: tuning.decision.profiles.risky.reward,
        description: "高风险高收益，失败惩罚也更显著。"
      }
    ]
  };
}

function applyDecision(
  stats: Stats,
  decision: DecisionType,
  difficulty: DifficultyConfig,
  rng: Rng,
  tuning: GameplayTuning
): { statChanges: Partial<Record<StatKey, number>>; deathRollBonus: number } {
  const primary = pickOne(rng, allStatKeys);
  const secondary = pickOne(rng, allStatKeys.filter((k) => k !== primary));

  const setup = tuning.decision.profiles[decision];

  const successRate = clamp(
    setup.successRate - difficulty.yearlyVolatility * tuning.decision.successRateVolatilityFactor,
    tuning.decision.successRateClampMin,
    tuning.decision.successRateClampMax
  );
  const success = rng() < successRate;
  const baseGain = Math.round(setup.gain * difficulty.riskRewardMultiplier);
  const baseLoss = Math.round(setup.loss * difficulty.failurePenaltyMultiplier);

  if (success) {
    return {
      statChanges: {
      [primary]: clamp(baseGain, tuning.decision.gainClampMin, tuning.decision.gainClampMax),
      [secondary]: tuning.decision.secondarySuccessDelta
      },
      deathRollBonus: setup.deathBonus
    };
  }

  return {
    statChanges: {
    [primary]: clamp(baseLoss, tuning.decision.lossClampMin, tuning.decision.lossClampMax),
    [secondary]: tuning.decision.secondaryFailureDelta
    },
    deathRollBonus: setup.deathBonus
  };
}

function buildEventTitle(world: WorldConfig, age: number, rng: Rng, special: boolean, tuning: GameplayTuning): string {
  const topic = pickOne(rng, world.yearlyEventHints);
  const blankYear = rng() < tuning.pacing.blankYearChance;
  if (blankYear) {
    return `${age}岁·平年·${topic}`;
  }
  if (special) {
    return `${age}岁·异动·${topic}`;
  }
  return `${age}岁·${topic}`;
}

function summarizeStatDelta(changes: Partial<Record<StatKey, number>>): string {
  const mapping: Record<StatKey, string> = {
    intelligence: "智力",
    charisma: "魅力",
    family: "家境",
    fortune: "气运",
    physique: "体魄"
  };
  const parts: string[] = [];
  for (const key of Object.keys(mapping) as StatKey[]) {
    const delta = changes[key] ?? 0;
    if (delta > 0) parts.push(`${mapping[key]}+${delta}`);
    if (delta < 0) parts.push(`${mapping[key]}${delta}`);
  }
  return parts.length ? parts.join("，") : "平稳无明显变化";
}

function computeFame(stats: Stats): number {
  return computeFameWithTuning(stats, createDefaultGameplayTuning());
}

function computeFameWithTuning(
  stats: Stats,
  tuning: GameplayTuning,
  signals?: {
    mainlineActCount?: number;
    stableChoices?: number;
    balancedChoices?: number;
    riskyBreakthroughs?: number;
    riskySetbacks?: number;
  }
): number {
  const weight = tuning.fame;
  const denominator =
    weight.intelligenceWeight +
    weight.charismaWeight +
    weight.familyWeight +
    weight.fortuneWeight +
    weight.physiqueWeight;
  if (denominator <= 0) {
    return weight.min;
  }
  const weighted =
    stats.intelligence * weight.intelligenceWeight +
    stats.charisma * weight.charismaWeight +
    stats.family * weight.familyWeight +
    stats.fortune * weight.fortuneWeight +
    stats.physique * weight.physiqueWeight;
  const normalized = weighted / denominator;
  const statFame = (normalized / Math.max(1, weight.maxStatValue)) * (weight.max - weight.min) + weight.min;
  const narrativeImpact =
    (signals?.mainlineActCount ?? 0) * weight.mainlineActBonus +
    (signals?.stableChoices ?? 0) * weight.stableChoiceBonus +
    (signals?.balancedChoices ?? 0) * weight.balancedChoiceBonus +
    (signals?.riskyBreakthroughs ?? 0) * weight.riskyBreakthroughBonus -
    (signals?.riskySetbacks ?? 0) * weight.riskySetbackPenalty;
  const fame = statFame + narrativeImpact;
  return Math.max(weight.min, Math.min(weight.max, Number(fame.toFixed(1))));
}

function refreshRunFame(run: InternalRunState): void {
  const signals = {
    mainlineActCount: new Set(
      run.narrative.completedScenes
        .map((scene) => scene.mainlineActId)
        .filter((id): id is string => Boolean(id))
    ).size,
    stableChoices: run.history.filter((event) => event.tags.includes("decision_outcome_stable")).length,
    balancedChoices: run.history.filter((event) => event.tags.includes("decision_outcome_balanced")).length,
    riskyBreakthroughs: run.history.filter((event) => event.tags.includes("decision_outcome_breakthrough")).length,
    riskySetbacks: run.history.filter((event) => event.tags.includes("decision_outcome_setback")).length
  };
  run.fame = computeFameWithTuning(run.stats, run.tuningSnapshot, signals);
}

function directedDecisionOutcomeTags(
  decision: DecisionType,
  outcome?: ApprovedNarrativeAttributeOutcome
): string[] {
  if (!outcome) return [];
  if (decision === "safe") return ["decision_outcome_stable"];
  if (decision === "balanced") return ["decision_outcome_balanced"];
  const tags: string[] = [];
  if (outcome.effects.some((effect) => effect.direction === "up" && effect.band === "heavy")) {
    tags.push("decision_outcome_breakthrough");
  }
  if (outcome.effects.some((effect) => effect.direction === "down" && effect.band === "heavy")) {
    tags.push("decision_outcome_setback");
  }
  return tags;
}

function updateNegativeStreaks(run: InternalRunState): void {
  if (run.age < run.tuningSnapshot.death.minAge) {
    for (const key of coreStatKeys) {
      run.negativeStreaks[key] = 0;
    }
    return;
  }
  for (const key of coreStatKeys) {
    run.negativeStreaks[key] = run.stats[key] < 0 ? run.negativeStreaks[key] + 1 : 0;
  }
}

function calcDeathRisk(
  run: InternalRunState,
  _world: WorldConfig,
  extraBonus = 0
): { risk: number; cause?: string } {
  const deathTuning = run.tuningSnapshot.death;
  if (run.age < deathTuning.minAge) {
    return { risk: 0 };
  }

  const lowPhysique = run.stats.physique < deathTuning.lowPhysiqueThreshold;
  const physiqueRisk = lowPhysique
    ? clamp(
      deathTuning.physiqueBaseRisk +
      ((deathTuning.lowPhysiqueThreshold - run.stats.physique) / deathTuning.lowPhysiqueThreshold) * deathTuning.physiqueMissingRiskFactor,
      deathTuning.physiqueRiskClampMin,
      deathTuning.physiqueRiskClampMax
    )
    : 0;

  let longNegativeRisk = 0;
  let longNegativeCause: string | undefined;
  for (const key of coreStatKeys) {
    const streak = run.negativeStreaks[key];
    if (run.stats[key] >= 0 || streak < deathTuning.negativeStreakTrigger) continue;
    const valueSeverity = clamp(Math.abs(run.stats[key]) / 30, 0, 1);
    const streakSeverity = clamp((streak - deathTuning.negativeStreakTrigger + 1) / deathTuning.longNegativeStreakDivisor, 0, 1);
    const risk = clamp(
      deathTuning.longNegativeBaseRisk +
      valueSeverity * deathTuning.longNegativeValueFactor +
      streakSeverity * deathTuning.longNegativeStreakFactor,
      deathTuning.longNegativeRiskClampMin,
      deathTuning.longNegativeRiskClampMax
    );
    if (risk > longNegativeRisk) {
      longNegativeRisk = risk;
      longNegativeCause = `${negativeStatLabel[key]}长期低迷反噬`;
    }
  }

  const hasTrigger = lowPhysique || longNegativeRisk > 0;
  if (!hasTrigger) return { risk: 0 };

  const cause = physiqueRisk >= longNegativeRisk ? "体魄衰竭" : longNegativeCause;
  const risk = clamp(
    Math.max(physiqueRisk, longNegativeRisk) + extraBonus,
    deathTuning.finalRiskClampMin,
    deathTuning.finalRiskClampMax
  );
  return { risk, cause };
}

function checkAscension(run: InternalRunState): AscensionState {
  const threshold = run.tuningSnapshot.ascension.deterministicStatThreshold;
  const byStat: Array<{ key: keyof Stats; title: string; desc: string; type: AscensionState["type"] }> = [
    { key: "intelligence", title: "智识飞升", desc: "你的思维突破了凡人的认知边界。", type: "eternal_youth" },
    { key: "charisma", title: "众望飞升", desc: "你的意志可聚拢时代人心。", type: "immortality" },
    { key: "fortune", title: "命运飞升", desc: "你与命运的偏转达成同调。", type: "rejuvenation" },
    { key: "physique", title: "体魄飞升", desc: "你的躯体抵达超凡阈值。", type: "immortality" }
  ];
  for (const item of byStat) {
    if (run.stats[item.key] >= threshold) {
      return {
        unlocked: true,
        type: item.type,
        title: item.title,
        description: item.desc,
        unlockedAge: run.age
      };
    }
  }
  return run.ascension;
}

function maybeUnlockAscension(run: InternalRunState, rng: Rng): AscensionState {
  if (run.ascension.unlocked) return run.ascension;
  const deterministic = checkAscension(run);
  if (deterministic.unlocked) return deterministic;
  if (run.age < 25) return run.ascension;

  const ascensionTuning = run.tuningSnapshot.ascension;
  const stats = run.stats;
  const highThreshold = Math.min(ascensionTuning.fortuneThresholdA, ascensionTuning.intelligenceThresholdB);
  const highStats = [stats.intelligence, stats.charisma, stats.family, stats.fortune].filter((v) => v >= highThreshold).length;
  const legendaryCount = run.cards.filter((c) => c.rarity === "legendary").length;
  const ascensionRoll = rng();

  if (
    highStats >= ascensionTuning.highStatsThresholdA &&
    stats.fortune >= ascensionTuning.fortuneThresholdA &&
    ascensionRoll < ascensionTuning.chanceA
  ) {
    return {
      unlocked: true,
      type: "immortality",
      title: "长生不老",
      description: "你突破了寿限束缚，生命节律发生根本变化。",
      unlockedAge: run.age
    };
  }
  if (
    legendaryCount >= ascensionTuning.legendaryCountThresholdB &&
    stats.intelligence >= ascensionTuning.intelligenceThresholdB &&
    ascensionRoll < ascensionTuning.chanceB
  ) {
    return {
      unlocked: true,
      type: "rejuvenation",
      title: "返老还童",
      description: "你的生命状态被重塑，躯体回归巅峰阶段。",
      unlockedAge: run.age
    };
  }
  if (highStats >= ascensionTuning.highStatsThresholdC && ascensionRoll < ascensionTuning.chanceC) {
    return {
      unlocked: true,
      type: "eternal_youth",
      title: "青春永驻",
      description: "岁月不再在你身上留下明显痕迹。",
      unlockedAge: run.age
    };
  }

  return run.ascension;
}

function calcEnding(run: InternalRunState): string {
  if (run.outcome === "dead") {
    return `你在${run.age}岁因${run.deathCause ?? "意外"}离世。最终名望：${run.fame}。`;
  }
  if (run.outcome === "completed") {
    const quality = run.narrative.endingPolarity === "good"
      ? "好结局"
      : run.narrative.endingPolarity === "normal"
        ? "普通结局"
        : "坏结局";
    return `你在${run.age}岁走到这段人生的收束处。引擎已裁定为${quality}，最终名望：${run.fame}。`;
  }
  const endingTuning = run.tuningSnapshot.ending;
  const { intelligence, charisma, family, fortune } = run.stats;
  const score = intelligence * 1.1 + charisma + family * 0.95 + fortune * 1.2;

  if (run.ascension.unlocked) {
    return `你触发了“${run.ascension.title}”，在人世规则之外延展了命运。`;
  }
  if (score >= endingTuning.greatScore) return "你的人生在多个领域达到了高峰，留下了跨时代的影响力。";
  if (score >= endingTuning.goodScore) return "你拥有稳固而体面的结局，在时代中留下了清晰的足迹。";
  if (score >= endingTuning.normalScore) return "你的人生起伏并存，虽未登顶，但也活出了自己的厚度。";
  return "你的人生历经坎坷，最终以平凡甚至艰难收场，但故事依然完整。";
}

function toTimelineEntry(event: YearEvent, stage: AgeThreshold): TimelineEntry {
  const titlePrefix = `${event.age}岁`;
  const normalizedTitle = event.title.startsWith(titlePrefix)
    ? event.title.slice(titlePrefix.length).replace(/^·/, "").trim()
    : event.title;
  return {
    age: event.age,
    ageStage: stage,
    title: normalizedTitle,
    narrative: event.summary,
    tags: event.tags,
    statChanges: event.statChanges
  };
}

export function createRun(ctx: EngineContext, req: StartRunRequest): InternalRunState {
  validateStats(req.stats);
  if (req.talentPointTotal < ctx.tuning.bootstrap.talentPointMin || req.talentPointTotal > ctx.tuning.bootstrap.talentPointMax) {
    throw new Error("天赋点超出当前配置允许范围");
  }
  if (
    req.selectedCardIds.length < ctx.tuning.bootstrap.selectedCardMin ||
    req.selectedCardIds.length > ctx.tuning.bootstrap.selectedCardMax
  ) {
    throw new Error("选卡数量超出当前配置允许范围");
  }
  const allocated =
    req.stats.intelligence + req.stats.charisma + req.stats.family + req.stats.fortune + req.stats.physique;
  if (allocated !== req.talentPointTotal) {
    throw new Error("属性分配总和必须等于本局可用天赋点");
  }

  const seed = Date.now() + Math.floor(Math.random() * 100000);
  const rng = seedrandom(String(seed));

  const selected = ctx.cards.filter((c) => req.selectedCardIds.includes(c.id));
  let stats = cloneStats(req.stats);
  for (const card of selected) {
    stats = applyChanges(stats, card.modifiers);
  }

  // Narrative worlds end only through the approved story closure. Keep the
  // legacy random end age for non-directed worlds without leaving a latent
  // calendar stop in the narrative runtime.
  const endAge = ctx.narrativeEnabled
    ? Number.MAX_SAFE_INTEGER
    : randomInt(rng, ctx.world.endAgeRange.min, ctx.world.endAgeRange.max);

  return {
    runId: `run_${seed}`,
    worldId: ctx.world.id,
    difficultyId: ctx.difficulty.id,
    age: 0,
    ageStage: resolveAgeStage(0, ctx.world),
    personaPrompt: req.personaPrompt,
    stats,
    cards: selected,
    items: [],
    history: [],
    timelineChunk: [],
    ended: false,
    ascension: { unlocked: false },
    fame: computeFameWithTuning(stats, ctx.tuning),
    outcome: "ongoing",
    negativeStreaks: {
      intelligence: 0,
      charisma: 0,
      family: 0,
      fortune: 0
    },
    yearsSinceLastMilestone: 0,
    tuningSnapshot: ctx.tuning,
    aiConversation: {},
    story: createStoryDirectorState(ctx.world.id),
    narrative: createNarrativeRunState(Boolean(ctx.narrativeEnabled)),
    narrativeWorldId: ctx.narrativeEnabled ? ctx.world.id : undefined,
    narrativeReservoir: {
      queued: [],
      revealedCount: 0,
      revealedAge: 0,
      revealedAgeStage: resolveAgeStage(0, ctx.world),
      phase: "generating",
      pendingRequestIds: []
    },
    turnRecords: [],
    seed,
    endAge
  };
}

function publicToken(run: InternalRunState, scope: string, value: string): string {
  const digest = createHash("sha256")
    .update(`${run.runId}:${scope}:${value}`)
    .digest("hex")
    .slice(0, 20);
  return `${scope}_${digest}`;
}

function publicOptionId(run: InternalRunState, choice: MilestoneChoice, decision: DecisionType): string {
  return publicToken(run, "option", `${choice.age}:${run.history.length}:${decision}`);
}

export function toPublicMilestoneChoice(
  run: InternalRunState,
  choice: MilestoneChoice | undefined = run.nextMilestoneChoice
): PublicMilestoneChoice | undefined {
  if (!choice) return undefined;
  const sceneState = run.narrative.activeScene;
  return {
    sceneId: publicToken(run, "scene", sceneState?.id ?? `${choice.age}:${run.history.length}`),
    revision: run.history.length,
    age: choice.age,
    background: choice.background,
    options: choice.options.map((option) => ({
      id: publicOptionId(run, choice, option.id),
      label: option.label,
      description: option.description
    }))
  };
}

export function resolvePublicDecisionOption(
  run: InternalRunState,
  optionId: string | undefined
): DecisionType | undefined {
  const choice = run.nextMilestoneChoice;
  if (!choice || !optionId?.trim()) return undefined;
  return choice.options.find((option) => publicOptionId(run, choice, option.id) === optionId)?.id;
}

export function toPublicTimelineEntry(run: InternalRunState, entry: TimelineEntry): PublicTimelineEntry {
  return {
    entryId: publicToken(run, "entry", `${entry.age}:${entry.narrative}:${entry.title}`),
    ageFrom: entry.ageFrom,
    age: entry.age,
    ageStage: { label: entry.ageStage.label },
    kind: entry.tags.includes("milestone")
      ? "choice_outcome"
      : entry.tags.includes("director")
        ? "scene"
        : "passage",
    narrative: entry.narrative,
    statChanges: entry.statChanges
  };
}

function publicStatsSnapshot(run: InternalRunState): Stats {
  return cloneStats(run.stats);
}

function publicItemsSnapshot(run: InternalRunState): TurnRecord["itemsSnapshot"] {
  return run.items.map((item) => ({
    id: item.id,
    name: item.name,
    rarity: item.rarity,
    description: item.description,
    obtainedAge: item.obtainedAge
  }));
}

function publicNarrativeCharactersSnapshot(run: InternalRunState): NonNullable<TurnRecord["narrativeCharactersSnapshot"]> {
  return run.narrative.dynamicCharacters
    .filter((character) => character.importance !== "momentary" && character.status === "active")
    .slice(-8)
    .map((character) => ({
      id: character.id,
      name: character.name,
      role: character.role,
      description: character.description,
      introducedAge: character.introducedAge
    }));
}

export function appendTurnRecords(
  run: InternalRunState,
  entries: TimelineEntry[],
  choice?: PublicMilestoneChoice,
  choiceOutcome?: TurnRecord["choiceOutcome"]
): TurnRecord[] {
  run.turnRecords ??= [];
  const createdAt = Date.now();
  const records = entries.map((entry, index) => {
    const publicEntry = toPublicTimelineEntry(run, entry);
    return {
      turnId: publicToken(run, "turn", `${run.turnRecords.length + index + 1}:${publicEntry.entryId}`),
      sequence: run.turnRecords.length + index + 1,
      kind: publicEntry.kind,
      ageFrom: publicEntry.ageFrom,
      age: publicEntry.age,
      ageStage: publicEntry.ageStage,
      narrative: publicEntry.narrative,
      statChanges: publicEntry.statChanges,
      statsSnapshot: publicStatsSnapshot(run),
      itemsSnapshot: publicItemsSnapshot(run),
      narrativeCharactersSnapshot: publicNarrativeCharactersSnapshot(run),
      fameSnapshot: run.fame,
      choice: index === entries.length - 1 ? choice : undefined,
      choiceOutcome: index === entries.length - 1 ? choiceOutcome : undefined,
      createdAt
    } satisfies TurnRecord;
  });
  run.turnRecords.push(...records);
  return records;
}

export function appendPublicTurnRecord(
  run: InternalRunState,
  publicEntry: PublicTimelineEntry,
  choice?: PublicMilestoneChoice,
  choiceOutcome?: TurnRecord["choiceOutcome"]
): TurnRecord {
  run.turnRecords ??= [];
  const record: TurnRecord = {
    turnId: publicToken(run, "turn", `${run.turnRecords.length + 1}:${publicEntry.entryId}`),
    sequence: run.turnRecords.length + 1,
    kind: publicEntry.kind,
    ageFrom: publicEntry.ageFrom,
    age: publicEntry.age,
    ageStage: publicEntry.ageStage,
    narrative: publicEntry.narrative,
    statChanges: publicEntry.statChanges,
    statsSnapshot: publicStatsSnapshot(run),
    itemsSnapshot: publicItemsSnapshot(run),
    narrativeCharactersSnapshot: publicNarrativeCharactersSnapshot(run),
    fameSnapshot: run.fame,
    choice,
    choiceOutcome,
    createdAt: Date.now()
  };
  run.turnRecords.push(record);
  return record;
}

export function resolveTurnRecordChoice(
  run: InternalRunState,
  choice: PublicMilestoneChoice | undefined,
  resolvedOption: { id: string; label: string; description: string } | undefined
): void {
  if (!choice || !resolvedOption) return;
  const record = [...(run.turnRecords ?? [])]
    .reverse()
    .find((item) => item.choice?.sceneId === choice.sceneId && !item.choiceOutcome);
  if (!record) return;
  record.choiceOutcome = {
    optionId: resolvedOption.id,
    label: resolvedOption.label,
    description: resolvedOption.description
  };
}

export function ensureVisibleTurnRecords(run: InternalRunState, world: WorldConfig): TurnRecord[] {
  ensureStoryDirectorState(run);
  run.turnRecords ??= [];
  const pendingChoice = toPublicMilestoneChoice(run);
  if (run.turnRecords.length > 0) {
    // Older runs can contain the visible event without the pending choice. Repair the
    // public projection only when the choice's own event has already been revealed.
    if (pendingChoice && !run.turnRecords.some((record) => (
      record.choice?.sceneId === pendingChoice.sceneId && !record.choiceOutcome
    ))) {
      const choiceRecord = [...run.turnRecords]
        .reverse()
        .find((record) => record.age === pendingChoice.age && !record.choiceOutcome);
      if (choiceRecord) choiceRecord.choice = pendingChoice;
    }
    return run.turnRecords;
  }
  const shown = Math.max(0, Math.min(run.narrativeReservoir.revealedCount, run.history.length));
  const entries = toPresentationTimelineEntries(world, run.history.slice(0, shown));
  const lastEntry = entries.at(-1);
  const records = appendTurnRecords(
    run,
    entries,
    pendingChoice?.age === lastEntry?.age ? pendingChoice : undefined
  );
  return records;
}

export function appendDecisionTurnRecord(
  run: InternalRunState,
  event: YearEvent,
  world: WorldConfig,
  choice: PublicMilestoneChoice | undefined,
  resolvedOption: { id: string; label: string; description: string } | undefined
): TurnRecord {
  run.turnRecords ??= [];
  const publicEntry = toPublicTimelineEntryFromEvent(run, event, world);
  const record: TurnRecord = {
    turnId: publicToken(run, "turn", `${run.turnRecords.length + 1}:${publicEntry.entryId}`),
    sequence: run.turnRecords.length + 1,
    kind: "choice_outcome",
    ageFrom: publicEntry.ageFrom,
    age: publicEntry.age,
    ageStage: publicEntry.ageStage,
    narrative: publicEntry.narrative,
    statChanges: publicEntry.statChanges,
    statsSnapshot: publicStatsSnapshot(run),
    itemsSnapshot: publicItemsSnapshot(run),
    narrativeCharactersSnapshot: publicNarrativeCharactersSnapshot(run),
    fameSnapshot: run.fame,
    choice,
    choiceOutcome: resolvedOption ? {
      optionId: resolvedOption.id,
      label: resolvedOption.label,
      description: resolvedOption.description
    } : undefined,
    createdAt: Date.now()
  };
  run.turnRecords.push(record);
  return record;
}

export function toPublicTimelineEntryFromEvent(
  run: InternalRunState,
  event: YearEvent,
  world: WorldConfig
): PublicTimelineEntry {
  return toPublicTimelineEntry(run, toTimelineEntry(event, resolveAgeStage(event.age, world)));
}

function mergeTimelineStatChanges(events: YearEvent[]): Partial<Record<StatKey, number>> {
  return events.reduce<Partial<Record<StatKey, number>>>((total, event) => {
    for (const key of allStatKeys) {
      const delta = event.statChanges[key] ?? 0;
      if (delta !== 0) total[key] = (total[key] ?? 0) + delta;
    }
    return total;
  }, {});
}

export function toPresentationTimelineEntries(world: WorldConfig, events: YearEvent[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  let hidden: YearEvent[] = [];
  for (const event of events) {
    if (!event.summary.trim()) {
      hidden.push(event);
      continue;
    }
    const grouped = [...hidden, event];
    hidden = [];
    const entry = toTimelineEntry(event, resolveAgeStage(event.age, world));
    entries.push(grouped.length > 1
      ? {
          ...entry,
          ageFrom: grouped[0]?.age,
          statChanges: mergeTimelineStatChanges(grouped),
          sourceEventCount: grouped.length
        }
      : entry);
  }
  for (const event of hidden) {
    entries.push(toTimelineEntry(event, resolveAgeStage(event.age, world)));
  }
  return entries.filter((entry) => entry.narrative.trim().length > 0);
}

function resolveDirectorTurnKind(run: InternalRunState, world: WorldConfig): "normal" | "milestone" {
  const nextAge = run.age + 1;
  const tuning = run.tuningSnapshot ?? createDefaultGameplayTuning();
  if (nextAge < tuning.milestone.minEligibleAge) return "normal";
  const anchored = world.milestoneAges?.includes(nextAge) ?? false;
  const guaranteed = run.yearsSinceLastMilestone >= tuning.milestone.guaranteeYears;
  const rng = seedrandom(`${run.seed}:director-kind:${nextAge}:${run.history.length}`);
  return anchored || guaranteed || rng() < milestoneTriggerRate(resolveAgeStage(nextAge, world).id, tuning)
    ? "milestone"
    : "normal";
}

function shouldHoldSceneAge(run: InternalRunState): boolean {
  const clock = run.narrative.sceneClock;
  return Boolean(
    run.narrative.enabled &&
    run.narrative.activeScene &&
    clock.mode === "hold" &&
    clock.sameAgeTurnCount < clock.maxSameAgeTurns
  );
}

function eventStatsForProfile(profileId: string): [StatKey, StatKey] {
  const profiles: Record<string, [StatKey, StatKey]> = {
    guardian: ["charisma", "physique"],
    ambition: ["intelligence", "family"],
    broker: ["family", "fortune"],
    mentor: ["intelligence", "charisma"],
    institution: ["intelligence", "family"],
    outsider: ["fortune", "physique"]
  };
  return profiles[profileId] ?? ["fortune", "charisma"];
}

function eventStatsForDefinition(definition: EventDefinition): [StatKey, StatKey] {
  if (definition.primaryStat && definition.secondaryStat) {
    return [definition.primaryStat, definition.secondaryStat];
  }
  return eventStatsForProfile(definition.outcomeProfileId);
}

export function getDirectedEventAttributePolicy(definition: EventDefinition): NarrativeAttributePolicy {
  const [primary, secondary] = eventStatsForDefinition(definition);
  return {
    allowedStats: [primary, secondary],
    allowedBands: ["light", "medium"],
    allowedDirections: ["up"],
    minEffects: 1,
    maxEffects: 1
  };
}

function candidateWeight(run: InternalRunState, definition: EventDefinition): number {
  let weight = definition.baseWeight;
  for (const effect of collectPassiveEffects(run)) {
    if (effect.type !== "candidate_weight" || !effectMatchesTags(effect, definition.tags)) continue;
    weight += Math.max(0, effect.amount ?? 0);
  }
  for (const effect of collectPassiveEffects(run)) {
    if (effect.type !== "unlock_event") continue;
    const targets = effect.eventIds ?? [];
    if (targets.includes(definition.id) || (definition.factionId && targets.includes(definition.factionId))) {
      weight += 4;
    }
  }
  if (definition.factionId) {
    weight += Math.max(-3, Math.min(3, run.story.factionTension[definition.factionId] ?? 0));
  }
  if (run.story.activeFocusTag && definition.focusTags?.includes(run.story.activeFocusTag)) {
    weight += 2;
  }
  // maxAge is a source-material preference. Do not turn an older protagonist
  // into an empty event pool merely because a concrete incident was written
  // for an earlier life stage.
  if (definition.maxAge !== undefined && run.age + 1 > definition.maxAge) {
    weight -= Math.min(6, Math.ceil((run.age + 1 - definition.maxAge) / 8));
  }
  return weight;
}

function pickItemReward(
  run: InternalRunState,
  definition: EventDefinition,
  items: ItemDefinition[],
  rng: Rng
): ItemInstance | undefined {
  if (run.items.length >= 3) return undefined;
  const bonus = collectPassiveEffects(run)
    .filter((effect) => effect.type === "reward_bonus")
    .reduce((sum, effect) => sum + Math.max(0, effect.amount ?? 0), 0);
  if (rng() >= Math.min(0.42, 0.14 + bonus)) return undefined;
  const available = items.filter((item) =>
    !run.items.some((owned) => owned.id === item.id) &&
    item.tags.some((tag) => definition.tags.includes(tag))
  );
  const selected = available.length > 0 ? pickOne(rng, available) : undefined;
  if (!selected) return undefined;
  return {
    id: selected.id,
    name: selected.name,
    rarity: selected.rarity,
    description: selected.description,
    obtainedAge: run.age + 1,
    effects: selected.effects
  };
}

function buildDirectedDecisionEffects(definition: EventDefinition): Record<DecisionType, DirectedDecisionEffect> {
  const [primary, secondary] = eventStatsForDefinition(definition);
  return {
    safe: {
      success: { [secondary]: 1 },
      failure: { [secondary]: -1 },
      deathRisk: 0
    },
    balanced: {
      success: { [primary]: 2, [secondary]: 1 },
      failure: { [primary]: -1, [secondary]: -1 },
      deathRisk: 0.04
    },
    risky: {
      success: { [primary]: 3, [secondary]: 1 },
      failure: { [primary]: -2, [secondary]: -1 },
      deathRisk: 0.11
    }
  };
}

function buildDirectedDecisionPolicy(definition: EventDefinition): Record<DecisionType, PendingDirectedDecisionPolicy> {
  const [primary, secondary] = eventStatsForDefinition(definition);
  return {
    // Safe choices are reliable but deliberately capped below the breakthrough band.
    safe: {
      allowedStats: [primary, secondary],
      allowedBands: ["light"],
      allowedDirections: ["up"],
      minEffects: 1,
      maxEffects: 1
    },
    // Balanced choices may have a light cost, but must still produce a visible gain.
    balanced: {
      allowedStats: [primary, secondary],
      allowedBands: ["light", "medium"],
      allowedDirections: ["up", "down"],
      minEffects: 1,
      maxEffects: 2,
      requirePositive: true
    },
    // Risky choices let the narrator resolve either a breakthrough or a real setback.
    risky: {
      allowedStats: [primary, secondary],
      allowedBands: ["light", "medium", "heavy"],
      allowedDirections: ["up", "down"],
      minEffects: 1,
      maxEffects: 2
    }
  };
}

export function createDirectedMilestoneChoice(
  age: number,
  definition: EventDefinition,
  tuning: GameplayTuning
): MilestoneChoice {
  const base = generateMilestoneChoice(age, definition.promptHook || definition.title, tuning);
  const labels: Record<string, Array<{ label: string; description: string }>> = {
    guardian: [
      { label: "守住底线", description: "优先保护眼前的人与秩序。" },
      { label: "协调各方", description: "承担代价，争取更稳的解法。" },
      { label: "挺身而出", description: "以自身名誉赌一次转机。" }
    ],
    ambition: [
      { label: "留住筹码", description: "先稳住既有位置与资源。" },
      { label: "交换条件", description: "以部分让步换取上升空间。" },
      { label: "强行破局", description: "押上声誉与关系争夺主导。" }
    ],
    mentor: [
      { label: "静待积累", description: "把眼前机会换成长线基础。" },
      { label: "共同投入", description: "承担成本，换取可信同盟。" },
      { label: "押注传承", description: "以短期损失赌未来格局。" }
    ]
  };
  const preset = labels[definition.outcomeProfileId];
  if (preset) {
    base.options = base.options.map((option, index) => ({
      ...option,
      label: preset[index]?.label ?? option.label,
      description: preset[index]?.description ?? option.description
    }));
  }
  return base;
}

export function applyDirectedMilestonePresentation(
  run: InternalRunState,
  presentation: DirectedMilestonePresentation | undefined
): void {
  const choice = run.nextMilestoneChoice;
  if (!choice || !presentation) return;
  const background = presentation.background.trim();
  if (background) choice.background = background;
  const overrides = new Map(presentation.optionOverrides.map((option) => [option.id, option]));
  choice.options = choice.options.map((option) => {
    const override = overrides.get(option.id);
    if (!override) return option;
    return {
      ...option,
      label: override.label.trim() || option.label,
      description: override.description.trim() || option.description
    };
  });
}

function fallbackEventDefinition(
  world: WorldConfig,
  age: number,
  storyDirections: StoryDirectionDefinition[]
): EventDefinition {
  const title = world.yearlyEventHints[age % world.yearlyEventHints.length] ?? "寻常际遇";
  return {
    id: `${world.id}_ordinary_${age}`,
    worldId: world.id,
    title,
    kind: "normal",
    tags: ["ordinary", "fortune"],
    minAge: 0,
    cooldownYears: 0,
    baseWeight: 1,
    outcomeProfileId: "ordinary",
    storyDirectionIds: storyDirections.map((direction) => direction.id),
    focusTags: Array.from(new Set(storyDirections.flatMap((direction) => direction.focusTags))).slice(0, 8),
    promptHook: `围绕${title}展开一段与角色处境相符的人生片段。`
  };
}

function narrativeClosureEventDefinition(run: InternalRunState, world: WorldConfig): EventDefinition {
  return {
    id: `${world.id}_narrative_closure_${run.age + 1}`,
    worldId: world.id,
    title: "余波收束",
    kind: "normal",
    tags: ["narrative_closure"],
    minAge: run.age + 1,
    cooldownYears: 0,
    baseWeight: 100,
    outcomeProfileId: "ordinary",
    storyRole: "closure",
    storyPosition: "resolution",
    storyDirectionIds: run.story.activeDirectionId ? [run.story.activeDirectionId] : [],
    narrativeBeat: "ending",
    promptHook: "此前的冲突已经有了代价与回响，人物必须亲自面对最后的结果。"
  };
}

function storyPositionForNarrativeBeat(beat: NonNullable<EventDefinition["narrativeBeat"]>): EventDefinition["storyPosition"] {
  if (beat === "setup") return "origin";
  if (beat === "escalation") return "accumulation";
  if (beat === "pressure") return "pressure";
  if (beat === "climax") return "turn";
  if (beat === "payoff" || beat === "ending") return "resolution";
  return undefined;
}

/**
 * Build a legal scene from a world-owned archetype only when the concrete
 * event material for the required beat is exhausted. The generated definition
 * still uses the same thread, fact ledger and stage gates as normal material.
 */
function buildNarrativeArchetypeCandidates(
  run: InternalRunState,
  world: WorldConfig,
  narrativeWorld: NarrativeWorldDefinition,
  nextAge: number,
  beat: NonNullable<EventDefinition["narrativeBeat"]>
): EventDefinition[] {
  const archetypes = (narrativeWorld.sceneArchetypes ?? []).filter((archetype) => archetype.beats.includes(beat));
  if (archetypes.length === 0) return [];

  const activeScene = run.narrative.activeScene;
  const experiences = activeScene
    ? (() => {
        const thread = narrativeWorld.threads.find((item) => item.id === activeScene.threadId);
        const directionId = thread?.directionIds[0] ?? run.story.foregroundExperienceId ?? run.story.activeDirectionId;
        return directionId ? [{ directionId, threadId: activeScene.threadId }] : [];
      })()
    : narrativeWorld.routeArcs
      .map((route) => ({ directionId: route.directionId, threadId: route.coreThreadIds[0] }))
      .filter((experience): experience is { directionId: string; threadId: string } => Boolean(experience.threadId))
      .filter((experience) => {
        const thread = run.narrative.threads.find((item) => item.id === experience.threadId);
        return (!thread || thread.status === "resolved") && isNarrativeStageReady(
          narrativePromptSourceForRun(run),
          narrativeWorld,
          "opening",
          experience.directionId
        );
      });
  const mainlineFacts = narrativeWorld.mainlineFacts ?? [];
  const introducedFactCount = beat === "setup" || beat === "escalation"
    ? 1
    : beat === "pressure"
      ? 2
      : beat === "climax"
        ? 3
        : 0;

  return experiences.flatMap(({ directionId, threadId }) => archetypes.map((archetype) => {
    const thread = narrativeWorld.threads.find((item) => item.id === threadId);
    const introducedMainlineFacts = mainlineFacts.slice(0, introducedFactCount).map((fact) => ({
      id: fact.id,
      kind: fact.kind,
      label: fact.label,
      priority: fact.priority ?? 3
    }));
    const opensThread = beat === "setup";
    const resolvesThread = beat === "payoff";
    const threadFact: StoryFactDefinition | undefined = opensThread
      ? {
          id: `thread:${threadId}`,
          kind: "open_question",
          label: thread?.label ?? "一条需要继续面对的旧事",
          priority: 2,
          threadId,
          routeIds: [directionId]
        }
      : undefined;
    return {
      id: `${world.id}_archetype_${archetype.id}_${directionId.replace(/[^a-z0-9]+/gi, "_")}_${nextAge}`,
      worldId: world.id,
      factionId: directionId.split(".")[1],
      title: archetype.label,
      kind: beat === "setup" || beat === "pressure" || beat === "climax" ? "milestone" : "normal",
      tags: Array.from(new Set(["narrative_archetype", ...(archetype.focusTags ?? [])])),
      minAge: 0,
      cooldownYears: 0,
      baseWeight: archetype.baseWeight ?? 10,
      outcomeProfileId: archetype.outcomeProfileId ?? directionId.split(".")[1] ?? "ordinary",
      storyPosition: storyPositionForNarrativeBeat(beat),
      storyDirectionIds: [directionId],
      narrativeThreadIds: [threadId],
      opensThreads: opensThread ? [threadId] : undefined,
      resolvesThreads: resolvesThread ? [threadId] : undefined,
      narrativeBeat: beat,
      sceneArchetypeId: archetype.id,
      factEffect: {
        introduce: [...(threadFact ? [threadFact] : []), ...introducedMainlineFacts],
        modifyFactIds: [
          ...(beat !== "setup" && beat !== "payoff" ? [`thread:${threadId}`] : []),
          ...(beat === "payoff" ? mainlineFacts.map((fact) => fact.id) : [])
        ],
        resolveFactIds: resolvesThread ? [`thread:${threadId}`] : undefined
      },
      reclaimableFactIds: resolvesThread ? [`thread:${threadId}`] : undefined,
      promptHook: `${archetype.description} ${thread?.premise ?? ""}`.trim()
    };
  }));
}

function narrativeRouteIdsForDefinition(
  definition: EventDefinition,
  narrativeWorld?: NarrativeWorldDefinition | null
): string[] {
  const configuredRoutes = new Set((narrativeWorld?.routeArcs ?? []).map((route) => route.directionId));
  return Array.from(new Set(definition.storyDirectionIds ?? [])).filter((routeId) => (
    configuredRoutes.size === 0 || configuredRoutes.has(routeId)
  ));
}

function desiredNarrativeBeatsForRoute(
  run: InternalRunState,
  routeId: string,
  narrativeWorld?: NarrativeWorldDefinition | null,
  legacyThreadIds: readonly string[] = []
): Array<NonNullable<EventDefinition["narrativeBeat"]>> {
  const localProgress = getNarrativeRouteProgress(run.narrative, routeId);
  // Existing saves from the single-scene implementation have no routeProgress
  // yet. Read that scene only when its actual thread matches this route's
  // source material; never use it to block another route.
  const phase = localProgress?.phase ?? (
    run.narrative.activeScene && legacyThreadIds.includes(run.narrative.activeScene.threadId)
      ? run.narrative.activeScene.phase
      : undefined
  );
  if (!phase) return ["setup"];
  if (phase === "setup") return ["escalation"];
  if (phase === "escalation") {
    return isNarrativeWorldStageReady(narrativePromptSourceForRun(run), narrativeWorld, "pressure")
      ? ["pressure"]
      : ["escalation"];
  }
  if (phase === "pressure") {
    return isNarrativeWorldStageReady(narrativePromptSourceForRun(run), narrativeWorld, "climax")
      ? ["climax"]
      : ["pressure"];
  }
  return ["payoff"];
}

function isNarrativeRouteEventEligible(
  run: InternalRunState,
  definition: EventDefinition,
  routeId: string,
  narrativeWorld?: NarrativeWorldDefinition | null
): boolean {
  const beat = definition.narrativeBeat;
  if (!beat || beat === "ending") return false;
  if (!narrativeRouteIdsForDefinition(definition, narrativeWorld).includes(routeId)) return false;
  if (run.story.closureState === "guiding") return beat === "payoff";
  if (beat === "setup" && !isNarrativeMainlineActEntryReady(
    narrativePromptSourceForRun(run),
    narrativeWorld
  )) return false;
  return desiredNarrativeBeatsForRoute(
    run,
    routeId,
    narrativeWorld,
    definition.narrativeThreadIds ?? []
  ).includes(beat);
}

function isDirectedStoryPositionEligible(
  run: InternalRunState,
  definition: EventDefinition,
  narrativeWorld?: NarrativeWorldDefinition | null
): boolean {
  if (run.narrative.enabled && definition.narrativeBeat) {
    const beat = definition.narrativeBeat;
    if (run.story.closureState === "guiding") {
      return beat === "ending" || narrativeRouteIdsForDefinition(definition, narrativeWorld)
        .some((routeId) => desiredNarrativeBeatsForRoute(run, routeId, narrativeWorld).includes("payoff"));
    }
    return narrativeRouteIdsForDefinition(definition, narrativeWorld)
      .some((routeId) => isNarrativeRouteEventEligible(run, definition, routeId, narrativeWorld));
  }
  const position = definition.storyPosition;
  if (!position) return true;
  const completeness = run.story.completeness;
  if (completeness.origin < 1) return position === "origin";
  if (completeness.accumulation < 2) return position === "accumulation";
  if (completeness.pressure < 2) return position === "pressure";
  if (completeness.turn < 1) return position === "turn";
  if (!run.story.closureEligible) {
    // A payoff may use a resolution-position event. It must remain available
    // long enough to satisfy the narrative closure gate.
    return position !== "resolution" || definition.narrativeBeat === "payoff";
  }
  return true;
}

function hasDirectedEventPrerequisites(run: InternalRunState, definition: EventDefinition): boolean {
  const flags = new Set(run.story.flags);
  const blockedFlags = new Set(run.story.blockedFlags);
  if (!(definition.requiresFlags ?? []).every((flag) => flags.has(flag) && !blockedFlags.has(flag))) return false;
  const routeFact = (factId: string) => run.narrative.enabled && Boolean(definition.narrativeBeat) && factId.startsWith("thread:");
  if (!(definition.requiresFactIds ?? []).filter((factId) => !routeFact(factId)).every((factId) => hasOpenFact(run.story, factId))) return false;
  if ((definition.reclaimableFactIds ?? []).filter((factId) => !routeFact(factId)).some((factId) => !hasOpenFact(run.story, factId))) return false;
  if ((definition.modifiesFactIds ?? []).filter((factId) => !routeFact(factId)).some((factId) => !hasEstablishedFact(run.story, factId))) return false;
  if (run.narrative.enabled && definition.narrativeBeat) return true;
  if (!definition.followUpIds?.length) return true;
  return definition.followUpIds.some((eventId) => run.story.seenEventIds.includes(eventId));
}

function focusTagForCandidate(candidate: DirectedEventCandidate): string {
  return candidate.definition.focusTags?.[0]?.trim() || candidate.definition.outcomeProfileId || "ordinary";
}

function materializeDirectedCandidates(
  run: InternalRunState,
  difficulty: DifficultyConfig,
  definitions: EventDefinition[],
  items: ItemDefinition[],
  defaultKind: "normal" | "milestone"
): DirectedEventCandidate[] {
  const nextAge = run.age + (shouldHoldSceneAge(run) ? 0 : 1);
  const ranked = definitions
    .map((definition) => ({
      definition,
      score: candidateWeight(run, definition),
      tie: seedrandom(`${run.seed}:candidate:${nextAge}:${definition.id}`)()
    }))
    .sort((a, b) => b.score - a.score || b.tie - a.tie || a.definition.id.localeCompare(b.definition.id))
    .slice(0, DIRECTOR_EVENT_POOL_SIZE);

  return ranked.map(({ definition, score }) => {
    const candidateKind: "normal" | "milestone" = definition.kind === "milestone" ? "milestone" : defaultKind;
    const rng = seedrandom(`${run.seed}:event-preview:${nextAge}:${definition.id}`);
    const [primary, secondary] = eventStatsForDefinition(definition);
    const rewardBonus = collectPassiveEffects(run)
      .filter((effect) => effect.type === "reward_bonus")
      .reduce((sum, effect) => sum + Math.max(0, effect.amount ?? 0), 0);
    const positive = rng() < clamp(0.56 + difficulty.growthBias + rewardBonus, 0.2, 0.82);
    const magnitude = candidateKind === "milestone" ? 2 : 1;
    const statChanges = definition.narrativeBeat === "ending" || candidateKind === "milestone" || run.narrative.enabled
      ? {}
      : positive
        ? { [primary]: magnitude, [secondary]: 1 }
        : { [primary]: -magnitude, [secondary]: -1 };
    return {
      definition,
      kind: candidateKind,
      score,
      preview: {
        statChanges,
        item: positive ? pickItemReward(run, definition, items, rng) : undefined,
        decisionEffects: candidateKind === "milestone" ? buildDirectedDecisionEffects(definition) : undefined
      }
    };
  });
}

export function buildDirectedEventCandidates(
  run: InternalRunState,
  world: WorldConfig,
  difficulty: DifficultyConfig,
  definitions: EventDefinition[],
  items: ItemDefinition[],
  storyDirections: StoryDirectionDefinition[] = [],
  narrativeWorld?: NarrativeWorldDefinition | null
): DirectedEventCandidate[] {
  ensureStoryDirectorState(run);
  // A completed mainline may only move through the approved closing path. Do
  // not let a stale ordinary candidate reopen the story before the model asks
  // for closure and the engine accepts it.
  if (run.narrative.enabled && run.story.mainlineCompleted && run.story.closureState === "open") {
    return [];
  }
  const nextAge = run.age + (shouldHoldSceneAge(run) ? 0 : 1);
  const narrativeEnabled = run.narrative.enabled;
  let kind = resolveDirectorTurnKind(run, world);
  let forcedOpeningScene = false;
  let forcedSceneMilestone = false;
  const activeSceneBeat = !narrativeEnabled && run.narrative.activeScene
    ? desiredNarrativeBeats(run, "continue", narrativeWorld)[0]
    : undefined;
  if (!narrativeEnabled && run.narrative.activeScene) {
    // The legacy path still uses one active scene. Narrative mode projects the
    // most recently selected route for presentation only; it is not a global
    // eligibility gate.
    const entersDecisionBeat = (
      (activeSceneBeat === "pressure" && run.narrative.activeScene?.phase === "escalation") ||
      (activeSceneBeat === "climax" && run.narrative.activeScene?.phase === "pressure")
    );
    kind = entersDecisionBeat ? "milestone" : "normal";
    forcedSceneMilestone = entersDecisionBeat;
  }
  if (!narrativeEnabled && !run.narrative.activeScene) {
    const canOpenScene = definitions.some((definition) => (
      definition.worldId === world.id &&
      definition.narrativeBeat === "setup" &&
      hasDirectedEventPrerequisites(run, definition) &&
      isDirectedStoryPositionEligible(run, definition, narrativeWorld)
    ));
    if (canOpenScene) {
      // The first trace of a world conflict is lived as an ordinary year. A
      // player decision begins only after the scene has developed pressure.
      kind = "normal";
      forcedOpeningScene = true;
    }
  }
  const eligible = definitions.filter((definition) => {
    if (definition.worldId !== world.id) return false;
    if (!narrativeEnabled && (
      definition.kind !== "any" &&
      definition.kind !== kind &&
      !(forcedOpeningScene && definition.narrativeBeat === "setup") &&
      !(forcedSceneMilestone && (definition.narrativeBeat === "pressure" || definition.narrativeBeat === "climax")) &&
      !(activeSceneBeat && definition.narrativeBeat === activeSceneBeat)
    )) return false;
    const availableAt = run.story.cooldowns[definition.id] ?? 0;
    if (availableAt > nextAge) return false;
    if (!hasDirectedEventPrerequisites(run, definition)) return false;
    return isDirectedStoryPositionEligible(run, definition, narrativeWorld);
  });
  const legalCandidates = eligible;
  const resolutionCandidates = legalCandidates.filter((definition) => definition.storyPosition === "resolution");
  // Eligibility authorizes a model request only. The terminal scene exists
  // exclusively after that request has been approved into the guiding state.
  const shouldBuildClosureScene = run.narrative.enabled && !run.narrative.activeScene &&
    run.story.closureState === "guiding";
  const source = shouldBuildClosureScene
    ? [narrativeClosureEventDefinition(run, world)]
    : run.story.closureState === "guiding" && resolutionCandidates.length > 0
      ? resolutionCandidates
      : legalCandidates.length > 0
        ? legalCandidates
        : run.narrative.enabled
          ? []
          : [fallbackEventDefinition(world, nextAge, storyDirections)];
  const candidateKind: "normal" | "milestone" = !shouldBuildClosureScene && legalCandidates.length > 0 ? kind : "normal";
  const routedSource: Array<{
    definition: EventDefinition;
    routeId?: string;
    kind: "normal" | "milestone";
  }> = [];
  for (const definition of source) {
    if (!narrativeEnabled || !definition.narrativeBeat || definition.narrativeBeat === "ending") {
      routedSource.push({ definition, kind: candidateKind });
      continue;
    }
    for (const routeId of narrativeRouteIdsForDefinition(definition, narrativeWorld)) {
      if (!isNarrativeRouteEventEligible(run, definition, routeId, narrativeWorld)) continue;
      const progress = getNarrativeRouteProgress(run.narrative, routeId);
      const entersDecisionBeat = (
        (definition.narrativeBeat === "pressure" && progress?.phase === "escalation") ||
        (definition.narrativeBeat === "climax" && progress?.phase === "pressure")
      );
      routedSource.push({
        definition,
        routeId,
        kind: entersDecisionBeat ? "milestone" : "normal"
      });
    }
  }
  const ranked = routedSource
    .map(({ definition, routeId, kind: routeKind }) => ({
      definition,
      routeId,
      kind: routeKind,
      score: candidateWeight(run, definition),
      tie: seedrandom(`${run.seed}:candidate:${nextAge}:${routeId ?? "legacy"}:${definition.id}`)()
    }))
    .sort((a, b) => b.score - a.score || b.tie - a.tie || a.definition.id.localeCompare(b.definition.id))
    // The model chooses a route after this pool is built. Truncating globally
    // here can silently erase a legal route before the model ever sees it.
    // Focus projections still apply their own small limits.

  return ranked.map(({ definition, routeId, kind: routeKind, score }) => {
    const rng = seedrandom(`${run.seed}:event-preview:${nextAge}:${definition.id}`);
    const [primary, secondary] = eventStatsForDefinition(definition);
    const rewardBonus = collectPassiveEffects(run)
      .filter((effect) => effect.type === "reward_bonus")
      .reduce((sum, effect) => sum + Math.max(0, effect.amount ?? 0), 0);
    const positive = rng() < clamp(0.56 + difficulty.growthBias + rewardBonus, 0.2, 0.82);
    const magnitude = routeKind === "milestone" ? 2 : 1;
    const statChanges = definition.narrativeBeat === "ending" || routeKind === "milestone" || narrativeEnabled
      ? {}
      : positive
      ? { [primary]: magnitude, [secondary]: 1 }
      : { [primary]: -magnitude, [secondary]: -1 };
    return {
      definition,
      routeId,
      kind: routeKind,
      score,
      preview: {
        statChanges,
        item: positive ? pickItemReward(run, definition, items, rng) : undefined,
        decisionEffects: routeKind === "milestone" ? buildDirectedDecisionEffects(definition) : undefined
      }
    };
  });
}

export function buildDirectedFocusOptions(candidates: DirectedEventCandidate[]): DirectedFocusOption[] {
  const grouped = new Map<string, DirectedFocusOption>();
  for (const candidate of candidates) {
    const id = focusTagForCandidate(candidate);
    const existing = grouped.get(id);
    const weight = Math.max(1, candidate.score);
    if (existing) {
      existing.candidateCount += 1;
      existing.weight += weight;
      continue;
    }
    grouped.set(id, {
      id,
      storyPosition: candidate.definition.storyPosition,
      candidateCount: 1,
      weight
    });
  }
  return Array.from(grouped.values())
    .sort((a, b) => b.weight - a.weight || b.candidateCount - a.candidateCount || a.id.localeCompare(b.id))
    .slice(0, DIRECTOR_FOCUS_OPTION_LIMIT);
}

export function selectDirectedCandidateForFocus(
  run: InternalRunState,
  candidates: DirectedEventCandidate[],
  focusTag: string
): DirectedEventCandidate | undefined {
  const focused = candidates.filter((candidate) => focusTagForCandidate(candidate) === focusTag);
  const pool = focused.length > 0 ? focused : candidates;
  if (pool.length === 0) return undefined;
  const totalWeight = pool.reduce((sum, candidate) => sum + Math.max(1, candidate.score), 0);
  const rng = seedrandom(`${run.seed}:focus-event:${run.age + 1}:${focusTag}:${run.history.length}`);
  let cursor = rng() * totalWeight;
  for (const candidate of pool) {
    cursor -= Math.max(1, candidate.score);
    if (cursor <= 0) return candidate;
  }
  return pool[pool.length - 1];
}

function candidateSupportsStoryDirection(
  candidate: DirectedEventCandidate,
  direction: StoryDirectionDefinition
): boolean {
  if (candidate.routeId) return candidate.routeId === direction.id;
  if (candidate.definition.storyDirectionIds?.includes(direction.id)) return true;
  const candidateTags = new Set([
    ...candidate.definition.tags,
    ...(candidate.definition.focusTags ?? [])
  ]);
  return direction.focusTags.some((tag) => candidateTags.has(tag));
}

export function buildDirectedStoryDirections(
  candidates: DirectedEventCandidate[],
  storyDirections: StoryDirectionDefinition[]
): DirectedStoryDirection[] {
  return storyDirections
    .map((direction) => {
      const supported = candidates.filter((candidate) => candidateSupportsStoryDirection(candidate, direction));
      return {
        id: direction.id,
        label: direction.label,
        summary: direction.summary,
        focusTags: direction.focusTags,
        storyPosition: supported[0]?.definition.storyPosition,
        candidateCount: supported.length,
        weight: supported.reduce((sum, candidate) => sum + Math.max(1, candidate.score), 0)
      };
    })
    .filter((direction) => direction.candidateCount > 0)
    .sort((a, b) => b.weight - a.weight || b.candidateCount - a.candidateCount || a.id.localeCompare(b.id));
}

export function selectDirectedCandidateForDirection(
  run: InternalRunState,
  candidates: DirectedEventCandidate[],
  direction: StoryDirectionDefinition,
  materialId?: string
): DirectedEventCandidate | undefined {
  const supported = candidates.filter((candidate) => candidateSupportsStoryDirection(candidate, direction));
  const exact = materialId
    ? supported.find((candidate) => candidate.definition.id === materialId)
    : undefined;
  if (exact) return exact;

  const pool = supported.length > 0 ? supported : candidates;
  if (pool.length === 0) return undefined;
  const totalWeight = pool.reduce((sum, candidate) => sum + Math.max(1, candidate.score), 0);
  const rng = seedrandom(`${run.seed}:direction-event:${run.age + 1}:${direction.id}:${run.history.length}`);
  let cursor = rng() * totalWeight;
  for (const candidate of pool) {
    cursor -= Math.max(1, candidate.score);
    if (cursor <= 0) return candidate;
  }
  return pool[pool.length - 1];
}

function desiredNarrativeBeats(
  run: InternalRunState,
  intent: NarrativeIntent,
  narrativeWorld?: NarrativeWorldDefinition | null
): Array<NonNullable<EventDefinition["narrativeBeat"]>> {
  const phase = run.narrative.activeScene?.phase;
  if (!phase) return ["setup"];
  // A scene has a fixed causal order. The model may choose how to render the
  // next legal beat, but may not jump ahead and abandon its current conflict.
  if (phase === "setup") return ["escalation"];
  if (phase === "escalation") {
    return isNarrativeWorldStageReady(narrativePromptSourceForRun(run), narrativeWorld, "pressure")
      ? ["pressure"]
      : ["escalation"];
  }
  if (phase === "pressure") {
    return isNarrativeWorldStageReady(narrativePromptSourceForRun(run), narrativeWorld, "climax")
      ? ["climax"]
      : ["pressure"];
  }
  return ["payoff"];
}

export function buildDirectedNarrativeIntents(
  run: InternalRunState,
  candidates: DirectedEventCandidate[],
  narrativeWorld?: NarrativeWorldDefinition | null
): NarrativeIntent[] {
  if (run.narrative.enabled) {
    // Intent remains part of the existing tool contract, but route-local
    // progress decides the permitted beat. Do not turn it into a second
    // global state machine that can contradict the selected route.
    return candidates.length > 0 ? ["continue", "pressure", "payoff"] : ["continue"];
  }
  if (run.narrative.activeScene) {
    return ["continue"];
  }
  const available = new Set(candidates.map((candidate) => candidate.definition.narrativeBeat));
  const intents: NarrativeIntent[] = [];
  for (const intent of ["continue", "pressure", "payoff"] as NarrativeIntent[]) {
    if (desiredNarrativeBeats(run, intent, narrativeWorld).some((beat) => available.has(beat))) intents.push(intent);
  }
  return intents.length > 0 ? intents : ["continue"];
}

export function candidateAdvancesNarrativeComponent(
  run: InternalRunState,
  candidate: DirectedEventCandidate,
  componentId: string
): boolean {
  const focusState = run.narrative.components.find((component) => component.id === componentId && component.status !== "resolved");
  return Boolean(focusState && candidate.definition.narrativeComponentTransitions?.some((transition) => (
    transition.componentId === componentId && canAdvanceNarrativeComponent(focusState, transition.status)
  )));
}

function componentHintForFocus(
  definition: NarrativeComponentDefinition,
  status: InternalRunState["narrative"]["components"][number]["status"]
): string {
  if (status === "introduced") return definition.introHint;
  if (status === "active") return definition.activeHint;
  if (status === "escalated") return definition.escalationHint;
  return definition.payoffHint;
}

/** Only expose components that the current legal event pool can actually advance. */
export function buildDirectedNarrativeComponentFocuses(
  run: InternalRunState,
  candidates: DirectedEventCandidate[],
  narrativeWorld?: NarrativeWorldDefinition | null
): DirectedNarrativeComponentFocus[] {
  const definitions = new Map((narrativeWorld?.components ?? []).map((component) => [component.id, component]));
  return run.narrative.components
    .filter((state) => state.status !== "resolved")
    .map((state) => {
      const definition = definitions.get(state.id);
      const related = candidates.filter((candidate) => (
        candidateAdvancesNarrativeComponent(run, candidate, state.id)
      ));
      return definition && related.length > 0
        ? {
            id: definition.id,
            label: definition.label,
            hint: componentHintForFocus(definition, state.status),
            candidateCount: related.length,
            weight: related.reduce((sum, candidate) => sum + Math.max(1, candidate.score), 0),
            status: state.status,
            priority: definition.priority,
            lastTouchedAge: state.lastTouchedAge
          }
        : undefined;
    })
    .filter((focus): focus is DirectedNarrativeComponentFocus & {
      status: InternalRunState["narrative"]["components"][number]["status"];
      priority: number;
      lastTouchedAge: number;
    } => Boolean(focus))
    .sort((a, b) => {
      const statusWeight: Record<typeof a.status, number> = {
        introduced: 1,
        active: 2,
        escalated: 3,
        payable: 4,
        resolved: 0
      };
      if (statusWeight[a.status] !== statusWeight[b.status]) return statusWeight[b.status] - statusWeight[a.status];
      if (a.priority !== b.priority) return b.priority - a.priority;
      if (a.weight !== b.weight) return b.weight - a.weight;
      return b.lastTouchedAge - a.lastTouchedAge;
    })
    .slice(0, 3)
    .map(({ status: _status, priority: _priority, lastTouchedAge: _lastTouchedAge, ...focus }) => focus);
}

/** Only expose scene categories that the engine can realize this turn. */
export function buildDirectedSceneArchetypeOptions(
  candidates: DirectedEventCandidate[],
  narrativeWorld?: NarrativeWorldDefinition | null
): DirectedSceneArchetypeOption[] {
  const definitions = new Map((narrativeWorld?.sceneArchetypes ?? []).map((item) => [item.id, item]));
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const id = candidate.definition.sceneArchetypeId;
    if (!id || !definitions.has(id)) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([id, candidateCount]) => {
      const definition = definitions.get(id)!;
      return { id, label: definition.label, description: definition.description, candidateCount };
    })
    .sort((a, b) => b.candidateCount - a.candidateCount || a.id.localeCompare(b.id))
    .slice(0, DIRECTOR_FOCUS_OPTION_LIMIT);
}

export function selectDirectedCandidateForIntent(
  run: InternalRunState,
  candidates: DirectedEventCandidate[],
  intent: NarrativeIntent,
  focusComponentId?: string,
  sceneArchetypeId?: string,
  narrativeWorld?: NarrativeWorldDefinition | null,
  routeId?: string
): DirectedEventCandidate | undefined {
  const routeCandidates = routeId
    ? candidates.filter((candidate) => candidate.routeId
      ? candidate.routeId === routeId
      : candidate.definition.storyDirectionIds?.includes(routeId))
    : candidates;
  const scoped = routeId && run.narrative.enabled
    ? routeCandidates.filter((candidate) => desiredNarrativeBeatsForRoute(
      run,
      routeId,
      narrativeWorld,
      candidate.definition.narrativeThreadIds ?? []
    ).includes(candidate.definition.narrativeBeat ?? "setup"))
    : routeCandidates.filter((candidate) => new Set(desiredNarrativeBeats(
      run,
      run.narrative.activeScene ? "continue" : intent,
      narrativeWorld
    )).has(candidate.definition.narrativeBeat ?? "setup"));
  // A missing beat must not silently jump to another causal beat or route.
  // The same candidate pool is also used to decide whether background years
  // should advance, so this exposes data/state inconsistencies before a model
  // request can produce an empty turn.
  const basePool = scoped;
  const archetypeScoped = sceneArchetypeId
    ? basePool.filter((candidate) => candidate.definition.sceneArchetypeId === sceneArchetypeId)
    : [];
  const archetypePool = archetypeScoped.length > 0 ? archetypeScoped : basePool;
  const focused = focusComponentId
    ? archetypePool.filter((candidate) => candidateAdvancesNarrativeComponent(run, candidate, focusComponentId))
    : [];
  const pool = focused.length > 0 ? focused : archetypePool;
  if (pool.length === 0) return undefined;
  const totalWeight = pool.reduce((sum, candidate) => sum + Math.max(1, candidate.score), 0);
  const rng = seedrandom(`${run.seed}:narrative-intent:${run.age + 1}:${intent}:${run.history.length}`);
  let cursor = rng() * totalWeight;
  for (const candidate of pool) {
    cursor -= Math.max(1, candidate.score);
    if (cursor <= 0) return candidate;
  }
  return pool[pool.length - 1];
}

export function buildDirectedDecisionDirections(
  run: InternalRunState,
  directions: DirectedStoryDirection[],
  definitions: StoryDirectionDefinition[]
): Record<DecisionType, StoryDirectionDefinition> | undefined {
  const byId = new Map(definitions.map((direction) => [direction.id, direction]));
  const ranked = directions
    .map((direction) => byId.get(direction.id))
    .filter((direction): direction is StoryDirectionDefinition => Boolean(direction));
  if (definitions.length === 0) return undefined;

  const active = run.story.activeDirectionId
    ? byId.get(run.story.activeDirectionId)
    : undefined;
  if (ranked.length === 0 && !active) return undefined;
  const ordered = active
    ? [active]
    : ranked.length > 0
      ? ranked
      : definitions;
  const pick = (index: number): StoryDirectionDefinition => ordered[index] ?? ordered[0]!;
  return {
    safe: pick(0),
    balanced: pick(1),
    risky: pick(2)
  };
}

function applyStoryDirection(
  run: InternalRunState,
  direction: StoryDirectionDefinition,
  committed: boolean
): void {
  const story = ensureStoryDirectorState(run);
  if (!committed) return;
  if (!story.contract.initialDirectionId) {
    story.contract.initialDirectionId = direction.id;
    story.contract.coreThreadIds = Array.from(new Set([
      ...story.contract.coreThreadIds,
      ...direction.openingThreadIds
    ]));
    story.openThreads = Array.from(new Set([...story.openThreads, ...direction.openingThreadIds])).slice(-8);
  }
  story.foregroundExperienceId = direction.id;
  story.activeDirectionId = direction.id;
  story.committedDirectionIds = [
    ...story.committedDirectionIds.filter((id) => id !== direction.id),
    direction.id
  ].slice(-12);
  story.lastDirectionCommitAge = run.age;
  story.openThreads = Array.from(new Set([...story.openThreads, ...direction.openingThreadIds])).slice(-8);
  story.closureEligible = run.narrative.enabled ? Boolean(story.mainlineCompleted) : isClosureEligible(story, run.narrative);
}

/**
 * Keep a route-selection history without treating any selected route as an
 * exclusive branch. The first selection only anchors legacy ending metadata;
 * subsequent selections remain equally available.
 */
function recordNarrativeRouteSelection(
  run: InternalRunState,
  routeId: string,
  narrativeWorld?: NarrativeWorldDefinition | null
): void {
  const story = ensureStoryDirectorState(run);
  const route = narrativeWorld?.routeArcs.find((item) => item.directionId === routeId);
  if (!story.contract.initialDirectionId) {
    story.contract.initialDirectionId = routeId;
    story.contract.coreThreadIds = Array.from(new Set([
      ...story.contract.coreThreadIds,
      ...(route?.coreThreadIds ?? [])
    ])).slice(-12);
  }
  story.foregroundExperienceId = routeId;
  story.activeDirectionId = routeId;
  story.committedDirectionIds = [
    ...story.committedDirectionIds.filter((id) => id !== routeId),
    routeId
  ].slice(-12);
  story.lastDirectionCommitAge = run.age;
}

function introduceMainlineActFacts(
  story: StoryDirectorState,
  act: NonNullable<NarrativeWorldDefinition["mainlineActs"]>[number],
  narrativeWorld: NarrativeWorldDefinition | null | undefined,
  age: number,
  sourceEventId: string
): void {
  const factById = new Map((narrativeWorld?.mainlineFacts ?? []).map((fact) => [fact.id, fact]));
  applyStoryFactEffect(story, {
    introduce: Array.from(new Set([...(act.factId ? [act.factId] : []), ...(act.introduceFactIds ?? [])]))
      .map((id) => factById.get(id))
      .filter((fact): fact is NonNullable<typeof fact> => Boolean(fact))
      .map((fact) => ({ id: fact.id, kind: fact.kind, label: fact.label, priority: fact.priority ?? 3 }))
  }, age, sourceEventId);
}

interface MainlineActCompletionRecord {
  sourceId: string;
  experienceId?: string;
  threadId: string;
  openedAge: number;
  decisionCount: number;
}

function recordMainlineActCompletion(
  run: InternalRunState,
  act: NonNullable<NarrativeWorldDefinition["mainlineActs"]>[number],
  record: MainlineActCompletionRecord
): boolean {
  if (run.narrative.completedScenes.some((scene) => scene.mainlineActId === act.id)) return false;
  run.narrative.completedScenes = [
    ...run.narrative.completedScenes,
    {
      id: `mainline:${act.id}:${record.sourceId}:${run.age}`,
      experienceId: record.experienceId,
      threadId: record.threadId,
      mainlineActId: act.id,
      openedAge: record.openedAge,
      resolvedAge: run.age,
      decisionCount: Math.max(1, record.decisionCount)
    }
  ].slice(-12);
  return true;
}

function recordMainlineActPayoff(
  run: InternalRunState,
  act: NonNullable<NarrativeWorldDefinition["mainlineActs"]>[number],
  mainlineActs: NonNullable<NarrativeWorldDefinition["mainlineActs"]>,
  definition: EventDefinition,
  experienceId: string | undefined,
  story: StoryDirectorState
): void {
  const activeScene = run.narrative.activeScene;
  recordMainlineActCompletion(run, act, {
    sourceId: definition.id,
    experienceId,
    threadId: activeScene?.threadId ?? definition.narrativeThreadIds?.[0] ?? experienceId ?? act.id,
    openedAge: activeScene?.openedAge ?? run.age,
    // The payoff event itself is an irreversible scene; its player choice is
    // recorded separately by the existing milestone path.
    decisionCount: activeScene?.decisionCount ?? 0
  });
  run.narrative.lastResolvedSceneAge = run.age;
  run.narrative.activeScene = undefined;
  run.narrative.sceneClock = { ...run.narrative.sceneClock, mode: "advance", sameAgeTurnCount: 0 };
  const actIndex = mainlineActs.findIndex((item) => item.id === act.id);
  const nextAct = actIndex >= 0 ? mainlineActs[actIndex + 1] : undefined;
  run.narrative.activeMainlineActId = nextAct?.id;
  if (nextAct && experienceId) {
    // A payoff advances the shared world act. Only the route that actually
    // reached it begins a fresh local pass; every other route keeps its
    // accumulated five-beat progress.
    run.narrative = resetNarrativeRouteProgress(run.narrative, experienceId);
  }
  if (!nextAct && experienceId) {
    story.closureExperienceId = experienceId;
  }
}

function refreshNarrativeClosureEligibility(
  run: InternalRunState,
  narrativeWorld?: NarrativeWorldDefinition | null
): void {
  const story = ensureStoryDirectorState(run);
  refreshNarrativeMainlineCompletion(narrativePromptSourceForRun(run), narrativeWorld);
  story.closureEligible = run.narrative.enabled ? Boolean(story.mainlineCompleted) : isClosureEligible(story, run.narrative);
  if (story.closureEligible && run.narrative.enabled && run.narrative.endingState === "open") {
    run.narrative.endingState = "eligible";
  }
}

function updateStoryAfterEvent(
  run: InternalRunState,
  candidate: DirectedEventCandidate,
  direction?: StoryDirectionDefinition,
  narrativeWorld?: NarrativeWorldDefinition | null,
  experienceIdOverride?: string,
  completeMainlineAct = false
): void {
  const { definition } = candidate;
  const story = ensureStoryDirectorState(run);
  const mainlineActs = narrativeWorld?.mainlineActs ?? [];
  const isEndingEvent = definition.narrativeBeat === "ending";
  let mainlineActId = isEndingEvent
    ? undefined
    : run.narrative.activeScene?.mainlineActId ?? run.narrative.activeMainlineActId;
  if (!isEndingEvent && !mainlineActId && mainlineActs.length > 0) {
    let actIndex = Math.min(run.narrative.completedScenes.length, mainlineActs.length - 1);
    // A migrated or damaged save may have completed a scene without its prerequisite fact.
    // Reopen the nearest compatible act instead of progressing into an unreachable one.
    while (actIndex > 0 && (mainlineActs[actIndex].requiredFactIds ?? []).some((id) => !hasEstablishedFact(story, id))) {
      actIndex -= 1;
    }
    mainlineActId = mainlineActs[actIndex]?.id;
  }
  const mainlineAct = mainlineActs.find((act) => act.id === mainlineActId);
  if (mainlineActId) run.narrative.activeMainlineActId = mainlineActId;
  story.seenEventIds = [...story.seenEventIds.filter((id) => id !== definition.id), definition.id].slice(-24);
  if (definition.cooldownYears > 0) {
    story.cooldowns[definition.id] = run.age + definition.cooldownYears;
  }
  if (definition.factionId) {
    story.factionTension[definition.factionId] = (story.factionTension[definition.factionId] ?? 0) + 1;
  }
  const resolvedThreads = new Set(definition.resolvesThreads ?? []);
  if (resolvedThreads.size > 0) {
    story.openThreads = story.openThreads.filter((thread) => !resolvedThreads.has(thread));
    story.resolvedThreadIds = Array.from(new Set([
      ...story.resolvedThreadIds,
      ...resolvedThreads
    ])).slice(-16);
  }
  const openedThreads = definition.opensThreads ?? [];
  if (openedThreads.length > 0) {
    story.openThreads = Array.from(new Set([...story.openThreads, ...openedThreads])).slice(-8);
  }
  const clearedFlags = new Set(definition.clearsFlags ?? []);
  story.flags = Array.from(
    new Set([
      ...story.flags.filter((flag) => !clearedFlags.has(flag)),
      `event:${definition.id}`,
      ...(definition.setsFlags ?? [])
    ])
  ).slice(-32);
  story.blockedFlags = Array.from(new Set([...story.blockedFlags, ...(definition.blocksFlags ?? [])])).slice(-32);

  if (definition.focusTags?.length) {
    story.activeFocusTag = definition.focusTags[0];
  }
  // A director route is model-selected world data. It may differ from the
  // event metadata used for balance, and must not be replaced by that metadata.
  const eventExperienceId = candidate.routeId ?? experienceIdOverride ?? definition.storyDirectionIds?.[0];
  if (eventExperienceId) recordNarrativeRouteSelection(run, eventExperienceId, narrativeWorld);
  if (direction) applyStoryDirection(run, direction, false);
  story.lastStoryPosition = definition.storyPosition;
  if (definition.storyPosition) {
    story.completeness[definition.storyPosition] = Math.min(
      3,
      story.completeness[definition.storyPosition] + 1
    );
  }
  run.narrative = applyNarrativeEvent(
    run.narrative,
    definition,
    run.age,
    narrativeWorld?.components,
    story.flags,
    { mainlineActId, experienceId: eventExperienceId, routeId: eventExperienceId }
  );
  applyStoryFactEffect(story, definition.factEffect, run.age, definition.id);
  applyStoryFactEffect(story, {
    modifyFactIds: definition.modifiesFactIds,
    resolveFactIds: definition.reclaimableFactIds
  }, run.age, definition.id);
  if (mainlineAct) {
    // A world act starts from the first model-selected scene, not from a
    // particular legacy setup event. This lets all routes remain open.
    introduceMainlineActFacts(story, mainlineAct, narrativeWorld, run.age, definition.id);
  }
  if (completeMainlineAct && definition.narrativeBeat === "payoff" && mainlineAct) {
    applyStoryFactEffect(story, {
      resolveFactIds: mainlineAct.resolveFactIds
    }, run.age, definition.id);
    recordMainlineActPayoff(run, mainlineAct, mainlineActs, definition, eventExperienceId, story);
  }
  refreshNarrativeClosureEligibility(run, narrativeWorld);
}

export type DirectedClosureOutcome = "ignored" | "guiding" | "finished";

export function canRequestDirectedClosure(
  run: InternalRunState,
  narrativeWorld?: NarrativeWorldDefinition | null
): boolean {
  const story = ensureStoryDirectorState(run);
  if (
    run.ended ||
    run.nextMilestoneChoice ||
    story.closureState !== "open" ||
    Boolean(run.narrative.activeScene)
  ) {
    return false;
  }

  if (!run.narrative.enabled) return story.closureEligible;
  if (run.narrative.endingBlueprintId) return true;
  return assessClosureReadiness({
    worldId: run.worldId,
    age: run.age,
    personaPrompt: run.personaPrompt,
    cards: run.cards,
    items: run.items,
    story,
    narrative: run.narrative,
    stats: run.stats,
  }, narrativeWorld ?? null).eligible;
}

/**
 * Move an already-complete narrative into the engine-approved ending path.
 * This is also the recovery point for a malformed closing tool response: it
 * locks the assessed blueprint, but it never advances an unrelated year.
 */
export function beginDirectedClosureGuidance(
  run: InternalRunState,
  narrativeWorld?: NarrativeWorldDefinition | null
): boolean {
  const story = ensureStoryDirectorState(run);
  if (run.ended || story.closureState === "finished" || run.narrative.activeScene) return false;
  if (story.closureState === "guiding") return true;
  if (story.closureState !== "open") return false;
  if (!canRequestDirectedClosure(run, narrativeWorld)) return false;

  if (run.narrative.enabled && !run.narrative.endingBlueprintId) {
    const assessment = assessEnding({
      worldId: run.worldId,
      age: run.age,
      personaPrompt: run.personaPrompt,
      cards: run.cards,
      items: run.items,
      story,
      narrative: run.narrative,
      stats: run.stats,
      fame: run.fame,
      history: run.history,
      tuning: run.tuningSnapshot,
      difficultyId: run.difficultyId
    }, narrativeWorld ?? null);
    if (!assessment.eligible) return false;
    run.narrative = lockNarrativeEnding(run.narrative, assessment);
    if (!run.narrative.endingBlueprintId) return false;
  }

  story.closureState = "guiding";
  run.narrative = setNarrativeEndingState(run.narrative, "guiding");
  return true;
}

function deferNarrativeCatastrophe(run: InternalRunState, cause: string): boolean {
  if (!run.narrative.enabled || run.story.closureState === "finished") return false;
  run.narrative = recordNarrativeSetback(run.narrative, cause);
  run.story.flags = Array.from(new Set([
    ...run.story.flags,
    "narrative:critical_setback"
  ])).slice(-32);
  return true;
}

export function applyDirectedClosureRequest(
  run: InternalRunState,
  action: "guide" | "finish",
  narrativeWorld?: NarrativeWorldDefinition | null
): DirectedClosureOutcome {
  const story = ensureStoryDirectorState(run);
  const isApprovedFinish = action === "finish" &&
    story.closureState === "guiding" &&
    (!run.narrative.enabled || run.narrative.endingState === "guiding");
  if (action === "guide") {
    return beginDirectedClosureGuidance(run, narrativeWorld) ? "guiding" : "ignored";
  }
  if (!isApprovedFinish) return "ignored";

  if (
    action !== "finish" ||
    story.closureState !== "guiding" ||
    (run.narrative.enabled ? run.narrative.payoffCount < 1 : story.completeness.resolution < 1)
  ) {
    story.closureState = "guiding";
    run.narrative = setNarrativeEndingState(run.narrative, "guiding");
    return "guiding";
  }

  story.closureState = "finished";
  run.narrative = setNarrativeEndingState(run.narrative, "finished");
  run.ended = true;
  if (run.narrative.enabled) {
    run.outcome = "completed";
    run.deathCause = undefined;
  } else if (run.ascension.unlocked) {
    run.outcome = "ascended";
  }
  run.endingSummary = calcEnding(run);
  return "finished";
}

export function advanceWithDirectedEvent(
  run: InternalRunState,
  world: WorldConfig,
  candidate: DirectedEventCandidate,
  narrative: string,
  storyDirection?: StoryDirectionDefinition,
  decisionDirections?: Record<DecisionType, StoryDirectionDefinition>,
  narrativeWorld?: NarrativeWorldDefinition | null,
  options?: {
    attributeOutcome?: ApprovedNarrativeAttributeOutcome;
    attributePolicy?: NarrativeAttributePolicy;
    experienceId?: string;
    sceneClockMode?: "advance" | "hold";
    /** Only an actual payoff event may complete the current world act. */
    completeMainlineAct?: boolean;
  }
): { updated: InternalRunState; fromAge: number; toAge: number; chunk: YearEvent[] } {
  if (run.ended || run.nextMilestoneChoice) {
    return { updated: run, fromAge: run.age, toAge: run.age, chunk: [] };
  }
  const fromAge = run.age;
  const heldAge = shouldHoldSceneAge(run);
  if (!heldAge) run.age += 1;
  const tuning = run.tuningSnapshot ?? createDefaultGameplayTuning();
  const stage = resolveAgeStage(run.age, world);
  const stageCap = resolveStageDeltaCap(stage.id, tuning);
  const modelChanges = options?.attributeOutcome
    ? approveNarrativeAttributeOutcome(
      run,
      world,
      options.attributeOutcome,
      "background",
      options.attributePolicy ?? (candidate.kind === "normal" ? getDirectedEventAttributePolicy(candidate.definition) : undefined)
    )
    : undefined;
  if (run.narrative.enabled && candidate.kind === "normal" && candidate.definition.narrativeBeat !== "ending" && !modelChanges) {
    throw new Error("scene_outcome_required");
  }
  const changes = modelChanges ?? reduceNegativeChanges(run, clampYearlyChangesByStage(candidate.preview.statChanges, stageCap));
  const tone = classifyEventTone(changes, stageCap, tuning);
  run.stats = applyChanges(run.stats, changes);
  run.ageStage = stage;
  updateNegativeStreaks(run);
  if (candidate.preview.item && !run.items.some((item) => item.id === candidate.preview.item?.id)) {
    run.items.push(candidate.preview.item);
  }
  const event: YearEvent = {
    age: run.age,
    title: `${run.age}岁·${candidate.definition.title}`,
    summary: narrative.trim() || `这一年，你在${candidate.definition.title}中经历了新的转折。`,
    statChanges: changes,
    tags: [
      "director",
      candidate.kind,
      `event_${candidate.definition.id}`,
      `tone_${tone}`,
      ...(storyDirection ? [`direction_${storyDirection.id}`] : []),
      ...candidate.definition.tags,
      ...(candidate.preview.item ? [`item_${candidate.preview.item.id}`] : [])
    ]
  };
  run.history.push(event);
  updateStoryAfterEvent(
    run,
    candidate,
    storyDirection,
    narrativeWorld,
    options?.experienceId,
    options?.completeMainlineAct
  );
  refreshRunFame(run);
  if (candidate.definition.narrativeBeat === "setup" && options?.sceneClockMode) {
    run.narrative.sceneClock = {
      ...run.narrative.sceneClock,
      mode: options.sceneClockMode,
      sameAgeTurnCount: 0
    };
  }
  if (heldAge && run.narrative.activeScene) {
    run.narrative.sceneClock = {
      ...run.narrative.sceneClock,
      sameAgeTurnCount: run.narrative.sceneClock.sameAgeTurnCount + 1
    };
  }

  if (!heldAge) {
    const rng = seedrandom(`${run.seed}:director-resolve:${run.age}:${candidate.definition.id}`);
    const deathCheck = calcDeathRisk(run, world, 0);
    if (reduceDeathRisk(run, deathCheck.risk) > 0 && rng() < reduceDeathRisk(run, deathCheck.risk)) {
      const cause = deathCheck.cause ?? "命运反噬";
      if (!deferNarrativeCatastrophe(run, cause)) {
        run.ended = true;
        run.outcome = "dead";
        run.deathCause = cause;
        run.endingSummary = calcEnding(run);
      }
    } else {
      run.ascension = maybeUnlockAscension(run, rng);
    }
  }

  if (!run.ended && candidate.kind === "milestone") {
    run.nextMilestoneChoice = createDirectedMilestoneChoice(run.age, candidate.definition, tuning);
    run.pendingDirectedDecisionEffects = candidate.preview.decisionEffects;
    run.pendingDirectedDecisionPolicy = buildDirectedDecisionPolicy(candidate.definition);
    run.pendingDirectedDecisionDirections = decisionDirections;
    run.pendingDirectedDecisionFactEffects = candidate.definition.decisionFactEffects;
    run.yearsSinceLastMilestone = 0;
  } else if (!run.ended) {
    run.pendingDirectedDecisionDirections = undefined;
    run.pendingDirectedDecisionFactEffects = undefined;
    run.pendingDirectedDecisionPolicy = undefined;
    run.yearsSinceLastMilestone += 1;
  }
  return { updated: run, fromAge, toAge: run.age, chunk: [event] };
}

export interface DynamicNarrativeScenePayload {
  routeId: string;
  factionId?: string;
  beat: Exclude<NonNullable<EventDefinition["narrativeBeat"]>, "ending">;
  narrative: string;
  participants: Array<{
    name: string;
    factionId?: string;
    role: string;
    description: string;
    recurring: boolean;
  }>;
  attributeOutcome?: ApprovedNarrativeAttributeOutcome;
  attributePolicy?: NarrativeAttributePolicy;
  sceneClockMode?: "advance" | "hold";
  createsDecision?: boolean;
}

/**
 * The dynamic director records a world-act beat, not a static event candidate.
 * Route IDs remain an open model choice; the engine only validates package IDs
 * and settles time, facts, attributes and the decision boundary.
 */
export function advanceWithDynamicNarrativeScene(
  run: InternalRunState,
  world: WorldConfig,
  narrativeWorld: NarrativeWorldDefinition,
  payload: DynamicNarrativeScenePayload
): { updated: InternalRunState; fromAge: number; toAge: number; chunk: YearEvent[] } {
  if (run.ended || run.nextMilestoneChoice) return { updated: run, fromAge: run.age, toAge: run.age, chunk: [] };
  if (run.narrative.enabled && run.story.mainlineCompleted) {
    throw new Error("dynamic_scene_after_mainline_complete");
  }
  const route = narrativeWorld.routeArcs.find((item) => item.directionId === payload.routeId);
  if (!route) throw new Error("dynamic_scene_route_invalid");
  const runtimeState = ensureNarrativeActRuntime(run.narrative, narrativeWorld, run.age);
  run.narrative = runtimeState;
  const runtime = run.narrative.actRuntime;
  const act = runtime ? narrativeWorld.mainlineActs?.find((item) => item.id === runtime.actId) : undefined;
  if (!runtime || !act || runtime.beat !== payload.beat) throw new Error("dynamic_scene_beat_invalid");
  const knownFactions = narrativeWorld.narrativeFactions ?? [];
  if (payload.factionId && knownFactions.length > 0 && !knownFactions.some((faction) => faction.id === payload.factionId)) {
    throw new Error("dynamic_scene_faction_invalid");
  }
  const fromAge = run.age;
  const heldAge = shouldHoldSceneAge(run);
  if (!heldAge) run.age += 1;
  const changes = payload.attributeOutcome
    ? approveNarrativeAttributeOutcome(run, world, payload.attributeOutcome, "background", payload.attributePolicy)
    : undefined;
  const createsDecision = payload.createsDecision === true;
  if (!createsDecision && (payload.beat === "setup" || payload.beat === "escalation" || payload.beat === "payoff") && !changes) {
    throw new Error("dynamic_scene_outcome_required");
  }
  const settledChanges = changes ?? {};
  run.stats = applyChanges(run.stats, settledChanges);
  run.ageStage = resolveAgeStage(run.age, world);
  updateNegativeStreaks(run);
  const sceneId = `dynamic:${act.id}:${payload.beat}:${run.age}:${run.history.length + 1}`;
  const factId = act.factId ?? act.introduceFactIds?.[0];
  const event: YearEvent = {
    age: run.age,
    title: `${run.age}岁·人生片段`,
    summary: payload.narrative.trim(),
    statChanges: settledChanges,
    tags: [
      "director",
      "dynamic_scene",
      createsDecision ? "milestone" : "normal",
      `direction_${payload.routeId}`,
      `act_${act.id}`,
      `beat_${payload.beat}`,
      ...(payload.factionId ? [`faction_${payload.factionId}`] : [])
    ]
  };
  run.history.push(event);
  const story = ensureStoryDirectorState(run);
  recordNarrativeRouteSelection(run, payload.routeId, narrativeWorld);
  if (payload.factionId) story.factionTension[payload.factionId] = (story.factionTension[payload.factionId] ?? 0) + 1;
  if (payload.beat === "setup") introduceMainlineActFacts(story, act, narrativeWorld, run.age, sceneId);
  if (factId && payload.beat !== "setup") applyStoryFactEffect(story, { modifyFactIds: [factId] }, run.age, sceneId);
  const threadId = route.coreThreadIds[0] ?? payload.routeId;
  const previousScene = run.narrative.activeScene?.mainlineActId === act.id ? run.narrative.activeScene : undefined;
  run.narrative.activeScene = payload.beat === "payoff"
    ? undefined
    : {
      id: previousScene?.id ?? sceneId,
      threadId,
      phase: payload.beat,
      openedAge: previousScene?.openedAge ?? run.age,
      lastTouchedAge: run.age,
      mainlineActId: act.id,
      decisionCount: previousScene?.decisionCount ?? 0
    };
  run.narrative.scene = {
    place: payload.factionId ? `${payload.factionId}势力所在` : "人物所处的现实场域",
    conflict: payload.narrative.trim().slice(0, 160),
    aftermath: payload.beat === "payoff" ? "这一幕的代价已留下余波。" : "此段经历仍会在后续被承接。",
    lastEventId: sceneId
  };
  const storedCharacterIds: string[] = [];
  for (const participant of payload.participants.filter((item) => item.recurring)) {
    const existing = run.narrative.dynamicCharacters.find((character) => (
      character.name === participant.name && character.factionId === participant.factionId && character.status === "active"
    ));
    const character: NarrativeDynamicCharacter = existing ?? {
      id: `character:${createHash("sha256").update(`${run.runId}:${participant.name}:${participant.factionId ?? "none"}`).digest("hex").slice(0, 16)}`,
      name: participant.name,
      factionId: participant.factionId,
      role: participant.role,
      description: participant.description,
      relatedFactIds: [],
      relatedRouteIds: [],
      introducedAge: run.age,
      lastSeenAge: run.age,
      importance: "recurring",
      status: "active"
    };
    character.lastSeenAge = run.age;
    character.role = participant.role;
    character.description = participant.description;
    character.relatedRouteIds = Array.from(new Set([...character.relatedRouteIds, payload.routeId])).slice(-8);
    character.relatedFactIds = Array.from(new Set([...character.relatedFactIds, ...(factId ? [factId] : [])])).slice(-8);
    if (!existing) run.narrative.dynamicCharacters = [...run.narrative.dynamicCharacters, character].slice(-24);
    storedCharacterIds.push(character.id);
  }
  run.narrative.activeCharacterIds = Array.from(new Set([...run.narrative.activeCharacterIds, ...storedCharacterIds])).slice(-12);
  run.narrative.memoryEntries = [
    ...run.narrative.memoryEntries,
    {
      id: `memory:${sceneId}`,
      age: run.age,
      routeId: payload.routeId,
      factionIds: payload.factionId ? [payload.factionId] : [],
      characterIds: storedCharacterIds,
      factIds: factId ? [factId] : [],
      text: payload.narrative.trim().slice(0, 480)
    }
  ].slice(-80);
  if (payload.sceneClockMode && payload.beat !== "payoff") {
    run.narrative.sceneClock = { ...run.narrative.sceneClock, mode: payload.sceneClockMode, sameAgeTurnCount: 0 };
  } else if (heldAge && run.narrative.activeScene) {
    run.narrative.sceneClock = { ...run.narrative.sceneClock, sameAgeTurnCount: run.narrative.sceneClock.sameAgeTurnCount + 1 };
  }
  if (payload.beat === "payoff") {
    const recorded = recordMainlineActCompletion(run, act, {
      sourceId: sceneId,
      experienceId: payload.routeId,
      threadId,
      openedAge: previousScene?.openedAge ?? runtime.enteredAge,
      decisionCount: runtime.decisionCount
    });
    if (!recorded) throw new Error("dynamic_mainline_act_already_completed");
    run.narrative.payoffCount = Math.min(8, run.narrative.payoffCount + 1);
    run.narrative.lastResolvedSceneAge = run.age;
    run.narrative.sceneClock = { ...run.narrative.sceneClock, mode: "advance", sameAgeTurnCount: 0 };
    const advanced = advanceNarrativeActBeat(run.narrative, narrativeWorld, run.age, { selectedRouteId: payload.routeId });
    run.narrative = advanced.state;
    if (!run.narrative.actRuntime || run.narrative.actRuntime.actId === act.id) story.closureExperienceId = payload.routeId;
    refreshNarrativeClosureEligibility(run, narrativeWorld);
  } else if (!createsDecision) {
    run.narrative = advanceNarrativeActBeat(run.narrative, narrativeWorld, run.age, { selectedRouteId: payload.routeId }).state;
  }
  refreshRunFame(run);
  if (!heldAge) {
    const rng = seedrandom(`${run.seed}:dynamic-scene:${sceneId}`);
    const deathCheck = calcDeathRisk(run, world, 0);
    if (reduceDeathRisk(run, deathCheck.risk) > 0 && rng() < reduceDeathRisk(run, deathCheck.risk)) {
      const cause = deathCheck.cause ?? "命运反噬";
      if (!deferNarrativeCatastrophe(run, cause)) {
        run.ended = true;
        run.outcome = "dead";
        run.deathCause = cause;
        run.endingSummary = calcEnding(run);
      }
    } else {
      run.ascension = maybeUnlockAscension(run, rng);
    }
  }
  if (!run.ended && createsDecision) {
    const tuning = run.tuningSnapshot ?? createDefaultGameplayTuning();
    run.nextMilestoneChoice = generateMilestoneChoice(run.age, payload.narrative, tuning);
    run.pendingDirectedDecisionPolicy = dynamicDecisionPolicies();
    run.pendingDynamicScene = { id: sceneId, routeId: payload.routeId, factionId: payload.factionId, beat: payload.beat, mainlineActId: act.id, factId };
    run.yearsSinceLastMilestone = 0;
  } else if (!run.ended) {
    run.yearsSinceLastMilestone += 1;
  }
  return { updated: run, fromAge, toAge: run.age, chunk: [event] };
}

function dynamicDecisionPolicies(): Record<DecisionType, PendingDirectedDecisionPolicy> {
  return {
    safe: { allowedStats: allStatKeys, allowedBands: ["light"], allowedDirections: ["up"], minEffects: 1, maxEffects: 1 },
    balanced: { allowedStats: allStatKeys, allowedBands: ["light", "medium"], allowedDirections: ["up", "down"], minEffects: 1, maxEffects: 2, requirePositive: true },
    risky: { allowedStats: allStatKeys, allowedBands: ["light", "medium", "heavy"], allowedDirections: ["up", "down"], minEffects: 1, maxEffects: 2 }
  };
}

export function dynamicSceneAttributePolicy(): NarrativeAttributePolicy {
  return { allowedStats: allStatKeys, allowedBands: ["light", "medium"], allowedDirections: ["up", "down"], minEffects: 1, maxEffects: 2, requirePositive: true };
}

export function dynamicBackgroundAttributePolicy(run: InternalRunState): NarrativeAttributePolicy {
  const runtime = run.narrative.actRuntime;
  const focus = runtime?.growthFocusId
    ? runtime.growthFocusOptions?.find((option) => option.id === runtime.growthFocusId)
    : undefined;
  return {
    allowedStats: allStatKeys,
    allowedBands: ["light", "medium"],
    allowedDirections: ["up"],
    minEffects: 1,
    maxEffects: 1,
    requirePositive: true,
    preferredStats: focus?.primaryStats,
    minPreferredEffects: focus ? 1 : undefined
  };
}

export function autoAdvanceToCheckpoint(
  run: InternalRunState,
  world: WorldConfig,
  difficulty: DifficultyConfig,
  options?: {
    milestoneEventPool?: string[];
    targetYears?: number;
    maxTargetYears?: number;
    allowRandomMilestone?: boolean;
    deferNarrativeAttributeEffects?: boolean;
  }
): { updated: InternalRunState; fromAge: number; toAge: number; chunk: YearEvent[] } {
  if (run.ended || run.nextMilestoneChoice) {
    return { updated: run, fromAge: run.age, toAge: run.age, chunk: [] };
  }

  const fromAge = run.age;
  const chunk: YearEvent[] = [];
  const milestoneEventPool = options?.milestoneEventPool ?? [];
  const tuning = run.tuningSnapshot ?? createDefaultGameplayTuning();

  const segmentTargetYears = clamp(
    Math.trunc(options?.targetYears ?? 1),
    1,
    Math.max(1, tuning.pacing.maxYearsPerChunk, Math.trunc(options?.maxTargetYears ?? 1))
  );
  while (!run.ended && !run.nextMilestoneChoice) {
    run.age += 1;
    const rng = seedrandom(`${run.seed}:${run.age}:${run.history.length}`);
    const currentStage = resolveAgeStage(run.age, world);
    const stageCap = resolveStageDeltaCap(currentStage.id, tuning);

    const special = rng() < tuning.pacing.specialYearChance;
    const rawChanges = options?.deferNarrativeAttributeEffects
      ? {}
      : special
      ? calcSpecialEventChanges(run.stats, difficulty, rng, tuning)
      : calcBaseGrowth(run.stats, difficulty, rng, tuning);
    const changes = reduceNegativeChanges(run, clampYearlyChangesByStage(rawChanges, stageCap));
    const tone = classifyEventTone(changes, stageCap, tuning);
    const deltaTags = buildDeltaBinTags(changes, stageCap, tuning);
    const worldGuides = worldNegativeGuideTags(world.id, tone, rng);

    if (!options?.deferNarrativeAttributeEffects) {
      run.stats = applyChanges(run.stats, changes);
    }
    run.ageStage = resolveAgeStage(run.age, world);
    if (!options?.deferNarrativeAttributeEffects) updateNegativeStreaks(run);

    const yearlyEvent: YearEvent = {
      age: run.age,
      title: buildEventTitle(world, run.age, rng, special, tuning),
      summary: special
        ? `这一年出现了超出常态的突发事件：${summarizeStatDelta(changes)}。`
        : `这一年里你经历了许多变化：${summarizeStatDelta(changes)}。`,
      statChanges: changes,
      tags: options?.deferNarrativeAttributeEffects
        ? []
        : [
            "yearly",
            run.ageStage.id,
            special ? "special" : "normal",
            `stage_cap_${stageCap}`,
            `tone_${tone}`,
            ...deltaTags,
            ...worldGuides
          ]
    };

    run.history.push(yearlyEvent);
    refreshRunFame(run);
    chunk.push(yearlyEvent);
    if (!options?.deferNarrativeAttributeEffects) {
      run.ascension = maybeUnlockAscension(run, rng);
      const deathCheck = calcDeathRisk(run, world, 0);
      const adjustedDeathRisk = reduceDeathRisk(run, deathCheck.risk);
      if (adjustedDeathRisk > 0 && rng() < adjustedDeathRisk) {
        const cause = deathCheck.cause ?? "意外灾祸";
        if (!deferNarrativeCatastrophe(run, cause)) {
          run.ended = true;
          run.outcome = "dead";
          run.deathCause = cause;
          run.endingSummary = calcEnding(run);
          break;
        }
      }
    }

    if (run.ascension.unlocked && !run.narrative.enabled) {
      run.ended = true;
      run.outcome = "ascended";
      run.endingSummary = calcEnding(run);
      break;
    }

    const milestoneByRandom = options?.allowRandomMilestone !== false && shouldTriggerRandomMilestone(run, tuning, rng);
    if (milestoneByRandom) {
      const seedEvent = pickMilestoneSeedEvent(rng, milestoneEventPool);
      run.nextMilestoneChoice = generateMilestoneChoice(run.age, seedEvent, tuning);
      run.yearsSinceLastMilestone = 0;
      break;
    }
    run.yearsSinceLastMilestone += 1;

    if (chunk.length >= segmentTargetYears) {
      break;
    }

    if (run.age >= run.endAge && !run.narrative.enabled) {
      run.ended = true;
      run.endingSummary = calcEnding(run);
      break;
    }
  }

  return { updated: run, fromAge, toAge: run.age, chunk };
}

export function applyMilestoneDecisionAndAdvance(
  run: InternalRunState,
  world: WorldConfig,
  difficulty: DifficultyConfig,
  decision: DecisionType,
  options?: { milestoneEventPool?: string[]; narrativeOutcome?: ApprovedNarrativeAttributeOutcome; factResolution?: NarrativeFactResolution; narrativeWorld?: NarrativeWorldDefinition | null }
): { updated: InternalRunState; fromAge: number; toAge: number; chunk: YearEvent[]; decisionEvent: YearEvent } {
  if (!run.nextMilestoneChoice) {
    throw new Error("当前没有可用的关键抉择");
  }

  const tuning = run.tuningSnapshot ?? createDefaultGameplayTuning();
  const rng = seedrandom(`${run.seed}:decision:${run.age}:${run.history.length}`);
  const directedEffect = run.pendingDirectedDecisionEffects?.[decision];
  const pendingDynamicScene = run.pendingDynamicScene;
  const isDirectedDecision = Boolean(directedEffect) || run.history[run.history.length - 1]?.tags.includes("director") === true;
  const directedSuccessRate = clamp(
    tuning.decision.profiles[decision].successRate - difficulty.yearlyVolatility * tuning.decision.successRateVolatilityFactor,
    tuning.decision.successRateClampMin,
    tuning.decision.successRateClampMax
  );
  const modelChanges = options?.narrativeOutcome
    ? approveNarrativeAttributeOutcome(run, world, options.narrativeOutcome, "decision", run.pendingDirectedDecisionPolicy?.[decision])
    : undefined;
  if (isDirectedDecision && !modelChanges) {
    throw new Error("decision_outcome_required");
  }
  const decisionResult = modelChanges
    ? { statChanges: modelChanges, deathRollBonus: 0 }
    : directedEffect
    ? {
        statChanges: rng() < directedSuccessRate
          ? directedEffect.success
          : directedEffect.failure,
        deathRollBonus: directedEffect.deathRisk
      }
    : applyDecision(run.stats, decision, difficulty, rng, tuning);
  const stageCap = resolveStageDeltaCap(run.ageStage.id, tuning);
  const decisionChanges = reduceNegativeChanges(run, clampYearlyChangesByStage(decisionResult.statChanges, stageCap));
  const tone = classifyEventTone(decisionChanges, stageCap, tuning);
  const deltaTags = buildDeltaBinTags(decisionChanges, stageCap, tuning);
  const worldGuides = worldNegativeGuideTags(world.id, tone, rng);
  const committedDirection = run.pendingDirectedDecisionDirections?.[decision];
  if (committedDirection) {
    applyStoryDirection(run, committedDirection, true);
  }
  run.stats = applyChanges(run.stats, decisionChanges);
  updateNegativeStreaks(run);

  const decisionEvent: YearEvent = {
    age: run.age,
    title: `${run.age}岁·关键抉择`,
    summary: `你选择了${decision === "safe" ? "稳健" : decision === "balanced" ? "适中" : "冒险"}路线，结果：${summarizeStatDelta(decisionChanges)}。`,
    statChanges: decisionChanges,
    tags: [
      "milestone",
      decision,
      `stage_cap_${stageCap}`,
      `tone_${tone}`,
      ...(committedDirection ? [`direction_${committedDirection.id}`] : []),
      ...directedDecisionOutcomeTags(decision, options?.narrativeOutcome),
      ...deltaTags,
      ...worldGuides
    ]
  };
  run.history.push(decisionEvent);
  const sourceEventId = run.history.slice(-2)[0]?.tags
    .find((tag) => tag.startsWith("event_"))
    ?.slice("event_".length) ?? "milestone";
  applyStoryFactEffect(run.story, run.pendingDirectedDecisionFactEffects?.[decision] ?? {
    introduce: [{
      id: `decision:${sourceEventId}:${decision}:${run.age}`,
      kind: "commitment",
      label: `人物在${run.age}岁作出了不可逆的${decision === "safe" ? "保全" : decision === "balanced" ? "权衡" : "冒险"}承诺。`,
      priority: 2,
      routeIds: committedDirection ? [committedDirection.id] : undefined
    }, {
      id: `cost:${sourceEventId}:${decision}:${run.age}`,
      kind: "cost",
      label: "这次抉择留下了需要在后续承担的代价。",
      priority: 2,
      routeIds: committedDirection ? [committedDirection.id] : undefined
    }]
  }, run.age, sourceEventId);
  if (pendingDynamicScene && options?.narrativeWorld) {
    const act = options.narrativeWorld.mainlineActs?.find((item) => item.id === pendingDynamicScene.mainlineActId);
    if (!act || pendingDynamicScene.beat !== run.narrative.actRuntime?.beat) {
      throw new Error("dynamic_decision_state_invalid");
    }
    if (pendingDynamicScene.beat === "climax" && pendingDynamicScene.factId) {
      const permitted = act.resolutionModes ?? ["exposed", "concealed", "compromised", "sacrificed"];
      if (!options.factResolution || !permitted.includes(options.factResolution)) throw new Error("dynamic_fact_resolution_required");
      const resolvedFactIds = Array.from(new Set([pendingDynamicScene.factId, ...(act.resolveFactIds ?? [])]));
      applyStoryFactEffect(run.story, { resolveFactIds: resolvedFactIds }, run.age, sourceEventId);
      for (const fact of run.story.factLedger?.facts ?? []) {
        if (!resolvedFactIds.includes(fact.id)) continue;
        fact.resolution = options.factResolution;
        fact.resolutionSummary = "这项世界事实已在高潮抉择中得到不可逆的处置。";
      }
    }
    run.narrative = recordNarrativeSceneDecision(run.narrative);
    run.narrative = advanceNarrativeActBeat(run.narrative, options.narrativeWorld, run.age, {
      selectedRouteId: pendingDynamicScene.routeId,
      decision: true
    }).state;
    if (pendingDynamicScene.beat === "climax") run.narrative.climaxCount = Math.min(8, run.narrative.climaxCount + 1);
    run.narrative.memoryEntries = [
      ...run.narrative.memoryEntries,
      {
        id: `memory:decision:${sourceEventId}:${run.age}`,
        age: run.age,
        routeId: pendingDynamicScene.routeId,
        factionIds: pendingDynamicScene.factionId ? [pendingDynamicScene.factionId] : [],
        characterIds: [],
        factIds: pendingDynamicScene.factId ? [pendingDynamicScene.factId] : [],
        text: decisionEvent.summary
      }
    ].slice(-80);
  }
  refreshRunFame(run);
  if (!pendingDynamicScene) run.narrative = recordNarrativeSceneDecision(run.narrative);
  run.nextMilestoneChoice = undefined;
  run.pendingDirectedDecisionEffects = undefined;
  run.pendingDirectedDecisionPolicy = undefined;
  run.pendingDirectedDecisionDirections = undefined;
  run.pendingDirectedDecisionFactEffects = undefined;
  run.pendingDynamicScene = undefined;

  const deathCheck = calcDeathRisk(run, world, decisionResult.deathRollBonus);
  const adjustedDeathRisk = reduceDeathRisk(run, deathCheck.risk);
  if (adjustedDeathRisk > 0 && rng() < adjustedDeathRisk) {
    const cause = deathCheck.cause ?? (decision === "risky" ? "冒险失败" : "决策反噬");
    if (deferNarrativeCatastrophe(run, cause)) {
      return {
        updated: run,
        fromAge: decisionEvent.age,
        toAge: run.age,
        chunk: [decisionEvent],
        decisionEvent
      };
    }
    run.ended = true;
    run.outcome = "dead";
    run.deathCause = cause;
    run.endingSummary = calcEnding(run);
    return {
      updated: run,
      fromAge: decisionEvent.age,
      toAge: run.age,
      chunk: [decisionEvent],
      decisionEvent
    };
  }

  run.ascension = maybeUnlockAscension(run, rng);
  if (run.ascension.unlocked && !isDirectedDecision) {
    run.ended = true;
    run.outcome = "ascended";
    run.endingSummary = calcEnding(run);
    return {
      updated: run,
      fromAge: decisionEvent.age,
      toAge: run.age,
      chunk: [decisionEvent],
      decisionEvent
    };
  }

  return {
    updated: run,
    fromAge: decisionEvent.age,
    toAge: run.age,
    chunk: [decisionEvent],
    decisionEvent
  };
}

export function resolveNarrativeStatTiers(
  stats: Stats,
  config?: InternalRunState["narrative"]["statTierConfig"]
): Record<StatKey, NarrativeStatTier> {
  const lowMax = config?.lowMax ?? 8;
  const highMin = config?.highMin ?? 22;
  return allStatKeys.reduce<Record<StatKey, NarrativeStatTier>>((tiers, stat) => {
    tiers[stat] = stats[stat] <= lowMax ? "low" : stats[stat] >= highMin ? "high" : "steady";
    return tiers;
  }, {} as Record<StatKey, NarrativeStatTier>);
}

export function toClientRun(run: InternalRunState): PublicRunState {
  ensureStoryDirectorState(run);
  const shown = run.narrativeReservoir.revealedCount;
  const visibleTurn = run.turnRecords?.at(-1);
  const visibleAge = visibleTurn?.age ?? run.narrativeReservoir.revealedAge;
  const visibleStage = visibleTurn
    ? { id: run.narrativeReservoir.revealedAgeStage.id, label: visibleTurn.ageStage.label, min: 0, max: Number.MAX_SAFE_INTEGER }
    : run.narrativeReservoir.revealedAgeStage;
  const visibleChoice = [...(run.turnRecords ?? [])]
    .reverse()
    .find((turn) => turn.choice && !turn.choiceOutcome)
    ?.choice;
  const visibleEnded = run.ended && run.narrativeReservoir.queued.length === 0 && (
    !visibleTurn || visibleTurn.age >= run.age
  );
  const visiblePhase: RunPhase = visibleEnded
    ? "ended"
    : visibleChoice
      ? "waiting_decision"
      : run.narrativeReservoir.phase === "generating"
        ? "ready"
      : run.narrativeReservoir.phase;
  const visibleStats = visibleTurn?.statsSnapshot ?? run.stats;
  const runtime = run.narrative.actRuntime;
  const growthFocus = runtime && (runtime.growthFocusOptions?.length ?? 0) > 0
    ? {
        selectedId: runtime.growthFocusId,
        options: runtime.growthFocusOptions!.map((focus) => ({
          id: focus.id,
          label: focus.label,
          description: focus.description
        }))
      }
    : undefined;
  return {
    runId: run.runId,
    worldId: run.worldId,
    difficultyId: run.difficultyId,
    age: visibleAge,
    ageStage: { label: visibleStage.label },
    personaPrompt: run.personaPrompt,
    stats: visibleStats,
    statTiers: resolveNarrativeStatTiers(visibleStats, run.narrative.statTierConfig),
    growthFocus,
    cards: run.cards.map((card) => ({
      id: card.id,
      name: card.name,
      rarity: card.rarity,
      description: card.description,
      modifiers: card.modifiers
    })),
    items: visibleTurn?.itemsSnapshot ?? publicItemsSnapshot(run),
    narrativeCharacters: visibleTurn?.narrativeCharactersSnapshot ?? publicNarrativeCharactersSnapshot(run),
    nextMilestoneChoice: visibleChoice,
    ended: visibleEnded,
    endingSummary: visibleEnded ? run.endingSummary : undefined,
    ascension: run.ascension,
    fame: visibleTurn?.fameSnapshot ?? run.fame,
    outcome: visibleEnded ? run.outcome : "ongoing",
    phase: visiblePhase,
    bufferSize: run.narrativeReservoir.queued.length,
    revealedAge: visibleAge,
    revealedCount: shown
  };
}

export function attachTimelineChunk(run: InternalRunState, world: WorldConfig, chunk: YearEvent[]): InternalRunState {
  run.timelineChunk = toPresentationTimelineEntries(world, chunk);
  return run;
}

export function queueTimelineEntries(run: InternalRunState, entries: TimelineEntry[]): void {
  if (entries.length === 0) return;
  if (run.narrativeReservoir.revealedCount === 0) {
    const first = entries[0];
    if (first) {
      run.narrativeReservoir.revealedAge = first.age - 1;
      run.narrativeReservoir.revealedAgeStage = first.ageStage;
    }
  }
  run.narrativeReservoir.queued.push(...entries);
}

export function revealNextTimelineEntry(run: InternalRunState): TimelineEntry | null {
  const next = run.narrativeReservoir.queued.shift();
  if (!next) return null;
  run.narrativeReservoir.revealedCount = Math.min(
    run.history.length,
    run.narrativeReservoir.revealedCount + (next.sourceEventCount ?? 1)
  );
  run.narrativeReservoir.revealedAge = next.age;
  run.narrativeReservoir.revealedAgeStage = next.ageStage;
  return next;
}

export function markRunPhase(run: InternalRunState, phase: RunPhase): void {
  run.narrativeReservoir.phase = phase;
}

export function hasPendingRequestId(run: InternalRunState, requestId?: string): boolean {
  if (!requestId?.trim()) return false;
  return run.narrativeReservoir.pendingRequestIds.includes(requestId.trim());
}

export function rememberRequestId(run: InternalRunState, requestId?: string): void {
  if (!requestId?.trim()) return;
  const normalized = requestId.trim();
  if (run.narrativeReservoir.pendingRequestIds.includes(normalized)) return;
  run.narrativeReservoir.pendingRequestIds.push(normalized);
  if (run.narrativeReservoir.pendingRequestIds.length > 20) {
    run.narrativeReservoir.pendingRequestIds = run.narrativeReservoir.pendingRequestIds.slice(-20);
  }
}
