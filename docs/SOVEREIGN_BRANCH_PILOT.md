# 布衣逐鹿：作者分支表与验证记录

更新于 2026-11-14。当前逐鹿、边境均按事件协议 2 使用运行版本 22。本轮重整逐鹿素材，不升级运行协议、不改写旧局快照。后文 v21、v22 旧实测仅说明当时素材，不能作为本轮验收。

## 本轮创作基线：夺县、争西洲、入京逐鹿

已经确认：夺取天下为主轴；第二幕先夺县再争西洲；第三幕入京后还要解决主要割据对手。主动留守是有完整生活与交接的普通结局道路。京畿不再另设勤王、议和分权道路。本文只供开发，不被加载进模型。

| 位置／单元 | 一件事及入口依据 | 实际结果与接续 | 生活承接 |
| --- | --- | --- | --- |
| `family-ruin` | 承接原身世，童年、家变、流亡分别成事 | 家庭条件与损失进入投军；不固定奖励税册残页 | 原家庭生计、同龄人与亲人，6—8 年 |
| `join-rebels` | 选择守纪义军、富足而控制严的义军或溃兵 | 保存协作、从属或漂泊关系，进入自立 | 所选队伍中的服役、旧人变化，1—3 年 |
| `self-rise` | 守纪路线分担地方战事；受控路线脱离控制；溃兵路线在瓦解中组织自保 | 检定只裁定带出独立队伍；成功接立足，失败接失散 | 不把三种首领统一写成背叛者 |
| `scattered-band` | 自立失散后选择重新聚拢或接受吞并 | 聚拢成功取得真实剩余力量再立足；失败或独立事业终结交观察 | 伤亡、依附与债务留下 |
| `base-established` | 用现有人手取得、安顿并守住第一据点 | 第一幕完成；兵符记录已存在的指挥权 | 找落脚处、家属安顿，1—3 年 |
| `army-building` | 据点成长为能外出作战的部伍 | 有合作需求接结盟，否则直接夺县 | 训练、家庭、骨干承担职责，2—4 年 |
| `ally-rebels` | 只处理夺县之前的合作条件 | 互助、联合指挥或拒绝均接夺县，不奖励未取得的辖地 | 盟约落实在同一行动中，不另开扩张菜单 |
| `attack-county` | 争夺同一座实际县城 | 成功接县城生活，再按局势接朝廷介入、粮道或西洲争夺；失败接重整 | 县城与旧据点、降军和居民，2—4 年 |
| `court-offer` | 已取得县城后，朝廷以共同对手提出任职与差遣 | 接受、拒绝或交涉承接粮道／西洲；交涉失利接损失处理 | 官职只改变已交付权限，不凭空增加土地 |
| `cut-grain-road` | 截断西洲军阀向争夺地区输送兵械的军用通路 | 三档办法目标相同，胜败均改变随后的西洲战事 | 不混入保护另一支民粮队的不同目标 |
| `fight-warlord` | 军阀封锁县城并控制相连要地，处理这场区域争夺 | 成功取得实际连片辖地接区域安排；失败接损失与重整 | 对手、盟友与援助沿用此前结果 |
| `lost-territory` | 上一行动受挫，安顿真实幸存者并守住尚存之地 | 守住只保留剩余力量，接去向；覆亡可提前结束 | 重整不恢复丢失城池 |
| `reduced-future` | 实际受挫后决定保有地方的去向，不假定只能剩小寨 | 留守接地方人生；最后行动另处理解救邻地并接区域安排；投降失去独立事业交观察 | 保有多少就经营多少，10—15 年的地方生活与交接 |
| `regional-lord` | 已有持续区域与实际部伍，决定自主、任职或共治 | 按所选立场落实真实权责，结束第二幕；不再接回扩张 | 一方生活、旧部任职及关系变化，2—4 年 |
| `future-road` | 区域安排已实际成立 | 入京或留守，直接选择不掷点 | 选择当次写完，不立即总结人生 |
| `capital-arrival` | 已选入京，用实际力量取得外围驻地 | 建立进攻京城条件，接京畿行动；不白送决定性胜利 | 战时驻防、原有盟军与损失，1—3 年 |
| `decisive-capital` 前半 | 行动取得京城，处理实际军政交付 | 京城只是新的立足点；各主要对手仍存在，继续天下争夺 | 驻军轮换、控制范围与后方生活，1—3 年 |
| 同组天下行动 | 面对京外主要对手的联合进逼，处理决定性的战役 | 胜利接降附与辖地处置；失利接转入守势后的不同战事；再失利接最后撤守 | 各方按实际力量行动，不从宫城直接跳全国太平 |
| 同组战后与新朝 | 主要对手解决后安置实际参战各方，建立可运行的统治 | 新朝初政、长期治理、实际继位、退位生活、晚年，最终交观察 | 沿用 4—7、5—8、4—7、5—8、3—6 年范围 |
| `last-stand` | 入京／天下战事失败后的撤守或突围 | 保住地方接地方交接；实际核心力量覆亡可坏结局 | 撤守恢复 3—6 年，失去的人与权力不回来 |
| `western-settlement` → `western-succession` | 主动留守，或保有地方的撤守 | 守土、恢复、地方生活、实际交接与晚年，普通结局；真实覆亡另判 | 3—5、2—4、5—8、5—8、3—6 年，身份依实际历史 |

