export type WorldId = string;
export type StatKey = "intelligence" | "charisma" | "family" | "fortune" | "physique";
export type DecisionType = "safe" | "balanced" | "risky";
export type CardRarity = "common" | "rare" | "epic" | "legendary";
export type AgeStageId = "child" | "youth" | "prime" | "middle" | "elder";
export type StepAction = "consume" | "decide" | "select_growth_focus" | "generate_opening" | "resolve_survival";
export type RunPhase = "generating" | "ready" | "waiting_decision" | "ended";
export type DirectorMode = "legacy" | "tool-fast" | "auto";
export type EventKind = "normal" | "milestone" | "any";
export type EventStoryRole = "daily" | "main" | "branch" | "milestone" | "closure";
export type EventStoryPosition = "origin" | "accumulation" | "pressure" | "turn" | "resolution";
export type StoryClosureState = "open" | "guiding" | "finished";
export type NarrativeBeat = "setup" | "escalation" | "pressure" | "climax" | "payoff" | "ending";
export type NarrativeArcPhase = "setup" | "rising" | "pressure" | "climax" | "aftermath" | "ending";
export type NarrativeThreadStatus = "seeded" | "escalating" | "climax" | "resolved";
export type EndingPolarity = "good" | "normal" | "bad";
export type NarrativeEndingState = "open" | "eligible" | "locked" | "guiding" | "finished";
export type PassiveEffectType = "candidate_weight" | "negative_reduce" | "death_risk_reduce" | "reward_bonus" | "unlock_event";
export type StoryFactKind = "open_question" | "stake" | "commitment" | "cost" | "relationship_change";
export type StoryFactStatus = "open" | "resolved" | "blocked";
export type NarrativeFactResolution = "exposed" | "concealed" | "compromised" | "sacrificed";
export type NarrativeCharacterImportance = "momentary" | "recurring" | "core";

export interface StoryDirectionDefinition {
  id: string;
  label: string;
  summary: string;
  focusTags: string[];
  factionIds: string[];
  openingThreadIds: string[];
  closureTags: string[];
}

export type AgeStageRateMap = Record<AgeStageId, number>;
export type AgeStageIntMap = Record<AgeStageId, number>;

export interface Stats {
  intelligence: number;
  charisma: number;
  family: number;
  fortune: number;
  physique: number;
}

/** Semantic attribute consequences proposed by the narrator and settled by the engine. */
export type NarrativeAttributeBand = "light" | "medium" | "heavy";
export type NarrativeAttributeDirection = "up" | "down";
export type NarrativeStatTier = "low" | "steady" | "high";
export type SurvivalChoice = "self_rescue" | "seek_help" | "trust_fate";
export type NarrativeProgressGateStage = "opening" | "escalation" | "pressure" | "climax";
export interface NarrativeAttributeEffect {
  stat: StatKey;
  direction: NarrativeAttributeDirection;
  band: NarrativeAttributeBand;
}

/**
 * The engine owns the numeric envelope; the narrator selects an outcome within it.
 * This keeps one tool call expressive without allowing a scene to invent its own balance rules.
 */
export interface NarrativeAttributePolicy {
  allowedStats: StatKey[];
  allowedBands: NarrativeAttributeBand[];
  allowedDirections: NarrativeAttributeDirection[];
  minEffects: number;
  maxEffects: number;
  requirePositive?: boolean;
  /** A local preference the engine verifies without exposing numeric rules to players. */
  preferredStats?: StatKey[];
  minPreferredEffects?: number;
  /** Negative effects on these stats are never accepted for this policy. */
  forbidNegativeStats?: StatKey[];
  /** The engine accepts at most this negative semantic band for a specific stat. */
  maxNegativeBandByStat?: Partial<Record<StatKey, NarrativeAttributeBand>>;
}

export interface BackgroundCard {
  id: string;
  name: string;
  rarity: CardRarity;
  description: string;
  modifiers: Partial<Record<StatKey, number>>;
  tags: string[];
  /** Compact narrator hints carried only by the player-selected talent cards. */
  narrative?: TalentNarrativeProfile;
  effects?: PassiveEffect[];
}

export interface TalentNarrativeProfile {
  bias: string;
  affinities?: string[];
  riskTone?: string;
}

export interface PassiveEffect {
  type: PassiveEffectType;
  stat?: StatKey;
  tags?: string[];
  amount?: number;
  eventIds?: string[];
  description: string;
}

export interface ItemDefinition {
  id: string;
  name: string;
  rarity: CardRarity;
  description: string;
  tags: string[];
  effects: PassiveEffect[];
}

export interface ItemInstance {
  id: string;
  name: string;
  rarity: CardRarity;
  description: string;
  obtainedAge: number;
  effects?: PassiveEffect[];
}

/** A causal fact is engine data, not player-facing prompt material. */
export interface StoryFactDefinition {
  id: string;
  kind: StoryFactKind;
  label: string;
  priority?: number;
  threadId?: string;
  routeIds?: string[];
  characterIds?: string[];
}

