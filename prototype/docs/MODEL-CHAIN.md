# 简历工作台 · 核心链路说明书

> 代码版本：当前 `main`（前端已移除，只保留模型链路 + 数据层）
> 源码：`prototype/v2.mjs`（提示词、五阶段实现）、`prototype/cli.mjs`（入口）、`prototype/mock.mjs`（离线替身）
> 配套：[DATA-CONTRACT.md](./DATA-CONTRACT.md)（数据契约）、[MODEL-PIPELINE.md](./MODEL-PIPELINE.md)（阶段参数速查）

---

## 0. 一句话总览

**原始口述 → 建卡 → JD 扫描（选卡 + 策略）→ 按选卡逐经历编译（背景/Hook/正文）→ 生成评论 → 回答补卡 → 新卡入库并只重编译该段。**

没有前端参与；所有阶段都可以用 `node prototype/cli.mjs <stage>` 单独执行，产物全部落在数据目录的 `v2/` 下。

---

## 1. 全链路图

```mermaid
flowchart LR
  RAW[raw/*.json<br/>原始口述] --> SNAP[snapshots/rev/index.json<br/>经历库索引]
  SNAP --> IMPORT[① 建卡<br/>PROMPT_INGEST]
  IMPORT --> CARDS[(v2/cards.json<br/>6 槽位 + S/A/B)]
  JD[目标 JD] --> SCAN[② 语义扫描<br/>PROMPT_SCAN]
  CARDS --> SCAN
  SCAN --> SCANOUT[(run.scan<br/>jd_analysis + rankings + gaps)]
  SCANOUT --> COMPOSE[③ 三区编译<br/>PROMPT_COMPILE]
  CARDS --> COMPOSE
  COMPOSE --> FIT[字数/风格归一化<br/>PROMPT_FIT + 扩写 + hardTrim]
  FIT --> CONTENT[(run.content<br/>background + bullets)]
  CONTENT --> COMMENTS[④ 评论<br/>PROMPT_COMMENTS]
  COMMENTS --> CMT[(run.comments<br/>锚定 bullet)]
  CMT --> GAP[⑤ 补卡<br/>PROMPT_GAPCARD]
  GAP -->|回答足够| NEWCARD[新卡入库<br/>source=gap]
  NEWCARD --> CARDS
  GAP -->|回答不足| FOLLOW[追问 insufficient<br/>不改库]
  NEWCARD --> RECOMPILE[只重编译该经历]
  RECOMPILE --> CONTENT
```

---

## 2. 五阶段速查表

| # | 阶段 | 函数（v2.mjs） | 提示词 | 输入 | 输出 | 模型参数 |
| --- | --- | --- | --- | --- | --- | --- |
| ① | 建卡 | `importFromWiki()` | `PROMPT_INGEST` | 经历标题/类型 + raw 口述 | `spine_summary` + `story_cards[]`（6 槽位） | max_tokens 8000, T=0.3 |
| ② | 扫描 | `scan(jd)` | `PROMPT_SCAN` | JD + 全部经历与卡片强槽位 | `jd_analysis` + `experience_rankings`（选卡/match_reason/gaps） | max_tokens 5000, T=0.2 |
| ③ | 编译 | `compose(runId, selections)` | `PROMPT_COMPILE(s)` | 单段经历主干 + 用户选卡 + 扫描 match_reason + 策略 | `project_background` + `bullets[]` | max_tokens 4000, T=0.4 |
| ③.5 | 归一化 | `fitExperience()` | `PROMPT_FIT` | 超限/评价收尾/重复 hook 的 bullet | 改写后的背景与正文 | max_tokens 3000/2500, T=0.2 |
| ④ | 评论 | `comments(runId)` | `PROMPT_COMMENTS` | JD + 已生成 bullets + gaps + 未选 S/A 卡 | `comments[]`（锚定 bullet_id，最多 4 条） | max_tokens 2000, T=0.2（默认） |
| ⑤ | 补卡 | `gapCard(runId,{comment_id,answer})` | `PROMPT_GAPCARD` | 原始口述 + 缺口问题 + 用户回答 | 新卡（或 insufficient + 追问）→ 该段重编译 | max_tokens 3000, T=0.2（默认） |

