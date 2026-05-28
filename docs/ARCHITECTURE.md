# 项目架构（v0.8.0）

## 1. 架构目标
- 保持“玩法主流程”与“运维配置”解耦。
- 保持“部署模式”与“会话运行”边界清晰。
- 保持“状态机计算”与“AI 文本生成”分层，支持可控回退。

## 2. 系统分层

### 2.1 前端层（`apps/frontend`）
- 职责：
  - 游戏主流程 UI（开局、推进、抉择、结算）
  - Setting 控制台（会话配置/模型配置/内容配置）
  - 时间线渲染与状态提示
- 关键模块：
  - `App.tsx`：用户流程状态机
  - `components/AdminPanel.tsx`：配置中心
  - `lib/api.ts`：后端 API 访问
  - `lib/localConfig.ts`：浏览器本地存储（clientId 与 provider）

### 2.2 API 层（`apps/backend/src/index.ts`）
- 职责：
  - 请求校验与错误响应
  - 游戏流程编排（start/step）
  - 配置读写与内容读写
  - 统一注入 AI 上下文
- 特征：
  - 以 `DEPLOY_MODE` 固定链路
  - 通过 `zod` 做输入校验
  - 通过 store 维持进程内运行状态

### 2.3 领域层（`apps/backend/src/engine.ts`）
- 职责：
  - 角色创建与属性校验
  - 年份推进、里程碑决策、结局判定
  - 名望与死亡/飞升逻辑
  - timelineChunk 映射
- 特征：
  - 纯规则计算，不依赖网络
  - 规则结果先生成，再交给 AI 润色

### 2.4 AI 适配层（`apps/backend/src/ai.ts`）
- 职责：
  - 构造 System/User Prompt
  - 调用 OpenAI Compatible 接口
  - 重试、缓存、截断续写
  - milestone A/B/C 文案解析与回退

### 2.5 共享契约层（`packages/shared`）
- 职责：
  - 统一前后端类型协议
  - 固化 RunState、ProviderConfig、ContentBundle 等接口

## 3. 运行时序

### 3.1 启动阶段
1. `start-local.bat` 或 `start-cloud.bat` 设定 `DEPLOY_MODE`
2. 前端调用 `GET /api/meta/bootstrap`
3. 前端初始化世界观、难度、抽卡池、天赋总点、运行限制

### 3.2 会话环境确认
1. 用户在 Setting 点击“确认本局环境”
2. 前端调用 `POST /api/game/env`
3. 后端校验链路与 key 规则，并把 env 绑定到 `clientId`

### 3.3 开局流程
1. 前端调用 `POST /api/game/start`
2. 后端执行：
   - 参数校验、world/difficulty 解析
   - 创建 run（叠加卡牌、初始化名望）
   - `autoAdvanceToCheckpoint` 生成 raw chunk
   - AI 生成年份叙事并替换 summary
   - 如遇里程碑，AI 生成 A/B/C 文案
3. 返回 `run + timelineChunk`

### 3.4 推进流程
1. 前端调用 `POST /api/game/step`
2. 后端分支：
   - 有 milestone：执行 `applyMilestoneDecisionAndAdvance`
   - 无 milestone：执行 `autoAdvanceToCheckpoint`
3. 对新增 chunk 做 AI 叙事增强，返回结果

## 4. 关键规则边界
- 开局点数：`20~30`（bootstrap 随机）
- 开局属性：每项 `0~10`，总和必须等于本局点数
- 抽卡：`1~3` 张
- 年份分块：每次最多推进 2 年
- 结局：仅 `dead` 或 `ascended`
- 名望：`(智力+魅力+气运+体魄)/4` 映射到 `0~100`

## 5. 配置与数据边界

### 5.1 静态/种子数据
- `data/worlds/*.json`
- `data/cards.json`
- `data/difficulties.json`
- `skills/ai-gm/prompt-pack.json`

### 5.2 运行期可编辑数据
- `storage/custom-content.json`
- `storage/runtime-config.json`
- 备份目录：`storage/backups/*`

### 5.3 扩展设定数据
- 世界线：`data/settings/worldlines/*.timeline.json`
- 阵营：`data/settings/factions/factions.json`
- 阵营事件：`data/events/faction-events.json`
- 天赋叙事钩子：`data/talents/talent-cards.json`

## 6. 安全设计
- 云端模式：只读后端 `CLOUD_MODEL_API_KEY`，不下发前端。
- 本地模式：本地 key 仅会话提交，不写盘。
- 前端本地存储仅保存：
  - `clientId`
  - `localProviderConfig`
- 管理配置接口全部走后端 schema 校验。

## 7. 扩展点
- 增加世界观：编辑 content worlds 或种子数据
- 增加难度：编辑 difficulties
- 增加卡牌：编辑 cards + talent hooks
- 增强叙事：编辑 promptPack 与设定摘要源
- 替换模型：修改 ProviderConfig（baseUrl/model/apiPath）
