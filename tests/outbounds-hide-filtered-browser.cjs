'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const source=fs.readFileSync('web/mihomo-settings.js','utf8');
const styles=fs.readFileSync('web/mihomo-settings.css','utf8');
const html=fs.readFileSync('web/index.html','utf8');
const chunk=(a,b)=>{
 const first=source.indexOf(a),last=source.indexOf(b,first);
 assert(first>=0&&last>first,a);return source.slice(first,last);
};
assert(html.includes('id="mihomo-hide-filtered-outbounds"'));
const proxy=(id,name,type='vless')=>({id,name,kind:'proxy',type,server:'same.example.test',port:443});
const items=[
 proxy('p1','RU | 🇷🇺 ★ LTE Россия'),
 proxy('p2','INT | 🇷🇺 ★ LTE Москва'),
 proxy('p3','INT | 🇷🇺 ★ LTE Казань'),
 proxy('p4','INT | 🇩🇪 ★ LTE Germany'),
 proxy('p5','INT | 🇷🇺 ★ LTE Россия','hysteria2'),
 {id:'group1',kind:'group',name:'Russia',type:'url-test',proxies:['RU | 🇷🇺 ★ LTE Россия']},
];
const subs=[
 {id:'src1',group:'FOREIGN',name:'quatro-vpn',filteredNodes:[
  {name:'🇷🇺 ★ LTE Россия',protocol:'vless'},
  {name:'🇷🇺 ★ LTE Москва',protocol:'vless'},
  {name:'🇷🇺 ★ LTE Удалённый узел',protocol:'vless'},
 ]}
];
const script=[
 "const root=document.getElementById('mihomo-settings-root');",
 "const $=s=>root.querySelector(s), $$=(s,c=root)=>[...c.querySelectorAll(s)];",
 "const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('\"','&quot;');",
 "const fmt=x=>String(x);const SF=()=>'*';const muiT=k=>k;",
 'const draft={basics:{directIpVersion:"dual",ipv4Domains:[],outboundUploadStatistics:false,outboundDownloadStatistics:false},outbounds:'+JSON.stringify(items)+'};',
 'const app={state:{state:{outbounds:'+JSON.stringify(items)+',outboundSubscriptions:'+JSON.stringify(subs)+'}}};',
 'const outboundTableMarkup=new WeakMap(),delayResults=new Map(),activeGroupResults=new Map();',
 'let balancerSubscriptions=[],activeGroupRequest=null,currentTab="outbounds";',
 'const vpnGateStatusHTML=()=>"",testOutbound=()=>{};',
 chunk('  function outboundAddress(', '  function paintCurrentGroupNode('),
 chunk('  function outboundSupportsDelay(', '  function moveOutbound(id,delta){'),
 "const toggle=$('#mihomo-hide-filtered-outbounds');",
 "try{toggle.checked=localStorage.getItem('mui-hide-filtered-outbounds')==='1'}catch{}",
 "toggle.onchange=()=>{try{localStorage.setItem('mui-hide-filtered-outbounds',toggle.checked?'1':'0')}catch{}renderOutbounds()};",
 "window.__state={renderOutbounds,app,draft};renderOutbounds();"
].join('\n');
const control=html.match(/<label class="mihomo-outbound-filter-toggle"[\s\S]*?<\/label><small class="mihomo-muted mihomo-outbound-filter-count"[^>]*>Скрыто: 0<\/small>/);
assert(control,'checkbox and counter missing from main HTML');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  for(const width of [390,1280]){
   const page=await browser.newPage({viewport:{width,height:880}});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const fixture='<!doctype html><html lang="ru"><head><style>:root{--ctl:38px;--radius-sm:7px;--radius-lg:10px;--line:#48515c;--line-strong:#697482;--text:#e8eff9;--surface:#1b2633;--muted:#89929b;--teal:#009B77;--ease:ease}body{background:#101923;color:#e8eff9}</style><style>'+styles+'</style></head><body><section id="mihomo-settings-root"><div class="mihomo-toolbar">'+control[0]+'</div><div id="mihomo-outbound-table"></div><div id="mihomo-balancer-table"></div><div id="mihomo-subscription-balancer-table"></div></section></body></html>';
   await page.route('https://panel.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:fixture}));
   await page.goto('https://panel.test/',{waitUntil:'domcontentloaded'});
   await page.addScriptTag({content:script});
   const box=page.locator('#mihomo-outbound-table'),toggle=page.locator('#mihomo-hide-filtered-outbounds');
   const rows=()=>box.locator('tbody tr');
   const names=async()=>rows().locator('td.mihomo-name').allTextContents();
   assert.equal(await toggle.isChecked(),false);
   assert.equal((await names()).length,8,'five proxies and three builtins');
   await toggle.check();
   const hidden=await names();
   assert.equal(hidden.length,6,'two matching filtered outbounds hidden; missing third filtered name was never in list');
   assert(!hidden.some(n=>n.includes('★ LTE Россия')&&n.startsWith('RU |')));
   assert(!hidden.some(n=>n.includes('★ LTE Москва')));
   assert(hidden.includes('INT | 🇷🇺 ★ LTE Казань'),'unfiltered Russia must remain');
   assert(hidden.includes('INT | 🇷🇺 ★ LTE Россия'),'same label but different protocol must remain');
   assert(hidden.includes('INT | 🇩🇪 ★ LTE Germany'));
   assert.equal(await page.locator('#mihomo-hidden-filtered-count').innerText(),'Скрыто: 2');
   assert.equal((await page.evaluate(()=>localStorage.getItem('mui-hide-filtered-outbounds'))),'1');
   assert.equal(await page.evaluate(()=>window.__state.draft.outbounds.length),6,'all nodes/groups remain in memory');
   // Simulate the app-wide /api/state polling without losing selection or repainting.
   const tr=await rows().first().evaluate(el=>{el.dataset.reuseSentinel='yes';return el.dataset.reuseSentinel});
   await page.evaluate(()=>window.__state.renderOutbounds());
   assert.equal(await rows().first().getAttribute('data-reuse-sentinel'),tr);
   await toggle.uncheck();
   assert.equal((await names()).length,8,'previously hidden outbounds must reappear immediately');
   assert.equal(await page.locator('#mihomo-hidden-filtered-count').isHidden(),true);
   assert.equal(await page.evaluate(()=>localStorage.getItem('mui-hide-filtered-outbounds')),'0');
   assert.deepEqual(errors,[]);
   await page.close();
   console.log('PASS filtered-only checkbox, independent proxies and live repaint width',width);
  }
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1});
