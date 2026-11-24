import fs from 'node:fs/promises';
import path from 'node:path';

const REPORTS = path.resolve(import.meta.dirname, 'reports');
const dirs = (await fs.readdir(REPORTS)).filter((x) => x.startsWith('real-7x2-')).sort();
const out = path.join(REPORTS, dirs.at(-1));
const report = JSON.parse(await fs.readFile(path.join(out, 'report.json'), 'utf8'));

const charLen = (s) => [...String(s ?? '')].length;
const norm = (s) => String(s ?? '').replace(/\s+/g, '');
const numRe = /\d+(?:\.\d+)?%?/g;
const uniq = (a) => [...new Set(a)];

function punctuationImbalance(s) {
  const pairs = [['（', '）'], ['(', ')'], ['【', '】'], ['[', ']']];
  return pairs.some(([a, b]) => (String(s).match(new RegExp(`\\${a}`, 'g')) || []).length !== (String(s).match(new RegExp(`\\${b}`, 'g')) || []).length);
}

function bigrams(s) {
  const t = norm(s);
  const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}
function jaccard(a, b) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / Math.max(1, a.size + b.size - inter);
}

const enriched = [];
for (const r of report.results) {
  if (r.error) { enriched.push({ ...r }); continue; }
  const run = JSON.parse(await fs.readFile(path.join(out, 'runs', `${r.run_id}.json`), 'utf8'));
  const allBullets = run.content.experiences.flatMap((e) => e.bullets || []);
  const rawByExp = new Map((await (async () => {
    const db = JSON.parse(await fs.readFile(path.resolve(import.meta.dirname, 'runtime/v2/cards.json'), 'utf8'));
    return db.experiences.map((e) => [e.exp_id, e.raw_text || '']);
  })()));
  const unsupported = [];
  for (const e of run.content.experiences) {
    const raw = norm(rawByExp.get(e.exp_id) || '');
    for (const b of e.bullets || []) {
      for (const n of [...String(b.content).matchAll(numRe)].map((m) => m[0])) {
        if (!raw.includes(norm(n))) unsupported.push({ bullet_id: b.bullet_id, number: n, content: b.content });
      }
    }
  }
  const punct = allBullets.filter((b) => punctuationImbalance(b.content)).map((b) => b.bullet_id);
  const dup = [];
  for (let i = 0; i < allBullets.length; i++) for (let j = i + 1; j < allBullets.length; j++) {
    const s = jaccard(bigrams(allBullets[i].content), bigrams(allBullets[j].content));
    if (s >= 0.55) dup.push({ a: allBullets[i].bullet_id, b: allBullets[j].bullet_id, similarity: Number(s.toFixed(2)) });
  }
  const bulletDist = Object.fromEntries(run.content.experiences.map((e) => [e.exp_id, (e.bullets || []).length]));
  const selectedExp = uniq(run.content.experiences.map((e) => e.exp_id));
  enriched.push({
    ...r,
    planning: {
      selected_experience_count: selectedExp.length,
      experience_target: '3–4 段',
      experience_count_compliant: selectedExp.length >= 3 && selectedExp.length <= 4,
      bullet_distribution: bulletDist,
      avg_bullets_per_experience: Number((allBullets.length / Math.max(1, selectedExp.length)).toFixed(2)),
    },
    quality: {
      punctuation_imbalance: punct,
      punctuation_balance_rate: Number(((allBullets.length - punct.length) / Math.max(1, allBullets.length)).toFixed(3)),
      unsupported_numbers: unsupported,
      duplicate_pairs: dup,
    },
  });
}

const lowCard = report.extraction.per_experience.filter((e) => e.cards < 3).map((e) => ({ exp_id: e.exp_id, title: e.title, cards: e.cards }));
const highCard = report.extraction.per_experience.filter((e) => e.cards > 8).map((e) => ({ exp_id: e.exp_id, title: e.title, cards: e.cards }));

const findings = {
  generated_at: new Date().toISOString(), source_report: path.relative(path.resolve(import.meta.dirname, '../..'), out),
  extraction: {
    cards: report.extraction.cards,
    experiences: report.extraction.experiences,
    low_card_experiences: lowCard,
    high_card_experiences: highCard,
    card_count_note: '当前 v2.3 prompt 目标 4–8 张/核心经历；实测 1–6 张，说明切分密度不足/受 raw 长度影响，需要人工确认或调 prompt。',
  },
  results: enriched,
};
await fs.writeFile(path.join(out, 'analysis.json'), JSON.stringify(findings, null, 2), 'utf8');

