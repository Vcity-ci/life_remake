# 部署手册（Windows Server + IIS 体验站）

## 1. 目标
- 源码更新后，服务器只执行：
  - `git pull`
  - `npm install`
  - `npm run build`
  - 重启后端服务
- 前端走同域 `/api/*`，由 IIS 反代到 `127.0.0.1:4000`
- 后端固定从项目根目录读取：
  - `.env`
  - `data/*`
  - `skills/ai-gm/prompt-pack.json`

## 2. 目录约定（服务器）
- 项目根目录示例：`C:\srv\life_remake`
- 关键路径：
  - `C:\srv\life_remake\.env`
  - `C:\srv\life_remake\data\...`
  - `C:\srv\life_remake\skills\ai-gm\prompt-pack.json`
  - `C:\srv\life_remake\apps\frontend\dist\...`

## 3. 当前代码链路（已对齐）

### 3.1 前端 API
- `apps/frontend/src/lib/api.ts` 与 `apps/frontend/src/lib/api.js`：
  - `const API_BASE = import.meta.env.VITE_API_BASE_URL || "";`
- 环境文件：
  - `apps/frontend/.env.development`：`VITE_API_BASE_URL=http://localhost:4000`
  - `apps/frontend/.env.production`：`VITE_API_BASE_URL=`
- 结果：
  - 本地开发请求：`http://localhost:4000/api/*`
  - 生产请求：`/api/*`（同域）

### 3.2 后端内容与提示词读取
- `apps/backend/src/content.ts` 基于后端源码目录向上定位项目根：
  - 读取 `data/*`
  - 读取 `skills/ai-gm/prompt-pack.json`
- 不再依赖 `apps/backend/dist/data`、`apps/backend/dist/skills`

### 3.3 后端环境变量读取
- `apps/backend/src/index.ts` 显式：
  - `dotenv.config({ path: path.join(process.cwd(), ".env") })`
- 服务运行目录必须是项目根目录（`C:\srv\life_remake`）

## 4. IIS 反代配置（同域）

### 4.1 前置组件
- 安装 IIS
- 安装 URL Rewrite
- 安装 Application Request Routing（ARR）
- 开启 ARR Proxy

### 4.2 站点根目录
- IIS 站点物理路径指向：
  - `C:\srv\life_remake\apps\frontend\dist`

### 4.3 URL Rewrite 规则
- 规则 1：`/api/*` 反代到 Node
  - 匹配：`^api/(.*)`
  - 重写到：`http://127.0.0.1:4000/api/{R:1}`
  - 保留查询串：开启
- 规则 2：SPA 回退（可选）
  - 非文件、非目录时重写到 `/index.html`

## 5. 后端服务建议（Windows Service）
- 可用 NSSM / WinSW / PM2 Windows Service 任一方案
- 关键是“工作目录”：
  - `WorkingDirectory = C:\srv\life_remake`
- 启动命令示例：
  - `npm run start -w @reroll/backend`

## 6. 服务器初始化与首次部署
在 `C:\srv\life_remake` 执行：

```powershell
git clone <repo> .
npm install
npm run build
```

创建根目录 `.env`（`C:\srv\life_remake\.env`）：

```env
PORT=4000
DEPLOY_MODE=cloud

CLOUD_MODEL_API_KEY=your_key
GUEST_SESSION_SECRET=replace_with_long_random_secret
GUEST_TOKEN_TTL_MINUTES=120

DEFAULT_PROVIDER_BASE_URL=https://api.openai.com/v1
DEFAULT_PROVIDER_MODEL=gpt-4.1-mini
DEFAULT_PROVIDER_API_PATH=/chat/completions
DEFAULT_PROVIDER_TEMPERATURE=0.9
DEFAULT_PROVIDER_MAX_TOKENS=700
DEFAULT_PROVIDER_TIMEOUT_MS=45000

DEBUG_MODEL_CALLS=0
```

启动后端服务后，检查：
- `http://127.0.0.1:4000/health`
- 浏览器访问站点，网络请求应为 `/api/meta/bootstrap`（不是 `http://localhost:4000/...`）

## 7. 日常发布流程（固定）
每次发布只需在根目录执行：

```powershell
git pull
npm install
npm run build
```

然后重启后端服务（按你的服务名）：

```powershell
Restart-Service <YourBackendServiceName>
```

## 8. 故障排查

### 8.1 前端仍请求 localhost:4000
- 确认已重新 `npm run build`
- 确认生产包来自 `apps/frontend/dist`
- 确认 `apps/frontend/.env.production` 的 `VITE_API_BASE_URL=` 为空

### 8.2 后端报找不到 data/skills
- 确认服务工作目录是 `C:\srv\life_remake`
- 确认根目录存在 `data` 与 `skills`

### 8.3 后端未加载到 .env
- 确认根目录存在 `C:\srv\life_remake\.env`
- 确认服务工作目录正确

### 8.4 IIS 访问正常但 /api 502
- 确认后端进程在 `127.0.0.1:4000` 监听
- 检查 URL Rewrite 与 ARR Proxy 是否开启
