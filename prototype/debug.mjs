import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {call} from './llm.mjs';

const root=path.resolve(process.env.WORKBENCH_DATA_DIR||path.join(import.meta.dirname,'local-data'));
const workflowFile=path.join(import.meta.dirname,'.local-workflow.json');
const defaultWorkflow={default_retrieval_mode:'index_fallback',repair_on_block:true};
export async function workflowConfig(){try{return {...defaultWorkflow,...JSON.parse(await fs.readFile(workflowFile,'utf8'))}}catch(e){if(e.code==='ENOENT')return {...defaultWorkflow};throw e}}
export async function saveWorkflowConfig(value){if(!['index','fulltext','index_fallback'].includes(value?.default_retrieval_mode)||typeof value.repair_on_block!=='boolean')throw Error('流程参数无效');const config={default_retrieval_mode:value.default_retrieval_mode,repair_on_block:value.repair_on_block};await fs.writeFile(workflowFile,JSON.stringify(config,null,2),'utf8');return config}
const safe=id=>/^[a-zA-Z0-9_-]{1,100}$/.test(id)?id:null;
const stages=[
 {id:'wiki_input',lane:'经历入库',kind:'entry',label:'经历输入',output:'选中的 Experience ID + 用户原话'},
 {id:'check_extension',lane:'经历入库',kind:'model',label:'归属核对',input:'所选经历正文 + 本轮原话',output:'accept / reason'},
 {id:'wiki_update',lane:'经历入库',kind:'model',label:'整理 Wiki',input:'原话 + 所选经历及子节点',output:'Experience / Story / Fragment / Topic 建议'},
 {id:'wiki_commit',lane:'经历入库',kind:'rule',label:'校验与快照',input:'模型建议 + 原话引用',output:'稳定 ID、关系、Markdown 快照'},
 {id:'guide_questions',lane:'经历入库',kind:'model',label:'引导提问',input:'选中 Experience + 子节点',output:'最多三条有依据的问题'},
 {id:'assist_wiki',lane:'经历入库',kind:'model',label:'Wiki 写作辅助',input:'当前正文 + 用户指令',output:'补充建议与问题'},
 {id:'jd_input',lane:'简历制作',kind:'entry',label:'输入 JD',output:'完整 JD + 可选覆盖意见'},
 {id:'strategy',lane:'简历制作',kind:'model',label:'写作策略',input:'JD + 覆盖意见',output:'主副策略 + 写作重心'},
 {id:'query_plan',lane:'简历制作',kind:'model',label:'查询计划',input:'JD + 策略',output:'要求、术语、证据需求'},
 {id:'experience_search',lane:'简历制作',kind:'rule',label:'按经历检索',input:'每条要求的 terms + Experience 及子节点索引',output:'Experience 候选及未命中兜底'},
 {id:'evaluate',lane:'简历制作',kind:'model',label:'证据评估',input:'单条要求 + 候选 Experience 全文',output:'相关性、贡献、证据、使用决定'},
 {id:'selection',lane:'简历制作',kind:'model',label:'经历选材',input:'策略 + 评估 + 完整经历',output:'栏目、篇幅、重点、故事钩子'},
 {id:'selection_guard',lane:'简历制作',kind:'rule',label:'选材约束',input:'模型选材 + 有效评估 + 经历类型',output:'过滤无证据条目并校正栏目'},
 {id:'outline',lane:'简历制作',kind:'model',label:'简历大纲',input:'选材 + 经历 + 基础信息',output:'可审阅的栏目与条目'},
 {id:'outline_guard',lane:'简历制作',kind:'rule',label:'大纲约束',input:'模型大纲 + 已选材料',output:'移除无来源条目并核对节点 ID'},
 {id:'revise_outline',lane:'简历制作',kind:'model',label:'评论修订',input:'大纲 + 用户意见 + 所选材料',output:'更新后的大纲'},
 {id:'compose',lane:'简历制作',kind:'model',label:'生成正文',input:'已审大纲 + 完整材料',output:'Markdown + claims + questions'},
 {id:'trace_claims',lane:'简历制作',kind:'model',label:'逐句追溯',input:'正文逐行 + SourceRef 原话',output:'句子与来源 ID'},
 {id:'verify',lane:'简历制作',kind:'model',label:'事实校验',input:'正文 + 来源 + 策略',output:'block / review / suggestion'},
 {id:'claim_guard',lane:'简历制作',kind:'rule',label:'来源结构检查',input:'正文 + claims + 完整材料',output:'无法追溯或结构不符的阻断问题'},
 {id:'repair',lane:'简历制作',kind:'model',label:'修复正文',input:'有阻断问题的正文 + 来源',output:'修订稿，再次追溯与校验'},
 {id:'save_resume',lane:'简历制作',kind:'rule',label:'保存简历',input:'通过校验的正文 + 用户编辑',output:'本地简历版本'}
 ,{id:'assist_review',lane:'简历制作',kind:'model',label:'简历评论',input:'简历正文 + 用户指令',output:'可定位的打磨评论'}
];
const links=[
 ['wiki_input','check_extension','所选经历 + 原话；新建时跳过归属核对'],['check_extension','wiki_update','accept=true'],['wiki_input','wiki_update','新建经历直接整理'],['wiki_update','wiki_commit','结构化建议 + 原话引用'],['wiki_commit','guide_questions','用户主动请求：所选经历及子节点'],['wiki_commit','assist_wiki','用户主动请求：当前正文和用户指令'],
 ['jd_input','strategy','完整 JD'],['strategy','query_plan','策略 + JD'],['query_plan','experience_search','逐条 requirement.terms'],['experience_search','evaluate','Experience 候选全文；index_fallback 追加未命中经历'],['evaluate','selection','各要求的有效 assessment'],['selection','selection_guard','模型决定与证据约束'],['selection_guard','outline','有效经历与栏目'],['outline','outline_guard','生成大纲与选材'],['outline_guard','revise_outline','用户主动评论；可重复'],['outline_guard','compose','用户确认的大纲'],['revise_outline','compose','修订后的大纲'],['compose','trace_claims','正文逐行'],['trace_claims','claim_guard','来源标注 + 正文'],['claim_guard','verify','结构问题与正文'],['verify','repair','有 block 才修复'],['repair','trace_claims','修复后重新追溯'],['verify','save_resume','无 block 后由工作台保存'],['save_resume','assist_review','用户主动请求：当前简历正文 + 用户指令']
].map(([from,to,data])=>({from,to,data}));
const implementations={wiki_input:'app.js · requestAssistance/saveDoc',wiki_commit:'workbench.mjs · updateWiki/commit',jd_input:'app.js · createOutline',experience_search:'workbench.mjs · generate/indexText',selection_guard:'workbench.mjs · groupSelection/supported',outline_guard:'workbench.mjs · sanitizeOutline/validateOutline',claim_guard:'workbench.mjs · structuralCheck',save_resume:'serve.mjs + storage.mjs · saveResumes'};
export const flow=()=>({stages:stages.map(s=>({...s,implementation:implementations[s.id]||`llm.mjs · ${s.id}`})),links,retrieval_modes:[{id:'index_fallback',label:'索引 + 全经历兜底'},{id:'index',label:'仅索引'},{id:'fulltext',label:'全部经历全文'}]});
export async function traced(operation,input,work){const trace={id:`trace_${crypto.randomUUID().replaceAll('-','').slice(0,16)}`,operation,at:new Date().toISOString(),input,events:[]};const wrapped=async(task,payload)=>{const start=Date.now();try{const output=await call(task,payload);trace.events.push({task,input:payload,output,elapsed_ms:Date.now()-start,kind:'model'});return output}catch(e){trace.events.push({task,input:payload,error:e.message,elapsed_ms:Date.now()-start,kind:'model'});throw e}};wrapped.record=(task,payload,output)=>trace.events.push({task,input:payload,output,elapsed_ms:0,kind:'rule'});try{const result=await work(wrapped);trace.run_id=result?.id||result?.run_id||null;trace.result_summary={status:result?.status||'ok',revision:result?.revision??null,validation:result?.validation?{ok:result.validation.ok,issues:result.validation.issues}:null};return result} catch(e){trace.error=e.message;throw e}finally{await fs.mkdir(path.join(root,'debug-traces'),{recursive:true});await fs.writeFile(path.join(root,'debug-traces',`${trace.id}.json`),JSON.stringify(trace,null,2),'utf8')}}
export async function traces(){const folder=path.join(root,'debug-traces');let names=[];try{names=await fs.readdir(folder)}catch(e){if(e.code!=='ENOENT')throw e}const results=await Promise.all(names.filter(x=>/^trace_[\w-]+\.json$/.test(x)).slice(-100).map(async name=>{const data=JSON.parse(await fs.readFile(path.join(folder,name),'utf8'));return {id:data.id,operation:data.operation,at:data.at,run_id:data.run_id,event_count:data.events?.length||0,error:data.error||null}}));return results.sort((a,b)=>b.at.localeCompare(a.at))}
export async function traceFor(id){if(!safe(id))throw Error('无效轨迹编号');return JSON.parse(await fs.readFile(path.join(root,'debug-traces',`${id}.json`),'utf8'))}
export async function runs(){const folder=path.join(root,'runs');let names=[];try{names=await fs.readdir(folder)}catch(e){if(e.code!=='ENOENT')throw e}const list=[];for(const name of names.slice(-100)){if(!safe(name))continue;try{const r=JSON.parse(await fs.readFile(path.join(folder,name,'result.json'),'utf8'));list.push({id:r.id,status:r.status,revision:r.revision,jd:String(r.jd||'').slice(0,130),mode:r.mode,elapsed_ms:r.metrics?.elapsed_ms,validation_ok:r.validation?.ok??null})}catch{}}return list.reverse()}
export async function runFor(id){if(!safe(id))throw Error('无效运行编号');return JSON.parse(await fs.readFile(path.join(root,'runs',id,'result.json'),'utf8'))}

