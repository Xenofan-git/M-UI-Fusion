'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const { chromium } = require('playwright-core');
const source = fs.readFileSync('web/mihomo-settings.js', 'utf8');
const style = fs.readFileSync('web/mihomo-settings.css', 'utf8');
const start = source.indexOf('ruleModal.innerHTML=');
const end = source.indexOf(';\n    document.body.appendChild(ruleModal);', start);
if(start<0 || end<start) throw Error('rule modal markup not found');
const markup = vm.runInNewContext(source.slice(start+'ruleModal.innerHTML='.length,end), {
 SF:()=>'',ruleTypes:['DOMAIN','GEOIP','IP-CIDR','MATCH','AND','GEOSITE'],ruleHelpButton:(kind,type)=>'<button type="button" data-mihomo-rule-type="'+(type||'LIST')+'" class="mihomo-rule-help-trigger">!</button>'
});
const jsStart=source.indexOf('  function openRuleModal(');
const jsEnd=source.indexOf('  async function saveRuleDraft(',jsStart);
if(jsStart<0||jsEnd<jsStart)throw Error('real rule editor functions not found');
const runtimeCode=[
 "const $=selector=>document.querySelector(selector);",
 "const draft={routingRules:[{id:'ru',type:'GEOIP',payload:'RU',target:'Russia',noResolve:true},{id:'match',type:'MATCH',payload:'',target:'FOREIGN',noResolve:false}]};",
 "const ensureModals=()=>{};",
 "const targetOptions=selected=>['DIRECT','Russia','FOREIGN'].map(x=>'<option value=\"'+x+'\" '+(x===selected?'selected':'')+'>'+x+'</option>').join('');",
 "const muiT=key=>key;",
 "const openModal=id=>{document.getElementById(id).classList.add('open')};",
 "const rulePayloadHint=type=>'Hint '+type;",
 "const loadGeoCategories=()=>Promise.resolve([]);",
 "window.MUIRuleLists={decode:()=>null,displayCategoryName:x=>x};",
 source.slice(jsStart,jsEnd),
 'window.openTestRule=openRuleModal;window.syncTestRule=syncRuleForm;'
].join('\n');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 let checks=0;
 try{
  for(const width of [1280,390]){
   const page=await browser.newPage({viewport:{width,height:850}});
   const fixture='<!doctype html><html><head><style>body{background:#111;color:#eee}.modal-backdrop{display:block}.mihomo-modal{max-width:95vw}.modal-content{max-height:80vh;overflow:auto}</style><style>'+style+'</style></head><body><div id="mihomo-rule-modal">'+markup+'</div></body></html>';
   await page.setContent(fixture);
   await page.addScriptTag({content:runtimeCode});
   const summary=page.locator('#mihomo-rule-advanced summary');
   const detail=page.locator('#mihomo-rule-advanced');
   const body=page.locator('.mihomo-rule-advanced-body');
   const form=page.locator('#mihomo-rule-form');
   const state=()=>detail.evaluate(e=>e.open);
   const visible=()=>body.evaluate(e=>getComputedStyle(e).display!=='none');
   await page.evaluate(()=>window.openTestRule('ru'));
   if(await state()||await visible())throw Error('GEOIP starts visually open');
   checks++;
   await summary.click();
   if(!(await state())||!(await visible()))throw Error('GEOIP did not open');
   const original=await form.evaluate(f=>({type:f.elements.type.value,payload:f.elements.payload.value,noResolve:f.elements.noResolve.checked,target:f.elements.target.value}));
   if(JSON.stringify(original)!==JSON.stringify({type:'GEOIP',payload:'RU',noResolve:true,target:'Russia'}))throw Error('existing rule changed '+JSON.stringify(original));
   checks++;
   await summary.click();
   if(await state()||await visible())throw Error('GEOIP cannot close');
   checks++;
   await summary.click();
   if(!(await state()))throw Error('GEOIP cannot reopen');
   await page.locator('input[name=noResolve]').uncheck();
   await summary.click();
   await summary.click();
   if(await form.evaluate(f=>f.elements.noResolve.checked))throw Error('noResolve did not retain unsaved checkbox state');
   if(await form.evaluate(f=>f.elements.payload.value)!=='RU')throw Error('RU expression changed');
   checks++;
   await page.locator('select[name=type]').selectOption('DOMAIN');
   await summary.click();
   await page.evaluate(()=>window.syncTestRule());
   if(await state())throw Error('syncRuleForm unexpectedly reopened section');
   checks++;
   await page.evaluate(()=>window.openTestRule(''));
   if(await state()||await visible())throw Error('new LIST not collapsed');
   await summary.click();
   if(!(await state())||!(await visible()))throw Error('new LIST cannot expand');
   await summary.click();
   if(await state()||await visible())throw Error('new LIST cannot collapse');
   checks++;
   await page.evaluate(()=>window.openTestRule('match'));
   if(await state()||await visible())throw Error('MATCH not collapsed');
   await summary.click();
   if(!(await state())||!(await visible()))throw Error('MATCH cannot open');
   await summary.click();
   if(await state()||await visible())throw Error('MATCH cannot close');
   checks++;
   await page.close();
  }
  console.log('PASS: '+checks+' Chromium accordion checks; real GEOIP/LIST/MATCH editor, RU, no-resolve, desktop/mobile');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