export interface StoryFactEffect {
  introduce?: StoryFactDefinition[];
  modifyFactIds?: string[];
  resolveFactIds?: string[];
  blockFactIds?: string[];
}

export interface EventDefinition {
  id: string;
  worldId: WorldId;
  factionId?: string;
  title: string;
  kind: EventKind;
  tags: string[];
  minAge: number;
  /**
   * Source-material age preference. The narrative director treats this as a
   * ranking hint rather than a terminal eligibility boundary.
   */
  maxAge?: number;
  cooldownYears: number;
  baseWeight: number;
  outcomeProfileId: string;
  storyRole?: EventStoryRole;
  storyPosition?: EventStoryPosition;
  focusTags?: string[];
  requiresFlags?: string[];
  setsFlags?: string[];
  clearsFlags?: string[];
  blocksFlags?: string[];
  primaryStat?: StatKey;
  secondaryStat?: StatKey;
  storyDirectionIds?: string[];
  narrativeThreadIds?: string[];
  opensThreads?: string[];
  resolvesThreads?: string[];
  followUpIds?: string[];
  narrativeBeat?: NarrativeBeat;
  /** A reusable dramatic situation above this concrete source event. */
  sceneArchetypeId?: string;
  narrativeCharacterIds?: string[];
  narrativeComponentTransitions?: NarrativeComponentTransition[];
  /** Facts that must already exist before this event can be selected. */
  requiresFactIds?: string[];
  /** Facts this event may materially change without resolving. */
  modifiesFactIds?: string[];
  /** Facts this event is permitted to pay off. */
  reclaimableFactIds?: string[];
  factEffect?: StoryFactEffect;
  /** A decision changes the story ledger only after the player commits it. */
  decisionFactEffects?: Partial<Record<DecisionType, StoryFactEffect>>;
  promptHook: string;
}

export type NarrativeComponentType = "plot" | "character" | "relationship" | "object" | "promise" | "consequence";
export type NarrativeComponentStatus = "dormant" | "introduced" | "active" | "escalated" | "payable" | "resolved";

export interface NarrativeComponentActivation {
  phases?: NarrativeArcPhase[];
  minAge?: number;
  maxAge?: number;
  requiresFlags?: string[];
  requiresThreadIds?: string[];
}

/**
 * A compact, engine-owned narrative fact. Components are never projected to
 * the client; they only control which established material reaches the model.
 */
export interface NarrativeComponentDefinition {
  id: string;
  label: string;
  type: NarrativeComponentType;
  priority: number;
  directionIds?: string[];
  threadIds?: string[];
  characterIds?: string[];
  facts?: string[];
  activation?: NarrativeComponentActivation;
  introHint: string;
  activeHint: string;
  escalationHint: string;
  payoffHint: string;
}

export interface NarrativeComponentTransition {
  componentId: string;
  status: Exclude<NarrativeComponentStatus, "dormant">;
  fact?: string;
}

export interface NarrativeComponentEventBinding {
  eventId: string;
  transitions: NarrativeComponentTransition[];
}

export interface NarrativeComponentCatalog {
  version: 1;
  worldId: WorldId;
  components: NarrativeComponentDefinition[];
  eventBindings: NarrativeComponentEventBinding[];
}

export interface NarrativeEventBinding {
  eventId: string;
  beat: NarrativeBeat;
  opensThreads?: string[];
  resolvesThreads?: string[];
  characterIds?: string[];
  sceneArchetypeId?: string;
  sceneHint?: string;
}

/**
 * A world-defined dramatic act. The engine only understands ordering and fact
 * requirements; each world supplies its own dramatic meaning.
 */
export interface NarrativeMainlineActDefinition {
  id: string;
  label: string;
  prompt: string;
  requiredFactIds?: string[];
  introduceFactIds?: string[];
  resolveFactIds?: string[];
  readinessStage?: NarrativeProgressGateStage;
  /** The single world fact this act introduces, pressures and resolves. */
  factId?: string;
  resolutionModes?: NarrativeFactResolution[];
}

/**
 * Compact model-authored continuity from one world act to the next. The engine
 * persists it in the existing fact ledger, never as a player-facing label.
 */
export interface NarrativeActHandoff {
  resolvedTension: string;
  lastingConsequence: string;
  continuation: string;
}

/**
 * A reusable dramatic situation. It gives the director usable material even
 * after a very specific local event has aged out or is on cooldown.
 */
export interface NarrativeSceneArchetype {
  id: string;
  label: string;
  description: string;
  beats: NarrativeBeat[];
  focusTags?: string[];
  outcomeProfileId?: string;
  baseWeight?: number;
}

/** A world-level fact shared by all parallel life experiences. */
export interface NarrativeMainlineFactDefinition {
  id: string;
  kind: StoryFactKind;
  label: string;
  priority?: number;
  routeIds?: string[];
  factionIds?: string[];
  resolutionModes?: NarrativeFactResolution[];
}

