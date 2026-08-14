# 项目架构（v1.0.1）

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
- `tool-fast` 事件导演：本地候选筛选后由模型一次工具调用选择事件并提交文案
- 工具不可用时使用本地事件文案回退，不启动多轮工具循环

### 2.4.1 叙事提供者与工具审批（`apps/backend/src/narrative-provider.ts`、`tool-gateway.ts`）
- 默认 `local` 叙事提供者仍复用现有 OpenAI Compatible 调用与消息压缩链路
- 可选 `sillytavern` 提供者仅请求一个由部署者实现的本地桥接端点；未配置或桥接失败时自动回到本地提供者
- 桥接端点接收压缩后的世界、人物、素材和叙事计划，不接收用户模型密钥
- `tool-gateway.ts` 是模型意图进入规则引擎前的唯一审批点：事件方向必须属于引擎候选，结局请求必须满足完整性和数值门槛

### 2.5 配置与存储层
- `content.ts`：读取/写入 `storage/custom-content.json`
- `config.ts`：读取/写入 `storage/runtime-config.json`
- `store.ts`：匿名会话、临时 run 和存档快照；运行态写入 `storage/anonymous-game-store.json`
- 浏览器仅持有 HttpOnly 匿名会话 Cookie。前端 `clientId` 只为兼容既有请求体，不参与归属或授权判断。
- 本地模式 API Key 只保留在当前后端进程内，持久化数据不会记录该值。

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
- 触发：阶段概率、保底年数与世界观 `milestoneAges`
- 最低触发年龄：`minEligibleAge`
- 背景种子：`data/events/faction-events.json` 会兼容归一为带 ID、冷却和阵营标签的事件卡
- 事件元数据：`data/events/event-metadata.json` 逐条补充年龄窗、叙事位置、方向标签、主次属性、权重与冷却；加载时与原始事件文本合并
- 天赋和命运道具会影响候选权重、负面变化与死亡风险
- 文案：AI 先在工具调用中选择事件方向；引擎确定具体事件后，AI 再根据工具回执渲染叙事与抉择文案
- 数值：引擎按事件专属后果计算，模型不能修改属性、掉落或结局
- 幼年阶段仍受 `deltaCapByStage.child` 限制

阶段 2：导演运行态复用既有 `StoryDirectorState`，在事件结算后记录方向标签、语义 flags、阻断 flags 与结构完整性缓冲。缓冲以起点、积累、压力、转向、结果五类事件计数，并仅标记是否具备未来“请求结局引导”的最低结构条件。

兼容边界：旧随机推进不读取也不写入该状态；其候选筛选、数值结算、死亡/飞升阈值与前端展示均保持原样。工具模式则按阶段 4/5 的主线与收束规则运行，内部状态始终不会暴露给前端。

阶段 3：`aiConversation.year` 的既有压缩会话现可保存文本消息、模型工具调用和引擎结算回执。导演工具成功后，只有事件被引擎结算才写入该完整回合；近期三轮保留完整工具记录，归档摘要仍只压缩用户输入与最终叙事。为兼容本地 OpenAI 接口，历史工具记录在下一次请求时投影为普通的用户/助手成对消息，不直接发送历史 `tool` role。

阶段 4：`tool-fast` 使用两段式导演。引擎先按年龄、冷却、主线位置、前置 flags 和阻断 flags 筛出合法事件，并合并为最多六个方向标签；模型只能工具调用 `select_event_focus` 选择方向。引擎随后按候选权重和本局种子确定具体事件，将该事件素材作为 `tool` 回执交给第二次模型调用渲染。工具不支持或第一段调用失败时，仍由引擎选取方向池首项并使用本地叙事回退。

阶段 5：工具模式的结构完整性达到最低条件后，模型可调用 `request_story_closure` 申请 `guide` 或 `finish`。引擎只会在至少出现一个结果事件、且没有待选抉择时批准结束；未达到该门槛的申请会转为引导期，并优先投放结果类事件。飞升仅作为可供结局消费的成果，寿命上限只提供收束节奏，不再直接终止工具模式；死亡仍立即结束。获批后使用既有结局文案生成完成最终结算。

阶段 6：古代世界的原始事件、事件元数据和叙事绑定均以同一事件 ID 对齐。每条事件同时具有可用年龄、冷却、权重、主副属性、后果画像、状态旗标与叙事节拍；前端以阅读器布局展示既有流式时间线、抉择、天赋、道具与结算，不参与状态判定。

## 5. 前端抉择历史时序
- 用户点击 A/B/C 后仅记录 pending 决策
- 收到该 milestone 年份的 `timeline`（AI 文本）后才落地到“抉择历史”
- 历史项同时展示掷点胶囊（来自该年 `statChanges`）

## 5.1 推进计数与缓冲协同（2026-06-01）
- 前端维护 `pendingAdvanceCountRef` 作为“用户推进请求待兑现数”
- 每次 step 请求结束（无论是否收到 timeline）都会释放一次待兑现计数
- 时间线展示通过 `timelineBufferRef` 先入缓冲再消费，重复项在入缓冲时去重
- 该协同用于避免“第二次抉择后等待态不退出”的卡死链路

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

## 7.1 匿名会话与存档
- 每个浏览器会话可自动恢复最近一次 run；run 默认保留 7 天，会话默认续期 30 天。
- 每个会话默认最多 5 个存档。创建存档会返回一次恢复码，可在另一个浏览器恢复为新的匿名 run。
- 存档快照默认保留 180 天。期限和数量可通过 `ANONYMOUS_*` 环境变量调整。
- 单实例云部署必须将项目 `storage/` 挂载为持久卷；多实例部署需以共享数据库/对象存储实现同一仓储接口后再启用横向扩容。

## 8. 后续扩展方向
- 云端队列化（Redis/BullMQ）用于多实例调度与削峰
- 本地链路继续保持轻依赖、可单机运行