所有调用都走 `response_format: json_object`，超时 240s；只有 JSON 解析失败才重试一次。

---

## 3. 阶段时序（以一次完整 CLI/API 调用为例）

```mermaid
sequenceDiagram
  autonumber
  participant U as CLI / API
  participant C as v2.mjs
  participant L as DeepSeek
  participant F as 数据目录

  U->>C: scan(jd)
  C->>F: 读 v2/cards.json
  C->>L: PROMPT_SCAN + {jd, experiences, cards}
  L-->>C: {jd_analysis, experience_rankings}
  C->>F: 写 runs/<run_id>.json
  C-->>U: run_id + rankings

  U->>C: compose(run_id, selections)
  loop 每段经历
    C->>L: PROMPT_COMPILE + 经历/选卡/match_reason/策略
    L-->>C: {project_background, bullets}
    alt 字数/风格不合规
      C->>L: PROMPT_FIT（最多 3 轮）
      L-->>C: 改写后的内容
      C->>C: 仍不合规 → hardTrim 分句裁剪
    end
  end
  C->>F: 写 run.content
  C-->>U: 生成结果

  U->>C: comments(run_id)
  C->>L: PROMPT_COMMENTS + JD/bullets/gaps
  L-->>C: comments[]
  C->>F: 写 run.comments

  U->>C: gap(run_id, comment_id, answer)
  C->>L: PROMPT_GAPCARD + raw/问题/回答
  alt insufficient
    L-->>C: {insufficient, question}
    C-->>U: 追问，不改库
  else 足够
    L-->>C: {card}
    C->>F: cards.json 追加新卡
    C->>C: compose 只重编译该经历
    C->>F: run.comments 标记 resolved
    C-->>U: 新卡 + 新内容
  end
```

---

## 4. 数据依赖图

```mermaid
flowchart TB
  subgraph 输入层
    RAW[raw/raw_*.json<br/>experience_id + messages]
    SNAP[snapshots/rev/index.json<br/>nodes/relations]
    WIKI[snapshots/rev/wiki/*.md]
    JD[目标 JD 文本]
    PROFILE[profile.json<br/>基础信息]
  end

  subgraph 事实层
    CARDS[(v2/cards.json<br/>experiences + cards)]
  end

  subgraph 运行层
    RUN[(v2/runs/run_id.json)]
    SCAN[run.scan<br/>jd_analysis / rankings / gaps]
    CONTENT[run.content<br/>experiences / background / bullets]
    CMT[run.comments<br/>question / bullet_id / resolved]
  end

  RAW --> IMPORT[importFromWiki]
  SNAP --> IMPORT
  WIKI --> IMPORT
  IMPORT --> CARDS
  JD --> SCANFN[scan]
  CARDS --> SCANFN
  SCANFN --> RUN
  RUN --> SCAN
  CARDS --> COMPOSEFN[compose]
  SCAN --> COMPOSEFN
  COMPOSEFN --> CONTENT
  CONTENT --> COMMENTSFN[comments]
  COMMENTSFN --> CMT
  CMT --> GAPFN[gapCard]
  GAPFN -->|新卡| CARDS
  GAPFN -->|重编译| COMPOSEFN
  PROFILE -.旧版渲染使用.-> CONTENT

  SCAN -. 引用 .-> CARDS
  CONTENT -. 引用 .-> CARDS
  CMT -. 引用 .-> CONTENT
```

**关键不变量**
- `cards[].exp_id` ∈ `experiences[].exp_id`；`card_id` 唯一；
- `run.scan.selected_cards[].card_id` ∈ `cards`；
- `run.content.bullets[].card_id` ∈ `cards`，且 `raw_quote` 非空；
- `run.comments[].bullet_id` ∈ 该 run 的 bullets；
- **重建 `cards.json` 会让之前的 run 变成 stale**（引用旧测试卡的 run 会失效），所以历史 run 要么归档，要么只在当前卡片版本内校验。

---

## 5. 各阶段细节 + 提示词全文

### ① 建卡：raw → cards

