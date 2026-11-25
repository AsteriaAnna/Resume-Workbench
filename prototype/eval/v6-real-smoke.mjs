import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../core/store.mjs';
import { createLLM } from '../core/llm.mjs';
import * as pipeline from '../core/pipeline.mjs';

const DATA = path.resolve(import.meta.dirname, '..', '..', '..', '沙盒数据-真实语料-v3', 'v2', 'cards.json');
const JD = path.resolve(import.meta.dirname, '..', '..', '..', '回归集', 'jd-02-AI产品实习生.md');
const db = JSON.parse(await fs.readFile(DATA, 'utf8'));
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'v6real-'));
const store = await createStore(dir).init();
const llm = await createLLM();
const pick = db.experiences.filter((e) => ['campus', 'internship'].includes(e.category)).slice(0, 3);
for (const e of pick) {
  console.log('[create]', e.title);
  const exp = await pipeline.createExperience({ store, input: { type: e.category, name: e.title, role: '', time: '' } });
  const r = await pipeline.ingest({ store, llm, experienceId: exp.experience_id, text: e.raw_text });
  console.log('[ingest] applied', r.patch.applied.length, 'skipped', r.patch.skipped.length, 'unresolved', r.patch.unresolved.length, 'stories', r.derived.model.stories.length);
  console.log('[narrative]', (await store.readNarrative(exp.experience_id)).slice(0, 160).replace(/\n/g, ' / '));
}
const jd = await fs.readFile(JD, 'utf8');
const run = await pipeline.generate({ store, llm, jd, config: { maxExperiences: 4, show_background: true, show_tech_stack: true } });
console.log(JSON.stringify({
  run_id: run.run_id, exps: run.content.experiences.length,
  bullets: run.content.experiences.reduce((n, e) => n + e.bullets.length, 0),
  errors: run.validation.errors, issues: run.issues.length,
  strategy: run.plan.strategy, questions: run.questions.all.length,
  sections: run.content.experiences.map((e) => ({ bg: e.project_background?.length || 0, tech: e.tech_stack?.length || 0, bullets: e.bullets.length })),
}, null, 2));
console.log('store', dir);
