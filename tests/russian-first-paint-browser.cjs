'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const html=fs.readFileSync('web/login.html','utf8');
const i18n=fs.readFileSync('web/i18n.js','utf8');
const locales=fs.readFileSync('web/i18n-locales.js','utf8');
const headHtml=fs.readFileSync('web/index.html','utf8');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 let count=0;
 try {
  for(const [server,stale,expected,heading] of [
   ['ru','zh-CN','ru','Добро пожаловать'],
   ['ru','en','ru','Добро пожаловать'],
   ['en','zh-CN','en','Welcome'],
   ['zh-CN','ru','zh-CN','欢迎'],
  ]){
   const context=await browser.newContext();
   await context.addInitScript(stored=>{try{localStorage.setItem('mui-language',stored)}catch{}},stale);
   const page=await context.newPage();
   await page.route('https://panel.test/**',async route=>{
    const request=new URL(route.request().url());
    const isLogin=request.pathname==='/login';
    if(isLogin){
     // Equivalent to serveLocalizedPage: the backend injects its saved language.
     let rendered=html.replace('data-default-language="ru"','data-default-language="'+server+'"')
       .replace('<html lang="ru"','<html lang="'+server+'"');
     await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:rendered});
     return;
    }
    if(request.pathname.startsWith('/static/')||request.pathname.startsWith('/media/')){
     const relative=request.pathname.slice(1);
     const filename=path.join('web',relative.startsWith('static/')?relative.replace('static/',''):relative);
     if(fs.existsSync(filename))return route.fulfill({status:200,body:fs.readFileSync(filename),contentType:filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'image/png'});
    }
    await route.fulfill({status:404,body:''});
   });
   await page.goto('https://panel.test/login',{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-l10n-pending'),null,{timeout:12000});
   const state=await page.evaluate(()=>({
    title:document.title,lang:document.documentElement.lang,stored:localStorage.getItem('mui-language'),
    heading:document.querySelector('.headline')?.textContent,
    user:document.querySelector('#username')?.getAttribute('placeholder')
   }));
   assert.equal(state.lang,expected,JSON.stringify(state));
   assert.equal(state.heading,heading,JSON.stringify(state));
   assert.equal(state.stored,expected,'outdated browser cache should be reconciled to backend value');
   assert(state.title.includes(server==='ru'?'Вход':server==='en'?'Log In':'登录'),JSON.stringify(state));
   if(server==='ru')assert.equal(state.user,'Имя пользователя');
   if(server==='ru'){
    // Explicit user selection still works instantly, without waiting for API.
    await page.locator('#settings-button').click();
    await page.locator('#language-select').selectOption('en');
    assert.equal(await page.locator('.headline').innerText(),'Welcome');
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.defaultLanguage),'en');
   }
   await context.close();count++;
  }
  // Dashboard shares the same precedence: even cached Chinese must not
  // override the server's Russian language on the first translation pass.
  const indexContext=await browser.newContext();
  const dashboard=await indexContext.newPage();
  await dashboard.route('https://panel.test/**',async route=>{
   if(new URL(route.request().url()).pathname==='/')return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html lang="ru" data-default-language="ru"><head><meta charset="utf-8"><title>RU-first</title></head><body><button data-i18n="nav.overview">Обзор</button><script src="/i18n-locales.js"></script><script src="/i18n.js"></script></body></html>'});
   const u=new URL(route.request().url()).pathname;
   if(u==='/i18n.js'||u==='/i18n-locales.js')return route.fulfill({status:200,contentType:'application/javascript',body:u==='/i18n.js'?i18n:locales});
   await route.fulfill({status:404});
  });
  await indexContext.addInitScript(()=>localStorage.setItem('mui-language','zh-CN'));
  await dashboard.goto('https://panel.test/',{waitUntil:'load'});
  const state=await dashboard.evaluate(()=>({
   lang:window.muiGetLang(),text:document.querySelector('button').innerText,
   cache:localStorage.getItem('mui-language')
  }));
  assert.equal(state.lang,'ru',JSON.stringify(state));
  assert.equal(state.text,'Обзор',JSON.stringify(state));
  await dashboard.evaluate(()=>window.muiSetLang('en'));
  assert.equal(await dashboard.evaluate(()=>window.muiGetLang()),'en','manual locale switch must remain instant');
  await dashboard.evaluate(()=>window.muiSetLang('ru'));
  assert.equal(await dashboard.evaluate(()=>window.muiGetLang()),'ru');
  await indexContext.close();
 }finally{await browser.close();}
 console.log('PASS Russian server-first locale overrides stale Chinese first paint, login/title/dashboard, explicit language choices',count);
})().catch(e=>{console.error(e);process.exitCode=1});
