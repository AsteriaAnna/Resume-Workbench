# COMPLIANCE-REPORT · INPUT-FOLLOW v5 合规检查

> 检查基准：`repo/prototype/docs/INPUT-FOLLOW.md`（v4 定稿，732 行，唯一设计基准）
> 检查对象：`repo/prototype/core/*`、`repo/prototype/v5-cli.mjs`、`repo/prototype/tests/v5-core.test.mjs`、`repo/package.json`
> 快照：分支 `feat/input-follow-v5`，HEAD `75f76bd`（`fix(v5): import norm in extract, add fragment merge regression test`），工作区仅 `prototype/docs/IMPLEMENTATION-NOTES.md` 为他人未提交改动
> 检查方式：逐节对照 + 全量读代码 + `npm test` + mock CLI 端到端 + 真实 API smoke（`prototype/eval/v5-real-smoke.mjs`）+ 定向探针
> 约束：本次检查**未修改任何实现代码/测试**；本文件是唯一新增产物

结论一句话：**主链可运行、核心硬规则大部分落地（未分配=硬错误、AI 不写 Markdown、人工确认、原始话锚点、父子深度、A2 内容校验、P10 target 回填均已实现），但“简历问题引擎”仍缺 2 类设计依据（BLOCKER），问题对象的 A2 确定性校验仍不完整（BLOCKER）；其余为 GAP/设计待拍板项。**

---

## 0. 快照与复现

### 0.1 代码快照（SHA256 前 12 位）

| 文件 | 字节 | SHA256-12 |
| --- | --- | --- |
| `repo/prototype/core/extract.mjs` | 10954 | `C1BA05F33EAC` |
| `repo/prototype/core/generate.mjs` | 12092 | `E23457578F93` |
| `repo/prototype/core/llm.mjs` | 2770 | `6EAEB0A20BEF` |
| `repo/prototype/core/markdown.mjs` | 6963 | `3B578178E395` |
| `repo/prototype/core/mock.mjs` | 6205 | `ABF73600A731` |
| `repo/prototype/core/pipeline.mjs` | 3463 | `FED2320741C7` |
| `repo/prototype/core/prompts.mjs` | 10117 | `8969F914646A` |
| `repo/prototype/core/questions.mjs` | 10544 | `2FAE72AEDEFC` |
| `repo/prototype/core/retrieval.mjs` | 3959 | `AC393F2E9CC9` |
| `repo/prototype/core/store.mjs` | 8294 | `4EF504058800` |
| `repo/prototype/core/types.mjs` | 7582 | `07ADCFF5BF32` |
| `repo/prototype/v5-cli.mjs` | 6701 | `30FA87534E6B` |
| `repo/prototype/tests/v5-core.test.mjs` | 12929 | `0DED731AA26B` |

### 0.2 已执行的验证命令

```powershell
cd repo
npm test                                   # 16 tests / 16 pass / 0 fail，约 0.7s
node prototype/eval/v5-real-smoke.mjs      # 真实 API smoke，run_1e3612eff2f704
```

mock CLI 端到端（3 段经历 → raw → Draft → confirm → Markdown → generate）：

```powershell
cd repo
$d = "<临时数据目录>"
$e1 = (node prototype/v5-cli.mjs create --mock --data $d --type campus --name 经历A | ConvertFrom-Json).experience.experience_id
$e2 = (node prototype/v5-cli.mjs create --mock --data $d --type project --name 经历B | ConvertFrom-Json).experience.experience_id
$e3 = (node prototype/v5-cli.mjs create --mock --data $d --type internship --name 经历C | ConvertFrom-Json).experience.experience_id
node prototype/v5-cli.mjs input --mock --data $d --exp $e1 --text-file r1.txt
node prototype/v5-cli.mjs input --mock --data $d --exp $e2 --text-file r2.txt
node prototype/v5-cli.mjs input --mock --data $d --exp $e3 --text-file r3.txt
node prototype/v5-cli.mjs confirm --mock --data $d --exp $e1
node prototype/v5-cli.mjs confirm --mock --data $d --exp $e2
node prototype/v5-cli.mjs confirm --mock --data $d --exp $e3
node prototype/v5-cli.mjs generate --mock --data $d --jd-file jd.txt
```

实测结果：`ok=true`，3 段经历 / 6 bullets / 0 validation errors / 简历问题 0；数据落盘为 `v5/experiences/<exp>/…`、`v5/questions/experience-<exp>.json`、`v5/runs/<run>.json`、`v5/debug/<timestamp>-<node>.json`。

### 0.3 状态定义

| 标记 | 含义 |
| --- | --- |
| **PASS** | 设计条目已落地且与文档一致（含仅存无害差异） |
| **GAP** | 设计条目未完整落地/实现方式与文档有偏差，但主链仍可运行；需修或回写设计 |
| **BLOCKER** | 违反设计文档中的显式硬规则/必测用例，会产生错误数据、错误结果或关键能力缺失 |
| **待确认** | 设计文档本身未定或本轮由实现方单方面决定，需用户拍板（不是实现 bug） |
| **N/A** | 设计未要求（如 profile/education 不在 INPUT-FOLLOW 字段定义内） |

---

## 1. 结论摘要

| 维度 | PASS | GAP | BLOCKER | N/A |
| --- | --- | --- | --- | --- |
| 角色 R0–R9 / A1–A3（14 行） | 10 | 2 | 2 | 0 |
| 提示词契约 P1–P10（10 行） | 6 | 3 | 0 | 1 |
| 数据与权威（11 行） | 8 | 2 | 0 | 1 |
| Story 准入/父子/未分配（13 行） | 10 | 3 | 0 | 0 |
| 两套问题引擎（16 行） | 9 | 5 | 2 | 0 |
| 生成阶段（10 行） | 9 | 1 | 0 | 0 |
| 调试/测试/验收（8 行） | 3 | 5 | 0 | 0 |
| **合计（82 行）** | **55** | **21** | **4** | **2** |

> 计数按第 2–8 节的编号行统计（同一编号只记一个主状态）。BLOCKER 4 行对应 **2 个独立问题**：Q-08/R-14（A3 简历依据不完整）与 Q-09/R-12（A2 问题校验不完整）。另有 §11 的 9 条“设计待用户拍板”（N-01～N-09）单列，不计入上表。

---

## 2. 角色 R0–R9 / A1–A3（设计 §6）

