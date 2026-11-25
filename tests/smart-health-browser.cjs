'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
const html=fs.readFileSync('web/index.html','utf8'),js=fs.readFileSync('web/smart-health.js','utf8');
const start=html.indexOf('<div class="mihomo-pane" data-mihomo-pane="smart-health">');
const end=html.indexOf('</div></div><div hidden>',start);
assert(start>=0&&end>start);
const markup=html.slice(start,end);
const catalog=[{id:'yandex-doh',name:'Яндекс DNS',protocol:'DoH'},{id:'yandex-dot',name:'Яндекс DNS',protocol:'DoT'},{id:'vk',name:'ВКонтакте',protocol:'HTTPS'}];
(async()=>{
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900}});
 await page.setContent('<section class="view active"><button data-mihomo-tab="smart-health">Smart Health Monitor</button>'+markup+'</section>');
 await page.evaluate(catalog=>{
   window.muiGetLang=()=> 'ru';window.__requests=[];
   window.__data={settings:{enabled:false,normalSeconds:180,degradedSeconds:60,offlineSeconds:10,services:['yandex-doh','vk']},catalog,status:{mode:'disabled',pending:false,healthy:0,events:[],controls:[]}};
   window.api=async(url,opts={})=>{
    window.__requests.push({url,method:opts.method||'GET',body:opts.body});
    if(opts.method==='PUT'){window.__data.settings=JSON.parse(opts.body);window.__data.status={mode:'pending',pending:true,healthy:0,events:[],controls:[]};}
    return structuredClone(window.__data);
   };
 },catalog);
 await page.addScriptTag({content:js});
 await page.locator('[data-mihomo-tab="smart-health"]').click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-smart-service]').length===3);
 assert.equal(await page.locator('#smart-health-normal').inputValue(),'180');
 assert.equal(await page.locator('[data-smart-service="yandex-dot"]').isChecked(),false);
 await page.locator('#smart-health-enabled').check();
 await page.locator('[data-smart-service="yandex-dot"]').check();
 await page.locator('[data-smart-service="vk"]').uncheck();
 await page.locator('#smart-health-offline').fill('12');
 await page.locator('#smart-health-offline').dispatchEvent('change');
 await page.locator('[data-mihomo-tab="smart-health"]').click();
 assert.equal(await page.locator('#smart-health-offline').inputValue(),'12','refresh discarded draft');
 await page.locator('#smart-health-save').click();
 await page.waitForFunction(()=>window.__requests.some(x=>x.method==='PUT'));
 const body=await page.evaluate(()=>JSON.parse(window.__requests.find(x=>x.method==='PUT').body));
 assert.deepEqual(body,{enabled:true,normalSeconds:180,degradedSeconds:60,offlineSeconds:12,services:['yandex-doh','yandex-dot']});
 await page.locator('#smart-health-pending').waitFor({state:'visible'});
 assert.match(await page.locator('#smart-health-mode').textContent(),/Ожидает перезапуска/);
 await page.evaluate(()=>{window.__data.status={mode:'offline',pending:false,healthy:0,events:[{mode:'offline',at:'2026-11-25T18:00:00Z'}],controls:[{id:'yandex-doh',ok:false,milliseconds:2000}]};});
 await page.locator('[data-mihomo-tab="smart-health"]').click();
 await page.waitForFunction(()=>document.querySelector('#smart-health-mode').textContent.includes('Нет ответа'));
 assert.match(await page.locator('[data-smart-result="yandex-doh"]').textContent(),/Нет ответа/);
 assert.equal(await page.locator('[data-smart-result="yandex-dot"]').textContent(),'—');
 assert.match(await page.locator('#smart-health-events').textContent(),/Нет ответа/);
 await page.close();
 }
 console.log('PASS: monitor tab checkbox selection, intervals, independent save, pending restart, status and events, draft preservation on desktop/mobile');
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
