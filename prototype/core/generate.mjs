import { AppError, assert, charLen, id, now, quoteMatch, validateContent, validateBullet } from './types.mjs';
import { promptP5, promptP6, promptP7, promptP8 } from './prompts.mjs';
import { storyBrief } from './markdown.mjs';
import { leavesOf } from './types.mjs';
import { evaluateAll, aggregateCoverage } from './retrieval.mjs';
import { detectResumeCandidates, planResumeQuestions } from './questions.mjs';

const numRe = /\d+(?:\.\d+)?%?/g;
const norm = (s) => String(s ?? '').replace(/\s+/g, '');

function renumber(content) {
  for (const exp of content.experiences ?? []) {
    exp.bullets = (exp.bullets ?? []).map((b, i) => ({ ...b, bullet_id: exp.experience_id + '_b' + (i + 1) }));
  }
  return content;
}

function trimAtBoundary(text, max) {
  const chars = [...String(text ?? '')];
  if (chars.length <= max) return String(text ?? '');
  const cut = chars.slice(0, max).join('');
  const at = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('，'), cut.lastIndexOf(';'), cut.lastIndexOf(','));
  return at >= Math.min(18, max - 1) ? cut.slice(0, at + 1) : cut;
}

export function normalizeLengths(content) {
  const adjustments = [];
  for (const exp of content.experiences ?? []) {
    let bg = String(exp.project_background ?? '');
    if (charLen(bg) > 60) { exp.project_background = trimAtBoundary(bg, 60); adjustments.push({ experience_id: exp.experience_id, field: 'background', from: charLen(bg), to: charLen(exp.project_background) }); }
    for (const b of exp.bullets ?? []) {
      if (charLen(b.hook) > 12) { const old = charLen(b.hook); b.hook = trimAtBoundary(b.hook, 12); adjustments.push({ bullet_id: b.bullet_id, field: 'hook', from: old, to: charLen(b.hook) }); }
      if (charLen(b.content) > 70) { const old = charLen(b.content); b.content = trimAtBoundary(b.content, 70); adjustments.push({ bullet_id: b.bullet_id, field: 'content', from: old, to: charLen(b.content) }); }
    }
  }
  return adjustments;
}

export async function planResume({ llm, jd, evaluations, coverage, config = {} }) {
  const p = promptP5({ jd, evaluations, coverage, config });
  const { json } = await llm.callJSON(p.system, p.user, p);
  assert(Array.isArray(json.experiences), 'PLAN_INVALID', 'Planner 缺少 experiences');
  return {
    strategy: {
      hook_level: ['L1', 'L2', 'L3'].includes(json.strategy?.hook_level) ? json.strategy.hook_level : 'L2',
      body_pattern: ['XYZ', 'CAR', 'PAR'].includes(json.strategy?.body_pattern) ? json.strategy.body_pattern : 'CAR',
      jd_focus: String(json.strategy?.jd_focus || ''),
    },
    experiences: json.experiences.slice(0, config.maxExperiences ?? 4).map((e) => ({
      experience_id: String(e.experience_id || ''),
      why: String(e.why || ''),
      bullets: (e.bullets || []).slice(0, config.maxBulletsPerExperience ?? 4).map((b, i) => ({
        story_id: String(b.story_id || ''), jd_quote: String(b.jd_quote || ''), order: Number(b.order) || i + 1,
      })),
      background: e.background || { needed: true, cover: ['背景', '目标', '角色', '范围'] },
    })),
    global_order: json.global_order || [],
    dropped: json.dropped || [],
  };
}

function cleanBullet(b, i, expId, stories) {
  let content = String(b.content || '').trim().replace(/^【[^】]{1,24}】\s*/, '');
  const hook = String(b.hook || '').trim();
  if (hook && content.startsWith(hook)) content = content.slice(hook.length).replace(/^[：:、，\s]+/, '');
  const story = stories.find((s) => s.story_id === b.story_id);
  return {
    bullet_id: `${expId}_b${i + 1}`,
    story_id: String(b.story_id || ''),
    jd_quote: String(b.jd_quote || ''),
    hook,
    content,
    evidence_quote: String(b.evidence_quote || story?.raw_quotes?.[0] || ''),
  };
}

