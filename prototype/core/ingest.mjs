import { AppError, assert, now, SLOT_KEYS, validateMarkdownModel } from './types.mjs';
import { promptP1, promptP11 } from './prompts.mjs';
import { parseNarrative, serializeNarrative, narrativeText, applyPatch } from './narrative.mjs';
import { buildModelFromDraft } from './extract.mjs';
import { serializeMarkdown } from './markdown.mjs';

function storyDraftFromJson(json, experience) {
  assert(Array.isArray(json.stories), 'DERIVE_INVALID', 'P1 输出缺少 stories');
  assert(Array.isArray(json.unassigned_details), 'DERIVE_INVALID', 'P1 必须输出 unassigned_details 数组');
  assert(json.unassigned_details.length === 0, 'UNASSIGNED_INPUT', '正文中存在未归入 Story/Fragment 的信息', { unassigned_details: json.unassigned_details });
  return {
    experience_id: experience.experience_id,
    experienceFields: { type: experience.type, name: experience.name, role: experience.role, time: experience.time },
    created_at: now(),
    prompt_version: 'v6.0',
    stories: (json.stories || []).map((s, i) => ({
      temp_id: String(s.temp_id || `s${i + 1}`),
      parent_temp_id: s.parent_temp_id ? String(s.parent_temp_id) : null,
      order: Number(s.order) || i + 1,
      title: String(s.title || `事件${i + 1}`).slice(0, 30),
      summary: String(s.summary || ''),
      ownership: String(s.ownership || ''),
      scope: String(s.scope || ''),
      slots: Object.fromEntries(SLOT_KEYS.map((k) => [k, String(s.slots?.[k] ?? '')])),
      raw_quotes: Array.isArray(s.raw_quotes) ? s.raw_quotes.map(String).filter(Boolean) : [],
      boundary_reason: String(s.boundary_reason || ''),
      flags: Array.isArray(s.flags) ? s.flags : [],
    })),
    fragments: (json.fragments || []).map((f, i) => ({ temp_id: String(f.temp_id || `f${i + 1}`), body: String(f.body || ''), reason: String(f.reason || '') })).filter((f) => f.body),
    questions: Array.isArray(json.questions) ? json.questions : [],
  };
}

export async function deriveStories({ store, llm, experience }) {
  const narrative = parseNarrative(await store.readNarrative(experience.experience_id), { experience_id: experience.experience_id });
  const text = narrativeText(narrative);
  if (!text.trim()) return { model: { experience: { ...experience }, stories: [], fragments: [] }, markdown: '' };
  const p = promptP1({ experience, raw: text, currentMarkdown: '' });
  const { json } = await llm.callJSON(p.system, p.user, p);
  const draft = storyDraftFromJson(json, experience);
  const model = buildModelFromDraft(draft, null);
  model.experience = { experience_id: experience.experience_id, type: experience.type, name: experience.name, role: experience.role, time: experience.time };
  validateMarkdownModel(model);
  const markdown = serializeMarkdown(model);
  await store.writeMarkdown(experience.experience_id, model);
  await store.saveDraft(experience.experience_id, draft);
  const updated = await store.readExperience(experience.experience_id);
  updated.confirmed_at = now();
  updated.derived_at = now();
  await store.saveExperience(updated);
  return { model, markdown, draft };
}

export async function ingestInput({ store, llm, experienceId, text }) {
  const experience = await store.readExperience(experienceId);
  assert(String(text ?? '').trim(), 'INVALID_RAW', '输入不能为空');
  const raw = await store.appendRaw(experienceId, text);
  const existing = parseNarrative(await store.readNarrative(experienceId), { experience_id: experience.experience_id });
  const history = (await store.listRaw(experienceId)).filter((r) => r.raw_id !== raw.raw_id).slice(-20).map((r) => r.text).join('\n\n');
  const p = promptP11({
    experience: { experience_id: experience.experience_id, type: experience.type, name: experience.name, role: experience.role, time: experience.time },
    narrative: narrativeText(existing),
    raw: text,
    history,
  });
  const { json } = await llm.callJSON(p.system, p.user, p);
  await store.debug('P11-merge', { experience_id: experience.experience_id, output: json, raw: text });
  const ops = Array.isArray(json.operations) ? json.operations : Array.isArray(json.patches) ? json.patches : [];
  const patch = applyPatch(existing, ops, text);
  const next = { experience: { ...existing.experience, ...experience }, paragraphs: patch.model.paragraphs };
  await store.writeNarrative(experienceId, serializeNarrative(next));
  await store.bumpEvidence(experienceId);
  const derived = await deriveStories({ store, llm, experience: await store.readExperience(experienceId) });
  return { raw, patch: { applied: patch.applied, skipped: patch.skipped, unresolved: json.unresolved || [] }, narrative: next, derived };
}

export async function editNarrative({ store, llm, experienceId, markdown }) {
  const experience = await store.readExperience(experienceId);
  const model = parseNarrative(markdown, { experience_id: experienceId });
  assert(model.experience.name || experience.name, 'INVALID_NARRATIVE', '经历缺少 name');
  await store.writeNarrative(experienceId, serializeNarrative(model));
  await store.bumpEvidence(experienceId);
  const derived = await deriveStories({ store, llm, experience: await store.readExperience(experienceId) });
  return { model, derived };
}
