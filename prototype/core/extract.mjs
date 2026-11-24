import { AppError, assert, id, now, norm, SLOT_KEYS, validateMarkdownModel } from './types.mjs';
import { promptP1 } from './prompts.mjs';
import { serializeMarkdown } from './markdown.mjs';

const clone = (v) => JSON.parse(JSON.stringify(v));

export async function extractDraft({ store, llm, experience, raw }) {
  assert(String(raw ?? '').trim().length > 0, 'INVALID_RAW', 'raw 为空');
  const currentMarkdown = await store.readMarkdown(experience.experience_id);
  const p = promptP1({ experience, raw: raw.text, currentMarkdown });
  const { json } = await llm.callJSON(p.system, p.user, p);
  await store.debug('P1-extract', { experience_id: experience.experience_id, raw_id: raw.raw_id, prompt_version: p.tag, output: json });
  assert(Array.isArray(json.stories), 'DRAFT_INVALID', 'P1 输出缺少 stories');
  assert(Array.isArray(json.unassigned_details), 'DRAFT_INVALID', 'P1 必须输出 unassigned_details 数组（用于证明已检查）');
  assert(json.unassigned_details.length === 0, 'UNASSIGNED_INPUT', 'raw 中存在未归入 Story/Fragment 的信息，不能入库', { unassigned_details: json.unassigned_details });
  const draft = {
    experience_id: experience.experience_id,
    raw_id: raw.raw_id,
    prompt_version: 'v5.0',
    created_at: now(),
    stories: json.stories.map((s, i) => ({
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
    fragments: Array.isArray(json.fragments) ? json.fragments.map((f, i) => ({ temp_id: String(f.temp_id || `f${i + 1}`), body: String(f.body || ''), reason: String(f.reason || '') })).filter((f) => f.body) : [],
    questions: Array.isArray(json.questions) ? json.questions : [],
  };
  assert(draft.stories.length > 0 || draft.fragments.length > 0, 'DRAFT_EMPTY', 'P1 既没有 Story 也没有 Fragment');
  const rawN = String(raw.text ?? '').replace(/\s+/g, '').replace(/[“”"'']/g, '');
  for (const s of draft.stories) {
    assert(s.raw_quotes.length > 0, 'DRAFT_INVALID', `${s.temp_id}: 缺少 raw_quotes`);
    assert(s.title, 'DRAFT_INVALID', `${s.temp_id}: 缺少 title`);
    for (const q of s.raw_quotes) {
      const qn = String(q).replace(/\s+/g, '').replace(/[“”"'']/g, '');
      assert(qn.length >= 4 && rawN.includes(qn), 'RAW_QUOTE_NOT_FOUND', `${s.temp_id}: raw_quote 不是本次 raw 的逐字原话: ${q}`);
    }
  }
  draft.unassigned_details = json.unassigned_details || [];
  await store.saveDraft(experience.experience_id, draft);
  return draft;
}

function normalizeDecisions(decisions) {
  if (!decisions) return { deleted: [], patches: {}, merged: [], splits: [] };
  if (Array.isArray(decisions)) {
    const out = { deleted: [], patches: {}, merged: [], splits: [] };
    for (const d of decisions) {
      if (d.action === 'delete') out.deleted.push(d.temp_id);
      else if (d.action === 'patch') out.patches[d.temp_id] = d.patch || {};
      else if (d.action === 'merge') out.merged.push({ from: d.from || [d.temp_id], into: d.into || d.target_temp_id });
      else if (d.action === 'split') out.splits.push({ temp_id: d.temp_id, parts: d.parts || [] });
    }
    return out;
  }
  return {
    deleted: decisions.deleted || decisions.rejected || [],
    patches: decisions.patches || {},
    merged: decisions.merged || [],
    splits: decisions.splits || [],
  };
}

export function buildModelFromDraft(draft, decisionsInput) {
  const decisions = normalizeDecisions(decisionsInput);
  let stories = clone(draft.stories);
  const deleted = new Set(decisions.deleted || []);

  // split
  for (const split of decisions.splits || []) {
    const idx = stories.findIndex((s) => s.temp_id === split.temp_id);
    if (idx < 0) continue;
    const source = stories[idx];
    const hasChildren = stories.some((s) => s.parent_temp_id === source.temp_id);
    if (hasChildren) throw new AppError('SPLIT_HAS_CHILDREN', `${source.temp_id} 有子 Story，不能拆分；请先合并/移动子节点`);
    const parts = (split.parts || []).filter((p) => p && p.title);
    if (parts.length < 2) throw new AppError('SPLIT_INVALID', '拆分至少需要 2 个 part');
    const newStories = parts.map((p, i) => ({
      ...clone(source),
      temp_id: `${source.temp_id}_p${i + 1}`,
      title: String(p.title).slice(0, 30),
      summary: String(p.summary || source.summary || ''),
      slots: { ...source.slots, ...(p.slots || {}) },
      raw_quotes: p.raw_quotes?.length ? p.raw_quotes : source.raw_quotes,
      order: source.order + i,
    }));
    stories.splice(idx, 1, ...newStories);
  }

  // merge
  for (const merge of decisions.merged || []) {
    const from = new Set(merge.from || []);
    const into = stories.find((s) => s.temp_id === merge.into);
    if (!into) throw new AppError('MERGE_INVALID', `合并目标不存在: ${merge.into}`);
    const sources = stories.filter((s) => from.has(s.temp_id) && s.temp_id !== merge.into);
    if (!sources.length) continue;
    for (const src of sources) {
      for (const k of SLOT_KEYS) {
        const a = String(into.slots[k] || '').trim(), b = String(src.slots[k] || '').trim();
        if (b && b !== '未提及' && b !== a) into.slots[k] = a && a !== '未提及' ? `${a}；${b}` : b;
      }
      into.raw_quotes = [...new Set([...(into.raw_quotes || []), ...(src.raw_quotes || [])])];
      if (!into.summary && src.summary) into.summary = src.summary;
      for (const s of stories) if (s.parent_temp_id === src.temp_id) s.parent_temp_id = merge.into;
      deleted.add(src.temp_id);
    }
  }

  // patches
  for (const [tempId, patch] of Object.entries(decisions.patches || {})) {
    const s = stories.find((x) => x.temp_id === tempId);
    if (!s) continue;
    if (patch.title !== undefined) s.title = String(patch.title).slice(0, 30);
    if (patch.summary !== undefined) s.summary = String(patch.summary);
    if (patch.slots) s.slots = { ...s.slots, ...patch.slots };
    if (patch.raw_quotes) s.raw_quotes = patch.raw_quotes;
  }

  stories = stories.filter((s) => !deleted.has(s.temp_id));
  // 父节点不存在/父节点本身是子节点 → 提升为顶层
  const byTemp = new Map(stories.map((s) => [s.temp_id, s]));
  for (const s of stories) {
    if (s.parent_temp_id && !byTemp.has(s.parent_temp_id)) s.parent_temp_id = null;
    if (s.parent_temp_id && byTemp.get(s.parent_temp_id)?.parent_temp_id) s.parent_temp_id = null;
  }
  // 父节点顺序、子节点顺序重排
  const roots = stories.filter((s) => !s.parent_temp_id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  let rootOrder = 0;
  for (const r of roots) {
    r.order = ++rootOrder;
    const children = stories.filter((s) => s.parent_temp_id === r.temp_id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    let childOrder = 0;
    for (const c of children) c.order = ++childOrder;
  }

  // 生成稳定 ID
  const idMap = new Map(stories.map((s) => [s.temp_id, id('story', 6)]));
  const modelStories = stories.map((s) => ({
    story_id: idMap.get(s.temp_id),
    parent_story_id: s.parent_temp_id ? idMap.get(s.parent_temp_id) : null,
    order: s.order,
    title: s.title,
    summary: s.summary,
    ownership: s.ownership || '',
    scope: s.scope || '',
    slots: s.slots,
    raw_quotes: s.raw_quotes,
    flags: s.flags || [],
  }));
  const fragments = (draft.fragments || []).filter((f) => !deleted.has(f.temp_id)).map((f) => ({ body: f.body, reason: f.reason }));
  return {
    experience: {
      experience_id: draft.experience_id,
      ...draft.experienceFields,
    },
    stories: modelStories,
    fragments,
  };
}

function quoteKey(q) { return String(q || '').replace(/\s+/g, '').replace(/[“”"'']/g, ''); }

// 手改保护：已存在的 Story 不因再次抽取而重建；只把“新 raw_quote”的 Story 追加进去。
export function mergeWithCurrent(current, incoming) {
  if (!current) return incoming;
  const existing = current.stories ?? [];
  const quoteToExisting = new Map();
  for (const s of existing) for (const q of s.raw_quotes || []) quoteToExisting.set(quoteKey(q), s);
  const idMap = new Map();
  const additions = [];
  for (const s of incoming.stories ?? []) {
    const hit = (s.raw_quotes || []).map((q) => quoteToExisting.get(quoteKey(q))).find(Boolean);
    if (hit) { idMap.set(s.story_id, hit.story_id); continue; }
    additions.push(s);
  }
  const merged = { experience: current.experience, stories: [...existing], fragments: [...(current.fragments ?? [])] };
  let maxOrder = Math.max(0, ...existing.map((s) => s.order ?? 0));
  for (const s of additions) {
    const parent = s.parent_story_id ? (idMap.get(s.parent_story_id) || s.parent_story_id) : null;
    merged.stories.push({ ...s, parent_story_id: parent && merged.stories.some((x) => x.story_id === parent) ? parent : null, order: ++maxOrder });
  }
  const fragKeys = new Set(merged.fragments.map((f) => norm(f.body)));
  for (const f of incoming.fragments ?? []) if (!fragKeys.has(norm(f.body))) merged.fragments.push(f);
  return merged;
}

export async function confirmDraft({ store, experience, decisions }) {
  const draft = await store.readDraft(experience.experience_id);
  assert(draft, 'NO_DRAFT', '没有可确认的 AI Draft，请先输入内容');
  draft.experienceFields = { type: experience.type, name: experience.name, role: experience.role, time: experience.time };
  const incoming = buildModelFromDraft(draft, decisions);
  incoming.experience = {
    experience_id: experience.experience_id,
    type: experience.type, name: experience.name, role: experience.role, time: experience.time,
  };
  const current = await store.readModel(experience.experience_id);
  const model = mergeWithCurrent(current, incoming);
  model.experience = incoming.experience;
  validateMarkdownModel(model);
  const text = serializeMarkdown(model);
  await store.writeMarkdown(experience.experience_id, model);
  await store.bumpEvidence(experience.experience_id);
  const updated = await store.readExperience(experience.experience_id);
  updated.confirmed_at = now();
  await store.saveExperience(updated);
  return { model, markdown: text };
}

export async function importExperience({ store, llm, input, rawText }) {
  const exp = await store.createExperience(input);
  const raw = await store.appendRaw(exp.experience_id, rawText);
  const draft = await extractDraft({ store, llm, experience: exp, raw });
  return { experience: exp, raw, draft };
}
