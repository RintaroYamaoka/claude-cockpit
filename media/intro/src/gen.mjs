// src/gen.mjs — src/scenes/*.html を生成する。cockpit のペインは pane.tsx の行配分(24 行:依存 3・罫・意図・見出し・本文 10・結果・罫・履歴 3・罫・操作)をそのまま描く。
import fs from 'node:fs';
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const W = 58; // 45% のペイン:60 列 − 右余白 2(pane.tsx の RIGHT_PAD)
const RULE = '┄'.repeat(W);
const ruleHid = (a,b) => ('┄'.repeat(W-14) + ` ↑${a} ↓${b}`).padEnd(W,'┄');
const pad = n => String(n).padStart(4);
const fit = (s,w) => s.length<=w ? s : s.slice(0,w-1)+'…';

// ---------- 行(variants = [[key, html], ...] を重ねて pick / swapTo で切り替える)
const row = (id, v) => typeof v === 'string' ? `<div class="ln" id="${id}">${v}</div>`
  : `<div class="ln" id="${id}">` + v.map(([k,h],i)=>`<span class="v${i?' off':''}" id="${id}-${k}">${h}</span>`).join('') + `</div>`;

const tri = `<span class="now rel"><span class="tri">▶</span><span class="tri2">▷</span></span>`;
const focusRow = (path, cls, exports) => `${tri} <span class="${cls} b">${fit(path,W-20)}</span><span class="dim">  exports ${exports}</span>`;
const importsRow = items => `<span class="dim">  imports     </span>` + items.map(([m,cls,plus]) => `<span class="${cls}">${m}</span>${plus?`<span class="ok pm">+</span>`:''}<span>  </span>`).join('');
const depsRow = (n, mods) => `<span class="dim">  dependents  </span><span class="b">${n}</span><span class="dim">  </span>` + mods.map(([m,cls])=>`<span class="${cls}">${m}  </span>`).join('');
const intentRow = txt => `${tri} <span class="dim">${txt}</span>`;
const focusEmpty = `${tri} <span class="dim">まだファイルを触っていない</span>`;
const importsEmpty = `<span class="dim">  imports     —</span>`;
const depsEmpty = `<span class="dim">  dependents  —</span>`;
const intentEmpty = `${tri} `;
const headingEmpty = `<span class="dim">まだ変更はありません。AI が Edit / Write / Bash すると、ここにコードが…</span>`;

const hBash = (summary, time) => `<span class="ok">$ </span>${esc(fit(summary,W-26))}<span class="ok"> ✓</span><span class="dim"> ${time}</span>`;
const hStream = (path, n, kind='新規', agent=false) => `<span class="now">▎ ${fit(path,W-34)} · ${kind} ストリーミング中 ${n} 行 ▌</span>` + (agent?`<span class="dim">  ↳ サブエージェント</span>`:'');
const hDiff = ({path, cls, symbol, kind, time, hidden, above=0, history, reverted, agent}) => `<span class="${cls}">▎ ${fit(path,W-40)}</span>`
  + (symbol?`<span class="dim"> · ${symbol}</span>`:'') + (kind?`<span class="dim"> ▌${kind}</span>`:'')
  + (reverted?`<span class="warn"> リバート済み</span>`:`<span class="dim"> ${time}</span>`)
  + (agent?`<span class="dim">  ↳ サブエージェント</span>`:'') + ((hidden||above)?`<span class="dim">  ↑${above} ↓${hidden}</span>`:'') + (history?`<span class="now">  履歴</span>`:'');

const ten = rows => { const r=[...rows]; while(r.length<10) r.push(''); return r.slice(0,10); };
const diffBody = lines => ten(lines.map(l => { const e=esc(fit(l,W-1)); if(l.startsWith('+')) return ` <span class="plus">${e}</span>`; if(l.startsWith('-')) return ` <span class="minus">${e}</span>`; if(l.startsWith('@@')) return ` <span class="dim">${e}</span>`; return ' '+e; }));
const bashBody = (cmd, out) => ten([` $ ${esc(fit(cmd,W-3))}`, ' ', ...out.map(o=>` <span class="dim">${esc(fit(o,W-1))}</span>`)]);
const streamBody = (lines, n) => { const tail=lines.slice(0,n).slice(-10); const start=n-tail.length;
  return ten(tail.map((l,i)=>`<span class="dim">${pad(start+i+1)} </span>` + (i<tail.length-1?`<span class="dim">${esc(fit(l,W-5))}</span>`:esc(fit(l,W-5))))); };
const emptyBody = ten([]);

const HG = `<svg class="hg" viewBox="0 0 12 20"><path d="M2 1h8M2 19h8M3 1c0 6 6 6 6 9s-6 3-6 9M9 1c0 6-6 6-6 9s6 3 6 9"/></svg>`;
const MARK = {ok:'✓',fail:'✗',running:HG,skip:'–'};
const resultRow = (plus, minus, checks, fail) => `<span class="dim">  └ </span><span class="ok">+${plus}</span> <span class="bad">-${minus}</span>`
  + (checks ? `<span class="dim">  </span>` + checks.map(([st,label,ms]) => `<span class="${st==='ok'?'ok':st==='fail'?'bad':'dim'}">${MARK[st]} ${label}</span>${ms?`<span class="dim"> ${ms}s</span>`:''}<span>  </span>`).join('') : '')
  + (fail ? `<span class="bad">  ${esc(fit(fail,Math.floor(W/2)))}</span>` : '');

const histFile = ({shown, mark, time, tool, path, cls, symbol, plus, minus, reverted, agent}) => {
  const m = shown ? '▸' : mark, mcls = shown ? 'now' : mark==='✗' ? 'bad' : mark==='✓' ? 'ok' : 'dim';
  const tail = (symbol ? symbol.length+3 : 0) + (` +${plus} -${minus}`).length + (reverted?2:0) + (agent?2:0);
  return `<span class="${mcls}">${m} </span><span class="${shown?'':'dim'}">${time} ${tool.padEnd(5)} ${agent?'↳ ':''}</span><span class="${cls}${shown?' b':''}${reverted?' dim':''}">${fit(path,Math.max(12,W-16-tail))}</span>`
    + (symbol?`<span class="${shown?'':'dim'}"> · ${symbol}</span>`:'') + `<span class="dim"> +${plus} -${minus}</span>` + (reverted?`<span class="warn"> ↶</span>`:'');
};
const histBash = ({shown, time, summary}) => `<span class="${shown?'now':'ok'}">${shown?'▸':'✓'} </span><span class="${shown?'':'dim'}">${time} Bash  $ </span><span class="${shown?'b':''}">${esc(fit(summary,W-20))}</span>`;
const ops = (hasShown, hasRevertable, history) => `<span class="${hasShown?'':'dim'}">o: 開く</span> <span class="${hasRevertable?'':'dim'}">r: リバート</span> j: ↓ k: ↑` + (history?' l: 最新へ':'');

/** ペイン。rows: {r0,r1,r2,r4,r5,body:{key:[10]},r16,r17,r18,r19,r20,r22} 各値は html か variants */
function pane(P, s, style=''){
  const bodyKeys = Object.keys(s.body);
  const bodyRows = Array.from({length:10},(_,i)=> row(`${P}-r${6+i}`, bodyKeys.map(k=>[k, s.body[k][i]])));
  return `<div class="cp" id="${P}-cp" data-layout-allow-overlap${style?` style="${style}"`:``}>` + [
    row(`${P}-r0`, s.r0), row(`${P}-r1`, s.r1), row(`${P}-r2`, s.r2), row(`${P}-r3`, `<span class="dim">${RULE}</span>`),
    row(`${P}-r4`, s.r4), row(`${P}-r5`, s.r5), ...bodyRows, row(`${P}-r16`, s.r16), row(`${P}-r17`, s.r17 ?? `<span class="dim">${RULE}</span>`),
    row(`${P}-r18`, s.r18), row(`${P}-r19`, s.r19), row(`${P}-r20`, s.r20), row(`${P}-r21`, `<span class="dim">${RULE}</span>`), row(`${P}-r22`, s.r22),
  ].join('\n') + `</div>`;
}

