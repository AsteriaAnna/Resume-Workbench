# INPUT-FOLLOW v5 实现观察笔记（设计监督）

> 角色：独立设计监督（task-5）。唯一设计基准：`repo/prototype/docs/INPUT-FOLLOW.md`（v4 定稿）。
> 只记录：设计自身缺陷/不可实现/与真实数据冲突、Lead 的临时处理方案及其可逆性与回写需求。
> 不记录代码风格与合规清单（合规检查见 `COMPLIANCE-REPORT.md`，由 compliance-checker 负责）。
> 分支：`feat/input-follow-v5`。日期均为本地时区 Asia/Shanghai。

## 观察状态

| 时间 | 状态 |
| --- | --- |
| 2026-11-24 23:38 | 开始监督。repo 干净，`prototype/core/` 不存在；设计文档 `INPUT-FOLLOW.md` 已读（732 行）。 |
| 2026-11-24 23:43 | Lead 已落盘 `core/{types,llm,store,markdown,prompts,mock,extract,questions,retrieval,generate,pipeline}.mjs`、`v5-cli.mjs`；`tests/v5-core.test.mjs` 尚未出现；`package.json` 未改。此时 `questions.mjs` 从 `markdown.mjs` 导入不存在的 `leavesOf`（实际导出名 `getLeaves`，`leavesOf` 在 `types.mjs`），CLI 全命令 Node 启动即报错（属开发中，待复核）。 |
| 2026-11-24 23:50 | 复核：`node --test` 全绿（12/12，含 v5-core 4 项）；`v5-real-smoke.mjs` 新增但不可运行（见 N-031）。Lead 已修：模块导入、`raw.text` 传参、`unassigned_details` 落 draft、appendRaw 门槛、子层级 `###`、summary/ownership/scope 落 Markdown、uiSlots 状态过滤、A2 前置并合并 R8、P8 applied/remaining、手动改 Markdown 触发问题 expire、0-Story 经历允许 Fragment。仍未闭合的关键项见「五、23:50 复核」。 |

真实数据基准：`prototype/eval/runtime/raw/*.json`（7 段经历真实语料，2026-11-22 抓取）与 `eval/README.md`。

---

## 一、设计缺陷 / 不可实现 / 与真实数据冲突

### N-001 A1 覆盖统计丢弃 R4 的 missing，「整条 JD 要求零覆盖」不会成为问题候选

- **日期**：2026-11-24
- **问题**：覆盖只从 `matched` 建行；R4 的 `missing` 被丢弃；没有任何匹配的 JD 要求不产生 coverage 行。
- **设计原文**：§7 A1「合并 R4 的 matched/missing」「统计每条 JD 引用的覆盖（direct/adjacent/none）」；§10.3.1「建 JD 覆盖快照：每条 JD 引用的 support = direct/adjacent/none」。
- **实际做法**：`core/retrieval.mjs:39-57` `aggregateCoverage` 只遍历 `evaluations[].matched` 生成 `requirements`；`missing` 只计数。`core/generate.mjs:146` + `core/questions.mjs:36-67` `detectResumeCandidates` 只遍历 `coverage.requirements`，因此「JD 有要求、全库零覆盖」这种最关键的缺口问不出来（除非 P4 自己在 `matched` 里给 `support:"none"`）。
- **影响**：`coverage_missing` 依据基本失效，简历问题引擎最大一类问题被吞掉。
- **临时或永久**：永久偏离（未回写设计）。建议按设计修：A1 用 P4.missing 建 `support:"none"` 行。
- **待用户确认**：否（属实现缺陷），但需 Lead 决定修法。

### N-002 Markdown 解析不支持设计 §5 的 `### Story:` 子层级，会静默丢子 Story

- **日期**：2026-11-24
- **问题**：按设计文档 §5 的示例写 Markdown（父 `## Story:`、子 `### Story:`）时，解析器把 `###` 子 Story 整段当成父 Story 的 body，子 Story 的槽位与原话会覆盖父 Story 的槽位/原话；不报错。
- **设计原文**：§5 示例 `### Story: 设计三层社群` + `<!-- story_id: story_2; parent: story_1; order: 1 -->`；§4.5「最大深度 2：父 → 子」；§2 规则 3「人直接手改 Markdown = 直接生效」。
- **实际做法**：`core/markdown.mjs:13` `STORY_HEAD = /^##\s+Story:\s*(.+?)\s*$/` 只认 `##`；`core/markdown.mjs:130-140` 序列化时所有 Story（含子）一律写 `##`，层级只保留在 meta 注释。实测（2026-11-24 23:41）用设计 §5 样例行：`stories` 只剩父 + 第三个顶层，story_2 消失，父的 `slots.stage` 被子的「执行」覆盖、`raw_quotes` 被子的原话覆盖，全程无异常。
- **影响**：用户按唯一设计文档手写/手改父子 Markdown 会被静默改写（丢数据 + 父节点被污染），直接违反「Markdown 是唯一正文事实源」。
- **临时或永久**：需二选一，当前状态若保留 = 永久偏离。
- **待用户确认**：是。选项：(a) 解析/序列化支持 `###` 表示子层级；(b) 明确 Markdown 只允许平铺、删改设计 §5 的 `###` 示例并回写文档。无论哪种，都不应静默吞掉 `### Story:`。

### N-003 回答经历问题的短答案无法入库（raw 最少 10 字）

- **日期**：2026-11-24
- **问题**：问题引擎要求用户一句话补全（口径/人数/周期），但 raw 写入硬性要求 ≥10 字。
- **设计原文**：§10.7「回答 → 新 `raw`」；§7 P2 `expected_answer.format: "一句话"`；§10.4「回答一次就更新」。
- **实际做法**：`core/store.mjs:75-82` `appendRaw` 断言 `text.trim().length >= 10`；`core/questions.mjs:144-166` `answerQuestion` 直接调用 `appendRaw`。
- **影响**：「注册数÷进群数」「约 200 份」「口径=注册/进群」这类完全有效的短答被拒，用户只能凑字；问题闭环在真实短答场景不可用。
- **临时或永久**：实现限制（设计未规定最小字数），建议永久降低门槛或允许结构化短答。
- **待用户确认**：是（是否需要最小长度；建议 ≥2 字或不限）。

### N-004 `ownership` / `scope` 维度在 Story 字段中不存在，但 P2 / A3 / mock 都在提问

- **日期**：2026-11-24
- **问题**：问题引擎要问「谁主导（ownership）」「范围多大（scope）」，但 Story 六槽位没有对应字段，答案无处可落。
- **设计原文**：§7 P2 输出 `missing: ["result","metric","ownership","scope"]`；§7 A3「对每张 Story 检查槽位：缺 `result/metric/ownership/scope` → 候选」；§4.5 Story 字段 `slots` 只有 `stage/module/problem/workflow/tech_link/outcome`；§10.3.1 前置条件「答案能落到 Story 字段」。
- **实际做法**：`core/types.mjs:9-11` SLOT_KEYS 六项无 ownership/scope；`core/questions.mjs:9-34` `detectExperienceCandidates` 只查 result/metric/workflow/problem，静默丢掉 ownership/scope；`core/mock.mjs:41-55` P2 mock 仍会返回 `missing:["ownership"]`、`["scope"]`（`core/questions.mjs:69-88` `validateQuestion` 只查非空，照常入库）。
- **影响**：用户回答「我主导/覆盖全校」后 P1 无字段可归 → 进 Fragment 或触发 `unassigned_details` 硬错误；且同类问题会因字段永远缺失而反复生成，形成「问不完」的循环。这是设计文档内部矛盾，不是单纯实现问题。
- **临时或永久**：设计需补。若确认不需要 ownership/scope，应把 P2/A3 维度改为六槽可映射项并回写 §7/§10。
- **待用户确认**：是（重要设计决策）。

### N-005 `summary` 在 Markdown 语法中没有位置，确认后丢失

- **日期**：2026-11-24
- **问题**：AI Draft 的 `summary`（尤其父 Story 必填的总述）在确认写入 Markdown 时被丢弃，之后 parse 回来是空串。
- **设计原文**：§4.5 字段含 `summary`，「父节点必填；子节点可空」；§2 Markdown 是正文权威、AI Draft 未确认丢弃；§5 Markdown 示例没有 summary 行。
- **实际做法**：`core/extract.mjs:19-31` Draft 保留 summary；`core/extract.mjs:136-145` `buildModelFromDraft` 把它放进 model；但 `core/markdown.mjs:114-146` `serializeMarkdown` 不写 summary，`core/markdown.mjs:78` parse 默认 `summary:''`。`confirmDraft`（`core/extract.mjs:157-174`）写盘即丢。
- **影响**：父子结构的「父节点总述」信息永久丢失；R4/P5 从 Markdown 读到的父 Story 没有 summary，与 §4.5 不符；Draft 一旦丢弃无法恢复（设计明确 Draft 可丢弃）。
- **临时或永久**：需决策：Markdown 增加 `- 摘要：` 行；或把 summary 写进 body 由「父 Story 正文只写总述」承担；或明确 summary 只存在 Draft 层（则 §4.5 需回写）。
- **待用户确认**：是。

### N-006 P1 被强制要求至少产出 1 个 Story，「挂名/无本人动作」的经历无法入库

