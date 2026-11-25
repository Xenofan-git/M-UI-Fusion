'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const html=fs.readFileSync('web/index.html','utf8');
const head=html.slice(0,html.indexOf('</head>'));
const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
const rgb=s=>s.match(/\d+/g).slice(0,3).map(Number);
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 let count=0,min=Infinity;
 try{
  for(const theme of ['shadcn','md3','liquid']){
   const page=await browser.newPage({viewport:{width:1000,height:600},reducedMotion:'reduce'});
   const styles=Array.from(head.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>|<link\b[^>]*rel="stylesheet"[^>]*>/gi),m=>m[0]).filter(s=>!s.includes('data-ui-only=')||s.includes('data-ui-only="'+theme+'"')).map(s=>{
     if(s.startsWith('<style'))return s;
     const f=s.match(/href="static\/([^"?]+)/)?.[1];return f?'<style>'+fs.readFileSync('web/'+f,'utf8')+'</style>':'';
   }).join('\n');
   const button=html.match(/<button class="danger-btn" id="mihomo-restart">[\s\S]*?<\/button>/)[0];
   await page.setContent('<!doctype html><html data-ui-theme="'+theme+'"><head>'+styles+'</head><body><div id="mihomo-settings-root" class="mihomo-settings-page"><div class="mihomo-actionbar">'+button+'</div></div></body></html>');
   const b=page.locator('#mihomo-restart');
   for(const dark of [false,true])for(const skin of ['','graphite','ivory','emerald','aurora']){
    await page.evaluate(({dark,skin})=>{const r=document.documentElement;r.setAttribute('data-theme',dark?'dark':'light');document.body.classList.toggle('dark',dark);if(skin)r.setAttribute('data-color-skin',skin);else r.removeAttribute('data-color-skin')},{dark,skin});
    const check=async(phase)=>{
     const s=await b.evaluate(e=>{const c=getComputedStyle(e);return {text:c.webkitTextFillColor,bg:c.backgroundColor,img:c.backgroundImage,opacity:c.opacity,visibility:c.visibility,display:c.display,hover:e.matches(':hover'),active:e.matches(':active')}});
     const a=lum(rgb(s.text)),z=lum(rgb(s.bg)),ratio=(Math.max(a,z)+.05)/(Math.min(a,z)+.05);
     assert(ratio>=4.5&&s.opacity==='1'&&s.img==='none'&&s.visibility==='visible'&&s.display!=='none',JSON.stringify({theme,dark,skin,phase,s,ratio}));
     if(phase==='hover')assert(s.hover,JSON.stringify({theme,dark,skin,phase,s}));if(phase==='active')assert(s.active,JSON.stringify({theme,dark,skin,phase,s}));
     min=Math.min(min,ratio);count++;
    };
    await b.evaluate(e=>{e.disabled=false;e.blur()});await page.mouse.move(980,580);await check('normal');
    await b.hover();await check('hover');
    await page.mouse.down();await check('active');await page.mouse.up();
    await page.mouse.move(980,580);await b.focus();await check('focus');
    await b.evaluate(e=>e.disabled=true);await check('disabled');await b.hover();await check('disabled hover');
   }
   await page.close();
  }
  console.log('PASS Restart Mihomo',count,'states, minimum contrast',min.toFixed(2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
