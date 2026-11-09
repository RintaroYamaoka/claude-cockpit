// src/gen.mjs — src/scenes/*.html を生成する。cockpit のペインは pane.tsx の行配分(24 行:依存 3・罫・意図・見出し・本文 10・結果・罫・履歴 3・罫・操作)をそのまま描く。
import fs from 'node:fs';
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const W = 74;
const RULE = '┄'.repeat(W);
const ruleHid = (a,b) => ('┄'.repeat(W-14) + ` ↑${a} ↓${b}`).padEnd(W,'┄');
const pad = n => String(n).padStart(4);
const fit = (s,w) => s.length<=w ? s : s.slice(0,w-1)+'…';

// ---------- 行(variants = [[key, html], ...] を重ねて pick / swapTo で切り替える)
const row = (id, v) => typeof v === 'string' ? `<div class="ln" id="${id}">${v}</div>`
  : `<div class="ln" id="${id}">` + v.map(([k,h],i)=>`<span class="v${i?' off':''}" id="${id}-${k}">${h}</span>`).join('') + `</div>`;

const tri = `<span class="now rel"><span class="tri">▶</span><span class="tri2">▷</span></span>`;
const focusRow = (path, cls, exports) => `${tri} <span class="${cls} b">${path}</span><span class="dim">  exports ${exports}</span>`;
const importsRow = items => `<span class="dim">  imports     </span>` + items.map(([m,cls,plus]) => `<span class="${cls}">${m}</span>${plus?`<span class="ok pm">+</span>`:''}<span>  </span>`).join('');
const depsRow = (n, mods) => `<span class="dim">  dependents  </span><span class="b">${n}</span><span class="dim">  </span>` + mods.map(([m,cls])=>`<span class="${cls}">${m}  </span>`).join('');
const intentRow = txt => `${tri} <span class="dim">${txt}</span>`;
const focusEmpty = `${tri} <span class="dim">まだファイルを触っていない</span>`;
const importsEmpty = `<span class="dim">  imports     —</span>`;
const depsEmpty = `<span class="dim">  dependents  —</span>`;
const intentEmpty = `${tri} `;
const headingEmpty = `<span class="dim">まだ変更はありません。AI が Edit / Write / Bash すると、ここにコードが…</span>`;

const hBash = (summary, time) => `<span class="ok">$ </span>${esc(summary)}<span class="ok"> ✓</span><span class="dim"> ${time}</span>`;
const hStream = (path, n) => `<span class="now">▎ ${path} · 新規 ストリーミング中 ${n} 行 ▌</span>`;
const hDiff = ({path, cls, symbol, kind, time, hidden, history, reverted}) => `<span class="${cls}">▎ ${path}</span>`
  + (symbol?`<span class="dim"> · ${symbol}</span>`:'') + (kind?`<span class="dim"> ▌${kind}</span>`:'')
  + (reverted?`<span class="warn"> リバート済み</span>`:`<span class="dim"> ${time}</span>`)
  + (hidden?`<span class="dim">  ↑0 ↓${hidden}</span>`:'') + (history?`<span class="now">  履歴</span>`:'');

const ten = rows => { const r=[...rows]; while(r.length<10) r.push(''); return r.slice(0,10); };
const diffBody = lines => ten(lines.map(l => { const e=esc(fit(l,W-1)); if(l.startsWith('+')) return ` <span class="plus">${e}</span>`; if(l.startsWith('-')) return ` <span class="minus">${e}</span>`; if(l.startsWith('@@')) return ` <span class="dim">${e}</span>`; return ' '+e; }));
const bashBody = (cmd, out) => ten([` $ ${esc(cmd)}`, ' ', ...out.map(o=>` <span class="dim">${esc(o)}</span>`)]);
const streamBody = (lines, n) => { const tail=lines.slice(0,n).slice(-10); const start=n-tail.length;
  return ten(tail.map((l,i)=>`<span class="dim">${pad(start+i+1)} </span>` + (i<tail.length-1?`<span class="dim">${esc(l)}</span>`:esc(l)))); };
const emptyBody = ten([]);

const MARK = {ok:'✓',fail:'✗',running:'⏳',skip:'–'};
const resultRow = (plus, minus, checks, fail) => `<span class="dim">  └ </span><span class="ok">+${plus}</span> <span class="bad">-${minus}</span>`
  + (checks ? `<span class="dim">  </span>` + checks.map(([st,label,ms]) => `<span class="${st==='ok'?'ok':st==='fail'?'bad':'dim'}">${MARK[st]} ${label}</span>${ms?`<span class="dim"> ${ms}s</span>`:''}<span>  </span>`).join('') : '')
  + (fail ? `<span class="bad">  ${esc(fail)}</span>` : '');