export async function composeExperience({ llm, jd, experience, model, plan, strategy = {}, config = {} }) {
  const stories = (plan.bullets || []).map((b) => (model.stories ?? []).find((s) => s.story_id === b.story_id)).filter(Boolean);
  assert(stories.length > 0, 'COMPOSE_NO_STORY', `${experience.experience_id}: 计划没有有效 Story`);
  const leaves = leavesOf(model.stories ?? []);
  const allowed = stories.filter((s) => leaves.includes(s));
  const p = promptP6({
    jd,
    experience: { experience_id: experience.experience_id, type: experience.type, name: experience.name, role: experience.role, time: experience.time },
    model: allowed.map(storyBrief),
    plan,
    fragments: model.fragments || [],
    strategy,
    config,
  });
  const { json } = await llm.callJSON(p.system, p.user, p);
  const bullets = (json.bullets || []).slice(0, 4).map((b, i) => cleanBullet(b, i, experience.experience_id, allowed));
  for (const b of bullets) {
    const story = allowed.find((s) => s.story_id === b.story_id);
    assert(story, 'COMPOSE_STORY_MISMATCH', `${b.bullet_id}: story_id 不在计划内`);
    const hay = [model.experience?.background, ...(story.raw_quotes || []), ...Object.values(story.slots || {})].join('\n');
    assert(quoteMatch(hay, b.evidence_quote).pass, 'COMPOSE_QUOTE', `${b.bullet_id}: evidence_quote 不在 Story 中`);
  }
  const out = {
    experience_id: experience.experience_id,
    title: experience.name,
    type: experience.type,
    bullets,
  };
  if (config.show_background !== false) out.project_background = String(json.project_background || '').trim();
  if (config.show_tech_stack === true) out.tech_stack = Array.isArray(json.tech_stack) ? json.tech_stack.map(String).filter(Boolean).slice(0, 6) : [];
  return out;
}

export async function composeResume({ llm, jd, library, plan, config = {} }) {
  const out = [];
  for (const item of plan.experiences || []) {
    const exp = library.find((e) => e.experience_id === item.experience_id);
    if (!exp) continue;
    try {
      out.push(await composeExperience({ llm, jd, experience: exp, model: exp.model, plan: item, strategy: plan.strategy || {}, config }));
    } catch (e) {
      out.push({ experience_id: item.experience_id, title: exp.name, type: exp.type, bullets: [], error: e.message });
    }
  }
  return { experiences: out };
}

export async function critique({ llm, jd, content, coverage }) {
  const p = promptP7({ jd, content, coverage });
  const { json } = await llm.callJSON(p.system, p.user, p);
  return Array.isArray(json.issues) ? json.issues : [];
}

export async function revise({ llm, jd, content, issues }) {
  const p = promptP8({ jd, content, issues });
  const { json } = await llm.callJSON(p.system, p.user, p);
  return { content: json.content || content, applied_issue_ids: json.applied_issue_ids || [], remaining: json.remaining || [] };
}