### 逐单元核对表

以下仅供开发审读；接续逐项对应运行素材，不加载进项目模型。表中“观察”表示该来源没有写定后续，仍须由观察器依据实际结果裁定；不是自动通关。

**第一幕**

| 单元 | 处理的一件事 | 结果对应的允许接续 | 前置生活 |
| --- | --- | --- | --- |
| `ruin-home` | 家庭与同龄人成长 | 经历→ruin-tax | 6—8 年 |
| `ruin-tax` | 家变与财产失去 | 经历→ruin-flight | — |
| `ruin-flight` | 携实际亲人流亡 | 经历→组:join-rebels | — |
| `join-arrives` | 抵达义军招募处 | 经历→join-choice | — |
| `join-choice` | 决定依附对象 | disciplined、provisioned、stragglers→join-life | — |
| `join-life` | 所选队伍中的服役与关系 | 经历→组:self-rise | 1—3 年 |
| `rise-dispute` | 依实际依附产生独立出路 | 经历→rise-choice | — |
| `rise-choice` | 组织并转驻自己的队伍 | safe成、balanced成、risky成→rise-band；safe败、balanced败、risky败→组:scattered-band | — |
| `rise-band` | 安顿实际带出的部众 | 经历→组:base-established | — |
| `base-organize` | 寻找可用据点并准备守卫 | 经历→base-first-stand | 1—3 年 |
| `base-first-stand` | 取得并安顿第一据点 | 经历→base-recognition | — |
| `base-recognition` | 拒绝征逼、实际守住独立据点 | 经历→观察 | — |
| `scattered-choice` | 散失后决定重聚或受编 | regroup→scattered-gather；submit→观察 | — |
| `scattered-gather` | 重新聚拢独立力量 | safe成、balanced成、risky成→scattered-recovery；safe败、balanced败、risky败→观察 | — |
| `scattered-recovery` | 安顿重聚后的真实家底 | 经历→组:base-established | — |

**第二幕**

| 单元 | 处理的一件事 | 结果对应的允许接续 | 前置生活 |
| --- | --- | --- | --- |
| `army-service` | 据点内的成军与骨干成长 | 经历→army-first-command | 2—4 年 |
| `army-first-command` | 首次协作行动 | 经历→army-coordination | — |
| `army-coordination` | 把协作经验落实到部伍 | 经历→组:attack-county／组:ally-rebels | — |
| `county-arrives` | 县城威胁与进攻准备 | 经历→county-choice | — |
| `county-choice` | 夺取这座县城 | safe成、balanced成、risky成→county-return；safe败、balanced败、risky败→组:lost-territory | — |
| `county-return` | 经营实际取得的县城 | 经历→组:fight-warlord／组:court-offer／组:cut-grain-road | 2—4 年 |
| `ally-choice` | 决定本次夺县合作方式 | mutual、combined→ally-return；independent→组:attack-county | — |
| `ally-return` | 落实本次合作 | 经历→组:attack-county | — |
| `offer-arrives` | 既有县城引来朝廷介入 | 经历→offer-choice | — |
| `offer-choice` | 接受、拒绝或交涉任职 | accept→offer-return；negotiate→offer-negotiation；refuse→组:fight-warlord／组:cut-grain-road | — |
| `offer-negotiation` | 争取实际任职条件 | safe成、balanced成、risky成→offer-return；safe败、balanced败、risky败→组:lost-territory | — |
| `offer-return` | 承接任职及地方责任 | 经历→组:fight-warlord／组:cut-grain-road | — |
| `road-choice` | 截断同一条敌军军运 | safe成、balanced成、risky成→road-return；safe败、balanced败、risky败→组:fight-warlord | — |
| `road-return` | 将所得用于西洲争夺 | 经历→组:fight-warlord | — |
| `warlord-arrives` | 区域军阀进逼 | 经历→warlord-choice | — |
| `warlord-choice` | 争夺相连要地与辖地 | safe成、balanced成、risky成→warlord-return；safe败、balanced败、risky败→组:lost-territory | — |
| `warlord-return` | 安顿实际区域战果 | 经历→组:regional-lord | — |
| `regional-arrives` | 汇集既有地盘与关系 | 经历→regional-choice | — |
| `regional-choice` | 决定自主、受编或共治 | self-rule、nominal-rule、shared-rule→regional-verdict | — |
| `regional-verdict` | 按实际立场落实军政权责 | self-rule、nominal-rule、shared-rule→regional-aftermath | — |
| `regional-aftermath` | 区域秩序持续运行 | 经历→观察 | 2—4 年 |
| `lost-grief` | 承接已发生耗损与返回生活 | 经历→lost-rebuild | — |
| `lost-rebuild` | 重建协作，面对新的进逼 | 经历→lost-defense | — |
| `lost-defense` | 守住实有地方与独立力量 | safe成、balanced成、risky成→lost-return；safe败、balanced败、risky败→观察 | — |
| `lost-return` | 安顿本次守卫后的力量 | 经历→组:reduced-future | — |
| `reduced-choice` | 以真实剩余力量决定去向 | local→reduced-local-life；last-campaign→reduced-breakout；submit→观察 | — |
| `reduced-breakout` | 援救邻地并取得守卫责任 | safe成、balanced成、risky成→reduced-order；safe败、balanced败、risky败→观察 | — |
| `reduced-order` | 按已有协作接管新地方 | independent、appointed、shared、existing-command→reduced-aftermath | — |
| `reduced-aftermath` | 新旧地方形成持续区域 | 经历→组:regional-lord | 2—4 年 |
| `reduced-local-life` | 经营剩余地方、交接与退居 | 经历→观察 | 10—15 年 |

