# 技术文档（v1.0.1）

## 当前机制对齐：2026-09-10 00:26 +08:00

以下补充以当前动态链路为准；旧章节的年度死亡 roll、飞升阈值和静态里程碑参数不能直接视为当前玩法入口。

### 年度体魄、生存危机与结算

`engine.ts` 的 `applyAnnualFamilyPhysiqueSupport` 与 `updateAnnualSurvivalRisk` 在实际跨年时执行；同年场景不重复取得年度家境支持或累积年度风险。三套世界包当前共用以下数值配置，年龄段边界仍读取各自基础世界的 `ageThresholds`：

| 生存阶段 | 体魄低于 | 初始危机概率 | 每多一年增加 | 概率上限 |
| --- | --- | --- | --- | --- |
| 幼年 | 1 | 4% | 3 个百分点 | 14% |
| 青年 | 2 | 6% | 4 个百分点 | 22% |
| 成年（prime / middle） | 3 | 8% | 5 个百分点 | 30% |
| 老年 | 5 | 12% | 6 个百分点 | 42% |

- 配置为 `startAge=4`、`graceYears=3`，第三个连续低体魄检查年份开始概率判断；风险会经过既有减风险机制并限制在阶段上限内。恢复至风险线、切换生存阶段会重置累计。
- 自愈／求援／听天由命使用智力／魅力／气运档位。配置成功率为低档 25%、中档 55%、高档 100%，引擎亦直接认定高档成功。
- 成功将体魄至少恢复到当前风险线 +5 并清除累计；失败写入 `outcome=dead` 与 `deathCause`，由结算渲染承接故事。风险触发本身不宣判死亡。
- 年度家境体魄支持：低档 -1/0/+1 权重为 20/60/20；中档 0/+1 为 60/40；高档 0/+1/+2 为 45/45/10。该变化与当年属性后果合并，不增加模型请求。
- 主线结局使用 `completed` 及 good / normal / bad 蓝图，与上述死亡路径区分；属性决定结局品质，不单独充当主线结束条件。

### 当前投影与扩展接口

- `App.tsx` 读取 bootstrap 世界列表，难度选择不展示，默认内容首项；本地与云端 Provider 配置链路保持独立。
- 人物身份引用、地点、本领与事实变化沿现有提交链写入局内状态；`NarrativeAssets.tsx` 展示足迹、本领和回合变化。已选 1 至 3 张天赋的数值与叙事画像用于开局和续写。
- Setting 的模型用量面板统计会话请求及服务商已上报 Token；未上报用量单独记录，不代表零消耗，也不推算金额或余额。
- 数据库及前端 UX 是待办方向；当前文件仓储和 NDJSON／TurnRecord 接口仍是实际实现。

本轮仅文档核对，未重跑编译。上一轮 2026-09-09 的后端编译和 53 项回归结果见对应记录。

## 增量对齐：2026-09-09 23:47 +08:00

- `index.ts` 统一计算既有 `allowedTurnKinds`，同步提供给任务记忆投影和工具输入；`storyArc` 传递世界总纲。年龄、属性准入及节拍推进规则保持原链路。
- `dynamicNarrativeSceneTools` 将总纲、幕说明和当前节拍放入场景工具描述。`dynamicNarrativeScenePrompt` 组装公共年龄、成长、路线和工具提交信息；背景任务使用对应的任务上下文，不增加模型请求。
- `buildTaskNarrativePlan` 的普通年份 Lore 查询侧重人物设定与近期经历；混合请求保留场景所需知识。事实详情预算分别为背景 1、混合 2、纯场景 4，均先按相关性选取，开放事实引用目录不受详情预算截断。
- `retrieveNarrativeMemories` 对关联事实全部已收束的记忆投影结果摘要，间接召回分数按结束后的年龄间隔衰减；明确事实引用、本领关联与结局任务保留直接召回权重。同一结果去重，不改写持久化记忆或删除人物、地点、本领。
- 新增跨世界请求投影、历史结果召回及任务预算回归；后端编译和 53 项测试通过。实际模型文本尚未采样。

## 增量对齐：2026-09-09 12:30 +08:00

- `narrativeRouteBeatGuidance`：setup 读取 `perspective`，escalation/pressure 读取 `escalation`，climax 读取 `crisis`，payoff/ending 读取 `payoffFocus`；缺省回到世界包自身的视角。动态请求对所有路线应用同一投影，抉择结果使用已选路线。
- `buildTaskNarrativePlan`：总纲与当前任务分层组装，Lore 阶段来自 `actRuntime.beat`；不再依赖滞留的 `arcPhase`。幕间交接在新幕 setup 投影，并与已召回结果去重。
- `normalizeNarrativeHandoffFact`：仅将 `act:*:consequence`、kind=cost、status=open 的历史交接后果规范化为 resolved，保留引用、标签与结果信息。该规则用于上下文、工具引用合同和引擎账本规范化。
- `factUpdateContract`：开放的 `dynamic:*` 和旧 `act:*:continuation` 可推进、收束；`act:*:payoff` 及世界核心事实不因此开放给叙事工具。
- `recordDynamicActHandoff`：新交接三个字段均作为历史结果保存；未完成事项由同轮 `factUpdates` 提交。交接 ID 合并到当前回合记忆并关联出场人物，不新增模型请求。
- 回归覆盖新交接落盘、旧承诺完成、存档快照隔离、跨世界指引读取和旧 arcPhase 不影响 Lore 阶段。后端编译及 50 项测试通过；未进行真实模型叙事采样。

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