| ID | 角色/算法 | 结论 | 证据与说明 |
| --- | --- | --- | --- |
| R-01 | **R0 Human** | PASS | CLI 提供创建/输入/确认/手改/回答/忽略/生成/查看：`repo/prototype/v5-cli.mjs:32-123`；`edit` 为人手改 Markdown 入口 `v5-cli.mjs:78-84` + `core/pipeline.mjs:35-46`；终审结果由 `generate`/`show` 输出完整 run `v5-cli.mjs:98-117`。**无导出命令**（§8 步 18 “终审/导出”）→ R-04 GAP。 |
| R-02 | **R1 Extractor** | PASS | `core/extract.mjs:7-50` 只产出 AI Draft 并 `saveDraft`（`extract.mjs:48`），不写 Markdown；硬规则见 §5 D-02/D-03。 |
| R-03 | **R2 Experience Question Planner** | PASS | `core/questions.mjs:126-141` 调用 P2、全部保存、UI 取 3；不补内容、不看 JD（`promptP2` 输入仅 experience+model+candidates，`core/prompts.mjs:62-89`）。 |
| R-04 | **R3 JD Note（可选）** | GAP | 仅有 prompt 定义 `core/prompts.mjs:91-98`，**全仓无调用点**（`grep -n "promptP3(" repo/prototype/core` 无结果）；`run` 中无 `jd_note`（`generate.mjs:197-214`）。违反 §11.3“不存在只写在文档里、没有实现出口的节点”。可选角色，故 GAP 非 BLOCKER。 |
| R-05 | **R4 Experience Evaluator（每经历并行）** | PASS | `core/retrieval.mjs:25-39` Worker 池并发（默认 3），每经历只喂本经历全部 Story（含 `is_container` 标记，`retrieval.mjs:9-14`）；不跨经历、不打分。 |
| R-06 | **R5 Selector/Planner** | PASS（弱） | `core/generate.mjs:39-55` + `promptP5`；输出 3–4 段/每段 bullet 计划。但**不校验** experience_id 是否存在、story_id 是否叶子、jd_quote 是否 JD、段数/条数下限，仅 `slice(0,max)`（`generate.mjs:44-51`）→ 见 G-05。 |
| R-07 | **R6 Composer** | PASS | `core/generate.mjs:72-100` 每段经历单独编译；`evidence_quote` 必须可回溯到 Story（`generate.mjs:86-92`，失败 `COMPOSE_QUOTE`）；不跨 Story 拼造的约束只在 prompt（`prompts.mjs:146`），无机器校验 → G-08。 |
| R-08 | **R7 Critic** | PASS | `core/generate.mjs:113-117` 只返回 issues，不改稿；输入 JD+草稿+coverage（`prompts.mjs:161-172`）。 |
| R-09 | **R8 Revisor（有界）** | PASS（弱） | `core/generate.mjs:174-182`：仅当存在 blocker/warning 时修订一次（`config.revise` 默认 true），记录 `applied_issue_ids/remaining`（`generate.mjs:179`）。**无可配 2 轮**、无 diff/修改说明（§7 P8 硬规则 3/4）→ G-09；修订后仍不通过无显式“交人工”标记（R0 看 run）。 |
| R-10 | **R9 Resume Question Planner** | PASS（弱） | = P10，见 Q-05～Q-07；`questions.mjs:143-166`。 |
| R-11 | **A1 Aggregator** | PASS（弱） | `core/retrieval.mjs:41-79`：枚举 JD 行建覆盖快照（`retrieval.mjs:44-49`），合并 R4 matched/missing、统计 recommendation；**未做“同 story+同 jd_quote 保留最强 support”的逐条去重**（`retrieval.mjs:65` 直接 push）→ G-10；不做加权总分（无）。 |
| R-12 | **A2 Validator** | **BLOCKER（问题对象）** | 内容侧已补：字数/背景 → issues、父 Story 证据、jd_quote∈JD、重复 bullet（`core/generate.mjs:125-161`，实测见 §10.3）。**问题对象侧**仍缺 §10.9/A2.5：experience 问题 `basis_quote` 不校验是否存在于材料（`questions.mjs:82` 只在 `library.length` 时进入，而调用处传 `library: []`，`questions.mjs:135`）；resume 问题的 target 存在性完全不校验（`questions.mjs:82` 仅 `scope==='experience'`）→ 见 Q-09。 |
| R-13 | **A3 Question Candidate Detector** | GAP | 经历侧：`questions.mjs:10-37` 只出 `story_incomplete`/`vague_action`，**无 `contradiction` 检测**（§10.3.1 经历侧第 2 条）→ Q-10。简历侧见 R-14。 |
| R-14 | **A3 简历侧（依据完整性）** | **BLOCKER** | `questions.mjs:39-74` 只从 `evaluations[].matched` 中取**未选中的 direct/adjacent**，basis 恒为 `adjacent_unselected`（`questions.mjs:62-63`）；完全不使用 `coverage`/`jd` 入参，**无法产出 `coverage_missing`**，也**没有 `unrealized_potential` 检测**（“只提了一句 RAG 没展开”）。真实 smoke：coverage 有 8 条 `none`，candidates=0、questions=0（§10.2 明确 3 类依据、§11.2 必测用例 14）→ Q-08。**若产品决定 v5 只做“相邻未选 Story”单一依据，需回写设计 §10.2/§11.2-14，属设计待拍板（见 §11 N-03）；按现行文档判 BLOCKER。** |

---

## 3. 提示词契约 P1–P10（设计 §7）

| ID | 节点 | 结论 | 证据与说明 |
| --- | --- | --- | --- |
| P-01 | **P1 Extractor** | PASS（弱） | 输入 raw+当前 Markdown+经历字段（`core/prompts.mjs:20-60`，`extract.mjs:9-10`）；输出 stories/fragments/unassigned_details/questions（`prompts.mjs:35-53`）；`unassigned_details` 必须为数组且为空（`extract.mjs:13-15`）；`raw_quotes` 逐字校验（`extract.mjs:38-46`）。**`boundary_reason` 未做必填校验、raw_quotes 未限 1–3、title 落库上限 30 而非文档展示 ≤20**（`extract.mjs:25/31`，`types.mjs:75`）→ G-01。 |
| P-02 | **P2 Experience Questioner** | PASS | 输入 Markdown+raw_quotes+candidates（`prompts.mjs:62-89`）；输出绑定 story、单维度、basis_quote；全部输出不设上限。硬规则 1/2/4/5 在 prompt；basis 的机器校验缺失见 Q-09。 |
| P-03 | **P3 JD Note** | GAP | prompt 定义（`prompts.mjs:91-98`）但无调用、无 `jd_note` 落盘（同 R-04）。 |
| P-04 | **P4 Experience Evaluator** | PASS | 输入原始 JD+该经历全部 Story（`retrieval.mjs:9-14`）；输出 recommendation/matched/missing/reason；不打分、不选组合、不跨经历。`jd_quote∈JD`、`story_quote∈Story` 无后置校验（交给 A2 也未做）→ G-04。 |
| P-05 | **P5 Selector/Planner** | PASS（弱） | 输入 R4 结果+A1 coverage+config（`generate.mjs:39-41`，`prompts.mjs:123-142`）；输出 experiences/background/global_order/dropped。叶子 Story、主 JD 引用、3–4 段下限仅 prompt 约束（`prompts.mjs:129-131`），无机器校验 → G-05。 |
| P-06 | **P6 Composer** | PASS（弱） | 单段计划+selected stories+fragments（`prompts.mjs:144-159`）；`evidence_quote` 必填且回溯校验（`generate.mjs:86-92`）。**字数区间实现为 35–80**（`types.mjs:124`），设计 §12 待确认建议 35–55、§7 为“约 40” → N-02/待确认；输出字段名 `project_background` 与文档 `background` 不同（`prompts.mjs:157`）→ G-06。 |
| P-07 | **P7 Critic** | PASS | issues schema 与设计一致（`prompts.mjs:161-172`）；只出 issues。 |
| P-08 | **P8 Revisor** | GAP | 输出 `content+applied_issue_ids+remaining`（`generate.mjs:119-123`），但**只修订 1 轮**（`generate.mjs:174`）、**无 diff/修改说明落盘**、`applied_issue_ids` 未校验是否对应真实 issue（真实 smoke 中 LLM 回传 0 个 id，`revision.applied=true`）。§7 P8 规则 3/4 未完全落地 → G-09。 |
| P-09 | **P9** | N/A | 设计明确“P9 已合并进 P10，编号保留空缺”（§7 编号说明），实现无 P9，正确。 |
| P-10 | **P10 Resume Question Planner** | GAP | 输出与 §7 P10 基本一致；`target/jd_quote/basis_quote/missing` 从 A3 候选回填（`questions.mjs:152-161`，单测+探针 PASS）。**输入缺 Critic issues**（`promptP10` 只传 jd/resume/library/coverage/candidates，`prompts.mjs:205`），与 §7 P10 输入清单不符；未按“覆盖影响排序”（prompt/实现均无）；target 按 `candidates[i] || candidates[0]` 下标对齐，问题数≠候选数时可能错配 → G-07。 |

