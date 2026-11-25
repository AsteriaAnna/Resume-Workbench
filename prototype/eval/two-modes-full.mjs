import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../core/store.mjs';
import { createLLM } from '../core/llm.mjs';
import { composeExperience } from '../core/generate.mjs';
import { buildModelFromRegistry } from '../core/story-registry.mjs';
import { parseMarkdown } from '../core/markdown.mjs';
import * as pipeline from '../core/pipeline.mjs';

const DATA = path.resolve(import.meta.dirname, '..', '..', '..', '沙盒数据-真实语料-v3', 'v2', 'cards.json');
const JD_PATH = path.resolve(import.meta.dirname, '..', '..', '..', '回归集', 'jd-01-市场部实习生.md');
const db = JSON.parse(await fs.readFile(DATA, 'utf8'));
const e = db.experiences.find((x) => x.exp_id === 'exp_74645d5065a74df4');
const jd = (await fs.readFile(JD_PATH, 'utf8')).trim();
const chunks = e.raw_text.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
const inputs = [chunks.slice(0, 3).join('\n\n'), chunks.slice(3).join('\n\n')];

async function runMode(mode) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `v6-mode-${mode}-`));
  const store = await createStore(dir).init();
  const llm = await createLLM();
  const exp = await pipeline.createExperience({ store, input: { type: 'campus', name: e.title, role: '', time: '' } });
  const first = await pipeline.ingest({ store, llm, experienceId: exp.experience_id, text: inputs[0], mode });
  const second = await pipeline.ingest({ store, llm, experienceId: exp.experience_id, text: inputs[1], mode });
  const narrative = await store.readNarrative(exp.experience_id);
  const registry = await store.readRegistry(exp.experience_id);
  const stories = registry ? registry.stories.filter((s) => s.status === 'active') : [];
  const experience = await store.readExperience(exp.experience_id);
  const model = registry ? buildModelFromRegistry(registry, experience) : parseMarkdown(await store.readMarkdown(exp.experience_id));
  const plan = {
    bullets: stories.slice(0, 4).map((s) => ({
      story_id: s.story_id,
      jd_quote: jd.split('\n').find((x) => x.trim().length > 10) || '岗位要求',
      order: 1,
    })),
  };
  let generated = null, error = null;
  try {
    generated = await composeExperience({
      llm, jd, experience: model.experience, model, plan,
      strategy: { hook_level: 'L2', body_pattern: 'CAR', jd_focus: '' },
      config: { show_background: true },
    });
  } catch (err) { error = err.message; }
  return { mode, dir, first, second, narrative, registry, stories, model, plan, generated, error };
}

const results = [];
for (const mode of ['registry', 'curator']) {
  console.log(`\n[run] ${mode} ...`);
  results.push(await runMode(mode));
}

const outDir = path.resolve(import.meta.dirname, 'reports', `mode-compare-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`);
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'result.json'), JSON.stringify({ inputs, raw: e.raw_text, jd, results }, null, 2), 'utf8');

const lines = ['# Workflow vs Agent：原文到 Story/Experience', ''];
lines.push('## 原始输入（全文）', '', '```text', e.raw_text.trim(), '```', '');
lines.push('## 第一次输入', '', '```text', inputs[0], '```', '');
lines.push('## 第二次输入', '', '```text', inputs[1], '```', '');
for (const r of results) {
  lines.push(`\n# ${r.mode === 'registry' ? 'Workflow（P11 + P1/P1-Update）' : 'Agent（Workflow + Curator 循环）'}`, '');
  lines.push('## 经历正文', '', '```text', r.narrative.trim(), '```', '');
  lines.push(`## Story（${r.stories.length} 条）`, '');
  for (const s of r.stories) {
    lines.push(`### ${s.title}`, '');
    lines.push('```json', JSON.stringify({ projection_fit: s.projection_fit, single_topic: s.single_topic, slots: s.slots, raw_quotes: s.raw_quotes }, null, 2), '```', '');
  }
  lines.push('## 生成的 Experience', '');
  if (r.error) lines.push('```text', 'ERROR: ' + r.error, '```', '');
  else {
    for (const b of r.generated.bullets) lines.push(`- **${b.hook}** ${b.content}`, `  - evidence: ${b.evidence_quote}`);
    lines.push('', 'Validation:', '```json', JSON.stringify(r.generated.validation || r.generated, null, 2).slice(0, 3000), '```');
  }
  lines.push('', `临时目录：${r.dir}`);
}
await fs.writeFile(path.join(outDir, 'report.md'), lines.join('\n'), 'utf8');
console.log(lines.join('\n'));
console.log('\n[report]', path.relative(path.resolve(import.meta.dirname, '../..'), outDir));
