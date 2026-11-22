'use strict';
// A real Chromium regression for the 5-second GLOBAL /api/state redraw.
// Previous tests only repainted one span, but renderOutbounds() itself was
// destroying the entire table and reloading an unchanged SVG flag every poll.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright-core');
const web=path.resolve(__dirname,'../web');
const source=fs.readFileSync(path.join(web,'mihomo-settings.js'),'utf8');
const html=fs.readFileSync(path.join(web,'index.html'),'utf8');
assert(html.includes('static/mihomo-settings.js?v=119'));
assert(html.includes('static/mihomo-settings.css?v=121'));
const chunk=(a,b)=>{
 const start=source.indexOf(a),end=source.indexOf(b,start);
 assert(start>=0&&end>start,a+' -> '+b);
 return source.slice(start,end);
};
const script=[
 "const root=document.getElementById('mihomo-settings-root');",
 "const $=s=>root.querySelector(s), $$=(s,c=root)=>[...c.querySelectorAll(s)];",
 "const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('\"','&quot;');",
 "const fmt=x=>String(x);const SF=x=>'*';const muiT=k=>k;",
 "const group={id:'g1',name:'Foreign-quatro-vpn',type:'url-test',kind:'group',proxies:['LV'],interval:180};",
 "const draft={basics:{directIpVersion:'dual',ipv4Domains:[],outboundUploadStatistics:true,outboundDownloadStatistics:true},outbounds:[group]};",
 "const app={state:{state:{outbounds:[group],outboundSubscriptions:[{id:'sub-1',group:'Foreign-quatro-vpn'}],outboundTraffic:{'Foreign-quatro-vpn':{up:0,down:0}}}}};",
 "const outboundTableMarkup=new WeakMap();const delayResults=new Map();",
 "const activeGroupResults=new Map([['Foreign-quatro-vpn',{running:true,applied:true,current:'INT | lv 0.1X - LTE №51 - Латвия'}]]);",
 "let activeGroupRequest=null,balancerSubscriptions=[],currentTab='subscriptions';",
 "const vpnGateStatusHTML=()=>'';const testOutbound=()=>{};",
 "window.__currentName='INT | lv 0.1X - LTE №51 - Латвия';",
 "const api=async()=>({running:true,groups:{'Foreign-quatro-vpn':{applied:true,current:window.__currentName}}});",
 chunk('  function outboundAddress(', '  function paintCurrentGroupNode('),
 chunk('  function paintCurrentGroupNode(', '  function outboundSupportsDelay('),
 chunk('  function outboundSupportsDelay(', '  function moveOutbound(id,delta){'),
 "window.__test={renderOutbounds,app,draft,activeGroupResults,outboundTableMarkup};",
 "renderOutbounds();"
].join('\n');
const file=path.join(web,'.current-outbound-repaint-test.html');
const fixture='<!doctype html><html><head><meta charset="UTF-8">'+
 '<link rel="stylesheet" href="mihomo-settings.css"></head><body>'+
 '<section id="mihomo-settings-root">'+
 '<div id="mihomo-subscription-balancer-table"></div>'+
 '<div id="mihomo-balancer-table"></div>'+
 '<div id="mihomo-outbound-table"></div>'+
 '</section><script src="country-flags.js"></script></body></html>';
(async()=>{
 fs.writeFileSync(file,fixture);
 let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--allow-file-access-from-files']});
  for(const width of [390,1440]){
   const page=await browser.newPage({viewport:{width,height:820}});
   const errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(pathToFileURL(file).href);
   await page.addScriptTag({content:script});
   await page.waitForFunction(()=>document.querySelector('.mihomo-current-country-flag')?.naturalWidth>0);
   await page.evaluate(()=>{
     const box=document.querySelector('#mihomo-subscription-balancer-table');
     window.__table=box.querySelector('table');
     window.__flag=box.querySelector('.mihomo-current-country-flag');
     window.__rebuildCount=0;
     window.__observer=new MutationObserver(events=>{
       for(const event of events)if(event.type==='childList'&&event.removedNodes.length)window.__rebuildCount++;
     });
     window.__observer.observe(box,{childList:true});
   });
   await page.evaluate(async()=>{
     for(let i=0;i<12;i++){
       __test.app.state.state.outboundTraffic['Foreign-quatro-vpn']={up:i*10,down:i*5};
       __test.renderOutbounds(); // same as renderState() on each /api/state poll
       await Promise.resolve(); // allow the server/current poll to settle
     }
   });
   const stable=await page.evaluate(()=>{
     const box=document.querySelector('#mihomo-subscription-balancer-table');
     const flag=box.querySelector('.mihomo-current-country-flag');
     return {same:flag===window.__flag,connected:window.__flag.isConnected,
       sameTable:box.querySelector('table')===window.__table,
       removals:window.__rebuildCount+window.__observer.takeRecords().filter(e=>e.removedNodes.length).length,
       width:getComputedStyle(flag).width,height:getComputedStyle(flag).height,
       traffic:box.querySelector('[data-outbound-traffic]').textContent};
   });
   assert.equal(stable.same,true,'the same SVG element must persist throughout global polls: '+JSON.stringify(stable));
   assert.equal(stable.sameTable,true,'global refresh must never recreate unchanged table');
   assert.equal(stable.removals,0,'no DOM removal when polling');
   assert.equal(stable.connected,true);
   assert.equal(stable.width,'16px');
   assert.equal(stable.height,'11px');
   assert.equal(stable.traffic,'110 / 55','traffic counters must update without table rebuild');
   // When the ACTIVE node label changes but the country remains Latvia, only
   // the text content changes; the flag and the table retain identity.
   await page.evaluate(async()=>{
     window.__currentName='INT | lv 0.1X - LTE №52 - Латвия';
     __test.activeGroupResults.get('Foreign-quatro-vpn').current=window.__currentName;
     __test.renderOutbounds();
     await Promise.resolve();
   });
   const updated=await page.evaluate(()=>({
     same:document.querySelector('.mihomo-current-country-flag')===window.__flag,
     label:document.querySelector('.mihomo-current-country-label').textContent
   }));
   assert(updated.same&&updated.label.includes('№52'),JSON.stringify(updated));
   // A genuine change of country must switch SVG exactly once, then remain
   // stable through subsequent global polls.
   await page.evaluate(async()=>{
     window.__currentName='RU | ru 0.1X - LTE №65 - Москва';
     __test.activeGroupResults.get('Foreign-quatro-vpn').current=window.__currentName;
     __test.renderOutbounds();
     await Promise.resolve();
     window.__newFlag=document.querySelector('.mihomo-current-country-flag');
     for(let i=0;i<10;i++){__test.renderOutbounds();await Promise.resolve();}
   });
   const changed=await page.evaluate(()=>({
     replaced:window.__newFlag!==window.__flag,
     unchangedAfter:window.__newFlag===document.querySelector('.mihomo-current-country-flag'),
     src:window.__newFlag.getAttribute('src')
   }));
   assert(changed.replaced&&changed.unchangedAfter&&changed.src.includes('ru.svg'),JSON.stringify(changed));
   // When membership REALLY changes, structural table markup must update.
   await page.evaluate(()=>{__test.draft.outbounds[0].proxies.push('RU');__test.renderOutbounds()});
   assert.match(await page.locator('#mihomo-subscription-balancer-table').textContent(),/2 узлов/);
   assert.deepEqual(errors,[]);
   console.log('PASS real global-state redraw',width,'px: flag preserved across 12+10 polls, counters refreshed, smaller 16x11px');
   await page.close();
  }
 }finally{await browser?.close();fs.rmSync(file,{force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
