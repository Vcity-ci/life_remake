# 技术文档（v1.0.1）

## 增量机制：2026-09-21 +08:00 — 场景协议与三世界内容

- `NARRATIVE_SCENE_PARTICIPANT_LIMIT=6` 同时驱动结算工具 Schema 与本地解析器。参与者只同步需要身份、关系或连续性的具名人物；它不改变 Planner 的三项焦点、五名详细人物召回或十二名活跃档案上限。
- `generateDynamicNarrativeScene` 在收到 settlement 后先解析人物、属性和 `actHandoff`，通过后才发起 prose render。非法结构不会再消耗第二次请求，也不会发布半成品。
- 现代与奇幻基础世界升级为 v10；与古代相同，它们只在 `resolveNarrativeExperience` 组合所选 IF 快照后才产生运行时三幕。
- 本领档案继续复用 `name / mastery / description / source / status`，其中 `name` 是稳定标题、`mastery` 是短状态，未引入重复身份字段。

## 增量机制：2026-09-21 +08:00 — IF 子世界包运行时组合

- 共享协议新增 `NarrativeStoryPackDefinition / Snapshot / PublicStoryPackOption / ResolvedNarrativeExperience`。`StartRunRequest` 接收 `storyPackId`；生产 HTTP schema 将其设为必填。
- `story-packs.ts` 每次 bootstrap 或开局按目录发现内容，不使用代码枚举。加载器校验三幕数量、命名空间、基础社会力量引用、路线卡 act/faction 引用及卡片 ID 冲突。
- `narrative-experience.ts` 是唯一组合点：把子包三幕投影为旧五拍状态机所需的三个 act，将路线 promise 投影为 mainline skeleton，并把路线结局方向叠加到基础世界三档蓝图。引擎没有新增第二套节拍实现。
- `index.ts` 的开局链负责存在性、世界归属与生产入口校验；低层 `createRun` 只接收已解析上下文。步进链从 `storyPackSnapshot` 重组体验，不重新读取同名磁盘路线。
- Planner 工具不再暴露 `patternIds`。所选 IF 线是整局前提；Planner 仍可按需选择社会力量、关注对象、回合类型与时间请求。Renderer、Observer、Commit 与 Curator 接口保持原职责。
- bootstrap 同时返回世界的 `storyPackCount / playable` 与公开路线列表。前端按世界筛选路线；没有有效路线的世界不能开始新局。

## 增量机制：2026-09-20 03:44 +08:00 — v9 世界协议与节拍观察

- `packages/shared/src/index.ts` 新增 `NarrativeWorldCore`、`NarrativeSocialForceDefinition`、`NarrativePalette`、`NarrativeStoryPatternDefinition`、`NarrativeSessionPremise` 与 `NarrativeBeatObservation`。v9 的 `routeArcs`、`narrativeFactions` 和逐路线门槛均非必需；内置包只使用世界级 `progression.gates`。
- `content.ts` 对 v9 校验世界核心、社会力量、调色板、故事形态和三张世界级结局蓝图。世界卡仍按任务、关键词、拍点和动态对象召回，但不再需要 route scope 才能进入当前内置世界请求。
- 开局链路在 `render_origin` 成功后调用 `generateNarrativeSessionPremise`，成功结果写入 `NarrativeRunState.sessionPremise` 后才把 opening 标记为 ready。该请求使用隔离的最小任务上下文，不继承或改写主叙事 conversation；结果随匿名存档和分支快照持久化，不显示为新的玩家回合。
- `plan_narrative_turn` 的场景计划使用 `patternIds` 与 `forceIds`，二者均可为空且各最多两项。引擎只校验引用是否属于当前世界包；它们用于精确召回和 Episode 关联，不是合法剧情白名单。
- 场景或抉择后果完成正文审校后调用 `observeNarrativeBeat`。观察请求同样使用隔离的最小任务上下文，只读取专用 prompt 中的故事弧、拍点和刚完成正文；结果写入 `lastBeatObservation`，只有 `advance` 才推进当前拍。选择场景在玩家作答前固定为 `hold`，观察器不参与事实、属性、人物或资产提交。
- 动态场景提交继续沿用原子事务：工具结果、连续性更新、节拍观察和引擎结算任一失败，都不会发布半成品 `TurnRecord`。Memory Curator 仍只处理已经提交的 Episode。
- v9 结局评估从完整世界的三张蓝图中选择品质；旧 route-scoped 评估仅服务早期数据契约，不参与三个内置世界。

