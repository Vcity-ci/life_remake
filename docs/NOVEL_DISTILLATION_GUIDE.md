# 小说蒸馏成新图配置操作文档

本文档说明如何把一部小说、设定集或长篇故事素材，借助 AI 蒸馏成本项目可用的新世界观配置。

## 1. 前提

- 只处理你拥有使用权的文本：原创、授权、公版，或仅用于本地私有测试的素材。
- 不建议把整部未授权商业小说直接上传到第三方模型。
- 如果素材很长，先分章摘要，再让 AI 基于摘要与结构化笔记生成配置。
- 目标不是复刻原作剧情，而是提取“世界规则、冲突结构、事件母题、人物命运感”，转成可随机运行的人生模拟地图。

## 2. 本项目需要的配置文件

运行时最关键：

- `storage/custom-content.json`
  - 当前实际运行内容入口。
  - 包含 `worlds`、`cards`、`difficulties`、`promptPack`、`gameplayTuning`。
  - 修改后影响新开局，不回溯旧局。

设定源与扩展入口：

- `data/worlds/*.json`
  - 世界基础配置种子。
  - 当前已有 `storage/custom-content.json` 时，直接改这里通常不会影响运行。
- `data/settings/worldlines/*.timeline.json`
  - 世界线背景、核心冲突、秩序、禁忌。
  - 当前 AI 摘要主要使用 `eraName`、`timeframe`、`coreConflict`、`socialOrder`、`taboos`。
- `data/settings/factions/factions.json`
  - 阵营价值观、行为方式、事件偏好、情报风格。
- `data/events/faction-events.json`
  - 各世界的阵营事件池，影响抉择背景和长期伏笔。
- `data/talents/talent-cards.json`
  - 天赋卡及 `promptHooks`，影响角色个人叙事倾向。
- `skills/ai-gm/prompt-pack.json`
  - 默认 prompt 资源。
  - 运行时若已有 `storage/custom-content.json`，优先看 `storage/custom-content.json.promptPack`。

## 3. 总流程

1. 确认素材范围
2. 分章做摘要
3. 蒸馏世界观圣经
4. 蒸馏阵营与事件池
5. 蒸馏天赋卡与叙事钩子
6. 生成项目 JSON 草案
7. 人工校验字段与边界
8. 写入 `storage/custom-content.json` 和 `data/*`
9. 本地跑局验证
10. 根据输出问题迭代 prompt 和事件池

## 4. 第一步：把小说拆成结构化摘要

长篇素材不要一次塞给 AI。建议按章节或每 1~3 万字分块处理。

每个分块让 AI 输出：

```text
你是世界观蒸馏助手。请从以下章节中提取可用于人生模拟游戏的结构化信息。
不要复述原文，不要输出长段剧情，只提炼规则、冲突、地点、阵营、事件母题。

输出 JSON：
{
  "plotFacts": ["本段发生的关键事实，最多8条"],
  "worldRules": ["世界运行规则，最多8条"],
  "socialOrder": ["阶层、制度、资源分配方式，最多8条"],
  "factions": [
    {
      "name": "阵营名",
      "values": ["价值观"],
      "behavior": "典型行动方式",
      "conflicts": ["与谁冲突、为何冲突"]
    }
  ],
  "eventSeeds": ["可随机化为年份事件或抉择事件的母题，最多12条"],
  "tone": ["叙事语气关键词"],
  "taboos": ["世界内禁忌或高风险行为"]
}

素材：
<<<粘贴本章或本段摘要>>>
```

产物建议保存为临时文件，例如：

```text
drafts/novel-distill/chapter-001.json
drafts/novel-distill/chapter-002.json
```

## 5. 第二步：合并成世界观圣经

把所有章节摘要喂给 AI，让它合并去重。

提示词：

```text
你是游戏世界观设计师。请把以下章节摘要合并成一个适合“AI人生重开器”的世界观圣经。
目标是让随机年份叙事有清晰脉络，而不是复刻原作剧情。

要求：
1. 提炼稳定世界规则，不写具体原文桥段。
2. 提炼可复用冲突，不依赖固定主角。
3. 每个字段短句高密度，避免散文。
4. 输出 JSON。

输出结构：
{
  "worldId": "英文小写id",
  "worldName": "中文世界名",
  "intro": "一句话介绍",
  "stylePrompt": "64字内文风和叙事重点",
  "eraName": "时代名",
  "timeframe": "时间范围或时代感",
  "coreConflict": "核心冲突，120字内",
  "socialOrder": "社会秩序，120字内",
  "taboos": ["世界禁忌，3-8条"],
  "yearlyEventHints": ["年份主题，5-8个"],
  "mainlineStages": [
    { "stage": "阶段名", "ageRange": "0-12", "goal": "该阶段主线压力" }
  ],
  "factionTone": "阵营互动总基调"
}

章节摘要：
<<<粘贴所有章节摘要或摘要索引>>>
```

