import {createStudio} from './studio-ui.js';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast._t); toast._t = setTimeout(() => (t.style.display = 'none'), 3600); };

async function getJson(url) { const r = await fetch(url); const j = await r.json(); if (!r.ok) throw Error(j.error || '操作失败'); return j; }
async function postJson(url, data) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); const j = await r.json(); if (!r.ok) throw Error(j.error || '操作失败'); return j; }

const S = {
  screen: 'wiki',
  nodes: [{ title: '我的经历', type: 0, text: '# 我的经历\n\n点击图谱中的节点阅读经历。' }, { title: '基础信息', type: 0, text: '# 基础信息\n\n在这里记录姓名、教育、联系方式等信息。' }],
  activeDoc: 1, docTabs: [1], wikiRevision: 0, relations: [], aiOpen: true, layout: '星图',
  resumes: [], opened: [], activeResume: null, folder: '全部简历', folders: ['我的简历', '实习申请'],
  side: 'gen', formatTab: '排版设置', graphMode: 'atlas', graphRotate: false, graphLabels: true, wikiChat: {}, wikiChatLoaded: new Set(),
};
const wikiDrafts=new Map();
const selectedExperience = () => { const n = S.nodes[S.activeDoc]; return n?.kind === 'experience' ? n.id : ['story', 'fragment'].includes(n?.kind) ? n.experience_id : null; };
const current = () => S.resumes.find((r) => r.id === S.activeResume);
const experienceTypeNames = { internship: '公司实习', work: '正式工作', project: '独立项目', campus: '校园经历', volunteer: '志愿活动', other: '其他／待确认' };
const sectionOf = { internship: '实习经历', work: '工作经历', project: '项目经历', campus: '项目经历', volunteer: '志愿经历', other: '其他经历' };

/* ---------------- 启动 ---------------- */
async function init() {
  bind();
  await Promise.all([loadWiki(), loadProfile(), loadResumes()]);
  render();
}
function bind() {
  document.addEventListener('click', onClick);
  document.addEventListener('input', (e) => {
    if (e.target.id === 'doc-editor') { const n = S.nodes[S.activeDoc]; if (n) {n.text = e.target.value;wikiDrafts.set(n.id||'profile',n.text);} }
    studio.input(e);
  });
  document.addEventListener('change', e=>{if(e.target.id==='node-jump'){selectDoc(e.target.value);return;}if(e.target.id==='experience-type')setType(e.target.value);else studio.input(e);});
}

/* ---------------- 路由/渲染 ---------------- */
function go(screen) { S.screen = screen; render(); }
function render() {
  if (S.screen !== 'wiki') stopGraph();
  $$('[data-go]').forEach((b) => b.classList.toggle('active', b.dataset.go === S.screen));
  renderTabs();
  if (S.screen === 'wiki') renderWiki();
  else if (S.screen === 'resumes') renderResumes();
  else if (S.screen === 'editor' && current()) renderEditor();
  else if (S.screen === 'settings') renderSettings();
  else if (S.screen === 'help') renderHelp();
}
function renderTabs() {
  $('#tabs').innerHTML = S.opened.map((id) => S.resumes.find((r) => r.id === id)).filter(Boolean)
    .map((r) => `<button data-open="${esc(r.id)}" class="${S.screen === 'editor' && S.activeResume === r.id ? 'active' : ''}">${esc(r.name)} <span data-close-tab="${esc(r.id)}">×</span></button>`).join('');
}