---

## 4. 数据与权威（设计 §2、§3）

| ID | 检查点 | 结论 | 证据与说明 |
| --- | --- | --- | --- |
| D-01 | **raw 只追加、不可变** | PASS | `core/store.mjs:75-82` 只新增 `raw_<id>.json`；无 update/delete raw 的 API；字段 `{raw_id, experience_id, text, at}` 与 §8 一致。 |
| D-02 | **AI 不直接写 Markdown** | PASS | 全仓 `writeMarkdown` 仅两处调用：人工确认 `core/extract.mjs:209`、人工手改 `core/pipeline.mjs:38`；P1/P4~P10 均不写 Markdown。`grep -n "writeMarkdown" repo/prototype/core` 可复现。 |
| D-03 | **AI Draft 必须人工确认后才进 Markdown** | PASS | `confirmDraft` 需 `readDraft` 且 `assert(draft)`（`extract.mjs:196-197`）；`pipeline.confirmExperienceStories` 是唯一入库入口（`pipeline.mjs:18-33`）；CLI `confirm` 为显式命令（`v5-cli.mjs:60-71`）。 |
| D-04 | **AI Draft 仅内存/临时文件，未确认丢弃** | PASS（弱） | Draft 落 `v5/experiences/<exp>/draft.json`（`store.mjs:101-106`），属临时文件；但**无“丢弃 Draft”命令**，旧 Draft 会被下一次抽取覆盖 → G-11。 |
| D-05 | **Markdown 是正文权威** | PASS | 生成阶段一律 `store.loadLibrary()` 从 Markdown 解析（`store.mjs:128-141`），不读 Draft 作为正文。 |
| D-06 | **人直接手改 Markdown = 直接生效，AI 不覆盖** | PASS（本轮已修复） | `pipeline.editExperienceMarkdown` 直接解析+写回（`pipeline.mjs:35-46`）；再次抽取+确认时用 `mergeWithCurrent` 保留已有 Story 只追加新 Story（`extract.mjs:171-193`，`extract.mjs:204-205`）；专项测试 `tests/v5-core.test.mjs:149-162` 与本报告探针均验证手改标题保留、新 Story 追加。 |
| D-07 | **不保存逐行 revision/provenance** | PASS | Markdown 内只有 front matter+Story 元信息，无行级 revision；`experience.json` 的 `evidence_rev` 是问题失效用的版本号（§10.6），不是正文 provenance。 |
| D-08 | **AI Draft raw_quotes 逐字来自 raw（防幻觉锚点）** | PASS | `extract.mjs:38-46` 对每条 quote 做去空白/引号归一后要求 `rawN.includes(qn)`，否则 `RAW_QUOTE_NOT_FOUND`（探针实测拦截）。 |
| D-09 | **存储布局与文档一致** | GAP | 文档：`raw/raw_<id>.json`、`questions/<experience_id>.json`、`debug/<run_id>/<node>.json`。实现：raw 在 `v5/experiences/<id>/raw/`（`store.mjs:40`）；问题在 `v5/questions/experience-<id>.json`/`resume-<runId>.json`（`store.mjs:142-145`）；debug 为 `v5/debug/<timestamp>-<node>.json` 扁平文件（`store.mjs:188-193`）。功能等价但布局/命名不一致 → G-12（含 §8 落盘约定）。 |
| D-10 | **run 落盘字段** | GAP | `v5/runs/<run_id>.json` 已含 jd/evaluations/coverage/plan/content/issues/revision/validation/questions/candidates（`generate.mjs:197-214`）。文档要求 `jd_raw, jd_note?, evidence, coverage, plan, draft, issues, revisions, questions`：实现用 `jd`/`content`/单数 `revision`，且无 `jd_note`（P3 未接）→ G-13。 |
| D-11 | **profile / education** | N/A | INPUT-FOLLOW §3 只定义 `type/name/role/time/exp_id`，无 profile/education 字段；旧系统字段不在本设计范围，不作为缺陷。 |

---

## 5. Story 定义、准入、父子、未分配（设计 §4、§5）

