import fs from 'node:fs/promises';
import path from 'node:path';
import { createLLM } from '../core/llm.mjs';
import { createStore } from '../core/store.mjs';
import { charLen, quoteMatch, norm } from '../core/types.mjs';

const REPORT_DIR = path.resolve(import.meta.dirname, 'reports');
const storeArg = process.argv.includes('--store') ? process.argv[process.argv.indexOf('--store') + 1] : '';
const expArg = process.argv.includes('--exp') ? process.argv[process.argv.indexOf('--exp') + 1] : 'exp_74645d5065a74df4';
let schemeName, stories;
if (storeArg) {
  const st = await createStore(storeArg).init();
  const reg = await st.readRegistry(expArg);
  if (!reg) throw new Error('store 中没有 registry');
  schemeName = 'store:' + expArg;
  stories = reg.stories.filter((x) => x.status === 'active').map((s) => ({
    story_id: s.story_id, title: s.title, slots: s.slots || {}, raw_quotes: s.raw_quotes || [],
    ownership: s.ownership || '', scope: s.scope || '',
  }));
} else {
  const dirs = (await fs.readdir(REPORT_DIR)).filter((x) => x.startsWith('three-schemes-')).sort();
  const srcDir = path.join(REPORT_DIR, dirs.at(-1));
  const data = JSON.parse(await fs.readFile(path.join(srcDir, 'result.json'), 'utf8'));
  schemeName = process.argv.includes('--scheme') ? process.argv[process.argv.indexOf('--scheme') + 1] : 'registry-update';
  const scheme = data.results.find((x) => x.name === schemeName);
  if (!scheme || scheme.error) throw new Error('没有可用的方案结果: ' + schemeName);
  stories = (scheme.second?.stories || []).map((s) => ({
  story_id: s.story_id,
  title: s.title,
  slots: s.slots || {},
  raw_quotes: s.raw_quotes || [],
  ownership: s.ownership || '',
  scope: s.scope || '',
}));
}
const DATA = path.resolve(import.meta.dirname, '..', '..', '..', '沙盒数据-真实语料-v3', 'v2', 'cards.json');
const db = JSON.parse(await fs.readFile(DATA, 'utf8'));
const exp = db.experiences.find((x) => x.exp_id === 'exp_74645d5065a74df4');
const raw = exp.raw_text;
const llm = await createLLM();

const compileSystem = `# Role
你是 Story 多骨架投影测试员。对同一条 Story，分别用 CAR（痛点破局）和 PAR（流程链路）写出两条 bullet，并给出 L2 级行业标准 Hook。
只输出 JSON。

# 输入
Story：title / slots（stage,module,problem,workflow,tech_link,outcome）/ ownership / scope / raw_quotes。

# 规则
1. 只能使用 Story 中的事实；不得新增数字、工具、结果、时间；
2. Hook 使用 L2 行业标准术语（可 1–3 个英文短词）；不限制字数；
3. 正文不限制字数；
4. CAR：先点具体卡点/约束 → 方案权衡（放弃 A 选 B）→ 落地解法 → 结果；focus_angle 写“为什么这么权衡”；
5. PAR：业务前提 → 输入 → 核心处理节点 → 交付输出/效率变化；focus_angle 写“输入→处理→输出”的关键链路；
6. 两种骨架的信息焦点必须不同，不能只换开头；
7. 如果 Story 信息不足以支撑某骨架，明确返回 null，不要硬编；
8. 必须带 evidence_quote（逐字来自 Story）。
# 输出
{ "car": { "hook": "", "content": "", "focus_angle": "", "evidence_quote": "" }, "par": { "hook": "", "content": "", "focus_angle": "", "evidence_quote": "" } }`;

const judgeSystem = `# Role
你是 Story 验收员。检查三件事：多骨架是否成立、单主题纯度、原话忠实度。只输出 JSON。
# 输入
raw、Story、CAR、PAR。
# 判定
1. car_l2 / par_l2：Hook 是否达到 L2 行业标准术语水位；
2. focus_distinct：CAR 聚焦“权衡/为什么”，PAR 聚焦“输入→处理→输出”，两者信息焦点是否明显不同；
3. single_topic：Story 是否只围绕一个核心决策/子问题；若同时包含两个独立动作/问题，false；
4. faithfulness：两条 bullet 的数字、工具、结果、归属是否都能在 raw/Story 中找到，无畸变/编造；
5. split_recommended：single_topic=false 时建议拆分。
# 输出
{ "car_l2": true, "par_l2": true, "focus_distinct": true, "single_topic": true, "faithfulness": true, "topic_count": 1, "split_recommended": false, "problems": [] }`;

