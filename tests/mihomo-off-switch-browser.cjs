'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const read=f=>fs.readFileSync('web/'+f,'utf8');
const css=['mihomo-settings.css','liquid-glass.css','theme-shadcn.css','theme-md3.css','color-skins.css'].map(read).join('\n');
const rgb=s=>(s.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
const lum=a=>a.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4})
 .reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const aa=lum(a),bb=lum(b);return(Math.max(aa,bb)+.05)/(Math.min(aa,bb)+.05)};
(async()=>{
 const b=await chromium.launch({headless:true,executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 let tested=0;
 try{
 for(const width of [390,1280]){
  const p=await b.newPage({viewport:{width,height:750}});
  await p.setContent('<!DOCTYPE html><html><head><style>'+css+'</style></head><body>'+
   '<main id="mihomo-settings-root" style="padding:20px;min-height:300px; background:var(--surface-strong, #1c2831)">'+
   '<table class="mihomo-table" style="width:100%"><tbody><tr class="mihomo-rule-off"><td>Выключено</td><td><div class="mihomo-actions mihomo-rule-controls">'+
   '<label class="mihomo-rule-switch"><input type="checkbox" id="switch" aria-label="Включить"><span class="mihomo-rule-switch-track"></span></label></div></td></tr></tbody></table></main></body></html>');
  for(const [theme,skin,mode] of [['liquid','none','dark'],['shadcn','graphite','dark'],['md3','emerald','dark'],['shadcn','ivory','light'],['md3','none','light']]){
   await p.evaluate(({theme,skin,mode})=>{
    const el=document.documentElement;
    el.dataset.uiTheme=theme;el.dataset.theme=mode;
    if(skin==='none')delete el.dataset.colorSkin;else el.dataset.colorSkin=skin;
    el.classList.toggle('dark',mode==='dark');
    document.body.classList.toggle('dark',mode==='dark');
   },{theme,skin,mode});
   const checkbox=p.locator('#switch'),track=p.locator('.mihomo-rule-switch-track');
   await checkbox.uncheck();
   await p.waitForTimeout(235);
   const state=await track.evaluate(el=>{
    const s=getComputedStyle(el),dot=getComputedStyle(el,'::after');
    return {track:s.backgroundColor,border:s.borderTopColor,dot:dot.backgroundColor,
      dotWidth:parseFloat(dot.width),dotPosition:dot.transform,opacity:s.opacity,
      width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height};
   });
   assert(state.dotWidth>=13,'off thumb must have visible dimensions');
   assert.equal(state.width,34);assert.equal(state.height,20);
   const dotContrast=contrast(rgb(state.dot),rgb(state.track));
   assert(dotContrast>=3,'OFF thumb invisible: '+JSON.stringify({theme,skin,mode,state,dotContrast}));
   const borderContrast=contrast(rgb(state.border),rgb(state.track));
   assert(borderContrast>=1.5,'OFF outline low contrast: '+JSON.stringify({theme,skin,mode,state,borderContrast}));
   await p.locator('.mihomo-rule-switch').click();
   assert(await checkbox.isChecked(),'user click must turn rule on');
   await p.waitForTimeout(225);
   const checked=await track.evaluate(el=>({background:getComputedStyle(el).backgroundColor,
     dotTransform:getComputedStyle(el,'::after').transform}));
   assert.notEqual(checked.background,state.track,'ON must differ from OFF');
   await p.locator('.mihomo-rule-switch').click();
   assert(!(await checkbox.isChecked()),'user click must turn rule back off');
   tested++;
  }
  await p.close();
 }
 }finally{await b.close();}
 console.log('PASS off-switch visible and interactive for',tested,'real Chromium theme/size combinations');
})().catch(e=>{console.error(e);process.exitCode=1});
