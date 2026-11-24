import { AppError, assert, hash, id, now, QUESTION_BASES, SLOT_KEYS, charLen, quoteMatch } from './types.mjs';
import { promptP2, promptP10 } from './prompts.mjs';
import { storyBrief } from './markdown.mjs';
import { leavesOf } from './types.mjs';
import { extractDraft } from './extract.mjs';

const qid = (q) => `q_${hash(`${q.scope}|${q.basis_type}|${q.target?.experience_id || ''}|${q.target?.story_id || ''}|${(q.missing || []).join(',')}|${q.basis_quote}`)}`;
const uiSlots = (questions) => ({ all: questions, ui: questions.filter((x) => ['candidate', 'asked'].includes(x.status)).slice(0, 3) });

export function detectExperienceCandidates({ experience, model }) {
  const out = [];
  for (const s of leavesOf(model.stories ?? [])) {
    const missing = [];
    if (!s.slots?.outcome || s.slots.outcome === '未提及') missing.push('result');
    if (!/\d/.test(s.slots?.outcome || '') && s.slots?.outcome && s.slots.outcome !== '未提及') missing.push('metric');
    if (!s.slots?.workflow || s.slots.workflow === '未提及') missing.push('workflow');
    if (!s.slots?.problem || s.slots.problem === '未提及') missing.push('problem');
    if (!s.ownership || s.ownership === '未提及') missing.push('ownership');
    if (!s.scope || s.scope === '未提及') missing.push('scope');
    if (missing.length) {
      out.push({
        scope: 'experience', basis_type: 'story_incomplete',
        target: { experience_id: experience.experience_id, story_id: s.story_id },
        basis_quote: s.raw_quotes?.[0] || s.slots?.workflow || s.title,
        missing, source: 'story_slots',
      });
    }
    if (s.slots?.workflow && charLen(s.slots.workflow) < 18) {
      out.push({
        scope: 'experience', basis_type: 'vague_action',
        target: { experience_id: experience.experience_id, story_id: s.story_id },
        basis_quote: s.slots.workflow, missing: ['workflow'], source: 'story_slots',
      });
    }
  }
  return out;
}

export function detectResumeCandidates({ jd, library, coverage, evaluations = [], selectedStoryIds = new Set() }) {
  const selected = new Set(selectedStoryIds);
  const out = [];
  const seen = new Set();
  // 只从 R4 的 matched 关系找「未选中的 direct/adjacent Story」；不做条件行 × 全库排列
  for (const e of evaluations) {
    const exp = library.find((x) => x.experience_id === e.experience_id);
    if (!exp) continue;
    for (const m of e.matched || []) {
      if (!m.story_id || selected.has(m.story_id)) continue;
      // 只接受 R4 明确 direct/adjacent 的未选 Story；support=none 不能证明相关，避免假候选
      if (!['direct', 'adjacent'].includes(m.support)) continue;
      const s = (exp.stories ?? []).find((x) => x.story_id === m.story_id);
      if (!s) continue;
      const hasAction = (s.slots?.workflow && s.slots.workflow !== '未提及') || (s.raw_quotes?.length > 0);
      if (!hasAction) continue; // 至少要有动作/原话，才有补充价值
      const missing = [];
      if (!s.slots?.outcome || s.slots.outcome === '未提及') missing.push('result');
      if (!/\d/.test(s.slots?.outcome || '')) missing.push('metric');
      const key = exp.experience_id + '|' + s.story_id + '|' + m.jd_quote;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        scope: 'resume',
        basis_type: 'adjacent_unselected',
        target: { experience_id: exp.experience_id, story_id: s.story_id },
        jd_quote: m.jd_quote,
        basis_quote: s.raw_quotes?.[0] || s.slots.outcome,
        missing: missing.length ? missing : ['workflow'],
        source: 'R4.matched',
        expected_effect: '补一条覆盖 JD 的 bullet',
      });
    }
  }
  return out;
}

export function validateQuestion(q, { library = [], existing = [] } = {}) {
  assert(q && q.scope && QUESTION_BASES.includes(q.basis_type), 'QUESTION_INVALID', '问题 scope/basis_type 非法');
  assert(String(q.question ?? '').trim().length >= 5, 'QUESTION_INVALID', '问题文案过短');
  assert(String(q.basis_quote ?? '').trim().length > 0, 'QUESTION_INVALID', '问题缺少 basis_quote');
  assert(Array.isArray(q.missing) && q.missing.length > 0, 'QUESTION_INVALID', '问题缺少 missing');
  assert(q.target && (q.target.experience_id || q.target.story_id), 'QUESTION_INVALID', '问题缺少 target');
  if (q.scope === 'experience' && q.target?.experience_id && library.length) {
    const exp = library.find((x) => x.experience_id === q.target.experience_id);
    assert(exp, 'QUESTION_INVALID', `target 经历不存在: ${q.target.experience_id}`);
    if (q.target.story_id) {
      const s = (exp.stories ?? []).find((x) => x.story_id === q.target.story_id);
      assert(s, 'QUESTION_INVALID', `target Story 不存在: ${q.target.story_id}`);
      const raw = exp.markdown || '';
      assert(quoteMatch(raw, q.basis_quote).pass, 'QUESTION_INVALID', `basis_quote 不在 Story 正文中: ${q.basis_quote}`);
    }
  }
  const dup = existing.some((x) => x.scope === q.scope && x.target?.experience_id === q.target?.experience_id && x.target?.story_id === q.target?.story_id && x.basis_quote === q.basis_quote);
  assert(!dup, 'QUESTION_DUPLICATE', '重复问题');
  return true;
}