| ID | 检查点 | 结论 | 证据与说明 |
| --- | --- | --- | --- |
| S-01 | **Story 定义与准入（子目标+本人动作+闭环结果+自包含+原话）** | PASS（语义靠 prompt/人工） | P1 prompt 完整写入 5 条准入（`prompts.mjs:26-33`）；机器只做结构校验（title/raw_quotes/slots/parent，`types.mjs:71-87`）；文档 §4.3 明确“机器只负责结构与引用，语义自包含由人确认”。 |
| S-02 | **人工确认 Story 列表（不逐句审）** | PASS（弱） | `input` 返回 Story 列表（temp_id/title/raw_quotes/flags，`v5-cli.mjs:51-58`），`confirm` 才是入库；支持 decisions 删除/合并/拆分/编辑（`extract.mjs:52-125`）。但 **CLI 预览不含 parent_temp_id/层级**，`confirm` 输出也不展示 Story 列表，只有数量+Markdown（`v5-cli.mjs:66-70`）→ G-14。 |
| S-03 | **质量提示 flags 不存 S/A/B、机器不用来选经历** | PASS（弱） | P1 输出 `flags` 四类（`prompts.mjs:48`、`extract.mjs:32`），随 Story 保存并在 input 预览展示；无 `quality_grade`/`capabilities` 字段（`types.mjs:3-11`、`store.mjs:47-50`）。P4 的 `storyBrief` 仍把 `flags` 传给评估器（`markdown.mjs:167-180`、`retrieval.mjs:13`），§4.4“机器选择经历时不看这些标记”只是弱约束 → G-15。 |
| S-04 | **六槽位为描述字段、缺就“未提及”、不作为准入** | PASS | 六槽位常量（`types.mjs:9-11`）；Markdown 逐行解析/序列化（`markdown.mjs:4-19, 96-108, 143-146`）；缺失不拦截入库，进入问题机制。 |
| S-05 | **父子层级：最大深度 2** | PASS | `validateMarkdownModel` 禁止父节点再有父（`types.mjs:100-105`），`buildModelFromDraft` 会把“父的父”提升为顶层（`extract.mjs:129-133`）；专项测试 `tests/v5-core.test.mjs:25-47`。 |
| S-06 | **父节点不生成 bullet、只做背景/总述；证据必须来自叶子** | PASS（本轮已补 A2） | P4 prompt（`prompts.mjs:108`）；Composer 只喂叶子（`generate.mjs:75-76`）；A2 现在对“父 Story 作为 bullet 证据”出 blocker issue（`generate.mjs:138`，探针实测）。 |
| S-07 | **子 raw_quotes 必须落在父覆盖的 raw 范围；同一 evidence quote 只挂一个叶子** | GAP | 实现无父区间/引语唯一性校验（`grep -n "parent" core/extract.mjs` 仅结构处理）。文档 §4.5 关系规则 3/4 未落地 → G-16。 |
| S-08 | **层级由 AI 建议、由人确认；不确认按平铺** | GAP | AI 的 `parent_temp_id` 在无 decisions 时被直接采用并写成 `### Story:`（`extract.mjs:129-148`、`markdown.mjs:150-151`）；**没有确认/拒绝层级的操作**，`decisions.patches` 不支持改 `parent_temp_id`（`extract.mjs:117-125`），CLI 预览也看不到层级（S-02）→ G-17。 |
| S-09 | **父节点 summary 必填、子节点可空（§4.5 字段表）** | GAP | `validateStory` 不检查父节点 `summary`；Markdown 虽支持 `- 摘要：`（`markdown.mjs:17, 98-99, 140`），但非父必填校验 → G-18。 |
| S-10 | **Markdown 语法（§5）** | PASS | front matter/`## 背景`/`## Story`/`### Story` 子节点/`- 阶段…原话`/`## 素材片段` 全部解析+序列化；用 §5 文档示例实测 parse→serialize 往返一致（含 `###` 与 Fragment）。 |
| S-11 | **顺序/order、无时间不推断、标题不带序号** | PASS | `order` 解析+重排（`extract.mjs:134-142`、`markdown.mjs:136-152`）；时间选填（`types.mjs:58-59`）；序列化标题不带序号。 |
| S-12 | **未分配 raw 信息 = 硬错误，阻断入库，不变成提问** | PASS | `extract.mjs:14-15`：`unassigned_details` 必须是数组且长度为 0，非空抛 `UNASSIGNED_INPUT`，且在 `saveDraft` 之前（`extract.mjs:15` vs `47-48`）；专项测试 `tests/v5-core.test.mjs:80-95` 断言不落 Draft；P2 prompt 明确“raw 有信息没进 Story 是流水线错误，应报错”（`prompts.mjs:72`）。 |
| S-13 | **Story 数量不设固定目标、按事件边界自然切** | PASS | P1 prompt 明确“不设固定卡片数量目标”（`prompts.mjs:30`）；无密度常量。 |

---

## 6. 两套问题引擎（设计 §10）

### 6.1 经历问题（Experience Question）

| ID | 检查点 | 结论 | 证据与说明 |
| --- | --- | --- | --- |
| Q-01 | **依据类型**：story_incomplete / contradiction / vague_action | GAP | `questions.mjs:10-37` 实现 `story_incomplete`（缺 outcome/metric/workflow/problem/ownership/scope）与 `vague_action`（workflow<18 字）；**无 contradiction 检测**（§10.3.1 经历侧第 2 条）→ G-19。 |
| Q-02 | **前置条件：只基于已有内容、单维度、绑定 story、回答能改变 bullet** | PASS（prompt 为主） | `promptP2` 明确“依据只能是 Story 槽位/正文/raw_quotes”“一次只问一个缺失维度”（`prompts.mjs:68-73`）；`candidates` 为空时 prompt 要求不问（`prompts.mjs:74`）。机器侧“单维度”未强制（missing 可多项）→ G-20。 |
| Q-03 | **全部输出、不设上限；UI 每次 3 条可循环** | PASS | 全部保存 `questions.mjs:136-139`；`uiSlots` 过滤 candidate/asked 后 `slice(0,3)`（`questions.mjs:8`）；测试断言 all=4/ui=3（`tests/v5-core.test.mjs:97-112`）。**无“循环/分页”参数**，只有前 3 → G-21。 |
| Q-04 | **状态与 evidence_rev**：candidate/asked/answered/dismissed/expired + evidence_rev | PASS（弱） | 对象含 status/evidence_rev（`questions.mjs:115-117`）；`confirm`/`edit` 会把旧的 candidate/asked 置 expired（`pipeline.mjs:22-27, 40-44`）；`answer` 置 answered 并记录 `evidence_rev`（`questions.mjs:186-190`）。**回答后同经历其他问题不失效**（探针：答完后兄弟问题仍 candidate、evidence_rev 仍为 1）→ G-22；`listQuestions` 也不按 evidence_rev 惰性失效。 |
| Q-05 | **去重（question_id 哈希）** | PASS | `qid` = scope+basis_type+target+missing+basis_quote 哈希（`questions.mjs:7`）；批次内 + 与已存去重（`questions.mjs:119-120, 134, 162`）。注意 `question_id` 在 P10 target 回填**之前**计算（`questions.mjs:103` vs `153-161`），target 不同但其他字段相同的候选会撞 id → G-23。 |
| Q-06 | **存储与展示**：questions/<exp>.json、不写 Markdown、经历页 inline | PASS（弱） | `v5/questions/experience-<exp>.json`（`store.mjs:142-145`）；不写 Markdown；CLI `questions --exp` 输出 inline 列表（`v5-cli.mjs:72-77`）。路径命名与 §10.6 不一致（D-09）→ G-12。 |
| Q-07 | **回答回流**：新 raw → P1 → 人确认 → 重算 coverage/bullet → 旧问题状态 | GAP | `answerQuestion` 做了：appendRaw → extractDraft → bumpEvidence → answered（`questions.mjs:173-192`）；**没有**：重算/重规划问题、生成 backlog、旧依据问题 expired、`needs_manual` 兜底、最多一次 follow-up 限制（§10.7 步 4/5/6）→ G-24。 |

### 6.2 简历问题（Resume Question）

