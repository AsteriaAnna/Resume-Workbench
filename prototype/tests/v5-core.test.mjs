import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { createStore } from '../core/store.mjs';
import { createLLM } from '../core/llm.mjs';
import { createMock } from '../core/mock.mjs';
import * as pipeline from '../core/pipeline.mjs';
import { parseMarkdown, serializeMarkdown } from '../core/markdown.mjs';
import { extractDraft } from '../core/extract.mjs';
import { validateMarkdownModel } from '../core/types.mjs';
import { planResumeQuestions, detectResumeCandidates } from '../core/questions.mjs';

async function tempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'v5-core-'));
  return { dir, store: await createStore(dir).init() };
}

const raw1 = '我负责校园公众号的内容制作，从选题、写稿到排版。通过改选题和重做配图，单篇阅读量从3000提升到1.2万。活动报名用飞书表格，设计了报名和打卡流程，完成率达到60%。';
const raw2 = '我参与一个AI产品的需求梳理，把模糊需求拆成结构化文档和验收标准。和研发、设计协作推进上线，并用表格跟踪效果。';
const raw3 = '我在HR部门实习，负责员工资料收取和核对。用Excel登记约2000份利益冲突书，按部门存档，发现数量不符时会提出异议并复核。';

test('Markdown 序列化/解析 + 父子层级校验', () => {
  const model = {
    experience: { experience_id: 'exp_test', type: 'project', name: '测试项目', role: '', time: '', background: '背景' },
    stories: [
      { story_id: 'story_p', parent_story_id: null, order: 1, title: '父事件', summary: '父总述', ownership: '主导', scope: '全校', slots: { stage: '阶段', module: '模块', problem: '问题', workflow: '流程', tech_link: '未提及', outcome: '结果' }, raw_quotes: ['父事件原话'] },
      { story_id: 'story_c', parent_story_id: 'story_p', order: 1, title: '子事件', summary: '', slots: { stage: '阶段', module: '模块', problem: '问题', workflow: '流程', tech_link: '未提及', outcome: '结果' }, raw_quotes: ['子事件原话'] },
    ],
    fragments: [{ body: '片段' }],
  };
  const text = serializeMarkdown(model);
  const parsed = parseMarkdown(text);
  assert.equal(parsed.stories.length, 2);
  assert.equal(parsed.stories.find((s) => s.story_id === 'story_c').parent_story_id, 'story_p');
  assert.equal(parsed.stories.find((s) => s.story_id === 'story_p').summary, '父总述');
  assert.equal(parsed.stories.find((s) => s.story_id === 'story_p').ownership, '主导');
  assert.equal(parsed.stories.find((s) => s.story_id === 'story_p').scope, '全校');
  assert.ok(text.includes('### Story: 子事件'));
  assert.equal(parsed.fragments.length, 1);

  const invalid = JSON.parse(JSON.stringify(model));
  invalid.stories.push({ ...invalid.stories[1], story_id: 'story_g', parent_story_id: 'story_c', title: '孙事件' });
  assert.throws(() => validateMarkdownModel(invalid), /最大深度|父 Story 不能/);
});

test('mock 端到端：新建 3 段经历→Draft→确认→Markdown→生成→问题', async () => {
  const { store } = await tempStore();
  const llm = await createLLM({ mock: true, mockCall: createMock() });
  const raws = [raw1, raw2, raw3];
  const types = ['campus', 'project', 'internship'];
  const exps = [];
  for (let i = 0; i < 3; i++) {
    const exp = await pipeline.createExperience({ store, input: { type: types[i], name: `经历${i + 1}`, role: i === 0 ? '负责人' : '', time: '' } });
    await pipeline.addExperienceInput({ store, llm, experienceId: exp.experience_id, text: raws[i] });
    const confirmed = await pipeline.confirmExperienceStories({ store, llm, experienceId: exp.experience_id, decisions: null });
    assert.ok(confirmed.model.stories.length >= 1);
    assert.ok(confirmed.markdown.includes('## Story:'));
    assert.equal(confirmed.questions.all.length, 4);
    assert.equal(confirmed.questions.ui.length, 3);
    exps.push(exp);
  }

  const run = await pipeline.generate({ store, llm, jd: '负责内容运营与数据整理，能独立推进流程优化。', config: { maxExperiences: 4 } });
  assert.equal(run.content.experiences.length, 3);
  assert.ok(run.content.experiences.every((e) => e.bullets.length >= 1));
  assert.equal(run.validation.errors.length, 0);
  assert.ok(Array.isArray(run.questions.all));
  assert.ok(run.questions.ui.length <= 3);

  const firstQ = (await pipeline.questions({ store, scope: 'experience', target: exps[0].experience_id })).all[0];
  const answered = await pipeline.answer({ store, llm, questionId: firstQ.question_id, text: '补充：转化率按注册人数/进群人数计算，统计周期为活动结束后7天。' });
  assert.equal(answered.question.status, 'answered');
  assert.ok(answered.draft.stories.length >= 1);
  assert.ok((await store.listRaw(firstQ.target.experience_id)).length >= 2);
});