// ---------- transcript(左)
const T = {
  p0: `<span class="dim">></span> leads API の入力検証を zod にして。`, p1: `  型と一体で。`, e: ' ',
  i0: `<span class="now" data-layout-allow-occlusion>●</span> zod で入力検証を型と一体にする。`, i1: `  スキーマを lib/validation.ts に置き、`, i2: `  route から使う。`,
  b0: `<span class="ok" data-layout-allow-occlusion>●</span> <span class="b">Bash</span>(npm install zod)`, b1: `  <span class="dim">⎿  added 1 package in 2s</span>`,
  w0: `<span class="ok" data-layout-allow-occlusion>●</span> <span class="b">Write</span>(lib/validation.ts)`, w1: `  <span class="dim">⎿  Wrote 13 lines to lib/validation.ts</span>`,
  u0: `<span class="ok" data-layout-allow-occlusion>●</span> <span class="b">Update</span>(app/api/leads/route.ts)`, u1: `  <span class="dim">⎿  Updated app/api/leads/route.ts with</span>`,
  u2: `  <span class="dim">   2 additions and 5 removals</span>`, u2b: `  <span class="dim">   5 additions and 1 removal</span>`,
  t0: `<span class="ok" data-layout-allow-occlusion>●</span> <span class="b">Update</span>(tests/route.test.ts)`, t1: `  <span class="dim">⎿  Updated tests/route.test.ts with</span>`, t2: `  <span class="dim">   3 additions</span>`,
  a0: `<span class="ok" data-layout-allow-occlusion>●</span> <span class="b">Agent</span>(size の検証テストを足す)`, a1: `  <span class="dim">⎿  Done (1 tool use · 12s)</span>`,
  th: `<span class="now" data-layout-allow-occlusion>✻</span> Thinking… <span class="dim">(12s · ↓ 2.1k tokens)</span>`,
  rv0: `<span class="dim">></span> cockpit: 人が tests/route.test.ts への`, rv1: `  直前の変更をリバートした。意図的な判断。`, rv2: `  別の方法が要るか人に聞く。`,
  ak: `<span class="now" data-layout-allow-occlusion>●</span> 了解。テストの追加は保留にします。`,
};
/** rows: [[id|null, key, hidden?], ...] */
function transcript(P, rows, {full=false, y=0}={}){
  return `<div class="tx${full?' full':''}" id="${P}-tx" data-layout-allow-overlap><div class="txs"><div class="txin" id="${P}-txin" style="transform:translateY(${y}px)">`
    + rows.map(([id,key,hidden]) => `<div class="ln" data-layout-allow-occlusion${id?` id="${P}-${id}"`:''}${hidden?' style="opacity:0"':''}>${T[key].replace(/<span /g,'<span data-layout-allow-occlusion ')}</div>`).join('\n')
    + `</div></div><div class="txb"><div class="ln"><span class="dim" id="${P}-hr">${'─'.repeat(full?137:74)}</span></div><div class="ln"><span class="dim">></span> <span class="cur" id="${P}-cur"></span></div><div class="ln"><span class="dim">  ? for shortcuts</span></div></div></div>`;
}
const win = (P, inner) => `<div class="win" id="${P}-win"><div class="titlebar"><span class="d r"></span><span class="d y"></span><span class="d g"></span><span class="ttl">leads-api — claude</span></div><div class="body" id="${P}-body">${inner}</div></div>`;
const cap = (id, parts) => `<p class="cap" id="${id}">${parts.map(p=>p.startsWith('*')?`<span class="ac">${p.slice(1)}</span>`:`<span>${p}</span>`).join('')}</p>`;
const sub = (id, parts) => `<p class="sub" id="${id}">${parts.map(p=>`<span>${p}</span>`).join('')}</p>`;
const keys = (id, ks) => `<div class="keys" id="${id}">${ks.map(([kid,k],i)=>(i?`<span class="plus">then</span>`:'')+`<kbd id="${kid}">${k}</kbd>`).join('')}</div>`;
const lab = (id, text, {x,y,ac=false,n=null}) => `<div class="lab${ac?' ac':''}" id="${id}" style="right:${1920-x}px;top:${y}px">${n!==null?`<span class="n">${n}</span>`:''}${text} ▸</div>`;
const ptr = id => `<svg class="ptr" id="${id}" viewBox="0 0 28 36"><path d="M2 2 L2 28 L9 21 L14 33 L19 31 L14 19 L24 19 Z" fill="#fff" stroke="#1b1b1f" stroke-width="2" stroke-linejoin="round"/></svg>`;

// ---------- VS Code(Dark Modern)。o で開いた時だけ前に出る。中身は tests/route.test.ts の編集後、カーソルはハンクの先頭行(editor.ts の `@@ -n +m` の m)
const TEST_FILE = [
  `import { describe, expect, it } from 'vitest'`, ``, `import { POST } from '@/app/api/leads/route'`, ``,
  `const post = (body: unknown) => POST(new Request('http://x/api/leads', { method: 'POST', body: JSON.stringify(body) }))`, ``,
  `describe('POST /api/leads', () => {`, `  it('rejects an invalid email', async () => {`, `    expect((await post({ email: 'nope' })).status).toBe(400)`, `  })`,
  `  it('stores a valid lead', async () => {`, `    const res = await post({ email: 'a@b.co', company: 'Acme', size: 12 })`, `    expect(res.status).toBe(201)`, `  })`,
  `  it('rejects a non-numeric size', async () => {`, `    expect((await post({ email: 'a@b.co', size: 'big' })).status).toBe(400)`, `  })`, `})`,
];
function hlTs(line){
  const re=/('[^']*')|\b(import|from|const|async|await|export)\b|\b(\d+)\b|([A-Za-z_$][\w$]*)(?=\()|([A-Za-z_$][\w$]*)|(\s+)|(.)/g; let m, out='';
  while((m=re.exec(line))){
    if(m[1]) out+=`<span style="color:#ce9178">${esc(m[1])}</span>`;
    else if(m[2]) out+=`<span style="color:${m[2]==='const'?'#569cd6':'#c586c0'}">${m[2]}</span>`;
    else if(m[3]) out+=`<span style="color:#b5cea8">${m[3]}</span>`;
    else if(m[4]) out+=`<span style="color:#dcdcaa">${m[4]}</span>`;
    else if(m[5]) out+=`<span style="color:#9cdcfe">${m[5]}</span>`;
    else out+=esc(m[0]);
  }
  return out;
}
const ICON = {
  files:`<svg viewBox="0 0 24 24" class="on"><path d="M7 4h7l4 4v12H7z"/><path d="M14 4v4h4"/><path d="M4 8v13h11"/></svg>`,
  search:`<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg>`,
  scm:`<svg viewBox="0 0 24 24"><circle cx="7" cy="5" r="2"/><circle cx="7" cy="19" r="2"/><circle cx="17" cy="9" r="2"/><path d="M7 7v10M17 11c0 3-10 2-10 6"/></svg>`,
  debug:`<svg viewBox="0 0 24 24"><path d="M6 4l12 8-12 8z"/></svg>`,
  ext:`<svg viewBox="0 0 24 24"><rect x="4" y="9" width="5" height="5"/><rect x="9" y="4" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/><rect x="14" y="9" width="5" height="5"/></svg>`,
  remote:`<svg viewBox="0 0 24 24"><path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/></svg>`,
  branch:`<svg viewBox="0 0 24 24"><circle cx="7" cy="5" r="2"/><circle cx="7" cy="19" r="2"/><circle cx="17" cy="9" r="2"/><path d="M7 7v10M17 11c0 3-10 2-10 6"/></svg>`,
  sync:`<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2"/></svg>`,
  err:`<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M9 9l6 6M15 9l-6 6"/></svg>`,
  warn:`<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v5M12 17v.5"/></svg>`,
};
function vscode(P, lines, cur, added){
  const tree = [
    ['dir open','app',0],['dir open','api',1],['dir open','leads',2],['file ts','route.ts',3],
    ['dir open','lib',0],['file ts','db.ts',1],['file ts','validation.ts',1],
    ['dir','node_modules',0],
    ['dir open','tests',0],['file ts sel','route.test.ts',1],
    ['file json','package.json',0],['file json','tsconfig.json',0],['file ts','vitest.config.ts',0],
  ].map(([cls,name,d])=>`<div class="row ${cls}" style="--ind:${10+d*16}px">${cls.includes('ts')?'<span class="ts">TS</span>':cls.includes('json')?'<span class="json">{}</span>':''}${name}</div>`).join('');
  const code = lines.map((l,i)=>{ const n=i+1; const isCur=n===cur; return `<div class="vsc-ln${isCur?' curline':''}"><span class="gut${added.includes(n)?' add':''}"></span><span class="no">${n}</span><span class="src">${isCur?`<span class="caret" id="${P}-vcaret"></span>`:''}${hlTs(l)}</span></div>`; }).join('');
  return `<div class="vsc" id="${P}-vsc" data-layout-allow-overlap data-layout-allow-occlusion>
  <div class="vsc-title"><div class="menu"><span>File</span><span>Edit</span><span>Selection</span><span>View</span><span>Go</span><span>Run</span><span>Terminal</span><span>Help</span></div><div class="ttl">route.test.ts — leads-api [WSL: Ubuntu] — Visual Studio Code</div><div class="wc"><span>—</span><span>▢</span><span>✕</span></div></div>
  <div class="vsc-act"><div class="bar"></div>${ICON.files}${ICON.search}${ICON.scm}${ICON.debug}${ICON.ext}</div>
  <div class="vsc-side"><div class="h">EXPLORER</div><div class="h2">⌄ LEADS-API [WSL: UBUNTU]</div>${tree}</div>
  <div class="vsc-ed">
    <div class="vsc-tabs"><div class="vsc-tab"><span class="ts">TS</span>route.test.ts<span class="x">✕</span></div></div>
    <div class="vsc-crumb">tests › <span style="color:#519aba;font-weight:700;font-size:10px">TS</span> route.test.ts › describe('POST /api/leads') callback › it('stores a valid lead') callback</div>
    <div class="vsc-code">${code}</div>
  </div>
  <div class="vsc-status"><span class="remote">${ICON.remote}WSL: Ubuntu</span><span class="it">${ICON.branch}main</span><span class="it">${ICON.sync}</span><span class="it">${ICON.err}0 ${ICON.warn}0</span><div class="right"><span class="it">Ln ${cur}, Col 1</span><span class="it">Spaces: 2</span><span class="it">UTF-8</span><span class="it">LF</span><span class="it">{} TypeScript</span></div></div>
</div>`;
}

const ROWY = r => 112 + r*30; // ペインの r 行目の frame 上の y
const LABX = 1036; // ラベルの右端(仕切り x=1044 の左)

// ---------- 中身(leads-api)
const VALIDATION = [
  `import { z } from 'zod'`, ``, `export const LeadSchema = z.object({`, `  email: z.string().email(),`, `  company: z.string().min(1),`, `  size: z.number().int().positive(),`, `})`, ``,
  `export type Lead = z.infer<typeof LeadSchema>`, ``, `export function isEmail(value: unknown): value is string {`, `  return LeadSchema.shape.email.safeParse(value).success`, `}`,
];
const DIFF_VALIDATION = [`@@ -1,3 +1,13 @@`, ...VALIDATION.slice(0,10).map(l=>'+'+l), ` export function isEmail(value: unknown): value is string {`,
  `-  return typeof value === 'string' && /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(value)`, `+  return LeadSchema.shape.email.safeParse(value).success`, ` }`];
const EDIT1_NEW = [`import { insertLead } from '@/lib/db'`, `import { LeadSchema } from '@/lib/validation'`, ``, `export const runtime = 'nodejs'`, ``, `export async function POST(req: Request): Promise<Response> {`, `  const body = LeadSchema.parse(await req.json())`];
const DIFF_ROUTE1 = [`@@ -2,9 +2,6 @@`, ` import { insertLead } from '@/lib/db'`, `-import { isEmail } from '@/lib/validation'`, `+import { LeadSchema } from '@/lib/validation'`, ` `,
  ` export const runtime = 'nodejs'`, ` `, ` export async function POST(req: Request): Promise<Response> {`, `-  const body = await req.json()`, `-  if (!isEmail(body.email)) {`,
  `-    return Response.json({ error: 'invalid email' }, { status: 400 })`, `-  }`, `+  const body = LeadSchema.parse(await req.json())`, `   const lead = await insertLead({ email: body.email, company: body.company, size: body.size })`];