- **日期**：2026-11-24
- **问题**：只含背景/否定信息（没有可准入 Story）的经历会被 P1 判失败，raw 存不进去。
- **设计原文**：§4.2 不满足 3/4 → Fragment；§4.6「所有 raw 信息必须被 Story/Fragment 覆盖」；P1 输出 schema 允许 stories 为空、fragments 非空；未分配才失败。
- **实际做法**：`core/extract.mjs:33` `assert(draft.stories.length > 0, 'DRAFT_EMPTY')`。
- **影响**：真实语料 `eval/runtime/raw_827bf049….json`「担任过 Trae 校园大使，目前只是挂名，未开展活动；Second.Me 校园大使具体实践尚未提供」这类如实录入会被判失败，用户只能删经历或编内容，与「高保真优先、宁可问用户不编造」冲突。
- **临时或永久**：待决策（允许 0 Story 经历并提示「暂无可写内容」；或 UI 明确不允许为这类内容建经历）。
- **待用户确认**：是。

### N-007 真实 raw 普遍夹杂「元叙述/缺口声明」，与「未分配=硬错误」冲突

- **日期**：2026-11-24
- **问题**：真实口述里有大量不是事件事实的内容：自评、重复说明、材料缺失声明、后续计划。设计只允许归入 Story/Fragment，否则判为抽取失败。
- **设计原文**：§4.6 / P1 硬规则 8「所有 raw 信息都必须归入 Story/Fragment；`unassigned_details` 必须为空。非空即失败，不得静默丢弃，也不得转成用户问题」；§4.1 Fragment =「不满足准入的细节/背景」。
- **真实数据证据**：`raw_05b0…`「这段经历与扣子项目有重复之处，早期效果也不算理想；项目目前仍在进行，后续进展可以继续补充」；`raw_59bc…`「现有材料尚未说明具体活动和工作过程，先按已知范围记录」；`raw_827b…`「具体活动和承担的工作尚未提供」。
- **实际做法**：`core/extract.mjs:13` 严格断言 `unassigned_details` 为空即抛 `UNASSIGNED_INPUT`；P1 提示词（`core/prompts.mjs:33,48-49`）要求归入 Story/Fragment。这类元信息要么被塞进 Fragment（污染「细节/背景」语义），要么返回 unassigned → 整段经历无法入库。
- **影响**：正常用户口述频繁触发硬错误；或被迫把「尚未提供/挂名」当成事件细节写进素材片段，后续问题引擎会把它们当依据。
- **临时或永久**：设计缺「非事件性原话」通道（如 `meta_notes/uncertainties`：不算未分配、不进 Story、不生成 bullet）。建议补设计。
- **待用户确认**：是。

### N-008 真实数据：补充 raw 指代不明且被挂到错误经历，设计已移除归属校验

- **日期**：2026-11-24
- **问题**：回答/补充 raw 常带指代（「那篇推文」「这个活动」），且真实语料中存在挂错经历的情况；v5 的 raw 写入只校验长度。
- **真实数据证据**：`raw_925b…` 与 `raw_dbdcaa…` 内容完全相同，均为「补充：那篇推文发布后48小时阅读量从3000涨到1.2万，主要来自班级群和朋友圈。」却挂在 `exp_d50a`（扣子校园推广）；该经历 raw 全文没有任何「推文」内容（推文/公众号相关在「学业发展中心」经历的 raw 里）。
- **设计原文**：§2 raw 是事实来源；§10.7 回答 → 新 raw；§4.2 准入 4「自包含」；§0 前提 1「不做自动判断新经历」；`INPUT-AUDIT.md:28-41` 记录旧 `workbench.updateWiki` 有 `check_extension`「与当前经历无关则拒绝」，v5 未继承。
- **实际做法**：`core/store.mjs:75-82` 只校验 10–30000 字；`core/extract.mjs:7-13` P1 输入仅本经历 raw + 当前 Markdown。
- **影响**：补充信息挂错经历 → P1 无法自包含，只能进 Fragment 或 `unassigned_details` 硬失败；设计把归属完全交给用户，真实数据证明会出错。
- **临时或永久**：待决策（加轻量归属校验，或 P1 显式输出「疑似不属于本经历」）。
- **待用户确认**：是。

### N-009 真实数据：raw 的 `experience_id` 可为 null / 存在「一 raw 多身份」，与 v5 一经历一 raw 模型冲突

- **日期**：2026-11-24
- **问题**：真实数据里 raw 是「用户一次输入」为单位，不是「一段经历」为单位：有个人资料 raw（`experience_id: null`），也有一条 raw 混合多个校园身份。
- **真实数据证据**：`raw_89ad…json` `experience_id: null`（姓名/学校/专业/GPA/课程等 profile 类信息）；`raw_827b…json` 一条 raw 同时含黑客松、志愿者、Trae 校园大使、Second.Me 校园大使四个身份，属于同一 `exp_87e94b1c84884de3`。
- **设计原文**：§3 F1 经历字段只有 `type/name/role/time`，无教育背景/profile；§4.6/P1 假设「该经历的 raw」；§8 落盘 `raw/raw_<id>.json` 带 `experience_id`。
- **实际做法**：`core/store.mjs:75-82` `appendRaw` 必须传 `expId`（`store.readExperience` 校验存在），不存在「无经历 raw」；v5 无 profile/education 存储；简历生成节点（P5/P6）只产经历 bullets + 背景，无教育背景模块。
- **影响**：真实用户的教育/GPA 信息、以及「一次口述多个身份」的输入无落点；若未来要导入真实语料做评测/演进，必须先做数据拆分或给 v5 补 profile 层。设计未覆盖「简历教育背景」是否属于本流程。
- **临时或永久**：v5 从 0 且数据隔离（`<data>/v5/`），暂无迁移需求；但设计应说明「education/profile 不在本轮范围」或补字段。
- **真实数据实测补充（2026-11-24 23:46，run_f499e9886a26d2）**：P7 Critic 明确报「JD 基本要求『本科及以上在读』在 coverage 中 support 为 none，简历正文未体现学历/在读状态」——生成链路没有教育背景模块，这条要求永远无法被满足；同时该 JD 的「公司类型/地点/时长」等元信息也被当作覆盖要求（联动 N-030）。
- **待用户确认**：是（教育背景是否纳入 INPUT-FOLLOW 范围）。

### N-010 `quoteMatch` 宽松：部分分句命中即通过，「逐字原话」校验名不副实