**代码**：`importFromWiki()`（v2.mjs，约 L586）→ `normalizeCards()` → `grade()`
**输入**：经历标题、类型、`raw_text`（`raw/*.json` 的 messages 拼接）
**输出**：`{ spine_summary, story_cards[] }`，每卡 6 槽位；随后静态规则分级：
- S：problem/workflow/outcome 三槽位齐全 + outcome 含数字
- A：三槽位齐全 / 两槽位且有动作或数字
- B：其余
**校验**：槽位缺信息必须填「未提及」；`raw_quote` 必须来自原话；卡片必须 `is_verified=true`。
**提示词**：

```text
const PROMPT_INGEST = `# Role
你是一个严谨的知识图谱构建引擎与资深产品架构师。你的任务是将用户针对某段经历（项目、实习或校园经历）的【原始口述文本（Raw）】，提纯并转化为结构化的【经历主干（Spine）】与【全要素决策卡片（Story Cards）】。

# Core Principles
1. 绝对忠于事实（零幻觉原则）：只能基于用户提供的原始口述整理、去噪、结构化；严禁编造原文未提及的数据、组件或背景。槽位没有信息必须填"未提及"。
2. 独立闭环切分原则：出现新的子问题/卡点、新阶段里程碑或独立技术/产品决策，且包含动作与结果时，切分为新卡；同一决策的补充解释合并进同一张卡；核心经历目标 4~8 张卡，按时间/因果给 step_order。
3. 多视角完备性：每张卡尽量填满 6 个槽位，便于未来按不同策略渲染。

# Output Schema（只返回一个 JSON 对象）
{
  "spine_summary": "120-180字，客观第三人称：背景目标 → 关键阶段 → 最终成果",
  "story_cards": [
    {
      "step_order": 1,
      "toc_title": "20字以内短标题（做了什么决策/解决什么问题）",
      "slot_stage": "阶段",
      "slot_module": "业务域/功能模块",
      "slot_problem": "卡点、约束、方案权衡与决策依据",
      "slot_workflow": "输入 → 核心处理动作 → 交付输出",
      "slot_tech_link": "技术栈/模型/API/工具及连接关系；纯业务向写协作工具或方法论；无则填未提及",
      "slot_outcome": "客观结果/量化收益 + 体现的核心能力",
      "raw_quote": "从原话中一字不差截取的1-3句关键原话",
      "linked_nodes": [{ "node_name": "客观标签", "node_type": "tech|product|domain" }]
    }
  ]
}`;
```

---

### ② 扫描：JD + 卡片 → 选卡/策略

**代码**：`scan(jd)`（约 L612）
**输入**：`{ jd, experiences[{exp_id, category, title, spine_summary, cards[{card_id, step_order, quality_grade, slot_problem, slot_workflow, slot_outcome}]}] }`
**输出**：
```json
{
  "jd_analysis": { "core_demands": [], "jd_focus": "", "hook_level": "L1|L2|L3", "body_pattern": "XYZ|CAR|PAR", "reason": "" },
  "experience_rankings": [{ "exp_id": "", "priority_rank": 1, "decision": "主推详写|补充略写|建议舍弃",
    "selected_cards": [{ "card_id": "", "step_order": 1, "match_reason": "" }], "gaps": [] }]
}
```
**校验**：代码只依赖 JSON 解析成功；字段与引用由测试闸门保证（`npm test` 会校验 jd_analysis 字段、rankings 覆盖、card_id 合法）。`selected_cards` 为空则后续 compose 跳过该段。
**提示词**：

```text
const PROMPT_SCAN = `# Role
你是一个资深技术/产品招聘专家与简历策略主编。请根据【目标 JD】，对候选人知识库中的【全量经历与决策卡片】进行深度语义扫描、证据质量质检与经历级取舍排序。

# Core Rules
1. 跨语义深度匹配（拒绝机械找词）：重点考察卡片的 slot_problem / slot_workflow / slot_outcome 是否能实质性印证 JD 的能力要求。
2. 证据质量一票否决：优先选用 quality_grade 为 S 或 A 的卡片；缺乏具体行动与结果支撑的卡片不得选为主力。
3. 叙事连贯性保护：同一经历选多张卡时，保留能体现"启动→攻坚→迭代/结果"逻辑链的卡片（关注 step_order）；每张入选卡必须给出 match_reason（该卡哪个具体动作/决策印证了 JD 的哪条要求），后续编译会用它做"单点聚焦"。
4. 客观缺口诊断：若某段核心经历值得写但缺少 JD 看重的维度，在 gaps 中明确指出。

