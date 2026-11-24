'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
const read=f=>fs.readFileSync('web/'+f,'utf8');
const source=read('outbound-subscriptions.js');
const css=[read('outbound-subscriptions.css'),read('theme-shadcn.css'),read('theme-md3.css'),read('color-skins.css')].join('\n');
assert.ok(read('index.html').includes('static/outbound-subscriptions.css?v=123'));
assert.ok(read('index.html').includes('static/outbound-subscriptions.js?v=119'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 let count=0;
 try{
  for(const theme of ['shadcn','md3','liquid'])
   for(const width of [390,1440])
    for(const dark of [true,false]){
     const page=await browser.newPage({viewport:{width,height:900}});
     await page.setContent('<html data-ui-theme="'+theme+'" data-color-skin="emerald"><head><style>'+css+
      '</style></head><body class="'+(dark?'dark':'')+'"><main style="padding:20px;width:100%;box-sizing:border-box"><div id="outsub-root" class="outsub-page"><div id="outsub-status"></div><button id="outsub-reload">Обновить список</button><div id="outsub-list" class="outsub-list"></div></div></main></body></html>');
     await page.evaluate(()=>{
      window.fetch=async()=>({ok:true,status:200,json:async()=>({data:[
       {id:'one',name:'quatro-vpn',enabled:true,group:'Foreign-quatro-vpn',intervalMinutes:1440,nodeCount:130,lastUpdated:'2026-11-20T23:19:20Z'},
       {id:'two',name:'paused',enabled:false,group:'Russia',intervalMinutes:45,nodeCount:14,lastUpdated:null}
      ]})});
     });
     await page.addScriptTag({content:source});
     await page.evaluate(()=>window.MUIOutboundSubscriptions.load());
     const cards=page.locator('.outsub-card');
     assert.equal(await cards.count(),2);
     for(const [i,expected] of [[0,'quatro-vpn'],[1,'paused']]){
      const card=cards.nth(i),info=card.locator('.outsub-info-frame');
      const got=await info.evaluate(el=>{
       const computed=getComputedStyle(el);
       const title=el.querySelector('h3'),text=el.querySelector('.outsub-card-meta');
       return {bg:computed.backgroundColor,backgroundImage:computed.backgroundImage,
         border:computed.borderTopColor, title:getComputedStyle(title).color,
         text:getComputedStyle(text).color,
         icon:!!el.querySelector('.outsub-refresh-icon'),status:el.querySelector('.outsub-pill')?.textContent,
         count:el.querySelector('.outsub-count-badge')?.textContent,
         date:el.querySelector('.outsub-last-updated')?.textContent,
         bounds:el.getBoundingClientRect().toJSON(),
         hoverBorder:null
       };
      });
      assert.equal(got.bg,'rgb(11, 15, 20)',JSON.stringify({theme,width,dark,got}));
      assert.equal(got.backgroundImage,'none');
      assert.equal(got.border,'rgb(52, 49, 68)');
      assert.equal(got.title,'rgb(255, 255, 255)');
      assert.equal(got.text,'rgb(214, 219, 227)');
      assert.equal(got.icon,i===0);
      assert.equal(got.status,i===0?'Автообновление':'Приостановлено');
      assert.equal(got.count,i===0?'130 узлов':'14 узлов');
      assert.match(got.date,/Обновлено/);
      assert.ok(got.bounds.right<=width+1&&got.bounds.left>=0,'card must fit viewport '+JSON.stringify(got.bounds));
      assert.deepEqual(await card.locator('.outsub-actions button').allTextContents(),['Обновить','Параметры подписки','Удалить']);
      await info.hover();
      assert.equal(await info.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(11, 15, 20)','hover must stay black');
      count++;
     }
     await page.close();
    }
 }finally{await browser.close();}
 console.log('PASS: near-black subscription cards, auto-refresh icon, node count/date, 3 themes x 2 widths x 2 appearances, '+count+' cards');
})().catch(e=>{console.error(e);process.exitCode=1});
