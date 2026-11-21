'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('web/mihomo-settings.js','utf8');
const html=fs.readFileSync('web/index.html','utf8');
assert.ok(html.includes('static/mihomo-settings.js?v=115'));
assert.ok(source.includes('lastSyncedOutbounds=clone(draft.outbounds)'));
assert.ok(source.includes('lastSyncedBasics=clone(draft.basics)'));
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
async function scenario({changeRules=false,changeOutbounds=false,changeBasics=false,reject=false}){
 const draft={outbounds:[copy(oldNode)],routingRules:copy(rules),basics:{mode:'rule',ipv6:true}};
 const lastSyncedOutbounds=copy(draft.outbounds),lastSyncedBasics=copy(draft.basics);
 // Background refresh replaces the node but does NOT change the open draft.
 const state={outbounds:[copy(freshNode)],routingRules:copy(rules),mihomoBasics:{mode:'rule',ipv6:true},settings:{mode:'rule',logLevel:'info'}};
 if(changeRules)draft.routingRules.splice(1,1);
 if(changeOutbounds)draft.outbounds.push({id:'manual',name:'MyManual',kind:'proxy'});
 if(changeBasics)draft.basics.ipv6=false;
 const requests=[],messages=[],classes=[];
 const button={disabled:false};
 const scope={
   draft,lastSyncedOutbounds,lastSyncedBasics,dirty:true,
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
 return {calls,scope,oldNode,freshNode,state,messages,button};
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
 assert.equal(edited.calls[0].url,'/api/mihomo/settings','outbound changes still use protected full-save API');
 const basics=await scenario({changeBasics:true});
 assert.equal(basics.calls[0].url,'/api/mihomo/settings','Basics changes still use protected full-save API');
 const rejected=await scenario({changeRules:true,reject:true});
 assert.equal(rejected.scope.dirty,true,'rejected rules must stay editable');
 assert.equal(rejected.state.routingRules.length,3,'server rejection must not fake a save');
 assert.equal(rejected.messages[0].err,true);
 console.log('PASS: rule delete uses isolated rules-only request despite changed subscription nodes; full-save and error behavior preserved');
})().catch(e=>{console.error(e);process.exitCode=1});
