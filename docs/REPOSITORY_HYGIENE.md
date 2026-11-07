# 仓库文件与验证记录

更新于 2026-11-06。本文件区分可复现源码、生成物与本地运行记录；忽略规则见根目录 `.gitignore`。

## 文件盘点

| 文件或目录 | 处理 | 依据 |
| --- | --- | --- |
| 各工作区 `node_modules/`、`dist/` | 忽略 | 安装或构建可再生 |
| `coverage/`、`.vite/`、`*.tsbuildinfo`、`*.log` | 忽略 | 测试、开发与编译缓存 |
| `apps/frontend/src/**/*.js`、同位置生成的 `.d.ts` 与 source map | 忽略并取消已有跟踪 | 当前前端 `tsc` 没有 `outDir/noEmit`，编译结果落在源码旁；真实源码是 `.ts/.tsx` |
| `packages/shared/src/index.js`、`index.d.ts` 及 map | 忽略并取消已有跟踪 | 前端编译包含共享源码，会生成这些相邻文件；共享包入口明确指向 `index.ts` |
| `apps/backend/src/types/seedrandom.d.ts` | 保留 | 手写类型声明，不是编译产物 |
| 前端 `src/vite-env.d.ts`、`src/types/**/*.d.ts` | 保留 | 手写前端声明的约定位置，不被生成物规则吞掉 |
| `.env`、`.env.*` | 忽略，以下三项例外 | 运行环境可能含私密配置 |
| `apps/backend/.env.example` | 保留 | 空密钥的启动模板 |
| `apps/frontend/.env.development`、`.env.production` | 保留 | 现有内容仅为公开 API 地址／同源默认值；不用于保存密钥 |
| `storage/` | 忽略 | 玩家存档、运行配置、自定义内容、备份、请求抓包、实测统计及临时图片 |
| `Material/` | 忽略 | 私人参考文本、图片和 `ak.txt` 测试密钥 |
| `.agent/`、`.codex/config.toml`、`.trae/skills/skill-config.json` | 忽略 | 本地代理状态或个人启用偏好；当前 Codex 配置为空 |
| `.trae/skills/beautify-github-readme/`、`skills/`、项目指令 | 保留 | 可复用项目技能及其素材，不因目录隐藏而一并忽略 |
| `data/`、`examples/` | 保留 | 静态世界、IF、制度卡、事件组和制作模板 |
| `scripts/`、测试源码 | 保留 | 可复用的完整对局、回放、统计与回归入口 |
| `docs/` 及文档 SVG／截图 | 保留 | 仓库说明与经过选择的展示素材 |
| `.DS_Store`、`Thumbs.db`、`Desktop.ini` | 忽略 | 操作系统元数据 |

原有 `.txt` 规则只匹配名字恰为 `.txt` 的文件，现保留这个边界并注明含义。没有使用 `*.txt`：示例目录中的文字制作指南应继续入库。也没有全局忽略 `*.js`、`*.json` 或 `*.d.ts`。

## 已跟踪生成物的处理

本次确认前端 18 个、共享包 2 个相邻生成文件，共 20 个；只从 Git 索引移除，本地文件保留。另取消空的 `.codex/config.toml` 与个人 `.trae/skills/skill-config.json` 的跟踪。没有移除手写后端声明、TypeScript 源码或项目技能。

这些取消跟踪表现为已暂存删除，需与 `.gitignore` 一起提交；本轮没有自动提交或推送。后续构建即使再次写入这些文件，也不会重新成为 Git 变更。

本轮没有修改 TypeScript 编译配置或运行逻辑。若将来新增手写前端声明，请放在上述声明位置；调整构建输出位置时同步收拢忽略规则。

## 验证脚本与产物

普通回归和构建：

```powershell
npm test -w @reroll/backend
npm run build
```

这两项不使用 `Material/ak.txt` 发起真实对局。真实模型验证为手动入口：

| 脚本 | 用途与输入 |
| --- | --- |
| `scripts/live-narrative-check.mjs` | 读本地测试密钥，独立临时存储跑边镇新局；`NARRATIVE_CHECK_STOP_FLOW` 指定组提交后停止，`NARRATIVE_CHECK_RESUME` 读取样本；开发定点回放可显式设置 `NARRATIVE_CHECK_CURRENT_MATERIAL=1`，仅隔离夹具换用当前素材、复用已有绑定与正文，不迁移玩家局。默认产物在 `storage/verification-<时间戳>/` |
| `scripts/replay-event-assets-check.mjs` | 用有待处理批次的本地存档回放展示维护 |
| `scripts/replay-event-flow-check.mjs` | 用对应历史抓包回放幕卡、收束与接组；读取脚本要求的来源文件名 |
| `scripts/replay-period-memory.mjs` | 参数为来源目录、输出目录、一个或多个 `model-*.json`，用当前职责回放时期压缩 |
| `scripts/summarize-narrative-check.mjs` | 根据抓包与 `latest-run.json` 生成 `audit.json`；不调用模型 |
| `scripts/export-narrative-story.mjs` | 根据本地存档导出 `story.md`；可指定组 ID 按来源与回合关联导出完整单组正文及抉择；不调用模型 |
| `scripts/replay-ending-check.mjs` | 参数为已结束存档、输出目录；保留真实历史与确认等级，排除此前结局输出，回放人生总结。不修改原存档；若此前结局已进入压缩摘要则拒绝回放 |

真实模型脚本会消耗配置服务的额度。请求抓包、完整正文与存档只保存在本地；可复用脚本入库。输出目录使用 `storage/`，不把一次性测试数据散落到源码目录。部分历史回放脚本要求特定抓包布局，不是通用游戏启动命令。

## 提交前检查

```powershell
git status --short
git diff --cached --stat
git ls-files -ci --exclude-standard
git check-ignore --no-index -v Material/ak.txt storage/anonymous-game-store.json apps/frontend/src/App.js
```

第三条应没有输出，表示当前索引中没有仍匹配忽略规则的文件。检查模板、源码、脚本及文档未被误忽略时，可对目标运行 `git check-ignore --no-index -v <路径>`；未匹配时返回码为 1 是正常结果。

`storage/` 不随 Git 发布，也不能依靠 Git 备份。部署时单独持久化并备份存档及自定义内容；需要分享实测时，另行选择不含密钥和私人故事的证据，不对整个目录强制添加。
