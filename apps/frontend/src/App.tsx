import React, { useEffect, useMemo, useRef, useState } from "react";
import type { BackgroundCard, DecisionType, ProviderConfig, ProviderLimits, RunState, StartAllocationConfig, StatKey, Stats, TimelineEntry } from "@reroll/shared";
import { AdminPanel } from "./components/AdminPanel";
import { fetchBootstrap, saveGameEnvironment, startRunStream, stepRunStream, type GameStreamEvent } from "./lib/api";
import { getOrCreateClientId, readLocalProviderConfig, writeLocalProviderConfig } from "./lib/localConfig";

interface BootstrapState {
  deployMode: "local" | "cloud";
  worlds: Array<{ id: string; name: string; intro: string }>;
  difficulties: Array<{ id: string; name: string; description: string }>;
  cardPool: BackgroundCard[];
  talentPointTotal: number;
  startAllocation: StartAllocationConfig;
  runtime: {
    runtimeMode: "cloud" | "local";
    cloud: ProviderConfig;
  };
  limits: ProviderLimits;
}

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

function rarityClass(r: BackgroundCard["rarity"]): string {
  return `rarity-${r}`;
}

function timelineKey(t: TimelineEntry): string {
  return `${t.age}-${t.title}-${t.narrative}`;
}

function formatDeltaLabel(
  stat: StatKey,
  delta: number
): string {
  const name = statLabels[stat];
  const sign = delta > 0 ? "+" : "";
  return `${name}${sign}${delta}`;
}

