'use strict';
// Regression for an actual field report: USA nodes stay bright after adding
// "США" below already-saved RU exclusions. No backend writes before Apply.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright-core');
const web=path.resolve(__dirname,'../web');
const source=fs.readFileSync(path.join(web,'mihomo-balancer-servers.js'),'utf8');
const html=fs.readFileSync(path.join(web,'index.html'),'utf8');
assert(html.includes('static/mihomo-balancer-servers.js?v=130'));
const script=source.replace(' function renderRows(){',
 ' function renderRows(){window.__renderCount=(window.__renderCount||0)+1;')
 .replace(/\}\)\(\);\s*$/,'window.__filterDebug={renderRows,items:()=>items};})();');
assert(script!==source,'cannot inject test');
const savedRU='🇷🇺\nМосква\nМСК\nСанкт-Петербург\nРоссия';
const names=Array.from({length:119},(_,i)=>
  i<17
  ?'quatro-vpn | 🇺🇸 ⚡ ⭐ 0.1X - LTE №'+String(i+63)+' - США· '+(i%2?'Эшберн':'Денвер')
  :'quatro-vpn | 🇩🇪 LTE №'+String(i+1)+' - Германия');
const filtered=Array.from({length:14},(_,i)=>({
 name:'quatro-vpn | 🇷🇺 LTE №'+(i+1)+' - Россия',
 protocol:'vless',sourceId:'sub1',countryCode:'RU',member:false,
 filtered:true,alive:null
}));
const records=names.map((name,index)=>({
 name,protocol:'vless',
 // One server without an upstream sourceId must still be filtered via
 // the unambiguous provider prefix in a single-subscription group.
 sourceId:index===0?'stale-status-source':index===1?'':'sub1',
 countryCode:index===0?'DE':index===1?'':index<17?'US':'DE',
 member:true,alive:true,delay:25
}));
const nodeOutbounds=names.slice(1).map(name=>({
 id:'n-'+name,kind:'proxy',type:'vless',name,sourceSubscriptionId:'sub1'
}));
const group={id:'g1',name:'FOREIGN',kind:'group',type:'url-test',
 proxies:names,subscriptionIds:['sub1']};
const sub={id:'sub1',name:'quatro-vpn',group:'FOREIGN',filterKeep:'',
 filterExclude:savedRU,enabled:true,intervalMinutes:1440};
