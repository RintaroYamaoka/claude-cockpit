// shared helpers (inlined into every scene)
function words(sel, at, tl, step){ step = step||0.07;
  tl.fromTo(sel+" span",{opacity:0,filter:"blur(8px)"},{opacity:1,filter:"blur(0px)",duration:0.2,ease:"power2.out",stagger:step},at); }
function unwords(sel, at, tl){ tl.to(sel+" span",{opacity:0,filter:"blur(6px)",duration:0.16,ease:"power3.in",stagger:0.03},at); }
function typeIn(sel, at, tl, cps){ cps = cps||22; const el=document.querySelector(sel); if(!el) return at;
  const txt=el.getAttribute("data-type")||""; el.innerHTML=""; const frag=document.createDocumentFragment();
  for(const c of txt){ const s=document.createElement("span"); s.className="ch"; s.textContent=c; frag.appendChild(s);} el.appendChild(frag);
  const dur=txt.length/cps; tl.fromTo(sel+" .ch",{opacity:0},{opacity:1,duration:0.01,stagger:dur/Math.max(1,txt.length)},at); return at+dur; }
function show(sel, at, tl, dur){ tl.fromTo(sel,{opacity:0},{opacity:1,duration:dur||0.25,ease:"power2.out"},at); }
function hide(sel, at, tl, dur){ tl.to(sel,{opacity:0,duration:dur||0.2,ease:"power3.in"},at); }
function rise(sel, at, tl, dy){ tl.fromTo(sel,{opacity:0,y:dy||18},{opacity:1,y:0,duration:0.5,ease:"expo.out"},at); }
function press(sel, at, tl){ tl.fromTo(sel,{scale:1},{scale:0.9,duration:0.08,ease:"power2.in",immediateRender:false},at)
  .to(sel,{scale:1,duration:0.22,ease:"back.out(2)"},at+0.08)
  .fromTo(sel,{backgroundColor:"#fab387",color:"#1e1e2e"},{backgroundColor:"#1e1e2e",color:"#cdd6f4",duration:0.5,ease:"power2.out",immediateRender:false},at+0.08); }
// flip: a later change on a visible element (no immediateRender)
function flip(sel, at, tl, from, to, dur, ease){ to.duration=dur||0.35; to.ease=ease||"power2.out"; to.immediateRender=false; tl.fromTo(sel,from,to,at); }
function keys(sel, at, tl){ tl.fromTo(sel,{opacity:0,y:10},{opacity:1,y:0,duration:0.3,ease:"power2.out"},at); }
function unkeys(sel, at, tl){ tl.to(sel,{opacity:0,duration:0.2,ease:"power3.in"},at); }
function pop(sel, at, tl){ tl.fromTo(sel,{scale:0,opacity:0},{scale:1,opacity:1,duration:0.35,ease:"back.out(1.6)"},at); }
function swapIn(sel, at, tl){ tl.fromTo(sel,{opacity:0,filter:"blur(8px)"},{opacity:1,filter:"blur(0px)",duration:0.22,ease:"power2.out"},at); }
function swapOut(sel, at, tl){ tl.to(sel,{opacity:0,filter:"blur(8px)",duration:0.18,ease:"power3.in"},at); }
function blink(sel, at, until, tl){ for(let t=at;t<until;t+=1.0){ tl.set(sel,{opacity:1},t); tl.set(sel,{opacity:0},Math.min(t+0.5,until)); } }
// cockpit: variants of one row. pick = hard switch, swapTo = blur swap (0.2 s)
function pick(sel, at, tl){ const el=document.querySelector(sel); if(!el) return; const sib=el.parentElement.querySelectorAll(".v");
  tl.set(sib,{opacity:0},at); tl.set(sel,{opacity:1},at); }
function swapTo(sel, at, tl){ const el=document.querySelector(sel); if(!el) return; const sib=[...el.parentElement.querySelectorAll(".v")].filter(x=>x!==el);
  tl.to(sib,{opacity:0,filter:"blur(6px)",duration:0.16,ease:"power3.in"},at);
  tl.fromTo(sel,{opacity:0,filter:"blur(6px)"},{opacity:1,filter:"blur(0px)",duration:0.22,ease:"power2.out"},at+0.1); }
// dim everything in a container except the given rows
function focusRows(container, keep, at, tl){ const rows=[...document.querySelectorAll(container+" > .ln")].filter(r=>!keep.includes("#"+r.id));
  tl.to(rows,{opacity:0.22,duration:0.4,ease:"power2.inOut"},at); }
function unfocusRows(container, at, tl){ tl.to(container+" > .ln",{opacity:1,duration:0.4,ease:"power2.inOut"},at); }
function label(sel, at, tl){ tl.fromTo(sel,{opacity:0,x:10},{opacity:1,x:0,duration:0.35,ease:"expo.out"},at); }
function unlabel(sel, at, tl){ tl.to(sel,{opacity:0,duration:0.2,ease:"power3.in"},at); }
function scrollTo(sel, at, tl, y){ tl.to(sel,{y:y,duration:0.3,ease:"power2.out"},at); }
