'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
const html=fs.readFileSync('web/index.html','utf8'),js=fs.readFileSync('web/mihomo-settings.js','utf8');
const tabs=html.slice(html.indexOf('<div class="mihomo-tabs">'),html.indexOf('<span class="ink-bar" data-ink-for="mihomo"></span>'))+'</div>';
const start=js.indexOf('  const ruleHelpDescriptions='),end=js.indexOf('  // Every user rule is retained',start);
const code=js.slice(start,end)+'\nsetupRuleHelp();';
const styles=[...html.matchAll(/<link rel="stylesheet" href="static\/([^"?]+\.css)(?:\?[^"]+)?"([^>]*)>|<style>([\s\S]*?)<\/style>/g)];
const cssFor=theme=>styles.filter(x=>!x[2]||!x[2].includes('data-ui-only=')||x[2].includes('data-ui-only="'+theme+'"')).map(x=>x[3]??fs.readFileSync('web/'+x[1],'utf8')).join('\n');
const wrap=t=>'<section id="mihomo-settings-root">'+t+'</section>';
const exact='Тонкие настройки мониторинга здоровья серверов. Рекомендуется не менять значения по умолчанию. Меняйте если только знаете зачем.';
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 for(const [skin,dark] of [['light',false],['graphite',true],['emerald',true],['ivory',false],['aurora',true]]){
 for(const theme of ['shadcn','md3','liquid'])for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900}});page.setDefaultTimeout(5000);
 await page.setContent('<html data-ui-theme="'+theme+'" data-color-skin="'+skin+'" data-theme="'+(dark?'dark':'light')+'"><head><style>'+cssFor(theme)+'</style></head><body class="'+(dark?'dark':'')+'">'+wrap(tabs)+'</body></html>');
 await page.evaluate(()=>{window.muiGetLang=()=> 'ru';window.muiT=k=>k;});
 await page.addScriptTag({content:code});
 const tab=page.locator('[data-mihomo-tab="smart-health"]'),help=page.locator('.smart-health-tab-help'),pop=page.locator('#mihomo-rule-help-popup');
 const actual=await tab.evaluate(e=>({width:getComputedStyle(e).borderTopWidth,color:getComputedStyle(e).borderTopColor,style:getComputedStyle(e).borderTopStyle}));
 assert.equal(actual.width,'2px');assert.equal(actual.style,'solid');assert.match(actual.color,/rgb\((201, 46, 64|255, 133, 142)\)/);
 const h=await help.evaluate(e=>{const s=getComputedStyle(e);return {width:s.width,height:s.height,radius:s.borderRadius,border:s.borderTopWidth,color:s.color,weight:s.fontWeight}});
 assert.equal(h.width,'24px');assert.equal(h.height,'24px');assert.equal(h.radius,'50%');assert.equal(h.border,'2px');assert.equal(h.weight,'700');assert.match(h.color,/rgb\((201, 46, 64|255, 133, 142)\)/);
 await tab.evaluate(e=>e.classList.add('active'));
 assert.equal(await tab.evaluate(e=>getComputedStyle(e).borderTopWidth),'2px');
 assert.equal(await tab.locator('button').count(),0,'no nested button');
 await help.scrollIntoViewIfNeeded();await page.waitForTimeout(150);await help.hover();await pop.waitFor({state:'visible'});assert.equal(await pop.textContent(),exact);
 const rect=await pop.boundingBox();assert(rect.x>=0&&rect.x+rect.width<=width,'popup clipped');
 await page.mouse.move(1,850);await pop.waitFor({state:'hidden'});
 await help.click();await pop.waitFor({state:'visible'});
 assert.equal(await help.getAttribute('aria-expanded'),'true');
 await page.keyboard.press('Escape');await pop.waitFor({state:'hidden'});
 console.log('PASS',skin,theme,width);await page.close();
 }
 }
 const touch=await browser.newContext({viewport:{width:390,height:850},hasTouch:true,isMobile:true});
 const page=await touch.newPage();await page.setContent(wrap(tabs)+'<style>'+cssFor('shadcn')+'</style>');
 await page.evaluate(()=>{window.muiGetLang=()=> 'ru';window.muiT=k=>k;});
 await page.addScriptTag({content:code});await page.locator('.smart-health-tab-help').tap();
 await page.locator('#mihomo-rule-help-popup').waitFor({state:'visible'});
 assert.equal(await page.locator('#mihomo-rule-help-popup').textContent(),exact);
 await touch.close();
 console.log('PASS: red border, separate !, hover, click, Escape, tap, viewport, 30 theme/device combinations');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
