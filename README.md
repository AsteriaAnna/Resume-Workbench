# 简历工作台 · 核心链路

> 当前仓库**只有模型链路与数据层**，前端（页面/图谱/调试台）已移除。
> 目标：把关键环节的输入、输出和质量闸门测清楚，再谈展示。

## 链路

```
raw 原始口述 → ① 建卡 → cards.json → ② JD 语义扫描 → run.scan
             → ③ 三区编译（背景 + Hook + 正文）→ run.content
             → ④ 评论 → run.comments → ⑤ 补卡 → 新卡 + 该段重编译
```

详细说明：
- [prototype/docs/MODEL-PIPELINE.md](prototype/docs/MODEL-PIPELINE.md) — 每个阶段的提示词、参数、质量闸门
- [prototype/docs/DATA-CONTRACT.md](prototype/docs/DATA-CONTRACT.md) — 数据目录结构与引用不变量

## 快速开始

需要 Node 20+，零依赖。

```bash
# 1) 看一眼知识库
node prototype/cli.mjs state

# 2) 离线跑通（不调用模型）
DEEPSEEK_MOCK=1 node prototype/cli.mjs pipeline --jd-file 回归集/jd-01-市场部实习生.md

# 3) 真实模型（需要数据目录和 DeepSeek 密钥）
$env:WORKBENCH_DATA_DIR="$PWD\..\沙盒数据-真实语料-v3"
node prototype/cli.mjs scan --jd-file ../回归集/jd-01-市场部实习生.md
node prototype/cli.mjs compose --run v2run_xxx
node prototype/cli.mjs comments --run v2run_xxx
node prototype/cli.mjs gap --run v2run_xxx --comment cm_1 --answer "补充：口径是……"
node prototype/cli.mjs check --run v2run_xxx

# 4) 只启 JSON API（无前端）
node prototype/serve.mjs   # GET /health；/api/v2/*
```

## 测试

```bash
npm test                      # mock 链路 + 数据契约（离线、确定性）
npm run test:live             # 真实模型冒烟（LIVE=1 且配置密钥）
```

测试覆盖：
- 扫描输出结构、选卡引用合法性；
- 编译的 1 卡 1 bullet、字数、Hook、溯源、反八股；
- 评论锚点；补卡入库/重编译/resolved；
- 图谱节点与边的一致性；
- 数据目录（raw / snapshots / cards / runs）的结构与引用不变量。

## 核心文件

| 文件 | 作用 |
| --- | --- |
| `prototype/v2.mjs` | 模型链路：提示词、扫描、编译、评论、补卡、图谱、JSON 路由 |
| `prototype/llm.mjs` | 模型连接配置（旧 Wiki 任务保留） |
| `prototype/workbench.mjs` | 经历库/快照/原始语料读取（建卡依赖） |
| `prototype/mock.mjs` | 离线确定性模型替身（`DEEPSEEK_MOCK=1`） |
| `prototype/cli.mjs` | 阶段命令入口 |
| `prototype/serve.mjs` | 精简 JSON API |
| `prototype/tests/` | 契约测试、数据依赖测试、live 冒烟 |
