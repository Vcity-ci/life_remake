import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
function patch(prev, key, value) {
    return {
        ...prev,
        [key]: value
    };
}
export function ProviderConfigForm({ value, onChange, limits, compact }) {
    return (_jsxs("div", { className: compact ? "grid compact-grid" : "grid", children: [_jsxs("label", { children: ["Base URL", _jsx("input", { value: value.baseUrl, onChange: (e) => onChange(patch(value, "baseUrl", e.target.value)), placeholder: "https://api.openai.com/v1" })] }), _jsxs("label", { children: ["Model", _jsx("input", { value: value.model, onChange: (e) => onChange(patch(value, "model", e.target.value)), placeholder: "\u4EFB\u610F\u6A21\u578B\u540D" })] }), _jsxs("label", { children: ["API Path", _jsx("select", { value: value.apiPath, onChange: (e) => onChange(patch(value, "apiPath", e.target.value)), children: limits.apiPathOptions.map((opt) => (_jsx("option", { value: opt, children: opt }, opt))) })] }), _jsxs("label", { children: ["Temperature (", limits.temperature.min, " ~ ", limits.temperature.max, ")", _jsx("input", { type: "number", step: "0.1", min: limits.temperature.min, max: limits.temperature.max, value: value.temperature, onChange: (e) => onChange(patch(value, "temperature", Number(e.target.value))) })] }), _jsxs("label", { children: ["Max Tokens\uFF08\u56FA\u5B9A\u7531\u7CFB\u7EDF\u63A7\u5236\uFF09", _jsx("input", { type: "number", value: value.maxTokens, disabled: true, readOnly: true }), _jsx("small", { children: "\u6587\u672C\u957F\u5EA6\u7531\u63D0\u793A\u8BCD\u5DE5\u7A0B\u63A7\u5236\uFF0C\u4E0D\u5EFA\u8BAE\u5728\u9762\u677F\u4E2D\u8C03\u6574 token \u4E0A\u9650\u3002" })] }), _jsxs("label", { children: ["Timeout (ms) (", limits.timeoutMs.min, " ~ ", limits.timeoutMs.max, ")", _jsx("input", { type: "number", min: limits.timeoutMs.min, max: limits.timeoutMs.max, value: value.timeoutMs, onChange: (e) => onChange(patch(value, "timeoutMs", Number(e.target.value))) })] })] }));
}
