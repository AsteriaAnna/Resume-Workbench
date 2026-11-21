import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root=await fs.mkdtemp(path.join(os.tmpdir(),'resume-debug-test-'));
process.env.WORKBENCH_DATA_DIR=root;
const {flow,traced,traces,traceFor,runs,runFor}=await import('../debug.mjs');
try{
  const graph=flow();
  const ids=new Set(graph.stages.map(s=>s.id));
  assert.equal(ids.size,graph.stages.length);
  assert.ok(graph.links.every(link=>ids.has(link.from)&&ids.has(link.to)));
  assert.ok(graph.links.some(link=>link.from==='experience_search'&&link.to==='evaluate'));
  assert.ok(graph.stages.some(stage=>stage.id==='assist_review'));
  const result=await traced('test',{},async()=>({id:'run_example',status:'outline'}));
  assert.equal(result.id,'run_example');
  const list=await traces();
  assert.equal(list.length,1);
  assert.equal((await traceFor(list[0].id)).run_id,'run_example');
  await fs.mkdir(path.join(root,'runs','run_example'),{recursive:true});
  await fs.writeFile(path.join(root,'runs','run_example','result.json'),JSON.stringify({id:'run_example',jd:'测试 JD',status:'outline',mode:'index_fallback'}));
  assert.equal((await runs())[0].id,'run_example');
  assert.equal((await runFor('run_example')).jd,'测试 JD');
  await assert.rejects(()=>runFor('../outside'),/无效运行编号/);
  console.log('Debug graph, traces and runs passed');
}finally{await fs.rm(root,{recursive:true,force:true})}

