# 数据契约（DATA CONTRACT）

所有数据都在 `WORKBENCH_DATA_DIR` 下（默认 `prototype/local-data`；沙盒用工作区的 `沙盒数据-*`）。
目录必须整体可拷贝，不允许写死绝对路径。

## 目录结构

```
<DATA>/
├── current.json                     # { revision: <最新快照号> }
├── profile.json                     # 基础信息 markdown（姓名/教育等）
├── raw/                             # 原始口述（建卡的事实来源）
│   └── raw_<id>.json                # { experience_id, messages:[{role,content,...}], at }
├── snapshots/<rev>/
│   ├── index.json                   # wiki 索引：nodes(经历/故事/片段/主题)+relations+sources
│   └── wiki/*.md                    # 各经历的 Markdown 正文
├── conversations/<exp_id>/          # 经历助手的问答记录（可选，模型链路不依赖）
├── v2/
│   ├── cards.json                   # ★ 核心输入：经历 + 6 槽位卡片
│   └── runs/<run_id>.json           # ★ 每次链路的完整留痕
└── runs/                            # 旧版工作台运行记录（模型链路不依赖）
```

## 生产/消费关系

| 数据 | 生产 | 消费 | 不变量 |
| --- | --- | --- | --- |
| `raw/*.json` | 用户录入 | import 建卡 | 每个文件必须有 `experience_id` 和非空 `messages` |
| `snapshots/*/index.json` | 经历库 | import 建卡 | `nodes[].kind=experience` 的 `id` 唯一、`status` 合法 |
| `v2/cards.json` | import（或人工维护） | scan / compose / gap / graph | 卡片 `exp_id` 必须存在于 experiences；`card_id` 唯一；`quality_grade ∈ {S,A,B}`；`raw_quote` 非空；`is_verified` |
| `v2/runs/<id>.json` | scan/compose/comments/gap | 复盘、校验、graph | `scan.selected_cards` ⊆ cards；`content.bullets[].card_id` ⊆ cards；`comments[].bullet_id` ⊆ 本次 bullets |
| `profile.json` | 用户维护 | 旧版渲染（模型链路不依赖） | Markdown 字符串 |

## 卡片字段（`v2/cards.json`）

```json
{
  "schema": "v2-1",
  "experiences": [
    { "exp_id": "exp_x", "category": "internship|campus|project|work|volunteer|other", "title": "...", "spine_summary": "..." }
  ],
  "cards": [
    {
      "card_id": "exp_x_c1", "exp_id": "exp_x", "step_order": 1,
      "toc_title": "20 字以内",
      "quality_grade": "S|A|B",
      "slot_stage": "...", "slot_module": "...", "slot_problem": "...",
      "slot_workflow": "...", "slot_tech_link": "...", "slot_outcome": "...",
      "raw_quote": "逐字原话", "linked_nodes": [{ "node_name": "...", "node_type": "tech|product|domain" }],
      "is_verified": true, "source": "raw|gap"
    }
  ]
}
```

## 运行记录（`v2/runs/<id>.json`）

| 字段 | 由谁写 | 说明 |
| --- | --- | --- |
| `run_id / jd / created_at` | scan | 一次扫描 = 一个 run |
| `scan` | scan | `jd_analysis` + `experience_rankings` |
| `selections` | compose | 用户/CLI 选择的卡片与策略 |
| `content` | compose | `experiences[].project_background + bullets[].checks` |
| `comments` | comments | 锚定 bullet 的问题 |
| `gap_cards` | gap | 补出来的卡片 |

## 校验方式

```bash
# 结构 + 引用一致性（不调用模型）
WORKBENCH_DATA_DIR=... node prototype/cli.mjs state
node --test prototype/tests/data-deps.test.mjs    # 读数据目录做完整性检查

# 单次运行的内容质量
node prototype/cli.mjs check --run v2run_xxx
```

## 已知边界

- `import` 依赖 `snapshots` + `raw`；只有 `cards.json` 时不能重建卡片，但 scan 之后全部可用；
- `conversations/` 与 `runs/`（旧版）不参与模型链路，可清空；
- `cards.json` 是唯一事实源，删它等于重置知识库。
