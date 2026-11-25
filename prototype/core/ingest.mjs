import { AppError, assert, now, SLOT_KEYS, validateMarkdownModel } from './types.mjs';
import { promptP1, promptP11, promptP1Update, promptP1Review, promptP1Repair } from './prompts.mjs';
import { parseNarrative, serializeNarrative, narrativeText, applyPatch } from './narrative.mjs';
import { buildModelFromDraft } from './extract.mjs';
import { serializeMarkdown } from './markdown.mjs';
import { registryFromModel, applyStoryOperations } from './story-registry.mjs';

function storyDraftFromJson(json, experience) {
  assert(Array.isArray(json.stories), 'DERIVE_INVALID', 'P1 输出缺少 stories');
  assert(Array.isArray(json.unassigned_details), 'DERIVE_INVALID', 'P1 必须输出 unassigned_details 数组');
  assert(json.unassigned_details.length === 0, 'UNASSIGNED_INPUT', '正文中存在未归入 Story/Fragment 的信息', { unassigned_details: json.unassigned_details });
  return {
    experience_id: experience.experience_id,
    experienceFields: { type: experience.type, name: experience.name, role: experience.role, time: experience.time },
    created_at: now(),
    prompt_version: 'v6.1',
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
      projection_fit: Array.isArray(s.projection_fit) ? s.projection_fit.filter((x) => ['XYZ','CAR','PAR'].includes(x)) : [],
      single_topic: s.single_topic !== false,
      quality_reason: String(s.quality_reason || ''),
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
  await store.debug('P1-derive', { experience_id: experience.experience_id, output: json });
  const draft = storyDraftFromJson(json, experience);
  const passQ = (s) => Array.isArray(s.projection_fit) && s.projection_fit.length > 0 && s.single_topic === true;
  const rejected = [];
  draft.stories = draft.stories.filter((s) => {
    if (passQ(s)) return true;
    rejected.push({ temp_id: s.temp_id, title: s.title, projection_fit: s.projection_fit, single_topic: s.single_topic });
    draft.fragments.push({ temp_id: s.temp_id, body: `${s.title}：${s.raw_quotes?.join(' / ') || ''}`, reason: `准入失败：${s.quality_reason || '无法支撑任一骨架或非单主题'}` });
    return false;
  });
  await store.debug('P1-admission', { experience_id: experience.experience_id, accepted: draft.stories.length, rejected });
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

export async function updateStories({ store, llm, experience, narrative, changedParagraphIds = [], mode = 'registry' }) {
  const text = narrativeText(narrative);
  let registry = await store.readRegistry(experience.experience_id);
  if (!registry) {
    const full = await deriveStories({ store, llm, experience });
    registry = registryFromModel({ model: full.model, experience, narrative });
    await store.writeRegistry(experience.experience_id, registry);
    return { model: full.model, markdown: full.markdown, registry, applied: [], skipped: [], questions: [], mode: 'initial-registry' };
  }
  const p = promptP1Update({ experience, narrative, changedParagraphIds, registry });
  let json;
  try {
    ({ json } = await llm.callJSON(p.system, p.user, p));
  } catch (e) {
    if (e.code !== 'LLM_JSON' || !e.details?.raw) throw e;
    await store.debug('P1-update-invalid', { experience_id: experience.experience_id, raw: e.details.raw });
    const rp = promptP1Repair({ raw: e.details.raw });
    ({ json } = await llm.callJSON(rp.system, rp.user, rp));
  }
  await store.debug('P1-update', { experience_id: experience.experience_id, output: json, changedParagraphIds });
  let result = applyStoryOperations({ registry, operations: json.operations || [], narrative: text, experience });
  let applied = [...result.applied];
  let skipped = [...result.skipped];
  let review = null;
  if (mode === 'curator') {
    try {
      const rp = promptP1Review({ experience, narrative, registry: result.registry });
      const { json: rj } = await llm.callJSON(rp.system, rp.user, rp);
      if (Array.isArray(rj.operations) && rj.operations.length) {
        const rr = applyStoryOperations({ registry: result.registry, operations: rj.operations, narrative: text, experience });
        result = rr;
        applied.push(...rr.applied);
        skipped.push(...rr.skipped);
        review = { operations: rj.operations, applied: rr.applied.length, skipped: rr.skipped };
      } else review = { operations: [], applied: 0, skipped: [] };
    } catch (e) { review = { error: e.message }; }
  }
  await store.writeRegistry(experience.experience_id, result.registry);
  await store.writeMarkdown(experience.experience_id, result.model);
  const updated = await store.readExperience(experience.experience_id);
  updated.derived_at = now();
  await store.saveExperience(updated);
  return { model: result.model, markdown: result.markdown, registry: result.registry, applied, skipped, questions: json.unresolved || [], review, mode };
}

export async function ingestInput({ store, llm, experienceId, text, mode = 'registry' }) {
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
  const updated = await store.readExperience(experienceId);
  let derived;
  if (mode === 'full') derived = await deriveStories({ store, llm, experience: updated });
  else derived = await updateStories({ store, llm, experience: updated, narrative: next, changedParagraphIds: patch.changed_paragraph_ids || [], mode });
  return { raw, patch: { applied: patch.applied, skipped: patch.skipped, unresolved: json.unresolved || [], changed_paragraph_ids: patch.changed_paragraph_ids || [] }, narrative: next, derived };
}

export async function editNarrative({ store, llm, experienceId, markdown, mode = 'registry' }) {
  const experience = await store.readExperience(experienceId);
  const model = parseNarrative(markdown, { experience_id: experienceId });
  assert(model.experience.name || experience.name, 'INVALID_NARRATIVE', '经历缺少 name');
  await store.writeNarrative(experienceId, serializeNarrative(model));
  await store.bumpEvidence(experienceId);
  const derived = await updateStories({ store, llm, experience: await store.readExperience(experienceId), narrative: model, changedParagraphIds: model.paragraphs.map((p) => p.paragraph_id), mode });
  return { model, derived };
}
