import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { fetchAdminConfig, fetchAdminContent, fetchModelUsage, saveAdminConfig, saveAdminContent } from "../lib/api";
import { ProviderConfigForm } from "./ProviderConfigForm";
const defaultProvider = {
    provider: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    apiPath: "/chat/completions",
    temperature: 0.9,
    maxTokens: 1824,
    timeoutMs: 45000,
    reasoningEffort: "minimal"
};
function defaultContent() {
    return {
        worlds: [],
        cards: [],
        difficulties: [],
        promptPack: {
            systemCore: "",
            immersionRules: "",
            yearNormalRule: "",
            yearMinorRule: "",
            milestoneRule: "",
            storyConstraint: "",
            endingHint: ""
        }
    };
}
const usageOperationLabels = {
    narrative: "常规叙事",
    summary: "上下文摘要",
    continuation: "文本续写",
    director: "方向选择",
    planning: "剧情规划",
    render: "场景渲染",
    origin: "身世生成",
    background: "人生背景",
    scene: "场景推进",
    choice: "抉择生成",
    decision: "抉择后果",
    ending: "结局渲染"
};
function formatUsageNumber(value) {
    return new Intl.NumberFormat("zh-CN").format(value);
}
function formatUsageDuration(durationMs) {
    if (durationMs < 1000)
        return `${durationMs} ms`;
    return `${(durationMs / 1000).toFixed(1)} 秒`;
}
export function AdminPanel(props) {
    const { onClose, bootstrap, localApiKey, setLocalApiKey, localProvider, setLocalProvider, onConfirmEnvironment, canConfirmEnv, envReady, worldId, setWorldId } = props;
    const [tab, setTab] = useState("session");
    const [cloudProvider, setCloudProvider] = useState(defaultProvider);
    const [limits, setLimits] = useState(bootstrap.limits);
    const [content, setContent] = useState(defaultContent());
    const [modelUsage, setModelUsage] = useState(null);
    const [usageLoading, setUsageLoading] = useState(true);
    const [usageError, setUsageError] = useState("");
    const [status, setStatus] = useState("");
    const [loading, setLoading] = useState(true);
    const cloudLocked = bootstrap.deployMode === "cloud";
    useEffect(() => {
        async function init() {
            if (cloudLocked) {
                setLoading(false);
                return;
            }
            try {
                const [runtimeRsp, loadedContent] = await Promise.all([fetchAdminConfig(), fetchAdminContent()]);
                setCloudProvider(runtimeRsp.runtime.cloud);
                setLimits(runtimeRsp.limits);
                const normalizedContent = {
                    ...loadedContent,
                    promptPack: {
                        ...loadedContent.promptPack,
                        yearNormalRule: loadedContent.promptPack.yearNormalRule ?? "",
                        yearMinorRule: loadedContent.promptPack.yearMinorRule ?? "",
                        milestoneRule: loadedContent.promptPack.milestoneRule ?? "",
                        storyConstraint: loadedContent.promptPack.storyConstraint ?? "",
                        endingHint: loadedContent.promptPack.endingHint ?? ""
                    }
                };
                setContent(normalizedContent);
            }
            catch (error) {
                setStatus(`读取配置失败：${String(error)}`);
            }
            finally {
                setLoading(false);
            }
        }
        void init();
    }, [cloudLocked]);
    async function loadModelUsage() {
        setUsageLoading(true);
        setUsageError("");
        try {
            setModelUsage(await fetchModelUsage());
        }
        catch {
            setUsageError("暂时无法读取本会话的模型用量。");
        }
        finally {
            setUsageLoading(false);
        }
    }
    useEffect(() => {
        void loadModelUsage();
    }, []);
    useEffect(() => {
        if (cloudLocked && tab !== "session") {
            setTab("session");
        }
    }, [cloudLocked, tab]);
    const runtimePayload = useMemo(() => ({
        runtime: {
            runtimeMode: bootstrap.deployMode,
            cloud: cloudProvider
        }
    }), [bootstrap.deployMode, cloudProvider]);
    async function onSaveRuntime() {
        try {
            setStatus("保存模型配置中...");
            const saved = await saveAdminConfig(runtimePayload);
            setCloudProvider(saved.runtime.cloud);
            setLimits(saved.limits);
            setStatus("模型配置已保存。后续新开局生效。");
        }
        catch (error) {
            setStatus(`保存失败：${String(error)}`);
        }
    }
    async function onSaveContent() {
        try {
            setStatus("保存内容配置中...");
            const saved = await saveAdminContent(content);
            setContent(saved);
            setStatus("内容配置已保存并备份到 storage/backups。新开局生效。");
        }
        catch (error) {
            setStatus(`保存失败：${String(error)}`);
        }
    }
    function patchWorld(index, patch) {
        setContent((prev) => {
            const next = [...prev.worlds];
            next[index] = { ...next[index], ...patch };
            return { ...prev, worlds: next };
        });
    }
    function patchCard(index, patch) {
        setContent((prev) => {
            const next = [...prev.cards];
            next[index] = { ...next[index], ...patch };
            return { ...prev, cards: next };
        });
    }
    function patchDifficulty(index, patch) {
        setContent((prev) => {
            const next = [...prev.difficulties];
            next[index] = { ...next[index], ...patch };
            return { ...prev, difficulties: next };
        });
    }
    function removeWorld(index) {
        setContent((prev) => ({ ...prev, worlds: prev.worlds.filter((_, i) => i !== index) }));
    }
    function removeCard(index) {
        setContent((prev) => ({ ...prev, cards: prev.cards.filter((_, i) => i !== index) }));
    }
    function removeDifficulty(index) {
        setContent((prev) => ({ ...prev, difficulties: prev.difficulties.filter((_, i) => i !== index) }));
    }
    function addWorld() {
        setContent((prev) => ({
            ...prev,
            worlds: [
                ...prev.worlds,
                {
                    id: `world_${Date.now()}`,
                    name: "新世界观",
                    intro: "简介",
                    stylePrompt: "叙事风格",
                    milestoneAges: [18, 25, 35],
                    endAgeRange: { min: 60, max: 85 },
                    yearlyEventHints: ["成长", "冲突", "转机"],
                    ageThresholds: [
                        { id: "child", label: "幼年", min: 0, max: 12 },
                        { id: "youth", label: "青年", min: 13, max: 29 },
                        { id: "prime", label: "壮年", min: 30, max: 44 },
                        { id: "middle", label: "中年", min: 45, max: 59 },
                        { id: "elder", label: "老年", min: 60, max: 120 }
                    ]
                }
            ]
        }));
    }
    function addCard() {
        setContent((prev) => ({
            ...prev,
            cards: [
                ...prev.cards,
                {
                    id: `card_${Date.now()}`,
                    name: "新卡牌",
                    rarity: "common",
                    description: "卡牌描述",
                    modifiers: { intelligence: 1 },
                    tags: ["custom"]
                }
            ]
        }));
    }
    function addDifficulty() {
        setContent((prev) => ({
            ...prev,
            difficulties: [
                ...prev.difficulties,
                {
                    id: `diff_${Date.now()}`,
                    name: "新难度",
                    yearlyVolatility: 0.35,
                    growthBias: 0,
                    riskRewardMultiplier: 1,
                    failurePenaltyMultiplier: 1,
                    description: "难度描述"
                }
            ]
        }));
    }
    if (loading) {
        return (_jsx("div", { className: "modal-mask", children: _jsx("div", { className: "modal", children: _jsx("p", { children: "Setting \u52A0\u8F7D\u4E2D..." }) }) }));
    }
    return (_jsx("div", { className: "modal-mask", children: _jsxs("div", { className: "modal admin-modal", children: [_jsx("h2", { children: "Setting \u63A7\u5236\u53F0" }), _jsxs("div", { className: "row admin-tabs", children: [_jsx("button", { className: tab === "session" ? "selected" : "ghost", onClick: () => setTab("session"), children: "\u4F1A\u8BDD\u914D\u7F6E" }), !cloudLocked ? (_jsx("button", { className: tab === "model" ? "selected" : "ghost", onClick: () => setTab("model"), children: "\u6A21\u578B\u914D\u7F6E" })) : null, !cloudLocked ? (_jsx("button", { className: tab === "content" ? "selected" : "ghost", onClick: () => setTab("content"), children: "\u5185\u5BB9\u914D\u7F6E" })) : null] }), tab === "session" ? (_jsxs("section", { children: [_jsx("p", { children: "\u672C\u5C40\u73AF\u5883\u4E0E\u73A9\u6CD5\u53C2\u6570\uFF08\u5148\u786E\u8BA4\u518D\u5F00\u5C40\uFF09" }), _jsxs("p", { children: ["\u5F53\u524D\u90E8\u7F72\u94FE\u8DEF\uFF1A", bootstrap.deployMode === "cloud" ? "云端体验站" : "本地部署"] }), bootstrap.deployMode === "local" ? (_jsxs(_Fragment, { children: [_jsxs("label", { children: ["\u672C\u5730 API Key", _jsx("input", { type: "password", value: localApiKey, onChange: (e) => setLocalApiKey(e.target.value), placeholder: "\u8F93\u5165\u4F60\u81EA\u5DF1\u7684 key\uFF08\u4EC5\u672C\u4F1A\u8BDD\uFF09" })] }), _jsx(ProviderConfigForm, { value: localProvider, onChange: setLocalProvider, limits: limits, compact: true })] })) : (_jsx("p", { children: "\u4E91\u7AEF\u6A21\u5F0F\u4E0B\u5C06\u4F7F\u7528\u670D\u52A1\u5668\u4FDD\u5B58\u7684\u6A21\u578B\u914D\u7F6E\u3002" })), _jsx("div", { className: "grid compact-grid", children: _jsxs("label", { children: ["\u4E16\u754C\u89C2", _jsx("select", { value: worldId, onChange: (e) => setWorldId(e.target.value), children: bootstrap.worlds.map((w) => (_jsx("option", { value: w.id, children: w.name }, w.id))) })] }) }), _jsxs("div", { className: "row", children: [_jsx("button", { disabled: !canConfirmEnv, onClick: () => void onConfirmEnvironment(), children: "\u786E\u8BA4\u672C\u5C40\u73AF\u5883" }), _jsx("small", { children: envReady ? "已确认" : "未确认" })] }), _jsxs("section", { className: "model-usage-panel", "aria-live": "polite", children: [_jsxs("div", { className: "row between model-usage-heading", children: [_jsxs("div", { children: [_jsx("h3", { children: "\u6A21\u578B\u7528\u91CF" }), _jsx("small", { children: "\u4EC5\u7EDF\u8BA1\u672C\u6D4F\u89C8\u5668\u4F1A\u8BDD\u4E2D\u670D\u52A1\u5546\u5DF2\u4E0A\u62A5\u7684 Token\uFF0C\u4E0D\u4F30\u7B97\u8D39\u7528\u6216\u8D26\u6237\u4F59\u989D\u3002" })] }), _jsx("button", { className: "ghost", disabled: usageLoading, onClick: () => void loadModelUsage(), children: usageLoading ? "读取中" : "刷新" })] }), usageError ? _jsx("p", { className: "model-usage-empty", children: usageError }) : null, !usageError && usageLoading && !modelUsage ? _jsx("p", { className: "model-usage-empty", children: "\u6B63\u5728\u8BFB\u53D6\u672C\u4F1A\u8BDD\u7528\u91CF..." }) : null, !usageError && !usageLoading && modelUsage?.entries.length === 0 ? _jsx("p", { className: "model-usage-empty", children: "\u5C1A\u65E0\u6A21\u578B\u8C03\u7528\u8BB0\u5F55\u3002" }) : null, modelUsage && modelUsage.entries.length > 0 ? (_jsxs(_Fragment, { children: [_jsxs("dl", { className: "model-usage-totals", children: [_jsxs("div", { children: [_jsx("dt", { children: "\u5B9E\u9645\u8BF7\u6C42" }), _jsx("dd", { children: formatUsageNumber(modelUsage.totals.requestCount) })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u5DF2\u4E0A\u62A5 Token" }), _jsx("dd", { children: formatUsageNumber(modelUsage.totals.totalTokens) })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u8F93\u5165 / \u8F93\u51FA" }), _jsxs("dd", { children: [formatUsageNumber(modelUsage.totals.inputTokens), " / ", formatUsageNumber(modelUsage.totals.outputTokens)] })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u672A\u4E0A\u62A5 / \u7F13\u5B58\u547D\u4E2D" }), _jsxs("dd", { children: [formatUsageNumber(modelUsage.totals.unreportedUsageCount), " / ", formatUsageNumber(modelUsage.totals.cacheHitCount)] })] })] }), _jsx("div", { className: "model-usage-list", children: modelUsage.entries.map((entry) => (_jsxs("div", { className: "model-usage-entry", children: [_jsxs("div", { children: [_jsx("strong", { children: usageOperationLabels[entry.operation] }), _jsxs("small", { children: [entry.model, " \u00B7 ", entry.transport === "responses" ? "Responses" : "Chat Completions"] })] }), _jsxs("small", { children: [entry.requestCount, " \u6B21\u8BF7\u6C42 \u00B7 ", entry.inputTokens, " / ", entry.outputTokens, " / ", entry.totalTokens, " Token \u00B7 ", formatUsageDuration(entry.durationMs), entry.failureCount ? ` · ${entry.failureCount} 次失败` : "", entry.unreportedUsageCount ? ` · ${entry.unreportedUsageCount} 次未上报` : "", entry.cacheHitCount ? ` · ${entry.cacheHitCount} 次缓存` : ""] })] }, `${entry.runId ?? "session"}-${entry.model}-${entry.transport}-${entry.operation}`))) })] })) : null] })] })) : null, !cloudLocked && tab === "model" ? (_jsxs("section", { children: [_jsx("p", { children: "\u5168\u5C40\u4E91\u7AEF\u6A21\u578B\u53C2\u6570\uFF08\u90E8\u7F72\u7EA7\uFF09" }), _jsx(ProviderConfigForm, { value: cloudProvider, onChange: setCloudProvider, limits: limits }), _jsx("div", { className: "row", children: _jsx("button", { onClick: () => void onSaveRuntime(), children: "\u4FDD\u5B58\u6A21\u578B\u914D\u7F6E" }) })] })) : null, !cloudLocked && tab === "content" ? (_jsxs("section", { children: [_jsxs("details", { open: true, children: [_jsx("summary", { children: "\u4E16\u754C\u89C2" }), _jsxs("div", { className: "row between", children: [_jsx("span", { children: "\u65B0\u589E/\u7F16\u8F91/\u5220\u9664" }), _jsx("button", { onClick: addWorld, children: "\u65B0\u589E" })] }), content.worlds.map((w, i) => (_jsxs("div", { className: "editor-card", children: [_jsxs("label", { children: ["ID", _jsx("input", { value: w.id, onChange: (e) => patchWorld(i, { id: e.target.value }) })] }), _jsxs("label", { children: ["\u540D\u79F0", _jsx("input", { value: w.name, onChange: (e) => patchWorld(i, { name: e.target.value }) })] }), _jsxs("label", { children: ["\u7B80\u4ECB", _jsx("textarea", { value: w.intro, onChange: (e) => patchWorld(i, { intro: e.target.value }) })] }), _jsxs("label", { children: ["\u98CE\u683C", _jsx("textarea", { value: w.stylePrompt, onChange: (e) => patchWorld(i, { stylePrompt: e.target.value }) })] }), _jsx("button", { className: "ghost", onClick: () => removeWorld(i), children: "\u5220\u9664" })] }, `${w.id}-${i}`)))] }), _jsxs("details", { children: [_jsx("summary", { children: "\u80FD\u529B\u5361" }), _jsxs("div", { className: "row between", children: [_jsx("span", { children: "\u65B0\u589E/\u7F16\u8F91/\u5220\u9664" }), _jsx("button", { onClick: addCard, children: "\u65B0\u589E" })] }), content.cards.map((card, i) => (_jsxs("div", { className: "editor-card", children: [_jsxs("label", { children: ["ID", _jsx("input", { value: card.id, onChange: (e) => patchCard(i, { id: e.target.value }) })] }), _jsxs("label", { children: ["\u540D\u79F0", _jsx("input", { value: card.name, onChange: (e) => patchCard(i, { name: e.target.value }) })] }), _jsxs("label", { children: ["\u63CF\u8FF0", _jsx("textarea", { value: card.description, onChange: (e) => patchCard(i, { description: e.target.value }) })] }), _jsx("button", { className: "ghost", onClick: () => removeCard(i), children: "\u5220\u9664" })] }, `${card.id}-${i}`)))] }), _jsxs("details", { children: [_jsx("summary", { children: "\u63D0\u793A\u8BCD\u5305" }), _jsxs("label", { children: ["systemCore", _jsx("textarea", { rows: 4, value: content.promptPack.systemCore ?? "", onChange: (e) => setContent((prev) => ({ ...prev, promptPack: { ...prev.promptPack, systemCore: e.target.value } })) })] }), _jsxs("label", { children: ["immersionRules", _jsx("textarea", { rows: 4, value: content.promptPack.immersionRules ?? "", onChange: (e) => setContent((prev) => ({ ...prev, promptPack: { ...prev.promptPack, immersionRules: e.target.value } })) })] }), _jsxs("label", { children: ["yearNormalRule", _jsx("textarea", { rows: 3, value: content.promptPack.yearNormalRule ?? "", onChange: (e) => setContent((prev) => ({ ...prev, promptPack: { ...prev.promptPack, yearNormalRule: e.target.value } })) })] }), _jsxs("label", { children: ["yearMinorRule", _jsx("textarea", { rows: 3, value: content.promptPack.yearMinorRule ?? "", onChange: (e) => setContent((prev) => ({ ...prev, promptPack: { ...prev.promptPack, yearMinorRule: e.target.value } })) })] }), _jsxs("label", { children: ["milestoneRule", _jsx("textarea", { rows: 3, value: content.promptPack.milestoneRule ?? "", onChange: (e) => setContent((prev) => ({ ...prev, promptPack: { ...prev.promptPack, milestoneRule: e.target.value } })) })] }), _jsxs("label", { children: ["storyConstraint", _jsx("textarea", { rows: 3, value: content.promptPack.storyConstraint ?? "", onChange: (e) => setContent((prev) => ({ ...prev, promptPack: { ...prev.promptPack, storyConstraint: e.target.value } })) })] }), _jsxs("label", { children: ["endingHint", _jsx("textarea", { rows: 3, value: content.promptPack.endingHint ?? "", onChange: (e) => setContent((prev) => ({ ...prev, promptPack: { ...prev.promptPack, endingHint: e.target.value } })) })] })] }), _jsx("div", { className: "row", children: _jsx("button", { onClick: () => void onSaveContent(), children: "\u4FDD\u5B58\u5185\u5BB9\u914D\u7F6E" }) })] })) : null, _jsx("div", { className: "row", children: _jsx("button", { className: "ghost", onClick: onClose, children: "\u5173\u95ED" }) }), status ? _jsx("p", { className: "status", children: status }) : null] }) }));
}
