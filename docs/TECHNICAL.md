# 技术文档（v0.9.0）

## 1. 项目定位
- 项目：AI 人生重开器 + 跑团
- 形态：前后端分离 Monorepo（Node.js + TypeScript）
- 核心能力：
  - 本地/云端双部署链路
  - 年份推进状态机 + 关键抉择节点
  - AI 叙事生成与 A/B/C 风险收益语义
  - 可编辑内容配置与运行配置持久化

## 2. 技术栈
- 前端：React 18 + Vite 5 + TypeScript
- 后端：Express 4 + TypeScript + tsx
- 共享类型：`@reroll/shared`
- AI SDK：`openai`（OpenAI Compatible）
- 校验：`zod`
- 随机性：`seedrandom`
- 脚本：Windows `*.bat` + npm scripts（workspace）

## 3. 目录结构
```text
apps/
  backend/        # API、状态机、AI 调用
  frontend/       # 游戏 UI、Setting 控制台
packages/
  shared/         # 前后端共享类型
data/             # 种子配置与设定库
storage/          # 运行期持久化与备份
docs/             # 项目文档
skills/ai-gm/     # 提示词规则包（种子）
```

## 4. 运行与构建
- 根脚本：
  - `npm run dev`：并行启动前后端
  - `npm run dev:local`：本地链路（`start-local.bat`）
  - `npm run dev:cloud`：云端链路（`start-cloud.bat`）
  - `npm run build`：构建 shared/backend/frontend
- 前端固定端口：`5173`（strictPort）
- 后端默认端口：`4000`

## 5. 环境变量（后端）
文件：`apps/backend/.env`
- `PORT=4000`
- `DEPLOY_MODE=local|cloud`
- `CLOUD_MODEL_API_KEY=...`
- `DEFAULT_PROVIDER_BASE_URL=https://api.openai.com/v1`
- `DEFAULT_PROVIDER_MODEL=gpt-4.1-mini`
- `DEFAULT_PROVIDER_API_PATH=/chat/completions`
- `DEFAULT_PROVIDER_TEMPERATURE=0.9`
- `DEFAULT_PROVIDER_MAX_TOKENS=700`
- `DEFAULT_PROVIDER_TIMEOUT_MS=45000`
- `CORS_ORIGIN=http://localhost:5173`
- `DEBUG_MODEL_CALLS=0|1`

## 6. API 概览
基地址：`http://localhost:4000`

### 6.1 元数据与健康
- `GET /api/meta/bootstrap`
  - 返回：`deployMode/worlds/difficulties/cardPool/talentPointTotal/startAllocation/runtime/limits`
- `GET /health`
  - 返回：`{ ok: true }`

### 6.2 会话环境
- `POST /api/game/env`
  - 入参：`clientId/localApiKey/localProviderConfig`
  - 规则：
    - cloud 模式禁止传本地 key
    - local 模式必须有本地 key

### 6.3 游戏流程
- `POST /api/game/start`
  - 入参：`clientId/worldId/difficultyId/personaPrompt/talentPointTotal/stats/selectedCardIds`
  - 返回：`run + timelineChunk + startAllocation`
- `POST /api/game/step`
  - 入参：`runId/decision?`
  - 返回：`run + timelineChunk + startAllocation`
  - 当存在 `nextMilestoneChoice` 且缺少 `decision` 时会报错
- `POST /api/game/start/stream`
  - 入参同 `start`
  - 响应：`application/x-ndjson`
  - 事件：`started -> timeline* -> meta -> milestone? -> done`（失败时 `error`）
  - `started` 阶段不会下发 milestone，避免前端先挂载 fallback 抉择文案
- `POST /api/game/step/stream`
  - 入参同 `step`
  - 响应：`application/x-ndjson`
  - 事件：`timeline* -> meta -> milestone? -> done`（失败时 `error`）

### 6.4 管理面板
- `GET /api/admin/config`
- `POST /api/admin/config`
- `GET /api/admin/content`
- `POST /api/admin/content`

## 7. 核心数据模型
来源：`packages/shared/src/index.ts`
- `Stats`：`intelligence/charisma/family/fortune/physique`
- `RunState`：
  - 运行态：年龄、阶段、属性、历史、时间线分块、结束标记
  - 结局态：`outcome(ongoing/dead/ascended)`、`fame`、`ascension`、`deathCause`
- `MilestoneChoice`：固定 `safe/balanced/risky`
- `ProviderConfig`：OpenAI Compatible 参数集合

## 8. 状态机与算法要点
实现：`apps/backend/src/engine.ts`
- 开局：
  - 属性输入每项 `0~10`
  - 总点必须等于 `talentPointTotal`
  - `talentPointTotal` 必须落在 `gameplayTuning.bootstrap.talentPointMin~talentPointMax`
  - 选卡数量必须落在 `gameplayTuning.bootstrap.selectedCardMin~selectedCardMax`
  - 叠加已选卡牌 modifiers
  - 创建 run 时冻结 `tuningSnapshot`，本局后续统一按该快照计算
