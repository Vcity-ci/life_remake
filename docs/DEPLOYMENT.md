# 部署手册（v0.6.0）

## 1. 部署目标
本项目已拆分为两条独立启动链路：
- 本地部署链路（调试主线）
- 云端体验链路（域名访问主线）

两条链路在“启动入口”和“运行模式”层面解耦，不在局内切换。

## 2. 启动入口
### 2.1 本地部署（Local）
- 脚本：`start-local.bat`
- npm：`npm run dev:local`
- 行为：
  - 检查/安装依赖
  - 自动补全 `apps/backend/.env`
  - 启动前后端并自动打开 `http://localhost:5173`
- 模式：`DEPLOY_MODE=local`

### 2.2 云端体验（Cloud）
- 脚本：`start-cloud.bat`
- npm：`npm run dev:cloud`
- 行为：
  - 直接按云端链路启动（后续可对接正式部署脚本）
- 模式：`DEPLOY_MODE=cloud`
- 规划：
  - 队列化编排（Redis/BullMQ）与响应优化在云端链路统一落地

### 2.3 兼容入口
- `start.bat` 默认重定向到 `start-local.bat`

## 3. 运行模式边界
- 模式由启动链路决定，不再在 Setting 中切换。
- 后端通过 `DEPLOY_MODE` 固定当前链路。
- `/api/meta/bootstrap` 会返回 `deployMode` 给前端展示。
- 本地链路默认不依赖 Redis；云端链路可扩展 Redis 队列与多实例调度。

## 4. 密钥安全边界
### 4.1 云端链路
- 使用后端环境变量：`CLOUD_MODEL_API_KEY`
- key 不下发前端，不写入仓库文件

### 4.2 本地链路
- 本地 key 由用户会话输入
- 仅会话内存使用，不写盘，不写日志

## 5. 环境变量建议
- 通用：`apps/backend/.env`
- 示例：`apps/backend/.env.example`
- 关键项：
  - `DEPLOY_MODE=local|cloud`
  - `CLOUD_MODEL_API_KEY=`
  - `DEFAULT_PROVIDER_BASE_URL=`
  - `DEFAULT_PROVIDER_MODEL=`

## 6. 发布建议
- 本地发布：仅使用 local 链路文件，不携带云端密钥。
- 云端发布：密钥通过部署平台 Secret 注入，不写入仓库。
- 强制检查：发布前确认 `.env` 与 `storage/*` 未纳入提交。
- 云端性能阶段建议新增：
  - `REDIS_URL`
  - 队列并发与重试参数（如 `QUEUE_CONCURRENCY`、`QUEUE_ATTEMPTS`）
  - 事件流通道配置（用于前端增量接收）

## 7. 故障排查
- 前端无法连后端：确认 `PORT` 与 `CORS_ORIGIN`。
- 云端无输出：确认 `CLOUD_MODEL_API_KEY` 有效。
- 本地模式提示缺 key：确认已在 Setting 输入并“确认本局环境”。
- 本地启动后网页打不开且日志提示端口冲突：
  - 当前前端固定端口 `5173`（strictPort），不会自动跳端口。
  - 当前后端固定端口 `4000`。
  - 启动脚本会自动尝试释放 5173/4000 的占用进程。
  - 若释放失败，再手动执行：`taskkill /PID <pid> /F`
