'use strict';
// Optional real browser smoke: needs playwright-core (NODE_PATH).
// Uses actual country-flags.js and the project's bundled country SVG files.
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright-core');
const web=path.resolve(__dirname,'../web');
const source=fs.readFileSync(path.join(web,'mihomo-settings.js'),'utf8');
const start=source.indexOf('  function displayedCurrentNode(');
const end=source.indexOf('  function groupTypeLabel(',start);
const paintStart=source.indexOf('  function paintCurrentGroupNode(');
const paintEnd=source.indexOf('  // Update visible text nodes',paintStart);
if(start<0||end<start||paintStart<0||paintEnd<paintStart)throw Error('helper boundaries changed');
const helperCode=source.slice(start,end)+'\n'+source.slice(paintStart,paintEnd);
const fixture=path.join(web,'.current-outbound-flags-test.html');
const doc='<!doctype html><html><head><style>'+
'.mihomo-current-group{display:inline-flex;align-items:center;gap:8px}'+
'.mihomo-current-country-flag{width:18px;height:12px;object-fit:cover}'+
'</style></head><body>'+
'<span id="foreign" class="mihomo-current-group"></span>'+
'<span id="russia" class="mihomo-current-group"></span>'+
'<span id="renamed" class="mihomo-current-group"></span>'+
'<script src="country-flags.js"></script></body></html>';
const runCode=[
'const app={state:{state:{outboundSubscriptions:[{id:"s-quatro",name:"quatro-vpn",group:"Renamed-Foreign"}]}}};',
'const draft={outbounds:[{kind:"group",name:"Renamed-Foreign",subscriptionIds:["s-quatro"]}]};',
'const balancerSubscriptions=[];',
'const activeGroupResults=new Map([',
" ['FOREIGN',{running:true,applied:true,current:'INT | lv 🟩 🔥 ⭐ 0.1X - LTE №51 - Латвия'}],",
" ['Russia',{running:true,applied:true,current:'RU | ru 0.1X - LTE №65 - Москва'}],",
" ['Renamed-Foreign',{running:true,applied:true,current:'quatro-vpn | 🇪🇪 🟩 ⚡ ⭐ 0.1X - LTE №78 - Эстония'}]",
']);',
'const groupResultLabel=()=>"";const groupResultTitle=()=>"";const groupTestNote=()=>"";',
helperCode,
'paintCurrentGroupNode(document.getElementById("foreign"),"FOREIGN");',
'paintCurrentGroupNode(document.getElementById("russia"),"Russia");',
'paintCurrentGroupNode(document.getElementById("renamed"),"Renamed-Foreign");'
].join('\n');
(async()=>{
 fs.writeFileSync(fixture,doc);
 let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--allow-file-access-from-files']});
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(fixture).href);
  await page.addScriptTag({content:runCode});
  await page.waitForFunction(()=>document.querySelectorAll('.mihomo-current-country-flag').length===3);
  await page.waitForFunction(()=>[...document.querySelectorAll('.mihomo-current-country-flag')].every(n=>n.complete&&n.naturalWidth>0));
  const data=await page.evaluate(()=>['foreign','russia','renamed'].map(id=>{
    const e=document.getElementById(id),img=e.querySelector('img'),label=e.querySelector('.mihomo-current-country-label');
    return {src:img.src,text:label.textContent,title:e.title,naturalWidth:img.naturalWidth,alt:img.alt};
  }));
  if(errors.length)throw Error('browser errors: '+errors.join('; '));
  if(!data[0].src.endsWith('/flags/lv.svg')||!data[1].src.endsWith('/flags/ru.svg')||
     !data[2].src.endsWith('/flags/ee.svg'))throw Error('wrong assets '+JSON.stringify(data));
  if(data[2].text.includes('quatro-vpn |')||!data[2].text.includes('Эстония'))
    throw Error('subscription name visible after group rename '+JSON.stringify(data[2]));
  if(data[0].text.includes('lv')||data[1].text.match(/^ru\b/i)||!data[0].text.includes('Латвия')||!data[1].text.includes('Москва'))throw Error('raw country code visible '+JSON.stringify(data));
  if(data[0].naturalWidth===0||data[1].naturalWidth===0)throw Error('SVG not loaded');
  // The image must be the SAME DOM node across repeated health polling.
  // Replacing it every nine seconds reloads the SVG and makes the flag blink.
  const stable=await page.evaluate(()=>{
    const f=document.querySelector('#foreign img'),r=document.querySelector('#russia img');
    for(let i=0;i<12;i++){
      paintCurrentGroupNode(document.getElementById('foreign'),'FOREIGN');
      paintCurrentGroupNode(document.getElementById('russia'),'Russia');
    }
    const sameFlags=f===document.querySelector('#foreign img')&&r===document.querySelector('#russia img');
    activeGroupResults.get('FOREIGN').current='INT | lv 🟩 🔥 ⭐ 0.1X - LTE №52 - Латвия';
    paintCurrentGroupNode(document.getElementById('foreign'),'FOREIGN');
    const sameFlagAfterLabelChange=f===document.querySelector('#foreign img');
    const label=document.querySelector('#foreign .mihomo-current-country-label').textContent;
    return {sameFlags,sameFlagAfterLabelChange,label};
  });
  if(!stable.sameFlags||!stable.sameFlagAfterLabelChange||!stable.label.includes('№52'))
    throw Error('flag SVG reloaded during refresh: '+JSON.stringify(stable));
  console.log('PASS: real browser loads LV/RU/EE SVG, hides provider after group rename and keeps stable flags');
  for(const d of data)console.log(JSON.stringify(d));
 }finally{await browser?.close();fs.rmSync(fixture,{force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