test('未分配 raw 信息是硬错误，不进入 Draft', async () => {
  const { store } = await tempStore();
  const llm = await createLLM({
    mock: true,
    mockCall: createMock({
      'P1-extract': () => ({
        stories: [{ temp_id: 's1', parent_temp_id: null, order: 1, title: '事件', summary: '', slots: { stage: '阶段', module: '模块', problem: '未提及', workflow: '动作', tech_link: '未提及', outcome: '结果' }, raw_quotes: ['原话内容足够长'], boundary_reason: '切分' }],
        fragments: [], unassigned_details: [{ text: '漏掉的细节', reason: '未归入' }], questions: [],
      }),
    }),
  });
  const exp = await pipeline.createExperience({ store, input: { type: 'project', name: '测试' } });
  const raw = await store.appendRaw(exp.experience_id, '这是一段足够长的原始输入内容，用于测试未分配信息。');
  await assert.rejects(() => extractDraft({ store, llm, experience: exp, raw }), (e) => e.code === 'UNASSIGNED_INPUT');
  assert.equal(await store.readDraft(exp.experience_id), null);
});

test('问题全部存储、UI 只返回 3 条，dismiss/answered 状态可持久化', async () => {
  const { store } = await tempStore();
  const llm = await createLLM({ mock: true, mockCall: createMock() });
  const exp = await pipeline.createExperience({ store, input: { type: 'campus', name: '测试经历' } });
  await pipeline.addExperienceInput({ store, llm, experienceId: exp.experience_id, text: raw1 });
  const c = await pipeline.confirmExperienceStories({ store, llm, experienceId: exp.experience_id, decisions: null });
  assert.equal(c.questions.all.length, 4);
  assert.equal(c.questions.ui.length, 3);
  const loaded = await pipeline.questions({ store, scope: 'experience', target: exp.experience_id });
  assert.equal(loaded.all.length, 4);
  assert.equal(loaded.ui.length, 3);
  const dismissed = await pipeline.dismiss({ store, questionId: loaded.all[0].question_id });
  assert.equal(dismissed.status, 'dismissed');
  const again = await pipeline.questions({ store, scope: 'experience', target: exp.experience_id });
  assert.equal(again.all.find((q) => q.question_id === dismissed.question_id).status, 'dismissed');
});

test('简历问题：P10 从候选回填 target/basis，全部存储、UI 3 槽过滤 dismissed', async () => {
  const { store } = await tempStore();
  const llm = await createLLM({ mock: true, mockCall: createMock() });
  const exp = await pipeline.createExperience({ store, input: { type: 'campus', name: '候选经历' } });
  await pipeline.addExperienceInput({ store, llm, experienceId: exp.experience_id, text: raw1 });
  const c = await pipeline.confirmExperienceStories({ store, llm, experienceId: exp.experience_id, decisions: null });
  const story = c.model.stories[0];
  const library = await store.loadLibrary();
  const candidate = {
    scope: 'resume', basis_type: 'coverage_missing',
    target: { experience_id: exp.experience_id, story_id: story.story_id },
    jd_quote: '负责内容运营与数据整理', basis_quote: story.raw_quotes[0], missing: ['workflow'],
  };
  const qs = await planResumeQuestions({ store, llm, runId: 'run_test', jd: '负责内容运营与数据整理。', resume: { experiences: [] }, library, coverage: { requirements: [] }, candidates: [candidate] });
  assert.ok(qs.all.length >= 1);
  assert.equal(qs.all[0].target.experience_id, exp.experience_id);
  assert.equal(qs.all[0].basis_quote, story.raw_quotes[0]);
  const dismissed = await pipeline.dismiss({ store, questionId: qs.all[0].question_id });
  assert.equal(dismissed.status, 'dismissed');
  const again = await pipeline.questions({ store, scope: 'resume', target: 'run_test' });
  assert.ok(!again.ui.some((q) => q.question_id === dismissed.question_id));
});

test('A3 不接受 support=none 的假候选，零覆盖无相关 Story 时不提问', () => {
  const library = [{
    experience_id: 'exp_x', stories: [{
      story_id: 'story_x', raw_quotes: ['一段原话'], slots: { workflow: '做了活动', outcome: '有结果' },
    }],
  }];
  const evalNone = [{ experience_id: 'exp_x', matched: [{ story_id: 'story_x', support: 'none', jd_quote: '用户访谈' }], missing: [] }];
  assert.equal(detectResumeCandidates({ jd: '用户访谈', library, coverage: { requirements: [] }, evaluations: evalNone }).length, 0);
  const evalAdj = [{ experience_id: 'exp_x', matched: [{ story_id: 'story_x', support: 'adjacent', jd_quote: '用户访谈' }], missing: [] }];
  assert.equal(detectResumeCandidates({ jd: '用户访谈', library, coverage: { requirements: [] }, evaluations: evalAdj, selectedStoryIds: new Set() }).length, 1);
});

test('人工手改 Markdown 后再输入/确认，手改内容不被覆盖', async () => {
  const { store } = await tempStore();
  const llm = await createLLM({ mock: true, mockCall: createMock() });
  const exp = await pipeline.createExperience({ store, input: { type: 'project', name: '手改保护' } });
  await pipeline.addExperienceInput({ store, llm, experienceId: exp.experience_id, text: raw2 });
  const first = await pipeline.confirmExperienceStories({ store, llm, experienceId: exp.experience_id, decisions: null });
  const oldTitle = first.model.stories[0].title;
  const md = await store.readMarkdown(exp.experience_id);
  await pipeline.editExperienceMarkdown({ store, experienceId: exp.experience_id, markdown: md.replace(oldTitle, '人工改过的标题') });
  await pipeline.addExperienceInput({ store, llm, experienceId: exp.experience_id, text: '补充：后来又和设计团队做了一轮验收，并把验收标准写进了文档。' });
  const second = await pipeline.confirmExperienceStories({ store, llm, experienceId: exp.experience_id, decisions: null });
  assert.ok(second.model.stories.some((s) => s.title === '人工改过的标题'), '手改标题应保留');
  assert.ok(second.model.stories.length >= 2, '新 Story 应追加而不是重建');
});
