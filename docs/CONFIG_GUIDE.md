# 配置指南（v1.0.0）

## 当前入口：2026-11-07

边镇将帅运行版本 20、其他 IF 运行版本 18。当前职责和供应顺序见[架构](ARCHITECTURE.md)与[最新历史／接组规范](PERIOD_MEMORY_AND_EVENT_ROUTING.md)。组末观察只判断收束，后续组由独立规划选择；压缩只处理未覆盖时期正文，不配置旧人生摘要的反复改写。

边镇素材 2.4.0 支持在事件单元上配置 `lifeBefore: { minYears, maxYears, context }`，只控制本单元开始前的普通生活。引擎选定并保存年数，规划不新增调度输出。配置示例、适用衔接与实际效果见[普通生活](ORDINARY_LIFE_INTERVALS.md)，旧局不自动套用新素材。

本地 `.env`、运行配置、自定义内容、存档及验证抓包不入库；空密钥模板与公开前端 API 默认值保留。配置文件的 Git 边界见[文件清单](REPOSITORY_HYGIENE.md)，文档按[索引](README.md)区分现行与历史。下面各日期章节保留对应时期说明，不把旧文体、五拍或用途扩写重新当作当前配置入口。

## 静态内容整理：2026-11-05

当前静态内容边界见 [世界卡规范](NARRATIVE_WORLD_CARD_DESIGN.md)，边镇线采用运行版本 20，其余路线保留既有入口。worldCore.laws 可省略；仅有明确特殊世界规则时填写，不要求每个世界生成“资源决定权力”等常识。古代材料本轮撤掉四条抽象规律及一张通用权力卡，清理手续清单和作者指令，未新增设定或事件组。逐卡记录见 [审计清单](ANCIENT_STATIC_CONTENT_REVIEW.md)。

下方运行版本 18 及日期章节保留其对应时期的配置说明，不作为恢复旧文体、表达样例或五拍逻辑的制作入口。

## 当前规则：运行版本 18（2026-11-04）

详见 [当前叙事规范](NARRATIVE_V18.md)。世界配置不再支持文体、文风与结局指导字段。主持资料采用五项结构化模型输出，目的和收束依据取自 IF。时间交接必填，换幕不覆盖。配置编辑不提供已退出的职责项。IF 的 `endingDirections.closureBoundary` 区分局部受挫与成立的提前结局，不改变各幕目标及既有等级标准。

提示词包仅保留非叙事旧年度入口使用的 `yearNormalRule / yearMinorRule / milestoneRule` 与公共 `userInputGuardRule / restrictedContentRule`；当前 AI 叙事职责固定在任务合同中。旧键在规范化时丢弃，不另行映射。

下列日期章节均为历史记录，与当前规范冲突时不适用。

## 当前内容配置：2026-09-21 +08:00

| 内容 | 当前来源与作用 |
| --- | --- |
| 基础世界 | `data/worlds/<worldId>.json` 与 `data/narratives/<worldId>.story.json`；v10 只定义共同世界观、社会力量、世界卡、数值、生存和结局。 |
| IF 子世界包 | `data/narratives/story-packs/**/*.json`；加载器递归发现并依据文件内 `worldId` 归属，不在基础世界登记清单。 |
| 可玩状态 | 至少存在一个校验通过的子世界包才可开始新局；当前古代、现代、奇幻均已迁移并各有六条路线。 |
| 存档 | 开局快照完整子世界包；编辑磁盘路线只影响新局，不迁移进行中的存档。 |

模板分别见[基础世界包说明](../examples/world-pack/WORLD_PACK_GUIDE.txt)与[IF 子世界包说明](../examples/world-pack/STORY_PACK_GUIDE.txt)。下方 2026-09-10 表格保留为历史记录，其中版本号、逐路线配置和进程缓存描述不再代表当前 v10 入口。

## 当前配置入口对齐：2026-09-10 00:26 +08:00

本节补充当前动态叙事配置。后文保留的 `gameplayTuning.milestone/death/ascension` 等字段说明属于已有配置结构，不能据此认定当前主线按随机年龄里程碑或到龄飞升运行。

| 内容 | 当前来源与作用 |
| --- | --- |
| 世界选择列表 | 首次从 `data/worlds/*.json` 初始化至 `storage/custom-content.json.worlds`，经 bootstrap 提供给前端。已有内容存储不会自动追加新基础世界。 |
| 世界叙事 | `data/narratives/<worldId>.story.json`；三个内置包均为 v6，按 ID 加载并在进程中缓存。 |
| 年龄与成长 | 基础世界的 `ageThresholds`，叙事包的 `opening.earlyLife`、`progression.backgroundPacing/growthFocuses/routes/statTiers/statTierPresentation`。 |
| 生存与家境 | 叙事包的 `progression.survival`：阶段风险线、宽限年、风险上限、恢复成功率与体魄缓冲、年度家境支持。 |
| 主线结束与品质 | `progression.completion` 与 `endingBlueprints`；每条路线有 good / normal / bad 蓝图。 |
| 天赋 | `data/cards.json` 种子与内容仓储的 cards；模型接收最终选定卡的叙事画像，开局使用 modifiers。 |
| 难度 | 前端不开放选项，沿用 bootstrap 首项；后端配置结构保留。 |
| 部署模式 | 本地会话提供密钥和模型参数；云端使用服务端配置，两个入口不合并。 |
| 存档 | `storage/anonymous-game-store.json` 与 `ANONYMOUS_*` 环境配置；尚未使用数据库。 |

