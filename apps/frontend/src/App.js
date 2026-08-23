import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdminPanel } from "./components/AdminPanel";
import { ApiError, createSaveSlot, deleteSaveSlot, fetchBootstrap, fetchCurrentRun, fetchSaveSlots, recoverSaveSlot, resetAnonymousGameData, resetCurrentRun, restoreSaveSlot, saveGameEnvironment, startRunStream, stepRunStream } from "./lib/api";
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
const statKeys = ["intelligence", "charisma", "family", "fortune", "physique"];
const statTierLabels = { low: "积累中", steady: "可用", high: "出众" };
function rarityClass(r) {
    return `rarity-${r}`;
}
function timelineKey(t) {
    return t.turnId;
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
    if (outcome === "completed")
        return "收束";
    return "终局";
}
function endingBadgeText(run) {
    if (run.outcome === "dead")
        return "命数已尽";
    if (run.outcome === "ascended")
        return run.ascension.title?.trim() || "超凡飞升";
    if (run.outcome === "completed")
        return "人生收束";
    return "尘世落幕";
}
function formatSaveTime(updatedAt) {
    return new Date(updatedAt).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}
function makeStepRequestId(runId, action, nonce, decision) {
    const decisionPart = decision ?? "none";
    return `${runId}:${action}:${decisionPart}:${nonce}`;
}
export default function App() {
    const [bootstrap, setBootstrap] = useState(null);
    const [runtimeMode, setRuntimeMode] = useState("local");
    const [worldId, setWorldId] = useState("ancient");
    const [difficultyId, setDifficultyId] = useState("standard");
    const [personaPrompt, setPersonaPrompt] = useState("");
    const [selectedCards, setSelectedCards] = useState([]);
    const [stats, setStats] = useState(defaultStats);
    const [run, setRun] = useState(null);
    const [status, setStatus] = useState("初始化中...");
    const [showSettings, setShowSettings] = useState(false);
    const [envReady, setEnvReady] = useState(false);
    const [turns, setTurns] = useState([]);
    const [showEndingModal, setShowEndingModal] = useState(false);
    const [showBusyModal, setShowBusyModal] = useState(false);
    const [showSaveModal, setShowSaveModal] = useState(false);
    const [saveSlots, setSaveSlots] = useState([]);
    const [saveTitle, setSaveTitle] = useState("");
    const [recoveryCode, setRecoveryCode] = useState("");
    const [issuedRecoveryCode, setIssuedRecoveryCode] = useState("");
    const [saveWorking, setSaveWorking] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [autoAdvance, setAutoAdvance] = useState(false);
    const timelineRef = useRef(null);
    const followLatestTimelineRef = useRef(true);
    const isGeneratingRef = useRef(false);
    const runRef = useRef(null);
    const requestNonceRef = useRef(0);
    const [flippedCards, setFlippedCards] = useState({});
    const timeline = turns;
    const activeDecision = useMemo(() => ([...turns].reverse().find((turn) => turn.choice && !turn.choiceOutcome)?.choice), [turns]);
    const decisionHistory = useMemo(() => {
        const seen = new Set();
        return [...turns].reverse().flatMap((turn) => {
            if (turn.kind !== "choice_outcome" || !turn.choice || !turn.choiceOutcome || seen.has(turn.choice.sceneId))
                return [];
            seen.add(turn.choice.sceneId);
            return [{
                    id: turn.choice.sceneId,
                    age: turn.age,
                    ageStageLabel: turn.ageStage.label,
                    background: turn.choice.background ?? "",
                    choiceLabel: turn.choiceOutcome.label,
                    choiceDescription: turn.choiceOutcome.description,
                    rollLabels: extractDeltaLabels(turn)
                }];
        }).reverse();
    }, [turns]);
    const [localApiKey, setLocalApiKey] = useState("");
    const [localProvider, setLocalProvider] = useState({
        provider: "openai-compatible",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        apiPath: "/chat/completions",
        temperature: 0.9,
        maxTokens: 1824,
        timeoutMs: 45000,
        reasoningEffort: "minimal",
        directorMode: "auto"
    });
    const clientId = useMemo(() => getOrCreateClientId(), []);
    function isServerBusyError(error) {
        if (error instanceof ApiError) {
            return error.status === 503 || error.code === "server_busy" || error.message.includes("服务器繁忙");
        }
        return error instanceof Error && error.message.includes("服务器繁忙");
    }
    useEffect(() => {
        async function init() {
            try {
                const boot = await fetchBootstrap();
                setBootstrap(boot);
                setRuntimeMode(boot.deployMode);
                setWorldId(boot.worlds.some((world) => world.id === "ancient") ? "ancient" : (boot.worlds[0]?.id ?? "modern"));
                setDifficultyId(boot.difficulties[0]?.id ?? "standard");
                const localCfg = readLocalProviderConfig();
                if (localCfg)
                    setLocalProvider(localCfg);
                else
                    setLocalProvider(boot.runtime.cloud);
                const current = await fetchCurrentRun();
                if (!restoreCurrentRun(current)) {
                    setStatus(current.environmentReady ? "本局环境已确认，可以开始人生。" : "请先在 Setting 确认本局环境，然后开始人生。");
                }
            }
            catch {
                setStatus("服务暂不可用，请稍后刷新页面。");
            }
        }
        void init();
    }, []);
    async function refreshBootstrapForReplay(freshAnonymousStart = false) {
        try {
            const boot = await fetchBootstrap();
            setBootstrap(boot);
            setRuntimeMode(boot.deployMode);
            setWorldId((prev) => freshAnonymousStart
                ? (boot.worlds.some((world) => world.id === "ancient") ? "ancient" : (boot.worlds[0]?.id ?? prev))
                : (boot.worlds.some((world) => world.id === prev) ? prev : (boot.worlds[0]?.id ?? prev)));
            setDifficultyId((prev) => freshAnonymousStart
                ? (boot.difficulties[0]?.id ?? prev)
                : (boot.difficulties.some((difficulty) => difficulty.id === prev) ? prev : (boot.difficulties[0]?.id ?? prev)));
        }
        catch {
            setStatus("开局配置暂不可用，请稍后重试。");
        }
    }
    useEffect(() => {
        writeLocalProviderConfig(localProvider);
    }, [localProvider]);
    useEffect(() => {
        if (!timelineRef.current || !followLatestTimelineRef.current)
            return;
        timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }, [timeline]);
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
    const canRandomStart = useMemo(() => {
        if (!bootstrap || !envReady)
            return false;
        if (personaPrompt.trim().length < 4)
            return false;
        return bootstrap.cardPool.length >= bootstrap.startAllocation.selectedCardMin;
    }, [bootstrap, envReady, personaPrompt]);
    const usedTalentPoints = useMemo(() => stats.intelligence + stats.charisma + stats.physique + stats.family + stats.fortune, [stats]);
    const remainingTalentPoints = useMemo(() => (bootstrap ? Math.max(0, bootstrap.talentPointTotal - usedTalentPoints) : 0), [bootstrap, usedTalentPoints]);
    function resetPendingFlowState() {
        // Streamed turns are already committed by the server; there is no client-side reveal queue.
    }
    function restoreCurrentRun(payload) {
        setEnvReady(payload.environmentReady);
        const restored = payload.run;
        if (!restored)
            return false;
        resetPendingFlowState();
        followLatestTimelineRef.current = true;
        setTurns(payload.turns ?? payload.timeline.map((entry, index) => ({
            turnId: entry.entryId,
            sequence: index + 1,
            kind: entry.kind,
            ageFrom: entry.ageFrom,
            age: entry.age,
            ageStage: entry.ageStage,
            narrative: entry.narrative,
            statChanges: entry.statChanges,
            statsSnapshot: restored.stats,
            itemsSnapshot: restored.items,
            fameSnapshot: restored.fame,
            createdAt: 0
        })));
        setRun(restored);
        runRef.current = restored;
        setWorldId(restored.worldId);
        setDifficultyId(restored.difficultyId);
        setPersonaPrompt(restored.personaPrompt);
        setStats(restored.stats);
        setSelectedCards(restored.cards.map((card) => card.id));
        setFlippedCards(buildFlippedCards(restored.cards.map((card) => card.id)));
        setAutoAdvance(false);
        setShowEndingModal(false);
        setStatus(payload.environmentReady ? "已恢复本局人生。" : "已恢复本局人生，请在 Setting 重新确认本局环境。");
        return true;
    }
    function appendTurn(record) {
        setTurns((previous) => {
            const settled = record.choice?.sceneId && record.choiceOutcome
                ? previous.map((item) => item.choice?.sceneId === record.choice?.sceneId && !item.choiceOutcome
                    ? { ...item, choiceOutcome: record.choiceOutcome }
                    : item)
                : previous;
            const existingIndex = settled.findIndex((item) => item.turnId === record.turnId);
            if (existingIndex < 0)
                return [...settled, record];
            return settled.map((item, index) => index === existingIndex ? record : item);
        });
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
    function canAdvance(runState) {
        if (!runState)
            return false;
        const runPhase = phaseOf(runState);
        return runPhase === "ready";
    }
    async function runStepGeneration(decision, decisionAgeOverride) {
        const currentRun = runRef.current;
        if (!currentRun)
            return;
        if (isGeneratingRef.current)
            return;
        isGeneratingRef.current = true;
        setIsGenerating(true);
        try {
            await stepRunStream(decision
                ? {
                    runId: currentRun.runId,
                    action: "decide",
                    decision,
                    decisionAge: typeof decisionAgeOverride === "number"
                        ? decisionAgeOverride
                        : (activeDecision?.age ?? currentRun.age),
                    sceneId: activeDecision?.sceneId,
                    sceneRevision: activeDecision?.revision,
                    requestId: makeStepRequestId(currentRun.runId, "decide", ++requestNonceRef.current, decision)
                }
                : {
                    runId: currentRun.runId,
                    action: "consume",
                    requestId: makeStepRequestId(currentRun.runId, "consume", ++requestNonceRef.current)
                }, async (event) => {
                if (event.type === "turn") {
                    appendTurn(event.data.record);
                    setStatus(`人生推进中...(${event.data.index + 1}/${event.data.total})`);
                    return;
                }
                if (event.type === "done") {
                    if (event.data.turns)
                        setTurns(event.data.turns);
                    setRun(event.data.run);
                    runRef.current = event.data.run;
                    if (event.data.run.ended || phaseOf(event.data.run) === "ended") {
                        setStatus("本局结束。");
                        setShowEndingModal(true);
                    }
                    else if (event.data.run.nextMilestoneChoice && phaseOf(event.data.run) === "waiting_decision") {
                        setStatus("新的抉择出现。");
                    }
                    else {
                        setStatus("已就绪，继续推进年份。");
                    }
                    return;
                }
                if (event.type === "error") {
                    throw new Error(event.data.message);
                }
            });
        }
        finally {
            isGeneratingRef.current = false;
            setIsGenerating(false);
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
    function createRandomStats(totalPoints) {
        const next = { ...defaultStats };
        let remaining = totalPoints;
        while (remaining > 0) {
            const available = statKeys.filter((key) => next[key] < 10);
            if (available.length === 0)
                break;
            const picked = available[Math.floor(Math.random() * available.length)];
            next[picked] += 1;
            remaining -= 1;
        }
        return next;
    }
    function pickRandomCardIds() {
        if (!bootstrap)
            return [];
        const maxCards = Math.min(bootstrap.startAllocation.selectedCardMax, bootstrap.cardPool.length);
        const minCards = Math.min(bootstrap.startAllocation.selectedCardMin, maxCards);
        const count = Math.max(minCards, maxCards);
        return [...bootstrap.cardPool]
            .sort(() => Math.random() - 0.5)
            .slice(0, count)
            .map((card) => card.id);
    }
    function buildFlippedCards(cardIds) {
        return cardIds.reduce((acc, id) => {
            acc[id] = true;
            return acc;
        }, {});
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
        catch {
            setEnvReady(false);
            setStatus("环境配置失败，请检查模型设置后重试。");
        }
    }
    async function refreshSaveSlots() {
        const response = await fetchSaveSlots();
        setSaveSlots(response.saves);
    }
    async function openSaveManager() {
        setRecoveryCode("");
        setIssuedRecoveryCode("");
        setShowSaveModal(true);
        try {
            await refreshSaveSlots();
        }
        catch {
            setStatus("存档列表暂不可用，请稍后重试。");
        }
    }
    async function saveCurrentRun() {
        if (!run || saveWorking || isStreaming || isGenerating)
            return;
        setSaveWorking(true);
        try {
            const created = await createSaveSlot({ runId: run.runId, title: saveTitle.trim() || undefined });
            setIssuedRecoveryCode(created.recoveryCode);
            setSaveTitle("");
            await refreshSaveSlots();
            setStatus("当前人生已存档。");
        }
        catch {
            setStatus("存档失败，请稍后重试。");
        }
        finally {
            setSaveWorking(false);
        }
    }
    async function restoreSavedRun(saveId) {
        if (saveWorking)
            return;
        setSaveWorking(true);
        try {
            const restored = await restoreSaveSlot(saveId);
            if (!restoreCurrentRun(restored))
                throw new Error("save_restore_empty");
            setShowSaveModal(false);
        }
        catch {
            setStatus("恢复存档失败，请稍后重试。");
        }
        finally {
            setSaveWorking(false);
        }
    }
    async function recoverSavedRun() {
        if (!recoveryCode.trim() || saveWorking)
            return;
        setSaveWorking(true);
        try {
            const restored = await recoverSaveSlot(recoveryCode.trim());
            if (!restoreCurrentRun(restored))
                throw new Error("save_recovery_empty");
            setShowSaveModal(false);
        }
        catch {
            setStatus("恢复码无效或存档已过期。");
        }
        finally {
            setSaveWorking(false);
        }
    }
    async function removeSaveSlot(saveId) {
        if (saveWorking)
            return;
        setSaveWorking(true);
        try {
            await deleteSaveSlot(saveId);
            await refreshSaveSlots();
            setStatus("存档已删除。");
        }
        catch {
            setStatus("删除存档失败，请稍后重试。");
        }
        finally {
            setSaveWorking(false);
        }
    }
    async function onStart(overrides) {
        if (!bootstrap)
            return;
        if (isStreaming || isGenerating)
            return;
        const startStats = overrides?.stats ?? stats;
        const startSelectedCards = overrides?.selectedCardIds ?? selectedCards;
        try {
            setIsStreaming(true);
            resetPendingFlowState();
            setStatus("人生推进中...");
            await startRunStream({
                clientId,
                worldId,
                difficultyId,
                personaPrompt,
                talentPointTotal: bootstrap.talentPointTotal,
                stats: startStats,
                selectedCardIds: startSelectedCards
            }, async (event) => {
                if (event.type === "meta") {
                    setStatus("本局调参已同步，继续推进叙事...");
                    return;
                }
                if (event.type === "started") {
                    setRun(event.data.run);
                    runRef.current = event.data.run;
                    setTurns([]);
                    setStatus("角色已开局，点击“推进年份”开始流转。");
                    return;
                }
                if (event.type === "turn") {
                    appendTurn(event.data.record);
                    setStatus(`人生推进中...(${event.data.index + 1}/${event.data.total})`);
                    return;
                }
                if (event.type === "done") {
                    if (event.data.turns)
                        setTurns(event.data.turns);
                    const mergedRun = event.data.run;
                    const mergedPhase = phaseOf(mergedRun);
                    setRun(mergedRun);
                    runRef.current = mergedRun;
                    if (mergedPhase === "ended") {
                        setStatus("本局结束。");
                        setShowEndingModal(true);
                    }
                    else if (mergedRun.nextMilestoneChoice && mergedPhase === "waiting_decision") {
                        setStatus("新的抉择出现。");
                    }
                    else {
                        setStatus("已就绪，点击“推进年份”。");
                    }
                    return;
                }
                if (event.type === "error") {
                    throw new Error(event.data.message);
                }
            });
        }
        catch (error) {
            if (isServerBusyError(error)) {
                setAutoAdvance(false);
                setShowBusyModal(true);
                setStatus("服务器繁忙，请稍后重试。");
            }
            else {
                setStatus("开局暂不可用，请检查本局环境后重试。");
            }
        }
        finally {
            setIsStreaming(false);
        }
    }
    async function onRandomStart() {
        if (!bootstrap)
            return;
        if (isStreaming || isGenerating)
            return;
        if (!envReady) {
            setStatus("请先在 Setting 确认本局环境。");
            return;
        }
        if (personaPrompt.trim().length < 4) {
            setStatus("请先填写至少四个字的人设提示词。");
            return;
        }
        const randomStats = createRandomStats(bootstrap.talentPointTotal);
        const allocated = statKeys.reduce((sum, key) => sum + randomStats[key], 0);
        if (allocated !== bootstrap.talentPointTotal) {
            setStatus("天赋点超过当前单项上限，无法随机分配。");
            return;
        }
        const randomCardIds = pickRandomCardIds();
        if (randomCardIds.length < bootstrap.startAllocation.selectedCardMin) {
            setStatus("可用天赋卡不足，无法随机开局。");
            return;
        }
        setStats(randomStats);
        setSelectedCards(randomCardIds);
        setFlippedCards(buildFlippedCards(randomCardIds));
        await onStart({ stats: randomStats, selectedCardIds: randomCardIds });
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
        if (activeDecision && runPhase === "waiting_decision") {
            setStatus("请先完成当前抉择。");
            return;
        }
        if (run.growthFocus && !run.growthFocus.selectedId) {
            setStatus("请先确定这一阶段的成长方向。");
            return;
        }
        try {
            setStatus("推进年份中...");
            if (isGeneratingRef.current) {
                setStatus("等待命运流转中...");
                return;
            }
            await runStepGeneration();
        }
        catch (error) {
            if (isServerBusyError(error)) {
                setAutoAdvance(false);
                setShowBusyModal(true);
                setStatus("服务器繁忙，请稍后重试。");
            }
            else {
                setStatus("暂时无法推进，请稍后重试。");
            }
        }
    }
    async function onDecision(decision) {
        if (!run)
            return;
        if (isStreaming || isGeneratingRef.current)
            return;
        const currentRun = run;
        const decisionAge = activeDecision?.age ?? currentRun.age;
        try {
            resetPendingFlowState();
            const optimisticRun = {
                ...currentRun,
                nextMilestoneChoice: undefined,
                phase: "generating"
            };
            setRun(optimisticRun);
            runRef.current = optimisticRun;
            setStatus("命运流转中...");
            await runStepGeneration(decision, decisionAge);
        }
        catch (error) {
            setRun(currentRun);
            runRef.current = currentRun;
            if (isServerBusyError(error)) {
                setAutoAdvance(false);
                setShowBusyModal(true);
                setStatus("服务器繁忙，请稍后重试。");
            }
            else {
                setStatus("暂时无法完成抉择，请稍后重试。");
            }
        }
    }
    async function onSelectGrowthFocus(focusId) {
        const currentRun = runRef.current;
        if (!currentRun || isStreaming || isGeneratingRef.current)
            return;
        isGeneratingRef.current = true;
        setIsGenerating(true);
        try {
            await stepRunStream({
                runId: currentRun.runId,
                action: "select_growth_focus",
                growthFocusId: focusId,
                requestId: makeStepRequestId(currentRun.runId, "select_growth_focus", ++requestNonceRef.current, focusId)
            }, async (event) => {
                if (event.type === "done") {
                    if (event.data.turns)
                        setTurns(event.data.turns);
                    setRun(event.data.run);
                    runRef.current = event.data.run;
                    setStatus("成长方向已确定。");
                    return;
                }
                if (event.type === "error")
                    throw new Error(event.data.message);
            });
        }
        catch {
            setStatus("暂时无法确认成长方向，请稍后重试。");
        }
        finally {
            isGeneratingRef.current = false;
            setIsGenerating(false);
        }
    }
    async function resetRun() {
        if (isStreaming || isGenerating || saveWorking)
            return false;
        try {
            await resetCurrentRun();
        }
        catch {
            setStatus("重置失败，请稍后重试。");
            return false;
        }
        setRun(null);
        runRef.current = null;
        setSelectedCards([]);
        setFlippedCards({});
        setStats(defaultStats);
        setTurns([]);
        followLatestTimelineRef.current = true;
        resetPendingFlowState();
        setShowEndingModal(false);
        setAutoAdvance(false);
        setStatus(envReady ? "已重开本局，可以开始新的人生。" : "已重开本局，请先确认 Setting 后开局。");
        void refreshBootstrapForReplay();
        return true;
    }
    async function resetAnonymousSave() {
        if (isStreaming || isGenerating || saveWorking)
            return;
        const confirmed = window.confirm("这会删除当前匿名档案中的全部人生、存档、抉择分岔和恢复码，且无法恢复。模型配置会保留。确定继续吗？");
        if (!confirmed)
            return;
        setSaveWorking(true);
        try {
            await resetAnonymousGameData();
            setRun(null);
            runRef.current = null;
            setPersonaPrompt("");
            setSelectedCards([]);
            setFlippedCards({});
            setStats(defaultStats);
            setTurns([]);
            setSaveSlots([]);
            setSaveTitle("");
            setRecoveryCode("");
            setIssuedRecoveryCode("");
            followLatestTimelineRef.current = true;
            resetPendingFlowState();
            setShowSaveModal(false);
            setShowEndingModal(false);
            setAutoAdvance(false);
            setStatus(envReady ? "匿名存档已重置，可以开始新的人生。" : "匿名存档已重置，请先确认 Setting 后开局。");
            void refreshBootstrapForReplay(true);
        }
        catch {
            setStatus("匿名存档重置失败，请稍后重试。");
        }
        finally {
            setSaveWorking(false);
        }
    }
    async function playAgain() {
        if (await resetRun()) {
            setStatus(envReady ? "再来一把！可以开始新的人生。" : "再来一把！请先确认 Setting 后开局。");
        }
    }
    useEffect(() => {
        if (!autoAdvance)
            return;
        if (!run)
            return;
        if (run.ended || phaseOf(run) === "ended") {
            setAutoAdvance(false);
            return;
        }
        if (isStreaming || isGenerating)
            return;
        if (activeDecision && phaseOf(run) === "waiting_decision") {
            setStatus("自动流转已暂停，等待抉择。");
            return;
        }
        if (!canAdvance(run))
            return;
        const timer = window.setTimeout(() => {
            void onAdvance();
        }, 350);
        return () => window.clearTimeout(timer);
    }, [autoAdvance, run, timeline.length, activeDecision, isStreaming, isGenerating]);
    if (!bootstrap) {
        return _jsx("main", { className: "app", children: _jsx("p", { children: status }) });
    }
    return (_jsxs("main", { className: `app game-shell world-${worldId}`, children: [_jsxs("header", { className: "topbar", children: [_jsx("button", { className: "icon-action", onClick: () => setShowSettings(true), title: "\u672C\u5C40\u8BBE\u7F6E", "aria-label": "\u672C\u5C40\u8BBE\u7F6E", children: "\u2699" }), _jsx("h1", { children: "\u4EBA\u751F\u91CD\u5F00\u5668" }), _jsxs("div", { className: "topbar-actions", children: [_jsxs("label", { className: `auto-flow-toggle ${autoAdvance ? "active" : ""}`, children: [_jsx("input", { type: "checkbox", checked: autoAdvance, onChange: (e) => setAutoAdvance(e.target.checked) }), "\u81EA\u52A8\u6D41\u8F6C"] }), _jsx("button", { className: "icon-action", disabled: isStreaming || isGenerating, onClick: () => void openSaveManager(), title: "\u5B58\u6863", "aria-label": "\u5B58\u6863", children: "\u25A3" }), _jsx("button", { className: "icon-action", disabled: isStreaming || isGenerating || saveWorking, onClick: () => void resetRun(), title: "\u91CD\u5F00\u672C\u5C40", "aria-label": "\u91CD\u5F00\u672C\u5C40", children: "\u21BB" })] })] }), _jsx("div", { className: "game-content", children: !run ? (_jsxs("section", { className: "panel start-panel", children: [_jsx("h2", { children: "\u521B\u5EFA\u89D2\u8272" }), _jsxs("label", { children: ["\u4EBA\u8BBE\u63D0\u793A\u8BCD", _jsx("textarea", { rows: 4, value: personaPrompt, onChange: (e) => setPersonaPrompt(e.target.value), placeholder: "\u4F8B\u5982\uFF1A\u5B64\u72EC\u4F46\u5F3A\u97E7\uFF0C\u6267\u7740\u8FFD\u6C42\u88AB\u8BA4\u53EF\uFF0C\u5E0C\u671B\u6539\u53D8\u5BB6\u65CF\u547D\u8FD0(\u81F3\u5C11\u56DB\u4E2A\u5B57)\u3002" })] }), _jsxs("div", { children: [_jsxs("p", { children: ["\u53EF\u7528\u5929\u8D4B\u70B9\uFF1A", remainingTalentPoints] }), _jsx("div", { className: "stats-grid pixel-grid", children: Object.keys(statLabels).map((key) => (_jsxs("div", { className: "stat-box pixel-stat", children: [_jsxs("strong", { children: [statIcons[key], " ", statLabels[key]] }), _jsxs("div", { className: "row", children: [_jsx("button", { onClick: () => changeStat(key, -1), children: "-" }), _jsx("span", { children: stats[key] }), _jsx("button", { onClick: () => changeStat(key, 1), children: "+" })] })] }, key))) })] }), _jsxs("div", { children: [_jsxs("p", { children: ["\u62BD\u5361\u7FFB\u724C\uFF08\u53EF\u9009 ", bootstrap.startAllocation.selectedCardMin, "-", bootstrap.startAllocation.selectedCardMax, "\uFF09"] }), _jsx("div", { className: "cards", children: bootstrap.cardPool.map((card) => {
                                        const selected = selectedCards.includes(card.id);
                                        const flipped = Boolean(flippedCards[card.id]);
                                        return (_jsx("div", { className: "flip-wrap", children: !flipped ? (_jsxs("button", { className: "card card-back", onClick: () => flipCard(card.id), children: [_jsx("strong", { children: "???" }), _jsx("small", { children: "\u70B9\u51FB\u7FFB\u724C" })] })) : (_jsxs("button", { className: `card ${selected ? "picked" : ""} ${rarityClass(card.rarity)}`, onClick: () => toggleCard(card.id), children: [_jsx("strong", { children: card.name }), _jsx("small", { children: card.rarity }), _jsx("p", { children: card.description })] })) }, card.id));
                                    }) })] }), _jsxs("div", { className: "row", children: [_jsx("button", { disabled: !canStart || isStreaming || isGenerating, onClick: () => void onStart(), children: "\u5F00\u59CB\u6E38\u620F" }), _jsx("button", { className: "ghost", disabled: !canRandomStart || isStreaming || isGenerating, onClick: () => void onRandomStart(), children: "\u968F\u673A\u5206\u914D\u5E76\u5F00\u59CB" })] }), _jsx("p", { className: "status", children: status })] })) : (_jsxs("section", { className: "run-panel reader-layout", children: [_jsxs("aside", { className: "reader-rail character-rail", children: [_jsxs("div", { className: "rail-title", children: [_jsx("small", { children: "\u6B64\u751F\u884C\u81F3" }), _jsxs("strong", { children: [run.age, " \u5C81"] }), _jsx("span", { children: run.ageStage.label })] }), _jsx("dl", { className: "stat-list", children: statKeys.map((key) => {
                                        const tier = run.statTiers?.[key] ?? "steady";
                                        return _jsxs("div", { children: [_jsxs("dt", { children: [statIcons[key], " ", statLabels[key]] }), _jsxs("dd", { children: [_jsx("span", { children: run.stats[key] }), _jsx("small", { className: `stat-tier stat-tier-${tier}`, children: statTierLabels[tier] })] })] }, key);
                                    }) }), _jsxs("div", { className: "rail-meta", children: [_jsxs("span", { children: ["\u540D\u671B ", run.fame] }), _jsx("span", { children: run.outcome === "ongoing" ? "命途未定" : outcomeLabel(run.outcome) })] })] }), _jsxs("section", { className: "story-reader", "aria-label": "\u4EBA\u751F\u53D9\u4E8B", children: [_jsxs("header", { className: "reader-heading", children: [_jsx("small", { children: "\u547D\u8FD0\u7EAA\u4E8B" }), _jsxs("h2", { children: [run.age, " \u5C81 \u00B7 ", run.ageStage.label] })] }), _jsx("div", { className: "timeline-scroll", ref: timelineRef, onScroll: (event) => {
                                        const target = event.currentTarget;
                                        followLatestTimelineRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 24;
                                    }, children: timeline.map((item, index) => (_jsxs("article", { className: "narrative", children: [_jsx("header", { children: _jsx("strong", { children: item.ageFrom && item.ageFrom < item.age
                                                        ? `${item.ageFrom}-${item.age}岁`
                                                        : timeline[index - 1]?.age === item.age
                                                            ? "同年"
                                                            : `${item.age}岁` }) }), _jsx("p", { children: item.narrative }), _jsx("div", { className: "delta-row", children: extractDeltaLabels(item).map((label, idx) => _jsx("small", { children: label }, `${timelineKey(item)}-${idx}`)) })] }, timelineKey(item)))) }), activeDecision && phaseOf(run) === "waiting_decision" ? (_jsxs("section", { className: "decision-dock", children: [_jsx("p", { children: activeDecision.background ?? "你来到抉择时刻：" }), _jsx("div", { className: "decision-options", children: activeDecision.options.map((opt) => (_jsxs("button", { disabled: isStreaming || isGenerating, onClick: () => void onDecision(opt.id), children: [_jsx("strong", { children: opt.label }), _jsx("small", { children: opt.description })] }, opt.id))) })] })) : null, !run.ended && !(activeDecision && phaseOf(run) === "waiting_decision") ? (_jsx("div", { className: "advance-bar", children: _jsx("button", { disabled: isStreaming || isGenerating || !canAdvance(run), onClick: () => void onAdvance(), children: "\u7EE7\u7EED\u63A8\u8FDB" }) })) : null, run.ended ? (_jsxs("div", { className: "ending", children: [_jsxs("div", { className: "ending-head", children: [_jsx("h3", { children: "\u6B64\u751F\u7ED3\u5C40" }), _jsx("span", { className: `ending-pill ${run.outcome === "dead" ? "is-dead" : run.outcome === "ascended" ? "is-ascended" : "is-completed"}`, children: endingBadgeText(run) })] }), _jsxs("p", { className: "ending-meta", children: ["\u540D\u671B ", run.fame, " \u00B7 ", fameTitle(run.fame)] }), _jsx("blockquote", { className: "ending-quote", children: run.endingSummary ?? "命运已暂告一段落。" })] })) : null, _jsx("p", { className: "status", children: status })] }), _jsxs("aside", { className: "reader-rail fate-rail", "aria-label": "\u547D\u8FD0\u6863\u6848", children: [_jsxs("section", { className: "rail-section", children: [_jsx("h3", { children: "\u5929\u8D4B" }), _jsx("div", { className: "asset-list", children: run.cards.map((card) => _jsx("span", { className: `asset-chip ${rarityClass(card.rarity)}`, title: card.description, children: card.name }, card.id)) })] }), _jsxs("section", { className: "rail-section", children: [_jsx("h3", { children: "\u547D\u8FD0\u4EBA\u7269" }), _jsx("div", { className: "asset-list", children: (run.narrativeCharacters?.length ?? 0) === 0 ? _jsx("small", { children: "\u5C1A\u65E0\u5E38\u9A7B\u4EBA\u7269" }) : run.narrativeCharacters.map((character) => _jsx("span", { className: "asset-chip item-chip", title: `${character.role}：${character.description}`, children: character.name }, character.id)) })] }), _jsxs("section", { className: "decision-history", children: [_jsx("div", { className: "decision-history-head", children: _jsx("h3", { children: "\u5DF2\u4F5C\u6289\u62E9" }) }), decisionHistory.length === 0 ? _jsx("p", { className: "decision-history-empty", children: "\u5C1A\u672A\u8D70\u5230\u5206\u5C94\u5904\u3002" }) : (_jsx("div", { className: "decision-history-list", children: decisionHistory.map((entry) => (_jsxs("article", { className: "decision-history-item", children: [_jsxs("p", { className: "decision-history-meta", children: [entry.age, "\u5C81 \u00B7 ", entry.ageStageLabel] }), _jsx("p", { className: "decision-history-bg", children: entry.background || "你走到了命运分岔口。" }), _jsxs("p", { className: "decision-history-choice", children: [_jsx("span", { children: entry.choiceLabel }), entry.choiceDescription] }), entry.rollLabels.length > 0 ? _jsx("div", { className: "decision-history-rolls", children: entry.rollLabels.map((label, idx) => _jsx("small", { children: label }, `${entry.id}-roll-${idx}`)) }) : null] }, entry.id))) }))] })] })] })) }), showSettings ? (_jsx(AdminPanel, { onClose: () => setShowSettings(false), bootstrap: bootstrap, localApiKey: localApiKey, setLocalApiKey: setLocalApiKey, localProvider: localProvider, setLocalProvider: setLocalProvider, onConfirmEnvironment: onConfirmEnvironment, canConfirmEnv: canConfirmEnv, envReady: envReady, worldId: worldId, setWorldId: setWorldId, difficultyId: difficultyId, setDifficultyId: setDifficultyId })) : null, run?.growthFocus && !run.growthFocus.selectedId && !run.ended ? (_jsx("div", { className: "modal-mask", role: "dialog", "aria-modal": "true", "aria-label": "\u9009\u62E9\u6210\u957F\u65B9\u5411", children: _jsxs("div", { className: "modal growth-focus-modal", children: [_jsx("h2", { children: "\u6B64\u9636\u6BB5\u7684\u79EF\u7D2F" }), _jsx("div", { className: "growth-focus-options", children: run.growthFocus.options.map((focus) => (_jsxs("button", { disabled: isStreaming || isGenerating, onClick: () => void onSelectGrowthFocus(focus.id), children: [_jsx("strong", { children: focus.label }), _jsx("small", { children: focus.description })] }, focus.id))) })] }) })) : null, run?.ended && showEndingModal ? (_jsx("div", { className: "modal-mask", children: _jsxs("div", { className: "modal ending-modal", children: [_jsx("h2", { children: "\u672C\u5C40\u7ED3\u7B97" }), _jsxs("div", { className: "ending-summary-top", children: [_jsx("span", { className: `ending-pill ${run.outcome === "dead" ? "is-dead" : run.outcome === "ascended" ? "is-ascended" : "is-completed"}`, children: outcomeLabel(run.outcome) }), _jsx("small", { children: endingBadgeText(run) })] }), _jsxs("p", { children: ["\u540D\u671B\u5F97\u5206\uFF1A", run.fame] }), _jsxs("p", { children: ["\u79F0\u53F7\uFF1A", fameTitle(run.fame)] }), _jsx("blockquote", { className: "ending-quote ending-quote-modal", children: run.endingSummary ?? "命运已暂告一段落。" }), _jsxs("div", { className: "row", children: [_jsx("button", { onClick: () => void playAgain(), children: "\u518D\u6765\u4E00\u628A" }), _jsx("button", { className: "ghost", onClick: () => setShowEndingModal(false), children: "\u5173\u95ED" })] })] }) })) : null, showBusyModal ? (_jsx("div", { className: "modal-mask", children: _jsxs("div", { className: "modal ending-modal", children: [_jsx("h2", { children: "\u63D0\u793A" }), _jsx("p", { children: "\u670D\u52A1\u5668\u7E41\u5FD9\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002" }), _jsx("div", { className: "row", children: _jsx("button", { onClick: () => setShowBusyModal(false), children: "\u6211\u77E5\u9053\u4E86" }) })] }) })) : null, showSaveModal ? (_jsx("div", { className: "modal-mask", children: _jsxs("div", { className: "modal save-modal", children: [_jsx("h2", { children: "\u5B58\u6863" }), run ? (_jsxs("section", { className: "save-section", children: [_jsxs("label", { children: ["\u5B58\u6863\u540D\u79F0", _jsx("input", { value: saveTitle, maxLength: 40, onChange: (event) => setSaveTitle(event.target.value), placeholder: `${run.age}岁的人生记录` })] }), _jsx("button", { disabled: saveWorking || isStreaming || isGenerating, onClick: () => void saveCurrentRun(), children: "\u4FDD\u5B58\u5F53\u524D\u4EBA\u751F" })] })) : null, issuedRecoveryCode ? (_jsxs("section", { className: "save-section recovery-issued", children: [_jsx("small", { children: "\u6062\u590D\u7801" }), _jsx("code", { children: issuedRecoveryCode })] })) : null, _jsxs("section", { className: "save-section", children: [_jsx("h3", { children: "\u5F53\u524D\u6D4F\u89C8\u5668\u7684\u5B58\u6863" }), saveSlots.length === 0 ? _jsx("p", { className: "save-empty", children: "\u5C1A\u65E0\u5B58\u6863\u3002" }) : (_jsx("div", { className: "save-list", children: saveSlots.map((slot) => (_jsxs("article", { className: "save-item", children: [_jsxs("div", { children: [_jsx("strong", { children: slot.title }), _jsxs("small", { children: [slot.age, "\u5C81 \u00B7 ", slot.kind === "decision" ? "抉择分岔" : slot.ended ? "已结局" : "进行中", " \u00B7 ", formatSaveTime(slot.updatedAt)] })] }), _jsxs("div", { className: "save-actions", children: [_jsx("button", { className: "ghost", disabled: saveWorking, onClick: () => void restoreSavedRun(slot.id), children: slot.kind === "decision" ? "回到分岔" : "恢复" }), _jsx("button", { className: "icon-action save-delete", disabled: saveWorking, onClick: () => void removeSaveSlot(slot.id), title: "\u5220\u9664\u5B58\u6863", "aria-label": `删除存档 ${slot.title}`, children: "\u00D7" })] })] }, slot.id))) }))] }), _jsxs("section", { className: "save-section", children: [_jsxs("label", { children: ["\u6062\u590D\u7801", _jsx("input", { value: recoveryCode, onChange: (event) => setRecoveryCode(event.target.value), placeholder: "save_..." })] }), _jsx("button", { disabled: saveWorking || !recoveryCode.trim(), onClick: () => void recoverSavedRun(), children: "\u6062\u590D\u5B58\u6863" })] }), _jsxs("section", { className: "save-section reset-anonymous-section", children: [_jsx("h3", { children: "\u533F\u540D\u6863\u6848" }), _jsx("p", { children: "\u5220\u9664\u5F53\u524D\u6D4F\u89C8\u5668\u7684\u5168\u90E8\u4EBA\u751F\u8BB0\u5F55\u3001\u5B58\u6863\u3001\u5206\u5C94\u548C\u6062\u590D\u7801\uFF1B\u6A21\u578B\u914D\u7F6E\u4F1A\u4FDD\u7559\u3002" }), _jsx("button", { className: "danger", disabled: saveWorking || isStreaming || isGenerating, onClick: () => void resetAnonymousSave(), children: "\u91CD\u7F6E\u533F\u540D\u5B58\u6863" })] }), _jsx("div", { className: "row", children: _jsx("button", { className: "ghost", disabled: saveWorking, onClick: () => setShowSaveModal(false), children: "\u5173\u95ED" }) })] }) })) : null, _jsx("footer", { className: "site-footer", children: _jsxs("a", { className: "repo-link", href: "https://github.com/Vcity-ci/life_remake", target: "_blank", rel: "noreferrer", children: [_jsx("svg", { className: "repo-icon", viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false", children: _jsx("path", { d: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" }) }), _jsx("span", { children: "Vcity-ci/life_remake" })] }) })] }));
}