| ID | 检查点 | 结论 | 证据与说明 |
| --- | --- | --- | --- |
| Q-08 | **依据类型**：coverage_missing / adjacent_unselected / unrealized_potential | **BLOCKER** | `questions.mjs:39-74` 只产出 `adjacent_unselected`；`coverage`/`jd` 入参未使用；无 `coverage_missing`（A1 覆盖 none × 库中相关 Story）与 `unrealized_potential`（有潜力但未生成 bullet）检测。真实 smoke `run_1e3612eff2f704`：coverage `none=8`、`candidates=0`、`questions=0`。固定测试仅断言“none 不进候选”（`tests/v5-core.test.mjs:137-147`），未覆盖另两类依据。 |
| Q-09 | **依据/目标必须存在（A2 问题校验）** | **BLOCKER** | `validateQuestion`：experience 问题的 `basis_quote` 在 `library: []` 调用下不做任何存在性校验（`questions.mjs:82`, `135`）；resume 问题的 target 因条件 `scope === 'experience'` 永不校验（`questions.mjs:82`）。探针：伪造 basis_quote 的 experience 问题、target 指向不存在经历的 resume 问题均通过校验。违反 §10.2 硬规则“没有 basis 就没有问题”与 §10.9 A2 扩展。 |
| Q-10 | **前置条件（候选存在、动作+结果/交付、未使用、回答后能生成可靠 bullet、答案可落 Story 字段）** | GAP | `questions.mjs:52-54` 只要求“有动作/原话”，**不要求结果/交付**；`answers 能落字段` 未校验；`hasAction` 用 `raw_quotes` 兜底过宽 → G-25。 |
| Q-11 | **全部输出、不设上限；UI 3 条** | PASS | 同 Q-03；`planResumeQuestions` 保存全部有效问题（`questions.mjs:164`），`ui` 3 条。 |
| Q-12 | **不改写已选 bullet / 只问新增；不设 must 门禁** | PASS（prompt 为主） | `promptP10` 明确（`prompts.mjs:189-194`）；无 must 过滤逻辑。机器无“新增语义”校验 → 归入 Q-09。 |
| Q-13 | **输入完整（JD+简历+全库+覆盖+R4 matched/missing+A3 候选+Critic issues）** | GAP | `promptP10` 只传 jd/resume/library/coverage/candidates（`prompts.mjs:205`），**缺 Critic issues**（§7 P10 输入清单）→ G-07。 |
| Q-14 | **去重/排序（target+basis_type+basis_quote，按覆盖影响）** | GAP | 去重靠 question_id 哈希（PASS 部分）；无“按覆盖影响排序”，无 target+basis_type+basis_quote 三元组去重（`questions.mjs:164`）→ G-26。 |
| Q-15 | **P10 target 回填** | PASS | `questions.mjs:152-161` 用候选回填 target/jd_quote/basis_quote/missing；单测 `tests/v5-core.test.mjs:114-135` 与探针（resume 问题 → answer 成功、raw 增加）均通过。下标对齐风险见 G-07。 |

### 6.3 两套问题分界

| ID | 检查点 | 结论 | 证据/说明 |
| --- | --- | --- | --- |
| Q-16 | **两套问题不混用（scope/purpose/action/输入分开）** | PASS | scope=experience/resume、purpose=complete_story/add_content、action=enrich_story/add_bullet/add_story（`questions.mjs:129-133, 148-151`）；输入方式 P2 只看 Markdown、P10 看 JD+简历+全库（`prompts.mjs:62-89, 183-206`）；共用 Question 对象与存储。 |

---

## 7. 生成阶段（设计 §8、§9）

| ID | 检查点 | 结论 | 证据与说明 |
| --- | --- | --- | --- |
| G-01 | **R4 每经历并行评估** | PASS | `retrieval.evaluateAll` Worker 池（`core/retrieval.mjs:25-39`）；每次只喂本经历全部 Story（`retrieval.mjs:9-14`）。 |
| G-02 | **A1 汇总（合并/去重/覆盖统计，不打分）** | PASS（弱） | `aggregateCoverage`（`retrieval.mjs:41-79`）：JD 行枚举 + matched/missing 合并 + support 取最强 + recommendation_counts；无加权总分；逐 story 去重缺失 → G-10。 |
| G-03 | **R5 决定 3–4 段、每段约 4 条、顺序/背景** | PASS（弱） | `planResume`（`generate.mjs:39-55`）+ `validateContent`（`types.mjs:133-146`）会对 3–4 段/背景 40–60/≤4 条出 issues；但仅“报告不阻断”，实际 bullet 下限不是 3–4、Mock 仅 2 条/段，真实 smoke 3/4/3 → N-01/待确认。 |
| G-04 | **A2 全量校验（schema/引用/字数/顺序/重复/问题）** | PASS（内容侧；问题侧见 Q-09/BLOCKER-2） | 内容侧：`validateContent`→issues（`generate.mjs:127`）、story 存在、evidence_quote 回溯、父 Story、jd_quote、重复 bullet、括号（`generate.mjs:131-158`）；问题侧见 Q-09。**issues.type 仍用 `bullet`/`syntax`，不在 Critic 枚举内**（设计 §7 P7 枚举 = coverage/duplication/ordering/evidence/length/style/overclaim/background；实现 `generate.mjs:134,156`）→ G-27。 |
| G-05 | **R6 Story→bullet（约 40 字、一核心、不编数字、带 evidence_quote）** | PASS（弱） | `composeExperience`（`generate.mjs:72-100`）+ `validateBullet`（`types.mjs:120-131`）：evidence_quote 必填+回溯，数字不在 Story 中→warning（`generate.mjs:143-146`），评价性收尾/重复 hook 校验。字数 35–80 与设计“约 40/35–55”冲突 → N-02。 |
| G-06 | **R7 Critic 整份评审（只 issues）** | PASS | `critique`（`generate.mjs:113-117`）；真实 smoke 产出 24 条 issues（coverage/evidence/duplication/ordering/style/overclaim/background/syntax 等），R8 收到 blocker/warning 子集（`generate.mjs:176`）。 |
| G-07 | **R8 有界修订、修不掉交人工** | PASS（弱） | 最多 1 轮（`generate.mjs:174-182`）；`remaining` 记录在 run.revision；真实 smoke 修订后仍存在 issues/validation errors，但无“交人工”显式状态。可配 2 轮/ diff 缺失 → G-09。 |
| G-08 | **人工终审（§8 步 18）** | PASS（弱） | `generate` 返回完整 run 供 R0 审查（`v5-cli.mjs:98-112`），`show --run` 可复查（`v5-cli.mjs:113-117`）；无导出/批准状态机 → G-28。 |
| G-09 | **验证失败的处理（不静默放宽）** | GAP | `validateGenerated` 的 `errors` 已映射为 `length` blocker issues（`generate.mjs:127`）并在修订前喂给 R8（`generate.mjs:171-176`）；但真实 smoke 修订后仍有 2 条 `content 31 字` validation errors（`run_1e3612eff2f704`），说明 R8 无法保证清除，且生成仍返回成功 → 需要“未通过=阻断/人工确认”策略（设计未细化）→ G-29。 |
| G-10 | **数字/标点/重复校验** | PASS | 数字不在 Story → warning（`generate.mjs:143-146`）；括号不闭合 → warning（`generate.mjs:152-157`）；重复 bullet → `duplication` warning（`generate.mjs:149-151`）。 |

---

## 8. 调试、测试与验收（设计 §11）

