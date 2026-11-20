import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'resume-wiki-v01-'));
process.env.WORKBENCH_DATA_DIR=dir;
const {updateWiki,createWikiExperience,conversationFor,guideQuestions,state,documentFor,editWiki,generate,reviseOutline,compose}=await import('../workbench.mjs');
let turn=0;let currentStory,currentFragment;
const mock=async(task,input)=>{
 if(task==='check_extension')return {accept:!input.message.includes('rap'),reason:'内容与所选经历无关'};
 if(task==='guide_questions')return {questions:[]};
 if(task==='wiki_update'){
   turn++;const id=input.existing.id;
   if(turn===1)return {title:'示例实习',summary:'处理文档和流程',markdown:'## 背景\n在示例公司参与文档工作。',stories:[{title:'文档制作',summary:'独立整理文档',markdown:'我独立整理文档。'}],fragments:[{title:'流程问题',summary:'发现流程问题',markdown:'发现交接缺少记录。'}],topics:[{title:'文档能力',summary:'整理文档',node_ids:[]}],quotes:['在示例公司']};
   if(turn===2)return {title:'示例实习',summary:'处理文档和流程',markdown:'## 背景\n在示例公司参与文档工作，补充了交接细节。',stories:[{id:currentStory,title:'文档制作',summary:'独立整理文档',markdown:'我独立整理文档，并核对内容。'}],fragments:[{id:currentFragment,title:'流程问题',summary:'发现流程问题',markdown:'发现交接缺少记录。'}],topics:[{title:'文档能力',summary:'整理文档',node_ids:[]}],quotes:['补充了交接细节']};
   return {title:'示例实习',summary:'处理文档和流程',markdown:'## 背景\n在示例公司参与文档工作，补充了交接细节。',stories:[{id:currentStory,title:'文档制作',summary:'独立整理文档',markdown:'我独立整理文档，并核对内容。'},{title:'交接改进',summary:'设计交接记录',markdown:'我设计交接记录，解决信息遗漏。',upgraded_from:currentFragment}],fragments:[],upgrades:[{fragment_id:currentFragment}],quotes:['设计交接记录']};
 }
 if(task==='strategy')return {main_strategy:'工作流程型',secondary_strategy:'问题解决型',target_keyword_depth:'L3',body_focus:'文档与流程'};
 if(task==='query_plan')return {requirements:[{id:'req_1',jd_quote:'文档能力',category:'文档',terms:['文档'],evidence_needs:['行动'],constraints:[]}]};
 if(task==='evaluate')return {assessments:input.evidence.map(x=>({requirement_id:'req_1',node_id:x.node.id,relevance:x.markdown.includes('文档')?'direct':'none',contribution:'executed',evidence:'supported',depth:'L3',decision:x.markdown.includes('文档')?'use':'omit',quote:x.markdown.includes('文档')?'文档':''}))};
 if(task==='selection')return {items:input.evidence.filter(x=>x.node.kind==='experience').map(x=>({node_id:x.node.id,section:'实习经历',priority:1,use:'重点展开',focus:'文档',story_ids:[],keyword_depth:'L3',reason:'有依据'}))};
 if(task==='outline')return {positioning:'文档与流程',sections:[{name:'实习经历',items:input.selection.items.map(x=>({node_id:x.node_id,title:'示例实习',approach:'问题解决',focus:'文档',story_ids:[],order:1}))}]};
 if(task==='revise_outline')return {...input.outline,positioning:'按评论修改'};
 if(task==='trace_claims')return {claims:input.lines.map(line=>({sentence:line,node_id:input.material[0].node.id,source_ids:input.material[0].node.source_ids}))};
 if(task==='compose')return {markdown:'## 实习经历\n我独立整理文档。',claims:[{sentence:'我独立整理文档。',node_id:input.material[0].node.id,source_ids:input.material[0].node.source_ids}]};
 if(task==='verify')return {ok:true,issues:[]};
 throw Error(`Unexpected task ${task}`)
};
try{
 let r=await createWikiExperience({message:'在示例公司参与文档工作。'},mock);assert.equal(r.revision,1);let s=await state();currentStory=s.nodes.find(n=>n.kind==='story').id;currentFragment=s.nodes.find(n=>n.kind==='fragment').id;assert.match(await documentFor(s.nodes.find(n=>n.kind==='story'),1),/我独立整理文档/);
 r=await updateWiki({message:'补充了交接细节。',experience_id:r.experience_id},mock);assert.equal(r.experience_id,s.nodes.find(n=>n.kind==='experience').id);s=await state();assert.equal(s.nodes.filter(n=>n.kind==='experience').length,1);assert.equal(s.nodes.filter(n=>n.kind==='story').length,1);const guidance=await guideQuestions({experience_id:r.experience_id},mock);assert.equal(guidance.questions.length,1);assert.equal(guidance.questions[0].node_id,currentFragment);
 r=await updateWiki({message:'设计交接记录。',experience_id:r.experience_id},mock);s=await state();assert.equal(s.nodes.find(n=>n.id===currentFragment).status,'superseded');assert.ok(s.nodes.find(n=>n.id===currentFragment).superseded_by);
 await assert.rejects(updateWiki({message:'关于 rap 的泛泛观点',experience_id:r.experience_id},mock),e=>e.code==='UNRELATED_INPUT');assert.equal((await state()).revision,3);assert.equal((await conversationFor(r.experience_id)).filter(x=>x.status==='rejected').length,1);await assert.rejects(updateWiki({message:'游离内容'},mock),e=>e.code==='BROKEN_REF');
 for(const jd of ['需要文档能力','需要整理文档'])for(const mode of ['fulltext','index','index_fallback']){const run=await generate({jd,mode},mock);assert.equal(run.query_plan.requirements.length,1);assert.equal(run.discovery.length,1);const revised=await reviseOutline({run_id:run.id,comment:'调整定位'},mock);assert.equal(revised.outline.positioning,'按评论修改');const finished=await compose({run_id:run.id},mock);assert.equal(finished.status,'complete')}
 const exp=s.nodes.find(n=>n.kind==='experience'),old=await documentFor(exp,s.revision);await assert.rejects(editWiki({experience_id:exp.id,markdown:'# 删除全部锚点'}),e=>e.code==='BROKEN_REF');assert.equal((await state()).revision,s.revision);assert.equal(await documentFor(exp,s.revision),old);
 console.log('V0.1 mock chain passed');
}finally{await fs.rm(dir,{recursive:true,force:true})}