const histFile = ({shown, mark, time, tool, path, cls, symbol, plus, minus, reverted}) => {
  const m = shown ? '▸' : mark, mcls = shown ? 'now' : mark==='✗' ? 'bad' : mark==='✓' ? 'ok' : 'dim';
  return `<span class="${mcls}">${m} </span><span class="${shown?'':'dim'}">${time} ${tool.padEnd(5)} </span><span class="${cls}${shown?' b':''}${reverted?' dim':''}">${path}</span>`
    + (symbol?`<span class="${shown?'':'dim'}"> · ${symbol}</span>`:'') + `<span class="dim"> +${plus} -${minus}</span>` + (reverted?`<span class="warn"> ↶</span>`:'');
};
const histBash = ({shown, time, summary}) => `<span class="${shown?'now':'ok'}">${shown?'▸':'✓'} </span><span class="${shown?'':'dim'}">${time} Bash  $ </span><span class="${shown?'b':''}">${esc(summary)}</span>`;
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
  th: `<span class="now">✻</span> Thinking… <span class="dim">(12s · ↓ 2.1k tokens)</span>`,
  rv0: `<span class="dim">></span> cockpit: 人が tests/route.test.ts への`, rv1: `  直前の変更をリバートした。意図的な判断。`, rv2: `  別の方法が要るか人に聞く。`,
  ak: `<span class="now" data-layout-allow-occlusion>●</span> 了解。テストの追加は保留にします。`,
};
/** rows: [[id|null, key, hidden?], ...] */
function transcript(P, rows, {full=false, y=0}={}){
  return `<div class="tx${full?' full':''}" id="${P}-tx" data-layout-allow-overlap><div class="txs"><div class="txin" id="${P}-txin" style="transform:translateY(${y}px)">`
    + rows.map(([id,key,hidden]) => `<div class="ln" data-layout-allow-occlusion${id?` id="${P}-${id}"`:''}${hidden?' style="opacity:0"':''}>${T[key].replace(/<span /g,'<span data-layout-allow-occlusion ')}</div>`).join('\n')
    + `</div></div><div class="txb"><div class="ln"><span class="dim" id="${P}-hr">${'─'.repeat(full?124:45)}</span></div><div class="ln"><span class="dim">></span> <span class="cur" id="${P}-cur"></span></div><div class="ln"><span class="dim">  ? for shortcuts</span></div></div></div>`;
}
const win = (P, inner) => `<div class="win" id="${P}-win"><div class="titlebar"><span class="d r"></span><span class="d y"></span><span class="d g"></span><span class="ttl">leads-api — claude</span></div><div class="body" id="${P}-body">${inner}</div></div>`;
const cap = (id, parts) => `<p class="cap" id="${id}">${parts.map(p=>p.startsWith('*')?`<span class="ac">${p.slice(1)}</span>`:`<span>${p}</span>`).join('')}</p>`;
const sub = (id, parts) => `<p class="sub" id="${id}">${parts.map(p=>`<span>${p}</span>`).join('')}</p>`;
const keys = (id, ks) => `<div class="keys" id="${id}">${ks.map(([kid,k],i)=>(i?`<span class="plus">then</span>`:'')+`<kbd id="${kid}">${k}</kbd>`).join('')}</div>`;
const lab = (id, text, {x,y,ac=false,n=null}) => `<div class="lab${ac?' ac':''}" id="${id}" style="left:${x}px;top:${y}px">${n!==null?`<span class="n">${n}</span>`:''}${text}</div>`;
const ptr = id => `<svg class="ptr" id="${id}" viewBox="0 0 28 36"><path d="M2 2 L2 28 L9 21 L14 33 L19 31 L14 19 L24 19 Z" fill="#fff" stroke="#1b1b1f" stroke-width="2" stroke-linejoin="round"/></svg>`;
const ROWY = r => 112 + r*30; // ペインの r 行目の frame 上の y
const LABX = 1545;

// ---------- 中身(leads-api)
const VALIDATION = [
  `import { z } from 'zod'`, ``, `export const LeadSchema = z.object({`, `  email: z.string().email(),`, `  company: z.string().min(1),`, `  size: z.number().int().positive(),`, `})`, ``,
  `export type Lead = z.infer<typeof LeadSchema>`, ``, `export function isEmail(value: unknown): value is string {`, `  return LeadSchema.shape.email.safeParse(value).success`, `}`,
];
const DIFF_VALIDATION = [`@@ -1,3 +1,13 @@`, ...VALIDATION.slice(0,10).map(l=>'+'+l), ` export function isEmail(value: unknown): value is string {`,
  `-  return typeof value === 'string' && /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(value)`, `+  return LeadSchema.shape.email.safeParse(value).success`, ` }`];
const DIFF_ROUTE1 = [`@@ -2,9 +2,6 @@`, ` import { insertLead } from '@/lib/db'`, `-import { isEmail } from '@/lib/validation'`, `+import { LeadSchema } from '@/lib/validation'`, ` `,
  ` export const runtime = 'nodejs'`, ` `, ` export async function POST(req: Request): Promise<Response> {`, `-  const body = await req.json()`, `-  if (!isEmail(body.email)) {`,
  `-    return Response.json({ error: 'invalid email' }, { status: 400 })`, `-  }`, `+  const body = LeadSchema.parse(await req.json())`, `   const lead = await insertLead({ email: body.email, company: body.company, size: body.size })`];
const DIFF_ROUTE2 = [`@@ -7,3 +7,7 @@`, ` `, ` export async function POST(req: Request): Promise<Response> {`, `-  const body = LeadSchema.parse(await req.json())`,
  `+  const parsed = LeadSchema.safeParse(await req.json())`, `+  if (!parsed.success) {`, `+    return Response.json({ error: parsed.error.flatten() }, { status: 400 })`, `+  }`, `+  const body = parsed.data`,
  `   const lead = await insertLead({ email: body.email, company: body.company, size: body.size })`, `   return Response.json(lead, { status: 201 })`];
const DIFF_TEST = [`@@ -9,4 +9,7 @@`, `   it('stores a valid lead', async () => {`, `     const res = await post({ email: 'a@b.co', company: 'Acme', size: 12 })`, `     expect(res.status).toBe(201)`, `   })`,
  `+  it('rejects a non-numeric size', async () => {`, `+    expect((await post({ email: 'a@b.co', size: 'big' })).status).toBe(400)`, `+  })`, ` })`];

