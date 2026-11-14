import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { initialState, cleanState, aiMessages, parseAI, fingerprint } from '../core.mjs';
let dir, child, mock, csrf, port, base, received, remoteFile=null, privateRepo=true;
const listen = server => new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const call = async (route, method='GET', data, headers={}) => { const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json','X-Workbench-Token':csrf||'',...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});const bytes=Buffer.from(await r.arrayBuffer());let value;try{value=JSON.parse(bytes);}catch{}return {status:r.status,value,bytes};};
before(async()=>{
  dir=await fs.mkdtemp(path.join(os.tmpdir(),'storyfolio-tests-'));
  mock=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;res.setHeader('Content-Type','application/json');
    if(req.url==='/chat/completions'){received=JSON.parse(raw);res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({markdown:'# 测试\n## 教育背景\n测试学校',questions:[],role:'产品实习生'})}}]}));return;}
    if(req.url==='/repos/test/private'){res.end(JSON.stringify({private:privateRepo}));return;}
    if(req.url.endsWith('/contents/resume-workbench/workspace.json')){
      if(req.method==='PUT'){const b=JSON.parse(raw);if((b.sha||null)!==(remoteFile?.sha||null)){res.statusCode=409;res.end('{}');return;}remoteFile={content:b.content,sha:'sha-'+Date.now()};res.end(JSON.stringify({content:{sha:remoteFile.sha}}));return;}
      if(!remoteFile){res.statusCode=404;res.end('{}');return;}res.end(JSON.stringify(remoteFile));return;
    }res.statusCode=404;res.end('{}');
  });
  const mockPort=await listen(mock);const reserve=http.createServer();port=await listen(reserve);await new Promise(r=>reserve.close(r));base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['--import','./tests/mock-fetch.mjs','server.mjs'],{cwd:path.resolve('.'),env:{...process.env,PORT:String(port),WORKBENCH_DATA:dir,MOCK_GITHUB:`http://127.0.0.1:${mockPort}`},windowsHide:true,stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(new Error('server exit '+code)));});
  csrf=(await call('/api/state')).value.csrf;
  await call('/api/settings','POST',{baseUrl:`http://127.0.0.1:${mockPort}`,model:'mock-model',apiKey:'test-secret-key',repo:'test/private',token:'test-secret-token'});
});
after(async()=>{child?.kill();mock?.closeAllConnections();await new Promise(r=>mock?.close(r));});
test('完整故事进入模型上下文，保留复杂过程',()=>{const s=initialState('完整经历库');s.stories[0].text='先核对两个 Excel 的员工号，再标记异常；2000 份是团队规模。';const messages=aiMessages(s,{kind:'resume',jd:'流程设计'});assert.match(messages[1].content,/2000 份是团队规模/);assert.match(messages[0].content,/教育背景必须/);});
test('备份白名单剔除密钥及未知字段',()=>{const s=cleanState({...initialState(),apiKey:'secret',settings:{token:'secret'}});assert.equal(s.apiKey,undefined);assert.equal(s.settings,undefined);assert.equal(fingerprint(s),fingerprint({...s,revision:9}));});
test('异常 AI 输出拒绝，代码围栏 JSON 可接受',()=>{assert.throws(()=>parseAI('我认为可以这样写'));assert.equal(parseAI('```json\n{"markdown":"内容"}\n```').markdown,'内容');});
test('本地读写及乐观并发防覆盖',async()=>{const s=(await call('/api/state')).value.state;s.library='持久化的完整经历';let r=await call('/api/state','PUT',s);assert.equal(r.status,200);assert.equal((await call('/api/state','PUT',s)).status,409);assert.equal(JSON.parse(await fs.readFile(path.join(dir,'workspace.json'))).library,s.library);});
test('跨来源请求与缺少令牌写入被拒绝',async()=>{assert.equal((await call('/api/state','PUT',{}, {'X-Workbench-Token':''})).status,403);assert.equal((await call('/api/state','GET',undefined,{Origin:'https://attacker.test'})).status,403);});
test('备份与读取接口不暴露密钥',async()=>{for(const route of ['/api/state','/api/backup']){const r=await call(route);assert.ok(!r.bytes.toString().includes('test-secret'));}assert.equal((await call('/data/settings.local.json')).status,404);});
test('AI 完整请求与候选返回，不自动覆盖经历库',async()=>{const before=(await call('/api/state')).value.state.library;const r=await call('/api/ai','POST',{kind:'resume',jd:'产品实习生，要求流程设计'});assert.equal(r.status,200);assert.match(r.value.markdown,/教育背景/);assert.equal(received.model,'mock-model');assert.match(received.messages[1].content,/持久化的完整经历/);assert.equal((await call('/api/state')).value.state.library,before);});
test('Word 导出为真实 DOCX 压缩包',async()=>{const r=await call('/api/export/docx','POST',{markdown:'# 测试\n## 教育背景\n测试大学\n- **流程设计：**核对资料并完成交接。',layout:{font:'sans'}});assert.equal(r.status,200);assert.equal(r.bytes.subarray(0,2).toString(),'PK');await fs.writeFile(path.join(dir,'export.docx'),r.bytes);});
test('首次 GitHub 同步不带凭据，回传同步状态',async()=>{const r=await call('/api/sync/push','POST',{});assert.equal(r.status,200);assert.equal(r.value.sync.dirty,false);const cloud=Buffer.from(remoteFile.content,'base64').toString();assert.match(cloud,/持久化的完整经历/);assert.ok(!cloud.includes('test-secret'));});
test('云端变化时拒绝直接覆盖',async()=>{remoteFile.sha='other-device';assert.equal((await call('/api/sync/push','POST',{})).status,409);});
test('恢复云端先备份本机，且拒绝过期 SHA',async()=>{assert.equal((await call('/api/sync/pull','POST',{sha:'wrong'})).status,409);const r=await call('/api/sync/pull','POST',{sha:'other-device'});assert.equal(r.status,200);assert.ok((await fs.readdir(dir)).some(x=>x.startsWith('backup-')));});
test('公开仓库无法上传个人资料',async()=>{privateRepo=false;const r=await call('/api/sync/push','POST',{});assert.equal(r.status,400);assert.match(r.value.error,/公开/);privateRepo=true;});
test('错误备份不会损坏现有资料',async()=>{const before=(await call('/api/state')).value.state;assert.equal((await call('/api/import','POST',{schema:1})).status,400);assert.deepEqual((await call('/api/state')).value.state,before);});
test('版本历史及布局导入恢复完整',async()=>{const s=(await call('/api/state')).value.state;s.history.push({id:'h',kind:'library',targetId:'library',label:'测试版本',markdown:'旧正文',date:new Date().toISOString()});const r=await call('/api/import','POST',s);assert.equal(r.status,200);assert.equal(r.value.state.history.at(-1).markdown,'旧正文');});
