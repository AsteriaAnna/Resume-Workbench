import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const inputFile=process.env.EXPERIENCE_FILE;
if(!inputFile)throw Error('Set EXPERIENCE_FILE to the experience library Markdown path');
const source=await fs.readFile(inputFile,'utf8');
const section=title=>{
  const line=`### ${title}`;
  const start=source.indexOf(line);
  assert(start>=0,`Missing section: ${title}`);
  const tail=source.slice(start+line.length);
  const end=tail.search(/\n### |\n## /);
  return tail.slice(0,end<0?undefined:end).trim();
};
const coze=section('扣子平台校园推广');
const split=coze.indexOf('线下落地受到');
assert(split>0);
const first=coze.slice(0,split).trim();
const supplement=coze.slice(split).trim();
const sony=section('索尼中国有限公司上海分公司 HRG 部门实习');
const basic=section('上海理工大学本科阶段');
const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-interaction-'));
process.env.WORKBENCH_DATA_DIR=dataDir;
const {updateWiki,createWikiExperience,guideQuestions,conversationFor,saveProfile,state,documentFor,generate,compose}=await import('../workbench.mjs');
const {call}=await import('../llm.mjs');
const report={steps:[],dataDir};
try{
  const a=await createWikiExperience({message:first},call);
  report.steps.push({stage:'first_experience',revision:a.revision,experience_id:a.experience_id,questions:a.questions?.length||0});
  const b=await updateWiki({message:supplement,experience_id:a.experience_id},call);
  report.steps.push({stage:'supplement',revision:b.revision,same_experience:b.experience_id===a.experience_id,questions:b.questions?.length||0});
  const c=await createWikiExperience({message:sony},call);
  const index=await state();
  const guidance=await guideQuestions({experience_id:a.experience_id},call);
  const rawFiles=await fs.readdir(path.join(dataDir,'raw'));
  const counts=Object.fromEntries(['experience','story','fragment','topic'].map(kind=>[kind,index.nodes.filter(n=>n.kind===kind).length]));
  const active=index.nodes.filter(n=>n.status==='active');
  const validAnchors=(await Promise.all(active.map(n=>documentFor(n,index.revision)))).every((text,i)=>text.includes(`<a id="${active[i].id}"></a>`));
  report.steps.push({stage:'second_experience',revision:c.revision,new_experience:c.experience_id!==a.experience_id,raw_batches:rawFiles.length,counts,validAnchors,questions:c.questions?.length||0,guide_questions:guidance.questions.length,conversation_turns:(await conversationFor(a.experience_id)).length});
  const savedProfile=await saveProfile({markdown:basic});
  report.steps.push({stage:'basic_information',profile_revision:savedProfile.revision,source_length:basic.length});
  const jd='AI 产品实习生：协助梳理用户需求，输出产品交付文档；熟练使用 ChatGPT、DeepSeek 等大模型工具提升需求梳理和方案撰写效率；了解 Coze 平台；具有逻辑思维和沟通能力，能够推进需求落地。';
  const run=await generate({jd,mode:'index_fallback'},call);
  report.steps.push({stage:'outline',run_id:run.id,requirements:run.query_plan.requirements.length,index_hits:run.discovery.map(x=>x.index_candidates.length),fallback_reads:run.discovery.map(x=>x.fulltext_fallback_candidates.length),selection:run.selection.items.map(x=>({kind:index.nodes.find(n=>n.id===x.node_id)?.kind,section:x.section,use:x.use})),sections:run.outline.sections.map(x=>x.name),model_calls:run.metrics.model_usage.length});
  const done=await compose({run_id:run.id},call);
  report.steps.push({stage:'compose',status:done.status,validation:done.validation,claim_count:done.content?.claims?.length||0,body_length:done.content?.markdown?.length||0});
  console.log(JSON.stringify(report,null,2));
}catch(error){report.error={code:error.code||'ERROR',object_id:error.object_id||'',field:error.field||'',message:error.message};console.log(JSON.stringify(report,null,2));process.exitCode=1}
finally{await fs.rm(dataDir,{recursive:true,force:true})}