const F_ROUTE = focusRow('app/api/leads/route.ts','app','POST, runtime'), I_ROUTE = importsRow([['lib','lib',false]]), D_ROUTE = depsRow(1,[['tests','oth']]);
const F_VAL = focusRow('lib/validation.ts','lib','LeadSchema, Lead, isEmail'), I_VAL = importsRow([['zod','dim',true]]), D_VAL = depsRow(2,[['app/api','app'],['tests','oth']]);
const F_TEST = focusRow('tests/route.test.ts','oth','—'), I_TEST = importsRow([['app/api','app',false],['vitest','dim',false]]), D_TEST = `<span class="dim">  dependents  —(エントリポイントか未参照)</span>`;
const INTENT = intentRow('zod で入力検証を型と一体にする');
const H_BASH = hBash('npm install zod','10:39');
const H_VAL = hDiff({path:'lib/validation.ts',cls:'lib',symbol:'LeadSchema',time:'10:40',hidden:4});
const H_VAL_H = hDiff({path:'lib/validation.ts',cls:'lib',symbol:'LeadSchema',time:'10:40',hidden:4,history:true});
const H_R1 = hDiff({path:'app/api/leads/route.ts',cls:'app',symbol:'POST',kind:'ルーティング',time:'10:42',hidden:4});
const H_R2 = hDiff({path:'app/api/leads/route.ts',cls:'app',symbol:'POST',kind:'ルーティング',time:'10:43',hidden:1});
const H_T = hDiff({path:'tests/route.test.ts',cls:'oth',time:'10:44'});
const H_T_RV = hDiff({path:'tests/route.test.ts',cls:'oth',time:'10:44',reverted:true});
const HB = {time:'10:39',summary:'npm install zod'};
const HV = {mark:'✓',time:'10:40',tool:'Write',path:'lib/validation.ts',cls:'lib',symbol:'LeadSchema',plus:11,minus:1};
const HR1 = {mark:'✗',time:'10:42',tool:'Edit',path:'app/api/leads/route.ts',cls:'app',symbol:'POST',plus:2,minus:5};
const HR2 = {mark:'✓',time:'10:43',tool:'Edit',path:'app/api/leads/route.ts',cls:'app',symbol:'POST',plus:5,minus:1};
const HT = {mark:'✓',time:'10:44',tool:'Edit',path:'tests/route.test.ts',cls:'oth',plus:3,minus:0};
const BLANK = ' ';

const scenes = [];
const scene = (id, dur, markup, script) => scenes.push({id, dur, markup, script});

// ===== 1 hook(7 s):Claude Code 1 枚。Update の行が流れても、どの行かは出てこない
{
  const P='hk';
  const rows=[['p0','p0'],['p1','p1'],[null,'e'],['i0','i0'],['i1','i1'],['i2','i2'],[null,'e'],['b0','b0',1],['b1','b1',1],['e1','e',1],['w0','w0',1],['w1','w1',1],['e2','e',1],['u0','u0',1],['u1','u1',1],['u2','u2',1],['e3','e',1],['th','th',1]];
  scene('hook',7, `<div id="${P}-stage" class="stage clip" data-start="0" data-duration="7" data-track-index="0">
${win(P, transcript(P, rows, {full:true}))}
${cap(`${P}-c1`, ['人の仕事は、','書くから','*「見る」','へ。'])}
${sub(`${P}-s1`, ['While the AI writes, your job is to watch.'])}
${cap(`${P}-c2`, ['でも、','*どの行','が変わったかは、見えない。'])}
${sub(`${P}-s2`, ['The transcript never shows which lines changed.'])}
</div>`, `
blink("#${P}-cur",0.2,6.9,tl);
words("#${P}-c1",0.6,tl,0.1); words("#${P}-s1",1.0,tl,0.05);
rise("#${P}-b0",0.8,tl,8); rise("#${P}-b1",1.1,tl,8);
rise("#${P}-w0",1.8,tl,8); rise("#${P}-w1",2.1,tl,8);
rise("#${P}-u0",2.8,tl,8); rise("#${P}-u1",3.1,tl,8); rise("#${P}-u2",3.25,tl,8);
rise("#${P}-th",3.9,tl,8);
unwords("#${P}-c1",3.4,tl); unwords("#${P}-s1",3.4,tl);
words("#${P}-c2",3.7,tl,0.1); words("#${P}-s2",4.1,tl,0.05);
flip("#${P}-u2 span",4.3,tl,{color:"#7f849c"},{color:"#d97757"},0.3);
flip("#${P}-u1 span",4.3,tl,{color:"#7f849c"},{color:"#d97757"},0.3);
flip("#${P}-u2 span",6.2,tl,{color:"#d97757"},{color:"#7f849c"},0.3);
flip("#${P}-u1 span",6.2,tl,{color:"#d97757"},{color:"#7f849c"},0.3);
unwords("#${P}-c2",6.6,tl); unwords("#${P}-s2",6.6,tl);
`);
}

