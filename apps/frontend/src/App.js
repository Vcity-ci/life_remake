import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdminPanel } from "./components/AdminPanel";
import { ApiError, fetchBootstrap, saveGameEnvironment, startRunStream, stepRunStream } from "./lib/api";
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
function makeStepRequestId(runId, action, nonce, decision) {
    const decisionPart = decision ?? "none";
    return `${runId}:${action}:${decisionPart}:${nonce}`;
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
    const [timelineBuffer, setTimelineBuffer] = useState([]);
    const [decisionHistory, setDecisionHistory] = useState([]);
    const [showEndingModal, setShowEndingModal] = useState(false);
    const [showBusyModal, setShowBusyModal] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const timelineRef = useRef(null);
    const pendingDecisionRef = useRef(null);
    const timelineBufferRef = useRef([]);
    const pendingAdvanceCountRef = useRef(0);
    const pendingRunAfterBufferRef = useRef(null);
    const pendingMilestoneRef = useRef(null);
    const isGeneratingRef = useRef(false);
    const runRef = useRef(null);
    const requestNonceRef = useRef(0);
    const [flippedCards, setFlippedCards] = useState({});
    const [localApiKey, setLocalApiKey] = useState("");
    const [localProvider, setLocalProvider] = useState({
        provider: "openai-compatible",
        baseUrl: "https://api.openai.com/v1",
        model: "",
        apiPath: "/chat/completions",
        temperature: 0.9,
        maxTokens: 1824,
        timeoutMs: 45000,
        reasoningEffort: "minimal"
    });
    const clientId = useMemo(() => getOrCreateClientId(), []);
    function isServerBusyError(error) {
        if (!(error instanceof ApiError))
            return false;
        return error.status === 503 || error.code === "server_busy" || error.message.includes("服务器繁忙");
    }
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
    useEffect(() => {
        timelineBufferRef.current = timelineBuffer;
    }, [timelineBuffer]);
    useEffect(() => {
        isGeneratingRef.current = isGenerating;
    }, [isGenerating]);
    useEffect(() => {
        runRef.current = run;
    }, [run]);
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
    function resetPendingFlowState() {
        pendingAdvanceCountRef.current = 0;
        pendingRunAfterBufferRef.current = null;
        pendingMilestoneRef.current = null;
    }
    function enqueueTimelineEntry(entry) {
        setTimelineBuffer((prev) => {
            if (prev.some((item) => timelineKey(item) === timelineKey(entry)))
                return prev;
            return [...prev, entry];
        });
    }
    function commitRunWithBufferedMilestone(baseRun) {
        const mergedPhase = phaseOf(baseRun);
        setRun(baseRun);
        pendingRunAfterBufferRef.current = null;
        pendingMilestoneRef.current = null;
        if (mergedPhase === "ended") {
            setStatus("本局结束。");
            setShowEndingModal(true);
        }
        else if (baseRun.nextMilestoneChoice && mergedPhase === "waiting_decision") {
            setStatus("新的抉择出现。");
        }
        else {
            setStatus("命运已揭露，继续推进。");
        }
    }
    function phaseOf(runState) {
        if (!runState)
            return "ready";
        return (runState.phase ?? (runState.ended ? "ended" : "ready"));
    }
    function currentDisplayedAge(runState) {
        const lastTimelineAge = timeline.length > 0 ? timeline[timeline.length - 1]?.age : undefined;
        if (typeof lastTimelineAge === "number")
            return lastTimelineAge;
        return runState?.revealedAge ?? runState?.age ?? 0;
    }
    function isAdvanceEntryForAge(entry, age) {
        if (!entry)
            return false;
        if (entry.age === age + 1)
            return true;
        if (entry.age === age && entry.tags.includes("milestone"))
            return true;
        return false;
    }
    function canAdvance(runState) {
        if (!runState)
            return false;
        const runPhase = phaseOf(runState);
        if (runPhase !== "ready")
            return false;
        const nextEntry = timelineBufferRef.current[0];
        const age = currentDisplayedAge(runState);
        if (isAdvanceEntryForAge(nextEntry, age))
            return true;
        return timelineBufferRef.current.length === 0;
    }
    function recordPendingDecisionFromDisplayedYears(displayed) {
        const pending = pendingDecisionRef.current;
        if (!pending)
            return;
        const milestoneEntry = displayed.find((item) => item.tags.includes("milestone"));
        if (!milestoneEntry)
            return;
        const runId = runRef.current?.runId ?? "run";
        setDecisionHistory((prev) => ([
            ...prev,
            {
                id: `${runId}-${pending.age}-${pending.choiceId}-${prev.length}`,
                age: pending.age,
                ageStageLabel: pending.ageStageLabel,
                background: pending.background,
                choiceId: pending.choiceId,
                choiceLabel: pending.choiceLabel,
                choiceDescription: pending.choiceDescription,
                rollLabels: extractDeltaLabels(milestoneEntry)
            }
        ]));
        pendingDecisionRef.current = null;
    }
    function consumeBufferedYears(count) {
        if (count <= 0)
            return 0;
        const current = timelineBufferRef.current;
        if (current.length === 0)
            return 0;
        const takeCount = Math.min(count, current.length);
        const take = current.slice(0, takeCount);
        const remaining = current.slice(takeCount);
        timelineBufferRef.current = remaining;
        setTimelineBuffer(remaining);
        if (take.length > 0) {
            setTimeline((prev) => [...prev, ...take]);
            recordPendingDecisionFromDisplayedYears(take);
        }
        return take.length;
    }
    function flushBufferedYears() {
        if (pendingAdvanceCountRef.current <= 0) {
            if (timelineBufferRef.current.length > 0) {
                setStatus("命运已抵达，点击“推进年份”揭露。");
                return;
            }
            if (!isGeneratingRef.current) {
                const pendingRun = pendingRunAfterBufferRef.current;
                if (pendingRun) {
                    commitRunWithBufferedMilestone(pendingRun);
                }
            }
            return;
        }
        const consumed = consumeBufferedYears(pendingAdvanceCountRef.current);
        if (consumed > 0) {
            pendingAdvanceCountRef.current = Math.max(0, pendingAdvanceCountRef.current - consumed);
        }
        if (pendingAdvanceCountRef.current > 0) {
            setStatus("等待命运流转中...");
            return;
        }
        if (timelineBufferRef.current.length > 0) {
            setStatus("命运已抵达，点击“推进年份”揭露。");
        }
        else if (isGeneratingRef.current) {
            setStatus("揭露命运中...");
        }
        else {
            const pendingRun = pendingRunAfterBufferRef.current;
            if (pendingRun) {
                commitRunWithBufferedMilestone(pendingRun);
            }
        }
    }
    async function runStepGeneration(decision) {
        const currentRun = runRef.current;
        if (!currentRun)
            return;
        if (isGeneratingRef.current)
            return;
        isGeneratingRef.current = true;
        setIsGenerating(true);
        let timelineEmitted = false;
        try {
            await stepRunStream(decision
                ? {
                    runId: currentRun.runId,
                    action: "decide",
                    decision,
                    decisionAge: currentRun.nextMilestoneChoice?.age ?? currentRun.age,
                    requestId: makeStepRequestId(currentRun.runId, "decide", ++requestNonceRef.current, decision)
                }
                : {
                    runId: currentRun.runId,
                    action: "consume",
                    requestId: makeStepRequestId(currentRun.runId, "consume", ++requestNonceRef.current)
                }, async (event) => {
                if (event.type === "timeline") {
                    timelineEmitted = true;
                    enqueueTimelineEntry(event.data.entry);
                    setStatus(`揭露命运中...(${event.data.index + 1}/${event.data.total})`);
                    flushBufferedYears();
                    return;
                }
                if (event.type === "milestone") {
                    pendingMilestoneRef.current = event.data;
                    return;
                }
                if (event.type === "done") {
                    pendingRunAfterBufferRef.current = event.data.run;
                    flushBufferedYears();
                    return;
                }
                if (event.type === "error") {
                    throw new Error(event.data.message);
                }
            });
        }
        finally {
            if (!timelineEmitted && pendingAdvanceCountRef.current > 0) {
                pendingAdvanceCountRef.current = Math.max(0, pendingAdvanceCountRef.current - 1);
            }
            isGeneratingRef.current = false;
            setIsGenerating(false);
            flushBufferedYears();
        }
    }
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
        if (isStreaming || isGenerating)
            return;
        try {
            setIsStreaming(true);
            resetPendingFlowState();
            setTimelineBuffer([]);
            timelineBufferRef.current = [];
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
                    runRef.current = event.data.run;
                    setTimeline([]);
                    setTimelineBuffer([]);
                    timelineBufferRef.current = [];
                    setDecisionHistory([]);
                    pendingDecisionRef.current = null;
                    setStatus("角色已开局，点击“推进年份”开始流转。");
                    return;
                }
                if (event.type === "timeline") {
                    enqueueTimelineEntry(event.data.entry);
                    setStatus(`揭露命运中...(${event.data.index + 1}/${event.data.total})`);
                    flushBufferedYears();
                    return;
                }
                if (event.type === "milestone") {
                    pendingMilestoneRef.current = event.data;
                    return;
                }
                if (event.type === "done") {
                    const mergedRun = event.data.run;
                    const mergedPhase = phaseOf(mergedRun);
                    setRun(mergedRun);
                    runRef.current = mergedRun;
                    if (timelineBufferRef.current.length > 0) {
                        setStatus("命运已抵达，点击“推进年份”揭露。");
                    }
                    else if (mergedPhase === "ended") {
                        setStatus("本局结束。");
                        setShowEndingModal(true);
                    }
                    else if (mergedRun.nextMilestoneChoice && mergedPhase === "waiting_decision") {
                        setStatus("新的抉择出现。");
                    }
                    else {
                        setStatus("已就绪，点击“推进年份”。");
                    }
                    pendingRunAfterBufferRef.current = null;
                    pendingMilestoneRef.current = null;
                    return;
                }
                if (event.type === "error") {
                    throw new Error(event.data.message);
                }
            });
        }
        catch (error) {
            if (isServerBusyError(error)) {
                setShowBusyModal(true);
                setStatus("服务器繁忙，请稍后重试。");
            }
            else {
                setStatus(`开局失败：${String(error)}`);
            }
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
        if (!canAdvance(run))
            return;
        const runPhase = phaseOf(run);
        if (runPhase === "ended") {
            setStatus("本局已结束。");
            return;
        }
        if (run.nextMilestoneChoice && runPhase === "waiting_decision" && timelineBufferRef.current.length === 0) {
            setStatus("请先完成当前抉择。");
            return;
        }
        try {
            setStatus("推进年份中...");
            pendingAdvanceCountRef.current += 1;
            flushBufferedYears();
            if (pendingAdvanceCountRef.current === 0)
                return;
            if (isGeneratingRef.current) {
                setStatus("等待命运流转中...");
                return;
            }
            await runStepGeneration();
        }
        catch (error) {
            pendingAdvanceCountRef.current = Math.max(0, pendingAdvanceCountRef.current - 1);
            if (isServerBusyError(error)) {
                setShowBusyModal(true);
                setStatus("服务器繁忙，请稍后重试。");
            }
            else {
                setStatus(`推进失败：${String(error)}`);
            }
        }
    }
    async function onDecision(decision) {
        if (!run)
            return;
        if (isStreaming || isGeneratingRef.current)
            return;
        const choice = run.nextMilestoneChoice?.options.find((opt) => opt.id === decision);
        if (run.nextMilestoneChoice && choice) {
            pendingDecisionRef.current = {
                age: run.nextMilestoneChoice.age ?? run.age,
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
            resetPendingFlowState();
            setStatus("命运流转中...");
            pendingAdvanceCountRef.current = 1;
            await runStepGeneration(decision);
            flushBufferedYears();
            pendingDecisionRef.current = null;
        }
        catch (error) {
            pendingDecisionRef.current = null;
            pendingAdvanceCountRef.current = Math.max(0, pendingAdvanceCountRef.current - 1);
            if (isServerBusyError(error)) {
                setShowBusyModal(true);
                setStatus("服务器繁忙，请稍后重试。");
            }
            else {
                setStatus(`推进失败：${String(error)}`);
            }
        }
    }
    function resetRun() {
        setRun(null);
        setSelectedCards([]);
        setFlippedCards({});
        setStats(defaultStats);
        setTimeline([]);
        setTimelineBuffer([]);
        timelineBufferRef.current = [];
        setDecisionHistory([]);
        resetPendingFlowState();
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
    return (_jsxs("main", { className: "app game-shell", children: [_jsxs("header", { className: "topbar", children: [_jsx("button", { className: "setting-btn", onClick: () => setShowSettings(true), children: "\u2699 Setting" }), _jsx("h1", { children: "\u4EBA\u751F\u91CD\u5F00\u5668" }), _jsx("button", { className: "ghost", onClick: resetRun, children: "\u91CD\u5F00" })] }), _jsx("div", { className: "game-content", children: !run ? (_jsxs("section", { className: "panel start-panel", children: [_jsx("h2", { children: "\u521B\u5EFA\u89D2\u8272" }), _jsxs("label", { children: ["\u4EBA\u8BBE\u63D0\u793A\u8BCD", _jsx("textarea", { rows: 4, value: personaPrompt, onChange: (e) => setPersonaPrompt(e.target.value), placeholder: "\u4F8B\u5982\uFF1A\u5B64\u72EC\u4F46\u5F3A\u97E7\uFF0C\u6267\u7740\u8FFD\u6C42\u88AB\u8BA4\u53EF\uFF0C\u5E0C\u671B\u6539\u53D8\u5BB6\u65CF\u547D\u8FD0(\u81F3\u5C11\u56DB\u4E2A\u5B57)\u3002" })] }), _jsxs("div", { children: [_jsxs("p", { children: ["\u53EF\u7528\u5929\u8D4B\u70B9\uFF1A", remainingTalentPoints] }), _jsx("div", { className: "stats-grid pixel-grid", children: Object.keys(statLabels).map((key) => (_jsxs("div", { className: "stat-box pixel-stat", children: [_jsxs("strong", { children: [statIcons[key], " ", statLabels[key]] }), _jsxs("div", { className: "row", children: [_jsx("button", { onClick: () => changeStat(key, -1), children: "-" }), _jsx("span", { children: stats[key] }), _jsx("button", { onClick: () => changeStat(key, 1), children: "+" })] })] }, key))) })] }), _jsxs("div", { children: [_jsxs("p", { children: ["\u62BD\u5361\u7FFB\u724C\uFF08\u53EF\u9009 ", bootstrap.startAllocation.selectedCardMin, "-", bootstrap.startAllocation.selectedCardMax, "\uFF09"] }), _jsx("div", { className: "cards", children: bootstrap.cardPool.map((card) => {
                                        const selected = selectedCards.includes(card.id);
                                        const flipped = Boolean(flippedCards[card.id]);
                                        return (_jsx("div", { className: "flip-wrap", children: !flipped ? (_jsxs("button", { className: "card card-back", onClick: () => flipCard(card.id), children: [_jsx("strong", { children: "???" }), _jsx("small", { children: "\u70B9\u51FB\u7FFB\u724C" })] })) : (_jsxs("button", { className: `card ${selected ? "picked" : ""} ${rarityClass(card.rarity)}`, onClick: () => toggleCard(card.id), children: [_jsx("strong", { children: card.name }), _jsx("small", { children: card.rarity }), _jsx("p", { children: card.description })] })) }, card.id));
                                    }) })] }), _jsx("button", { disabled: !canStart || isStreaming || isGenerating, onClick: () => void onStart(), children: "\u5F00\u59CB\u6E38\u620F" }), _jsx("p", { className: "status", children: status })] })) : (_jsxs("section", { className: "panel run-panel", children: [_jsxs("h2", { children: [run.age, " \u5C81 \u00B7 ", run.ageStage.label] }), _jsxs("p", { children: [statIcons.intelligence, "\u667A\u529B ", run.stats.intelligence, " \u00B7 ", statIcons.charisma, "\u9B45\u529B ", run.stats.charisma, " \u00B7 ", statIcons.family, "\u5BB6\u5883 ", run.stats.family, " \u00B7 ", statIcons.fortune, "\u6C14\u8FD0 ", run.stats.fortune, "\u00B7 ", statIcons.physique, "\u4F53\u9B44 ", run.stats.physique] }), _jsxs("p", { children: ["\u540D\u671B\uFF1A", run.fame, " \u00B7 \u7ED3\u5C40\u72B6\u6001\uFF1A", run.outcome === "ongoing" ? "进行中" : outcomeLabel(run.outcome)] }), _jsx("div", { className: "timeline-scroll", ref: timelineRef, children: timeline.slice(-14).map((item) => (_jsxs("article", { className: "narrative", children: [_jsxs("strong", { children: [item.age, "\u5C81 \u00B7 ", item.ageStage.label, " \u00B7 ", item.title] }), _jsx("div", { className: "delta-row", children: extractDeltaLabels(item).length === 0 ? (_jsx("small", { children: "\u5C5E\u6027\u53D8\u5316\uFF1A\u65E0" })) : (extractDeltaLabels(item).map((label, idx) => (_jsx("small", { children: label }, `${timelineKey(item)}-${idx}`)))) }), _jsx("p", { children: item.narrative })] }, timelineKey(item)))) }), _jsxs("section", { className: "decision-history", children: [_jsxs("div", { className: "decision-history-head", children: [_jsx("h3", { children: "\u6289\u62E9\u5386\u53F2" }), _jsx("small", {})] }), decisionHistory.length === 0 ? (_jsx("p", { className: "decision-history-empty", children: "\u6682\u65E0\u6289\u62E9\u8BB0\u5F55\u3002" })) : (_jsx("div", { className: "decision-history-list", children: decisionHistory.map((entry) => (_jsxs("article", { className: "decision-history-item", children: [_jsxs("p", { className: "decision-history-meta", children: [entry.age, "\u5C81 \u00B7 ", entry.ageStageLabel] }), _jsx("p", { className: "decision-history-bg", children: entry.background || "你走到了命运分岔口。" }), _jsxs("p", { className: "decision-history-choice", children: [_jsx("span", { className: "decision-choice-pill", children: entry.choiceLabel }), entry.choiceDescription] }), _jsx("div", { className: "decision-history-rolls", children: entry.rollLabels.length === 0 ? (_jsx("small", { className: "decision-roll-pill", children: "\u63B7\u70B9\uFF1A\u65E0\u660E\u663E\u53D8\u5316" })) : (entry.rollLabels.map((label, idx) => (_jsx("small", { className: "decision-roll-pill", children: label }, `${entry.id}-roll-${idx}`)))) })] }, entry.id))) }))] }), run.nextMilestoneChoice && phaseOf(run) === "waiting_decision" ? (_jsxs("div", { children: [_jsx("p", { children: run.nextMilestoneChoice.background ?? "你来到抉择时刻：" }), _jsx("div", { className: "row", children: run.nextMilestoneChoice.options.map((opt) => (_jsx("button", { disabled: isStreaming || isGenerating, onClick: () => void onDecision(opt.id), children: opt.label }, opt.id))) }), _jsx("div", { className: "row", children: run.nextMilestoneChoice.options.map((opt) => (_jsxs("small", { children: [opt.label, "\uFF1A", opt.description] }, `${opt.id}-desc`))) })] })) : null, phaseOf(run) === "ready" ? (_jsx("div", { className: "row", children: _jsx("button", { disabled: isStreaming || isGenerating || !canAdvance(run), onClick: () => void onAdvance(), children: isGenerating ? "等待命运揭露..." : "推进年份" }) })) : null, run.ended ? (_jsxs("div", { className: "ending", children: [_jsxs("div", { className: "ending-head", children: [_jsx("h3", { children: "\u7ED3\u5C40" }), _jsx("span", { className: `ending-pill ${run.outcome === "dead" ? "is-dead" : "is-ascended"}`, children: endingBadgeText(run) })] }), _jsxs("p", { className: "ending-meta", children: ["\u540D\u671B ", run.fame, " \u00B7 ", fameTitle(run.fame)] }), _jsx("blockquote", { className: "ending-quote", children: run.endingSummary ?? "命运已暂告一段落。" })] })) : null, _jsx("p", { className: "status", children: status })] })) }), showSettings ? (_jsx(AdminPanel, { onClose: () => setShowSettings(false), bootstrap: bootstrap, localApiKey: localApiKey, setLocalApiKey: setLocalApiKey, localProvider: localProvider, setLocalProvider: setLocalProvider, onConfirmEnvironment: onConfirmEnvironment, canConfirmEnv: canConfirmEnv, envReady: envReady, worldId: worldId, setWorldId: setWorldId, difficultyId: difficultyId, setDifficultyId: setDifficultyId })) : null, run?.ended && showEndingModal ? (_jsx("div", { className: "modal-mask", children: _jsxs("div", { className: "modal ending-modal", children: [_jsx("h2", { children: "\u672C\u5C40\u7ED3\u7B97" }), _jsxs("div", { className: "ending-summary-top", children: [_jsx("span", { className: `ending-pill ${run.outcome === "dead" ? "is-dead" : "is-ascended"}`, children: outcomeLabel(run.outcome) }), _jsx("small", { children: endingBadgeText(run) })] }), _jsxs("p", { children: ["\u540D\u671B\u5F97\u5206\uFF1A", run.fame] }), _jsxs("p", { children: ["\u79F0\u53F7\uFF1A", fameTitle(run.fame)] }), _jsx("blockquote", { className: "ending-quote ending-quote-modal", children: run.endingSummary ?? "命运已暂告一段落。" }), _jsxs("div", { className: "row", children: [_jsx("button", { onClick: playAgain, children: "\u518D\u6765\u4E00\u628A" }), _jsx("button", { className: "ghost", onClick: () => setShowEndingModal(false), children: "\u5173\u95ED" })] })] }) })) : null, showBusyModal ? (_jsx("div", { className: "modal-mask", children: _jsxs("div", { className: "modal ending-modal", children: [_jsx("h2", { children: "\u63D0\u793A" }), _jsx("p", { children: "\u670D\u52A1\u5668\u7E41\u5FD9\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002" }), _jsx("div", { className: "row", children: _jsx("button", { onClick: () => setShowBusyModal(false), children: "\u6211\u77E5\u9053\u4E86" }) })] }) })) : null, _jsx("footer", { className: "site-footer", children: _jsxs("a", { className: "repo-link", href: "https://github.com/Vcity-ci/life_remake", target: "_blank", rel: "noreferrer", children: [_jsx("svg", { className: "repo-icon", viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false", children: _jsx("path", { d: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" }) }), _jsx("span", { children: "Vcity-ci/life_remake" })] }) })] }));
}