世界包模板见 [JSON 编写与使用说明](../examples/world-pack/WORLD_PACK_GUIDE.txt)。修改叙事包后需要重启后端以刷新进程缓存；添加基础世界时还需同步既有内容仓储。生存配置的当前数值见 [技术文档](./TECHNICAL.md)。

## 1. 配置入口与生效范围
- 运行配置：`storage/runtime-config.json`
- 内容配置：`storage/custom-content.json`
- 玩法调参主入口：`content.gameplayTuning`
- 生效时机：
  - 开局时冻结为 `run.tuningSnapshot`
  - 调参仅影响新开局，不回溯旧局

## 2. 核心配置文件说明

### 2.1 `storage/runtime-config.json`
控制后端默认 Provider（云端模式生效）：
- `baseUrl`
- `model`
- `apiPath`（`/chat/completions` 或 `/responses`）
- `temperature`
- `maxTokens`（默认 18240，用于容纳完整工具参数；正文长度由各任务提示词指导，旧默认 1824 在读取时升级）
- `timeoutMs`

### 2.2 `storage/custom-content.json`
控制游戏内容与玩法参数：
- `worlds`
- `cards`
- `difficulties`
- `promptPack`
- `gameplayTuning`

## 3. gameplayTuning 分组
- `bootstrap`：开局天赋点范围、选卡数量范围
- `pacing`：分块推进速度、小事件概率、平年概率
- `milestone`：抉择触发年龄下限、保底年数、阶段触发概率
- `stage`：年龄阶段属性波动上限、delta 分箱阈值
- `growth`：普通年份成长/衰减概率模型
- `decision`：抉择 A/B/C 的数值模板与风险元数据
- `death`：死亡风险判定参数
- `ascension`：飞升硬阈值与概率阈值
- `fame`：名望映射权重
- `ending`：结局评分分档阈值

## 4. 参数边界（后端 schema 校验）

### 4.1 `bootstrap`
- `talentPointMin`: 整数 `1~200`
- `talentPointMax`: 整数 `1~200`，且 `>= talentPointMin`
- `selectedCardMin`: 整数 `1~12`
- `selectedCardMax`: 整数 `1~12`，且 `>= selectedCardMin`

### 4.2 `pacing`
- `maxYearsPerChunk`: 整数 `1~12`
- `specialYearChance`: `0~1`
- `blankYearChance`: `0~1`

### 4.3 `milestone`
- `minEligibleAge`: 整数 `0~120`
- `guaranteeYears`: 整数 `1~120`
- `triggerRateByStage.*`: `0~1`

### 4.4 `stage`
- `deltaCapByStage.*`: 整数 `1~30`
- `lightBandRatio`: `(0,1)`
- `mediumBandRatio`: `(0,1)` 且 `>= lightBandRatio`
- `overallExtremeRatio`: `(0,1]`

### 4.5 `growth`
- `baseGrowthChance`: `0~1`
- `baseDecayChance`: `0~1`
- `decayVolatilityFactor`: `0~3`
- `growthChanceClampMin/Max`: `0~1` 且 `Max>=Min`
- `decayChanceClampMin/Max`: `0~1` 且 `Max>=Min`
- `decayBranchFactor`: `0~1`
- `specialPositiveBaseChance`: `0~1`
- `specialPositiveGrowthBiasFactor`: `0~3`

### 4.6 `decision`
- `profiles.*.successRate`: `0~1`
- `profiles.*.gain`: 整数 `1~20`
- `profiles.*.loss`: 整数 `-20~-1`
- `profiles.*.deathBonus/risk/reward`: `0~1`
- `successRateVolatilityFactor`: `0~2`
- `successRateClampMin/Max`: `0~1` 且 `Max>=Min`
- `gainClampMin/Max`: 整数 `1~30` 且 `Max>=Min`
- `lossClampMin/Max`: 整数 `-30~-1` 且 `Max>=Min`
- `secondarySuccessDelta`: 整数 `-5~10`
- `secondaryFailureDelta`: 整数 `-10~5`

### 4.7 `death`
- `minAge`: 整数 `0~120`
- `negativeStreakTrigger`: 整数 `1~60`
- `lowPhysiqueThreshold`: 整数 `1~30`
- `physiqueBaseRisk`: `0~1`
- `physiqueMissingRiskFactor`: `0~1`
- `physiqueRiskClampMin/Max`: `0~1` 且 `Max>=Min`
- `longNegativeBaseRisk`: `0~1`
- `longNegativeValueFactor`: `0~1`
- `longNegativeStreakDivisor`: `(0,100]`
- `longNegativeStreakFactor`: `0~1`
- `longNegativeRiskClampMin/Max`: `0~1` 且 `Max>=Min`
- `finalRiskClampMin/Max`: `0~1` 且 `Max>=Min`