// ===== 2 reveal(6 s):巻き戻して、窓を割り、右に計器盤(空の状態 = pane.tsx の文言そのまま)
{
  const P='rv';
  const rows=[['p0','p0'],['p1','p1'],[null,'e'],['i0','i0'],['i1','i1'],['i2','i2'],[null,'e'],['b0','b0'],['b1','b1'],['e1','e'],['w0','w0'],['w1','w1'],['e2','e'],['u0','u0'],['u1','u1'],['u2','u2'],['e3','e'],['th','th']];
  const pn = pane(P,{r0:focusEmpty,r1:importsEmpty,r2:depsEmpty,r4:intentEmpty,r5:headingEmpty,body:{e:emptyBody},r16:BLANK,r18:BLANK,r19:BLANK,r20:BLANK,r22:ops(false,false,false)}, 'opacity:0');
  scene('reveal',6, `<div id="${P}-stage" class="stage clip" data-start="0" data-duration="6" data-track-index="0">
${win(P, transcript(P, rows, {full:true}) + `<div class="vr" id="${P}-vr" style="opacity:0"></div>` + pn)}
${cap(`${P}-c1`, ['もう一度。','今度は、','*計器','を付けて。'])}
${sub(`${P}-s1`, ['Once more, with instruments.'])}
${cap(`${P}-c2`, ['*cockpit',' ― 右に 1 枚。','左の Claude Code は素のまま。'])}
${sub(`${P}-s2`, ['One pane on the right. Claude Code on the left stays untouched. No settings.'])}
</div>`, `
blink("#${P}-cur",0.2,5.9,tl);
blink("#${P}-cp .tri",1.7,5.9,tl);
words("#${P}-c1",0.3,tl,0.1); words("#${P}-s1",0.7,tl,0.05);
tl.to(["#${P}-th","#${P}-u2","#${P}-u1","#${P}-u0","#${P}-w1","#${P}-w0","#${P}-b1","#${P}-b0"],{opacity:0,duration:0.12,ease:"power2.in",stagger:0.05},0.5);
tl.to("#${P}-tx",{width:640,duration:0.6,ease:"power2.inOut"},1.3);
tl.to("#${P}-hr",{opacity:0,duration:0.1},1.3);
tl.set("#${P}-hr",{textContent:"${'─'.repeat(45)}"},1.5);
tl.to("#${P}-hr",{opacity:1,duration:0.2},1.6);
tl.fromTo("#${P}-vr",{opacity:1,scaleY:0},{opacity:1,scaleY:1,duration:0.5,ease:"expo.out"},1.6);
tl.fromTo("#${P}-cp",{opacity:0,x:60},{opacity:1,x:0,duration:0.6,ease:"expo.out"},1.7);
unwords("#${P}-c1",2.6,tl); unwords("#${P}-s1",2.6,tl);
words("#${P}-c2",2.9,tl,0.1); words("#${P}-s2",3.3,tl,0.05);
unwords("#${P}-c2",5.6,tl); unwords("#${P}-s2",5.6,tl);
`);
}

// ===== 3 stream(9 s):① Bash が記録され、Write が行単位で流れ、確定したら本当の差分
{
  const P='st';
  const rows=[['p0','p0'],['p1','p1'],[null,'e'],['i0','i0'],['i1','i1'],['i2','i2'],[null,'e'],['b0','b0',1],['b1','b1',1],['e1','e',1],['w0','w0',1],['w1','w1',1]];
  const body = {e:emptyBody, bash:bashBody('npm install zod',['','added 1 package, and audited 2 packages in 2s','found 0 vulnerabilities'])};
  for(let n=1;n<=13;n++) body['s'+n]=streamBody(VALIDATION,n);
  body.val = diffBody(DIFF_VALIDATION);
  const r5=[['e',headingEmpty],['bash',H_BASH],...Array.from({length:13},(_,i)=>['s'+(i+1),hStream('lib/validation.ts',i+1)]),['val',H_VAL]];
  const pn = pane(P,{
    r0:[['e',focusEmpty],['val',F_VAL]], r1:[['e',importsEmpty],['val',I_VAL]], r2:[['e',depsEmpty],['val',D_VAL]],
    r4:[['e',intentEmpty],['i',INTENT]], r5, body,
    r16:[['e',BLANK],['run',resultRow(11,1,[['running','型チェック',0],['running','テスト',0]])],['ok',resultRow(11,1,[['ok','型チェック','2.4'],['ok','テスト','1.0']])]],
    r18:[['e',BLANK],['bash',histBash({shown:true,...HB})],['val',histFile({shown:true,...HV})]],
    r19:[['e',BLANK],['val',histBash({shown:false,...HB})]], r20:BLANK,
    r22:[['e',ops(false,false,false)],['bash',ops(true,false,false)],['val',ops(true,true,false)]],
  });
  const lines = Array.from({length:13},(_,i)=>(1.9+i*0.34).toFixed(2));
  scene('stream',9, `<div id="${P}-stage" class="stage clip" data-start="0" data-duration="9" data-track-index="0">
${win(P, transcript(P, rows) + `<div class="vr"></div>` + pn)}
${lab(`${P}-l1`,'書かれている最中のコード',{x:LABX,y:ROWY(5)+1,ac:true,n:1})}
${cap(`${P}-c1`, ['書かれている','*最中','のコードが、','そのまま流れる。'])}
${sub(`${P}-s1`, ['Code streams in as the model writes it.'])}
${cap(`${P}-c2`, ['確定したら、','*本当の差分','。変わった行と前後だけ。'])}
${sub(`${P}-s2`, ['Once applied: the real diff. Changed lines and two lines of context.'])}
</div>`, `
blink("#${P}-cur",0.2,8.9,tl);
blink("#${P}-cp .tri",0.3,8.9,tl);
words("#${P}-c1",0.4,tl,0.1); words("#${P}-s1",0.8,tl,0.05);
pick("#${P}-r4-i",0.3,tl);
rise("#${P}-b0",0.3,tl,8); rise("#${P}-b1",0.6,tl,8);
pick("#${P}-r5-bash",0.6,tl); pick("#${P}-r6-bash",0.6,tl); ${Array.from({length:9},(_,i)=>`pick("#${P}-r${7+i}-bash",0.6,tl);`).join(' ')}
pick("#${P}-r18-bash",0.6,tl); pick("#${P}-r22-bash",0.6,tl);
rise("#${P}-w0",1.6,tl,8);
label("#${P}-l1",1.7,tl);
${lines.map((t,i)=>`pick("#${P}-r5-s${i+1}",${t},tl); ${Array.from({length:10},(_,r)=>`pick("#${P}-r${6+r}-s${i+1}",${t},tl);`).join(' ')}`).join('\n')}
unwords("#${P}-c1",5.8,tl); unwords("#${P}-s1",5.8,tl);
words("#${P}-c2",6.4,tl,0.1); words("#${P}-s2",6.8,tl,0.05);
unlabel("#${P}-l1",6.3,tl);
rise("#${P}-w1",6.5,tl,8);
swapTo("#${P}-r5-val",6.5,tl); ${Array.from({length:10},(_,r)=>`swapTo("#${P}-r${6+r}-val",6.5,tl);`).join(' ')}
swapTo("#${P}-r0-val",6.5,tl); swapTo("#${P}-r1-val",6.5,tl); swapTo("#${P}-r2-val",6.5,tl);
pick("#${P}-r16-run",6.6,tl); pick("#${P}-r18-val",6.6,tl); pick("#${P}-r19-val",6.6,tl); pick("#${P}-r22-val",6.6,tl);
pick("#${P}-r16-ok",7.9,tl); pop("#${P}-r16-ok",7.9,tl);
unwords("#${P}-c2",8.6,tl); unwords("#${P}-s2",8.6,tl);
`);
}