function extractDeltaLabels(entry: TimelineEntry): string[] {
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

export default function App(): React.JSX.Element {
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [runtimeMode, setRuntimeMode] = useState<"cloud" | "local">("local");
  const [worldId, setWorldId] = useState("modern");
  const [difficultyId, setDifficultyId] = useState("standard");
  const [personaPrompt, setPersonaPrompt] = useState("");
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats>(defaultStats);
  const [run, setRun] = useState<RunState | null>(null);
  const [status, setStatus] = useState("初始化中...");
  const [showSettings, setShowSettings] = useState(false);
  const [envReady, setEnvReady] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [showEndingModal, setShowEndingModal] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const [flippedCards, setFlippedCards] = useState<Record<string, boolean>>({});

  const [localApiKey, setLocalApiKey] = useState("");
  const [localProvider, setLocalProvider] = useState<ProviderConfig>({
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
        if (localCfg) setLocalProvider(localCfg);
        else setLocalProvider(boot.runtime.cloud);

        setStatus("请先在 Setting 确认本局环境，然后开始人生。");
      } catch (error) {
        setStatus(`初始化失败：${String(error)}`);
      }
    }
    void init();
  }, []);

  useEffect(() => {
    writeLocalProviderConfig(localProvider);
  }, [localProvider]);

  useEffect(() => {
    if (!timelineRef.current) return;
    timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
  }, [timeline]);

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

  const usedTalentPoints = useMemo(
    () => stats.intelligence + stats.charisma + stats.physique + stats.family + stats.fortune,
    [stats]
  );
  const remainingTalentPoints = useMemo(
    () => (bootstrap ? Math.max(0, bootstrap.talentPointTotal - usedTalentPoints) : 0),
    [bootstrap, usedTalentPoints]
  );

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
      setStatus(`本局环境已确认。Token范围 ${rsp.limits.maxTokens.min}-${rsp.limits.maxTokens.max}。`);
      setShowSettings(false);
    } catch (error) {
      setEnvReady(false);
      setStatus(`环境配置失败：${String(error)}`);
    }
  }

  async function onStart(): Promise<void> {
    if (!bootstrap) return;
    if (isStreaming) return;
    try {
      setIsStreaming(true);
      setStatus("人生推进中（流式生成）...");
      await startRunStream({
        clientId,
        worldId,
        difficultyId,
        personaPrompt,
        talentPointTotal: bootstrap.talentPointTotal,
        stats,
        selectedCardIds: selectedCards
      }, async (event: GameStreamEvent) => {
        if (event.type === "meta") {
          setStatus("本局调参已同步，继续推进叙事...");
          return;
        }
        if (event.type === "started") {
          setRun(event.data.run);
          setTimeline([]);
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
          } else if (event.data.run.nextMilestoneChoice) {
            setStatus("岁月流逝中，新的抉择正在逼近。");
          } else {
            setStatus("年份推进完成，继续推进。");
          }
          return;
        }
        if (event.type === "error") {
          throw new Error(event.data.message);
        }
      });
    } catch (error) {
      setStatus(`开局失败：${String(error)}`);
    } finally {
      setIsStreaming(false);
    }
  }

  async function onAdvance(): Promise<void> {
    if (!run) return;
    if (isStreaming) return;
    try {
      setIsStreaming(true);
      setStatus("继续推进年份中（流式生成）...");
      await stepRunStream({ runId: run.runId, decision: "balanced" }, async (event: GameStreamEvent) => {
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
          } else if (event.data.run.nextMilestoneChoice) {
            setStatus("新的抉择出现。");
          } else {
            setStatus("年份推进完成，继续推进。");
          }
          return;
        }
        if (event.type === "error") {
          throw new Error(event.data.message);
        }
      });
    } catch (error) {
      setStatus(`推进失败：${String(error)}`);
    } finally {
      setIsStreaming(false);
    }
  }

  async function onDecision(decision: DecisionType): Promise<void> {
    if (!run) return;
    if (isStreaming) return;
    try {
      setIsStreaming(true);
      setStatus("命运流转中（流式生成）...");
      await stepRunStream({ runId: run.runId, decision }, async (event: GameStreamEvent) => {
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
          setStatus(event.data.run.ended ? "本局结束。" : "时间继续向前，等待下一个分岔点。");
          if (event.data.run.ended) setShowEndingModal(true);
          return;
        }
        if (event.type === "error") {
          throw new Error(event.data.message);
        }
      });
    } catch (error) {
      setStatus(`推进失败：${String(error)}`);
    } finally {
      setIsStreaming(false);
    }
  }

  function resetRun(): void {
    setRun(null);
    setSelectedCards([]);
    setFlippedCards({});
    setStats(defaultStats);
    setTimeline([]);
    setShowEndingModal(false);
    setEnvReady(false);
    setStatus("已重置，请重新确认 Setting 并开局。");
  }

  function playAgain(): void {
    resetRun();
    setStatus("再来一把！请重新确认 Setting 并开局。");
  }

  if (!bootstrap) {
    return <main className="app"><p>{status}</p></main>;
  }

  return (
    <main className="app game-shell">
      <header className="topbar">
        <button className="setting-btn" onClick={() => setShowSettings(true)}>⚙ Setting</button>
        <h1>人生重开器</h1>
        <button className="ghost" onClick={resetRun}>重开</button>
      </header>

      {!run ? (
        <section className="panel start-panel">
          <h2>创建角色</h2>

          <label>
            人设提示词
            <textarea
              rows={4}
              value={personaPrompt}
              onChange={(e) => setPersonaPrompt(e.target.value)}
              placeholder="例如：孤独但强韧，执着追求被认可，希望改变家族命运。"
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

          <button disabled={!canStart || isStreaming} onClick={() => void onStart()}>
            开始游戏
          </button>
          <p className="status">{status}</p>
        </section>
      ) : (
        <section className="panel run-panel">
          <h2>{run.age} 岁 · {run.ageStage.label}</h2>
          <p>
            {statIcons.intelligence}智力 {run.stats.intelligence} · {statIcons.charisma}魅力 {run.stats.charisma} · {statIcons.family}家境 {run.stats.family} · {statIcons.fortune}气运 {run.stats.fortune}
            · {statIcons.physique}体魄 {run.stats.physique}
          </p>
          <p>
            名望：{run.fame} · 结局状态：{run.outcome === "ongoing" ? "进行中" : run.outcome === "dead" ? "死亡" : "飞升"}
          </p>

          <div className="timeline-scroll" ref={timelineRef}>
            {timeline.slice(-14).map((item) => (
              <article className="narrative" key={timelineKey(item)}>
                <strong>{item.age}岁 · {item.ageStage.label} · {item.title}</strong>
                <div className="delta-row">
                  {extractDeltaLabels(item).length === 0 ? (
                    <small>属性变化：无</small>
                  ) : (
                    extractDeltaLabels(item).map((label, idx) => (
                      <small key={`${timelineKey(item)}-${idx}`}>{label}</small>
                    ))
                  )}
                </div>
                <p>{item.narrative}</p>
              </article>
            ))}
          </div>

          {run.nextMilestoneChoice ? (
            <div>
              <p>{run.nextMilestoneChoice.background ?? "你来到抉择时刻："}</p>
              <div className="row">
                {run.nextMilestoneChoice.options.map((opt) => (
                  <button key={opt.id} disabled={isStreaming} onClick={() => void onDecision(opt.id)}>
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="row">
                {run.nextMilestoneChoice.options.map((opt) => (
                  <small key={`${opt.id}-desc`}>{opt.label}：{opt.description}</small>
                ))}
              </div>
            </div>
          ) : null}

          {!run.nextMilestoneChoice && !run.ended ? (
            <div className="row">
              <button disabled={isStreaming} onClick={() => void onAdvance()}>继续推进年份</button>
            </div>
          ) : null}

          {run.ended ? (
            <div className="ending">
              <h3>结局</h3>
              <p>{run.endingSummary}</p>
            </div>
          ) : null}

          <p className="status">{status}</p>
        </section>
      )}

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

      {run?.ended && showEndingModal ? (
        <div className="modal-mask">
          <div className="modal ending-modal">
            <h2>本局结算</h2>
            <p>结局：{run.outcome === "dead" ? "死亡" : run.outcome === "ascended" ? "飞升" : "终局"}</p>
            <p>名望得分：{run.fame}</p>
            <p>称号：{fameTitle(run.fame)}</p>
            <p>终局总结：{run.endingSummary ?? "命运已暂告一段落。"}</p>
            <div className="row">
              <button onClick={playAgain}>再来一把</button>
              <button className="ghost" onClick={() => setShowEndingModal(false)}>关闭</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
