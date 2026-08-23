# 更新日志

## 2026-08-23 - 叙事节奏与成长选择（增量）
- 世界包升级支持四档属性门槛、三种幕间成长方向和属性档位配置；引擎继续与具体世界和路线数量解耦。
- `compose_world_scene` 合并场景推进与普通人生段选择，背景段不会再触发第二次模型调用，也不再依赖普通年份内部标签。
- 重要拍点的抉择密度改为：压力/高潮必有，setup/escalation 可按场景后果产生；玩家选择后才推进当前拍。
- 匿名存档保存成长方向；前端显示属性档位和成长方向选择卡，不显示内部叙事标签或工具协议。

## 2026-08-22 04:29 +08:00 - 动态世界幕导演（增量）
- 新增世界包 v4 契约：世界幕事实、阵营目录、全局五拍运行态、局内人物和本地记忆条目。
- 活跃叙事链改为模型 `compose_world_scene` 工具调用；模型选择世界包路线/阵营并渲染场景，引擎保留年龄、属性、死亡、事实、幕推进和结局的唯一裁决权。
- 抉择的高潮后果可提交受限事实收束方式，`payoff` 后才进入下一世界幕；三幕完成后才允许结局申请。
- 前端将命运栏改为展示局内常驻“命运人物”，不复用道具数据。

## 2026-08-22 01:34 +08:00 - 叙事属性平衡与三档结局（增量）
- 将导演路径的模型属性结果统一为“模型提议语义后果、引擎按策略审批并换算数值”的单次工具调用链；没有恢复随机属性 roll。
- 普通背景年份固定在轻/中度正向成长；抉择改为可验证的三档：稳健仅轻度正收益，适中可有轻代价但必须保留收益，冒险可出现重度突破或重度挫折。
- 名望由属性基础、已完成世界幕与真实抉择结果共同构成；它以受限修正量参与叙事结局评分，不替代主线完成判定。
- 结局蓝图从好/坏扩展为好/普通/坏三档。古代六条路线均补齐普通结局蓝图；内容加载会校验每条配置路线同时具备三档蓝图。
- 后端回归测试 23/23 通过，后端 TypeScript 构建通过。共享包构建的 `dist` 被已有本地进程占用，未强制终止该进程。

## 2026-08-21 01:29 +08:00 - 路线局部节拍与世界幕（增量）
- 新增按世界包 `routeArcs` 派生的 `routeProgress`，路线数不再由引擎或古代世界硬编码。
- 导演工具继续由模型选择路线 ID；引擎保留既有事件 `narrativeBeat`，按所选路线的局部节拍确定具体素材。
- 移除 `activeScene` 对其它路线候选的全局阻断。它现在只负责当前路线的场景展示与年龄计时投影。
- payoff 后只重置达成该 payoff 的路线；其它路线的局部进度和已发生事实保留。当前世界幕推进到下一个 `mainlineAct`。
- `thread:*` 不再在叙事模式中造成跨幕、跨路线候选阻断，仍作为事实账本和素材关联记录；旧非叙事事实校验不变。
- 路线选材接口改为直接接收 `routeId`，新世界包不必依赖旧 `StoryDirectionDefinition` 才能进入导演链。
- 后端回归测试 21/21 通过，后端 TypeScript 编译通过；共享包构建输出被本地占用，未强制终止占用进程。

## v1.0.2 - 2026-06-02
- 新增小说/长篇素材蒸馏操作文档：
  - `docs/NOVEL_DISTILLATION_GUIDE.md`
- 文档覆盖：
  - 如何分章摘要小说素材
  - 如何用 AI 蒸馏世界观圣经
  - 如何生成 `worlds/worldlines/factions/faction-events/talent-cards/promptPack`
  - 如何同步到 `storage/custom-content.json`
  - 如何做本地跑局验证与复读排查
- `README.md` 文档导航新增该入口。

## v1.0.1 - 2026-06-01
- 修复“第二个抉择后卡死”问题（前端推进状态机）：
  - `pendingAdvanceCountRef` 在 `runStepGeneration` 结束时统一释放，避免等待计数悬挂
  - 时间线缓冲改为基于 `timelineBufferRef` 的同步去重入队，减少异步 `setState` 竞态
- 抉择链路稳定性增强：
  - 抉择请求年龄透传与前端乐观态切换保持一致，降低 `waiting_decision` 残留导致的阻塞概率
- 文档同步更新：
  - `README.md`
  - `docs/USAGE_FLOW.md`
  - `docs/TECHNICAL.md`
  - `docs/ARCHITECTURE.md`

## v1.0.0 - 2026-05-30
- 文档全面对齐当前版本实现：
  - 重写 `docs/USAGE_FLOW.md`
  - 重写 `docs/CONFIG_GUIDE.md`
  - 重写 `docs/ARCHITECTURE.md`
  - 重写 `docs/TECHNICAL.md`
  - 重写 `docs/DEPLOYMENT.md`
- 关键对齐点：
  - 根目录 `.env` 读取路径（后端以 `process.cwd()` 为准）
  - 后端固定读取根目录 `data/*` 与 `skills/ai-gm/prompt-pack.json`
  - 抉择触发逻辑：阶段概率 + 保底 + 最低年龄门槛
  - 流式事件顺序：`started -> timeline -> meta -> milestone -> done`
  - `started` 阶段不下发 milestone（避免前端先挂 fallback 文案）
  - 前端“抉择历史”改为在收到 milestone 年份 AI 文本后再挂载，并展示掷点胶囊

