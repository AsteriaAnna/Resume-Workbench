export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inline = s => escapeHtml(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
export function markdownHtml(md) {
  let list=false; const out=[];
  for(const line of String(md||'').split('\n')) {
    if(/^\s*<a id=/.test(line)) continue;
    const li=line.match(/^\s*[-*]\s+(.+)/);
    if(li){if(!list){out.push('<ul>');list=true;}out.push(`<li>${inline(li[1])}</li>`);continue;}
    if(list){out.push('</ul>');list=false;}
    const h=line.match(/^(#{1,4})\s+(.+)/);
    if(h)out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    else if(line.trim())out.push(`<p>${inline(line)}</p>`);
  }
  if(list)out.push('</ul>');return out.join('\n');
}
export function htmlToMarkdown(html) {
  return String(html||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'')
    .replace(/<h([1-4])[^>]*>/gi,(_,n)=>'\n'+'#'.repeat(+n)+' ').replace(/<li[^>]*>/gi,'\n- ')
    .replace(/<\/(?:p|div|h[1-4]|li|ul)>|<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,'')
    .replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/\n{3,}/g,'\n\n').trim();
}
export function exportHtml(resume) {
  const s=resume.styles||{},clamp=(v,a,b,d)=>Math.max(a,Math.min(b,Number.parseFloat(v)||d));
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escapeHtml(resume.name)}</title><style>@page{size:A4;margin:16mm}body{font-family:"Microsoft YaHei",sans-serif;max-width:178mm;margin:auto;font-size:${clamp(s.fontSize,11,18,13)}px;line-height:${clamp(s.lineHeight,1.2,2.4,1.7)}}h1{font-size:24px}h2{font-size:16px;border-bottom:1px solid #bbc5d8;padding-bottom:5px;color:${s.theme==='blue'?'#4057bc':'#26314a'}}h3{font-size:14px}li{margin:5px 0}h2,h3{break-after:avoid}p,li{orphans:2;widows:2}button{margin:20px}@media print{button{display:none}}</style><button onclick="window.print()">打印／保存为 PDF</button>${markdownHtml(resume.markdown)}</html>`;
}
