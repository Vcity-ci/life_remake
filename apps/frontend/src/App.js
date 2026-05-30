import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdminPanel } from "./components/AdminPanel";
import { fetchBootstrap, saveGameEnvironment, startRunStream, stepRunStream } from "./lib/api";
import { getOrCreateClientId, readLocalProviderConfig, writeLocalProviderConfig } from "./lib/localConfig";
const statLabels = {
    intelligence: "智力",
    charisma: "魅力",
    family: "家境",
    fortune: "气运",
    physique: "体魄"
};
const statIcons = {
    intelligence: "🧠",
    charisma: "✨",
    family: "🏠",
    fortune: "🍀",
    physique: "💪"
};
const defaultStats = {
    intelligence: 0,
    charisma: 0,
    family: 0,
    fortune: 0,
    physique: 0
};
function rarityClass(r) {
    return `rarity-${r}`;
}
function timelineKey(t) {
    return `${t.age}-${t.title}-${t.narrative}`;
}
function formatDeltaLabel(stat, delta) {
    const name = statLabels[stat];
    const sign = delta > 0 ? "+" : "";
    return `${name}${sign}${delta}`;
}
function extractDeltaLabels(entry) {
    const keys = ["intelligence", "charisma", "physique", "family", "fortune"];
    const labels = [];
    for (const key of keys) {
        const delta = entry.statChanges[key] ?? 0;
        if (delta !== 0) {
            labels.push(formatDeltaLabel(key, delta));
        }
    }
    return labels;
}
function fameTitle(fame) {
    if (fame < 20)
        return "无名之辈";
    if (fame < 40)
        return "小有名气";
    if (fame < 60)
        return "声名鹊起";
    if (fame < 80)
        return "名动一方";
    return "举世传奇";
}
function outcomeLabel(outcome) {
    if (outcome === "dead")
        return "死亡";
    if (outcome === "ascended")
        return "飞升";
    return "终局";
}
function endingBadgeText(run) {
    if (run.outcome === "dead")
        return "命数已尽";
    if (run.outcome === "ascended")
        return run.ascension.title?.trim() || "超凡飞升";
    return "尘世落幕";
}
export default function App() {
    const [bootstrap, setBootstrap] = useState(null);
    const [runtimeMode, setRuntimeMode] = useState("local");
    const [worldId, setWorldId] = useState("modern");
    const [difficultyId, setDifficultyId] = useState("standard");
    const [personaPrompt, setPersonaPrompt] = useState("");
    const [selectedCards, setSelectedCards] = useState([]);
    const [stats, setStats] = useState(defaultStats);
    const [run, setRun] = useState(null);
    const [status, setStatus] = useState("初始化中...");
    const [showSettings, setShowSettings] = useState(false);
    const [envReady, setEnvReady] = useState(false);
    const [timeline, setTimeline] = useState([]);
    const [decisionHistory, setDecisionHistory] = useState([]);
    const [showEndingModal, setShowEndingModal] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const timelineRef = useRef(null);
    const pendingDecisionRef = useRef(null);
    const [flippedCards, setFlippedCards] = useState({});
    const [localApiKey, setLocalApiKey] = useState("");
    const [localProvider, setLocalProvider] = useState({
        provider: "openai-compatible",
        baseUrl: "https://api.openai.com/v1",
        model: "",
        apiPath: "/chat/completions",
        temperature: 0.9,
        maxTokens: 1024,
        timeoutMs: 45000
    });
    const clientId = useMemo(() => getOrCreateClientId(), []);
    useEffect(() => {
        async function init() {
            try {
                const boot = await fetchBootstrap();
                setBootstrap(boot);
                setRuntimeMode(boot.deployMode);
                setWorldId(boot.worlds[0]?.id ?? "modern");
                setDifficultyId(boot.difficulties[0]?.id ?? "standard");
                const localCfg = readLocalProviderConfig();
                if (localCfg)
                    setLocalProvider(localCfg);
                else
                    setLocalProvider(boot.runtime.cloud);
                setStatus("请先在 Setting 确认本局环境，然后开始人生。");
            }
            catch (error) {
                setStatus(`初始化失败：${String(error)}`);
            }
        }
        void init();
    }, []);
    useEffect(() => {
        writeLocalProviderConfig(localProvider);
    }, [localProvider]);
    useEffect(() => {
        if (!timelineRef.current)
            return;
        timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }, [timeline]);
    const canConfirmEnv = useMemo(() => {
        if (!bootstrap)
            return false;
        if (bootstrap.deployMode === "local") {
            if (!localApiKey.trim())
                return false;
            if (!localProvider.model.trim() || !localProvider.baseUrl.trim())
                return false;
        }
        return true;
    }, [bootstrap, localApiKey, localProvider]);
    useEffect(() => {
        if (bootstrap) {
            setRuntimeMode(bootstrap.deployMode);
        }
    }, [bootstrap]);
    const canStart = useMemo(() => {
        if (!bootstrap || !envReady)
            return false;
        if (personaPrompt.trim().length < 4)
            return false;
        const allocated = stats.intelligence + stats.charisma + stats.physique + stats.family + stats.fortune;
        if (allocated < bootstrap.startAllocation.talentPointMin || allocated > bootstrap.startAllocation.talentPointMax)
            return false;
        if (allocated !== bootstrap.talentPointTotal)
            return false;
        if (selectedCards.length < bootstrap.startAllocation.selectedCardMin ||
            selectedCards.length > bootstrap.startAllocation.selectedCardMax)
            return false;
        return true;
    }, [bootstrap, envReady, personaPrompt, selectedCards, stats]);
    const usedTalentPoints = useMemo(() => stats.intelligence + stats.charisma + stats.physique + stats.family + stats.fortune, [stats]);
    const remainingTalentPoints = useMemo(() => (bootstrap ? Math.max(0, bootstrap.talentPointTotal - usedTalentPoints) : 0), [bootstrap, usedTalentPoints]);
    function changeStat(key, delta) {
        setStats((prev) => {
            const next = { ...prev };
            if (delta > 0) {
                const allocated = prev.intelligence + prev.charisma + prev.physique + prev.family + prev.fortune;
                const total = bootstrap?.talentPointTotal ?? 0;
                if (allocated >= total)
                    return prev;
            }
            const candidate = Math.max(0, Math.min(10, next[key] + delta));
            if (candidate === next[key])
                return prev;
            next[key] = candidate;
            return next;
        });
    }
    function toggleCard(id) {
        setSelectedCards((prev) => {
            const maxCards = bootstrap?.startAllocation.selectedCardMax ?? 3;
            if (prev.includes(id))
                return prev.filter((x) => x !== id);
            if (prev.length >= maxCards)
                return prev;
            return [...prev, id];
        });
    }
    function flipCard(id) {
        setFlippedCards((prev) => ({ ...prev, [id]: true }));
    }
    async function onConfirmEnvironment() {
        if (!bootstrap)
            return;
        try {
            setStatus("保存本局环境配置...");
            const rsp = await saveGameEnvironment({
                clientId,
                localApiKey: runtimeMode === "local" ? localApiKey : undefined,
                localProviderConfig: runtimeMode === "local" ? localProvider : undefined
            });
            setEnvReady(true);
            setStatus(`本局环境已确认。`);
            setShowSettings(false);
        }
        catch (error) {
            setEnvReady(false);
            setStatus(`环境配置失败：${String(error)}`);
        }
    }
    async function onStart() {
        if (!bootstrap)
            return;
        if (isStreaming)
            return;
        try {
            setIsStreaming(true);
            setStatus("人生推进中...");
            await startRunStream({
                clientId,
                worldId,
                difficultyId,
                personaPrompt,
                talentPointTotal: bootstrap.talentPointTotal,
                stats,
                selectedCardIds: selectedCards
            }, async (event) => {
                if (event.type === "meta") {
                    setStatus("本局调参已同步，继续推进叙事...");
                    return;
                }
                if (event.type === "started") {
                    setRun(event.data.run);
                    setTimeline([]);
                    setDecisionHistory([]);
                    pendingDecisionRef.current = null;
                    setStatus("角色已开局，正在生成年份叙事...");
                    return;
                }
                if (event.type === "timeline") {
                    setTimeline((prev) => [...prev, event.data.entry]);
                    setStatus(`生成年份叙事中...(${event.data.index + 1}/${event.data.total})`);
                    return;
                }
                if (event.type === "milestone") {
                    setRun((prev) => prev ? { ...prev, nextMilestoneChoice: event.data } : prev);
                    setStatus("新的抉择出现。");
                    return;
                }
                if (event.type === "done") {
                    setRun(event.data.run);
                    if (event.data.run.ended) {
                        setStatus("本局结束。");
                        setShowEndingModal(true);
                    }
                    else if (event.data.run.nextMilestoneChoice) {
                        setStatus("岁月流逝中，新的抉择正在逼近。");
                    }
                    else {
                        setStatus("年份推进完成，继续推进。");
                    }
                    return;
                }
                if (event.type === "error") {
                    throw new Error(event.data.message);
                }
            });
        }
        catch (error) {
            setStatus(`开局失败：${String(error)}`);
        }
        finally {
            setIsStreaming(false);
        }
    }
    async function onAdvance() {
        if (!run)
            return;
        if (isStreaming)
            return;
        try {
            setIsStreaming(true);
            setStatus("继续推进年份中...");
            await stepRunStream({ runId: run.runId, decision: "balanced" }, async (event) => {
                if (event.type === "meta") {
                    return;
                }
                if (event.type === "timeline") {
                    setTimeline((prev) => [...prev, event.data.entry]);
                    setStatus(`生成年份叙事中...(${event.data.index + 1}/${event.data.total})`);
                    return;
                }
                if (event.type === "milestone") {
                    setRun((prev) => prev ? { ...prev, nextMilestoneChoice: event.data } : prev);
                    setStatus("新的抉择出现。");
                    return;
                }
                if (event.type === "done") {
                    setRun(event.data.run);
                    if (event.data.run.ended) {
                        setStatus("本局结束。");
                        setShowEndingModal(true);
                    }
                    else if (event.data.run.nextMilestoneChoice) {
                        setStatus("新的抉择出现。");
                    }
                    else {
                        setStatus("年份推进完成，继续推进。");
                    }
                    return;
                }
                if (event.type === "error") {
                    throw new Error(event.data.message);
                }
            });
        }
        catch (error) {
            setStatus(`推进失败：${String(error)}`);
        }
        finally {
            setIsStreaming(false);
        }
    }
    async function onDecision(decision) {
        if (!run)
            return;
        if (isStreaming)
            return;
        const choice = run.nextMilestoneChoice?.options.find((opt) => opt.id === decision);
        if (run.nextMilestoneChoice && choice) {
            pendingDecisionRef.current = {
                age: run.age,
                ageStageLabel: run.ageStage.label,
                background: run.nextMilestoneChoice?.background ?? "",
                choiceId: decision,
                choiceLabel: choice.label,
                choiceDescription: choice.description
            };
        }
        else {
            pendingDecisionRef.current = null;
        }
        try {
            setIsStreaming(true);
            setStatus("命运流转中...");
            await stepRunStream({ runId: run.runId, decision }, async (event) => {
                if (event.type === "meta") {
                    return;
                }
                if (event.type === "timeline") {
                    setTimeline((prev) => [...prev, event.data.entry]);
                    const pending = pendingDecisionRef.current;
                    if (pending && event.data.entry.tags.includes("milestone")) {
                        setDecisionHistory((prev) => ([
                            ...prev,
                            {
                                id: `${run.runId}-${pending.age}-${pending.choiceId}-${prev.length}`,
                                age: pending.age,
                                ageStageLabel: pending.ageStageLabel,
                                background: pending.background,
                                choiceId: pending.choiceId,
                                choiceLabel: pending.choiceLabel,
                                choiceDescription: pending.choiceDescription,
                                rollLabels: extractDeltaLabels(event.data.entry)
                            }
                        ]));
                        pendingDecisionRef.current = null;
                    }
                    setStatus(`生成年份叙事中...(${event.data.index + 1}/${event.data.total})`);
                    return;
                }
                if (event.type === "milestone") {
                    setRun((prev) => prev ? { ...prev, nextMilestoneChoice: event.data } : prev);
                    setStatus("新的抉择出现。");
                    return;
                }
                if (event.type === "done") {
                    setRun(event.data.run);
                    pendingDecisionRef.current = null;
                    setStatus(event.data.run.ended ? "本局结束。" : "时间继续向前，等待下一个分岔点。");
                    if (event.data.run.ended)
                        setShowEndingModal(true);
                    return;
                }
                if (event.type === "error") {
                    throw new Error(event.data.message);
                }
            });
        }
        catch (error) {
            pendingDecisionRef.current = null;
            setStatus(`推进失败：${String(error)}`);
        }
        finally {
            setIsStreaming(false);
        }
    }
    function resetRun() {
        setRun(null);
        setSelectedCards([]);
        setFlippedCards({});
        setStats(defaultStats);
        setTimeline([]);
        setDecisionHistory([]);
        pendingDecisionRef.current = null;
        setShowEndingModal(false);
        setEnvReady(false);
        setStatus("已重置，请重新确认 Setting 并开局。");
    }
    function playAgain() {
        resetRun();
        setStatus("再来一把！请重新确认 Setting 并开局。");
    }
    if (!bootstrap) {
        return _jsx("main", { className: "app", children: _jsx("p", { children: status }) });
    }
    return (_jsxs("main", { className: "app game-shell", children: [_jsxs("header", { className: "topbar", children: [_jsx("button", { className: "setting-btn", onClick: () => setShowSettings(true), children: "\u2699 Setting" }), _jsx("h1", { children: "\u4EBA\u751F\u91CD\u5F00\u5668" }), _jsx("button", { className: "ghost", onClick: resetRun, children: "\u91CD\u5F00" })] }), _jsx("div", { className: "game-content", children: !run ? (_jsxs("section", { className: "panel start-panel", children: [_jsx("h2", { children: "\u521B\u5EFA\u89D2\u8272" }), _jsxs("label", { children: ["\u4EBA\u8BBE\u63D0\u793A\u8BCD", _jsx("textarea", { rows: 4, value: personaPrompt, onChange: (e) => setPersonaPrompt(e.target.value), placeholder: "\u4F8B\u5982\uFF1A\u5B64\u72EC\u4F46\u5F3A\u97E7\uFF0C\u6267\u7740\u8FFD\u6C42\u88AB\u8BA4\u53EF\uFF0C\u5E0C\u671B\u6539\u53D8\u5BB6\u65CF\u547D\u8FD0\u3002" })] }), _jsxs("div", { children: [_jsxs("p", { children: ["\u53EF\u7528\u5929\u8D4B\u70B9\uFF1A", remainingTalentPoints] }), _jsx("div", { className: "stats-grid pixel-grid", children: Object.keys(statLabels).map((key) => (_jsxs("div", { className: "stat-box pixel-stat", children: [_jsxs("strong", { children: [statIcons[key], " ", statLabels[key]] }), _jsxs("div", { className: "row", children: [_jsx("button", { onClick: () => changeStat(key, -1), children: "-" }), _jsx("span", { children: stats[key] }), _jsx("button", { onClick: () => changeStat(key, 1), children: "+" })] })] }, key))) })] }), _jsxs("div", { children: [_jsxs("p", { children: ["\u62BD\u5361\u7FFB\u724C\uFF08\u53EF\u9009 ", bootstrap.startAllocation.selectedCardMin, "-", bootstrap.startAllocation.selectedCardMax, "\uFF09"] }), _jsx("div", { className: "cards", children: bootstrap.cardPool.map((card) => {
                                        const selected = selectedCards.includes(card.id);
                                        const flipped = Boolean(flippedCards[card.id]);
                                        return (_jsx("div", { className: "flip-wrap", children: !flipped ? (_jsxs("button", { className: "card card-back", onClick: () => flipCard(card.id), children: [_jsx("strong", { children: "???" }), _jsx("small", { children: "\u70B9\u51FB\u7FFB\u724C" })] })) : (_jsxs("button", { className: `card ${selected ? "picked" : ""} ${rarityClass(card.rarity)}`, onClick: () => toggleCard(card.id), children: [_jsx("strong", { children: card.name }), _jsx("small", { children: card.rarity }), _jsx("p", { children: card.description })] })) }, card.id));
                                    }) })] }), _jsx("button", { disabled: !canStart || isStreaming, onClick: () => void onStart(), children: "\u5F00\u59CB\u6E38\u620F" }), _jsx("p", { className: "status", children: status })] })) : (_jsxs("section", { className: "panel run-panel", children: [_jsxs("h2", { children: [run.age, " \u5C81 \u00B7 ", run.ageStage.label] }), _jsxs("p", { children: [statIcons.intelligence, "\u667A\u529B ", run.stats.intelligence, " \u00B7 ", statIcons.charisma, "\u9B45\u529B ", run.stats.charisma, " \u00B7 ", statIcons.family, "\u5BB6\u5883 ", run.stats.family, " \u00B7 ", statIcons.fortune, "\u6C14\u8FD0 ", run.stats.fortune, "\u00B7 ", statIcons.physique, "\u4F53\u9B44 ", run.stats.physique] }), _jsxs("p", { children: ["\u540D\u671B\uFF1A", run.fame, " \u00B7 \u7ED3\u5C40\u72B6\u6001\uFF1A", run.outcome === "ongoing" ? "进行中" : outcomeLabel(run.outcome)] }), _jsx("div", { className: "timeline-scroll", ref: timelineRef, children: timeline.slice(-14).map((item) => (_jsxs("article", { className: "narrative", children: [_jsxs("strong", { children: [item.age, "\u5C81 \u00B7 ", item.ageStage.label, " \u00B7 ", item.title] }), _jsx("div", { className: "delta-row", children: extractDeltaLabels(item).length === 0 ? (_jsx("small", { children: "\u5C5E\u6027\u53D8\u5316\uFF1A\u65E0" })) : (extractDeltaLabels(item).map((label, idx) => (_jsx("small", { children: label }, `${timelineKey(item)}-${idx}`)))) }), _jsx("p", { children: item.narrative })] }, timelineKey(item)))) }), _jsxs("section", { className: "decision-history", children: [_jsxs("div", { className: "decision-history-head", children: [_jsx("h3", { children: "\u6289\u62E9\u5386\u53F2" }), _jsx("small", {})] }), decisionHistory.length === 0 ? (_jsx("p", { className: "decision-history-empty", children: "\u6682\u65E0\u6289\u62E9\u8BB0\u5F55\u3002" })) : (_jsx("div", { className: "decision-history-list", children: decisionHistory.map((entry) => (_jsxs("article", { className: "decision-history-item", children: [_jsxs("p", { className: "decision-history-meta", children: [entry.age, "\u5C81 \u00B7 ", entry.ageStageLabel] }), _jsx("p", { className: "decision-history-bg", children: entry.background || "你走到了命运分岔口。" }), _jsxs("p", { className: "decision-history-choice", children: [_jsx("span", { className: "decision-choice-pill", children: entry.choiceLabel }), entry.choiceDescription] }), _jsx("div", { className: "decision-history-rolls", children: entry.rollLabels.length === 0 ? (_jsx("small", { className: "decision-roll-pill", children: "\u63B7\u70B9\uFF1A\u65E0\u660E\u663E\u53D8\u5316" })) : (entry.rollLabels.map((label, idx) => (_jsx("small", { className: "decision-roll-pill", children: label }, `${entry.id}-roll-${idx}`)))) })] }, entry.id))) }))] }), run.nextMilestoneChoice ? (_jsxs("div", { children: [_jsx("p", { children: run.nextMilestoneChoice.background ?? "你来到抉择时刻：" }), _jsx("div", { className: "row", children: run.nextMilestoneChoice.options.map((opt) => (_jsx("button", { disabled: isStreaming, onClick: () => void onDecision(opt.id), children: opt.label }, opt.id))) }), _jsx("div", { className: "row", children: run.nextMilestoneChoice.options.map((opt) => (_jsxs("small", { children: [opt.label, "\uFF1A", opt.description] }, `${opt.id}-desc`))) })] })) : null, !run.nextMilestoneChoice && !run.ended ? (_jsx("div", { className: "row", children: _jsx("button", { disabled: isStreaming, onClick: () => void onAdvance(), children: "\u7EE7\u7EED\u63A8\u8FDB\u5E74\u4EFD" }) })) : null, run.ended ? (_jsxs("div", { className: "ending", children: [_jsxs("div", { className: "ending-head", children: [_jsx("h3", { children: "\u7ED3\u5C40" }), _jsx("span", { className: `ending-pill ${run.outcome === "dead" ? "is-dead" : "is-ascended"}`, children: endingBadgeText(run) })] }), _jsxs("p", { className: "ending-meta", children: ["\u540D\u671B ", run.fame, " \u00B7 ", fameTitle(run.fame)] }), _jsx("blockquote", { className: "ending-quote", children: run.endingSummary ?? "命运已暂告一段落。" })] })) : null, _jsx("p", { className: "status", children: status })] })) }), showSettings ? (_jsx(AdminPanel, { onClose: () => setShowSettings(false), bootstrap: bootstrap, localApiKey: localApiKey, setLocalApiKey: setLocalApiKey, localProvider: localProvider, setLocalProvider: setLocalProvider, onConfirmEnvironment: onConfirmEnvironment, canConfirmEnv: canConfirmEnv, envReady: envReady, worldId: worldId, setWorldId: setWorldId, difficultyId: difficultyId, setDifficultyId: setDifficultyId })) : null, run?.ended && showEndingModal ? (_jsx("div", { className: "modal-mask", children: _jsxs("div", { className: "modal ending-modal", children: [_jsx("h2", { children: "\u672C\u5C40\u7ED3\u7B97" }), _jsxs("div", { className: "ending-summary-top", children: [_jsx("span", { className: `ending-pill ${run.outcome === "dead" ? "is-dead" : "is-ascended"}`, children: outcomeLabel(run.outcome) }), _jsx("small", { children: endingBadgeText(run) })] }), _jsxs("p", { children: ["\u540D\u671B\u5F97\u5206\uFF1A", run.fame] }), _jsxs("p", { children: ["\u79F0\u53F7\uFF1A", fameTitle(run.fame)] }), _jsx("blockquote", { className: "ending-quote ending-quote-modal", children: run.endingSummary ?? "命运已暂告一段落。" }), _jsxs("div", { className: "row", children: [_jsx("button", { onClick: playAgain, children: "\u518D\u6765\u4E00\u628A" }), _jsx("button", { className: "ghost", onClick: () => setShowEndingModal(false), children: "\u5173\u95ED" })] })] }) })) : null, _jsx("footer", { className: "site-footer", children: _jsxs("a", { className: "repo-link", href: "https://github.com/Vcity-ci/life_remake", target: "_blank", rel: "noreferrer", children: [_jsx("svg", { className: "repo-icon", viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false", children: _jsx("path", { d: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" }) }), _jsx("span", { children: "Vcity-ci/life_remake" })] }) })] }));
}
