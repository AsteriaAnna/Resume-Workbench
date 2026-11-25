import { charLen } from './types.mjs';

const parse = (s) => { try { return JSON.parse(s); } catch { return {}; } };
const sentences = (raw) => String(raw ?? '').split(/[。！？；;\n]/).map((x) => x.trim()).filter((x) => charLen(x) >= 4);
const first = (a, fallback = '未提及') => (a && a.length ? a[0] : fallback);
const pad = (text, min = 50, max = 68) => {
  let s = String(text ?? '').trim();
  while (charLen(s) < min) s += '，形成可复用的流程与结果';
  if (charLen(s) > max) s = [...s].slice(0, max).join('');
  return s;
};

export function createMock(overrides = {}) {
  return async ({ tag, user }) => {
    if (overrides[tag]) return overrides[tag](parse(user));
    const input = parse(user);
    if (tag === 'P11-merge') {
      const ss = sentences(input.new_raw);
      const q = ss[0] || '新增内容';
      return {
        operations: [{ op: 'append', target_paragraph_id: 'p_1', text: q, source_raw_ids: [], source_quotes: [q], reason: 'mock 增量追加' }],
        unresolved: [],
      };
    }
    if (tag === 'P1-extract') {
      const ss = sentences(input.raw_text);
      const stories = [];
      const n = Math.max(1, Math.min(2, ss.length));
      for (let i = 0; i < n; i++) {
        const sentence = ss[i] || ss[0] || '完成了一段经历';
        const outcome = ss[i + 1] || sentence;
        stories.push({
          temp_id: `s${i + 1}`, parent_temp_id: null, order: i + 1,
          title: `事件${i + 1}：${[...sentence].slice(0, 10).join('')}`,
          summary: [...sentence].slice(0, 24).join(''),
          slots: {
            stage: i === 0 ? '起步阶段' : '迭代阶段',
            module: '核心模块',
            problem: '未提及',
            workflow: sentence,
            tech_link: '未提及',
            outcome: outcome,
          },
          raw_quotes: [sentence], boundary_reason: '出现新的子目标/动作与结果', flags: [],
        });
      }
      return { stories, fragments: [], unassigned_details: [], questions: [] };
    }
    if (tag === 'P1-update') {
      const reg = input.story_registry?.stories || [];
      const active = reg.find((x) => x.status === 'active');
      if (!active) return { operations: [], unresolved: [] };
      const ps = input.narrative?.paragraphs || [];
      const changed = (input.changed_paragraph_ids || []).map((id) => ps.find((p) => p.paragraph_id === id)).filter(Boolean);
      const text = changed[changed.length - 1]?.text || ps[ps.length - 1]?.text || '';
      if (!text) return { operations: [], unresolved: [] };
      return { operations: [{ op: 'update', story_id: active.story_id, patch: { slots: { outcome: text } }, source_paragraph_ids: [changed[changed.length - 1]?.paragraph_id].filter(Boolean), reason: 'mock 增量补充' }], unresolved: [] };
    }
    if (tag === 'P1-repair') return { operations: [], unresolved: [] };
    if (tag === 'P1-review') return { operations: [], unresolved: [] };
    if (tag === 'P2-experience-questions') {
      const stories = input.markdown_model?.stories ?? [];
      const sid = stories[0]?.story_id || 'story_0';
      return {
        questions: [1, 2, 3, 4].map((i) => ({
          scope: 'experience', purpose: 'complete_story', basis_type: 'story_incomplete',
          target: { experience_id: input.experience?.experience_id || '', story_id: sid },
          basis_quote: stories[0]?.raw_quotes?.[0] || '现有原文',
          missing: [['metric', 'result'], ['ownership'], ['scope'], ['metric']][i - 1],
          question: ['这条结果有没有可核对的数据口径？', '这件事里你本人具体负责哪一步？', '覆盖范围/人数/时长是多少？', '这个数字的统计周期是什么？'][i - 1],
          expected_answer: { fields: [['metric'], ['ownership'], ['scope'], ['period']][i - 1], format: '一句话' },
          priority: i <= 2 ? 'high' : 'medium',
        })),
      };
    }
    if (tag === 'P3-jd-note') {
      return { notes: String(input.jd ?? '').split(/[。\n]/).filter(Boolean).slice(0, 5).map((line) => ({ jd_quote: line.trim(), topic: '要求', kind: '要求', importance_hint: 'medium', confidence: 'medium' })) };
    }
    if (tag === 'P4-evaluate') {
      const stories = input.stories ?? [];
      const jdQuote = String(input.jd ?? '').split(/[。\n]/).find((x) => x.trim())?.trim() || '岗位要求';
      const leaf = stories.filter((s) => !(stories || []).some((x) => x.parent_story_id === s.story_id));
      return {
        experience_id: input.experience?.experience_id || '',
        recommendation: leaf.length ? 'use' : 'drop',
        matched: leaf.slice(0, 2).map((s) => ({
          jd_quote: jdQuote, story_id: s.story_id,
          story_quote: s.raw_quotes?.[0] || s.slots?.outcome || '未提及',
          support: 'direct', ownership: 'executed', note: 'mock 证据',
        })),
        missing: [], reason: 'mock：有可用叶子 Story',
      };
    }
    if (tag === 'P5-plan') {
      const evals = (input.evaluations ?? []).filter((e) => e.recommendation === 'use' && e.matched?.length);
      const exps = evals.slice(0, Math.min(4, Math.max(3, evals.length)));
      return {
        strategy: { hook_level: 'L2', body_pattern: 'CAR', jd_focus: 'mock JD 焦点' },
        experiences: exps.map((e, i) => ({
          experience_id: e.experience_id,
          why: 'mock：有直接证据',
          bullets: e.matched.slice(0, 4).map((m, j) => ({ story_id: m.story_id, jd_quote: m.jd_quote, order: j + 1 })),
          background: { needed: true, cover: ['背景', '目标', '角色', '范围'] },
        })),
        global_order: exps.map((e) => e.experience_id),
        dropped: [],
      };
    }
    if (tag === 'P6-compose') {
      const model = input.selected_stories ?? [];
      const expId = input.experience?.experience_id || '';
      const bullets = model.slice(0, 4).map((s, i) => ({
        story_id: s.story_id,
        jd_quote: input.plan?.bullets?.[i]?.jd_quote || '岗位要求',
        hook: `核心动作${i + 1}`,
        content: pad(s.slots?.workflow || s.raw_quotes?.[0] || '完成核心动作并交付结果'),
        evidence_quote: s.raw_quotes?.[0] || s.slots?.outcome || '未提及',
      }));
      const out = {
        experience_id: expId,
        bullets,
      };
      if (input.config?.show_background !== false) out.project_background = '该项目面向真实业务场景，由本人负责从需求分析到方案落地的完整流程，覆盖设计、执行与复盘。';
      if (input.config?.show_tech_stack === true) out.tech_stack = ['飞书表格：报名与打卡流程', 'Excel：数据核对与统计'];
      return out;
    }
    if (tag === 'P7-critic') return { issues: [] };
    if (tag === 'P8-revise') return { content: input.content, applied_issue_ids: [], remaining: [] };
    if (tag === 'P10-resume-questions') {
      const c = (input.candidates ?? [])[0] || {};
      return {
        questions: [1, 2, 3, 4].map((i) => ({
          scope: 'resume', purpose: 'add_content',
          basis_type: c.basis_type || 'unrealized_potential',
          action: 'add_bullet',
          jd_quote: c.jd_quote || (String(input.jd ?? '').split(/[。\n]/)[0] || '岗位要求'),
          experience_id: c.experience_id || c.target?.experience_id || '',
          story_id: c.story_id || c.target?.story_id || '',
          basis_quote: c.basis_quote || '当前依据',
          missing: ['workflow'], question: '能否补充你具体怎么做的？', expected_answer: { fields: ['workflow'], format: '一句话' },
          priority: i <= 2 ? 'high' : 'medium', expected_effect: '补一条 bullet',
        })),
      };
    }
    throw new Error(`mock 未覆盖 tag: ${tag}`);
  };
}