**第三幕**

| 单元 | 处理的一件事 | 结果对应的允许接续 | 前置生活 |
| --- | --- | --- | --- |
| `capital-falls` | 抵达京畿外围 | 经历→capital-joint | — |
| `capital-joint` | 依实际协作取得驻地 | 经历→capital-rotation | — |
| `capital-rotation` | 战时驻守与部众轮换 | 经历→组:decisive-capital | 1—3 年 |
| `capital-founding-action` | 夺取京畿与宫城 | safe成、balanced成、risky成→capital-reckoning；safe败、balanced败、risky败→组:last-stand | — |
| `capital-reckoning` | 交接京城军政 | capital-held→realm-front | — |
| `realm-front` | 京外主要对手形成战线 | 经历→realm-campaign | 1—3 年 |
| `realm-campaign` | 与主要对手进行外线战役 | safe成、balanced成、risky成→realm-reckoning；safe败、balanced败、risky败→realm-reverse | — |
| `realm-reverse` | 战败后落实损失与守势 | 经历→realm-counterstroke | — |
| `realm-counterstroke` | 击败围攻中枢的联军 | safe成、balanced成、risky成→realm-reckoning；safe败、balanced败、risky败→组:last-stand | — |
| `realm-reckoning` | 主要对手辖地与军政交付 | campaign-won、core-defended→realm-foundation | — |
| `realm-foundation` | 建朝、即位与任命 | throne-established→new-court | — |
| `new-court` | 新朝初政与亲友身份变化 | 经历→new-reign-years | 4—7 年 |
| `new-reign-years` | 长期治理与开国同伴变化 | 经历→new-crown-transfer | 5—8 年 |
| `new-crown-transfer` | 正式交付最高权力 | crown-transferred→retired-sovereign | 4—7 年 |
| `retired-sovereign` | 退位后生活 | 经历→dynasty-legacy | 5—8 年 |
| `dynasty-legacy` | 晚年与留下的秩序 | 经历→观察 | 3—6 年 |
| `last-choice` | 败势中的保全行动 | safe成、safe败、balanced成、balanced败、risky成、risky败→last-reckoning | — |
| `last-reckoning` | 区分保全与实际覆亡 | line-preserved→last-aftermath；line-broken、line-extinguished→观察 | — |
| `last-aftermath` | 撤守后恢复实际地方生活 | 经历→组:western-succession | 3—6 年 |
| `future-choice` | 决定入京或留守 | capital→组:capital-arrival；west→组:western-settlement | — |
| `west-council` | 留守后的职责与地方生活 | 经历→west-defense | 3—5 年 |
| `west-defense` | 守卫地方，承担实际胜败 | safe成、safe败、balanced成、balanced败、risky成→west-repair；risky败→观察 | — |
| `west-repair` | 战后损失与生活恢复 | 经历→west-years | 2—4 年 |
| `west-years` | 长期地方经营与旧人变化 | 经历→组:western-succession | 5—8 年 |
| `west-handover` | 交付既有总领职责 | independent-handover、appointed-handover、shared-handover→west-retirement | — |
| `west-retirement` | 实际交权后的退居 | 经历→west-legacy | 5—8 年 |
| `west-legacy` | 地方人生的晚年 | 经历→观察 | 3—6 年 |

### 素材处置与分层交付

