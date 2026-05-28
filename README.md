# AI 人生重开器 + 跑团

一个前后端分离、可扩展、可本地/云端双模式运行的 AI 跑团项目。

## 特性
- 三个内置世界观：`现代`、`古代`、`奇幻`
- 主界面仅保留：属性配置、人设输入、天赋卡选择、开始游戏
- 所有运行/模型/内容配置集中在左上角 `Setting` 控制台
- 年份推进分三类节点（全部调用 AI 生成文本）
  - 普通节点：年度叙事
  - 小事件节点：突发事件叙事
  - 可选事件节点：背景 + A/B/C 选项
- A/B/C 选项语义固定
  - A：低风险低收益
  - B：中风险中收益
  - C：高风险高收益
- 年龄阶段系统：`幼年/青年/壮年/中年/老年`
- 飞升机制：`长生不老/返老还童/青春永驻`
- 自动推进到可选节点，用户看到的是逐年动态叙事

## 启动方式（双链路）
- 本地部署链路（调试主线）：[start-local.bat](./start-local.bat)
- 云端体验链路（域名体验站预留）：[start-cloud.bat](./start-cloud.bat)
- 兼容入口：[start.bat](./start.bat)（默认转发本地链路）

## 运行模式
- 模式由启动链路决定，不在局内切换。
- 云端链路：服务端持有 key（后端环境变量）。
- 本地链路：用户在 Setting 输入 key（会话级）。

## 参数范围
前端 Setting 中直接显示：
- `Temperature`: `0 ~ 2`
- `Max Tokens`: `64 ~ 4000`
- `Timeout`: `5000 ~ 120000ms`

## 本地保存
- 内容保存：`storage/custom-content.json`
- 内容备份：`storage/backups/content-*.json`
- 运行配置：`storage/runtime-config.json`
- 运行配置备份：`storage/backups/runtime-config-*.json`

## 文档导航
- [技术文档](./docs/TECHNICAL.md)：技术栈、目录结构、接口清单、配置与数据边界
- [架构文档](./docs/ARCHITECTURE.md)：系统分层、核心时序、模块职责与扩展点
- [使用流程](./docs/USAGE_FLOW.md)：从启动到开局、推进、结算、重开的完整流程
- [配置指南](./docs/CONFIG_GUIDE.md)：运行参数、设定文件、提示词模块与持久化
- [部署手册](./docs/DEPLOYMENT.md)：本地/云端链路、环境变量与上线建议
- [开发日志](./docs/DEV_LOG.md)：按日期记录的开发过程与文档整理项
- [更新日志](./docs/CHANGELOG.md)：版本级变更历史
- [GitHub 上传检查清单](./docs/GITHUB_RELEASE_CHECKLIST.md)：上传前安全检查与命令
- [VS Code 源代码管理指南](./docs/VSCODE_SOURCE_CONTROL_GUIDE.md)：在 VS Code 中完成提交与推送
