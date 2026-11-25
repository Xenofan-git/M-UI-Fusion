'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
const html=fs.readFileSync('web/index.html','utf8'),js=fs.readFileSync('web/mihomo-settings.js','utf8');
const tabs=html.slice(html.indexOf('<div class="mihomo-tabs">'),html.indexOf('<span class="ink-bar" data-ink-for="mihomo"></span>'))+'</div>';
const start=js.indexOf('  const ruleHelpDescriptions='),end=js.indexOf('  // Every user rule is retained',start);
const code=js.slice(start,end)+'\nsetupRuleHelp();';
const css=fs.readFileSync('web/mihomo-settings.css','utf8');
const exact='Тонкие настройки мониторинга здоровья серверов. Рекомендуется не менять значения по умолчанию. Меняйте если только знаете зачем.';
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 for(const [skin,dark] of [['light',false],['graphite',true],['emerald',true],['ivory',false],['aurora',true]]){
 for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900}});
 await page.setContent('<html data-color-skin="'+skin+'"><head><style>'+css+'</style></head><body class="'+(dark?'dark':'')+'" style="--line:#9aaba4;--surface-subtle:#eee;--surface-strong:#fff;--text-strong:#111;--text:#222;--muted:#444">'+tabs+'</body></html>');
 await page.evaluate(()=>{window.muiGetLang=()=> 'ru';window.muiT=k=>k;});
 await page.addScriptTag({content:code});
 const tab=page.locator('[data-mihomo-tab="smart-health"]'),help=page.locator('.smart-health-tab-help'),pop=page.locator('#mihomo-rule-help-popup');
 const actual=await tab.evaluate(e=>({width:getComputedStyle(e).borderTopWidth,color:getComputedStyle(e).borderTopColor,style:getComputedStyle(e).borderTopStyle}));
 assert.equal(actual.width,'1px');assert.equal(actual.style,'solid');assert.match(actual.color,/rgb\((196, 63, 71|240, 123, 130)\)/);
 assert.equal(await tab.locator('button').count(),0,'no nested button');
 await help.hover();await pop.waitFor({state:'visible'});assert.equal(await pop.textContent(),exact);
 const rect=await pop.boundingBox();assert(rect.x>=0&&rect.x+rect.width<=width,'popup clipped');
 await page.mouse.move(1,850);await pop.waitFor({state:'hidden'});
 await help.click();await pop.waitFor({state:'visible'});
 assert.equal(await help.getAttribute('aria-expanded'),'true');
 await page.keyboard.press('Escape');await pop.waitFor({state:'hidden'});
 await page.close();
 }
 }
 const touch=await browser.newContext({viewport:{width:390,height:850},hasTouch:true,isMobile:true});
 const page=await touch.newPage();await page.setContent(tabs+'<style>'+css+'</style>');
 await page.evaluate(()=>{window.muiGetLang=()=> 'ru';window.muiT=k=>k;});
 await page.addScriptTag({content:code});await page.locator('.smart-health-tab-help').tap();
 await page.locator('#mihomo-rule-help-popup').waitFor({state:'visible'});
 assert.equal(await page.locator('#mihomo-rule-help-popup').textContent(),exact);
 await touch.close();
 console.log('PASS: red border, separate !, hover, click, Escape, tap, viewport, 10 theme/device combinations');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
