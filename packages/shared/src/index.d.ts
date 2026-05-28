export type WorldId = string;
export type StatKey = "intelligence" | "charisma" | "family" | "fortune" | "physique";
export type DecisionType = "safe" | "balanced" | "risky";
export type CardRarity = "common" | "rare" | "epic" | "legendary";
export type AgeStageId = "child" | "youth" | "prime" | "middle" | "elder";
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
    milestoneAges: number[];
    endAgeRange: {
        min: number;
        max: number;
    };
    yearlyEventHints: string[];
    ageThresholds?: AgeThreshold[];
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
    decision?: DecisionType;
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
    age: number;
    ageStage: AgeThreshold;
    title: string;
    narrative: string;
    tags: string[];
    statChanges: Partial<Record<StatKey, number>>;
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
    history: YearEvent[];
    timelineChunk?: TimelineEntry[];
    nextMilestoneChoice?: MilestoneChoice;
    ended: boolean;
    endingSummary?: string;
    ascension: AscensionState;
    fame: number;
    outcome: "ongoing" | "dead" | "ascended";
    deathCause?: string;
}
export interface StartRunResponse {
    run: RunState;
    timelineChunk: TimelineEntry[];
}
export interface StepRunResponse {
    run: RunState;
    timelineChunk: TimelineEntry[];
}
export interface ProviderConfig {
    provider: "openai-compatible";
    baseUrl: string;
    model: string;
    apiPath: string;
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
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