const DIFF_ROUTE2 = [`@@ -7,3 +7,7 @@`, ` `, ` export async function POST(req: Request): Promise<Response> {`, `-  const body = LeadSchema.parse(await req.json())`,
  `+  const parsed = LeadSchema.safeParse(await req.json())`, `+  if (!parsed.success) {`, `+    return Response.json({ error: parsed.error.flatten() }, { status: 400 })`, `+  }`, `+  const body = parsed.data`,
  `   const lead = await insertLead({ email: body.email, company: body.company, size: body.size })`, `   return Response.json(lead, { status: 201 })`];
const DIFF_TEST = [`@@ -11,4 +11,7 @@`, `   it('stores a valid lead', async () => {`, `     const res = await post({ email: 'a@b.co', company: 'Acme', size: 12 })`, `     expect(res.status).toBe(201)`, `   })`,
  `+  it('rejects a non-numeric size', async () => {`, `+    expect((await post({ email: 'a@b.co', size: 'big' })).status).toBe(400)`, `+  })`, ` })`];

const scrolled = (lines, off, rows=9) => [lines[0], ...lines.slice(1+off, 1+off+rows)];
const F_ROUTE = focusRow('app/api/leads/route.ts','app','POST, runtime'), I_ROUTE = importsRow([['lib','lib',false]]), D_ROUTE = depsRow(1,[['tests','oth']]);
const F_VAL = focusRow('lib/validation.ts','lib','LeadSchema, Lead, isEmail'), I_VAL = importsRow([['zod','dim',true]]), D_VAL = depsRow(2,[['app/api','app'],['tests','oth']]);
const F_TEST = focusRow('tests/route.test.ts','oth','—'), I_TEST = importsRow([['app/api','app',false],['vitest','dim',false]]), D_TEST = `<span class="dim">  dependents  —(エントリポイントか未参照)</span>`;
const INTENT = intentRow('zod で入力検証を型と一体にする');
const H_BASH = hBash('npm install zod','10:39');
const H_VAL = hDiff({path:'lib/validation.ts',cls:'lib',symbol:'LeadSchema',time:'10:40',hidden:4});
const H_VAL_H = hDiff({path:'lib/validation.ts',cls:'lib',symbol:'LeadSchema',time:'10:40',hidden:4,history:true});
const H_R1 = hDiff({path:'app/api/leads/route.ts',cls:'app',symbol:'POST',kind:'ルーティング',time:'10:42',hidden:4});
const H_R2 = hDiff({path:'app/api/leads/route.ts',cls:'app',symbol:'POST',kind:'ルーティング',time:'10:43',hidden:1});
const H_T = hDiff({path:'tests/route.test.ts',cls:'oth',time:'10:44',agent:true});
const H_T_RV = hDiff({path:'tests/route.test.ts',cls:'oth',time:'10:44',reverted:true,agent:true});
const HB = {time:'10:39',summary:'npm install zod'};
const HV = {mark:'✓',time:'10:40',tool:'Write',path:'lib/validation.ts',cls:'lib',symbol:'LeadSchema',plus:11,minus:1};
const HR1 = {mark:'✗',time:'10:42',tool:'Edit',path:'app/api/leads/route.ts',cls:'app',symbol:'POST',plus:2,minus:5};
const HR2 = {mark:'✓',time:'10:43',tool:'Edit',path:'app/api/leads/route.ts',cls:'app',symbol:'POST',plus:5,minus:1};
const HT = {mark:'✓',time:'10:44',tool:'Edit',path:'tests/route.test.ts',cls:'oth',plus:3,minus:0,agent:true};
const BLANK = ' ';


// ---------- 解剖図(1〜3 行。各行は [text, cls, label|null] の列。ラベルは上下 2 段に交互)
const cw = t => [...t].reduce((n,c)=>n+(c.charCodeAt(0)>0x2e7f && c!=='…' ? 2 : 1),0) * 12; // 表示幅 px(JP は 2 列)
const lw = t => [...t].reduce((n,c)=>n+(c===' '?4:c.charCodeAt(0)>0x2e7f?15:8.6),0) + 16; // ラベル幅 px(15px 太字)
function anatomy(id, lines, {top, note=null, ac=[]}){
  let html=''; let y=0;
  lines.forEach((segs)=>{
    let x=0; let row=`<div class="al" style="position:absolute;left:0;top:${y}px">`; let labels=''; let ticks=''; const rowEnd=[-1e9,-1e9,-1e9];
    segs.forEach(([t,cls,l])=>{
      row+=`<span class="${cls||''}">${esc(t)}</span>`;
      if(l){
        const w=lw(l); let r=rowEnd.findIndex(e=>e+10<=x); let lx=x;
        if(r<0){ r=rowEnd.indexOf(Math.min(...rowEnd)); lx=rowEnd[r]+10; }
        rowEnd[r]=lx+w; const ly=y+34+r*28; const tx=x+Math.min(6,cw(t)/2);
        ticks+=`<div class="tick" style="left:${tx}px;top:${y+30}px;height:${ly-(y+30)+11}px"></div>`;
        if(lx>tx+2) ticks+=`<div class="tick" style="left:${tx}px;top:${ly+10}px;width:${lx-tx}px;height:1px"></div>`;
        labels+=`<div class="lb${ac.includes(l)?' ac':''}" style="left:${lx}px;top:${ly}px">${l}</div>`;
      }
      x+=cw(t);
    });
    html+=row+'</div>'+ticks+labels; y+=124;
  });
  if(note) html+=`<div class="note" style="top:${y-20}px">${note}</div>`;
  return `<div class="anat" id="${id}" data-layout-allow-overlap data-layout-allow-occlusion style="top:${top}px;height:${y+(note?60:0)}px">${html}</div>`;
}
const KINDS = ['スキーマ','依存関係','ルーティング','環境変数','設定','新規'];
const kinds = (id, on, top) => `<div class="kinds" id="${id}" style="top:${top}px">${KINDS.map(k=>`<div class="k${k===on?' on':''}">▌${k}</div>`).join('')}</div>`;
function dimTx(P, at, tl){ return `tl.to("#${P}-tx",{opacity:0.12,duration:0.4,ease:"power2.inOut"},${at});`; }
function undimTx(P, at, tl){ return `tl.to("#${P}-tx",{opacity:1,duration:0.4,ease:"power2.inOut"},${at});`; }

const scenes = [];
const scene = (id, dur, markup, script) => scenes.push({id, dur, markup, script});
const bodyAll = (P,k,t,fn='swapTo') => `${fn}("#${P}-r5-${k}",${t},tl); ${Array.from({length:10},(_,r)=>`${fn}("#${P}-r${6+r}-${k}",${t},tl);`).join(' ')}`;
const depsAll = (P,k,t) => `swapTo("#${P}-r0-${k}",${t},tl); swapTo("#${P}-r1-${k}",${t},tl); swapTo("#${P}-r2-${k}",${t},tl);`;
const BASE = [['p0','p0'],['p1','p1'],[null,'e'],['i0','i0'],['i1','i1'],['i2','i2'],[null,'e']];
const R_BW = [['b0','b0'],['b1','b1'],[null,'e'],['w0','w0'],['w1','w1'],[null,'e']];
const R_U = [['u0','u0'],['u1','u1'],['u2','u2'],[null,'e'],['v0','u0'],['v1','u1'],['v2','u2b'],[null,'e']];
const R_A = [['ag0','a0'],['ag1','a1'],[null,'e']];
const R_RV = [['rv0','rv0',1],['rv1','rv1',1],['rv2','rv2',1],['e8','e',1],['ak','ak',1]];
const RES_VAL = resultRow(11,1,[['ok','型チェック','2.4'],['ok','テスト','1.0']]);
const RES_R1F = resultRow(2,5,[['ok','型チェック','2.8'],['fail','テスト','1.1']],'ZodError: Invalid email');
const RES_R2 = resultRow(5,1,[['ok','型チェック','2.6'],['ok','テスト','1.0']]);
const RES_T = resultRow(3,0,[['ok','型チェック','2.2'],['ok','テスト','1.0']]);

// ===== 1 hook(8 s):頼んだ。流れるが、読めない
{
  const P='hk';
  const rows=[...BASE,['b0','b0',1],['b1','b1',1],['e1','e',1],['w0','w0',1],['w1','w1',1],['e2','e',1],['u0','u0',1],['u1','u1',1],['u2','u2',1],['e3','e',1],['th','th',1]];
  scene('hook',8, `<div id="${P}-stage" class="stage clip" data-start="0" data-duration="8" data-track-index="0">
${win(P, transcript(P, rows, {full:true}))}
${cap(`${P}-c1`, ['頼んだ。','あとは、流れていく。'])}
${sub(`${P}-s1`, ['I asked for it. The rest scrolls by.'])}
${cap(`${P}-c2`, ['どこを触って、','*何が変わった','か、読めない。'])}
${sub(`${P}-s2`, ['Which file, which lines, what it affects: the transcript does not tell you.'])}
</div>`, `
blink("#${P}-cur",0.2,7.9,tl);
words("#${P}-c1",0.6,tl,0.1); words("#${P}-s1",1.0,tl,0.05);
rise("#${P}-b0",0.8,tl,8); rise("#${P}-b1",1.1,tl,8);
rise("#${P}-w0",1.8,tl,8); rise("#${P}-w1",2.1,tl,8);
rise("#${P}-u0",2.8,tl,8); rise("#${P}-u1",3.1,tl,8); rise("#${P}-u2",3.25,tl,8);
rise("#${P}-th",3.9,tl,8);
unwords("#${P}-c1",3.2,tl); unwords("#${P}-s1",3.2,tl);
words("#${P}-c2",3.5,tl,0.1); words("#${P}-s2",3.9,tl,0.05);
flip("#${P}-u1 span",4.3,tl,{color:"#7f849c"},{color:"#d97757"},0.3); flip("#${P}-u2 span",4.3,tl,{color:"#7f849c"},{color:"#d97757"},0.3);
flip("#${P}-u1 span",7.2,tl,{color:"#d97757"},{color:"#7f849c"},0.3); flip("#${P}-u2 span",7.2,tl,{color:"#d97757"},{color:"#7f849c"},0.3);
unwords("#${P}-c2",7.6,tl); unwords("#${P}-s2",7.6,tl);
`);
}