# Hook 专业术语层级（hook_level，三选一，全篇统一）
- L1 功能直白层：非技术岗/传统业务岗，用大众易懂的中文功能词，不带技术概念。
- L2 行业标准术语层（默认推荐）：AI 应用 PM/策略 PM/AI 落地岗，直接调用业界公认标准名词，允许 1~3 个英文词或中英混排（如 Local-First 存储、Structured Output 校验、Rule-Based 规则约束、Human-in-the-Loop）。
- L3 架构与工程权衡层：大厂核心 AI 平台/Agent 架构岗/强技术向 PM，点出架构模式或工程边界（如 Zero-Backend 端侧架构、Deterministic Guardrails、Index-Free 语义扫描）。

# 正文叙事骨架（body_pattern，三选一，全篇统一）
- XYZ 成果导向型：先抛量化指标或核心交付结果 → 再写实现该结果的关键机制与动作。
- CAR 痛点破局型：先点明具体卡点/工程约束 → 再写方案权衡（放弃 A 选 B）与落地解法 → 最终结果。
- PAR 流程链路型：先交代目标场景 → 再按"输入 → 核心处理节点 → 交付输出"展开链路与效果。

# 选择原则
根据 JD 的岗位属性与考察重点选择 hook_level 与 body_pattern；不确定时 hook_level 取 L2。同时提炼一句 jd_focus（JD 最核心的考核句，不超过 60 字）。

# Output Schema（只返回 JSON）
{
  "jd_analysis": {
    "core_demands": ["3-5项核心诉求"],
    "jd_focus": "JD 最核心的考核句（≤60字）",
    "hook_level": "L1|L2|L3",
    "body_pattern": "XYZ|CAR|PAR",
    "reason": "一句话说明为什么选这个组合"
  },
  "experience_rankings": [
    { "exp_id": "经历ID", "priority_rank": 1, "decision": "主推详写|补充略写|建议舍弃",
      "selected_cards": [ { "card_id": "卡片ID", "step_order": 1, "match_reason": "该卡的具体动作/决策如何印证 JD 的某项要求（编译时用作单点聚焦）" } ],
      "gaps": ["缺口描述"] }
  ]
}
要求：覆盖输入里每个 exp_id；主推最多 2 段、略写最多 3 段。`;
```

---

### ③ 编译：单段经历 → 三区内容

**代码**：`compose(runId, selections)`（约 L304）
**输入**（每段）：
- 经历 `title/category/spine_summary`
- 用户选中的卡片（按 step_order 排序，带 6 槽位）
- 扫描阶段给这些卡片的 `match_reason`（编译时做单点聚焦）
- 策略：`{ jd_focus, hook_level, body_pattern }`（来自 `scan.jd_analysis`，可被 selections 覆盖）

**输出**：

```json
{
  "exp_id": "",
  "project_background": "40-60 字背景总述",
  "bullets": [{ "card_id": "", "focus_angle": "≤15字", "hook": "4-12字符", "content": "35-80字" }]
}
```

**质量闸门（代码硬校验 + 归一化）**：

```mermaid
flowchart TD
  A[LLM compile 输出] --> B{每卡恰好 1 bullet<br/>card_id 合法?}
  B -->|否| ERR[该段记录 error，不阻塞其他段]
  B -->|是| C{project_background<br/>40-60 且以。或；结尾?}
  C -->|否| FIX[PROMPT_FIT 改写]
  C -->|是| D
  FIX --> D{content 35-80<br/>hook 4-12?}
  D -->|否| FIX
  D -->|是| E{反八股?<br/>无评价收尾/无重复hook}
  E -->|否| FIX
  E -->|是| OK[写入 run.content]
  FIX -->|3 轮后仍不合规| TRIM[hardTrim 分句裁剪<br/>记录 hard_trimmed]
  TRIM --> OK
```