/* ---------------- 经历库 ---------------- */
async function loadWiki(openId) {
  try {
    const data = await getJson('/api/wiki');
    S.wikiRevision = data.index.revision || 0;
    S.relations = data.index.relations || [];
    if (!S.wikiRevision) { render(); return; }
    const activeId = S.nodes[S.activeDoc]?.id || null;
    const openIds = S.docTabs.map((i) => S.nodes[i]?.id).filter(Boolean);
    const basicText = S.nodes[1]?.text && S.nodes[1].text !== '# 基础信息\n\n在这里记录姓名、教育、联系方式等信息。' ? S.nodes[1].text : '# 基础信息';
    S.nodes = [{ title: '我的经历', type: 0, text: '# 我的经历\n\n点击图谱中的节点阅读经历。' }, { title: '基础信息', type: 0, text: basicText }];
    for (const n of data.index.nodes) {
      if (n.status !== 'active') continue;
      const doc = (data.documents || []).find((d) => d.id === n.id);
      S.nodes.push({ id: n.id, experience_id: n.experience_id, experience_type: n.experience_type, kind: n.kind, title: n.title, type: n.kind === 'topic' ? 0 : ['story', 'fragment'].includes(n.kind) ? 2 : 1, text: wikiDrafts.get(n.id) ?? doc?.markdown ?? n.summary });
    }
    const idx = (id) => S.nodes.findIndex((n) => n.id === id);
    S.docTabs = [1, ...openIds.map(idx).filter((i) => i > 1)];
    if (openId && idx(openId) > 1) { S.activeDoc = idx(openId); if (!S.docTabs.includes(S.activeDoc)) S.docTabs.push(S.activeDoc); }
    else if (activeId && idx(activeId) > 1) S.activeDoc = idx(activeId);else S.activeDoc=1;
    render();
  } catch (e) { toast('经历库读取失败：' + e.message); }
}
async function loadProfile() {
  try { const p = await getJson('/api/profile'); if (p.markdown) S.nodes[1].text = wikiDrafts.get('profile') ?? p.markdown; } catch {}
}
function renderWiki() {
  $('#app').innerHTML = `<div class="wiki">
    <section class="panel graph-panel"><div class="panel-head"><strong>知识图谱</strong><span>${S.wikiRevision ? `第 ${S.wikiRevision} 版 · ` : '示例 · '}${S.nodes.length} 个节点</span></div>
      <select id="node-jump" aria-label="查找节点"><option value="">查找节点…</option>${S.nodes.map((n,i)=>`<option value="${i}">${esc(n.title)}</option>`).join('')}</select><div class="graph" id="graph"><canvas id="graph-canvas"></canvas></div>
      <div class="legend"><span style="color:#d9b877">● 我的经历</span>　<span style="color:#6d91bd">● 经历</span>　<span style="color:#8be9b0">● 卡片</span>　<span style="color:#8b98a9">● 主题</span></div>
      ${graphFooterHtml()}
    </section>
    <section class="panel" id="doc-panel">${docPanelHtml()}</section>
    <section class="panel side"><div class="panel-head"><strong>✧ 经历助手</strong><span></span></div>
      <div class="side-body"><div id="wiki-msg" class="chat-messages">${wikiChatHtml()}</div>
      <textarea id="wiki-input" placeholder="讲述一段经历，或补充当前经历的细节…"></textarea>
      <button class="primary" data-action="wiki-send">发送</button>
      <button data-action="wiki-ask">让 AI 提几个补充问题</button></div>
    </section></div>`;
  drawGraph();
}
function docPanelHtml() {
  const n = S.nodes[S.activeDoc];
  return `<div class="doc-tabs">${S.docTabs.map((i) => `<div class="doc-tab ${i === S.activeDoc ? 'active' : ''}"><button data-node="${i}">${esc(S.nodes[i]?.title || '')}</button><button data-close-doc="${i}">×</button></div>`).join('')}<button data-action="new-node">＋</button><button data-action="save-doc">保存</button><button data-action="archive-node">归档</button><button data-action="restore-node">恢复</button></div>
    ${!n ? '<div class="empty">点击图谱节点打开，或新建经历。</div>' : `<div class="doc-title">${esc(n.title)}</div>${n.kind === 'experience' ? `<div class="doc-sub">经历类型 · <select id="experience-type">${Object.entries(experienceTypeNames).map(([k, v]) => `<option value="${k}" ${n.experience_type === k ? 'selected' : ''}>${v}</option>`).join('')}</select> · Markdown 可编辑</div>` : '<div class="doc-sub">Markdown 文档 · 可编辑</div>'}<textarea class="doc-editor" id="doc-editor">${esc(n.text)}</textarea><div class="foot">编辑后点“保存”；索引与正文同步更新</div>`}`;
}
function refreshWikiDoc() { const el = $('#doc-panel'); if (el) el.innerHTML = docPanelHtml(); }
function selectDoc(i) {
  S.activeDoc = Number(i);
  if (!S.docTabs.includes(S.activeDoc)) S.docTabs.push(S.activeDoc);
  refreshWikiDoc();
  if (S.screen === 'wiki') loadWikiChat(selectedExperience() || null);
  drawGraph();
}
function questionHtml(q) {
  const text = typeof q === 'string' ? q : (q?.question || '');
  const basis = typeof q === 'object' && q ? (q.basis || '') : '';
  return `<li>${esc(text)}${basis ? `<br><small>${esc(basis)}</small>` : ''}</li>`;
}
function wikiChatKey() { return selectedExperience() || 'none'; }
function wikiChatHtml() {
  const msgs = S.wikiChat[wikiChatKey()] || [];
  if (!msgs.length) return '<p>选择一段已有经历后，可以继续补充内容；新建经历请点上方 ＋。</p>';
  return msgs.map((m) => m.role === 'you' ? `<p class="you">${esc(m.text)}</p>` : `<p class="ai">${m.html}</p>`).join('');
}
function refreshWikiChat() {
  const el = $('#wiki-msg'); if (!el) return;
  el.innerHTML = wikiChatHtml();
  el.scrollTop = el.scrollHeight;
}
function addWikiChat(role, payload, key = wikiChatKey()) {
  (S.wikiChat[key] ||= []).push(role === 'you' ? { role, text: payload } : { role, html: payload });
  refreshWikiChat();
}
async function loadWikiChat(expId) {
  if (!expId || S.wikiChatLoaded.has(expId)) return;
  S.wikiChatLoaded.add(expId);
  try {
    const d = await getJson('/api/wiki/conversation?experience_id=' + encodeURIComponent(expId));
    const msgs = [];
    for (const rec of d.messages || []) {
      const u = typeof rec.user === 'string' ? rec.user.trim() : '';
      if (u) msgs.push({ role: 'you', text: (u.startsWith('#') || u.length > 120) ? `已提交一段经历材料（${u.length} 字）` : u });
      const a = rec.assistant || {};
      if (a.summary) msgs.push({ role: 'ai', html: esc(a.summary) });
      if (Array.isArray(a.questions) && a.questions.length) msgs.push({ role: 'ai', html: '建议继续补充：<ul>' + a.questions.map(questionHtml).join('') + '</ul>' });
    }
    if (msgs.length) S.wikiChat[expId] = msgs;
    if (selectedExperience() === expId) refreshWikiChat();
  } catch {}
}
function setType(value) { const id = selectedExperience(); if (!id) return; postJson('/api/wiki/type', { experience_id: id, experience_type: value }).then(() => { toast('经历类型已更新'); }).catch((e) => toast('类型更新失败：' + e.message)); }
async function saveDoc() {
  const n = S.nodes[S.activeDoc]; if (!n) return;
  try {
    if (S.activeDoc === 1) { await postJson('/api/profile', { markdown: n.text }); wikiDrafts.delete('profile');toast('基础信息已保存'); return; }
    if (n.kind === 'experience' || ['story', 'fragment'].includes(n.kind)) {
      if (n.kind === 'experience') await postJson('/api/wiki/edit', { experience_id: n.id, markdown: n.text });
      else await postJson('/api/wiki/edit', { experience_id: n.experience_id, node_id: n.id, markdown: n.text });
      wikiDrafts.delete(n.id);toast('已保存并生成新版本'); await loadWiki(n.id);
    } else toast('该节点由经历索引自动生成');
  } catch (e) { toast('保存失败：' + e.message); }
}
async function wikiSend() {
  const text = ($('#wiki-input')?.value || '').trim(); if (!text) return toast('先输入内容');
  if(S.wikiBusy)return toast('正在整理上一条补充');
  S.wikiBusy=true;
  const exp = selectedExperience(),chatKey=wikiChatKey();
  addWikiChat('you', text,chatKey);
  $('#wiki-input').value = '';
  try {
    if(S.activeDoc===1){const n=S.nodes[1];n.text=(n.text.includes('在这里记录姓名')?'# 基础信息':n.text)+'\n\n'+text;await postJson('/api/profile',{markdown:n.text});addWikiChat('ai','已保存到基础信息。');refreshWikiDoc();return;}
    if (exp) {
      const r = await postJson('/api/wiki/input', { experience_id: exp, message: text });
      const qs = (r.questions || []).map((q) => `<li>${esc(q.question || q)}</li>`).join('');
      addWikiChat('ai', `已整理进经历（第 ${r.revision} 版）。${qs ? '<br>建议继续补充：<ul>' + qs + '</ul>' : ''}`,chatKey);
      await loadWiki(exp);
    } else {
      const r = await postJson('/api/wiki/create', { message: text });
      addWikiChat('ai', `已新建经历并整理（第 ${r.revision} 版）。`);
      await loadWiki(r.experience_id);
      loadWikiChat(r.experience_id);
    }
  } catch (e) { if($('#wiki-input'))$('#wiki-input').value=text;addWikiChat('ai', '失败：' + esc(e.message)+'；输入已保留，可重试。',chatKey); } finally {S.wikiBusy=false;}
}
async function wikiAsk() {
  const exp = selectedExperience(); if (!exp) return toast('先在图谱里选一段经历');
  try {
    const r = await postJson('/api/wiki/questions', { experience_id: exp });
    const qs = (r.questions || []).map(questionHtml).join('');
    addWikiChat('ai', '可以补充：<ul>' + (qs || '<li>暂无明显缺口</li>') + '</ul>');
  } catch (e) { toast('提问失败：' + e.message); }
}
function newNode() { const name = prompt('新建经历：先写一句这段经历的概述'); if (!name) return; postJson('/api/wiki/create', { message: name }).then((r) => { toast('已新建经历'); return loadWiki(r.experience_id); }).catch((e) => toast('新建失败：' + e.message)); }

