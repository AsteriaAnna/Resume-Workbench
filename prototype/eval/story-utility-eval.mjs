import fs from 'node:fs/promises';
import path from 'node:path';
import { createLLM } from '../core/llm.mjs';
import { composeExperience } from '../core/generate.mjs';
import { charLen, validateBullet } from '../core/types.mjs';

const REPORT_DIR = path.resolve(import.meta.dirname, 'reports');
const dirs = (await fs.readdir(REPORT_DIR)).filter((x) => x.startsWith('three-schemes-')).sort();
const srcDir = path.join(REPORT_DIR, dirs.at(-1));
const data = JSON.parse(await fs.readFile(path.join(srcDir, 'result.json'), 'utf8'));
const JD_DIR = path.resolve(import.meta.dirname, '..', '..', '..', '回归集');
const jds = [
  { id: 'jd-01', text: (await fs.readFile(path.join(JD_DIR, 'jd-01-市场部实习生.md'), 'utf8')).trim() },
  { id: 'jd-02', text: (await fs.readFile(path.join(JD_DIR, 'jd-02-AI产品实习生.md'), 'utf8')).trim() },
];
const llm = await createLLM();

function stripStories(result) {
  const stories = result.second?.stories || [];
  return stories.map((s) => ({
    story_id: s.story_id || s.title,
    title: s.title,
    slots: s.slots || {},
    raw_quotes: s.raw_quotes || [],
    ownership: s.ownership || '',
    scope: s.scope || '',
  }));
}

const judgeSystem = `# Role
你是简历故事评估员。只评估 Story 能否支撑一条高质量简历 bullet，不改写。

# 输入
JD 原文 + 若干 Story（title/slots/raw_quotes/ownership/scope）。

# 对每条 Story 打分（1–5）
- bullet_worthiness：能否针对该 JD 写出一条具体、可信、有信息量的 bullet；
- distinct_angle：是否提供一个与其他 Story 不重复的独立角度；
- evidence_strength：动作/结果/归属/范围/原话是否足够；
- admission：strong | weak | fragment；
- reason：一句话，必须指到具体槽位/原话。

# 规则
- 纯职责列表、只有背景、无结果 → 低分；
- 只有“参与/负责”无本人动作 → 低分；
- 没有 JD 关联 → bullet_worthiness 低；
- 不因为文风加分。
# 输出（只输出 JSON）
{ "stories": [{ "story_id": "", "bullet_worthiness": 0, "distinct_angle": 0, "evidence_strength": 0, "admission": "strong|weak|fragment", "reason": "" }] }`;

const judgeResults = {};
for (const r of data.results) {
  if (r.error) continue;
  judgeResults[r.name] = {};
  const stories = stripStories(r);
  for (const jd of jds) {
    const p = {
      system: judgeSystem,
      user: JSON.stringify({ jd: jd.text, stories }, null, 2),
      tag: `judge-${r.name}-${jd.id}`,
      maxTokens: 4000,
      temperature: 0,
    };
    try {
      const { json } = await llm.callJSON(p.system, p.user, p);
      judgeResults[r.name][jd.id] = json.stories || [];
    } catch (e) {
      judgeResults[r.name][jd.id] = { error: e.message };
    }
  }
}

function avg(arr) { return arr.length ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)) : 0; }