- 重写第一幕自立原因和方法，保留同一检定协议与原难度；删除风险成功直接赠地及固定税册战利品。
- 第二幕保留现有组的职能，重接为夺县与争西洲的因果链。区域成果结束后同幕接续为空；去向组仅由真实失败来源进入。
- 删除京畿的 `capital-decision`、勤王／分权检定及其专属战后生活；把对应容量用于天下战事及失败后的守势。主要对手的新增检定均为魅力 22。
- 世界领域卡写制度和行动条件；IF 写主线、三幕目的及结局边界；事件组写当前经历、结果、接续与生活。完整故事不在各层重复复制。
- 家庭、同伴与既有盟敌持续承接；展示维护仍仅处理预设状态，不召回正文。
- 验证脚本逐节点配置选项。新局与失败来源回放分别记证据，不修改随机点数。

## 本轮验收：素材 4.0.2／IF 5.0.1（2026-11-14）

当前为 20 组、72 单元，协议 2、运行版本 22。本轮改动集中在世界领域资料、逐鹿 IF、事件素材、开发 skill 与验收脚本；没有修改引擎来判断逐鹿的军职、地域或具体故事结果。旧局快照保持不变。

### 实测发现、修改与回放

1. **败局出口缺标准。** 首次留守新局在自立、重新聚众连续失败后，正文已写旧人散伙、主角与同伴被拆编到不同队伍；观察却因为“尚未取得据点”返回 ongoing，随后无合法接续。IF 5.0.1 明确区分“还没成功”与“独立组织已解散”：从同一待收尾来源只重新观察，原选择、检定与结果正文不变，24 岁确认存活的坏结局。
2. **失败共同入口加重损失。** 入京新局攻县失败写的是全员撤回、梯绳损失，重整入口却预设失地与伤者，下一段凭空加了箭伤。4.0.1 去掉入口预设，第一次回放又在后一个 outcome 发现“原来的伤亡与失地继续存在”，4.0.2 一并改为实际人手、辖地与耗损。最终回放前两段明确“人没少”，没有新添伤亡或失地；随后防御检定才产生自己的实际后果。
3. **守纪分兵仍被写成阻拦。** 两个新局都在 scene 写合作分兵、choice 背景又写首领不许走。4.0.2 把当前检定处境写清：该路线独立分兵已获同意，阻力来自路上，而受控与溃兵路线各有自身阻力。由选择前的完整来源回放，首领当众认下分兵，实际转驻后形成自己的队伍；没有把原依附一律改成背叛。
4. **防守成功与天下结果仍有尺度跳跃。** 入京首局的反击只写敌人退后三十里，随后进入建朝。4.0.2 明确此战是主要对手联军投入核心力量的决定性战役，胜利实际解决联军指挥与独立兵权，后接军镇交付、建朝即位。由真实外线战败来源回放，正文写出联军指挥被俘、其余军镇交出兵权辖地；后续写国号、即位与任命，再进入执政和传承。前次外线失败与伤亡没有抹掉。

所有回放均为隔离验证；没有改玩家存档、强改随机点数或补发未取得成果。更换素材后从受影响单元前回放会重新生成该单元，因此它不是已保存结果的普通重试。已经保存的前序失败不重掷。

### 实际路径与证据

目录均位于本地 `storage/`，其中保留最终请求、原始返回、选择记录、逐轮内部快照与 `story.txt`。

| 目录 | 性质与实际结果 | 验收结论 |
| --- | --- | --- |
| `verification-sovereign-v22-rewrite-capital-live-20261114` | 4.0.0 完整新局：守纪义军、自立成功；攻县失败、守卫与邻地救援成功，再自立区域；入京成功、外线战败、守城反击成功；执政、继位、退居，81 岁 good | 完整路线可达；但反击仅退敌便建朝、普通生活重复，原样保留为修订前证据 |
| `verification-sovereign-v22-rewrite-west-live-20261114` | 4.0.0 完整新局尝试：自立和聚众均失败，24 岁独立队伍解散；观察 ongoing 后空接续 | 失败样本；没有到达留守分支，不计作留守通过 |
| `verification-sovereign-v22-rewrite-defeat-replay-20261114` | 同一双失败结果，用 IF 5.0.1 只重新观察；24 岁 bad、alive | 真实败局出口通过，不冒充新局 |
| `verification-sovereign-v22-rewrite-west-final-20261114` | 4.0.1／IF 5.0.1 完整新局：成军、夺县、接受任职、军运行动、西洲战事、自立区域；主动留守后守御失败，恢复、交接与退居，82 岁 normal | 夺县—西洲主轴、辅助经历回接、留守与非成功后续通过；生活重复尚在 |
| `verification-sovereign-v22-rewrite-realm-replay-20261114` | 4.0.2，从已保存的外线失败后回放：主要对手联军被解决、军政交付、正式建朝、继任与晚年，81 岁 good | 修订后战争到建朝的交接通过；是后半局回放 |
| `verification-sovereign-v22-rewrite-allied-rise-replay-20261114` | 4.0.2，守纪义军分兵前来源，实际获准分兵、转驻并组织自己的部众 | 三种依附不再在该样本统一成首领阻拦；其余两种依附未重新完整实测 |
| `verification-sovereign-v22-rewrite-loss-final-20261114` | 4.0.2，原攻县失败后完整重整组回放 | 既有损耗保留、未强加伤亡，随后独立守卫和去向交接正常 |

