import { assert, hash, id, norm, now, quoteMatch } from './types.mjs';
import { serializeMarkdown } from './markdown.mjs';
import { validateMarkdownModel } from './types.mjs';

const anchorKey = (expId, anchors, title) => `story_${hash(`${expId}|${(anchors || []).map(norm).join('|')}|${String(title || '').trim()}`)}`;

function paragraphIdsForQuote(paragraphs, quote) {
  const q = norm(quote);
  if (!q) return [];
  return paragraphs.filter((p) => norm(p.text).includes(q)).map((p) => p.paragraph_id);
}

export function registryFromModel({ model, experience, narrative }) {
  const stories = (model.stories ?? []).map((s, i) => {
    const anchors = s.raw_quotes ?? [];
    const key = anchorKey(experience.experience_id, anchors, s.title);
    return {
      story_id: key,
      story_key: key,
      experience_id: experience.experience_id,
      title: s.title,
      summary: s.summary || '',
      ownership: s.ownership || '',
      scope: s.scope || '',
      slots: s.slots,
      raw_quotes: anchors,
      source_paragraph_ids: paragraphIdsForQuote(narrative?.paragraphs ?? [], anchors[0] || ''),
      parent_story_id: s.parent_story_id || null,
      order: s.order ?? i + 1,
      projection_fit: s.projection_fit || [],
      single_topic: s.single_topic !== false,
      quality_reason: s.quality_reason || '',
      status: 'active',
      version: 1,
      updated_at: now(),
    };
  });
  return {
    experience_id: experience.experience_id,
    updated_at: now(),
    stories,
    fragments: model.fragments ?? [],
  };
}

export function buildModelFromRegistry(registry, experience) {
  const active = (registry.stories ?? []).filter((s) => s.status === 'active');
  return {
    experience: {
      experience_id: experience.experience_id,
      type: experience.type, name: experience.name, role: experience.role, time: experience.time,
      background: experience.background || '',
    },
    stories: active.map((s) => ({
      story_id: s.story_id,
      parent_story_id: s.parent_story_id || null,
      order: s.order,
      title: s.title,
      summary: s.summary || '',
      ownership: s.ownership || '',
      scope: s.scope || '',
      slots: s.slots,
      raw_quotes: s.raw_quotes,
      flags: s.flags || [],
    })),
    fragments: registry.fragments || [],
  };
}

export function renderRegistry({ registry, experience }) {
  const text = serializeMarkdown(buildModelFromRegistry(registry, experience));
  return { model: buildModelFromRegistry(registry, experience), markdown: text };
}

function ensureQuotes(quotes, narrative) {
  const bad = [];
  for (const q of quotes || []) if (!quoteMatch(narrative, q).pass) bad.push(q);
  return bad;
}

