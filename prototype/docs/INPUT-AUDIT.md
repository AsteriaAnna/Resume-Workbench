# 输入审计（INPUT AUDIT）

> 对照当前 `main`（核心链路版：前端已移除）逐项核对"我们应该有什么输入"。
> 代码依据：`prototype/v2.mjs`、`prototype/cli.mjs`、`prototype/serve.mjs`、`prototype/workbench.mjs`。

---

## 0. 结论

| 你列的输入 | 现状 | 说明 |
| --- | --- | --- |
| ① 经历库：点已有经历继续输入 | **能力在、入口丢** | `workbench.updateWiki()` 存在；当前 API/CLI 没有暴露；前端删除后无入口 |
| ① 经历库：新建经历并输入 | **能力在、入口丢** | `workbench.createWikiExperience()` 存在；同样未暴露 |
| ② 简历制作：输入 JD | ✅ 可用 | `scan(jd)`；CLI `scan --jd/--jd-file`，API `POST /api/v2/scan` |
| ② 选择关键词级别（hook_level） | ⚠️ 半可用 | 显示为 scan 的**输出**；只能在 compose 的 `selections[].strategy` 里覆盖；无 CLI 参数、无 UI |
| ② 选择内容表达方式（body_pattern） | ⚠️ 半可用 | 同上：扫描推荐 + compose 覆盖可用，但没有"生成前选择"的独立入口 |
| ③ 生成后评论 → 回答 → 补 bullet + 补经历库 | ✅ 可用（无"点击"） | `comments()` + `gapCard()`；CLI `comments/gap`，API `/comments`、`/gap` |
| ③ 评论的判断依据 | ✅ 但不是独立重扫 | 输入是 JD + 已生成 bullets + scan.gaps + 未选中的 S/A 卡；不会重扫全库 |
| ③ 回答后增加 bullet | ✅ | 新卡入库 → 只重编译该段经历 → 该段多一条 bullet |
| ③ 回答后补充经历库 | ✅ | 新卡写入 `v2/cards.json`（`source=gap`，重新分级） |

**一句话**：#3 完整；#2 的 JD 有、两个"选择"只剩 API 覆盖；#1 完全缺入口（删前端时一起丢了）。

---

## 1. 三类输入的调用链

### ① 经历库输入（当前缺失）

```
（前端已删）
workbench.updateWiki({ experience_id, message }, call)
workbench.createWikiExperience({ message }, call)
  → llm.call('check_extension') 判定是否属于当前经历
  → llm.call('wiki_update') 整理成新快照
  → snapshots/<rev>/ + raw/raw_*.json
```

- 已有经历补充：`experience_id` + 用户口述；会被 `check_extension` 拒绝"与当前经历无关"的输入。
- 新建经历：不传 `experience_id`，`create:true`。
- **缺口**：`serve.mjs` 只有 `/health` 与 `/api/v2/*`；`cli.mjs` 没有 wiki 命令；`workbench.mjs` 仍保留函数但无人调用。

### ② 简历生成输入

```
JD ──scan(jd)──▶ jd_analysis{ jd_focus, hook_level, body_pattern } + rankings
selections[{ exp_id, card_ids, strategy? }] ──compose──▶ content
```

- **JD**：必填，唯一硬输入。
- **hook_level / body_pattern**：scan 输出"推荐值"，compose 时若 `selections[].strategy` 提供则覆盖（`const s = { ...defaults, ...(sel.strategy || {}) }`）。
- **缺口**：`scan()` 不接受 hook_level/body_pattern 参数；CLI 没有 `--hook-level/--body-pattern/--jd-focus`；只能手写 `--select-file` 的 JSON。当前没有"生成前选择"的界面/参数。

### ③ 评论 → 补卡（完整）

```
content ──comments(run_id)──▶ comments[{ bullet_id, question, reason }]
comments + comment_id + answer ──gapCard──▶ 新卡 + 该段重编译 + comment.resolved
```

- 评论输入：`jd` + 已生成 `bullets` + `scan.gaps` + 未选中的 S/A 卡（最多 20）。
- 评论约束：最多 4 条；必须锚定本次的 `bullet_id`；模型失败用 gaps 兜底。
- 补卡输入：`comment_id` + `answer`；模型若判断证据不足 → `insufficient + 追问`（不改库）。
- 补卡输出：新卡（`source=gap`，重新 grade）→ `cards.json`；只重编译该经历；`resolved=true`。

