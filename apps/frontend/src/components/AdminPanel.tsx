import React, { useEffect, useMemo, useState } from "react";
import type {
  AdminConfigPayload,
  BackgroundCard,
  ContentBundle,
  DifficultyConfig,
  ProviderConfig,
  ProviderLimits,
  WorldConfig
} from "@reroll/shared";
import { fetchAdminConfig, fetchAdminContent, saveAdminConfig, saveAdminContent } from "../lib/api";
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
  baseUrl: "https://api.openai.com/v1",
  model: "",
  apiPath: "/chat/completions",
  temperature: 0.9,
  maxTokens: 700,
  timeoutMs: 45000
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
    setWorldId,
    difficultyId,
    setDifficultyId
  } = props;

  const [tab, setTab] = useState<"session" | "model" | "content">("session");
  const [cloudProvider, setCloudProvider] = useState<ProviderConfig>(defaultProvider);
  const [limits, setLimits] = useState<ProviderLimits>(bootstrap.limits);
  const [content, setContent] = useState<ContentBundle>(defaultContent());
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
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
  }, []);

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
          <button className={tab === "model" ? "selected" : "ghost"} onClick={() => setTab("model")}>模型配置</button>
          <button className={tab === "content" ? "selected" : "ghost"} onClick={() => setTab("content")}>内容配置</button>
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

              <label>
                难度
                <select value={difficultyId} onChange={(e) => setDifficultyId(e.target.value)}>
                  {bootstrap.difficulties.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="row">
              <button disabled={!canConfirmEnv} onClick={() => void onConfirmEnvironment()}>确认本局环境</button>
              <small>{envReady ? "已确认" : "未确认"}</small>
            </div>
          </section>
        ) : null}

        {tab === "model" ? (
          <section>
            <p>全局云端模型参数（部署级）</p>
            <ProviderConfigForm value={cloudProvider} onChange={setCloudProvider} limits={limits} />
            <div className="row">
              <button onClick={() => void onSaveRuntime()}>保存模型配置</button>
            </div>
          </section>
        ) : null}

        {tab === "content" ? (
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
              <summary>难度</summary>
              <div className="row between"><span>新增/编辑/删除</span><button onClick={addDifficulty}>新增</button></div>
              {content.difficulties.map((d, i) => (
                <div key={`${d.id}-${i}`} className="editor-card">
                  <label>ID<input value={d.id} onChange={(e) => patchDifficulty(i, { id: e.target.value })} /></label>
                  <label>名称<input value={d.name} onChange={(e) => patchDifficulty(i, { name: e.target.value })} /></label>
                  <label>描述<textarea value={d.description} onChange={(e) => patchDifficulty(i, { description: e.target.value })} /></label>
                  <button className="ghost" onClick={() => removeDifficulty(i)}>删除</button>
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
