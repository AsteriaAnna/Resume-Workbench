import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { initialState, cleanState, fingerprint, aiMessages, parseAI } from './core.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.WORKBENCH_DATA || path.join(root, 'data');
const port = Number(process.env.PORT || 4317);
const csrf = randomUUID();
await fs.mkdir(dataDir, { recursive: true });
const read = async (name, fallback) => { try { return JSON.parse(await fs.readFile(path.join(dataDir, name), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } };
async function write(name, value) { const target = path.join(dataDir, name), temp = target + '.' + randomUUID() + '.tmp'; await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 }); await fs.rename(temp, target); }
let state = await read('workspace.json', null);
if (!state) { let seed = ''; try { seed = await fs.readFile(path.join(dataDir, 'seed-library.md'), 'utf8'); } catch {} state = initialState(seed); await write('workspace.json', state); }
state = cleanState(state);
let settings = await read('settings.local.json', { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: '', repo: '', token: '' });
let sync = await read('sync.local.json', { repo: '', sha: null, hash: null });
let serial = Promise.resolve();
function locked(fn) { const result = serial.then(fn); serial = result.catch(() => {}); return result; }
function safeSettings() { return { baseUrl: settings.baseUrl, model: settings.model, repo: settings.repo, hasApiKey: Boolean(settings.apiKey), hasToken: Boolean(settings.token) }; }
function info() { return { repo: settings.repo, connected: Boolean(settings.token && settings.repo), dirty: sync.hash !== fingerprint(state), lastSync: sync.date || null }; }
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
async function backup(reason) { const name = `backup-${Date.now()}-${randomUUID().slice(0,8)}.json`; await write(name, state); return name; }
async function replace(next) { next.revision = state.revision + 1; await write('workspace.json', next); state = next; return state; }
async function body(req) { let result = ''; for await (const chunk of req) { result += chunk; if (Buffer.byteLength(result) > 12 * 1024 * 1024) fail('资料超过 12 MB，请拆分后导入。', 413); } try { return JSON.parse(result || '{}'); } catch { fail('请求格式有误。'); } }
function json(res, value, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
async function github(endpoint, options = {}) {
  if (!settings.token || !/^[\w.-]+\/[\w.-]+$/.test(settings.repo)) fail('先填写私有仓库（用户名/仓库名）和 GitHub Token。');
  const r = await fetch(`https://api.github.com/repos/${settings.repo}${endpoint}`, { ...options, headers: { Authorization: `Bearer ${settings.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(options.headers || {}) }, signal: AbortSignal.timeout(30000) });
  if (r.status === 404 && options.allowMissing) return null;
  const value = await r.json();
  if (!r.ok) fail(`GitHub ${r.status}：${r.status === 401 ? 'Token 无效' : r.status === 404 ? '仓库不存在或 Token 没有权限' : r.status === 409 ? '云端已变化，请先下载查看' : '请求失败，请检查权限及网络'}`, r.status === 409 ? 409 : 400);
  return value;
}
async function remote() {
  const repo = await github('');
  if (!repo.private) fail('经历包含个人资料，请选择私有仓库。当前仓库是公开的。');
  return github('/contents/resume-workbench/workspace.json', { allowMissing: true });
}
async function exportDocx(markdown, layout) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON || 'python', [path.join(root, 'export_docx.py')], { windowsHide: true });
    const out = []; let err = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('Word 导出超时')); }, 30000);
    child.stdout.on('data', c => out.push(c)); child.stderr.on('data', c => err += c);
    child.on('error', () => { clearTimeout(timer); reject(new Error('Word 导出需要 Python 和 python-docx，请查看使用说明。')); });
    child.on('close', code => { clearTimeout(timer); if (code) reject(new Error('Word 导出失败，请确认已安装 python-docx。')); else resolve(Buffer.concat(out)); });
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify({ markdown, layout }));
  });
}
const server = http.createServer(async (req, res) => {
  try {
    const origin = `http://${req.headers.host}`;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) fail('不允许的访问地址', 403);
    const url = new URL(req.url, origin);
    if (req.headers.origin && req.headers.origin !== origin) fail('请在本地工作台内操作。', 403);
    if (req.method !== 'GET' && req.headers['x-workbench-token'] !== csrf) fail('页面已过期，请刷新。', 403);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (url.pathname === '/api/state' && req.method === 'GET') return json(res, { state, settings: safeSettings(), sync: info(), csrf });
    if (url.pathname === '/api/state' && req.method === 'PUT') {
      const b = await body(req);
      return await locked(async () => { if (b.revision !== state.revision) fail('另一个窗口修改了资料。请导出当前编辑内容后刷新，避免覆盖。', 409); const next = cleanState(b); return json(res, { state: await replace(next), sync: info() }); });
    }
    if (url.pathname === '/api/settings' && req.method === 'POST') {
      const b = await body(req);
      return await locked(async () => {
        const endpoint = new URL(b.baseUrl || settings.baseUrl);
        if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) fail('API 地址应为 http(s) 地址，不带参数和账号。');
        if (endpoint.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) fail('远程模型接口请使用 HTTPS。本地模型可使用 HTTP。');
        const repo = String(b.repo || '').trim(); if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) fail('仓库格式：用户名/仓库名。');
        settings = { baseUrl: endpoint.href.replace(/\/$/, ''), model: String(b.model || '').trim(), repo, apiKey: b.clearApiKey ? '' : b.apiKey || settings.apiKey, token: b.clearToken ? '' : b.token || settings.token };
        await write('settings.local.json', settings);
        if (sync.repo !== repo) { sync = { repo, sha: null, hash: null }; await write('sync.local.json', sync); }
        json(res, { settings: safeSettings(), sync: info() });
      });
    }
    if (url.pathname === '/api/ai' && req.method === 'POST') {
      const b = await body(req);
      if (!settings.model) fail('先到设置中填写模型名称和 API 地址。');
      if (!['library','resume','rewrite'].includes(b.kind)) fail('未知写作操作');
      if (b.kind !== 'library' && !b.jd?.trim()) fail('请先粘贴目标 JD。');
      if (!state.library.trim() && !state.stories.some(x => x.text.trim())) fail('请先添加原始故事或导入经历库。');
      const response = await fetch(`${settings.baseUrl}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}) }, body: JSON.stringify({ model: settings.model, messages: aiMessages(state, b), temperature: 0.4 }), signal: AbortSignal.timeout(180000) });
      if (!response.ok) fail(`模型接口返回 ${response.status}，请检查 API 地址、密钥、模型权限及额度。`, 400);
      const value = await response.json(); const content = value.choices?.[0]?.message?.content;
      if (typeof content !== 'string') fail('模型未返回文字，请使用支持 Chat Completions 的模型。');
      return json(res, parseAI(content));
    }
    if (url.pathname === '/api/backup' && req.method === 'GET') return json(res, state);
    if (url.pathname === '/api/import' && req.method === 'POST') {
      const b = await body(req); const next = cleanState(b);
      return await locked(async () => { await backup('import'); json(res, { state: await replace(next), sync: info() }); });
    }
    if (url.pathname === '/api/sync/push' && req.method === 'POST') return await locked(async () => {
      const file = await remote();
      if ((file?.sha || null) !== sync.sha) fail('云端已有其他版本。请先下载云端备份查看，或将云端版本恢复到本机，再同步。', 409);
      const content = Buffer.from(JSON.stringify(state, null, 2)).toString('base64');
      if (Buffer.byteLength(content, 'base64') > 950000) fail('备份超过当前同步上限 950 KB，请先下载完整备份并整理历史版本。');
      const result = await github('/contents/resume-workbench/workspace.json', { method: 'PUT', body: JSON.stringify({ message: `更新简历工作台 ${new Date().toISOString()}`, content, ...(file?.sha ? { sha: file.sha } : {}) }) });
      sync = { repo: settings.repo, sha: result.content.sha, hash: fingerprint(state), date: new Date().toISOString() }; await write('sync.local.json', sync); json(res, { sync: info() });
    });
    if (url.pathname === '/api/sync/remote' && req.method === 'GET') {
      const file = await remote(); if (!file) fail('云端尚无工作台备份。');
      return json(res, { state: cleanState(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'))), sha: file.sha });
    }
    if (url.pathname === '/api/sync/pull' && req.method === 'POST') {
      const b = await body(req);
      return await locked(async () => {
        const file = await remote(); if (!file) fail('云端尚无备份。');
        if (file.sha !== b.sha) fail('云端版本再次变化，请重新查看。', 409);
        const next = cleanState(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')));
        await backup('pull'); await replace(next);
        sync = { repo: settings.repo, sha: file.sha, hash: fingerprint(state), date: new Date().toISOString() }; await write('sync.local.json', sync);
        json(res, { state, sync: info() });
      });
    }
    if (url.pathname === '/api/export/docx' && req.method === 'POST') {
      const b = await body(req); const content = await exportDocx(String(b.markdown || ''), b.layout || {});
      res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }); return res.end(content);
    }
    const staticFiles = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
    const file = staticFiles[url.pathname];
    if (req.method === 'GET' && file) {
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(await fs.readFile(path.join(root, 'public', file)));
    }
    fail('未找到页面', 404);
  } catch (e) { if (!res.headersSent) json(res, { error: e.name === 'TimeoutError' ? '连接超时，原稿未改动，请稍后重试。' : e.message || '操作失败' }, e.status || 500); else res.end(); }
});
server.listen(port, '127.0.0.1', () => console.log(`Storyfolio 已启动：http://127.0.0.1:${port}\n数据目录：${dataDir}`));