// ===== 4 deps(8 s):② 上 3 行。imports / dependents、増えた依存の +
{
  const P='dp';
  const rows=[['p0','p0'],['p1','p1'],[null,'e'],['i0','i0'],['i1','i1'],['i2','i2'],[null,'e'],['b0','b0'],['b1','b1'],[null,'e'],['w0','w0'],['w1','w1'],[null,'e'],['th','th']];
  const pn = pane(P,{r0:F_VAL,r1:I_VAL,r2:D_VAL,r4:INTENT,r5:H_VAL,body:{val:diffBody(DIFF_VALIDATION)},
    r16:resultRow(11,1,[['ok','型チェック','2.4'],['ok','テスト','1.0']]), r18:histFile({shown:true,...HV}), r19:histBash({shown:false,...HB}), r20:BLANK, r22:ops(true,true,false)});
  scene('deps',8, `<div id="${P}-stage" class="stage clip" data-start="0" data-duration="8" data-track-index="0">
${win(P, transcript(P, rows) + `<div class="vr"></div>` + pn)}
${lab(`${P}-l0`,'今触っているファイル',{x:LABX,y:ROWY(0)+1,ac:true,n:2})}
${lab(`${P}-l1`,'このファイルが使っているもの',{x:LABX,y:ROWY(1)+1})}
${lab(`${P}-l2`,'このファイルを使っているもの',{x:LABX,y:ROWY(2)+1})}
${cap(`${P}-c1`, ['編集した瞬間に、','そのファイルの','*依存','。'])}
${sub(`${P}-s1`, ['The moment a file is edited: what it imports, and who depends on it.'])}
${cap(`${P}-c2`, ['このセッションで','*増えた依存','には +。'])}
${sub(`${P}-s2`, ['A green + marks a dependency added in this session.'])}
</div>`, `
blink("#${P}-cur",0.2,7.9,tl);
blink("#${P}-cp .tri",0.2,7.9,tl);
words("#${P}-c1",0.4,tl,0.1); words("#${P}-s1",0.8,tl,0.05);
focusRows("#${P}-cp",["#${P}-r0","#${P}-r1","#${P}-r2"],0.5,tl);
label("#${P}-l0",0.8,tl); label("#${P}-l1",1.6,tl); label("#${P}-l2",2.6,tl);
unwords("#${P}-c1",4.6,tl); unwords("#${P}-s1",4.6,tl);
words("#${P}-c2",4.9,tl,0.1); words("#${P}-s2",5.3,tl,0.05);
unlabel("#${P}-l0",4.9,tl); unlabel("#${P}-l1",4.9,tl); unlabel("#${P}-l2",4.9,tl);
flip("#${P}-r1 .pm",5.2,tl,{scale:2.2,transformOrigin:"50% 50%"},{scale:1},0.5,"back.out(1.6)");
unfocusRows("#${P}-cp",7.2,tl);
unwords("#${P}-c2",7.6,tl); unwords("#${P}-s2",7.6,tl);
`);
}