## v0.8.1 - 2026-05-28
- 新增 GitHub 发布准备文档：
  - `docs/GITHUB_RELEASE_CHECKLIST.md`
  - `docs/VSCODE_SOURCE_CONTROL_GUIDE.md`
- `README.md` 文档导航新增上传检查与 VS Code 提交流程入口。
- 发布前安全审计结论补充：
  - 重点检查 `apps/backend/.env` 不入库
  - 路径/密钥扫描需排除子目录依赖缓存（如 `apps/frontend/node_modules/.vite`）
  - 本地 `.env` 变量名与 `.env.example` 可能不一致，需上传前人工对齐

## v0.8.0 - 2026-05-28
- 文档体系重整：
  - 新增 `docs/TECHNICAL.md`（技术文档）
  - 新增 `docs/USAGE_FLOW.md`（使用流程）
  - 新增 `docs/DEV_LOG.md`（开发日志）
  - 重写 `docs/ARCHITECTURE.md`（分层架构 + 运行时序）
- `README.md` 增加“文档导航”并统一指向各文档入口。
- 文档内容按当前实现对齐：
  - start/step API 编排
  - 年份推进与里程碑决策逻辑
  - 本地/云端模式边界
  - 配置与持久化路径

## v0.7.2 - 2026-05-28
- 文本长度控制改为纯提示词约束：\n  - 年份总结/事件背景：80~150字\n  - 选项与对话：<=20字
- 移除后端对年份与背景文本的硬截断阈值处理（不再依赖字符裁切）。

## v0.7.1 - 2026-05-28
- 补全 Phase A 提示词输入字段：\n  - 当年属性变化(delta)\n  - 当前属性绝对值（含体魄）\n  - 当前名望值与档位\n  - 是否经过空过年份\n  - 当前年龄阶段\n  - 当前风险等级（A/B/C或普通年）
- 年度与节点背景长度规则强化：180~300字；选项<=30字。
- `ProviderConfigForm` 中 `Max Tokens` 改为只读（由后端固定控制）。

## v0.7.0 - 2026-05-28
- 执行 Phase A 规则重构：
  - 新增开局维度 `体魄`
  - 开局随机总点改为 `20~30`
  - 引入 `名望(fame)` 与 `结局状态(outcome)`
- 结局判定重构：
  - 仅 `死亡` 或 `飞升`
  - 支持 `deathCause` 记录
- 年份状态机更新：
  - 年度随机增减五维属性
  - 死亡风险与体魄/名望联动
  - 飞升阈值为任一关键属性达到 30
- 三选项风险收益重映射：
  - A低风险低收益，B中风险中收益，C高风险高收益
  - C可触发死亡结束
- 前端面板新增 `体魄` 显示，运行态新增 `名望` 与 `结局状态` 展示。
- 文档同步更新：架构、配置、变更记录。

## v0.6.0 - 2026-05-27
- 新增部署双链路：
  - `start-local.bat`（本地部署链路）
  - `start-cloud.bat`（云端体验链路）
- `start.bat` 改为本地链路入口代理。
- 启动模式由工程入口决定，不再在局内切换。
- 后端接入 `DEPLOY_MODE`，并在 `/api/meta/bootstrap` 返回 `deployMode`。
- Setting 中移除运行模式切换，仅显示当前部署链路。
- 新增部署手册：`docs/DEPLOYMENT.md`。

## v0.5.0 - 2026-05-27
- 新增模块化设定源：
  - `data/settings/worldlines/*.timeline.json`
  - `data/settings/factions/factions.json`
  - `data/events/faction-events.json`
  - `data/talents/talent-cards.json`（20张天赋卡+prompt钩子）
- 后端 AI 上下文接入：世界线摘要、阵营摘要、阵营事件池摘要、已选天赋卡叙事钩子摘要。
- 提示词工程细化并固化字段：
  - `yearNormalRule`
  - `yearMinorRule`
  - `milestoneRule`
  - `storyConstraint`
- `data/cards.json` 同步为 20 张卡的运行卡池（从 talent-cards 派生）。
- 文档更新并标注设定集具体路径。

## 2026-08-15 01:22 +08:00 - 叙事世界包与 P4 结局链（增量记录）
- 古代世界接入可配置主线骨架、路线属性门槛、事实账本、背景段落节拍、活跃场景与双向结局蓝图。
- 导演工具从“模型选择事件方向”收紧为“模型提出叙事意图、引擎审批具体候选”；模型不能修改事件数值、掉落、路线事实或结局极性。
- 主线完成后只允许 `request_story_closure`；引擎锁定结局蓝图后才渲染收束和结算。年龄不再是叙事世界包的强制结局条件。
- 结局工具协议异常时保留结局引导并阻止无关年份推进；兼容存档会在背景段落前刷新完成状态。
- 文档以追加方式同步：`ARCHITECTURE.md`、`TECHNICAL.md`、`USAGE_FLOW.md`、`DEV_LOG.md`。