## 增量机制：2026-09-16 19:05 +08:00 — World Card 生命周期一致性

- `selectNarrativeWorldCardMatches` 先验证结构化作用域，再区分直接、关联和粘滞激活。`stickyUntilSequence` 与 `cooldownUntilSequence` 使用排他的 Episode 边界；提交器忽略 sticky continuation，消除隔轮重复卡自我续期。
- 一层关联召回现与直接召回共享 Cooldown、inclusionGroup、卡片数和字符预算。匹配任务的 `style_example` 保留一个独立席位，避免真实文风样例被通用高优先级设定挤出。
- `NarrativeWorldCardTask` 仅保留六个消费任务；`ensureNarrativeHorizon` 在请求前重建 task=horizon 的 Plan，不再借用 planning 召回结果。
- v8 加载校验要求 worldCards 非空，运行期按 `version` 明确选择 v8 worldCards 或 v1—v7 lore。`pendingDynamicScene` 新增 locationIds/abilityIds，承接场景提交后的稳定资产引用。
- `NarrativeContextManifest` 的后端 trace 可查看 selected/excluded world cards、activationKind、生命周期余量与排除原因；这些字段不会进入格式化 Prompt。
- 动态导演接口移除未使用的 eventDefinitions、itemDefinitions、storyDirections 传参；资源文件和非导演兼容逻辑未删除。

## 增量机制：2026-09-16 11:48 +08:00 — World Card v8

- `NarrativeWorldCardDefinition` 新增 geography / institution / culture / faction / location / ability / style_example 类型，以及 placement、order、关键词选择逻辑、扫描深度和一层关联召回。`content.ts` 对这些字段做数据校验，v8 世界包不再合并单独的旧组件事件簿。
- `narrative.ts` 以当前任务、世界幕、拍点、计划路线／阵营、显式 focus、近期 Episode 文本和最近公开叙事构造召回查询。字面关键词与 `/pattern/flags` 均可匹配；状态匹配、文本命中、粘滞、冷却、优先级、互斥组和字符预算共同决定最终卡片。
- `narrative/context/` 将 world / scenario / example / author_note 放入不同 section，并在 trace 中记录卡片 ID、激活原因、注入位置与估算 Token。标题等作者字段不进入玩家正文。
- `prepareNarrativeOutcomeRequest` 的事实、人物、地点和本领引用只来自本轮精确召回；provider 返回 incomplete 或截断时，后端区分记录 `tool_arguments_truncated`，不会把协议或校验细节投影给玩家。
- Memory Curator 的整局摘要上限为 600 字符，并继续以 revision 和 Episode 覆盖范围提交；不进行粗暴裁剪。三套世界包和社区示例均已迁移到 v8。

## 增量机制：2026-09-15 13:21 +08:00 — Curator、Horizon 与 Agent Runtime

