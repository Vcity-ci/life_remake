# 技术文档（v1.0.1）

## 1. 技术栈
- 前端：React 18 + Vite 5 + TypeScript
- 后端：Express + TypeScript（`tsx` 开发，`tsc` 构建）
- 共享类型：`@reroll/shared`
- AI SDK：`openai`
- 校验：`zod`
- 随机：`seedrandom`

## 2. 目录结构
```text
apps/
  backend/
  frontend/
packages/
  shared/
data/
skills/
storage/
docs/
```

## 3. 环境变量与路径

### 3.1 `.env` 读取位置
后端启动时固定从项目根目录加载：
- `dotenv.config({ path: path.join(process.cwd(), ".env") })`

### 3.2 资源读取根
后端内容读取固定使用项目根：
- `data/*`
- `skills/ai-gm/prompt-pack.json`
- 不依赖 `apps/backend/dist/data` 或 `apps/backend/dist/skills`

## 4. API 列表

### 4.1 元数据/健康
- `GET /api/meta/bootstrap`
- `GET /health`

### 4.2 会话环境
- `POST /api/game/env`

### 4.3 游戏流程
- `POST /api/game/start`
- `POST /api/game/step`
- `POST /api/game/start/stream`（NDJSON）
- `POST /api/game/step/stream`（NDJSON）

### 4.4 管理接口
- `GET /api/admin/config`
- `POST /api/admin/config`
- `GET /api/admin/content`
- `POST /api/admin/content`
- 云端模式下全部锁定为 403

## 5. 流式事件协议
- `started`
- `timeline`
- `meta`
- `milestone`
- `done`
- `error`

说明：
- 开局时先 `started` 再 `timeline`
- milestone 只在 AI 抉择文案 ready 后发出

## 6. 引擎规则实现摘要

### 6.1 开局
- 属性每项 `0~10`
- 总和必须等于 `talentPointTotal`
- 选卡数量在调参范围内
- 生成 `tuningSnapshot`

### 6.2 年份推进
- `autoAdvanceToCheckpoint`
- 每轮推进最多 `maxYearsPerChunk`
- 年份类型：普通/异动/平年（由概率决定）

### 6.3 抉择触发
- `age >= minEligibleAge`
- 阶段概率：`triggerRateByStage`
- 未触发达到 `guaranteeYears` 保底触发
- 背景种子来自 faction event pool

### 6.4 抉择结算
- `applyMilestoneDecisionAndAdvance`
- 先算 `statChanges`，后按阶段 cap 截断
- 幼年保持 `-2..2`（默认）

### 6.5 结局
- `dead` 或 `ascended`
- 结束后调用 AI 结算文案（失败回退引擎文案）

## 7. 前端行为实现摘要
- Setting 先确认环境，才能开局
- 时间线按 `timeline` 事件增量渲染
- 抉择历史采用“延迟挂载”：
  - 点击选项先缓存 pending
  - 收到对应 milestone 年份 `timeline` 后写入历史
  - 同步展示掷点胶囊
- 推进状态机关键点（2026-06-01）：
  - `runStepGeneration` 的 `finally` 统一释放 `pendingAdvanceCountRef`
  - 不再依赖“是否收到 timeline”来决定释放，避免计数悬挂
  - `enqueueTimelineEntry` 使用 `timelineBufferRef` 做同步去重入队，减少 `setState` 异步竞态导致的卡住

## 8. 配置校验
- `schema.ts` 对 `startRun/gameEnv/contentBundle/gameplayTuning` 做边界校验
- 交叉约束（如 min/max、阈值顺序）在 `superRefine` 校验

## 9. 构建命令
- 全量：`npm run build`
- 后端：`npm run build -w @reroll/backend`
- 前端：`npm run build -w @reroll/frontend`

## 10. 当前叙事运行时对齐（2026-08-15 01:22 +08:00，增量）

> 本节补充当前代码状态；如与第 6 节的历史简述冲突，以本节为准。

