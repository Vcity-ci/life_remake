# 配置指南（v0.7.0）

## 1. 使用流程
1. 选择启动链路：
   - 本地调试：双击 `start-local.bat`（或 `start.bat`）
   - 云端体验：双击 `start-cloud.bat`
2. 打开网页后点击左上角 `Setting`
3. 在“会话配置”确认本局参数
4. 关闭 Setting 回到主界面开局

## 1.1 开局点数与抽卡规则
- 每局随机“本局可用天赋点总数”：`20~30`
- 开局维度：`智力/魅力/家境/气运/体魄`
- 五维初始为 0，由玩家手动分配。
- 页面仅显示“可用天赋点剩余值”。
- 当可用点数为 0，继续加点无效（不抛错）。
- 抽卡为三卡背翻牌展示，翻开后按稀有度渲染边框。

## 2. 结局判定
- 仅两种结束：
  - 死亡（体魄与名望相关风险）
  - 飞升（任一关键属性达到 30）

## 3. 名望（fame）
- 名望由四维平权评分得出：
  - `智力/魅力/气运/体魄`
- 百分制范围：`0~100`

## 4. 选项规则
- A：低风险低收益
- B：中风险中收益
- C：高风险高收益（可触发死亡）

## 4.1 文本长度规则（提示词约束）
- 年份总结：`80~150字`
- 事件背景：`80~150字`
- 选项描述：每项 `<=20字`
- 对话句：单句 `<=20字`

## 5. 设定集与路径
- 世界线设定：`data/settings/worldlines/*.timeline.json`
- 阵营设定：`data/settings/factions/factions.json`
- 阵营事件池：`data/events/faction-events.json`
- 天赋卡与叙事钩子（20张）：`data/talents/talent-cards.json`
- 游戏实际卡池（运行读取）：`data/cards.json`
- 提示词规则包：`skills/ai-gm/prompt-pack.json`

## 6. 提示词模块
编辑 `skills/ai-gm/prompt-pack.json`：
- `yearNormalRule`
- `yearMinorRule`
- `milestoneRule`
- `storyConstraint`
- `endingHint`

说明：
- 文本长度由提示词工程控制，不通过前端调 `max_tokens` 来裁切。
- 模型会接收到“空过年份记录”用于后续叙事承接。

## 7. 参数上下限
- Temperature: `0~2`
- Timeout: `5000~120000`
- Max Tokens：由后端固定，不在 Setting 面板开放

## 8. 本地持久化
- 内容：`storage/custom-content.json`
- 内容备份：`storage/backups/content-*.json`
- 运行配置：`storage/runtime-config.json`
- 运行配置备份：`storage/backups/runtime-config-*.json`
