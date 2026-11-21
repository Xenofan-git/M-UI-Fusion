'use strict';
// Exercise the actual Outbounds table DOM + click handler in Chromium,
// including unsaved *other* settings, saved and newly added node names.
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
const js=fs.readFileSync('web/mihomo-settings.js','utf8');
const css=fs.readFileSync('web/mihomo-settings.css','utf8');
const chunk=(start,end)=>{const a=js.indexOf(start),b=js.indexOf(end,a);assert.ok(a>=0&&b>a);return js.slice(a,b)};
const boot=[
 "const root=document.getElementById('mihomo-settings-root');",
 "const $=s=>root.querySelector(s),$$=(s,c=root)=>[...c.querySelectorAll(s)];",
 "const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('\"','&quot;');",
 "const muiT=k=>({'mh.testOutbound':'Проверить исходящий','mh.testing':'Проверяется','mh.testUnavailable':'Не поддерживается','mh.saveFirst':'Сначала сохраните изменения'})[k]||k;",
 "const SF=x=>'*';const fmt=x=>x;let currentTab='outbounds';const delayResults=new Map(),activeGroupResults=new Map();",
 "const draft={basics:{directIpVersion:'dual',ipv4Domains:[]},outbounds:[",
 " {id:'a',name:'saved-node',kind:'proxy',type:'vless',server:'one.test',port:443},",
 " {id:'b',name:'new-node',kind:'proxy',type:'vless',server:'two.test',port:443},",
 " {id:'c',name:'no-test',kind:'proxy',type:'reject',server:'reject.test',port:443}",
 "]};",
 "const app={state:{state:{outbounds:[{id:'a',name:'saved-node',kind:'proxy',type:'vless'}]}}};",
 "let dirty=true;let calls=[];let failing=false;",
 "const api=async(u,o)=>{calls.push({url:u,body:JSON.parse(o.body)});if(failing)throw Error('timeout');return {delay:31}};",
 "const outboundRows=()=>[{name:'DIRECT',kind:'builtin',type:'direct',address:'Direct'},",
 "{name:'REJECT',kind:'builtin',type:'reject',address:'Reject'},...draft.outbounds];",
 "const visibleGroupPeers=item=>draft.outbounds.filter(x=>x.kind===item.kind);",
 "const isSubscriptionGroup=()=>false;const groupTypeLabel=x=>x;const outboundAddress=item=>item.server||'—';",
 "const groupResultTitle=()=>'';const groupResultLabel=()=>'';const groupTestNote=()=>'';",
 "const vpnGateStatusHTML=()=>'';const paintActiveGroupResults=()=>{};const refreshActiveGroups=()=>{};",
 "const groupResultLabelFake=()=>'';",
 chunk('  function delayLabel(name){','  // Display only: hide a provider label'),
 chunk('  function outboundSupportsDelay(item){','  // Some existing subscription groups'),
 chunk('  function renderOutbounds(){','  function moveOutbound(id,delta){'),
 chunk('  async function testOutbound(button){','  function currentWarpOutbound(){'),
 "window.getCalls=()=>calls;window.setFail=v=>failing=v;window.delayResults=delayResults;",
 "window.currentState=()=>({dirty,rows:draft.outbounds.map(x=>x.name)})",
 "renderOutbounds();"
].join('\n');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();
  await page.setContent('<!doctype html><html><head><style>'+css+'</style></head><body><div id="mihomo-settings-root"><div id="mihomo-outbound-table"></div></div></body></html>');
  await page.addScriptTag({content:boot});
  const testButton=name=>page.locator('[data-test-outbound="'+name+'"]');
  assert.equal(await testButton('saved-node').isEnabled(),true,'saved node test must be clickable while dirty');
  assert.equal(await testButton('DIRECT').isEnabled(),true,'built-in DIRECT remains testable');
  assert.equal(await testButton('new-node').isDisabled(),true,'unsaved node not present in Mihomo');
  assert.match(await testButton('new-node').getAttribute('title'),/сохраните/);
  assert.equal(await testButton('no-test').isDisabled(),true);
  assert.equal(await testButton('REJECT').isDisabled(),true);
  assert.match(await testButton('REJECT').getAttribute('title'),/Не поддерживается/);
  await testButton('saved-node').click();
  await page.waitForFunction(()=>document.querySelector('.mihomo-delay-result')!==null
    &&document.querySelector('[data-test-outbound="saved-node"]')?.disabled===false);
  assert.deepEqual(await page.evaluate(()=>window.getCalls()),[{url:'/api/mihomo/outbound/delay',body:{name:'saved-node'}}]);
  assert.equal(await page.locator('[data-test-outbound="saved-node"]').count(),1);
  assert.match(await page.locator('tr').filter({has:page.locator('[data-test-outbound="saved-node"]')}).textContent(),/31 ms/);
  assert.equal((await page.evaluate(()=>window.currentState())).dirty,true,'probing cannot alter the draft');
  await page.evaluate(()=>window.setFail(true));
  await testButton('DIRECT').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.mihomo-delay-result')].some(x=>x.textContent==='timeout'));
  assert.equal(await testButton('DIRECT').isEnabled(),true,'timeout cannot permanently lock test');
  console.log('PASS browser: saved node clickable despite dirty draft, unsaved/reject disabled, actual POST, 31 ms result, retry after timeout');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