// ===== 2 reveal(7 s):巻き戻して、右に計器盤(空)
{
  const P='rv';
  const rows=[...BASE,['b0','b0'],['b1','b1'],['e1','e'],['w0','w0'],['w1','w1'],['e2','e'],['u0','u0'],['u1','u1'],['u2','u2'],['e3','e'],['th','th']];
  const pn = pane(P,{r0:focusEmpty,r1:importsEmpty,r2:depsEmpty,r4:intentEmpty,r5:headingEmpty,body:{e:emptyBody},r16:BLANK,r18:BLANK,r19:BLANK,r20:BLANK,r22:ops(false,false,false)}, 'opacity:0');
  scene('reveal',7, `<div id="${P}-stage" class="stage clip" data-start="0" data-duration="7" data-track-index="0">
${win(P, transcript(P, rows, {full:true}) + `<div class="vr" id="${P}-vr" style="opacity:0"></div>` + pn)}
${cap(`${P}-c1`, ['同じ作業を、','*計器','を付けて見直す。'])}
${sub(`${P}-s1`, ['The same task again, this time with instruments.'])}
${cap(`${P}-c2`, ['*cockpit',' ― 右に 1 枚。','まだ何も触っていないので、空。'])}
${sub(`${P}-s2`, ['cockpit: one pane on the right. Claude Code on the left is untouched. Nothing touched yet, so it is empty.'])}
</div>`, `
blink("#${P}-cur",0.2,6.9,tl);
blink("#${P}-cp .tri",1.7,6.9,tl);
words("#${P}-c1",0.3,tl,0.1); words("#${P}-s1",0.7,tl,0.05);
tl.to(["#${P}-th","#${P}-u2","#${P}-u1","#${P}-u0","#${P}-w1","#${P}-w0","#${P}-b1","#${P}-b0"],{opacity:0,duration:0.12,ease:"power2.in",stagger:0.05},0.5);
tl.to("#${P}-tx",{width:924,duration:0.6,ease:"power2.inOut"},1.3);
tl.to("#${P}-hr",{opacity:0,duration:0.1},1.3);
tl.set("#${P}-hr",{textContent:"${'─'.repeat(74)}"},1.5);
tl.to("#${P}-hr",{opacity:1,duration:0.2},1.6);
tl.fromTo("#${P}-vr",{opacity:1,scaleY:0},{opacity:1,scaleY:1,duration:0.5,ease:"expo.out"},1.6);
tl.fromTo("#${P}-cp",{opacity:0,x:60},{opacity:1,x:0,duration:0.6,ease:"expo.out"},1.7);
unwords("#${P}-c1",2.4,tl); unwords("#${P}-s1",2.4,tl);
words("#${P}-c2",2.8,tl,0.1); words("#${P}-s2",3.2,tl,0.05);
unwords("#${P}-c2",6.6,tl); unwords("#${P}-s2",6.6,tl);
`);
}

// ===== 3 first(10 s):Bash が入り(コマンドと出力)、Write が入る(流れるのは後で)
{
  const P='fs';
  const rows=[...BASE,['b0','b0',1],['b1','b1',1],['e1','e',1],['w0','w0',1],['w1','w1',1]];
  const body = {e:emptyBody, bash:bashBody('npm install zod',['','added 1 package, and audited 2 packages in 2s','found 0 vulnerabilities'])};
  for(let n=1;n<=13;n++) body['s'+n]=streamBody(VALIDATION,n);
  body.val = diffBody(DIFF_VALIDATION);
  const r5=[['e',headingEmpty],['bash',H_BASH],...Array.from({length:13},(_,i)=>['s'+(i+1),hStream('lib/validation.ts',i+1)]),['val',H_VAL]];
  const pn = pane(P,{
    r0:[['e',focusEmpty],['val',F_VAL]], r1:[['e',importsEmpty],['val',I_VAL]], r2:[['e',depsEmpty],['val',D_VAL]],
    r4:[['e',intentEmpty],['i',INTENT]], r5, body,
    r16:[['e',BLANK],['run',resultRow(11,1,[['running','型チェック',0],['running','テスト',0]])],['ok',RES_VAL]],
    r18:[['e',BLANK],['bash',histBash({shown:true,...HB})],['val',histFile({shown:true,...HV})]],
    r19:[['e',BLANK],['val',histBash({shown:false,...HB})]], r20:BLANK,
    r22:[['e',ops(false,false,false)],['bash',ops(true,false,false)],['val',ops(true,true,false)]],
  });
  const lines = Array.from({length:13},(_,i)=>(5.2+i*0.15).toFixed(2));
  scene('first',10, `<div id="${P}-stage" class="stage clip" data-start="0" data-duration="10" data-track-index="0">
${win(P, transcript(P, rows) + `<div class="vr"></div>` + pn)}
${lab(`${P}-l1`,'Bash:コマンド全文と出力、終了コード',{x:LABX,y:ROWY(5)+1,ac:true})}
${cap(`${P}-c1`, ['Bash は、','*コマンド全文と出力','。'])}
${sub(`${P}-s1`, ['A Bash step shows the whole command and its output; the exit code becomes the mark.'])}
${cap(`${P}-c2`, ['Write が入った。','この画面を、','*上から読む','。'])}
${sub(`${P}-s2`, ['A Write landed. Let us read this screen top to bottom.'])}
</div>`, `
blink("#${P}-cur",0.2,9.9,tl);
blink("#${P}-cp .tri",0.3,9.9,tl);
pick("#${P}-r4-i",0.3,tl);
rise("#${P}-b0",0.3,tl,8); rise("#${P}-b1",0.6,tl,8);
pick("#${P}-r5-bash",0.6,tl); ${Array.from({length:10},(_,i)=>`pick("#${P}-r${6+i}-bash",0.6,tl);`).join(' ')}
pick("#${P}-r18-bash",0.6,tl); pick("#${P}-r22-bash",0.6,tl);
words("#${P}-c1",0.6,tl,0.1); words("#${P}-s1",1.0,tl,0.05);
label("#${P}-l1",0.9,tl);
unlabel("#${P}-l1",3.6,tl);
unwords("#${P}-c1",3.8,tl); unwords("#${P}-s1",3.8,tl);
rise("#${P}-w0",4.9,tl,8);
${lines.map((t,i)=>`pick("#${P}-r5-s${i+1}",${t},tl); ${Array.from({length:10},(_,r)=>`pick("#${P}-r${6+r}-s${i+1}",${t},tl);`).join(' ')}`).join('\n')}
rise("#${P}-w1",7.4,tl,8);
${bodyAll(P,'val',7.4)} ${depsAll(P,'val',7.4)}
pick("#${P}-r16-run",7.5,tl); pick("#${P}-r18-val",7.5,tl); pick("#${P}-r19-val",7.5,tl); pick("#${P}-r22-val",7.5,tl);
pick("#${P}-r16-ok",8.6,tl); pop("#${P}-r16-ok",8.6,tl);
words("#${P}-c2",5.0,tl,0.1); words("#${P}-s2",5.4,tl,0.05);
unwords("#${P}-c2",9.6,tl); unwords("#${P}-s2",9.6,tl);
`);
}

// ===== 4 deps(30 s):上の 3 行を解剖する
{
  const P='dp';
  const rows=[...BASE,...R_BW,['th','th']];
  const pn = pane(P,{r0:F_VAL,r1:I_VAL,r2:D_VAL,r4:INTENT,r5:H_VAL,body:{val:diffBody(DIFF_VALIDATION)},r16:RES_VAL,r18:histFile({shown:true,...HV}),r19:histBash({shown:false,...HB}),r20:BLANK,r22:ops(true,true,false)});
  const A1 = anatomy(`${P}-a1`, [[['▶','now','ターン中は点滅'],[' ',''],['lib/validation.ts','lib b','今触っているファイル(層の色)'],['  exports LeadSchema, Lead, isEmail','dim','外に公開している名前']]], {top:ROWY(0)});
  const A2 = anatomy(`${P}-a2`, [[['  imports     ','dim','このファイルが使っているもの'],['zod','dim','パッケージは薄色'],['+','ok','このセッションで増えた依存'],['  app/api','app','モジュールはディレクトリ 2 段(例)']]], {top:ROWY(0)+124, ac:['このセッションで増えた依存']});
  const A3 = anatomy(`${P}-a3`, [[['  dependents  ','dim','このファイルを使っているファイル'],['2','b','数'],['  ','dim'],['app/api','app','場所'],['  tests','oth',null]]], {top:ROWY(0)+248, note:'誰も使っていなければ  —(エントリポイントか未参照)'});
  scene('deps',30, `<div id="${P}-stage" class="stage clip" data-start="0" data-duration="30" data-track-index="0">
${win(P, transcript(P, rows) + `<div class="vr"></div>` + pn)}
${A1}${A2}${A3}
${cap(`${P}-c1`, ['①','*今触っているファイル','と、exports。'])}
${sub(`${P}-s1`, ['Row 1: the file being touched, its layer colour, and what it exports. The ▶ blinks while a turn is running.'])}
${cap(`${P}-c2`, ['②',' imports ― ','*使っているもの','。'])}
${sub(`${P}-s2`, ['Row 2: what this file imports. Modules two directories deep; packages in the dim colour.'])}
${cap(`${P}-c3`, ['*+',' は、このセッションで増えた依存。'])}
${sub(`${P}-s3`, ['The + marks a dependency added in this session. I never asked for zod. I know the moment it lands.'])}
${cap(`${P}-c4`, ['③',' dependents ― ','*使われている','場所。'])}
${sub(`${P}-s4`, ['Row 3: how many files depend on this one, and where. The blast radius of a change.'])}
${cap(`${P}-c5`, ['route から使われている。','次に触るのは、','*読める','。'])}
${sub(`${P}-s5`, ['The route uses it, so the next edit is predictable.'])}
</div>`, `
blink("#${P}-cur",0.2,29.9,tl);
blink("#${P}-cp .tri",0.2,29.9,tl);
${dimTx(P,0.3)}
focusRows("#${P}-cp",["#${P}-r0"],0.3,tl);
tl.fromTo("#${P}-a1",{opacity:0,x:-16},{opacity:1,x:0,duration:0.5,ease:"expo.out"},0.5);
tl.fromTo("#${P}-a1 .lb, #${P}-a1 .tick",{opacity:0},{opacity:1,duration:0.3,stagger:0.5},1.2);
words("#${P}-c1",0.4,tl,0.1); words("#${P}-s1",0.8,tl,0.05);
unwords("#${P}-c1",6.0,tl); unwords("#${P}-s1",6.0,tl);
words("#${P}-c2",6.4,tl,0.1); words("#${P}-s2",6.8,tl,0.05);
focusRows("#${P}-cp",["#${P}-r0","#${P}-r1"],6.4,tl);
tl.fromTo("#${P}-a2",{opacity:0,x:-16},{opacity:1,x:0,duration:0.5,ease:"expo.out"},6.6);
tl.fromTo("#${P}-a2 .lb, #${P}-a2 .tick",{opacity:0},{opacity:1,duration:0.3,stagger:0.45},7.2);
unwords("#${P}-c2",11.4,tl); unwords("#${P}-s2",11.4,tl);
words("#${P}-c3",11.8,tl,0.1); words("#${P}-s3",12.2,tl,0.05);
flip("#${P}-r1 .pm",12.4,tl,{scale:2.4,transformOrigin:"50% 50%"},{scale:1},0.6,"back.out(1.6)");
flip("#${P}-a2 .ok",12.4,tl,{scale:2.4,transformOrigin:"50% 50%"},{scale:1},0.6,"back.out(1.6)");
unwords("#${P}-c3",17.6,tl); unwords("#${P}-s3",17.6,tl);
words("#${P}-c4",18.0,tl,0.1); words("#${P}-s4",18.4,tl,0.05);
focusRows("#${P}-cp",["#${P}-r0","#${P}-r1","#${P}-r2"],18.0,tl);
tl.fromTo("#${P}-a3",{opacity:0,x:-16},{opacity:1,x:0,duration:0.5,ease:"expo.out"},18.2);
tl.fromTo("#${P}-a3 .lb, #${P}-a3 .tick",{opacity:0},{opacity:1,duration:0.3,stagger:0.5},18.8);
tl.fromTo("#${P}-a3 .note",{opacity:0},{opacity:1,duration:0.3},22.0);
unwords("#${P}-c4",25.0,tl); unwords("#${P}-s4",25.0,tl);
words("#${P}-c5",25.4,tl,0.1); words("#${P}-s5",25.8,tl,0.05);
flip("#${P}-r2 .app",25.6,tl,{scale:1.5,transformOrigin:"0% 50%"},{scale:1},0.6,"back.out(1.6)");
tl.to(["#${P}-a1","#${P}-a2","#${P}-a3"],{opacity:0,duration:0.3,ease:"power3.in"},29.0);
unfocusRows("#${P}-cp",29.0,tl); ${undimTx(P,29.0)}
unwords("#${P}-c5",29.6,tl); unwords("#${P}-s5",29.6,tl);
`);
}

