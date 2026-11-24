'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const read=f=>fs.readFileSync('web/'+f,'utf8');
const css=['liquid-button.css','theme-shadcn.css','theme-md3.css','color-skins.css','action-button-feedback.css','mihomo-settings.css'].map(read).join('\n');
const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
const rgb=s=>s.match(/\d+/g).slice(0,3).map(Number);
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 await page.setContent('<html><head><style>'+css+'</style></head><body><form id="login-form"><button id="login-button" class="login-button" type="button">Войти</button></form><div id="outsub-modal"><form id="outsub-form"><button class="primary-btn" id="outsub-submit" type="button">Создать балансировщик</button></form></div><div class="modal-backdrop mui-dialog"><section class="mui-dialog-panel"><footer class="modal-footer"><button id="mui-dialog-cancel" class="outline-btn">Отмена</button><button class="danger-btn">Подтвердить</button></footer></section></div><form id="editor"><label class="mihomo-field"><span>Узлы</span><select name="proxies" multiple></select></label></form></body></html>');
 let n=0,min=Infinity;
 for(const theme of ['shadcn','md3','liquid'])for(const dark of [false,true])for(const skin of ['','graphite','ivory','emerald','aurora']){
  await page.evaluate(({theme,dark,skin})=>{const r=document.documentElement;r.setAttribute('data-ui-theme',theme);r.classList.toggle('dark',dark);r.setAttribute('data-theme',dark?'dark':'light');document.body.classList.toggle('dark',dark);if(skin)r.setAttribute('data-color-skin',skin);else r.removeAttribute('data-color-skin')},{theme,dark,skin});
  for(const sel of ['#login-button','#outsub-submit','.mui-dialog .outline-btn']){
   const b=page.locator(sel);
   for(const disabled of [false,true]){
    if(disabled&&sel.includes('outline-btn'))continue;
    await b.evaluate((e,d)=>e.disabled=d,disabled);
    const v=await b.evaluate(e=>{const s=getComputedStyle(e);return [s.webkitTextFillColor,s.backgroundColor,s.opacity,s.backgroundImage]});
    const a=lum(rgb(v[0])),z=lum(rgb(v[1])),ratio=(Math.max(a,z)+.05)/(Math.min(a,z)+.05);
    assert(ratio>=4.5&&v[2]==='1'&&v[3]==='none',JSON.stringify({theme,dark,skin,sel,disabled,v,ratio}));
    min=Math.min(min,ratio);n++;
   }
   await b.evaluate(e=>e.disabled=false);
  }
 }
 console.log('PASS button contrast',n,'states, minimum',min.toFixed(2));
 const source={id:'s1',name:'provider',group:'FOREIGN',filterExclude:'Russia',enabled:true,intervalMinutes:1440};
 const de='provider | Germany',ru='provider | Russia',fr='provider | France';
 const nodes=[{name:de,kind:'proxy',type:'ss'},{name:ru,kind:'proxy',type:'ss'},{name:fr,kind:'proxy',type:'ss',sourceSubscriptionId:'s1'}];
 await page.addScriptTag({content:read('country-flags.js')});
 await page.addScriptTag({content:read('mihomo-balancer-servers.js')});
 for(const name of ['RUSSIA','FOREIGN','Russia']){
  await page.evaluate(({name,source,nodes,de,ru,fr})=>{
   const form=document.querySelector('#editor');const isOrphan=name==='RUSSIA';
   const group={name,kind:'group',proxies:isOrphan?[de,ru]:name==='FOREIGN'?[fr]:[ru.replace('provider','RU')],subscriptionIds:name==='FOREIGN'?['s1']:[]};
   const candidates=name==='Russia'?[...nodes,{name:'RU | Russia',kind:'proxy',type:'ss'}]:nodes;
   form.elements.proxies.replaceChildren(...candidates.map(n=>new Option(n.name,n.name,false,group.proxies.includes(n.name))));
   window.__writes=[];
   window.fetch=async(u,o)=>{
    if(o?.method==='PUT'){window.__writes.push(JSON.parse(o.body));return{ok:true,json:async()=>({data:{}})};}
    return{ok:true,json:async()=>({data:{available:true,nodes:group.proxies.map(name=>({name,member:true,protocol:'ss'}))}})};
   };
   MUIBalancerServers.attach({form,group,subs:[source],outbounds:candidates,persistedName:name,isDirty:()=>false,afterRefresh:async()=>{}});
  },{name,source,nodes,de,ru,fr});
  if(name==='Russia'){assert(await page.locator('.fbs-options').isHidden());continue;}
  assert(await page.locator('.fbs-keep').isVisible(),name+' keep missing');
  assert(await page.locator('.fbs-drop').isVisible(),name+' drop missing');
  const rect=await page.locator('.fbs-keep').boundingBox(),table=await page.locator('.fbs-table-wrap').boundingBox();
  assert(rect.y>=table.y+table.height,name+' filters above table');
  if(name==='RUSSIA'){
   assert.equal(await page.locator('.fbs-table-body tr[data-node]').count(),2);
   await page.locator('.fbs-drop').fill('Germany');
   assert.equal(await page.locator('.fbs-table-body tr.fbs-row-filtered').count(),1);
   await page.locator('.fbs-source-save').click();
   await page.waitForFunction(()=>window.__writes.length===1);
   const req=await page.evaluate(()=>window.__writes[0]);
   assert.equal(req.sourceId,'');assert.equal(req.group,'RUSSIA');assert.equal(req.filterExclude,'Germany');
  }
 }
 console.log('PASS both subscription group editors, retained filter preview/save, manual group unchanged, filters below table');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
