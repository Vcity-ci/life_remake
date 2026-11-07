# 古代静态内容审计与整理

日期：2026-11-05。

用户确认：先整理已有内容，暂不新增剧情。军屯新制度、北方诸部利益分化、具体新地理及欠饷事件组均未加入运行资料。本轮沿用已有世界、人物、地理、IF 和事件骨架。

## 查实的问题

1. worldCore 的四条抽象判断仍在幕初材料中，三条从 2026-09-22 至本轮前原样保留。它们反复强调权力成立、资源与执行条件，没有提供大衍特有的世界事实。
2. ancient.rule.power_is_access 作为 foundation 不经关键词筛选进入材料，又重复上述框架。县署卡提供写状、认保、递送、查验、催办的完整手续顺序，具体程度超过多数冒险知识。
3. 多张卡在正常结果之后固定附加责任、疑问、资格或治理工作。例如“完成委托也未必等于……”“军事胜利会立刻带来……”“定鼎之后仍需……”。这些是作者安排，不是某个具体局面的已知事实。
4. 军需卡已经有“哗变”，证明问题不只是缺少这个词。它没有具体闹饷者、行动与出口；在未批准新增剧情时，不能把增加几个危机词当成已补足冒险。
5. 世界包制作示例仍有全局后果公式和 style_example；小说制作指南仍指导生成旧阵营事件池、文风、五拍与账册线索。只改运行正文会保留未来重新引入的来源。

历史比对：0f1022d（2026-09-22）、5e2c28a（2026-09-22）、ceca0f1（2026-10-14）、00f7613（2026-10-26）中的相关世界规律、县署及军事卡。

## 真实消费链路

共同设定、时代切片、匹配的静态卡、IF 方向与事件组目录 → 幕初组织本局主持资料 → 当前节点或已选结果、固定主持资料与实际历史 → 正文。

- narrative.ts 的 buildNarrativePromptPlan 决定静态材料何时进入；context/collectors.ts 和 formatter.ts 决定最终栏目。
- 边镇事件组模式不供应 IF 的 adventureSeeds。只增加该字段不会改善当前事件执行。
- event-flow.ts 的 eventFlowCatalog 提供组和节点局势；正文仅消费当前节点或已选结果，不接收整套未来分支。
- 展示维护不回流正文或幕初选材。本轮发现的意象重复不能再归因于已经隔离的展示资产。
- 最近完整验证局的 model-0038 首次出现“数着人回来”；model-0042 压缩保留，model-0093 将其写为长辈“始终”的训诫，并增加“要账的人”“账目分明”“人心账”。这是实际输出经历史与下一幕卡强化的证据，不是固定 system 里存在同一句命令。

证据位于 storage/verification-1793809603414。本轮未改写这些记录，也未重新跑局。

## 本轮处理

| 位置 | 处理 |
| --- | --- |
| ancient.story.json / worldCore | 删除四条通用权力判断，不填空数组或替代公式；将唯一的“景朝”按既有总览统一为“大衍” |
| worldCore 的其余内容 | 使用已有时代、地域、制度和生活事实，去掉“身份决定入口”等作者解释 |
| storyBible | 保留开局局势，移除人生路线清单和抽象叙事结语；具名行动方详情仍在相应卡中 |
| 配置类型、校验、材料组装 | laws 可省略；配置时仍校验字符串内容；未配置时不输出“世界规律”栏目 |
| 世界栏目 | 从“世界常量（故事成立的规律……）”改为中性的“世界设定” |
| 制作模板与指南 | 删除空泛必填规律、文风样例、旧五拍和旧阵营事件制作步骤；当前指南不再并列多套历史方法 |

laws 的可选性只协调静态内容接口，不修改运行版本、属性、检定、时间交接、事件游标、观察或结局。现有测试中一处读取 laws[0] 的断言改用仍然存在的世界 identity，保持其检查材料供应职责；本轮未执行测试。

## 43 张卡逐项处置

“收紧”指删除作者指挥、重复解释或强制的后续清单，保留原有知识；不表示补出了新剧情。共删除 1 张、收紧 22 张、保留 20 张。整理后 42 张。

### foundation.json

