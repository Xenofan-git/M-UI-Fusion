'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
const read=f=>fs.readFileSync('web/'+f,'utf8');
const source=read('outbound-subscriptions.js');
const html=read('index.html'),head=html.slice(0,html.indexOf('</head>'));
assert.ok(read('index.html').includes('static/outbound-subscriptions.css?v=125'));
assert.ok(read('index.html').includes('static/outbound-subscriptions.js?v=122'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 let count=0;
 try{
  for(const theme of ['shadcn','md3','liquid'])
   for(const width of [390,1440])
    for(const appearance of ['dark','light','ivory']){
     const dark=appearance==='dark',skin=appearance==='ivory'?' data-color-skin="ivory"':'';
     const css=Array.from(head.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>|<link\b[^>]*rel="stylesheet"[^>]*>/gi),m=>m[0]).filter(s=>!s.includes('data-ui-only=')||s.includes('data-ui-only="'+theme+'"')).map(s=>s.startsWith('<style')?s:'<style>'+read(s.match(/href="static\/([^"?]+)/)[1])+'</style>').join('\n');
     const page=await browser.newPage({viewport:{width,height:900}});
     await page.setContent('<!doctype html><html data-ui-theme="'+theme+'"'+skin+' data-theme="'+(dark?'dark':'light')+'"><head>'+css+
      '</head><body class="'+(dark?'dark':'')+'"><main style="padding:20px;width:100%;box-sizing:border-box"><div class="mihomo-toolbar"><button id="mihomo-add-source" class="mihomo-primary">＋ Добавить подписку</button></div><div id="outsub-root" class="outsub-page"><div id="outsub-status"></div><button id="outsub-reload">Обновить список</button><div id="outsub-list" class="outsub-list"></div></div></main></body></html>');
     await page.evaluate(()=>{
      window.__calls=[];window.__healthMode='mixed';
      window.fetch=async(url,options)=>{
       window.__calls.push({url,method:options?.method||'GET'});
       const json=data=>({ok:true,status:200,json:async()=>({data})});
       if(url.endsWith('/subscriptions/one/nodes')){
        if(window.__healthMode==='error')throw Error('offline');
        return json({nodes:[
         {key:'a',alive:true,checkedAt:'2026-11-25T12:00:00Z',delay:40},
         {key:'b',alive:false,checkedAt:'2026-11-25T12:00:00Z'},
         {key:'c',alive:true},
         {key:'d',alive:false},
         {key:'e',checkedAt:'2026-11-25T12:00:00Z'}
        ]});
       }
       if(url.endsWith('/subscriptions/two/nodes'))return json({nodes:[]});
       return json([
        {id:'one',name:'quatro-vpn',enabled:true,group:'Foreign-quatro-vpn',intervalMinutes:1440,nodeCount:130,lastUpdated:'2026-11-20T23:19:20Z'},
        {id:'two',name:'paused',enabled:false,group:'Russia',intervalMinutes:45,nodeCount:14,lastUpdated:null}
       ]);
      };
      // Capture the actual interval callback so the test need not wait 30s.
      const original=window.setInterval;window.setInterval=(fn,ms,...args)=>{
       if(ms===30000){window.__healthTick=fn;return 1;}return original(fn,ms,...args);
      };
     });
     await page.addScriptTag({content:source});
     await page.evaluate(()=>window.MUIOutboundSubscriptions.load());
     const cards=page.locator('.outsub-card');
     assert.equal(await cards.count(),2);
     await page.waitForFunction(()=>document.querySelectorAll('.outsub-health-online').length===2);
     assert.equal(await cards.nth(0).locator('.outsub-health-title').innerText(),'Статус последней проверки подписки:');
     assert.equal(await cards.nth(0).locator('.outsub-health-online').innerText(),'доступно 1 узлов');
     assert.equal(await cards.nth(0).locator('.outsub-health-offline').innerText(),'недоступно 1 узлов');
     assert.match(await cards.nth(0).locator('.outsub-health').innerText(),/Без результатов проверки: 128/);
     assert.match(await cards.nth(1).locator('.outsub-health').innerText(),/Нет данных последней проверки/);
     const expectedBg=dark?'rgb(11, 15, 20)':appearance==='ivory'?'rgb(255, 250, 240)':'rgb(245, 248, 247)';
     const lum=s=>s.match(/\d+/g).slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
     const contrast=(x,y)=>(Math.max(lum(x),lum(y))+.05)/(Math.min(lum(x),lum(y))+.05);
     if(!dark){
      const button=page.locator('#mihomo-add-source');
      const checkButton=async expected=>{
       const v=await button.evaluate(e=>{const s=getComputedStyle(e);return [s.backgroundColor,s.webkitTextFillColor]});
       assert.equal(v[0],expected,JSON.stringify({theme,width,appearance,v}));
       assert(contrast(v[0],v[1])>=4.5);
      };
      await checkButton('rgb(228, 239, 234)');
      await button.hover();await checkButton('rgb(213, 231, 222)');
      await page.mouse.down();await checkButton('rgb(196, 223, 208)');await page.mouse.up();
      await page.mouse.move(width-1,899);
     }
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
      assert.equal(got.bg,expectedBg,JSON.stringify({theme,width,appearance,got}));
      assert.equal(got.backgroundImage,'none');
      assert(contrast(got.title,got.bg)>=4.5);
      assert(contrast(got.text,got.bg)>=4.5);
      for(const sel of ['.outsub-health-online','.outsub-health-offline','.outsub-health-unknown']){
       const ink=await info.locator(sel).first().evaluate(e=>getComputedStyle(e).color);
       assert(contrast(ink,got.bg)>=4.5,JSON.stringify({appearance,sel,ink,bg:got.bg}));
      }
      assert.equal(got.icon,i===0);
      assert.equal(got.status,i===0?'Автообновление':'Приостановлено');
      assert.equal(got.count,i===0?'130 узлов':'14 узлов');
      assert.match(got.date,/Обновлено/);
      assert.ok(got.bounds.right<=width+1&&got.bounds.left>=0,'card must fit viewport '+JSON.stringify(got.bounds));
      assert.deepEqual(await card.locator('.outsub-actions button').allTextContents(),['Обновить','Параметры подписки','Удалить']);
      await info.hover();
      assert.equal(await info.evaluate(el=>getComputedStyle(el).backgroundColor),expectedBg,'hover must preserve appearance');
      count++;
     }
     await page.evaluate(()=>{window.__healthMode='error';window.__healthTick()});
     await page.waitForFunction(()=>document.querySelector('.outsub-health').textContent.includes('временно недоступны'));
     const calls=await page.evaluate(()=>window.__calls.length);
     await page.evaluate(()=>{document.querySelector('#outsub-root').hidden=true;window.__healthTick()});
     await page.waitForTimeout(50);
     assert.equal(await page.evaluate(()=>window.__calls.length),calls);
     assert(await page.evaluate(()=>window.__calls.every(c=>c.method==='GET')));
     await page.close();
    }
 }finally{await browser.close();}
 console.log('PASS: theme-aware cards/add button, last-check counts and unknown/offline/error handling, 3 themes x 2 widths x 3 appearances, '+count+' cards');
})().catch(e=>{console.error(e);process.exitCode=1});
