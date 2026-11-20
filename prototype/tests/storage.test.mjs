import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const folder=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-storage-'));
process.env.WORKBENCH_DATA_DIR=folder;
const {resumes,saveResumes,syncSettings,pushData}=await import('../storage.mjs');
try{
  assert.deepEqual(await resumes(),[]);
  const draft=[{id:1,name:'产品实习生',html:'<h1>测试</h1>',folder:'我的简历'}];
  await saveResumes(draft);
  assert.deepEqual(await resumes(),draft);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(folder,'resumes.json'),'utf8')),draft);
  const settings=await syncSettings();
  assert.equal(settings.repo,'AsteriaAnna/esume-Workbench-data');
  assert.equal(settings.configured,false);
  await assert.rejects(pushData(),/令牌/);
  console.log('Storage test passed');
}finally{await fs.rm(folder,{recursive:true,force:true})}

