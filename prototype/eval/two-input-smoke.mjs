import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../core/store.mjs';
import { createLLM } from '../core/llm.mjs';
import { quoteMatch, charLen, norm } from '../core/types.mjs';
import * as pipeline from '../core/pipeline.mjs';

const DATA = path.resolve(import.meta.dirname, '..', '..', '..', '沙盒数据-真实语料-v3', 'v2', 'cards.json');
const db = JSON.parse(await fs.readFile(DATA, 'utf8'));
const e = db.experiences.find((x) => x.exp_id === 'exp_74645d5065a74df4') || db.experiences[0];
const raw = e.raw_text;
const chunks = raw.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
const first = chunks.slice(0, 3).join('\n\n');
const second = chunks.slice(3).join('\n\n');

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'v6two-'));
const store = await createStore(dir).init();
const llm = await createLLM();
const exp = await pipeline.createExperience({ store, input: { type: 'campus', name: e.title } });

const r1 = await pipeline.ingest({ store, llm, experienceId: exp.experience_id, text: first });
const nar1 = await store.readNarrative(exp.experience_id);
const stories1 = r1.derived.model.stories;
const r2 = await pipeline.ingest({ store, llm, experienceId: exp.experience_id, text: second });
const nar2 = await store.readNarrative(exp.experience_id);
const stories2 = r2.derived.model.stories;
const content2 = await store.readMarkdown(exp.experience_id);

function slotFill(stories) {
  const keys = ['stage', 'module', 'problem', 'workflow', 'tech_link', 'outcome'];
  let filled = 0, total = 0;
  for (const s of stories) for (const k of keys) { total++; if (s.slots?.[k] && s.slots[k] !== '未提及') filled++; }
  return total ? filled / total : 0;
}
function quotePass(stories, text) {
  let pass = 0;
  for (const s of stories) for (const q of s.raw_quotes || []) if (quoteMatch(text, q).pass) pass++;
  return pass;
}
function storySummary(s) {
  return {
    title: s.title,
    summary: s.summary,
    ownership: s.ownership,
    scope: s.scope,
    slots: s.slots,
    raw_quotes: s.raw_quotes,
    flags: s.flags,
  };
}
function paras(n) { return String(n).split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean); }
function dupParas(n) {
  const ps = paras(n).map(norm);
  return ps.filter((p, i) => ps.findIndex((q) => q === p) !== i).length;
}

const report = {
  generated_at: new Date().toISOString(),
  experience: { exp_id: e.exp_id, title: e.title, raw_chars: charLen(raw) },
  split: { first_chars: charLen(first), second_chars: charLen(second), first, second },
  first: {
    applied: r1.patch.applied, skipped: r1.patch.skipped, unresolved: r1.patch.unresolved,
    narrative: nar1, narrative_paragraphs: paras(nar1).length,
    stories: stories1.map(storySummary), story_count: stories1.length,
    slot_fill_rate: Number(slotFill(stories1).toFixed(3)),
    quote_pass: quotePass(stories1, nar1), quote_total: stories1.reduce((n, s) => n + (s.raw_quotes?.length || 0), 0),
  },
  second: {
    applied: r2.patch.applied, skipped: r2.patch.skipped, unresolved: r2.patch.unresolved,
    narrative: nar2, narrative_paragraphs: paras(nar2).length,
    stories: stories2.map(storySummary), story_count: stories2.length,
    slot_fill_rate: Number(slotFill(stories2).toFixed(3)),
    quote_pass: quotePass(stories2, nar2), quote_total: stories2.reduce((n, s) => n + (s.raw_quotes?.length || 0), 0),
    duplicate_paragraphs: dupParas(nar2),
    content_markdown_chars: charLen(content2),
  },
};

const outDir = path.resolve(import.meta.dirname, 'reports', `two-input-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`);
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

const lines = [];
lines.push('# 两次增量输入测试：经历正文 + 派生 Story', '');
lines.push(`- 经历：${e.title}`);
lines.push(`- raw：${report.experience.raw_chars} 字；第一次 ${report.split.first_chars} 字，第二次 ${report.split.second_chars} 字`);
lines.push(`- 临时数据：\`${dir}\``);
lines.push('', '## 第一次输入', '');
lines.push(`- P11 应用：${r1.patch.applied.length}；跳过：${r1.patch.skipped.length}；未决：${r1.patch.unresolved.length}`);
lines.push(`- 正文：${report.first.narrative_paragraphs} 段`);
lines.push(`- Story：${report.first.story_count}；槽位填充：${report.first.slot_fill_rate}；原话命中：${report.first.quote_pass}/${report.first.quote_total}`);
lines.push('', '### 正文', '', report.first.narrative, '');
lines.push('### Story', '');
for (const s of report.first.stories) lines.push(`- **${s.title}**｜${s.summary || '—'}｜quotes=${s.raw_quotes.join(' / ')}｜flags=${(s.flags || []).join(',') || '—'}`);
lines.push('', '## 第二次输入（增量）', '');
lines.push(`- P11 应用：${r2.patch.applied.length}；跳过：${r2.patch.skipped.length}；未决：${r2.patch.unresolved.length}`);
lines.push(`- 正文：${report.second.narrative_paragraphs} 段；重复段落：${report.second.duplicate_paragraphs}`);
lines.push(`- Story：${report.second.story_count}；槽位填充：${report.second.slot_fill_rate}；原话命中：${report.second.quote_pass}/${report.second.quote_total}`);
lines.push('', '### 正文', '', report.second.narrative, '');
lines.push('### Story', '');
for (const s of report.second.stories) lines.push(`- **${s.title}**｜${s.summary || '—'}｜quotes=${s.raw_quotes.join(' / ')}｜flags=${(s.flags || []).join(',') || '—'}`);
lines.push('', '## 质量观察（自动）', '');
lines.push(`- 第一次 → 第二次：Story ${report.first.story_count} → ${report.second.story_count}；正文 ${report.first.narrative_paragraphs} → ${report.second.narrative_paragraphs} 段`);
lines.push(`- 第二次原话命中：${report.second.quote_pass}/${report.second.quote_total}；重复段落：${report.second.duplicate_paragraphs}`);
lines.push(`- 需要人工看：第二次是否把新增事实放在合理位置、Story 是否重复/过碎、槽位是否填了“未提及”。`);
await fs.writeFile(path.join(outDir, 'report.md'), lines.join('\n'), 'utf8');
console.log(lines.join('\n'));
console.log(`\n[report] ${path.relative(path.resolve(import.meta.dirname, '../..'), outDir)}`);