// ===== 5 body(26 s):意図・見出し・本文・結果を解剖する
{
  const P='bd';
  const rows=[...BASE,...R_BW,['th','th']];
  const pn = pane(P,{r0:F_VAL,r1:I_VAL,r2:D_VAL,r4:INTENT,r5:H_VAL,body:{val:diffBody(DIFF_VALIDATION)},r16:RES_VAL,r18:histFile({shown:true,...HV}),r19:histBash({shown:false,...HB}),r20:BLANK,r22:ops(true,true,false)});
  const A1 = anatomy(`${P}-a1`, [[['▶ ','now',null],['zod で入力検証を型と一体にする','dim','モデルが今書いている文章の 1 行目 = 何のために']]], {top:ROWY(4)});
  const A2 = anatomy(`${P}-a2`, [[['▎ ','lib',null],['lib/validation.ts','lib','ファイル(層の色)'],[' · LeadSchema','dim','変更位置に最も近い宣言名'],[' 10:40','dim','時刻'],['  ↑0 ↓4','dim','見えていない行数']]], {top:ROWY(4)+124});
  const A3 = anatomy(`${P}-a3`, [[['  └ ','dim',null],['+11','ok','増えた行'],[' ','dim'],['-1','bad','減った行'],['  ✓ 型チェック','ok','編集直後に裏で回したチェック'],[' 2.4s','dim','所要時間'],['  ✓ テスト','ok','関連テスト'],[' 1.0s','dim',null]]], {top:ROWY(4)+248, note:'回せるものが無いプロジェクトでは  – チェック  とだけ出る'});
  scene('body',26, `<div id="${P}-stage" class="stage clip" data-start="0" data-duration="26" data-track-index="0">
${win(P, transcript(P, rows) + `<div class="vr"></div>` + pn)}
${A1}${A2}${A3}
${cap(`${P}-c1`, ['④ 意図 ― ','*何のために','、が常に見える。'])}
${sub(`${P}-s1`, ['Row 4, the intent: the first line of what the model is writing right now. Always visible.'])}
${cap(`${P}-c2`, ['⑤ 見出し ― ','ファイル・','*宣言名','・時刻。'])}
${sub(`${P}-s2`, ['Row 5, the heading: file, nearest declaration, time. At the right, how many lines are out of view.'])}
${cap(`${P}-c3`, ['⑥ 本文 ― ','*本当の差分','。変わった行と前後 2 行。'])}
${sub(`${P}-s3`, ['The body: the real diff. Write or Edit, a line diff of before and after, with two lines of context.'])}
${cap(`${P}-c4`, ['⑦ 結果 ― ','増減と、','*直後のチェック','。'])}
${sub(`${P}-s4`, ['The result: lines added and removed, then the checks run right after the edit: typecheck, related tests, lint, with their time.'])}
</div>`, `
blink("#${P}-cur",0.2,25.9,tl);
blink("#${P}-cp .tri",0.2,25.9,tl);
${dimTx(P,0.3)}
focusRows("#${P}-cp",["#${P}-r4"],0.3,tl);
tl.fromTo("#${P}-a1",{opacity:0,x:-16},{opacity:1,x:0,duration:0.5,ease:"expo.out"},0.5);
tl.fromTo("#${P}-a1 .lb, #${P}-a1 .tick",{opacity:0},{opacity:1,duration:0.3},1.2);
words("#${P}-c1",0.4,tl,0.1); words("#${P}-s1",0.8,tl,0.05);
unwords("#${P}-c1",5.0,tl); unwords("#${P}-s1",5.0,tl);
words("#${P}-c2",5.4,tl,0.1); words("#${P}-s2",5.8,tl,0.05);
focusRows("#${P}-cp",["#${P}-r4","#${P}-r5"],5.4,tl);
tl.fromTo("#${P}-a2",{opacity:0,x:-16},{opacity:1,x:0,duration:0.5,ease:"expo.out"},5.6);
tl.fromTo("#${P}-a2 .lb, #${P}-a2 .tick",{opacity:0},{opacity:1,duration:0.3,stagger:0.4},6.2);
unwords("#${P}-c2",10.4,tl); unwords("#${P}-s2",10.4,tl);
words("#${P}-c3",10.8,tl,0.1); words("#${P}-s3",11.2,tl,0.05);
focusRows("#${P}-cp",["#${P}-r4","#${P}-r5",${Array.from({length:10},(_,r)=>`"#${P}-r${6+r}"`).join(',')}],10.8,tl);
tl.to(["#${P}-a1","#${P}-a2"],{opacity:0.35,duration:0.3},10.8);
unwords("#${P}-c3",16.6,tl); unwords("#${P}-s3",16.6,tl);
words("#${P}-c4",17.0,tl,0.1); words("#${P}-s4",17.4,tl,0.05);
unfocusRows("#${P}-cp",17.0,tl);
tl.to(["#${P}-a1","#${P}-a2"],{opacity:0,duration:0.3},17.0);
tl.fromTo("#${P}-a3",{opacity:0,x:-16},{opacity:1,x:0,duration:0.5,ease:"expo.out"},17.2);
tl.fromTo("#${P}-a3 .lb, #${P}-a3 .tick",{opacity:0},{opacity:1,duration:0.3,stagger:0.45},17.8);
tl.fromTo("#${P}-a3 .note",{opacity:0},{opacity:1,duration:0.3},22.2);
tl.to("#${P}-a3",{opacity:0,duration:0.3,ease:"power3.in"},25.2);
${undimTx(P,25.2)}
unwords("#${P}-c4",25.6,tl); unwords("#${P}-s4",25.6,tl);
`);
}

