import React, { useEffect, useMemo, useRef, useState } from "react";
import type { CurrentGameRunResponse, ProviderConfig, ProviderLimits, PublicBackgroundCard, PublicRunState, RunPhase, SaveSlotSummary, StartAllocationConfig, StatKey, Stats, StepAction, SurvivalChoice, TurnRecord } from "@reroll/shared";
import { AdminPanel } from "./components/AdminPanel";
import { NarrativeAssetsPanel, NarrativeAssetChanges } from "./components/NarrativeAssets";
import {
  ApiError,
  createSaveSlot,
  deleteSaveSlot,
  fetchBootstrap,
  fetchCurrentRun,
  fetchSaveSlots,
  recoverSaveSlot,
  resetAnonymousGameData,
  resetCurrentRun,
  restoreSaveSlot,
  saveGameEnvironment,
  startRunStream,
  stepRunStream,
  type GameStreamEvent
} from "./lib/api";
import { getOrCreateClientId, readLocalProviderConfig, writeLocalProviderConfig } from "./lib/localConfig";

interface BootstrapState {
  deployMode: "local" | "cloud";
  worlds: Array<{ id: string; name: string; intro: string }>;
  difficulties: Array<{ id: string; name: string; description: string }>;
  cardPool: PublicBackgroundCard[];
  talentPointTotal: number;
  startAllocation: StartAllocationConfig;
  runtime: {
    runtimeMode: "cloud" | "local";
    cloud: ProviderConfig;
  };
  limits: ProviderLimits;
}

type MilestoneChoice = NonNullable<PublicRunState["nextMilestoneChoice"]>;
type SurvivalCrisis = NonNullable<PublicRunState["survivalCrisis"]>;
type StartOverrides = {
  stats?: Stats;
  selectedCardIds?: string[];
};

const statLabels: Record<StatKey, string> = {
  intelligence: "智力",
  charisma: "魅力",
  family: "家境",
  fortune: "气运",
  physique: "体魄"
};

const statIcons: Record<StatKey, string> = {
  intelligence: "🧠",
  charisma: "✨",
  family: "🏠",
  fortune: "🍀",
  physique: "💪"
};

const defaultStats: Stats = {
  intelligence: 0,
  charisma: 0,
  family: 0,
  fortune: 0,
  physique: 0
};
const statKeys: StatKey[] = ["intelligence", "charisma", "family", "fortune", "physique"];
const statTierLabels = { low: "积累中", steady: "可用", high: "出众" } as const;

function rarityClass(r: PublicBackgroundCard["rarity"]): string {
  return `rarity-${r}`;
}

function timelineKey(t: TurnRecord): string {
  return t.turnId;
}

function formatDeltaLabel(
  stat: StatKey,
  delta: number
): string {
  const name = statLabels[stat];
  const sign = delta > 0 ? "+" : "";
  return `${name}${sign}${delta}`;
}

function extractDeltaLabels(entry: Pick<TurnRecord, "statChanges">): string[] {
  const keys: StatKey[] = ["intelligence", "charisma", "physique", "family", "fortune"];
  const labels: string[] = [];
  for (const key of keys) {
    const delta = entry.statChanges[key] ?? 0;
    if (delta !== 0) {
      labels.push(formatDeltaLabel(key, delta));
    }
  }
  return labels;
}

function fameTitle(fame: number): string {
  if (fame < 20) return "无名之辈";
  if (fame < 40) return "小有名气";
  if (fame < 60) return "声名鹊起";
  if (fame < 80) return "名动一方";
  return "举世传奇";
}

function outcomeLabel(outcome: PublicRunState["outcome"]): string {
  if (outcome === "dead") return "死亡";
  if (outcome === "ascended") return "飞升";
  if (outcome === "completed") return "收束";
  return "终局";
}

function endingBadgeText(run: PublicRunState): string {
  if (run.outcome === "dead") return "命数已尽";
  if (run.outcome === "ascended") return run.ascension.title?.trim() || "超凡飞升";
  if (run.outcome === "completed") return "人生收束";
  return "尘世落幕";
}

