# AI 人生重开器 + 跑团

一个前后端分离、可本地运行也可云端部署的 AI 文本 TRPG 项目。

## 当前版本
- 文档版本：`v1.0.0`
- 核心链路：流式年份推进 + 抉择节点 + 结局结算

## 功能概览
- 三个内置世界观：`现代`、`古代`、`奇幻`
- 角色创建：人设输入、五维加点、天赋卡选择
- 年份推进：普通年 / 异动年 / 关键抉择年
- 抉择机制：
  - 按年龄阶段概率触发
  - 连续未触发保底触发
  - 抉择背景种子来自阵营事件池
- 结局状态：`dead` 或 `ascended`
- 前端抉择历史：
  - 记录背景与选择
  - 在收到抉择年份 AI 文本后再挂载
  - 展示掷点胶囊

## 启动方式

### 本地开发
- 命令：`npm run dev:local`
- 或双击：`start-local.bat`

### 云端体验
- 命令：`npm run dev:cloud`
- 或双击：`start-cloud.bat`

### 通用
- 命令：`npm run dev`
- 构建：`npm run build`

## 运行模式
- 模式由后端 `DEPLOY_MODE` 决定，不在局内切换。
- `local`：会话中使用用户填写的本地 key。
- `cloud`：只用服务器 `CLOUD_MODEL_API_KEY`，管理接口锁定。

## 配置与数据
- 运行配置：`storage/runtime-config.json`
- 内容配置：`storage/custom-content.json`
- 备份目录：`storage/backups/*`
- 根目录资源：
  - `data/*`
  - `skills/ai-gm/prompt-pack.json`
  - `.env`（后端按项目根目录读取）

## 前端 API 基址规则
- `apps/frontend/src/lib/api.ts`：
  - `const API_BASE = import.meta.env.VITE_API_BASE_URL || "";`
- 开发：`.env.development` 指向 `http://localhost:4000`
- 生产：`.env.production` 为空字符串，走同域 `/api/*`

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
