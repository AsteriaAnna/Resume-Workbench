import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './types.mjs';

async function loadConfig() {
  let local = {};
  try { local = JSON.parse(await fs.readFile(path.join(import.meta.dirname, '..', '.local-ai.json'), 'utf8')); } catch {}
  return {
    key: process.env.DEEPSEEK_API_KEY || local.apiKey || '',
    base: process.env.DEEPSEEK_BASE_URL || local.baseUrl || 'https://api.deepseek.com/chat/completions',
    model: process.env.DEEPSEEK_MODEL || local.model || 'deepseek-flash',
  };
}

export async function createLLM({ mock = false, mockCall = null, maxRetries = 1, timeoutMs = 240000 } = {}) {
  const cfg = await loadConfig();
  const stats = { calls: 0, input_chars: 0, output_chars: 0, by_tag: {} };
  async function callJSON(system, user, { tag = 'llm', maxTokens = 5000, temperature = 0.2 } = {}) {
    stats.calls++;
    stats.input_chars += String(system).length + String(user).length;
    stats.by_tag[tag] = (stats.by_tag[tag] || 0) + 1;
    if (mock) {
      if (typeof mockCall !== 'function') throw new AppError('MOCK_MISSING', 'mock 模式缺少 mockCall');
      const out = await mockCall({ tag, system, user });
      stats.output_chars += JSON.stringify(out).length;
      return { json: out, usage: {}, tag };
    }
    if (!cfg.key) throw new AppError('NO_KEY', '未配置 DeepSeek 密钥（.local-ai.json 或 DEEPSEEK_API_KEY）');
    let last;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(cfg.base, {
          method: 'POST', signal: ctrl.signal,
          headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: cfg.model, temperature, reasoning_effort: 'none',
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
            response_format: { type: 'json_object' }, max_tokens: maxTokens,
          }),
        });
        if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
        const data = await res.json();
        const raw = data.choices?.[0]?.message?.content || '{}';
        stats.output_chars += raw.length;
        let json;
        try { json = JSON.parse(raw); }
        catch { throw new AppError('LLM_JSON', `模型返回非 JSON（${tag}）`); }
        return { json, usage: data.usage || {}, tag };
      } catch (e) {
        last = e;
      } finally { clearTimeout(timer); }
    }
    throw last instanceof Error ? last : new AppError('LLM_FAILED', String(last));
  }
  return { callJSON, stats, config: cfg, mock };
}
