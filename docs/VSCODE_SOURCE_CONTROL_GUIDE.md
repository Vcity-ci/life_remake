# VS Code 源代码管理上传指南（v0.8.1）

本指南用于把当前项目通过 VS Code 的“源代码管理”面板上传到 GitHub。

## 1. 前置条件

1. 安装 Git 并可在终端执行 `git --version`
2. VS Code 已登录 GitHub 账号
3. 项目目录已在 VS Code 打开

## 2. 第一次初始化仓库（若尚未初始化）

在 VS Code 终端执行：

```powershell
git init
git branch -M main
```

## 3. 在 VS Code 里提交

1. 左侧点击“源代码管理”（分支图标）
2. 确认变更列表中不包含敏感文件（特别是 `apps/backend/.env`）
3. 在顶部输入提交信息，例如：
- `chore: prepare docs and release checklist for github`
4. 点击“提交”

## 4. 关联远程 GitHub 仓库

### 方式 A：命令面板
1. `Ctrl + Shift + P`
2. 输入并执行：`Git: Add Remote`
3. 远程名填：`origin`
4. 远程地址填：`https://github.com/<user>/<repo>.git`

### 方式 B：终端
```powershell
git remote add origin https://github.com/<user>/<repo>.git
```

## 5. 首次推送

在源代码管理面板点击“发布分支”，或终端执行：

```powershell
git push -u origin main
```

## 6. 后续日常提交流程

1. 改代码
2. 源代码管理面板查看 diff
3. 填写 commit message 并提交
4. 点击“同步更改”或执行：
```powershell
git push
```

## 7. 常见问题

1. 提示未设置用户信息
```powershell
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
```

2. 远程已存在同名仓库历史，推送被拒绝
- 先执行 `git pull --rebase origin main`
- 解决冲突后再 `git push`

3. 不小心把 `.env` 加进暂存区
```powershell
git restore --staged apps/backend/.env
```
