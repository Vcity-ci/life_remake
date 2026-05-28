import type { AdminConfigPayload, ContentBundle, DecisionType, DifficultyConfig, GameEnvConfigResponse, ProviderConfig, ProviderLimits, RunState, StartRunResponse, StepRunResponse, WorldConfig, BackgroundCard } from "@reroll/shared";
export interface BootstrapPayload {
    deployMode: "local" | "cloud";
    worlds: WorldConfig[];
    difficulties: DifficultyConfig[];
    cardPool: BackgroundCard[];
    talentPointTotal: number;
    runtime: AdminConfigPayload["runtime"];
    limits: ProviderLimits;
}
export declare function fetchBootstrap(): Promise<BootstrapPayload>;
export declare function fetchAdminConfig(): Promise<{
    runtime: AdminConfigPayload["runtime"];
    limits: ProviderLimits;
}>;
export declare function saveAdminConfig(payload: AdminConfigPayload): Promise<{
    runtime: AdminConfigPayload["runtime"];
    limits: ProviderLimits;
}>;
export declare function fetchAdminContent(): Promise<ContentBundle>;
export declare function saveAdminContent(payload: ContentBundle): Promise<ContentBundle>;
export declare function saveGameEnvironment(payload: {
    clientId: string;
    localApiKey?: string;
    localProviderConfig?: ProviderConfig;
}): Promise<GameEnvConfigResponse>;
export declare function startRun(payload: {
    clientId: string;
    worldId: string;
    difficultyId: string;
    personaPrompt: string;
    talentPointTotal: number;
    stats: RunState["stats"];
    selectedCardIds: string[];
}): Promise<StartRunResponse>;
export declare function stepRun(payload: {
    runId: string;
    decision: DecisionType;
}): Promise<StepRunResponse>;
