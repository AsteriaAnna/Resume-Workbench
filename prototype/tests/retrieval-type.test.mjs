import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const folder=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-retrieval-'));
process.env.WORKBENCH_DATA_DIR=folder;
const {createWikiExperience,generate,setExperienceType,state}=await import('../workbench.mjs');
const mock=async(task,input)=>{
  if(task==='wiki_update'){
    if(input.message.includes('校园'))return {title:'校园活动',experience_type:'campus',summary:'活动执行',markdown:'我负责校园活动的报名和签到。',stories:[{title:'报名签到流程',summary:'用表格记录报名名单',markdown:'我用表格记录报名和签到。'}],fragments:[],topics:[],quotes:['校园活动']};
    return {title:'公司实习',experience_type:'internship',summary:'档案整理',markdown:'我在公司整理员工档案。',stories:[],fragments:[],topics:[],quotes:['公司整理']};
  }
  if(task==='strategy')return {main_strategy:'工作流程型',secondary_strategy:'问题解决型',target_keyword_depth:'L3',body_focus:'活动执行'};
  if(task==='query_plan')return {requirements:[{id:'req_1',jd_quote:'报名流程',category:'执行',terms:['报名'],evidence_needs:['记录名单'],constraints:[]}]};
  if(task==='evaluate')return {assessments:input.evidence.map(m=>({requirement_id:'req_1',node_id:m.node.id,relevance:m.markdown.includes('报名')?'direct':'none',contribution:'executed',evidence:'supported',decision:m.markdown.includes('报名')?'use':'omit',quote:m.markdown.includes('报名')?'报名':''}))};
  if(task==='selection')return {items:input.evidence.filter(m=>m.node.title==='校园活动').map(m=>({node_id:m.node.id,section:'实习经历',use:'重点展开',focus:'报名签到',priority:1,story_ids:m.children.filter(c=>c.kind==='story').map(c=>c.id),reason:'符合岗位'}))};
  if(task==='outline')return {positioning:'校园活动执行',sections:[{name:'实习/项目经历',items:input.selection.items.map(x=>({node_id:x.node_id,title:'校园活动',approach:'流程',focus:'报名签到',story_ids:x.story_ids,order:1}))}]};
  throw Error(`Unexpected task ${task}`);
};
try{
  const ruleEvents=[];
  mock.record=(task,input,output)=>ruleEvents.push({task,input,output});
  const campus=await createWikiExperience({message:'我在校园活动负责报名签到。'},mock);
  await createWikiExperience({message:'我在公司整理员工档案。'},mock);
  const before=await state();
  assert.equal(before.nodes.find(n=>n.id===campus.experience_id).experience_type,'campus');
  const story=before.nodes.find(n=>n.kind==='story');
  const run=await generate({jd:'负责报名流程',mode:'index_fallback'},mock);
  assert.deepEqual(run.discovery[0].index_candidates,[campus.experience_id]);
  assert.ok(run.discovery[0].fulltext_fallback_candidates.every(id=>id.startsWith('exp_')));
  assert.ok(run.evaluation.assessments.every(x=>x.node_id.startsWith('exp_')));
  assert.equal(run.selection.items[0].section,'项目经历');
  assert.deepEqual(run.selection.items[0].story_ids,[story.id]);
  assert.ok(run.selection.items[0].evidence_ids.includes(story.id));
  assert.ok(ruleEvents.some(x=>x.task==='wiki_commit'));
  assert.ok(ruleEvents.some(x=>x.task==='experience_search'&&x.output.index_candidates.includes(campus.experience_id)));
  assert.ok(ruleEvents.some(x=>x.task==='selection_guard'));
  assert.ok(ruleEvents.some(x=>x.task==='outline_guard'));
  assert.equal(run.outline.sections[0].name,'项目经历');
  const changed=await setExperienceType({experience_id:campus.experience_id,experience_type:'project'});
  assert.equal(changed.experience_type,'project');
  assert.equal((await state()).nodes.find(n=>n.id===campus.experience_id).experience_type,'project');
  console.log('Experience retrieval and type test passed');
}finally{await fs.rm(folder,{recursive:true,force:true})}

