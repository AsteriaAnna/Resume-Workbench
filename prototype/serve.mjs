import http from 'node:http';
import { v2route } from './v2.mjs';

const port = Number(process.env.WORKBENCH_PORT || 4321);
const send = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const body = async (req) => { let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 1_000_000) throw Error('输入过长'); } return JSON.parse(raw || '{}'); };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, mode: process.env.DEEPSEEK_MOCK === '1' ? 'mock' : 'live', data: process.env.WORKBENCH_DATA_DIR || 'local-data' });
    if (url.pathname.startsWith('/api/v2/')) return v2route(req, res, url, { body, send });
    return send(res, 404, { error: '只有 /api/v2/* 与 /health（前端已移除）' });
  } catch (e) { send(res, e.code ? 400 : 500, { error: e.message, code: e.code || 'INTERNAL_ERROR' }); }
}).listen(port, '127.0.0.1', () => console.log(`Core API: http://127.0.0.1:${port}/health`));