/** A durable pressure group. It is data owned by a world package, not a hard route gate. */
export interface NarrativeFactionDefinition {
  id: string;
  label: string;
  summary: string;
  stance?: string;
  conflictFactionIds?: string[];
}

export interface NarrativeThreadDefinition {
  id: string;
  label: string;
  premise: string;
  directionIds: string[];
  payoffHint: string;
}

export interface NarrativeCharacterDefinition {
  id: string;
  label: string;
  role: string;
  description: string;
  directionIds: string[];
}

export interface NarrativeLoreEntry {
  id: string;
  text: string;
  priority: number;
  directionIds?: string[];
  phases?: NarrativeArcPhase[];
  threadIds?: string[];
}

export interface EndingBlueprint {
  id: string;
  worldId: WorldId;
  directionId: string;
  polarity: EndingPolarity;
  title: string;
  premise: string;
  finalConflict: string;
  payoffFocus: string;
  epilogueFocus: string;
  statWeights: Partial<Record<StatKey, number>>;
  requiredThreadIds: string[];
  favorableFlags?: string[];
  adverseFlags?: string[];
}

/**
 * A world-owned qualification gate. It measures a weighted capability instead
 * of tying narrative movement to a calendar age.
 */
export interface NarrativeStatGate {
  weights: Partial<Record<StatKey, number>>;
  threshold: number;
}

/** Player-selected emphasis for ordinary-year growth during one world act. */
export interface NarrativeGrowthFocusDefinition {
  id: string;
  label: string;
  description: string;
  primaryStats: StatKey[];
  secondaryStats?: StatKey[];
}

/** World-owned thresholds used by public attribute pills and model context. */
export interface NarrativeStatTierConfig {
  lowMax: number;
  highMin: number;
}

/** Player-facing wording for a world's internal low / steady / high stat tiers. */
export type NarrativeStatTierPresentation = Record<StatKey, Record<NarrativeStatTier, string>>;

export interface NarrativeRouteProgression {
  directionId: string;
  gates?: Partial<Record<NarrativeProgressGateStage, NarrativeStatGate>>;
}

export interface NarrativeBackgroundPacing {
  minYears: number;
  maxYears: number;
  personalReflectionChance?: number;
}

/** World-owned early-life constraints. They shape narration, never story completion. */
export interface NarrativeEarlyLifeDefinition {
  /** Inclusive upper bound for the dependent-life narration frame. */
  maxAge: number;
}

/** Opening policy for one world package. */
export interface NarrativeOpeningDefinition {
  earlyLife?: NarrativeEarlyLifeDefinition;
}

export interface NarrativeCompletionRule {
  requireCommittedDirection?: boolean;
  requireDecisionConsequence?: boolean;
  requireClimax?: boolean;
  requirePayoff?: boolean;
  requireResolvedCoreFacts?: boolean;
  requireNoActiveScene?: boolean;
  /** Number of resolved scene instances. Repeated experiences are allowed. */
  minCompletedSceneInstances?: number;
  /** A world may require all configured acts without naming their semantics in code. */
  requireAllMainlineActs?: boolean;
}

export interface NarrativeSurvivalStage {
  id: string;
  label: string;
  ageStageIds: AgeStageId[];
  /** A crisis can accumulate only while physique is strictly below this value. */
  dangerBelowPhysique: number;
  baseCrisisRisk: number;
  additionalYearRisk: number;
  maxCrisisRisk: number;
}

export interface NarrativeFamilyPhysiqueSupport {
  outcomes: Array<{
    delta: number;
    weight: number;
  }>;
}

export interface NarrativeSurvivalRule {
  /** No survival risk is checked before this age. */
  startAge: number;
  graceYears: number;
  stages: NarrativeSurvivalStage[];
  recovery: {
    successRateByTier: Record<NarrativeStatTier, number>;
    restoreBuffer: number;
  };
  familyPhysiqueSupport: Record<NarrativeStatTier, NarrativeFamilyPhysiqueSupport>;
}

export interface NarrativeWorldProgression {
  backgroundPacing: NarrativeBackgroundPacing;
  routes: NarrativeRouteProgression[];
  completion: NarrativeCompletionRule;
  growthFocuses?: NarrativeGrowthFocusDefinition[];
  statTiers?: NarrativeStatTierConfig;
  statTierPresentation?: NarrativeStatTierPresentation;
  survival?: NarrativeSurvivalRule;
}

/**
 * Internal dramatic spine. It is supplied to the narrator as a constraint,
 * never projected to the player as a chapter title or route label.
 */
export interface NarrativeMainlineSkeleton {
  premise: string;
  opening: string;
  pressure: string;
  climax: string;
  payoff: string;
  goodEndingDirection: string;
  badEndingDirection: string;
}