// ===== 5 checks(10 s):③ 編集直後のチェック。parse が投げて ✗、safeParse で ✓
{
  const P='ck';
  const rows=[['p0','p0'],['p1','p1'],[null,'e'],['i0','i0'],['i1','i1'],['i2','i2'],[null,'e'],['b0','b0'],['b1','b1'],[null,'e'],['w0','w0'],['w1','w1'],[null,'e'],
    ['u0','u0',1],['u1','u1',1],['u2','u2',1],['e4','e',1],['v0','u0',1],['v1','u1',1],['v2','u2b',1],['e5','e',1],['th','th']];
  const pn = pane(P,{
    r0:[['val',F_VAL],['route',F_ROUTE]], r1:[['val',I_VAL],['route',I_ROUTE]], r2:[['val',D_VAL],['route',D_ROUTE]], r4:INTENT,
    r5:[['val',H_VAL],['r1',H_R1],['r2',H_R2]], body:{val:diffBody(DIFF_VALIDATION), r1:diffBody(DIFF_ROUTE1), r2:diffBody(DIFF_ROUTE2)},
    r16:[['val',resultRow(11,1,[['ok','型チェック','2.4'],['ok','テスト','1.0']])],
         ['r1run',resultRow(2,5,[['running','型チェック',0],['running','テスト',0]])],
         ['r1tc',resultRow(2,5,[['ok','型チェック','2.8'],['running','テスト',0]])],
         ['r1fail',resultRow(2,5,[['ok','型チェック','2.8'],['fail','テスト','1.1']],'ZodError: Invalid email')],
         ['r2run',resultRow(5,1,[['running','型チェック',0],['running','テスト',0]])],
         ['r2ok',resultRow(5,1,[['ok','型チェック','2.6'],['ok','テスト','1.0']])]],
    r17:[['a',`<span class="dim">${RULE}</span>`],['b',`<span class="dim">${ruleHid(0,1)}</span>`]],
    r18:[['val',histFile({shown:true,...HV})],['r1',histFile({shown:true,...HR1})],['r2',histFile({shown:true,...HR2})]],
    r19:[['val',histBash({shown:false,...HB})],['r1',histFile({shown:false,...HV})],['r2',histFile({shown:false,...HR1})]],
    r20:[['val',BLANK],['r1',histBash({shown:false,...HB})],['r2',histFile({shown:false,...HV})]],
    r22:ops(true,true,false)});
  const all = (k,t) => `swapTo("#${P}-r5-${k}",${t},tl); ${Array.from({length:10},(_,r)=>`swapTo("#${P}-r${6+r}-${k}",${t},tl);`).join(' ')} pick("#${P}-r18-${k}",${t},tl); pick("#${P}-r19-${k}",${t},tl); pick("#${P}-r20-${k}",${t},tl);`;
  scene('checks',10, `<div id="${P}-stage" class="stage clip" data-start="0" data-duration="10" data-track-index="0">
${win(P, transcript(P, rows) + `<div class="vr"></div>` + pn)}
${lab(`${P}-l1`,'編集直後の型チェックと関連テスト',{x:LABX-120,y:ROWY(16)+1,ac:true,n:3})}
${cap(`${P}-c1`, ['編集した','*直後','に、型チェックとテスト。'])}
${sub(`${P}-s1`, ['Right after each edit: typecheck and the related tests.'])}
${cap(`${P}-c2`, ['parse が例外を投げて、','テストが','*赤','。'])}
${sub(`${P}-s2`, ['parse() throws on bad input, so the test goes red.'])}
${cap(`${P}-c3`, ['safeParse に直して、','*緑','。壊れた瞬間に分かる。'])}
${sub(`${P}-s3`, ['Fixed with safeParse(). Green. You know the moment it breaks.'])}
</div>`, `
blink("#${P}-cur",0.2,9.9,tl);
blink("#${P}-cp .tri",0.2,9.9,tl);
words("#${P}-c1",0.4,tl,0.1); words("#${P}-s1",0.8,tl,0.05);
rise("#${P}-u0",0.3,tl,8); rise("#${P}-u1",0.8,tl,8); rise("#${P}-u2",0.95,tl,8);
swapTo("#${P}-r0-route",0.8,tl); swapTo("#${P}-r1-route",0.8,tl); swapTo("#${P}-r2-route",0.8,tl);
${all('r1',0.8)}
pick("#${P}-r16-r1run",0.9,tl);
focusRows("#${P}-cp",["#${P}-r16","#${P}-r5"],1.4,tl);
label("#${P}-l1",1.6,tl);
pick("#${P}-r16-r1tc",2.6,tl); pop("#${P}-r16-r1tc",2.6,tl);
unwords("#${P}-c1",3.6,tl); unwords("#${P}-s1",3.6,tl);
pick("#${P}-r16-r1fail",3.7,tl); pop("#${P}-r16-r1fail",3.7,tl);
words("#${P}-c2",4.0,tl,0.1); words("#${P}-s2",4.4,tl,0.05);
unlabel("#${P}-l1",4.0,tl);
unwords("#${P}-c2",6.2,tl); unwords("#${P}-s2",6.2,tl);
unfocusRows("#${P}-cp",6.3,tl);
rise("#${P}-v0",6.5,tl,8); rise("#${P}-v1",6.9,tl,8); rise("#${P}-v2",7.05,tl,8); rise("#${P}-th",7.6,tl,8);
${all('r2',6.9)}
pick("#${P}-r17-b",6.9,tl);
pick("#${P}-r16-r2run",7.0,tl);
words("#${P}-c3",6.5,tl,0.1); words("#${P}-s3",6.9,tl,0.05);
pick("#${P}-r16-r2ok",8.3,tl); pop("#${P}-r16-r2ok",8.3,tl);
unwords("#${P}-c3",9.6,tl); unwords("#${P}-s3",9.6,tl);
`);
}

