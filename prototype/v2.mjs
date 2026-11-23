import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { state, profile } from './workbench.mjs';
import { mockCall } from './mock.mjs';

const dataRoot = path.resolve(process.env.WORKBENCH_DATA_DIR || path.join(import.meta.dirname, 'local-data'));
const v2Root = path.join(dataRoot, 'v2');
const cardsFile = path.join(v2Root, 'cards.json');
const runsDir = path.join(v2Root, 'runs');
const id = (p) => `${p}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
const readJson = async (p, fallback) => { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } };
const writeJson = async (p, v) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, JSON.stringify(v, null, 2), 'utf8'); };

const aiCfg = async () => {
  let local = {};
  try { local = JSON.parse(await fs.readFile(path.join(import.meta.dirname, '.local-ai.json'), 'utf8')); } catch {}
  return { key: process.env.DEEPSEEK_API_KEY || local.apiKey, base: local.baseUrl || 'https://api.deepseek.com/chat/completions', model: process.env.DEEPSEEK_MODEL || local.model || 'deepseek-flash' };
};

async function callLLM(system, user, maxTokens = 5000, tag = '', temperature = 0.2) {
  if (process.env.DEEPSEEK_MOCK === '1') return mockCall({ tag, system, user });
  const cfg = await aiCfg();
  if (!cfg.key) throw Object.assign(new Error('DeepSeek 密钥未配置'), { code: 'NO_KEY' });
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 240000);
    try {
      const res = await fetch(cfg.base, {
        method: 'POST', signal: ctrl.signal,
        headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: cfg.model, temperature, reasoning_effort: 'none', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_object' }, max_tokens: maxTokens }),
      });
      if (!res.ok) { const detail = await res.text().catch(() => ''); throw new Error(`DeepSeek HTTP ${res.status} ${detail.slice(0, 200)}`); }
      const data = await res.json();
      return { json: JSON.parse(data.choices?.[0]?.message?.content || '{}'), usage: data.usage || {} , tag };
    } catch (e) {
      last = e;
    } finally { clearTimeout(timer); }
  }
  throw last;
}

// ---------- 提示词 ----------
const STRATEGIES = `1. 功能模块型：钩子突出业务/功能模块名；正文按模块职责与核心功能点展开。
2. 工作流程型：钩子突出端到端链路；正文按「输入→处理步骤→交付输出」展开。
3. 问题解决型：钩子突出核心痛点；正文按「卡点→方案权衡→落地解法与结果」展开。
4. 业务成果型：钩子突出核心收益/指标；正文结论先行，再拆解达成路径。
5. 技术链路型：钩子突出技术栈/架构；正文按组件选型、数据流转与连接关系展开。
6. 项目阶段型：钩子突出阶段里程碑；正文按时间演进阶段递进展开。
7. 核心能力型：钩子突出岗位匹配的核心能力；正文用具体动作佐证。`;

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

const PROMPT_FIT = `# Role
你是简历字数与风格归一化器。严格不新增事实、不删关键数字/工具/结果，保持原 hook 与叙事骨架。