## 6. 第三步：生成项目文件草案

### 6.1 生成 `worlds` 配置

目标位置：

- 新图种子：`data/worlds/{worldId}.json`
- 当前运行：同步到 `storage/custom-content.json.worlds`

字段模板：

```json
[
  {
    "id": "new_world",
    "name": "新世界名",
    "intro": "一句话介绍。",
    "stylePrompt": "文风克制，强调秩序、代价、长期伏笔。",
    "milestoneAges": [15, 20, 30, 40],
    "endAgeRange": { "min": 55, "max": 85 },
    "yearlyEventHints": ["主题一", "主题二", "主题三", "主题四", "主题五"]
  }
]
```

注意：

- `milestoneAges` 当前不是主要抉择触发逻辑，真实触发看 `gameplayTuning.milestone`。
- `yearlyEventHints` 会直接影响普通年标题主题。
- `stylePrompt` 会进入 AI prompt，但会被压缩，必须短而密。

### 6.2 生成 worldline

目标位置：

- `data/settings/worldlines/{worldId}.timeline.json`

模板：

```json
[
  {
    "id": "new_world",
    "eraName": "时代名",
    "timeframe": "时代范围",
    "coreConflict": "核心冲突，短句高密度。",
    "socialOrder": "阶层、制度、资源和风险结构。",
    "taboos": ["禁忌一", "禁忌二", "禁忌三"],
    "mainlineStages": [
      { "stage": "幼年", "ageRange": "0-12", "goal": "被秩序塑形，埋下身份压力。" },
      { "stage": "青年", "ageRange": "13-29", "goal": "选择阵营或道路，第一次付出代价。" }
    ],
    "factionTone": "阵营都不纯善，行动更看重代价与资源。"
  }
]
```

注意：

- 当前代码摘要主要使用 `eraName/timeframe/coreConflict/socialOrder/taboos`。
- `mainlineStages` 可先写好，但若希望强力进入 prompt，需要后续扩展 `summarizeWorldline`。

### 6.3 生成 factions

目标位置：

- `data/settings/factions/factions.json`

模板：

```json
[
  {
    "id": "faction_id",
    "name": "阵营名",
    "values": ["秩序", "血统", "代价"],
    "behavior": "通过婚盟、审判、资源封锁影响个人命运。",
    "eventBias": ["家族联姻", "边地战事"],
    "intelStyle": "消息常以密信、流言、账册异常出现。"
  }
]
```

设计标准：

- 每个阵营必须有明确利益，不只是一句设定。
- `behavior` 写“它如何改变玩家人生”。
- `eventBias` 要能映射到 `yearlyEventHints` 或事件池。

### 6.4 生成 faction-events

目标位置：

- `data/events/faction-events.json`

模板：

```json
[
  {
    "worldId": "new_world",
    "factionId": "faction_id",
    "events": [
      "你收到一封匿名密信，暗示家族账册里有不该存在的支出。",
      "边地忽然传来征调令，熟人劝你趁乱换取一份军功。",
      "旧日恩人要求你在公开场合为某个可疑人物作证。"
    ]
  }
]
```

事件池写法：

- 不写固定主角名。
- 用第二人称可承接的事件种子。
- 每条都要能自然变成 A/B/C 抉择。
- 每个阵营至少 8-15 条事件，避免复读。

### 6.5 生成 talent-cards

目标位置：

- `data/talents/talent-cards.json`
- 若要运行卡池立即生效，也要同步到 `storage/custom-content.json.cards`。

模板：

```json
[
  {
    "id": "t_hidden_lineage",
    "name": "隐秘血脉",
    "rarity": "rare",
    "description": "你的出身被刻意遮掩，却总在关键场合引来注视。",
    "modifiers": { "family": 1, "fortune": 1 },
    "tags": ["lineage", "secret"],
    "promptHooks": {
      "narrativeBias": "让身份疑云在年份叙事中逐步显影。",
      "eventAffinity": ["家族联姻", "朝堂倾轧"],
      "riskTone": "秘密带来机会，也带来被利用的风险。"
    }
  }
]
```

注意：

- `storage/custom-content.json.cards` 当前不保存 `promptHooks`，只保存基础卡牌字段。
- `promptHooks` 来自 `data/talents/talent-cards.json`，按已选卡进入 AI 上下文。
- 如果新增卡牌 id，要保证 `storage/custom-content.json.cards` 和 `data/talents/talent-cards.json` 的 id 对得上。

## 7. 第四步：生成 promptPack 建议

目标位置：

- `storage/custom-content.json.promptPack`
- 可同步种子到 `skills/ai-gm/prompt-pack.json`

提示词：

