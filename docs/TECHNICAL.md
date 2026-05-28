# 技术文档（v0.8.0）

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
  - 返回：`deployMode/worlds/difficulties/cardPool/talentPointTotal/runtime/limits`
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
  - 返回：`run + timelineChunk`
- `POST /api/game/step`
  - 入参：`runId/decision?`
  - 返回：`run + timelineChunk`
  - 当存在 `nextMilestoneChoice` 且缺少 `decision` 时会报错

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
  - 总点必须等于 `talentPointTotal(20~30)`
  - 叠加已选卡牌 modifiers
- 年份推进（`autoAdvanceToCheckpoint`）：
  - 每次最多推进 2 年（`MAX_YEARS_PER_CHUNK=2`）
  - 普通年与小事件年分别计算属性变化
  - 每年更新 `fame`
  - 依次判定：死亡 -> 飞升 -> 里程碑 -> 自然终局
- 关键抉择（`applyMilestoneDecisionAndAdvance`）：
  - A/B/C 分别对应低/中/高风险收益
  - 决策后可直接死亡/飞升，或继续自动推进
- 名望：
  - 由 `智力/魅力/气运/体魄` 四维映射到 `0~100`

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
  - 失败时回退空文本/默认选项

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
  - `selectedCardIds`：`1~3`
  - `personaPrompt`：`4~500`
  - `stats`：各项 `0~10`
  - `talentPointTotal`：`20~30`
  - world/card/difficulty id 必须唯一
  - worlds 必须保留 `modern/ancient/fantasy`
