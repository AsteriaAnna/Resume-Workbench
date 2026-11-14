const $ = s => document.querySelector(s);
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = x => x ? new Date(x).toLocaleString('zh-CN', { hour12: false }) : '尚未同步';
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
let state, settings, sync, csrf, page = 'stories', selectedStory, selectedResume, dirty = false, saveTimer, saving, saveError = false, editSequence = 0, candidate, remoteData, filePurpose, generating = false;
const dialog = $('#dialog');
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').style.display = 'none', 5500); }
async function api(url, method = 'GET', data, binary = false) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Workbench-Token': csrf || '' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error || '操作失败'); }
  return binary ? r.blob() : r.json();
}
function dirtyMark() { dirty = true; editSequence++; saveError = false; $('#save-status').textContent = '正在保存…'; clearTimeout(saveTimer); saveTimer = setTimeout(() => flush().catch(showError), 850); }
function showError(e) { toast(e.message); }
async function flush() {
  clearTimeout(saveTimer);
  if (saving) await saving;
  if (!dirty) return;
  saving = (async () => {
    while (dirty) {
      const sequence = editSequence, copy = structuredClone(state);
      try { const r = await api('/api/state', 'PUT', copy); state.revision = r.state.revision; sync = r.sync; dirty = sequence !== editSequence; $('#save-status').textContent = dirty ? '正在保存…' : '✓ 已保存到本机'; }
      catch (e) { saveError = true; $('#save-status').textContent = '保存失败 · 请下载备份'; throw e; }
    }
  })();
  try { await saving; } finally { saving = null; }
}
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
function snapshot(kind, targetId, markdown, label, document) {
  state.history.unshift({ id: id(), kind, targetId, markdown, label, document: document ? structuredClone(document) : undefined, date: now() });
}
const doc = () => state.resumes.find(x => x.id === selectedResume);
const story = () => state.stories.find(x => x.id === selectedStory);
function autoSnapshot(kind, targetId, markdown, document) {
  const previous = state.history.find(x => x.kind === kind && x.targetId === targetId);
  if (!previous || Date.now() - Date.parse(previous.date) > 120000) snapshot(kind, targetId, markdown, '编辑前自动留档', document);
}
function counts() { $('#story-count').textContent = state.stories.length; $('#resume-count').textContent = state.resumes.length; }
function intro(kicker, title, sub, actions = '') { return `<div class="intro"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${sub}</p></div><div class="actions">${actions}</div></div>`; }
function render() {
  counts(); document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === page));
  $('#breadcrumb').textContent = `我的工作空间 / ${{ stories:'原始故事', library:'我的经历库', resumes:'简历工作室', settings:'模型与同步' }[page]}`;
  if (page === 'stories') renderStories();
  if (page === 'library') renderLibrary();
  if (page === 'resumes') selectedResume && doc() ? renderStudio() : renderResumes();
  if (page === 'settings') renderSettings();
}
function renderStories() {
  selectedStory ||= state.stories[0]?.id; const s = story();
  $('#view').innerHTML = intro('THE ORIGINAL STORIES', '每一段经历，都有来处。', '保留事情怎么发生、你怎么判断、具体做了什么。整理经历库时，原文始终留在这里。', '<button data-action="import-story">导入 MD / TXT</button><button class="primary" data-action="new-story">＋ 记录故事</button>') + `<div class="split"><div class="list">${state.stories.map(s => `<button class="list-item ${selectedStory === s.id ? 'selected' : ''}" data-story="${esc(s.id)}"><strong>${esc(s.title || '未命名故事')}</strong><small>${esc(s.text.slice(0,65).replace(/[#*]/g,''))}…</small><small style="margin-top:10px">${s.text.length} 字 · ${date(s.updatedAt).split(' ')[0]}</small></button>`).join('') || '<div class="empty">还没有故事</div>'}</div>${s ? `<section class="panel"><div class="panel-head"><input aria-label="故事标题" class="editor-title" data-field="story-title" value="${esc(s.title)}"><div class="actions"><button class="small" data-action="story-version">留存版本</button><button class="small" data-action="history" data-kind="story">历史</button></div></div><textarea class="editor" data-field="story-text" aria-label="原始故事" placeholder="从一件具体的事开始：当时是什么情况？你负责什么？你尝试了什么，结果怎样？">${esc(s.text)}</textarea><div class="editor-foot"><span>${esc(s.source || '我的原始叙述')}</span><button class="subtle small danger" data-action="delete-story">删除故事</button></div></section>` : '<section class="panel empty"><strong>从真实发生过的一件事开始</strong>直接粘贴长故事也可以。过程、细节和当时的思考，都值得留下。</section>'}</div>`;
}
function renderLibrary() {
  $('#view').innerHTML = intro('YOUR EXPERIENCE LIBRARY', '把经历积累下来。', '这里是以后所有简历的共同底稿。AI 整理先给候选稿，采纳后才更新经历库。', '<button data-action="import-library">导入经历库</button><button class="primary" data-action="generate-library">✦ 从故事整理</button>') + `<section class="panel"><div class="panel-head"><span class="tag">完整经历 · 持续补充</span><div class="actions"><button class="small" data-action="library-version">保存版本</button><button class="small" data-action="history" data-kind="library">版本历史</button><button class="small" data-action="export-library">导出 MD</button></div></div><textarea class="editor" data-field="library" aria-label="经历库" placeholder="粘贴已有的经历库，或者从原始故事整理。">${esc(state.library)}</textarea><div class="editor-foot"><span>保留完整过程与数字口径，生成简历时再安排主次</span><span id="library-length">${state.library.length} 字</span></div></section>`;
}
function renderResumes() {
  $('#view').innerHTML = intro('THE RESUME STUDIO', '为下一次机会，写一份简历。', '已有经历库后，粘贴 JD 即可起稿。每个岗位单独保存，内容与排版都可以继续编辑。', '<button data-action="blank-resume">空白简历</button><button class="primary" data-action="new-resume">＋ 粘贴 JD，生成简历</button>') + `<div class="cards">${state.resumes.map(r => `<article class="panel resume-card"><div style="width:100%"><span class="tag">${esc(r.company || '待填写公司')}</span><span class="mini-paper"></span></div><h2>${esc(r.role || r.title || '未命名简历')}</h2><div class="muted">${date(r.updatedAt)}</div><div class="actions"><button class="primary small" data-resume="${esc(r.id)}">继续编辑 →</button><button class="small" data-copy="${esc(r.id)}">复制版本</button></div></article>`).join('')}</div>${state.resumes.length ? '' : '<div class="panel empty"><strong>你的故事已经准备好，下一步是机会。</strong>填写个人资料后，粘贴第一份 JD。生成的内容可以逐段改写和自由编辑。<p><button data-nav="settings">完善个人资料</button></p></div>'}`;
}
function inline(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}
export function markdown(text) {
  let html = '', list = false;
  for (const line of text.split('\n')) {
    if (/^[-*] /.test(line)) { if (!list) { html += '<ul>'; list = true; } html += `<li>${inline(line.slice(2))}</li>`; continue; }
    if (list) { html += '</ul>'; list = false; }
    const head = /^(#{1,3})\s+(.+)$/.exec(line);
    if (head) html += `<h${head[1].length}>${inline(head[2])}</h${head[1].length}>`;
    else if (line.trim() === '---') html += '<hr>';
    else if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  return html + (list ? '</ul>' : '');
}
function layoutStyle(l) { return `--resume-size:${l.fontSize}pt;--leading:${l.lineHeight};--margin:${l.margin}mm;--resume-accent:${l.accent};--resume-font:${l.font === 'serif' ? "'SimSun',serif" : "'Microsoft YaHei',sans-serif"}`; }
function paper(r) { return `<article class="paper ${r.layout.theme === 'compact' ? 'compact' : ''}" style="${layoutStyle(r.layout)}">${markdown(r.markdown)}</article>`; }
function sections(text) { return text.split(/(?=^## )/m); }
function sectionControls() { const chunks = sections(doc().markdown); return chunks.map((s,i) => { const title = /^## (.+)/.exec(s)?.[1]; return title ? `<span>${esc(title)} <button data-move="${i}" data-direction="-1" aria-label="上移${esc(title)}">↑</button><button data-move="${i}" data-direction="1" aria-label="下移${esc(title)}">↓</button></span>` : ''; }).join(''); }
function renderStudio() {
  const r = doc(), l = r.layout;
  $('#view').innerHTML = intro('EDIT · DESIGN · EXPORT', esc(r.role || r.title || '简历编辑'), esc(r.company || '在下方填写岗位和公司，导出文件将按“姓名+岗位+公司”命名。'), '<button data-action="back-resumes">← 全部简历</button><button data-action="resume-version">保存版本</button><button class="primary" data-action="export-menu">导出 ↗</button>') + `<div class="workspace"><div class="panel"><div class="panel-head"><strong>内容编辑</strong><div class="actions"><button class="small" data-action="rewrite">✦ 改写选中文字</button><button class="small" data-action="history" data-kind="resume">历史</button></div></div><div class="panel-body form-grid" style="padding:14px 18px"><label>岗位<input data-field="resume-role" value="${esc(r.role)}"></label><label>公司<input data-field="resume-company" value="${esc(r.company)}"></label></div><div class="section-controls" id="sections">${sectionControls()}</div><textarea class="editor" id="resume-editor" data-field="resume-markdown" aria-label="简历内容 Markdown" spellcheck="false">${esc(r.markdown)}</textarea><div class="editor-foot"><span>## 板块　### 经历　**加粗**</span><span id="resume-length">${r.markdown.length} 字</span></div><details><summary>查看与编辑本次 JD</summary><textarea data-field="resume-jd">${esc(r.jd)}</textarea><button data-action="regenerate" class="small">根据当前 JD 重新生成候选稿</button></details><div class="panel-body"><button class="subtle small danger" data-action="delete-resume">删除这份简历</button></div></div><div><div class="format-bar"><label>模板<select data-layout="theme"><option value="classic" ${l.theme==='classic'?'selected':''}>经典 · 细线</option><option value="compact" ${l.theme==='compact'?'selected':''}>紧凑 · 色块</option></select></label><label>字体<select data-layout="font"><option value="sans" ${l.font==='sans'?'selected':''}>微软雅黑</option><option value="serif" ${l.font==='serif'?'selected':''}>宋体</option></select></label><label>字号 pt<input type="number" data-layout="fontSize" min="9" max="18" step=".5" value="${l.fontSize}"></label><label>行距<input type="number" data-layout="lineHeight" min="1.2" max="2.2" step=".05" value="${l.lineHeight}"></label><label>边距 mm<input type="number" data-layout="margin" min="8" max="30" value="${l.margin}"></label><label>主题色<input type="color" data-layout="accent" value="${l.accent}"></label></div><div class="preview-wrap" id="preview">${paper(r)}</div><p class="muted">A4 单栏 · 实时内容预览。最终分页以“打印 / PDF”预览为准。</p></div></div>`;
}
function updatePreview() { $('#preview').innerHTML = paper(doc()); $('#resume-length').textContent = doc().markdown.length + ' 字'; $('#sections').innerHTML = sectionControls(); }
function renderSettings() {
  const p = state.profile;
  $('#view').innerHTML = intro('MAKE IT YOURS', '你的资料，你的工作方式。', '写作偏好和资料会随备份同步。模型密钥与 GitHub Token 只保存在本机设置文件。') + `<div class="settings-grid"><div><section class="panel"><div class="panel-head"><strong>个人资料</strong><span class="tag">所有岗位共用</span></div><div class="panel-body form-grid">${[['name','姓名'],['phone','手机号'],['email','邮箱'],['availability','到岗与实习时长']].map(([k,n])=>`<label>${n}<input data-profile="${k}" value="${esc(p[k])}"></label>`).join('')}<label class="wide">作品 / GitHub 链接<input data-profile="links" value="${esc(p.links)}"></label></div></section><section class="panel"><div class="panel-head"><strong>表达风格</strong><button class="small" data-action="history" data-kind="style">历史</button></div><div class="panel-body"><p class="muted">已放入你确认的阅读顺序和模块写法。可以补充你喜欢的示例段落。</p><textarea data-field="style" style="width:100%;min-height:350px">${esc(state.style)}</textarea></div></section></div><div><section class="panel"><div class="panel-head"><strong>AI 模型连接</strong><span class="tag">自带 API</span></div><div class="panel-body form-grid"><label class="wide">兼容 OpenAI 的 API 根地址<input id="base-url" value="${esc(settings.baseUrl)}" placeholder="https://api.example.com/v1"></label><label>模型名称<input id="model" value="${esc(settings.model)}" placeholder="填写服务商提供的模型 ID"></label><label>API Key<input id="api-key" type="password" autocomplete="new-password" placeholder="${settings.hasApiKey ? '已保存，留空不修改' : '本地模型可留空'}"></label><div class="wide muted">仅支持 Chat Completions 兼容接口。使用远程接口时，生成所需的经历和 JD 会发送给该服务商。</div></div></section><section class="panel"><div class="panel-head"><strong>GitHub 私有同步</strong><span class="status-pill">${sync.dirty ? '本地有未同步内容' : '已同步'}</span></div><div class="panel-body form-grid"><label class="wide">私有仓库<input id="repo" value="${esc(settings.repo)}" placeholder="用户名/私有仓库名"></label><label class="wide">GitHub Token<input id="github-token" type="password" autocomplete="new-password" placeholder="${settings.hasToken ? '已保存，留空不修改' : '需要该私有仓库 Contents 读写权限'}"></label><p class="muted wide">最近同步：${date(sync.lastSync)}<br>同步经历、简历、风格、排版设置及版本历史。云端有变化时停止覆盖，先让你查看。</p><div class="actions wide"><button data-action="push">↑ 上传本机版本</button><button data-action="remote">↓ 查看云端版本</button></div></div></section><div class="actions"><button class="primary" data-action="save-settings">保存连接设置</button><button data-action="clear-secrets" class="small">清除本机密钥</button></div><div class="callout">密钥保存在 data/settings.local.json，不包含在完整备份和 GitHub 同步里。当前本机文件未加密，请妥善保管电脑账户。</div><section class="panel"><div class="panel-head"><strong>备份与迁移</strong></div><div class="panel-body"><p class="muted">完整备份可迁移到另一台电脑。导入前会自动留存本机快照。</p><div class="actions"><button data-action="backup">下载完整备份</button><button data-action="import-backup">导入完整备份</button></div></div></section></div></div>`;
}
function modal(title, body, footer = '') { dialog.innerHTML = `<div class="dialog-head"><h2>${esc(title)}</h2><button class="subtle" data-action="close">✕</button></div><div class="dialog-body">${body}</div><div class="dialog-foot"><button data-action="close">关闭</button>${footer}</div>`; if (!dialog.open) dialog.showModal(); }
function download(name, content, type = 'text/plain;charset=utf-8') { const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function filename() { const r = doc(); return [state.profile.name, r.role, r.company].filter(Boolean).join('+').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_') || '简历'; }
function newDocument(markdown = '', role = '', company = '', jd = '') { const r = { id: id(), title: role || '新的简历', role, company, jd, markdown, updatedAt: now(), layout: { fontSize: 12, lineHeight: 1.65, margin: 17, accent: '#244b42', font: 'sans', theme: 'classic' } }; state.resumes.unshift(r); return r; }
async function generate(kind, extra = {}) {
  if (generating) return toast('上一份候选稿仍在生成，请稍等。');
  await flush(); generating = true;
  const original = kind === 'library' ? state.library : kind === 'rewrite' || extra.targetId ? state.resumes.find(x=>x.id===extra.targetId)?.markdown : null;
  modal('正在生成候选稿', '<div class="loading"><span class="spinner"></span>正在读取完整资料并起稿，通常需要几十秒。原稿保持不变。</div>');
  try {
    const result = await api('/api/ai', 'POST', { kind, ...extra });
    candidate = { ...result, kind, ...extra, base: original };
    showCandidate();
  } catch (e) { modal('这次没有生成成功', `<p>${esc(e.message)}</p><p class="muted">原始故事、经历库和简历均未被覆盖。可到“模型与同步”检查连接。</p>`); }
  finally { generating = false; }
}
function showCandidate() {
  modal('候选稿 · 确认后采纳', `${candidate.questions.length ? `<div class="callout"><strong>需要你确认的信息</strong><ul>${candidate.questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ul><p>可以先编辑下方候选稿，或返回故事补充后重新生成。</p></div>` : ''}${candidate.notes ? `<p class="muted">${esc(candidate.notes)}</p>` : ''}<textarea id="candidate-text" class="candidate" aria-label="候选稿">${esc(candidate.markdown)}</textarea>`, '<button class="primary" data-action="accept-candidate">采纳这份内容</button>');
}
async function acceptCandidate() {
  const text = $('#candidate-text').value;
  if (candidate.kind === 'library') { if (state.library !== candidate.base) throw new Error('经历库在生成期间已编辑，请先复制候选稿，再比较合并。'); snapshot('library','library',state.library,'AI 整理前'); state.library = text; page='library'; }
  else if (candidate.kind === 'rewrite') {
    const r = state.resumes.find(x=>x.id===candidate.targetId);
    if (!r || r.markdown !== candidate.base) throw new Error('原稿已变化，请复制候选稿后手动合并。');
    snapshot('resume',r.id,r.markdown,'AI 局部改写前',r);
    r.markdown = r.markdown.slice(0,candidate.start) + text + r.markdown.slice(candidate.end); r.updatedAt=now();
  } else {
    let r = state.resumes.find(x=>x.id===candidate.targetId);
    if (r) { if (r.markdown !== candidate.base) throw new Error('原稿已变化，请先保存候选稿并比较。'); snapshot('resume',r.id,r.markdown,'重新生成前',r); r.markdown=text; r.updatedAt=now(); }
    else { r = newDocument(text,candidate.role,candidate.company,candidate.jd); snapshot('resume',r.id,text,'首次生成',r); }
    selectedResume=r.id; page='resumes';
  }
  dirtyMark(); await flush(); dialog.close(); render(); toast('已采纳并保存到本机');
}
function showHistory(kind) {
  const target = kind === 'resume' ? selectedResume : kind === 'story' ? selectedStory : kind;
  const items = state.history.filter(x=>x.kind===kind && x.targetId===target);
  modal('版本历史', items.map(h=>`<div class="history-item"><div><strong>${esc(h.label)}</strong><br><small>${date(h.date)} · ${h.markdown.length} 字</small></div><button data-history="${esc(h.id)}">查看 / 恢复</button></div>`).join('') || '<p class="muted">还没有历史版本。编辑会自动留档，也可以点击“保存版本”。</p>');
}
document.addEventListener('input', e => {
  const t = e.target, f = t.dataset.field;
  if (t.dataset.profile) state.profile[t.dataset.profile] = t.value;
  else if (t.dataset.layout) {
    const key = t.dataset.layout; const value = ['fontSize','lineHeight','margin'].includes(key) ? Number(t.value) : t.value;
    if (t.type === 'number' && (!t.value || !t.checkValidity())) return;
    autoSnapshot('resume',doc().id,doc().markdown,doc()); doc().layout[key]=value; doc().updatedAt=now(); updatePreview();
  } else if (f === 'story-title' || f === 'story-text') { autoSnapshot('story',story().id,story().text); story()[f==='story-title'?'title':'text']=t.value; story().updatedAt=now(); }
  else if (f === 'library') { autoSnapshot('library','library',state.library); state.library=t.value; $('#library-length').textContent=t.value.length+' 字'; }
  else if (f === 'style') { autoSnapshot('style','style',state.style); state.style=t.value; }
  else if (f?.startsWith('resume-')) { const r=doc(); autoSnapshot('resume',r.id,r.markdown,r); r[f.slice(7)]=t.value; r.updatedAt=now(); if(f==='resume-markdown') updatePreview(); }
  else return;
  dirtyMark();
});
document.addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  try {
    if(t.dataset.nav) { page=t.dataset.nav; render(); return; }
    if(t.dataset.story) { selectedStory=t.dataset.story; render(); return; }
    if(t.dataset.resume) { selectedResume=t.dataset.resume; render(); return; }
    if(t.dataset.copy) { const r=structuredClone(state.resumes.find(x=>x.id===t.dataset.copy)); r.id=id(); r.title+=' · 副本'; r.updatedAt=now(); state.resumes.unshift(r); dirtyMark(); render(); return; }
    if(t.dataset.move) { const r=doc(), parts=sections(r.markdown), i=Number(t.dataset.move), j=i+Number(t.dataset.direction); if(j<0 || j>=parts.length || !parts[j].startsWith('## ')) return; snapshot('resume',r.id,r.markdown,'调整板块顺序前',r); [parts[i],parts[j]]=[parts[j],parts[i]]; r.markdown=parts.map(s=>s.trimEnd()+'\n\n').join(''); dirtyMark(); renderStudio(); return; }
    if(t.dataset.history) { const h=state.history.find(x=>x.id===t.dataset.history); modal(h.label, `<p class="muted">${date(h.date)}</p><textarea readonly>${esc(h.markdown)}</textarea>`, `<button class="primary" data-restore="${esc(h.id)}">恢复此版本</button>`); return; }
    if(t.dataset.restore) { const h=structuredClone(state.history.find(x=>x.id===t.dataset.restore)); if(h.kind==='resume') { let r=state.resumes.find(x=>x.id===h.targetId); if(r) snapshot('resume',r.id,r.markdown,'恢复前留档',r); if(h.document) { if(r) Object.assign(r,h.document); else state.resumes.unshift(h.document); } else if(r) r.markdown=h.markdown; selectedResume=h.targetId; page='resumes'; } else if(h.kind==='story') { let s=state.stories.find(x=>x.id===h.targetId); if(!s) { s={id:h.targetId,title:'恢复的故事',text:''};state.stories.unshift(s); } snapshot('story',s.id,s.text,'恢复前留档');s.text=h.markdown;s.updatedAt=now(); selectedStory=s.id;page='stories'; } else { snapshot(h.kind,h.kind,state[h.kind],'恢复前留档');state[h.kind]=h.markdown;page=h.kind==='style'?'settings':'library'; } dirtyMark(); await flush();dialog.close();render();toast('已恢复；恢复前内容也已留档');return; }
    const a=t.dataset.action;
    if(a==='close') return dialog.close();
    if(a==='new-story') { const s={id:id(),title:'新的故事',text:'',source:'我的原始叙述',updatedAt:now()};state.stories.unshift(s);selectedStory=s.id;dirtyMark();render();$('.editor-title').focus(); }
    if(a==='story-version') {snapshot('story',story().id,story().text,story().title);dirtyMark();toast('故事版本已留存');}
    if(a==='library-version') {snapshot('library','library',state.library,'手动保存');dirtyMark();toast('经历库版本已留存');}
    if(a==='resume-version') {snapshot('resume',doc().id,doc().markdown,'手动保存',doc());dirtyMark();await flush();toast('内容与排版版本已保存');}
    if(a==='delete-story' && confirm('删除这条故事？原文会保留在历史备份中。')) { snapshot('story',story().id,story().text,'删除前留档：'+story().title);state.stories=state.stories.filter(x=>x.id!==selectedStory);selectedStory=null;dirtyMark();render(); }
    if(a==='delete-resume' && confirm('删除这份简历？内容会保留在完整备份的历史中。')) { snapshot('resume',doc().id,doc().markdown,'删除前留档',doc());state.resumes=state.resumes.filter(x=>x.id!==selectedResume);selectedResume=null;dirtyMark();render(); }
    if(a==='history') showHistory(t.dataset.kind);
    if(a==='generate-library') await generate('library');
    if(a==='export-library') download('经历库.md',state.library);
    if(a==='back-resumes') {selectedResume=null;render();}
    if(a==='blank-resume') {const r=newDocument('# '+(state.profile.name||'简历')+'\n\n## 教育背景\n\n## 实习经历\n\n## 项目经历\n\n## 技能与资质\n');selectedResume=r.id;dirtyMark();render();}
    if(a==='new-resume') modal('粘贴 JD，开始新的一份', '<p class="muted">会读取完整经历库、原始故事、个人资料与风格偏好。公司和岗位名称将从 JD 中识别，也可在生成后修改。</p><textarea id="new-jd" aria-label="目标 JD" placeholder="粘贴职位名称、公司、岗位职责和任职要求…"></textarea>', '<button class="primary" data-action="start-resume">✦ 生成候选稿</button>');
    if(a==='start-resume') {const jd=$('#new-jd').value.trim();if(!jd)throw new Error('请先粘贴 JD');await generate('resume',{jd});}
    if(a==='regenerate') await generate('resume',{jd:doc().jd,targetId:doc().id});
    if(a==='rewrite') {const el=$('#resume-editor'),start=el.selectionStart,end=el.selectionEnd;if(start===end)throw new Error('先在左侧编辑框中选中要改写的一段文字。');candidate={start,end,selection:el.value.slice(start,end),targetId:doc().id};modal('改写选中的一段',`<p class="muted">${esc(candidate.selection)}</p><label>你想怎么改？<textarea id="rewrite-instruction" placeholder="例如：保留原有细节，先说明项目背景，再强调我对流程的判断和设计。"></textarea></label>`,'<button class="primary" data-action="start-rewrite">生成改写建议</button>');}
    if(a==='start-rewrite') {const extra={...candidate,instruction:$('#rewrite-instruction').value,current:doc().markdown,jd:doc().jd};await generate('rewrite',extra);}
    if(a==='accept-candidate') await acceptCandidate();
    if(a==='export-menu') modal('导出简历',`<p>文件名：<strong>${esc(filename())}</strong></p><p class="muted">PDF 使用浏览器打印：选择“另存为 PDF”，关闭页眉页脚。Word 保留可编辑内容，分页可能与 PDF 不同。</p><div class="actions"><button class="primary" data-action="pdf">打印 / PDF</button><button data-action="docx">Word .docx</button><button data-action="md">Markdown</button><button data-action="html">HTML</button></div>`);
    if(a==='md') download(filename()+'.md',doc().markdown);
    if(a==='html') { const css=await (await fetch('/style.css')).text();download(filename()+'.html',`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${esc(filename())}</title><style>${css}body{background:#fff}.paper{width:210mm;min-height:297mm;margin:auto}@media print{.paper{display:block!important}}</style>${paper(doc())}</html>`,'text/html;charset=utf-8'); }
    if(a==='pdf') {await flush();dialog.close();$('#print-only').innerHTML=paper(doc());let st=$('#page-style');if(!st){st=document.createElement('style');st.id='page-style';document.head.append(st);}st.textContent=`@page{size:A4;margin:${doc().layout.margin}mm}`;document.title=filename();window.print();}
    if(a==='docx') {t.disabled=true;try{await flush();const blob=await api('/api/export/docx','POST',{markdown:doc().markdown,layout:doc().layout},true);download(filename()+'.docx',blob);}finally{t.disabled=false;}}
    if(a==='backup') {download('Storyfolio-完整备份-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(state,null,2),'application/json');toast('备份包含故事、经历库、简历与历史；不含密钥');}
    if(a?.startsWith('import-')) {filePurpose=a;$('#file-input').accept=a==='import-backup'?'.json':'.md,.txt';$('#file-input').value='';$('#file-input').click();}
    if(a==='save-settings') {const r=await api('/api/settings','POST',{baseUrl:$('#base-url').value,model:$('#model').value,apiKey:$('#api-key').value,repo:$('#repo').value,token:$('#github-token').value});settings=r.settings;sync=r.sync;await flush();render();toast('连接设置已保存到本机');}
    if(a==='clear-secrets' && confirm('清除本机保存的 API Key 和 GitHub Token？')) {const r=await api('/api/settings','POST',{...settings,clearApiKey:true,clearToken:true});settings=r.settings;render();toast('密钥已清除');}
    if(a==='push') {await flush();t.disabled=true;try{const r=await api('/api/sync/push','POST',{});sync=r.sync;toast('已同步到 GitHub 私有仓库');if(page==='settings')render();}finally{t.disabled=false;}}
    if(a==='remote') {t.disabled=true;try{remoteData=await api('/api/sync/remote');modal('云端版本',`<p>原始故事 ${remoteData.state.stories.length} 条 · 简历 ${remoteData.state.resumes.length} 份 · 历史 ${remoteData.state.history.length} 条</p><div class="callout">可以先下载查看。恢复会替换当前工作空间，本机现有内容会自动备份到 data 目录。</div>`,'<button data-action="download-remote">下载云端备份</button><button class="primary" data-action="pull">恢复云端版本</button>');}finally{t.disabled=false;}}
    if(a==='download-remote') download('云端工作台备份.json',JSON.stringify(remoteData.state,null,2),'application/json');
    if(a==='pull' && confirm('将云端资料恢复到本机？当前本机资料会先自动备份。')) {await flush();const r=await api('/api/sync/pull','POST',{sha:remoteData.sha});state=r.state;sync=r.sync;selectedStory=null;selectedResume=null;dialog.close();render();toast('云端内容已恢复，本机旧内容已备份');}
  } catch(e) {showError(e);}
});
$('#file-input').addEventListener('change',async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>12000000)throw new Error('文件过大，请使用 12 MB 以内的文件');const text=await file.text();if(filePurpose==='import-backup'){if(!confirm('导入会替换工作空间，当前资料会先自动备份。继续？'))return;await flush();const r=await api('/api/import','POST',JSON.parse(text));state=r.state;sync=r.sync;selectedStory=null;selectedResume=null;}else if(filePurpose==='import-library'){snapshot('library','library',state.library,'导入前留档');state.library=text;dirtyMark();}else{const s={id:id(),title:file.name.replace(/\.[^.]+$/,''),text,source:'导入文件：'+file.name,updatedAt:now()};state.stories.unshift(s);selectedStory=s.id;dirtyMark();}render();toast('已导入');}catch(e){showError(e);}});
try {const r=await api('/api/state');({state,settings,sync,csrf}=r);$('#save-status').textContent='✓ 已保存到本机';render();} catch(e){$('#view').innerHTML=`<div class="empty"><strong>无法读取本地工作空间</strong>${esc(e.message)}<p>请检查启动窗口，刷新后重试。</p></div>`;}