```text
请基于以下世界观圣经，为 AI 人生模拟生成 promptPack。
要求短句高密度，适合每年生成 50-80 字中文叙事。
必须强调：第二人称、不得改数值、不得跳出世界观、承接近期历史、避免复读。

输出 JSON：
{
  "systemCore": "",
  "immersionRules": "",
  "yearNormalRule": "",
  "yearMinorRule": "",
  "milestoneRule": "",
  "storyConstraint": "",
  "endingHint": ""
}

世界观圣经：
<<<粘贴世界观圣经>>>
```

建议：

- `systemCore` 放硬规则。
- `immersionRules` 放文风。
- `yearNormalRule/yearMinorRule` 控制年份总结。
- `milestoneRule` 只管抉择背景和 A/B/C。
- `storyConstraint` 放主线承接规则。
- `endingHint` 放结局回扣规则。

## 8. 第五步：人工校验清单

写入项目之前逐项检查：

- `worldId` 在所有文件一致。
- `storage/custom-content.json.worlds` 包含新世界。
- `data/settings/worldlines/*.timeline.json` 中有同一个 `id`。
- `data/events/faction-events.json` 中 `worldId` 匹配。
- `factionId` 必须能在 `factions.json` 找到。
- `cards[].modifiers` 只使用合法属性：`intelligence/charisma/family/fortune/physique`。
- `storage/custom-content.json.cards` 和 `data/talents/talent-cards.json` 的卡牌 id 对齐。
- `yearlyEventHints` 至少 5 个，避免普通年主题太窄。
- 每个阵营事件池至少 8 条，避免抉择背景重复。
- `promptPack` 不写长篇设定，写短规则。

## 9. 第六步：写入与生效

推荐做法：

1. 先备份 `storage/custom-content.json`。
2. 把新世界追加到 `storage/custom-content.json.worlds`。
3. 把新卡牌追加到 `storage/custom-content.json.cards`。
4. 把新世界线写入 `data/settings/worldlines/{worldId}.timeline.json`。
5. 把阵营写入 `data/settings/factions/factions.json`。
6. 把事件写入 `data/events/faction-events.json`。
7. 把天赋钩子写入 `data/talents/talent-cards.json`。
8. 重启后端，重新打开前端或刷新 bootstrap。

说明：

- 已进行中的对局不会回溯更新。
- 新配置只影响新开局。
- 如果只改 `data/worlds`，已有 `storage/custom-content.json` 时通常不会生效。

## 10. 第七步：本地验证

建议至少做三轮验证：

1. JSON 校验
   - 启动后端，看是否能正常 `/api/meta/bootstrap`。
   - 如果 schema 不通过，后端会在管理保存或读取流程暴露错误。
2. 小样本跑局
   - 每个世界跑 3 局，每局推进到至少 15 岁。
   - 观察普通年是否围绕同一世界规则。
   - 观察抉择背景是否来自阵营事件，而不是泛泛而谈。
3. 复读检查
   - 连续记录 20 条年份文本。
   - 标记重复开头、重复结尾、重复事件。
   - 回头增加 `yearlyEventHints`、阵营事件池或收紧 `storyConstraint`。

## 11. 常见问题

### 11.1 改了 `data/worlds` 但游戏没变化

原因：运行时优先读 `storage/custom-content.json`。  
处理：同步修改 `storage/custom-content.json.worlds`，或重建 storage。

### 11.2 世界线写得很长但 AI 没用上

原因：当前摘要主要取 `eraName/timeframe/coreConflict/socialOrder/taboos`。  
处理：把核心信息压进这些字段；或后续修改 `summarizeWorldline` 让 `mainlineStages` 进入 prompt。

### 11.3 事件像随机段子，没有主线

原因：事件池只写了孤立事件，没有阵营目标和长期代价。  
处理：每条事件都绑定阵营利益、玩家代价、可回扣后果。

### 11.4 人物线不贴合天赋

原因：只改了卡牌数值，没有同步 `data/talents/talent-cards.json.promptHooks`。  
处理：给每张核心天赋写 `narrativeBias/eventAffinity/riskTone`。

### 11.5 输出像原小说复述

原因：蒸馏提示词没有强调“提取规则，不复刻剧情”。  
处理：在蒸馏阶段明确禁止输出原文句子、固定角色剧情和专名依赖。

## 12. 推荐文件落地顺序

1. `data/settings/worldlines/{worldId}.timeline.json`
2. `data/settings/factions/factions.json`
3. `data/events/faction-events.json`
4. `data/talents/talent-cards.json`
5. `storage/custom-content.json.worlds`
6. `storage/custom-content.json.cards`
7. `storage/custom-content.json.promptPack`
8. 小样本跑局验证
9. 再同步 `data/worlds/{worldId}.json` 作为种子备份

这样做的好处是先保证 AI 上下文有主线和阵营，再让前端世界选项与开局卡池跟上。
