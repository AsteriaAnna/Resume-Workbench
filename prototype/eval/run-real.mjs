import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = import.meta.dirname;
const REPO = path.resolve(HERE, '..', '..');
const SRC = path.resolve(REPO, '..', '沙盒数据-真实语料-v3');
const JD_DIR = path.resolve(REPO, '..', '回归集');
const RUNTIME = path.join(HERE, 'runtime');
const STAMP = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const OUT = path.join(HERE, 'reports', `real-7x2-${STAMP}`);
const REUSE = process.argv.includes('--reuse-cards');
const SKIP_IMPORT = process.argv.includes('--skip-import');

const norm = (s) => String(s ?? '').replace(/\s+/g, '').replace(/[“”"'']/g, '');
const round = (n, d = 3) => Number.isFinite(n) ? Number(n.toFixed(d)) : 0;
const pct = (a, b) => b ? `${Math.round((a / b) * 1000) / 10}%` : '—';
const uniq = (a) => [...new Set(a)];
const charLen = (s) => [...String(s ?? '')].length;

function quoteMatch(raw, quote) {
  const R = norm(raw), Q = norm(quote);
  if (!Q) return { pass: false, ratio: 0, parts: 0, hitParts: 0 };
  if (R.includes(Q)) return { pass: true, ratio: Q.length / Math.max(1, R.length), parts: 1, hitParts: 1 };
  const parts = String(quote).split(/[。！？；;.!?\n]/).map(norm).filter((x) => x.length >= 4);
  const hit = parts.filter((p) => R.includes(p));
  return { pass: hit.length > 0, ratio: hit.join('').length / Math.max(1, R.length), parts: parts.length, hitParts: hit.length };
}

function numericClaims(text) {
  return [...String(text ?? '').matchAll(/\d+(?:\.\d+)?%?/g)].map((m) => m[0]);
}

function coveredChars(raw, quotes) {
  const R = norm(raw);
  const used = new Uint8Array(R.length);
  for (const q of quotes) {
    const Q = norm(q);
    if (!Q) continue;
    let from = 0;
    while (true) {
      const at = R.indexOf(Q, from);
      if (at < 0) break;
      for (let i = at; i < at + Q.length; i++) used[i] = 1;
      from = at + 1;
    }
  }
  let n = 0;
  for (const x of used) n += x;
  return { covered: n, total: R.length, ratio: R.length ? n / R.length : 0 };
}

function validateContent(content) {
  const errors = [];
  for (const exp of content?.experiences || []) {
    const bg = charLen(exp.project_background || '');
    if (bg < 40 || bg > 60) errors.push(`${exp.exp_id}:背景${bg}字`);
    for (const b of exp.bullets || []) {
      const h = charLen(b.hook || ''), c = charLen(b.content || '');
      if (h < 4 || h > 12) errors.push(`${b.bullet_id}:hook${h}字`);
      if (c < 35 || c > 80) errors.push(`${b.bullet_id}:content${c}字`);
      if (!b.card_id) errors.push(`${b.bullet_id}:缺card_id`);
      if (!b.raw_quote) errors.push(`${b.bullet_id}:缺raw_quote`);
      if (!String(b.focus_angle || '').trim()) errors.push(`${b.bullet_id}:缺focus_angle`);
      if (String(b.content || '').trim().startsWith(String(b.hook || ''))) errors.push(`${b.bullet_id}:content重复hook`);
    }
  }
  return errors;
}

function summarizeExtraction(db) {
  const exps = db.experiences || [], cards = db.cards || [];
  const slotFields = ['slot_stage', 'slot_module', 'slot_problem', 'slot_workflow', 'slot_tech_link', 'slot_outcome'];
  const perExp = [];
  let quotePass = 0, quoteTotal = 0, unsupported = 0, numericTotal = 0, slotFilled = 0, slotTotal = 0;
  for (const e of exps) {
    const cs = cards.filter((c) => c.exp_id === e.exp_id);
    const raw = e.raw_text || '';
    let expQuotePass = 0, expUnsupported = 0, expNumeric = 0;
    for (const c of cs) {
      const qm = quoteMatch(raw, c.raw_quote);
      if (qm.pass) quotePass++;
      if (qm.pass) expQuotePass++;
      quoteTotal++;
      for (const f of slotFields) {
        const v = String(c[f] || '').trim();
        slotTotal++;
        if (v && v !== '未提及') slotFilled++;
        for (const n of numericClaims(v)) {
          numericTotal++; expNumeric++;
          if (!norm(raw).includes(norm(n))) { unsupported++; expUnsupported++; }
        }
      }
    }
    const ordered = cs.map((c) => Number(c.step_order)).filter(Number.isFinite).sort((a, b) => a - b);
    const continuous = ordered.every((n, i) => n === i + 1);
    const cov = coveredChars(raw, cs.map((c) => c.raw_quote));
    perExp.push({
      exp_id: e.exp_id, title: e.title, category: e.category,
      raw_chars: charLen(raw), cards: cs.length,
      avg_slots_filled: round(cs.length ? cs.reduce((n, c) => n + slotFields.filter((f) => c[f] && c[f] !== '未提及').length, 0) / cs.length : 0, 2),
      quote_pass: `${expQuotePass}/${cs.length}`,
      raw_quote_coverage: round(cov.ratio, 3),
      numeric_claims: expNumeric, numeric_unsupported: expUnsupported,
      step_order_continuous: continuous,
      grades: cs.reduce((a, c) => ((a[c.quality_grade] = (a[c.quality_grade] || 0) + 1), a), {}),
    });
  }
  const verified = cards.filter((c) => c.is_verified === true).length;
  return {
    experiences: exps.length, cards: cards.length, verified,
    verified_rate: round(verified / Math.max(1, cards.length), 3),
    avg_cards_per_experience: round(cards.length / Math.max(1, exps.length), 2),
    slot_fill_rate: round(slotFilled / Math.max(1, slotTotal), 3),
    quote_pass_rate: round(quotePass / Math.max(1, quoteTotal), 3),
    numeric_claims: numericTotal,
    numeric_unsupported: unsupported,
    numeric_unsupported_rate: round(unsupported / Math.max(1, numericTotal), 3),
    grade_distribution: cards.reduce((a, c) => ((a[c.quality_grade] = (a[c.quality_grade] || 0) + 1), a), {}),
    per_experience: perExp,
  };
}

function validateBulletEvidence(content, db) {
  const rawByExp = new Map(db.experiences.map((e) => [e.exp_id, e.raw_text || '']));
  let total = 0, pass = 0, unsupported = 0;
  const bad = [];
  for (const exp of content?.experiences || []) {
    const raw = rawByExp.get(exp.exp_id) || '';
    for (const b of exp.bullets || []) {
      total++;
      const ok = quoteMatch(raw, b.raw_quote).pass;
      if (ok) pass++; else bad.push({ bullet_id: b.bullet_id, raw_quote: b.raw_quote });
      const rawN = norm(raw);
      for (const n of numericClaims(b.content)) if (!rawN.includes(norm(n))) unsupported++;
    }
  }
  return { total, quote_pass: pass, quote_pass_rate: round(pass / Math.max(1, total), 3), numeric_unsupported: unsupported, bad_quotes: bad };
}

const EXPECTED = {
  'jd-01-市场部实习生': {
    primary: ['exp_74645d5065a74df4', 'exp_d50a9529b632446a', 'exp_5a658e3efb144562'],
    secondary: ['exp_642a44a57bf84af7', 'exp_b7c1b5a21acf49d8'],
  },
  'jd-02-AI产品实习生': {
    primary: ['exp_5a658e3efb144562', 'exp_74645d5065a74df4', 'exp_d50a9529b632446a'],
    secondary: ['exp_5d4fb766dd414965', 'exp_b7c1b5a21acf49d8'],
  },
};

async function main() {
  await fs.rm(RUNTIME, { recursive: true, force: true });
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.cp(SRC, RUNTIME, { recursive: true });
  process.env.WORKBENCH_DATA_DIR = RUNTIME;
  const v2 = await import(pathToFileURL(path.join(REPO, 'prototype', 'v2.mjs')).href + `?eval=${Date.now()}`);
  const baseline = JSON.parse(await fs.readFile(path.join(SRC, 'v2', 'cards.json'), 'utf8'));
  let db = await v2.loadCards();
  let extractionMode = 'reuse-existing';
  if (!REUSE && !SKIP_IMPORT) {
    console.log('[eval] 真实抽取：7 段经历 ...');
    try {
      db = await v2.importFromWiki((p) => console.log('[ingest]', JSON.stringify(p)));
      extractionMode = 'fresh-import';
    } catch (e) {
      console.log('[eval] 抽取失败，回退基线卡片：', e.message);
      db = baseline;
      await v2.saveCards(db);
      extractionMode = 'baseline-fallback';
    }
  }
  console.log('[eval] cards:', db.experiences.length, 'experiences /', db.cards.length, 'cards /', extractionMode);

  const extraction = summarizeExtraction(db);
  const jds = [
    { id: 'jd-01', file: path.join(JD_DIR, 'jd-01-市场部实习生.md'), key: 'jd-01-市场部实习生' },
    { id: 'jd-02', file: path.join(JD_DIR, 'jd-02-AI产品实习生.md'), key: 'jd-02-AI产品实习生' },
  ];
  const results = [];
  for (const j of jds) {
    const jd = (await fs.readFile(j.file, 'utf8')).trim();
    console.log(`[eval] ${j.id} scan ...`);
    const t0 = Date.now();
    let run, scanMs = 0, composeMs = 0, commentsMs = 0;
    try {
      run = await v2.scan(jd);
      scanMs = Date.now() - t0;
      console.log('[eval] scan ok', run.run_id, 'rankings', run.scan?.experience_rankings?.length);
    } catch (e) {
      results.push({ jd: j.id, error: `scan: ${e.message}` });
      continue;
    }
    const selections = (run.scan?.experience_rankings || []).map((r) => ({
      exp_id: r.exp_id,
      card_ids: (r.selected_cards || []).map((c) => c.card_id),
      strategy: {
        jd_focus: run.scan?.jd_analysis?.jd_focus || '',
        hook_level: run.scan?.jd_analysis?.hook_level || 'L2',
        body_pattern: run.scan?.jd_analysis?.body_pattern || 'CAR',
      },
    })).filter((x) => x.card_ids.length);
    console.log('[eval] selections', selections.map((s) => `${s.exp_id}:${s.card_ids.length}`).join(', '));
    const t1 = Date.now();
    let composed;
    try {
      composed = await v2.compose(run.run_id, selections);
      composeMs = Date.now() - t1;
      console.log('[eval] compose ok', composed.content?.experiences?.length, 'experiences');
    } catch (e) {
      results.push({ jd: j.id, run_id: run.run_id, error: `compose: ${e.message}`, scan_ms: scanMs });
      continue;
    }
    const t2 = Date.now();
    try {
      const withComments = await v2.comments(run.run_id);
      commentsMs = Date.now() - t2;
      composed.comments = withComments.comments || [];
      console.log('[eval] comments', composed.comments.length);
    } catch (e) {
      composed.comments = [];
      console.log('[eval] comments failed', e.message);
    }
    const selectedExpIds = uniq(selections.map((s) => s.exp_id));
    const exp = EXPECTED[j.key] || { primary: [], secondary: [] };
    const primaryHit = exp.primary.filter((id) => selectedExpIds.includes(id));
    const secondaryHit = exp.secondary.filter((id) => selectedExpIds.includes(id));
    const structuralErrors = validateContent(composed.content);
    const evidence = validateBulletEvidence(composed.content, db);
    const bullets = composed.content.experiences.flatMap((e) => e.bullets || []);
    const validCommentAnchors = (composed.comments || []).filter((c) => bullets.some((b) => b.bullet_id === c.bullet_id)).length;
    const allText = JSON.stringify(composed.content);
    results.push({
      jd: j.id, run_id: run.run_id, jd_focus: run.scan?.jd_analysis?.jd_focus,
      hook_level: run.scan?.jd_analysis?.hook_level, body_pattern: run.scan?.jd_analysis?.body_pattern,
      core_demands: run.scan?.jd_analysis?.core_demands || [],
      latency_ms: { scan: scanMs, compose: composeMs, comments: commentsMs, total: scanMs + composeMs + commentsMs },
      selected_experiences: selectedExpIds, selected_cards: selections.reduce((n, s) => n + s.card_ids.length, 0),
      bullet_count: bullets.length, experience_count: composed.content.experiences.length,
      expected_primary: exp.primary, primary_hit: primaryHit, recall_primary: round(primaryHit.length / Math.max(1, exp.primary.length), 3),
      secondary_hit: secondaryHit,
      precision_against_primary: round(primaryHit.length / Math.max(1, selectedExpIds.length), 3),
      structural_errors: structuralErrors,
      evidence,
      comments: { count: composed.comments.length, valid_anchor: validCommentAnchors },
      lengths: {
        avg_content: round(bullets.reduce((n, b) => n + charLen(b.content), 0) / Math.max(1, bullets.length), 1),
        avg_hook: round(bullets.reduce((n, b) => n + charLen(b.hook), 0) / Math.max(1, bullets.length), 1),
        avg_background: round(composed.content.experiences.reduce((n, e) => n + charLen(e.project_background), 0) / Math.max(1, composed.content.experiences.length), 1),
      },
      sample_bullets: bullets.slice(0, 4).map((b) => ({ bullet_id: b.bullet_id, hook: b.hook, content: b.content, card_id: b.card_id })),
      content_chars: allText.length,
    });
  }

  const report = {
    generated_at: new Date().toISOString(),
    model: 'deepseek-flash', extraction_mode: extractionMode,
    data: { experiences: db.experiences.length, cards: db.cards.length, source: '沙盒数据-真实语料-v3', isolated_runtime: path.relative(REPO, RUNTIME) },
    jds: jds.map((j) => ({ id: j.id, file: path.relative(REPO, j.file), expected: EXPECTED[j.key] })),
    extraction,
    results,
    metrics_definition: {
      quote_pass_rate: '卡片 raw_quote 能逐字/部分命中原始 raw 的比例',
      numeric_unsupported_rate: '槽位中数字不在 raw 里的比例（越低越好；0 为理想）',
      raw_quote_coverage: '卡片引用覆盖 raw 字符的比例（近似，低不代表错，只说明卡片是提纯而非复述）',
      recall_primary: '人工设定的主相关经历中，被 scan 选入的比例',
      precision_against_primary: '选入经历中属于主相关经历的比例（分母含补充经历，因此会偏低）',
      structural_errors: '背景/字数/hook/card_id/溯源字段等格式错误数',
      evidence_quote_pass_rate: '生成 bullet 的 raw_quote 在经历 raw 中可核对的比例',
    },
  };
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  const md = renderMarkdown(report);
  await fs.writeFile(path.join(OUT, 'report.md'), md, 'utf8');
  // 复制本次 run 记录，便于复查
  try {
    const runs = await fs.readdir(path.join(RUNTIME, 'v2', 'runs'));
    const ids = new Set(results.map((r) => r.run_id).filter(Boolean));
    await fs.mkdir(path.join(OUT, 'runs'), { recursive: true });
    for (const f of runs) if (ids.has(f.replace(/\.json$/, ''))) await fs.copyFile(path.join(RUNTIME, 'v2', 'runs', f), path.join(OUT, 'runs', f));
  } catch {}
  console.log('\n' + md);
  console.log(`\n[eval] report: ${path.relative(REPO, OUT)}`);
}

function renderMarkdown(r) {
  const lines = [];
  lines.push(`# 真实评测：7 段经历 × 2 份 JD`, '');
  lines.push(`- 生成时间：${r.generated_at}`);
  lines.push(`- 模型：${r.model}`);
  lines.push(`- 数据：${r.data.experiences} 段经历 / ${r.data.cards} 张卡（${r.extraction_mode}）`);
  lines.push(`- 隔离运行目录：\`${r.data.isolated_runtime}\``);
  lines.push(`- 说明：卡片抽取使用当前 v2.3 提示词；生成使用 scan→compose→comments。`);
  lines.push('', '## 评测集', '', '| JD | 主相关经历 | 补充相关 |', '| --- | --- | --- |');
  for (const j of r.jds) lines.push(`| ${j.id} | ${j.expected.primary.join('<br>')} | ${(j.expected.secondary || []).join('<br>') || '—'} |`);
  lines.push('', '## 一、输入→卡片（抽取节点）', '');
  const e = r.extraction;
  lines.push('| 指标 | 值 |', '| --- | --- |');
  lines.push(`| 经历数 | ${e.experiences} |`);
  lines.push(`| 卡片数 | ${e.cards} |`);
  lines.push(`| 平均卡片/经历 | ${e.avg_cards_per_experience} |`);
  lines.push(`| verified 率 | ${pct(e.verified, e.cards)} |`);
  lines.push(`| 槽位填充率 | ${pct(e.slot_fill_rate * 1000, 1000)} |`);
  lines.push(`| 原话命中率 | ${pct(e.quote_pass_rate * 1000, 1000)} |`);
  lines.push(`| 数字无依据 | ${e.numeric_unsupported}/${e.numeric_claims}（${pct(e.numeric_unsupported, e.numeric_claims)}） |`);
  lines.push('', '### 每段经历', '', '| 经历 | 类型 | Raw字 | 卡数 | 平均槽位 | 原话命中 | 引用覆盖率 | 数字无依据 | 连续step | 等级 |', '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |');
  for (const x of e.per_experience) lines.push(`| ${x.title} | ${x.category} | ${x.raw_chars} | ${x.cards} | ${x.avg_slots_filled} | ${x.quote_pass} | ${x.raw_quote_coverage} | ${x.numeric_unsupported}/${x.numeric_claims} | ${x.step_order_continuous ? '✅' : '❌'} | ${JSON.stringify(x.grades)} |`);
  lines.push('', '## 二、生成节点（两份 JD）', '');
  for (const x of r.results) {
    lines.push(`### ${x.jd}${x.error ? '（失败）' : ''}`, '');
    if (x.error) { lines.push(`- 错误：${x.error}`, ''); continue; }
    lines.push(`- run：\`${x.run_id}\``);
    lines.push(`- JD 焦点：${x.jd_focus}`);
    lines.push(`- 策略：${x.hook_level} / ${x.body_pattern}`);
    lines.push(`- 选经历：${x.selected_experiences.join(', ')}（${x.experience_count} 段，${x.bullet_count} 条 bullet）`);
    lines.push(`- 主相关召回：${x.primary_hit.length}/${x.expected_primary.length} = ${pct(x.primary_hit.length, x.expected_primary.length)}`);
    lines.push(`- 主相关精确：${pct(x.primary_hit.length, x.selected_experiences.length)}`);
    lines.push(`- 结构错误：${x.structural_errors.length} ${x.structural_errors.slice(0, 6).join('；')}`);
    lines.push(`- 溯源命中：${x.evidence.quote_pass}/${x.evidence.total} = ${pct(x.evidence.quote_pass, x.evidence.total)}；数字无依据：${x.evidence.numeric_unsupported}`);
    lines.push(`- 评论：${x.comments.count}，有效锚点：${x.comments.valid_anchor}`);
    lines.push(`- 耗时：scan ${x.latency_ms.scan}ms / compose ${x.latency_ms.compose}ms / comments ${x.latency_ms.comments}ms`);
    lines.push(`- 字数：content 均值 ${x.lengths.avg_content} / hook 均值 ${x.lengths.avg_hook} / 背景均值 ${x.lengths.avg_background}`);
    lines.push('', '样例：', '');
    for (const b of x.sample_bullets) lines.push(`- 【${b.hook}】${b.content} \`(${b.card_id})\``);
    lines.push('');
  }
  lines.push('## 三、指标定义与局限', '');
  for (const [k, v] of Object.entries(r.metrics_definition)) lines.push(`- **${k}**：${v}`);
  lines.push('', '- 主相关经历集合是本次评测人工设定（依据 JD 与 raw），不是完美 ground truth；建议后续补 qrels 人工复核。');
  lines.push('- 抽取节点使用当前 v2.3 的 6 槽位提示词，不是最新 INPUT-FOLLOW 的 Story 准入/问题引擎；本报告测的是现有实现。');
  lines.push('- 未做人工逐条质量评分；结构/溯源/召回是自动指标，不能替代人工判断。');
  return lines.join('\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