// ===== 6 stream(36 s):次の Edit が流れる → ルーティング → ✗ → j/k → 直して ✓
{
  const P='st';
  const rows=[...BASE,...R_BW,['u0','u0',1],['u1','u1',1],['u2','u2',1],['e4','e',1],['v0','u0',1],['v1','u1',1],['v2','u2b',1],['e5','e',1]];
  const body = {val:diffBody(DIFF_VALIDATION)};
  for(let n=1;n<=7;n++) body['s'+n]=streamBody(EDIT1_NEW,n);
  body.r1 = diffBody(DIFF_ROUTE1); body.r1s = diffBody(scrolled(DIFF_ROUTE1,3)); body.r2 = diffBody(DIFF_ROUTE2);
  const H_R1S = hDiff({path:'app/api/leads/route.ts',cls:'app',symbol:'POST',kind:'ルーティング',time:'10:42',hidden:1,above:3});
  const r5=[['val',H_VAL],...Array.from({length:7},(_,i)=>['s'+(i+1),hStream('app/api/leads/route.ts',i+1,'置換')]),['r1',H_R1],['r1s',H_R1S],['r2',H_R2]];
  const pn = pane(P,{
    r0:[['val',F_VAL],['route',F_ROUTE]], r1:[['val',I_VAL],['route',I_ROUTE]], r2:[['val',D_VAL],['route',D_ROUTE]], r4:INTENT, r5, body,
    r16:[['val',RES_VAL],['r1run',resultRow(2,5,[['running','型チェック',0],['running','テスト',0]])],['r1tc',resultRow(2,5,[['ok','型チェック','2.8'],['running','テスト',0]])],['r1f',RES_R1F],['r2run',resultRow(5,1,[['running','型チェック',0],['running','テスト',0]])],['r2',RES_R2]],
    r17:[['a',`<span class="dim">${RULE}</span>`],['b',`<span class="dim">${ruleHid(0,1)}</span>`]],
    r18:[['val',histFile({shown:true,...HV})],['r1',histFile({shown:true,...HR1})],['r2',histFile({shown:true,...HR2})]],
    r19:[['val',histBash({shown:false,...HB})],['r1',histFile({shown:false,...HV})],['r2',histFile({shown:false,...HR1})]],
    r20:[['val',BLANK],['r1',histBash({shown:false,...HB})],['r2',histFile({shown:false,...HV})]],
    r22:ops(true,true,false)});
  const lines = Array.from({length:7},(_,i)=>(1.2+i*0.28).toFixed(2));
  scene('stream',36, `<div id="${P}-stage" class="stage clip" data-start="0" data-duration="36" data-track-index="0">
${win(P, transcript(P, rows) + `<div class="vr"></div>` + pn)}
${lab(`${P}-l1`,'書かれている最中:行番号つき、最後の行だけ明るい',{x:LABX,y:ROWY(5)+1,ac:true})}
${kinds(`${P}-k`,'ルーティング',ROWY(5)+34)}
${lab(`${P}-l2`,'落ちたテストの 1 行目',{x:LABX,y:ROWY(16)+1,ac:true})}
${keys(`${P}-kj`, [[`${P}-kjk`,'j']])}
${keys(`${P}-kk`, [[`${P}-kkk`,'k']])}
${cap(`${P}-c1`, ['書かれている','*最中','のコードが、行番号つきで流れる。'])}
${sub(`${P}-s1`, ['The next Edit starts. Its code streams in with line numbers; only the last line is bright. The heading counts the lines.'])}
${cap(`${P}-c2`, ['確定。見出しに','*▌ルーティング','。入口を触った。'])}
${sub(`${P}-s2`, ['Applied. The heading says: routing. Six kinds of structural change get a label: schema, dependencies, routing, env, config, new file.'])}
${cap(`${P}-c3`, ['テストが落ちた。','*今','。1 行目は ZodError。'])}
${sub(`${P}-s3`, ['The test failed, right now, with its first line. The transcript shows nothing of this.'])}
${cap(`${P}-c4`, ['長い差分は ','*j / k',' でスクロール。'])}
${sub(`${P}-s4`, ['A long diff scrolls with j and k. The arrows in the heading count the hidden lines.'])}
${cap(`${P}-c5`, ['AI が直しにいく。','safeParse に変えて、','*緑','。'])}
${sub(`${P}-s5`, ['The AI goes back to fix it: safeParse, and green.'])}
</div>`, `
blink("#${P}-cur",0.2,35.9,tl);
blink("#${P}-cp .tri",0.2,35.9,tl);
words("#${P}-c1",0.4,tl,0.1); words("#${P}-s1",0.8,tl,0.05);
rise("#${P}-u0",0.6,tl,8);
${depsAll(P,'route',0.9)}
${lines.map((t,i)=>`pick("#${P}-r5-s${i+1}",${t},tl); ${Array.from({length:10},(_,r)=>`pick("#${P}-r${6+r}-s${i+1}",${t},tl);`).join(' ')}`).join('\n')}
label("#${P}-l1",1.6,tl);
unlabel("#${P}-l1",6.6,tl);
unwords("#${P}-c1",7.0,tl); unwords("#${P}-s1",7.0,tl);
rise("#${P}-u1",7.3,tl,8); rise("#${P}-u2",7.45,tl,8);
${bodyAll(P,'r1',7.4)}
pick("#${P}-r16-r1run",7.5,tl); pick("#${P}-r18-r1",7.5,tl); pick("#${P}-r19-r1",7.5,tl); pick("#${P}-r20-r1",7.5,tl);
words("#${P}-c2",7.4,tl,0.1); words("#${P}-s2",7.8,tl,0.05);
tl.fromTo("#${P}-k",{opacity:0,x:12},{opacity:1,x:0,duration:0.4,ease:"expo.out"},8.6);
tl.fromTo("#${P}-k .k",{opacity:0},{opacity:1,duration:0.2,stagger:0.35},8.8);
pick("#${P}-r16-r1tc",10.2,tl); pop("#${P}-r16-r1tc",10.2,tl);
tl.to("#${P}-k",{opacity:0,duration:0.3,ease:"power3.in"},15.2);
unwords("#${P}-c2",15.6,tl); unwords("#${P}-s2",15.6,tl);
pick("#${P}-r16-r1f",16.0,tl); pop("#${P}-r16-r1f",16.0,tl);
words("#${P}-c3",16.0,tl,0.1); words("#${P}-s3",16.4,tl,0.05);
label("#${P}-l2",17.0,tl);
unlabel("#${P}-l2",22.2,tl);
unwords("#${P}-c3",22.6,tl); unwords("#${P}-s3",22.6,tl);
words("#${P}-c4",23.0,tl,0.1); words("#${P}-s4",23.4,tl,0.05);
keys("#${P}-kj",23.2,tl); press("#${P}-kjk",23.6,tl);
pick("#${P}-r5-r1s",23.8,tl); ${Array.from({length:10},(_,r)=>`pick("#${P}-r${6+r}-r1s",23.8,tl);`).join(' ')}
unkeys("#${P}-kj",25.6,tl); keys("#${P}-kk",25.7,tl); press("#${P}-kkk",26.1,tl);
pick("#${P}-r5-r1",26.3,tl); ${Array.from({length:10},(_,r)=>`pick("#${P}-r${6+r}-r1",26.3,tl);`).join(' ')}
unkeys("#${P}-kk",27.6,tl);
unwords("#${P}-c4",28.0,tl); unwords("#${P}-s4",28.0,tl);
words("#${P}-c5",28.4,tl,0.1); words("#${P}-s5",28.8,tl,0.05);
rise("#${P}-v0",28.6,tl,8); rise("#${P}-v1",29.0,tl,8); rise("#${P}-v2",29.15,tl,8);
${bodyAll(P,'r2',29.2)}
pick("#${P}-r17-b",29.2,tl); pick("#${P}-r18-r2",29.2,tl); pick("#${P}-r19-r2",29.2,tl); pick("#${P}-r20-r2",29.2,tl);
pick("#${P}-r16-r2run",29.3,tl);
pick("#${P}-r16-r2",31.4,tl); pop("#${P}-r16-r2",31.4,tl);
unwords("#${P}-c5",33.6,tl); unwords("#${P}-s5",33.6,tl);
`);
}