const lines = [];
lines.push('# 评测补充分析（自动指标 + 发现）', '');
lines.push(`- 源报告：\`${path.relative(path.resolve(import.meta.dirname, '../..'), out)}\``);
lines.push(`- 生成时间：${findings.generated_at}`);
lines.push('', '## 一、新增检测指标', '');
lines.push('| 指标 | 含义 | 为什么重要 |', '| --- | --- | --- |');
lines.push('| 选经历数合规 | 3–4 段为理想 | 超过 4 段会挤占篇幅、稀释重点 |');
lines.push('| 每段 bullet 分布 | 每段 3–4 条为理想 | 检查是否“一段独大/其他陪跑” |');
lines.push('| 标点平衡率 | 括号等成对符号是否闭合 | 结构校验抓不到的“生成语病” |');
lines.push('| 数字无依据 | bullet 数字不在该经历 raw 中 | 防止模型做算术推导/夸大（如 6×40=240） |');
lines.push('| 重复 bullet 对 | 两两 bigram Jaccard ≥0.55 | 检查同一事实重复讲 |');
lines.push('| 低卡经历 | 卡片数 <3 | 可能切分不足，story 不够支撑 3–4 条 |');
lines.push('', '## 二、结果', '');
for (const r of enriched) {
  if (r.error) { lines.push(`### ${r.jd}：失败 - ${r.error}`, ''); continue; }
  lines.push(`### ${r.jd}`, '');
  lines.push(`- 选经历：${r.planning.selected_experience_count} 段（合规：${r.planning.experience_count_compliant ? '是' : '否'}）`);
  lines.push(`- 每段 bullet：${Object.entries(r.planning.bullet_distribution).map(([k, v]) => `${k}=${v}`).join('，')}`);
  lines.push(`- 平均 bullet/段：${r.planning.avg_bullets_per_experience}`);
  lines.push(`- 标点平衡率：${(r.quality.punctuation_balance_rate * 100).toFixed(1)}%${r.quality.punctuation_imbalance.length ? `（${r.quality.punctuation_imbalance.join('、')}）` : ''}`);
  lines.push(`- 数字无依据：${r.quality.unsupported_numbers.length ? r.quality.unsupported_numbers.map((x) => `${x.number}@${x.bullet_id}`).join('、') : '0'}`);
  lines.push(`- 重复 bullet 对：${r.quality.duplicate_pairs.length ? JSON.stringify(r.quality.duplicate_pairs) : '0'}`);
  lines.push('');
}
lines.push('## 三、关键发现', '');
lines.push('1. **抽取的溯源很干净**：24 张卡 100% verified，raw_quote 命中 100%，槽位数字 0 条无依据；但引用覆盖率最低到 0.242（扣子）——说明卡片是提纯而非复述，**低覆盖不等于错，但可能漏掉 raw 细节**，需要人工抽查。');
lines.push('2. **切分密度偏保守**：7 段经历共 24 张卡，3 段经历 ≤3 张（校内 AI 仅 1 张）；按“一段核心经历 5–8 张”的旧目标看，部分经历不足以支撑 4 条 bullet。');
lines.push('3. **选材数量超标**：JD-01 选了 5 段经历/13 条 bullet，超过 3–4 段的目标；JD-02 4 段/10 条，基本合规。说明 scan 的“主推最多 2 + 略写最多 3”仍会产出 5 段。');
lines.push('4. **结构合规不等于表达合规**：JD-02 有 1 条括号不闭合（`二群承接分享与抽奖）`），所有字数/字段校验都通过；需要加“标点/句子完整性”校验。');
lines.push('5. **数字幻觉是“推导型”而非“凭空编”**：JD-01 的 `240 人次` 来自 6 场 × 40 人，但 raw 只写了“6 场、每场约 40 人”，没有 240；这类“合理推导”也要拦截或标注口径。');
lines.push('6. **评论仍是旧实现**：两份 JD 各 4 条、4 个有效锚点，但这是 `PROMPT_COMMENTS` 的固定 4 条上限，不是新设计的问题引擎（没有全部输出/状态/更新）。');
lines.push('', '## 四、建议下一步', '');
lines.push('- 生成前加 planning 硬约束：最多 4 段、每段最多 4 条；超过要说明理由；');
lines.push('- 加数字/标点校验：数字必须在 raw 或卡片中逐字出现；括号必须闭合；');
lines.push('- 抽卡阶段加“低卡经历”提示：<3 张时建议重切或提问，不直接进入生成；');
lines.push('- 用新设计的问题引擎替代 comments：全部候选、状态、气泡 UI 只展示 3 个。');
await fs.writeFile(path.join(out, 'analysis.md'), lines.join('\n'), 'utf8');
console.log(lines.join('\n'));
console.log('\n[analysis]', path.relative(path.resolve(import.meta.dirname, '../..'), out));
