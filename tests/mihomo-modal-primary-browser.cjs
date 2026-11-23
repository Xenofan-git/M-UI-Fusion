'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const read=file=>fs.readFileSync(file,'utf8');
const index=read('web/index.html');
const css=[
  read('web/mihomo-settings.css'),
  [...index.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)].map(x=>x[1]).join('\n'),
  read('web/liquid-button.css'),
  read('web/theme-shadcn.css'),
  read('web/theme-md3.css'),
  read('web/color-skins.css')
].join('\n');
const fg=read('web/i18n-locales.js');
const js=read('web/mihomo-settings.js');
assert.ok(js.includes('data-i18n="mh.applyToDraft">Apply</button>'),'actual Mihomo modal buttons must use short label');
assert.ok(fg.includes('"mh.applyToDraft": "Применить"'),'Russian action label must be short');
assert.ok(index.includes('static/color-skins.css?v=116'),'updated CSS must bypass browser cache');
assert.ok(index.includes('static/i18n-locales.js?v=119'),'updated translation must bypass browser cache');
const sample=async(page,id)=>page.locator('#'+id+' button.primary-btn').evaluate(button=>{
  const style=getComputedStyle(button);
  return {
    background:style.backgroundColor,
    backgroundImage:style.backgroundImage,
    foreground:style.color,
    fill:style.webkitTextFillColor,
    opacity:Number(style.opacity),
    disabled:button.disabled,
    text:button.textContent.trim()
  };
});
const rgba=value=>{
  const v=String(value).match(/^rgba?\(([^)]+)\)/);
  if(!v)throw Error('Unrecognized color '+value);
  const n=v[1].split(/[\s,\/]+/).filter(Boolean).slice(0,3).map(Number);
  return n;
};
const luminosity=color=>{
  const rgb=rgba(color).map(n=>{
    const v=n/255;
    return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;
  });
  return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
};
const contrast=(a,b)=>{
  const x=luminosity(a),y=luminosity(b);
  return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);
};
const markup=id=>'<div id="'+id+'"><section class="mihomo-modal"><form><footer class="modal-footer"><button type="button" class="primary-btn">Применить</button></footer></form></section></div>';
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox'],headless:true});
  let checked=0,minContrast=100;
  try{
    for(const skin of ['none','graphite','ivory','emerald','aurora']){
      for(const theme of ['liquid','shadcn','md3']){
        for(const dark of [false,true]){
          const page=await browser.newPage({viewport:{width:1024,height:768}});
          const attr=skin==='none'?'':' data-color-skin="'+skin+'"';
          const doc='<!doctype html><html data-ui-theme="'+theme+'"'+attr+'><head><style>'+css+'</style></head><body class="'+(dark?'dark':'')+'">'+markup('mihomo-rule-modal')+markup('mihomo-outbound-modal')+markup('vpngate-modal')+'</body></html>';
          await page.setContent(doc);
          for(const id of ['mihomo-rule-modal','mihomo-outbound-modal','vpngate-modal']){
            const button=page.locator('#'+id+' button.primary-btn');
            for(const stage of ['normal','hover','focus']){
              if(stage==='normal')await page.mouse.move(900,750);
              if(stage==='hover')await button.hover();
              if(stage==='focus'){await button.focus();}
              const result=await sample(page,id);
              const ratio=contrast(result.background,result.foreground);
              minContrast=Math.min(minContrast,ratio);
              assert.ok(ratio>=4.5,skin+' '+theme+' '+(dark?'dark':'light')+' '+id+' '+stage+': contrast='+ratio.toFixed(2)+' '+JSON.stringify(result));
              assert.equal(result.fill,result.foreground,'webkit text fill mismatch');
              assert.equal(result.backgroundImage,'none','layered glass covered the accent');
              assert.ok(result.opacity>=0.99,'button became translucent');
              assert.equal(result.disabled,false,'enabled button became disabled');
              checked++;
            }
            // reset focus for the next button
            await page.evaluate(()=>document.activeElement?.blur?.());
          }
          await page.close();
        }
      }
    }
    console.log('PASS:',checked,'modal button states (3 modals, 3 states, 5 palettes, 3 layout themes, light/dark), minimum text contrast',minContrast.toFixed(2)+':1');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
