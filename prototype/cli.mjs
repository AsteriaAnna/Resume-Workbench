#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadCards, scan, compose, comments, gapCard, graph } from './v2.mjs';

const arg = (name, fallback = '') => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] ?? '' : fallback; };
const has = (name) => process.argv.includes('--' + name);
const out = (obj, code = 0) => { console.log(JSON.stringify(obj, null, 2)); process.exit(code); };
const readJd = async () => {
  const text = arg('jd');
  if (text) return text;
  const file = arg('jd-file');
  return file ? (await fs.readFile(file, 'utf8')).trim() : '';
};
const runById = async (id) => (await fs.readFile(path.join(process.env.WORKBENCH_DATA_DIR || path.join(import.meta.dirname, 'local-data'), 'v2', 'runs', `${id}.json`), 'utf8'));
const autoSelections = (run) => (run.scan?.experience_rankings || []).map((r) => ({
  exp_id: r.exp_id,
  card_ids: (r.selected_cards || []).map((c) => c.card_id),
  strategy: {
    jd_focus: run.scan?.jd_analysis?.jd_focus || '',
    hook_level: run.scan?.jd_analysis?.hook_level || 'L2',
    body_pattern: run.scan?.jd_analysis?.body_pattern || 'CAR',
  },
})).filter((x) => x.card_ids.length);

function validateRun(run) {
  const errors = [];
  if (!run.scan) errors.push('缺少 scan');
  if (!run.content) errors.push('缺少 content');
  for (const exp of run.content?.experiences || []) {
    const bg = [...String(exp.project_background || '')];
    if (bg.length < 40 || bg.length > 60) errors.push(`${exp.exp_id}: project_background ${bg.length} 字（应 40-60）`);
    for (const b of exp.bullets || []) {
      const h = [...String(b.hook || '')], c = [...String(b.content || '')];
      if (h.length < 4 || h.length > 12) errors.push(`${b.bullet_id}: hook ${h.length} 字（应 4-12）`);
      if (c.length < 35 || c.length > 80) errors.push(`${b.bullet_id}: content ${c.length} 字（应 35-80）`);
      if (!b.card_id) errors.push(`${b.bullet_id}: 缺 card_id`);
      if (!b.raw_quote) errors.push(`${b.bullet_id}: 缺 raw_quote（溯源）`);
      if (!String(b.focus_angle || '').trim()) errors.push(`${b.bullet_id}: 缺 focus_angle`);
      if (/(体现了?|展现了?|验证了?|确保了?|保障了?).{0,18}(能力|效果|质量|准确|顺畅)\s*$/.test(String(b.content || '').trim())) errors.push(`${b.bullet_id}: 评价性收尾`);
      if (String(b.content || '').trim().startsWith(String(b.hook || ''))) errors.push(`${b.bullet_id}: content 重复 hook`);
    }
  }
  return errors;
}

const cmd = process.argv[2] || 'help';
async function main() {
try {
  if (cmd === 'state') {
    const db = await loadCards();
    const grades = db.cards.reduce((a, c) => ((a[c.quality_grade] = (a[c.quality_grade] || 0) + 1), a), {});
    return out({ data: process.env.WORKBENCH_DATA_DIR || '(default local-data)', experiences: db.experiences.length, cards: db.cards.length, grades });
  }
  if (cmd === 'import') {
    const { importFromWiki } = await import('./v2.mjs');
    const db = await importFromWiki();
    return out({ ok: true, experiences: db.experiences.length, cards: db.cards.length });
  }
  if (cmd === 'scan') {
    const jd = await readJd();
    if (!jd) return out({ error: '需要 --jd 或 --jd-file' }, 2);
    const run = await scan(jd);
    return out({ run_id: run.run_id, jd_analysis: run.scan?.jd_analysis, rankings: (run.scan?.experience_rankings || []).map((r) => ({ exp_id: r.exp_id, rank: r.priority_rank, decision: r.decision, cards: (r.selected_cards || []).map((c) => c.card_id), gaps: r.gaps })) });
  }
  if (cmd === 'compose') {
    const id = arg('run'); if (!id) return out({ error: '需要 --run <run_id>' }, 2);
    const run0 = JSON.parse(await runById(id));
    let selections = autoSelections(run0);
    if (arg('select-file')) selections = JSON.parse(await fs.readFile(arg('select-file'), 'utf8'));
    if (!selections.length) return out({ error: '没有可编译的选卡' }, 2);
    const run = await compose(id, selections);
    return out({ run_id: run.run_id, experiences: run.content.experiences.length, bullets: run.content.experiences.reduce((n, e) => n + (e.bullets || []).length, 0), validation: validateRun(run) });
  }
  if (cmd === 'comments') {
    const id = arg('run'); if (!id) return out({ error: '需要 --run <run_id>' }, 2);
    const run = await comments(id);
    return out({ run_id: id, comments: run.comments });
  }
  if (cmd === 'gap') {
    const id = arg('run'), cid = arg('comment'), answer = arg('answer');
    if (!id || !cid || !answer) return out({ error: '需要 --run --comment --answer' }, 2);
    const r = await gapCard(id, { comment_id: cid, answer });
    return out({ run_id: id, insufficient: !!r.insufficient, question: r.question || '', card: r.card || null, comments: r.run?.comments || [] });
  }
  if (cmd === 'graph') return out(await graph());
  if (cmd === 'check') {
    const id = arg('run'); if (!id) return out({ error: '需要 --run <run_id>' }, 2);
    const run = JSON.parse(await runById(id));
    const errors = validateRun(run);
    return out({ run_id: id, ok: errors.length === 0, errors }, errors.length ? 1 : 0);
  }
  if (cmd === 'pipeline') {
    const jd = await readJd(); if (!jd) return out({ error: '需要 --jd 或 --jd-file' }, 2);
    const run = await scan(jd);
    const composed = await compose(run.run_id, autoSelections(run));
    const withComments = await comments(run.run_id);
    return out({ run_id: run.run_id, scan: { hook_level: run.scan.jd_analysis.hook_level, body_pattern: run.scan.jd_analysis.body_pattern, selected: autoSelections(run).reduce((n, s) => n + s.card_ids.length, 0) }, compose: { experiences: composed.content.experiences.length, bullets: composed.content.experiences.reduce((n, e) => n + (e.bullets || []).length, 0), validation: validateRun(composed) }, comments: withComments.comments.length });
  }
  out({
    usage: 'node prototype/cli.mjs <command>',
    commands: {
      state: '知识库概况',
      import: '从 Wiki 原始经历重建卡片（需要 data/snapshots + raw）',
      scan: '--jd-file 回归集/jd-01-市场部实习生.md',
      compose: '--run <run_id> [--select-file selections.json]',
      comments: '--run <run_id>',
      gap: '--run <run_id> --comment <comment_id> --answer "..."',
      check: '--run <run_id> 校验字数/溯源/风格',
      graph: '输出图谱 JSON',
      pipeline: '--jd-file ... 一次跑通 scan→compose→comments',
    },
    env: { WORKBENCH_DATA_DIR: '数据目录（默认 prototype/local-data）', DEEPSEEK_MOCK: '=1 使用离线 mock，不调用模型' },
  });
} catch (e) {
  out({ error: e.message, code: e.code || 'ERROR' }, 1);
}

}

main();
