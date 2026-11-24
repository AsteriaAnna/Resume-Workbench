import { assert, charLen, SLOT_KEYS, validateMarkdownModel } from './types.mjs';

const FRONT_KEYS = ['experience_id', 'type', 'name', 'role', 'time'];
const SLOT_LABEL = {
  stage: '阶段',
  module: '模块',
  problem: '问题/判断',
  workflow: '流程',
  tech_link: '技术/方法',
  outcome: '结果',
};
const SLOT_FROM_LABEL = Object.fromEntries(Object.entries(SLOT_LABEL).map(([k, v]) => [v, k]));
const STORY_HEAD = /^(?:##|###)\s+Story:\s*(.+?)\s*$/;
const META_LINE = /^<!--\s*story_id:\s*([^;]+);\s*parent:\s*([^;]+);\s*order:\s*(\d+)\s*-->\s*$/;
const SLOT_LINE = /^-\s*(阶段|模块|问题\/判断|流程|技术\/方法|结果)\s*[：:]\s*(.*)$/;
const QUOTE_LINE = /^-\s*原话\s*[：:]\s*(.*)$/;
const SUMMARY_LINE = /^-\s*摘要\s*[：:]\s*(.*)$/;
const OWNERSHIP_LINE = /^-\s*归属\s*[：:]\s*(.*)$/;
const SCOPE_LINE = /^-\s*范围\s*[：:]\s*(.*)$/;

export function parseMarkdown(text, fallback = {}) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  assert(lines[0]?.trim() === '---', 'INVALID_MARKDOWN', '缺少 front matter 起始 ---');
  let i = 1;
  const front = {};
  for (; i < lines.length; i++) {
    if (lines[i].trim() === '---') { i++; break; }
    const at = lines[i].indexOf(':');
    assert(at > 0, 'INVALID_MARKDOWN', `front matter 行无法解析: ${lines[i]}`);
    front[lines[i].slice(0, at).trim()] = lines[i].slice(at + 1).trim();
  }
  for (const k of ['experience_id', 'type', 'name']) assert(front[k], 'INVALID_MARKDOWN', `front matter 缺 ${k}`);

  const experience = {
    experience_id: front.experience_id,
    type: front.type,
    name: front.name,
    role: front.role || '',
    time: front.time || '',
    background: '',
    ...fallback,
  };
  const stories = [];
  const fragments = [];
  let section = null; // 'background' | 'story' | 'fragments' | 'other'
  let current = null;
  let fragmentLines = [];

  const flushFragment = () => {
    const body = fragmentLines.join('\n').trim();
    if (body) fragments.push({ body });
    fragmentLines = [];
  };
  const flushStory = () => {
    if (!current) return;
    const body = current.bodyLines.join('\n').trim();
    if (body) current.body = body;
    delete current.bodyLines;
    stories.push(current);
    current = null;
  };

  for (; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trimEnd();
    if (/^##\s+背景\s*$/.test(line)) {
      flushStory(); if (section === 'fragments') flushFragment();
      section = 'background';
      continue;
    }
    if (/^##\s+素材片段\s*$/.test(line)) {
      flushStory(); if (section === 'fragments') flushFragment();
      section = 'fragments';
      continue;
    }
    const sh = line.match(STORY_HEAD);
    if (sh) {
      flushStory(); if (section === 'fragments') flushFragment();
      section = 'story';
      current = {
        story_id: '', parent_story_id: null, order: stories.length + 1,
        title: sh[1], summary: '', ownership: '', scope: '', slots: Object.fromEntries(SLOT_KEYS.map((k) => [k, ''])),
        raw_quotes: [], body: '', bodyLines: [],
      };
      // 下一行必须是 meta
      const next = (lines[i + 1] ?? '').trim();
      const mm = next.match(META_LINE);
      assert(mm, 'INVALID_MARKDOWN', `${sh[1]}: Story 下一行必须是 <!-- story_id: ...; parent: ...; order: ... -->`);
      current.story_id = mm[1].trim();
      current.parent_story_id = mm[2].trim() === 'null' ? null : mm[2].trim();
      current.order = Number(mm[3]);
      i++;
      continue;
    }
    if (section === 'story' && current) {
      const sm = line.match(SLOT_LINE);
      if (sm) { current.slots[SLOT_FROM_LABEL[sm[1]]] = sm[2].trim(); continue; }
      const smy = line.match(SUMMARY_LINE);
      if (smy) { current.summary = smy[1].trim(); continue; }
      const own = line.match(OWNERSHIP_LINE);
      if (own) { current.ownership = own[1].trim(); continue; }
      const scp = line.match(SCOPE_LINE);
      if (scp) { current.scope = scp[1].trim(); continue; }
      const qm = line.match(QUOTE_LINE);
      if (qm) {
        current.raw_quotes = qm[1].split('|').map((x) => x.trim()).filter(Boolean);
        continue;
      }
      if (line.trim()) current.bodyLines.push(rawLine);
      continue;
    }
    if (section === 'background') { experience.background += (experience.background ? '\n' : '') + rawLine; continue; }
    if (section === 'fragments') { fragmentLines.push(rawLine); continue; }
  }
  flushStory(); if (section === 'fragments') flushFragment();
  experience.background = experience.background.trim();

  const model = { experience, stories, fragments };
  validateMarkdownModel(model);
  return model;
}

