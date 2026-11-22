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
  v2: { cards: [], experiences: [], scan: null, sel: new Map(), strategy: { jd_focus: '', hook_level: 'L2', body_pattern: 'CAR' }, run: null, comments: [], active: null, busy: false, runId: null },
};
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
    if (e.target.id === 'doc-editor') { const n = S.nodes[S.activeDoc]; if (n) n.text = e.target.value; }
    if (e.target.id === 'jd-input') S._jd = e.target.value;
    if (e.target.dataset.style) {
      const r = current(); if (r) { r.styles = { ...(r.styles || {}), [e.target.dataset.style]: e.target.dataset.style === 'lineHeight' ? e.target.value : e.target.value + 'px' }; const p = $('#paper'); if (p) Object.assign(p.style, r.styles); }
    }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'experience-type') return setType(e.target.value);
    if (e.target.matches('[data-pick]')) {
      const map = S.v2.sel.get(e.target.dataset.exp) || new Map();
      map.set(e.target.dataset.card, e.target.checked);
      S.v2.sel.set(e.target.dataset.exp, map);
      const box = $('#scan-box'); if (box) { box.innerHTML = scanList(); }
      const expHead = e.target.closest('.exp-block')?.querySelector('.exp-head span'); if (expHead) { const r = S.v2.scan.experience_rankings.find((x) => x.exp_id === e.target.dataset.exp); if (r) expHead.textContent = `${experienceTypeNames[S.v2.experiences.find((x) => x.exp_id === r.exp_id)?.category] || ''} · #${r.priority_rank} ${r.decision || ''} · 已选 ${[...map.values()].filter(Boolean).length}/${S.v2.cards.filter((c) => c.exp_id === r.exp_id).length}`; }
    }
    if (['hook-level', 'body-pattern'].includes(e.target.id)) { S.v2.strategy[e.target.id === 'hook-level' ? 'hook_level' : 'body_pattern'] = e.target.value; }
  });
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
      S.nodes.push({ id: n.id, experience_id: n.experience_id, experience_type: n.experience_type, kind: n.kind, title: n.title, type: n.kind === 'topic' ? 0 : ['story', 'fragment'].includes(n.kind) ? 2 : 1, text: doc?.markdown || n.summary });
    }
    const idx = (id) => S.nodes.findIndex((n) => n.id === id);
    S.docTabs = [1, ...openIds.map(idx).filter((i) => i > 1)];
    if (openId && idx(openId) > 1) { S.activeDoc = idx(openId); if (!S.docTabs.includes(S.activeDoc)) S.docTabs.push(S.activeDoc); }
    else if (activeId && idx(activeId) > 1) S.activeDoc = idx(activeId);
    render();
  } catch (e) { toast('经历库读取失败：' + e.message); }
}
async function loadProfile() {
  try { const p = await getJson('/api/profile'); if (p.markdown) S.nodes[1].text = p.markdown; } catch {}
}
function renderWiki() {
  $('#app').innerHTML = `<div class="wiki">
    <section class="panel graph-panel"><div class="panel-head"><strong>知识图谱</strong><span>${S.wikiRevision ? `第 ${S.wikiRevision} 版 · ` : '示例 · '}${S.nodes.length} 个节点</span></div>
      <div class="graph" id="graph"><canvas id="graph-canvas"></canvas></div>
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
  return `<div class="doc-tabs">${S.docTabs.map((i) => `<div class="doc-tab ${i === S.activeDoc ? 'active' : ''}"><button data-node="${i}">${esc(S.nodes[i]?.title || '')}</button><button data-close-doc="${i}">×</button></div>`).join('')}<button data-action="new-node">＋</button><button data-action="save-doc">保存</button></div>
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
function addWikiChat(role, payload) {
  const key = wikiChatKey();
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
    if (S.activeDoc === 1) { await postJson('/api/profile', { markdown: n.text }); toast('基础信息已保存'); return; }
    if (n.kind === 'experience' || ['story', 'fragment'].includes(n.kind)) {
      if (n.kind === 'experience') await postJson('/api/wiki/edit', { experience_id: n.id, markdown: n.text });
      else await postJson('/api/wiki/edit', { experience_id: n.experience_id, node_id: n.id, markdown: n.text });
      toast('已保存并生成新版本'); await loadWiki(n.id);
    } else toast('该节点由经历索引自动生成');
  } catch (e) { toast('保存失败：' + e.message); }
}
async function wikiSend() {
  const text = ($('#wiki-input')?.value || '').trim(); if (!text) return toast('先输入内容');
  const exp = selectedExperience();
  addWikiChat('you', text);
  $('#wiki-input').value = '';
  try {
    if (exp) {
      const r = await postJson('/api/wiki/input', { experience_id: exp, message: text });
      const qs = (r.questions || []).map((q) => `<li>${esc(q.question || q)}</li>`).join('');
      addWikiChat('ai', `已整理进经历（第 ${r.revision} 版）。${qs ? '<br>建议继续补充：<ul>' + qs + '</ul>' : ''}`);
      await loadWiki(exp);
    } else {
      const r = await postJson('/api/wiki/create', { message: text });
      addWikiChat('ai', `已新建经历并整理（第 ${r.revision} 版）。`);
      await loadWiki(r.experience_id);
      loadWikiChat(r.experience_id);
    }
  } catch (e) { addWikiChat('ai', '失败：' + esc(e.message)); }
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
  const links = [...(data.links || []), ...exps.map((n) => ({ source: '__hub__', target: n.id, kind: 'center' }))];
  return { ...data, nodes: [hub, ...data.nodes], links };
}