function graphFooterHtml() {
  const m = S.graphMode || 'atlas';
  return `<div class="graph-footer">
    <div class="view-switch">${[['atlas', '星图'], ['shell', '球面'], ['tier', '分层']].map(([k, label]) => `<button data-graph-mode="${k}" class="${m === k ? 'active' : ''}">${label}</button>`).join('')}</div>
    <div class="graph-tools">
      <button data-graph-zoom="out" aria-label="拉远">−</button><span class="zoom-label" id="zoom-label">100%</span><button data-graph-zoom="in" aria-label="拉近">＋</button>
      <button data-action="reset-graph">复位</button>
      <button data-graph-toggle="rotate" class="${S.graphRotate ? 'active' : ''}">自转</button>
      <button data-graph-toggle="labels" class="${S.graphLabels !== false ? 'active' : ''}">标签</button>
    </div>
  </div>`;
}

/* ---------------- 知识星图（暗色星空 + 辉光 + 星图/球面/分层） ---------------- */
const Graph = { raf: null, stop: null, canvas: null, pos: null, w: 0, h: 0, rot: { x: 0.35, y: 0.6 }, zoom: 1, api: null };
const GRAPH_MODE = () => S.graphMode || 'atlas';
function stopGraph() { if (Graph.raf != null) { cancelAnimationFrame(Graph.raf); Graph.raf = null; } if (Graph.stop) { Graph.stop(); Graph.stop = null; } }
const hashStr = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const seeded = (id, salt) => (hashStr(id + '#' + salt) % 1000) / 1000;