**具体规则**（`checkBullet`）：
| 检查 | 规则 | 不合规处理 |
| --- | --- | --- |
| hook 长度 | 4-12 字符 | 进入 FIT |
| content 长度 | 35-80（舒适 50-75） | 进入 FIT，仍超则 hardTrim |
| 背景 | 40-60 且完整句 | 进入 FIT，仍不合规则 hardTrim |
| 评价收尾 | 禁止「体现/展现/验证/确保/保障 + 能力/效果/质量」 | 进入 FIT |
| 重复 hook | content 不得以 hook 或【…】开头 | 程序先剥离，再不行进 FIT |
| 溯源 | `raw_quote` 必须来自卡片 | 空则测试失败 |
| focus | `focus_angle` 非空 | 空则测试失败 |

**提示词（模板，`{jd_focus}/{hook_level}/{body_pattern}` 由策略注入）**：

```text
const PROMPT_COMPILE = (p) => `# Role
你是一个顶尖的 AI 产品经理简历架构师，写作参照大厂内部复盘文档：冷静、具体、可核对，不抒情、不自我评价。
请严格基于候选人的【单段经历主干】和【已选决策卡片（6槽位事实）】，按照【Hook 专业术语层级】与【正文叙事骨架】，编译出专业、克制、全篇层级统一的简历模块。

# Input Parameters
- 目标岗位 JD 考察重点：${p.jd_focus || '未提供'}
- Hook 术语层级（全局锁定）：${p.hook_level || 'L2'}
- 正文叙事骨架（全局锁定）：${p.body_pattern || 'CAR'}

# 一、项目背景区（project_background）
- 1~2 句，40~60 字，放在所有 Bullet 之前。**必须是完整通顺的句子（以句号或分号结尾），不得为压字数截断成病句。**
- 必须交代三件事：① 业务背景（什么场景、为谁做）；② 从 0 到 1 的独立/主导定位；③ 整体产品/项目形态。
- 宏观定位只写在这里，不要塞进 Bullet；不要写"体现了…能力"。

# 二、Hook 层级映射（严格执行 ${p.hook_level}，全篇不得混级）
## L1 功能直白层
- 适用：非技术岗、传统业务岗、需要降低理解门槛的场景。
- 命名规范：大众易懂的中文功能词或动作词，不带技术概念、不带英文缩写。
- 正例：语音转待办、本地数据存储、提示词调优、报名表设计、名单核对。
- 反例：Zero-Backend、Deterministic、端侧架构（这些属于 L3）。

## L2 行业标准术语层（默认档）
- 适用：AI 应用 PM、策略 PM、AI 落地岗、大多数互联网产品岗。
- 命名规范：直接调用业界公认的产研标准名词；允许 1~3 个英文词或中英混排；不加"化/性/度"等虚词后缀；不用只有本公司内部才懂的缩写。
- 正例：Local-First 存储、Structured Output 校验、Rule-Based 规则约束、Human-in-the-Loop、Prompt 迭代、数据口径对齐。
- 反例：万能助手、智能中枢、全链路生态（生造概念）。

## L3 架构与工程权衡层
- 适用：大厂核心 AI 平台、Agent 架构岗、强技术向 PM。
- 命名规范：点出架构模式（Pattern）或工程边界/权衡（Trade-off），必须能在架构语境里被同行复述。
- 正例：Zero-Backend 端侧架构、Deterministic Guardrails、Index-Free 语义扫描、Human-in-the-Loop 审核。
- 反例：单纯堆技术名词（RAG+Agent+向量库）却没有模式或权衡。

## 通用约束
- 同一段经历的所有 hook 必须处于同一层级、同一命名风格（不能一条英文架构词、下一条口语白话）。
- 术语必须 100% 对应卡片里的真实动作；卡片没写过的东西不得写进 hook。
- 严禁空洞黑话：闭环、赋能、矩阵、抓手、生态、全景、体系、全链路（作为空词时）。

