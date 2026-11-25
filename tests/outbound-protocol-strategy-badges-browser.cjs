'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const web=path.resolve(__dirname,'../web');
const source={id:'sub-test',name:'provider',group:'FOREIGN',filterExclude:'🇷🇺',enabled:true,intervalMinutes:1440,nodeCount:2,filteredNodes:[{name:'🇷🇺 LTE Russia',countryCode:'RU',protocol:'vless',key:'node-ru-01'}]};
const nodes=[{id:'de',name:'provider | 🇩🇪 LTE Germany',kind:'proxy',type:'vless',sourceSubscriptionId:source.id,sourceNodeKey:'node-de-01'},{id:'pl',name:'provider | 🇵🇱 LTE Poland',kind:'proxy',type:'vless',sourceSubscriptionId:source.id,sourceNodeKey:'node-pl-01'}];
const group={id:'foreign-group',kind:'group',name:'FOREIGN',type:'url-test',subscriptionIds:[source.id],proxies:nodes.map(n=>n.name),testUrl:'https://www.gstatic.com/generate_204',interval:300,timeout:8000,tolerance:100};
const state={running:true,state:{settings:{language:'ru',mode:'rule'},outboundSubscriptions:[source],outbounds:[...nodes,group],routingRules:[{id:'r1',type:'MATCH',target:'FOREIGN'}],inbounds:[]}};
const status={available:true,nodes:[...nodes.map(n=>({name:n.name,sourceId:source.id,protocol:n.type,member:true,alive:true})),{name:'provider | 🇷🇺 LTE Russia',countryCode:'RU',protocol:'vless',sourceId:source.id,member:false,filtered:true,key:'node-ru-01'}]};
(async()=>{
const browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const writes=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://panel.test/**',async route=>{
   const u=new URL(route.request().url()),method=route.request().method();
   if(u.pathname==='/')return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fs.readFileSync(path.join(web,'index.html'))});
   if(u.pathname.startsWith('/api/')){
    let data={};
    if(method==='POST'||method==='PUT'){writes.push({url:u.pathname,body:route.request().postDataJSON()});}
    if(u.pathname==='/api/state')data=state;
    else if(u.pathname==='/api/mihomo/subscriptions')data=[source];
    else if(u.pathname==='/api/mihomo/balancers/status')data=status;
    else if(u.pathname==='/api/mihomo/subscriptions/preview')data={nodes:[{name:'🇷🇺 LTE Russia',key:'node-ru-01',protocol:'vless',countryCode:'RU',included:false}]};
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,data})});
   }
   const f=path.join(web,u.pathname.replace(/^\/static\//,'').replace(/^\//,''));
   if(fs.existsSync(f)&&fs.statSync(f).isFile())return route.fulfill({status:200,body:fs.readFileSync(f),contentType:f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.svg')?'image/svg+xml':f.endsWith('.png')?'image/png':'application/octet-stream'});
   return route.fulfill({status:404});
  });
  await page.goto('https://panel.test/',{waitUntil:'load'});
  await page.waitForFunction(()=>window.MUIMihomoSettings&&window.MUIBalancerServers);
  await page.evaluate(s=>{app.state=s;setView('mihomo');MUIMihomoSettings.refreshOutbounds();MUIMihomoSettings.openTab('subscriptions')},state);
  const subBadge=page.locator('#mihomo-subscription-balancer-table td:nth-child(4) .protocol-pill');
  await subBadge.waitFor({state:"attached"});if(width>760)assert(await subBadge.isVisible());assert(await subBadge.evaluate(e=>e.classList.contains('transport')));
  await page.evaluate(()=>MUIMihomoSettings.openTab('outbounds'));
  const proxy=page.locator('#mihomo-outbound-table tr').filter({hasText:'LTE Germany'}).locator('td:nth-child(4) .protocol-pill');
  await proxy.waitFor({state:"attached"});if(width>760)assert(await proxy.isVisible());assert.equal(await proxy.textContent(),'vless');assert(!(await proxy.evaluate(e=>e.classList.contains('transport'))));
  for(const name of ['direct','reject','reject-drop']){
   const built=page.locator('#mihomo-outbound-table td:nth-child(4) .protocol-pill').filter({hasText:new RegExp('^'+name+'$')});
   await built.waitFor({state:"attached"});if(width>760)assert(await built.isVisible());assert(await built.evaluate(e=>e.classList.contains('transport')));
  }
  await page.evaluate(()=>{
   const cell=document.querySelector('#mihomo-outbound-table td:nth-child(4)');
   for(const cls of ['protocol-pill','protocol-pill transport']){
    const b=document.createElement('span');b.className=cls;b.dataset.reference=cls;b.textContent='reference';cell.append(b);
   }
  });
  const props=['color','borderTopColor','backgroundColor','borderTopWidth','borderTopStyle','borderRadius','fontWeight'];
  const compare=async(sel,ref)=>{
    const pair=await page.evaluate(({sel,ref,props})=>{
     const read=e=>props.map(k=>getComputedStyle(e)[k]);return [read(document.querySelector(sel)),read(document.querySelector('[data-reference="'+ref+'"]'))];
    },{sel,ref,props});assert.deepEqual(pair[0],pair[1]);assert.equal(pair[0][3],'1px');assert.equal(pair[0][4],'solid');
  };
  for(const theme of ['shadcn','md3','liquid'])for(const dark of [false,true])for(const skin of ['','graphite','ivory','emerald','aurora']){
   await page.evaluate(({theme,dark,skin})=>{const r=document.documentElement;r.setAttribute('data-ui-theme',theme);r.setAttribute('data-theme',dark?'dark':'light');document.body.classList.toggle('dark',dark);if(skin)r.setAttribute('data-color-skin',skin);else r.removeAttribute('data-color-skin');for(const link of document.querySelectorAll('link[data-ui-only]'))link.disabled=link.dataset.uiOnly!==theme;},{theme,dark,skin});
   await compare('#mihomo-outbound-table td:nth-child(4) .protocol-pill:not(.transport):not([data-reference])','protocol-pill');
   await compare('#mihomo-outbound-table td:nth-child(4) .protocol-pill.transport:not([data-reference])','protocol-pill transport');
   const colors=await page.evaluate(()=>Array.from(document.querySelectorAll('[data-reference]'),e=>getComputedStyle(e).borderTopColor));assert.notEqual(colors[0],colors[1]);
  }
  console.log('PASS actual outbound and subscription rows, matching inbound tags in 30 theme combinations at',width);
  await page.close();
 }
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
