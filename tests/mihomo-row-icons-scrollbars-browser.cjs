'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright-core');
const index=fs.readFileSync('web/index.html','utf8');
assert(index.includes('static/color-skins.css?v=116'));
assert(index.includes('static/mihomo-settings.js?v=131'));
const css=[
  'liquid-glass.css','mihomo-settings.css','liquid-button.css'
].map(name=>fs.readFileSync('web/'+name,'utf8')).join('\n')+
  [...index.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match=>match[1]).join('\n')+
  ['theme-shadcn.css','theme-md3.css','color-skins.css'].map(name=>fs.readFileSync('web/'+name,'utf8')).join('\n')+
  '\n*{transition:none!important;animation:none!important}';
const icon=(kind,attrs='')=>'<button class="mihomo-icon '+kind+'" '+attrs+'><svg class="sf-symbol" viewBox="0 0 24 24" style="stroke:currentColor"><path d="M3 12h18"/></svg></button>';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  for(const theme of ['liquid','shadcn','md3'])for(const width of [390,1440]){
   const doc='<!doctype html><html data-ui-theme="'+theme+'" data-color-skin="emerald">'+
    '<head><style>'+css+'</style></head><body class="dark">'+
    '<section id="mihomo-settings-root"><div class="mihomo-table-wrap"><table class="mihomo-table">'+
    '<tbody><tr><td><div class="mihomo-actions">'+
    icon('','data-outbound-up="1"')+icon('','data-outbound-down="1"')+
    icon('','data-outbound-edit="1"')+icon('danger','data-outbound-delete="1"')+
    '</div></td><td>'+icon('','data-test-outbound="France"')+'</td></tr></tbody></table></div></section>'+
    '<div class="mihomo-modal" style="width:280px;height:150px;overflow:auto"><div style="height:1100px">Modal</div></div>'+
    '<div class="fbs-table-wrap" style="width:260px;max-height:150px;overflow:auto"><div style="height:1100px">Servers</div></div>'+
    '</body></html>';
   const page=await browser.newPage({viewport:{width,height:850}});
   await page.setContent(doc);
   const expected=[['[data-outbound-up]','rgb(23, 188, 145)'],['[data-outbound-down]','rgb(23, 188, 145)'],['[data-outbound-edit]','rgb(23, 188, 145)'],['[data-outbound-delete]','rgb(255, 83, 103)'],['[data-test-outbound]','rgb(255, 202, 69)']];
   for(const [selector,color] of expected){
     const el=page.locator(selector);
     await el.hover();
     await page.waitForTimeout(240);
     const actual=await el.evaluate(btn=>({
       color:getComputedStyle(btn).color,
       border:getComputedStyle(btn).borderTopColor,
       icon:getComputedStyle(btn.querySelector('svg')).color
     }));
     assert.equal(actual.color,color,theme+':'+width+':'+selector+':hover text');
     assert.equal(actual.border,color,theme+':'+width+':'+selector+':hover border');
     assert.equal(actual.icon,color,theme+':'+width+':'+selector+':hover icon');
   }
   const test=page.locator('[data-test-outbound]');
   await page.evaluate(()=>{const test=document.querySelector('[data-test-outbound]');test.disabled=true;test.classList.add('mihomo-test-running')});
   await page.mouse.move(width-5,5);
   const clicked=await test.evaluate(el=>({color:getComputedStyle(el).color,border:getComputedStyle(el).borderTopColor,opacity:getComputedStyle(el).opacity}));
   assert.equal(clicked.color,'rgb(255, 202, 69)',theme+':'+width+':running test keeps yellow');
   assert.equal(clicked.border,'rgb(255, 202, 69)',theme+':'+width+':running border');
   assert.equal(clicked.opacity,'1',theme+':'+width+':running icon stays visible');
   for(const selector of ['.mihomo-modal','.fbs-table-wrap']){
     const scroll=await page.locator(selector).evaluate(el=>({
       overflow:getComputedStyle(el).overflowY,
       width:getComputedStyle(el,'::-webkit-scrollbar').width,
       track:getComputedStyle(el,'::-webkit-scrollbar-track').backgroundColor,
       thumb:getComputedStyle(el,'::-webkit-scrollbar-thumb').backgroundColor,
       scrollable:el.scrollHeight>el.clientHeight
     }));
     assert(scroll.scrollable,selector+' must scroll');
     assert.equal(scroll.width,'12px',theme+':'+width+':'+selector+' scrollbar width');
     assert.notEqual(scroll.thumb,'rgba(0, 0, 0, 0)',selector+' visible thumb');
   }
   console.log('PASS row icon hover/test running and 12px scrollbar',theme,width);
   await page.close();
  }
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1});
