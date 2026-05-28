import React from "react";
import type { ProviderConfig, ProviderLimits } from "@reroll/shared";

interface Props {
  value: ProviderConfig;
  onChange: (next: ProviderConfig) => void;
  limits: ProviderLimits;
  compact?: boolean;
}

function patch<T extends keyof ProviderConfig>(
  prev: ProviderConfig,
  key: T,
  value: ProviderConfig[T]
): ProviderConfig {
  return {
    ...prev,
    [key]: value
  };
}

export function ProviderConfigForm({ value, onChange, limits, compact }: Props): React.JSX.Element {
  return (
    <div className={compact ? "grid compact-grid" : "grid"}>
      <label>
        Base URL
        <input
          value={value.baseUrl}
          onChange={(e) => onChange(patch(value, "baseUrl", e.target.value))}
          placeholder="https://api.openai.com/v1"
        />
      </label>

      <label>
        Model
        <input
          value={value.model}
          onChange={(e) => onChange(patch(value, "model", e.target.value))}
          placeholder="任意模型名"
        />
      </label>

      <label>
        API Path
        <select
          value={value.apiPath}
          onChange={(e) => onChange(patch(value, "apiPath", e.target.value as ProviderConfig["apiPath"]))}
        >
          {limits.apiPathOptions.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </label>

      <label>
        Temperature ({limits.temperature.min} ~ {limits.temperature.max})
        <input
          type="number"
          step="0.1"
          min={limits.temperature.min}
          max={limits.temperature.max}
          value={value.temperature}
          onChange={(e) => onChange(patch(value, "temperature", Number(e.target.value)))}
        />
      </label>

      <label>
        Max Tokens（固定由系统控制）
        <input type="number" value={value.maxTokens} disabled readOnly />
        <small>文本长度由提示词工程控制，不建议在面板中调整 token 上限。</small>
      </label>

      <label>
        Timeout (ms) ({limits.timeoutMs.min} ~ {limits.timeoutMs.max})
        <input
          type="number"
          min={limits.timeoutMs.min}
          max={limits.timeoutMs.max}
          value={value.timeoutMs}
          onChange={(e) => onChange(patch(value, "timeoutMs", Number(e.target.value)))}
        />
      </label>
    </div>
  );
}