# Rules
1. project_background 目标 40-60 字，必须是完整句子（以。或；结尾），不得截断成病句。
2. 每条 bullet 的 content 目标 50-75 字、可接受 35-80 字（含标点）；>80 必须删到 ≤80；<35 可适度补充。
3. 只围绕 focus_angle 的一个抓手，删修饰、合并从句；允许只保留 2~3 个要素，不得只做同义替换。
4. 若结尾是评价性表述（体现了…能力 / 展现了… / 验证了… / 确保了… / 保障了…），改成事实、数字或交付物收尾。
5. content 中不要重复 hook、不要带【】前缀；不改 hook、不改 card_id。
6. 只返回 JSON：{ "project_background": "...", "bullets": [ { "card_id": "...", "content": "..." } ] }`;

function offendersOf(exp) {
  const bgLen = charLen(exp.project_background);
  const bgBad = bgLen < 40 || bgLen > 60 || !/[。；]\s*$/.test(String(exp.project_background || '').trim());
  const bad = exp.bullets.filter((b) => b.checks.content_len < 35 || b.checks.content_len > 80 || b.checks.eval_end || b.checks.hook_repeated);
  return { bgBad, bad };
}

function hardTrim(text, min, max) {
  let t = String(text || '').trim();
  if (charLen(t) <= max) return t;
  const parts = t.split(/(?<=[，。；、])/).filter((x) => x.trim());
  while (charLen(parts.join('')) > max && parts.length > 2) {
    let cand = -1, worst = Infinity;
    for (let i = 0; i < parts.length - 1; i++) {
      const c = parts[i];
      const hasNum = /\d/.test(c), hasTool = /Excel|飞书|豆包|问卷星|HTML|SQL|Newsletter|PR|AI/i.test(c);
      const score = (hasNum ? 2 : 0) + (hasTool ? 2 : 0) - charLen(c) / 50;
      if (score < worst) { worst = score; cand = i; }
    }
    if (cand < 0) break;
    parts.splice(cand, 1);
  }
  t = parts.join('');
  if (charLen(t) > max) t = [...t].slice(0, max - 1).join('') + '…';
  return t.trim();
}

async function fitExperience(exp) {
  let { bgBad, bad } = offendersOf(exp);
  for (let pass = 0; pass < 3 && (bgBad || bad.length); pass++) {
    const payload = {
      project_background: exp.project_background,
      bullets: bad.map((b) => {
        const card = exp.cards.find((c) => c.card_id === b.card_id) || {};
        return {
          card_id: b.card_id, hook: b.hook, focus_angle: b.focus_angle, content: b.content,
          facts: { problem: card.slot_problem, workflow: card.slot_workflow, outcome: card.slot_outcome },
          current_len: [...b.content].length,
        };
      }),
    };
    let json = null;
    try { ({ json } = await callLLM(PROMPT_FIT, JSON.stringify(payload, null, 2), 3000, 'fit', 0.2)); } catch { break; }
    if (!json) break;
    if (bgBad && typeof json.project_background === 'string' && json.project_background.trim()) exp.project_background = json.project_background.trim();
    for (const nb of json.bullets || []) {
      const target = exp.bullets.find((b) => b.card_id === nb.card_id);
      if (target && typeof nb.content === 'string' && nb.content.trim()) target.content = nb.content.trim();
    }
    // 重新计算 checks
    for (const b of exp.bullets) b.checks = checkBullet(b);
    ({ bgBad, bad } = offendersOf(exp));
  }
  // 兜底：LLM 三轮仍超长时，按分句裁剪（保留末句结论 + 含数字/工具的从句）
  const hard = [];
  if (bgBad) { exp.project_background = hardTrim(exp.project_background, 40, 60); hard.push('project_background'); }
  for (const b of bad) { b.content = hardTrim(b.content, 35, 80); hard.push(b.card_id); b.checks = checkBullet(b); }
  const stillBad = exp.bullets.filter((b) => b.checks.content_len < 45 || b.checks.content_len > 80 || b.checks.eval_end || b.checks.hook_repeated);
  // 过短的 bullet：再补一次（只能从 facts 里取具体动作/数字，禁止编造）
  let short = exp.bullets.filter((b) => b.checks.content_len < 35);
  if (short.length) {
    const payload = {
      task: 'expand',
      instruction: '以下 Bullet 过短（<45 字）。请只使用 facts 中的具体动作、工具或数字补到 50-70 字，不得新增事实。',
      bullets: short.map((b) => {
        const card = exp.cards.find((c) => c.card_id === b.card_id) || {};
        return { card_id: b.card_id, hook: b.hook, content: b.content, current_len: [...b.content].length, facts: { problem: card.slot_problem, workflow: card.slot_workflow, outcome: card.slot_outcome } };
      }),
    };
    try {
      const { json } = await callLLM(PROMPT_FIT, JSON.stringify(payload, null, 2), 2500, 'expand', 0.2);
      for (const nb of json.bullets || []) {
        const t = exp.bullets.find((b) => b.card_id === nb.card_id);
        if (t && typeof nb.content === 'string' && nb.content.trim()) t.content = nb.content.trim();
      }
      for (const b of exp.bullets) b.checks = checkBullet(b);
      short = exp.bullets.filter((b) => b.checks.content_len < 35);
    } catch {}
  }
  const stillBad2 = exp.bullets.filter((b) => b.checks.content_len < 35 || b.checks.content_len > 80 || b.checks.eval_end || b.checks.hook_repeated);
  exp.background_len = charLen(exp.project_background);
  exp.fit = { background_ok: charLen(exp.project_background) >= 40 && charLen(exp.project_background) <= 60, bullets_ok: stillBad2.length === 0, hard_trimmed: hard, short_after_expand: short.map((b) => b.card_id), remaining_offenders: stillBad2.map((b) => ({ card_id: b.card_id, len: b.checks.content_len })) };
}

async function compose(runId, selections) {
  const run = await readJson(path.join(runsDir, `${runId}.json`), null);
  if (!run) throw Object.assign(new Error('运行不存在'), { code: 'NO_RUN' });
  const db = await loadCards();
  const jdAnalysis = run.scan?.jd_analysis || {};
  const legacy = jdAnalysis.recommended_strategy || {};
  const defaults = {
    jd_focus: jdAnalysis.jd_focus || '',
    hook_level: jdAnalysis.hook_level || (String(legacy.depth || 'L2').replace(/[^L123]/g, '') ? `L${String(legacy.depth || 'L2').replace(/[^123]/g, '')}` : 'L2'),
    body_pattern: jdAnalysis.body_pattern || 'CAR',
  };
  // 卡片 → 扫描给出的 match_reason（编译时做单点聚焦）
  const matchReasons = new Map();
  for (const r of run.scan?.experience_rankings || []) for (const c of r.selected_cards || []) if (c.match_reason) matchReasons.set(c.card_id, c.match_reason);

  const results = [];
  for (const sel of selections || []) {
    const exp = db.experiences.find((e) => e.exp_id === sel.exp_id);
    if (!exp) continue;
    const cards = (sel.card_ids || []).map((cid) => db.cards.find((c) => c.card_id === cid)).filter(Boolean).sort((a, b) => a.step_order - b.step_order);
    if (!cards.length) continue;
    const s = { ...defaults, ...(sel.strategy || {}) };
    const user = `经历主干（${exp.title}，${exp.category}）：\n${exp.spine_summary}\n\n已选卡片（按 step_order 升序；match_reason 是扫描阶段给出的匹配切入点，正文必须围绕它做单点聚焦）：\n${JSON.stringify(cards.map((c) => ({
      card_id: c.card_id, step_order: c.step_order, quality_grade: c.quality_grade, toc_title: c.toc_title,
      match_reason: matchReasons.get(c.card_id) || '',
      slot_stage: c.slot_stage, slot_module: c.slot_module, slot_problem: c.slot_problem,
      slot_workflow: c.slot_workflow, slot_tech_link: c.slot_tech_link, slot_outcome: c.slot_outcome,
    })), null, 2)}\n\n要求输出恰好 ${cards.length} 条 bullet，每个 card_id 用一次，并给出 project_background。`;
    let json = { bullets: [] };
    try {
      ({ json } = await callLLM(PROMPT_COMPILE(s), user, 4000, 'compile', 0.4));
    } catch (e) {
      results.push({ exp_id: exp.exp_id, title: exp.title, category: exp.category, cards, strategy: s, project_background: '', bullets: [], error: e.message });
      continue;
    }
    const bullets = (json.bullets || []).map((b, i) => {
      const card = cards.find((c) => c.card_id === b.card_id);
      let rawContent = String(b.content || '').trim().replace(/^【[^】]{1,24}】\s*/, '');
      const hk = String(b.hook || '').trim();
      if (hk && rawContent.startsWith(hk)) rawContent = rawContent.slice(hk.length).replace(/^[：:、，\s]+/, '');
      const bullet = {
        bullet_id: `${exp.exp_id}_b${i + 1}`,
        card_id: b.card_id || '',
        focus_angle: String(b.focus_angle || '').trim(),
        hook: String(b.hook || '').trim(),
        content: rawContent,
        match_reason: matchReasons.get(b.card_id) || '',
        raw_quote: card?.raw_quote || '',
      };
      return { ...bullet, checks: checkBullet(bullet) };
    });
    results.push({
      exp_id: exp.exp_id, title: exp.title, category: exp.category,
      project_background: String(json.project_background || '').trim(),
      strategy: s, cards, bullets,
    });
  }
  for (const r of results) { try { await fitExperience(r); } catch (e) { r.fit = { error: e.message }; } }
  run.selections = selections;
  run.content = { experiences: results, strategy_defaults: defaults };
  run.comments = [];
  await writeJson(path.join(runsDir, `${runId}.json`), run);
  return run;
}

// ---------- 生成气泡评论 ----------
async function comments(runId) {
  const run = await readJson(path.join(runsDir, `${runId}.json`), null);
  if (!run || !run.content) throw Object.assign(new Error('请先生成内容'), { code: 'NO_CONTENT' });
  const db = await loadCards();
  const gaps = (run.scan?.experience_rankings || []).flatMap((r) => (r.gaps || []).map((g) => ({ exp_id: r.exp_id, exp_title: db.experiences.find((e) => e.exp_id === r.exp_id)?.title || r.exp_id, gap: g })));
  const selectedIds = new Set(run.content.experiences.flatMap((e) => e.bullets.map((b) => b.card_id)));
  const unselected = db.cards.filter((c) => !selectedIds.has(c.card_id) && ['S', 'A'].includes(c.quality_grade)).map((c) => ({ card_id: c.card_id, exp_id: c.exp_id, toc_title: c.toc_title, quality_grade: c.quality_grade, slot_problem: c.slot_problem.slice(0, 80) }));
  const bullets = run.content.experiences.flatMap((e) => e.bullets.map((b) => ({ bullet_id: b.bullet_id, exp_id: e.exp_id, hook: b.hook, content: b.content })));
  const user = JSON.stringify({ jd: run.jd, gaps, unselected_cards: unselected.slice(0, 20), bullets }, null, 2);
  let json = { comments: [] };
  try { ({ json } = await callLLM(PROMPT_COMMENTS, user, 2000)); } catch (e) { for (const g of gaps.slice(0, 3)) json.comments.push({ bullet_id: bullets.find((b) => b.exp_id === g.exp_id)?.bullet_id || bullets[0]?.bullet_id, exp_id: g.exp_id, question: `${g.gap} `, reason: '扫描发现的缺口', card_ids: [] }); }
  const valid = new Set(bullets.map((b) => b.bullet_id));
  run.comments = (json.comments || []).filter((c) => valid.has(c.bullet_id)).slice(0, 4).map((c, i) => ({ comment_id: `cm_${i + 1}`, ...c, resolved: false }));
  await writeJson(path.join(runsDir, `${runId}.json`), run);
  return run;
}

// ---------- 补卡：生成新卡并重编译该经历 ----------
async function gapCard(runId, { comment_id, answer }) {
  const run = await readJson(path.join(runsDir, `${runId}.json`), null);
  if (!run) throw Object.assign(new Error('运行不存在'), { code: 'NO_RUN' });
  const comment = (run.comments || []).find((c) => c.comment_id === comment_id);
  if (!comment) throw Object.assign(new Error('评论不存在'), { code: 'NO_COMMENT' });
  const db = await loadCards();
  const exp = db.experiences.find((e) => e.exp_id === comment.exp_id);
  if (!exp) throw Object.assign(new Error('经历不存在'), { code: 'NO_EXP' });
  const raw = await rawTextFor(exp.exp_id) || exp.raw_text || '';
  const user = `经历标题：${exp.title}\n经历类型：${exp.category}\n\n原始口述：\n${raw}\n\n缺口问题：${comment.question}\n用户回答：${answer}`;
  const { json } = await callLLM(PROMPT_GAPCARD, user, 3000);
  if (json.insufficient) {
    comment.answer = answer;
    comment.followup = json.question || '再补充一点具体做法或结果？';
    await writeJson(path.join(runsDir, `${runId}.json`), run);
    return { insufficient: true, question: comment.followup, run };
  }
  const card = {
    card_id: `${exp.exp_id}_gap${db.cards.filter((c) => c.exp_id === exp.exp_id && String(c.source).startsWith('gap')).length + 1}`,
    exp_id: exp.exp_id, step_order: Number(json.card?.step_order) || (Math.max(0, ...db.cards.filter((c) => c.exp_id === exp.exp_id).map((c) => c.step_order)) + 1),
    toc_title: String(json.card?.toc_title || '补充卡片').slice(0, 30),
    quality_grade: grade(json.card || {}),
    slot_stage: String(json.card?.slot_stage || ''), slot_module: String(json.card?.slot_module || ''),
    slot_problem: String(json.card?.slot_problem || ''), slot_workflow: String(json.card?.slot_workflow || ''),
    slot_tech_link: String(json.card?.slot_tech_link || ''), slot_outcome: String(json.card?.slot_outcome || ''),
    raw_quote: String(json.card?.raw_quote || answer),
    linked_nodes: (json.card?.linked_nodes || []).map((n) => ({ node_name: String(n.node_name || ''), node_type: n.node_type || 'product' })).filter((n) => n.node_name),
    is_verified: true, source: 'gap',
  };
  db.cards.push(card);
  await saveCards(db);
  // 重新编译该经历（用当前选中卡片 + 新卡）
  const expContent = run.content.experiences.find((e) => e.exp_id === exp.exp_id);
  const keep = expContent ? expContent.bullets.map((b) => b.card_id) : [];
  const sel = { exp_id: exp.exp_id, card_ids: [...new Set([...keep, card.card_id])], strategy: expContent?.strategy };
  await compose(runId, (run.selections || []).map((s) => (s.exp_id === exp.exp_id ? sel : s)));
  // compose 会重置 comments，这里把本轮评论（含已解决状态）合并回去
  const fresh = await readJson(path.join(runsDir, `${runId}.json`), null);
  comment.resolved = true;
  comment.answer = answer;
  comment.new_card_id = card.card_id;
  fresh.comments = run.comments;
  await writeJson(path.join(runsDir, `${runId}.json`), fresh);
  return { insufficient: false, card, run: fresh };
}

// ---------- 图谱 ----------
async function graph() {
  const db = await loadCards();
  const nodes = [];
  const links = [];
  for (const e of db.experiences) {
    nodes.push({ id: e.exp_id, label: e.title, type: 'experience', category: e.category, size: 16 });
    for (const c of db.cards.filter((c) => c.exp_id === e.exp_id)) {
      nodes.push({ id: c.card_id, label: c.toc_title, type: 'card', grade: c.quality_grade, size: 9 + (c.quality_grade === 'S' ? 3 : c.quality_grade === 'A' ? 1 : 0) });
      links.push({ source: e.exp_id, target: c.card_id, kind: 'belongs' });
    }
  }
  const nodeMap = new Map();
  for (const c of db.cards) for (const n of c.linked_nodes || []) {
    const key = n.node_name;
    if (!nodeMap.has(key)) { nodeMap.set(key, { id: `n_${nodeMap.size}`, label: key, type: 'node', nodeType: n.node_type, size: 5 }); nodes.push(nodeMap.get(key)); }
    links.push({ source: c.card_id, target: nodeMap.get(key).id, kind: 'tag' });
  }
  return { nodes, links, stats: { experiences: db.experiences.length, cards: db.cards.length, tags: nodeMap.size } };
}

// ---------- 路由 ----------
const json = (send, res, obj, status = 200) => send(res, status, obj);
const err = (send, res, e) => send(res, e.code ? 400 : 500, { error: e.message, code: e.code || 'V2_ERROR' });

export async function v2route(req, res, url, { body, send }) {
  try {
    const p = url.pathname;
    if (req.method === 'GET' && p === '/api/v2/state') {
      const db = await loadCards();
      const me = await profile();
      return json(send, res, { experiences: db.experiences, cards: db.cards, profile: me.markdown || '', imported_at: db.imported_at || null });
    }
    if (req.method === 'POST' && p === '/api/v2/import') {
      const db = await importFromWiki();
      return json(send, res, { ok: true, experiences: db.experiences.length, cards: db.cards.length });
    }
    if (req.method === 'POST' && p === '/api/v2/scan') {
      const v = await body(req);
      const run = await scan(String(v.jd || '').trim());
      return json(send, res, run);
    }
    if (req.method === 'POST' && p === '/api/v2/compose') {
      const v = await body(req);
      const run = await compose(v.run_id, v.selections || []);
      return json(send, res, run);
    }
    if (req.method === 'POST' && p === '/api/v2/comments') {
      const v = await body(req);
      return json(send, res, await comments(v.run_id));
    }
    if (req.method === 'POST' && p === '/api/v2/gap') {
      const v = await body(req);
      return json(send, res, await gapCard(v.run_id, { comment_id: v.comment_id, answer: String(v.answer || '') }));
    }
    if (req.method === 'GET' && p === '/api/v2/graph') return json(send, res, await graph());
    if (req.method === 'GET' && p === '/api/v2/run') {
      const run = await readJson(path.join(runsDir, `${url.searchParams.get('id')}.json`), null);
      return run ? json(send, res, run) : send(res, 404, { error: '运行不存在' });
    }
    return send(res, 404, { error: 'v2 路由不存在' });
  } catch (e) { err(send, res, e); }
}

// ================= 以下为恢复区块（误删后补回，2026-11-22） =================
const charLen = (s) => [...String(s || '')].length;

function checkBullet(b) {
  const hook = charLen(b.hook);
  const content = charLen(b.content);
  const evalEnd = /(体现了?|展现了?|验证了?|确保了?|保障了?).{0,18}(能力|效果|质量|准确|顺畅)\s*$/.test(String(b.content || '').trim());
  const _h = String(b.hook || '').trim(), _c = String(b.content || '').trim();
  const hookRepeated = !!_h && (_c.startsWith(_h) || _c.startsWith(`【${_h}】`) || _c.startsWith('【'));
  return {
    hook_len: hook,
    content_len: content,
    hook_ok: hook >= 4 && hook <= 12,
    content_ok: content >= 35 && content <= 80,
    content_in_comfort: content >= 50 && content <= 75,
    content_over_limit: content > 80,
    eval_end: evalEnd,
    hook_repeated: hookRepeated,
    focus_ok: !!String(b.focus_angle || '').trim(),
    banned: /闭环|赋能|矩阵|抓手|生态|全景|体系/.test(String(b.hook || '')),
  };
}

const PROMPT_COMMENTS = `# Role
你是简历策略编辑。基于【JD】【已生成简历内容】【扫描发现的知识缺口】【未被选中的高质量卡片】，在简历对应位置生成"气泡评论"，询问用户是否要补卡。

