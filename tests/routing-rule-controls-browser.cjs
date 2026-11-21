'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const src=fs.readFileSync('web/mihomo-settings.js','utf8');
const css=fs.readFileSync('web/mihomo-settings.css','utf8');
const start=src.indexOf('  function ruleIsEnabled(rule)');
const end=src.indexOf('  function targetOptions(',start);
assert.ok(start>0&&end>start,'routing control logic not found');
const chunk=src.slice(start,end);
const boot=[
 "const root=document.querySelector('#mihomo-settings-root');",
 "const $=selector=>document.querySelector(selector);",
 "const $$=(selector,context=document)=>Array.from(context.querySelectorAll(selector));",
 "const SF=icon=>String.fromCharCode();",
 "const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('\"','&quot;');",
 "const muiT=(key)=>({'mh.ruleEnabled':'Включить/выключить','mh.managedRuleSwitch':'Основные','mh.matchAlwaysOn':'Всегда включено','mh.dragPriority':'Перетащить для приоритета','mh.colRuleType':'ТИП','mh.colPayload':'УСЛОВИЯ','mh.colOutbound':'ИСХОДЯЩИЙ','mh.colOptions':'ОПЦИИ','mh.colActions':'ДЕЙСТВИЯ'})[key]||key;",
 "const windowMUI=window.MUIRuleLists={decode:()=>null};",
 "const ruleTypeDisplayLabel=type=>type==='MATCH'?'ВЕСЬ ОСТАЛЬНОЙ ТРАФИК':type;",
 "const ruleReadableType=rule=>ruleTypeDisplayLabel(rule.type);",
 "const ruleReadablePayload=rule=>rule.payload||'Все оставшиеся';",
 "const ruleHelpButton=()=>'';",
 "const basicsRuleRows=()=>[];",
 "const draft={routingRules:[",
 "  {id:'bank',type:'DOMAIN-SUFFIX',payload:'bank.ru',target:'DIRECT'},",
 "  {id:'geo',type:'GEOIP',payload:'RU',target:'Russia',noResolve:true},",
 "  {id:'social',type:'DOMAIN-SUFFIX',payload:'social.ru',target:'Russia'},",
 "  {id:'fallback',type:'MATCH',payload:'',target:'FOREIGN'}",
 "]};",
 "let dirty=false;",
 "const hideRuleHelp=()=>{};",
 "const ensureFinalMatch=()=>{};",
 "const markDirty=()=>{dirty=true;renderRules();};",
 "const openRuleModal=()=>{};",
 "const toast=()=>{};",
 "const muiConfirm=async()=>false;",
 chunk,
 "window.readRuleState=()=>({rules:draft.routingRules.map(r=>({...r})),dirty});",
 "window.tryMove=moveRuleTo;window.tryToggle=toggleRule;window.tryArrow=moveRule;",
 "renderRules();"
].join('\n');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 let count=0;
 try{
   for(const width of [1280,390]){
     const page=await browser.newPage({viewport:{width,height:860}});
     await page.setContent('<!doctype html><html><head><style>:root{--line:#666;--line-strong:#888;--surface:#27293a;--surface-subtle:#333;--surface-hover:#556;--text:#fff;--text-strong:#fff;--muted:#bbb;--teal:#009B77;--skin-accent:#009B77;--table-hover:#445}body{background:#101422;color:#fff;margin:0}</style><style>'+css+'</style></head><body><div id="mihomo-settings-root"><section id="mihomo-rule-table"></section></div></body></html>');
     await page.addScriptTag({content:boot});
     const order=()=>page.evaluate(()=>window.readRuleState().rules.map(r=>r.id));
     const rules=()=>page.evaluate(()=>window.readRuleState().rules);
     const row=id=>page.locator('[data-rule-row="'+id+'"]');
     const toggle=id=>row(id).locator('[data-rule-toggle]');
     assert.deepEqual(await order(),['bank','geo','social','fallback']);
     assert.equal(await toggle('bank').isChecked(),true);
     assert.equal(await toggle('geo').isChecked(),true);
     assert.equal(await toggle('fallback').isChecked(),true);
     assert.equal(await toggle('fallback').isDisabled(),true);
     assert.equal(await row('fallback').locator('[data-rule-drag]').count(),0,'MATCH drag handle must not exist');
     assert.equal(await row('fallback').locator('[data-rule-delete]').count(),0,'MATCH delete button must not exist');
     assert.equal(await row('fallback').locator('[data-rule-up]').isDisabled(),true);
     assert.equal(await row('fallback').locator('[data-rule-down]').isDisabled(),true);
     count++;
     await toggle('geo').uncheck();
     assert.equal((await rules()).find(r=>r.id==='geo').enabled,false);
     assert.equal((await rules()).find(r=>r.id==='geo').payload,'RU');
     assert.equal((await rules()).find(r=>r.id==='geo').noResolve,true);
     assert.equal(await row('geo').evaluate(r=>r.classList.contains('mihomo-rule-off')),true);
     count++;
     await row('bank').locator('[data-rule-down]').click();
     assert.deepEqual(await order(),['geo','bank','social','fallback']);
     assert.equal((await rules()).find(r=>r.id==='geo').enabled,false,'priority moving must not enable disabled rule');
     count++;
     await row('social').locator('[data-rule-up]').click();
     assert.deepEqual(await order(),['geo','social','bank','fallback']);
     count++;
     // Drag reordering should work on desktop; the same handles are also
     // pointer-enabled for touch and pen, and up/down work for keyboard.
     if(width===1280){
       await row('bank').locator('[data-rule-drag]').dragTo(row('geo'),{targetPosition:{x:50,y:10}});
       assert.deepEqual(await order(),['bank','geo','social','fallback']);
       count++;
     }
     await page.evaluate(()=>window.tryMove('fallback','bank'));
     await page.evaluate(()=>window.tryMove('geo','fallback'));
     assert.equal((await order()).at(-1),'fallback','MATCH always last');
     assert.equal((await order()).at(-2),'geo','drop onto MATCH inserts just before it');
     count++;
     count++;
     await page.evaluate(()=>window.tryToggle('fallback',false));
     assert.equal((await rules()).find(r=>r.id==='fallback').enabled,undefined,'MATCH never disabled');
     count++;
     await toggle('geo').check();
     assert.equal((await rules()).find(r=>r.id==='geo').enabled,undefined,'on uses legacy enabled semantics');
     assert.equal((await page.evaluate(()=>window.readRuleState().dirty)),true);
     count++;
     await page.close();
   }
   console.log('PASS:',count,'Chromium rule switch, priority drag/arrows and MATCH fixed scenarios at desktop/mobile widths');
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1});