async function callJson(system, user, tag) {
  return (await llm.callJSON(system, user, { tag, maxTokens: 5000, temperature: 0 })).json;
}

function numbers(text) { return [...String(text || '').matchAll(/\d+(?:\.\d+)?%?/g)].map((m) => m[0]); }
function evidenceOk(q, story) {
  const hay = [story.raw_quotes?.join('\n'), ...Object.values(story.slots || {})].join('\n');
  return quoteMatch(hay, q).pass;
}
function numberOk(text, story) {
  const hay = norm([story.raw_quotes?.join('\n'), ...Object.values(story.slots || {})].join('\n'));
  return numbers(text).every((n) => hay.includes(norm(n)));
}

const rows = [];
for (const s of stories) {
  const compile = await callJson(compileSystem, JSON.stringify({ story: s }, null, 2), `project-${s.story_id}`);
  const judge = await callJson(judgeSystem, JSON.stringify({ raw, story: s, car: compile.car, par: compile.par }, null, 2), `judge-${s.story_id}`);
  const checks = {
    car_present: !!compile.car && charLen(compile.car.content) > 0,
    par_present: !!compile.par && charLen(compile.par.content) > 0,
    evidence: !!compile.car && !!compile.par && evidenceOk(compile.car.evidence_quote, s) && evidenceOk(compile.par.evidence_quote, s),
    numbers: !!compile.car && !!compile.par && numberOk(compile.car.content, s) && numberOk(compile.par.content, s),
  };
  const bulletChecks = [compile.car, compile.par].filter(Boolean);
  const evidenceAny = bulletChecks.length > 0 && bulletChecks.every((b) => evidenceOk(b.evidence_quote, s));
  const numbersAny = bulletChecks.length > 0 && bulletChecks.every((b) => numberOk(b.content, s));
  const multi = checks.car_present && checks.par_present && checks.evidence && checks.numbers && judge.focus_distinct;
  const hook_l2 = !!judge.car_l2 && !!judge.par_l2;
  const purity = !!judge.single_topic && !judge.split_recommended;
  const faithful = evidenceAny && numbersAny && !!judge.faithfulness;
  rows.push({ story: s, compile, judge, checks, multi, purity, faithful, hook_l2, evidenceAny, numbersAny });
}

const summary = {
  scheme: schemeName,
  stories: rows.length,
  multi_skeleton_pass: rows.filter((r) => r.multi).length,
  hook_l2_pass: rows.filter((r) => r.hook_l2).length,
  purity_pass: rows.filter((r) => r.purity).length,
  faithfulness_pass: rows.filter((r) => r.faithful).length,
  rows,
};
const outDir = path.join(REPORT_DIR, `story-projection-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`);
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'result.json'), JSON.stringify(summary, null, 2), 'utf8');

const lines = ['# Story 三指标验收：多骨架 / 纯度 / 忠实度', '', `方案：${schemeName}，Story 数：${rows.length}`, '', '| Story | 多骨架（不限字数） | L2 Hook（单独） | 纯度 | 忠实度 | CAR Hook | PAR Hook | 问题 |', '| --- | --- | --- | --- | --- | --- | --- | --- |'];
for (const r of rows) {
  lines.push(`| ${r.story.title} | ${r.multi ? '✅' : '❌'} | ${r.hook_l2 ? '✅' : '❌'} | ${r.purity ? '✅' : '❌'} | ${r.faithful ? '✅' : '❌'} | ${r.compile.car?.hook || '-'} | ${r.compile.par?.hook || '-'} | ${(r.judge.problems || []).join('；') || '-'} |`);
}
lines.push('', `**汇总：多骨架通过 ${summary.multi_skeleton_pass}/${summary.stories}；L2 Hook ${summary.hook_l2_pass}/${summary.stories}；纯度 ${summary.purity_pass}/${summary.stories}；忠实度 ${summary.faithfulness_pass}/${summary.stories}**`);
lines.push('', '## 详细输出', '');
for (const r of rows) {
  lines.push(`### ${r.story.title}`, '');
  lines.push('CAR：' + JSON.stringify(r.compile.car));
  lines.push('PAR：' + JSON.stringify(r.compile.par));
  lines.push('判定：' + JSON.stringify(r.judge));
  lines.push('');
}
await fs.writeFile(path.join(outDir, 'report.md'), lines.join('\n'), 'utf8');
console.log(lines.join('\n'));
console.log('\n[report]', path.relative(path.resolve(import.meta.dirname, '../..'), outDir));
