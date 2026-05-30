# 技术文档（v1.0.0）

## 1. 技术栈
- 前端：React 18 + Vite 5 + TypeScript
- 后端：Express + TypeScript（`tsx` 开发，`tsc` 构建）
- 共享类型：`@reroll/shared`
- AI SDK：`openai`
- 校验：`zod`
- 随机：`seedrandom`

## 2. 目录结构
```text
apps/
  backend/
  frontend/
packages/
  shared/
data/
skills/
storage/
docs/
```

## 3. 环境变量与路径

### 3.1 `.env` 读取位置
后端启动时固定从项目根目录加载：
- `dotenv.config({ path: path.join(process.cwd(), ".env") })`

### 3.2 资源读取根
后端内容读取固定使用项目根：
- `data/*`
- `skills/ai-gm/prompt-pack.json`
- 不依赖 `apps/backend/dist/data` 或 `apps/backend/dist/skills`

## 4. API 列表

### 4.1 元数据/健康
- `GET /api/meta/bootstrap`
- `GET /health`

### 4.2 会话环境
- `POST /api/game/env`

### 4.3 游戏流程
- `POST /api/game/start`
- `POST /api/game/step`
- `POST /api/game/start/stream`（NDJSON）
- `POST /api/game/step/stream`（NDJSON）

### 4.4 管理接口
- `GET /api/admin/config`
- `POST /api/admin/config`
- `GET /api/admin/content`
- `POST /api/admin/content`
- 云端模式下全部锁定为 403

## 5. 流式事件协议
- `started`
- `timeline`
- `meta`
- `milestone`
- `done`
- `error`

说明：
- 开局时先 `started` 再 `timeline`
- milestone 只在 AI 抉择文案 ready 后发出

## 6. 引擎规则实现摘要

### 6.1 开局
- 属性每项 `0~10`
- 总和必须等于 `talentPointTotal`
- 选卡数量在调参范围内
- 生成 `tuningSnapshot`

### 6.2 年份推进
- `autoAdvanceToCheckpoint`
- 每轮推进最多 `maxYearsPerChunk`
- 年份类型：普通/异动/平年（由概率决定）

### 6.3 抉择触发
- `age >= minEligibleAge`
- 阶段概率：`triggerRateByStage`
- 未触发达到 `guaranteeYears` 保底触发
- 背景种子来自 faction event pool

### 6.4 抉择结算
- `applyMilestoneDecisionAndAdvance`
- 先算 `statChanges`，后按阶段 cap 截断
- 幼年保持 `-2..2`（默认）

### 6.5 结局
- `dead` 或 `ascended`
- 结束后调用 AI 结算文案（失败回退引擎文案）

## 7. 前端行为实现摘要
- Setting 先确认环境，才能开局
- 时间线按 `timeline` 事件增量渲染
- 抉择历史采用“延迟挂载”：
  - 点击选项先缓存 pending
  - 收到对应 milestone 年份 `timeline` 后写入历史
  - 同步展示掷点胶囊

## 8. 配置校验
- `schema.ts` 对 `startRun/gameEnv/contentBundle/gameplayTuning` 做边界校验
- 交叉约束（如 min/max、阈值顺序）在 `superRefine` 校验

## 9. 构建命令
- 全量：`npm run build`
- 后端：`npm run build -w @reroll/backend`
- 前端：`npm run build -w @reroll/frontend`
