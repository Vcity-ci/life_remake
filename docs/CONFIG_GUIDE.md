# 配置指南（v1.0.0）

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
- `maxTokens`
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
- `systemCore/immersionRules` 放全局硬约束
- `yearNormalRule/yearMinorRule` 控制年度文风
- `milestoneRule` 只管抉择背景与 A/B/C 文案输出格式
- `storyConstraint/endingHint` 负责主线收束

## 7. 调参建议
1. 一次只改一个分组（例如只改 `milestone`）
2. 每次改完至少跑 10 局看分布（抉择年龄、死亡年龄、飞升率）
3. 异常可回滚 `storage/backups/content-*.json`
