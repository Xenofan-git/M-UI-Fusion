'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
const get=f=>fs.readFileSync('web/'+f,'utf8');
const index=get('index.html');
const css=[
  get('liquid-glass.css'),get('mihomo-settings.css'),
  [...index.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n'),
  ...['liquid-button.css','theme-shadcn.css','theme-md3.css','color-skins.css'].map(get)
].join('\n')+'\n*{transition:none !important;animation:none !important}';
function luminance(hex){return hex.map(n=>{const v=n/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;})
  .reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);}
function parse(color){const nums=String(color).match(/[\d.]+/g);if(!nums||nums.length<3)throw Error(color);return nums.slice(0,3).map(Number);}
function contrast(a,b){const x=luminance(parse(a)),y=luminance(parse(b));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
(async()=>{
 const b=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 let count=0,minContrast=99;
 try{
  for(const theme of ['liquid','shadcn','md3'])
   for(const skin of ['none','graphite','ivory','emerald','aurora'])
    for(const mode of ['dark','light']){
     const p=await b.newPage({viewport:{width:1000,height:750}});
     await p.setContent('<!doctype html><html data-ui-theme="'+theme+'"'+(skin==='none'?'':' data-color-skin="'+skin+'"')+'"><head><style>'+css+'</style></head><body class="'+(mode==='dark'?'dark':'')+'"><div id="mihomo-settings-root" class="mihomo-settings-page"><div class="mihomo-actionbar"><button id="mihomo-save" class="primary-btn" disabled><span class="mihomo-dirty-dot"></span>Сохранить</button></div></div></body></html>');
     const button=p.locator('#mihomo-save');
     for(const disabled of [true,false]){
      await button.evaluate((el,v)=>el.disabled=v,disabled);await p.waitForTimeout(35);
      for(const hover of [false,true]){
       if(hover)await p.mouse.move(1000,750).then(()=>button.hover({force:true}));
       else await p.mouse.move(1000,750);
       await p.waitForTimeout(35);
       const result=await button.evaluate(el=>{
        const c=getComputedStyle(el);
        return {bg:c.backgroundColor,fg:c.color,fill:c.webkitTextFillColor,bgImage:c.backgroundImage,opacity:+c.opacity,disabled:el.disabled};
       });
       const ratio=contrast(result.bg,result.fg);minContrast=Math.min(minContrast,ratio);
       assert.ok(ratio>=7,JSON.stringify({theme,skin,mode,disabled,hover,result,ratio}));
       assert.equal(result.bgImage,'none',JSON.stringify(result));
       assert.ok(contrast(result.bg,result.fill)>=7,JSON.stringify({theme,skin,mode,disabled,hover,result}));
       assert.ok(!disabled||result.opacity<1,'disabled must look disabled');
       assert.ok(disabled||result.opacity>=.7,'enabled must remain visually legible');
       count++;
      }
     }
     await p.close();
    }
 }finally{await b.close();}
 console.log('PASS Save hover & disabled',count,'states, minimum contrast',minContrast.toFixed(2));
})().catch(e=>{console.error(e);process.exitCode=1});
