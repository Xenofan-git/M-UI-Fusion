'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright-core');
const source=fs.readFileSync('web/outbound-subscriptions.js','utf8');
const flags=fs.readFileSync('web/country-flags.js','utf8');
const css=fs.readFileSync('web/outbound-subscriptions.css','utf8');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  for(const width of [390,1280]){
   const page=await browser.newPage({viewport:{width,height:920}});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const html='<!doctype html><html lang="ru"><head><style>:root{--text-strong:#eef;--text-muted:#aaa;--border:#555;--surface:#202431;--teal:#009B77}body{margin:0;background:#151c26;color:#eef}</style><style>'+css+'</style></head><body><section data-mihomo-pane="sources"><div id="outsub-root"><div id="outsub-status"></div><button id="outsub-reload">Reload</button><div id="outsub-list"></div></div></section></body></html>';
   await page.route('https://panel.test/**',route=>{
     const pathname=new URL(route.request().url()).pathname;
     if(pathname==='/')return route.fulfill({status:200,contentType:'text/html',body:html});
     if(pathname.startsWith('/flags/')){
       const filename='web'+pathname;
       if(fs.existsSync(filename))return route.fulfill({status:200,contentType:'image/svg+xml',body:fs.readFileSync(filename)});
     }
     return route.fulfill({status:404,body:'not found'});
   });
   await page.goto('https://panel.test/');
   await page.evaluate(()=>{
     window.__calls=[];
     window.__sources=[];
     window.fetch=async(input,opts={})=>{
       const url=String(input),method=opts.method||'GET';
       let payload;
       try{payload=opts.body?JSON.parse(opts.body):null;}catch{}
       window.__calls.push({url,method,payload});
       const json=data=>({ok:true,status:200,json:async()=>({data})});
       if(method==='GET'&&url.endsWith('/api/mihomo/subscriptions'))return json(window.__sources);
       if(method==='POST'&&url.endsWith('/api/mihomo/subscriptions')){
         const sub={...payload,id:'sub-catalog',nodeCount:3,lastUpdated:'2026-11-24T12:00:00Z'};
         window.__sources.push(sub);return json(sub);
       }
       if(method==='GET'&&url.endsWith('/api/mihomo/subscriptions/sub-catalog/nodes')){
         return json({nodes:[
           {name:'LTE Россия',key:'node-ru-01',countryCode:'RU',flag:'🇷🇺',protocol:'vless',included:true},
           {name:'LTE Germany',key:'node-de-02',countryCode:'DE',flag:'🇩🇪',protocol:'vless',included:true},
           {name:'LTE Finland',key:'node-fi-03',countryCode:'FI',flag:'🇫🇮',protocol:'vless',included:true},
         ],total:3,selected:3,filtered:0});
       }
       if(method==='POST'&&url.endsWith('/api/mihomo/subscriptions/groups'))return json({ok:true});
       throw Error('unexpected request: '+method+' '+url);
     };
   });
   await page.addScriptTag({content:flags});
   await page.addScriptTag({content:source});
   // Source Catalog: URL is entered ONCE, without choosing a group.
   await page.evaluate(()=>window.MUIOutboundSubscriptions.openSource());
   const modal=page.locator('#outsub-modal');
   assert(await modal.isVisible());
   assert.equal(await page.locator('#outsub-title').innerText(),'Добавить подписку');
   assert.equal(await modal.locator('[name="groupName"]').isVisible(),false);
   assert.equal(await modal.locator('[name="sourceId"]').isVisible(),false);
   assert(await modal.locator('[name="url"]').isVisible());
   await modal.locator('[name="name"]').fill('QuatroVPN');
   await modal.locator('[name="url"]').fill('https://provider.example/secret');
   assert(await modal.locator('#outsub-update-panel').isVisible());
   assert.equal(await modal.locator('[name="intervalHours"]').inputValue(),'24');
   assert.equal(await modal.locator('[name="intervalRestMinutes"]').inputValue(),'0');
   await modal.locator('[name="intervalHours"]').fill('24');
   await modal.locator('[name="intervalRestMinutes"]').fill('0');
   assert.equal(await modal.locator('[name="intervalMinutes"]').inputValue(),'1440');
   await modal.locator('[name="enabled"]').check();
   await modal.locator('#outsub-submit').click();
   await page.waitForFunction(()=>!document.querySelector('#outsub-modal').classList.contains('open'));
   assert.equal(await page.locator('.outsub-card').count(),1);
   assert.equal(await page.locator('.outsub-card h3').innerText(),'QuatroVPN');
   assert.equal(await page.locator('.outsub-card-meta').innerText(),'Интервал обновления: 1440 мин');
   assert.equal((await page.locator('.outsub-card').innerText()).includes('Исходная группа'),false);
   await page.getByRole('button',{name:'Параметры подписки'}).click();
   assert(await modal.locator('#outsub-source-inventory').isVisible());
   // Same fbs-style hours/minutes update card now belongs to source only.
   assert(await modal.locator('#outsub-update-panel').isVisible());
   assert.equal(await modal.locator('.fbs-check').count(),1);
   assert.equal(await modal.locator('.fbs-interval [type="number"]').count(),2);
   assert.equal(await modal.locator('.outsub-filters').isVisible(),false);
   assert.equal(await modal.locator('[name="group"]').isVisible(),false);
   await page.waitForFunction(()=>document.querySelector('#outsub-source-inventory-count').textContent.includes('3 из 3'));
   assert.equal(await modal.locator('#outsub-source-inventory-body tr').count(),3);
   assert.equal(await modal.locator('#outsub-source-inventory thead th').count(),4);
   const sortHeader=key=>modal.locator('#outsub-source-inventory thead button[data-sort="'+key+'"]');
   assert.equal(await sortHeader('name').innerText(),'Имя ↑');
   assert.equal(await sortHeader('ping').innerText(),'Пинг ↕');
   assert.equal(await sortHeader('delay').innerText(),'Задержка ↕');
   await sortHeader('ping').click();
   assert.equal(await sortHeader('ping').innerText(),'Пинг ↑');
   assert.equal(await sortHeader('ping').getAttribute('aria-pressed'),'true');
   assert.equal(await sortHeader('name').innerText(),'Имя ↕');
   await sortHeader('ping').click();
   assert.equal(await sortHeader('ping').innerText(),'Пинг ↓');
   await sortHeader('delay').click();
   assert.equal(await sortHeader('delay').innerText(),'Задержка ↑');
   assert.equal(await sortHeader('ping').innerText(),'Пинг ↕');
   await sortHeader('delay').click();
   assert.equal(await sortHeader('delay').innerText(),'Задержка ↓');
   await modal.locator('#outsub-source-inventory-search').fill('Germany');
   assert.equal(await modal.locator('#outsub-source-inventory-body tr').count(),1);
   await modal.locator('.outsub-actions button.outline-btn').click();
   assert.equal(await modal.isVisible(),false);
   // Creation form: source list only, no URL, no auto-refresh per balancer.
   await page.evaluate(()=>window.MUIOutboundSubscriptions.openCreate());
   const picker=modal.locator('#outsub-source-picker');
   const pickerButton=modal.locator('#outsub-source-open');
   assert(await pickerButton.isVisible());
   assert.equal(await picker.isVisible(),false,'native select is backing only');
   assert((await pickerButton.innerText()).includes('QuatroVPN'),'single source auto-selected');
   assert.equal(await modal.locator('[name="url"]').isVisible(),false);
   assert.equal(await modal.locator('[name="enabled"]').isVisible(),false);
   assert.equal(await modal.locator('#outsub-update-panel').isVisible(),false);
   assert.equal(await modal.locator('[name="intervalHours"]').isVisible(),false);
   assert.equal(await modal.locator('[name="intervalMinutes"]').isVisible(),false);
   assert.equal(await modal.locator('[name="name"]').isVisible(),false);
   assert(await modal.locator('[name="groupName"]').isVisible());
   assert((await picker.locator('option').allTextContents()).some(x=>x.includes('QuatroVPN')));
   await pickerButton.click();
   assert(await modal.locator('#outsub-source-menu [data-source-id="sub-catalog"]').isVisible());
   await modal.locator('#outsub-source-menu [data-source-id="sub-catalog"]').click();
   await page.waitForFunction(()=>document.querySelector('#outsub-preview-count').textContent.includes('Выбрано 3 из 3'));
   await modal.locator('[name="groupName"]').fill('FOREIGN 2');
   await modal.locator('[name="filterExclude"]').fill('🇷🇺');
   await page.waitForFunction(()=>document.querySelector('#outsub-preview-count').textContent.includes('Выбрано 2 из 3'));
   await modal.locator('#outsub-submit').click();
   await page.waitForFunction(()=>!document.querySelector('#outsub-modal').classList.contains('open'));
   // A second group points to the SAME source ID; no provider URL resubmitted.
   await page.evaluate(()=>window.MUIOutboundSubscriptions.openCreate());
   assert.equal(await picker.inputValue(),'sub-catalog','source auto-selected on second open');
   await page.waitForFunction(()=>document.querySelector('#outsub-preview-count').textContent.includes('Выбрано 3 из 3'));
   await modal.locator('[name="groupName"]').fill('Russia 2');
   await modal.locator('[name="filterKeep"]').fill('🇷🇺');
   await modal.locator('#outsub-submit').click();
   await page.waitForFunction(()=>!document.querySelector('#outsub-modal').classList.contains('open'));
   const calls=await page.evaluate(()=>window.__calls);
   const sourcePOST=calls.filter(x=>x.method==='POST'&&x.url.endsWith('/api/mihomo/subscriptions'));
   const groupsPOST=calls.filter(x=>x.method==='POST'&&x.url.endsWith('/api/mihomo/subscriptions/groups'));
   assert.equal(sourcePOST.length,1,'one provider download/import');
   assert.equal(groupsPOST.length,2,'two groups share the same source ID');
   assert.equal(sourcePOST[0].payload.createGroup,false);
   assert.equal(sourcePOST[0].payload.group,'');
   assert.equal(groupsPOST[0].payload.sourceId,'sub-catalog');
   assert.equal(groupsPOST[1].payload.sourceId,'sub-catalog');
   assert.equal(groupsPOST[0].payload.filterExclude,'🇷🇺');
   assert.equal(groupsPOST[1].payload.filterKeep,'🇷🇺');
   for(const call of groupsPOST){
     assert(!Object.hasOwn(call.payload,'url'),'group must never re-submit provider URL');
     assert(!Object.hasOwn(call.payload,'intervalMinutes'),'group must not have its own source update scheduler');
   }
   assert.equal(await page.locator('.outsub-card').count(),1,'still only one source catalog record');
   // With multiple subscription records, the custom dropdown must show all
   // choices instead of an empty native Windows popup.
   await page.evaluate(()=>window.__sources.push({
     id:'sub-second',name:'AnotherVPN',url:'https://provider.example/second',
     enabled:false,group:'',intervalMinutes:180,nodeCount:4
   }));
   await page.evaluate(()=>window.MUIOutboundSubscriptions.openCreate());
   await page.waitForFunction(()=>document.querySelectorAll('#outsub-source-menu [data-source-id]').length===2);
   const multipleButton=modal.locator('#outsub-source-open');
   assert.equal(await multipleButton.innerText(),'Выберите подписку…');
   await multipleButton.click();
   assert(await modal.locator('#outsub-source-menu [data-source-id="sub-catalog"]').isVisible());
   assert(await modal.locator('#outsub-source-menu [data-source-id="sub-second"]').isVisible());
   await modal.locator('#outsub-source-menu [data-source-id="sub-second"]').click();
   assert.equal(await modal.locator('#outsub-source-picker').inputValue(),'sub-second');
   assert((await multipleButton.innerText()).includes('AnotherVPN'));
   await modal.locator('.outsub-actions button.outline-btn').click();
   assert.deepEqual(errors,[],errors.join('; '));
   await page.close();
   console.log('PASS single source, two linked groups, separate tab and no duplicate URL width',width);
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
