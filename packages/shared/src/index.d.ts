export type WorldId = string;
export type StatKey = "intelligence" | "charisma" | "family" | "fortune" | "physique";
export type DecisionType = "safe" | "balanced" | "risky";
export type CardRarity = "common" | "rare" | "epic" | "legendary";
export type AgeStageId = "child" | "youth" | "prime" | "middle" | "elder";
export type StepAction = "consume" | "decide";
export type RunPhase = "generating" | "ready" | "waiting_decision" | "ended";
export type DirectorMode = "legacy" | "tool-fast" | "auto";
export type EventKind = "normal" | "milestone" | "any";
export type EventStoryRole = "daily" | "main" | "branch" | "milestone" | "closure";
export type EventStoryPosition = "origin" | "accumulation" | "pressure" | "turn" | "resolution";
export type StoryClosureState = "open" | "guiding" | "finished";
export type NarrativeBeat = "setup" | "escalation" | "pressure" | "climax" | "payoff" | "ending";
export type NarrativeArcPhase = "setup" | "rising" | "pressure" | "climax" | "aftermath" | "ending";
export type NarrativeThreadStatus = "seeded" | "escalating" | "climax" | "resolved";
export type EndingPolarity = "good" | "bad";
export type NarrativeEndingState = "open" | "eligible" | "locked" | "guiding" | "finished";
export type PassiveEffectType = "candidate_weight" | "negative_reduce" | "death_risk_reduce" | "reward_bonus" | "unlock_event";
export type StoryFactKind = "open_question" | "stake" | "commitment" | "cost" | "relationship_change";
export type StoryFactStatus = "open" | "resolved" | "blocked";
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
export interface BackgroundCard {
    id: string;
    name: string;
    rarity: CardRarity;
    description: string;
    modifiers: Partial<Record<StatKey, number>>;
    tags: string[];
    effects?: PassiveEffect[];
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
    maxAge: number;
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
    sceneHint?: string;
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
export interface NarrativeRouteProgression {
    directionId: string;
    gates?: Partial<Record<"opening" | "pressure" | "climax", NarrativeStatGate>>;
}
export interface NarrativeBackgroundPacing {
    minYears: number;
    maxYears: number;
    personalReflectionChance?: number;
}
export interface NarrativeCompletionRule {
    requireCommittedDirection?: boolean;
    requireDecisionConsequence?: boolean;
    requireClimax?: boolean;
    requirePayoff?: boolean;
    requireResolvedCoreFacts?: boolean;
    requireNoActiveScene?: boolean;
}
/** Reserved for a later age-stage decline/death rule; the engine does not enforce it yet. */
export interface NarrativeSurvivalRule {
    graceYears: number;
    stages: Array<{
        ageStageId: AgeStageId;
        minimums: Partial<Record<StatKey, number>>;
    }>;
}
export interface NarrativeWorldProgression {
    backgroundPacing: NarrativeBackgroundPacing;
    routes: NarrativeRouteProgression[];
    completion: NarrativeCompletionRule;
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
export interface NarrativeWorldDefinition {
    version: 1 | 2;
    worldId: WorldId;
    storyBible: string;
    styleRules: string[];
    mainlineSkeleton?: NarrativeMainlineSkeleton;
    progression?: NarrativeWorldProgression;
    routeArcs: Array<{
        directionId: string;
        summary: string;
        coreThreadIds: string[];
    }>;
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
}
export interface NarrativeRunState {
    version: 1 | 2;
    enabled: boolean;
    arcPhase: NarrativeArcPhase;
    climaxCount: number;
    payoffCount: number;
    threads: NarrativeThreadState[];
    components: NarrativeComponentRunState[];
    activeCharacterIds: string[];
    scene: NarrativeSceneState;
    activeScene?: ActiveNarrativeScene;
    lastResolvedSceneAge?: number;
    endingState: NarrativeEndingState;
    endingBlueprintId?: string;
    endingPolarity?: EndingPolarity;
    endingScore?: number;
    setbackCount: number;
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
        profiles: Record<DecisionType, {
            successRate: number;
            gain: number;
            loss: number;
            deathBonus: number;
            risk: number;
            reward: number;
        }>;
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
        min: number;
        max: number;
    };
    ending: {
        greatScore: number;
        goodScore: number;
        normalScore: number;
    };
}
export interface StartAllocationConfig {
    talentPointMin: number;
    talentPointMax: number;
    selectedCardMin: number;
    selectedCardMax: number;
}
export declare function createDefaultGameplayTuning(): GameplayTuning;
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
    decision?: string;
    decisionAge?: number;
    sceneId?: string;
    sceneRevision?: number;
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
export type TimelinePresentationKind = "passage" | "scene" | "choice_outcome";
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
export interface PublicRunState {
    runId: string;
    worldId: WorldId;
    difficultyId: string;
    age: number;
    ageStage: PublicAgeStage;
    personaPrompt: string;
    stats: Stats;
    cards: PublicBackgroundCard[];
    items: PublicItemInstance[];
    /** Compatibility projection of the latest unresolved TurnRecord choice. */
    nextMilestoneChoice?: PublicMilestoneChoice;
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
    temperature: {
        min: number;
        max: number;
    };
    maxTokens: {
        min: number;
        max: number;
        note: string;
    };
    timeoutMs: {
        min: number;
        max: number;
    };
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