/**
 * A world-owned route catalog entry. The engine treats the identifier as data:
 * it never assumes a fixed route count or knows a world's route names.
 */
export interface NarrativeRouteDefinition {
  directionId: string;
  label?: string;
  summary: string;
  coreThreadIds: string[];
  perspective?: string;
  escalation?: string;
  crisis?: string;
  payoffFocus?: string;
  characterIds?: string[];
  loreIds?: string[];
  materialEventIds?: string[];
}

export interface NarrativeWorldDefinition {
  version: 1 | 2 | 3 | 4 | 5 | 6;
  worldId: WorldId;
  storyBible: string;
  styleRules: string[];
  /** World-owned closing texture for the final renderer. */
  endingGuide?: string;
  opening?: NarrativeOpeningDefinition;
  mainlineSkeleton?: NarrativeMainlineSkeleton;
  progression?: NarrativeWorldProgression;
  /** Optional static facts. Dynamic worlds may create act handoffs at runtime. */
  mainlineFacts?: NarrativeMainlineFactDefinition[];
  /** Ordered, world-owned dramatic acts; never rendered as player-facing chapters. */
  mainlineActs?: NarrativeMainlineActDefinition[];
  /** Factions available to the narrator while composing a dynamic scene. */
  narrativeFactions?: NarrativeFactionDefinition[];
  /** General-purpose scenes used when no concrete material is currently fit. */
  sceneArchetypes?: NarrativeSceneArchetype[];
  /** Complete route catalog projected to the model from world data. */
  routeArcs: NarrativeRouteDefinition[];
  threads: NarrativeThreadDefinition[];
  characters: NarrativeCharacterDefinition[];
  lore: NarrativeLoreEntry[];
  eventBindings: NarrativeEventBinding[];
  endingBlueprints: EndingBlueprint[];
  components?: NarrativeComponentDefinition[];
  componentEventBindings?: NarrativeComponentEventBinding[];
}

/**
 * The only dramatic actions a model may propose. The engine translates an
 * approved intention into a concrete, currently legal event.
 */
export type NarrativeIntent = "continue" | "pressure" | "payoff";

export interface NarrativeThreadState {
  id: string;
  status: NarrativeThreadStatus;
  openedAge: number;
  lastTouchedAge: number;
}

/**
 * Per-route dramatic progress. Routes are defined by each world's routeArcs;
 * an absent record means that route has not yet started its current pass.
 */
export interface NarrativeRouteProgress {
  routeId: string;
  phase: Exclude<NarrativeBeat, "payoff" | "ending">;
  lastTouchedAge: number;
  lastEventId?: string;
}

/** The only dramatic beat currently owned by the engine for a world act. */
export interface NarrativeActRuntime {
  actId: string;
  beat: Exclude<NarrativeBeat, "ending">;
  enteredAge: number;
  lastAdvancedAge: number;
  selectedRouteIds: string[];
  decisionCount: number;
  growthFocusId?: string;
  growthFocusOptions?: NarrativeGrowthFocusDefinition[];
}

/** A player-visible recurring person generated during this particular life. */
export interface NarrativeDynamicCharacter {
  id: string;
  name: string;
  factionId?: string;
  role: string;
  description: string;
  relatedFactIds: string[];
  relatedRouteIds: string[];
  introducedAge: number;
  lastSeenAge: number;
  importance: NarrativeCharacterImportance;
  status: "active" | "resolved" | "gone";
}

/** Compact, deterministic local memory. Retrieval never changes engine state. */
export interface NarrativeMemoryEntry {
  id: string;
  age: number;
  routeId?: string;
  factionIds: string[];
  characterIds: string[];
  factIds: string[];
  text: string;
}

export interface NarrativeComponentRunState {
  id: string;
  status: Exclude<NarrativeComponentStatus, "dormant">;
  introducedAge: number;
  lastTouchedAge: number;
  facts: string[];
}

export interface NarrativeSceneState {
  place: string;
  conflict: string;
  aftermath: string;
  lastEventId?: string;
}

export interface ActiveNarrativeScene {
  id: string;
  threadId: string;
  phase: Exclude<NarrativeBeat, "ending">;
  openedAge: number;
  lastTouchedAge: number;
  mainlineActId?: string;
  decisionCount?: number;
}

export interface NarrativeSceneClock {
  mode: "advance" | "hold";
  sameAgeTurnCount: number;
  maxSameAgeTurns: number;
}

/** One generated opening passage plus the compact facts that remain in model context. */
export interface NarrativeOriginProfile {
  summary: string;
  seedHints: string[];
}

export interface NarrativeOpeningState {
  status: "pending" | "ready";
  profile?: NarrativeOriginProfile;
}

/** Immutable proof that a concrete scene, rather than merely a route label, was completed. */
export interface CompletedNarrativeScene {
  id: string;
  experienceId?: string;
  threadId: string;
  mainlineActId?: string;
  openedAge: number;
  resolvedAge: number;
  decisionCount: number;
}

