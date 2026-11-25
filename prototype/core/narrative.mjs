import { assert, norm } from './types.mjs';

const FRONT_KEYS = ['experience_id', 'type', 'name', 'role', 'time'];

export function parseNarrative(text, fallback = {}) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const exp = { experience_id: '', type: '', name: '', role: '', time: '', ...fallback };
  let i = 0;
  if (lines[0]?.trim() === '---') {
    i = 1;
    for (; i < lines.length; i++) {
      if (lines[i].trim() === '---') { i++; break; }
      const at = lines[i].indexOf(':');
      if (at > 0) exp[lines[i].slice(0, at).trim()] = lines[i].slice(at + 1).trim();
    }
  }
  const body = lines.slice(i).join('\n').replace(/^##\s*经历正文\s*$/m, '').trim();
  const chunks = body.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  const paragraphs = chunks.map((t, idx) => ({ paragraph_id: `p_${idx + 1}`, text: t }));
  return { experience: exp, paragraphs };
}

export function serializeNarrative(model) {
  const e = model.experience || {};
  const out = ['---'];
  for (const k of FRONT_KEYS) if (e[k] !== undefined && e[k] !== '') out.push(`${k}: ${e[k]}`);
  out.push('---', '', '## 经历正文', '');
  for (const p of model.paragraphs || []) {
    const t = String(p.text ?? '').trim();
    if (t) out.push(t, '');
  }
  return out.join('\n').trimEnd() + '\n';
}

export function narrativeText(model) {
  return (model.paragraphs || []).map((p) => p.text).join('\n\n');
}

function quoteExists(raw, quote) {
  const q = norm(quote);
  if (q.length < 2) return false;
  return norm(raw).includes(q);
}

export function applyPatch(model, operations, raw) {
  const paragraphs = (model.paragraphs || []).map((p) => ({ ...p }));
  const applied = [];
  const skipped = [];
  for (const op of operations || []) {
    const text = String(op.text ?? '').trim();
    if (!text) { skipped.push({ op, reason: '空段落' }); continue; }
    if (Array.isArray(op.source_quotes) && op.source_quotes.length) {
      const ok = op.source_quotes.every((q) => quoteExists(raw, q));
      if (!ok) { skipped.push({ op, reason: 'source_quotes 不在本次 raw 中' }); continue; }
    }
    const idx = paragraphs.findIndex((p) => p.paragraph_id === op.target_paragraph_id);
    const at = idx >= 0 ? idx : paragraphs.length - 1;
    if (op.op === 'append_after' || op.op === 'insert_after' || op.op === 'append') paragraphs.splice(at + 1, 0, { text });
    else if (op.op === 'insert_before') paragraphs.splice(Math.max(0, at), 0, { text });
    else if (op.op === 'replace_span' && idx >= 0) paragraphs[idx] = { text };
    else if (op.op === 'merge_into' && idx >= 0) paragraphs[idx] = { text: `${paragraphs[idx].text}\n${text}` };
    else paragraphs.push({ text });
    applied.push({ op, reason: op.reason || '' });
  }
  return {
    model: { experience: model.experience, paragraphs: paragraphs.map((p, i) => ({ paragraph_id: `p_${i + 1}`, text: p.text })) },
    applied, skipped,
  };
}