// ===== 6 history(9 s):④ 履歴。行を押すとその時の画面。見ている間は新しい変更が来ても動かない
{
  const P='hs';
  const rows=[['p0','p0'],['p1','p1'],[null,'e'],['i0','i0'],['i1','i1'],['i2','i2'],[null,'e'],['b0','b0'],['b1','b1'],[null,'e'],['w0','w0'],['w1','w1'],[null,'e'],
    ['u0','u0'],['u1','u1'],['u2','u2'],[null,'e'],['v0','u0'],['v1','u1'],['v2','u2b'],[null,'e'],['th','th'],['e6','e',1],['t0','t0',1],['t1','t1',1],['t2','t2',1]];
  const pn = pane(P,{
    r0:[['route',F_ROUTE],['val',F_VAL]], r1:[['route',I_ROUTE],['val',I_VAL]], r2:[['route',D_ROUTE],['val',D_VAL]], r4:INTENT,
    r5:[['r2',H_R2],['val',H_VAL_H]], body:{r2:diffBody(DIFF_ROUTE2), val:diffBody(DIFF_VALIDATION)},
    r16:[['r2',resultRow(5,1,[['ok','型チェック','2.6'],['ok','テスト','1.0']])],['val',resultRow(11,1,[['ok','型チェック','2.4'],['ok','テスト','1.0']])]],
    r17:[['a',`<span class="dim">${ruleHid(0,1)}</span>`],['b',`<span class="dim">${ruleHid(1,1)}</span>`]],
    r18:[['r2',histFile({shown:true,...HR2})],['val',histFile({shown:false,...HR2})]],
    r19:[['r2',histFile({shown:false,...HR1})],['val',histFile({shown:false,...HR1})]],
    r20:[['r2',histFile({shown:false,...HV})],['val',histFile({shown:true,...HV})]],
    r22:[['r2',ops(true,true,false)],['val',ops(true,true,true)]]});
  scene('history',9, `<div id="${P}-stage" class="stage clip" data-start="0" data-duration="9" data-track-index="0">
${win(P, transcript(P, rows, {y:-30}) + `<div class="vr"></div>` + pn + `<div class="hl" id="${P}-hl" style="position:absolute;left:641px;right:0;top:${20*30}px;height:30px;background:#313244;opacity:0"></div>`)}
${lab(`${P}-l1`,'履歴',{x:LABX+200,y:ROWY(18)+1,ac:true,n:4})}
${ptr(`${P}-ptr`)}
${cap(`${P}-c1`, ['行を押すと、','*その時の画面','に戻る。'])}
${sub(`${P}-s1`, ['Click a row to go back to that moment: body, result, dependencies.'])}
${cap(`${P}-c2`, ['見ている間は、','新しい変更が来ても','*動かない','。'])}
${sub(`${P}-s2`, ['While you look back, new changes do not move the screen.'])}
</div>`, `
blink("#${P}-cur",0.2,8.9,tl);
blink("#${P}-cp .tri",0.2,8.9,tl);
words("#${P}-c1",0.4,tl,0.1); words("#${P}-s1",0.8,tl,0.05);
focusRows("#${P}-cp",["#${P}-r18","#${P}-r19","#${P}-r20","#${P}-r17"],0.5,tl);
label("#${P}-l1",0.8,tl);
tl.fromTo("#${P}-ptr",{opacity:0,x:1500,y:900},{opacity:1,x:1500,y:900,duration:0.1},1.45);
tl.to("#${P}-ptr",{x:800,y:722,duration:0.9,ease:"power2.inOut"},1.6);
tl.to("#${P}-ptr",{scale:0.85,duration:0.08,ease:"power2.in",transformOrigin:"10% 5%"},2.7);
tl.to("#${P}-ptr",{scale:1,duration:0.2,ease:"back.out(2)"},2.78);
tl.fromTo("#${P}-hl",{opacity:0},{opacity:1,duration:0.08},2.75);
tl.to("#${P}-hl",{opacity:0,duration:0.3},2.95);
unfocusRows("#${P}-cp",2.8,tl); unlabel("#${P}-l1",2.8,tl);
swapTo("#${P}-r5-val",2.85,tl); ${Array.from({length:10},(_,r)=>`swapTo("#${P}-r${6+r}-val",2.85,tl);`).join(' ')}
swapTo("#${P}-r0-val",2.85,tl); swapTo("#${P}-r1-val",2.85,tl); swapTo("#${P}-r2-val",2.85,tl);
pick("#${P}-r16-val",2.9,tl); pick("#${P}-r18-val",2.9,tl); pick("#${P}-r19-val",2.9,tl); pick("#${P}-r20-val",2.9,tl); pick("#${P}-r22-val",2.9,tl);
tl.to("#${P}-ptr",{x:1500,y:900,opacity:0,duration:0.6,ease:"power2.in"},3.6);
unwords("#${P}-c1",4.6,tl); unwords("#${P}-s1",4.6,tl);
words("#${P}-c2",5.0,tl,0.1); words("#${P}-s2",5.4,tl,0.05);
rise("#${P}-t0",5.6,tl,8); rise("#${P}-t1",5.9,tl,8); rise("#${P}-t2",6.05,tl,8);
scrollTo("#${P}-txin",5.6,tl,-150);
pick("#${P}-r17-b",6.0,tl);
flip("#${P}-r17-b",6.0,tl,{color:"#d97757"},{color:"#7f849c"},0.8);
unwords("#${P}-c2",8.6,tl); unwords("#${P}-s2",8.6,tl);
`);
}