export interface NarrativeRunState {
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  enabled: boolean;
  opening?: NarrativeOpeningState;
  arcPhase: NarrativeArcPhase;
  climaxCount: number;
  payoffCount: number;
  threads: NarrativeThreadState[];
  routeProgress: NarrativeRouteProgress[];
  /** Global act beat. routeProgress is retained only to read old snapshots. */
  actRuntime?: NarrativeActRuntime;
  dynamicCharacters: NarrativeDynamicCharacter[];
  memoryEntries: NarrativeMemoryEntry[];
  components: NarrativeComponentRunState[];
  activeCharacterIds: string[];
  scene: NarrativeSceneState;
  activeScene?: ActiveNarrativeScene;
  sceneClock: NarrativeSceneClock;
  completedScenes: CompletedNarrativeScene[];
  activeMainlineActId?: string;
  lastResolvedSceneAge?: number;
  endingState: NarrativeEndingState;
  endingBlueprintId?: string;
  endingPolarity?: EndingPolarity;
  endingScore?: number;
  setbackCount: number;
  statTierConfig?: NarrativeStatTierConfig;
  /** Snapshot of world-owned player-facing tier wording for this run. */
  statTierPresentation?: NarrativeStatTierPresentation;
}

export interface StoryCompletenessBuffer {
  origin: number;
  accumulation: number;
  pressure: number;
  turn: number;
  resolution: number;
}

export interface StoryContract {
  version: 1;
  worldId: WorldId;
  mainlineId: string;
  initialDirectionId?: string;
  coreThreadIds: string[];
}

export interface StoryFactRecord extends StoryFactDefinition {
  status: StoryFactStatus;
  introducedAge: number;
  lastTouchedAge: number;
  sourceEventId: string;
  resolvedAge?: number;
  resolution?: NarrativeFactResolution;
  resolutionSummary?: string;
}

export interface StoryFactLedger {
  version: 1;
  facts: StoryFactRecord[];
  openQuestion: string[];
  stakes: string[];
  commitment: string[];
  cost: string[];
  relationshipChange: string[];
  resolvedFactIds: string[];
  blockedFactIds: string[];
}

export interface StoryDirectorState {
  contract: StoryContract;
  seenEventIds: string[];
  cooldowns: Record<string, number>;
  flags: string[];
  openThreads: string[];
  resolvedThreadIds: string[];
  factionTension: Record<string, number>;
  /** Current foreground experience; activeDirectionId remains for old saves. */
  foregroundExperienceId?: string;
  /** The first experience that reaches payoff; it determines ending texture. */
  closureExperienceId?: string;
  activeDirectionId?: string;
  committedDirectionIds: string[];
  lastDirectionCommitAge?: number;
  activeFocusTag?: string;
  lastStoryPosition?: EventStoryPosition;
  completeness: StoryCompletenessBuffer;
  /** Engine-owned completion latch. Stats decide ending quality after this is true. */
  mainlineCompleted?: boolean;
  mainlineCompletedAge?: number;
  closureEligible: boolean;
  closureState: StoryClosureState;
  blockedFlags: string[];
  factLedger?: StoryFactLedger;
}

export interface AgeThreshold {
  id: AgeStageId;
  label: string;
  min: number;
  max: number;
}

export interface WorldConfig {
  id: WorldId;
  name: string;
  intro: string;
  stylePrompt: string;
  milestoneAges?: number[];
  endAgeRange: {
    min: number;
    max: number;
  };
  yearlyEventHints: string[];
  ageThresholds?: AgeThreshold[];
}