# 三、正文叙事骨架（严格执行 ${p.body_pattern}，完整展开）
## XYZ 成果导向型
- 目的：让读者先看到结果，再看到你怎么做到的。
- 元素：①量化结果或核心交付物；②实现该结果的关键机制/动作；③（可选）约束或口径说明。
- 展开顺序：结果先行 → 机制/动作 → 口径或边界。
- 要素要求：至少 2 个、最多 3 个，不要求四件套。
- 反例：通过优化内容并持续迭代，有效提升了阅读表现。
- 正例：公众号推文均值 3000 阅读；改选题、重做配图并在班级群与朋友圈投放，48 小时阅读量到 1.2 万。

## CAR 痛点破局型
- 目的：让读者看到你识别问题、做权衡、落地解决的能力。
- 元素：①具体卡点/工程约束；②方案权衡（放弃 A 选 B 的依据）；③落地解法；④结果。
- 展开顺序：卡点 → 权衡 → 解法 → 结果。**不要求四个都写**：60 字内写 2~3 个刚刚好（常见组合：卡点+解法+结果，或卡点+权衡+解法）。
- 反例：针对交接不清的问题，通过建立表格实现了流程优化。
- 正例：口头交接常断在"谁改到哪一步"；把入职拆成合同、交付、返还三段，用共享 Excel 记责任人、进度与卡点，交接从 10 分钟压到 3 分钟。

## PAR 流程链路型
- 目的：让读者一眼看清端到端链路与你在其中的位置。
- 元素：①目标场景/输入；②核心处理节点（2~3 个动作）；③交付输出；④效果。
- 展开顺序：场景 → 输入 → 处理节点 → 输出 → 效果；可省略"效果"，写成 3 段链路。
- 反例：负责活动全流程，完成报名、执行和复盘。
- 正例：6 场保研分享会：问卷收名单 → 按场次排嘉宾与场地 → 签到表执行，场均 40 人、累计 240 人次。

