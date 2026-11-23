import fs from "node:fs/promises";
const md = await fs.readFile("prototype/docs/MODEL-CHAIN.md","utf8");
const blocks = [...md.matchAll(/```mermaid\n([\s\S]*?)```/g)].map(m => m[1]);
async function render(i, tries=3) {
  const b = blocks[i-1];
  const b64 = Buffer.from(b).toString("base64url");
  for (let t=1;t<=tries;t++) {
    try {
      const ctrl = new AbortController(); const timer = setTimeout(()=>ctrl.abort(), 20000);
      const r = await fetch("https://mermaid.ink/img/"+b64, { signal: ctrl.signal });
      clearTimeout(timer);
      const buf = await r.arrayBuffer();
      console.log(`block ${i} try ${t}:`, r.status, r.headers.get("content-type"), buf.byteLength);
      if (r.ok) { await fs.writeFile(`_mmd-${i}.img`, Buffer.from(buf)); return; }
    } catch(e) { console.log(`block ${i} try ${t}: ERR`, e.message); }
  }
}
await render(3); await render(5);
