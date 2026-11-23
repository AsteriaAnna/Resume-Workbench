// 离线确定性模型替身：DEEPSEEK_MOCK=1 时启用，用于零成本跑通链路测试
// 输出必须满足 v2.mjs 的校验规则（长度/字段/引用），否则测试会失败

const pick = (text, re) => { const m = String(text).match(re); return m ? m[1] : ''; };

function bulletsFrom(user) {
  // compose 的 user 文本里包含已选卡片 JSON 数组
  const i = user.indexOf('[');
  const j = user.lastIndexOf(']');
  if (i < 0 || j < 0) return [];
  try {
    const cards = JSON.parse(user.slice(i, j + 1));
    return cards.filter((c) => c && c.card_id).map((c, k) => {
      const hook = String(c.toc_title || '流程优化').replace(/[【】\s]/g, '').slice(0, 8);
      const content = `${String(c.toc_title || '推进事项').slice(0, 20)}：拆解输入与约束，设计可执行流程并落地，覆盖关键节点与责任人，最终交付可复用的物料与数据记录，支持后续复盘。`;
      return { card_id: c.card_id, focus_angle: hook.slice(0, 12), hook, content: content.slice(0, 72) };
    });
  } catch { return []; }
}

export function mockCall({ tag, system, user }) {
  const sys = String(system || '');
  const mode = tag || (sys.includes('知识卡片补齐引擎') ? 'gapcard' : sys.includes('气泡评论') ? 'comments' : sys.includes('经历访谈') ? 'guide' : '');
  let json = {};
  if (mode === 'ingest') {
    json = {
      spine_summary: '围绕目标场景独立推进从需求到交付的完整流程，拆解约束、设计可执行方案并落地，形成可复用的工作方法。',
      story_cards: [
        { step_order: 1, toc_title: '流程拆解与方案设计', slot_stage: '启动', slot_module: '流程设计', slot_problem: '现有流程依赖口头交接，信息容易断点且责任不清', slot_workflow: '梳理输入与节点 → 拆解责任 → 输出流程表', slot_tech_link: '飞书表格', slot_outcome: '交接时间从 10 分钟降到 3 分钟，遗漏明显减少', raw_quote: '原话示例：把流程拆成阶段并记录责任人' },
        { step_order: 2, toc_title: '数据汇总与复盘', slot_stage: '执行', slot_module: '数据运营', slot_problem: '活动数据分散，无法判断效果好坏的来源', slot_workflow: '收集报名与打卡数据 → 汇总成周报 → 复盘指标', slot_tech_link: 'Excel', slot_outcome: '输出周报，参与人数与完成率可追溯', raw_quote: '原话示例：每周汇总数据输出周报' },
      ],
    };
  } else if (mode === 'scan') {
    let pack = {};
    try { pack = JSON.parse(user); } catch {}
    const rankings = (pack.experiences || []).map((e, i) => ({
      exp_id: e.exp_id,
      priority_rank: i + 1,
      decision: i < 2 ? '主推详写' : '补充略写',
      selected_cards: (e.cards || []).slice(0, 2).map((c, k) => ({ card_id: c.card_id, step_order: c.step_order || k + 1, match_reason: '该卡的动作与结果能直接印证 JD 要求的执行与数据能力' })),
      gaps: ['是否能量化结果口径'],
    }));
    json = { jd_analysis: { core_demands: ['流程优化', '数据整理', '执行落地'], jd_focus: '能独立推进流程优化并输出可追溯的数据结果', hook_level: 'L2', body_pattern: 'CAR', reason: '岗位偏业务落地，采用标准术语与痛点解法' }, experience_rankings: rankings };
  } else if (mode === 'compile') {
    json = { project_background: '面向校园与业务场景的推广项目，本人独立负责从需求拆解到落地交付，覆盖线上内容与线下执行，形成可复用的流程与数据记录。', bullets: bulletsFrom(user) };
  } else if (mode === 'comments') {
    let input = {};
    try { input = JSON.parse(user); } catch {}
    const bullets = (input.bullets || []).slice(0, 2);
    json = { comments: bullets.map((b) => ({ bullet_id: b.bullet_id, exp_id: b.exp_id, question: '这条结果是否有可核对的数据口径或来源？', reason: 'JD 关注数据可追溯', card_ids: [] })) };
  } else if (mode === 'gapcard') {
    json = { insufficient: false, card: { step_order: 9, toc_title: '数据口径补充', slot_stage: '复盘', slot_module: '数据', slot_problem: '结果缺少统计口径', slot_workflow: '记录分子分母与统计时间', slot_tech_link: 'Excel', slot_outcome: '补全口径后数据可核对', raw_quote: '用户回答：补充统计口径', linked_nodes: [] } };
  } else if (mode === 'fit' || mode === 'expand') {
    let payload = {};
    try { payload = JSON.parse(user); } catch {}
    json = { project_background: payload.project_background || '面向校园与业务场景的推广项目，本人独立负责从需求拆解到落地交付，覆盖线上内容与线下执行。', bullets: (payload.bullets || []).map((b) => ({ card_id: b.card_id, content: b.content })) };
  } else {
    json = {};
  }
  return { json, usage: { prompt_tokens: 0, completion_tokens: 0, mock: true }, tag: mode };
}
