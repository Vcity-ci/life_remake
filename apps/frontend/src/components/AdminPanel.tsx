import React, { useEffect, useMemo, useState } from "react";
import type {
  AdminConfigPayload,
  BackgroundCard,
  ContentBundle,
  DifficultyConfig,
  ModelUsageOperation,
  ModelUsageSummary,
  ProviderConfig,
  ProviderLimits,
  WorldConfig
} from "@reroll/shared";
import { fetchAdminConfig, fetchAdminContent, fetchModelUsage, saveAdminConfig, saveAdminContent } from "../lib/api";
import { ProviderConfigForm } from "./ProviderConfigForm";

interface Props {
  onClose: () => void;
  bootstrap: {
    deployMode: "local" | "cloud";
    worlds: Array<{ id: string; name: string; intro: string }>;
    difficulties: Array<{ id: string; name: string; description: string }>;
    limits: ProviderLimits;
  };
  localApiKey: string;
  setLocalApiKey: (key: string) => void;
  localProvider: ProviderConfig;
  setLocalProvider: (cfg: ProviderConfig) => void;
  onConfirmEnvironment: () => Promise<void>;
  canConfirmEnv: boolean;
  envReady: boolean;
  worldId: string;
  setWorldId: (id: string) => void;
  difficultyId: string;
  setDifficultyId: (id: string) => void;
}

const defaultProvider: ProviderConfig = {
  provider: "openai-compatible",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  apiPath: "/chat/completions",
  temperature: 0.9,
  maxTokens: 1824,
  timeoutMs: 45000,
  reasoningEffort: "minimal"
};

