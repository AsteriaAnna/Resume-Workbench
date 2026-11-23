import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {state,profile,documentFor,editWiki,updateWiki,generate,reviseOutline,compose as composeOriginal} from './workbench.mjs';
import {call} from './llm.mjs';
import {htmlToMarkdown,exportHtml} from './document.mjs';

const root=path.resolve(process.env.WORKBENCH_DATA_DIR||path.join(import.meta.dirname,'local-data'));
const dir=path.join(root,'studio');
const uid=p=>p+'_'+crypto.randomUUID().replaceAll('-','');
const safe=s=>{if(!/^[\w-]{1,100}$/.test(s||''))throw Error('无效编号');return s;};
const read=async(p,f)=>{try{return JSON.parse(await fs.readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT')return f;throw e;}};
const write=async(p,v)=>{await fs.mkdir(path.dirname(p),{recursive:true});const t=p+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(t,JSON.stringify(v,null,2));await fs.rename(t,p);};
let lock=Promise.resolve();
const serial=f=>{const p=lock.then(f);lock=p.catch(()=>{});return p;};
const resumeFile=id=>path.join(dir,'resumes',safe(id)+'.json');
export async function listResumes(){
  let names=[];try{names=await fs.readdir(path.join(dir,'resumes'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const items=await Promise.all(names.filter(n=>n.endsWith('.json')).map(n=>read(path.join(dir,'resumes',n))));
  return items.sort((a,b)=>b.updated_at.localeCompare(a.updated_at));
}
export const getResume=id=>read(resumeFile(id),null);
export const saveResume=(input,expected)=>serial(async()=>{
  const id=input.id||uid('resume'),old=await getResume(id);
  if(old&&expected!==old.revision)throw Object.assign(Error('此简历已被其他操作更新，请重新打开后合并修改。'),{status:409});
  if(typeof input.markdown!=='string'||input.markdown.length>200000)throw Error('正文格式不正确');
  const semantic=v=>JSON.stringify(Object.fromEntries(Object.entries(v).filter(([k])=>!['revision','created_at','updated_at'].includes(k)).sort(([a],[b])=>a.localeCompare(b))));
  if(old&&semantic({...old,...input})===semantic(old))return old;
  const now=new Date().toISOString();
  const next={...old,...input,id,name:String(input.name||'未命名简历').slice(0,100),revision:(old?.revision||0)+1,created_at:old?.created_at||now,updated_at:now};
  if(old)await write(path.join(dir,'history',id,`${old.revision}.json`),old);
  await write(resumeFile(id),next);return next;
});
let migrationLock=Promise.resolve();
export function migrate(){const next=migrationLock.then(migrateOnce);migrationLock=next.catch(()=>{});return next;}
async function migrateOnce(){
  const report=await read(path.join(dir,'migration.json'),{version:1,resumes:[],answers:[]});
  for(const old of await read(path.join(root,'resumes.json'),[])){
    const key=String(old.id);if(report.resumes.includes(key))continue;
    const id='legacy_'+key.replace(/[^\w-]/g,'_');
    if(!await getResume(id))await saveResume({id,name:old.name,folder:old.folder||'我的简历',markdown:htmlToMarkdown(old.html),styles:old.styles||{},jd:'',outline:null,comments:[],status:'草稿',legacy_html:old.html});
    report.resumes.push(key);await write(path.join(dir,'migration.json'),report);
  }
  let files=[];try{files=await fs.readdir(path.join(root,'v2','runs'));}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const file of files.filter(x=>x.endsWith('.json'))){
    const run=await read(path.join(root,'v2','runs',file),{});
    for(const c of run.comments||[]){
      if(!c.answer?.trim()||!c.exp_id)continue;
      const key=crypto.createHash('sha256').update(c.exp_id+'\n'+c.answer).digest('hex');
      if(report.answers.includes(key))continue;
      const index=await state(),exp=index.nodes.find(n=>n.id===c.exp_id&&n.kind==='experience');if(!exp)continue;
      const md=await documentFor(exp,index.revision),marker=`<!-- migrated-answer:${key} -->`;
      if(!md.includes(marker))await editWiki({experience_id:exp.id,markdown:md+`\n\n${marker}\n## 历史评论补充\n${c.answer}\n`});
      report.answers.push(key);await write(path.join(dir,'migration.json'),report);
    }
  }
  return report;
}
export async function materials(){
  const index=await state(),basic=await profile(),sources=[];
  const experiences=[];
  for(const exp of index.nodes.filter(n=>n.kind==='experience'&&n.status==='active')){
    const children=index.nodes.filter(n=>n.experience_id===exp.id&&n.status==='active');
    const ids=new Set([...(exp.source_ids||[]),...children.flatMap(n=>n.source_ids||[])]);
    const refs=[];
    for(const s of index.sources.filter(s=>ids.has(s.id))){
      const raw=await read(path.join(root,s.source_path),null);
      const text=raw?.messages.find(m=>m.id===s.message_id)?.content;
      if(text){const src={id:s.id,node_id:exp.id,text};refs.push(src);sources.push(src);}
    }
    experiences.push({...exp,markdown:await documentFor(exp,index.revision),stories:children,source_ids:refs.map(s=>s.id)});
  }
  if(basic.markdown&&basic.source_ref)sources.push({id:basic.source_ref.id,node_id:'profile_local',text:basic.markdown});
  const result={revision:index.revision,profile_revision:basic.revision,profile:basic.markdown,experiences,sources};
  if(JSON.stringify(result).length>300000)throw Error('材料超过当前完整阅读预算。请拆分过长的重复记录后重试；没有截断资料。');
  return result;
}
export async function graph(){
  const index=await state();const nodes=index.nodes.filter(n=>n.status==='active').map(n=>({id:n.id,label:n.title,type:n.kind==='experience'?'experience':n.kind==='topic'?'node':'card',exp_id:n.experience_id,kind:n.kind}));
  nodes.unshift({id:'profile_local',label:'基础信息',type:'profile'});
  const links=index.relations.filter(r=>r.status==='active').map(r=>({source:r.from_id,target:r.to_id,kind:r.type}));
  return {nodes,links,stats:{experiences:nodes.filter(n=>n.type==='experience').length,cards:nodes.filter(n=>n.type==='card').length,tags:nodes.filter(n=>n.type==='node').length}};
}
export function validateOutline(o,m){
  if(!Array.isArray(o?.sections))throw Error('大纲缺少栏目');
  const ids=new Set(['profile_local',...m.experiences.map(e=>e.id)]);
  for(const s of o.sections){if(typeof s.name!=='string'||!Array.isArray(s.items))throw Error('大纲栏目格式错误');for(const i of s.items){if(!ids.has(i.node_id))throw Error('大纲引用了不存在的经历');const e=m.experiences.find(e=>e.id===i.node_id);for(const sid of i.story_ids||[])if(!e?.stories.some(n=>n.id===sid))throw Error('故事归属不正确');}}
}
export function claimIssues(draft,m){
  const errors=[],claims=draft?.claims||[],md=String(draft?.markdown||'');
  if(!md.trim())errors.push({severity:'block',reason:'正文为空'});
  for(const c of claims)if(!md.includes(c.sentence)||!c.sentence?.trim()||!Array.isArray(c.source_ids)||!c.source_ids.length||c.source_ids.some(id=>!m.sources.some(s=>s.id===id)))errors.push({severity:'block',sentence:c.sentence,reason:'事实引用无效'});
  for(const line of md.split('\n').filter(s=>s.trim()&&!/^#+\s/.test(s)&&!/^\s*[-|:]+\s*$/.test(s)))if(!claims.some(c=>c.sentence&&line.includes(c.sentence)))errors.push({severity:'block',sentence:line,reason:'正文行缺少事实引用'});
  return errors;
}
export async function execute(action,input,model=call){
  const m=await materials();
  if(action==='outline'){
    if(!input.jd?.trim())throw Error('请提供 JD');
    const run=await generate({jd:input.jd,mode:'index_fallback'},model);
    return {outline:run.outline,run_id:run.id,strategy:run.strategy,query_plan:run.query_plan,discovery:run.discovery,evaluation:run.evaluation,selection:run.selection,material_revision:m.revision,profile_revision:m.profile_revision};
  }
  if(action==='revise'){
    if(!input.run_id)throw Error('先生成岗位大纲');
    const run=await reviseOutline({run_id:input.run_id,comment:input.comment},model);
    return {outline:run.outline,run_id:run.id,strategy:run.strategy,material_revision:m.revision};
  }
  if(action==='compose'){
    if(!input.run_id)throw Error('先生成岗位大纲');
    validateOutline(input.outline,m);
    const run=await composeOriginal({run_id:input.run_id,outline:input.outline},model);
    const issues=[...(run.validation?.issues||[]),...(run.validation?.comments||[])];
    return {draft:run.content,issues,ok:run.validation?.ok===true,run_id:run.id,material_revision:run.revision,profile_revision:m.profile_revision};
  }
  if(action==='comments'){
    const r=await model('studio_comments',{jd:input.jd,markdown:input.markdown,material:m});if(!Array.isArray(r.comments))throw Error('评论格式不完整');
    return {comments:r.comments.filter(c=>c.quote&&input.markdown.includes(c.quote)&&['expression','fact'].includes(c.kind)&&(c.kind!=='fact'||m.experiences.some(e=>e.id===c.node_id))).slice(0,4).map(c=>({...c,id:uid('comment'),status:'open'}))};
  }
  if(action==='answer'){
    if(!input.answer?.trim())throw Error('请先填写补充');
    if(!m.experiences.some(e=>e.id===input.comment?.node_id))throw Error('请选择补充所属的经历');
    const receipt=path.join(dir,'answers',crypto.createHash('sha256').update(input.comment.node_id+'\n'+input.answer.trim()).digest('hex')+'.json');
    if(!await read(receipt,null)){await updateWiki({experience_id:input.comment.node_id,message:input.answer},model);await write(receipt,{saved_at:new Date().toISOString()});}
    const updated=await materials();
    const patch=await model('studio_patch',{jd:input.jd,markdown:input.markdown,comment:input.comment,answer:input.answer,material:updated});
    if(patch.quote!==input.comment.quote||!input.markdown.includes(patch.quote)||!patch.replacement)throw Error('建议无法对应原句；补充已保存到经历库');
    const draft={markdown:patch.replacement,claims:patch.claims};const verification=await model('studio_verify',{draft,sources:updated.sources});
    if(!Array.isArray(verification.issues))throw Error('补充已保存，修改建议核验失败');
    const issues=[...claimIssues(draft,updated),...verification.issues];return {patch,issues,ok:!issues.some(i=>i.severity==='block'),supplement_saved:true};
  }
  throw Error('未知任务');
}

const jobs=new Map();
export async function startJob(action,input,model=call){
  if(!['outline','revise','compose','comments','answer'].includes(action))throw Error('未知任务');
  const job={id:uid('job'),action,input,status:'running',stage:'准备材料',events:[],created_at:new Date().toISOString()};jobs.set(job.id,job);
  const persist=()=>write(path.join(dir,'jobs',job.id+'.json'),job);
  await persist();
  const wrapped=async(task,payload)=>{if(job.status==='cancelled')throw Error('任务已取消');job.stage=task;await persist();const at=Date.now();try{const output=await model(task,payload);job.events.push({task,input:payload,output,elapsed_ms:Date.now()-at});await persist();return output;}catch(e){job.events.push({task,input:payload,error:e.message});throw e;}};
  Promise.resolve().then(()=>execute(action,input,wrapped)).then(result=>{if(job.status!=='cancelled'){job.result=result;job.status='complete';}}).catch(e=>{if(job.status!=='cancelled'){job.error=e.message;job.status='failed';}}).finally(async()=>{job.finished_at=new Date().toISOString();await persist();jobs.delete(job.id);}).catch(()=>{});
  return {id:job.id};
}
export async function jobFor(id){const j=jobs.get(safe(id))||await read(path.join(dir,'jobs',id+'.json'),null);if(!j)throw Error('任务不存在');if(j.status==='running'&&!jobs.has(id))return {...j,status:'interrupted',error:'服务已重启，可以重新执行此任务'};return j;}
export async function studioRoute(req,res,url,{body,send}){
  const p=url.pathname;
  if(p==='/api/studio/folders'&&req.method==='GET')return send(res,200,{folders:await read(path.join(dir,'folders.json'),[])});
  if(p==='/api/studio/folders'&&req.method==='POST'){const v=await body(req);if(!Array.isArray(v.folders)||v.folders.some(f=>typeof f!=='string'||f.length>100))throw Error('文件夹格式错误');await write(path.join(dir,'folders.json'),[...new Set(v.folders)]);return send(res,200,{ok:true});}
  if(p==='/api/studio/graph'&&req.method==='GET')return send(res,200,await graph());
  if(p==='/api/studio/resumes'&&req.method==='GET'){await migrate();return send(res,200,{items:await listResumes()});}
  if(p==='/api/studio/resume'&&req.method==='POST'){const v=await body(req);return send(res,200,await saveResume(v.resume,v.expected_revision));}
  if(p==='/api/studio/job'&&req.method==='POST'){const v=await body(req);return send(res,202,await startJob(v.action,v.input));}
  if(p==='/api/studio/job'&&req.method==='GET')return send(res,200,await jobFor(url.searchParams.get('id')));
  if(p==='/api/studio/cancel'&&req.method==='POST'){const {id}=await body(req);const j=jobs.get(safe(id));if(j)j.status='cancelled';return send(res,200,{ok:true});}
  if(p==='/api/studio/history'&&req.method==='GET'){const id=safe(url.searchParams.get('id'));let names=[];try{names=await fs.readdir(path.join(dir,'history',id));}catch(e){if(e.code!=='ENOENT')throw e;}return send(res,200,{items:await Promise.all(names.filter(n=>/^\d+\.json$/.test(n)).sort((a,b)=>parseInt(b)-parseInt(a)).map(n=>read(path.join(dir,'history',id,n))))});}
  if(p==='/api/studio/export'&&req.method==='GET'){const r=await getResume(url.searchParams.get('id'));if(!r)throw Error('简历不存在');if(url.searchParams.get('format')==='md'){res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(r.name)}.md`});return res.end(r.markdown);}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(exportHtml(r));}
  return send(res,404,{error:'接口不存在'});
}
