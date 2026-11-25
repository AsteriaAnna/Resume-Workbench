# Story 质量与颗粒度：三方案实测报告

> 日期：2026-11-25  
> 数据：`exp_74645d5065a74df4`（学业发展中心，raw 327 字），两次不重叠输入：204 字 + 121 字  
> 模型：`deepseek-flash`；第一次 P1 建立 registry，第二次分别用三种方案  
> 完整原始结果：`prototype/eval/reports/three-schemes-20261125133539/`（本地，未提交真实内容）

## 1. 三方案定义

| 方案 | 做法 |
| --- | --- |
| `full-rewrite` | 每次新输入都用 P1 全量重写 Story，随机分配 ID（旧实现） |
| `registry-update` | 首次 P1 建 `story_registry`；第二次 P1-Update 带 registry + changed_paragraph_ids，只改变更 Story |
| `curator-loop` | registry + P1-Update + 一次 P1-Review（有界循环，不是自主 Agent） |

## 2. 结果

| 指标 | full-rewrite | registry-update | curator-loop |
| --- | ---: | ---: | ---: |
| 首次 Story 数 | 4 | 4 | 4 |
| 二次 Story 数 | 6 | 6 | 7 |
| 首次 ID 保留（4 条中） | 0/4 | **4/4** | **4/4** |
| ID Jaccard | 0 | 0.667 | 0.571 |
| 标题 Jaccard | 0 | 0.667 | 0.571 |
| 二次槽位填充率 | 0.750 | 0.778 | **0.810** |
| 二次 quote 命中 | 7/7 | 7/7 | 7/7 |
| 二次准入率（启发式） | 1.0 | 1.0 | 1.0 |

### 结论一：全量重写不可接受

- 首次 4 条，二次 6 条；
- **已有 4 条 Story 的 ID 全部变化**；
- 标题 Jaccard = 0，说明同一段经历两次被切成完全不同的 Story；
- 下游引用、问题、选材无法稳定对应。

### 结论二：Registry 明显改善身份稳定

- 首次 4 条 ID 在第二次全部保留（4/4）；
- 第二次只新增 2 条：分享会、单词活动；
- 已有 4 条中，1 条被补充了 tech_link（“设计报名打卡流程”从缺 tech_link 变成齐全）；
- 槽位填充 0.75 → 0.778。

### 结论三：Curator 更细，但不是全面更好

- 保留 4 条旧 ID，新增 3 条（分享会、单词活动、AI 工具）；
- 槽位填充最高 0.810；
- 但新增的“使用 AI 工具辅助文档与排版”仍缺 problem，属于弱 Story；
- Story 数 7，比 Registry 多 1，颗粒度更细，但是否需要这条要看生成阶段是否用得上。

## 3. Story 颗粒度观察

Registry 二次结果：

1. 主动联系老师统筹活动（旧）
2. 公众号内容与活动材料更新（旧）
3. 设计报名打卡流程并统计数据（旧，补了 tech_link）
4. 对接同学与嘉宾邀请协调（旧）
5. 落地保研分享会并承担运营（新）
6. 单词活动打卡流程设计与完成率（新）

Curator 二次结果：在上述基础上再拆出“使用 AI 工具辅助文档与排版”。

**判断：**

- Registry 的 4 条旧 Story 更像“职责块”，其中“主动联系老师”“公众号内容”“对接协调”仍偏职责/动作，不算强决策/结果链；
- 新增的“分享会”“单词活动”颗粒度更合理（有动作 + 结果）；
- Curator 拆出 AI 工具这条，粒度更细，但缺结果，属于“技术链路细节”，是否单独成 Story 取决于它能否支撑一条独立 bullet；
- 当前 6–7 条的数量不算多，但**质量不是均匀的**：事件型 Story 好于职责型 Story。

## 4. 质量限制因素定位

### 4.1 模型输出格式不稳定（最高优先级）

P1-Update 真实输出多次出现**结构不完整 JSON**（缺花括号/截断），导致 `LLM_JSON` 失败。已加：

- `temperature=0`；
- 输出预算提高；
- JSON 控制字符修复；
- P1-Repair 兜底（只修 JSON，不增删 operation）。

但这只是兜底。根因是：

- 输出 schema 太自由，模型在 `create/update/merge/split` 之间摇摆；
- 没有 few-shot 的边界示例；
- 没有“先分类、再填字段”的两段式；
- 没有 JSON Schema 强制 / 结构化输出约束（当前只有 `json_object`）。

### 4.2 准入没有强校验

- “主动联系老师任副主席”是角色/起点，不是“子目标+动作+结果”的闭环；
- “对接同学与嘉宾邀请协调”是职责，不是事件；
- “使用 AI 工具辅助文档与排版”缺 outcome；
- 当前 flags 没有完整标出 `missing_problem/missing_tech/missing_outcome`，人看起来会误判。

根因：P1/P1-Update 的提示词有“准入描述”，但没有**可执行的拒绝/降级规则 + 示例**；Validator 只校验 quote/结构，不校验准入。

### 4.3 粒度规则没有量化边界

