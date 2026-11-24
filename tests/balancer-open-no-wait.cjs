'use strict';
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const js=fs.readFileSync('web/mihomo-settings.js','utf8');
const html=fs.readFileSync('web/index.html','utf8');
assert(html.includes('static/mihomo-settings.js?v=135'),'cache-bust the no-wait editor handler');
assert(js.includes('const cached=app.state?.state?.outboundSubscriptions'),
 'editor needs to reuse canonical state snapshot');
const begin=js.indexOf("  async function openOutboundModal(id='',requestedKind='proxy'){");
const end=js.indexOf('\n  function populateOutboundTypes(',begin);
assert(begin>0&&end>begin,'full handler not found');
const fn=js.slice(begin,end);
const group={id:'group1',kind:'group',name:'FOREIGN',type:'url-test',proxies:[],subscriptionIds:['s1']};
const source={id:'s1',name:'quatro-vpn',group:'FOREIGN',filterExclude:'Москва'};
async function run(cacheMode){
 const events=[];
 const delayedNetwork=()=>{events.push('network_fetch');return Promise.resolve([source])};
 const input={focus:()=>events.push('focus')};
 const box={elements:{name:input}};
 const ui={
  editingSubscriptionGroup:false,creatingSubscriptionGroup:false,balancerSubscriptions:[],editingOriginal:null,
  draft:{outbounds:[group],basics:{outboundTestUrl:'https://www.gstatic.com/generate_204'}},
  currentTab:'subscriptions',app:{state:cacheMode==='valid'?{state:{outboundSubscriptions:[source]}}:cacheMode==='empty'?{state:{outboundSubscriptions:[]}}:cacheMode==='wrong'?{state:{outboundSubscriptions:[{id:'other',name:'other',group:'OTHER'}]}}:{}},
  window:{MUIBalancerServers:{teardown:()=>events.push('teardown'),active:()=>true}},
  api:delayedNetwork,
  clone:value=>JSON.parse(JSON.stringify(value)),
  ensureModals:()=>events.push('ensureModals'),
  fillOutboundForm:()=>events.push('fillForm'),
  setOutboundMode:()=>events.push('setFormMode'),
  setYAML:()=>events.push('setYAML'),
  showImportError:()=>{},
  $:id=>id==='#mihomo-outbound-form'?box:{value:'',textContent:'',style:{},dataset:{}},
  openModal:()=>events.push('openModal'),
  requestAnimationFrame:()=>{},
  muiT:()=>'',newManualBalancerDefaults:()=>({}),
  defaultTestURL:'https://www.gstatic.com/generate_204',
  // Ensure failing/API-timed-out requests must not affect cached opening.
 };
 vm.createContext(ui);
 vm.runInContext(fn+';this.openEditor=openOutboundModal',ui);
 await ui.openEditor('group1');
 assert.deepEqual(ui.balancerSubscriptions,JSON.parse(JSON.stringify([source])),
  'existing stored source must be sufficient to populate the editor');
 assert(events.indexOf('fillForm')>=0&&events.indexOf('openModal')>events.indexOf('fillForm'));
 assert.equal(events.includes('network_fetch'),cacheMode!=='valid',
  'existing state must not block pencil click on a second HTTP request');
 return events;
}
(async()=>{
 const cached=await run('valid');
 const fallback=await run('missing');
 const empty=await run('empty');
 const wrong=await run('wrong');
 console.log('PASS: balancer pencil uses complete cached state, but refetches missing/empty/mismatched sources',JSON.stringify({cached,fallback,empty,wrong}));
})().catch(err=>{console.error(err);process.exitCode=1});
