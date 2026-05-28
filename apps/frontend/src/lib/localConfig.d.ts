import type { ProviderConfig } from "@reroll/shared";
export declare function readLocalProviderConfig(): ProviderConfig | null;
export declare function writeLocalProviderConfig(config: ProviderConfig): void;
export declare function getOrCreateClientId(): string;