const generation = {};
for (const r of data.results) {
  if (r.error) continue;
  generation[r.name] = {};
  const stories = stripStories(r);
  const scores = jds.flatMap((jd) => Array.isArray(judgeResults[r.name][jd.id]) ? judgeResults[r.name][jd.id] : []);
  const scoreById = new Map();
  for (const x of scores) {
    const cur = scoreById.get(x.story_id) || { w: 0, d: 0, e: 0, n: 0 };
    cur.w += Number(x.bullet_worthiness) || 0; cur.d += Number(x.distinct_angle) || 0; cur.e += Number(x.evidence_strength) || 0; cur.n++;
    scoreById.set(x.story_id, cur);
  }
  const top = [...stories].sort((a, b) => {
    const sa = scoreById.get(a.story_id) || { w: 0, n: 1 };
    const sb = scoreById.get(b.story_id) || { w: 0, n: 1 };
    return (sb.w / sb.n) - (sa.w / sa.n);
  }).slice(0, 3);
  for (const jd of jds) {
    const model = { experience: { experience_id: 'exp_eval', type: 'campus', name: '评估经历', role: '', time: '' }, stories, fragments: [] };
    const plan = { bullets: top.map((s) => ({ story_id: s.story_id, jd_quote: jd.text.split('\n').find((x) => x.trim().length > 8) || '岗位要求', order: 1 })) };
    try {
      const out = await composeExperience({ llm, jd: jd.text, experience: model.experience, model, plan, strategy: { hook_level: 'L2', body_pattern: 'CAR', jd_focus: '' }, config: { show_background: true } });
      const errors = out.bullets.flatMap((b) => validateBullet(b).map((e) => `${b.bullet_id}:${e}`));
      generation[r.name][jd.id] = {
        bullets: out.bullets.map((b) => ({ hook: b.hook, content: b.content, story_id: b.story_id, evidence_quote: b.evidence_quote })),
        count: out.bullets.length, errors,
      };
    } catch (e) {
      generation[r.name][jd.id] = { error: e.message };
    }
  }
}

const summary = data.results.filter((r) => !r.error).map((r) => {
  const stories = stripStories(r);
  const all = jds.flatMap((jd) => Array.isArray(judgeResults[r.name][jd.id]) ? judgeResults[r.name][jd.id] : []);
  const by = new Map();
  for (const s of all) by.set(s.story_id, s);
  const vals = [...by.values()];
  const gens = Object.values(generation[r.name]);
  return {
    scheme: r.name,
    stories: stories.length,
    judge_stories: vals.length,
    avg_bullet_worthiness: avg(vals.map((x) => Number(x.bullet_worthiness) || 0)),
    avg_distinct_angle: avg(vals.map((x) => Number(x.distinct_angle) || 0)),
    avg_evidence_strength: avg(vals.map((x) => Number(x.evidence_strength) || 0)),
    strong_ratio: vals.length ? Number((vals.filter((x) => x.admission === 'strong').length / vals.length).toFixed(2)) : 0,
    generation: gens.map((g) => g.error ? { error: g.error } : { count: g.count, errors: g.errors }),
  };
});

const outDir = path.join(REPORT_DIR, `story-utility-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`);
await fs.mkdir(outDir, { recursive: true });
const full = { source: path.relative(path.resolve(import.meta.dirname, '../..'), srcDir), jds: jds.map((x) => x.id), judgeResults, generation, summary };
await fs.writeFile(path.join(outDir, 'result.json'), JSON.stringify(full, null, 2), 'utf8');
const lines = ['# Story 下游可用性评估（Story → bullet）', '', `源三方案：${full.source}`, '', '## 汇总', '', '| 方案 | Story | 平均可写性 | 独立角度 | 证据强度 | strong 比例 | 生成 bullet | 生成错误 |', '| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |'];
for (const s of summary) {
  const g = s.generation.map((x) => x.error ? `ERR:${x.error.slice(0, 30)}` : `${x.count}条/${x.errors.length}错`).join('；');
  lines.push(`| ${s.scheme} | ${s.stories} | ${s.avg_bullet_worthiness} | ${s.avg_distinct_angle} | ${s.avg_evidence_strength} | ${s.strong_ratio} | ${g} | |`);
}
lines.push('', '## 说明', '', '- 评分由 LLM 按 rubric 给出，不等于人工 ground truth；', '- 生成用同一 P6/strategy，检查是否能把 Story 转成合法 bullet；', '- 这项评估更接近 Story 的真实用途：支撑简历 bullet。');
await fs.writeFile(path.join(outDir, 'report.md'), lines.join('\n'), 'utf8');
console.log(lines.join('\n'));
console.log('\n[report]', path.relative(path.resolve(import.meta.dirname, '../..'), outDir));