- `apps/backend/src/narrative/curator.ts` 每次选择 4—6 个尚未覆盖的已提交 Episode；payoff／ending 可提前触发。模型通过 `curate_narrative_memory` 返回 run、act、route、character、faction 作用域摘要及现有事实／人物引用，`store.ts` 在匿名 session/run 锁内按 `memoryRevision` 比较后提交。
- Curator 调用使用已保存运行态的结构化副本，模型请求期间不读取正在被下一 step 修改的对象。成功后 run Digest 投影到既有 conversation 摘要并移除已覆盖 archive；失败只记录服务端调试信息，保留未整理 Episode 等待下一次调度。
- `NarrativeHorizonPlan` 由 `plan_narrative_horizon` 在可进入主线场景时生成；纯背景不调用。Horizon 按 act 复用，重大抉择和 payoff 失效，下次主线候选回合再生成。其 Schema 不含 routeId 或 allowedRouteIds。
- `apps/backend/src/narrative/runtime.ts` 是动态叙事 Agent 的编排入口。它调用 Horizon、`plan_narrative_turn`、第二次 `buildNarrativePromptPlan`、动态 Renderer 和 `refine_narrative_prose`；原有 `runNarrativeTurnTransaction` 与 step 末端 `saveRun` 继续承担发布边界。
- `refine_narrative_prose` 只返回正文及可选抉择背景。结构化属性、事实、人物、地点、本领、选项与结局定性沿用 Renderer 已验证结果；整理失败使原事务失败，不使用原文或模板作为静默回退。
- `NarrativeContextProvider` 将原 Collector 拆成固定顺序、可组合的数据提供者；Context Orchestrator 仍统一执行来源去重、任务预算、格式化和 manifest。Attempt 仅持久化 call/act/beat/route/faction/revision/fragment/episode 引用。
- 回归覆盖 Curator revision/覆盖投影、Digest 与原始 Episode 召回、Horizon 失效和 Provider 顺序。后端 64 项测试、后端编译、前端生产构建及 shared `--noEmit` 检查通过；shared 常规 emit 因本地进程占用 `packages/shared/dist` 返回 EPERM。真实模型表现、Token 增幅和延迟仍需实际游戏采样。

## 增量机制：2026-09-15 12:32 +08:00 — Planner / Renderer 与 Episode 索引

- `apps/backend/src/narrative/turn.ts` 定义内部 `NarrativeTurnEnvelope` 与 `NarrativeTurnPlan`；`ai.ts` 的 `plan_narrative_turn` 只接受世界包合法 ID 和引擎状态，动态 renderer 随后只暴露计划对应的 `render_background_segment`、`render_scene` 或 `render_choice_scene`。
- `buildNarrativePromptPlan` 新增 planning/rendering 任务视图。planning 读取当前世界幕和完整路线目录，不携带上一条路线偏好；rendering 使用模型已选 route/faction/focus 做第二次确定性召回。Context manifest 同步记录 callId、任务来源、worldId 与 focusIds。
- Context task profile 已按 origin/background/planning/rendering/decision/closure/ending 分配不同层级比例。会话正文按完整 user/assistant 语义回合进入预算，未摘要回合不做字符级裁剪；历史压缩继续由带 revision 与来源游标的异步摘要提交负责。
- `apps/backend/src/narrative/commit.ts` 在所有相关更新成功后写入 Episode 引用，并从 payoff handoff 写入 Act Canon；`apps/backend/src/narrative/episodes.ts` 只返回既有 memory ID 和阶段结果，不复制正文或推导状态。
- 结局申请经过 closure 任务的统一上下文编排。已批准结局的模型文本不再截为固定字符数，也不在渲染失败时替换成本地模板；失败会使当前 step 保持未提交。
- 验证：后端 61 项回归、后端 TypeScript 编译与前端生产构建通过；没有启动服务或调用真实模型。

## 增量机制：2026-09-15 11:06 +08:00 — Context Orchestrator

- `apps/backend/src/narrative/context/` 提供内部上下文协议：`NarrativeContextFragment` 记录 layer、section、placement、sourceIds、priority、estimatedTokens、required 与回合生命周期；这些类型不进入共享前端协议或存档结构。
- `collectNarrativePlanFragments` 将现有 `NarrativePromptPlan` 增量适配为带来源的片段。开放事实目录与已召回详情按事实 ID 去重；人物、Lore、地点、本领和局内记忆使用稳定来源 ID。旧的非任务计划只保留迁移适配器，不形成第二套生产模式。
- `composeNarrativeContext` 是当前动态工具请求与结局渲染的统一用户上下文入口。它复用 `buildConversationPromptMessages` 投影摘要、archive 与近期回合，执行确定性去重和任务预算后，分别输出 provider 历史消息、当前用户上下文和不含正文的 manifest。
- 预算采用本地估算值，只用于请求前裁剪低优先补充材料；实际 Token 统计继续使用供应商响应。history 保持原有完整回合窗口，必要 task/runtime/active 片段优先保留，空余层级预算可被其他层借用。
- 回归覆盖来源唯一性、事实目录／详情合并、任务末位投影、conversation 摘要归属和超预算 Lore 裁剪。引擎仍是状态裁决者，编排器不选择路线、不推进节拍、不修改属性或事实。
- 验证：后端 59 项回归、后端编译和前端生产构建通过；未启动服务、调用真实模型或修改本地存档。

