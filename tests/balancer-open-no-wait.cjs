'use strict';
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const js=fs.readFileSync('web/mihomo-settings.js','utf8');
const html=fs.readFileSync('web/index.html','utf8');
assert(html.includes('static/mihomo-settings.js?v=127'),'cache-bust the no-wait editor handler');
assert(js.includes('const cached=app.state?.state?.outboundSubscriptions'),
 'editor needs to reuse canonical state snapshot');
const begin=js.indexOf("  async function openOutboundModal(id='',requestedKind='proxy'){");
const end=js.indexOf('\n  function populateOutboundTypes(',begin);
assert(begin>0&&end>begin,'full handler not found');
const fn=js.slice(begin,end);
const group={id:'group1',kind:'group',name:'FOREIGN',type:'url-test',proxies:[],subscriptionIds:['s1']};
const source={id:'s1',name:'quatro-vpn',group:'FOREIGN',filterExclude:'Москва'};
async function run(cached){
 const events=[];
 const delayedNetwork=()=>{events.push('network_fetch');return Promise.resolve([source])};
 const input={focus:()=>events.push('focus')};
 const box={elements:{name:input}};
 const ui={
  editingSubscriptionGroup:false,balancerSubscriptions:[],editingOriginal:null,
  draft:{outbounds:[group],basics:{outboundTestUrl:'https://www.gstatic.com/generate_204'}},
  currentTab:'subscriptions',app:{state:cached?{state:{outboundSubscriptions:[source]}}:{}},
  window:{MUIBalancerServers:{teardown:()=>events.push('teardown'),active:()=>true}},
  api:delayedNetwork,
  clone:value=>JSON.parse(JSON.stringify(value)),
  ensureModals:()=>events.push('ensureModals'),
  fillOutboundForm:()=>events.push('fillForm'),
  setOutboundMode:()=>events.push('setFormMode'),
  setYAML:()=>events.push('setYAML'),
  showImportError:()=>{},
  $:id=>id==='#mihomo-outbound-form'?box:{value:'',textContent:''},
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
 assert.equal(events.includes('network_fetch'),!cached,
  'existing state must not block pencil click on a second HTTP request');
 return events;
}
(async()=>{
 const cached=await run(true);
 const fallback=await run(false);
 console.log('PASS: subscription balancer pencil opens using cached state without waiting for API; missing-state fallback still loads',JSON.stringify({cached,fallback}));
})().catch(err=>{console.error(err);process.exitCode=1});
