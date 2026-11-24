'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const css=fs.readFileSync('web/mihomo-settings.css','utf8');
  const labels=['Основные','Исходящие','Балансировщики из Исходящих','Балансировщики из Подписок','Правила маршрутизации'];
  for(const width of [390,900,1440]){
   const page=await browser.newPage({viewport:{width,height:820}});
   const head='<style>:root{--stroke:#496157;--line:#456158;--text-strong:#e9fff5;--muted:#a6beae;--surface-strong:#172c24;--surface-subtle:#1f3931;--surface-hover:#284c40;--teal:#009B77;--ease:ease}body{background:#101d19;color:#e9fff5;margin:0}#mihomo-settings-root{padding:12px}</style><style>'+css+'</style>';
   const nav=labels.map((v,i)=>'<button type="button" class="mihomo-tab'+(!i?' active':'')+'"><span class="mihomo-tab-icon"><svg class="mihomo-tab-glyph" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/></svg></span><span class="mihomo-tab-label">'+v+'</span></button>').join('');
   await page.setContent('<!doctype html><html><head>'+head+'</head><body><main id="mihomo-settings-root"><div class="mihomo-tabs">'+nav+'</div><div class="fbs-options"><button type="button" class="fbs-tab active"><svg class="fbs-tab-icon" viewBox="0 0 24 24"><path d="M2 3h20L15 12v9l-6-2v-7z"/></svg>Фильтры</button></div></main></body></html>');
   const navButtons=page.locator('.mihomo-tab');
   const navStyle=await navButtons.first().evaluate(el=>({font:parseFloat(getComputedStyle(el).fontSize),weight:getComputedStyle(el).fontWeight,icon:el.querySelector('.mihomo-tab-glyph').getBoundingClientRect().width,outerIcon:el.querySelector('.mihomo-tab-icon').getBoundingClientRect().width}));
   assert.equal(navStyle.font,width<=760?13.5:14.5,'Mihomo tab label size should resemble left menu');
   assert(+navStyle.weight<=600,'Mihomo tab label should not become heavier than original active tab');
   const inactiveWeight=await navButtons.nth(1).evaluate(el=>+getComputedStyle(el).fontWeight);
   assert(inactiveWeight<=500,'Inactive Mihomo tab should retain a light font weight');
   assert(navStyle.icon>=20&&navStyle.outerIcon>=29,'Mihomo icons must grow with tabs');
   const filterStyle=await page.locator('.fbs-tab').first().evaluate(el=>({font:parseFloat(getComputedStyle(el).fontSize),padding:parseFloat(getComputedStyle(el).paddingLeft),icon:el.querySelector('svg').getBoundingClientRect().width}));
   assert.equal(filterStyle.font,14);assert(filterStyle.padding>=17);assert(filterStyle.icon>=18);
   for(const el of await navButtons.all()){
    const box=await el.boundingBox();
    assert(box.x>=-1&&box.x+box.width<=width+1,'Mihomo tabs should fit on viewport '+width);
   }
   await navButtons.nth(3).click();
   assert(await navButtons.nth(3).isEnabled(),'larger tabs must remain operable');
   console.log('PASS',width+'px',navStyle,filterStyle);
   await page.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