## 增量机制：2026-09-15 01:50 +08:00 — 提交来源与混合召回

- `applyMilestoneDecisionAndAdvance` 对模型提出的事实更新使用回合最终 `sourceEventId`，与 `memory:${sourceEventId}` 以及 `recordDirectedDecisionOutcome` 一致。由此避免账本已经更新、变化摘要却因来源不匹配而遗漏。
- `isNarrativeFactModelMutable` 统一事实工具合同与生活侧引用目录的可更新范围。目前为局内动态事实及幕间 continuation；世界幕完成事实仍由既有高潮和结算逻辑处理。
- `buildTaskNarrativePlan` 区分纯场景和包含背景工具的 mixed turn。mixed turn 不再以当前幕提示及幕事实作为公共检索种子；模型尚未选择路线时不随机注入某条路线的专属 Lore，场景工具仍包含完整世界主线、当前幕、节拍、路线和阵营参数。
- 回归覆盖三世界的纯背景／混合／纯场景投影，并校验抉择事实来源能够进入会话变化记事。


## 增量机制：2026-09-15 01:34 +08:00 — 记忆提交与覆盖

- 模型侧 `factUpdates` 提供 `introduce[{kind,label,status,priority?}]` 与 `updates[{factId,status,summary}]`。解析器将更新转换为已有 `progress/resolutions` 等内部操作，复用引擎提交；世界幕完成事实仍由原高潮链路管理。新事实可直接记录为已发生结果。
- `relationshipUpdates` 沿用稳定 `characterRef`、关系立场和说明，新增可选 `status/description` 更新已有档案。已离场常驻人物仍保留在最近八名公开人物投影中，描述标明状态；既有历史回合快照不回写。
- `ChatConversationState.summaryThroughMemoryId` 跟随摘要成功提交更新。近期回合和未摘要 archive 仍通过来源 ID 排除重复召回；摘要覆盖条目仅在明确事实／本领用途或结局任务下重新召回。缺少覆盖标记的旧会话不推测其覆盖范围。
- 待摘要输入优先使用提交时形成的分类变化记事；没有记事的旧回合保留简短正文尾段。完全相同的投影去重，原始 archive 正文仍用于异步摘要，不按模糊相似度删除提交历史。
- 召回相似性降权只影响补充上下文，不能改变存档事实、候选路线或引擎准入。身世、人设、天赋与完整引用目录保留。普通年份和主线场景继续共用一次动态请求，无新增规划请求。
- 验证：57 项后端回归通过，后端与前端编译通过。未启动服务、调用真实模型或改写本地存档；对叙事重复率和真实 Token 节省不作未测量承诺。


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
## 增量机制：2026-09-22 +08:00 — World Card 目录与焦点召回

- `content.ts` 会读取 `data/narratives/<worldId>.story.json`，同时递归读取 `data/narratives/world-cards/<worldId>/**/*.json`。目录文件格式为 `{ worldId, cards }`；合并后继续由 `validateNarrativeWorldFactContract` 检查卡片 ID、类型、激活条件、作用域、关联与生命周期。
- `NarrativeStoryPackDefinition` 使用 `worldCardRefs` 和 `acts[].worldCardRefs` 引用世界拥有的卡片。`story-packs.ts` 在加载时验证引用存在，`resolveNarrativeExperience` 不再合并路线私有正文。
- 世界卡选择器将路线引用作为相关度加分，将 Planner 已选择的卡片作为精确焦点；任务、幕／拍、阵营与运行状态作用域仍然有效。召回上限仍为 6 张、1400 字符，避免因为资料库扩充而回到全量注入。
- `NarrativeTurnFocusReference.kind` 增加 `world_card`。候选来自规划上下文实际选中的世界卡，不把整份世界卡目录塞入工具 Schema。
- Context Provider 将 `storyBible` 作为 `stable:world-snapshot`，将 `worldCoreContext` 作为 `stable:world-core`，二者职责不同且均由预算编排器统一去重、排序和追踪。