export function serializeMarkdown(model) {
  validateMarkdownModel(model);
  const e = model.experience;
  const out = [];
  out.push('---');
  out.push(`experience_id: ${e.experience_id}`);
  out.push(`type: ${e.type}`);
  out.push(`name: ${e.name}`);
  if (e.role) out.push(`role: ${e.role}`);
  if (e.time) out.push(`time: ${e.time}`);
  out.push('---', '');
  if (e.background) out.push('## 背景', e.background, '');
  const stories = [...(model.stories ?? [])];
  const roots = stories.filter((s) => !s.parent_story_id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const renderStory = (s, level) => {
    out.push(`${'#'.repeat(level)} Story: ${s.title}`);
    out.push(`<!-- story_id: ${s.story_id}; parent: ${s.parent_story_id ?? 'null'}; order: ${s.order ?? 1} -->`);
    if (s.summary) out.push(`- 摘要：${s.summary}`);
    if (s.ownership) out.push(`- 归属：${s.ownership}`);
    if (s.scope) out.push(`- 范围：${s.scope}`);
    for (const key of SLOT_KEYS) {
      const v = String(s.slots?.[key] ?? '').trim();
      if (v) out.push(`- ${SLOT_LABEL[key]}：${v}`);
    }
    if (s.raw_quotes?.length) out.push(`- 原话：${s.raw_quotes.join(' | ')}`);
    if (String(s.body ?? '').trim()) out.push('', String(s.body).trim());
    out.push('');
    const children = stories.filter((x) => x.parent_story_id === s.story_id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const c of children) renderStory(c, level + 1);
  };
  for (const s of roots) renderStory(s, 2);
  if (model.fragments?.length) {
    out.push('## 素材片段');
    for (const f of model.fragments) out.push(String(f.body ?? '').trim(), '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export function getLeaves(model) {
  const stories = model.stories ?? [];
  const parents = new Set(stories.map((s) => s.parent_story_id).filter(Boolean));
  return stories.filter((s) => !parents.has(s.story_id));
}

export function storyBrief(s) {
  return {
    story_id: s.story_id,
    title: s.title,
    parent_story_id: s.parent_story_id,
    order: s.order,
    summary: s.summary || '',
    ownership: s.ownership || '',
    scope: s.scope || '',
    slots: s.slots,
    raw_quotes: s.raw_quotes,
    flags: s.flags || [],
  };
}
