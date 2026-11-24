# 真实数据评测（7 段经历 × 2 份 JD）

用途：用真实经历库跑一次 **输入→卡片抽取→scan→compose→comments**，输出可复现的自动指标，作为后续改动基线。

## 评测集

| 项 | 内容 |
| --- | --- |
| 经历 | `沙盒数据-真实语料-v3` 的 7 段经历 |
| JD | `回归集/jd-01-市场部实习生.md`、`jd-02-AI产品实习生.md` |
| 模型 | `deepseek-flash`（`.local-ai.json`） |
| 隔离 | 每次运行把数据复制到 `prototype/eval/runtime/`，不污染原始数据 |

主相关经历是人工设定的评测标签，不是完美 qrels；见 `run-real.mjs` 的 `EXPECTED`。

## 运行

```bash
# 真实抽取 + 两份 JD 生成
node prototype/eval/run-real.mjs

# 复用现有卡片（不重新抽取）
node prototype/eval/run-real.mjs --reuse-cards --skip-import

# 对最新报告补充规划/表达质量指标
node prototype/eval/analyze.mjs
```

输出：

- `prototype/eval/reports/real-7x2-<timestamp>/report.md`
- `report.json`
- `analysis.md` / `analysis.json`（由 `analyze.mjs` 追加）
- `runs/`（本次 scan/compose 运行记录）

## 指标

### 抽取

| 指标 | 含义 |
| --- | --- |
| verified 率 | 卡片是否都已确认 |
| 槽位填充率 | 6 个槽位非空/非“未提及”的比例 |
| 原话命中率 | `raw_quote` 能否在经历 raw 中找到 |
| 数字无依据 | 槽位中的数字不在 raw 中的比例 |
| 引用覆盖率 | 卡片引用覆盖 raw 字符的比例（低是提纯，不等于错） |
| 卡片数/经历 | 检查切分密度（当前 prompt 目标 4–8） |

### 生成

| 指标 | 含义 |
| --- | --- |
| 主相关召回 | 人工主相关经历被选中的比例 |
| 主相关精确 | 选中经历中属于主相关的比例 |
| 选经历数合规 | 是否 3–4 段 |
| 每段 bullet 分布 | 是否约 4 条/段 |
| 结构错误 | 背景/字数/hook/card_id/溯源字段 |
| 溯源命中 | bullet 的 `raw_quote` 能否在 raw 中核对 |
| 数字无依据 | bullet 中的数字不在 raw 中出现 |
| 标点平衡率 | 括号等是否闭合（结构校验抓不到的语病） |
| 重复 bullet 对 | bigram Jaccard ≥0.55 的重复内容 |
| 评论锚点 | comments 是否锚定到真实 bullet |

## 局限

1. 主相关经历是人工设定，样本小（2 份 JD），不能当统计显著性结论。
2. 抽取用当前 v2.3 六槽位 prompt，不是最新 `INPUT-FOLLOW` 的 Story 准入/问题引擎。
3. 自动指标不能替代人工逐条阅读；建议每份 JD 至少人工看 3 条 bullet。
4. 不要把真实评测报告提交到公开仓库（`.gitignore` 已忽略 `reports/` 与 `runtime/`）。
