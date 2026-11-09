import fs from "node:fs"; import path from "node:path";
const css = fs.readFileSync("src/chrome.css","utf8"); const lib = fs.readFileSync("src/lib.js","utf8");
const dir=process.env.SCENES||"src/scenes"; const out="compositions";
for (const f of fs.readdirSync(dir).filter(f=>f.endsWith(".html")).sort()) {
  const id = f.replace(/^\d+-/,"").replace(/\.html$/,"");
  const src = fs.readFileSync(path.join(dir,f),"utf8");
  const [markup, script=""] = src.split("<!--SCRIPT-->");
  const html = `<template>
<style>
${css}
</style>
<div id="root" data-composition-id="${id}" data-width="1920" data-height="1080">
${markup.trim()}
</div>
<script>
${lib}
(function(){
const tl = gsap.timeline({ paused: true });
${script.trim()}
window.__timelines["${id}"] = tl;
})();
</script>
</template>
`;
  fs.writeFileSync(path.join(out, id+".html"), html);
  console.log("wrote", id);
}
