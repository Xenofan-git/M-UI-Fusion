'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('web/mihomo-settings.js','utf8');
const html=fs.readFileSync('web/index.html','utf8');
assert.ok(html.includes('static/mihomo-settings.js?v=133'));
assert.ok(source.includes('lastSyncedOutbounds=clone(draft.outbounds)'));
assert.ok(source.includes('lastSyncedBasics=clone(draft.basics)'));
const applyStart=source.indexOf('  async function saveOutboundDraft(event){');
const applyEnd=source.indexOf('\n  function rulePayloadHint(',applyStart);
assert(applyStart>0&&applyEnd>applyStart);
const applyCode=source.slice(applyStart,applyEnd);
assert(applyCode.includes('await window.MUIBalancerServers?.saveSourceSettings?.()'),
  'balancer Apply must save pending subscription filters before closing');
assert(applyCode.indexOf('saveSourceSettings')<applyCode.indexOf('window.MUIBalancerServers?.teardown()'),
  'save pending filters before tearing down the source editor');
assert(source.includes("window.addEventListener('beforeunload'"),
  'warn on F5 if Mihomo or subscription filter draft has not been saved');
const start=source.indexOf('  async function saveSettings(){');
const end=source.indexOf('\n  ensureModals();',start);
assert.ok(start>0&&end>start);
const fn=source.slice(start,end);
const copy=x=>JSON.parse(JSON.stringify(x));
const oldNode={id:'old-node',name:'Latvia',server:'old.example',sourceSubscriptionId:'sub-1'};
const freshNode={id:'fresh-node',name:'Estonia',server:'new.example',sourceSubscriptionId:'sub-1'};
const rules=[
  {id:'first',type:'AND',payload:'((DOMAIN,example.com))',target:'DIRECT'},
  {id:'geoip',type:'GEOIP',payload:'RU',target:'Russia'},
  {id:'match',type:'MATCH',target:'FOREIGN'}
];
async function scenario({changeRules=false,changeOutbounds=false,deleteForeign=false,changeBasics=false,reorder=false,reject=false,renameSubscribedGroup=false}){
 const foreign={id:'group-foreign',name:'FOREIGN',kind:'group',type:'url-test',proxies:[]};
 const draft={outbounds:[copy(oldNode),copy(foreign)],routingRules:copy(rules),basics:{mode:'rule',ipv6:true}};
 const lastSyncedOutbounds=copy(draft.outbounds),lastSyncedBasics=copy(draft.basics),lastSyncedRules=copy(draft.routingRules);
 // Background refresh replaces the node but does NOT change the open draft.
 const state={outbounds:[copy(freshNode),copy(foreign)],routingRules:copy(rules),mihomoBasics:{mode:'rule',ipv6:true},settings:{mode:'rule',logLevel:'info'}};
 if(changeRules)draft.routingRules.splice(1,1);
 if(changeOutbounds)draft.outbounds.push({id:'manual',name:'MyManual',kind:'proxy'});
 if(deleteForeign)draft.outbounds=draft.outbounds.filter(item=>item.id!=='group-foreign');
 if(reorder){
   const second={id:'group-second',name:'SECOND',kind:'group',type:'url-test',proxies:[]};
   draft.outbounds.push(copy(second));
   lastSyncedOutbounds.push(copy(second));
   state.outbounds.push(copy(second));
   draft.outbounds.unshift(draft.outbounds.pop());
 }
 if(changeBasics)draft.basics.ipv6=false;
 if(renameSubscribedGroup){
   // Browser editor is open while the managed source has refreshed; user
   // renames ONLY the subscribed balancer, never its managed proxies.
   draft.outbounds[1].name='Renamed-Subscribed-Balancer';
   draft.outbounds[1].subscriptionIds=['sub-1'];
   draft.outbounds[1].proxies=['Latvia'];
   // Simulate an incidental subscription-node field from an older draft.
   draft.outbounds[0].name='Outdated subscription proxy label';
   draft.routingRules[2].target='Renamed-Subscribed-Balancer';
 }
 const requests=[],messages=[],classes=[],dialogEvents=[];
 const button={disabled:false};
 const scope={
   draft,lastSyncedOutbounds,lastSyncedBasics,lastSyncedRules,dirty:true,mihomoActionBusy:false,
   openMihomoStatusDialog:(kind)=>({set:(phase,message)=>dialogEvents.push({kind,phase,message})}),
   app:{state:{state}},root:{classList:{remove:v=>classes.push(v)}},
   clone:copy,
   $$:()=>[],
   $:()=>button,
   commitBasicsTags:()=>{},
   api:async(url,opts)=>{requests.push({url,body:JSON.parse(opts.body),method:opts.method});if(reject)throw Error('bad target');return {message:'Saved'};},
   toast:(v,err)=>messages.push({v,err}),
   refresh:async()=>{},
   muiT:()=>'',syncButtons:()=>{}
 };
 vm.createContext(scope);
 vm.runInContext(fn+'\nthis.runSave=saveSettings',scope);
 await scope.runSave();
 const calls=JSON.parse(JSON.stringify(requests));
 return {calls,scope,oldNode,freshNode,state,messages,button,dialogEvents};
}
(async()=>{
 const only=await scenario({changeRules:true});
 assert.equal(only.calls.length,1);
 assert.equal(only.calls[0].url,'/api/mihomo/rules');
 assert.equal(only.calls[0].method,'PUT');
 assert.deepEqual(Object.keys(only.calls[0].body),['routingRules'],'never transmit stale subscription node');
 assert.equal(only.calls[0].body.routingRules.length,2,'removed rule not reinserted');
 assert.equal(only.state.outbounds[0].id,'fresh-node','refresh must survive rule-only save');
 assert.equal(only.state.routingRules.length,2);
 assert.equal(only.scope.dirty,false);
 const edited=await scenario({changeOutbounds:true});
 assert.equal(edited.calls[0].url,'/api/mihomo/editor','outbound changes must use delta, not stale full save');
 assert.deepEqual(edited.calls[0].body.upserts.map(x=>x.id),['manual']);
 assert.deepEqual(edited.calls[0].body.deleteIds,[]);
 assert.ok(!JSON.stringify(edited.calls[0].body).includes('old-node'),'old subscription nodes must not be uploaded');
 assert.equal(edited.state.outbounds[0].id,'fresh-node');
 const deleted=await scenario({deleteForeign:true});
 assert.equal(deleted.calls[0].url,'/api/mihomo/editor','unrelated FOREIGN removal must use delta API');
 assert.deepEqual(deleted.calls[0].body.deleteIds,['group-foreign']);
 assert.deepEqual(deleted.calls[0].body.upserts,[]);
 assert.ok(!JSON.stringify(deleted.calls[0].body).includes('old-node'));
 assert.equal(deleted.state.outbounds[0].id,'fresh-node');
 const basics=await scenario({changeBasics:true});
 assert.equal(basics.calls[0].url,'/api/mihomo/editor','Basics changes must not carry stale subscription nodes');
 assert.equal(basics.calls[0].body.basics.ipv6,false);
 assert.deepEqual(basics.calls[0].body.upserts,[]);
 const reordered=await scenario({reorder:true});
 assert.deepEqual(reordered.calls[0].body.order,['group-second','group-foreign']);
 const combined=await scenario({changeRules:true,deleteForeign:true});
 assert.equal(combined.calls[0].body.routingRules.length,2);
 assert.deepEqual(combined.calls[0].body.deleteIds,['group-foreign']);
 const renamed=await scenario({renameSubscribedGroup:true});
 assert.equal(renamed.calls.length,1);
 assert.equal(renamed.calls[0].url,'/api/mihomo/editor');
 assert.deepEqual(renamed.calls[0].body.upserts.map(item=>item.id),['group-foreign'],
   'renaming a subscribed balancer must not upload its managed proxy nodes');
 assert.deepEqual(renamed.calls[0].body.deleteIds,[]);
 assert.equal(renamed.calls[0].body.upserts[0].name,'Renamed-Subscribed-Balancer');
 assert.equal(renamed.calls[0].body.routingRules[2].target,'Renamed-Subscribed-Balancer');
 assert(!JSON.stringify(renamed.calls[0].body).includes('Outdated subscription proxy label'),
   'incidental old source proxy must not be sent to the editor API');
 const rejected=await scenario({changeRules:true,reject:true});
 assert.equal(rejected.scope.dirty,true,'rejected rules must stay editable');
 assert.equal(rejected.state.routingRules.length,3,'server rejection must not fake a save');
 assert.equal(rejected.dialogEvents[0].phase,'error');
 assert.equal(rejected.messages.length,0,'errors should use centered dialog, not toast');
 console.log('PASS: rules-only and manual FOREIGN deletion, add, reorder, Basics and combined edits never transmit stale subscription nodes; errors preserve draft');
})().catch(e=>{console.error(e);process.exitCode=1});
