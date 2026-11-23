'use strict';
// Computed paint + real pointer interaction for login/save across theme skins.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const read=file=>fs.readFileSync('web/'+file,'utf8');
const login=read('login.html'),index=read('index.html');
const inline=html=>[...html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g)]
  .map(m=>m[1]).join('\n');
const common=['liquid-button.css','theme-shadcn.css','theme-md3.css','color-skins.css','action-button-feedback.css'];
const panelCSS=[read('liquid-glass.css'),read('mihomo-settings.css'),inline(index),...common.map(read)].join('\n');
const loginCSS=[inline(login),...common.map(read)].join('\n');
const toRGB=s=>(s.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
const luminance=rgb=>rgb.map(v=>{let n=v/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4})
  .reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
async function sampleButton(page,button){
 const image=(await button.screenshot({animations:'disabled'})).toString('base64');
 return page.evaluate(async data=>{
   const image=new Image();image.src='data:image/png;base64,'+data;
   await image.decode();
   const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
   const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
   return [...ctx.getImageData(Math.round(image.width*.16),Math.round(image.height*.52),1,1).data].slice(0,3);
 },image);
}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 let count=0,minimum=Infinity;
 try{
  const samples=[
   ...['liquid','shadcn','md3'].flatMap(theme=>['dark','light'].map(mode=>({theme,mode,skin:'none'}))),
   ...['graphite','ivory','emerald','aurora'].flatMap(skin=>['dark','light'].map(mode=>({theme:'shadcn',mode,skin}))),
   {theme:'liquid',mode:'dark',skin:'emerald'},
   {theme:'md3',mode:'dark',skin:'ivory'}
  ];
  for(const type of ['login','save']){
   const page=await browser.newPage({viewport:{width:940,height:690}});
   const css=type==='login'?loginCSS:panelCSS;
   const markup=type==='login'
    ?'<form><button id="login-button" class="login-button" type="button">Войти</button></form>'
    :'<div id="mihomo-settings-root"><div class="mihomo-actionbar"><button id="mihomo-save" class="primary-btn" type="button"><span class="mihomo-dirty-dot"></span>Сохранить</button></div></div>';
   await page.setContent('<!doctype html><html><head><style>'+css+'</style></head><body><div style="padding:60px">'+markup+'</div></body></html>');
   const button=page.locator(type==='login'?'#login-button':'#mihomo-save');
   await button.evaluate(el=>{el.style.width='190px';el.style.height='46px';el.addEventListener('click',()=>window.__pressed=(window.__pressed||0)+1)});
   for(const {theme,mode,skin} of samples){
    await page.evaluate(({theme,mode,skin})=>{
      const root=document.documentElement;
      root.setAttribute('data-ui-theme',theme);
      if(skin==='none')root.removeAttribute('data-color-skin');else root.setAttribute('data-color-skin',skin);
      root.classList.toggle('dark',mode==='dark');
      root.setAttribute('data-theme',mode);
      document.body.classList.toggle('dark',mode==='dark');
    },{theme,mode,skin});
    await button.evaluate(el=>el.disabled=false);
    await page.mouse.move(880,660);
    await page.waitForTimeout(230);
    const before=await button.evaluate(el=>{
      const s=getComputedStyle(el);return {fill:s.webkitTextFillColor,color:s.color,
        bg:s.backgroundImage,shadow:s.boxShadow,disabled:el.disabled,transform:s.transform};
    });
    assert.match(before.bg,/linear-gradient/i,JSON.stringify({type,theme,mode,skin,before}));
    const background=await sampleButton(page,button);
    const fg=toRGB(before.fill);
    const contrast=ratio(background,fg);minimum=Math.min(minimum,contrast);
    assert(contrast>=4.4,JSON.stringify({type,theme,mode,skin,background,fg,contrast}));
    assert(background.some(x=>x>15)&&background.some(x=>x<242),'background not pure white/black: '+JSON.stringify({type,theme,mode,skin,background}));
    await button.hover({force:true});await page.waitForTimeout(250);
    const hover=await button.evaluate(el=>{
      const s=getComputedStyle(el);return {bg:s.backgroundImage,shadow:s.boxShadow,fill:s.webkitTextFillColor};
    });
    assert.match(hover.bg,/linear-gradient/i);
    assert.notEqual(hover.shadow,before.shadow,'hover glow must change');
    const box=await button.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.mouse.down();await page.waitForTimeout(180);
    const pressed=await button.evaluate(el=>{
      const s=getComputedStyle(el);return {bg:s.backgroundImage,transform:s.transform,fill:s.webkitTextFillColor};
    });
    assert.match(pressed.bg,/linear-gradient/i,'active press cannot flash to a solid white/black fill');
    assert(!['none','matrix(1, 0, 0, 1, 0, 0)'].includes(pressed.transform),
      'press must visibly move/scale: '+JSON.stringify({type,theme,mode,skin,pressed}));
    await page.mouse.up();
    await button.evaluate(el=>el.disabled=true);await page.waitForTimeout(225);
    const disabled=await button.evaluate(el=>({bg:getComputedStyle(el).backgroundImage,
      ink:getComputedStyle(el).webkitTextFillColor,opacity:+getComputedStyle(el).opacity}));
    assert.match(disabled.bg,/linear-gradient/i,JSON.stringify({type,theme,mode,skin,disabled}));
    assert(disabled.opacity<1,'disabled must be visibly quiet: '+JSON.stringify({type,theme,mode,skin,disabled}));
    count++;
   }
   await page.emulateMedia({reducedMotion:'reduce'});
   await button.evaluate(el=>el.disabled=false);
   await button.hover({force:true});
   const reduced=await button.evaluate(el=>({duration:getComputedStyle(el).transitionDuration}));
   assert(reduced.duration.split(',').every(v=>parseFloat(v)===0),'reduced-motion disables transitions: '+reduced.duration);
   await page.close();
  }
 }finally{await browser.close();}
 console.log('PASS Login/Save real pointer and paint:',count,'skin/theme combos, minimum text contrast',minimum.toFixed(2));
})().catch(e=>{console.error(e);process.exitCode=1});
