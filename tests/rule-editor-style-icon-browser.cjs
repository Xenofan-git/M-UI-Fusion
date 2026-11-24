'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const html=fs.readFileSync('web/index.html','utf8'),head=html.slice(0,html.indexOf('</head>'));
const js=fs.readFileSync('web/mihomo-settings.js','utf8');
const start=js.indexOf('ruleModal.innerHTML='),end=js.indexOf(';\n    document.body.appendChild(ruleModal);',start);
const markup=vm.runInNewContext(js.slice(start+'ruleModal.innerHTML='.length,end),{SF:()=>'',ruleTypes:['DOMAIN','GEOIP','MATCH'],ruleHelpButton:()=>'<button type="button" class="mihomo-rule-help-trigger" aria-expanded="false">!</button>'});
const tab=name=>html.match(new RegExp('<button[^>]*data-mihomo-tab="'+name+'"[^>]*>[\\s\\S]*?</button>'))[0];
const paths=t=>Array.from(t.matchAll(/<path d="([^"]+)"/g),m=>m[1]);
assert.deepEqual(paths(tab('subscriptions')),[...paths(tab('balancers')),'M12 8v8m-3-3 3 3 3-3']);
const lum=s=>s.match(/\d+/g).slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
(async()=>{
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
let count=0,min=Infinity;
try{
for(const theme of ['shadcn','md3','liquid']){
 const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
 const styles=Array.from(head.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>|<link\b[^>]*rel="stylesheet"[^>]*>/gi),m=>m[0]).filter(s=>!s.includes('data-ui-only=')||s.includes('data-ui-only="'+theme+'"')).map(s=>{
 if(s.startsWith('<style'))return s; const f=s.match(/href="static\/([^"?]+)/)?.[1];return f?'<style>'+fs.readFileSync('web/'+f,'utf8')+'</style>':'';
 }).join('\n');
 await page.setContent('<!doctype html><html data-ui-theme="'+theme+'"><head>'+styles+'</head><body><div class="modal-backdrop open" id="mihomo-rule-modal">'+markup+'</div></body></html>');
 const badge=page.locator('#mihomo-rule-type-field .mihomo-rule-help-trigger');
 for(const dark of [false,true])for(const skin of ['','graphite','ivory','emerald','aurora']){
  await page.evaluate(({dark,skin})=>{const r=document.documentElement;r.setAttribute('data-theme',dark?'dark':'light');document.body.classList.toggle('dark',dark);if(skin)r.setAttribute('data-color-skin',skin);else r.removeAttribute('data-color-skin')},{dark,skin});
  const contrast=async(sel,phase,backgroundSel)=>{
   const v=await page.locator(sel).first().evaluate((e,bgSel)=>{const c=getComputedStyle(e);return {fg:c.webkitTextFillColor,bg:bgSel?getComputedStyle(document.querySelector(bgSel)).backgroundColor:c.backgroundColor,opacity:c.opacity,visible:c.visibility}},backgroundSel);
   const a=lum(v.fg),b=lum(v.bg),r=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
   assert(r>=4.5&&v.opacity==='1'&&v.visible==='visible',JSON.stringify({theme,dark,skin,sel,phase,v,r}));min=Math.min(min,r);count++;
  };
  await badge.evaluate(e=>{e.setAttribute('aria-expanded','false');e.blur()});await page.mouse.move(1,1);
  await contrast('#mihomo-rule-type-field .mihomo-rule-help-trigger','normal');
  await badge.hover();await contrast('#mihomo-rule-type-field .mihomo-rule-help-trigger','hover');
  await page.mouse.down();await contrast('#mihomo-rule-type-field .mihomo-rule-help-trigger','active');await page.mouse.up();
  await page.mouse.move(1,1);await badge.focus();await contrast('#mihomo-rule-type-field .mihomo-rule-help-trigger','focus');
  await badge.evaluate(e=>{e.blur();e.setAttribute('aria-expanded','true')});await contrast('#mihomo-rule-type-field .mihomo-rule-help-trigger','pinned');
  await contrast('#mihomo-rule-conditions-title','heading','#mihomo-rule-conditions');
  await contrast('#mihomo-rule-form textarea[name=geoCategories]','field');
  await contrast('#mihomo-rule-type-field select','select');
  await contrast('#mihomo-rule-form .mihomo-form-note','note');
  await contrast('#mihomo-geo-picker-open','category');
 }
 await page.close();
}
console.log('PASS palette contrast',count,'checks, minimum',min.toFixed(2),'; shared SVG paths + center arrow');
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