function withHub(data) {
  const hub = { id: '__hub__', label: '我的经历', type: 'hub' };
  const exps = data.nodes.filter((n) => n.type === 'experience');
  const links = [...(data.links || []), ...data.nodes.filter(n=>n.type==='experience'||n.type==='profile').map((n) => ({ source: '__hub__', target: n.id, kind: 'center' }))];
  return { ...data, nodes: [hub, ...data.nodes], links };
}

async function drawGraph() {
  const canvas = $('#graph-canvas'); if (!canvas) return;
  stopGraph();
  let data;
  try { data = await getJson('/api/studio/graph'); } catch { data = { nodes: [], links: [], stats: {} }; }
  if (!data.nodes.length) data = { nodes: S.nodes.slice(2).map((n) => ({ id: n.id || n.title, label: n.title, type: n.kind === 'experience' ? 'experience' : 'card', grade: 'A' })), links: [], stats: {} };
  data = withHub(data);
  if (canvas.clientWidth < 80 || canvas.clientHeight < 80) { setTimeout(drawGraph, 60); return; }
  const ctx = canvas.getContext('2d'); const dpr = window.devicePixelRatio || 1;
  const fit = () => { canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr; };
  fit();
  const onResize = () => {fit();W=canvas.clientWidth;H=canvas.clientHeight;};
  window.addEventListener('resize', onResize);

  let W = canvas.clientWidth || 600, H = canvas.clientHeight || 480;
  const mode = GRAPH_MODE();
  const radiusOf = (n) => n.type === 'hub' ? 15 : n.type === 'experience' ? 13 : n.type === 'card' ? (n.grade === 'S' ? 8 : n.grade === 'A' ? 6.5 : 5.5) : 3.2;
  const colorOf = (n) => n.type === 'hub' ? '#f6d79a' : n.type === 'experience' ? '#9ed0ff' : n.type === 'card' ? (n.grade === 'S' ? '#a6f3c7' : n.grade === 'A' ? '#ffd489' : '#ffa29b') : '#a9b6cc';

  const nodes = data.nodes.map((n) => ({ ...n, r: radiusOf(n), color: colorOf(n), x: 0, y: 0, vx: 0, vy: 0, fixed: false, sx: 0, sy: 0, sr: n.r, alpha: 1, z: 0 }));
  const map = new Map(nodes.map((n) => [n.id, n]));
  const links = (data.links || []).map((l) => ({ ...l, s: map.get(l.source), t: map.get(l.target) })).filter((l) => l.s && l.t);
  const cam = { x: 0, y: 0, k: Graph.zoom || 1 };
  let alpha = 1;
  let drag = null, rotDrag = null, pan = null, hover = null;

  if (mode === 'atlas') {
    const sizeOk = Graph.pos && Graph.w && Math.abs(Graph.w - W) < 8 && Math.abs(Graph.h - H) < 8;
    let cacheOk = sizeOk;
    if (cacheOk) { const xs = [...Graph.pos.values()].map((p) => p.x), ys = [...Graph.pos.values()].map((p) => p.y); if (Math.max(...xs) - Math.min(...xs) < W * 0.35 && Math.max(...ys) - Math.min(...ys) < H * 0.35) cacheOk = false; }
    for (const n of nodes) { const c = cacheOk ? Graph.pos.get(n.id) : null; n.x = c ? c.x : W / 2 + (seeded(n.id, 1) - 0.5) * W * 0.82; n.y = c ? c.y : H / 2 + (seeded(n.id, 2) - 0.5) * H * 0.78; }
    alpha = cacheOk ? 0.02 : 1;
  } else if (mode === 'shell') {
    nodes.forEach((n, i) => { const y = 1 - 2 * (i + 0.5) / nodes.length; const r = Math.sqrt(Math.max(0, 1 - y * y)); const th = 2.399963229728653 * i; n.bx = Math.cos(th) * r; n.by = y; n.bz = Math.sin(th) * r; });
    const hubN = nodes.find((n) => n.type === 'hub'); if (hubN) { hubN.bx = 0; hubN.by = 0; hubN.bz = 0; }
  } else {
    // 分层：中心 → 每段经历一列（经历 → 卡片 → 主题）
    const exps = nodes.filter((n) => n.type === 'experience');
    const hub = nodes.find((n) => n.type === 'hub');
    if (hub) { hub.x = W / 2; hub.y = H * 0.09; }
    const colW = W * 0.86, x0 = W * 0.07;
    exps.forEach((n, i) => { n.x = x0 + colW * (exps.length === 1 ? 0.5 : i / (exps.length - 1)); n.y = H * 0.26; });
    const cards = nodes.filter((n) => n.type === 'card');
    for (const exp of exps) {
      const list = cards.filter((c) => c.id.startsWith(exp.id + '_')).sort((a, b) => (a.grade === 'S' ? 0 : a.grade === 'A' ? 1 : 2) - (b.grade === 'S' ? 0 : b.grade === 'A' ? 1 : 2));
      list.forEach((c, j) => {
        const cols = Math.min(4, list.length);
        const row = Math.floor(j / cols), col = j % cols;
        c.x = exp.x + (col - (cols - 1) / 2) * 34 + (row % 2 ? 12 : 0);
        c.y = H * 0.46 + row * 46;
      });
    }
    const tags = nodes.filter((n) => n.type === 'node');
    tags.forEach((t, i) => {
      const link = links.find((l) => l.s === t || l.t === t);
      const owner = link ? (link.s === t ? link.t : link.s) : null;
      const anchor = owner ? (owner.type === 'card' ? owner : owner) : null;
      const baseX = anchor ? anchor.x : x0 + (i / Math.max(1, tags.length - 1)) * colW;
      t.x = Math.max(20, Math.min(W - 20, baseX + (seeded(t.id, 3) - 0.5) * 46));
      t.y = H * 0.78 + (i % 3) * 18;
    });
    const others = nodes.filter((n) => n.type !== 'hub' && n.type !== 'experience' && n.type !== 'card' && n.type !== 'node');
    others.forEach((n, i) => { n.x = x0 + colW * (i / Math.max(1, others.length - 1)); n.y = H * 0.68; });
  }

  const project = () => {
    if (mode === 'shell') {
      const R = Math.min(W, H) * 0.37 * cam.k;
      const cx = W / 2 + cam.x, cy = H / 2 + cam.y;
      const cyy = Math.cos(Graph.rot.y), syy = Math.sin(Graph.rot.y);
      const cxx = Math.cos(Graph.rot.x), sxx = Math.sin(Graph.rot.x);
      for (const n of nodes) {
        let x = n.bx * cyy - n.bz * syy, z = n.bx * syy + n.bz * cyy;
        let y = n.by * cxx - z * sxx; z = n.by * sxx + z * cxx;
        const f = 1 / (1 + z * 0.55);
        n.sx = cx + x * R * f; n.sy = cy + y * R * f; n.sr = n.r * f; n.z = z; n.alpha = 0.3 + 0.7 * ((1 - z) / 2);
      }
    } else {
      for (const n of nodes) { n.sx = W / 2 + cam.x + (n.x - W / 2) * cam.k; n.sy = H / 2 + cam.y + (n.y - H / 2) * cam.k; n.sr = n.r * cam.k; n.alpha = 1; n.z = 0; }
    }
  };
  const pick = (px, py) => { let best = null, bd = 14; for (const n of nodes) { const d = Math.hypot(n.sx - px, n.sy - py); if (d < Math.max(10, n.sr + 7) && d < bd) { bd = d; best = n; } } return best; };

  canvas.onpointerdown = (e) => {
    canvas.setPointerCapture(e.pointerId);
    const n = pick(e.offsetX, e.offsetY);
    if (mode === 'shell' && !n) { rotDrag = { x: e.offsetX, y: e.offsetY }; return; }
    if (n && mode !== 'shell') { drag = { n, dx: n.sx - e.offsetX, dy: n.sy - e.offsetY }; n.fixed = true; alpha = Math.max(alpha, 0.6); return; }
    pan = { x: e.offsetX, y: e.offsetY, cx: cam.x, cy: cam.y };
  };
  canvas.onpointermove = (e) => {
    if (rotDrag) { Graph.rot.y += (e.offsetX - rotDrag.x) * 0.006; Graph.rot.x = Math.max(-1.2, Math.min(1.2, Graph.rot.x + (e.offsetY - rotDrag.y) * 0.006)); rotDrag = { x: e.offsetX, y: e.offsetY }; return; }
    if (drag) { if (mode === 'atlas') { drag.n.x = (e.offsetX - drag.dx - W / 2 - cam.x) / cam.k + W / 2; drag.n.y = (e.offsetY - drag.dy - H / 2 - cam.y) / cam.k + H / 2; } return; }
    if (pan) { cam.x = pan.cx + (e.offsetX - pan.x); cam.y = pan.cy + (e.offsetY - pan.y); return; }
    hover = pick(e.offsetX, e.offsetY);
  };
  canvas.onpointerup = () => { if (drag) drag.n.fixed = false; drag = null; rotDrag = null; pan = null; alpha = Math.max(alpha, 0.25); };
  canvas.onpointerleave = () => { hover = null; };
  canvas.onclick = (e) => {
    const n = pick(e.offsetX, e.offsetY); if (!n) return;
    if (n.type === 'hub') { toast('中心节点：我的经历。点击任意经历可打开。'); return; }
    if(n.id==='profile_local'){selectDoc(1);return;}
    const i=S.nodes.findIndex(x=>x.id===n.id);if(i>=0)selectDoc(i);
  };
  canvas.onwheel = (e) => { e.preventDefault(); Graph.zoom = Math.min(3, Math.max(0.35, (Graph.zoom || 1) * (e.deltaY < 0 ? 1.12 : 0.9))); cam.k = Graph.zoom; };
  function findExp(id) { const l = links.find((x) => x.target === id || x.source === id); if (!l) return null; return map.get(l.source)?.type === 'experience' ? l.source : map.get(l.target)?.type === 'experience' ? l.target : null; }

  // 星空背景（固定种子，不闪烁）
  const stars = Array.from({ length: 130 }, (_, i) => ({ x: seeded('sx' + i, 1) * W, y: seeded('sy' + i, 2) * H, r: 0.4 + seeded('sr' + i, 3) * 1.1, a: 0.18 + seeded('sa' + i, 4) * 0.5 }));

  const draw = () => {
    project();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#07101e'); bg.addColorStop(0.55, '#0a1526'); bg.addColorStop(1, '#0d1a2c');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    for (const s of stars) { ctx.globalAlpha = s.a; ctx.fillStyle = '#dce8ff'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
    // 地图标题（参考站风格）
    ctx.fillStyle = 'rgba(226,236,248,.92)'; ctx.textAlign = 'left';
    ctx.font = '600 15px -apple-system,"Microsoft YaHei"';
    ctx.fillText('我的经历星系', 18, 30);
    ctx.fillStyle = 'rgba(160,180,205,.65)'; ctx.font = '11px -apple-system,"Microsoft YaHei"';
    const st = data.stats || {};
    ctx.fillText(`${st.experiences || 0} 段经历 · ${st.cards || 0} 张卡片 · ${st.tags || 0} 个主题`, 18, 48);
    const sorted = mode === 'shell' ? [...nodes].sort((a, b) => (b.z || 0) - (a.z || 0)) : nodes;
    for (const l of links) {
      const isCenter = l.kind === 'center' || l.s.type === 'hub' || l.t.type === 'hub';
      ctx.strokeStyle = isCenter ? 'rgba(214,180,110,.22)' : 'rgba(150,190,240,.14)';
      ctx.lineWidth = isCenter ? 1.2 : 0.7;
      ctx.beginPath(); ctx.moveTo(l.s.sx, l.s.sy); ctx.lineTo(l.t.sx, l.t.sy); ctx.stroke();
    }
    for (const n of sorted) {
      const isHub = n.type === 'hub';
      const R = Math.max(2.5, n.sr);
      const glow = ctx.createRadialGradient(n.sx, n.sy, 0, n.sx, n.sy, R * (isHub ? 5 : 3.4));
      glow.addColorStop(0, n.color); glow.addColorStop(0.25, n.color); glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = n.alpha * 0.35; ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(n.sx, n.sy, R * (isHub ? 5 : 3.4), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = n.alpha; ctx.fillStyle = n.color; ctx.beginPath(); ctx.arc(n.sx, n.sy, R, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = n.alpha * 0.9; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(n.sx - R * 0.25, n.sy - R * 0.25, Math.max(0.8, R * 0.28), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      const showLabel = S.graphLabels !== false && (isHub || n.type === 'experience' || n === hover || (n.type === 'card' && ((n.grade === 'S' && mode !== 'tier') || cam.k > 1.15)));
      if (showLabel) {
        const idx = nodes.indexOf(n);
        let ly = n.sy + n.sr + 11, fs = isHub ? 12 : n.type === 'experience' ? 11 : 9.5, maxLen = isHub ? 8 : 14;
        if (isHub) { ly = n.sy - n.sr - 9; }
        if (mode === 'tier' && n.type === 'experience') { ly = n.sy + n.sr + (idx % 2 ? 24 : -6); fs = 9.5; maxLen = 10; }
        ctx.font = `${fs}px -apple-system,"Microsoft YaHei"`;
        ctx.textAlign = 'center';
        ctx.fillStyle = isHub ? 'rgba(246,215,154,.95)' : 'rgba(220,232,246,.9)';
        ctx.shadowColor = 'rgba(0,0,0,.9)'; ctx.shadowBlur = 3;
        ctx.fillText(String(n.label).slice(0, maxLen), n.sx, ly);
        ctx.shadowBlur = 0;
      }
    }
    if (mode === 'shell') { ctx.fillStyle = 'rgba(150,175,205,.5)'; ctx.font = '10px -apple-system,"Microsoft YaHei"'; ctx.textAlign = 'right'; ctx.fillText('拖动旋转 · 滚轮缩放', W - 14, H - 12); }
    if (mode === 'tier') { ctx.fillStyle = 'rgba(150,175,205,.5)'; ctx.font = '10px -apple-system,"Microsoft YaHei"'; ctx.textAlign = 'left'; ctx.fillText('中心 → 经历分组 → 卡片 → 主题', 14, H - 12); }
  };

  const tick = () => {
    if (mode === 'atlas' && alpha > 0.015) {
      alpha *= 0.985; cam.k = Graph.zoom || 1;
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j]; const dx = a.x - b.x, dy = a.y - b.y; const d2 = dx * dx + dy * dy || 1;
        if (d2 > 40000) continue; const d = Math.sqrt(d2); const f = Math.min(2.2, 1400 / d2) * alpha;
        a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
      for (const l of links) { const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y; const d = Math.hypot(dx, dy) || 1; const f = (d - 105) * 0.0075 * alpha; l.s.vx += (dx / d) * f; l.s.vy += (dy / d) * f; l.t.vx -= (dx / d) * f; l.t.vy -= (dy / d) * f; }
      for (const n of nodes) {
        if (n.type === 'hub') { n.x += (W / 2 - n.x) * 0.12; n.y += (H / 2 - n.y) * 0.12; continue; }
        n.vx += (W / 2 - n.x) * 0.0004; n.vy += (H / 2 - n.y) * 0.0004;
        n.vx = Math.max(-4, Math.min(4, n.vx * 0.88)); n.vy = Math.max(-4, Math.min(4, n.vy * 0.88));
        if (!n.fixed) { n.x += n.vx; n.y += n.vy; }
        const pad = n.r + 4;
        if (n.x < pad) { n.x = pad; n.vx = Math.abs(n.vx) * 0.6; } if (n.x > W - pad) { n.x = W - pad; n.vx = -Math.abs(n.vx) * 0.6; }
        if (n.y < pad) { n.y = pad; n.vy = Math.abs(n.vy) * 0.6; } if (n.y > H - pad) { n.y = H - pad; n.vy = -Math.abs(n.vy) * 0.6; }
      }
      Graph.pos = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }])); Graph.w = W; Graph.h = H;
    }
    if (mode === 'shell' && S.graphRotate) Graph.rot.y += 0.0022;
    cam.k = Graph.zoom || 1;
    draw();
    Graph.raf = requestAnimationFrame(tick);
  };
  Graph.stop = () => { window.removeEventListener('resize', onResize); };
  Graph.canvas = canvas; Graph.mode = mode;
  Graph.api = {
    zoom(f) { Graph.zoom = Math.min(3, Math.max(0.35, (Graph.zoom || 1) * f)); cam.k = Graph.zoom; },
    reset() { Graph.zoom = 1; cam.x = 0; cam.y = 0; Graph.rot = { x: 0.35, y: 0.6 }; },
  };
  tick();
}


