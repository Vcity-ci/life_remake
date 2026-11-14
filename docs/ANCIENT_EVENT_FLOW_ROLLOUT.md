# 古代 IF 事件组横向扩充

更新于 2026-11-14。本文记录古代世界事件组从边镇将帅向其他 IF 推广的范围、结构约定和验证方式。边镇与逐鹿当前采用协议 2；逐鹿最新重整与验收见对应作者表。后文首轮推广记录保留当时结果，包括**江湖宗师**试点及**庙堂权臣、商贾世家、方术教门、布衣逐鹿**首轮事件组推广。

## 范围

| IF | 运行版本 | 事件组 | 状态 |
| --- | --- | --- | --- |
| 边镇将帅 `ancient.frontier-commander` | 20 | 13 组 / 41 单元 | 已跑通 |
| 江湖宗师 `ancient.jianghu-master` | 20 | 12 组 / 37 单元 | 试点完成 |
| 庙堂权臣 `ancient.court-minister` | 20 | 14 组 / 43 单元 | 试点完成 |
| 商贾世家 `ancient.merchant-house` | 20 | 14 组 / 43 单元 | 试点完成 |
| 方术教门 `ancient.mystic-order` | 20 | 14 组 / 43 单元 | 试点完成 |
| 布衣逐鹿 `ancient.sovereign-rise` | 22 | 20 组 / 72 单元 | 协议 2；夺县、争西洲、京畿与天下、守成及非成功后续，见[当前作者表与分版本验收](SOVEREIGN_BRANCH_PILOT.md) |

## 结构约定

下列为其他路线 v20 的约定；布衣 v21 的直接选择、分支提前结束和显式接续按新试点执行。一条 IF 要进入 v20，需要同时满足：

1. story pack 增加 `eventFlowId`，值等于 pack `id`；
2. 新增 `data/narratives/event-flows/<packId>.json`；
3. event-flow 的 `id` 等于 `eventFlowId` 和 pack `id`；
4. 三幕各自至少一个组，第一组必须属于第一幕（`eventFlowRoles` 用第一组判断 originRoles 的归属）；
5. `routing=planned` 的组，每个单元必须有 `entry`；
6. 每组只有**最后一个单元**承担 `endsFlow`；前面的 choice/settlement 不提前结束组，否则后续后果单元不会执行；
7. `originRoles`、`assetRoles`、`items.roleId` 只能引用已定义 roles；
8. 结果里的 `grantItems` / `consumeItems` 只能引用已定义 items。

幕初只组织世界卡与名称绑定；首组和后续组由幕内路由选择。世界卡不保存开场组或可用组名单。

## 江湖宗师试点

三幕与 12 个组：

| 幕 | 组 | 单元 |
| --- | --- | --- |
| 问艺 | `jianghu-first-errand` | `errand-basics` / `errand-escort` / `errand-choice` |
| 问艺 | `escort-intercepted` | `escort-ambush` / `escort-rescue` / `escort-aftermath` |
| 问艺 | `apprentice-test` | `sect-test` / `sect-verdict` |
| 扬名 | `rival-sect-feud` | `rival-provocation` / `duel-choice` / `feud-aftermath` |
| 扬名 | `escort-ambush` | `road-ambush` / `convoy-choice` / `convoy-return` |
| 扬名 | `official-arrest` | `yamen-visit` / `arrest-choice` / `yamen-verdict` / `arrest-aftermath` |
| 扬名 | `sect-rebuild` | `rebuild-grief` / `rebuild-training` / `rebuild-stand` |
| 扬名 | `tournament` | `martial-meet` / `final-bout` / `tournament-result` / `tournament-aftermath` |
| 立宗 | `sect-siege` | `siege-pressure` / `siege-arrives` / `defense-choice` / `siege-result` / `siege-aftermath` |
| 立宗 | `last-sect-line` | `last-stand-choice` / `last-stand-reckoning` / `last-stand-aftermath` |
| 立宗 | `amnesty-offer` | `amnesty-choice` / `amnesty-aftermath` |
| 立宗 | `legacy-final` | `legacy-verdict` / `legacy-homecoming` |

角色与道具：

