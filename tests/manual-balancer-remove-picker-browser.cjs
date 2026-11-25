'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
const read=f=>fs.readFileSync('web/'+f,'utf8');
const html=read('index.html'),head=html.slice(0,html.indexOf('</head>'));
const lum=s=>s.match(/\d+/g).slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
const ratio=(x,y)=>(Math.max(lum(x),lum(y))+.05)/(Math.min(lum(x),lum(y))+.05);
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
 const styles=Array.from(head.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>|<link\b[^>]*rel="stylesheet"[^>]*>/gi),m=>m[0]).map(s=>s.startsWith('<style')?s:'<style '+(s.match(/data-ui-only="[^"]+"/)?.[0]||'')+'>'+read(s.match(/href="static\/([^"?]+)/)[1])+'</style>').join('\n');
 await page.setContent('<!doctype html><html><head>'+styles+'</head><body><div id="mihomo-outbound-modal" class="modal-backdrop open"><section class="modal-panel mihomo-modal"><form id="editor"><label class="mihomo-field"><span>Узлы</span><select name="proxies" multiple></select></label></form></section></div></body></html>');
 await page.addScriptTag({content:read('country-flags.js')});
 await page.addScriptTag({content:read('mihomo-balancer-servers.js')});
 await page.evaluate(()=>{
  window.__nodes=[{name:'Germany A',kind:'proxy',type:'vless'},{name:'Russia B',kind:'proxy',type:'ss'},{name:'Poland C',kind:'proxy',type:'hysteria2'}];
  window.__group={kind:'group',name:'Manual',proxies:['Germany A','Russia B']};
  window.__calls=[];window.fetch=async(u,o)=>{window.__calls.push(o?.method||'GET');return{ok:true,json:async()=>({data:{available:true,nodes:__group.proxies.map(name=>({name,member:true,alive:true}))}})}};
  const nativeInterval=window.setInterval;window.setInterval=(fn,ms,...args)=>{if(ms===60000){window.__tick=fn;return 1;}return nativeInterval(fn,ms,...args)};
  window.__attach=(sub=false)=>{
   const form=document.querySelector('#editor'),group=sub?{...__group,subscriptionIds:['s']}:__group;
   const nodes=__nodes.map(x=>({...x,sourceSubscriptionId:sub?'s':''}));
   form.elements.proxies.replaceChildren(...nodes.map(n=>new Option(n.name,n.name,false,group.proxies.includes(n.name))));
   MUIBalancerServers.attach({form,group,subs:sub?[{id:'s',name:'source'}]:[],outbounds:nodes,persistedName:group.name,updateDefaults:()=>{window.__defaults=[...form.elements.proxies.selectedOptions].map(o=>o.value)}});
  };
  __attach();
 });
 const row=name=>page.locator('.fbs-table-body tr[data-node="'+name+'"]');
 const members=()=>page.locator('#editor select[name=proxies]').evaluate(e=>[...e.selectedOptions].map(o=>o.value));
 await row('Germany A').waitFor();
 assert.equal(await page.locator('.fbs-remove-member').count(),2);
 await page.locator('.fbs-add-toggle').click();
 const menu=page.locator('.fbs-add-menu'),item=page.locator('.fbs-add-result').first();
 let checks=0;
 for(const theme of ['shadcn','md3','liquid'])for(const dark of [false,true])for(const skin of ['','graphite','ivory','emerald','aurora']){
  await page.evaluate(({theme,dark,skin})=>{const r=document.documentElement;r.setAttribute('data-ui-theme',theme);r.setAttribute('data-theme',dark?'dark':'light');document.body.classList.toggle('dark',dark);if(skin)r.setAttribute('data-color-skin',skin);else r.removeAttribute('data-color-skin');for(const el of document.querySelectorAll('style[data-ui-only]'))el.sheet.disabled=el.dataset.uiOnly!==theme;},{theme,dark,skin});
  const bg=await menu.evaluate(e=>getComputedStyle(e).backgroundColor);
  if((!dark&&!skin)||skin==='ivory')assert.equal(bg,'rgb(255, 255, 255)',JSON.stringify({theme,dark,skin,bg}));
  await page.mouse.move(1,1);
  const check=async()=>{
    const v=await item.evaluate(e=>{const s=getComputedStyle(e),t=getComputedStyle(e.querySelector('.fbs-add-name'));return [s.backgroundColor,t.webkitTextFillColor,t.fontSize,e.offsetHeight]});
    assert(v[2]==='15px'&&v[3]>=40&&ratio(v[0],v[1])>=4.5,JSON.stringify({theme,dark,skin,v}));
    checks++;
  };
  await check();await item.hover();await check();
  const cross=page.locator('.fbs-remove-member').first();
  const v=await cross.evaluate(e=>{const s=getComputedStyle(e);return [s.backgroundColor,s.webkitTextFillColor,s.opacity]});
  assert(v[2]==='1'&&ratio(v[0],v[1])>=4.5,JSON.stringify({theme,dark,skin,v}));checks++;
 }
 await row('Germany A').locator('.fbs-remove-member').click();
 assert.equal(await row('Germany A').count(),0);
 assert.deepEqual(await members(),['Russia B']);
 assert.deepEqual(await page.evaluate(()=>window.__defaults),['Russia B']);
 assert(await page.locator('.fbs-add-result').filter({hasText:'Germany A'}).isVisible());
 await page.evaluate(()=>__tick());
 await page.waitForTimeout(80);
 assert.equal(await row('Germany A').count(),0,'poll restored removed member');
 await page.locator('.fbs-add-result').filter({hasText:'Germany A'}).click();
 assert.equal(await row('Germany A').count(),1);
 assert.deepEqual(await members(),['Germany A','Russia B']);
 await row('Russia B').locator('.fbs-remove-member').click();
 await row('Germany A').locator('.fbs-remove-member').click();
 assert.equal(await page.locator('.fbs-empty-row td').getAttribute('colspan'),'6');
 assert.deepEqual(await members(),[]);
 assert.deepEqual(await page.evaluate(()=>__group.proxies),['Germany A','Russia B']);
 assert(await page.evaluate(()=>__calls.every(x=>x==='GET')));
 await page.evaluate(()=>__attach());
 assert.deepEqual(await members(),['Germany A','Russia B']);
 await page.evaluate(()=>__attach(true));
 assert.equal(await page.locator('.fbs-remove-member').count(),0);
 assert.equal(await page.locator('.fbs-table th').count(),5);
 console.log('PASS manual remove/re-add, cancel, poll, empty group, subscribed unchanged;',width,checks,'appearance checks');
 await page.close();
 }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
