import { promptP4 } from './prompts.mjs';
import { storyBrief } from './markdown.mjs';
import { leavesOf } from './types.mjs';
import { assert } from './types.mjs';

export async function evaluateExperience({ llm, jd, experience, model }) {
  const leaves = leavesOf(model.stories ?? []);
  assert(leaves.length > 0, 'NO_STORIES', `${experience.experience_id}: 没有叶子 Story`);
  const allStories = model.stories ?? [];
  const p = promptP4({
    jd,
    experience: { experience_id: experience.experience_id, type: experience.type, name: experience.name, role: experience.role, time: experience.time },
    stories: allStories.map((s) => ({ ...storyBrief(s), is_container: !!allStories.some((x) => x.parent_story_id === s.story_id) })),
  });
  const { json } = await llm.callJSON(p.system, p.user, p);
  return {
    experience_id: experience.experience_id,
    recommendation: ['use', 'hold', 'drop'].includes(json.recommendation) ? json.recommendation : 'hold',
    matched: Array.isArray(json.matched) ? json.matched : [],
    missing: Array.isArray(json.missing) ? json.missing : [],
    reason: String(json.reason || ''),
  };
}

export async function evaluateAll({ llm, jd, library, concurrency = 3 }) {
  const list = library.filter((e) => e.stories?.length);
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < list.length) {
      const i = cursor++;
      const exp = list[i];
      try { results[i] = await evaluateExperience({ llm, jd, experience: exp, model: exp.model }); }
      catch (e) { results[i] = { experience_id: exp.experience_id, recommendation: 'hold', matched: [], missing: [], reason: `评估失败: ${e.message}`, error: e.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length || 1)) }, worker));
  return results.filter(Boolean);
}

export function aggregateCoverage({ jd, evaluations }) {
  const norm = (s) => String(s || '').replace(/\s+/g, '').replace(/[“”"'']/g, '');
  const byQuote = new Map();
  const lines = String(jd || '')
    .split('\n')
    .map((x) => x.replace(/^\s*(?:[-*]|\d+[.、)])\s*/, '').trim())
    .filter((x) => x && !x.startsWith('#') && x.length >= 8 && x.length <= 160)
    .filter((x) => !/^(公司类型|地点|时长|薪资|每周|这份 ?JD|人工关注点|加分项|岗位方向)[：:]/.test(x));
  for (const line of lines) byQuote.set(line, { jd_quote: line, support: 'none', stories: [] });
  const findLine = (quote) => {
    const q = norm(quote);
    if (!q) return null;
    for (const [line, row] of byQuote) {
      const ln = norm(line);
      if (ln.includes(q) || q.includes(ln)) return row;
    }
    return null;
  };
  for (const e of evaluations) {
    for (const m of e.matched || []) {
      if (!m.jd_quote) continue;
      const row = findLine(m.jd_quote) || (() => { const r = { jd_quote: m.jd_quote, support: 'none', stories: [] }; byQuote.set(m.jd_quote, r); return r; })();
      if (m.support === 'direct') row.support = 'direct';
      else if (m.support === 'adjacent' && row.support !== 'direct') row.support = 'adjacent';
      row.stories.push({ experience_id: e.experience_id, story_id: m.story_id, support: m.support, story_quote: m.story_quote });
    }
    for (const miss of e.missing || []) {
      if (!miss.jd_quote) continue;
      const row = findLine(miss.jd_quote) || (() => { const r = { jd_quote: miss.jd_quote, support: 'none', stories: [] }; byQuote.set(miss.jd_quote, r); return r; })();
      if (row.support === 'none' && !row.stories.length) row.reason = miss.reason || '';
    }
  }
  return {
    jd,
    requirements: [...byQuote.values()],
    recommendation_counts: evaluations.reduce((a, e) => ((a[e.recommendation] = (a[e.recommendation] || 0) + 1), a), {}),
    experiences: evaluations.map((e) => ({ experience_id: e.experience_id, recommendation: e.recommendation, matched: e.matched.length, missing: e.missing.length })),
  };
}