# 四、语言风格（反八股）
1. 动词优先：拆解、核对、合并、收敛、替换、复盘、对账、埋点、整理成表、压到…；少用"负责/参与/完成"。
2. 开头轮换：同一段经历内相邻 Bullet 不用同一种开头（动作/结果/工具/约束四选一轮换）。
3. \`针对/面对/为\` 只在真正的卡点句使用，每段经历最多 1 次。
4. 禁止评价性收尾：不得以"体现了…能力 / 展现了… / 验证了… / 确保了… / 保障了…"收尾；结尾落在事实、数字或交付物上。
5. 禁虚词：持续、有效、进一步、从而、不断、积极、认真、较好地、显著、大幅；能用具体量级就不用形容词。
6. 单点聚焦：一条 Bullet 只讲一个抓手，宁可少讲，不堆三个动作。
7. 可追问：每条都应让读者能接着问"怎么做的 / 数据哪来的 / 你负责哪一步"。
8. 字数：content 35~80 字（主区间 50~75，宁短勿长，允许 2~3 个要素；短句只要信息完整即可）；project_background 40~60 字。

# 五、Few-Shot（模仿 good 的写法，不要照抄内容）
- CAR｜bad：针对轮班口头交接进度不清，用 Excel 搭建共享追踪表，将入职等多步骤任务拆解为阶段并记录负责人与状态，实现交接顺畅，体现流程优化能力。
  good：【共享追踪表】口头交接常断在"谁改到哪一步"；把入职拆成合同、交付、返还三段，用共享 Excel 记责任人、进度与卡点，交接从 10 分钟压到 3 分钟。
- XYZ｜bad：通过策划选课攻略选题并完成文案排版，最终提升了公众号阅读量，体现了内容运营能力。
  good：【选课攻略选题】公众号推文均值 3000 阅读；改选题、重做配图并在班级群与朋友圈投放，48 小时阅读量到 1.2 万，是均值的 4 倍。
- PAR｜bad：负责组织保研分享会，完成报名、现场执行等工作，确保了活动效果。
  good：【分享会流程】6 场保研分享会：问卷收名单 → 按场次排嘉宾与场地 → 签到表执行，场均 40 人、累计 240 人次。

# 六、输出（只返回 JSON，不要解释）
每条额外给 focus_angle（≤15 字，只用于自检，不出现在简历正文）。
{
  "exp_id": "经历ID",
  "project_background": "40-60字",
  "bullets": [
    { "card_id": "卡片ID", "focus_angle": "≤15字", "hook": "4-12字符", "content": "35-80字" }
  ]
}`;
```

**归一化提示词**：

```text
const PROMPT_FIT = `# Role
你是简历字数与风格归一化器。严格不新增事实、不删关键数字/工具/结果，保持原 hook 与叙事骨架。

# Rules
1. project_background 目标 40-60 字，必须是完整句子（以。或；结尾），不得截断成病句。
2. 每条 bullet 的 content 目标 50-75 字、可接受 35-80 字（含标点）；>80 必须删到 ≤80；<35 可适度补充。
3. 只围绕 focus_angle 的一个抓手，删修饰、合并从句；允许只保留 2~3 个要素，不得只做同义替换。
4. 若结尾是评价性表述（体现了…能力 / 展现了… / 验证了… / 确保了… / 保障了…），改成事实、数字或交付物收尾。
5. content 中不要重复 hook、不要带【】前缀；不改 hook、不改 card_id。
6. 只返回 JSON：{ "project_background": "...", "bullets": [ { "card_id": "...", "content": "..." } ] }`;
```

---

### ④ 评论：生成「值得补的方向」

**代码**：`comments(runId)`（约 L370）
**输入**：`{ jd, gaps, unselected_cards(最多 20 张 S/A), bullets }`
**输出**：`{ comments: [{ bullet_id, exp_id, question, reason, card_ids }] }`
**校验**：
- 只能锚定本次已生成的 bullet（非法锚点直接丢弃）；
- 最多 4 条；
- 模型调用失败时用 `gaps` 兜底生成 3 条。
**提示词**：

```text
const PROMPT_COMMENTS = `# Role
你是简历策略编辑。基于【JD】【已生成简历内容】【扫描发现的知识缺口】【未被选中的高质量卡片】，在简历对应位置生成"气泡评论"，询问用户是否要补卡。

# Rules
1. 每条评论必须锚定到一条已生成的 bullet（bullet_id），问的是"是否补充某个方向"，而不是评价措辞。
2. 优先针对 JD 核心要求中当前简历没有体现、但该经历本可深挖的方向（gaps）；其次才是未被选中的 S/A 卡。
3. 每条评论带 1 个具体问题（用户可直接回答），并列出可选卡片 id（可为空）。
4. 最多 4 条，宁缺毋滥。

# Output Schema（只返回 JSON）
{ "comments": [ { "bullet_id": "锚定的bullet", "exp_id": "经历ID", "question": "向用户提的问题", "reason": "为什么值得补（对应JD哪条）", "card_ids": ["可选的已有卡片ID"] } ] }`;
```

---

### ⑤ 补卡：回答 → 新卡 → 重编译

**代码**：`gapCard(runId,{comment_id,answer})`（约 L388）
**输入**：该经历 `raw_text` + 缺口问题 + 用户回答
**输出**：
- 回答不足：`{ insufficient: true, question }` → 前端/CLI 显示追问，**不改库**；
- 回答足够：`{ card, run }` → 追加到 `cards.json`（`source=gap`，重新 `grade()`），然后 **只重编译该经历**（保留原有选卡 + 新卡），并把评论标记 `resolved=true / new_card_id`。
**提示词**：

```text
const PROMPT_GAPCARD = `# Role
你是知识卡片补齐引擎。用户对简历中的某个缺口问题给出了回答。请结合【该经历的全部原话】与【用户的补充回答】，生成 1 张新的 6 槽位决策卡片。

# Rules
1. 事实只能来自【原话】或【用户回答】；不得编造。槽位缺失填"未提及"。
2. raw_quote 必须逐字来自【原话】或【用户回答】。
3. 如果原话和回答都不足以形成一张卡（没有具体动作或结果），返回 JSON：{ "insufficient": true, "question": "再追问一个更具体的问题" }。
4. 否则只返回一个 JSON 对象：{ "insufficient": false, "card": { step_order, toc_title, slot_stage, slot_module, slot_problem, slot_workflow, slot_tech_link, slot_outcome, raw_quote, linked_nodes:[{node_name,node_type}] } }。`;
```

---

## 6. run 状态机

```mermaid
stateDiagram-v2
  [*] --> scanned: scan(jd)
  scanned --> composed: compose(selections)
  composed --> commented: comments()
  commented --> gap_resolved: gap(answer 足够)
  gap_resolved --> commented: 该段重编译后仍保留评论
  commented --> commented: 回答不足（insufficient，不落库）
  composed --> composed: 改选卡重新 compose
