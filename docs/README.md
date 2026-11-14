# 项目文档索引

更新于 2026-11-14。项目处于原型开发；边境、逐鹿声明事件协议 2，新局均为运行版本 22；其余古代路线保留 20，其他世界 IF 保留 18。基础世界内容版本与运行版本是不同概念。

## 当前规范

| 文档 | 阅读目的 |
| --- | --- |
| [边境分支与协议复用](FRONTIER_BRANCH_PILOT.md) | 版本 22 的作者表、非授将后续、战后生活及验收；不作为模型输入 |
| [布衣分支与直接选择](SOVEREIGN_BRANCH_PILOT.md) | 逐鹿故事与历史试点；当前执行协议以事件组实现文档为准 |
| [架构与运行链路](ARCHITECTURE.md) | 从身世、幕初到事件提交、收束、接组和记忆的完整链路 |
| [分时段记忆与独立接组](PERIOD_MEMORY_AND_EVENT_ROUTING.md) | 最新上游提示词溯源、摘要替换与职责拆分；包含完整出生请求原文 |
| [事件组实现](EVENT_FLOW_IMPLEMENTATION.md) | 人工骨架、幕初具象化、节点检定与结果交接 |
| [边镇事件组推广](FRONTIER_EVENT_ROLLOUT.md) | 用户认可后推广到三幕 13 组，单元分工、出口与实际验证 |
| [古代 IF 事件组推广](ANCIENT_EVENT_FLOW_ROLLOUT.md) | 江湖宗师试点结构与其余古代 IF 的横向扩充约定 |
| [事件之间的普通生活](ORDINARY_LIFE_INTERVALS.md) | 素材配置生活范围，引擎保存并执行；属性达标后也能经历日常 |
| [出击与成为将军试点](FRONTIER_CAMPAIGN_PILOT.md) | 已获用户认可的单元路由、规则论功行赏、完整试点与历史问题 |
| [版本 20 角色卡与组前准备](EVENT_FLOW_V20.md) | 准入、预设资产范围、展示维护及已知问题 |
| [静态世界与主持资料](NARRATIVE_WORLD_CARD_DESIGN.md) | 各层素材字段、制度原文选择及实际供应位置 |
| [运行版本 18](NARRATIVE_V18.md) | 尚未配置事件组的路线的运行边界 |

发生冲突时，以上文档的当前说明及实际代码为准。`TECHNICAL.md` 日期章节、旧验收和开发日志保留历史，不用于恢复五节拍、风格追加、资产用途扩写或旧摘要协议。

## 使用与维护

- [使用流程](USAGE_FLOW.md)：开局、准备、选择、读档与结局。
- [配置指南](CONFIG_GUIDE.md)：服务配置、世界内容、存档与生效范围。
- [仓库文件与验证记录](REPOSITORY_HYGIENE.md)：忽略规则、取消跟踪清单、验证脚本与本地记录。
- [提交前核对](GITHUB_RELEASE_CHECKLIST.md)：检查暂存内容、构建产物与本地文件。
- [小说与世界包制作](NOVEL_DISTILLATION_GUIDE.md)、[基础模板](../examples/world-pack/WORLD_PACK_GUIDE.txt)、[IF 模板](../examples/world-pack/STORY_PACK_GUIDE.txt)。
- [IF 故事创作 skill](../skills/if-story-authoring/SKILL.md)：开发时对齐故事分支、落实事件素材并验收，不进入游戏提示词。

## 历史实测与变更

- [单组试点实测](FRONTIER_CAMPAIGN_PILOT.md)：守渡失败、调整、攻营成功与军议；包含后续真实结局、三类结局总结回放与未解决项。[前一轮实测](PERIOD_MEMORY_AND_EVENT_ROUTING.md)：独立观察与规划完整对局、压缩原文回放与未解决项。
- [大衍六类制度审核](WORLD_RULES_REVIEW.md)、[制度供应实测](WORLD_RULES_PLAYTEST.md)、[古代静态素材审计](ANCIENT_STATIC_CONTENT_REVIEW.md)。
- [版本 19 验收](EVENT_FLOW_VERIFICATION.md)、[版本 18 验收](NARRATIVE_V18_VERIFICATION.md)、[版本 17 历史规范](NARRATIVE_V17.md)。
- [技术记录](TECHNICAL.md)、[更新日志](CHANGELOG.md)、[开发日志](DEV_LOG.md)。

文档中的 `storage/verification-*` 路径为本机实测证据，不随 Git 发布。仓库保留结论、未解决项和可复用脚本，完整请求、原始返回、存档、私人参考与密钥另行保存在本地。缺少这些本地文件不影响正常启动或普通回归。