// ===== 7 ops(9 s):o で VS Code の該当行、r r でリバート(Claude にも伝わる)
{
  const P='op';
  const rows=[['p0','p0'],['p1','p1'],[null,'e'],['i0','i0'],['i1','i1'],['i2','i2'],[null,'e'],['b0','b0'],['b1','b1'],[null,'e'],['w0','w0'],['w1','w1'],[null,'e'],
    ['u0','u0'],['u1','u1'],['u2','u2'],[null,'e'],['v0','u0'],['v1','u1'],['v2','u2b'],[null,'e'],['t0','t0'],['t1','t1'],['t2','t2'],['e7','e'],
    ['rv0','rv0',1],['rv1','rv1',1],['rv2','rv2',1],['e8','e',1],['ak','ak',1]];
  const pn = pane(P,{
    r0:[['h',F_VAL],['t',F_TEST]], r1:[['h',I_VAL],['t',I_TEST]], r2:[['h',D_VAL],['t',D_TEST]], r4:INTENT,
    r5:[['h',H_VAL_H],['t',H_T],['rv',H_T_RV]], body:{h:diffBody(DIFF_VALIDATION), t:diffBody(DIFF_TEST)},
    r16:[['h',resultRow(11,1,[['ok','型チェック','2.4'],['ok','テスト','1.0']])],['t',resultRow(3,0,[['ok','型チェック','2.2'],['ok','テスト','1.0']])],['run',resultRow(3,0,[['running','型チェック',0],['running','テスト',0]])],['ok',resultRow(3,0,[['ok','型チェック','2.3'],['ok','テスト','1.0']])]],
    r17:[['h',`<span class="dim">${ruleHid(1,1)}</span>`],['t',`<span class="dim">${ruleHid(0,2)}</span>`]],
    r18:[['h',histFile({shown:false,...HR2})],['t',histFile({shown:true,...HT})],['rv',histFile({shown:true,...HT,reverted:true})]],
    r19:[['h',histFile({shown:false,...HR1})],['t',histFile({shown:false,...HR2})]], r20:[['h',histFile({shown:true,...HV})],['t',histFile({shown:false,...HR1})]],
    r22:[['h',ops(true,true,true)],['t',ops(true,true,false)]]});
  const toLatest = (t) => `swapTo("#${P}-r5-t",${t},tl); ${Array.from({length:10},(_,r)=>`swapTo("#${P}-r${6+r}-t",${t},tl);`).join(' ')} swapTo("#${P}-r0-t",${t},tl); swapTo("#${P}-r1-t",${t},tl); swapTo("#${P}-r2-t",${t},tl); pick("#${P}-r16-t",${t},tl); pick("#${P}-r17-t",${t},tl); pick("#${P}-r18-t",${t},tl); pick("#${P}-r19-t",${t},tl); pick("#${P}-r20-t",${t},tl); pick("#${P}-r22-t",${t},tl);`;
  scene('ops',10, `<div id="${P}-stage" class="stage clip" data-start="0" data-duration="10" data-track-index="0">
${win(P, transcript(P, rows, {y:-150}) + `<div class="vr"></div>` + pn + `<div class="toast" id="${P}-toast" style="left:18px;width:604px;right:auto">VS Code で開きました: leads-api › tests/route.test.ts:13</div>`)}
${keys(`${P}-k0`, [[`${P}-kl`,'l']])}
${keys(`${P}-k1`, [[`${P}-ko`,'o']])}
${keys(`${P}-k2`, [[`${P}-kr1`,'r'],[`${P}-kr2`,'r']])}
${cap(`${P}-c1`, ['*o',' で、その変更を ','VS Code の該当行に。'])}
${sub(`${P}-s1`, ['o opens that change in VS Code, at the line.'])}
${cap(`${P}-c2`, ['*r',' を 2 回で、','直前の変更を戻す。','Claude にも伝わる。'])}
${sub(`${P}-s2`, ['r twice reverts the last change. Claude is told it was deliberate.'])}
</div>`, `
blink("#${P}-cur",0.2,9.9,tl);
blink("#${P}-cp .tri",0.2,9.9,tl);
keys("#${P}-k0",0.2,tl); press("#${P}-kl",0.5,tl);
${toLatest(0.75)}
unkeys("#${P}-k0",1.2,tl);
words("#${P}-c1",1.4,tl,0.1); words("#${P}-s1",1.8,tl,0.05);
keys("#${P}-k1",1.6,tl); press("#${P}-ko",1.9,tl);
tl.fromTo("#${P}-toast",{opacity:0,y:10},{opacity:1,y:0,duration:0.3,ease:"expo.out"},2.2);
tl.to("#${P}-toast",{opacity:0,duration:0.25,ease:"power3.in"},4.8);
unwords("#${P}-c1",5.2,tl); unwords("#${P}-s1",5.2,tl); unkeys("#${P}-k1",5.2,tl);
words("#${P}-c2",5.6,tl,0.1); words("#${P}-s2",6.0,tl,0.05);
keys("#${P}-k2",5.5,tl); press("#${P}-kr1",5.9,tl); press("#${P}-kr2",6.25,tl);
pick("#${P}-r5-rv",6.5,tl); pick("#${P}-r18-rv",6.5,tl); pop("#${P}-r18-rv",6.5,tl);
pick("#${P}-r16-run",6.5,tl);
rise("#${P}-rv0",6.8,tl,8); rise("#${P}-rv1",6.95,tl,8); rise("#${P}-rv2",7.1,tl,8);
scrollTo("#${P}-txin",6.8,tl,-270);
pick("#${P}-r16-ok",7.9,tl); pop("#${P}-r16-ok",7.9,tl);
rise("#${P}-ak",8.2,tl,8);
scrollTo("#${P}-txin",8.2,tl,-330);
unwords("#${P}-c2",9.6,tl); unwords("#${P}-s2",9.6,tl); unkeys("#${P}-k2",9.6,tl);
`);
}

// ===== 8 end(7 s):計器盤はそのまま。左にマークと install の 1 行
{
  const P='en';
  const rows=[['p0','p0'],['p1','p1'],[null,'e'],['i0','i0'],['i1','i1'],['i2','i2'],[null,'e'],['b0','b0'],['b1','b1'],[null,'e'],['w0','w0'],['w1','w1'],[null,'e'],
    ['u0','u0'],['u1','u1'],['u2','u2'],[null,'e'],['v0','u0'],['v1','u1'],['v2','u2b'],[null,'e'],['t0','t0'],['t1','t1'],['t2','t2'],['e7','e'],['rv0','rv0'],['rv1','rv1'],['rv2','rv2'],['e8','e'],['ak','ak']];
  const pn = pane(P,{r0:F_TEST, r1:I_TEST, r2:D_TEST, r4:INTENT, r5:H_T_RV, body:{t:diffBody(DIFF_TEST)},
    r16:resultRow(3,0,[['ok','型チェック','2.3'],['ok','テスト','1.0']]), r17:`<span class="dim">${ruleHid(0,2)}</span>`,
    r18:histFile({shown:true,...HT,reverted:true}), r19:histFile({shown:false,...HR2}), r20:histFile({shown:false,...HR1}), r22:ops(true,true,false)});
  const card = `<div id="${P}-card" style="position:absolute;left:0;top:0;width:640px;bottom:0;opacity:0">
  <div id="${P}-mark" class="mono" style="position:absolute;left:40px;top:150px;font:700 84px/100px 'JetBrains Mono';color:#cdd6f4"><span class="now">▶</span> cockpit</div>
  <div id="${P}-line" style="position:absolute;left:44px;top:270px;font:500 30px/44px 'Noto Sans JP';color:#a6adc8">AI が書くのを、計器で見る。</div>
  <div id="${P}-big" style="position:absolute;left:44px;top:330px;font:700 34px/50px 'Noto Sans JP';color:#cdd6f4"><span style="display:block">計器は 4 つ。</span><span style="display:block">操作は 2 つ。</span><span style="display:block">設定は無い。</span></div>
  <div class="mono" style="position:absolute;left:44px;top:520px;font:400 22px/32px 'JetBrains Mono';color:#cdd6f4;white-space:pre"><span class="dim">></span> <span id="${P}-cmd" data-type="/plugin install cockpit&#10;    --marketplace RintaroYamaoka/claude-cockpit"></span></div>
</div>`;
  scene('end',7, `<div id="${P}-stage" class="stage clip" data-start="0" data-duration="7" data-track-index="0">
${win(P, transcript(P, rows, {y:-330}) + card + `<div class="vr"></div>` + pn)}
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
