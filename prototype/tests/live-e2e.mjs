// 真实模型冒烟测试：LIVE=1 时才运行（会消耗 API 额度）
import assert from 'node:assert/strict';

if (process.env.LIVE !== '1') {
  console.log('SKIP：设置 LIVE=1 且配置 WORKBENCH_DATA_DIR / DeepSeek 密钥后运行');
  process.exit(0);
}
const data = process.env.WORKBENCH_DATA_DIR;
if (!data) { console.error('需要 WORKBENCH_DATA_DIR'); process.exit(2); }

const { scan, compose, comments, loadCards } = await import('../v2.mjs');
const jd = '# 市场部实习生（内容与数据方向）\n\n- 负责公众号/新媒体内容选题、撰写与排版，提升阅读表现\n- 整理竞品动态与投放数据，输出周报\n- 参与线下活动报名、名单核对与现场执行\n- 熟练使用飞书/Excel 完成数据整理\n- 有内容运营或校园活动经验，能独立推进流程优化';

const db = await loadCards();
assert.ok(db.cards.length > 0, '知识库为空，请先建卡');
console.log(`数据：${db.experiences.length} 经历 / ${db.cards.length} 卡`);

const run = await scan(jd);
console.log('扫描：', run.scan.jd_analysis.hook_level, run.scan.jd_analysis.body_pattern, `选卡 ${run.scan.experience_rankings.reduce((n, r) => n + (r.selected_cards?.length || 0), 0)}`);
const selections = run.scan.experience_rankings.map((r) => ({
  exp_id: r.exp_id, card_ids: (r.selected_cards || []).map((c) => c.card_id),
  strategy: { jd_focus: run.scan.jd_analysis.jd_focus, hook_level: run.scan.jd_analysis.hook_level, body_pattern: run.scan.jd_analysis.body_pattern },
})).filter((s) => s.card_ids.length);
const composed = await compose(run.run_id, selections);
let bullets = 0;
for (const exp of composed.content.experiences) {
  assert.ok(exp.project_background.length >= 40 && exp.project_background.length <= 60, '背景字数不合规');
  for (const b of exp.bullets) {
    bullets += 1;
    assert.ok(b.raw_quote, `缺 raw_quote: ${b.bullet_id}`);
    assert.ok([...b.hook].length >= 4 && [...b.hook].length <= 12, `hook 长度异常: ${b.hook}`);
    assert.ok([...b.content].length >= 35 && [...b.content].length <= 80, `content 长度异常: ${b.bullet_id}`);
    assert.ok(!/(体现了?|展现了?|验证了?|确保了?|保障了?).{0,18}(能力|效果|质量|准确|顺畅)\s*$/.test(b.content), `评价性收尾: ${b.bullet_id}`);
  }
}
const withComments = await comments(run.run_id);
assert.ok(withComments.comments.length <= 4);
console.log(`真实模型通过：run=${run.run_id}，${composed.content.experiences.length} 段 / ${bullets} bullets，评论 ${withComments.comments.length} 条`);