// ===== 7 history(28 s):1 行の読み方 → ✗ の行 → Write の行 → 新しい変更が来ても動かない
{
  const P='hs';
  const rows=[...BASE,...R_BW,...R_U,['ag0','a0',1],['ag1','a1',1],['e6','e',1]];
  const H_R1_H = hDiff({path:'app/api/leads/route.ts',cls:'app',symbol:'POST',kind:'ルーティング',time:'10:42',hidden:4,history:true});
  const pn = pane(P,{
    r0:[['route',F_ROUTE],['val',F_VAL]], r1:[['route',I_ROUTE],['val',I_VAL]], r2:[['route',D_ROUTE],['val',D_VAL]], r4:INTENT,
    r5:[['r2',H_R2],['r1',H_R1_H],['val',H_VAL_H]], body:{r2:diffBody(DIFF_ROUTE2), r1:diffBody(DIFF_ROUTE1), val:diffBody(DIFF_VALIDATION)},
    r16:[['r2',RES_R2],['r1',RES_R1F],['val',RES_VAL]],
    r17:[['a',`<span class="dim">${ruleHid(0,1)}</span>`],['b',`<span class="dim">${ruleHid(1,1)}</span>`]],
    r18:[['r2',histFile({shown:true,...HR2})],['h',histFile({shown:false,...HR2})]],
    r19:[['r2',histFile({shown:false,...HR1})],['r1',histFile({shown:true,...HR1})]],
    r20:[['r2',histFile({shown:false,...HV})],['val',histFile({shown:true,...HV})]],
    r22:[['r2',ops(true,true,false)],['h',ops(true,true,true)]]});
  const A1 = anatomy(`${P}-a1`, [[['✓','ok','印'],[' 10:40','dim','時刻'],[' Write','dim','ツール'],[' lib/validation.ts','lib','ファイル(層の色)'],[' · LeadSchema','dim','宣言名'],[' +11 -1','dim','増減']]], {top:ROWY(14), note:`✓ 通った   ✗ 落ちた   ${HG} 実行中   – 回せない\n▸ 今映している   ↶ リバート済み   ↳ サブエージェント`});
  const body = (k,t) => `swapTo("#${P}-r5-${k}",${t},tl); ${Array.from({length:10},(_,r)=>`swapTo("#${P}-r${6+r}-${k}",${t},tl);`).join(' ')} pick("#${P}-r16-${k}",${t},tl);`;
  scene('history',28, `<div id="${P}-stage" class="stage clip" data-start="0" data-duration="28" data-track-index="0">
${win(P, transcript(P, rows) + `<div class="vr"></div>` + pn + `<div class="hl" id="${P}-hl1" style="position:absolute;left:925px;right:0;top:${19*30}px;height:30px;background:#313244;opacity:0"></div><div class="hl" id="${P}-hl2" style="position:absolute;left:925px;right:0;top:${20*30}px;height:30px;background:#313244;opacity:0"></div>`)}
${A1}
${lab(`${P}-l1`,'⑧ 履歴:新しいものが上',{x:LABX,y:ROWY(18)+1,ac:true})}
${ptr(`${P}-ptr`)}
${cap(`${P}-c1`, ['⑧ 履歴 ― ','*1 行の読み方','。'])}
${sub(`${P}-s1`, ['Row 8, the history, newest first. Each line: mark, time, tool, file, declaration, lines added and removed.'])}
${cap(`${P}-c2`, ['行を押すと、','*その時の画面','に戻る。'])}
${sub(`${P}-s2`, ['Click a row and that moment comes back: the body, the result, the dependencies.'])}
${cap(`${P}-c3`, ['もう 1 つ前も。'])}
${sub(`${P}-s3`, ['And the one before it.'])}
${cap(`${P}-c4`, ['見ている間は、','新しい変更が来ても','*動かない','。'])}
${sub(`${P}-s4`, ['While you look back, a new change does not move the screen. The rule just says: one above. l returns to the latest.'])}
</div>`, `
blink("#${P}-cur",0.2,27.9,tl);
blink("#${P}-cp .tri",0.2,27.9,tl);
words("#${P}-c1",0.4,tl,0.1); words("#${P}-s1",0.8,tl,0.05);
focusRows("#${P}-cp",["#${P}-r17","#${P}-r18","#${P}-r19","#${P}-r20"],0.5,tl);
label("#${P}-l1",0.8,tl);
${dimTx(P,1.0)}
tl.fromTo("#${P}-a1",{opacity:0,x:-16},{opacity:1,x:0,duration:0.5,ease:"expo.out"},1.2);
tl.fromTo("#${P}-a1 .lb, #${P}-a1 .tick",{opacity:0},{opacity:1,duration:0.3,stagger:0.4},1.8);
tl.fromTo("#${P}-a1 .note",{opacity:0},{opacity:1,duration:0.3},5.6);
tl.to("#${P}-a1",{opacity:0,duration:0.3,ease:"power3.in"},10.6);
${undimTx(P,10.6)}
unwords("#${P}-c1",11.0,tl); unwords("#${P}-s1",11.0,tl);
unlabel("#${P}-l1",11.0,tl);
words("#${P}-c2",11.4,tl,0.1); words("#${P}-s2",11.8,tl,0.05);
tl.fromTo("#${P}-ptr",{opacity:0,x:1500,y:900},{opacity:1,x:1500,y:900,duration:0.1,ease:"none"},11.6);
tl.to("#${P}-ptr",{x:1084,y:692,duration:0.9,ease:"power2.inOut"},11.75);
tl.to("#${P}-ptr",{scale:0.85,duration:0.08,ease:"power2.in",transformOrigin:"10% 5%"},12.8);
tl.to("#${P}-ptr",{scale:1,duration:0.2,ease:"back.out(2)"},12.88);
tl.fromTo("#${P}-hl1",{opacity:0},{opacity:1,duration:0.06,ease:"none"},12.82);
tl.to("#${P}-hl1",{opacity:0,duration:0.3,ease:"power2.out"},13.05);
unfocusRows("#${P}-cp",12.9,tl);
${body('r1',12.95)}
pick("#${P}-r18-h",13.0,tl); pick("#${P}-r19-r1",13.0,tl); pick("#${P}-r22-h",13.0,tl);
unwords("#${P}-c2",16.0,tl); unwords("#${P}-s2",16.0,tl);
words("#${P}-c3",16.4,tl,0.1); words("#${P}-s3",16.8,tl,0.05);
tl.to("#${P}-ptr",{y:722,duration:0.45,ease:"power2.inOut"},16.5);
tl.to("#${P}-ptr",{scale:0.85,duration:0.08,ease:"power2.in",transformOrigin:"10% 5%"},17.05);
tl.to("#${P}-ptr",{scale:1,duration:0.2,ease:"back.out(2)"},17.13);
tl.fromTo("#${P}-hl2",{opacity:0},{opacity:1,duration:0.06,ease:"none"},17.07);
tl.to("#${P}-hl2",{opacity:0,duration:0.3,ease:"power2.out"},17.3);
${body('val',17.2)}
swapTo("#${P}-r0-val",17.2,tl); swapTo("#${P}-r1-val",17.2,tl); swapTo("#${P}-r2-val",17.2,tl);
pick("#${P}-r19-r2",17.25,tl); pick("#${P}-r20-val",17.25,tl);
tl.to("#${P}-ptr",{x:1500,y:900,opacity:0,duration:0.6,ease:"power2.in"},17.9);
unwords("#${P}-c3",18.6,tl); unwords("#${P}-s3",18.6,tl);
words("#${P}-c4",19.0,tl,0.1); words("#${P}-s4",19.4,tl,0.05);
rise("#${P}-ag0",19.6,tl,8); rise("#${P}-ag1",19.9,tl,8);
scrollTo("#${P}-txin",19.6,tl,-90);
pick("#${P}-r17-b",20.0,tl);
flip("#${P}-r17-b",20.0,tl,{color:"#d97757"},{color:"#7f849c"},1.0);
unwords("#${P}-c4",25.6,tl); unwords("#${P}-s4",25.6,tl);
`);
}

// ===== 8 agent(14 s):l で最新へ。サブエージェントの変更には ↳
{
  const P='ag';
  const rows=[...BASE,...R_BW,...R_U,...R_A];
  const pn = pane(P,{
    r0:[['h',F_VAL],['t',F_TEST]], r1:[['h',I_VAL],['t',I_TEST]], r2:[['h',D_VAL],['t',D_TEST]], r4:INTENT,
    r5:[['h',H_VAL_H],['t',H_T]], body:{h:diffBody(DIFF_VALIDATION), t:diffBody(DIFF_TEST)},
    r16:[['h',RES_VAL],['t',RES_T]],
    r17:[['h',`<span class="dim">${ruleHid(1,1)}</span>`],['t',`<span class="dim">${ruleHid(0,2)}</span>`]],
    r18:[['h',histFile({shown:false,...HR2})],['t',histFile({shown:true,...HT})]],
    r19:[['h',histFile({shown:false,...HR1})],['t',histFile({shown:false,...HR2})]], r20:[['h',histFile({shown:true,...HV})],['t',histFile({shown:false,...HR1})]],
    r22:[['h',ops(true,true,true)],['t',ops(true,true,false)]]});
  const toLatest = (t) => `${bodyAll(P,'t',t)} ${depsAll(P,'t',t)} pick("#${P}-r16-t",${t},tl); pick("#${P}-r17-t",${t},tl); pick("#${P}-r18-t",${t},tl); pick("#${P}-r19-t",${t},tl); pick("#${P}-r20-t",${t},tl); pick("#${P}-r22-t",${t},tl);`;
  scene('agent',14, `<div id="${P}-stage" class="stage clip" data-start="0" data-duration="14" data-track-index="0">
${win(P, transcript(P, rows, {y:-90}) + `<div class="vr"></div>` + pn)}
${keys(`${P}-k0`, [[`${P}-kl`,'l']])}
${lab(`${P}-l1`,'↳ サブエージェントが書いた変更',{x:LABX,y:ROWY(5)+1,ac:true})}
${lab(`${P}-l2`,'履歴にも ↳',{x:LABX,y:ROWY(18)+1})}
${cap(`${P}-c1`, ['*l',' で最新へ。来ていたのは、','サブエージェントの変更。'])}
${sub(`${P}-s1`, ['l jumps back to the latest. What arrived was a change written by a subagent.'])}
${cap(`${P}-c2`, ['*↳',' が付く。','並列なら、今書いているものが映る。'])}
${sub(`${P}-s2`, ['Subagent changes stream the same way, marked ↳ in the heading and the history. The intent line stays the main conversation only.'])}
</div>`, `
blink("#${P}-cur",0.2,13.9,tl);
blink("#${P}-cp .tri",0.2,13.9,tl);
words("#${P}-c1",0.4,tl,0.1); words("#${P}-s1",0.8,tl,0.05);
keys("#${P}-k0",0.6,tl); press("#${P}-kl",0.9,tl);
${toLatest(1.15)}
unkeys("#${P}-k0",2.4,tl);
unwords("#${P}-c1",5.4,tl); unwords("#${P}-s1",5.4,tl);
words("#${P}-c2",5.8,tl,0.1); words("#${P}-s2",6.2,tl,0.05);
focusRows("#${P}-cp",["#${P}-r5","#${P}-r18","#${P}-r4"],5.8,tl);
label("#${P}-l1",6.0,tl); label("#${P}-l2",6.6,tl);
unlabel("#${P}-l1",12.6,tl); unlabel("#${P}-l2",12.6,tl); unfocusRows("#${P}-cp",12.6,tl);
unwords("#${P}-c2",13.0,tl); unwords("#${P}-s2",13.0,tl);
`);
}

