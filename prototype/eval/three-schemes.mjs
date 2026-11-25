import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../core/store.mjs';
import { createLLM } from '../core/llm.mjs';
import { parseMarkdown } from '../core/markdown.mjs';
import { quoteMatch, charLen, norm } from '../core/types.mjs';
import * as pipeline from '../core/pipeline.mjs';

const DATA = path.resolve(import.meta.dirname, '..', '..', '..', '沙盒数据-真实语料-v3', 'v2', 'cards.json');
const db = JSON.parse(await fs.readFile(DATA, 'utf8'));
const e = db.experiences.find((x) => x.exp_id === 'exp_74645d5065a74df4') || db.experiences[0];
const chunks = e.raw_text.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
const inputs = [chunks.slice(0, 3).join('\n\n'), chunks.slice(3).join('\n\n')];

const SLOTS = ['stage', 'module', 'problem', 'workflow', 'tech_link', 'outcome'];
const normText = (s) => String(s || '').replace(/\s+/g, '');

function metrics(stories, narrative) {
  const active = stories.filter((s) => s.status !== 'deleted' && s.status !== 'merged' && s.status !== 'split');
  let filled = 0, total = 0, quotePass = 0, quoteTotal = 0, admissible = 0;
  for (const s of active) {
    for (const k of SLOTS) { total++; if (s.slots?.[k] && s.slots[k] !== '未提及') filled++; }
    for (const q of s.raw_quotes || []) { quoteTotal++; if (quoteMatch(narrative, q).pass) quotePass++; }
    if (s.slots?.workflow && s.slots.workflow !== '未提及' && s.slots?.outcome && s.slots.outcome !== '未提及' && (s.raw_quotes || []).length) admissible++;
  }
  const titles = active.map((s) => normText(s.title));
  const ids = active.map((s) => s.story_id);
  return {
    story_count: active.length,
    slot_fill_rate: total ? Number((filled / total).toFixed(3)) : 0,
    quote_pass: quotePass,
    quote_total: quoteTotal,
    admission_rate: active.length ? Number((admissible / active.length).toFixed(3)) : 0,
    ids, titles,
    ids_sample: ids.slice(0, 5),
    titles_sample: active.map((s) => s.title),
    stories: active.map((s) => ({ story_id: s.story_id, story_key: s.story_key, title: s.title, summary: s.summary, ownership: s.ownership, scope: s.scope, slots: s.slots, raw_quotes: s.raw_quotes })),
  };
}

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return A.size + B.size - inter ? Number((inter / (A.size + B.size - inter)).toFixed(3)) : 0;
}

async function runScheme(name, mode) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `v6-${name}-`));
  const store = await createStore(dir).init();
  const llm = await createLLM();
  const exp = await pipeline.createExperience({ store, input: { type: 'campus', name: e.title, role: '', time: '' } });
  const first = await pipeline.ingest({ store, llm, experienceId: exp.experience_id, text: inputs[0], mode });
  const nar1 = await store.readNarrative(exp.experience_id);
  const reg1 = await store.readRegistry(exp.experience_id);
  const md1 = await store.readMarkdown(exp.experience_id);
  const m1 = metrics(reg1 ? reg1.stories : parseMarkdown(md1).stories, nar1);
  const second = await pipeline.ingest({ store, llm, experienceId: exp.experience_id, text: inputs[1], mode });
  const nar2 = await store.readNarrative(exp.experience_id);
  const reg2 = await store.readRegistry(exp.experience_id);
  const md2 = await store.readMarkdown(exp.experience_id);
  const m2 = metrics(reg2 ? reg2.stories : parseMarkdown(md2).stories, nar2);
  return {
    name, mode, dir,
    first: { patch: first.patch, ...m1 },
    second: { patch: second.patch, derived: second.derived ? { mode: second.derived.mode, review: second.derived.review, applied: second.derived.applied?.length, skipped: second.derived.skipped?.length } : null, ...m2 },
    stability: {
      id_jaccard: jaccard(m1.ids, m2.ids),
      title_jaccard: jaccard(m1.titles, m2.titles),
    },
  };
}

const schemes = [
  ['full-rewrite', 'full'],
  ['registry-update', 'registry'],
  ['curator-loop', 'curator'],
];
const results = [];
for (const [name, mode] of schemes) {
  console.log(`[run] ${name} ...`);
  try { results.push(await runScheme(name, mode)); }
  catch (err) { results.push({ name, mode, error: err.message, raw_len: err.details?.raw?.length, raw_tail: err.details?.raw?.slice(-300), stack: err.stack }); console.log('[error]', name, 'raw_len', err.details?.raw?.length, 'tail', err.details?.raw?.slice(-200)); }
}

const outDir = path.resolve(import.meta.dirname, 'reports', `three-schemes-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`);
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'result.json'), JSON.stringify({ inputs: { first: inputs[0], second: inputs[1] }, results }, null, 2), 'utf8');

const lines = [];
lines.push('# Story 质量与颗粒度：三方案对比', '');
lines.push(`- 经历：${e.title}`);
lines.push(`- 输入：第一次 ${charLen(inputs[0])} 字；第二次 ${charLen(inputs[1])} 字`);
lines.push('');
lines.push('| 方案 | 首次 Story | 二次 Story | ID Jaccard | 标题 Jaccard | 槽位填充(二次) | Quote(二次) | 准入率(二次) |');
lines.push('| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |');
for (const r of results) {
  if (r.error) { lines.push(`| ${r.name} | - | - | - | - | - | - | - |`); continue; }
  lines.push(`| ${r.name} | ${r.first.story_count} | ${r.second.story_count} | ${r.stability.id_jaccard} | ${r.stability.title_jaccard} | ${r.second.slot_fill_rate} | ${r.second.quote_pass}/${r.second.quote_total} | ${r.second.admission_rate} |`);
}
lines.push('', '## 明细', '');
for (const r of results) {
  lines.push(`### ${r.name}`, '');
  if (r.error) { lines.push(`- 错误：${r.error}`, ''); continue; }
  lines.push(`- 首次 Story：${r.first.story_count}；二次：${r.second.story_count}`);
  lines.push(`- 首次 titles：${r.first.titles_sample.join(' / ')}`);
  lines.push(`- 二次 titles：${r.second.titles_sample.join(' / ')}`);
  lines.push(`- ID Jaccard：${r.stability.id_jaccard}；标题 Jaccard：${r.stability.title_jaccard}`);
  lines.push(`- 二次槽位填充：${r.second.slot_fill_rate}；quote：${r.second.quote_pass}/${r.second.quote_total}；准入率：${r.second.admission_rate}`);
  lines.push('');
}
lines.push('## 说明', '');
lines.push('- `full-rewrite`：每次 P1 全量重写 Story（当前旧实现）；');
lines.push('- `registry-update`：首次 P1 建立 registry，第二次 P1-Update 只改变更 Story；');
lines.push('- `curator-loop`：registry + P1-Update + 一次 P1-Review（有界，不是自主 Agent）；');
lines.push('- ID Jaccard 只在 registry 方案有意义；full-rewrite 的 ID 每次随机，通常接近 0；');
lines.push('- 准入率启发式：workflow/outcome 非空 + 有 raw_quotes；不等于人工质量评估。');
await fs.writeFile(path.join(outDir, 'report.md'), lines.join('\n'), 'utf8');
console.log(lines.join('\n'));
console.log(`\n[report] ${path.relative(path.resolve(import.meta.dirname, '../..'), outDir)}`);
