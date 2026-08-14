import type { AdminConfigPayload, ContentBundle, CreateSaveResponse, CurrentGameRunResponse, GameEnvConfigResponse, PublicBackgroundCard, PublicDifficultyOption, PublicRunState, PublicTimelineEntry, TurnRecord, PublicWorldOption, ProviderConfig, ProviderLimits, SaveSlotSummary, StepAction, StartAllocationConfig, StartRunResponse, StepRunResponse, Stats } from "@reroll/shared";
export declare class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string);
}
export interface BootstrapPayload {
    deployMode: "local" | "cloud";
    worlds: PublicWorldOption[];
    difficulties: PublicDifficultyOption[];
    cardPool: PublicBackgroundCard[];
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
        run: PublicRunState;
    };
} | {
    type: "turn";
    data: {
        index: number;
        total: number;
        record: TurnRecord;
    };
} | {
    type: "done";
    data: {
        run: PublicRunState;
        timelineChunk: PublicTimelineEntry[];
        turns?: TurnRecord[];
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
    stats: Stats;
    selectedCardIds: string[];
}): Promise<StartRunResponse>;
export declare function stepRun(payload: {
    runId: string;
    action?: StepAction;
    decision?: string;
    decisionAge?: number;
    sceneId?: string;
    sceneRevision?: number;
    requestId?: string;
}): Promise<StepRunResponse>;
export declare function startRunStream(payload: {
    clientId: string;
    worldId: string;
    difficultyId: string;
    personaPrompt: string;
    talentPointTotal: number;
    stats: Stats;
    selectedCardIds: string[];
}, onEvent: (event: GameStreamEvent) => void | Promise<void>): Promise<void>;
export declare function stepRunStream(payload: {
    runId: string;
    action?: StepAction;
    decision?: string;
    decisionAge?: number;
    sceneId?: string;
    sceneRevision?: number;
    requestId?: string;
}, onEvent: (event: GameStreamEvent) => void | Promise<void>): Promise<void>;
export declare function fetchCurrentRun(): Promise<CurrentGameRunResponse>;
export declare function fetchSaveSlots(): Promise<{
    saves: SaveSlotSummary[];
}>;
export declare function createSaveSlot(payload: {
    runId: string;
    title?: string;
}): Promise<CreateSaveResponse>;
export declare function restoreSaveSlot(saveId: string): Promise<CurrentGameRunResponse>;
export declare function recoverSaveSlot(recoveryCode: string): Promise<CurrentGameRunResponse>;
export declare function resetCurrentRun(): Promise<void>;
export declare function resetAnonymousGameData(): Promise<void>;
export declare function deleteSaveSlot(saveId: string): Promise<void>;