| ID | 处置 | 原因 |
| --- | --- | --- |
| ancient.rule.power_is_access | 删除 | 无独立世界事实，且作为常驻卡重复权力公式；县署到它的关联一并删除 |
| ancient.culture.household_and_clan | 收紧 | 保留婚丧、照料、田产等关系，删除每个成员都应承担家门代价的安排 |
| ancient.institution.local_yamen | 收紧 | 保留成员和职司，删除逐项办事流程；标题改为“县署与地方事务” |
| ancient.geography.roads_and_waterways | 收紧 | 保留道路、季节、关津和沿途知识，删除公文与真实动静的评价式对举 |
| ancient.culture.market_and_craft | 收紧 | 保留职业、手艺、主顾与同业，去掉重复的信用解释及必然卷入权势的安排 |
| ancient.institution.academy_and_examination | 收紧 | 保留学习、师生和科场，删除取得功名后仍须证明能力的通用附加要求 |

### snapshot.json

| ID | 处置 | 原因 |
| --- | --- | --- |
| ancient.snapshot.jingyuan_reform | 收紧 | 保留清丈政策与利益冲突，删除田册可用作投名状等写作选材提示 |
| ancient.snapshot.central_figures | 收紧 | 保留四位人物的既有身份和目的，删除主角应如何触及权力网络的说明 |
| ancient.snapshot.nine_regions | 收紧 | 保留五处已写明的区域特征，删除“各地都不同”的空泛结语；未补造其余地域 |
| ancient.snapshot.frontier_pressure | 收紧 | 保留汗国行动与欠饷状况，先陈述外敌军势；删除边将必须如何回应及战后必受审视的安排 |
| ancient.snapshot.coastal_trade | 收紧 | 保留海商、贸易与禁海利益，删除财富必然转为罪证的表现指引 |
| ancient.snapshot.local_society | 收紧 | 保留宗族与地方制度，删除权力必须经过哪些人的重复解释 |
| ancient.snapshot.popular_faith | 保留 | 已有具体教门与灾年关系，不新增宗教事件或设定 |

### domains/military.json

| ID | 处置 | 原因 |
| --- | --- | --- |
| ancient.domain.military.reconnaissance | 保留 | 有侦察来源与判断条件，不为换词而重写 |
| ancient.domain.military.training_command | 保留 | 操练、军纪与协同是有效方法知识；未新增成长节点 |
| ancient.domain.military.logistics_morale | 保留 | 军需及失序后果属于有效知识；保留欠饷、逃亡与哗变，不做词语禁用 |
| ancient.domain.military.raid_siege | 收紧 | 保留打法和条件，删除与战后卡重复的固定后续事项 |
| ancient.domain.military.prisoners_retreat | 收紧 | 保留撤退与战后处置知识，删除“胜败之后仍要”的执行清单口吻 |

### domains/court.json

| ID | 处置 | 原因 |
| --- | --- | --- |
| ancient.domain.court.audience_appointment | 收紧 | 保留任用与升迁途径，删除一次任命必然开启立场考验的安排 |
| ancient.domain.court.faction_coalition | 保留 | 政见、门生与联盟是该题材的关联知识 |
| ancient.domain.court.palace_plot | 保留 | 宫门、宿卫与内廷消息有明确作用范围 |
| ancient.domain.court.ruler_bargain | 保留 | 君臣授权与制衡是对应局部知识，不扩大为全局规律 |
| ancient.domain.court.coup_transfer | 保留 | 对应政变与交权，不新增政变情节 |

### domains/commerce.json

| ID | 处置 | 原因 |
| --- | --- | --- |
| ancient.domain.commerce.capital_credit | 保留 | 借贷与经营条件是商业知识 |
| ancient.domain.commerce.transport_warehouse | 保留 | 运输条件及风险属于局部知识 |
| ancient.domain.commerce.guild_competition | 保留 | 行会与竞争方法不构成全局剧情安排 |
| ancient.domain.commerce.state_gray_trade | 保留 | 商业与制度的既有利益关系 |
| ancient.domain.commerce.succession_public | 收紧 | 删除事业扩大必需背叛等后续事件与结局评语，保留合伙和财产使用 |

### domains/jianghu.json

| ID | 处置 | 原因 |
| --- | --- | --- |
| ancient.domain.jianghu.mastery_rules | 收紧 | 保留师承、练习和门规，删除“真正掌握意味着”带来的额外资格定义 |
| ancient.domain.jianghu.challenge_duel | 保留 | 比武声名与守约是题材内后果，不据此新增比武 |
| ancient.domain.jianghu.escort_rescue | 收紧 | 保留路程、时限与安全，删除完成委托仍不足的通用翻案 |
| ancient.domain.jianghu.revenge_treasure | 收紧 | 保留利益、线索与归属，删除人物必须重新判断复仇责任的任务 |
| ancient.domain.jianghu.sect_legacy | 保留 | 门派组织与传承知识，不改该路线 |

