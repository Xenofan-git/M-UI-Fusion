'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
const source=fs.readFileSync('web/mihomo-settings.js','utf8');
const html=fs.readFileSync('web/index.html','utf8');
const sourceStart=source.indexOf('  // Reuse the existing centered M-UI dialog design');
const sourceEnd=source.indexOf('\n  ensureModals();',sourceStart);
assert(sourceStart>=0&&sourceEnd>sourceStart,'status dialog code missing');
assert(html.includes('static/mihomo-settings.js?v=128')&&html.includes('static/mihomo-settings.css?v=128'));
const snippet=source.slice(sourceStart,sourceEnd)+'\nwindow.__ops={saveSettings,restartMihomoFromSettings};';
const inlineCSS=[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
const css=[fs.readFileSync('web/liquid-glass.css','utf8'),fs.readFileSync('web/mihomo-settings.css','utf8'),inlineCSS,fs.readFileSync('web/theme-shadcn.css','utf8'),fs.readFileSync('web/theme-md3.css','utf8'),fs.readFileSync('web/color-skins.css','utf8')].join('\n');
const words={
 'common.close':'Закрыть','mh.operationSaving':'Сохранение конфигурации Mihomo…',
 'mh.operationSaveTitle':'Конфигурация сохранена',
 'mh.operationRestarting':'Перезапуск Mihomo…',
 'mh.operationRestartTitle':'Mihomo перезапущен',
 'mh.operationFailureTitle':'Не удалось выполнить операцию',
 'mh.operationRestartSuccess':'Mihomo успешно перезапущен.',
 'mh.settingsSaved':'Настройки маршрутизации Mihomo сохранены. Перезапустите Mihomo для применения.',
 'mh.saveFirst':'Сначала сохраните текущие изменения'
};
async function launchTest(browser,theme,width){
 const page=await browser.newPage({viewport:{width,height:900}});
 await page.setContent('<!doctype html><html data-ui-theme="'+theme+'"><head><meta charset="utf-8"><style>'+css+'</style></head><body class="dark" style="--surface-modal:#141924;--text:#e9e9ed;--text-strong:#fff;--line:#37394b;--ease:ease;--ease-modal:ease;--shadow-modal:0 18px 56px #0008"><main id="mihomo-settings-root"><button id="mihomo-save">Сохранить</button><button id="mihomo-restart">Перезапустить Mihomo</button></main></body></html>');
 await page.evaluate(trans=>{
   window.__requests=[];window.__toasts=[];window.__refreshes=0;
   window.$=selector=>document.querySelector(selector);
   window.$$=()=>[];
   window.root=document.querySelector('#mihomo-settings-root');
   window.dirty=true;
   window.draft={outbounds:[],routingRules:[{id:'match',type:'MATCH',target:'DIRECT'}],basics:{mode:'rule'}};
   window.lastSyncedOutbounds=[];window.lastSyncedBasics={mode:'rule'};window.lastSyncedRules=[];
   window.clone=data=>JSON.parse(JSON.stringify(data));
   window.app={state:{state:{outbounds:[],routingRules:[],mihomoBasics:{},settings:{}}}};
   window.muiT=key=>trans[key]||key;
   window.commitBasicsTags=()=>{};
   window.syncButtons=()=>{};
   window.refresh=async()=>{window.__refreshes++};
   window.toast=(text,bad)=>window.__toasts.push({text,bad});
   window.api=(url,options)=>new Promise((resolve,reject)=>{
     window.__requests.push({url,method:options.method,body:options.body});
     window.__resolve=resolve;window.__reject=reject;
   });
 },words);
 await page.addScriptTag({content:snippet});
 const status=page.locator('#mihomo-operation-status');
 await page.locator('#mihomo-save').focus();
 await page.evaluate(()=>{window.__pending=window.__ops.saveSettings()});
 await status.waitFor({state:'visible'});
 assert.equal(await status.getAttribute('data-phase'),'pending');
 assert.equal(await page.locator('#mihomo-operation-title').textContent(),words['mh.operationSaving']);
 assert.equal(await page.locator('.mui-mihomo-status-actions button').isDisabled(),true);
 assert.equal(await status.getAttribute('aria-modal'),null); // aria-modal belongs to dialog panel
 assert.equal(await page.locator('.mui-mihomo-status-panel').getAttribute('aria-modal'),'true');
 const rect=await page.locator('.mui-mihomo-status-panel').boundingBox();
 assert.ok(rect&&Math.abs(rect.x+rect.width/2-width/2)<5,'dialog must be centered '+JSON.stringify(rect));
 assert.ok(rect.x>=0&&rect.x+rect.width<=width+1,'dialog must fit viewport');
 await page.keyboard.press('Escape');
 assert.equal(await status.count(),1,'pending dialog must not close');
 await page.evaluate(()=>window.__ops.saveSettings());
 assert.equal(await page.evaluate(()=>window.__requests.length),1,'duplicate Save blocked');
 assert.equal(await page.evaluate(()=>window.__requests[0].url),'/api/mihomo/rules');
 await page.evaluate(async()=>{window.__resolve({message:'saved'});await window.__pending});
 assert.equal(await status.getAttribute('data-phase'),'success');
 assert.equal(await page.locator('#mihomo-operation-title').textContent(),words['mh.operationSaveTitle']);
 assert.equal(await page.locator('#mihomo-operation-message').textContent(),words['mh.settingsSaved']);
 assert.equal(await page.locator('.mui-mihomo-status-actions').isHidden(),true,
   'success notification has no Close button');
 assert.equal(await page.evaluate(()=>window.__toasts.length),0);
 await status.waitFor({state:'detached',timeout:4500});
 await page.evaluate(()=>{window.dirty=false;window.__pending=window.__ops.restartMihomoFromSettings()});
 await status.waitFor({state:'visible'});
 assert.equal(await status.getAttribute('data-phase'),'pending');
 assert.equal(await page.locator('#mihomo-operation-title').textContent(),words['mh.operationRestarting']);
 await page.evaluate(()=>window.__ops.restartMihomoFromSettings());
 assert.equal(await page.evaluate(()=>window.__requests.length),2,'duplicate restart blocked');
 assert.equal(await page.evaluate(()=>window.__requests[1].url),'/api/core/restart');
 assert.equal(await page.evaluate(()=>window.__requests[1].method),'POST');
 await page.evaluate(async()=>{window.__resolve({});await window.__pending});
 assert.equal(await status.getAttribute('data-phase'),'success');
 assert.equal(await page.locator('#mihomo-operation-title').textContent(),words['mh.operationRestartTitle']);
 assert.equal(await page.locator('#mihomo-operation-message').textContent(),words['mh.operationRestartSuccess']);
 // Success closes automatically without any user click; tests the real timer.
 await status.waitFor({state:'detached',timeout:4500});
 await page.evaluate(()=>{window.__pending=window.__ops.restartMihomoFromSettings()});
 await status.waitFor({state:'visible'});
 const dangerous='<img src=x onerror=alert(123)>';
 await page.evaluate(async text=>{window.__reject(new Error(text));await window.__pending},dangerous);
 assert.equal(await status.getAttribute('data-phase'),'error');
 await page.waitForTimeout(2700);
 assert.equal(await status.count(),1,'error dialog must stay until closed manually');
 assert.equal(await page.locator('.mui-mihomo-status-actions').isVisible(),true,
   'errors retain an accessible Close button');
 const errorButton=page.locator('.mui-mihomo-status-actions button');
 await errorButton.evaluate(button=>button.blur());
 await page.waitForTimeout(220);
 const normalColor=await errorButton.evaluate(button=>({
   background:getComputedStyle(button).backgroundColor,
   foreground:getComputedStyle(button).color,
   fill:getComputedStyle(button).webkitTextFillColor
 }));
 assert.equal(normalColor.background,'rgb(7, 107, 85)',theme+' '+width+' plain error button');
 assert.equal(normalColor.foreground,'rgb(255, 255, 255)',theme+' '+width+' plain error text');
 assert.equal(normalColor.fill,'rgb(255, 255, 255)',theme+' '+width+' WebKit foreground');
 await errorButton.hover();
 await page.waitForTimeout(210);
 const hoverColor=await errorButton.evaluate(button=>({
   background:getComputedStyle(button).backgroundColor,
   foreground:getComputedStyle(button).color
 }));
 assert.equal(hoverColor.foreground,'rgb(255, 255, 255)');
 assert.equal(hoverColor.background,'rgb(8, 127, 100)');
 assert.equal(await page.locator('#mihomo-operation-title').textContent(),words['mh.operationFailureTitle']);
 assert.equal(await page.locator('#mihomo-operation-message').textContent(),dangerous);
 assert.equal(await status.locator('img').count(),0,'error must render as textContent not HTML');
 assert.equal(await page.evaluate(()=>window.__toasts.length),0);
 await page.locator('.mui-mihomo-status-actions button').click();
 assert.equal(await status.count(),0);
 await page.close();
 return 3;
}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 let count=0;
 try{
  for(const theme of ['shadcn','md3','liquid']){
   for(const width of [390,1440]){
    count+=await launchTest(browser,theme,width);
   }
  }
 }finally{await browser.close()}
 console.log('PASS: centered Save/Restart pending, success and safe error dialog, no toast, duplicate guards, mobile/desktop, '+count+' outcomes');
})().catch(e=>{console.error(e);process.exitCode=1});
