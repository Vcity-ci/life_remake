# 更新日志

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