`verification-sovereign-v22-rewrite-loss-replay-20261114` 是 4.0.1 的中间回放，保留了发现第二处预设伤亡的证据。没有把最终素材各自从零一次无错跑通；最终改动用对应来源回放验证，完整留守新局仍是 4.0.1。

### 最终请求与开销核对

两次完整新局及修订后的回放使用 Chat Completions 真模型。逐项检查最终发送记录：作者表和 skill 没有进入请求，正文没有 `nextEventIds / nextFlowIds` 未来接续树，展示维护的 `currentState / writableFields` 档案没有回流正文。路由仅选择当前候选 ID；没有资产召回请求。每个职责的 system 与工具定义均只有一个固定版本。两种 provider 的协议交接由回归分别覆盖。

| 样本 | 请求数 | 输入／输出 Token | 模型调用耗时之和 | 协议纠正请求 |
| --- | ---: | ---: | ---: | ---: |
| 入京完整新局（4.0.0） | 252 | 829,462／50,948 | 477.6 秒 | 6 |
| 首次失败新局 | 71 | 221,334／22,930 | 180.9 秒 | 3 |
| 败局重新观察 | 2 | 12,443／457 | 4.9 秒 | 0 |
| 留守完整新局（4.0.1） | 228 | 740,263／44,534 | 414.4 秒 | 6 |
| 天下战事后半局回放（4.0.2） | 67 | 212,601／9,029 | 94.9 秒 | 2 |
| 合作分兵片段回放（4.0.2） | 9 | 33,572／1,714 | 18.2 秒 | 0 |
| 重整组最终回放（4.0.2） | 11 | 45,817／2,065 | 21.2 秒 | 0 |

耗时为模型调用累计值，不是前台响应承诺。完整入京样本 5 次幕初请求含协议纠正；不是幕内重写了 5 份世界卡。默认沙箱的最初两次启动因网络 EACCES 未形成对局，未纳入上述故事验收。

### 分项结论与未解决项

- **主线连贯性：**夺县成功来源确实接军运与西洲争夺，区域安排后不再退回“残部起家”；失败来源通过真实重整与邻地援救另取区域。京城之后继续主要对手战役，修订片段已补齐实际军政交付与建朝。
- **分支完整性：**72 单元从三幕显式入口可达，接续无回环；直接选择、行动胜败、失败后的不同战事、留守和提前事业败亡分别有出口。未穷举全部选项与随机组合；京畿最后撤守分支本轮没有自然触发，沿用机制覆盖，不能列为本轮完整实测。
- **生活与重复：**仍不合格。留守新局 26—29 岁连续重述五更起身、记边军旧例、母亲核账；入京首局晚年连续系鞋绳、报哨无事、数路签。删去常驻税册／粮册道具没有消除正文和既有历史中的同类意象。本轮没有改正文、压缩职责或恢复资产召回，也没有用过滤器遮掉这些重复。
- **其他实际问题：**幕初具象化仍出现“首随乡勇”“船户工匠”等身份词充当人名；修订后的战争对手在实际正文中仍多称“对手”。入京结局观察把末段闭眼听册判为寿终，正文没有明确死亡，生死判断仍有越界。以上不作为已解决交付。
- **机制与构建：**323 项后端回归、共享／后端／前端构建、skill 格式校验通过；两种 provider 的提交、重试与固定前缀有回归。运行协议保持 22，没有新增世界／IF 专用引擎分支。能够结局与年龄增长不代替上述未通过的故事质量项。

## 历史试点记录（本轮重整前）

## 运行来源与职责

本试点剧情接续的运行素材来自 `data/narratives/event-flows/ancient.sovereign-rise.json` 与对应 IF。本文是开发审读记录，不进入模型请求。

- `actEntries` 定义各幕入口。结果里的 `nextEventIds` 或 `nextFlowIds` 定义合法接续，不能同时填写。结束组时明确填写后续组数组，空数组表示没有已写定后续。
- 引擎先限制到合法、未完成、满足既有道具条件的候选。单候选直接承接；多候选由既有规划请求选 ID。规划只看当前候选入口和实际历史，不看未来结果树。
- 当前组未结束不抽新组。候选为空保留待收尾来源，不能退回全幕抽取，也不能强迫观察器改判结束。
- 世界卡只组织整幕局势及名称。幕内不改卡；选择和检定通过历史与接续生效。
- 观察器判断实际收束及主角生死，不选路线。实际结果可以结束游戏，不要求跑完全部可选事件组。

