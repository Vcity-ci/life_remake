# 开发日志

Tip：
1，选项提示词影响力
2，抉择触发逻辑
3，文本截断
4，响应速度很慢
5，天赋卡加点
6，世界观完善
7，云端部署
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

## 2026-08-15 01:22 +08:00

### 叙事运行时与 P4 结局链文档对齐
- 采用增量记录，不改写历史架构、技术或使用流程段落。
- 记录当前古代叙事世界包的真实边界：世界骨架、路线门槛、事实账本、活跃场景、可变背景段落与原子回合投影。
- 记录当前工具职责：模型只提出叙事意图或结局申请；引擎负责候选审批、事件结算、事实回收、结局蓝图锁定和最终 outcome。
- 记录 P4 状态机：主线完成不因年龄结束；进入 `mainlineCompleted` 后阻断普通候选和背景年份；结局工具失效时保持结局引导而非继续无关叙事。
- 同步位置：`ARCHITECTURE.md` 第 9 节、`TECHNICAL.md` 第 10 节、`USAGE_FLOW.md` 第 8 节、`CHANGELOG.md` 追加条目。

## 2026-08-21 01:29 +08:00

### 路线局部节拍与世界幕对齐
- 确认原有五步节拍仍是叙事骨架：`setup -> escalation -> pressure -> climax -> payoff`。本轮没有将其替换为按年龄的线性状态机。
- 将节拍记录从单一 `activeScene` 拆为世界包路线维度的 `routeProgress`。引擎只读取和记录模型本回合实际选中的路线，不推导或锁死模型的路线偏好。
- 保留事件自身的 `narrativeBeat` 编码以及“模型选路线、引擎选具体素材”的职责分工；没有补充通用兜底素材，也没有改动年龄或停表逻辑。
- 一条路线完成 payoff 后只清理该路线的局部进度，世界幕前进；其它路线保持可回收的既有进度。三幕 payoff 后再沿用现有结局审批。
- 补充并行路线回归断言：获胜路线重置、并行路线进度保留。后端测试 21/21 通过，后端构建通过。
