# 项目架构（v1.0.0）

## 1. 架构目标
- 玩法计算与 AI 文本生成解耦
- 本地部署与云端体验站复用同一核心逻辑
- 配置可统一调参且具备边界校验

## 2. 分层设计

### 2.1 前端层（`apps/frontend`）
- `App.tsx`：开局、推进、抉择、结算主流程
- `components/AdminPanel.tsx`：Setting 管理页
- `lib/api.ts`：HTTP + NDJSON 流式事件消费

### 2.2 API 编排层（`apps/backend/src/index.ts`）
- 请求校验、错误处理
- 启动/推进流程编排（含 stream）
- 游戏资源加载（content/runtime/worldline/faction/talentHooks）
- AI 调用上下文拼装与事件下发

### 2.3 规则引擎层（`apps/backend/src/engine.ts`）
- `createRun`
- `autoAdvanceToCheckpoint`
- `applyMilestoneDecisionAndAdvance`
- `attachTimelineChunk`
- 规则参数来自 `run.tuningSnapshot`

### 2.4 AI 适配层（`apps/backend/src/ai.ts`）
- Prompt 组装
- OpenAI Compatible 调用
- 缓存与重试
- milestone 结构化输出与 fallback

### 2.5 配置与存储层
- `content.ts`：读取/写入 `storage/custom-content.json`
- `config.ts`：读取/写入 `storage/runtime-config.json`
- `store.ts`：进程内会话与 run 状态

### 2.6 共享契约层（`packages/shared`）
- `RunState / GameplayTuning / ProviderConfig` 等共享类型

## 3. 核心时序（流式）

### 3.1 开局
1. `POST /api/game/start/stream`
2. 后端创建 run，先推进 raw chunk
3. `started` 事件先下发（无 milestone）
4. 年份叙事 AI 完成后逐条 `timeline`
5. milestone 文案 AI 就绪后再发 `milestone`
6. 最后 `done`

### 3.2 推进
1. `POST /api/game/step/stream`
2. 无抉择则自动推进；有抉择则先结算抉择再推进
3. 逐条 `timeline`
4. 有新抉择再发 `milestone`
5. `done`

## 4. 抉择链路要点
- 触发：阶段概率 + 保底年数
- 最低触发年龄：`minEligibleAge`
- 背景种子：`data/events/faction-events.json`
- 文案：AI 生成抉择背景与选项
- 数值：引擎计算
- 幼年阶段仍受 `deltaCapByStage.child` 限制

## 5. 前端抉择历史时序
- 用户点击 A/B/C 后仅记录 pending 决策
- 收到该 milestone 年份的 `timeline`（AI 文本）后才落地到“抉择历史”
- 历史项同时展示掷点胶囊（来自该年 `statChanges`）

## 6. 配置与数据边界
- 根目录固定资源：
  - `data/*`
  - `skills/ai-gm/prompt-pack.json`
  - `.env`（根目录）
- 运行期可编辑：
  - `storage/custom-content.json`
  - `storage/runtime-config.json`
- 备份目录：
  - `storage/backups/*`

## 7. 部署模式边界
- `DEPLOY_MODE=local`
  - 用户在会话内提供本地 key
- `DEPLOY_MODE=cloud`
  - 仅使用服务器 `CLOUD_MODEL_API_KEY`
  - 管理接口锁定（`/api/admin/*` 返回 403）

## 8. 后续扩展方向
- 云端队列化（Redis/BullMQ）用于多实例调度与削峰
- 本地链路继续保持轻依赖、可单机运行