### domains/faith.json

| ID | 处置 | 原因 |
| --- | --- | --- |
| ancient.domain.faith.disaster_healing | 保留 | 医药、灾病与救治是已有知识 |
| ancient.domain.faith.rite_miracle | 保留 | 保留原有神异解释的开放性，不新增神迹规则 |
| ancient.domain.faith.court_debate | 保留 | 教门与礼制辩论属于局部制度知识 |
| ancient.domain.faith.seal_taboo | 收紧 | 保留处置方法与影响因素，删除任何封禁必须取得见证及付出代价的通用前置要求 |
| ancient.domain.faith.popular_movement | 保留 | 已有互助、抗税与起事方向，不扩写或接入新事件组 |

### domains/sovereignty.json

| ID | 处置 | 原因 |
| --- | --- | --- |
| ancient.domain.sovereignty.mobilization | 保留 | 动员与追随动机仍属该题材知识 |
| ancient.domain.sovereignty.stronghold_campaign | 收紧 | 保留据点和治理知识，删除一次军事胜利立刻带来整组新问题的安排 |
| ancient.domain.sovereignty.absorb_forces | 保留 | 收编与联盟的既有关系知识 |
| ancient.domain.sovereignty.legitimacy_enthronement | 收紧 | 保留登基与分封相关方，撤掉必须逐一取得承认的通用表达 |
| ancient.domain.sovereignty.postwar_order | 收紧 | 保留治理事项，删除定鼎后必须继续全部工作及胜利者道德评价 |

## 制作入口的实质清理

- examples/world-pack/story.example.json 不再预填三条抽象 laws。
- world-cards.example.json 删除通用“选择会进入生活”卡和 style_example，仅保留局部设定的结构占位。
- story-pack.example.json 同步删除废弃卡引用和五拍字段，按现有加载协议提供 adventureSeeds、entryRequirements 格式占位；未新增运行剧情。
- WORLD_PACK_GUIDE.txt 明确 laws 可省略、世界事实与本局事件分工，不再要求制作表达样例。
- STORY_PACK_GUIDE.txt 删除五拍状态机与旧字段指导，解释事件组与 adventureSeeds 的实际消费差别。
- NARRATIVE_WORLD_CARD_DESIGN.md 与 NOVEL_DISTILLATION_GUIDE.md 改为单份当前指南，旧方法不再以多份“当前更新”留在正文中。

其他世界的内容未因本轮边境清理被重写。关键词、匹配算法、卡片优先级和冷却未调整。

## 检查及尚未证明的效果

已完成共享、后端、前端的 tsc --noEmit。古代、奇幻、现代静态 JSON 及示例可解析，卡片 ID 无重复，关联卡与六条 IF 的 worldCardRefs 未发现悬空；古代 42 张卡、奇幻 40 张、现代 37 张。

本轮不跑测试，不调用模型，不新增验证对局。类型与引用正确只能证明接口协调，不能证明实际故事已经不重复。

仍保留两个单独问题：

1. 既有素材的丰富度没有因删减而自动增加。新增设定与可选事件组已被本轮暂缓，后续须再确认具体内容。
2. 边境出击的组前条件为体魄 30、智力 26。最近完整局 22—33 岁仍在准备，受到增益、家庭影响、生活段跨度及检查时机共同影响；本轮没有调整这些数值或开放条件。

已生成世界卡、摘要和正文不会被本次静态整理自动重写。材料在后端重新加载后生效；旧局不能作为已经采用整套新静态材料的干净对照。

## 内容组织参考

参考 [Dungeon World Fronts](https://raw.githubusercontent.com/Sagelt/Dungeon-World/master/text/Fronts.xml) 的动机、行动及后果，[The Alexandrian](https://thealexandrian.net/wordpress/4147/roleplaying-games/dont-prep-plots) 的局势准备，以及 [《三国演义》第四十一回](https://zh.wikisource.org/wiki/三國演義/第041回) 中失利后继续改变局面的方式。仅作为审读依据，未将其人物或桥段加入本项目，也未替换现有事件组机制。