export interface GameplayTuning {
  bootstrap: {
    talentPointMin: number;
    talentPointMax: number;
    selectedCardMin: number;
    selectedCardMax: number;
  };
  pacing: {
    maxYearsPerChunk: number;
    specialYearChance: number;
    blankYearChance: number;
  };
  milestone: {
    minEligibleAge: number;
    guaranteeYears: number;
    triggerRateByStage: AgeStageRateMap;
  };
  stage: {
    deltaCapByStage: AgeStageIntMap;
    lightBandRatio: number;
    mediumBandRatio: number;
    overallExtremeRatio: number;
  };
  growth: {
    baseGrowthChance: number;
    baseDecayChance: number;
    decayVolatilityFactor: number;
    growthChanceClampMin: number;
    growthChanceClampMax: number;
    decayChanceClampMin: number;
    decayChanceClampMax: number;
    decayBranchFactor: number;
    specialPositiveBaseChance: number;
    specialPositiveGrowthBiasFactor: number;
  };
  decision: {
    profiles: Record<
      DecisionType,
      {
        successRate: number;
        gain: number;
        loss: number;
        deathBonus: number;
        risk: number;
        reward: number;
      }
    >;
    successRateVolatilityFactor: number;
    successRateClampMin: number;
    successRateClampMax: number;
    gainClampMin: number;
    gainClampMax: number;
    lossClampMin: number;
    lossClampMax: number;
    secondarySuccessDelta: number;
    secondaryFailureDelta: number;
  };
  death: {
    minAge: number;
    negativeStreakTrigger: number;
    lowPhysiqueThreshold: number;
    physiqueBaseRisk: number;
    physiqueMissingRiskFactor: number;
    physiqueRiskClampMin: number;
    physiqueRiskClampMax: number;
    longNegativeBaseRisk: number;
    longNegativeValueFactor: number;
    longNegativeStreakDivisor: number;
    longNegativeStreakFactor: number;
    longNegativeRiskClampMin: number;
    longNegativeRiskClampMax: number;
    finalRiskClampMin: number;
    finalRiskClampMax: number;
  };
  ascension: {
    deterministicStatThreshold: number;
    chanceA: number;
    chanceB: number;
    chanceC: number;
    highStatsThresholdA: number;
    highStatsThresholdC: number;
    fortuneThresholdA: number;
    legendaryCountThresholdB: number;
    intelligenceThresholdB: number;
  };
  fame: {
    intelligenceWeight: number;
    charismaWeight: number;
    familyWeight: number;
    fortuneWeight: number;
    physiqueWeight: number;
    maxStatValue: number;
    mainlineActBonus: number;
    stableChoiceBonus: number;
    balancedChoiceBonus: number;
    riskyBreakthroughBonus: number;
    riskySetbackPenalty: number;
    min: number;
    max: number;
  };
  ending: {
    greatScore: number;
    goodScore: number;
    normalScore: number;
    narrativeNormalScore: number;
    narrativeGoodScore: number;
    narrativeFameWeight: number;
  };
}

export interface StartAllocationConfig {
  talentPointMin: number;
  talentPointMax: number;
  selectedCardMin: number;
  selectedCardMax: number;
}

export function createDefaultGameplayTuning(): GameplayTuning {
  return {
    bootstrap: {
      talentPointMin: 25,
      talentPointMax: 35,
      selectedCardMin: 1,
      selectedCardMax: 3
    },
    pacing: {
      maxYearsPerChunk: 2,
      specialYearChance: 0.18,
      blankYearChance: 0.22
    },
    milestone: {
      minEligibleAge: 5,
      guaranteeYears: 20,
      triggerRateByStage: {
        child: 0.05,
        youth: 0.1,
        prime: 0.15,
        middle: 0.15,
        elder: 0.15
      }
    },
    stage: {
      deltaCapByStage: {
        child: 2,
        youth: 4,
        prime: 6,
        middle: 8,
        elder: 8
      },
      lightBandRatio: 0.34,
      mediumBandRatio: 0.67,
      overallExtremeRatio: 0.75
    },
    growth: {
      baseGrowthChance: 0.28,
      baseDecayChance: 0.15,
      decayVolatilityFactor: 0.85,
      growthChanceClampMin: 0.06,
      growthChanceClampMax: 0.86,
      decayChanceClampMin: 0.05,
      decayChanceClampMax: 0.82,
      decayBranchFactor: 0.6,
      specialPositiveBaseChance: 0.55,
      specialPositiveGrowthBiasFactor: 0.5
    },
    decision: {
      profiles: {
        safe: {
          successRate: 0.86,
          gain: 2,
          loss: -1,
          deathBonus: 0,
          risk: 0.2,
          reward: 0.4
        },
        balanced: {
          successRate: 0.66,
          gain: 4,
          loss: -2,
          deathBonus: 0.05,
          risk: 0.45,
          reward: 0.65
        },
        risky: {
          successRate: 0.48,
          gain: 7,
          loss: -4,
          deathBonus: 0.12,
          risk: 0.75,
          reward: 0.95
        }
      },
      successRateVolatilityFactor: 0.2,
      successRateClampMin: 0.2,
      successRateClampMax: 0.9,
      gainClampMin: 1,
      gainClampMax: 4,
      lossClampMin: -4,
      lossClampMax: -1,
      secondarySuccessDelta: 1,
      secondaryFailureDelta: -1
    },
    death: {
      minAge: 14,
      negativeStreakTrigger: 4,
      lowPhysiqueThreshold: 3,
      physiqueBaseRisk: 0.08,
      physiqueMissingRiskFactor: 0.22,
      physiqueRiskClampMin: 0.08,
      physiqueRiskClampMax: 0.7,
      longNegativeBaseRisk: 0.03,
      longNegativeValueFactor: 0.2,
      longNegativeStreakDivisor: 6,
      longNegativeStreakFactor: 0.16,
      longNegativeRiskClampMin: 0.03,
      longNegativeRiskClampMax: 0.72,
      finalRiskClampMin: 0.01,
      finalRiskClampMax: 0.85
    },
    ascension: {
      deterministicStatThreshold: 50,
      chanceA: 0.02,
      chanceB: 0.02,
      chanceC: 0.02,
      highStatsThresholdA: 3,
      highStatsThresholdC: 3,
      fortuneThresholdA: 45,
      legendaryCountThresholdB: 1,
      intelligenceThresholdB: 40
    },
    fame: {
      intelligenceWeight: 1,
      charismaWeight: 1,
      familyWeight: 0,
      fortuneWeight: 1,
      physiqueWeight: 1,
      maxStatValue: 100,
      mainlineActBonus: 8,
      stableChoiceBonus: 0.75,
      balancedChoiceBonus: 1,
      riskyBreakthroughBonus: 2.5,
      riskySetbackPenalty: 2,
      min: 0,
      max: 100
    },
    ending: {
      greatScore: 34,
      goodScore: 27,
      normalScore: 20,
      narrativeNormalScore: 15,
      narrativeGoodScore: 21,
      narrativeFameWeight: 0.05
    }
  };
}

