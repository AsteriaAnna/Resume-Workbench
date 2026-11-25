import { assert, now } from './types.mjs';
import { parseMarkdown, serializeMarkdown } from './markdown.mjs';
import { extractDraft, confirmDraft } from './extract.mjs';
import { detectExperienceCandidates, planExperienceQuestions, answerQuestion, dismissQuestion, listQuestions } from './questions.mjs';
import { generateResume } from './generate.mjs';
import { ingestInput, editNarrative, deriveStories } from './ingest.mjs';

export async function createExperience({ store, input }) {
  return store.createExperience(input);
}

export async function addExperienceInput({ store, llm, experienceId, text }) {
  const exp = await store.readExperience(experienceId);
  const raw = await store.appendRaw(experienceId, text);
  const draft = await extractDraft({ store, llm, experience: exp, raw });
  return { experience: exp, raw, draft };
}

export async function confirmExperienceStories({ store, llm, experienceId, decisions }) {
  const exp = await store.readExperience(experienceId);
  const { model, markdown } = await confirmDraft({ store, experience: exp, decisions });
  const updated = await store.readExperience(experienceId);
  // 人工确认成功后，旧候选/已问问题统一 expired，再生成新问题
  const old = await store.loadQuestions('experience', experienceId);
  for (const q of old.questions || []) {
    if (['candidate', 'asked'].includes(q.status)) { q.status = 'expired'; q.expired_at = new Date().toISOString(); }
  }
  await store.saveQuestions('experience', experienceId, { evidence_rev: updated.evidence_rev, questions: old.questions || [] });
  const candidates = detectExperienceCandidates({ experience: updated, model });
  const questions = model.stories.length
    ? await planExperienceQuestions({ store, llm, experience: updated, model, candidates })
    : { all: [], ui: [], candidates: [] };
  return { experience: updated, model, markdown, questions };
}

export async function editExperienceMarkdown({ store, experienceId, markdown }) {
  const model = parseMarkdown(markdown, { experience_id: experienceId });
  const text = serializeMarkdown(model);
  await store.writeMarkdown(experienceId, model);
  const rev = await store.bumpEvidence(experienceId);
  const bundle = await store.loadQuestions('experience', experienceId);
  for (const q of bundle.questions || []) {
    if (['candidate', 'asked'].includes(q.status)) { q.status = 'expired'; q.expired_at = new Date().toISOString(); }
  }
  await store.saveQuestions('experience', experienceId, { evidence_rev: rev, questions: bundle.questions || [] });
  return { model, markdown: text, evidence_rev: rev };
}

export async function ingest({ store, llm, experienceId, text, mode = 'registry' }) {
  return ingestInput({ store, llm, experienceId, text, mode });
}

export async function editExperienceNarrative({ store, llm, experienceId, markdown, mode = 'registry' }) {
  return editNarrative({ store, llm, experienceId, markdown, mode });
}

export async function derive({ store, llm, experienceId }) {
  const exp = await store.readExperience(experienceId);
  return deriveStories({ store, llm, experience: exp });
}

export async function generate({ store, llm, jd, config }) {
  return generateResume({ store, llm, jd, config });
}

export async function answer({ store, llm, questionId, text }) {
  return answerQuestion({ store, llm, questionId, text });
}

export async function dismiss({ store, questionId }) {
  return dismissQuestion({ store, questionId });
}

export async function questions({ store, scope, target }) {
  return listQuestions({ store, scope, target });
}

export async function inspectExperience({ store, experienceId }) {
  const exp = await store.readExperience(experienceId);
  const raw = await store.listRaw(experienceId);
  const md = await store.readMarkdown(experienceId);
  const narrative = await store.readNarrative(experienceId);
  let model = null;
  if (md) model = parseMarkdown(md, { experience_id: experienceId });
  const q = await store.loadQuestions('experience', experienceId);
  return { experience: exp, raw, markdown: md, narrative, model, questions: q };
}