export function applyStoryOperations({ registry, operations, narrative, experience }) {
  const reg = JSON.parse(JSON.stringify(registry || { experience_id: experience.experience_id, stories: [], fragments: [] }));
  reg.stories ||= [];
  reg.fragments ||= [];
  const byId = () => new Map(reg.stories.map((s) => [s.story_id, s]));
  const applied = [], skipped = [];

  for (const op of operations || []) {
    try {
      if (op.op === 'create') {
        assert(op.story && op.story.title, 'STORY_CREATE_INVALID', 'create 缺少 story.title');
        const projectionFitRaw = Array.isArray(op.projection_fit) ? op.projection_fit : (Array.isArray(op.story?.projection_fit) ? op.story.projection_fit : []);
        const projectionFit = projectionFitRaw.filter((x) => ['XYZ','CAR','PAR'].includes(x));
        assert(projectionFit.length > 0, 'STORY_QUALITY', 'create 无法支撑任一骨架（XYZ/CAR/PAR）');
        assert((op.single_topic ?? op.story?.single_topic) !== false, 'STORY_QUALITY', 'create 必须是单主题');
        const anchors = Array.isArray(op.anchor_quotes) ? op.anchor_quotes : [];
        const bad = ensureQuotes(anchors, narrative);
        assert(!bad.length, 'STORY_QUOTE_INVALID', `create anchor_quotes 不在正文中: ${bad.join(' / ')}`);
        const key = anchorKey(experience.experience_id, anchors, op.story.title);
        const existing = reg.stories.find((s) => s.status === 'active' && s.story_key === key);
        if (existing) {
          existing.version++;
          existing.updated_at = now();
          existing.slots = { ...existing.slots, ...(op.story.slots || {}) };
          existing.raw_quotes = [...new Set([...(existing.raw_quotes || []), ...anchors])];
          existing.source_paragraph_ids = [...new Set([...(existing.source_paragraph_ids || []), ...(op.source_paragraph_ids || [])])];
          applied.push({ ...op, _deduped_into: existing.story_id });
          continue;
        }
        reg.stories.push({
          story_id: key, story_key: key, experience_id: experience.experience_id,
          title: String(op.story.title).slice(0, 30), summary: String(op.story.summary || ''),
          ownership: String(op.story.ownership || ''), scope: String(op.story.scope || ''),
          slots: { stage: '', module: '', problem: '', workflow: '', tech_link: '', outcome: '', ...(op.story.slots || {}) },
          raw_quotes: anchors, source_paragraph_ids: op.source_paragraph_ids || [],
          parent_story_id: op.parent_story_id || null, order: reg.stories.length + 1,
          status: 'active', version: 1, updated_at: now(), flags: [], projection_fit: projectionFit, single_topic: (op.single_topic ?? op.story?.single_topic) !== false, quality_reason: String(op.quality_reason || op.story?.quality_reason || ''),
        });
        applied.push(op);
      } else if (op.op === 'update') {
        const s = byId().get(op.story_id);
        assert(s && s.status === 'active', 'STORY_UPDATE_MISSING', `update 目标不存在: ${op.story_id}`);
        const patch = op.patch || {};
        const anchors = patch.raw_quotes || [];
        const bad = ensureQuotes(anchors, narrative);
        assert(!bad.length, 'STORY_QUOTE_INVALID', `update raw_quotes 不在正文中: ${bad.join(' / ')}`);
        for (const k of ['title', 'summary', 'ownership', 'scope']) if (patch[k] !== undefined) s[k] = String(patch[k]);
        if (patch.slots) s.slots = { ...s.slots, ...patch.slots };
        if (patch.raw_quotes) s.raw_quotes = [...new Set([...(s.raw_quotes || []), ...patch.raw_quotes])];
        if (op.source_paragraph_ids) s.source_paragraph_ids = [...new Set([...(s.source_paragraph_ids || []), ...op.source_paragraph_ids])];
        s.version++; s.updated_at = now();
        applied.push(op);
      } else if (op.op === 'merge') {
        const target = byId().get(op.target_story_id);
        assert(target && target.status === 'active', 'STORY_MERGE_MISSING', `merge 目标不存在: ${op.target_story_id}`);
        for (const sid of op.story_ids || []) {
          if (sid === target.story_id) continue;
          const src = byId().get(sid);
          if (!src || src.status !== 'active') continue;
          target.raw_quotes = [...new Set([...(target.raw_quotes || []), ...(src.raw_quotes || [])])];
          target.source_paragraph_ids = [...new Set([...(target.source_paragraph_ids || []), ...(src.source_paragraph_ids || [])])];
          for (const k of ['stage', 'module', 'problem', 'workflow', 'tech_link', 'outcome']) {
            const a = String(target.slots?.[k] || ''), b = String(src.slots?.[k] || '');
            if (b && b !== '未提及' && b !== a) target.slots[k] = a && a !== '未提及' ? `${a}；${b}` : b;
          }
          src.status = 'merged'; src.merged_into = target.story_id; src.updated_at = now();
        }
        target.version++; target.updated_at = now();
        applied.push(op);
      } else if (op.op === 'split') {
        const src = byId().get(op.story_id);
        assert(src && src.status === 'active', 'STORY_SPLIT_MISSING', `split 目标不存在: ${op.story_id}`);
        const parts = op.parts || [];
        assert(parts.length >= 2, 'STORY_SPLIT_INVALID', 'split 至少需要 2 个 part');
        const newStories = parts.map((p, i) => ({
          story_id: anchorKey(experience.experience_id, p.anchor_quotes || [], p.story?.title || `part${i + 1}`),
          story_key: null, experience_id: experience.experience_id,
          title: String(p.story?.title || `${src.title}（${i + 1}）`).slice(0, 30),
          summary: String(p.story?.summary || ''), ownership: src.ownership, scope: src.scope,
          slots: { ...src.slots, ...(p.story?.slots || {}) },
          raw_quotes: p.anchor_quotes || src.raw_quotes,
          source_paragraph_ids: p.source_paragraph_ids || src.source_paragraph_ids,
          parent_story_id: src.parent_story_id || null, order: src.order + i,
          status: 'active', version: 1, updated_at: now(), flags: [],
        }));
        for (const ns of newStories) ns.story_key = ns.story_id;
        src.status = 'split'; src.updated_at = now();
        reg.stories.push(...newStories);
        applied.push(op);
      } else if (op.op === 'delete') {
        const s = byId().get(op.story_id);
        if (s && s.status === 'active') { s.status = 'deleted'; s.updated_at = now(); applied.push(op); }
        else skipped.push({ op, reason: 'delete 目标不存在或不再 active' });
      } else skipped.push({ op, reason: `未知 op: ${op.op}` });
    } catch (e) {
      skipped.push({ op, reason: e.message });
    }
  }
  // 只保留 active 的父引用；重新编号
  const activeIds = new Set(reg.stories.filter((s) => s.status === 'active').map((s) => s.story_id));
  for (const s of reg.stories) if (s.parent_story_id && !activeIds.has(s.parent_story_id)) s.parent_story_id = null;
  const roots = reg.stories.filter((s) => s.status === 'active' && !s.parent_story_id).sort((a, b) => a.order - b.order);
  let order = 1;
  for (const r of roots) {
    r.order = order++;
    const children = reg.stories.filter((s) => s.status === 'active' && s.parent_story_id === r.story_id).sort((a, b) => a.order - b.order);
    let co = 1;
    for (const c of children) c.order = co++;
  }
  reg.updated_at = now();
  const rendered = renderRegistry({ registry: reg, experience });
  try { validateMarkdownModel(rendered.model); } catch (e) { throw e; }
  return { registry: reg, applied, skipped, model: rendered.model, markdown: rendered.markdown };
}
