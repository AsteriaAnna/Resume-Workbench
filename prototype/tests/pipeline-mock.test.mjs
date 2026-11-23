import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const fixture = path.join(import.meta.dirname, 'fixtures', 'cards.json');
let dir;
let api;

test.before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-core-test-'));
  await fs.mkdir(path.join(dir, 'v2', 'runs'), { recursive: true });
  await fs.copyFile(fixture, path.join(dir, 'v2', 'cards.json'));
  process.env.WORKBENCH_DATA_DIR = dir;
  process.env.DEEPSEEK_MOCK = '1';
  api = await import('../v2.mjs');
});
test.after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

const JD = '# 示例 JD\n\n- 能独立推进流程优化并输出可追溯的数据结果\n- 熟悉飞书/Excel，能完成数据整理与周报输出\n- 有校园活动执行经验';

test('scan：输出 jd_analysis 与逐经历选卡，引用全部合法', async () => {
  const run = await api.scan(JD);
  assert.equal(typeof run.run_id, 'string');
  const ja = run.scan.jd_analysis;
  assert.ok(['L1', 'L2', 'L3'].includes(ja.hook_level));
  assert.ok(['XYZ', 'CAR', 'PAR'].includes(ja.body_pattern));
  assert.ok(ja.jd_focus.length > 0);
  const rankings = run.scan.experience_rankings;
  assert.equal(rankings.length, 2);
  const db = await api.loadCards();
  const cardIds = new Set(db.cards.map((c) => c.card_id));
  for (const r of rankings) {
    assert.ok(db.experiences.some((e) => e.exp_id === r.exp_id));
    for (const c of r.selected_cards) assert.ok(cardIds.has(c.card_id), `未知卡片 ${c.card_id}`);
    assert.ok(Array.isArray(r.gaps));
  }
});

test('compose：1 卡 1 bullet、字数/Hook/溯源/风格全部过闸', async () => {
  const run = await api.scan(JD);
  const selections = run.scan.experience_rankings.map((r) => ({
    exp_id: r.exp_id,
    card_ids: r.selected_cards.map((c) => c.card_id),
    strategy: { jd_focus: run.scan.jd_analysis.jd_focus, hook_level: run.scan.jd_analysis.hook_level, body_pattern: run.scan.jd_analysis.body_pattern },
  })).filter((s) => s.card_ids.length);
  const composed = await api.compose(run.run_id, selections);
  assert.ok(composed.content.experiences.length >= 1);
  const db = await api.loadCards();
  const cardById = new Map(db.cards.map((c) => [c.card_id, c]));
  let bullets = 0;
  for (const exp of composed.content.experiences) {
    const bg = [...exp.project_background];
    assert.ok(bg.length >= 40 && bg.length <= 60, `background ${bg.length}`);
    for (const b of exp.bullets) {
      bullets += 1;
      assert.ok(cardById.has(b.card_id), `未知卡片 ${b.card_id}`);
      assert.ok(String(b.raw_quote).length > 0, '缺少溯源原话');
      assert.ok(b.focus_angle.length > 0);
      const h = [...b.hook].length, c = [...b.content].length;
      assert.ok(h >= 4 && h <= 12, `hook ${h}`);
      assert.ok(c >= 35 && c <= 80, `content ${c}`);
      assert.ok(!/^【/.test(b.content), 'content 不应以【开头');
      assert.ok(!b.content.startsWith(b.hook), 'content 不应重复 hook');
      assert.ok(!/(体现了?|展现了?|验证了?|确保了?|保障了?).{0,18}(能力|效果|质量|准确|顺畅)\s*$/.test(b.content), '不应评价性收尾');
    }
  }
  assert.equal(bullets, selections.reduce((n, s) => n + s.card_ids.length, 0));
});

test('comments：锚定到已生成 bullet，最多 4 条', async () => {
  const run = await api.scan(JD);
  const selections = run.scan.experience_rankings.map((r) => ({ exp_id: r.exp_id, card_ids: r.selected_cards.map((c) => c.card_id), strategy: run.scan.jd_analysis })).filter((s) => s.card_ids.length);
  const composed = await api.compose(run.run_id, selections);
  const withComments = await api.comments(run.run_id);
  const bulletIds = new Set(composed.content.experiences.flatMap((e) => e.bullets.map((b) => b.bullet_id)));
  assert.ok(withComments.comments.length <= 4);
  for (const c of withComments.comments) {
    assert.ok(bulletIds.has(c.bullet_id), `评论锚点不存在 ${c.bullet_id}`);
    assert.ok(String(c.question).length > 0);
  }
});

test('gap：补卡入库、评论 resolved、该经历重编译', async () => {
  const run = await api.scan(JD);
  const selections = run.scan.experience_rankings.map((r) => ({ exp_id: r.exp_id, card_ids: r.selected_cards.map((c) => c.card_id), strategy: run.scan.jd_analysis })).filter((s) => s.card_ids.length);
  await api.compose(run.run_id, selections);
  const withComments = await api.comments(run.run_id);
  const target = withComments.comments[0];
  assert.ok(target, '没有生成评论，无法测试补卡');
  const before = await api.loadCards();
  const result = await api.gapCard(run.run_id, { comment_id: target.comment_id, answer: '补充口径：注册人数除以进群人数，按活动结束后台统计。' });
  assert.ok(!result.insufficient);
  const after = await api.loadCards();
  assert.equal(after.cards.length, before.cards.length + 1);
  const resolved = (result.run?.comments || []).find((c) => c.comment_id === target.comment_id);
  assert.ok(resolved?.resolved, '评论未标记 resolved');
  const exp = result.run.content.experiences.find((e) => e.exp_id === target.exp_id);
  assert.ok(exp?.bullets?.some((b) => b.card_id === result.card.card_id), '新卡未进入该段');
});

test('graph：节点/边引用一致，含中心节点', async () => {
  const g = await api.graph();
  assert.ok(g.nodes.length > 0);
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const l of g.links) assert.ok(ids.has(l.source) && ids.has(l.target), `悬空边 ${l.source}->${l.target}`);
  const db = await api.loadCards();
  for (const c of db.cards) assert.ok(ids.has(c.card_id), `卡片未入图 ${c.card_id}`);
});