| ID | 检查点 | 结论 | 证据与说明 |
| --- | --- | --- | --- |
| T-01 | **节点留痕 debug/<run_id>/<node>.json（node_id,prompt_id,prompt_version,model,input,output,validation,tokens,elapsed_ms,at）** | GAP | 仅 P1/P2/P10/generate 四处 `store.debug`（`extract.mjs:12`、`questions.mjs:130,147`、`generate.mjs:186`）；P4/P5/P6/P7/P8/A1/A2/A3 无留痕；文件为 `v5/debug/<timestamp>-<node>.json` 扁平结构（`store.mjs:188-193`），字段只有 `node/at/output(+少量上下文)`，**无 input/model/validation/tokens/elapsed_ms**，`prompt_version` 实际写入的是 tag（如 `P1-extract`）。§11.1 未落地 → G-30（Lead 已列为设计待确认 N-05）。 |
| T-02 | **每个 prompt 有版本/schema/校验** | GAP | 有全局 `PROMPT_VERSION='v5.0'`（`prompts.mjs:1`）与各节点 schema 文案；但无节点级 schema 自动校验（P4/P5/P7/P8 输出仅粗检），无 prompt 版本写入每条 debug 记录 → G-31。 |
| T-03 | **§11.2 必测用例（14 条）** | GAP | 当前 `tests/v5-core.test.mjs` 8 个 v5 测试（+8 个旧 v2 测试，共 16）：覆盖 #1/#2（新建 type+name、项目无 time）、#3（手改保护，L149）、#6（未分配，L80）、#12（P10 回填，L114）、#7 部分（A2 父证据无测试）、#14 部分（仅“无相关 Story 不提问”，L137）。**未覆盖**：#4（0→1/1→100 父子全链路）、#5（参与≠主导）、#7（父证据，仅有实现无测试）、#8（use/hold/drop 与选择一致）、#9（quote 不在原文→Validator）、#10（Critic blocker→Revisor→人工）、#11（经历问题 basis 来自 Story/raw）、#13（回答后旧问题 expired/不重复问）。详见 §10.2。 |
| T-04 | **§11.3 验收：角色都有输入/输出/落盘/失败分支** | GAP | R0–R9/A1–A3 主链可跑；但 R3/P3 无调用出口（R-04），A2 问题校验不完整（R-12），debug 不完整（T-01）→ 未完全满足。 |
| T-05 | **§11.3：每个字段有明确写入者/读取者** | PASS（弱） | experience/story/raw/run/question 字段基本有明确路径；`summary/ownership/scope` 已进 Markdown（`markdown.mjs:140-142`），但 `is_container` 只在 P4 临时推导不入库（`retrieval.mjs:13`）→ 可接受（§4.5 说“由程序推导”）。 |
| T-06 | **§11.3：不存在只写文档没有实现出口的节点** | GAP | P3/R3 只有 prompt（`prompts.mjs:91-98`，无调用）→ 与 T-04 同源。 |
| T-07 | **`npm test` 全绿、CLI 端到端可跑** | PASS | HEAD `75f76bd`：16/16 pass；mock CLI 3 经历→生成 `ok=true`；真实 API smoke 成功完成（3 经历/10 bullets/24 issues/0 问题）。 |
| T-08 | **Node 20+/零依赖/数据隔离** | PASS | 无 `dependencies`；`package.json` 有 `v5` 脚本并将 `prototype/tests/v5-core.test.mjs` 纳入 `npm test`；数据根 `WORKBENCH_DATA_DIR/v5`（`store.mjs:19-27`），真实数据不提交（`.gitignore` 覆盖 `prototype/local-data/`、eval runtime）。 |

---

## 9. BLOCKER 清单（按设计基准判定）

### BLOCKER-1（Q-08）：A3 简历问题依据只实现 1/3，真实 JD 覆盖缺口不提问

- **设计依据**：§10.2 简历问题 basis 三类（`coverage_missing` / `adjacent_unselected` / `unrealized_potential`）；§10.3.1 简历侧步骤 1–4；§11.2 必测用例 14（“`unrealized_potential` 能识别‘只提了一句 RAG’并生成新增问题”）。
- **实现事实**：`repo/prototype/core/questions.mjs:39-74`
  - 只遍历 `evaluations[].matched`，`coverage`/`jd` 入参未使用（`questions.mjs:39`）；
  - `support` 只接受 direct/adjacent（`questions.mjs:49-50`），basis 恒为 `adjacent_unselected`（`questions.mjs:62-63`）；
  - 无 `unrealized_potential` 候选（全仓仅类型枚举/prompt/mock 出现，`grep -n "unrealized_potential" repo/prototype/core` 无检测逻辑）。
- **真实后果**：`v5-real-smoke` 最终 run `run_1e3612eff2f704`：coverage `adjacent=7, none=8, direct=2`，`candidates=0`、`questions=0`。也就是说这份真实 JD 的 8 条 `none` 覆盖没有产生任何简历问题。
- **复现**：
  ```powershell
  cd repo
  node --input-type=module -e "import {detectResumeCandidates} from './prototype/core/questions.mjs'; const library=[{experience_id:'exp_x',stories:[{story_id:'s1',slots:{workflow:'做了访谈',outcome:'输出报告'},raw_quotes:['我做了访谈']}]}]; console.log(detectResumeCandidates({jd:'JD要求RAG落地',library,coverage:{requirements:[{jd_quote:'JD要求RAG落地',support:'none',stories:[]}]},evaluations:[{experience_id:'exp_x',matched:[],missing:[{jd_quote:'JD要求RAG落地',reason:'无证据'}]}],selectedStoryIds:new Set()}).length)"
  # 输出 0；coverage_missing 依据不会生成候选
  ```
- **设计待拍板**：若产品决定 v5 暂只做“未选 direct/adjacent Story”，需回写 §10.2/§10.3.1/§11.2-14（见 §11 N-03）。**按现行设计文档判 BLOCKER。**

### BLOCKER-2（Q-09）：A2 问题对象校验不完整——无依据/无 target 的问题可以入库

- **设计依据**：§10.2 硬规则“没有 basis 就没有问题”，§10.9 “A2 扩展 schema：basis 必须存在于当前材料，target 必须存在，单维度，不重复”，§7 A2 第 5 条“问题对象也必须过一遍 schema/basis/target 校验”。
- **实现事实**：`repo/prototype/core/questions.mjs:76-95`
  - experience 问题的 basis 校验被 `library.length` 短路（`:82`），而调用处固定传 `library: []`（`:135`）→ 完全不校验 `basis_quote` 是否在 Story/raw 中；
  - resume 问题也走同一函数，但存在性校验只对 `scope === 'experience'` 生效（`:82`）→ resume 的 target 存在性永不校验；
  - 单维度未校验（`missing` 可多项，`:80`）。
- **实测**（探针，均未抛错）：
  - `validateQuestion({scope:'experience', basis_type:'story_incomplete', target:{experience_id:'exp_a', story_id:'story_c'}, basis_quote:'完全不存在的依据', missing:['metric'], question:'口径？'}, {library:[], existing:[]})` → 通过；
  - `validateQuestion({scope:'resume', basis_type:'coverage_missing', target:{experience_id:'exp_does_not_exist', story_id:'story_nope'}, basis_quote:'x', missing:['workflow'], question:'能否补充？'}, {library: 非空, existing:[]})` → 通过。
- **后果**：P2/P10 的 LLM 纯文本问题可在无真实依据/无真实 target 时进入 Question Store 并展示，违反“没有 basis 就没有问题”。当前靠 prompt 约束，**无确定性闸门**。

---

## 10. GAP 清单（按主题，含复现/证据）

> 编号对应 §2–§8 表中的 G-xx；按严重度排序。

### 10.1 高（建议下一轮修）