const tmp=path.join(web,'.usa-filter-preview-test.html');
(async()=>{
 let browser;
 fs.writeFileSync(tmp,'<!DOCTYPE html><html><head><meta charset="utf-8">'+
 '<link rel="stylesheet" href="mihomo-settings.css"></head><body class="dark">'+
 '<form id="editor"><label class="mihomo-field"><span>Узлы</span>'+
 '<select name="proxies" multiple></select></label></form>'+
 '<script src="country-flags.js"></script></body></html>');
 try{
  browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',
   headless:true,args:['--no-sandbox','--allow-file-access-from-files']});
  for(const width of [390,1440]){
   const page=await browser.newPage({viewport:{width,height:900}});
   page.setDefaultTimeout(6000);
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(pathToFileURL(tmp).href);
   await page.evaluate(({names,records,filtered})=>{
     window.__statusRequests=0;window.__putRequests=0;
     window.fetch=async(url,options)=>{
       if(options?.method==='PUT'){
         window.__putRequests++;
         return {ok:true,json:async()=>({data:{}})};
       }
       if(String(url).includes('/subscriptions/preview'))
         return {ok:true,json:async()=>({data:{nodes:[]}})};
       window.__statusRequests++;
       return {ok:true,json:async()=>({data:{
         candidate:names[0],available:true,nodes:[...records,...filtered]
       }})};
     };
   },{names,records,filtered});
   await page.addScriptTag({content:script});
   await page.evaluate(()=>{
     window.__countryLookupCalls=0;
     const flags=window.MUICountryFlags;
     const original=flags.fromFilterLine;
     flags.fromFilterLine=function(...args){
       window.__countryLookupCalls++;
       return original.apply(this,args);
     };
   });
   const initialPerf=await page.evaluate(({group,sub,nodes,names})=>{
     const form=document.querySelector('#editor');
     for(const name of names){
       const opt=new Option(name,name);opt.selected=true;
       form.elements.proxies.add(opt);
     }
     const start=performance.now();
     window.MUIBalancerServers.attach({
       form,group,subs:[sub],outbounds:nodes,isDirty:()=>false,
       persistedName:group.name,updateDefaults:()=>{},afterRefresh:async()=>{}
     });
     return {elapsed:performance.now()-start,lookups:window.__countryLookupCalls};
   },{group,sub,nodes:nodeOutbounds,names});
   assert(initialPerf.elapsed<2500,
     'opening 119-node balancer must not block Chromium for seconds: '+JSON.stringify(initialPerf));
   assert(initialPerf.lookups<=20,
     'country conditions must be compiled once, not once per comparison: '+JSON.stringify(initialPerf));
   await page.waitForFunction(()=>document.querySelectorAll('tr[data-node]').length===133);
   assert((await page.evaluate(()=>window.__countryLookupCalls))<=20,
     'runtime refresh must use the same compiled condition cache');
   await page.locator('[data-sub-pane=filters]').click();
   assert.equal(await page.locator('tr.fbs-row-filtered[data-node]').count(),14);
   assert.equal(await page.locator('.fbs-filtered-divider').count(),1);
   assert.match((await page.locator('.fbs-show-count').innerText()),/отфильтровано 14/);
   const firstUSA=page.locator('tr[data-node*="США"]').first();
   assert.equal(await firstUSA.evaluate(el=>el.classList.contains('fbs-row-filtered')),false);
   const existingRows=await page.locator('tr[data-node]').evaluateAll(rows=>rows.map(row=>row.dataset.node));
   const inputExclude=async value=>page.locator('.fbs-drop').fill(value);
   // Actual keyboard input (not synthetic dispatchEvent), including the
   // intermediate prefix "С" and "СШ" typed into the visible textarea.
   await inputExclude(savedRU+'\n');
   const beforeTypingRender=await page.evaluate(()=>window.__renderCount);
   await page.locator('.fbs-drop').pressSequentially('США');
   assert.equal(await page.evaluate(()=>window.__renderCount),beforeTypingRender,
     'typing must not perform a full table render, even once per character');
   assert.equal(await page.locator('tr.fbs-row-filtered[data-node]').count(),31,
     '17 USA plus 14 RU must immediately turn muted/struck-through');
   assert.equal(await page.locator('.fbs-filtered-divider').count(),0,
     'do not regroup until Apply');
   assert.deepEqual(await page.locator('tr[data-node]').evaluateAll(rows=>rows.map(row=>row.dataset.node)),existingRows,
     'no nodes may change their order during typing');
   assert.equal(await firstUSA.evaluate(el=>getComputedStyle(el.querySelector('.fbs-node-name')).textDecorationLine.includes('line-through')),true);
   assert.match(await page.locator('.fbs-show-count').innerText(),/отфильтровано 31.*предпросмотр/);
   assert.equal(await page.evaluate(()=>window.__putRequests),0);
   await inputExclude(savedRU);
   assert.equal(await page.locator('tr.fbs-row-filtered[data-node]').count(),14,
     'removing USA restores 17 US nodes immediately');
   await inputExclude(savedRU+'\n🇺🇸');
   assert.equal(await page.locator('tr.fbs-row-filtered[data-node]').count(),31,
     'Unicode USA flag must behave like USA/RU country aliases');
   await inputExclude(savedRU+'\nСША');
   await page.evaluate(()=>window.MUIBalancerServers.saveSourceSettings());
   assert.equal(await page.locator('.fbs-filtered-divider').count(),1,
     'after successful Save excluded members are now grouped');
   assert.equal(await page.locator('tr.fbs-row-filtered[data-node]').count(),31);
   assert.equal(await page.evaluate(()=>window.__putRequests),1);
   assert.equal(errors.length,0,JSON.stringify(errors));
   console.log('PASS initial editor attach in '+initialPerf.elapsed.toFixed(1)+'ms and '+initialPerf.lookups+
     ' country lookups; USA filter preview 133 nodes, no reorder before Apply',width);
   await page.close();
  }
 }finally{await browser?.close();fs.rmSync(tmp,{force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
