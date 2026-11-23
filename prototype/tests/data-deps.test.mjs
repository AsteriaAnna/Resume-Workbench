import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA = process.env.WORKBENCH_DATA_DIR || path.resolve(import.meta.dirname, '..', '..', '..', '沙盒数据-真实语料-v3');
const exists = async (p) => { try { await fs.access(p); return true; } catch { return false; } };

test('数据目录结构完整（raw → snapshots → v2 cards → runs）', async (t) => {
  if (!(await exists(DATA))) return t.skip(`缺少数据目录：${DATA}（设置 WORKBENCH_DATA_DIR）`);
  const required = ['current.json', 'profile.json'];
  for (const f of required) assert.ok(await exists(path.join(DATA, f)), `缺少 ${f}`);

  const current = JSON.parse(await fs.readFile(path.join(DATA, 'current.json'), 'utf8'));
  const rev = current.revision ?? current.current ?? current;
  assert.ok(rev, 'current.json 缺少 revision');
  const snapDir = path.join(DATA, 'snapshots', String(rev));
  assert.ok(await exists(path.join(snapDir, 'index.json')), `缺少 snapshots/${rev}/index.json`);
  const index = JSON.parse(await fs.readFile(path.join(snapDir, 'index.json'), 'utf8'));
  assert.ok(Array.isArray(index.nodes) && index.nodes.length > 0, 'index.nodes 为空');
  assert.ok(await exists(path.join(snapDir, 'wiki')), '缺少 wiki 文档目录');

  const rawDir = path.join(DATA, 'raw');
  const rawFiles = (await fs.readdir(rawDir)).filter((f) => f.endsWith('.json'));
  assert.ok(rawFiles.length > 0, 'raw 为空，无法重建卡片');
  for (const f of rawFiles.slice(0, 5)) {
    const raw = JSON.parse(await fs.readFile(path.join(rawDir, f), 'utf8'));
    assert.ok(raw.experience_id, `${f} 缺少 experience_id`);
    assert.ok(Array.isArray(raw.messages) && raw.messages.length > 0, `${f} 缺少 messages`);
  }
});

test('卡片引用与质量分级合法', async (t) => {
  const cardsFile = path.join(DATA, 'v2', 'cards.json');
  if (!(await exists(cardsFile))) return t.skip(`缺少 ${cardsFile}`);
  const db = JSON.parse(await fs.readFile(cardsFile, 'utf8'));
  assert.ok(Array.isArray(db.experiences) && db.experiences.length > 0);
  assert.ok(Array.isArray(db.cards) && db.cards.length > 0);
  const expIds = new Set(db.experiences.map((e) => e.exp_id));
  const seen = new Set();
  for (const c of db.cards) {
    assert.ok(expIds.has(c.exp_id), `卡片 ${c.card_id} 的 exp_id 不存在`);
    assert.ok(!seen.has(c.card_id), `卡片 ID 重复：${c.card_id}`);
    seen.add(c.card_id);
    assert.ok(['S', 'A', 'B'].includes(c.quality_grade), `卡片 ${c.card_id} 分级非法`);
    assert.ok(String(c.raw_quote || '').length > 0, `卡片 ${c.card_id} 缺少 raw_quote`);
    assert.ok(c.is_verified, `卡片 ${c.card_id} 未 verify`);
    for (const slot of ['slot_problem', 'slot_workflow', 'slot_outcome']) assert.ok(slot in c, `${c.card_id} 缺 ${slot}`);
  }
  for (const e of db.experiences) assert.ok(db.cards.some((c) => c.exp_id === e.exp_id), `经历 ${e.exp_id} 没有卡片`);
});

test('运行记录可追溯：只严格校验当前卡片版本产生的 run', async (t) => {
  const runsDir = path.join(DATA, 'v2', 'runs');
  if (!(await exists(runsDir))) return t.skip(`缺少 ${runsDir}`);
  const files = (await fs.readdir(runsDir)).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0, '没有运行记录，先跑 cli pipeline');
  const db = JSON.parse(await fs.readFile(path.join(DATA, 'v2', 'cards.json'), 'utf8'));
  const cardIds = new Set(db.cards.map((c) => c.card_id));
  const importedAt = db.imported_at ? Date.parse(db.imported_at) : (await fs.stat(path.join(DATA, 'v2', 'cards.json'))).mtimeMs;
  let checked = 0, stale = 0;
  for (const f of files.slice(-30)) {
    const run = JSON.parse(await fs.readFile(path.join(runsDir, f), 'utf8'));
    if (!run.scan) continue;
    // 数据契约：重建 cards.json 后，旧 run 引用的测试补卡会失效 → 视为 stale 跳过
    if (importedAt && run.created_at && Date.parse(run.created_at) < importedAt) { stale += 1; continue; }
    checked += 1;
    for (const r of run.scan.experience_rankings || []) {
      assert.ok(db.experiences.some((e) => e.exp_id === r.exp_id), `${f}: 引用了不存在的经历 ${r.exp_id}`);
      for (const c of r.selected_cards || []) assert.ok(cardIds.has(c.card_id), `${f}: 扫描引用未知卡片 ${c.card_id}`);
    }
    for (const exp of run.content?.experiences || []) {
      for (const b of exp.bullets || []) assert.ok(cardIds.has(b.card_id), `${f}: bullet 引用未知卡片 ${b.card_id}`);
    }
    const bulletIds = new Set((run.content?.experiences || []).flatMap((e) => (e.bullets || []).map((b) => b.bullet_id)));
    for (const c of run.comments || []) assert.ok(bulletIds.has(c.bullet_id), `${f}: 评论锚点不存在 ${c.bullet_id}`);
  }
  console.log(`运行记录：严格校验 ${checked} 条，跳过历史 stale ${stale} 条（cards 重建前的 run）`);
  assert.ok(checked > 0 || stale > 0, '没有可校验的运行记录');
});