| 编号 | 问题 | 证据/复现 |
| --- | --- | --- |
| **G-07** | P10 输入缺 Critic issues；target 按候选下标回填（问题数≠候选数会错配）；无“按覆盖影响排序” | `prompts.mjs:205` 只传 5 个键；`questions.mjs:152-161` |
| **G-16** | §4.5 关系规则 3/4 未实现：子 raw_quotes 未校验落在父 raw 覆盖范围；同一 evidence quote 可挂多个叶子 | `core/extract.mjs` 无相关校验；`core/types.mjs:71-113` |
| **G-17** | 父子层级只由 AI 建议后直接采用，无人工确认/拒绝入口；CLI confirm 不展示层级 | `extract.mjs:129-148, 117-125`；`v5-cli.mjs:60-70` |
| **G-22** | 回答后同经历其他问题不 expired；`evidence_rev` 变化不触发失效（只在 confirm/edit 时批量过期） | `questions.mjs:173-192`；探针：答完后兄弟问题仍 candidate、evidence_rev 仍 1 |
| **G-24** | 回答回流缺“重算/重规划、新缺口 backlog、`needs_manual`、最多一次 follow-up” | §10.7 步 4/5/6；`questions.mjs:173-192` |
| **G-27** | A2 issues.type 用 `bullet`/`syntax`，不在 Critic 枚举（`coverage|duplication|ordering|evidence|length|style|overclaim|background`） | `generate.mjs:134,156`；`types.mjs` 文档枚举见 §7 P7 |
| **G-30** | §11.1 逐节点 debug 未落地（覆盖 P1/P2/P10/generate，缺 P4/P5/P6/P7/P8/A1/A2/A3；扁平文件；缺 input/model/validation/tokens/elapsed_ms） | `store.mjs:188-193`；`grep -n "store.debug" repo/prototype/core` |
| **G-31** | 每个 prompt 无节点级 schema 校验/版本记录；debug 的 `prompt_version` 写入 tag | `extract.mjs:12`；`prompts.mjs:1` |

### 10.2 中（影响契约完整性/可追溯性）

| 编号 | 问题 | 证据 |
| --- | --- | --- |
| **G-01** | P1 未校验 `boundary_reason` 必填；`raw_quotes` 未限 1–3；title 落库 ≤30（文档展示 ≤20） | `extract.mjs:25,31`；`types.mjs:75` |
| **G-04** | R4/A1 未校验 `jd_quote∈JD`、`story_quote∈Story`（A2 只校验最终 bullet） | `retrieval.mjs:6-23, 41-79` |
| **G-05** | P5 计划未校验 experience 存在、story 是叶子、jd_quote∈JD、3–4 段下限 | `generate.mjs:44-51` |
| **G-06** | P6 输出字段名 `project_background` 与文档 `background` 不一致；字数口径见 N-02 | `prompts.mjs:157`；`types.mjs:124` |
| **G-09** | P8 只 1 轮、无 diff/修改说明、`applied_issue_ids` 未校验 | `generate.mjs:119-123, 174-182` |
| **G-10** | A1 未按“同 story+同 jd_quote 保留最强 support”逐条去重 | `retrieval.mjs:65` |
| **G-12** | 存储布局与 §8/§10.6 不一致（raw/questions/debug 路径与文件名） | `store.mjs:40, 142-145, 188-193` |
| **G-13** | run 字段名与 §8 不一致（`jd`/`content`/`revision`，无 `jd_note`） | `generate.mjs:197-214` |
| **G-19** | A3 经历侧无 `contradiction` 检测 | `questions.mjs:10-37` |
| **G-20** | 单维度未强制（missing 可多项） | `questions.mjs:76-95` |
| **G-21** | UI 3 槽无循环/分页参数（只 slice 前 3） | `questions.mjs:8` |
| **G-25** | A3 简历前置条件未要求“结果/交付”，`raw_quotes` 兜底过宽；未校验“答案能落 Story 字段” | `questions.mjs:52-54` |
| **G-28** | §8 步 18 只有“查看 run”，无导出/终审状态 | `v5-cli.mjs:98-117` |
| **G-29** | 生成成功不保证 validation 通过（真实 smoke 修订后仍有 2 条 31 字 content error） | run_1e3612eff2f704 |
| **G-14** | Story 列表确认预览缺层级/一句话核心事实（§4.3 行格式），confirm 不展示列表 | `v5-cli.mjs:51-58, 66-70` |
| **G-15** | `flags` 被传给 R4（§4.4“机器选择经历时不看这些标记”） | `retrieval.mjs:13`；`markdown.mjs:167-180` |
| **G-18** | 父 Story `summary` 必填未校验 | `types.mjs:71-87` |
| **G-23** | question_id 在 P10 target 回填前计算，存在撞 id 风险 | `questions.mjs:103, 153-161` |
| **G-26** | 简历问题无 target+basis_type+basis_quote 三元组去重、无按覆盖影响排序 | `questions.mjs:164` |

### 10.3 低（无害差异/可回写）

| 编号 | 问题 | 证据 |
| --- | --- | --- |
| **G-11** | 无“丢弃 AI Draft”命令，旧 Draft 被下一次抽取覆盖 | `store.mjs:101-106` |
| **G-02** | R1 角色“未分配=失败”已落地，但 `draft.questions`（P1 输出的“需用户确认点”）被保存后无人消费 | `extract.mjs:35`；全仓无读取 |
| **G-03** | `bounds_reason` 未进 Markdown（文档 §4.5 字段含 boundary_reason，但 §5 语法未列，属设计待回写） | `extract.mjs:31`；`markdown.mjs` 无 boundary 行 |
| **G-08** | R6“不跨 Story 拼造”仅 prompt 约束 | `prompts.mjs:146` |

### 10.4 本轮已修复（保留记录，复核通过）

| 项 | 原 BLOCKER | 修复证据 | 复核 |
| --- | --- | --- | --- |
| 手改 Markdown 被再次确认覆盖 | 违反 §2.3/§11.2-3 | `extract.mjs:171-215` `mergeWithCurrent` + `confirmDraft`；测试 `tests/v5-core.test.mjs:149-162` | PASS：手改标题保留、新 Story 追加（探针 `hand-edit-survives-reconfirm=true`） |
| `mergeWithCurrent` 使用未导入的 `norm`（带 Fragment 的二次确认崩溃） | 运行时数据丢失/崩溃 | `extract.mjs:1` 补 `norm` 导入；测试 `tests/v5-core.test.mjs:164-…`（16/16 通过） | PASS：合并含 Fragment 时不再抛 `ReferenceError`（探针 `merge-with-fragments => {stories:1,fragments:2}`） |
| A2 未校验父 Story 证据/jd_quote/重复 bullet/字数→issues | §7 A2.2/2.3/2.4、§11.2-7 | `generate.mjs:125-161` | PASS（内容侧）：探针可同时报 `evidence:父 Story 不能作为 bullet 证据` / `evidence:jd_quote 不在 JD 原文中` / `duplication`；残留问题见 G-27 |

---

## 11. 设计待用户拍板项（不是实现 bug）