function normalizeQuestions(raw, defaults) {
  const seen = new Set();
  const out = [];
  for (const q of raw ?? []) {
    const missing = (q.missing || []).map((x) => ({ action: 'workflow' }[x] || x));
    const item = {
      question_id: qid(q),
      scope: q.scope || defaults.scope,
      purpose: q.purpose || defaults.purpose,
      basis_type: q.basis_type,
      target: q.target || defaults.target,
      jd_quote: q.jd_quote || '',
      basis_quote: q.basis_quote || '',
      missing,
      question: q.question || '',
      expected_answer: q.expected_answer || { fields: [], format: '一句话' },
      action: q.action || defaults.action,
      priority: q.priority || 'medium',
      expected_effect: q.expected_effect || '',
      status: 'candidate',
      evidence_rev: defaults.evidence_rev,
    };
    if (seen.has(item.question_id)) continue;
    seen.add(item.question_id);
    out.push(item);
  }
  return out;
}

export async function planExperienceQuestions({ store, llm, experience, model, candidates }) {
  const existing = (await store.loadQuestions('experience', experience.experience_id)).questions || [];
  const p = promptP2({ experience, model, candidates: candidates ?? [] });
  const { json } = await llm.callJSON(p.system, p.user, p);
  await store.debug('P2-experience-questions', { experience_id: experience.experience_id, output: json });
  const questions = normalizeQuestions(json.questions, {
    scope: 'experience', purpose: 'complete_story', target: { experience_id: experience.experience_id },
    action: 'enrich_story', evidence_rev: experience.evidence_rev || 0,
  }).filter((q) => !existing.some((e) => e.question_id === q.question_id));
  const valid = questions.filter((q) => { try { validateQuestion(q, { library: [], existing }); return true; } catch { return false; } });
  const saved = await store.saveQuestions('experience', experience.experience_id, {
    evidence_rev: experience.evidence_rev || 0,
    questions: [...existing, ...valid],
  });
  return { ...uiSlots(saved.questions), candidates: candidates ?? [] };
}

export async function planResumeQuestions({ store, llm, runId, jd, resume, library, coverage, candidates }) {
  const existing = (await store.loadQuestions('resume', runId)).questions || [];
  const p = promptP10({ jd, resume, library: library.map((e) => ({ experience_id: e.experience_id, name: e.name, stories: e.stories.map(storyBrief) })), coverage, candidates });
  const { json } = await llm.callJSON(p.system, p.user, p);
  await store.debug('P10-resume-questions', { run_id: runId, output: json, candidates });
  const rawQuestions = normalizeQuestions(json.questions, {
    scope: 'resume', purpose: 'add_content', target: {},
    action: 'add_bullet', evidence_rev: 0,
  });
  const cands = candidates ?? [];
  const questions = rawQuestions.map((q, i) => {
    const c = cands[i] || cands[0];
    return {
      ...q,
      target: (q.target && (q.target.experience_id || q.target.story_id)) ? q.target : (c?.target || {}),
      jd_quote: q.jd_quote || c?.jd_quote || '',
      basis_quote: q.basis_quote || c?.basis_quote || '',
      missing: (q.missing && q.missing.length) ? q.missing : (c?.missing || []),
    };
  }).filter((q) => !existing.some((e) => e.question_id === q.question_id));
  const valid = questions.filter((q) => { try { validateQuestion(q, { library, existing }); return true; } catch { return false; } });
  const saved = await store.saveQuestions('resume', runId, { evidence_rev: 0, questions: [...existing, ...valid] });
  return { ...uiSlots(saved.questions), candidates: candidates ?? [] };
}

export async function listQuestions({ store, scope, target }) {
  const bundle = target ? await store.loadQuestions(scope, target) : { questions: (await store.listQuestions(scope)).flatMap((x) => x.questions) };
  return uiSlots(bundle.questions || []);
}

export async function answerQuestion({ store, llm, questionId, text }) {
  const bundles = await store.listQuestions();
  let found = null;
  for (const b of bundles) {
    for (const q of b.questions || []) if (q.question_id === questionId) found = { bundle: b, q };
  }
  assert(found, 'QUESTION_NOT_FOUND', `问题不存在: ${questionId}`);
  const { bundle, q } = found;
  assert(q.status !== 'answered' && q.status !== 'dismissed', 'QUESTION_CLOSED', '问题已关闭');
  const exp = await store.readExperience(q.target?.experience_id);
  const raw = await store.appendRaw(exp.experience_id, text);
  const draft = await extractDraft({ store, llm, experience: exp, raw });
  const rev = await store.bumpEvidence(exp.experience_id);
  q.status = 'answered';
  q.answered_at = now();
  q.answer = String(text);
  q.evidence_rev = rev;
  await store.saveQuestions(bundle.scope, bundle.target, { evidence_rev: rev, questions: bundle.questions });
  return { question: q, draft };
}

export async function dismissQuestion({ store, questionId }) {
  const bundles = await store.listQuestions();
  for (const b of bundles) {
    for (const q of b.questions || []) if (q.question_id === questionId) {
      q.status = 'dismissed';
      await store.saveQuestions(b.scope, b.target, { evidence_rev: b.evidence_rev, questions: b.questions });
      return q;
    }
  }
  throw new AppError('QUESTION_NOT_FOUND', `问题不存在: ${questionId}`);
}
