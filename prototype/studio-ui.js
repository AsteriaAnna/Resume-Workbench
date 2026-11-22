import {markdownHtml,exportHtml} from './document.mjs';
export function createStudio({S,$,esc,toast,getJson,postJson,render,loadWiki,loadProfile}){
  const current=()=>S.resumes.find(r=>r.id===S.activeResume),queues=new Map(),timers=new Map();
  const status=msg=>{const e=$('#save-state');if(e)e.textContent=msg;};
  async function persist(r,notify=false){
    const previous=queues.get(r.id)||Promise.resolve();
    const next=previous.catch(()=>{}).then(async()=>{
      status('保存中…');const sent=structuredClone(r),fingerprint=JSON.stringify(sent);
      const saved=await postJson('/api/studio/resume',{resume:sent,expected_revision:r.revision});
      if(JSON.stringify(r)===fingerprint)Object.assign(r,saved);else{r.revision=saved.revision;r.updated_at=saved.updated_at;}
      status(`已保存 · v${r.revision}`);if(notify)toast('已保存');return saved;
    }).catch(e=>{status('保存失败，草稿仍在当前页面');toast(e.message);throw e;});queues.set(r.id,next);next.catch(()=>{});return next;
  }
  function dirty(r){status('尚未保存');clearTimeout(timers.get(r.id));timers.set(r.id,setTimeout(()=>persist(r).catch(()=>{}),700));}
  async function flush(){const r=current();if(r){clearTimeout(timers.get(r.id));await persist(r);}}
  async function loadResumes(){try{const d=await getJson('/api/studio/resumes');S.resumes=d.items;}catch(e){toast('简历读取失败：'+e.message);}}
  function renderResumes(){
    const folders=[...new Set(['全部简历','我的简历',...S.resumes.map(r=>r.folder||'我的简历')])];
    $('#app').innerHTML=`<div class="library"><div class="heading"><div><h1>我的简历</h1><p>按岗位整理，保存每次修改。</p></div><div class="actions"><button data-action="new-folder">新建文件夹</button><button class="primary" data-action="new">＋ 新建简历</button></div></div><div class="folders">${folders.map(f=>`<button data-folder="${esc(f)}" class="${S.folder===f?'active':''}">${esc(f)}</button>`).join('')}</div><div class="cards">${S.resumes.filter(r=>S.folder==='全部简历'||r.folder===S.folder).map(r=>`<article class="card" data-open="${esc(r.id)}"><div class="mini"><div class="mini-sheet">${markdownHtml(r.markdown||'# 空白简历').slice(0,3000)}</div></div><div class="card-meta"><strong>${esc(r.name)}</strong><small>${esc(r.status||'草稿')} · v${r.revision||1}<br>${esc(r.company||'')} ${esc(r.role||'')}<br>${esc(r.updated_at?.slice(0,16).replace('T',' ')||'')}</small></div></article>`).join('')||'<div class="empty">还没有简历，点击新建开始。</div>'}</div></div>`;
  }
  async function newResume(){await flush();const r=await postJson('/api/studio/resume',{resume:{name:'未命名简历',folder:S.folder==='全部简历'?'我的简历':S.folder,markdown:'',jd:'',comments:[],styles:{},outline:null,status:'草稿',company:'',role:''}});S.resumes.unshift(r);openResume(r.id);}
  function openResume(id){S.activeResume=id;if(!S.opened.includes(id))S.opened.push(id);S.screen='editor';S.side='gen';render();const r=current();if(r.job_id&&!r.job_done)poll(r,r.job_id);}
  const progress=r=>r.job_id&&!r.job_done?`<div class="task-progress">${esc(r.job_stage||'准备材料')}<button data-action="cancel-job">停止等待结果</button></div>`:'';
  function renderEditor(){const r=current();if(!r)return;
    $('#app').innerHTML=`<div class="toolbar"><button data-action="save">保存</button><button data-action="copy">另存副本</button><button data-action="rename">重命名</button><button data-action="history">历史</button><button data-action="export-md">MD</button><button data-action="export-pdf">PDF</button><span id="save-state">v${r.revision} · ${esc(r.name)}</span><div class="middle"><button data-action="toggle-edit">${S.editMode?'预览':'编辑正文'}</button><button data-action="side-gen">生成</button><button data-action="side-format">简历美化</button><button data-action="side-ai">AI 评论</button></div></div><div class="editor-space"><div class="paper-area">${S.editMode?`<textarea id="resume-source" class="paper source-editor" aria-label="简历 Markdown 正文">${esc(r.markdown)}</textarea>`:`<article id="paper" class="paper ${r.styles?.theme==='blue'?'theme-blue':''}">${markdownHtml(r.markdown)||'<div class="empty">输入 JD，审阅大纲，再生成内容。</div>'}</article>`}</div><section class="panel side" id="gen-side">${progress(r)}${r.proposal?proposalPanel(r):S.side==='gen'?genPanel(r):S.side==='format'?formatPanel(r):commentsPanel(r)}</section></div>`;
    const p=$('#paper');if(p){const s=r.styles||{};p.style.fontSize=(parseFloat(s.fontSize)||13)+'px';p.style.lineHeight=parseFloat(s.lineHeight)||1.7;p.style.padding=(parseFloat(s.padding)||48)+'px';}
  }
  function genPanel(r){return `<div class="panel-head"><strong>JD → 大纲 → 正文</strong></div><div class="side-body"><label class="field">目标公司<input data-meta="company" value="${esc(r.company)}"></label><label class="field">目标岗位<input data-meta="role" value="${esc(r.role)}"></label><label class="field">投递状态<select data-meta="status">${['草稿','待投递','已投递','面试中','已结束'].map(s=>`<option ${r.status===s?'selected':''}>${s}</option>`).join('')}</select></label><label class="field">完整 JD<textarea id="jd-input">${esc(r.jd)}</textarea></label><button class="primary" data-action="outline">生成／更新大纲</button>${r.material_revision&&r.material_revision!==S.wikiRevision?'<p class="gapnote">经历库已更新，建议更新大纲后重新生成。</p>':''}${r.outline?outlinePanel(r):'<p class="hint">读取完整经历和原话。每段经历的表达路线可在大纲中修改。</p>'}</div>`;}
  function outlinePanel(r){return `<hr><label class="field">候选人定位<textarea data-positioning>${esc(r.outline.positioning||'')}</textarea></label>${r.outline.sections.map((s,si)=>`<section class="outline-section"><div class="row"><input data-section="${si}" value="${esc(s.name)}"><button data-section-move="${si}" data-dir="-1">↑</button><button data-section-move="${si}" data-dir="1">↓</button></div>${s.items.map((i,ii)=>`<div class="exp-block"><label><input type="checkbox" data-outline="enabled" data-si="${si}" data-ii="${ii}" ${i.enabled!==false?'checked':''}> 使用</label><input data-outline="title" data-si="${si}" data-ii="${ii}" value="${esc(i.title)}"><label>阅读路线<textarea data-outline="approach" data-si="${si}" data-ii="${ii}">${esc(i.approach)}</textarea></label><label>重点与可追问内容<textarea data-outline="focus" data-si="${si}" data-ii="${ii}">${esc(i.focus)}</textarea></label><label>关键词<input data-outline="keywords" data-si="${si}" data-ii="${ii}" value="${esc((i.keywords||[]).join('、'))}"></label><button data-item-move="${si},${ii}" data-dir="-1">上移</button><button data-item-move="${si},${ii}" data-dir="1">下移</button></div>`).join('')}</section>`).join('')}<button data-action="add-outline">添加已有经历</button><textarea id="outline-comment" placeholder="对大纲提意见，例如合并两条重点、增加技术过程…"></textarea><button data-action="revise">AI 修改大纲</button><button class="primary" data-action="compose">确认大纲，生成正文</button>`;}
  function formatPanel(r){return `<div class="panel-head"><strong>简历美化</strong></div><div class="side-body"><button data-theme="classic">经典单栏</button><button data-theme="blue">蓝调标题</button>${[['fontSize','字号',11,18,.5,13],['lineHeight','行间距',1.2,2.4,.1,1.7],['padding','留白',20,70,2,48]].map(([k,l,min,max,step,d])=>`<label class="field">${l}<input data-format-style="${k}" type="range" min="${min}" max="${max}" step="${step}" value="${parseFloat(r.styles?.[k])||d}"></label>`).join('')}<p>正文栏目顺序</p>${sections(r.markdown).map((s,i)=>`<div class="row">${esc(s.split('\n')[0])}<button data-block-move="${i}" data-dir="-1">↑</button><button data-block-move="${i}" data-dir="1">↓</button></div>`).join('')}</div>`;}
  const sections=md=>String(md).split(/(?=^##\s)/m).filter(Boolean);
  function commentsPanel(r){return `<div class="panel-head"><strong>AI 打磨与补充</strong></div><div class="side-body"><button data-action="comments">审阅当前正文</button>${(r.comments||[]).map((c,i)=>`<div class="comment"><small>${c.kind==='fact'?'补充事实':'表达建议'} · ${esc(c.status||'open')}</small><blockquote>${esc(c.quote)}</blockquote><b>${esc(c.question)}</b><p>${esc(c.reason)}</p>${c.status==='open'?(c.kind==='expression'?`<p>${esc(c.suggestion)}</p><button data-apply-comment="${i}">接受建议</button>`:`<textarea data-answer="${i}" placeholder="补充具体经过…">${esc(c.answer||'')}</textarea><button data-answer-comment="${i}">保存到经历并提出改稿</button>`)+`<button data-dismiss="${i}">暂不处理</button>`:''}</div>`).join('')||'<p class="hint">AI 会对表达给建议，也会围绕已有事实提出具体问题。</p>'}</div>`;}
  function proposalPanel(r){const p=r.proposal;return `<div class="panel-head"><strong>待审阅的${p.kind==='patch'?'局部修改':'生成稿'}</strong></div><div class="side-body">${p.issues?.length?`<div class="gapnote">${p.issues.map(i=>esc(i.reason)).join('<br>')}</div>`:''}${p.kind==='patch'?`<p>原文</p><blockquote>${esc(p.patch.quote)}</blockquote><p>建议</p><blockquote>${esc(p.patch.replacement)}</blockquote>`:`<textarea readonly class="proposal-text">${esc(p.draft.markdown)}</textarea>`}<button class="primary" data-action="accept-proposal" ${p.ok?'':'disabled'}>应用到正文</button><button data-action="discard-proposal">保留现有正文</button><p class="hint">有事实阻断时不能直接应用。可补充经历后重新生成，原稿仍保留。</p></div>`;}
  const stageNames={studio_outline:'分析完整经历，形成大纲',studio_revise:'根据意见修改大纲',studio_compose:'撰写正文',studio_verify:'核对事实和来源',studio_comments:'审阅当前正文',studio_patch:'生成局部修改',check_extension:'核对补充归属',wiki_update:'保存经历补充'};
  const polling=new Set();
  async function poll(r,id){if(polling.has(id))return;polling.add(id);try{while(true){const j=await getJson('/api/studio/job?id='+encodeURIComponent(id));r.job_stage=stageNames[j.stage]||j.stage;
      if(j.status==='running'){const e=$('.task-progress');if(current()?.id===r.id&&e)e.firstChild.textContent=r.job_stage;await new Promise(resolve=>setTimeout(resolve,1000));continue;}
      r.job_done=true;r.last_job=id;
      if(j.status==='complete'){
        const x=j.result;if(j.action==='outline'||j.action==='revise'){r.outline=x.outline;r.material_revision=x.material_revision;}
        if(j.action==='compose')r.proposal={...x,kind:'draft',base_markdown:j.input.base_markdown??j.input.markdown??''};
        if(j.action==='comments')r.comments=x.comments;
        if(j.action==='answer'){r.proposal={...x,kind:'patch'};const c=r.comments.find(c=>c.id===j.input.comment.id);if(c)c.supplement_saved=true;await loadWiki();}
        toast('任务完成');
      }else toast(j.error||'任务已停止');
      await persist(r);if(current()?.id===r.id&&S.screen==='editor')render();break;
    }}catch(e){toast(e.message);}finally{polling.delete(id);}}
  async function run(action,extra={}){const r=current();if(!r)return;if(r.job_id&&!r.job_done)return toast('当前任务尚未完成');await flush();const input={jd:r.jd,outline:r.outline,markdown:r.markdown,base_markdown:r.markdown,...extra};const j=await postJson('/api/studio/job',{action,input});r.job_id=j.id;r.job_done=false;r.job_stage='准备材料';await persist(r);render();poll(r,j.id);}
  function input(e){const r=current();if(!r)return;const t=e.target;
    if(t.id==='resume-source')r.markdown=t.value;
    else if(t.id==='jd-input')r.jd=t.value;
    else if(t.dataset.meta)r[t.dataset.meta]=t.value;
    else if(t.hasAttribute('data-positioning'))r.outline.positioning=t.value;
    else if(t.dataset.section!==undefined)r.outline.sections[+t.dataset.section].name=t.value;
    else if(t.dataset.outline){const i=r.outline.sections[+t.dataset.si].items[+t.dataset.ii];i[t.dataset.outline]=t.dataset.outline==='enabled'?t.checked:t.dataset.outline==='keywords'?t.value.split(/[、,，]/).filter(Boolean):t.value;}
    else if(t.dataset.answer!==undefined){r.comments[+t.dataset.answer].answer=t.value;}
    else if(t.dataset.formatStyle){r.styles||={};r.styles[t.dataset.formatStyle]=Number(t.value);const p=$('#paper');if(p)p.style[t.dataset.formatStyle]=t.dataset.formatStyle==='lineHeight'?t.value:t.value+'px';}
    else return;dirty(r);
  }
  const move=(a,i,d)=>{const j=i+d;if(j>=0&&j<a.length)[a[i],a[j]]=[a[j],a[i]];};
  async function onClick(e){const t=e.target,r=current();
    try{
      if(t.dataset.theme){r.styles||={};r.styles.theme=t.dataset.theme;dirty(r);render();return;}
      if(t.dataset.sectionMove!==undefined){move(r.outline.sections,+t.dataset.sectionMove,+t.dataset.dir);dirty(r);render();return;}
      if(t.dataset.itemMove){const [s,i]=t.dataset.itemMove.split(',').map(Number);move(r.outline.sections[s].items,i,+t.dataset.dir);dirty(r);render();return;}
      if(t.dataset.blockMove!==undefined){const a=sections(r.markdown);move(a,+t.dataset.blockMove,+t.dataset.dir);r.markdown=a.join('');dirty(r);render();return;}
      if(t.dataset.dismiss!==undefined){r.comments[+t.dataset.dismiss].status='dismissed';dirty(r);render();return;}
      if(t.dataset.applyComment!==undefined){const c=r.comments[+t.dataset.applyComment];if(!c.suggestion||!r.markdown.includes(c.quote))return toast('原句已变化，请重新审阅');await flush();r.markdown=r.markdown.replace(c.quote,c.suggestion);c.status='accepted';await persist(r);render();return;}
      if(t.dataset.answerComment!==undefined){const c=r.comments[+t.dataset.answerComment];return run('answer',{comment:c,answer:c.answer,supplement_saved:c.supplement_saved});}
      const a=t.closest('[data-action]')?.dataset.action;
      if(a==='new')return newResume();
      if(a==='save')return persist(r,true);
      if(a==='toggle-edit'){S.editMode=!S.editMode;render();}
      if(a?.startsWith('side-')){S.side=a.slice(5);render();}
      if(a==='outline')return run('outline');
      if(a==='revise')return run('revise',{comment:$('#outline-comment').value});
      if(a==='compose')return run('compose');
      if(a==='comments'){S.side='ai';return run('comments');}
      if(a==='cancel-job'){await postJson('/api/studio/cancel',{id:r.job_id});toast('已停止接收结果；已提交的经历补充仍会保存');}
      if(a==='rename'){const name=prompt('简历名称',r.name);if(name?.trim()){r.name=name.trim();await persist(r);render();}}
      if(a==='copy'){await flush();const c=structuredClone(r);delete c.id;delete c.revision;delete c.created_at;delete c.job_id;c.name+=' 副本';const saved=await postJson('/api/studio/resume',{resume:c});S.resumes.unshift(saved);openResume(saved.id);}
      if(a==='new-folder'){const name=prompt('文件夹名称');if(name?.trim()){S.folder=name.trim();S.folders.push(S.folder);render();}}
      if(a==='add-outline'){const exps=S.nodes.filter(n=>n.kind==='experience');const key=prompt(exps.map((n,i)=>`${i+1}. ${n.title}`).join('\n')+'\n输入序号');const n=exps[Number(key)-1];if(n){r.outline.sections.push({name:n.experience_type==='internship'?'实习经历':'项目经历',items:[{node_id:n.id,title:n.title,approach:'',focus:'',keywords:[],story_ids:[],enabled:true}]});dirty(r);render();}}
      if(a==='accept-proposal'){const p=r.proposal;if(!p.ok)return;if(p.kind==='patch'){if(!r.markdown.includes(p.patch.quote))return toast('原句已变化，请保留当前稿并重新审阅');await flush();r.markdown=r.markdown.replace(p.patch.quote,p.patch.replacement);}else{if(r.markdown!==p.base_markdown&&!confirm('生成期间正文有修改。应用生成稿会保存当前稿为历史版本，是否继续？'))return;await flush();r.markdown=p.draft.markdown;r.claims=p.draft.claims;r.material_revision=p.material_revision;}r.proposal=null;await persist(r);render();}
      if(a==='discard-proposal'){r.proposal=null;await persist(r);render();}
      if(a==='export-md'){await flush();window.open('/api/studio/export?id='+encodeURIComponent(r.id)+'&format=md');}
      if(a==='export-pdf'){const w=window.open('about:blank');if(w){w.document.write(exportHtml(r));w.document.close();}}
      if(a==='history'){const h=await getJson('/api/studio/history?id='+encodeURIComponent(r.id));const n=prompt(h.items.map((x,i)=>`${i+1}. v${x.revision} ${x.updated_at}`).join('\n')+'\n输入要恢复的序号（当前稿会保留在历史中）');const old=h.items[Number(n)-1];if(old){await flush();const rev=r.revision;Object.assign(r,old,{revision:rev});await persist(r);render();}}
    }catch(e){toast(e.message);}
  }
  window.addEventListener('beforeunload',e=>{if([...queues.values()].length&&$('#save-state')?.textContent.includes('尚未保存')){e.preventDefault();e.returnValue='';}});
  return {loadResumes,renderResumes,renderEditor,newResume,openResume,input,onClick,flush};
}
