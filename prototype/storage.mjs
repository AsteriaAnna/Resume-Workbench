import fs from 'node:fs/promises';
import path from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {randomUUID} from 'node:crypto';

const root=path.resolve(process.env.WORKBENCH_DATA_DIR||path.join(import.meta.dirname,'local-data'));
const configFile=path.join(import.meta.dirname,'.local-github.json');
const repo='AsteriaAnna/esume-Workbench-data';
const remoteFile='workbench-data.json.gz';
const readJson=async(file,fallback)=>{try{return JSON.parse(await fs.readFile(file,'utf8'))}catch(e){if(e.code==='ENOENT')return fallback;throw e}};
const writeJson=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});const temp=`${file}.${randomUUID()}.tmp`;await fs.writeFile(temp,JSON.stringify(value,null,2),'utf8');await fs.rename(temp,file)};

export async function resumes(){return readJson(path.join(root,'resumes.json'),[])}
export async function saveResumes(items){if(!Array.isArray(items)||items.length>500||items.some(x=>!x||!((typeof x.id==='number')||(typeof x.id==='string'&&x.id.length>0&&x.id.length<=64))||typeof x.name!=='string'||typeof x.html!=='string'||x.html.length>200000))throw Error('简历资料格式不正确');await writeJson(path.join(root,'resumes.json'),items);return items}

export async function syncSettings(){const value=await readJson(configFile,{});return {repo,configured:Boolean(value.token),last_sync:await readJson(path.join(root,'sync-state.json'),null)}}
export async function setSyncToken(token){if(typeof token!=='string'||!/^gh[psu]_[A-Za-z0-9_]{20,}$|^github_pat_[A-Za-z0-9_]{20,}$/.test(token))throw Error('请填写 GitHub Personal Access Token');await writeJson(configFile,{token});return syncSettings()}
async function api(route,options={}){const {token}=await readJson(configFile,{});if(!token)throw Error('请先在设置中填写私有仓库访问令牌');const res=await fetch(`https://api.github.com${route}`,{...options,headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28',...(options.headers||{})}});const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(`GitHub 同步失败（${res.status}）：${data.message||'请检查仓库权限'}`);return data}
async function assertPrivate(){const info=await api(`/repos/${repo}`);if(info.private!==true)throw Error('资料仓库不是私有仓库，已停止同步')}
async function remote(){try{return await api(`/repos/${repo}/contents/${remoteFile}`)}catch(e){if(String(e.message).includes('（404）'))return null;throw e}}
async function collect(dir=root,relative=''){const out={};let entries;try{entries=await fs.readdir(dir,{withFileTypes:true})}catch(e){if(e.code==='ENOENT')return out;throw e}for(const entry of entries){if(entry.name.endsWith('.tmp')||entry.name.includes('.tmp-')||entry.name==='sync-state.json'||entry.name==='debug-traces')continue;const rel=path.posix.join(relative,entry.name),full=path.join(dir,entry.name);if(entry.isDirectory())Object.assign(out,await collect(full,rel));else if(entry.isFile())out[rel]=await fs.readFile(full,'utf8')}return out}
const decode=x=>gunzipSync(Buffer.from(String(x).replace(/\s/g,''),'base64')).toString('utf8');
export async function pushData(){await assertPrivate();const files=await collect();if(!Object.keys(files).length)throw Error('本机还没有新工作台保存的资料');const before=await remote(),last=await readJson(path.join(root,'sync-state.json'),{});if(before&&before.sha!==last.remote_sha)throw Error('云端资料已变化，请先恢复或核对云端版本，避免覆盖');const payload={format:1,repo,saved_at:new Date().toISOString(),files};const encoded=gzipSync(Buffer.from(JSON.stringify(payload))).toString('base64');if(encoded.length>80_000_000)throw Error('资料超过单文件同步上限');const request={message:`Backup workbench data ${payload.saved_at}`,content:encoded,...(before?{sha:before.sha}:{})};const result=await api(`/repos/${repo}/contents/${remoteFile}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});const state={remote_sha:result.content.sha,last_push:payload.saved_at,file_count:Object.keys(files).length};await writeJson(path.join(root,'sync-state.json'),state);return state}
export async function pullData(){await assertPrivate();const item=await remote();if(!item)throw Error('私有仓库尚无同步资料');const payload=JSON.parse(decode(item.content));if(payload.format!==1||payload.repo!==repo||!payload.files||typeof payload.files!=='object')throw Error('云端资料格式不正确');const existing=await collect();if(Object.keys(existing).length)throw Error('本机已有资料；为避免覆盖，请先在空资料目录中恢复');for(const [rel,content] of Object.entries(payload.files)){if(typeof content!=='string'||!rel||path.posix.isAbsolute(rel)||rel.split('/').some(part=>part==='..'))throw Error('云端资料路径不安全');const dest=path.resolve(root,...rel.split('/'));if(!dest.startsWith(root+path.sep))throw Error('云端资料路径不安全');await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,content,'utf8')}const state={remote_sha:item.sha,last_pull:new Date().toISOString(),file_count:Object.keys(payload.files).length};await writeJson(path.join(root,'sync-state.json'),state);return state}

