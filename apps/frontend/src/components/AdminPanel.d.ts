import React from "react";
import type { ProviderConfig, ProviderLimits } from "@reroll/shared";
interface Props {
    onClose: () => void;
    bootstrap: {
        deployMode: "local" | "cloud";
        worlds: Array<{
            id: string;
            name: string;
            intro: string;
        }>;
        difficulties: Array<{
            id: string;
            name: string;
            description: string;
        }>;
        limits: ProviderLimits;
    };
    localApiKey: string;
    setLocalApiKey: (key: string) => void;
    localProvider: ProviderConfig;
    setLocalProvider: (cfg: ProviderConfig) => void;
    onConfirmEnvironment: () => Promise<void>;
    canConfirmEnv: boolean;
    envReady: boolean;
    worldId: string;
    setWorldId: (id: string) => void;
    difficultyId: string;
    setDifficultyId: (id: string) => void;
}
export declare function AdminPanel(props: Props): React.JSX.Element;
export {};