export interface DifficultyConfig {
  id: string;
  name: string;
  yearlyVolatility: number;
  growthBias: number;
  riskRewardMultiplier: number;
  failurePenaltyMultiplier: number;
  description: string;
}

export interface StartRunRequest {
  clientId: string;
  worldId: WorldId;
  difficultyId: string;
  personaPrompt: string;
  stats: Stats;
  talentPointTotal: number;
  selectedCardIds: string[];
}

export interface StepRunRequest {
  runId: string;
  action?: StepAction;
  growthFocusId?: string;
  // This is a public, opaque option token. The engine resolves it to the internal decision profile.
  decision?: string;
  decisionAge?: number;
  sceneId?: string;
  sceneRevision?: number;
  survivalChoice?: SurvivalChoice;
  survivalCrisisId?: string;
  requestId?: string;
}

export interface YearEvent {
  age: number;
  title: string;
  summary: string;
  statChanges: Partial<Record<StatKey, number>>;
  tags: string[];
}

export interface MilestoneChoice {
  age: number;
  background?: string;
  options: Array<{
    id: DecisionType;
    label: string;
    risk: number;
    reward: number;
    description: string;
  }>;
}

export interface AscensionState {
  unlocked: boolean;
  type?: "immortality" | "rejuvenation" | "eternal_youth";
  title?: string;
  description?: string;
  unlockedAge?: number;
}

export interface TimelineEntry {
  ageFrom?: number;
  age: number;
  ageStage: AgeThreshold;
  title: string;
  narrative: string;
  tags: string[];
  statChanges: Partial<Record<StatKey, number>>;
  sourceEventCount?: number;
}

export interface PublicAgeStage {
  label: string;
}

export interface PublicBackgroundCard {
  id: string;
  name: string;
  rarity: CardRarity;
  description: string;
  modifiers: Partial<Record<StatKey, number>>;
}

export interface PublicItemInstance {
  id: string;
  name: string;
  rarity: CardRarity;
  description: string;
  obtainedAge: number;
}

export type TimelinePresentationKind = "origin" | "passage" | "scene" | "choice_outcome";

export interface PublicTimelineEntry {
  entryId: string;
  ageFrom?: number;
  age: number;
  ageStage: PublicAgeStage;
  kind: TimelinePresentationKind;
  narrative: string;
  statChanges: Partial<Record<StatKey, number>>;
}

/** The sole public record of a committed story turn. */
export interface TurnRecord {
  turnId: string;
  sequence: number;
  kind: TimelinePresentationKind;
  ageFrom?: number;
  age: number;
  ageStage: PublicAgeStage;
  narrative: string;
  statChanges: Partial<Record<StatKey, number>>;
  statsSnapshot: Stats;
  itemsSnapshot: PublicItemInstance[];
  narrativeCharactersSnapshot?: PublicNarrativeCharacter[];
  fameSnapshot: number;
  choice?: PublicMilestoneChoice;
  choiceOutcome?: {
    optionId: string;
    label: string;
    description: string;
  };
  createdAt: number;
}

export interface PublicMilestoneChoice {
  sceneId: string;
  revision: number;
  age: number;
  background?: string;
  options: Array<{
    id: string;
    label: string;
    description: string;
  }>;
}

export interface PublicNarrativeCharacter {
  id: string;
  name: string;
  role: string;
  description: string;
  introducedAge: number;
}

export interface PublicSurvivalCrisis {
  id: string;
  age: number;
  stageLabel: string;
  summary: string;
  dangerBelowPhysique: number;
  choices: Array<{
    id: SurvivalChoice;
    label: string;
    description: string;
    stat: StatKey;
    tier: NarrativeStatTier;
    guaranteed: boolean;
  }>;
}