## 开发覆盖核对

当前 20 组、77 单元，其中 8 个直接选择单元。这些数量是素材统计，不是通关条件。

| 位置 | 素材与接续 |
| --- | --- |
| 家变与依附 | 家庭生活、家变、流亡；`join-choice` 决定投守纪义军、供给充足义军或随溃兵，生活承接已选关系 |
| 自立与立足 | 脱身成功才整理独立队伍；失败接残部选择与重新聚众，聚众失败或交出独立指挥权可结束事业；第一据点不等于县城 |
| 经略 | 成军后选择攻县、结盟、受编、粮道或应对军阀；不要求五项全部完成。仅获官身、援助承诺或粮食时仍可接具体行动 |
| 一方秩序 | 直接选择自主、受编或共治，按真实辖地与兵权处理；有限安排不补发区域控制，可继续外部行动 |
| 扩张失利后的去向 | 仅余小据点时，直接选择守住现有地方、承担最后一次行动或交出指挥权；最后行动另行检定，失败不恢复基业，守成经历实际交接与退居 |
| 人生去向 | `future-choice` 提供入京、留守两个选项；普通生活不替玩家决定 |
| 留守 | 地方生活、边界守御、实际损失后的恢复、旧部变化；后续组处理按真实权限交接和退居 |
| 入京 | 外围立足后，`capital-decision` 决定勤王、议和分权或另建秩序；各有具体行动检定，失败不改换政治立场 |
| 新朝传承 | 实际建立新朝的结果在原组内单独接新朝单元链，经历执政、正式继位与退位生活；不再与护旧朝、分权共用模糊收尾，也不在刚立朝时结束事件组 |
| 战后与败势 | 成功按所选目标处置，不统一发帝印；失败接最后行动，保留损失。成功道路还经历执政、交接与退居，结局作人生总结 |

直接选择使用 `kind: decision`，选项有任意稳定 ID，不强制三项。执行记录保存 `mode: direct` 与 `optionId`，没有 `ChoiceCheck` 或 `roll`。结果仅收到已选行动及对应确定结果。前端不显示成功率、成败标签或结局等级。

检定仍使用 `kind: choice`，保留 safe/balanced/risky、节点属性与难度、概率公式和单次持久化掷点。直接选择不进入随机兜底。

两类结果与背景同年，后续沿用正文 `nextClock`，换幕不覆盖交接。展示维护仍只整理预设角色卡，不回流正文。

## 隔离实测与针对性修改

使用 `scripts/live-narrative-check.mjs` 与本地 `Material/ak.txt`，不输出密钥、不覆盖玩家存档。布衣脚本明确列出每个选择节点及其行动 ID，`NARRATIVE_CHECK_CHOICES` 可逐节点覆盖；没有配置或 ID 不存在时报错，不统一选择风险档位、不回落第一项。请求、原始返回、选择、掷点、状态与可读故事保存在本地 `storage/verification-*`。

`NARRATIVE_CHECK_CURRENT_MATERIAL=1` 仅用于开发回放：已提交正文不变，替换隔离快照的事件素材；尚未生成新幕卡时可加载当前 IF。已有世界卡不改写。记录标记 `currentMaterialReplay`，片段回放与完整新局分别记录。

实际发现并修改：

