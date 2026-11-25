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
  await page.locator('[data-outbound-edit="foreign-group"]').click();
  const modal=page.locator('#mihomo-outbound-modal');
  assert(await modal.isVisible());
  const check=(sel)=>modal.locator(sel);
  await page.waitForFunction(()=>document.querySelectorAll('.fbs-table-body tr[data-node]').length===3);
  assert(await check('.fbs-keep').isVisible());
  const verifyFilterFields=async()=>{
   const lum=s=>s.match(/\d+/g).slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
   const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
   const fields=await check('.fbs-filter-fields textarea').evaluateAll(es=>es.map(e=>{
    const s=getComputedStyle(e),r=e.getBoundingClientRect();return {height:e.offsetHeight,width:e.offsetWidth,x:r.x,y:r.y,font:s.fontSize,line:s.lineHeight,resize:s.resize,ink:s.webkitTextFillColor,bg:s.backgroundColor,border:s.borderTopColor,style:s.borderTopStyle,opacity:s.opacity};
   }));
   assert.equal(fields.length,2);
   for(const f of fields){
    assert(f.height>=168&&f.width>120&&f.font==='15px'&&f.line==='24px'&&f.resize==='vertical'&&f.style==='solid'&&f.opacity==='1',JSON.stringify(f));
    assert(ratio(f.ink,f.bg)>=4.5,JSON.stringify(f));
   }
   assert.notEqual(fields[0].border,fields[1].border);
   if(width>650)assert(Math.abs(fields[0].y-fields[1].y)<2);
   else assert(fields[1].y>=fields[0].y+fields[0].height);
   return Math.min(...fields.map(f=>ratio(f.ink,f.bg)));
  };
  let min=Infinity,count=0;
  for(const theme of ['shadcn','md3','liquid'])for(const dark of [false,true])for(const skin of ['','graphite','ivory','emerald','aurora']){
   await page.evaluate(({theme,dark,skin})=>{const r=document.documentElement;r.setAttribute('data-ui-theme',theme);r.setAttribute('data-theme',dark?'dark':'light');document.body.classList.toggle('dark',dark);if(skin)r.setAttribute('data-color-skin',skin);else r.removeAttribute('data-color-skin');for(const link of document.querySelectorAll('link[data-ui-only]'))link.disabled=link.dataset.uiOnly!==theme;},{theme,dark,skin});
   min=Math.min(min,await verifyFilterFields());count+=2;
  }
  await page.evaluate(()=>{const r=document.documentElement;r.setAttribute('data-ui-theme','shadcn');r.setAttribute('data-theme','light');document.body.classList.remove('dark');r.removeAttribute('data-color-skin');for(const link of document.querySelectorAll('link[data-ui-only]'))link.disabled=link.dataset.uiOnly!=='shadcn';});
  console.log('PASS filter field dimensions and contrast',width,count,'checks minimum',min.toFixed(2));

  assert.equal(await check('[data-sub-pane=update]').count(),0);
  assert.equal(await check('.fbs-refresh-source').count(),0);
  assert(await check('#mihomo-outbound-close').isVisible());
  await check('.fbs-drop').fill('');
  await check('.fbs-keep').fill('🇷🇺');
  const rows=await check('.fbs-table-body tr[data-node]').evaluateAll(rs=>rs.map(r=>({name:r.dataset.node,visible:!r.hidden,filtered:r.classList.contains('fbs-row-filtered'),excluded:r.classList.contains('fbs-row-excluded'),checked:r.querySelector('input').checked,decoration:getComputedStyle(r.querySelector('.fbs-node-name')).textDecorationLine})));
  assert.equal(rows.length,3);
  assert(rows.every(r=>r.visible));
  assert(rows.filter(r=>!r.name.includes('Russia')).every(r=>r.filtered&&r.decoration.includes('line-through')&&!r.checked));
  const ru=rows.find(r=>r.name.includes('Russia'));assert(!ru.filtered&&!ru.excluded&&ru.checked,JSON.stringify(rows));
  await check('#mihomo-outbound-close').click();assert(!(await modal.isVisible()));
  await page.locator('#mihomo-add-sub-balancer').click();
  assert(await modal.isVisible());
  assert.equal(await modal.getAttribute('data-creating-subscription'),'true');
  await verifyFilterFields();
  assert(await check('.fbs-table-wrap').isVisible());
  assert(await check('.fbs-keep').isVisible());
  assert.equal(await check('[data-sub-pane=update]').count(),0);
  const picker=check('select[name=subscriptionIds]');
  assert.equal(await picker.inputValue(),'','new group must require a manual source selection');
  assert.equal(await picker.locator('option:checked').textContent(),'Выберите подписку…');
  assert.equal(await check('.fbs-table-body tr[data-node]').count(),0);
  await picker.selectOption(source.id);
  await page.waitForFunction(()=>document.querySelectorAll('.fbs-table-body tr[data-node]').length===3);
  assert.equal(await picker.inputValue(),source.id);
  await check('input[name=name]').fill('RUSSIA-TEST');
  await check('.fbs-keep').fill('🇷🇺');
  await check('#outbound-apply').click();
  await page.waitForFunction(()=>!document.querySelector('#mihomo-outbound-modal').classList.contains('open'),null,{timeout:10000});
  const creation=writes.find(w=>w.url==='/api/mihomo/subscriptions/groups');
  assert(creation,JSON.stringify(writes));assert.equal(creation.body.group,'RUSSIA-TEST');assert.equal(creation.body.filterKeep,'🇷🇺');assert.equal(creation.body.sourceId,source.id);
  assert.equal(creation.body.settings.interval,300);
  const writeCount=writes.filter(w=>w.url==='/api/mihomo/subscriptions/groups').length;assert.equal(writeCount,1);
  await page.locator('#mihomo-add-sub-balancer').click();
  assert.equal(await picker.inputValue(),'','reopening must clear previous source');
  assert.equal(await check('.fbs-table-body tr[data-node]').count(),0);
  await check('#mihomo-outbound-close').click();
  const paint=await page.locator('#mihomo-save').evaluate(e=>{const s=getComputedStyle(e);return {color:s.webkitTextFillColor,bg:s.backgroundColor,opacity:s.opacity}});
  assert.equal(paint.color,'rgb(255, 255, 255)');assert.equal(paint.opacity,'1');
  console.log('PASS real editor',width,'close, visible Save, 3 stable rows with RU selected, one shared creation POST');
  await page.close();
 }
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
