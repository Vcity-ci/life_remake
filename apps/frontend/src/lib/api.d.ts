import type { AdminConfigPayload, ContentBundle, DecisionType, DifficultyConfig, GameEnvConfigResponse, ProviderConfig, ProviderLimits, RunState, StartAllocationConfig, StartRunResponse, StepRunResponse, WorldConfig, BackgroundCard } from "@reroll/shared";
export interface BootstrapPayload {
    deployMode: "local" | "cloud";
    worlds: WorldConfig[];
    difficulties: DifficultyConfig[];
    cardPool: BackgroundCard[];
    talentPointTotal: number;
    startAllocation: StartAllocationConfig;
    runtime: AdminConfigPayload["runtime"];
    limits: ProviderLimits;
}
export type GameStreamEvent = {
    type: "meta";
    data: {
        branch: "start" | "step";
        runId: string;
        rawChunkCount: number;
        fromAge: number;
        toAge: number;
        tuning: StartAllocationConfig;
    };
} | {
    type: "started";
    data: {
        run: RunState;
    };
} | {
    type: "timeline";
    data: {
        index: number;
        total: number;
        entry: NonNullable<RunState["timelineChunk"]>[number];
    };
} | {
    type: "milestone";
    data: NonNullable<RunState["nextMilestoneChoice"]>;
} | {
    type: "done";
    data: {
        run: RunState;
        timelineChunk: NonNullable<RunState["timelineChunk"]>;
    };
} | {
    type: "error";
    data: {
        message: string;
    };
};
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
export declare function startRunStream(payload: {
    clientId: string;
    worldId: string;
    difficultyId: string;
    personaPrompt: string;
    talentPointTotal: number;
    stats: RunState["stats"];
    selectedCardIds: string[];
}, onEvent: (event: GameStreamEvent) => void | Promise<void>): Promise<void>;
export declare function stepRunStream(payload: {
    runId: string;
    decision: DecisionType;
}, onEvent: (event: GameStreamEvent) => void | Promise<void>): Promise<void>;