1. 首轮留守测试在第二幕卡住：受编仅得到小范围职司，共同收尾却宣称一方之势。已收紧入口与处置条件，有限成果继续接具体行动。
2. 应对军阀的旧选项把迎战设为稳健、退守设为冒险，收尾还补发地盘。已改为明确投入的三档守御办法，保留真实所得。
3. 入京首局 38 岁即总结，战后生活不足。补入执政、交接和退居后，回放到 64 岁，但实际是普通结局：共用生活单元把已建立的新朝写回了地方守成，不能作为好结局通过。现已将建立新朝分流至原组内的专属执政与传承单元链。
4. 留守首局把“等你让位”当成交接完成，55 岁提前收束。IF 已区分日常分工、准备让位与实际继任、退居。第三幕复测在 59 岁结束，正文已写年轻人接手主位、主角退居；实际交接发生在生活段内，没有强制跑完后续可选组。
5. 多次扩张受挫、但小据点仍在的回放耗尽合法候选。已补入 `reduced-future` 具体去向，没有扩大整幕抽取；同一来源复测选择地方生活，在 61 岁完成实际交权、退居并形成普通结局。
6. 后续完整新局仍在 41 岁把下属后辈办事误判为主角交权。查实 `west-years` 混合任内生活与交接，普通结局另一条“保住一方基业”又绕过交权要求。已分开这两件事、收紧重叠标准；第三幕重放实际执行 `western-succession`，50 岁普通结局。
7. 入京失利、撤守成功的第三幕在 45 岁结束，暴露“最后一线”共同收尾混用保全与覆亡。已让保全部众与地方的分支继续交接退居，实际覆亡分支直接观察败局。复测分别为 53 岁普通结局和 35 岁坏结局，未重新掷点。
8. 新朝生活最初拆成新组时，立朝出口立即触发观察，34 岁就结束。现已改为原组内的专属单元链，不增加中途收束机会。五个单元分别处理新朝初政、长期治理、正式继位、退位生活与晚年；护旧朝、分权不经过该链。
9. 新朝回放在 51、55 岁两次因普通年份结算返回 down 而中断，解析位于请求返回之后，未进入现有单次纠错。仅布衣 v21 将同一解析移入现有纠错边界，属性规则与其他 IF 行为不变；两种 provider 均有回归，纠错材料不进入后续请求。
10. 从上述已保存的 55 岁状态恢复，61 岁完成新朝晚年与人生总结，观察确认好结局。实际正文包含新君独立批答、旧部与后代生活及主角退居；没有重新掷点。这是成功建朝来源的分段续跑，不能冒充修复后的另一轮完整新局。最后一段未触发纠错，纠错成功路径由机制回归验证。
11. 最后一轮入京新局在第一幕据点末段返回 ongoing，因无合法接续而保留来源。原单元只说“各方作出回应”，正文停在来使问话，观察又要求“公认独立”。已将该单元写实为拒绝征逼、保护避难者、现有部众守门及官署按独立乡兵应对；从单元前恢复后正常换幕，没有追加公认手续、扩大候选或重写观察职责。
12. 最后一轮留守新局在最后突破成功后形成了区域，但还没有处理过一方政治安排，`reduced-aftermath` 却没有接续。已补上到既有 `regional-lord` 的引用；已完成过的安排仍被过滤，不重复选择或自由重抽。恢复直接到达自主／受编／共治选择，沿用原有损失与真实战果。

实测目录：

| 目录 | 含义 |
| --- | --- |
| `storage/verification-sovereign-west-v21` | 首轮新局，自立失败、聚众成功；第二幕卡住样本 |
| `storage/verification-sovereign-west-recheck-v21` | 局部回放，检验有限成果和扩张失利；后续候选仍耗尽 |
| `storage/verification-sovereign-west-final-v21` | 第二次完整新局，留守且守御成功；55 岁收束过早样本 |
| `storage/verification-sovereign-west-handover-v21` | 从第二次新局第三幕建卡前回放；59 岁普通结局，实际接手与退居已发生 |
| `storage/verification-sovereign-capital-v21` | 完整入京新局，先选政治道路再检定；38 岁好结局，人生厚度不足样本 |
| `storage/verification-sovereign-capital-life-v21` | 同局战后重放，64 岁普通结局；新朝身份在共用生活中漂移的失败样本 |
| `storage/verification-sovereign-capital-risk-v21` | 同局另选真实冒险，两次行动均失败，42 岁坏结局 |
| `storage/verification-sovereign-reduced-v21` | 从候选耗尽来源回放；守住剩余小基业，61 岁普通结局，不补发区域控制 |
| `storage/verification-sovereign-west-current-v21` | 完整新局，41 岁提前收束的回归样本，保留输入与原始返回 |
| `storage/verification-sovereign-capital-current-v21` | 完整新局，扩张失利后选择小地方守成，53 岁普通结局；实际未进入京畿，不能计作入京通过 |
| `storage/verification-sovereign-west-latest-v21` | 从上述留守新局第三幕建卡前回放；实际交接与退居，50 岁普通结局 |
| `storage/verification-sovereign-capital-latest-v21` | 同一第二幕结果另选入京；行动失败、撤守成功，45 岁结束过早的样本 |
| `storage/verification-sovereign-retreat-v21` | 同一撤守结果重放，保全部众后继续交接，53 岁普通结局 |
| `storage/verification-sovereign-defeat-v21` | 同一真实双败结果重放，35 岁确认基业覆亡、坏结局 |
| `storage/verification-sovereign-new-court-v21` | 专属生活误拆新组的 34 岁提前收束样本，已撤回该拆组方式 |
| `storage/verification-sovereign-new-court-final-v21` | 原组内专属单元链；51 岁时普通生活结算提交 down，被仅允许 up 的规则拒绝，中断样本保留 |
| `storage/verification-sovereign-new-court-retry-v21` | 从同一 51 岁恢复，完成交接；55 岁再次遇到 down 校验中断，保留修复前证据 |
| `storage/verification-sovereign-new-court-complete-v21` | 从同一 55 岁恢复，新君在位、主角退居，61 岁好结局；同一成功建朝来源的最终续跑 |
| `storage/verification-sovereign-capital-full-final-v21` | 最后一轮入京新局，26 岁据点末段 ongoing，保留空接续来源及完整请求 |
| `storage/verification-sovereign-west-full-final-v21` | 最后一轮留守新局，攻县失败、撤守成功、最后突破成功；38 岁缺少政治安排接续，中断来源保留 |
| `storage/verification-sovereign-capital-full-repair-v21` | 从同一入京新局据点单元前修复回放；入京另建秩序失败、撤守成功，实际交接后 57 岁普通结局 |
| `storage/verification-sovereign-west-full-repair-v21` | 从留守新局已保存的最后突破与待收尾来源恢复；处理一方政治安排，明确留守，经历守土、正式交接与退居，66 岁普通结局 |