- `originRoles`：`home`、`father`、`mother`、`mentor`、`token`；
- 角色：父母、师父、师兄/师姐、同伴、同辈对手、商旅委托人、地方官、武林前辈、叛徒；
- 地点：家乡村镇、师门山门、官道/渡口、敌对门派；
- 本领：剑法、身法、内功、疗伤；
- 道具：师门信物、师门残谱、委托文书。

## 验证方式

- 结构：`validateNarrativeEventFlow` 校验身份、三幕覆盖、planned 单元入口、出口、角色/道具引用；
- 类型：`npx tsc -p apps/backend/tsconfig.json --noEmit`；
- 回归：后端测试中的 `event-flow.test.ts` 增加江湖宗师加载、三幕覆盖、首组与首个单元断言；
- 实测：使用限额密钥执行
  `NARRATIVE_CHECK_PACK=ancient.jianghu-master NARRATIVE_CHECK_STEPS=25 node scripts/live-narrative-check.mjs`，
  检查幕初请求不含事件组目录、首组由幕内路由选择、组内时序与抉择结果。

## 试点实测

第一局 20 步，完成第一幕 `jianghu-first-errand` / `escort-intercepted` / `apprentice-test` 三组，进入第二幕 `reputation`。检查发现：

- 幕初世界卡请求不含事件组目录，响应不含 `eventFlows`，只含 `flowBindings`；
- 首组由 `plan_next_event_flow` 选择（`jianghu-first-errand`），接组依次选择 `escort-intercepted`、`apprentice-test`；
- 第一幕在 16 岁收束，`sect-verdict` 为 `settlement:pass`，授予师门信物；
- 12 岁失败分支的正文把被掳的委托人与“已经凉了”写死，而下一组 `escort-intercepted` 仍按“救人”推进，造成连续性冲突。

修复：

- `errand-choice` 的三档失败结果明确写成“被掳走/仍扣在对方手里、生死未定”，不再允许正文写死；
- `escort-intercepted` 的入口改为“上一组结束时{{escort}}被掳走或下落不明”；
- `escort-aftermath` 兼容“救回养伤”和“未救回、交不出人”两种结果。

第二局 15 步，9 岁选择“救人追货”并成功救回被掳者，因此没有触发 `escort-intercepted`，直接进入 `apprentice-test`；首组、组内路由、幕初职责和抉择结果均正常。失败分支的修复仍需要后续实测覆盖。

第三轮按边境线生命周期补位：

- `official-arrest` 增加 `yamen-visit`（官府上门）与 `arrest-aftermath`（判决后果）；
- `tournament` 增加 `tournament-aftermath`（名望落回日常）；
- `sect-siege` 增加 `siege-pressure`（断粮/封路/内鬼）与 `siege-aftermath`（伤者、残部、百姓安置）；
- 新增 `sect-rebuild`（受挫后的重整，对应 `company-rebuild`）；
- 新增 `last-sect-line`（败势中的最终取舍，对应 `last-frontier-line`）；
- 修正所有组的出口：只有最后一个单元设 `endsFlow`，前面的 `choice`/`settlement` 不再提前结束组；
- 补 `father`/`mother` 到连续性候选；
- `sect-verdict` 的 retain 改为“准出门但受限”，避免第一幕无候选可接；
- `escort-letter` 先授予后消耗；`sect-token` 不再被招安无条件消耗。

30 步实测（2026-11-08）：24 岁，第一幕在 18 岁结束；`errand-choice` 成功，因此没有触发 `escort-intercepted`；第二幕 `rival-sect-feud`、`escort-ambush` 均完整执行到 `feud-aftermath`、`convoy-return`，`tournament` 进行到 `final-bout`；库存已有 `escort-letter` 与 `sect-token`，日志无 `event_flow_delivery_item_missing` 或 `event_flow_candidates_empty`。86 次请求，235,261 输入 / 16,267 输出。`official-arrest`、`sect-rebuild`、`sect-siege`、`last-sect-line` 尚未在本局实际走到，仍待定向实测。

## 其余四条 IF 试点

四条 IF 均按同一生命周期独立设计，各 14 组 / 43 单元，三幕 5 / 5 / 4；每条单独实测 25 步。

