import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdminPanel } from "./components/AdminPanel";
import { fetchBootstrap, saveGameEnvironment, startRun, stepRun } from "./lib/api";
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
    const [showEndingModal, setShowEndingModal] = useState(false);
    const timelineRef = useRef(null);
    const [flippedCards, setFlippedCards] = useState({});
    const [localApiKey, setLocalApiKey] = useState("");
    const [localProvider, setLocalProvider] = useState({
        provider: "openai-compatible",
        baseUrl: "https://api.openai.com/v1",
        model: "",
        apiPath: "/chat/completions",
        temperature: 0.9,
        maxTokens: 700,
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
        if (allocated !== bootstrap.talentPointTotal)
            return false;
        if (selectedCards.length === 0 || selectedCards.length > 3)
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
            if (prev.includes(id))
                return prev.filter((x) => x !== id);
            if (prev.length >= 3)
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
            setStatus(`本局环境已确认。Token范围 ${rsp.limits.maxTokens.min}-${rsp.limits.maxTokens.max}。`);
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
        try {
            setStatus("人生推进中...");
            const res = await startRun({
                clientId,
                worldId,
                difficultyId,
                personaPrompt,
                talentPointTotal: bootstrap.talentPointTotal,
                stats,
                selectedCardIds: selectedCards
            });
            const chunk = res.run.timelineChunk ?? [];
            const responseChunk = res.timelineChunk ?? [];
            const finalChunk = responseChunk.length > 0 ? responseChunk : chunk;
            if (finalChunk.length === 0) {
                setStatus("年份已推进，新的事件正在酝酿。");
                setRun(res.run);
                if (res.run.ended)
                    setShowEndingModal(true);
                return;
            }
            setRun(res.run);
            setTimeline((prev) => [...prev, ...finalChunk]);
            if (res.run.ended) {
                setStatus("本局结束。");
                setShowEndingModal(true);
            }
            else if (res.run.nextMilestoneChoice) {
                setStatus("岁月流逝中，新的抉择正在逼近。");
            }
            else {
                setStatus("年份推进完成，继续推进。");
            }
        }
        catch (error) {
            setStatus(`开局失败：${String(error)}`);
        }
    }
    async function onAdvance() {
        if (!run)
            return;
        try {
            setStatus("继续推进年份中...");
            const res = await stepRun({ runId: run.runId, decision: "balanced" });
            const chunk = res.run.timelineChunk ?? [];
            const responseChunk = res.timelineChunk ?? [];
            const finalChunk = responseChunk.length > 0 ? responseChunk : chunk;
            if (finalChunk.length === 0) {
                setRun(res.run);
                setStatus("年份已推进，请继续前行。");
                if (res.run.ended)
                    setShowEndingModal(true);
                return;
            }
            setRun(res.run);
            setTimeline((prev) => [...prev, ...finalChunk]);
            if (res.run.ended) {
                setStatus("本局结束。");
                setShowEndingModal(true);
            }
            else if (res.run.nextMilestoneChoice) {
                setStatus("新的抉择出现。");
            }
            else {
                setStatus("年份推进完成，继续推进。");
            }
        }
        catch (error) {
            setStatus(`推进失败：${String(error)}`);
        }
    }
    async function onDecision(decision) {
        if (!run)
            return;
        try {
            setStatus("命运流转中...");
            const res = await stepRun({ runId: run.runId, decision });
            const chunk = res.run.timelineChunk ?? [];
            const responseChunk = res.timelineChunk ?? [];
            const finalChunk = responseChunk.length > 0 ? responseChunk : chunk;
            if (finalChunk.length === 0) {
                setRun(res.run);
                setStatus("决策已生效，后续影响正在展开。");
                if (res.run.ended)
                    setShowEndingModal(true);
                return;
            }
            setRun(res.run);
            setTimeline((prev) => [...prev, ...finalChunk]);
            setStatus(res.run.ended ? "本局结束。" : "时间继续向前，等待下一个分岔点。");
            if (res.run.ended)
                setShowEndingModal(true);
        }
        catch (error) {
            setStatus(`推进失败：${String(error)}`);
        }
    }
    function resetRun() {
        setRun(null);
        setSelectedCards([]);
        setFlippedCards({});
        setStats(defaultStats);
        setTimeline([]);
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
    return (_jsxs("main", { className: "app game-shell", children: [_jsxs("header", { className: "topbar", children: [_jsx("button", { className: "setting-btn", onClick: () => setShowSettings(true), children: "\u2699 Setting" }), _jsx("h1", { children: "\u4EBA\u751F\u91CD\u5F00\u5668" }), _jsx("button", { className: "ghost", onClick: resetRun, children: "\u91CD\u5F00" })] }), !run ? (_jsxs("section", { className: "panel start-panel", children: [_jsx("h2", { children: "\u521B\u5EFA\u89D2\u8272" }), _jsxs("label", { children: ["\u4EBA\u8BBE\u63D0\u793A\u8BCD", _jsx("textarea", { rows: 4, value: personaPrompt, onChange: (e) => setPersonaPrompt(e.target.value), placeholder: "\u4F8B\u5982\uFF1A\u5B64\u72EC\u4F46\u5F3A\u97E7\uFF0C\u6267\u7740\u8FFD\u6C42\u88AB\u8BA4\u53EF\uFF0C\u5E0C\u671B\u6539\u53D8\u5BB6\u65CF\u547D\u8FD0\u3002" })] }), _jsxs("div", { children: [_jsxs("p", { children: ["\u53EF\u7528\u5929\u8D4B\u70B9\uFF1A", remainingTalentPoints] }), _jsx("div", { className: "stats-grid pixel-grid", children: Object.keys(statLabels).map((key) => (_jsxs("div", { className: "stat-box pixel-stat", children: [_jsxs("strong", { children: [statIcons[key], " ", statLabels[key]] }), _jsxs("div", { className: "row", children: [_jsx("button", { onClick: () => changeStat(key, -1), children: "-" }), _jsx("span", { children: stats[key] }), _jsx("button", { onClick: () => changeStat(key, 1), children: "+" })] })] }, key))) })] }), _jsxs("div", { children: [_jsx("p", { children: "\u62BD\u5361\u7FFB\u724C\uFF08\u53EF\u9009 1-3\uFF09" }), _jsx("div", { className: "cards", children: bootstrap.cardPool.map((card) => {
                                    const selected = selectedCards.includes(card.id);
                                    const flipped = Boolean(flippedCards[card.id]);
                                    return (_jsx("div", { className: "flip-wrap", children: !flipped ? (_jsxs("button", { className: "card card-back", onClick: () => flipCard(card.id), children: [_jsx("strong", { children: "???" }), _jsx("small", { children: "\u70B9\u51FB\u7FFB\u724C" })] })) : (_jsxs("button", { className: `card ${selected ? "picked" : ""} ${rarityClass(card.rarity)}`, onClick: () => toggleCard(card.id), children: [_jsx("strong", { children: card.name }), _jsx("small", { children: card.rarity }), _jsx("p", { children: card.description })] })) }, card.id));
                                }) })] }), _jsx("button", { disabled: !canStart, onClick: () => void onStart(), children: "\u5F00\u59CB\u6E38\u620F" }), _jsx("p", { className: "status", children: status })] })) : (_jsxs("section", { className: "panel run-panel", children: [_jsxs("h2", { children: [run.age, " \u5C81 \u00B7 ", run.ageStage.label] }), _jsxs("p", { children: [statIcons.intelligence, "\u667A\u529B ", run.stats.intelligence, " \u00B7 ", statIcons.charisma, "\u9B45\u529B ", run.stats.charisma, " \u00B7 ", statIcons.family, "\u5BB6\u5883 ", run.stats.family, " \u00B7 ", statIcons.fortune, "\u6C14\u8FD0 ", run.stats.fortune, "\u00B7 ", statIcons.physique, "\u4F53\u9B44 ", run.stats.physique] }), _jsxs("p", { children: ["\u540D\u671B\uFF1A", run.fame, " \u00B7 \u7ED3\u5C40\u72B6\u6001\uFF1A", run.outcome === "ongoing" ? "进行中" : run.outcome === "dead" ? "死亡" : "飞升"] }), _jsx("div", { className: "timeline-scroll", ref: timelineRef, children: timeline.slice(-14).map((item) => (_jsxs("article", { className: "narrative", children: [_jsxs("strong", { children: [item.age, "\u5C81 \u00B7 ", item.ageStage.label, " \u00B7 ", item.title] }), _jsx("div", { className: "delta-row", children: extractDeltaLabels(item).length === 0 ? (_jsx("small", { children: "\u5C5E\u6027\u53D8\u5316\uFF1A\u65E0" })) : (extractDeltaLabels(item).map((label, idx) => (_jsx("small", { children: label }, `${timelineKey(item)}-${idx}`)))) }), _jsx("p", { children: item.narrative })] }, timelineKey(item)))) }), run.nextMilestoneChoice ? (_jsxs("div", { children: [_jsx("p", { children: run.nextMilestoneChoice.background ?? "你来到抉择时刻：" }), _jsx("div", { className: "row", children: run.nextMilestoneChoice.options.map((opt) => (_jsx("button", { onClick: () => void onDecision(opt.id), children: opt.label }, opt.id))) }), _jsx("div", { className: "row", children: run.nextMilestoneChoice.options.map((opt) => (_jsxs("small", { children: [opt.label, "\uFF1A", opt.description] }, `${opt.id}-desc`))) })] })) : null, !run.nextMilestoneChoice && !run.ended ? (_jsx("div", { className: "row", children: _jsx("button", { onClick: () => void onAdvance(), children: "\u7EE7\u7EED\u63A8\u8FDB\u5E74\u4EFD" }) })) : null, run.ended ? (_jsxs("div", { className: "ending", children: [_jsx("h3", { children: "\u7ED3\u5C40" }), _jsx("p", { children: run.endingSummary })] })) : null, _jsx("p", { className: "status", children: status })] })), showSettings ? (_jsx(AdminPanel, { onClose: () => setShowSettings(false), bootstrap: bootstrap, localApiKey: localApiKey, setLocalApiKey: setLocalApiKey, localProvider: localProvider, setLocalProvider: setLocalProvider, onConfirmEnvironment: onConfirmEnvironment, canConfirmEnv: canConfirmEnv, envReady: envReady, worldId: worldId, setWorldId: setWorldId, difficultyId: difficultyId, setDifficultyId: setDifficultyId })) : null, run?.ended && showEndingModal ? (_jsx("div", { className: "modal-mask", children: _jsxs("div", { className: "modal ending-modal", children: [_jsx("h2", { children: "\u672C\u5C40\u7ED3\u7B97" }), _jsxs("p", { children: ["\u7ED3\u5C40\uFF1A", run.outcome === "dead" ? "死亡" : run.outcome === "ascended" ? "飞升" : "终局"] }), _jsxs("p", { children: ["\u540D\u671B\u5F97\u5206\uFF1A", run.fame] }), _jsxs("p", { children: ["\u79F0\u53F7\uFF1A", fameTitle(run.fame)] }), _jsxs("p", { children: ["\u7EC8\u5C40\u603B\u7ED3\uFF1A", run.endingSummary ?? "命运已暂告一段落。"] }), _jsxs("div", { className: "row", children: [_jsx("button", { onClick: playAgain, children: "\u518D\u6765\u4E00\u628A" }), _jsx("button", { className: "ghost", onClick: () => setShowEndingModal(false), children: "\u5173\u95ED" })] })] }) })) : null] }));
}