function defaultContent(): ContentBundle {
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

const usageOperationLabels: Record<ModelUsageOperation, string> = {
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

function formatUsageNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatUsageDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} 秒`;
}

export function AdminPanel(props: Props): React.JSX.Element {
  const {
    onClose,
    bootstrap,
    localApiKey,
    setLocalApiKey,
    localProvider,
    setLocalProvider,
    onConfirmEnvironment,
    canConfirmEnv,
    envReady,
    worldId,
    setWorldId
  } = props;

  const [tab, setTab] = useState<"session" | "model" | "content">("session");
  const [cloudProvider, setCloudProvider] = useState<ProviderConfig>(defaultProvider);
  const [limits, setLimits] = useState<ProviderLimits>(bootstrap.limits);
  const [content, setContent] = useState<ContentBundle>(defaultContent());
  const [modelUsage, setModelUsage] = useState<ModelUsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageError, setUsageError] = useState("");
  const [status, setStatus] = useState<string>("");
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

        const normalizedContent: ContentBundle = {
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
      } catch (error) {
        setStatus(`读取配置失败：${String(error)}`);
      } finally {
        setLoading(false);
      }
    }
    void init();
  }, [cloudLocked]);

  async function loadModelUsage(): Promise<void> {
    setUsageLoading(true);
    setUsageError("");
    try {
      setModelUsage(await fetchModelUsage());
    } catch {
      setUsageError("暂时无法读取本会话的模型用量。");
    } finally {
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

  const runtimePayload: AdminConfigPayload = useMemo(
    () => ({
      runtime: {
        runtimeMode: bootstrap.deployMode,
        cloud: cloudProvider
      }
    }),
    [bootstrap.deployMode, cloudProvider]
  );

  async function onSaveRuntime(): Promise<void> {
    try {
      setStatus("保存模型配置中...");
      const saved = await saveAdminConfig(runtimePayload);
      setCloudProvider(saved.runtime.cloud);
      setLimits(saved.limits);
      setStatus("模型配置已保存。后续新开局生效。");
    } catch (error) {
      setStatus(`保存失败：${String(error)}`);
    }
  }

  async function onSaveContent(): Promise<void> {
    try {
      setStatus("保存内容配置中...");
      const saved = await saveAdminContent(content);
      setContent(saved);
      setStatus("内容配置已保存并备份到 storage/backups。新开局生效。");
    } catch (error) {
      setStatus(`保存失败：${String(error)}`);
    }
  }

  function patchWorld(index: number, patch: Partial<WorldConfig>): void {
    setContent((prev) => {
      const next = [...prev.worlds];
      next[index] = { ...next[index], ...patch };
      return { ...prev, worlds: next };
    });
  }

  function patchCard(index: number, patch: Partial<BackgroundCard>): void {
    setContent((prev) => {
      const next = [...prev.cards];
      next[index] = { ...next[index], ...patch };
      return { ...prev, cards: next };
    });
  }

  function patchDifficulty(index: number, patch: Partial<DifficultyConfig>): void {
    setContent((prev) => {
      const next = [...prev.difficulties];
      next[index] = { ...next[index], ...patch };
      return { ...prev, difficulties: next };
    });
  }

  function removeWorld(index: number): void {
    setContent((prev) => ({ ...prev, worlds: prev.worlds.filter((_, i) => i !== index) }));
  }

  function removeCard(index: number): void {
    setContent((prev) => ({ ...prev, cards: prev.cards.filter((_, i) => i !== index) }));
  }

  function removeDifficulty(index: number): void {
    setContent((prev) => ({ ...prev, difficulties: prev.difficulties.filter((_, i) => i !== index) }));
  }

  function addWorld(): void {
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

  function addCard(): void {
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

  function addDifficulty(): void {
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
    return (
      <div className="modal-mask">
        <div className="modal"><p>Setting 加载中...</p></div>
      </div>
    );
  }

  return (
    <div className="modal-mask">
      <div className="modal admin-modal">
        <h2>Setting 控制台</h2>

        <div className="row admin-tabs">
          <button className={tab === "session" ? "selected" : "ghost"} onClick={() => setTab("session")}>会话配置</button>
          {!cloudLocked ? (
            <button className={tab === "model" ? "selected" : "ghost"} onClick={() => setTab("model")}>模型配置</button>
          ) : null}
          {!cloudLocked ? (
            <button className={tab === "content" ? "selected" : "ghost"} onClick={() => setTab("content")}>内容配置</button>
          ) : null}
        </div>

        {tab === "session" ? (
          <section>
            <p>本局环境与玩法参数（先确认再开局）</p>

            <p>当前部署链路：{bootstrap.deployMode === "cloud" ? "云端体验站" : "本地部署"}</p>

            {bootstrap.deployMode === "local" ? (
              <>
                <label>
                  本地 API Key
                  <input
                    type="password"
                    value={localApiKey}
                    onChange={(e) => setLocalApiKey(e.target.value)}
                    placeholder="输入你自己的 key（仅本会话）"
                  />
                </label>
                <ProviderConfigForm value={localProvider} onChange={setLocalProvider} limits={limits} compact />
              </>
            ) : (
              <p>云端模式下将使用服务器保存的模型配置。</p>
            )}

            <div className="grid compact-grid">
              <label>
                世界观
                <select value={worldId} onChange={(e) => setWorldId(e.target.value)}>
                  {bootstrap.worlds.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="row">
              <button disabled={!canConfirmEnv} onClick={() => void onConfirmEnvironment()}>确认本局环境</button>
              <small>{envReady ? "已确认" : "未确认"}</small>
            </div>

            <section className="model-usage-panel" aria-live="polite">
              <div className="row between model-usage-heading">
                <div>
                  <h3>模型用量</h3>
                  <small>仅统计本浏览器会话中服务商已上报的 Token，不估算费用或账户余额。</small>
                </div>
                <button className="ghost" disabled={usageLoading} onClick={() => void loadModelUsage()}>
                  {usageLoading ? "读取中" : "刷新"}
                </button>
              </div>

              {usageError ? <p className="model-usage-empty">{usageError}</p> : null}
              {!usageError && usageLoading && !modelUsage ? <p className="model-usage-empty">正在读取本会话用量...</p> : null}
              {!usageError && !usageLoading && modelUsage?.entries.length === 0 ? <p className="model-usage-empty">尚无模型调用记录。</p> : null}
              {modelUsage && modelUsage.entries.length > 0 ? (
                <>
                  <dl className="model-usage-totals">
                    <div><dt>实际请求</dt><dd>{formatUsageNumber(modelUsage.totals.requestCount)}</dd></div>
                    <div><dt>已上报 Token</dt><dd>{formatUsageNumber(modelUsage.totals.totalTokens)}</dd></div>
                    <div><dt>输入 / 输出</dt><dd>{formatUsageNumber(modelUsage.totals.inputTokens)} / {formatUsageNumber(modelUsage.totals.outputTokens)}</dd></div>
                    <div><dt>未上报 / 缓存命中</dt><dd>{formatUsageNumber(modelUsage.totals.unreportedUsageCount)} / {formatUsageNumber(modelUsage.totals.cacheHitCount)}</dd></div>
                  </dl>
                  <div className="model-usage-list">
                    {modelUsage.entries.map((entry) => (
                      <div key={`${entry.runId ?? "session"}-${entry.model}-${entry.transport}-${entry.operation}`} className="model-usage-entry">
                        <div>
                          <strong>{usageOperationLabels[entry.operation]}</strong>
                          <small>{entry.model} · {entry.transport === "responses" ? "Responses" : "Chat Completions"}</small>
                        </div>
                        <small>
                          {entry.requestCount} 次请求 · {entry.inputTokens} / {entry.outputTokens} / {entry.totalTokens} Token · {formatUsageDuration(entry.durationMs)}
                          {entry.failureCount ? ` · ${entry.failureCount} 次失败` : ""}
                          {entry.unreportedUsageCount ? ` · ${entry.unreportedUsageCount} 次未上报` : ""}
                          {entry.cacheHitCount ? ` · ${entry.cacheHitCount} 次缓存` : ""}
                        </small>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </section>
          </section>
        ) : null}

        {!cloudLocked && tab === "model" ? (
          <section>
            <p>全局云端模型参数（部署级）</p>
            <ProviderConfigForm value={cloudProvider} onChange={setCloudProvider} limits={limits} />
            <div className="row">
              <button onClick={() => void onSaveRuntime()}>保存模型配置</button>
            </div>
          </section>
        ) : null}

        {!cloudLocked && tab === "content" ? (
          <section>
            <details open>
              <summary>世界观</summary>
              <div className="row between"><span>新增/编辑/删除</span><button onClick={addWorld}>新增</button></div>
              {content.worlds.map((w, i) => (
                <div key={`${w.id}-${i}`} className="editor-card">
                  <label>ID<input value={w.id} onChange={(e) => patchWorld(i, { id: e.target.value })} /></label>
                  <label>名称<input value={w.name} onChange={(e) => patchWorld(i, { name: e.target.value })} /></label>
                  <label>简介<textarea value={w.intro} onChange={(e) => patchWorld(i, { intro: e.target.value })} /></label>
                  <label>风格<textarea value={w.stylePrompt} onChange={(e) => patchWorld(i, { stylePrompt: e.target.value })} /></label>
                  <button className="ghost" onClick={() => removeWorld(i)}>删除</button>
                </div>
              ))}
            </details>

            <details>
              <summary>能力卡</summary>
              <div className="row between"><span>新增/编辑/删除</span><button onClick={addCard}>新增</button></div>
              {content.cards.map((card, i) => (
                <div key={`${card.id}-${i}`} className="editor-card">
                  <label>ID<input value={card.id} onChange={(e) => patchCard(i, { id: e.target.value })} /></label>
                  <label>名称<input value={card.name} onChange={(e) => patchCard(i, { name: e.target.value })} /></label>
                  <label>描述<textarea value={card.description} onChange={(e) => patchCard(i, { description: e.target.value })} /></label>
                  <button className="ghost" onClick={() => removeCard(i)}>删除</button>
                </div>
              ))}
            </details>

            <details>
              <summary>提示词包</summary>
              <label>systemCore<textarea rows={4} value={content.promptPack.systemCore ?? ""} onChange={(e) => setContent((prev) => ({ ...prev, promptPack: { ...prev.promptPack, systemCore: e.target.value } }))} /></label>
              <label>immersionRules<textarea rows={4} value={content.promptPack.immersionRules ?? ""} onChange={(e) => setContent((prev) => ({ ...prev, promptPack: { ...prev.promptPack, immersionRules: e.target.value } }))} /></label>
              <label>yearNormalRule<textarea rows={3} value={content.promptPack.yearNormalRule ?? ""} onChange={(e) => setContent((prev) => ({ ...prev, promptPack: { ...prev.promptPack, yearNormalRule: e.target.value } }))} /></label>
              <label>yearMinorRule<textarea rows={3} value={content.promptPack.yearMinorRule ?? ""} onChange={(e) => setContent((prev) => ({ ...prev, promptPack: { ...prev.promptPack, yearMinorRule: e.target.value } }))} /></label>
              <label>milestoneRule<textarea rows={3} value={content.promptPack.milestoneRule ?? ""} onChange={(e) => setContent((prev) => ({ ...prev, promptPack: { ...prev.promptPack, milestoneRule: e.target.value } }))} /></label>
              <label>storyConstraint<textarea rows={3} value={content.promptPack.storyConstraint ?? ""} onChange={(e) => setContent((prev) => ({ ...prev, promptPack: { ...prev.promptPack, storyConstraint: e.target.value } }))} /></label>
              <label>endingHint<textarea rows={3} value={content.promptPack.endingHint ?? ""} onChange={(e) => setContent((prev) => ({ ...prev, promptPack: { ...prev.promptPack, endingHint: e.target.value } }))} /></label>
            </details>

            <div className="row">
              <button onClick={() => void onSaveContent()}>保存内容配置</button>
            </div>
          </section>
        ) : null}

        <div className="row">
          <button className="ghost" onClick={onClose}>关闭</button>
        </div>

        {status ? <p className="status">{status}</p> : null}
      </div>
    </div>
  );
}
