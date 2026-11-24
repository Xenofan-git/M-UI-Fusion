'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright-core');
const js=fs.readFileSync('web/mihomo-settings.js','utf8');
const first=js.indexOf('  function subscriptionGroupNames(){');
const last=js.indexOf('  function visibleGroupPeers(',first);
assert(first>=0&&last>first);
const subset=js.slice(first,last);
const source={id:'sub-foreign',name:'quatro-vpn',group:'FOREIGN'};
const nodes=[
 {id:'a',kind:'group',name:'FOREIGN',type:'url-test',subscriptionIds:['sub-foreign'],
  proxies:['quatro-vpn | 🇩🇪 LTE Germany']},
 {id:'b',kind:'group',name:'Russia',type:'url-test',proxies:['RU | 🇷🇺 LTE Москва','RU | 🇷🇺 LTE Казань']},
 {id:'c',kind:'group',name:'RUSSIA',type:'url-test',
  proxies:['quatro-vpn | 🇷🇺 LTE Москва','quatro-vpn | 🇷🇺 LTE Казань']},
 {id:'d',kind:'group',name:'RUSSIA2',type:'url-test',subscriptionManaged:true,
  proxies:['quatro-vpn | 🇷🇺 LTE Москва']},
 {id:'e',kind:'group',name:'Mixed',type:'select',proxies:['quatro-vpn | 🇷🇺 LTE Москва','RU | 🇷🇺 LTE Казань']}
];
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();
  await page.goto('about:blank');
  const actual=await page.evaluate(({subset,source,nodes})=>{
    const evaluate=new Function('app','balancerSubscriptions',subset+
      '\nreturn {isSubscriptionGroup,subscriptionGroupNames};');
    const functions=evaluate({state:{state:{outboundSubscriptions:[source]}}},[]);
    return nodes.map(node=>({name:node.name,subscribed:functions.isSubscriptionGroup(node)}));
  },{subset,source,nodes});
  assert.deepEqual(actual,[
   {name:'FOREIGN',subscribed:true},
   {name:'Russia',subscribed:false},
   {name:'RUSSIA',subscribed:true},
   {name:'RUSSIA2',subscribed:true},
   {name:'Mixed',subscribed:false}
  ]);
  console.log('PASS orphan RUSSIA restored to subscribed tab; manual Russia and mixed group remain manual');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