| IF | 主要行为组 | 失败后续 | 本幕结果 | 实测 |
| --- | --- | --- | --- | --- |
| 庙堂权臣 | 赈灾、科场、河工、派系、密议 | 被贬、党争清洗 | 第一任差遣、施政联盟 | 第一幕 17 岁结束；`career-setback` 被实际选中；`first-post` 结果组执行 |
| 商贾世家 | 牙人、封路、行会、渡口、官商 | 失信破产、行会制裁 | 立信商号、跨地商网 | 第一幕 14 岁结束；三条后果单元执行；契书/账册/商号印齐全 |
| 方术教门 | 疫村、假药、朝堂辩经、教团、封禁 | 妖言审问、镇压 | 受传法印、门徒信任 | 受法与疫村完整执行；`lineage-recognized` 进入 |
| 布衣逐鹿 | 据点、追随者、军阀联盟、攻城、背叛 | 部众离散、失地 | 第一块基业、一方之势 | 第一幕 18 岁结束；观察器在只完成渡口/据点两组时提前关幕，`base-established` 未执行、`command-tally` 未授予 |

实测目录：

- 庙堂权臣：`storage/verification-court-20261108-161126`；
- 商贾世家：`storage/verification-merchant-20261108-162335`；
- 方术教门：`storage/verification-mystic-20261108-163510`；
- 布衣逐鹿：`storage/verification-sovereign-20261108-164526`。

已知问题：

- 布衣逐鹿第一幕的 `closureMeaning` 在“渡口 + 据点”后已被观察器认为满足，结果组 `base-established` 没有执行。需要在后续调整第一幕目标描述或结果组入口；本轮不改通用观察器。
- 方术教门实测出现 `narrative_outcome_invalid` 的幕初重试，属于模型输出格式问题，流程继续。
- 布衣逐鹿连续性同步出现 `event_asset_not_registered: use introductions for legitimacy`，是模型直接更新未登记资产；正文照常，资产维护被拒。

## 后续推广

建议顺序：庙堂权臣 → 商贾世家 → 方术教门 → 布衣逐鹿。每条先做 9–12 组 / 25–35 单元，跑通一幕后再补完整三幕。

可复用的世界卡：

- 权臣：`ancient.domain.court.*`、`ancient.snapshot.central_figures`、`ancient.snapshot.jingyuan_reform`；
- 商贾：`ancient.domain.commerce.*`、`ancient.snapshot.coastal_trade`；
- 教门：`ancient.domain.faith.*`、`ancient.snapshot.popular_faith`；
- 逐鹿：`ancient.domain.sovereignty.*`、`ancient.snapshot.frontier_pressure`。

## 已知边界

- `eventFlowRoles` 把 `originRoles` 加到第一组所属幕；新文件必须按幕顺序排列，第一组属于第一幕。
- 组出口必须放在最后一个单元；前面的 `choice`/`settlement` 不设 `endsFlow`，否则后续后果单元不会执行。
- `sect-rebuild` 与 `last-sect-line` 是失败后续，不是可替换行为组；由 `entry` 让规划器只在对应结果后选择。
- `eventFlowId` 与 event-flow 文件必须同时提交；文件缺失时该 pack 会在加载阶段被跳过。
- 世界卡是整幕固定的开幕局势，不因当前年龄改写；素材的 `situation` 避免写“刚刚出生”这类时间敏感句。
- 正文出现的角色名必须来自 `flowBindings`，不要让 role id 裸露在世界卡或正文里。
- 其他 IF 的 v18 存档保持只读，不自动迁移。

## 参考素材

- [《庆余年》：故事·人物·结构](https://www.chinawriter.com.cn/n1/2020/0401/c404027-31657297.html#1)：权谋线的入局、执衡、临极升级结构。
- [Hearts of Wulin](https://au.nobleknight.com/P/2147975165/Hearts-of-Wulin?SS=AUD)：武侠跑团的关系、门派、比武与恩怨结构。
- [TavernWeave 世界书优化](https://github.com/liarmttt/tavernweave/blob/d134ddd69f941e2320160101315d760a631bfa65/skills/consult-tavernweave-library/references/st-guides/A3_%E4%B8%96%E7%95%8C%E4%B9%A6%E4%BC%98%E5%8C%96.md#1)：ST 世界书的角色、势力、地点条目化写法。
- [Dicecho 跑团模组作者页](https://www.dicecho.com/account/66dee101feb468f5be57ab5a)：中文跑团模组的事件、线索与分支组织。
