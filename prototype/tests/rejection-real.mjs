import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-rejection-'));
process.env.WORKBENCH_DATA_DIR=dataDir;
const {createWikiExperience,updateWiki,conversationFor,state}=await import('../workbench.mjs');
const {call}=await import('../llm.mjs');
try{
 const created=await createWikiExperience({message:'我在校内读书会负责组织三次分享活动，安排报名并统计到场人数。'},call);
 let rejected='none';
 try{await updateWiki({experience_id:created.experience_id,message:'关于 rap 音乐的风格，我觉得节奏和押韵值得讨论。这只是我的个人观点，与读书会无关。'},call)}catch(e){rejected=e.code||e.message}
 const index=await state(),conversation=await conversationFor(created.experience_id);
 console.log(JSON.stringify({rejected,current_revision:index.revision,experience_count:index.nodes.filter(n=>n.kind==='experience').length,rejected_turns:conversation.filter(x=>x.status==='rejected').length}));
 if(rejected!=='UNRELATED_INPUT'||index.revision!==1)process.exitCode=1;
}finally{await fs.rm(dataDir,{recursive:true,force:true})}