async function drawGraph() {
  const canvas = $('#graph-canvas'); if (!canvas) return;
  stopGraph();
  let data;
  try { data = await getJson('/api/v2/graph'); } catch { data = { nodes: [], links: [], stats: {} }; }
  if (!data.nodes.length) data = { nodes: S.nodes.slice(2).map((n) => ({ id: n.id || n.title, label: n.title, type: n.kind === 'experience' ? 'experience' : 'card', grade: 'A' })), links: [], stats: {} };
  data = withHub(data);
  if (canvas.clientWidth < 80 || canvas.clientHeight < 80) { setTimeout(drawGraph, 60); return; }
  const ctx = canvas.getContext('2d'); const dpr = window.devicePixelRatio || 1;
  const fit = () => { canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr; };
  fit();
  const onResize = () => fit();
  window.addEventListener('resize', onResize);

  const W = canvas.clientWidth || 600, H = canvas.clientHeight || 480;
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
    const exp = n.type === 'experience' ? n.id : (n.exp_id || findExp(n.id));
    if (!exp) return;
    const i = S.nodes.findIndex((x) => x.id === exp);
    if (i >= 0) selectDoc(i);
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


/* ---------------- 简历列表 ---------------- */
async function loadResumes() { try { const d = await getJson('/api/resumes'); S.resumes = d.items || d || []; } catch { S.resumes = []; } }
function renderResumes() {
  $('#app').innerHTML = `<div class="library"><div class="heading"><div><h1>我的简历</h1><p>每一次机会，都有一份合适的表达。</p></div><div class="actions"><button data-action="new">＋ 新建简历</button></div></div>
    <div class="folders">${['全部简历', ...S.folders].map((x) => `<button data-folder="${esc(x)}" class="${S.folder === x ? 'active' : ''}">▱ ${esc(x)}</button>`).join('')}</div>
    <div class="cards">${S.resumes.filter((r) => S.folder === '全部简历' || r.folder === S.folder).map((r) => `<article class="card" data-open="${esc(r.id)}"><div class="mini"><div class="mini-sheet"><b>${esc(r.name)}</b>${Array.from({ length: 15 }, (_, i) => `<div class="mini-line ${i % 5 === 0 ? 'heading-line' : i % 3 === 0 ? 'short' : ''}"></div>`).join('')}</div></div><div class="card-meta"><strong>${esc(r.name)}</strong><small>${esc(r.folder || '我的简历')} · 本机资料</small></div></article>`).join('') || '<div class="empty">还没有简历，点右上角新建。</div>'}</div></div>`;
}
function newResume() { const r = { id: 'r_' + Date.now().toString(36), name: '未命名简历', folder: '我的简历', html: '', styles: {} }; S.resumes.unshift(r); S.activeResume = r.id; if (!S.opened.includes(r.id)) S.opened.push(r.id); S.screen = 'editor'; S.side = 'gen'; render(); setTimeout(() => $('#jd-input')?.focus(), 60); }
function openResume(id) { S.activeResume = id; if (!S.opened.includes(id)) S.opened.push(id); S.screen = 'editor'; S.side = 'gen'; render(); }
async function saveResume(showToast = true) { const r = current(); if (!r) return; const paper = $('#paper'); if (paper) r.html = paper.innerHTML; try { await postJson('/api/resumes', { items: S.resumes }); if (showToast) toast('已保存到本机资料库'); } catch (e) { toast('保存失败：' + e.message); } }

/* ---------------- 简历编辑器 ---------------- */
function renderEditor() {
  const r = current();
  $('#app').innerHTML = `<div class="toolbar"><button data-action="save">保存</button><button data-action="copy">创建副本</button><button data-action="rename">重命名</button><button data-action="back">返回列表</button><div class="middle"><button data-action="side-gen" class="${S.side === 'gen' ? 'active' : ''}">✧ 生成</button><button data-action="side-format" class="${S.side === 'format' ? 'active' : ''}">简历美化</button><button data-action="side-ai" class="${S.side === 'ai' ? 'active' : ''}">评论${S.v2.comments.length ? ` (${S.v2.comments.length})` : ''}</button></div></div>
    <div class="editor-space"><div class="paper-area"><article id="paper" class="paper" contenteditable="true" aria-label="简历正文">${r.html || '<div class="empty">在右侧输入 JD → 扫描 → 选卡 → 生成简历</div>'}</article><div id="bubble-layer" class="gxbubble-layer"></div></div>
    <section class="panel side" id="gen-side">${S.side === 'gen' ? genPanel() : S.side === 'format' ? formatPanel() : aiPanel()}</section></div>`;
  if (r.styles) Object.assign($('#paper').style, r.styles);
  if (S.v2.comments.length) renderBubbles();
}
function genPanel() {
  const st = S.v2.strategy; const scan = S.v2.scan;
  return `<div class="gen-tabs"><strong>✧ 生成流程</strong><span>${S.v2.busy ? '处理中…' : ''}</span></div>
    <div class="gen-body">
      <label class="field">目标 JD<textarea id="jd-input" placeholder="粘贴目标岗位的完整 JD…">${esc(S._jd || '')}</textarea></label>
      <div class="row"><button class="primary" data-action="scan">扫描并推荐</button><button data-action="gen" ${scan ? '' : 'disabled'}>生成简历</button></div>
      ${st.jd_focus ? `<div class="jd-focus">JD 核心：${esc(st.jd_focus)}</div>` : ''}
      <div class="grid2"><label class="field">Hook 层级<select id="hook-level"><option value="L1" ${st.hook_level === 'L1' ? 'selected' : ''}>L1 功能直白</option><option value="L2" ${st.hook_level === 'L2' ? 'selected' : ''}>L2 行业术语</option><option value="L3" ${st.hook_level === 'L3' ? 'selected' : ''}>L3 架构权衡</option></select></label><label class="field">正文骨架<select id="body-pattern"><option value="XYZ" ${st.body_pattern === 'XYZ' ? 'selected' : ''}>XYZ 成果</option><option value="CAR" ${st.body_pattern === 'CAR' ? 'selected' : ''}>CAR 痛点</option><option value="PAR" ${st.body_pattern === 'PAR' ? 'selected' : ''}>PAR 流程</option></select></label></div>
      <div id="scan-box">${scan ? scanList() : '<p class="hint">扫描会读取全部经历与卡片，自动排序、选卡并给出缺口。</p>'}</div>
    </div>`;
}
function scanList() {
  const rows = [...(S.v2.scan.experience_rankings || [])].sort((a, b) => (a.priority_rank || 99) - (b.priority_rank || 99));
  return rows.map((r) => {
    const exp = S.v2.experiences.find((e) => e.exp_id === r.exp_id);
    const cards = S.v2.cards.filter((c) => c.exp_id === r.exp_id).sort((a, b) => a.step_order - b.step_order);
    const map = S.v2.sel.get(r.exp_id) || new Map();
    const why = new Map((r.selected_cards || []).map((x) => [x.card_id, x.match_reason]));
    const picked = cards.filter((c) => map.get(c.card_id)).length;
    return `<div class="exp-block"><div class="exp-head"><b>${esc(exp?.title || r.exp_id)}</b><span class="tag">${esc(experienceTypeNames[exp?.category] || '')} · #${r.priority_rank} ${esc(r.decision || '')} · 已选 ${picked}/${cards.length}</span></div>
      ${cards.map((c) => `<label class="pick"><input type="checkbox" data-pick data-exp="${esc(r.exp_id)}" data-card="${esc(c.card_id)}" ${map.get(c.card_id) ? 'checked' : ''}><span><b>${esc(c.toc_title)}</b> <i class="g g-${c.quality_grade}">${c.quality_grade}</i>${why.get(c.card_id) ? `<small class="why">推荐：${esc(why.get(c.card_id))}</small>` : ''}</span></label>`).join('')}
      ${(r.gaps || []).length ? `<div class="gapnote">缺口：${esc(r.gaps.join('；'))}</div>` : ''}</div>`;
  }).join('');
}
function formatPanel() {
  return `<div class="gen-tabs"><strong>简历美化</strong><span></span></div><div class="side-body"><div class="switches">${['切换模板', '排版设置', '模块管理'].map((t) => `<button data-format="${t}" class="${S.formatTab === t ? 'active' : ''}">${esc(t)}</button>`).join('')}</div>
    ${S.formatTab === '排版设置' ? `<label class="field">字号 <input data-style="fontSize" type="range" min="11" max="18" value="${parseFloat(current()?.styles?.fontSize) || 13}"></label><label class="field">行间距 <input data-style="lineHeight" type="range" min="1.2" max="2.4" step=".1" value="${parseFloat(current()?.styles?.lineHeight) || 1.7}"></label><label class="field">页面留白 <input data-style="padding" type="range" min="20" max="70" value="${parseFloat(current()?.styles?.padding) || 48}"></label>` : S.formatTab === '切换模板' ? '<button class="suggestion" data-theme="classic">经典 · 清晰单栏</button><button class="suggestion" data-theme="blue">蓝调 · 标题强调</button>' : '<p>本份简历的内容模块</p><p class="hint">模块顺序由生成时的经历排序决定。</p>'}</div>`;
}
function aiPanel() {
  const c = S.v2.active;
  return `<div class="gen-tabs"><strong>评论 · 补卡</strong><span>${S.v2.comments.length ? `${S.v2.comments.filter((x) => !x.resolved).length} 条待处理` : ''}</span></div>
    <div class="side-body"><div class="comment-list">${S.v2.comments.length ? S.v2.comments.map((x) => `<div class="comment ${x.resolved ? 'resolved' : ''}" data-comment="${esc(x.comment_id)}"><b>${esc(x.question)}</b><small>${esc(x.reason || '')}${x.resolved ? ' · 已补卡' : ''}</small></div>`).join('') : '<p class="hint">生成简历后，这里会出现“值得补的方向”。</p>'}</div>
    ${c ? `<div class="ai-question">${esc(c.question)}</div><textarea id="gap-answer" placeholder="回答上面的问题（具体做法、数字、结果…）"></textarea><div class="row"><button class="primary" data-action="gap">补卡并重写这一段</button><button data-action="close-comment">关闭</button></div><p class="hint" id="gap-hint"></p>` : '<p class="hint">点正文旁的气泡，或上方评论，开始补卡。</p>'}
    <button data-action="gen-comments">生成/刷新评论</button></div>`;
}

/* ---------------- 生成动作 ---------------- */
async function doScan() {
  const jd = ($('#jd-input')?.value || '').trim(); if (jd.length < 20) return toast('请先粘贴完整 JD');
  S._jd = jd; S.v2.busy = true; render();
  try {
    const st = await getJson('/api/v2/state'); S.v2.cards = st.cards || []; S.v2.experiences = st.experiences || [];
    const run = await postJson('/api/v2/scan', { jd }); S.v2.scan = run.scan;
    const ja = run.scan.jd_analysis || {};
    S.v2.strategy = { jd_focus: ja.jd_focus || '', hook_level: ja.hook_level || 'L2', body_pattern: ja.body_pattern || 'CAR' };
    S.v2.sel = new Map();
    for (const r of run.scan.experience_rankings || []) {
      const m = new Map();
      for (const c of r.selected_cards || []) m.set(c.card_id, true);
      for (const card of S.v2.cards.filter((c) => c.exp_id === r.exp_id)) if (!m.has(card.card_id)) m.set(card.card_id, false);
      S.v2.sel.set(r.exp_id, m);
    }
    S.v2.runId = run.run_id; S.v2.comments = []; S.v2.busy = false; toast('扫描完成，可调整选卡'); render();
  } catch (e) { S.v2.busy = false; render(); toast('扫描失败：' + e.message); }
}
async function doGenerate() {
  if (!S.v2.runId) return toast('先扫描');
  const selections = [...S.v2.sel.entries()].map(([exp_id, m]) => ({ exp_id, card_ids: [...m.entries()].filter(([, v]) => v).map(([c]) => c), strategy: S.v2.strategy })).filter((x) => x.card_ids.length);
  if (!selections.length) return toast('至少选一张卡');
  S.v2.busy = true; render();
  try {
    const run = await postJson('/api/v2/compose', { run_id: S.v2.runId, selections }); S.v2.busy = false;
    await loadProfile();
    renderResumeIntoPaper(run);
    const r = current();
    if (r && /^未命名简历/.test(r.name)) { const pname = String(S.nodes[1]?.text || '').split('\n')[0].replace(/^#\s*/, '') || '我的'; const jdTitle = (S._jd || '').match(/^#\s*(.+)/)?.[1] || '定向简历'; r.name = pname + ' · ' + jdTitle.slice(0, 12); }
    toast('已生成，正在生成评论…'); await refreshComments(true); S.side = 'ai'; render(); renderBubbles();
  } catch (e) { S.v2.busy = false; render(); toast('生成失败：' + e.message); }
}
function renderResumeIntoPaper(run) {
  const order = { internship: 0, work: 1, project: 2, campus: 2, volunteer: 3, other: 4 };
  const experiences = [...(run.content?.experiences || [])].sort((a, b) => (order[a.category] ?? 9) - (order[b.category] ?? 9));
  const bySec = new Map(); for (const e of experiences) { const sec = sectionOf[e.category] || '其他经历'; if (!bySec.has(sec)) bySec.set(sec, []); bySec.get(sec).push(e); }
  const name = String(S.nodes[1]?.text || '').split('\n')[0].replace(/^#\s*/, '') || '候选人';
  const profile = String(S.nodes[1]?.text || '');
  const eduLines = profile.split('\n').slice(1).map((l) => l.trim()).filter((l) => l && !/^\*\*时间：/.test(l) && !/^时间：/.test(l));
  let html = `<h1>${esc(name)}</h1><h2>教育背景</h2>${eduLines.map((l) => /^[-*]\s/.test(l) ? `<ul><li>${inline(l.replace(/^[-*]\s+/, ''))}</li></ul>` : `<p>${inline(l)}</p>`).join('')}`;
  for (const [sec, list] of bySec) { html += `<h2>${esc(sec)}</h2>`; for (const e of list) { html += `<h3>${esc(e.title)}</h3>`; if (e.project_background) html += `<p class="gen-bg">${esc(e.project_background)}</p>`; html += '<ul>'; for (const b of e.bullets || []) { const over = [...String(b.content || '')].length > 80; html += `<li data-bullet="${esc(b.bullet_id)}"><span class="hook">【${esc(b.hook)}】</span>${esc(b.content)}${over ? `<span class="overbadge">超长</span>` : ''}<span class="chip" data-quote="${esc(b.raw_quote || '')}" title="点开看原话">${esc((e.cards || []).find((c) => c.card_id === b.card_id)?.quality_grade || '卡')}</span></li>`; } html += '</ul>'; } }
  const paper = $('#paper'); if (!paper) return; paper.innerHTML = html;
  paper.querySelectorAll('.chip').forEach((ch) => (ch.onclick = (ev) => { ev.stopPropagation(); toast('原话：' + ch.dataset.quote); }));
  const r = current(); if (r) r.html = paper.innerHTML;
}
async function refreshComments(silent = false) {
  if (!S.v2.runId) return toast('先生成简历');
  try { const run = await postJson('/api/v2/comments', { run_id: S.v2.runId }); S.v2.comments = run.comments || []; if (!silent) toast(`评论已刷新：${S.v2.comments.length} 条`); render(); renderBubbles(); }
  catch (e) { toast('评论生成失败：' + e.message); }
}
function renderBubbles() {
  const layer = $('#bubble-layer'), paper = $('#paper'); if (!layer || !paper) return; layer.innerHTML = '';
  const wrap = $('.paper-area'); if (!wrap) return; const items = [];
  for (const c of S.v2.comments) {
    const li = paper.querySelector(`[data-bullet="${c.bullet_id}"]`); if (!li) continue;
    const br = li.getBoundingClientRect(), pr = paper.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    const b = document.createElement('div'); b.className = 'gxbubble' + (c.resolved ? ' resolved' : '');
    b.innerHTML = `<b>💬 ${esc(c.question.slice(0, 32))}${c.question.length > 32 ? '…' : ''}</b><small>点我回答 · 补卡</small>`;
    b.style.top = `${br.top - wr.top - 4}px`; b.style.left = `${pr.right - wr.left + 8}px`;
    b.onclick = () => { S.v2.active = c; S.side = 'ai'; render(); };
    layer.appendChild(b); items.push({ el: b, top: br.top - wr.top - 4 });
  }
  items.sort((a, b) => a.top - b.top); let last = -1e9;
  for (const it of items) { const h = it.el.offsetHeight || 52; const top = Math.max(it.top, last + 6); it.el.style.top = top + 'px'; last = top + h; }
}
async function doGap() {
  const c = S.v2.active; if (!c) return toast('先点一条评论');
  const answer = ($('#gap-answer')?.value || '').trim(); if (answer.length < 4) return toast('请先回答具体做法或结果');
  try {
    const r = await postJson('/api/v2/gap', { run_id: S.v2.runId, comment_id: c.comment_id, answer });
    if (r.insufficient) { $('#gap-hint').textContent = '还差一点：' + (r.question || '再补充一个具体动作或结果'); return; }
    S.v2.run = r.run; S.v2.comments = r.run.comments || []; S.v2.active = null;
    renderResumeIntoPaper(r.run); render(); renderBubbles(); toast(`已补卡「${r.card.toc_title}」并重写该段`);
  } catch (e) { toast('补卡失败：' + e.message); }
}

/* ---------------- 设置 ---------------- */
let syncInfo = null;
function renderSettings() {
  $('#app').innerHTML = `<div class="simple"><h2>模型连接</h2><p>密钥只保存在本机配置；页面只显示是否已配置，环境变量优先。</p>
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

/* ---------------- 帮助 ---------------- */
function renderHelp() {
  $('#app').innerHTML = `<div class="simple"><h2>使用说明</h2>
    <p><b>经历库</b>：点击图谱节点查看/编辑经历；＋ 新建经历；右侧助手可补充内容，或让 AI 提几个补充问题。</p>
    <p><b>简历</b>：新建简历 → 粘贴 JD → 「扫描并推荐」→ 在右侧确认/调整选卡 → 「生成简历」→ 点正文旁气泡（或右侧评论）回答，自动补卡并重写该段。</p>
    <p><b>生成口径</b>：Hook 层级（L1 功能直白 / L2 行业术语 / L3 架构权衡）+ 正文骨架（XYZ 成果 / CAR 痛点 / PAR 流程），可在生成前调整。</p>
    <p><b>数据</b>：经历、简历、模型配置均保存在本机；设置页可配置模型与私有仓库同步。</p>
    <button data-go="wiki">返回经历库</button></div>`;
}

/* ---------------- 事件 ---------------- */
function onClick(e) {
  const goEl = e.target.closest('[data-go]'); if (goEl) { go(goEl.dataset.go); return; }
  const tab = e.target.closest('[data-close-tab]'); if (tab) { const id = tab.dataset.closeTab; S.opened = S.opened.filter((x) => x !== id); if (S.activeResume === id) { S.activeResume = S.opened[0] || null; if (!S.activeResume) S.screen = 'resumes'; } render(); return; }
  const open = e.target.closest('[data-open]'); if (open) { openResume(open.dataset.open); return; }
  const folder = e.target.closest('[data-folder]'); if (folder) { S.folder = folder.dataset.folder; render(); return; }
  const node = e.target.closest('[data-node]'); if (node) { selectDoc(node.dataset.node); return; }
  const closeDoc = e.target.closest('[data-close-doc]'); if (closeDoc) { const i = Number(closeDoc.dataset.closeDoc); S.docTabs = S.docTabs.filter((x) => x !== i); if (S.activeDoc === i) S.activeDoc = S.docTabs[0] ?? 1; render(); return; }
  const cm = e.target.closest('[data-comment]'); if (cm) { S.v2.active = S.v2.comments.find((x) => x.comment_id === cm.dataset.comment); S.side = 'ai'; render(); return; }
  const gz = e.target.closest('[data-graph-zoom]');
  if (gz) { Graph.api?.zoom(gz.dataset.graphZoom === 'in' ? 1.2 : 0.84); const zl = document.getElementById('zoom-label'); if (zl) zl.textContent = Math.round((Graph.zoom || 1) * 100) + '%'; return; }
  const gt = e.target.closest('[data-graph-toggle]');
  if (gt) { if (gt.dataset.graphToggle === 'rotate') S.graphRotate = !S.graphRotate; else S.graphLabels = !(S.graphLabels !== false); renderWiki(); return; }
  const gm = e.target.closest('[data-graph-mode]');
  if (gm) { S.graphMode = gm.dataset.graphMode; Graph.pos = null; renderWiki(); return; }
  const fmt = e.target.closest('[data-format]'); if (fmt) { S.formatTab = fmt.dataset.format; render(); return; }
  const act = e.target.closest('[data-action]'); if (!act) return;
  const a = act.dataset.action;
  const map = {
    new: () => newResume(), save: () => saveResume(), back: () => { S.screen = 'resumes'; render(); },
    copy: () => { const r = current(); const c = { ...r, id: 'r_' + Date.now().toString(36), name: r.name + ' 副本' }; S.resumes.unshift(c); openResume(c.id); },
    rename: () => { const r = current(); const name = prompt('简历名称', r.name); if (!name) return; r.name = name.trim().slice(0, 40); render(); },
    'save-doc': () => saveDoc(), 'wiki-send': () => wikiSend(), 'wiki-ask': () => wikiAsk(), 'new-node': () => newNode(),
    'side-gen': () => { S.side = 'gen'; render(); }, 'side-format': () => { S.side = 'format'; render(); }, 'side-ai': () => { S.side = 'ai'; render(); renderBubbles(); },
    scan: () => doScan(), gen: () => doGenerate(), 'gen-comments': () => refreshComments(),
    gap: () => doGap(), 'close-comment': () => { S.v2.active = null; render(); },
    'save-model': () => saveModel(), 'sync-config': () => syncConfig(), 'sync-push': () => syncAction('push'), 'sync-pull': () => syncAction('pull'),
    'reset-graph': () => { Graph.pos = null; Graph.api?.reset(); drawGraph(); },
  };
  if (map[a]) { e.preventDefault(); map[a](); }
}

init();
