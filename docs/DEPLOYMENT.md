# 部署手册（Windows Server + IIS，体验站）

## 1. 目标
- 服务器更新流程固定为：
  - `git pull`
  - `npm install`
  - `npm run build`
  - 重启后端服务
- 前端同域访问 `/api/*`
- IIS 反代到 `127.0.0.1:4000`

## 2. 目录约定
示例项目根目录：`C:\srv\life_remake`

关键路径：
- `C:\srv\life_remake\.env`
- `C:\srv\life_remake\data\...`
- `C:\srv\life_remake\skills\ai-gm\prompt-pack.json`
- `C:\srv\life_remake\apps\frontend\dist\...`

## 3. 当前代码对齐点

### 3.1 前端 API 基址
- `apps/frontend/src/lib/api.ts`：
  - `const API_BASE = import.meta.env.VITE_API_BASE_URL || "";`
- `apps/frontend/.env.development`：
  - `VITE_API_BASE_URL=http://localhost:4000`
- `apps/frontend/.env.production`：
  - `VITE_API_BASE_URL=`

结果：
- 开发：请求 `http://localhost:4000/api/*`
- 生产：请求 `/api/*`

### 3.2 后端资源读取
- 后端固定从项目根读取：
  - `data/*`
  - `skills/ai-gm/prompt-pack.json`

### 3.3 后端环境变量读取
- 后端固定读取根目录 `.env`
- 运行时工作目录必须是项目根

## 4. IIS 配置

### 4.1 必装组件
- IIS
- URL Rewrite
- ARR（Application Request Routing）

### 4.2 站点目录
- 指向：`C:\srv\life_remake\apps\frontend\dist`

### 4.3 Rewrite 规则
1. `/api/*` -> `http://127.0.0.1:4000/api/{R:1}`
2. SPA 回退：非文件/非目录 -> `/index.html`

## 5. 后端服务化
可用 NSSM / WinSW / PM2 Windows Service。

关键要求：
- WorkingDirectory: `C:\srv\life_remake`
- Start: `npm run start -w @reroll/backend`

## 6. 首次部署步骤
在项目根执行：

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
DEFAULT_PROVIDER_BASE_URL=https://api.openai.com/v1
DEFAULT_PROVIDER_MODEL=gpt-4.1-mini
DEFAULT_PROVIDER_API_PATH=/chat/completions
DEFAULT_PROVIDER_TEMPERATURE=0.9
DEFAULT_PROVIDER_MAX_TOKENS=700
DEFAULT_PROVIDER_TIMEOUT_MS=45000
DEBUG_MODEL_CALLS=0
```

健康检查：
- `http://127.0.0.1:4000/health` 返回 `{ "ok": true }`

## 7. 日常发布
在项目根执行：

```powershell
git pull
npm install
npm run build
```

然后重启服务：

```powershell
Restart-Service <YourBackendServiceName>
```

## 8. 常见问题

### 8.1 前端仍请求 localhost:4000
- 确认生产构建已更新
- 确认 `.env.production` 的 `VITE_API_BASE_URL` 为空

### 8.2 后端找不到 data/skills
- 检查服务工作目录是否为项目根

### 8.3 后端读不到 .env
- 检查 `C:\srv\life_remake\.env` 是否存在
- 检查服务启动工作目录

### 8.4 IIS /api 502
- 检查后端是否监听 `127.0.0.1:4000`
- 检查 ARR Proxy 与 Rewrite 规则