- **日期**：2026-11-24
- **问题**：锚点校验 `pass` 的真实语义是「quote 的任一分句在原文出现」，而不是「quote 逐字在原文中」。
- **设计原文**：§2 规则 5「`raw_quotes` 必须逐字来自 raw」；§7 P1 硬规则 7「1–3 句逐字」；§7 A2「`jd_quote ∈ JD`；`story_quote/evidence_quote ∈ Story 原文或 raw」；§11.2 用例 9「quote 不在原文 → Validator 拦截」。
- **实际做法**：`core/types.mjs:40-48` `quoteMatch`：整体包含则 pass；否则按 `。！？；;.!?\n` 切句，任一 ≥4 字分句命中即 `pass:true`；`core/extract.mjs:57-62`（compose）、`core/generate.mjs:106-108`（A2）、`core/questions.mjs:82` 都用 `.pass`。
- **影响**：把原文两句拼接、或改写一半的 quote 只要含一个原文分句就通过，「防幻觉锚点」被削弱；§11.2 用例 9 对部分伪造 quote 不成立。
- **临时或永久**：可能是为容错标点/空白；若保留应把 A2 语义回写设计（或：raw 锚点要求 full match，evidence 允许 partial）。
- **待用户确认**：是（校验严格度）。

### N-011 bullet 字数区间 35–80 与设计「约 40（待确认 35–55）」冲突

- **日期**：2026-11-24
- **问题**：实现把旧 v2 的 35–80 口径直接搬进 v5 校验，而设计倾向更短。
- **设计原文**：§7 P6「content 约 40 字」；§12 待确认 4「bullet 字数：约 40，区间建议 35–55」；§11.2 无 35–80。
- **实际做法**：`core/types.mjs:120-131` `validateBullet` 35–80、hook 4–12；`core/prompts.mjs:148` P6「约 40 字（35–80）」。
- **影响**：56–80 字长句会被判通过，密度与「约 40」不符；「待确认项」被实现单方面定成旧口径。
- **临时或永久**：永久窗口若不改；待用户拍板 35–55。
- **待用户确认**：是（§12.4）。

### N-012 强制 3 段经历 / 每段 ≥3 条 bullet，与「宁可少写、不足就少写」张力

- **日期**：2026-11-24
- **问题**：可用经历不足 3 段时生成直接失败；P5 提示词给出「每段 3–4 条」下限暗示。
- **设计原文**：§0 前提 3「高保真优先：宁可少写」；§7 P5 硬规则 5「不足就少写，不硬凑 4 条」；§8 步 11「3–4 段」。
- **实际做法**：`core/types.mjs:133-147` `validateContent` 经历数 <3 记 error；`core/generate.mjs:129` `generateResume` 断言 `library.length >= 3` 否则抛 `LIBRARY_TOO_SMALL`；`core/prompts.mjs:126` P5「选 3–4 段；每段子弹数 3–4 条」。
- **影响**：只有 2 段可用经历的用户永远无法出稿（高保真场景常见：学生只有 2 段能写）；某段只撑得起 1–2 条时 prompt 会诱导硬凑。
- **临时或永久**：待决策（3 段是硬约束还是软目标；2 段时是否降级生成）。
- **待用户确认**：是。

### N-013 `unassigned_details` 字段缺失时被静默放行

- **日期**：2026-11-24
- **问题**：P1 契约要求输出 `unassigned_details`（必须为空），但模型漏掉该字段时实现按「空」处理，不会发现漏项。
- **设计原文**：§7 P1 输出 schema 含 `unassigned_details`；硬规则 8「非空即失败」——隐含字段必须存在才能证明「已检查」。
- **实际做法**：`core/extract.mjs:13` `assert(!json.unassigned_details || json.unassigned_details.length === 0)`；缺字段 = falsy = 通过。
- **影响**：模型少输出字段即可绕过「未分配信息」硬校验，防丢信息承诺失效。
- **临时或永久**：实现缺陷；建议要求字段存在且为空数组，否则判失败/重试。
- **待用户确认**：否。

### N-014 P2 / A3 的「raw 有信息没进 Story = 流水线错误」在实现里没有出口

- **日期**：2026-11-24
- **问题**：设计要求「未分配 = 流水线错误，必须阻断并修复」，但阻断只发生在 P1 抽取的 `unassigned_details`；「Markdown 确认阶段丢了 Draft 里的 Story/Fragment」没有校验。
- **设计原文**：§4.6「非空 = 抽取失败，阻断入库、要求重抽或人工归位」；§10.2 硬规则「`unassigned_details` 非空是流水线错误」；§11.2 用例 6。
- **实际做法**：`core/extract.mjs:62-174` `buildModelFromDraft` 允许 `deleted`、`merged`、`patched`；`fragments` 被静默保留/丢弃；确认前 Draft 的 stories 若被人工删除，没有「删除的 Story 覆盖过哪些 raw」检查；`fragments` 在 Markdown 里只存 body，`reason` 丢失（`core/markdown.mjs:141-145`）。
- **影响**：用户删卡后，原本被该卡覆盖的 raw 信息可能变成「既不在 Markdown 也不在 Fragment」的静默丢失，正好是设计最想防的情况；Fragment 的 reason（为什么不是 Story）确认后丢失。
- **临时或永久**：待决策（确认时校验 Draft→Markdown 的 raw 覆盖变化；fragment reason 是否落 Markdown）。
- **待用户确认**：是（是否需要在人工确认环节做覆盖差校验）。

### N-015 真实数据：重复 raw 会被重复抽取；设计明确不做重复检测

- **日期**：2026-11-24
- **问题**：同一补充被提交两次（两个 raw 文件）时，P1 会对同一内容重复产 Story。
- **真实数据证据**：`raw_925b…` 与 `raw_dbdcaa…` 内容逐字相同（同一经历 `exp_d50a`）。
- **设计原文**：§0 前提 1「不做重复检测」；§4.2 `flags` 含 `possible_duplicate`；§4.6 一遍抽取（每次输入一遍）。
- **实际做法**：`core/store.mjs:75-82` 追加即存；`core/extract.mjs:7-40` 每次 input 跑 P1 并覆盖 `draft.json`（`core/store.mjs:101-105`）。
- **影响**：重复 Story 需人工合并（设计接受）；但更隐蔽的问题是：同一经历多次 `input`、未确认前再次输入会**静默覆盖上一份 Draft**，设计未定义此行为，属信息可逆性风险。
- **临时或永久**：待确认（Draft 覆盖策略、是否提示/保留历史）。
- **待用户确认**：是（Draft 多次未确认时的覆盖策略）。

### N-016 P1 实际收到的是 raw 对象而非 raw 文本；回答重抽只喂最新一条 raw

- **日期**：2026-11-24
- **问题**：P1 的 `raw_text` 输入是 JSON 对象（含 raw_id/at 等），不是纯文本；`answer` 场景只传本次新增 raw，不是经历全部 raw。
- **设计原文**：§7 P1 输入「raw + 当前 Markdown + 经历字段」；§4.6「不返回原文重新看：raw 本来就在库里」。
- **实际做法**：`core/extract.mjs:10` 把整个 `raw` 对象传给 `promptP1`；`core/prompts.mjs:52-56` `raw_text: raw` 直接序列化；`core/questions.mjs:154-163` `answerQuestion` 只把最新 append 的 raw 交给 `extractDraft`。副作用：mock P1（`core/mock.mjs:18`）`sentences(input.raw_text)` 对对象取 `"[object Object]"`，mock 抽取完全没读真实文本。
- **影响**：真实调用大概率仍可读（对象里有 text），但契约与设计不符；mock 端到端测试无法验证抽取质量；回答重抽时依赖 current_markdown 兜指代。
- **临时或永久**：待决策（P1 输入改为拼接文本 + 明确「单条/全量 raw」；同步修 mock）。
- **待用户确认**：是（P1 的 raw 范围：单条还是全量）。

---

## 二、Lead 的临时处理方案（可逆性 / 是否需回写设计）

### N-020 存储布局改为「按经历分目录」，与 §8 落盘路径不同

- **日期**：2026-11-24
- **问题**：v5 数据布局由设计文档的扁平 `raw/`、`runs/`、`debug/`、`questions/` 改为按经历分目录。
- **设计原文**：§8 落盘 `raw/raw_<id>.json`、`runs/<run_id>.json`、`debug/<run_id>/<node>.json`；§10.6 `questions/<experience_id>.json` 与 `runs/<run_id>.json` 的 `questions`。
- **实际做法**：`core/store.mjs:19-27` 根目录 `<data>/v5/`；经历在 `experiences/<expId>/{experience.json,raw/*.json,draft.json,content.md}`；问题在 `questions/experience-<id>.json`、`questions/resume-<runId>.json`；run 另存 `runs/<runId>.json` 且 `run.questions` 再存一份。
- **影响**：旧 `DATA-CONTRACT.md`/`INPUT-FOLLOW.md §8` 的路径均不再成立；工具/评测脚本按文档路径会找错；`resume` 问题同时存在 questions 文件与 run.questions 两处，存在双写不一致风险。分目录本身合理（一经历一目录）。
- **临时或永久**：若保留 = 永久变更，应回写设计 §8/§10.6；否则改回文档路径。
- **待用户确认**：是（目录布局是否按实现回写设计）。

### N-021 节点留痕（`debug/`）未接线，run 无 token/耗时

- **日期**：2026-11-24
- **问题**：设计要求的每节点输入/输出/prompt 版本/token/耗时留痕没有落地。
- **设计原文**：§11.1 `debug/<run_id>/<node>.json`「{ node_id, prompt_id, prompt_version, model, input, output, validation, tokens, elapsed_ms, at }」；§8 落盘 `debug/`；§11.3 验收「每个 prompt 有版本/schema/校验」。
- **实际做法**：`core/store.mjs:188-193` 定义了 `debug()` 但全仓无调用；`core/llm.mjs:17` `stats` 只累计 calls/input_chars/output_chars/by_tag，不写入 run；run（`core/generate.mjs:153-168`）只有 `prompt_version/model/created_at` 与节点结果，无逐节点 tokens/elapsed。
- **影响**：无法定位哪个节点失败/成本多少，也不能做 prompt 版本对比；验收 §11.1 不满足。
- **临时或永久**：未实现；建议接线（至少 R4/P5/P6/P7/P8/P10 + P1）。
- **待用户确认**：否（建议实现）。

### N-022 A2 校验被放在 R8 修订之后，且 A2 issues 不进入 Revisor

- **日期**：2026-11-24
- **问题**：设计时序是 A2 校验 → R7 → R8（有界修订，只修 blocker/warning）；实现是 R7 → R8 → 最后才 A2，且 A2 结果不参与修订。
- **设计原文**：§8 步 13 A2、14 R7、15 R8；§7 A2「输出 issues（与 Critic 同 schema），不改稿」；R8 输入「草稿 + Critic issues（blocker/warning）」。
- **实际做法**：`core/generate.mjs:134-144`：`critique()`（R7）→ 有 blocker/warning 就 `revise()`（只喂 R7 issues）→ 再 `validateGenerated()`（A2）；A2 结果只塞进 `run.validation`（`errors` 是字符串数组、`issues` 与 Critic schema 不同）。
- **影响**：A2 抓到的结构/引用/字数错误留在最终稿，Revisor 看不到；两套 issue schema 不统一，违反「A2 与 Critic 同 schema」。
- **临时或永久**：实现偏离；建议 A2 前置、统一 issue schema、与 R7 issues 合并后再决定是否 R8。
- **待用户确认**：否（建议修）。

### N-023 P8 输出契约未落实：`applied_issue_ids` / `remaining` 丢弃

- **日期**：2026-11-24
- **问题**：修订结果只留布尔值，无法审计哪些 issue 修了/没修。
- **设计原文**：§7 P8 输出「修订稿 + `{applied_issue_ids, remaining}`」；§8 落盘 `revisions`。
- **实际做法**：`core/generate.mjs:89-93` `revise()` 只返回 `json.content`；`core/generate.mjs:136-143` 记录 `revision={applied:true}` 或 `{applied:false,error}`；run 无 `revisions` 字段（改叫 `revision`）。
- **影响**：修订不可审计；`remaining`（修不掉的 issue 交人工）信息丢失，与 §8/§11.1 不一致。
- **临时或永久**：实现缺陷；建议保存 `applied_issue_ids/remaining/revisions[]`。
- **待用户确认**：否。

### N-024 P4 只收到叶子 Story，父 Story 背景未提供

- **日期**：2026-11-24
- **问题**：设计明确 P4 输入「该经历的全部 Story（含父/子）」，实现只传叶子。
- **设计原文**：§7 P4 输入「原始 JD + 该经历的**全部 Story**（含父/子、槽位、quotes）」；硬规则 4「父 Story 只做背景/总述，不作为 evidence」。
- **实际做法**：`core/retrieval.mjs:6-12` `leavesOf(model.stories)` 后只把 leaves 传 P4；父节点完全不进 prompt。
- **影响**：评估员看不到父总述，子 Story 语境可能被误判；与设计输入契约不符（且与 N-005 联动：父 summary 目前也不落 Markdown，即便传也无内容）。
- **临时或永久**：待确认（建议按设计传父节点并标注「仅背景，不可作 evidence」）。
- **待用户确认**：否（建议按设计修）。

### N-025 简历问题的 `basis_quote` 只允许来自经历 Markdown；合法 bullet 依据会整批抛错

- **日期**：2026-11-24
- **问题**：设计允许简历问题的依据是「当前 bullet/Story/raw」，实现只校验经历 Markdown；更严重的是逐条 assert，任何一条非法会让整批问题作废。
- **设计原文**：§7 P10 硬规则 3「问题必须同时引用：JD 原文 + 当前依据（bullet/Story/raw）」；§10.6 `basis_quote`；§10.2 简历问题依据表（`adjacent_unselected` / `unrealized_potential` 都可由当前简历现状作依据）。
- **实际做法**：`core/questions.mjs:69-88` `validateQuestion`：`quoteMatch(exp.markdown, basis_quote)`；`core/questions.mjs:126-137` `planResumeQuestions` 对 LLM 返回逐条 `assert` 校验 → 任一失败抛 `AppError`；`core/generate.mjs:147-152` catch 后 `questions = {all:[],ui:[],error}`，整批丢失。
- **影响**：P10 若用「已选 bullet 原文」或 raw 原文作 basis_quote，会被判非法；且一条坏问题让整轮简历问题为空，用户看不到任何问题。
- **临时或永久**：实现缺陷；建议 basis 来源扩展（bullet/run.content/raw）+ 单条丢弃/告警而非整批抛错。
- **待用户确认**：否（建议修）。

### N-026 A3 候选没有进入 P2 输入，经验问题实际由 LLM 自由生成

- **日期**：2026-11-24
- **问题**：设计流程是 A3 候选 → P2 只写问题文案；实现 A3 候选只在 confirm 后计算并回显，P2 prompt 不含候选，也无「问题必须对应候选」的校验。
- **设计原文**：§10.3 流程图；§10.3.1；§7 A3「输出候选（不写问题文案）… 候选交给 P2/P10」；§10.2「没有 basis 就没有问题」。
- **实际做法**：`core/pipeline.mjs:18-25` confirm 后调 `detectExperienceCandidates`，随后 `planExperienceQuestions`（`core/questions.mjs:110-124`）把 candidates 只放进返回值，`promptP2`（`core/prompts.mjs:60-86`）完全不收 candidates；简历侧 P10 prompt 收 candidates（`core/prompts.mjs:180-202`），两侧不一致。
- **影响**：经验问题的「依据」不由 A3 门禁，可能问出没有候选支撑的问题；与设计分工不符。
- **临时或永久**：实现偏离；建议 P2 输入带 candidates，A2 校验问题 basis ∈ 候选。
- **待用户确认**：否（建议修）。

### N-027 问题展示未过滤状态：answered / dismissed / expired 会重新出现

- **日期**：2026-11-24
- **问题**：UI 3 槽直接截取问题数组前 3 条，不区分状态。
- **设计原文**：§10.4「已回答标 `answered`，不再展示；同类降权」「用户可 dismiss，系统不纠缠」「依据变化 → 旧问题标 `expired`，重新评估」。
- **实际做法**：`core/questions.mjs:7` `uiSlots = (questions) => ({ all: questions, ui: questions.slice(0, 3) })`，不按 status 过滤；`planExperienceQuestions`（119-123）保存 `[...existing, ...questions]`，旧问题状态原样保留并被再次返回。
- **影响**：用户答过/忽略过的问题会重新占用前 3 条槽位，「不纠缠」的设计承诺无法实现；`list` 命令也不会区分。
- **临时或永久**：实现缺陷；建议 `ui` 只取 candidate（或 asked），answered/dismissed 不进 UI。
- **待用户确认**：否。

### N-028 `evidence_rev` 失效机制基本未实现，且会在确认前提前 expire

- **日期**：2026-11-24
- **问题**：设计用 `evidence_rev` 控制问题失效；实现没有「保存时比对 rev、旧问题置 expired」逻辑，唯一 expire 发生在回答后、用户确认前。
- **设计原文**：§10.4「依据变化：`evidence_rev` 变化 → 旧问题标 `expired`，重新评估」；§10.6「`evidence_rev` 控制失效」；§10.7「回答后旧问题 answered；依据变化的问题 expired」。
- **实际做法**：`core/store.mjs:121-127` `bumpEvidence` 只自增；`core/questions.mjs:158-162` `answerQuestion` 在 `extractDraft` 之后、`bumpEvidence` 之前，把同 story 的 candidate 问题标 `expired`；`planExperienceQuestions`/`planResumeQuestions` 保存新问题时不做 rev 比对；`loadQuestions`（`core/store.mjs:155-157`）直接返回，不校验 evidence_rev。
- **影响**：手改 Markdown / 再次确认后旧问题仍显示有效；回答后用户若放弃确认（Draft 未入库），问题已被错误 expire，不可逆；与设计失效语义不符。
- **临时或永久**：实现缺陷 + 可逆性风险；建议在 evidence_rev 真正 bump 成功后统一标记旧问题 expired，并记录 `evidence_rev` 快照。
- **待用户确认**：否（建议修）。

### N-029 v5-cli `input` 命令访问不存在字段，成功路径会抛 TypeError

- **日期**：2026-11-24
- **问题**：CLI `input` 输出里读取 `result.draft.unassigned_details.length`，但 `extractDraft` 返回的 draft 没有该字段。
- **实际做法**：`v5-cli.mjs:55`；`core/extract.mjs:14-32` 返回对象字段为 `stories/fragments/questions`，无 `unassigned_details`。
- **影响**：每次成功 `input` 都会在输出阶段崩溃（TypeError），用户以为输入失败但 raw 已落盘；命令不可用。
- **临时或永久**：实现缺陷；建议顺手把 `unassigned_details` 放回 draft（也更符合 P1 契约）或在 CLI 输出固定 0。
- **待用户确认**：否（建议修）。

---

## 三、次要偏差（合并记录）

- **P7 issue type**：设计枚举为 `coverage|duplication|ordering|evidence|length|style|overclaim|background`；`core/prompts.mjs:167` 增加 `syntax`。若保留应回写 §7 P7。
- **Story title 长度**：设计 Story 列表展示「≤20 字」（§4.3）；`core/prompts.mjs:41` 要求 ≤20，但 `core/types.mjs:75` 与 `core/extract.mjs:23,79,111` 允许 30 字。落盘口径与展示口径不一致。
- **Fragment `reason` 不落 Markdown**：`core/markdown.mjs:141-145` 只写 body；确认后「为什么不是 Story」丢失（与 N-014 相关）。
- **P4 失败降级为 `hold`**：`core/retrieval.mjs:31-32` 捕获异常返回 `recommendation:'hold'`，`error` 只存在 result；A1/A2 无告警，用户看不到某段经历评估失败。
- **P5 `background.cover`**：设计输出 `background:{needed,cover:[]}`，实现默认 `['背景','目标','角色','范围']`（`core/generate.mjs:21`），不是设计给的枚举，未见校验。
- **`run` 无 `jd_note`/`debug`**：与 N-021 同源；P3 只有 prompt/mock、无调用出口（`core/prompts.mjs:88-95`，全仓 grep 无 `promptP3(` 调用），若保留 R3 则「只写在文档里、没有实现出口」（§11.3 验收）。
- **P1 mock 因 raw 传对象而读不到文本**：见 N-016；`core/mock.mjs:18` 依赖 `input.raw_text` 为字符串。

---

## 四、待用户确认清单（汇总）

1. N-002：Markdown 父子层级用 `###`（设计 §5）还是平铺 `##`+注释？当前实现只支持后者，且会静默吞掉 `###`。
2. N-003：回答问题的 raw 最小长度（现 10 字是否过高）。
3. N-004：Story 是否增加 `ownership/scope` 字段，或把 P2/A3 维度改为六槽可映射项。
4. N-005：`summary` 是否写进 Markdown；写在哪。
5. N-006 / N-007：是否允许「0 Story 经历」；raw 中的元叙述/缺口声明如何归类（新增 meta_notes？）。
6. N-008：是否加 raw 归属校验（旧 check_extension 的替代）。
7. N-009：教育背景/profile 是否纳入本轮 INPUT-FOLLOW。
8. N-010：quote 校验严格度（full match 还是 partial 分句）。
9. N-011：bullet 字数是否采纳 35–55。
10. N-012：3 段经历是硬约束还是软目标；不足时是否允许出稿。
11. N-014：确认环节是否需要校验「Draft → Markdown」的 raw 覆盖差。
12. N-015 / N-016：多次未确认 Draft 的覆盖策略；P1 的 raw 范围（单条/全量）。
13. N-020：数据目录布局按实现回写，还是改回设计路径。

---

## 五、2026-11-24 23:50 复核：已修复 / 部分修复 / 仍开放

| 编号 | 状态 | 证据 |
| --- | --- | --- |
| N-001 覆盖盲区 | 部分修复 | `core/retrieval.mjs:42-47` 现按 JD 行先铺 `support:none` 行；但引出新问题 N-030（行切分 ≠ 规范化要求集合，会造假缺口）。 |
| N-002 `###` 子层级 | 已修复 | `core/markdown.mjs:13,136-153` 支持 `##`/`###`，序列化按层级递归；meta 中的 parent 仍是权威。 |
| N-003 短答案 | 已修复 | `core/store.mjs:77-79` 门槛改为「非空」；`questions.mjs` answer 可写短答。 |
| N-004 ownership/scope | 部分修复 | P1 提示词已要求输出 `ownership/scope/summary`（`core/prompts.mjs:42-44`），extract 捕获（`core/extract.mjs`），Markdown 新增 `- 归属：`/`- 范围：`（`core/markdown.mjs:17-19,140-142`），storyBrief 带出。**但 A3（`core/questions.mjs:12-33`）仍不检查 ownership/scope**，P2 仍可能每轮重复问；v5-cli 展示层也未见这两列。 |
| N-005 summary 丢失 | 已修复（需回写设计） | `- 摘要：` 行写入/解析；设计 §5 无此语法，见 N-032。 |
| N-006 0-Story 经历 | 部分修复 | `core/extract.mjs:39` 允许「Story 或 Fragment 非空」；`core/pipeline.mjs:23-25` 无 Story 时跳过 P2。但 `confirmDraft` 对 0 Story 的 Markdown 是否可被后续生成安全跳过未测。 |
| N-012 强制 3 段 | 仍开放 | `core/generate.mjs:130` 仍断言 `library.length>=3` 抛 `LIBRARY_TOO_SMALL`；`core/types.mjs:136` 仍要求 3–4 段。 |
| N-013 unassigned 字段缺失 | 仍开放 | `core/extract.mjs:13` 仍是 `!json.unassigned_details || ...`，缺字段=通过；虽然 `draft.unassigned_details` 已补（:40）。 |
| N-014 确认环节覆盖差 | 仍开放 | `buildModelFromDraft` 删除/合并 Story 后无 raw 覆盖校验；fragment reason 仍不落 Markdown。 |
| N-016 raw 范围 | 部分修复 | P1 已收到 `raw.text`（`core/extract.mjs:10`）；但 answer 仍只喂最新一条 raw（见 N-034）。 |
| N-020 目录布局 | 仍开放 | `core/store.mjs:19-27` 未变；设计 §8 未回写。 |
| N-021 节点留痕 | 部分修复 | `core/generate.mjs:147` 只写一条 generate 级 debug（且 payload 极大）；P1/P2/P4/P5/P6/P7/P8/P10 仍无逐节点 input/output/token/elapsed。 |
| N-022 A2 时序 | 部分修复 | `core/generate.mjs:135-143` A2 issues 现与 Critic issues 合并后进 R8；但 `validateContent` 的字符串 `errors` 仍未 issue 化，最终 `validation.errors` 不参与修订。 |
| N-023 P8 审计字段 | 已修复 | `core/generate.mjs:90-94,142` 保存 `applied_issue_ids/remaining`。 |
| N-024 P4 父 Story | 仍开放 | `core/retrieval.mjs:6-7` 仍只传 leaves。 |
| N-025 简历问题 basis | 改变但仍有问题 | `core/questions.mjs:76` 现只对 `scope==='experience'` 做 basis 包含校验；简历问题变成完全不校验 basis（更不会误杀，但设计要求的「basis 必须存在」对简历侧失效）。 |
| N-026 A3→P2 门禁 | 仍开放 | `core/pipeline.mjs:22-24` 把 candidates 传入，但 P2 prompt 不含（`core/prompts.mjs:60-86`），A3 不参与判定。 |
| N-027 UI 状态过滤 | 已修复 | `core/questions.mjs:8` `ui` 只取 candidate/asked。 |
| N-028 evidence_rev | 部分修复 | `core/pipeline.mjs:33-38` 手改 Markdown 后把 candidate/asked 标 expired；但 load 时不比对 evidence_rev，answerQuestion 仍在确认前 expire（N-034）。 |
| N-029 CLI TypeError | 已修复 | `core/extract.mjs:40` draft 带 `unassigned_details`；CLI 可正常输出。 |
| N-030/031/032 新增 | 见下 | — |

## 六、23:50 新增问题

### N-030 JD 覆盖统计缺少「规范化 JD 要求集合」；按行铺 `none` 会制造假缺口

- **日期**：2026-11-24
- **问题**：A1/问题引擎需要「每条 JD 引用的 support」，但「JD 引用」没有规范集合。Lead 用「JD 按行切分」建 `none` 行；而 P4 的 `jd_quote` 是模型自由引用的片段。两者字符串不完全相等时，同一条 JD 要求会并存两行：整行 `none` + 片段 `direct`，`detectResumeCandidates` 会把整行 `none` 当成覆盖缺失。
- **设计原文**：§7 A1「统计每条 JD 引用的覆盖（direct/adjacent/none）」；§10.3.1「建 JD 覆盖快照：每条 JD 引用的 support = direct/adjacent/none」；§7 P3（可选）「JD Note 带逐字 quote」；设计没有定义「每条 JD 引用」的规范化来源与对齐规则。
- **实际做法**：`core/retrieval.mjs:42-47` 把 JD 按 `\n` 切行、去列表符号、长度 8–160 的字面行作为 requirements；`core/questions.mjs:37-68` 对这些行逐一找未选 Story。
- **真实数据实测（2026-11-24 23:46，`eval/v5-real-smoke.mjs`，JD=jd-02-AI产品实习生，run_f499e9886a26d2）**：coverage 行 support 分布 = `none 20 / adjacent 6 / direct 2`；`none` 行里包含「公司类型：AI 应用 / SaaS」「地点：远程 + 上海」「时长：6 个月，每周 5 天」「本科及以上在读，专业不限；」等**不是经历可覆盖的要求**。且同一要求出现两行：整行 `none`「协助完成用户访谈、竞品调研与数据复盘；」+ P4 引用片段 `adjacent`「协助完成用户访谈、竞品调研与数据复盘」（分号差异），即「已覆盖却仍标 none」。最终 `candidates=78`、简历问题 `all/ui=0`（见 N-038）。
- **影响**：真实 JD 里一行常含多个要求、要求也可能跨行；P4 引用多为半句。结果会是「已覆盖仍被判 none」的假 coverage_missing，或同一条要求重复提问；问题排序/覆盖统计可信度下降。
- **临时或永久**：临时启发式；建议回写设计：明确 JD 要求条目来源（P3 JD Note？人工切分？P4 归一化？）与 quote 对齐方式。
- **待用户确认**：是（覆盖口径）。

### N-031 `prototype/eval/v5-real-smoke.mjs` 当前不可运行（导入路径 + 数据路径都错）

- **日期**：2026-11-24
- **问题**：新增的真实验证脚本无法加载。
- **实际做法**：`prototype/eval/v5-real-smoke.mjs:4-6` 写 `./core/store.mjs`（同目录无 `core/`，应为 `../core/…`）；`DATA`/`JD`（:8-9）用 `path.resolve(import.meta.dirname,'..','..', …)`，从 `repo/prototype/eval` 解析到 `repo/`，但 `沙盒数据-真实语料-v3/`、`回归集/` 在工作区根（`repo` 的上一层）；实测：`import()` 报 `ERR_MODULE_NOT_FOUND`，`Test-Path repo/沙盒数据-真实语料-v3`、`repo/回归集` 均为 False。另外脚本用 `createLLM()`（无 mock）需要真实密钥。
- **影响**：Lead 若用它确认「真实数据能跑」会得到假阴性；也可能被当成已完成的真实验证。
- **临时或永久**：实现缺陷；建议修路径（或改读 `prototype/eval/runtime` 现有真实语料），失败时输出明确错误。
- **待用户确认**：否（建议修）。

### N-032 Markdown 语法被实现扩展（`###` / `- 摘要：` / `- 归属：` / `- 范围：`），设计 §5 未定义，必须回写

- **日期**：2026-11-24
- **问题**：为承接 summary/ownership/scope 与子层级，正文格式已超出设计文档规定的语法。
- **设计原文**：§5 Markdown 示例与规则只有 front matter、`## 背景`、`##/### Story:`、六槽位行、`- 原话：`、`## 素材片段`；§4.5 Story 字段只有 `title/summary/slots/raw_quotes/is_container/flags`，无 ownership/scope；§4.3 列表行也不含归属/范围。
- **实际做法**：`core/markdown.mjs:13-19` 新增 `### Story:`、`- 摘要：`、`- 归属：`、`- 范围：` 的解析；`core/markdown.mjs:136-153` 序列化层级与这三行；`core/prompts.mjs:42-44` P1 已要求输出；`core/extract.mjs` 捕获。
- **影响**：设计文档与实际正文格式不一致；设计 §11.2 用例 3（手改 Story 后重抽不覆盖手改）现在还要依赖这些新行的解析；任何人按设计文档写正文都不会有归属/范围/摘要行（信息会缺），或误以为这些行非法。展示层若按 §4.3 设计只显示 title/一句话/原话，也看不到新字段。
- **临时或永久**：建议定为永久（信息增益明确），但**必须回写设计 §4.5/§5/§4.3**；否则唯一设计基准失效。
- **待用户确认**：是（是否接受这三行 + `###` 作为正式语法）。

### N-033 测试把偏离行为固化为期望，mock 端到端未覆盖关键设计行为

- **日期**：2026-11-24
- **问题**：`node --test` 全绿（12/12），但若干断言把实现的临时行为当成设计行为。
- **实际做法/证据**：`prototype/tests/v5-core.test.mjs`：`:56`、`:98` 断言 `questions.all.length === 4` —— 这 4 条全部来自 mock P2 的固定返回（`core/mock.mjs:41-55`），与 A3 候选无关，等于把「A3 不参与」固化；`:106` 只断言 dismissed 状态持久化，未断言 UI 过滤后不再出现（设计 §10.4）；mock P2 产出 `ownership/scope` 问题，但 A3 从不产出这两类候选（`core/questions.mjs:12-33`），测试没发现；`:54-64` 未断言 summary/归属/范围/子层级实际写进 Markdown；端到端固定 3 段经历，未覆盖 0-Story、2 段、父子层级、重复 raw、短答案等 §11.2 边界。
- **影响**：绿灯无法证明「设计行为正确」；后续把偏离当基线继续演进的风险高。
- **临时或永久**：测试质量问题；建议按 §11.2 必测用例补断言（尤其问题状态、A3 门禁、父子/摘要/归属落盘）。
- **待用户确认**：否（建议补）。

### N-034 `answerQuestion` 仍在用户确认前 expire 问题，且 P1 只喂单条 raw

- **日期**：2026-11-24
- **问题**：N-028/N-016 的剩余部分。
- **设计原文**：§10.7「回答 → 新 raw；只对相关经历跑 P1 → AI Draft；**人确认 Story 列表 → 更新 Markdown**；旧问题 answered；依据变化的问题 expired」；§4.6「raw 本来就在库里」。
- **实际做法**：`core/questions.mjs:144-166`：先 `appendRaw`、把 `q.status='answered'`，随后把同 story 的 candidate 全部标 `expired`，再 `extractDraft`、`bumpEvidence`；Draft 需另一次 confirm 才落 Markdown。若用户不确认，问题已被永久 expire（不可逆）。`extractDraft({… raw })` 只传本条新 raw。
- **影响**：回答后放弃确认 = 旧问题消失且证据未更新；P1 无法对照经历全量 raw 判断新补充的归属/是否重复（「那篇推文」类指代只能靠 current_markdown 兜）。
- **临时或永久**：实现缺陷；建议：确认成功后再 expire/bump；P1 输入带全量 raw（或至少明确契约）。
- **待用户确认**：是（P1 raw 范围：单条/全量；expire 时机）。

---

## 七、真实数据 smoke 实测（2026-11-24 23:46，run_f499e9886a26d2）

> 方法：独立运行 Lead 新增的 `prototype/eval/v5-real-smoke.mjs`（真实 DeepSeek，真实语料 3 段经历，JD=`回归集/jd-02-AI产品实习生.md`），临时数据目录 `%TEMP%\v5real-GgNW8E`。用途仅为核对设计在真实数据上的行为，不修改任何实现。
> 结果摘要：3 段经历 / 10 条 bullet（4+3+3）；`validation.errors` 4 条未修复（背景 71/62 字、hook 15 字、content 29 字）；`issues` 25 条（blocker 5 / warning 12 / note 8）；简历问题 `all=0, ui=0`（candidates=78）；coverage `none 20 / adjacent 6 / direct 2`。

### N-035 真实数据：P1 把「总述/角色/荣誉」写成叶子 Story；准入 2/3 无任何机器校验，flags 未提示

- **日期**：2026-11-24
- **问题**：真实抽取把「任职总述」「获得称号」当可检索 Story，`flags` 为空，默认通过。
- **设计原文**：§4.2 准入 2「本人动作」、3「闭环结果/可验证交付」；§4.3「仅**有提示的卡**需要人工判断；无提示的卡默认通过」；§4.4 flags 用来提示 `missing_metric/vague_ownership/missing_outcome`；§4.5「总述用父 Story，父不生成 bullet」。
- **实际做法/证据**：`%TEMP%\v5real-GgNW8E\v5\experiences\exp_d94f9c36ab3ed474\content.md` Story `story_7c3378a9039f`「主动联系老师任副主席统筹活动」，outcome 是「担任副主席并统筹活动运营，日常运营工作持续开展」（非闭环交付），flags=`["missing_metric"]`；扣子经历 Story `story_053b52de0698`「项目收尾获优秀校园大使」，「获得称号」不是本人动作、也没有交付，flags=`[]`。全部 0 父节点（AI 未按 §4.5 建议层级）。
- **影响**：低质/非事件 Story 以「无提示默认通过」进入 Markdown → 可被 R4 当 evidence、R6 写进 bullet；「准入由人确认」实际依赖用户逐卡细看，而 UI 只给标题/一句话/原话。
- **临时或永久**：设计层风险；建议加确定性 admission 兜底（把「获得/担任/参与」类无交付表述标 flag 或强制提示），或明确承认「仅靠模型 flag」。
- **待用户确认**：是（准入是否要机器兜底提示）。

### N-036 真实数据：Fragment 承载「口径/边界/项目背景」，但下游 R4/R6/R7 完全不读 Fragment → 防夸大信息在生成时丢失

- **日期**：2026-11-24
- **问题**：真实 raw 里最关键的「不能怎么用这些数字」的信息被归入 Fragment 后，生成阶段看不到。
- **设计原文**：§4.1「Fragment 不生成 bullet」；§4.5 父 Story 做背景/总述；§7 P4/P6 输入只有 Story；F1 无经历级背景字段；§5 `## 背景` 可选，但 P1 输出没有 experience 级 background。
- **实际做法/证据**：扣子经历 Markdown 的 `## 素材片段` 有「朋友圈好友约3000人，但这不是实际看到宣传或进入活动的人数。」「线上与线下的转化率分别统计，不能混算。」；成都经历片段有「项目组面向海内外高校…」。但 `core/retrieval.mjs`、`core/generate.mjs` 组 prompt 时只传 Story（P4/P6），Fragment 从不进 prompt；Critic 也只拿 JD+content+coverage。P6 的 `project_background` 由模型凭空概括（实测出现 71/62 字超限，且删掉了「线上线下」边界）。
- **影响**：简历可能把「好友数」当触达、把线上线下转化混算、丢失项目背景——直接违反 §0「高保真、不编造、不夸大」。这是设计缺口（Fragment 只存不用），不是实现小 bug。
- **临时或永久**：设计需补：Fragment/raw 作为 P6（及 P7）的「边界约束输入」，或给经历加 background 字段并进入生成。
- **待用户确认**：是（重要）。

### N-037 真实数据：P2 产出设计枚举外的缺失维度（`action`），无字段可落、无校验

- **日期**：2026-11-24
- **问题**：真实运行中经历问题带 `missing:["action","workflow"]`、`expected_answer.fields:["action"]`。
- **设计原文**：§7 P2 输出 `missing: ["result","metric","ownership","scope"]`；§10.3.1 A3 检查维度 result/metric/ownership/scope；§10.6 Question.missing；§10.9 A2 校验「单维度」。
- **实际做法/证据**：`%TEMP%\v5real-GgNW8E\v5\questions\experience-exp_d94f9c36ab3ed474.json` 的 `q_6f64e08fd5958f5bccde`：`missing:["action","workflow"]`、`expected_answer.fields:["action"]`；`core/questions.mjs:72-91` `validateQuestion` 只校验 `missing` 非空；Story 没有 `action` 字段。
- **影响**：用户回答「我做了哪些动作」后 P1 无字段可归（进 workflow 或 unassigned），问题无法真正 close；同一维度可能反复生成。与 N-004 同源：问题维度与 Story 字段没有强制映射。
- **临时或永久**：设计/实现都需补白名单（P2 只允许能落到字段的维度；A2 校验 `missing ⊆ 字段枚举`）。
- **待用户确认**：否（建议修）。

### N-038 真实数据：A3 简历候选不校验「Story 与该 JD 引用的相关性」，78 条噪声候选把 P10 淹没成 0 问题

- **日期**：2026-11-24
- **问题**：`detectResumeCandidates` 对每条未覆盖 JD 行 × 每个未选 Story 全排列，不判断该 Story 是否真的与这条引用相关；真实运行 78 条候选，P10 输出 0 条问题。
- **设计原文**：§10.3.1 简历侧「对 none/弱 的 JD 引用，在未选中的 Story/经历里找 **direct/adjacent 证据**」「前置条件（缺一不可）：候选 Story/经历存在；有动作+结果/交付/证据；当前简历未使用；回答后能生成可靠新 bullet；答案能落到 Story 字段」；§7 A3 输入含 R4 matched/missing；§10.4「第一轮全部输出，不设上限」。
- **实际做法/证据**：`core/questions.mjs:39-70` 只判断 story 有 workflow+outcome，不读 R4 的 matched 关系；`basis_type` 直接取行级 support（adjacent/none）。实测 `candidates=78`，其中大量 `jd_quote=「公司类型：AI 应用 / SaaS」「地点：远程 + 上海」「本科及以上在读，专业不限；」` × 不相关 Story（如保研分享会、优秀校园大使）；P10 收到 78 条候选后返回 `questions.all=[]`（`run_f499e9886a26d2`，无 error）。
- **影响**：简历问题引擎真实产出为 0，用户拿不到「补一条覆盖 JD 的内容」的建议；设计「问题一直有、第一轮全部输出」不成立。根因是候选生成把「行级覆盖」当成「Story 与引用的证据关系」。
- **临时或永久**：实现缺陷 + 设计需明确候选相关性来源（用 R4 的 story↔jd_quote matched 关系，而非行级 support）。
- **待用户确认**：是（是否用 R4 关系做 A3 相关性门禁；以及 JD 元信息行如何排除）。

### N-039 真实数据：R8 之后 A2 错误与 bullet 编号/顺序仍未规范化，生成摘要只报 validation_errors=4

- **日期**：2026-11-24
- **问题**：真实运行修订后仍有 5 个 blocker（含 A2 的 hook/content 字数错误），且 bullet 编号出现缺号/乱序（Critic 报「b3、b1、b4、b2」「缺少 b2」），最终仍正常返回 run。
- **设计原文**：§8 步15「R8 条件修订（最多 1 轮），修不掉交人工」；§7 A2「字数/背景格式；重复 bullet；输出 issues」；§7 R8「输出 diff/修改说明」。
- **实际做法/证据**：`run_f499e9886a26d2.issues`（= 修订后重算）：`blocker|bullet|hook 15 字`、`blocker|bullet|content 29 字`、`blocker|evidence` 2 条、`blocker|coverage` 2 条；`validation.errors` 4 条；`revision.applied=true`。A2 的 `validateGenerated` 未检查 bullet_id 连续性与计划顺序（Critic 自己发现了乱序）。
- **影响**：revise 后未再做「内容规范化 + A2 重新拦截」，blocker 会直接进最终稿；CLI 摘要只展示 `validation_errors`，用户/Lead 容易忽略 blocker；R8 的「修不掉交人工」没有明确出口标记（`remaining` 有保存，但未被用于状态/告警）。
- **临时或永久**：实现缺陷；建议 R8 后统一重编号/裁剪并按 A2 issues 判定 `needs_manual`，摘要突出 blocker。
- **待用户确认**：否（建议修）。

### N-040 新增确定性 `normalizeLengths` 节点（设计无此节点）：只裁不补、在 issues 之后执行，属临时兜底

- **日期**：2026-11-24 23:48 观察
- **问题**：真实 smoke 暴露 background/hook/content 超长后，Lead 在 `generateResume` 末尾加了确定性裁剪 `normalizeLengths(content)`，设计里没有这个节点。
- **设计原文**：§7 P8 只允许「按 issues 修订、不新增事实、缺证据只能删/弱化」；§8 步 15 只有 R8 条件修订；§7 A2 负责「字数/背景格式」校验并输出 issues；设计没有「生成后硬裁字数」的算法节点，也没有说明硬裁后如何回写 issues。
- **实际做法/证据**：`core/generate.mjs:11-30,184-186`：`trimAtBoundary` 对 background>60、hook>12、content>80 按标点截断；对 background<40、content<35 用 `ensureMin` **循环追加固定短语补齐**——background 加「，并完成交付与复盘」、content 加「，完成交付并复盘」（`core/generate.mjs:34,36`）；在 `issues = critique + validate` 之后、最终 `validateGenerated` 之前执行；`run.adjustments` 记录 from/to，但 issues 未按调整后内容重算。同时新增 `renumber(content)`（:17-22,:179,:184）在 R8 后重排 bullet_id。另 `pipeline.mjs:22-27` 现在 confirm 成功后先把旧 candidate/asked 全部 expire 再生成新问题（比之前合理，但与 §10.7「回答后 answered/依据变化 expired」的状态语义仍需对齐）。
- **影响**：**补齐是编造事实**：给「阅读中英文文档并整理宣传材料」补「，完成交付并复盘」会新增原文没有的「交付/复盘」宣称，直接违反 §7 P6「禁评价性收尾、空话、编数字」与 §7 P8「不得新增事实」；`ensureMin` 循环可能重复追加同一短语。最终稿与 issues 不一致（用户看到的问题可能已在正文被裁/被补，未被记录）；「过短」被掩盖成假通过。
- **临时或永久**：**临时兜底**，可逆（可删）；若保留则必须改为「只裁不补」，或补齐必须走 R8/P8（带 issue 记录），并把 adjustments 转为 issue 或 validation 记录。
- **待用户确认**：是（是否接受「确定性字数归一化」作为正式节点；是否允许追加非原文内容）。

### N-041 A3 改为只用 R4.matched 后：`direct → coverage_missing` 语义错位，真正的「零覆盖」缺口不再产生候选

- **日期**：2026-11-24 23:50 观察（Lead 修 N-038 后引入的新问题）
- **问题**：A3 简历候选改成只遍历 R4 的 matched 关系（这对 N-038 的「全排列噪声」是正向修复），但 `basis_type` 映射与设计语义不符，且「JD 要求零覆盖」类的缺口没有任何候选来源。
- **设计原文**：§10.2 简历问题依据表：`coverage_missing`＝「JD 引用在 A1 覆盖中为 `none`/弱，且库里有相关经历」；`adjacent_unselected`＝「R4 发现库中 Story 有 `direct/adjacent` 证据，但没被选进简历」；§10.3.1 简历侧「对 none/弱 的 JD 引用，在未选中的 Story/经历里找 direct/adjacent 证据」。
- **实际做法/证据**：`core/questions.mjs:39-73`：只遍历 `evaluations[].matched`，过滤 `support∈{direct,adjacent}`；`basis_type: m.support === 'adjacent' ? 'adjacent_unselected' : 'coverage_missing'` —— 于是 support=`direct` 的未选 Story 被标成 `coverage_missing`（语义应为 adjacent_unselected/unrealized_potential）；support=`none` 被过滤，真正的「JD 要求零覆盖」行不产生任何候选（真实 run 里 Critic 指出的「缺 PRD / 知识库」没有对应问题候选）。
- **影响**：问题分类会误导 P10（它按 basis_type 理解目的）；覆盖缺口（最需要用户补内容的一类）反而问不出来；与 §10.2 的定义正好相反/缺失。
- **临时或永久**：临时修复引入的新偏离；建议明确三类边界的判定来源（direct+未选=adjacent_unselected/unrealized_potential；行级 none + 经历级相关性=coverage_missing），并回写设计 §10.2/A3。
- **待用户确认**：是（coverage_missing 与 adjacent_unselected 的边界）。

## 八、2026-11-24 23:48 复核（真实 smoke 后）

| 编号 | 状态 | 说明 |
| --- | --- | --- |
| N-001 / N-030 | 部分修复 | `core/retrieval.mjs:48` 排除「公司类型/地点/时长/这份JD/人工关注点/加分项」元信息行；`findLine`（:50-58）双向包含归一化，解决「整行 none + 片段 direct」重复。仍存在：学历行（本科及以上在读）仍作为覆盖要求（无教育模块，见 N-009）；`findLine` 双向 `includes` 可能在短行间误合并。 |
| N-038 | 部分修复 | `core/questions.mjs:39-73` 已改为只用 R4 matched 关系，不再全排列（真实 smoke 的 78 条噪声候选问题从根上解决）；但引入 N-041（basis_type 映射错位、none 缺口无候选来源）。 |
| N-041 | 部分修复（映射层），引入 N-042 | `core/questions.mjs:47,62` 现接受 `none` 并映射：`none → coverage_missing`、`direct/adjacent → adjacent_unselected`，与 §10.2 定义一致（direct 未选归 adjacent_unselected）。但 `none` 的实际语义是「该 Story 对此要求无证据」，直接生成候选会造出「保研分享会 × 用户访谈」这类假候选（N-042）。 |
| N-037 | 部分修复 | `core/questions.mjs:100` 把 `missing:"action"` 归一化成 `workflow`；但 `expected_answer.fields:["action"]` 未映射，P2 prompt 仍不限制枚举，A2 仍无白名单。 |
| N-039 | 部分修复 | `core/generate.mjs:17-22,179,184` 新增 `renumber` 重排 bullet_id；字数归一化（N-040）issues 不重算。 |
| N-040 | 部分修复 | 23:51 复核：`ensureMin` 补齐逻辑已删除（不再给正文追加「完成交付并复盘」等编造内容），`normalizeLengths` 现在只裁长（background>60/hook>12/content>80），仍存在：issues 在调整前计算、不重算；过短不再补齐但仍留 validation error；`ensureMin` 成为死代码。 |
| N-033 | 仍开放 | `prototype/tests/v5-core.test.mjs` 未变（23:42:16），仍无状态过滤/父子/摘要/归属断言，mock 端到端仍不覆盖真实文本/真实候选路径。 |
| N-012 / N-020 / N-021 / N-026 / N-034 | 仍开放 | 见各自条目；`core/generate.mjs:151` 仍硬断言 ≥3 段；逐节点留痕只有一条 generate 级 debug。 |

## 九、23:53 复核（Lead 回复后）

> Lead 反馈：已删 ensureMin 补字、A3 允许 none/adjacent/direct（none→coverage_missing，direct/adjacent→adjacent_unselected）、P10 增加 target/jd_quote/basis_quote 回填、answer 的 expire 移到人工确认成功后；并明确「Markdown 目录布局、3 段硬约束、profile/education 不在范围、未分配 meta 叙述」等临时方案**暂按设计优先保留，不擅自改设计，等用户拍板**。

### N-042 A3 把 R4 `matched` 里 support=none 的条目当作 coverage_missing 候选，产生「与 JD 要求无关」的假候选

- **日期**：2026-11-24 23:53（Lead 最新真实 run 证据）
- **问题**：Lead 的 smoke `run_22bbd63891d79f`（目录 `%TEMP%\v5real-OfRCRa`）`candidates=1`，这条候选是 `jd_quote=「协助完成用户访谈、竞品调研与数据复盘」` × `story=「落地约6场保研分享会」`、`support=none`、`basis_type=coverage_missing`。该 Story 与「用户访谈/竞品调研」毫无关系，R4 的 `none` 语义正是「本 Story 对此要求没有证据」。
- **设计原文**：§10.2 `coverage_missing`＝「JD 引用在 A1 覆盖中为 none/弱，**且库里有相关经历**」；§10.3.1 简历侧前置条件（候选 Story 存在、有动作+结果/交付/证据、回答后能生成可靠新 bullet、答案能落到 Story 字段）；§7 P10 规则 4「优先从未选中的 direct/adjacent Story 里找」。
- **实际做法/证据**：`core/questions.mjs:47-62` 接受 `m.support==='none'` 并只为该 Story 生成 `coverage_missing`；不判断「该 Story/经历与这条 JD 要求相关」。
- **影响**：若 P10 采用（target 回填后），会问用户「补充与用户访谈/竞品调研相关的内容」，而依据却是保研分享会；用户只能答非所问或拒绝。相反，真实存在的覆盖缺口（如 Critic 指出缺 PRD/知识库）没有对应 Story 可挂，反而没有候选。
- **临时或永久**：实现缺陷；`coverage_missing` 需要「经历/Story 级相关性」来源（例如 R4 `missing` 里按经历聚合的相关性、或专门的 relevance 判断），不能拿 `support=none` 当相关。
- **待用户确认**：是（与 N-041 同源：三类 basis 的判定来源与相关性阈值；建议回写设计 §10.2/A3）。

### N-043 Lead 的临时取舍决策记录：不擅自改设计，保留设计优先，等用户拍板

- **日期**：2026-11-24 23:53
- **问题**：若按实现现状回写设计，会改动设计语义；Lead 选择不改设计而是保留现状（并接受实现与设计的不一致）。
- **设计原文**：`INPUT-FOLLOW.md` 全文（尤其 §8 落盘路径、§8 步11「3–4 段」、F1 无 profile/education、§4.6/P1 未分配=硬错误）。
- **实际做法**：Lead 明确「Markdown 目录布局（N-020）、3 段硬约束（N-012）、profile/education 不在范围（N-009）、未分配 meta 叙述（N-007）」暂按设计优先保留，不擅自改设计，等用户确认。
- **影响**：这些点会持续表现为「文档未覆盖的临时实现」；如果用户不拍板，下一轮迭代仍会踩同样的坑（例如真实语料如 `raw_827b…` 的挂名/缺失声明会触发硬错误、只有 2 段可用经历无法出稿、教育背景永远无法进入简历）。
- **临时或永久**：临时（待用户）；一旦用户拍板，必须回写设计文档（否则唯一设计基准失效）。
- **待用户确认**：是（需要一次集中决策：目录布局、3 段是否硬约束、profile/education 范围、meta 叙述通道、`coverage_missing` 相关性来源）。

### N-044 设计内部矛盾：`coverage_missing` 的「库里有相关经历」与 A3 前置条件「候选 Story/经历存在」互斥，真实零覆盖缺口永远问不出来

- **日期**：2026-11-24 23:56（独立 smoke，最新代码 run_1f46e331c60a05，目录 `%TEMP%\v5real-NyOcUa`）
- **问题**：最新代码（含 P10 target 回填）真实运行时 `candidates=0 → questions.all=0`。原因不是回填 bug：R5 已把 R4 matched 的全部 Story 选入（R4 matched 的 9 个 unique story 全部出现在 plan 中），所以 A3「未选中的 matched Story」为空；而 coverage 里 8 条 `none` 行（PRD/需求文档、知识库/提示词库、提示词与结构化输出、学历等）恰恰是 Critic 报 blocker/warning 的真实缺口，但它们在 R4 里没有 matched Story → A3 无法为它们建候选。
- **设计原文**：§10.2 `coverage_missing`＝「JD 引用在 A1 覆盖中为 `none`/弱，**且库里有相关经历**」；§10.3.1 简历侧前置条件（缺一不可）「候选 Story/经历存在；有动作+结果/交付/证据；当前简历未使用；回答后能生成可靠新 bullet；答案能落到 Story 字段」；§7 A3 输出候选必须带 `target.story_id/experience_id`；§4.2 准入要求 Story 自包含。
- **实际做法/证据**：`core/questions.mjs:39-73` 只能从 `evaluations[].matched` 造候选；R4 对「无任何证据」的要求通常给 `missing`（不是 matched），而 `missing` 不携带 Story/经历锚点；`run_1f46e331c60a05`：coverage `none=8 / adjacent=7 / direct=2`，candidates=0，questions=0；同 run 的 Critic 明确报「PRD/需求文档、知识库/提示词库无覆盖」（blocker/warning），但用户看不到对应问题。
- **影响**：设计承诺的「第一轮全部输出问题」「覆盖缺口转成用户问题」在真实数据上无法成立；最能提升简历覆盖的一类问题（完全缺失的 JD 要求）被结构性排除。根因是设计把「零覆盖」与「库里有相关经历/候选 Story 存在」放在同一个 basis 里，两者互斥。
- **临时或永久**：**设计缺陷，需用户拍板**。可选方向：(a) 允许 `coverage_missing` 只挂 `experience_id`（用户从零补新 Story），弱化「候选 Story 存在」；(b) 明确「零覆盖且无任何相关经历」不产生问题，只由 Critic/A2 作为缺口展示；(c) 让 A3 用 P4 `missing` 行 + 经历级相关性造「experience 级候选」，并由用户决定是否补新经历。
- **待用户确认**：是（重要设计决策；与 N-041/N-042 同组，建议一次性定义三类 basis 的判定与候选锚点）。

## 十、2026-11-24 23:57 复核（第二次独立 smoke + 测试更新后）

- **测试**：`node --test` 13/13 全绿；`prototype/tests/v5-core.test.mjs` 新增第 114-135 行「简历问题：P10 从候选回填 target/basis，全部存储、UI 3 槽过滤 dismissed」。N-033 部分修复：新测试覆盖了 target 回填 + UI 过滤 dismissed；仍缺：`questions.all.length===4`（:103,:106）仍把 mock P2 固定 4 条当期望（A3 候选逻辑不参与断言）、未断言 summary/归属/范围/子层级落盘、未覆盖 0-Story / 2 段经历 / 重复 raw / 短答案 / `coverage_missing` 零覆盖场景。
- **N-034 已修复**：`core/questions.mjs` 的 `answerQuestion` 现在顺序为 `appendRaw → extractDraft → bumpEvidence → 标记 answered + evidence_rev`，不再在确认前把同 story 其他问题 expire；旧问题 expire 移到 `core/pipeline.mjs:22-27`「人工确认成功后」统一处理。
- **N-040 部分修复**：`ensureMin` 补齐已删除，`normalizeLengths` 只裁长（background>60 / hook>12 / content>80）；第二次 smoke 仍出现「背景 39 字（应 40-60）」的 validation error——按 Lead 决策「过短只记 error」可接受，但 issues 在调整前计算、不重算的问题仍在。
- **N-042 / N-044 仍开放**：第二次真实 smoke（run_1f46e331c60a05）`candidates=0 → questions=0`；coverage none 8（PRD/需求文档、知识库/提示词库、提示词与结构化输出、学历等），Critic 把它们报为 blocker/warning，但问题引擎无法为「零覆盖且无相关 Story」生成候选。需用户拍板（见 N-044 三个方向）。
- **N-039 部分修复**：`renumber` 已加；第二次 smoke 的 issues 已无 bullet 编号乱序（Critic 不再报缺 b2）。
- **仍未验证/开放**：N-012（≥3 段硬断言）、N-020（目录布局）、N-021（逐节点 debug/token）、N-026（A3 候选仍未进入 P2 prompt）；N-035（准入 flags 兜底）、N-036（Fragment 不进下游）仍为设计缺口，等用户决策。