/* ---------------- 设置 ---------------- */
let syncInfo = null;
function renderSettings() {
  $('#app').innerHTML = `<div class="simple"><h2>模型连接</h2><button data-action="debug">提示词调试</button><p>密钥只保存在本机配置；页面只显示是否已配置，环境变量优先。</p>
    <label>接口地址<input id="model-base" placeholder="https://api.deepseek.com/chat/completions"></label>
    <label>模型名称<input id="model-name" placeholder="deepseek-flash"></label>
    <label>API 密钥（留空保持原值）<input id="model-key" type="password" autocomplete="off"></label>
    <button class="primary" data-action="save-model">保存模型设置</button><p id="model-status">正在读取…</p>
    <h2>资料同步</h2><p>资料先保存在本机；可用私有仓库做手动备份。</p>
    <label>GitHub 访问令牌<input id="sync-token" type="password" autocomplete="off" placeholder="粘贴可读写私有仓库的令牌"></label>
    <button data-action="sync-config">保存令牌</button><button data-action="sync-push">同步到私有仓库</button><button data-action="sync-pull">从私有仓库恢复（仅空库）</button><p id="sync-status">正在读取同步状态…</p></div>`;
  loadModelStatus(); loadSyncStatus();
}
async function loadModelStatus() { try { const c = await getJson('/api/model'); $('#model-base').value = c.baseUrl || ''; $('#model-name').value = c.model || ''; $('#model-status').textContent = `当前：${c.model} · ${c.configured ? '已配置密钥（' + c.key_source + '）' : '未配置密钥'}`; } catch (e) { $('#model-status').textContent = '读取失败：' + e.message; } }
async function saveModel() { try { const r = await postJson('/api/model', { baseUrl: $('#model-base').value.trim(), model: $('#model-name').value.trim(), apiKey: $('#model-key').value.trim() }); $('#model-status').textContent = `已保存：${r.model} · ${r.configured ? '已配置' : '未配置'}`; $('#model-key').value = ''; toast('模型设置已保存'); } catch (e) { toast('保存失败：' + e.message); } }
async function loadSyncStatus() { try { syncInfo = await getJson('/api/sync/settings'); const el = $('#sync-status'); if (el) el.textContent = syncInfo.configured ? `已配置令牌 · 仓库 ${syncInfo.repo || ''}` : '未配置令牌'; } catch (e) { const el = $('#sync-status'); if (el) el.textContent = '同步未就绪：' + e.message; } }
async function syncConfig() { try { await postJson('/api/sync/settings', { token: $('#sync-token').value.trim() }); toast('令牌已保存'); loadSyncStatus(); } catch (e) { toast('保存失败：' + e.message); } }
async function syncAction(kind) { try { const r = await postJson(`/api/sync/${kind}`, {}); toast(kind === 'push' ? `已同步${r.files != null ? '：' + r.files + ' 个文件' : ''}` : '已从私有仓库恢复'); } catch (e) { toast('同步失败：' + e.message); } }


