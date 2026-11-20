import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'resume-live-v01-'));
process.env.WORKBENCH_DATA_DIR=dir;
const {createWikiExperience,generate,compose,state}=await import('../workbench.mjs');
const {call}=await import('../llm.mjs');
try{
 const update=await createWikiExperience({message:'我在示例公司担任产品实习生，负责整理每周产品反馈。原来的反馈散在聊天记录里，我用飞书表格按问题类别记录并每周发给导师。我们没有统计效率变化。'},call);
 console.log(JSON.stringify({stage:'wiki',revision:update.revision,nodes:(await state()).nodes.map(n=>({kind:n.kind,status:n.status}))}));
 const run=await generate({jd:'招聘产品实习生：能整理用户反馈、使用办公工具，并清楚表达个人贡献。',mode:'index_fallback'},call);
 console.log(JSON.stringify({stage:'outline',requirements:run.query_plan.requirements.length,sections:run.outline.sections.length,read_nodes:run.metrics.read_nodes}));
 const done=await compose({run_id:run.id},call);
 console.log(JSON.stringify({stage:'compose',status:done.status,issues:done.validation.issues.map(x=>({type:x.type,reason:x.reason})),contentKeys:Object.keys(done.content||{}),claimChecks:(done.content?.claims||[]).map(c=>({nodeKnown:done.material.some(m=>m.node.id===c.node_id),sentenceInMarkdown:done.content.markdown?.includes(c.sentence),sourceKnown:done.material.some(m=>m.node.id===c.node_id&&c.source_ids?.every(id=>m.node.source_ids.includes(id)))}))}));
}catch(e){console.log(JSON.stringify({stage:'error',code:e.code||null,message:e.message,stack:e.stack?.split('\\n').slice(0,4)}));process.exitCode=1}finally{await fs.rm(dir,{recursive:true,force:true})}


