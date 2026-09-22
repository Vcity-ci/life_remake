# GitHub 上传前检查清单（v0.8.1）

## 内容包发布核对补充：2026-09-21 +08:00

- 当前古代、现代、奇幻均为 v10 基础世界，各自提供六条 IF 子世界包，共十八条可选路线。
- 发布前同时校验 `data/narratives/*.story.json` 与 `data/narratives/story-packs/**/*.json`，并确认每条路线的 `worldId`、三幕命名空间和社会力量引用有效。
- 社区扩展需要同时提供[基础世界模板](../examples/world-pack/WORLD_PACK_GUIDE.txt)与[IF 路线模板](../examples/world-pack/STORY_PACK_GUIDE.txt)。

## 文档发布核对补充：2026-09-10 00:26 +08:00

- 对外功能以当前 [README](../README.md) 和各 docs 顶部增量记录为准；早期随机事件、古代唯一世界、双向结局描述不应再作为发布摘要。
- 当前仓库包含古代、奇幻、现代三个 v9 世界包；扩展入口为 [世界包模板与说明](../examples/world-pack/WORLD_PACK_GUIDE.txt)。
- 数据库与前端 UX 交互是后续 issue 方向，不应在发布说明中写成已交付功能。
- 本轮没有执行发布、部署或构建；以下原检查清单保留。

本清单用于在上传仓库到 GitHub 前做一次“安全 + 可复现”检查。

## 1. 必做检查

1. 检查是否误提交密钥或本地环境文件
- 不应上传：
  - `apps/backend/.env`
  - 任意包含真实 key/token 的文件
- 仓库中仅保留：
  - `apps/backend/.env.example`（空 key 占位）

2. 检查是否误提交运行时数据
- 当前 `.gitignore` 已忽略 `storage/`
- 上传前确认没有强制追踪 `storage/*`

3. 检查是否误提交依赖与构建产物
- 根目录已忽略 `node_modules`、`dist`
- 额外注意：`apps/frontend/node_modules/.vite/` 属于子目录缓存，不应入库

4. 检查启动配置一致性
- `apps/backend/.env.example` 使用 `DEPLOY_MODE`
- 若本地 `apps/backend/.env` 使用了其他变量名（如 `REROLL_RUNTIME_MODE`），需对齐后再使用

## 2. 推荐检查命令（PowerShell）

在项目根目录执行：

```powershell
# 查看未提交文件
git status --short

# 检查可能的密钥痕迹（排除依赖与构建目录）
rg -n --hidden -g '!node_modules/**' -g '!apps/frontend/dist/**' -g '!apps/backend/dist/**' -e "(api[_-]?key|secret|token|password|CLOUD_MODEL_API_KEY|OPENAI|Authorization|Bearer|sk-[A-Za-z0-9])"

# 检查绝对路径/本地路径痕迹
rg -n --hidden -g '!node_modules/**' -g '!apps/frontend/dist/**' -g '!apps/backend/dist/**' -e "C:\\Users\\|D:\\|/Users/|/home/|file://|vscode://"
```

## 3. 当前项目已确认项（本次审计）

1. `.gitignore` 已忽略：
- `node_modules`
- `dist`
- `.env`
- `storage`

2. 未发现真实 key 文本（仅占位字段）
- `CLOUD_MODEL_API_KEY=` 仍为空占位

3. 发现需人工确认项
- `apps/backend/.env` 存在本地调试配置：
  - `DEBUG_MODEL_CALLS=1`
  - `REROLL_RUNTIME_MODE=cloud`
- 该文件不应上传，上传前确保不被追踪

## 4. 上传前最终动作

1. 若存在被追踪的本地文件，先移除追踪再提交：
```powershell
git rm --cached apps/backend/.env
```

2. 提交文档与代码：
```powershell
git add .
git commit -m "chore: prepare repo for GitHub release"
```

3. 推送到远程：
```powershell
git remote add origin <你的仓库地址>
git branch -M main
git push -u origin main
```

## 5. 当前叙事改动提交检查（2026-08-21 01:29 +08:00，增量）

- v9 世界核心、本局前提、故事形态／社会力量与节拍观察涉及 `packages/shared/src/index.ts`、`apps/backend/src/ai.ts`、`apps/backend/src/narrative.ts`、`apps/backend/src/narrative/runtime.ts`、`apps/backend/src/engine.ts` 和 `apps/backend/src/index.ts`；提交时应确保契约、编排与状态迁移一起进入版本库。
- 回归测试位于 `apps/backend/src/engine.test.ts`，覆盖世界级门槛、三段五拍、可选故事素材、情景世界卡和世界级三档结局。
- 文档同步包含架构、技术、使用、配置、蒸馏、变更与开发日志；`docs/DEPLOYMENT.md` 不属于本次叙事变更范围。
- 发布前至少执行 `npm run test -w @reroll/backend` 与 `npm run build -w @reroll/backend`。若共享包 `dist` 被本地进程占用，不要强制杀进程；先确认源码和后端类型构建结果，再在空闲时重建共享产物。
