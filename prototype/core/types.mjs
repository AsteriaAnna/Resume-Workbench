import crypto from 'node:crypto';

export const EXPERIENCE_TYPES = Object.freeze({
  campus: '学校校园经历',
  project: '项目经历',
  internship: '实习经历',
});

export const SLOT_KEYS = Object.freeze([
  'stage', 'module', 'problem', 'workflow', 'tech_link', 'outcome',
]);

export const QUESTION_SCOPES = Object.freeze(['experience', 'resume']);
export const QUESTION_BASES = Object.freeze([
  'story_incomplete', 'contradiction', 'vague_action',
  'coverage_missing', 'adjacent_unselected', 'unrealized_potential',
]);
export const QUESTION_STATUSES = Object.freeze(['candidate', 'asked', 'answered', 'dismissed', 'expired']);
export const MAX_MARKDOWN_DEPTH = 2;

export class AppError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export function assert(condition, code, message, details = {}) {
  if (!condition) throw new AppError(code, message, details);
}

export const now = () => new Date().toISOString();
export const id = (prefix, bytes = 6) => `${prefix}_${crypto.randomBytes(bytes).toString('hex')}`;
export const charLen = (value) => [...String(value ?? '')].length;
export const norm = (value) => String(value ?? '').replace(/\s+/g, '').replace(/[“”"'']/g, '');
export const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 20);

export function quoteMatch(raw, quote) {
  const R = norm(raw);
  const Q = norm(quote);
  if (!Q) return { pass: false, ratio: 0, matched: [] };
  if (R.includes(Q)) return { pass: true, ratio: Q.length / Math.max(1, R.length), matched: [quote] };
  const parts = String(quote).split(/[。！？；;.!?\n]/).map((x) => x.trim()).filter((x) => charLen(x) >= 4);
  const matched = parts.filter((p) => R.includes(norm(p)));
  return { pass: matched.length > 0, ratio: matched.join('').length / Math.max(1, R.length), matched };
}

export function assertType(type) {
  assert(Object.hasOwn(EXPERIENCE_TYPES, type), 'INVALID_TYPE', `type 必须是 ${Object.keys(EXPERIENCE_TYPES).join(' / ')}`);
}

export function validateExperienceInput(input = {}) {
  assertType(input.type);
  assert(String(input.name ?? '').trim().length > 0, 'INVALID_FIELD', 'name 必填');
  assert(charLen(input.name) <= 80, 'INVALID_FIELD', 'name 过长（≤80 字）');
  assert(input.role === undefined || charLen(input.role) <= 40, 'INVALID_FIELD', 'role 过长（≤40 字）');
  assert(input.time === undefined || charLen(input.time) <= 60, 'INVALID_FIELD', 'time 过长（≤60 字）');
}

export function normalizeExperience(input = {}) {
  return {
    type: input.type,
    name: String(input.name ?? '').trim(),
    role: String(input.role ?? '').trim(),
    time: String(input.time ?? '').trim(),
  };
}

export function validateStory(story, { parentIds = new Set(), allowContainer = true } = {}) {
  assert(story && typeof story === 'object', 'INVALID_STORY', 'story 必须是对象');
  assert(String(story.story_id ?? '').startsWith('story_'), 'INVALID_STORY', 'story_id 必须为 story_ 前缀');
  assert(String(story.title ?? '').trim().length > 0, 'INVALID_STORY', `${story.story_id}: title 必填`);
  assert(charLen(story.title) <= 30, 'INVALID_STORY', `${story.story_id}: title 过长（≤30 字）`);
  assert(Array.isArray(story.raw_quotes) && story.raw_quotes.length > 0, 'INVALID_STORY', `${story.story_id}: 至少 1 条 raw_quotes`);
  for (const q of story.raw_quotes) assert(charLen(q) >= 4, 'INVALID_STORY', `${story.story_id}: raw_quote 过短`);
  assert(story.slots && typeof story.slots === 'object', 'INVALID_STORY', `${story.story_id}: slots 必填`);
  for (const key of SLOT_KEYS) {
    if (story.slots[key] !== undefined) assert(typeof story.slots[key] === 'string', 'INVALID_STORY', `${story.story_id}.${key} 必须是字符串`);
  }
  assert(story.parent_story_id === null || typeof story.parent_story_id === 'string', 'INVALID_STORY', `${story.story_id}: parent_story_id 必须是 null 或 story_ id`);
  if (story.parent_story_id) {
    assert(story.parent_story_id !== story.story_id, 'INVALID_STORY', `${story.story_id}: 不能以自己为父`);
    if (allowContainer) assert(parentIds.has(story.parent_story_id), 'BROKEN_PARENT', `${story.story_id}: 父 Story 不存在`);
  }
}

export function validateMarkdownModel(model) {
  assert(model && model.experience, 'INVALID_MARKDOWN', '缺少 experience');
  assertType(model.experience.type);
  assert(String(model.experience.name ?? '').trim(), 'INVALID_MARKDOWN', 'experience.name 必填');
  const stories = model.stories ?? [];
  const ids = new Set();
  for (const s of stories) {
    assert(!ids.has(s.story_id), 'DUPLICATE_STORY', `重复 story_id: ${s.story_id}`);
    ids.add(s.story_id);
  }
  for (const s of stories) validateStory(s, { parentIds: ids });
  // 深度最多 2 层：父不能有父
  for (const s of stories) {
    if (!s.parent_story_id) continue;
    const parent = stories.find((x) => x.story_id === s.parent_story_id);
    assert(parent && !parent.parent_story_id, 'INVALID_MARKDOWN', `${s.story_id}: 父 Story 不能是子 Story（最大深度 2）`);
  }
  // 同一父下 order 唯一
  for (const parentId of new Set(stories.map((s) => s.parent_story_id))) {
    const orders = stories.filter((s) => s.parent_story_id === parentId).map((s) => s.order);
    assert(new Set(orders).size === orders.length, 'INVALID_MARKDOWN', `同一父下 order 不能重复: ${parentId || 'root'}`);
  }
  for (const f of model.fragments ?? []) assert(String(f.body ?? '').trim(), 'INVALID_MARKDOWN', 'fragment.body 不能为空');
  return true;
}

export function leavesOf(stories) {
  const parents = new Set(stories.map((s) => s.parent_story_id).filter(Boolean));
  return stories.filter((s) => !parents.has(s.story_id));
}

export function validateBullet(bullet, { now = false } = {}) {
  const errors = [];
  const h = charLen(bullet.hook), c = charLen(bullet.content);
  if (h < 4 || h > 12) errors.push(`hook ${h} 字（应 4-12）`);
  if (c < 35 || c > 80) errors.push(`content ${c} 字（应 35-80）`);
  if (!String(bullet.story_id ?? '').startsWith('story_')) errors.push('缺 story_id');
  if (!String(bullet.evidence_quote ?? '').trim()) errors.push('缺 evidence_quote');
  if (!String(bullet.jd_quote ?? '').trim()) errors.push('缺 jd_quote');
  if (String(bullet.content ?? '').trim().startsWith(String(bullet.hook ?? ''))) errors.push('content 重复 hook');
  if (/(体现了?|展现了?|验证了?|确保了?|保障了?).{0,20}(能力|效果|质量|准确|顺畅)$/.test(String(bullet.content ?? '').trim())) errors.push('评价性收尾');
  return errors;
}

export function validateContent(content, config = {}) {
  const errors = [];
  const exps = content?.experiences ?? [];
  if (exps.length < 3 || exps.length > (config.maxExperiences ?? 4)) errors.push(`经历数 ${exps.length}（应 3-${config.maxExperiences ?? 4}）`);
  for (const exp of exps) {
    const bg = charLen(exp.project_background ?? '');
    if (bg < 40 || bg > 60) errors.push(`${exp.experience_id}: 背景 ${bg} 字（应 40-60）`);
    if (!Array.isArray(exp.bullets) || !exp.bullets.length) errors.push(`${exp.experience_id}: 没有 bullet`);
    if ((exp.bullets || []).length > (config.maxBulletsPerExperience ?? 4)) errors.push(`${exp.experience_id}: bullet ${exp.bullets.length} 条（应 ≤4）`);
    for (const b of exp.bullets ?? []) {
      for (const e of validateBullet(b)) errors.push(`${b.bullet_id || '?'}: ${e}`);
    }
  }
  return errors;
}
