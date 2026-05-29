# 配置指南（v0.9.0）

## 1. 配置入口与生效范围
- 模型与部署参数：`storage/runtime-config.json`
- 游戏内容与玩法参数：`storage/custom-content.json`
- 玩法调参主入口：`content.gameplayTuning`
- 生效时机：
  - `gameplayTuning` 在开局时冻结为 `run.tuningSnapshot`
  - 调参仅影响“新开局”，不会回溯修改进行中的旧局

## 2. 快速调参流程（推荐）
1. 打开 Setting 的“内容配置”，或调用 `GET /api/admin/content` 拉取当前内容。
2. 编辑 `gameplayTuning`。
3. 保存（`POST /api/admin/content`）。
4. 重新开一局验证（旧局不变）。

## 3. gameplayTuning 分组说明
- `bootstrap`：开局点数与选卡数量范围。
- `pacing`：每次推进年数、小事件概率、平年概率。
- `milestone`：抉择触发年龄、阶段概率、保底年数。
- `stage`：各年龄段单年属性波动上限与分箱比例。
- `growth`：常规年份成长/衰减的基础概率模型。
- `decision`：A/B/C 成败模型、收益惩罚、死亡加成。
- `death`：死亡判定门槛与风险曲线。
- `ascension`：飞升硬阈值与概率阈值。
- `fame`：名望权重与映射区间。
- `ending`：结局文案分档阈值。

## 4. 参数边界与约束（后端校验）

### 4.1 `bootstrap`
- `talentPointMin`：整数 `1~200`
- `talentPointMax`：整数 `1~200`，且 `>= talentPointMin`
- `selectedCardMin`：整数 `1~12`
- `selectedCardMax`：整数 `1~12`，且 `>= selectedCardMin`

### 4.2 `pacing`
- `maxYearsPerChunk`：整数 `1~12`
- `specialYearChance`：`0~1`
- `blankYearChance`：`0~1`

### 4.3 `milestone`
- `minEligibleAge`：整数 `0~120`
- `guaranteeYears`：整数 `1~120`
- `triggerRateByStage.child/youth/prime/middle/elder`：各 `0~1`

### 4.4 `stage`
- `deltaCapByStage.child/youth/prime/middle/elder`：整数 `1~30`
- `lightBandRatio`：`(0, 1)`
- `mediumBandRatio`：`(0, 1)`，且 `>= lightBandRatio`
- `overallExtremeRatio`：`(0, 1]`

### 4.5 `growth`
- `baseGrowthChance`：`0~1`
- `baseDecayChance`：`0~1`
- `decayVolatilityFactor`：`0~3`
- `growthChanceClampMin/Max`：各 `0~1`，且 `Max >= Min`
- `decayChanceClampMin/Max`：各 `0~1`，且 `Max >= Min`
- `decayBranchFactor`：`0~1`
- `specialPositiveBaseChance`：`0~1`
- `specialPositiveGrowthBiasFactor`：`0~3`

### 4.6 `decision`
- `profiles.safe/balanced/risky.successRate`：`0~1`
- `profiles.safe/balanced/risky.gain`：整数 `1~20`
- `profiles.safe/balanced/risky.loss`：整数 `-20~-1`
- `profiles.safe/balanced/risky.deathBonus/risk/reward`：各 `0~1`
- `successRateVolatilityFactor`：`0~2`
- `successRateClampMin/Max`：各 `0~1`，且 `Max >= Min`
- `gainClampMin/Max`：整数 `1~30`，且 `Max >= Min`
- `lossClampMin/Max`：整数 `-30~-1`，且 `Max >= Min`
- `secondarySuccessDelta`：整数 `-5~10`
- `secondaryFailureDelta`：整数 `-10~5`

