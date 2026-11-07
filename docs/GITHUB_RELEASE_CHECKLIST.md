# 提交前核对

更新于 2026-11-06。当前文件边界及验证脚本见[仓库文件与验证记录](REPOSITORY_HYGIENE.md)。

## 源码与本地文件

- 提交 `.ts/.tsx` 源码、手写声明、静态世界与事件组、回归及回放脚本、说明文档和选定的文档图片。
- 不提交依赖、构建产物、相邻生成的 `.js/.d.ts`、缓存、日志、`storage/`、`Material/` 或真实密钥。
- 保留空密钥 `apps/backend/.env.example` 和仅包含公开地址的两份前端环境默认值。
- 不用全局 `*.txt`、`*.json`、`*.d.ts` 隐藏素材、模板或手写类型。
- 本次 20 个已跟踪生成物及两份本地代理偏好已取消跟踪，本地文件保留；删除记录与新忽略规则一起提交。

## 检查实际暂存内容

在仓库根目录执行：

```powershell
git status --short
git diff --cached --stat
git ls-files -ci --exclude-standard
git diff --check
git diff --cached --check
```

`git ls-files -ci --exclude-standard` 应无输出。忽略规则不会自动影响已跟踪文件，发现例外时逐项确认并仅取消跟踪，避免删除本地存档。

可核对具体规则：

```powershell
git check-ignore --no-index -v Material/ak.txt storage/anonymous-game-store.json apps/frontend/src/App.js
```

同时检查 TypeScript 源码、后端手写声明、`data/`、`scripts/`、模板与 docs 仍可正常入库。不要强制添加整个本地记录目录。

## 功能与资料交接

- 类型、工具声明、解析、暂存、保存恢复与实际消费者成组提交。
- 边镇事件骨架及 IF 同时提交；幕初、独立接组与观察职责不能缺其中一部分。
- 当前文档明确版本 20 与其他 IF 版本 18 的不同实现，不把基础世界内容版本 10 当作运行协议。
- 不把旧验收中的五拍、资产用途提炼或旧摘要供应恢复成现行规则。
- 确认文档中的本地抓包引用只作本机证据，公开结论不依赖仓库包含这些产物。

验证命令：

```powershell
npm test -w @reroll/backend
npm run build
```

本轮仅更新忽略规则、索引与文档，没有重新调用模型或推进玩家局。既有 269 项回归和整局证据见[最新验证记录](PERIOD_MEMORY_AND_EVENT_ROUTING.md)；今后修改运行代码应重新运行相关检查。

## 提交范围

先检查实际差异再选择暂存文件。本轮没有自动 commit、push、创建发布或部署；发布与存档备份是独立操作，Git 不能代替运行数据备份。
