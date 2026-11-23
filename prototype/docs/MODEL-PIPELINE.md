# 模型链路（MODEL PIPELINE）

当前项目**只有模型链路 + JSON API/CLI**，没有前端。所有模型调用集中在 `prototype/v2.mjs`（提示词也在这里），底层 HTTP 在 `callLLM()`。

## 五个阶段

```
raw 原始口述
  │ ① import  PROMPT_INGEST（temperature 0.3）
  ▼
cards.json（6 槽位决策卡 + 静态分级 S/A/B）
  │ ② scan   PROMPT_SCAN（temperature 0.2）
  ▼
run.scan（jd_analysis + 经历排序/选卡/match_reason/gaps）
  │ ③ compose PROMPT_COMPILE（temperature 0.4）
  │    └─ 字数/风格归一化 PROMPT_FIT + 短句扩写（temperature 0.2，最多 3 轮 + 兜底）
  ▼
run.content（project_background + bullets[focus_angle/hook/content/raw_quote/checks]）
  │ ④ comments PROMPT_COMMENTS
  ▼
run.comments（气泡问题，锚定 bullet）
  │ ⑤ gap    PROMPT_GAPCARD（回答不足会返回 insufficient + 追问）
  ▼
新卡片入库 + 只重编译该段经历 + comment.resolved=true
```

## 模型参数

| 阶段 | max_tokens | temperature | 输出协议 |
| --- | --- | --- | --- |
| import | 8000 | 0.3 | JSON object |
| scan | 5000 | 0.2 | JSON object |
| compose | 4000 | 0.4 | JSON object |
| fit / expand | 3000 / 2500 | 0.2 | JSON object |
| comments | 2000 | — | JSON object |
| gapcard | 3000 | — | JSON object |

- 全部走 `response_format: json_object`，超时 240s，仅 JSON 解析失败重试一次；
- `DEEPSEEK_MOCK=1` 时完全不请求模型，使用 `prototype/mock.mjs` 的确定性输出（CI/离线测试用）。

## 输入/输出质量闸门

1. **建卡**：槽位缺失填「未提及」；`raw_quote` 必须来自原话；静态规则 `grade()` 打 S/A/B。
2. **扫描**：必须覆盖每个经历；`selected_cards` 必须来自输入卡片；`jd_analysis` 必须含 `jd_focus/hook_level/body_pattern`。
3. **编译**：
   - 1 卡 1 bullet，`card_id` 必须存在；
   - `project_background` 40~60 字且完整句（以。或；结尾）；
   - `hook` 4~12 字符；`content` 35~80 字（舒适区 50~75）；
   - 禁止评价性收尾（体现/展现/验证/确保/保障 + 能力/效果/质量）；
   - content 不得以 `【` 开头或重复 hook；
   - `raw_quote` 必须来自卡片，保证可溯源；
   - 超限走 `PROMPT_FIT` 改写（最多 3 轮）→ 仍超则 `hardTrim` 兜底并记录 `fit`。
4. **评论**：最多 4 条，必须锚定已存在 `bullet_id`。
5. **补卡**：回答不足返回 `insufficient + 追问`，不编造；成功则新卡入库、该段重编译、评论 resolved。

## 提示词位置

全部在 `prototype/v2.mjs` 顶部区域（`PROMPT_INGEST / PROMPT_SCAN / PROMPT_COMPILE / PROMPT_FIT / PROMPT_COMMENTS / PROMPT_GAPCARD`）。扫描/编译的策略参数由 `scan.jd_analysis` 注入，不由前端控制。

## 入口

```bash
# 离线测试（不花钱）
DEEPSEEK_MOCK=1 node prototype/cli.mjs pipeline --jd-file 回归集/jd-01-市场部实习生.md

# 真实模型
WORKBENCH_DATA_DIR=... node prototype/cli.mjs pipeline --jd-file ... 

# 仅 API（无前端）
node prototype/serve.mjs   # GET /health, /api/v2/*
```