export interface PublicRunState {
  runId: string;
  worldId: WorldId;
  difficultyId: string;
  age: number;
  ageStage: PublicAgeStage;
  personaPrompt: string;
  stats: Stats;
  statTiers?: Record<StatKey, NarrativeStatTier>;
  statTierLabels?: Record<StatKey, string>;
  growthFocus?: {
    selectedId?: string;
    options: Array<Pick<NarrativeGrowthFocusDefinition, "id" | "label" | "description">>;
  };
  opening?: {
    status: NarrativeOpeningState["status"];
  };
  cards: PublicBackgroundCard[];
  items: PublicItemInstance[];
  narrativeCharacters?: PublicNarrativeCharacter[];
  /** Compatibility projection of the latest unresolved TurnRecord choice. */
  nextMilestoneChoice?: PublicMilestoneChoice;
  survivalCrisis?: PublicSurvivalCrisis;
  ended: boolean;
  endingSummary?: string;
  ascension: AscensionState;
  fame: number;
  outcome: "ongoing" | "dead" | "ascended" | "completed";
  phase?: RunPhase;
  bufferSize?: number;
  revealedAge?: number;
  revealedCount?: number;
}

export interface PublicWorldOption {
  id: WorldId;
  name: string;
  intro: string;
}

export interface PublicDifficultyOption {
  id: string;
  name: string;
  description: string;
}

export interface RunState {
  runId: string;
  worldId: WorldId;
  difficultyId: string;
  age: number;
  ageStage: AgeThreshold;
  personaPrompt: string;
  stats: Stats;
  cards: BackgroundCard[];
  items: ItemInstance[];
  history: YearEvent[];
  timelineChunk?: TimelineEntry[];
  nextMilestoneChoice?: MilestoneChoice;
  ended: boolean;
  endingSummary?: string;
  ascension: AscensionState;
  fame: number;
  outcome: "ongoing" | "dead" | "ascended" | "completed";
  deathCause?: string;
  phase?: RunPhase;
  bufferSize?: number;
  revealedAge?: number;
  revealedCount?: number;
}

export interface StartRunResponse {
  run: PublicRunState;
  timelineChunk: PublicTimelineEntry[];
  turns?: TurnRecord[];
}

export interface StepRunResponse {
  run: PublicRunState;
  timelineChunk: PublicTimelineEntry[];
  turns?: TurnRecord[];
}

export interface SaveSlotSummary {
  id: string;
  title: string;
  worldId: WorldId;
  age: number;
  ended: boolean;
  updatedAt: number;
  kind: "manual" | "decision";
}

export interface CurrentGameRunResponse {
  run: PublicRunState | null;
  timeline: PublicTimelineEntry[];
  turns?: TurnRecord[];
  environmentReady: boolean;
}

export interface CreateSaveResponse {
  save: SaveSlotSummary;
  recoveryCode: string;
}

export type ModelUsageOperation =
  | "narrative"
  | "summary"
  | "continuation"
  | "director"
  | "planning"
  | "render"
  | "origin"
  | "background"
  | "scene"
  | "choice"
  | "decision"
  | "ending";

export type ModelUsageTransport = "chat" | "responses";

export interface ModelUsageTotals {
  requestCount: number;
  successCount: number;
  failureCount: number;
  cacheHitCount: number;
  reportedUsageCount: number;
  unreportedUsageCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
}

/**
 * Session-local aggregate of provider-reported usage. It intentionally excludes
 * credentials, prompts, generated text, provider balance, and price estimates.
 */
export interface ModelUsageEntry extends ModelUsageTotals {
  runId?: string;
  worldId?: string;
  model: string;
  transport: ModelUsageTransport;
  operation: ModelUsageOperation;
  updatedAt: number;
}

export interface ModelUsageSummary {
  updatedAt: number | null;
  totals: ModelUsageTotals;
  entries: ModelUsageEntry[];
}

export interface ProviderConfig {
  provider: "openai-compatible";
  baseUrl: string;
  model: string;
  apiPath: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  directorMode?: DirectorMode;
}

export interface ProviderLimits {
  temperature: { min: number; max: number };
  maxTokens: { min: number; max: number; note: string };
  timeoutMs: { min: number; max: number };
  apiPathOptions: string[];
}

export interface RuntimeConfig {
  runtimeMode: "cloud" | "local";
  cloud: ProviderConfig;
}

export interface AdminConfigPayload {
  runtime: RuntimeConfig;
}

export interface ContentBundle {
  worlds: WorldConfig[];
  cards: BackgroundCard[];
  difficulties: DifficultyConfig[];
  promptPack: Record<string, string>;
  gameplayTuning?: GameplayTuning;
}

export interface GameEnvConfigRequest {
  clientId: string;
  runtimeMode: "cloud" | "local";
  localApiKey?: string;
  localProviderConfig?: ProviderConfig;
}

export interface GameEnvConfigResponse {
  clientId: string;
  runtimeMode: "cloud" | "local";
  hasLocalApiKey: boolean;
  effectiveProvider: ProviderConfig;
  limits: ProviderLimits;
}

export interface AiMilestoneOptions {
  background: string;
  optionOverrides: Array<{
    id: DecisionType;
    label: string;
    description: string;
  }>;
}
