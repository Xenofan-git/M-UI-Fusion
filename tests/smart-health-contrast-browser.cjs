'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
const html=fs.readFileSync('web/index.html','utf8'),js=fs.readFileSync('web/smart-health.js','utf8');
const start=html.indexOf('<div class="mihomo-pane" data-mihomo-pane="smart-health">'),end=html.indexOf('</div></div><div hidden>',start);
const markup=html.slice(start,end);
const styles=[...html.matchAll(/<link rel="stylesheet" href="static\/([^"?]+\.css)(?:\?[^"]+)?"([^>]*)>|<style>([\s\S]*?)<\/style>/g)];
const states=['normal','degraded','offline','core_unavailable','starting','pending','unknown','disabled'];
const catalog=[{id:'vk',name:'ВКонтакте',protocol:'HTTPS',host:'vk.com'}];
function rgb(s){return s.match(/[\d.]+/g).slice(0,3).map(Number)}
function lum(s){return rgb(s).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0)}
function contrast(a,b){const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 let checks=0,min=99;
 try{
 for(const skin of ['light','ivory','graphite','emerald','aurora'])for(const theme of ['shadcn','md3','liquid'])for(const width of [390,1440]){
  const dark=!['light','ivory'].includes(skin);
  const css=styles.filter(x=>!x[2]||!x[2].includes('data-ui-only=')||x[2].includes('data-ui-only="'+theme+'"')).map(x=>x[3]??fs.readFileSync('web/'+x[1],'utf8')).join('\n');
  const page=await browser.newPage({viewport:{width,height:900}});page.setDefaultTimeout(4000);
  await page.setContent('<html data-ui-theme="'+theme+'" data-color-skin="'+skin+'" data-theme="'+(dark?'dark':'light')+'"><head><style>'+css+'\nbody{margin:0;padding:8px}.view.active,.mihomo-pane{display:block!important}</style></head><body class="'+(dark?'dark':'')+'"><section class="view active" id="mihomo-settings-root"><button data-mihomo-tab="smart-health">Monitor</button>'+markup+'</section></body></html>');
  await page.evaluate(({catalog,states})=>{
   window.muiGetLang=()=> 'ru';window.api=async()=>({settings:{enabled:true,normalSeconds:180,degradedSeconds:60,offlineSeconds:10,services:['vk']},catalog,status:{mode:'normal',events:states.map(mode=>({mode,at:'2026-11-25T18:00:00Z'})),controls:[{id:'vk',ok:true,milliseconds:10}]}});
  },{catalog,states});
  await page.addScriptTag({content:js});
  await page.locator('[data-mihomo-tab="smart-health"]').click();await page.waitForFunction(()=>document.querySelector('#smart-health-mode').dataset.mode==='normal');
  const check=async(sel,bgSel=null)=>{
   const v=await page.locator(sel).first().evaluate((e,bgSel)=>{const s=getComputedStyle(e);return {fg:s.webkitTextFillColor||s.color,bg:getComputedStyle(bgSel?document.querySelector(bgSel):e).backgroundColor,opacity:s.opacity}},bgSel);
   const ratio=contrast(v.fg,v.bg);min=Math.min(min,ratio);checks++;
   assert(ratio>=4.5,skin+' '+theme+' '+width+' '+sel+' '+JSON.stringify(v)+' contrast '+ratio);assert.equal(v.opacity,'1');
  };
  await check('#smart-health-add');await check('#smart-health-save');
  await page.locator('#smart-health-add').hover();await check('#smart-health-add');
  await check('#smart-health-mode','.smart-health-general .basics-section-body');
  for(const state of states)await check('.smart-health-event-state[data-mode="'+state+'"]','.smart-health-journal .basics-section-body');
  await check('[data-smart-result="vk"]','.smart-health-catalog');
  assert.equal(await page.locator('#smart-health-enabled+span').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(0, 155, 119)');
  await page.locator('#smart-health-add').click();await check('#smart-health-editor-submit');await check('#smart-health-editor-cancel');
  await page.locator('#smart-health-editor-cancel').click();
  const bounds=await page.locator('#smart-health-root').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);
  await page.close();
 }
 console.log('PASS '+checks+' contrast checks across 30 skin/layout/viewport combinations; minimum '+min.toFixed(2)+':1');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
