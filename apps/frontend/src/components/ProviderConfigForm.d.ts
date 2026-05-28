import React from "react";
import type { ProviderConfig, ProviderLimits } from "@reroll/shared";
interface Props {
    value: ProviderConfig;
    onChange: (next: ProviderConfig) => void;
    limits: ProviderLimits;
    compact?: boolean;
}
export declare function ProviderConfigForm({ value, onChange, limits, compact }: Props): React.JSX.Element;
export {};
