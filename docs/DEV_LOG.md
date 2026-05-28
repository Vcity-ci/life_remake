# 开发日志

## 2026-05-28

### 文档整理批次（v0.8.0）
- 完成项目文档体系重整：
  - 新增 [技术文档](./TECHNICAL.md)
  - 新增 [使用流程](./USAGE_FLOW.md)
  - 新增 [开发日志](./DEV_LOG.md)
  - 重写 [架构文档](./ARCHITECTURE.md) 为分层与时序视角
  - 更新 `README.md` 文档导航
- 整理原则：
  - 以当前代码实现为准，不写脱离实现的“计划文档”
  - 文档边界从“玩法说明”扩展到“接口、数据、配置、流程”
  - 文档间避免重复，改为互链索引

### 已核对的实现范围
- 运行链路与脚本：
  - `start-local.bat`
  - `start-cloud.bat`
  - `start.bat`
- 后端核心：
  - `apps/backend/src/index.ts`
  - `apps/backend/src/engine.ts`
  - `apps/backend/src/ai.ts`
  - `apps/backend/src/schema.ts`
  - `apps/backend/src/config.ts`
  - `apps/backend/src/content.ts`
  - `apps/backend/src/store.ts`
- 前端核心：
  - `apps/frontend/src/App.tsx`
  - `apps/frontend/src/components/AdminPanel.tsx`
  - `apps/frontend/src/components/ProviderConfigForm.tsx`
  - `apps/frontend/src/lib/api.ts`
  - `apps/frontend/src/lib/localConfig.ts`
- 共享契约：
  - `packages/shared/src/index.ts`

### 本次文档修正点
- 明确了 `Max Tokens` 在 UI 为只读，由后端限制范围控制。
- 明确了“本地 key 不写盘”的实际行为边界。
- 明确了 start/step 的编排流程与 milestone 分支逻辑。
- 明确了内容种子数据、运行态存储、设定增强源三类数据路径。

### 后续建议
- 后续每次改动状态机或 API 时，同步更新：
  - `docs/TECHNICAL.md`
  - `docs/ARCHITECTURE.md`
  - `docs/CHANGELOG.md`
