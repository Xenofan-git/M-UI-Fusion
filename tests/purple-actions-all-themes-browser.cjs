'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright-core');
const css=[
 ':root{--ctl:38px;--line:#b5b5bd;--radius-sm:8px}body{--surface:#f7f7fb;--surface-hover:#eeeafa;--card-bg:#fff;background:#f7f7fb;color:#111}body.dark{--surface:#1b1d29;--surface-hover:#292d40;--card-bg:#1b1d29;background:#1b1d29;color:#eee}',
 fs.readFileSync('web/theme-shadcn.css','utf8'),
 fs.readFileSync('web/theme-md3.css','utf8'),
 fs.readFileSync('web/color-skins.css','utf8'),
 fs.readFileSync('web/action-button-feedback.css','utf8')
].join('\n');
const lum=(color)=>{
 const m=color.match(/\d+(?:\.\d+)?/g);
 assert(m&&m.length>=3,'bad rgb: '+color);
 const channels=m.slice(0,3).map(x=>Number(x)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);
 return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];
};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 try {
  for(const theme of ['shadcn','md3','liquid']){
   for(const variant of [{dark:false,skin:null},{dark:true,skin:null},
     {dark:false,skin:'ivory'},{dark:true,skin:'aurora'},
     {dark:false,skin:'graphite'},{dark:false,skin:'emerald'}]){
    const page=await browser.newPage({viewport:{width:1280,height:720}});
    const attrs='data-ui-theme="'+theme+'"'+(variant.skin?' data-color-skin="'+variant.skin+'"':'');
    const body=variant.dark?'dark':'';
    await page.setContent('<!doctype html><html '+attrs+'><head><style>'+css+'</style></head><body class="'+body+'">'+
      '<button id="login-button" class="login-button">Войти</button>'+
      '<section id="mihomo-settings-root"><div class="mihomo-toolbar"><button class="mihomo-primary">Добавить подписку</button></div></section>'+
      '<section id="outsub-root"><div class="outsub-actions"><button class="outline-btn">Обновить</button><button class="outline-btn">Удалить</button></div></section>'+
      '<div id="outsub-modal"><div class="outsub-dialog"><button id="outsub-submit">Сохранить</button></div></div>'+
      '<div class="fbs-editor"><div class="fbs-toolbar"><button class="outline-btn">Опросить серверы</button></div></div>'+
      '</body></html>');
    for(const sel of ['#login-button','.mihomo-primary','#outsub-submit','#outsub-root .outsub-actions button:first-child','.fbs-toolbar .outline-btn']){
     const element=page.locator(sel);
     const properties=await element.evaluate(el=>{
       const style=getComputedStyle(el);
       const before=getComputedStyle(document.body);
       return {color:style.color,bg:style.backgroundColor,border:style.borderTopColor,
         root:before.getPropertyValue('--mui-outline-purple').trim(),
         fill:style.webkitTextFillColor};
     });
     const ratio=(Math.max(lum(properties.color),lum(properties.bg))+.05)/
       (Math.min(lum(properties.color),lum(properties.bg))+.05);
     assert(ratio>=4.5,sel+' contrast '+ratio.toFixed(2)+' '+theme+'/'+JSON.stringify(variant)+' '+JSON.stringify(properties));
     assert.equal(properties.color,properties.border,sel+' border color '+theme+'/'+JSON.stringify(variant));
     assert.equal(properties.color,properties.fill,sel+' webkit text fill '+theme+'/'+JSON.stringify(variant));
    }
    await page.close();
   }
  }
  console.log('PASS purple text/stroke and theme surface visibility for 3 layouts x 6 skins/light-dark x 5 action buttons');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