function formatSaveTime(updatedAt: number): string {
  return new Date(updatedAt).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function makeStepRequestId(runId: string, action: StepAction, nonce: number, decision?: string): string {
  const decisionPart = decision ?? "none";
  return `${runId}:${action}:${decisionPart}:${nonce}`;
}

export default function App(): React.JSX.Element {
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [runtimeMode, setRuntimeMode] = useState<"cloud" | "local">("local");
  const [worldId, setWorldId] = useState("ancient");
  const [difficultyId, setDifficultyId] = useState("standard");
  const [personaPrompt, setPersonaPrompt] = useState("");
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats>(defaultStats);
  const [run, setRun] = useState<PublicRunState | null>(null);
  const [status, setStatus] = useState("初始化中...");
  const [showSettings, setShowSettings] = useState(false);
  const [envReady, setEnvReady] = useState(false);
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  const [showEndingModal, setShowEndingModal] = useState(false);
  const [showBusyModal, setShowBusyModal] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveSlots, setSaveSlots] = useState<SaveSlotSummary[]>([]);
  const [saveTitle, setSaveTitle] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [issuedRecoveryCode, setIssuedRecoveryCode] = useState("");
  const [saveWorking, setSaveWorking] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [showGrowthFocus, setShowGrowthFocus] = useState(false);
  const [expandedOriginIds, setExpandedOriginIds] = useState<Set<string>>(() => new Set());
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const followLatestTimelineRef = useRef(true);
  const isGeneratingRef = useRef(false);
  const runRef = useRef<PublicRunState | null>(null);
  const requestNonceRef = useRef(0);
  const [flippedCards, setFlippedCards] = useState<Record<string, boolean>>({});

  const timeline = turns;
  const visibleAssets = turns.length ? turns[turns.length - 1].narrativeAssetsSnapshot : run?.narrativeAssets;
  const activeDecision = useMemo<MilestoneChoice | undefined>(() => (
    [...turns].reverse().find((turn) => turn.choice && !turn.choiceOutcome)?.choice
  ), [turns]);
  const activeSurvivalCrisis: SurvivalCrisis | undefined = run?.survivalCrisis;
  const decisionHistory = useMemo(() => {
    const seen = new Set<string>();
    return [...turns].reverse().flatMap((turn) => {
      if (turn.kind !== "choice_outcome" || !turn.choice || !turn.choiceOutcome || seen.has(turn.choice.sceneId)) return [];
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
  const [localProvider, setLocalProvider] = useState<ProviderConfig>({
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

  function isServerBusyError(error: unknown): boolean {
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
        if (localCfg) setLocalProvider(localCfg);
        else setLocalProvider(boot.runtime.cloud);

        const current = await fetchCurrentRun();
        if (!restoreCurrentRun(current)) {
          setStatus(current.environmentReady ? "本局环境已确认，可以开始人生。" : "请先在 Setting 确认本局环境，然后开始人生。");
        }
      } catch {
        setStatus("服务暂不可用，请稍后刷新页面。");
      }
    }
    void init();
  }, []);

  async function refreshBootstrapForReplay(freshAnonymousStart = false): Promise<void> {
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
    } catch {
      setStatus("开局配置暂不可用，请稍后重试。");
    }
  }

  useEffect(() => {
    writeLocalProviderConfig(localProvider);
  }, [localProvider]);

  useEffect(() => {
    if (!timelineRef.current || !followLatestTimelineRef.current) return;
    timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
  }, [timeline]);

  useEffect(() => {
    isGeneratingRef.current = isGenerating;
  }, [isGenerating]);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const canConfirmEnv = useMemo(() => {
    if (!bootstrap) return false;
    if (bootstrap.deployMode === "local") {
      if (!localApiKey.trim()) return false;
      if (!localProvider.model.trim() || !localProvider.baseUrl.trim()) return false;
    }
    return true;
  }, [bootstrap, localApiKey, localProvider]);
  useEffect(() => {
    if (bootstrap) {
      setRuntimeMode(bootstrap.deployMode);
    }
  }, [bootstrap]);

  const canStart = useMemo(() => {
    if (!bootstrap || !envReady) return false;
    if (personaPrompt.trim().length < 4) return false;
    const allocated =
      stats.intelligence + stats.charisma + stats.physique + stats.family + stats.fortune;
    if (allocated < bootstrap.startAllocation.talentPointMin || allocated > bootstrap.startAllocation.talentPointMax) return false;
    if (allocated !== bootstrap.talentPointTotal) return false;
    if (
      selectedCards.length < bootstrap.startAllocation.selectedCardMin ||
      selectedCards.length > bootstrap.startAllocation.selectedCardMax
    ) return false;
    return true;
  }, [bootstrap, envReady, personaPrompt, selectedCards, stats]);
  const canRandomStart = useMemo(() => {
    if (!bootstrap || !envReady) return false;
    if (personaPrompt.trim().length < 4) return false;
    return bootstrap.cardPool.length >= bootstrap.startAllocation.selectedCardMin;
  }, [bootstrap, envReady, personaPrompt]);

  const usedTalentPoints = useMemo(
    () => stats.intelligence + stats.charisma + stats.physique + stats.family + stats.fortune,
    [stats]
  );
  const remainingTalentPoints = useMemo(
    () => (bootstrap ? Math.max(0, bootstrap.talentPointTotal - usedTalentPoints) : 0),
    [bootstrap, usedTalentPoints]
  );

  function resetPendingFlowState(): void {
    // Streamed turns are already committed by the server; there is no client-side reveal queue.
  }

  function restoreCurrentRun(payload: CurrentGameRunResponse): boolean {
    setEnvReady(payload.environmentReady);
    const restored = payload.run;
    if (!restored) return false;
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
    setShowGrowthFocus(false);
    setShowEndingModal(false);
    setStatus(payload.environmentReady ? "已恢复本局人生。" : "已恢复本局人生，请在 Setting 重新确认本局环境。");
    return true;
  }

  function appendTurn(record: TurnRecord): void {
    setTurns((previous) => {
      const settled = record.choice?.sceneId && record.choiceOutcome
        ? previous.map((item) => item.choice?.sceneId === record.choice?.sceneId && !item.choiceOutcome
          ? { ...item, choiceOutcome: record.choiceOutcome }
          : item)
        : previous;
      const existingIndex = settled.findIndex((item) => item.turnId === record.turnId);
      if (existingIndex < 0) return [...settled, record];
      return settled.map((item, index) => index === existingIndex ? record : item);
    });
  }

  function phaseOf(runState: PublicRunState | null): RunPhase {
    if (!runState) return "ready";
    return (runState.phase ?? (runState.ended ? "ended" : "ready")) as RunPhase;
  }

  function currentDisplayedAge(runState: PublicRunState | null): number {
    const lastTimelineAge = timeline.length > 0 ? timeline[timeline.length - 1]?.age : undefined;
    if (typeof lastTimelineAge === "number") return lastTimelineAge;
    return runState?.revealedAge ?? runState?.age ?? 0;
  }

  function canAdvance(runState: PublicRunState | null): boolean {
    if (!runState) return false;
    if (runState.opening?.status === "pending") return false;
    if (runState.growthFocus && !runState.growthFocus.selectedId) return false;
    const runPhase = phaseOf(runState);
    return runPhase === "ready";
  }

  function needsGrowthFocus(runState: PublicRunState | null): boolean {
    return Boolean(
      runState &&
      runState.opening?.status === "ready" &&
      runState.growthFocus &&
      !runState.growthFocus.selectedId
    );
  }

  async function runStepGeneration(
    decision?: string,
    decisionAgeOverride?: number,
    survivalChoice?: SurvivalChoice,
    survivalCrisisId?: string
  ): Promise<void> {
    const currentRun = runRef.current;
    if (!currentRun) return;
    if (isGeneratingRef.current) return;
    isGeneratingRef.current = true;
    setIsGenerating(true);
    try {
      await stepRunStream(
        survivalChoice
          ? {
              runId: currentRun.runId,
              action: "resolve_survival",
              survivalChoice,
              survivalCrisisId,
              requestId: makeStepRequestId(
                currentRun.runId,
                "resolve_survival",
                ++requestNonceRef.current,
                survivalChoice
              )
            }
          : decision
          ? {
              runId: currentRun.runId,
              action: "decide",
              decision,
              decisionAge: typeof decisionAgeOverride === "number"
                ? decisionAgeOverride
                : (activeDecision?.age ?? currentRun.age),
              sceneId: activeDecision?.sceneId,
              sceneRevision: activeDecision?.revision,
              requestId: makeStepRequestId(
                currentRun.runId,
                "decide",
                ++requestNonceRef.current,
                decision
              )
            }
          : {
              runId: currentRun.runId,
              action: "consume",
              requestId: makeStepRequestId(
                currentRun.runId,
                "consume",
                ++requestNonceRef.current
              )
            },
        async (event: GameStreamEvent) => {
          if (event.type === "turn") {
            appendTurn(event.data.record);
            setStatus(`人生推进中...(${event.data.index + 1}/${event.data.total})`);
            return;
          }
          if (event.type === "done") {
            if (event.data.turns) setTurns(event.data.turns);
            setRun(event.data.run);
            runRef.current = event.data.run;
            if (event.data.run.ended || phaseOf(event.data.run) === "ended") {
              setStatus("本局结束。");
              setShowEndingModal(true);
            } else if (event.data.run.survivalCrisis && phaseOf(event.data.run) === "waiting_decision") {
              setStatus("命悬一线，请作出求生选择。");
            } else if (event.data.run.nextMilestoneChoice && phaseOf(event.data.run) === "waiting_decision") {
              setStatus("新的抉择出现。");
            } else {
              setStatus("已就绪，继续推进年份。");
            }
            return;
          }
          if (event.type === "error") {
            throw new Error(event.data.message);
          }
        }
      );
    } finally {
      isGeneratingRef.current = false;
      setIsGenerating(false);
    }
  }

  function changeStat(key: StatKey, delta: number): void {
    setStats((prev) => {
      const next = { ...prev };
      if (delta > 0) {
        const allocated =
          prev.intelligence + prev.charisma + prev.physique + prev.family + prev.fortune;
        const total = bootstrap?.talentPointTotal ?? 0;
        if (allocated >= total) return prev;
      }
      const candidate = Math.max(0, Math.min(10, next[key] + delta));
      if (candidate === next[key]) return prev;
      next[key] = candidate;
      return next;
    });
  }

  function toggleCard(id: string): void {
    setSelectedCards((prev) => {
      const maxCards = bootstrap?.startAllocation.selectedCardMax ?? 3;
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= maxCards) return prev;
      return [...prev, id];
    });
  }

  function flipCard(id: string): void {
    setFlippedCards((prev) => ({ ...prev, [id]: true }));
  }

  function createRandomStats(totalPoints: number): Stats {
    const next = { ...defaultStats };
    let remaining = totalPoints;
    while (remaining > 0) {
      const available = statKeys.filter((key) => next[key] < 10);
      if (available.length === 0) break;
      const picked = available[Math.floor(Math.random() * available.length)];
      next[picked] += 1;
      remaining -= 1;
    }
    return next;
  }

  function pickRandomCardIds(): string[] {
    if (!bootstrap) return [];
    const maxCards = Math.min(bootstrap.startAllocation.selectedCardMax, bootstrap.cardPool.length);
    const minCards = Math.min(bootstrap.startAllocation.selectedCardMin, maxCards);
    const count = Math.max(minCards, maxCards);
    return [...bootstrap.cardPool]
      .sort(() => Math.random() - 0.5)
      .slice(0, count)
      .map((card) => card.id);
  }

  function buildFlippedCards(cardIds: string[]): Record<string, boolean> {
    return cardIds.reduce<Record<string, boolean>>((acc, id) => {
      acc[id] = true;
      return acc;
    }, {});
  }

  async function onConfirmEnvironment(): Promise<void> {
    if (!bootstrap) return;
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
    } catch {
      setEnvReady(false);
      setStatus("环境配置失败，请检查模型设置后重试。");
    }
  }

  async function refreshSaveSlots(): Promise<void> {
    const response = await fetchSaveSlots();
    setSaveSlots(response.saves);
  }

  async function openSaveManager(): Promise<void> {
    setRecoveryCode("");
    setIssuedRecoveryCode("");
    setShowSaveModal(true);
    try {
      await refreshSaveSlots();
    } catch {
      setStatus("存档列表暂不可用，请稍后重试。");
    }
  }

  async function saveCurrentRun(): Promise<void> {
    if (!run || saveWorking || isStreaming || isGenerating) return;
    setSaveWorking(true);
    try {
      const created = await createSaveSlot({ runId: run.runId, title: saveTitle.trim() || undefined });
      setIssuedRecoveryCode(created.recoveryCode);
      setSaveTitle("");
      await refreshSaveSlots();
      setStatus("当前人生已存档。");
    } catch {
      setStatus("存档失败，请稍后重试。");
    } finally {
      setSaveWorking(false);
    }
  }

  async function restoreSavedRun(saveId: string): Promise<void> {
    if (saveWorking) return;
    setSaveWorking(true);
    try {
      const restored = await restoreSaveSlot(saveId);
      if (!restoreCurrentRun(restored)) throw new Error("save_restore_empty");
      setShowSaveModal(false);
    } catch {
      setStatus("恢复存档失败，请稍后重试。");
    } finally {
      setSaveWorking(false);
    }
  }

  async function recoverSavedRun(): Promise<void> {
    if (!recoveryCode.trim() || saveWorking) return;
    setSaveWorking(true);
    try {
      const restored = await recoverSaveSlot(recoveryCode.trim());
      if (!restoreCurrentRun(restored)) throw new Error("save_recovery_empty");
      setShowSaveModal(false);
    } catch {
      setStatus("恢复码无效或存档已过期。");
    } finally {
      setSaveWorking(false);
    }
  }

  async function removeSaveSlot(saveId: string): Promise<void> {
    if (saveWorking) return;
    setSaveWorking(true);
    try {
      await deleteSaveSlot(saveId);
      await refreshSaveSlots();
      setStatus("存档已删除。");
    } catch {
      setStatus("删除存档失败，请稍后重试。");
    } finally {
      setSaveWorking(false);
    }
  }

  async function onStart(overrides?: StartOverrides): Promise<void> {
    if (!bootstrap) return;
    if (isStreaming || isGenerating) return;
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
      }, async (event: GameStreamEvent) => {
        if (event.type === "meta") {
          setStatus("本局调参已同步，继续推进叙事...");
          return;
        }
        if (event.type === "started") {
          setRun(event.data.run);
          runRef.current = event.data.run;
          setTurns([]);
          setShowGrowthFocus(false);
          setExpandedOriginIds(new Set());
          setStatus(event.data.run.opening?.status === "pending" ? "身世正在显现..." : "角色已开局。");
          return;
        }
        if (event.type === "turn") {
          appendTurn(event.data.record);
          setStatus(`人生推进中...(${event.data.index + 1}/${event.data.total})`);
          return;
        }
        if (event.type === "done") {
          if (event.data.turns) setTurns(event.data.turns);
          const mergedRun = event.data.run;
          const mergedPhase = phaseOf(mergedRun);
          setRun(mergedRun);
          runRef.current = mergedRun;
          if (mergedPhase === "ended") {
            setStatus("本局结束。");
            setShowEndingModal(true);
          } else if (needsGrowthFocus(mergedRun)) {
            setStatus("身世已写就，踏入人生以确定此阶段的积累。");
          } else if (mergedRun.nextMilestoneChoice && mergedPhase === "waiting_decision") {
            setStatus("新的抉择出现。");
          } else {
            setStatus("已就绪，点击“推进年份”。");
          }
          return;
        }
        if (event.type === "error") {
          throw new Error(event.data.message);
        }
      });
    } catch (error) {
      if (isServerBusyError(error)) {
        setAutoAdvance(false);
        setShowBusyModal(true);
        setStatus("服务器繁忙，请稍后重试。");
      } else {
        setStatus("开局暂不可用，请检查本局环境后重试。");
      }
    } finally {
      setIsStreaming(false);
    }
  }

  async function onRandomStart(): Promise<void> {
    if (!bootstrap) return;
    if (isStreaming || isGenerating) return;
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

  async function onAdvance(): Promise<void> {
    if (!run) return;
    if (isStreaming) return;
    if (!canAdvance(run)) {
      setAutoAdvance(false);
      return;
    }
    const runPhase = phaseOf(run);
    if (runPhase === "ended") {
      setStatus("本局已结束。");
      return;
    }
    if ((activeDecision || activeSurvivalCrisis) && runPhase === "waiting_decision") {
      setStatus("请先完成当前抉择。");
      return;
    }
    try {
      setStatus("推进年份中...");
      if (isGeneratingRef.current) {
        setStatus("等待命运流转中...");
        return;
      }
      await runStepGeneration();
    } catch (error) {
      if (isServerBusyError(error)) {
        setAutoAdvance(false);
        setShowBusyModal(true);
        setStatus("服务器繁忙，请稍后重试。");
      } else {
        setStatus("暂时无法推进，请稍后重试。");
      }
    }
  }

  async function onDecision(decision: string): Promise<void> {
    if (!run) return;
    if (isStreaming || isGeneratingRef.current) return;
    const currentRun = run;
    const decisionAge = activeDecision?.age ?? currentRun.age;
    try {
      resetPendingFlowState();
      const optimisticRun: PublicRunState = {
        ...currentRun,
        nextMilestoneChoice: undefined,
        phase: "generating"
      };
      setRun(optimisticRun);
      runRef.current = optimisticRun;
      setStatus("命运流转中...");
      await runStepGeneration(decision, decisionAge);
    } catch (error) {
      setRun(currentRun);
      runRef.current = currentRun;
      if (isServerBusyError(error)) {
        setAutoAdvance(false);
        setShowBusyModal(true);
        setStatus("服务器繁忙，请稍后重试。");
      } else {
        setStatus("暂时无法完成抉择，请稍后重试。");
      }
    }
  }

  async function onSurvivalChoice(choice: SurvivalChoice): Promise<void> {
    if (!run || !activeSurvivalCrisis || isStreaming || isGeneratingRef.current) return;
    const currentRun = run;
    try {
      resetPendingFlowState();
      const optimisticRun: PublicRunState = {
        ...currentRun,
        survivalCrisis: undefined,
        phase: "generating"
      };
      setRun(optimisticRun);
      runRef.current = optimisticRun;
      setStatus("在生死之间挣扎...");
      await runStepGeneration(undefined, undefined, choice, activeSurvivalCrisis.id);
    } catch (error) {
      setRun(currentRun);
      runRef.current = currentRun;
      if (isServerBusyError(error)) {
        setAutoAdvance(false);
        setShowBusyModal(true);
        setStatus("服务器繁忙，请稍后重试。");
      } else {
        setStatus("暂时无法完成求生抉择，请稍后重试。");
      }
    }
  }

  async function onSelectGrowthFocus(focusId: string): Promise<void> {
    const currentRun = runRef.current;
    if (!currentRun || isStreaming || isGeneratingRef.current) return;
    isGeneratingRef.current = true;
    setIsGenerating(true);
    try {
      await stepRunStream({
        runId: currentRun.runId,
        action: "select_growth_focus",
        growthFocusId: focusId,
        requestId: makeStepRequestId(currentRun.runId, "select_growth_focus", ++requestNonceRef.current, focusId)
      }, async (event: GameStreamEvent) => {
        if (event.type === "done") {
          if (event.data.turns) setTurns(event.data.turns);
          setRun(event.data.run);
          runRef.current = event.data.run;
          setShowGrowthFocus(false);
          setStatus("成长方向已确定。");
          return;
        }
        if (event.type === "error") throw new Error(event.data.message);
      });
    } catch {
      setStatus("暂时无法确认成长方向，请稍后重试。");
    } finally {
      isGeneratingRef.current = false;
      setIsGenerating(false);
    }
  }

  async function onGenerateOpening(): Promise<void> {
    const currentRun = runRef.current;
    if (!currentRun || currentRun.opening?.status !== "pending" || isStreaming || isGeneratingRef.current) return;
    isGeneratingRef.current = true;
    setIsGenerating(true);
    setStatus("身世正在显现...");
    try {
      await stepRunStream({
        runId: currentRun.runId,
        action: "generate_opening",
        requestId: makeStepRequestId(currentRun.runId, "generate_opening", ++requestNonceRef.current)
      }, async (event: GameStreamEvent) => {
        if (event.type === "turn") {
          appendTurn(event.data.record);
          return;
        }
        if (event.type === "done") {
          if (event.data.turns) setTurns(event.data.turns);
          setRun(event.data.run);
          runRef.current = event.data.run;
          setShowGrowthFocus(false);
          setStatus("身世已写就。");
          return;
        }
        if (event.type === "error") throw new Error(event.data.message);
      });
    } catch {
      setStatus("暂时无法写就身世，请稍后重试。");
    } finally {
      isGeneratingRef.current = false;
      setIsGenerating(false);
    }
  }

  async function resetRun(): Promise<boolean> {
    if (isStreaming || isGenerating || saveWorking) return false;
    try {
      await resetCurrentRun();
    } catch {
      setStatus("重置失败，请稍后重试。");
      return false;
    }
    setRun(null);
    runRef.current = null;
    setSelectedCards([]);
    setFlippedCards({});
    setStats(defaultStats);
    setTurns([]);
    setShowGrowthFocus(false);
    setExpandedOriginIds(new Set());
    followLatestTimelineRef.current = true;
    resetPendingFlowState();
    setShowEndingModal(false);
    setAutoAdvance(false);
    setStatus(envReady ? "已重开本局，可以开始新的人生。" : "已重开本局，请先确认 Setting 后开局。");
    void refreshBootstrapForReplay();
    return true;
  }

  async function resetAnonymousSave(): Promise<void> {
    if (isStreaming || isGenerating || saveWorking) return;
    const confirmed = window.confirm("这会删除当前匿名档案中的全部人生、存档、抉择分岔和恢复码，且无法恢复。模型配置会保留。确定继续吗？");
    if (!confirmed) return;

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
      setShowGrowthFocus(false);
      setExpandedOriginIds(new Set());
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
    } catch {
      setStatus("匿名存档重置失败，请稍后重试。");
    } finally {
      setSaveWorking(false);
    }
  }

  async function playAgain(): Promise<void> {
    if (await resetRun()) {
      setStatus(envReady ? "再来一把！可以开始新的人生。" : "再来一把！请先确认 Setting 后开局。");
    }
  }

  useEffect(() => {
    if (!autoAdvance) return;
    if (!run) return;
    if (run.ended || phaseOf(run) === "ended") {
      setAutoAdvance(false);
      return;
    }
    if (isStreaming || isGenerating) return;
    if ((activeDecision || activeSurvivalCrisis) && phaseOf(run) === "waiting_decision") {
      setStatus("自动流转已暂停，等待抉择。");
      return;
    }
    if (!canAdvance(run)) {
      setAutoAdvance(false);
      return;
    }
    const timer = window.setTimeout(() => {
      void onAdvance();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [autoAdvance, run, timeline.length, activeDecision, activeSurvivalCrisis, isStreaming, isGenerating]);

  if (!bootstrap) {
    return <main className="app"><p>{status}</p></main>;
  }

  return (
    <main className={`app game-shell world-${worldId}`}>
      <header className="topbar">
        <button className="icon-action" onClick={() => setShowSettings(true)} title="本局设置" aria-label="本局设置">⚙</button>
        <h1>人生重开器</h1>
        <div className="topbar-actions">
          <label className={`auto-flow-toggle ${autoAdvance ? "active" : ""}`}>
            <input
              type="checkbox"
              checked={autoAdvance}
              disabled={Boolean(run && !canAdvance(run))}
              onChange={(e) => setAutoAdvance(e.target.checked)}
            />
            自动流转
          </label>
          <button className="icon-action" disabled={isStreaming || isGenerating} onClick={() => void openSaveManager()} title="存档" aria-label="存档">▣</button>
          <button className="icon-action" disabled={isStreaming || isGenerating || saveWorking} onClick={() => void resetRun()} title="重开本局" aria-label="重开本局">↻</button>
        </div>
      </header>

      <div className="game-content">
        {!run ? (
          <section className="panel start-panel">
          <h2>创建角色</h2>

          <label>
            人设提示词
            <textarea
              rows={4}
              value={personaPrompt}
              onChange={(e) => setPersonaPrompt(e.target.value)}
              placeholder="例如：孤独但强韧，执着追求被认可，希望改变家族命运(至少四个字)。"
            />
          </label>

          <div>
            <p>可用天赋点：{remainingTalentPoints}</p>
            <div className="stats-grid pixel-grid">
              {(Object.keys(statLabels) as StatKey[]).map((key) => (
                <div className="stat-box pixel-stat" key={key}>
                  <strong>{statIcons[key]} {statLabels[key]}</strong>
                  <div className="row">
                    <button onClick={() => changeStat(key, -1)}>-</button>
                    <span>{stats[key]}</span>
                    <button onClick={() => changeStat(key, 1)}>+</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p>抽卡翻牌（可选 {bootstrap.startAllocation.selectedCardMin}-{bootstrap.startAllocation.selectedCardMax}）</p>
            <div className="cards">
              {bootstrap.cardPool.map((card) => {
                const selected = selectedCards.includes(card.id);
                const flipped = Boolean(flippedCards[card.id]);
                return (
                  <div key={card.id} className="flip-wrap">
                    {!flipped ? (
                      <button className="card card-back" onClick={() => flipCard(card.id)}>
                        <strong>???</strong>
                        <small>点击翻牌</small>
                      </button>
                    ) : (
                      <button
                        className={`card ${selected ? "picked" : ""} ${rarityClass(card.rarity)}`}
                        onClick={() => toggleCard(card.id)}
                      >
                        <strong>{card.name}</strong>
                        <small>{card.rarity}</small>
                        <p>{card.description}</p>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="row">
            <button disabled={!canStart || isStreaming || isGenerating} onClick={() => void onStart()}>
              开始游戏
            </button>
            <button className="ghost" disabled={!canRandomStart || isStreaming || isGenerating} onClick={() => void onRandomStart()}>
              随机分配并开始
            </button>
          </div>
          <p className="status">{status}</p>
          </section>
        ) : (
          <section className="run-panel reader-layout">
            <aside className="reader-rail character-rail">
              <div className="rail-title"><small>此生行至</small><strong>{run.age} 岁</strong><span>{run.ageStage.label}</span></div>
              <dl className="stat-list">
                {statKeys.map((key) => {
                  const tier = run.statTiers?.[key] ?? "steady";
                  return <div key={key}><dt>{statIcons[key]} {statLabels[key]}</dt><dd><span>{run.stats[key]}</span><small className={`stat-tier stat-tier-${tier}`}>{run.statTierLabels?.[key] ?? statTierLabels[tier]}</small></dd></div>;
                })}
              </dl>
              <div className="rail-meta"><span>名望 {run.fame}</span><span>{run.outcome === "ongoing" ? "命途未定" : outcomeLabel(run.outcome)}</span></div>
            </aside>

            <section className="story-reader" aria-label="人生叙事">
              <header className="reader-heading"><small>命运纪事</small><h2>{run.age} 岁 · {run.ageStage.label}</h2></header>
              <div
                className="timeline-scroll"
                ref={timelineRef}
                onScroll={(event) => {
                  const target = event.currentTarget;
                  followLatestTimelineRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 24;
                }}
              >
                {timeline.map((item, index) => {
                  const isOrigin = item.kind === "origin";
                  const originExpanded = isOrigin && (needsGrowthFocus(run) || expandedOriginIds.has(item.turnId));
                  return (
                    <article className={`narrative${isOrigin ? " narrative-origin" : ""}${originExpanded ? " is-expanded" : ""}`} key={timelineKey(item)}>
                      <header>
                        {isOrigin ? <><small>命运初卷</small><strong>身世</strong></> : <strong>{item.ageFrom && item.ageFrom < item.age
                          ? `${item.ageFrom}-${item.age}岁`
                          : timeline[index - 1]?.age === item.age
                            ? "同年"
                            : `${item.age}岁`}</strong>}
                        {isOrigin ? (
                          <button
                            className="origin-toggle"
                            type="button"
                            title={originExpanded ? "收起身世" : "展开身世"}
                            aria-label={originExpanded ? "收起身世" : "展开身世"}
                            onClick={() => setExpandedOriginIds((previous) => {
                              const next = new Set(previous);
                              if (originExpanded) next.delete(item.turnId);
                              else next.add(item.turnId);
                              return next;
                            })}
                          >{originExpanded ? "⌃" : "⌄"}</button>
                        ) : null}
                      </header>
                      {(!isOrigin || originExpanded) ? <p>{item.narrative}</p> : null}
                      {isOrigin && originExpanded ? (
                        <div className="origin-talent-tags" aria-label="此生天赋">
                          {run.cards.map((card) => <span className={`asset-chip ${rarityClass(card.rarity)}`} key={card.id} title={card.description}>{card.name}</span>)}
                        </div>
                      ) : null}
                      {!isOrigin ? <div className="delta-row">{extractDeltaLabels(item).map((label, idx) => <small key={`${timelineKey(item)}-${idx}`}>{label}</small>)}</div> : null}
                      {(!isOrigin || originExpanded) ? <NarrativeAssetChanges current={item.narrativeAssetsSnapshot} previous={timeline[index - 1]?.narrativeAssetsSnapshot} /> : null}
                    </article>
                  );
                })}
                {run.opening?.status === "pending" ? (
                  <section className="opening-pending" aria-live="polite">
                    <small>命运初卷</small>
                    <p>身世正在显现，往后的经历会从这里开始。</p>
                    {!isStreaming && !isGenerating ? <button type="button" onClick={() => void onGenerateOpening()}>重新写就身世</button> : null}
                  </section>
                ) : null}
              </div>

              {activeDecision && phaseOf(run) === "waiting_decision" ? (
                <section className="decision-dock">
                  <p>{activeDecision.background ?? "你来到抉择时刻："}</p>
                  <div className="decision-options">
                    {activeDecision.options.map((opt) => (
                      <button key={opt.id} disabled={isStreaming || isGenerating} onClick={() => void onDecision(opt.id)}><strong>{opt.label}</strong><small>{opt.description}</small></button>
                    ))}
                  </div>
                </section>
              ) : null}

              {activeSurvivalCrisis && phaseOf(run) === "waiting_decision" ? (
                <section className="survival-dock" aria-live="polite">
                  <p className="survival-kicker">{activeSurvivalCrisis.age}岁 · {activeSurvivalCrisis.stageLabel}</p>
                  <p>{activeSurvivalCrisis.summary}</p>
                  <div className="survival-options">
                    {activeSurvivalCrisis.choices.map((choice) => (
                      <button
                        key={choice.id}
                        disabled={isStreaming || isGenerating}
                        onClick={() => void onSurvivalChoice(choice.id)}
                      >
                        <strong>{choice.label}</strong>
                        <small>凭 {statLabels[choice.stat]} · {choice.tier === "high" ? "把握十足" : choice.tier === "steady" ? "尚有转机" : "希望渺茫"}</small>
                        <span>{choice.description}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {!run.ended && !(activeDecision && phaseOf(run) === "waiting_decision") && !(activeSurvivalCrisis && phaseOf(run) === "waiting_decision") ? (
                <div className="advance-bar">
                  <button
                    disabled={isStreaming || isGenerating || (needsGrowthFocus(run) ? false : !canAdvance(run))}
                    onClick={() => {
                      if (needsGrowthFocus(run)) {
                        setShowGrowthFocus(true);
                        setStatus("请选择此阶段希望积累的方向。");
                        return;
                      }
                      void onAdvance();
                    }}
                  >{needsGrowthFocus(run) ? "踏入人生" : "继续推进"}</button>
                </div>
              ) : null}

              {run.ended ? (
                <div className="ending">
                  <div className="ending-head"><h3>此生结局</h3><span className={`ending-pill ${run.outcome === "dead" ? "is-dead" : run.outcome === "ascended" ? "is-ascended" : "is-completed"}`}>{endingBadgeText(run)}</span></div>
                  <p className="ending-meta">名望 {run.fame} · {fameTitle(run.fame)}</p>
                  <blockquote className="ending-quote">{run.endingSummary ?? "命运已暂告一段落。"}</blockquote>
                </div>
              ) : null}
              <p className="status">{status}</p>
            </section>

            <aside className="reader-rail fate-rail" aria-label="命运档案">
              <section className="rail-section"><h3>天赋</h3><div className="asset-list">{run.cards.map((card) => <span className={`asset-chip ${rarityClass(card.rarity)}`} key={card.id} title={card.description}>{card.name}</span>)}</div></section>
              <section className="rail-section"><h3>命运人物</h3><div className="asset-list">{(run.narrativeCharacters?.length ?? 0) === 0 ? <small>尚无常驻人物</small> : run.narrativeCharacters!.map((character) => <span className="asset-chip item-chip" key={character.id} title={`${character.role}：${character.description}`}>{character.name}</span>)}</div></section>
              <NarrativeAssetsPanel assets={visibleAssets} />
              <section className="decision-history">
                <div className="decision-history-head"><h3>已作抉择</h3></div>
                {decisionHistory.length === 0 ? <p className="decision-history-empty">尚未走到分岔处。</p> : (
                  <div className="decision-history-list">{decisionHistory.map((entry) => (
                    <article className="decision-history-item" key={entry.id}>
                      <p className="decision-history-meta">{entry.age}岁 · {entry.ageStageLabel}</p>
                      <p className="decision-history-bg">{entry.background || "你走到了命运分岔口。"}</p>
                      <p className="decision-history-choice"><span>{entry.choiceLabel}</span>{entry.choiceDescription}</p>
                      {entry.rollLabels.length > 0 ? <div className="decision-history-rolls">{entry.rollLabels.map((label, idx) => <small key={`${entry.id}-roll-${idx}`}>{label}</small>)}</div> : null}
                    </article>
                  ))}</div>
                )}
              </section>
            </aside>
          </section>
        )}
      </div>

      {showSettings ? (
        <AdminPanel
          onClose={() => setShowSettings(false)}
          bootstrap={bootstrap}
          localApiKey={localApiKey}
          setLocalApiKey={setLocalApiKey}
          localProvider={localProvider}
          setLocalProvider={setLocalProvider}
          onConfirmEnvironment={onConfirmEnvironment}
          canConfirmEnv={canConfirmEnv}
          envReady={envReady}
          worldId={worldId}
          setWorldId={setWorldId}
          difficultyId={difficultyId}
          setDifficultyId={setDifficultyId}
        />
      ) : null}

      {showGrowthFocus && run?.growthFocus && !run.growthFocus.selectedId && !run.ended && run.opening?.status !== "pending" ? (
        <div className="modal-mask" role="dialog" aria-modal="true" aria-label="选择成长方向">
          <div className="modal growth-focus-modal">
            <h2>此阶段的积累</h2>
            <div className="growth-focus-options">
              {run.growthFocus.options.map((focus) => (
                <button key={focus.id} disabled={isStreaming || isGenerating} onClick={() => void onSelectGrowthFocus(focus.id)}>
                  <strong>{focus.label}</strong>
                  <small>{focus.description}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {run?.ended && showEndingModal ? (
        <div className="modal-mask">
          <div className="modal ending-modal">
            <h2>本局结算</h2>
            <div className="ending-summary-top">
              <span className={`ending-pill ${run.outcome === "dead" ? "is-dead" : run.outcome === "ascended" ? "is-ascended" : "is-completed"}`}>
                {outcomeLabel(run.outcome)}
              </span>
              <small>{endingBadgeText(run)}</small>
            </div>
            <p>名望得分：{run.fame}</p>
            <p>称号：{fameTitle(run.fame)}</p>
            <blockquote className="ending-quote ending-quote-modal">
              {run.endingSummary ?? "命运已暂告一段落。"}
            </blockquote>
            <div className="row">
              <button onClick={() => void playAgain()}>再来一把</button>
              <button className="ghost" onClick={() => setShowEndingModal(false)}>关闭</button>
            </div>
          </div>
        </div>
      ) : null}

      {showBusyModal ? (
        <div className="modal-mask">
          <div className="modal ending-modal">
            <h2>提示</h2>
            <p>服务器繁忙，请稍后重试。</p>
            <div className="row">
              <button onClick={() => setShowBusyModal(false)}>我知道了</button>
            </div>
          </div>
        </div>
      ) : null}

      {showSaveModal ? (
        <div className="modal-mask">
          <div className="modal save-modal">
            <h2>存档</h2>
            {run ? (
              <section className="save-section">
                <label>
                  存档名称
                  <input value={saveTitle} maxLength={40} onChange={(event) => setSaveTitle(event.target.value)} placeholder={`${run.age}岁的人生记录`} />
                </label>
                <button disabled={saveWorking || isStreaming || isGenerating} onClick={() => void saveCurrentRun()}>保存当前人生</button>
              </section>
            ) : null}

            {issuedRecoveryCode ? (
              <section className="save-section recovery-issued">
                <small>恢复码</small>
                <code>{issuedRecoveryCode}</code>
              </section>
            ) : null}

            <section className="save-section">
              <h3>当前浏览器的存档</h3>
              {saveSlots.length === 0 ? <p className="save-empty">尚无存档。</p> : (
                <div className="save-list">
                  {saveSlots.map((slot) => (
                    <article className="save-item" key={slot.id}>
                      <div>
                        <strong>{slot.title}</strong>
                        <small>{slot.age}岁 · {slot.kind === "decision" ? "抉择分岔" : slot.ended ? "已结局" : "进行中"} · {formatSaveTime(slot.updatedAt)}</small>
                      </div>
                      <div className="save-actions">
                        <button className="ghost" disabled={saveWorking} onClick={() => void restoreSavedRun(slot.id)}>{slot.kind === "decision" ? "回到分岔" : "恢复"}</button>
                        <button className="icon-action save-delete" disabled={saveWorking} onClick={() => void removeSaveSlot(slot.id)} title="删除存档" aria-label={`删除存档 ${slot.title}`}>×</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="save-section">
              <label>
                恢复码
                <input value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} placeholder="save_..." />
              </label>
              <button disabled={saveWorking || !recoveryCode.trim()} onClick={() => void recoverSavedRun()}>恢复存档</button>
            </section>
            <section className="save-section reset-anonymous-section">
              <h3>匿名档案</h3>
              <p>删除当前浏览器的全部人生记录、存档、分岔和恢复码；模型配置会保留。</p>
              <button className="danger" disabled={saveWorking || isStreaming || isGenerating} onClick={() => void resetAnonymousSave()}>重置匿名存档</button>
            </section>
            <div className="row">
              <button className="ghost" disabled={saveWorking} onClick={() => setShowSaveModal(false)}>关闭</button>
            </div>
          </div>
        </div>
      ) : null}

      <footer className="site-footer">
        <a
          className="repo-link"
          href="https://github.com/Vcity-ci/life_remake"
          target="_blank"
          rel="noreferrer"
        >
          <svg className="repo-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
          <span>Vcity-ci/life_remake</span>
        </a>
      </footer>
    </main>
  );
}
