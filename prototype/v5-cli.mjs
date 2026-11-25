#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createStore } from './core/store.mjs';
import { createLLM } from './core/llm.mjs';
import { createMock } from './core/mock.mjs';
import * as pipeline from './core/pipeline.mjs';
import { AppError } from './core/types.mjs';

const args = process.argv.slice(2);
const cmd = args[0] || 'help';
const arg = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? '') : fallback;
};
const has = (name) => args.includes(`--${name}`);
const out = (obj, code = 0) => { console.log(JSON.stringify(obj, null, 2)); process.exit(code); };
const root = arg('data', process.env.WORKBENCH_DATA_DIR || path.join(import.meta.dirname, 'local-data'));
const mock = has('mock') || process.env.V5_MOCK === '1';

async function readText() {
  const text = arg('text');
  if (text) return text;
  const file = arg('text-file');
  return file ? (await fs.readFile(file, 'utf8')).trim() : '';
}

async function main() {
  const store = await createStore(root).init();
  const llm = await createLLM({ mock, mockCall: mock ? createMock() : null });

  if (cmd === 'create') {
    const exp = await pipeline.createExperience({ store, input: { type: arg('type'), name: arg('name'), role: arg('role'), time: arg('time') } });
    return out({ ok: true, experience: exp });
  }
  if (cmd === 'list') {
    const rows = await store.listExperiences();
    return out({ count: rows.length, experiences: rows });
  }
  if (cmd === 'inspect') {
    const exp = arg('exp');
    if (!exp) return out({ error: '需要 --exp' }, 2);
    return out(await pipeline.inspectExperience({ store, experienceId: exp }));
  }
  if (cmd === 'input') {
    const exp = arg('exp');
    if (!exp) return out({ error: '需要 --exp' }, 2);
    const text = await readText();
    if (!text) return out({ error: '需要 --text 或 --text-file' }, 2);
    const result = await pipeline.addExperienceInput({ store, llm, experienceId: exp, text });
    return out({
      ok: true, experience_id: exp, raw_id: result.raw.raw_id,
      draft: {
        stories: result.draft.stories.map((s) => ({ temp_id: s.temp_id, title: s.title, raw_quotes: s.raw_quotes, flags: s.flags })),
        fragments: result.draft.fragments.length, unassigned_details: result.draft.unassigned_details.length,
      },
      next: '确认 Story 列表：node prototype/v5-cli.mjs confirm --exp <id> [--decisions decisions.json]',
    });
  }
  if (cmd === 'confirm') {
    const exp = arg('exp');
    if (!exp) return out({ error: '需要 --exp' }, 2);
    let decisions = null;
    if (arg('decisions-file')) decisions = JSON.parse(await fs.readFile(arg('decisions-file'), 'utf8'));
    const result = await pipeline.confirmExperienceStories({ store, llm, experienceId: exp, decisions });
    return out({
      ok: true, experience_id: exp, stories: result.model.stories.length, fragments: result.model.fragments.length,
      questions: { total: result.questions.all.length, ui: result.questions.ui.slice(0, 3), all: result.questions.all },
      markdown: result.markdown,
    });
  }
  if (cmd === 'questions') {
    const exp = arg('exp'), run = arg('run');
    if (exp) return out(await pipeline.questions({ store, scope: 'experience', target: exp }));
    if (run) return out(await pipeline.questions({ store, scope: 'resume', target: run }));
    return out({ error: '需要 --exp 或 --run' }, 2);
  }
  if (cmd === 'ingest') {
    const exp = arg('exp');
    if (!exp) return out({ error: '需要 --exp' }, 2);
    const text = await readText();
    if (!text) return out({ error: '需要 --text 或 --text-file' }, 2);
    const result = await pipeline.ingest({ store, llm, experienceId: exp, text });
    return out({
      ok: true, experience_id: exp, raw_id: result.raw.raw_id,
      applied: result.patch.applied.length, skipped: result.patch.skipped.length,
      unresolved: result.patch.unresolved, stories: result.derived.model.stories.length,
      narrative: await store.readNarrative(exp),
    });
  }
  if (cmd === 'narrative') {
    const exp = arg('exp');
    if (!exp) return out({ error: '需要 --exp' }, 2);
    return out({ experience_id: exp, narrative: await store.readNarrative(exp), markdown: await store.readMarkdown(exp) });
  }
  if (cmd === 'edit-narrative') {
    const exp = arg('exp');
    if (!exp) return out({ error: '需要 --exp' }, 2);
    const text = await readText();
    if (!text) return out({ error: '需要 --text 或 --text-file' }, 2);
    const r = await pipeline.editExperienceNarrative({ store, llm, experienceId: exp, markdown: text });
    return out({ ok: true, experience_id: exp, stories: r.derived.model.stories.length });
  }
  if (cmd === 'derive') {
    const exp = arg('exp');
    if (!exp) return out({ error: '需要 --exp' }, 2);
    const r = await pipeline.derive({ store, llm, experienceId: exp });
    return out({ ok: true, experience_id: exp, stories: r.model.stories.length });
  }
  if (cmd === 'edit') {
    const exp = arg('exp');
    if (!exp) return out({ error: '需要 --exp' }, 2);
    const text = await readText();
    if (!text) return out({ error: '需要 --text 或 --text-file' }, 2);
    return out({ ok: true, ...(await pipeline.editExperienceMarkdown({ store, experienceId: exp, markdown: text })) });
  }
  if (cmd === 'answer') {
    const q = arg('question');
    if (!q) return out({ error: '需要 --question' }, 2);
    const text = await readText();
    if (!text) return out({ error: '需要 --text 或 --text-file' }, 2);
    const result = await pipeline.answer({ store, llm, questionId: q, text });
    return out({ ok: true, question: result.question, draft: result.draft });
  }
  if (cmd === 'dismiss') {
    const q = arg('question');
    if (!q) return out({ error: '需要 --question' }, 2);
    return out({ ok: true, question: await pipeline.dismiss({ store, questionId: q }) });
  }
  if (cmd === 'generate') {
    const jd = arg('jd') || (arg('jd-file') ? (await fs.readFile(arg('jd-file'), 'utf8')).trim() : '');
    if (!jd) return out({ error: '需要 --jd 或 --jd-file' }, 2);
    const run = await pipeline.generate({ store, llm, jd, config: {
      maxExperiences: Number(arg('max-experiences', 4)) || 4,
      maxBulletsPerExperience: 4,
      show_background: !has('no-background'),
      show_tech_stack: has('tech-stack'),
    } });
    return out({
      ok: true, run_id: run.run_id,
      summary: {
        experiences: run.content.experiences.length,
        bullets: run.content.experiences.reduce((n, e) => n + (e.bullets || []).length, 0),
        issues: run.issues.length, validation_errors: run.validation.errors.length,
        questions: run.questions.all.length, ui_questions: run.questions.ui.length,
      },
      run,
    });
  }
  if (cmd === 'show') {
    const runId = arg('run');
    if (!runId) return out({ error: '需要 --run' }, 2);
    return out(await store.loadRun(runId));
  }
  if (cmd === 'stats') {
    const exps = await store.listExperiences();
    const lib = await store.loadLibrary();
    const runs = await store.listRuns();
    return out({ experiences: exps.length, confirmed: lib.filter((e) => e.stories.length).length, stories: lib.reduce((n, e) => n + e.stories.length, 0), runs: runs.length });
  }
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    return out({
      commands: {
        create: '--type campus|project|internship --name <name> [--role] [--time]',
        input: '--exp <id> --text <text> | --text-file <path>',
        confirm: '--exp <id> [--decisions-file <json>]',
        questions: '--exp <id> | --run <id>',
        answer: '--question <qid> --text <text>',
        dismiss: '--question <qid>',
        generate: '--jd-file <path> | --jd <text> [--no-background] [--tech-stack]',
        show: '--run <id>',
        inspect: '--exp <id>',
        edit: '--exp <id> --text-file <markdown>（旧 Story 结构）',
        ingest: '--exp <id> --text-file <raw>（v6 自动合并正文 + 派生 Story，无人工确认）',
        narrative: '--exp <id>',
        'edit-narrative': '--exp <id> --text-file <narrative.md>',
        derive: '--exp <id>',
        list: '',
        stats: '',
      },
      flags: ['--mock（离线 mock）', '--data <root>（默认 prototype/local-data）'],
    });
  }
  return out({ error: `未知命令: ${cmd}` }, 2);
}

main().catch((e) => {
  const err = e instanceof AppError ? { error: e.message, code: e.code, details: e.details } : { error: e.message, stack: e.stack };
  console.error(JSON.stringify(err, null, 2));
  process.exit(1);
});
