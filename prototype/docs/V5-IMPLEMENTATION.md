# INPUT-FOLLOW v6 实现说明

> 设计基准：`INPUT-FOLLOW.md`（§13 经历正文/增量合并、§14 三区生成方法论）。
> 分支：`feat/input-follow-v5`。旧 v2 保留，不被 v6 依赖。

## 1. 目录

```
prototype/core/
  types.mjs       枚举、schema、quote/字数/内容校验（Hook 4–12、正文 50–70、背景 40–60）
  store.mjs       <data>/v5 存储：经历、raw、narrative、content、questions、runs、debug
  markdown.mjs    旧 Story Markdown 解析/序列化（生成缓存兼容）
  narrative.mjs   v6 经历正文：front matter + 自然段；ExperiencePatch 应用
  ingest.mjs      v6 自动增量：raw → Patch → 正文 → Story 自动派生（无人工确认）
  llm.mjs         DeepSeek / mock JSON 调用
  prompts.mjs     P1–P11 提示词（P11=ExperiencePatch，P6=三区编译）
  mock.mjs        离线确定性输出
  extract.mjs     旧 v5 一遍抽取/确认（保留兼容）
  questions.mjs   A3 候选（C 方案）、P2/P10、Question 状态/UI 3 槽
  retrieval.mjs   R4 每经历并行、A1 合并/覆盖
  generate.mjs    R5 计划（含 strategy）、R6 三区、A2、R7、R8
  pipeline.mjs    端到端编排
prototype/v5-cli.mjs
prototype/tests/v5-core.test.mjs
```

## 2. v6 主流程（无人工确认）

```bash
npm run v5 -- create --type project --name "..." --role "..." --time "..."
npm run v5 -- ingest --exp <id> --text-file raw.txt
npm run v5 -- narrative --exp <id>
npm run v5 -- edit-narrative --exp <id> --text-file narrative.md
npm run v5 -- derive --exp <id>
npm run v5 -- generate --jd-file jd.md [--no-background] [--tech-stack]
```

`ingest` 执行：

```
append raw
→ P11 生成 ExperiencePatch（按时间/逻辑插入或合并）
→ 自动应用（不确认）
→ 写 narrative.md
→ P1 从正文自动派生 Story
→ 写 content.md（生成缓存）
→ 返回 applied/skipped/unresolved + Story 数
```

旧 `input/confirm` 仍在，但只用于旧 Story 结构兼容；v6 用 `ingest`。

## 3. 生成方法论（已接入）

R5 输出：

```json
{ "strategy": { "hook_level": "L1|L2|L3", "body_pattern": "XYZ|CAR|PAR", "jd_focus": "" } }
```

R6 三区：

1. **项目背景**（可选，40–60 字）：场景/痛点 + 阶段跨度与主导定位 + 产品形态；
2. **Hook**（4–12 字符）：全篇同一 L1/L2/L3 水位，禁止空词；
3. **正文**（50–70 字）：XYZ/CAR/PAR 全局锁定；单点聚焦、第一句扣 Hook、结尾落在数字/交付物/状态。

可选板块：

- `show_background`（默认 true）：关闭时输出无 `project_background`；
- `show_tech_stack`（默认 false）：开启时输出 `tech_stack: string[]`（每项 ≤40 字）。

A2 校验：

- 背景（若展示）40–60；Hook 4–12；正文 50–70；
- `story_id`/`jd_quote`/`evidence_quote`；
- `jd_quote` 在 JD 原文；父 Story 不得作证据；重复 bullet；括号闭合；数字无依据（warning）。

## 4. C 方案（零覆盖）

- 有锚点：未选 direct/adjacent Story → `adjacent_unselected`；已选未展开 → `unrealized_potential`；经历级锚点（R4 use/missing）→ `coverage_missing`，`action=add_story`，target=experience；
- 无锚点：不生成问题，只进 Critic `coverage` issue；
- 全部候选输出，UI 只取 3 条。

## 5. 测试

```bash
npm test                 # v2 + v6，共 17 项
node --test prototype/tests/v5-core.test.mjs
```

覆盖：旧 Story 父子/摘要/归属/范围；mock 旧链路；未分配硬错误；问题状态/UI；P10 候选；C 方案 experience 级候选；假候选拒绝；手改 Markdown；Fragment 二次确认；v6 自动 ingest（无确认）+ 生成；可选背景/技术栈。

## 6. 真实 smoke（v6，2026-11-25）

- 3 段真实经历自动 ingest：applied 2/4/3，stories 6/4/3；无人工确认；
- 生成：3 段经历、10 bullets、7 条简历问题；strategy=L2/PAR；背景 59–60 字、技术栈 1–2 项；
- 仍有 1 条 content 45 字 <50（validation error，不自动补字）。

## 7. 已知边界（未解决）

1. 现有旧数据仍是 `content.md` Story 结构；v6 新经历使用 `narrative.md`，迁移工具未做。
2. 逐节点 debug 仍只覆盖部分节点；P3 只有 prompt 未接线。
3. `library<3` 硬失败；真实 2 段经历无法出稿。
4. 真实 P11/P1 的 Patch/Story 质量未做大规模人工评估；真实 smoke 仍有长度/覆盖问题。
5. 前端/气泡 UI 未实现，只有 CLI。
6. 合规报告 `COMPLIANCE-REPORT.md` 基于旧 HEAD，未覆盖 v6 自动 ingest/方法论。
