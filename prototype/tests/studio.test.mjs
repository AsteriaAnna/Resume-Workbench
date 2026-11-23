import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const folder=await fs.mkdtemp(path.join(os.tmpdir(),'resume-studio-'));
process.env.WORKBENCH_DATA_DIR=folder;
const wiki=await import('../workbench.mjs');
const studio=await import('../studio.mjs');
const mock=async(task,input)=>{
 if(task==='check_extension')return {accept:!input.message.includes('无关')};
 if(task==='wiki_update')return {title:'会议助手',experience_type:'project',summary:'做会议待办助手',markdown:input.message,stories:[{title:'检索决策',summary:'选择按会议检索',markdown:input.message}],fragments:[],topics:[],quotes:[input.message],questions:[]};
 throw Error(task);
};
test('unified sources, version conflicts, migration, proposals and persistent jobs',async()=>{
 try{
 const e=await wiki.createWikiExperience({message:'我负责Node.js接口，为避免跨会议混用内容，按会议ID检索，返回原话引用。'},mock);
 await wiki.updateWiki({experience_id:e.experience_id,message:'补充：我是两人团队的一员，部署由同学负责。'},mock);
 await assert.rejects(()=>wiki.updateWiki({experience_id:e.experience_id,message:'无关的网络观点'},mock));
 let m=await studio.materials();assert.equal(m.experiences.length,1);assert.ok(m.sources.some(s=>s.text.includes('部署由同学')));assert.ok(!m.sources.some(s=>s.text.includes('无关')));
 const r=await studio.saveResume({name:'测试',markdown:'旧稿',jd:'技术岗位'});
 assert.equal((await studio.saveResume(r,r.revision)).revision,r.revision);
 const r2=await studio.saveResume({...r,markdown:'修改稿'},r.revision);assert.equal(r2.revision,2);
 await assert.rejects(()=>studio.saveResume({...r,markdown:'过期修改'},r.revision),/其他操作/);
 const old=JSON.parse(await fs.readFile(path.join(folder,'studio','history',r.id,'1.json'),'utf8'));assert.equal(old.markdown,'旧稿');
 const outline={positioning:'技术项目候选人',sections:[{name:'项目经历',items:[{node_id:e.experience_id,title:'会议助手',story_ids:[],enabled:true}]}]};
 const model=async(task,input)=>{
  if(task==='studio_outline'){assert.ok(input.material.sources.some(s=>s.text.includes('部署由同学')));return outline;}
  if(task==='studio_compose'){const src=input.material.sources.find(s=>s.text.includes('Node.js'));return {markdown:'# 候选人\n## 项目经历\n- 开发Node.js接口并返回原话引用。',claims:[{sentence:'- 开发Node.js接口并返回原话引用。',source_ids:[src.id]}]};}
  if(task==='studio_verify')return {issues:[]};
  throw Error(task);
 };
 assert.deepEqual((await studio.execute('outline',{jd:'应用工程'},model)).outline,outline);
 const draft=await studio.execute('compose',{jd:'应用工程',outline},model);assert.equal(draft.ok,true);assert.equal((await studio.getResume(r.id)).markdown,'修改稿');
 assert.ok(studio.claimIssues({markdown:'无依据句子',claims:[]},m).length);
 assert.throws(()=>studio.validateOutline({sections:[{name:'项目',items:[{node_id:'invented'}]}]},m));
 const j=await studio.startJob('outline',{jd:'产品岗位'},model);let result;for(let i=0;i<40;i++){result=await studio.jobFor(j.id);if(result.status==='complete')break;await new Promise(r=>setTimeout(r,15));}assert.equal(result.status,'complete');assert.equal(result.events[0].task,'studio_outline');
 await fs.mkdir(path.join(folder,'v2','runs'),{recursive:true});await fs.writeFile(path.join(folder,'v2','runs','one.json'),JSON.stringify({comments:[{exp_id:e.experience_id,answer:'我还做了40条样本回归。'}]}));
 await studio.migrate();const rev=(await wiki.state()).revision;await studio.migrate();assert.equal((await wiki.state()).revision,rev);
 m=await studio.materials();assert.ok(m.sources.some(s=>s.text.includes('40条样本')));
 const comment={id:'retry-test',node_id:e.experience_id,quote:'旧句'};
 const failing=async(task,input)=>{if(task==='studio_patch')throw Error('patch failed');return mock(task,input);};
 await assert.rejects(()=>studio.execute('answer',{comment,answer:'补充：我负责接口错误提示。',markdown:'旧句'},failing),/patch failed/);
 const afterAnswer=(await wiki.state()).revision;
 await assert.rejects(()=>studio.execute('answer',{comment,answer:'补充：我负责接口错误提示。',markdown:'旧句'},failing),/patch failed/);
 assert.equal((await wiki.state()).revision,afterAnswer);
 await wiki.archiveWiki({node_id:e.experience_id});assert.equal((await studio.materials()).experiences.length,0);
 await wiki.archiveWiki({node_id:e.experience_id,restore:true});assert.equal((await studio.materials()).experiences.length,1);
 const g=await studio.graph();assert.ok(g.nodes.some(n=>n.id==='profile_local'));assert.ok(g.links.some(l=>l.target===e.experience_id));
 }finally{await fs.rm(folder,{recursive:true,force:true});}
});