function renderHelp(){ $('#app').innerHTML='<div class="simple"><h2>使用说明</h2><p>经历库：选择经历后补充原话，点击节点编辑 Markdown。基础信息独立保存。</p><p>简历：输入 JD → 调整大纲 → 生成并审阅 → 编辑排版 → 保存／导出。历史可恢复。</p><p>AI 评论可提出表达建议或补充事实，事实回答先写入经历库，再提出局部改稿。</p><button data-action="debug">提示词与运行调试</button></div>'; }
const studio=createStudio({S,$,esc,toast,getJson,postJson,render,loadWiki,loadProfile});
const loadResumes=()=>studio.loadResumes();
const renderResumes=()=>studio.renderResumes();
const renderEditor=()=>studio.renderEditor();
async function onClick(e){
 const t=e.target;
 const goEl=t.closest('[data-go]');if(goEl){await studio.flush().catch(()=>{});go(goEl.dataset.go);return;}
 const open=t.closest('[data-open]');if(open){await studio.flush().catch(()=>{});studio.openResume(open.dataset.open);return;}
 const tab=t.closest('[data-close-tab]');if(tab){await studio.flush().catch(()=>{});const id=tab.dataset.closeTab;S.opened=S.opened.filter(x=>x!==id);if(S.activeResume===id){S.activeResume=S.opened[0]||null;if(!S.activeResume)S.screen='resumes';}render();return;}
 if(t.dataset.folder){S.folder=t.dataset.folder;render();return;}
 if(t.dataset.node!==undefined){selectDoc(t.dataset.node);return;}
 if(t.dataset.closeDoc!==undefined){const i=+t.dataset.closeDoc;S.docTabs=S.docTabs.filter(x=>x!==i);if(S.activeDoc===i)S.activeDoc=S.docTabs[0]??1;render();return;}
 if(t.dataset.graphMode){S.graphMode=t.dataset.graphMode;Graph.pos=null;renderWiki();return;}
 if(t.dataset.graphZoom){Graph.api?.zoom(t.dataset.graphZoom==='in'?1.2:.84);return;}
 if(t.dataset.graphToggle){if(t.dataset.graphToggle==='rotate')S.graphRotate=!S.graphRotate;else S.graphLabels=!S.graphLabels;renderWiki();return;}
 const a=t.closest('[data-action]')?.dataset.action;
 const actions={'archive-node':async()=>{const n=S.nodes[S.activeDoc];if(!n?.id)return toast('基础信息不能归档');if(confirm('归档后不再用于生成，仍可恢复。')){await postJson('/api/wiki/archive',{node_id:n.id});await loadWiki();}},'restore-node':async()=>{const d=await getJson('/api/wiki');const a=d.index.nodes.filter(n=>n.status==='archived');const key=prompt(a.map((n,i)=>`${i+1}. ${n.title}`).join('\n')+'\n输入序号恢复');if(a[+key-1]){await postJson('/api/wiki/archive',{node_id:a[+key-1].id,restore:true});await loadWiki();}},'save-doc':saveDoc,'wiki-send':wikiSend,'wiki-ask':wikiAsk,'new-node':newNode,'save-model':saveModel,'sync-config':syncConfig,'sync-push':()=>syncAction('push'),'sync-pull':async()=>{await syncAction('pull');await loadWiki();await loadProfile();await loadResumes();},'reset-graph':()=>{Graph.pos=null;Graph.api?.reset();drawGraph();},debug:showDebug};
 if(actions[a]){await actions[a]();return;}await studio.onClick(e);
}
async function showDebug(){
 const d=await getJson('/api/prompts');const dlg=$('#dialog');
 dlg.innerHTML='<h2>提示词调试</h2><select id="prompt-task">'+d.items.map(p=>`<option>${esc(p.task)}</option>`).join('')+'</select><textarea id="prompt-value" style="height:350px"></textarea><p>保存后下一次任务使用新版本。运行输入输出可从简历的任务记录查看。</p><button id="prompt-save">保存</button><button id="prompt-close">关闭</button>';
 const pick=()=>{$('#prompt-value').value=d.items.find(p=>p.task===$('#prompt-task').value).prompt;};$('#prompt-task').onchange=pick;pick();$('#prompt-save').onclick=async()=>{await postJson('/api/prompts',{task:$('#prompt-task').value,prompt:$('#prompt-value').value});toast('提示词已保存');};$('#prompt-close').onclick=()=>dlg.close();dlg.showModal();
}
init();