- `apps/backend/src/narrative.ts` 将世界包定义投影为分层上下文，并以事实、活跃场景、路线承诺、高潮与回收状态计算主线完成；当前不使用 RAG。
- `apps/backend/src/engine.ts` 负责候选过滤、事实账本、属性结算、`TurnRecord` 和结局状态机。模型永远不能直接修改这些状态。
- `apps/backend/src/ai.ts` 的常规导演工具为 `propose_story_intent`；主线完成后的强制工具为 `request_story_closure`。两者只传递意图，不传递事件 ID、数值或结局极性。
- 叙事世界包中的 `endingBlueprints` 提供路线的好/坏结局大纲。引擎先锁定蓝图，再请求最终结局文本；最终文本调用失败时保留引擎结算摘要。
- 古代叙事世界的最终 outcome 可为 `completed`；死亡仍是立即中断，旧的 `ascended` 仅保留给未启用叙事世界包的兼容路径。

## 11. 路线局部进度实现（2026-08-21 01:29 +08:00，增量）

- 共享契约新增 `NarrativeRouteProgress`；`NarrativeRunState.version` 为 `4`，以 `routeProgress[]` 保存世界包路线的局部拍点。旧存档没有该字段时，运行态仍可读取同线程 `activeScene` 作为一次迁移兼容视图。
- `buildDirectedEventCandidates` 先保留既有事件的 `narrativeBeat` 与路线素材绑定，再为每个当前可用路线投影候选。模型选择的是 `routeId`，不是事件 ID、数值或下一幕。
- `selectDirectedCandidateForIntent` 直接接收字符串路线 ID，不再依赖旧 `StoryDirectionDefinition` 才能选材；新世界只需配置世界包路线即可进入同一引擎路径。
- `applyNarrativeEvent` 仅更新本回合实际选择路线的 `routeProgress`。`activeScene` 同步为该路线的展示/停表投影，不承担全局状态机职责。
- `recordMainlineActPayoff` 仅清除完成 payoff 的路线记录；共享世界幕前进与世界事实结算不清除其它路线。
- 年龄没有叙事终止上限。普通年份、场景停表和属性门槛沿用既有逻辑；路线局部进度不改变这些模块。

## 12. 当前动态回合与生存结算（2026-08-25 14:54 +08:00，增量）

1. `generateDirectedSegmentForRun` 通过 `generateDynamicNarrativeScene` 发起当前唯一的动态叙事调用。依据可用回合类型，模型必须调用 `render_background_segment`、`render_scene` 或 `render_choice_scene`；`/responses` 与 `/chat/completions` 的返回分别归一为同一工具调用记录。
2. 动态工具结果由 `apps/backend/src/ai.ts` 审核正文安全性、路线/阵营 ID、人物引用、属性语义、抉择选项和 payoff 交接事实；`apps/backend/src/engine.ts` 随后结算年龄、场景停表、事实、人物记忆与公开 `TurnRecord`。工具结果不合法时整回合回滚，内部原因只写后端日志，不投影前端。
3. `NarrativeRunState.dynamicCharacters` 保存本局常驻人物。工具 schema 将 `characterRef` 限制为 `new` 或当前已知人物 ID；引擎只在 `recurring=true` 时创建档案，并以既有 ID、或旧数据的姓名加阵营匹配，稳定合并重复人物。
4. `progression.survival` 是世界包拥有的死亡风险配置：年龄阶段风险线、连续低体魄宽限期、年度风险上限、恢复成功率与家境对体魄的年度支持均由其定义。当前古代包从 4 岁开始检测，连续 3 年低于风险线后才可触发危机。
5. `resolveSurvivalCrisis` 使用固定种子结算三种选择。成功率按所用属性的低/中/高档取世界包配置，高档直接成功；成功把体魄恢复到风险线加 `restoreBuffer`，失败才把 `outcome` 设为 `dead`，并交由既有结局渲染补足死因文本。
6. `BackgroundCard.narrative` 以 `bias`、`affinities`、`riskTone` 承载叙事游戏性。`summarizeTalentHooks` 只汇总本局已选的最多三张卡；身世生成、推进和结局均复用这一紧凑上下文，初始属性修正仍由卡片 `modifiers` 在创建运行态时结算。