export function validateGenerated({ content, library, jd = '' }) {
  const errors = validateContent(content, { maxExperiences: 4, maxBulletsPerExperience: 4 });
  const issues = errors.map((e) => ({ type: 'length', severity: 'blocker', location: {}, problem: e, suggestion: '修正字数/结构' }));
  const seenBullets = new Map();
  const jdN = String(jd || '').replace(/\s+/g, '');
  const byExp = new Map(library.map((e) => [e.experience_id, e]));
  for (const exp of content.experiences ?? []) {
    const source = byExp.get(exp.experience_id);
    for (const b of exp.bullets ?? []) {
      for (const e of validateBullet(b)) issues.push({ type: 'bullet', severity: 'blocker', location: { experience_id: exp.experience_id, bullet_id: b.bullet_id }, problem: e, suggestion: '修正 bullet 格式' });
      if (source) {
        const story = (source.stories ?? []).find((s) => s.story_id === b.story_id);
        if (!story) issues.push({ type: 'evidence', severity: 'blocker', location: { experience_id: exp.experience_id, bullet_id: b.bullet_id }, problem: 'story_id 不存在', suggestion: '只能引用已确认 Story' });
        else if ((source.stories ?? []).some((x) => x.parent_story_id === story.story_id)) issues.push({ type: 'evidence', severity: 'blocker', location: { experience_id: exp.experience_id, bullet_id: b.bullet_id }, problem: '父 Story 不能作为 bullet 证据', suggestion: '改用叶子 Story' });
        if (jdN && b.jd_quote && !jdN.includes(String(b.jd_quote).replace(/\s+/g, ''))) issues.push({ type: 'evidence', severity: 'warning', location: { experience_id: exp.experience_id, bullet_id: b.bullet_id }, problem: 'jd_quote 不在 JD 原文中', suggestion: '改用 JD 逐字引用' });
        else {
          const hay = [story.raw_quotes?.join('\n'), ...Object.values(story.slots || {})].join('\n');
          if (b.evidence_quote && !quoteMatch(hay, b.evidence_quote).pass) issues.push({ type: 'evidence', severity: 'blocker', location: { experience_id: exp.experience_id, bullet_id: b.bullet_id }, problem: 'evidence_quote 不在 Story 中', suggestion: '删除或改回可核对事实' });
          const hayN = norm(hay);
          for (const n of String(b.content || '').match(numRe) || []) {
            if (!hayN.includes(norm(n))) issues.push({ type: 'overclaim', severity: 'warning', location: { experience_id: exp.experience_id, bullet_id: b.bullet_id }, problem: `数字 ${n} 不在 Story 中（可能是推导）`, suggestion: '补口径或删除推导数字' });
          }
        }
      }
      const ck = norm(b.content);
      if (ck && seenBullets.has(ck)) issues.push({ type: 'duplication', severity: 'warning', location: { experience_id: exp.experience_id, bullet_id: b.bullet_id }, problem: `与 ${seenBullets.get(ck)} 内容重复`, suggestion: '合并或删除重复 bullet' });
      if (ck) seenBullets.set(ck, b.bullet_id);
      const pairs = [['（', '）'], ['(', ')']];
      for (const [leftChar, rightChar] of pairs) {
        const left = (String(b.content).match(new RegExp(`\\${leftChar}`, 'g')) || []).length;
        const right = (String(b.content).match(new RegExp(`\\${rightChar}`, 'g')) || []).length;
        if (left !== right) issues.push({ type: 'syntax', severity: 'warning', location: { experience_id: exp.experience_id, bullet_id: b.bullet_id }, problem: '括号不闭合', suggestion: '修复标点' });
      }
    }
  }
  return { errors, issues };
}

export async function generateResume({ store, llm, jd, config = {} }) {
  const runId = id('run', 7);
  const library = (await store.loadLibrary()).filter((e) => e.stories?.length);
  assert(library.length >= 3, 'LIBRARY_TOO_SMALL', `已确认 Story 的经历不足 3 段（当前 ${library.length}）`);
  const evaluations = await evaluateAll({ llm, jd, library, concurrency: config.concurrency ?? 3 });
  const coverage = aggregateCoverage({ jd, evaluations });
  const plan = await planResume({ llm, jd, evaluations, coverage, config });
  let content = await composeResume({ llm, jd, library, plan, config });
  const validationBefore = validateGenerated({ content, library, jd });
  let issues = [...await critique({ llm, jd, content, coverage }), ...validationBefore.issues];
  let revision = null;
  if (issues.some((x) => ['blocker', 'warning'].includes(x.severity)) && (config.revise ?? true)) {
    try {
      const revised = await revise({ llm, jd, content, issues: issues.filter((x) => ['blocker', 'warning'].includes(x.severity)) });
      content = revised.content || content;
      renumber(content);
      revision = { applied: true, applied_issue_ids: revised.applied_issue_ids || [], remaining: revised.remaining || [] };
      issues = [...await critique({ llm, jd, content, coverage }), ...validateGenerated({ content, library, jd }).issues];
    } catch (e) { revision = { applied: false, error: e.message }; }
  }
  renumber(content);
  const adjustments = normalizeLengths(content);
  const validation = validateGenerated({ content, library, jd });
  await store.debug('generate', { run_id: runId, jd, evaluations, coverage, plan, content, issues, validation, revision });
  const selectedStoryIds = new Set((plan.experiences || []).flatMap((e) => (e.bullets || []).map((b) => b.story_id)));
  const candidates = detectResumeCandidates({ jd, library, coverage, evaluations, selectedStoryIds });
  let questions = { all: [], ui: [] };
  if (candidates.length) {
    try {
      questions = await planResumeQuestions({ store, llm, runId, jd, resume: content, library, coverage, candidates });
    } catch (e) {
      questions = { all: [], ui: [], error: e.message };
    }
  }
  const run = {
    run_id: runId,
    created_at: now(),
    jd,
    model: llm.config?.model || '',
    prompt_version: 'v5.0',
    llm_stats: llm.stats,
    evaluations,
    coverage,
    plan,
    content,
    issues,
    revision,
    adjustments,
    validation,
    questions,
    candidates,
  };
  await store.saveRun(run);
  return run;
}
