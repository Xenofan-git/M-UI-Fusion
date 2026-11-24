'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const source=fs.readFileSync('web/outbound-subscriptions.js','utf8');
const flagSource=fs.readFileSync('web/country-flags.js','utf8');
const css=fs.readFileSync('web/outbound-subscriptions.css','utf8');
const root='https://panel.test';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  for(const width of [390,1280]){
   const context=await browser.newContext({viewport:{width,height:900}});
   const page=await context.newPage();
   const errors=[];
   page.on('pageerror',err=>errors.push(err.message));
   const fixture='<!doctype html><html lang="ru"><head><style>:root{--text-strong:#eef;--text-muted:#aaa;--border:#555;--surface:#202431;--teal:#009B77}body{margin:0;background:#151c26;color:#eef}</style><style>'+css+'</style></head><body><div id="outsub-root"><div id="outsub-status"></div><button id="outsub-reload">Reload</button><div id="outsub-list"></div></div></body></html>';
   await page.route('https://panel.test/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/')return route.fulfill({status:200,contentType:'text/html',body:fixture});
    const filename=url.pathname.startsWith('/flags/')?'web'+url.pathname:null;
    if(filename&&fs.existsSync(filename))
      return route.fulfill({status:200,contentType:'image/svg+xml',body:fs.readFileSync(filename)});
    return route.fulfill({status:404,body:''});
   });
   await page.goto(root,{waitUntil:'domcontentloaded'});
   await page.evaluate(()=>{window.fetch=async(url)=>{
     const nodes=[
      {key:'ru',name:'LTE №11 - Россия Москва',countryCode:'RU',protocol:'vless'},
      {key:'de',name:'LTE №12 - Germany Frankfurt',countryCode:'DE',protocol:'vless'},
      {key:'us',name:'LTE №13 - США Denver',countryCode:'US',protocol:'vless'},
     ];
     const result=String(url).includes('/preview')?{nodes}:{data:[]};
     return {ok:true,status:200,json:async()=>result};
   }});
   await page.addScriptTag({content:flagSource});
   await page.addScriptTag({content:source});
   await page.evaluate(()=>window.MUIOutboundSubscriptions.openCreate());
   const trigger=page.locator('.outsub-filter-field').first().locator('.outsub-flag-trigger');
   assert.equal(await trigger.innerText(),'Добавить флаг');
   assert.equal(await trigger.locator('svg.outsub-add-flag-icon').count(),1,'button should use SVG icon');
   assert.equal(await trigger.evaluate(e=>e.innerText.includes('🏳️')),false,'button must not use emoji square');
   await trigger.click();
   const first=page.locator('.outsub-filter-field').first();
   await first.locator('input[type="search"]').fill('Россия');
   const ru=first.locator('.outsub-country-option').filter({hasText:'Россия (RU)'});
   assert.equal(await ru.count(),1);
   await ru.click();
   assert.equal(await first.locator('textarea').inputValue(),'🇷🇺','country select should persist flag, not Russia');
   assert.equal(await first.locator('.outsub-country-chip').count(),1);
   assert.equal(await first.locator('.outsub-country-chip').innerText(),'','chip should show only a flag');
   const ruIcon=first.locator('.outsub-country-chip img');
   await ruIcon.waitFor({state:'visible'});
   assert.equal(await ruIcon.evaluate(img=>new URL(img.src).pathname),'/flags/ru.svg');
   assert.equal(await first.locator('.outsub-country-chip').getAttribute('title'),'Россия (RU)');
   await trigger.click();
   await first.locator('input[type="search"]').fill('Россия');
   await ru.click();
   assert.equal(await first.locator('textarea').inputValue(),'🇷🇺','do not append duplicate flags');
   // Add additional countries, one flag per line, no country names.
   await trigger.click();
   await first.locator('input[type="search"]').fill('Германия');
   await first.locator('.outsub-country-option').filter({hasText:'Германия (DE)'}).click();
   assert.equal(await first.locator('textarea').inputValue(),'🇷🇺\n🇩🇪');
   assert.equal(await first.locator('.outsub-country-chip').count(),2);
   // The exclusion field is independent of the keep field.
   const second=page.locator('.outsub-filter-field').nth(1);
   await second.locator('.outsub-flag-trigger').click();
   await second.locator('input[type="search"]').fill('США');
   await second.locator('.outsub-country-option').filter({hasText:'(US)'}).first().click();
   assert.equal(await second.locator('textarea').inputValue(),'🇺🇸');
   assert.equal(await second.locator('.outsub-country-chip img').evaluate(img=>new URL(img.src).pathname),'/flags/us.svg');
   await page.locator('#outsub-preview-button').click();
   await page.waitForFunction(()=>document.querySelector('#outsub-preview-count').textContent.includes('Выбрано 2 из 3'));
   assert.equal(await page.locator('#outsub-preview-list .outsub-node.filtered').count(),1,'US should be filtered by flag without emoji in the original name');
   assert.deepEqual(errors,[],errors.join('; '));
   await context.close();
   console.log('PASS flag insertion and SVG chips width',width);
  }
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