| 编号 | 事项 | 设计/实现现状 | 建议 |
| --- | --- | --- | --- |
| N-01 | **`library<3` 直接硬失败** | 设计 §0.2 说“一份简历 3–4 段经历”，但未要求 <3 必须失败；实现 `generate.mjs:166` 抛 `LIBRARY_TOO_SMALL`（真实只建 1 段经历时无法生成） | 拍板：3 段是硬约束还是软目标；2 段时是否降级生成并提示 |
| N-02 | **bullet 字数 35–80** | 设计 §7 P6“约 40 字”、§12 待确认“建议 35–55”；实现校验 35–80（`types.mjs:124`），真实 smoke 出现 31 字 validation error 且无法自动修复 | 拍板区间；建议回写 §12 或改实现为 35–55 |
| N-03 | **简历问题依据范围** | 设计 §10.2 三类；实现仅 `adjacent_unselected`（BLOCKER-1）。Lead 当前选择“无相关 Story 不提问”以避免假候选 | 拍板：是否本轮缩减为单一依据并回写 §10.2/§11.2-14；若要三类，需补 `unrealized_potential`（选中但未展开）与 `coverage_missing`（A1 覆盖 none × 库中相关 Story） |
| N-04 | **父/子层级人工确认方式** | 设计 §4.5.6“AI 建议、人确认；不确认按平铺”；实现直接采用 AI 建议（G-17），CLI 无层级预览/确认 | 拍板：默认平铺（需提供“拒绝父级”操作）还是默认采用 AI 建议并回写 |
| N-05 | **逐节点 debug（§11.1）** | 设计要求每节点 input/output/tokens/elapsed；实现仅 4 个节点且扁平文件（G-30） | 拍板：是否本轮按最小版（node_id/prompt_version/input/output/validation）补齐，tokens/elapsed 后置 |
| N-06 | **存储布局** | 设计 §8/§10.6 的目录/文件名 vs 实现 `v5/experiences/<id>/raw/`、`questions/experience-<id>.json`、扁平 debug（G-12） | 建议回写设计为实现的 v5 布局（或实现改名），二选一 |
| N-07 | **父节点 summary 存储** | 设计 §4.5 要求 summary 字段且父必填；§5 Markdown 语法未给 summary 行。实现已加 `- 摘要：`（`markdown.mjs:140`），但父必填未校验（G-18） | 回写 §5 语法（增加 摘要/归属/范围 行）并确认父必填 |
| N-08 | **P1 输入 raw 范围** | 设计 P1 输入“raw”，未定义是“本次新增 raw”还是“全量 raw”。实现传本次 raw + current_markdown（`extract.mjs:9-10`），因此 raw_quotes 只校验本次 raw；历史 Story 的 quote 不在合并校验内 | 回写 P1 输入语义；确认合并策略 |
| N-09 | **run 字段命名** | 设计 `jd_raw/evidence/draft/revisions`；实现 `jd/evaluations/content/revision`（G-13） | 回写 §8 或实现改名 |

---

## 12. §11.2 必测用例覆盖表（14 条）

| # | 设计用例 | 测试 | 结论 |
| --- | --- | --- | --- |
| 1 | 新建经历只填 type+name | `tests/v5-core.test.mjs:56` | PASS |
| 2 | 项目无时间 | 同上（第二段 `time: ''`，project） | PASS |
| 3 | 用户手改 Story 后再抽取（不覆盖手改） | `tests/v5-core.test.mjs:149-162` | PASS（本轮已补） |
| 4 | 完整流程含 0→1 与 1→100（拆成多张叶子/父子） | 仅父/子序列化校验（`:25-47`） | GAP（无抽取→确认→生成的父子端到端） |
| 5 | raw 写“参与”不得改“主导” | 无 | GAP（仅 P1 prompt 约束；无测试/机器校验） |
| 6 | `unassigned_details` 非空阻断 | `:80-95` | PASS |
| 7 | 父 Story 不作为 bullet 证据 | 仅有实现（`generate.mjs:138`），无测试 | GAP（实现已补，缺测试） |
| 8 | 同经历多 story 的 use/hold/drop 与最终选择一致 | 无 | GAP |
| 9 | quote 不在原文 → Validator 拦截 | 无测试（实现有 `RAW_QUOTE_NOT_FOUND`/`evidence_quote` 回溯） | GAP（缺测试） |
| 10 | Critic blocker → Revisor → 仍不行交人工 | 无测试（真实 smoke 触发了 1 轮修订，但无断言） | GAP |
| 11 | 经历问题 basis 来自 Story/raw | 仅 mock 固定文案（无伪造 basis 的反例测试） | GAP（且校验本身缺失，见 Q-09） |
| 12 | 简历问题只能新增 Story/bullet，不能要求改写已选 bullet | `:114-135` 只覆盖 target 回填/3 槽 | GAP（“不得改写”仅 prompt 约束） |
| 13 | 回答后旧问题 resolved/expired，同一依据不重复问 | `:73-77` 只断言 answered + raw 增加 | GAP（兄弟问题未 expired，见 G-22） |
| 14 | `unrealized_potential` 能识别“只提了一句 RAG”；无候选 Story 时不得提问 | `:137-147` 只覆盖“无相关 Story 不提问” | GAP（无 `unrealized_potential` 实现/测试，BLOCKER-1） |

覆盖率：**完全 PASS 3/14**（#1/#2/#3）、**部分 3/14**（#4/#12/#13/#14 中的局部断言）、**其余 GAP**。

---

## 13. §11.3 验收对照

| 验收项 | 结论 | 说明 |
| --- | --- | --- |
| R0–R9/A1–A3 都有输入/输出/落盘/失败分支 | GAP | R3/P3 无调用出口（R-04）；A2 问题校验不完整（R-12）；逐节点 debug 不完整（T-01） |
| 每个字段有明确写入者/读取者 | PASS（弱） | 见 T-05；`is_container` 仅 P4 临时推导、不入库（文档说“由程序推导”，可接受） |
| 每个 prompt 有版本/schema/校验 | GAP | 有 `PROMPT_VERSION` 与 schema 文案，但无节点级输出 schema 校验、无版本写入 debug（T-02/G-31） |
| 不存在“只写文档没有实现出口”的节点 | GAP | P3/R3 违反（T-06） |

---

## 14. 建议修复顺序（供 Lead/用户）

1. **BLOCKER-1**：补 A3 简历侧 `coverage_missing` 与 `unrealized_potential`（或按 N-03 回写设计并明确本轮范围）。真实 smoke 在 8 条 none 覆盖下 0 问题，是最影响产品价值的一项。
2. **BLOCKER-2**：补 A2 问题校验：experience 的 `basis_quote` 必须命中该 Story 的 Markdown/raw；resume 的 target experience/story 必须存在；`missing` 单维度。
3. **高 GAP**：P10 输入补 Critic issues（G-07）；回答回流补齐 expired/backlog/needs_manual（G-22/G-24）；§4.5 父区间/引语唯一（G-16）与层级确认（G-17）；A2 issues 枚举统一（G-27）；逐节点 debug（G-30）。
4. **中 GAP**：P5/P4 的 quote 归属校验（G-04/G-05）、P8 两轮/diff（G-09）、存储/run 命名回写（G-12/G-13）、A3 前置条件（G-25）、测试补齐 §11.2 的 #4/#5/#7/#8/#9/#10/#11/#13/#14。
5. **待确认项**：N-01～N-09 建议一次性拍板并回写 INPUT-FOLLOW，避免实现与文档继续漂移。

---

## 15. 声明

- 本次检查只读代码与测试，**未修改任何实现/测试文件**；唯一新增文件为本报告 `repo/prototype/docs/COMPLIANCE-REPORT.md`。
- 真实 smoke 使用 `.local-ai.json` 的已配置模型；结果仅用于观察端到端行为，不评价模型质量。
- 文中行号以 HEAD `75f76bd` 快照为准；若后续提交修改，请以文件内容复核行号。
- `npm test` 结果：**16 tests / 16 pass / 0 fail**（含旧 v2 测试 8 条）。