末轮两局均从新局开始，发现断点后保存原始样本，针对性修改并从受影响来源续跑到结局。最终可读故事覆盖完整人生，但这不等于最终素材已经各自从零一次无错通过。入京这局的实际结果是行动失败后的普通结局；成功建朝与提前败局由前述独立来源回放覆盖，没有强改掷点来达成指定等级。

请求开销示例（片段回放，不含继承的前半局请求）：

| 样本 | 请求数 | 输入 / 输出 Token | 模型调用耗时之和 | 协议纠正请求 |
| --- | ---: | ---: | ---: | ---: |
| 留守第三幕 `west-latest` | 55 | 151,492 / 9,286 | 101 秒 | 0 |
| 入京失利 `capital-latest`，修复前样本 | 56 | 197,700 / 12,510 | 126 秒 | 2 |
| 新朝晚年 `new-court-complete`，55 岁后续跑 | 15 | 42,836 / 1,966 | 25 秒 | 0 |
| 末轮留守新局 `west-full-final`，修复前部分 | 173 | 637,720 / 37,791 | 359 秒 | 6 |
| 同局接续 `west-full-repair`，待收尾来源之后 | 84 | 266,953 / 14,727 | 148 秒 | 1 |
| 末轮入京新局 `capital-full-final`，修复前部分 | 71 | 175,513 / 12,235 | 124 秒 | 3 |
| 同局接续 `capital-full-repair`，据点单元前恢复 | 125 | 404,080 / 24,279 | 238 秒 | 5 |

同一样本内按职责分别比较最终发送的 system 与工具，以上各职责均只有一个固定版本；动态年龄、选项和结果未改写它们。以上耗时是模型请求累计值，不是前台响应承诺。Chat Completions 使用真实模型；Responses 由机制回归覆盖。

## 未解决项

- 普通生活仍重复点人、粮册与核数意象。本轮没有证明这类表达重复已经消失。
- 展示维护出现过将未登记道具放入 updates 的错误；既有失败保留及不阻塞故事路径有效，本轮未重做维护协议。
- 幕初样本仍出现过“本幕待具象”这样的占位表达；事件角色绑定已有具体名称，但主持资料各字段的具象化质量尚未证明稳定。
- 未穷举全部直接选择及随机组合。机制通过、能够结局和人生年龄不代替叙事验收。

## 机制验证范围

311 项后端回归、共享／后端／前端构建通过。覆盖直接选择无掷点、两种 provider 传输、固定 system 与工具、保存恢复、同年交接、空候选保留、入京胜败分流与旧路线回归。布衣结算的单次纠错只重新提交属性，不重写正文、不改变年龄与属性状态，错误不进入后续请求。实际模型案例与机制回归分别记录；完整新局后的片段回放不冒充另一轮全新对局。

## 协议 2 复用验收（2026-11-14）

本轮只为逐鹿素材声明 `protocolVersion: 2`，与边境共用运行版本 22、直接选择、单候选承接和结算纠正；没有继续扩写逐鹿剧情。引擎不再按逐鹿 IF ID 启用这些能力。旧版本逐鹿存档只读保留。

`storage/verification-sovereign-v22-full-20261114` 为完整隔离新局：投守纪义军，自立成功，粮道行动失败，结盟并接受招安，应对军阀和攻县成功，自立一方，随后选择地方生活与实际交接，61 岁普通结局。178 次请求，输入 571,249 / 输出 35,906 Token，调用耗时之和 352.3 秒，3 次协议纠正。同职责的最终 system 与工具均为一个固定版本；真实 provider 为 Chat Completions，Responses 由回归覆盖。

直接选择、具体行动检定、结果接续、保存恢复和结局执行通过；322 项总回归与三端构建通过。入京和其他选项本轮未重新完整实测，沿用此前证据而非宣称已穷举。

需要后续创作对齐的具体问题仅记录，不在引擎补特判：

- 攻县成功、选择自立一方后，`reduced-future` 仍用“道路收窄、残部”引入去向，和刚形成的实际地盘不够衔接；接续可达不等于入口语义成立。
- 多次场景铺垫已经写出主角行动，随后选择背景再重述一次；粮册、名分与文书意象仍占据大量生活。
- 本轮仅验证同一协议的复用，没有用这些发现自行扩写逐鹿。后续修改先更新作者表，与用户对齐，再落实到对应事件组。