- 年份推进（`autoAdvanceToCheckpoint`）：
  - 每次最多推进 `gameplayTuning.pacing.maxYearsPerChunk` 年
  - 小事件概率：`gameplayTuning.pacing.specialYearChance`
  - 平年概率：`gameplayTuning.pacing.blankYearChance`
  - 普通年与小事件年分别计算属性变化
  - 关键抉择按阶段概率触发：`gameplayTuning.milestone.triggerRateByStage`
  - `minEligibleAge` 前不触发（默认 `5` 岁前禁触发）
  - 连续 `guaranteeYears` 未触发时保底触发（默认 `20` 年）
  - 触发时从 `data/events/faction-events.json`（当前 world）随机抽取事件作为抉择背景种子
  - 每年更新 `fame`
  - 依次判定：死亡 -> 飞升 -> 里程碑 -> 自然终局
- 关键抉择（`applyMilestoneDecisionAndAdvance`）：
  - A/B/C 的成功率、收益、惩罚、死亡加成、risk/reward 元数据来自 `gameplayTuning.decision.profiles`
  - 决策后可直接死亡/飞升，或继续自动推进
- 名望：
  - 由 `gameplayTuning.fame` 的权重与上下界映射计算

## 9. AI 叙事链路
实现：`apps/backend/src/ai.ts`
- 支持两类接口：
  - `/chat/completions`
  - `/responses`
- Prompt 结构：
  - System：核心规则 + 世界观 + 设定摘要 + 约束
  - User：人设、年龄、名望、属性绝对值、年度 delta、风险等级、节点规则
- 限制策略：
  - 文本长度主要由提示词约束（年度/背景 80~150 字）
  - 检测疑似截断时自动续写 20~40 字收束
- 稳定性：
  - 429/503 自动重试（退避）
  - 10 分钟 Prompt 缓存（上限 600）
  - OpenAI client 按 `provider+key` 池化复用
  - milestone 选项文本支持一次强约束重试（JSON-only）
  - milestone 在 AI options ready 后才下发，避免 started 阶段提前显示 fallback
  - 年度叙事空文本时会在 API 层使用种子随机 fallback（`平平无奇的一年` / `平凡但充实的一年`）

## 9.1 叙事输出链路（当前实现）
- 服务端使用分块并发（`NARRATIVE_CONCURRENCY`）生成叙事，并按时间线顺序输出。
- 前端使用 NDJSON 流式读取，收到 `timeline` 即增量渲染，不等待整块返回。
- 开局流式会先发 `started` 事件，确保“先进入局内，再推进年份”。
- 命中抉择时：先完成 milestone AI 文案装配，再发 `milestone` 事件。

## 9.2 性能优化分层决策（2026-05-29）
- 已确认：重型排队系统（Redis/BullMQ）放在云端链路，不进入本地开发默认链路。
- 原因：
  - 本地链路目标是低依赖、快速调试。
  - 云端链路更需要跨实例调度、削峰、重试、可观测与公平队列。
- 结论：响应速度问题与排队策略在云端开发阶段统一推进。

## 10. 内容与配置存储
- 内容主文件：`storage/custom-content.json`
- 内容备份：`storage/backups/content-*.json`
- 运行配置：`storage/runtime-config.json`
- 运行配置备份：`storage/backups/runtime-config-*.json`
- 种子来源：
  - 世界观：`data/worlds/*.json`
  - 卡池：`data/cards.json`
  - 难度：`data/difficulties.json`
  - 提示词：`skills/ai-gm/prompt-pack.json`
- 设定增强源：
  - 世界线：`data/settings/worldlines/*.timeline.json`
  - 阵营：`data/settings/factions/factions.json`
  - 阵营事件：`data/events/faction-events.json`
  - 天赋钩子：`data/talents/talent-cards.json`

## 11. 前端关键行为
- `App.tsx`：
  - 仅保留主流程 UI：人设、加点、翻牌、开始、推进、决策
  - 通过 `Setting` 管理运行环境、模型配置、内容配置
- 本地缓存：
  - `reroll_client_id`
  - `reroll_local_provider_config`
  - 本地 API key 不持久化

## 12. 校验与约束
- `zod` 统一校验请求与内容结构
- 关键约束：
  - `selectedCardIds`（请求壳层）：`1~12`
  - `personaPrompt`：`4~500`
  - `stats`：各项 `0~10`
  - `talentPointTotal`（请求壳层）：`1~200`
  - 实际开局约束由 `gameplayTuning.bootstrap` 再次校验（防止绕过前端）
  - `gameplayTuning` 全量边界和交叉约束见 `docs/CONFIG_GUIDE.md`
  - world/card/difficulty id 必须唯一
  - worlds 必须保留 `modern/ancient/fantasy`