- 什么算“一个子目标”？
- 职责块要不要拆？
- AI 工具细节要不要单独 Story？
- 当前只有自然语言规则，没有边界示例/反例。

### 4.4 评价指标仍是启发式

- `slot_fill`、`admission_rate` 是自动启发式，不等于人工质量；
- 没有“Story 可用性”人工评分；
- 样本只有 1 段经历，不能当统计结论。

### 4.5 正文初始化有重复

首次正文出现“担任副主席”重复两次（metadata + body），说明 P11 初始录入也缺少去重规则。

## 5. 对照 SOTA 级操作规范与流程

> 这里的“SOTA”指当前可借鉴的成熟工程/研究规范，不是简历领域已有统一标准。

### 5.1 切分：事件边界，而不是任务列表

- 事件切分研究认为，人会在**子目标完成/目标变化**处切事件，且事件是层级结构；
- 参考：[Event Segmentation](https://pmc.ncbi.nlm.nih.gov/articles/PMC3314399/)
- 规范：
  - Story = 一个子目标/决策 + 动作 + 闭环结果；
  - 职责列表不是 Story；
  - 父/子层级只在总目标跨多个子目标时使用；
  - 先判断边界，再填槽位。

### 5.2 单元：self-contained / minimal / distinct

- 检索单元研究强调：单元要 **distinct、minimal、self-contained**；proposition 太细，event-level 更适合作 bullet 单元；
- 参考：[Dense X Retrieval](https://ar5iv.labs.arxiv.org/html/2312.06648)
- 规范：
  - 一个 Story 脱离上下文能读懂；
  - 不能把多个独立子目标塞进一条；
  - 也不能细到只有一句职责。

### 5.3 增量：事件日志 + 稳定身份 + 对账

- 增量视图维护：按记录级更新、保留多版本状态，不整表重算；
- Event Sourcing / CQRS：raw 是事件日志，narrative/Story 是 projection，需要稳定 key、幂等、可回放；
- 增量知识图谱：实体对齐、冲突合并、保留稳定 ID；
- 参考：[Shared Arrangements](https://ar5iv.labs.arxiv.org/html/1812.02639)、[Event Sourcing/CQRS](https://pkg.go.dev/github.com/quintans/eventsourcing@v0.32.0)、[ID-GraphRAG](https://dl.acm.org/doi/10.1007/978-981-92-2856-0_11)
- 规范：
  - `story_registry` + `story_key`；
  - P1-Update 只改变更 Story；
  - 全量重写只做修复；
  - 每次变更带 source quotes / paragraph ids。

### 5.4 提示词：决策表 + few-shot + 两段式 + 校验

- 工作流/Agent 选择：先 workflow，再按需受限 Agent；参考 [Anthropic](https://www.anthropic.com/research/building-effective-agents)、[Workflow or Agent?](https://rexblack.com/resources/writing/workflow-or-agent)
- 规范：
  - 决策表 + 优先级；
  - 3–5 个边界 few-shot（拆分/合并/职责不拆/弱 Story）；
  - 先“分类”再“填字段”；
  - JSON Schema / Validator；
  - 失败可 repair，但 repair 不能改变语义。

### 5.5 表达：STAR/XYZ/CAR/PAR，而不是形容词

- 简历写作的行业规范：
  - 动作 + 对象 + 方法 + 结果/数字；
  - 单点聚焦；
  - 禁止评价性收尾；
  - Hook 与正文互文；
- 当前 §14 已写；Story 层要保证每个 Story 至少能支撑一种句式（XYZ/CAR/PAR），否则降级。

## 6. 准入更正（OR，不是 AND）

- Story create 条件：projection_fit 任一骨架（XYZ/CAR/PAR）+ 单主题 + quote 可回查；
- Hook/L2 是编译层产物，不作为 Story 准入；
- 修正后真实两次输入：Story 4→6（旧 4 条保留，新增分享会、单词活动）；
- 对 6 条跑三指标：多骨架 0/6、纯度 6/6、忠实度 3/6；
- 剩余瓶颈在 L2 术语、推断性补充、长度/引用，不在准入。

## 7. 建议的下一步

1. **v6.1 先修 P1-Update 的格式稳定性**：
   - 两段式：先输出 `{boundaries:[...]}`，再输出 operations；
   - 加 3–5 个 few-shot；
   - JSON Schema/Validator；repair 只修语法。
2. **Story 准入 Validator**：
   - 缺 outcome/action/self-contained → 自动降 Fragment；
   - 补 flags；
   - 职责列表 → 不 create。
3. **粒度规则量化**：
   - 一条 Story 最多 2 个动作簇；
   - 超过 → split；
   - 少于 1 个结果 → 不 create。
4. **Curator 只在长尾启用**：
   - 先用 Registry；Curator 只处理“合并/拆分/弱 Story”；
   - 用同一测试集比较，指标不退化才保留。
5. **人工抽样评估**：
   - 每方案抽 5 条 Story，评“准入/粒度/可用性”；
   - 当前自动指标只能做方向判断。
