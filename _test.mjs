import fs from "node:fs/promises";
const md = await fs.readFile("prototype/docs/MODEL-CHAIN.md","utf8");
const blocks = [...md.matchAll(/```mermaid\n([\s\S]*?)```/g)].map(m => m[1]);
console.log("mermaid blocks:", blocks.length);
for (let i=0;i<blocks.length;i++) {
  const b64 = Buffer.from(blocks[i]).toString("base64url");
  try {
    const r = await fetch("https://mermaid.ink/img/"+b64);
    console.log(i+1, "mermaid.ink", r.status, r.headers.get("content-type"));
    if (!r.ok) console.log((await r.text()).slice(0,200));
  } catch(e) { console.log(i+1, "mermaid.ink ERR", e.message); }
}
