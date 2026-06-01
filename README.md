# AI 人生重开器 + 跑团

一个**纯文字自动化小说**、偏策略选择的**半 TRPG**项目。  
你只负责设定角色与做关键决策；引擎负责推进岁月与数值，AI 负责把每一年写成可读、可连续追踪的叙事。

项目采用前后端分离架构，可本地运行，也可作为云端体验站部署。（官方体验站（持续更新）：http://47.98.121.127/

## 这个项目的三条主线

### 1) 完全开源的可控引擎
- 游戏规则不藏在模型黑盒里，而是集中在 `apps/backend/src/engine.ts`
- 关键流程：`createRun`、`autoAdvanceToCheckpoint`、`applyMilestoneDecisionAndAdvance`
- 触发、成长、风险、结局都可被审查、调参、复现实验

### 2) AI 驱动的文本体验
- 年份叙事、抉择文案、结局总结由 AI 生成（`apps/backend/src/ai.ts`）
- 支持 OpenAI Compatible Provider（可配 `baseUrl/model/apiPath`）
- 内置 fallback：模型失败时仍可回退引擎文案，保证流程不断

### 3) 强扩展性（世界观 / 事件 / 玩法 / 提示词）
- 世界线、阵营、事件池、天赋钩子全部数据化
- 数值系统与概率系统可通过 `gameplayTuning` 统一调参
- Prompt Pack 可替换，支持不同文风和叙事约束

## 玩法循环（当前版本）

1. 选择世界观与难度，确认本局环境
2. 输入人设，分配五维属性，选择天赋卡
3. 进入“年份推进”循环：普通年 / 异动年 / 关键抉择年
4. 在里程碑节点做 A/B/C 决策，引擎先结算，AI 再叙事
5. 直到结局：`dead` 或 `ascended`

流式链路默认使用 NDJSON，事件顺序为：  
`started -> timeline -> meta -> milestone -> done`

## 快速开始

### 本地开发（推荐）
- 命令：`npm run dev:local`
- 或双击：`start-local.bat`

### 云端体验链路
- 命令：`npm run dev:cloud`
- 或双击：`start-cloud.bat`

### 通用命令
- 同时启动前后端：`npm run dev`
- 构建：`npm run build`

## 运行模式边界

- `DEPLOY_MODE=local`
  - 会话内使用用户输入的本地 API Key
  - 适合个人调试与模型对比
- `DEPLOY_MODE=cloud`
  - 仅使用服务器 `CLOUD_MODEL_API_KEY`
  - `/api/admin/*` 管理接口锁定为 `403`
  - 适合公开体验站

## 扩展入口（你最可能会改的地方）

- 世界线设定：`data/settings/worldlines/*.timeline.json`
- 阵营设定：`data/settings/factions/factions.json`
- 阵营事件池：`data/events/faction-events.json`
- 天赋与叙事钩子：`data/talents/talent-cards.json`
- 内容与调参：`storage/custom-content.json`
- Provider 运行配置：`storage/runtime-config.json`
- Prompt 资源：`skills/ai-gm/prompt-pack.json`

## 配置原则

- 开局时会冻结 `run.tuningSnapshot`
- 调参只影响新开局，不回溯已进行中的局
- `storage/backups/*` 自动保存配置备份，便于回滚

## 工程结构

```text
apps/
  backend/   # API 编排 + 规则引擎 + AI 适配
  frontend/  # 游戏 UI + 流式事件消费
packages/
  shared/    # 前后端共享类型与契约
data/        # 世界观、阵营、事件、天赋资源
skills/      # Prompt 相关资源
storage/     # 运行配置、内容配置、备份
docs/        # 全量文档
```

## 文档导航

- [使用流程](./docs/USAGE_FLOW.md)
- [配置指南](./docs/CONFIG_GUIDE.md)
- [架构文档](./docs/ARCHITECTURE.md)
- [技术文档](./docs/TECHNICAL.md)
- [部署手册（Windows Server + IIS）](./docs/DEPLOYMENT.md)
- [更新日志](./docs/CHANGELOG.md)
- [开发日志](./docs/DEV_LOG.md)
- [GitHub 发布检查清单](./docs/GITHUB_RELEASE_CHECKLIST.md)
- [VS Code 源码管理指南](./docs/VSCODE_SOURCE_CONTROL_GUIDE.md)

## 许可证

[MIT](./LICENSE)
