'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright-core');
const html=fs.readFileSync('web/index.html','utf8'),js=fs.readFileSync('web/mihomo-settings.js','utf8');
const start=html.indexOf('<div class="mihomo-pane active" data-mihomo-pane="basics">');
const end=html.indexOf('<details class="basics-section"><summary data-i18n="mihomo.basic.sniffer">',start);
assert(start>=0&&end>start);
const general=html.slice(start,end);
assert(general.includes('name="watchdogEnabled"')&&general.includes('basics-watchdog-status'));
const fillStart=js.indexOf('  function fillBasicsForm(){');
const fillEnd=js.indexOf('  function renderBasicsTags(',fillStart);
const setupStart=js.indexOf('  function setupBasics(){');
const setupEnd=js.indexOf('  async function testOutbound(',setupStart);
const script=js.slice(fillStart,fillEnd)+js.slice(setupStart,setupEnd)+'\nsetupBasics();fillBasicsForm();';
(async()=>{
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:900}});
 await page.setContent(general+'</div></form></div><span id="basics-mode-warning"></span><input id="basics-dns-log" type="checkbox"><button id="basics-reset">reset</button>');
 await page.evaluate(()=>{
  window.$=s=>document.querySelector(s);window.$$=s=>[...document.querySelectorAll(s)];
  window.draft={basics:{mode:'rule',watchdogEnabled:false,logLevel:'info'}};
  window.app={state:{mihomoWatchdog:{state:'disabled',attempts:0}}};
  window.defaultBasics=()=>({watchdogEnabled:false});
  window.markDirty=()=>{window.changed=true};window.muiT=s=>s;
  window.renderBasicsTags=()=>{};window.saveSettings=()=>{};
 });
 await page.addScriptTag({content:script+'\nwindow.testRender=renderBasicsIndicators;window.testFill=fillBasicsForm;'});
 assert.equal(await page.locator('#basics-watchdogEnabled').isChecked(),false);
 await page.locator('label.switch').filter({has:page.locator('#basics-watchdogEnabled')}).click();
 assert.equal(await page.evaluate(()=>draft.basics.watchdogEnabled&&window.changed),true);
 await page.evaluate(()=>{app.state.mihomoWatchdog={state:'healthy',attempts:1};testRender()});
 assert.match(await page.locator('#basics-watchdog-status').textContent(),/healthy.*1\/3/);
 await page.evaluate(()=>{draft.basics.watchdogEnabled=true;testFill()});
 assert.equal(await page.locator('#basics-watchdogEnabled').isChecked(),true);
 console.log('PASS: Watchdog in Basics > General, switch binds draft, saved state and live status render');
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
