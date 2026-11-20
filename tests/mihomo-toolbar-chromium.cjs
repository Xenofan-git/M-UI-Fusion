'use strict';
// Run locally on a machine with Chromium + playwright-core:
// NODE_PATH=/path/to/node_modules MUI_CHROMIUM=/usr/bin/chromium node tests/mihomo-toolbar-chromium.cjs
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');
const root=path.join(__dirname,'..','web');
const get=f=>fs.readFileSync(path.join(root,f),'utf8');
const pageSource=get('index.html');
const inline=[...pageSource.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
const ids=['mihomo-add-outbound','mihomo-add-balancer','mihomo-add-sub-balancer','mihomo-add-rule'];
const buttons=ids.map(id=>{
 const match=pageSource.match(new RegExp('<button\\b[^>]*\\bid="'+id+'"[^>]*>[\\s\\S]*?<\\/button>'));
 if(!match)throw Error('missing button '+id);
 return match[0];
});
function rgb(v){const m=v.match(/^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/);return m&&[+m[1],+m[2],+m[3]]}
function luminosity(arr){const [r,g,b]=arr.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return r*.2126+g*.7152+b*.0722}
function contrast(fg,bg){const a=rgb(fg),b=rgb(bg);if(!a||!b)return 0;const x=luminosity(a),y=luminosity(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 let total=0;const problems=[];
 for(const featureMode of ['modern','legacy-no-color-mix']){
  for(const theme of ['shadcn','md3','liquid']){
   let css=['liquid-glass.css','mihomo-settings.css','outbound-subscriptions.css'].map(get);
   css.push(inline);
   if(theme==='shadcn')css.push(get('theme-shadcn.css'));
   if(theme==='md3')css.push(get('theme-md3.css'));
   if(theme==='liquid')css.push(get('liquid-button.css'));
   css.push(get('color-skins.css'));
   if(featureMode==='legacy-no-color-mix')css=css.map(s=>s.replace(/[a-z-]+\s*:\s*[^;{}]*color-mix\([^;{}]*;/g,''));
   for(const skin of ['','graphite','ivory','emerald','aurora']){
    for(const mode of ['light','dark']){
     const doc='<!doctype html><html data-ui-theme="'+theme+'" data-theme="'+mode+'"'+(skin?' data-color-skin="'+skin+'"':'')+'><head><style>'+css.join('\n')+'</style><style>* {transition:none !important; animation:none !important;}</style></head><body class="'+(mode==='dark'?'dark':'')+'"><div id="mihomo-settings-root"><div class="mihomo-toolbar" style="display:flex;flex-direction:column;align-items:flex-start;padding:20px">'+buttons.join('\n')+'</div></div></body></html>';
     const page=await browser.newPage({viewport:{width:1300,height:840}});
     await page.setContent(doc);
     for(const id of ids){
      const target=page.locator('#'+id);
      for(const hover of [false,true]){
       if(hover)await target.hover();
       else await page.mouse.move(1000,800);
       const props=await target.evaluate(el=>{const s=getComputedStyle(el);return {background:s.backgroundColor,color:s.color,fill:s.webkitTextFillColor,opacity:s.opacity,id:el.id}});
       const ratio=contrast(props.fill,props.background);
       const solid=!props.background.includes('rgba(');
       total++;
       if(!solid||ratio<4.5)problems.push({featureMode,theme,skin:skin||'default',mode,id,hover,ratio:+ratio.toFixed(2),...props});
      }
     }
     await page.close();
    }
   }
  }
 }
 await browser.close();
 console.log('CHROMIUM_EXACT_MIHOMO_TOOLBAR_CASES',total);
 console.log('FAILURES',problems.length);
 for(const bad of problems.slice(0,36))console.log('FAIL',JSON.stringify(bad));
 if(problems.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