### 4.7 `death`
- `minAge`：整数 `0~120`
- `negativeStreakTrigger`：整数 `1~60`
- `lowPhysiqueThreshold`：整数 `1~30`
- `physiqueBaseRisk`：`0~1`
- `physiqueMissingRiskFactor`：`0~1`
- `physiqueRiskClampMin/Max`：各 `0~1`，且 `Max >= Min`
- `longNegativeBaseRisk`：`0~1`
- `longNegativeValueFactor`：`0~1`
- `longNegativeStreakDivisor`：`(0, 100]`
- `longNegativeStreakFactor`：`0~1`
- `longNegativeRiskClampMin/Max`：各 `0~1`，且 `Max >= Min`
- `finalRiskClampMin/Max`：各 `0~1`，且 `Max >= Min`

### 4.8 `ascension`
- `deterministicStatThreshold`：整数 `1~60`
- `chanceA/B/C`：各 `0~1`
- `highStatsThresholdA/C`：整数 `1~5`
- `fortuneThresholdA`：整数 `0~30`
- `legendaryCountThresholdB`：整数 `0~10`
- `intelligenceThresholdB`：整数 `0~30`

### 4.9 `fame`
- `intelligenceWeight/charismaWeight/familyWeight/fortuneWeight/physiqueWeight`：各 `0~3`
- `maxStatValue`：整数 `1~100`
- `min/max`：各 `0~100`，且 `max >= min`

### 4.10 `ending`
- `greatScore/goodScore/normalScore`：各 `0~200`
- 约束：`greatScore >= goodScore >= normalScore`

## 5. 常用调参方案（按目标）

### 5.1 提高开局自由度
- 提高 `bootstrap.talentPointMin/Max`
- 提高 `bootstrap.selectedCardMax`
- 建议每次只改 `+2~+5` 点或 `+1` 张卡，先观察 5~10 局分布

### 5.2 提高推进速度（更快出内容）
- 提高 `pacing.maxYearsPerChunk`（例如 `2 -> 3/4`）
- 可小幅提高 `milestone.triggerRateByStage.*` 缩短到决策点时间
- 注意：块更大时，单次 step 的 AI 文本生成量也会变大

### 5.3 降低早死率
- 提高 `death.minAge`
- 降低 `death.physiqueBaseRisk` 与 `death.longNegativeBaseRisk`
- 提高 `death.negativeStreakTrigger`
- 收紧 `decision.profiles.risky.deathBonus`

### 5.4 提高博弈张力
- 提高 `decision.profiles.risky.gain` 与 `decision.profiles.risky.loss` 的绝对值
- 提高 `decision.successRateVolatilityFactor`
- 同时收紧 `decision.gain/loss clamp`，防止单次波动失控

### 5.5 控制抉择出现频率
- 更频繁：提高 `milestone.triggerRateByStage.*` 或降低 `guaranteeYears`
- 更稀疏：降低 `milestone.triggerRateByStage.*` 或提高 `guaranteeYears`
- 幼年保护：通过 `minEligibleAge` 控制（当前默认 `5`）

## 6. 当前默认抉择链路（已落地）
- 触发规则：按年龄阶段概率随机 + 连续 `20` 年未触发保底。
- 触发年龄下限：`5` 岁。
- 背景种子：从当前 world 的 `data/events/faction-events.json` 随机抽取。
- 文案下发顺序：`started` 不下发 milestone，等 AI options ready 后再发 `milestone`，避免前端挂 fallback。

## 7. 与模型参数的分工
- `gameplayTuning`：控制“数值与触发逻辑”。
- `promptPack`：控制“叙事风格与文本约束”。
- `runtime-config`（模型参数）：控制“模型调用表现（如温度/超时/最大 tokens）”。

## 8. 调参建议（执行层）
1. 一次只改一个分组（例如先改 `milestone`）。
2. 每次改动后至少跑 10 局看分布（死亡年龄、抉择出现年龄、飞升率）。
3. 如果出现异常，直接回滚 `storage/backups/content-*.json` 最近一版。