### 4.8 `ascension`
- `deterministicStatThreshold`: 整数 `1~60`
- `chanceA/B/C`: `0~1`
- `highStatsThresholdA/C`: 整数 `1~5`
- `fortuneThresholdA`: 整数 `0~30`
- `legendaryCountThresholdB`: 整数 `0~10`
- `intelligenceThresholdB`: 整数 `0~30`

### 4.9 `fame`
- `*_Weight`: `0~3`
- `maxStatValue`: 整数 `1~100`
- `min/max`: `0~100` 且 `max>=min`

### 4.10 `ending`
- `greatScore/goodScore/normalScore`: `0~200`
- 约束：`greatScore >= goodScore >= normalScore`

## 5. 当前版本的抉择与幼年约束
- 抉择触发：阶段概率随机 + `guaranteeYears` 保底
- 抉择最低年龄：`minEligibleAge`（默认 5）
- 抉择结算后仍会经过 `stage.deltaCapByStage` 截断
- 因此幼年阶段仍受 `child` 上限约束（默认 `-2..2`）

## 6. promptPack 建议
- `systemCore` 放全局硬约束
- `yearNormalRule/yearMinorRule` 控制年度文风
- `milestoneRule` 只管抉择背景与 A/B/C 文案输出格式
- `storyConstraint/endingHint` 负责主线收束

## 7. 调参建议
1. 一次只改一个分组（例如只改 `milestone`）
2. 每次改完至少跑 10 局看分布（抉择年龄、死亡年龄、飞升率）
3. 异常可回滚 `storage/backups/content-*.json`

## 8. 叙事世界包配置（2026-08-21 01:29 +08:00，增量）

- 当前叙事世界包源为 `data/narratives/<worldId>.story.json`；古代包是已完整接入的示例。世界包定义 `mainlineSkeleton`、`mainlineActs`、`routeArcs`、人物、Lore、事实和结局蓝图。
- `routeArcs` 的 `directionId` 是导演工具可选路线 ID。路线数量由该数组决定，不是引擎常量；新世界应同时提供路线摘要、核心线程和对应素材 ID。
- 事件仍在 `data/events/faction-events.json` 与 `data/events/event-metadata.json` 中定义。加载时按同一事件 ID 合并世界包 `eventBindings`，得到 `storyDirectionIds` 与 `narrativeBeat`。
- 当前内容加载校验要求每条已配置路线均有 `setup/escalation/pressure/climax/payoff` 五种已绑定素材，防止模型选择路线后没有可渲染事件。这个约束来自内容完整性校验，不代表路线之间互斥。
- `maxAge` 是素材权重偏好而非叙事终止条件；世界主线与结局不会因年龄达到某个上限自动结束。
- 本地 Provider 默认值为 `https://api.deepseek.com`、`deepseek-v4-flash`、`/chat/completions` 与 `reasoningEffort=minimal`。这些值可被 `DEFAULT_PROVIDER_*` 环境变量或会话配置覆盖。

## 9. 叙事属性与结局调参（2026-08-22 01:34 +08:00，增量）

- 导演模式下，`growth` 与 `decision.profiles` 仍保留给旧非叙事链路；当前叙事链路的属性数值来自模型工具结果，经 `NarrativeAttributePolicy` 审批后落盘。
- 普通背景段只能落入轻/中度正向属性变化。导演抉择的风险梯度不由 `decision.profiles.gain/loss` 直接决定：稳健仅轻度正收益，适中允许轻/中度且必须至少一项正收益，冒险允许重度正负结果。
- `fame` 新增：`mainlineActBonus`、`stableChoiceBonus`、`balancedChoiceBonus`、`riskyBreakthroughBonus`、`riskySetbackPenalty`。它们分别影响世界幕完成、三类抉择后果的名望增减；`maxStatValue` 仍是属性名望基数的归一上限。
- `ending.narrativeNormalScore` 与 `ending.narrativeGoodScore` 控制主线完成后的普通/好结局分界，`narrativeFameWeight` 为名望在结局分数中的有限修正。约束为 `narrativeGoodScore >= narrativeNormalScore`。
- 每个叙事世界包的每条 `routeArcs.directionId` 必须配置 `good`、`normal`、`bad` 三张结局蓝图，并与原有五步素材完整性校验一起在内容加载期检查。
## 配置增量：2026-09-22 +08:00 — 独立 World Card 目录

| 内容 | 当前入口 |
| --- | --- |
| 基础世界稳定规则与时代切片 | `data/narratives/<worldId>.story.json` |
| 世界资料卡 | `data/narratives/world-cards/<worldId>/**/*.json`，每份文件为 `{ worldId, cards }` |
| IF 子世界包 | `data/narratives/story-packs/**/*.json`，通过 `worldCardRefs` 引用所属世界卡 |

世界卡目录会递归发现并合并；卡片 ID 在同一世界内必须唯一。子世界包不能内嵌卡片正文，包级和幕级引用都必须指向已加载卡片。引用只影响召回优先级，不限制其他世界资料参与故事。示例见 `examples/world-pack/world-cards.example.json`。
