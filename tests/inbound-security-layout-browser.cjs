'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright-core');
const html=fs.readFileSync('web/index.html','utf8');
const markup=html.match(/<details class="inbound-form-section inbound-security" open>[\s\S]*?<\/details>/)?.[0];
const styles=[...html.matchAll(/<style(?: [^>]*)?>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
assert(markup);
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  for(const width of [390,1280]){
   const page=await browser.newPage({viewport:{width,height:920}});
   await page.setContent('<!doctype html><html lang="ru"><head><style>:root{--text-strong:#eef;--line:#777;--surface-modal:#1e2932;--muted:#aab;--radius:9px;--ctl:38px;--ease:ease;--green:#009B77;}body{background:#151e27;color:#eef}</style><style>'+styles+'</style></head><body><div class="drawer" style="height:auto;width:min(740px,100%);margin:0 auto"><form id="inbound-form"><div class="drawer-body">'+markup+'</div></form></div></body></html>');
   assert.equal(await page.locator('.field-security > label').count(),0,'removed duplicate left label');
   assert.equal(await page.locator('.inbound-security > summary').innerText(),'Безопасность');
   const modes=page.locator('#security-segmented');
   const field=page.locator('.field-security');
   const fieldWidth=await field.evaluate(el=>el.getBoundingClientRect().width);
   const modeWidth=await modes.evaluate(el=>el.getBoundingClientRect().width);
   assert(Math.abs(fieldWidth-modeWidth)<=2,'security selector must fill form width');
   const none=page.locator('#security-segmented [data-security="none"]');
   assert.equal(await none.innerText(),'Без защиты');
   assert.equal(await page.locator('#security-none-explanation').innerText(),
     'Не применять дополнительный протокол безопасности (TLS, Reality и т. п.).');
   await page.evaluate(()=>{const el=document.querySelector('#security-none-explanation');el.hidden=true});
   assert.equal(await page.locator('#security-none-explanation').isVisible(),false);
   await page.evaluate(()=>document.querySelector('#security-none-explanation').hidden=false);
   assert.equal(await page.locator('#security-none-explanation').isVisible(),true);
   assert(await page.locator('#security-segmented [data-security="tls"]').isEnabled());
   console.log('PASS inbound security',width,'field and mode width',Math.round(fieldWidth));
   await page.close();
  }
 } finally {await browser.close()}
})().catch(err=>{console.error(err);process.exitCode=1});
