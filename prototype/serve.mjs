import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {configured,connectionInfo,saveConnection,taskNames,promptInfo,savePrompt} from './llm.mjs';
import {resumes,saveResumes,syncSettings,setSyncToken,pushData,pullData} from './storage.mjs';
import {archiveWiki,state,profile,saveProfile,documentFor,wikiIndex,updateWiki,createWikiExperience,guideQuestions,conversationFor,editWiki,setExperienceType,generate,reviseOutline,compose} from './workbench.mjs';
import {traced} from './debug.mjs';
import {studioRoute} from './studio.mjs';
import {workflowConfig,flow,traces,traceFor,runs,runFor} from './debug.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/studio-ui.js':'studio-ui.js','/document.mjs':'document.mjs'};
const port=Number(process.env.WORKBENCH_PORT||4321);
const send=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj))};
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1000000)throw Error('输入过长')}return JSON.parse(raw)}
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(req.method==='GET'&&url.pathname==='/api/status')return send(res,200,connectionInfo());
if(req.method==='GET'&&url.pathname==='/api/model')return send(res,200,connectionInfo());

if(req.method==='POST'&&req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin))return send(res,403,{error:'仅允许本机页面修改资料'});
if(req.method==='POST'&&url.pathname==='/api/model')return send(res,200,await saveConnection(await body(req)));
if(url.pathname.startsWith('/api/studio/'))return await studioRoute(req,res,url,{body,send});
if(url.pathname==='/api/prompts'&&req.method==='GET')return send(res,200,{items:await Promise.all(taskNames().map(promptInfo))});
if(url.pathname==='/api/prompts'&&req.method==='POST'){const v=await body(req);return send(res,200,await savePrompt(v.task,v.prompt));}
if(url.pathname==='/api/traces'&&req.method==='GET')return send(res,200,{items:await traces()});
if(url.pathname==='/api/trace'&&req.method==='GET')return send(res,200,await traceFor(url.searchParams.get('id')));
if(req.method==='GET'&&url.pathname==='/api/resumes')return send(res,200,{items:await resumes()});
if(req.method==='POST'&&url.pathname==='/api/resumes'){const input=await body(req);return send(res,200,{items:await saveResumes(input.items)})}
if(req.method==='GET'&&url.pathname==='/api/sync/settings')return send(res,200,await syncSettings());
if(req.method==='POST'&&url.pathname==='/api/sync/settings')return send(res,200,await setSyncToken((await body(req)).token));
if(req.method==='POST'&&url.pathname==='/api/sync/push')return send(res,200,await pushData());
if(req.method==='POST'&&url.pathname==='/api/sync/pull')return send(res,200,await pullData());
if(req.method==='GET'&&url.pathname==='/api/wiki'){const index=await state();return send(res,200,{index,documents:await Promise.all(index.nodes.map(async n=>({id:n.id,markdown:await documentFor(n,index.revision)})))})}
if(req.method==='GET'&&url.pathname==='/api/profile')return send(res,200,await profile());
if(req.method==='POST'&&url.pathname==='/api/profile')return send(res,200,await saveProfile(await body(req)));
if(req.method==='GET'&&url.pathname==='/api/wiki/conversation')return send(res,200,{messages:await conversationFor(url.searchParams.get('experience_id'))});
if(req.method==='POST'&&url.pathname==='/api/wiki/input'){const input=await body(req);return send(res,200,await traced('wiki_input',{experience_id:input.experience_id},wrapped=>updateWiki(input,wrapped)))}
if(req.method==='POST'&&url.pathname==='/api/wiki/create'){const input=await body(req);return send(res,200,await traced('wiki_create',{},wrapped=>createWikiExperience(input,wrapped)))}
if(req.method==='POST'&&url.pathname==='/api/wiki/questions'){const input=await body(req);return send(res,200,await traced('wiki_questions',{experience_id:input.experience_id},wrapped=>guideQuestions(input,wrapped)))}
if(req.method==='POST'&&url.pathname==='/api/wiki/edit')return send(res,200,await editWiki(await body(req)));
if(req.method==='POST'&&url.pathname==='/api/wiki/archive')return send(res,200,await archiveWiki(await body(req)));
if(req.method==='POST'&&url.pathname==='/api/wiki/type')return send(res,200,await setExperienceType(await body(req)));
if(req.method==='POST'&&url.pathname==='/api/assist'){
 if(!configured())return send(res,503,{error:'DeepSeek 密钥未配置'});
 const input=await body(req);if(!['wiki','review'].includes(input.task)||typeof input.content!=='string'||input.content.length>50000||typeof input.instruction!=='string'||input.instruction.length>10000)return send(res,400,{error:'输入格式不正确'});
 const result=await traced('assist_'+input.task,{task:input.task},wrapped=>wrapped('assist_'+input.task,{content:input.content,instruction:input.instruction}));
 if(input.task==='review'){const comments=Array.isArray(result.comments)?result.comments.filter(x=>x&&typeof x.quote==='string'&&input.content.includes(x.quote)&&typeof x.suggestion==='string').slice(0,4):[];return send(res,200,{comments})}
 return send(res,200,{suggestion:String(result.suggestion||''),questions:Array.isArray(result.questions)?result.questions.slice(0,3):[],note:String(result.note||'')})}
 const f=files[url.pathname];if(req.method!=='GET'||!f){res.writeHead(404);return res.end('Not found')}res.setHeader('Content-Type',(f.endsWith('.js')||f.endsWith('.mjs'))?'text/javascript; charset=utf-8':f.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(await fs.readFile(path.join(root,f)))
 }catch(e){send(res,e.status||(e.code?400:500),{code:e.code||'INTERNAL_ERROR',object_id:e.object_id||'',field:e.field||'',message:e.message,error:e.name==='AbortError'?'请求超时':e.cause?.code==='EACCES'?'当前进程没有访问 DeepSeek 的网络权限':req.url?.startsWith('/api/sync/')?e.message:e.code?e.message:'本地服务处理失败'})}}).listen(port,'127.0.0.1',()=>console.log(`Workbench: http://127.0.0.1:${port}`));