# Rules
1. 每条评论必须锚定到一条已生成的 bullet（bullet_id），问的是"是否补充某个方向"，而不是评价措辞。
2. 优先针对 JD 核心要求中当前简历没有体现、但该经历本可深挖的方向（gaps）；其次才是未被选中的 S/A 卡。
3. 每条评论带 1 个具体问题（用户可直接回答），并列出可选卡片 id（可为空）。
4. 最多 4 条，宁缺毋滥。

# Output Schema（只返回 JSON）
{ "comments": [ { "bullet_id": "锚定的bullet", "exp_id": "经历ID", "question": "向用户提的问题", "reason": "为什么值得补（对应JD哪条）", "card_ids": ["可选的已有卡片ID"] } ] }`;

const PROMPT_GAPCARD = `# Role
你是知识卡片补齐引擎。用户对简历中的某个缺口问题给出了回答。请结合【该经历的全部原话】与【用户的补充回答】，生成 1 张新的 6 槽位决策卡片。

# Rules
1. 事实只能来自【原话】或【用户回答】；不得编造。槽位缺失填"未提及"。
2. raw_quote 必须逐字来自【原话】或【用户回答】。
3. 如果原话和回答都不足以形成一张卡（没有具体动作或结果），返回 JSON：{ "insufficient": true, "question": "再追问一个更具体的问题" }。
4. 否则只返回一个 JSON 对象：{ "insufficient": false, "card": { step_order, toc_title, slot_stage, slot_module, slot_problem, slot_workflow, slot_tech_link, slot_outcome, raw_quote, linked_nodes:[{node_name,node_type}] } }。`;

// ---------- 静态质检 ----------
const NOT_MENTIONED = /未提及|未提供|无相关|不明确/;
const PERSONAL = /独立|主动|负责|主导|牵头|亲手|自行|设计|搭建|优化|拆分|推动|落地/;
const grade = (c) => {
  const slots = ['slot_problem', 'slot_workflow', 'slot_outcome'].map((s) => String(c[s] ?? '').trim());
  const present = slots.filter((s) => s && !NOT_MENTIONED.test(s) && s.length >= 8);
  const hasNum = /\d/.test(String(c.slot_outcome ?? ''));
  const hasAct = PERSONAL.test(`${c.slot_workflow} ${c.slot_outcome}`);
  if (present.length === 3 && hasNum) return 'S';
  if (present.length === 3) return 'A';
  if (present.length === 2 && (hasAct || hasNum)) return 'A';
  return 'B';
};
const normalizeCards = (expId, raw, parsed) => (parsed.story_cards || []).map((c, i) => ({
  card_id: `${expId}_c${i + 1}`,
  exp_id: expId,
  step_order: Number(c.step_order) || i + 1,
  toc_title: String(c.toc_title || '').slice(0, 30),
  quality_grade: grade(c),
  slot_stage: String(c.slot_stage || ''), slot_module: String(c.slot_module || ''),
  slot_problem: String(c.slot_problem || ''), slot_workflow: String(c.slot_workflow || ''),
  slot_tech_link: String(c.slot_tech_link || ''), slot_outcome: String(c.slot_outcome || ''),
  raw_quote: String(c.raw_quote || ''),
  linked_nodes: (c.linked_nodes || []).map((n) => ({ node_name: String(n.node_name || '').trim(), node_type: ['tech', 'product', 'domain'].includes(n.node_type) ? n.node_type : 'product' })).filter((n) => n.node_name),
  is_verified: true,
  source: 'raw',
})).sort((a, b) => a.step_order - b.step_order);

// ---------- 数据存取 ----------
const loadCards = async () => readJson(cardsFile, { schema: 'v2-1', experiences: [], cards: [] });
const saveCards = (db) => writeJson(cardsFile, db);

async function rawTextFor(expId) {
  const rawDir = path.join(dataRoot, 'raw');
  let files = [];
  try { files = await fs.readdir(rawDir); } catch { return ''; }
  const texts = [];
  for (const f of files.filter((x) => x.endsWith('.json'))) {
    const j = await readJson(path.join(rawDir, f), null);
    if (j && j.experience_id === expId) for (const m of j.messages || []) if (m.content) texts.push(m.content);
  }
  return texts.join('\n\n');
}

async function importFromWiki(onProgress = () => {}) {
  const index = await state();
  const exps = index.nodes.filter((n) => n.kind === 'experience');
  const db = { schema: 'v2-1', imported_at: new Date().toISOString(), experiences: [], cards: [] };
  const errors = [];
  for (const [i, e] of exps.entries()) {
    const raw = await rawTextFor(e.id);
    onProgress({ step: 'extract', i: i + 1, total: exps.length, title: e.title });
    let parsed;
    try {
      ({ json: parsed } = await callLLM(PROMPT_INGEST, `经历标题：${e.title}\n经历类型：${e.experience_type}\n\n原始口述文本：\n${raw}`, 8000, 'ingest', 0.3));
    } catch (err) {
      errors.push(`${e.title}: ${err.message}`);
      onProgress({ step: 'error', title: e.title, message: err.message });
      continue;
    }
    const cards = normalizeCards(e.id, raw, parsed);
    db.experiences.push({ exp_id: e.id, category: e.experience_type, title: e.title, time_range: '', spine_summary: String(parsed.spine_summary || ''), raw_text: raw });
    db.cards.push(...cards);
  }
  if (!db.cards.length) throw Object.assign(new Error('建卡失败：' + (errors.join('；') || '未解析出卡片')), { code: 'IMPORT_FAILED' });
  await saveCards(db);
  return db;
}

// ---------- 扫描 ----------
async function scan(jd) {
  const db = await loadCards();
  if (!db.cards.length) throw Object.assign(new Error('知识库还没有卡片，请先导入'), { code: 'NO_CARDS' });
  const pack = {
    jd,
    experiences: db.experiences.map((e) => ({
      exp_id: e.exp_id, category: e.category, title: e.title, spine_summary: e.spine_summary,
      cards: db.cards.filter((c) => c.exp_id === e.exp_id && c.is_verified).map((c) => ({ card_id: c.card_id, step_order: c.step_order, quality_grade: c.quality_grade, slot_problem: c.slot_problem, slot_workflow: c.slot_workflow, slot_outcome: c.slot_outcome })),
    })),
  };
  const user = JSON.stringify(pack, null, 2);
  const { json, usage } = await callLLM(PROMPT_SCAN, user, 5000, 'scan', 0.2);
  const run = { run_id: id('v2run'), jd, created_at: new Date().toISOString(), scan: json, scan_usage: usage, pack_chars: user.length, selections: null, content: null, comments: [], gap_cards: [] };
  await writeJson(path.join(runsDir, `${run.run_id}.json`), run);
  return run;
}
// ================= 恢复区块结束 =================

export { loadCards, saveCards, scan, compose, comments, gapCard, graph, importFromWiki, rawTextFor, checkBullet };
