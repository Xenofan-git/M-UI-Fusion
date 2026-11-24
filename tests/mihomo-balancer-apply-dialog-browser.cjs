'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
const source=fs.readFileSync('web/mihomo-settings.js','utf8');
const css=fs.readFileSync('web/mihomo-settings.css','utf8');
const html=fs.readFileSync('web/index.html','utf8');
assert(html.includes('static/mihomo-settings.js?v=136'));
const slice=(start,end)=>{
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 assert(a>=0&&b>a,'cannot extract '+start);
 return source.slice(a,b);
};
const script=slice('  async function saveOutboundDraft(event){','  function rulePayloadHint(')+
 slice('  function openMihomoStatusDialog(kind){','  async function restartMihomoFromSettings(){')+
 '\nwindow.__saveBalancerDraft=saveOutboundDraft;';
const dict={
 'common.close':'Закрыть',
 'mh.operationApplying':'Применение параметров балансировщика…',
 'mh.operationApplyTitle':'Параметры балансировщика подготовлены',
 'mh.operationApplyReady':'Изменения добавлены в черновик. Нажмите «Сохранить», чтобы записать конфигурацию на сервер.',
 'mh.operationFailureTitle':'Не удалось выполнить операцию'
};
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  for(const width of [390,1440]){
   const page=await browser.newPage({viewport:{width,height:800}});
   await page.setContent('<!doctype html><html><head><meta charset="UTF-8"><style>'+css+'</style></head><body class="dark" style="--surface-modal:#161923;--text:#ececf2;--text-strong:#fff;--line:#383a4b"><button id="launch">Применить</button><div class="modal-backdrop open" id="mihomo-outbound-modal"><form id="mihomo-outbound-form"><input name="kind" value="group"></form><textarea id="outbound-yaml"></textarea></div></body></html>');
   await page.evaluate(translations=>{
     window.$=selector=>document.querySelector(selector);
     window.muiT=k=>translations[k]||k;
     window.outboundMode='yaml';
     window.editingOutbound='group-id';
     window.editingSubscriptionGroup=false;
     window.creatingSubscriptionGroup=false;
     window.editingOriginal={id:'group-id',name:'FOREIGN'};
     window.outboundBusy=false;
     window.draft={outbounds:[{id:'group-id',kind:'group',name:'FOREIGN',proxies:['Old']}],routingRules:[]};
     window.clone=x=>JSON.parse(JSON.stringify(x));
     window.setImportBusy=v=>window.outboundBusy=v;
     window.showImportError=v=>window.__importError=v;
     window.importRequest=x=>x;
     window.markDirty=()=>{window.__marked=(window.__marked||0)+1};
     window.closeModal=node=>node.classList.remove('open');
     window.MUIBalancerServers={teardown:()=>{},getExcluded:()=>null};
     window.api=(url,opts)=>new Promise((resolve,reject)=>{window.__apiCalls=(window.__apiCalls||0)+1;window.__resolve=resolve;window.__reject=reject;});
     document.querySelector('#launch').onclick=()=>{window.__pending=window.__saveBalancerDraft({preventDefault(){},currentTarget:document.querySelector('#mihomo-outbound-form')});};
   },dict);
   await page.addScriptTag({content:script});
   await page.locator('#launch').click();
   const status=page.locator('#mihomo-operation-status');
   assert.equal(await status.getAttribute('data-phase'),'pending');
   assert.equal(await page.locator('#mihomo-operation-title').innerText(),dict['mh.operationApplying']);
   await page.keyboard.press('Escape');
   assert.equal(await status.count(),1,'pending apply must remain visible');
   await page.evaluate(async()=>{
     window.__resolve({outbounds:[{kind:'group',name:'FOREIGN',type:'select',proxies:['New']}]});
     await window.__pending;
   });
   assert.equal(await status.getAttribute('data-phase'),'success',await page.locator('#mihomo-operation-message').innerText());
   assert.equal(await page.locator('#mihomo-operation-title').innerText(),dict['mh.operationApplyTitle']);
   assert.equal(await page.locator('#mihomo-operation-message').innerText(),dict['mh.operationApplyReady']);
   assert.equal(await page.evaluate(()=>window.draft.outbounds[0].proxies[0]),'New');
   assert.equal(await page.evaluate(()=>window.__marked),1);
   assert.equal(await page.evaluate(()=>document.querySelector('#mihomo-outbound-modal').classList.contains('open')),false);
   await status.waitFor({state:'detached',timeout:4200});
   assert.equal(await status.count(),0,'successful apply notice closes itself after 2.5s');
   await page.evaluate(()=>{
     document.querySelector('#mihomo-outbound-modal').classList.add('open');
     window.__marked=0;
   });
   await page.locator('#launch').click();
   await page.evaluate(async()=>{
     window.__reject(new Error('Parse invalid'));
     await window.__pending;
   });
   assert.equal(await status.getAttribute('data-phase'),'error');
   assert.equal(await page.locator('#mihomo-operation-message').innerText(),'Parse invalid');
   assert.equal(await page.evaluate(()=>window.__marked),0,'failed apply cannot mark draft modified');
   assert.equal(await page.evaluate(()=>document.querySelector('#mihomo-outbound-modal').classList.contains('open')),true);
   await page.keyboard.press('Escape');
   assert.equal(await status.count(),0);
   // The filter transaction is part of Apply: failure must keep the dialog
   // open, not report success or discard the unsaved fields.
   await page.evaluate(()=>{
     window.MUIBalancerServers.saveSourceSettings=async()=>{throw Error('Filter rejected')};
     window.__marked=0;
   });
   await page.locator('#launch').click();
   await page.evaluate(async()=>{
     window.__resolve({outbounds:[{kind:'group',name:'FOREIGN',type:'url-test',proxies:['Old']}]});
     await window.__pending;
   });
   assert.equal(await status.getAttribute('data-phase'),'error');
   assert.equal(await page.locator('#mihomo-operation-message').innerText(),'Filter rejected');
   assert.equal(await page.evaluate(()=>window.__marked),0);
   assert.equal(await page.evaluate(()=>document.querySelector('#mihomo-outbound-modal').classList.contains('open')),true);
   await page.locator('.mui-mihomo-status-actions button').click();
   // Successful filter save re-bases the group on fresh subscription
   // members. Stale members removed by the filter must not be restored.
   await page.evaluate(()=>{
     window.editingSubscriptionGroup=true;
     document.querySelector('#mihomo-outbound-form').insertAdjacentHTML('beforeend',
       '<select name="subscriptionIds" multiple><option value="sub1" selected>Source</option></select>');
     window.MUIBalancerServers.saveSourceSettings=async()=>true;
     window.MUIBalancerServers.getExcluded=()=>[];
     window.app={state:{state:{
       outbounds:[{kind:'proxy',name:'Live',sourceSubscriptionId:'sub1'}],
       outboundSubscriptions:[{id:'sub1',group:'FOREIGN'}]
     }}};
     window.refresh=async()=>{};
     window.__marked=0;
   });
   await page.locator('#launch').click();
   await page.evaluate(async()=>{
     window.__resolve({outbounds:[{kind:'group',name:'FOREIGN',type:'url-test',proxies:['Old']}]});
     await window.__pending;
   });
   assert.equal(await status.getAttribute('data-phase'),'success');
   assert.deepEqual(await page.evaluate(()=>window.draft.outbounds[0].proxies),['Live'],
     'old source members must be removed after filter updates');
   assert.equal(await page.evaluate(()=>window.__marked),1);
   console.log('PASS',width,'Apply group: modal success/error, source filters persisted, stale members rebased');
   await page.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
