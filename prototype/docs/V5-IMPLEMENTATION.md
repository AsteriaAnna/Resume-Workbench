# INPUT-FOLLOW v5 实现说明

> 设计基准：`INPUT-FOLLOW.md`。本文件只说明代码落点、命令、测试与当前已知边界。
> 分支：`feat/input-follow-v5`。旧 v2 实现保留，不被 v5 依赖或修改。

## 1. 目录与数据

```
prototype/core/
  types.mjs       枚举、schema、quote/字数/内容校验
  store.mjs       <data>/v5 存储：经历、raw、Draft、Markdown、questions、runs、debug
  markdown.mjs    front matter + Story/Fragment 解析与序列化（支持 ### 子 Story）
  llm.mjs         DeepSeek / mock JSON 调用
  prompts.mjs     P1/P2/P3/P4/P5/P6/P7/P8/P10 提示词契约
  mock.mjs        离线确定性输出
  extract.mjs     R1 一遍抽取、Draft、人工确认、手改保护
  questions.mjs   A3 候选、P2/P10、Question 状态、UI 3 槽
  retrieval.mjs   R4 每经历并行评估、A1 合并/覆盖
  generate.mjs    R5 计划、R6 编译、A2 校验、R7 评审、R8 有界修订
  pipeline.mjs    端到端编排
prototype/v5-cli.mjs
prototype/tests/v5-core.test.mjs
```

数据目录由 `WORKBENCH_DATA_DIR` / `--data` 指定，v5 使用其下 `v5/`，不碰旧数据。
raw 不可变；AI 只写 Draft；用户确认 Story 列表后才写 Markdown。

## 2. 命令

```bash
npm run v5 -- create --type campus --name "..." [--role ...] [--time ...]
npm run v5 -- input --exp <id> --text-file input.txt
npm run v5 -- confirm --exp <id> [--decisions-file decisions.json]
npm run v5 -- questions --exp <id>          # 经历问题，all + ui(3)
npm run v5 -- answer --question <qid> --text "..."
npm run v5 -- dismiss --question <qid>
npm run v5 -- edit --exp <id> --text-file content.md
npm run v5 -- generate --jd-file jd.md
npm run v5 -- show --run <id>
npm run v5 -- inspect --exp <id>
npm run v5 -- list | stats
```

`--mock` 走离线 mock；默认真实 DeepSeek（`.local-ai.json` 或 `DEEPSEEK_API_KEY`）。

## 3. 已落地的设计点

- R0–R9 / A1–A3 角色按设计拆分；R4 每经历并行；R5 计划；R6 编译；A2 校验；R7 评审；R8 有界修订。
- P1 一遍抽取；`unassigned_details` 必须存在且为空；`raw_quotes` 必须逐字来自本次 raw。
- 人工确认 Story 列表：`confirm` 接受全部/删除/合并/拆分/补丁；`mergeWithCurrent` 保证再次输入不会覆盖手改 Markdown。
- Story 准入、可选父/子层级（最大深度 2）、`summary/ownership/scope` 落 Markdown。
- 两套问题共用 `Question` 对象：经历问题（P2/A3）与简历问题（P10/A3）；全部存储，UI 只取 `candidate/asked` 前 3；`evidence_rev`、answered/dismissed/expired。
- 简历生成：R4 并行评估 → A1 覆盖 → R5 3–4 段/每段≤4 → R6 → A2 → R7 → R8（≤1）→ A2 复验；长度只裁不补（不新增事实）。
- A2 校验：字数、背景、hook、story_id、evidence_quote、jd_quote ∈ JD、父 Story 不得作证据、重复 bullet、括号闭合、数字无依据（warning）。
- `debug/` 已接 P1/P2/P10/generate；`run` 保存 `llm_stats`、`adjustments`、`revision`。

## 4. 测试

```bash
npm test                  # v2 + v5，共 13 项
node --test prototype/tests/v5-core.test.mjs
```

覆盖：Markdown 父子/摘要/归属/范围 roundtrip；mock 全链路；未分配硬错误；问题全量/UI 3/状态；P10 候选回填；A3 拒绝 support=none 假候选；手改 Markdown 后再次确认不被覆盖。

## 5. 已知边界（需用户拍板，未擅自改设计）

1. **零覆盖且库中无相关 Story 时，简历问题为 0**：设计 §10.2 的 `coverage_missing` 要求“库里有相关经历”，A3 又要求“候选 Story 存在”，两者在真实零覆盖时互斥；当前选择“不造假候选”，缺口由 Critic 报告。真实 smoke 出现过此情况。
2. `library<3` 直接失败：设计目标 3–4 段，与“宁可少写”存在张力；当前按 3 段硬门槛。
3. 教育背景/profile 不在 v5 范围；P3 JD Note 只有 prompt 未接线（可选节点）。
4. 数据目录采用按经历分目录 + `<data>/v5`，与设计 §8 的扁平路径不同；按实现回写设计待确认。
5. 逐节点 debug 只覆盖 P1/P2/P10/generate，尚未覆盖 R4/R5/R6/R7/R8 的 token/耗时。
6. 真实生成仍有背景/条数等长度 error（不静默修，交 Critic/人工），见 `IMPLEMENTATION-NOTES.md`。