```

对应 `v2/runs/<run_id>.json` 的字段：

| 状态 | 存在字段 |
| --- | --- |
| scanned | `scan` |
| composed | `selections`, `content` |
| commented | `comments` |
| gap_resolved | `comments[].resolved/new_card_id` + `cards.json` 新卡 |

---

## 7. 入口：CLI / API / 测试

### CLI（推荐，直接看每阶段输出）

```bash
# 建卡（需要 raw + snapshots）
node prototype/cli.mjs import

# 扫描
node prototype/cli.mjs scan --jd-file 回归集/jd-01-市场部实习生.md

# 按扫描推荐自动选卡编译
node prototype/cli.mjs compose --run v2run_xxx

# 评论 / 补卡 / 校验 / 一键跑通
node prototype/cli.mjs comments --run v2run_xxx
node prototype/cli.mjs gap --run v2run_xxx --comment cm_1 --answer "补充口径：..."
node prototype/cli.mjs check --run v2run_xxx
node prototype/cli.mjs pipeline --jd-file 回归集/jd-01-市场部实习生.md
```

- 环境变量：`WORKBENCH_DATA_DIR`（数据目录）、`DEEPSEEK_MOCK=1`（离线、不花钱、确定性输出）；
- `check` 是发布前的最后一道闸：字数、Hook、背景、评价收尾、重复 hook、溯源、focus。

### 精简 API（无前端）

```bash
node prototype/serve.mjs
# GET  /health
# GET  /api/v2/state
# POST /api/v2/import | scan | compose | comments | gap
# GET  /api/v2/graph | run?id=
# 其余路径 404（前端已删除）
```

### 测试

```bash
npm test                 # pipeline-mock + data-deps，离线 8/8
npm run test:live        # 真实模型冒烟（LIVE=1）
```

| 测试 | 验证内容 |
| --- | --- |
| `pipeline-mock.test.mjs` | 扫描结构/引用、编译 1卡1bullet/字数/Hook/溯源/反八股、评论锚点、补卡 resolved、图谱一致性 |
| `data-deps.test.mjs` | 数据目录结构、卡片分级与引用、当前版本 run 的引用一致性（stale run 跳过） |
| `live-e2e.mjs` | 真实模型跑 scan→compose→comments，断言质量闸门 |

---

## 8. 已知边界（下一步要打的点）

1. **扫描没有程序级 schema 校验**：目前只保证 JSON 可解析，字段/覆盖率靠测试与提示词；建议在 `scan()` 里加一层 `assertScan()`。
2. **编译的兜底会丢细节**：`hardTrim` 仍可能裁掉次要动作；需要统计触发率并针对高频卡片改提示词。
3. **补卡只做一轮**：回答不足时只给追问，没有多轮闭环。
4. **评论主题可能重复**：历史累积后会出现相近问题，需要去重。
5. **跨 JD 稳定性**：需要用不同岗位 JD 验证 `hook_level/body_pattern` 是否真按岗位选择，而不是固定输出。
6. **Mock 与真实模型的行为差异**：mock 只验证链路契约，不验证语言质量。

---

## 9. 文件索引

| 文件 | 说明 |
| --- | --- |
| `prototype/v2.mjs` | 核心链路与全部提示词 |
| `prototype/cli.mjs` | 阶段命令入口 |
| `prototype/serve.mjs` | 精简 JSON API |
| `prototype/mock.mjs` | 离线确定性模型替身 |
| `prototype/workbench.mjs` | 经历库/快照/raw 读取（建卡依赖） |
| `prototype/llm.mjs` | 模型连接配置（旧 Wiki 任务保留） |
| `prototype/docs/DATA-CONTRACT.md` | 数据契约 |
| `prototype/docs/MODEL-PIPELINE.md` | 阶段参数速查 |
| `prototype/tests/` | 契约测试 / 数据依赖 / live 冒烟 |
