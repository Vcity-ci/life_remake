# GitHub 上传前检查清单（v0.8.1）

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