// ===== 9 ops(30 s):o で VS Code、r r でリバート、Claude に伝わる、Esc
{
  const P='op';
  const rows=[...BASE,...R_BW,...R_U,...R_A,...R_RV];
  const pn = pane(P,{
    r0:F_TEST, r1:I_TEST, r2:D_TEST, r4:INTENT,
    r5:[['t',H_T],['rv',H_T_RV]], body:{t:diffBody(DIFF_TEST)},
    r16:[['t',RES_T],['run',resultRow(3,0,[['running','型チェック',0],['running','テスト',0]])],['ok',resultRow(3,0,[['ok','型チェック','2.3'],['ok','テスト','1.0']])]],
    r17:`<span class="dim">${ruleHid(0,2)}</span>`,
    r18:[['t',histFile({shown:true,...HT})],['rv',histFile({shown:true,...HT,reverted:true})]],
    r19:histFile({shown:false,...HR2}), r20:histFile({shown:false,...HR1}),
    r22:ops(true,true,false)});
  scene('ops',30, `<div id="${P}-stage" class="stage clip" data-start="0" data-duration="30" data-track-index="0">
${win(P, transcript(P, rows, {y:-90}) + `<div class="vr"></div>` + pn + `<div class="toast" id="${P}-toast">VS Code で開きました: leads-api › tests/route.test.ts:11</div>`)}
${vscode(P, TEST_FILE, 11, [15,16,17])}
${keys(`${P}-k1`, [[`${P}-ko`,'o']])}
${keys(`${P}-k2`, [[`${P}-kr1`,'r'],[`${P}-kr2`,'r']])}
${keys(`${P}-k3`, [[`${P}-kesc`,'Esc']])}
${cap(`${P}-c1`, ['⑨ ','*o',' ― 今映している変更を VS Code で開く。'])}
${sub(`${P}-s1`, ['o opens the change you are looking at: the project folder as the workspace, then the file at the line. On WSL, the Windows VS Code opens it as a WSL remote.'])}
${cap(`${P}-c2`, ['*r',' ― 3 秒以内に 2 回で、直前の変更を戻す。'])}
${sub(`${P}-s2`, ['r twice within 3 seconds reverts the last change. Typing >revert in the prompt does the same.'])}
${cap(`${P}-c3`, ['戻したことは ','*Claude にも伝わる','。決めるのは人。'])}
${sub(`${P}-s3`, ['Claude is told: a person reverted this on purpose, ask before trying another way. You decide.'])}
${cap(`${P}-c4`, ['止めるのは、Claude Code の ','*Esc','。'])}
${sub(`${P}-s4`, ['キーはペインがフォーカスを持つ間だけ(/cockpit か、ペインをクリック)。Stopping is Claude Code’s own Esc.'])}
</div>`, `
blink("#${P}-cur",0.2,29.9,tl);
blink("#${P}-cp .tri",0.2,29.9,tl);
words("#${P}-c1",0.4,tl,0.1); words("#${P}-s1",0.8,tl,0.05);
keys("#${P}-k1",0.8,tl); press("#${P}-ko",1.2,tl);
tl.fromTo("#${P}-toast",{opacity:0,y:10},{opacity:1,y:0,duration:0.3,ease:"expo.out"},1.5);
tl.fromTo("#${P}-vsc",{opacity:0,scale:0.72,filter:"blur(6px)",transformOrigin:"52% 22%"},{opacity:1,scale:1,filter:"blur(0px)",duration:0.5,ease:"expo.out"},2.0);
blink("#${P}-vcaret",2.5,8.0,tl);
tl.to("#${P}-toast",{opacity:0,duration:0.25,ease:"power3.in"},6.0);
tl.to("#${P}-vsc",{opacity:0,scale:0.96,duration:0.3,ease:"power3.in"},8.2);
unkeys("#${P}-k1",8.2,tl);
unwords("#${P}-c1",9.0,tl); unwords("#${P}-s1",9.0,tl);
words("#${P}-c2",9.4,tl,0.1); words("#${P}-s2",9.8,tl,0.05);
keys("#${P}-k2",9.6,tl); press("#${P}-kr1",10.0,tl); press("#${P}-kr2",10.4,tl);
pick("#${P}-r5-rv",10.7,tl); pick("#${P}-r18-rv",10.7,tl); pop("#${P}-r18-rv",10.7,tl);
pick("#${P}-r16-run",10.7,tl);
pick("#${P}-r16-ok",12.4,tl); pop("#${P}-r16-ok",12.4,tl);
unkeys("#${P}-k2",14.0,tl);
unwords("#${P}-c2",14.4,tl); unwords("#${P}-s2",14.4,tl);
words("#${P}-c3",14.8,tl,0.1); words("#${P}-s3",15.2,tl,0.05);
rise("#${P}-rv0",15.0,tl,8); rise("#${P}-rv1",15.15,tl,8); rise("#${P}-rv2",15.3,tl,8);
scrollTo("#${P}-txin",15.0,tl,-210);
rise("#${P}-ak",17.6,tl,8);
scrollTo("#${P}-txin",17.6,tl,-240);
unwords("#${P}-c3",20.6,tl); unwords("#${P}-s3",20.6,tl);
words("#${P}-c4",21.0,tl,0.1); words("#${P}-s4",21.4,tl,0.05);
keys("#${P}-k3",21.4,tl);
unkeys("#${P}-k3",27.2,tl);
unwords("#${P}-c4",27.6,tl); unwords("#${P}-s4",27.6,tl);
`);
}

// ===== 10 colors(16 s):色の規則は 4 つ
{
  const P='co';
  const rows=[...BASE,...R_BW,...R_U,...R_A,['rv0','rv0'],['rv1','rv1'],['rv2','rv2'],[null,'e'],['ak','ak']];
  const pn = pane(P,{r0:F_TEST, r1:I_TEST, r2:D_TEST, r4:INTENT, r5:H_T_RV, body:{t:diffBody(DIFF_TEST)},
    r16:resultRow(3,0,[['ok','型チェック','2.3'],['ok','テスト','1.0']]), r17:`<span class="dim">${ruleHid(0,2)}</span>`,
    r18:histFile({shown:true,...HT,reverted:true}), r19:histFile({shown:false,...HR2}), r20:histFile({shown:false,...HR1}), r22:ops(true,true,false)});
  const legend = `<div class="legend" id="${P}-lg" style="top:${ROWY(2)}px">
<span class="now">■</span> 今        ▶ ▸ ストリーミング中の見出し(1 色だけ)
<span class="ok">■</span><span class="bad">■</span><span class="warn">■</span> 状態      ✓ ✗  +n -n  終了コード  リバート済み
<span class="app">■</span> 入口      app  src  pages  api  routes  components
<span class="lib">■</span> ロジック  lib  core  hooks  utils  shared  services
<span class="db">■</span> データ    prisma  db  migrations  supabase  drizzle
<span class="oth">■</span> それ以外  scripts  tests  docs  パッケージ
<span class="dim">■</span> 残りは本文色と薄色の 2 段。背景は端末のまま</div>`;
  scene('colors',16, `<div id="${P}-stage" class="stage clip" data-start="0" data-duration="16" data-track-index="0">
${win(P, transcript(P, rows, {y:-240}) + `<div class="vr"></div>` + pn + legend)}
${cap(`${P}-c1`, ['色の規則は 4 つ。','*今','・状態・層・それ以外。'])}
${sub(`${P}-s1`, ['Four colour rules: now (one accent), state (green, red, yellow), layer (four hues on module names only), and everything else in two shades.'])}
</div>`, `
blink("#${P}-cur",0.2,15.9,tl);
words("#${P}-c1",0.4,tl,0.1); words("#${P}-s1",0.8,tl,0.05);
${dimTx(P,0.4)}
tl.fromTo("#${P}-lg",{opacity:0,x:-16},{opacity:1,x:0,duration:0.5,ease:"expo.out"},0.8);
flip("#${P}-cp .now",2.2,tl,{scale:1.6,transformOrigin:"0% 50%"},{scale:1},0.6,"back.out(1.6)");
flip("#${P}-cp .ok, #${P}-cp .bad, #${P}-cp .warn",5.0,tl,{scale:1.5,transformOrigin:"0% 50%"},{scale:1},0.6,"back.out(1.6)");
flip("#${P}-cp .app, #${P}-cp .lib, #${P}-cp .oth",8.0,tl,{scale:1.3,transformOrigin:"0% 50%"},{scale:1},0.6,"back.out(1.6)");
tl.to("#${P}-lg",{opacity:0,duration:0.3,ease:"power3.in"},15.0);
${undimTx(P,15.0)}
unwords("#${P}-c1",15.4,tl); unwords("#${P}-s1",15.4,tl);
`);
}

// ===== 11 end(8 s)
{
  const P='en';
  const rows=[...BASE,...R_BW,...R_U,...R_A,['rv0','rv0'],['rv1','rv1'],['rv2','rv2'],[null,'e'],['ak','ak']];
  const pn = pane(P,{r0:F_TEST, r1:I_TEST, r2:D_TEST, r4:INTENT, r5:H_T_RV, body:{t:diffBody(DIFF_TEST)},
    r16:resultRow(3,0,[['ok','型チェック','2.3'],['ok','テスト','1.0']]), r17:`<span class="dim">${ruleHid(0,2)}</span>`,
    r18:histFile({shown:true,...HT,reverted:true}), r19:histFile({shown:false,...HR2}), r20:histFile({shown:false,...HR1}), r22:ops(true,true,false)});
  const card = `<div id="${P}-card" style="position:absolute;left:0;top:0;width:924px;bottom:0;opacity:0">
  <div id="${P}-mark" class="mono" style="position:absolute;left:40px;top:150px;font:700 84px/100px 'JetBrains Mono';color:#cdd6f4"><span class="now">▶</span> cockpit</div>
  <div id="${P}-line" style="position:absolute;left:44px;top:270px;font:500 28px/44px 'Noto Sans JP';color:#a6adc8">AI に書かせても、自分のコードのまま。</div>
  <div id="${P}-big" style="position:absolute;left:44px;top:330px;font:700 34px/50px 'Noto Sans JP';color:#cdd6f4"><span style="display:block">計器は 4 つ。</span><span style="display:block">操作は 2 つ。</span><span style="display:block">設定は無い。</span></div>
  <div class="mono" style="position:absolute;left:44px;top:520px;font:400 22px/32px 'JetBrains Mono';color:#cdd6f4;white-space:pre"><span class="dim">></span> <span id="${P}-cmd" data-type="/plugin install cockpit&#10;    --marketplace RintaroYamaoka/claude-cockpit"></span></div>
</div>`;
  scene('end',8, `<div id="${P}-stage" class="stage clip" data-start="0" data-duration="8" data-track-index="0">
${win(P, transcript(P, rows, {y:-240}) + card + `<div class="vr"></div>` + pn)}
${cap(`${P}-c1`, ['*/plugin install cockpit'])}
${sub(`${P}-s1`, ['github.com/RintaroYamaoka/claude-cockpit · MIT · ♪ Drift – Minimal / PodcastAC (CC BY)'])}
</div>`, `
blink("#${P}-cur",0.2,0.6,tl);
tl.to("#${P}-tx",{opacity:0,duration:0.3,ease:"power3.in"},0.3);
tl.fromTo("#${P}-card",{opacity:0},{opacity:1,duration:0.2},0.6);
tl.fromTo("#${P}-mark",{opacity:0,x:-20},{opacity:1,x:0,duration:0.6,ease:"expo.out"},0.6);
tl.fromTo("#${P}-line",{opacity:0},{opacity:1,duration:0.4,ease:"power2.out"},1.1);
tl.fromTo("#${P}-big span",{opacity:0,filter:"blur(8px)"},{opacity:1,filter:"blur(0px)",duration:0.25,ease:"power2.out",stagger:0.15},1.4);
typeIn("#${P}-cmd",2.6,tl,28);
tl.set("#${P}-cp .tri",{opacity:0},0.01);
words("#${P}-c1",2.8,tl,0.1); words("#${P}-s1",3.4,tl,0.05);
`);
}

// ---------- 書き出し
fs.mkdirSync('src/scenes',{recursive:true});
for (const f of fs.readdirSync('src/scenes')) fs.unlinkSync('src/scenes/'+f);
scenes.forEach((s,i)=>{ const f=`src/scenes/${String(i+1).padStart(2,'0')}-${s.id}.html`; fs.writeFileSync(f, s.markup.trim()+'\n<!--SCRIPT-->\n'+s.script.trim()+'\n'); console.log('gen',f,s.dur+'s'); });