---

## 2. 三类之外，目前还存在哪些输入

| 输入 | 类型 | 入口 | 消费阶段 | 现状 |
| --- | --- | --- | --- | --- |
| `raw/*.json` + `snapshots/index.json` | 用户/数据 | `import` CLI/API | ① import | ✅ 建库唯一入口 |
| `selections`（选哪些卡、顺序） | 用户 | compose `selections[].card_ids` | ③ compose | ✅ API 可传；CLI 只能用 `--select-file` 或自动用 scan 推荐 |
| `selections[].strategy.jd_focus` | 用户 | compose | ③ compose | ✅ 覆盖扫描值；无 CLI 参数 |
| `run_id` | 会话 | CLI `--run`、API body | compose/comments/gap | ✅ 续跑定位 |
| `comment_id` | 交互 | CLI `--comment`、API body | gap | ✅ 选哪条评论回答 |
| `answer` | 用户 | CLI `--answer`、API body | gap | ✅ 补卡回答 |
| `WORKBENCH_DATA_DIR` | 环境 | 进程环境 | 全链路 | ✅ 数据目录 |
| `DEEPSEEK_MOCK` | 环境 | 进程环境 | 全链路 | ✅ 离线测试 |
| `profile.json` | 数据 | 文件 | 旧版渲染 | ⚠️ 核心链路不读 |
| `match_reason` | 内部 | scan→compose | compose 聚焦 | ✅ 用户不可见 |
| 旧 `recommended_strategy` | 兼容 | run.scan | compose 回退 | ✅ 仅回退 depth |
| 历史 `runs/` | 审计 | 文件 | 测试/复盘 | ⚠️ 不参与生成；cards 重建后 stale |
| `graph()` | 只读 | CLI/API | 观察 | ✅ 不影响生成 |

### 没有的输入（潜在缺口）

1. 经历库"编辑正文 / 删除经历"（只有追加式补充与新建）；
2. 卡片手工编辑 / 删除 / 合并（只能通过 gap 追加）；
3. 评论生成的开关/条数/侧重点（固定最多 4 条，输入里没有偏好）；
4. 多轮追问：insufficient 后只能再调一次 gap，没有"对话式追问"；
5. 批量选卡的交互（前端删除后，只剩 `--select-file`）；
6. 重新导入原始语料后的增量更新（`import` 目前是全量重建 cards）。

---

## 3. 建议的最小补齐（按优先级）

1. **补 #1 的入口**（最急）：
   - `cli.mjs wiki-input --exp <id> --message "..."`、`wiki-create --message "..."`；
   - API `POST /api/wiki/input`、`POST /api/wiki/create`，内部调用 `updateWiki/createWikiExperience` + `llm.call`；
   - 这一步做完，经历库才重新"可写入"。
2. **补 #2 的选择参数**：
   - `scan --hook-level L2 --body-pattern CAR --jd-focus "..."`（扫描前锁定）；
   - `compose --hook-level/--body-pattern/--jd-focus`（覆盖扫描推荐）；
   - 两者都落到 `selections[].strategy`，不改模型协议。
3. **补 #3 的"回答后自动追问"**：`gap` 返回 insufficient 时 CLI 交互读入下一轮回答，最多 2 轮。
4. **补卡片/经历维护**：`card-edit` / `card-delete`（需先定义删除对历史 run 的影响）。

---

## 4. 输入总图（文字版）

```
知识库写入：
  raw + snapshots --import--> cards.json
  （缺失）existing experience + message --> workbench.updateWiki --> snapshots/raw
  （缺失）new experience + message       --> createWikiExperience --> snapshots/raw
  cards + gap(answer)                   --> 新卡 --> cards.json

生成配置：
  JD --scan--> jd_analysis(hook_level/body_pattern/jd_focus) + rankings
  selections(card_ids, strategy?) --compose--> content

交互补充：
  content --comments--> comments
  comments + answer --gap--> 新卡 + 该段重编译
```
