'use strict';
// Real Mihomo rule editor functions with the actual HTML template and CSS.
// This catches data loss, hidden condition fields and target-dependent layout.
const fs=require('node:fs');
const vm=require('node:vm');
const {chromium}=require('playwright-core');
const src=fs.readFileSync('web/mihomo-settings.js','utf8');
const css=fs.readFileSync('web/mihomo-settings.css','utf8');
const start=src.indexOf('ruleModal.innerHTML=');
const stop=src.indexOf(';\n    document.body.appendChild(ruleModal);',start);
if(start<0||stop<start)throw Error('rule editor HTML not found');
const markup=vm.runInNewContext(src.slice(start+'ruleModal.innerHTML='.length,stop),{
  SF:()=>'',ruleTypes:['DOMAIN','GEOIP','IP-CIDR','AND','MATCH','GEOSITE','PROCESS-NAME'],
  ruleHelpButton:(kind,type)=>'<button type="button" data-mihomo-rule-type="'+(type||'LIST')+'" class="mihomo-rule-help-trigger">!</button>'
});
const labelsStart=src.indexOf('  const russianRuleTypes={');
const labelsEnd=src.indexOf('  function ruleReadablePayload(',labelsStart);
const labelFunctions=src.slice(labelsStart,labelsEnd);
const first=src.indexOf('  function openRuleModal(');
const last=src.indexOf('  async function saveRuleDraft(',first);
if(first<0||last<first)throw Error('rule editing functions not found');
const runtime=[
  "const $=selector=>document.querySelector(selector);",
  "const draft={routingRules:[",
  "  {id:'geo',type:'GEOIP',payload:'RU',target:'Russia',noResolve:true},",
  "  {id:'and-direct',type:'AND',payload:'((AND,((DOMAIN-SUFFIX,bank.ru),(NETWORK,tcp))))',target:'DIRECT',noResolve:false},",
  "  {id:'list-russia',type:'AND',payload:'OR_LIST_ENCODING',target:'Russia',noResolve:false,list:true},",
  "  {id:'match',type:'MATCH',payload:'',target:'FOREIGN',noResolve:false}",
  "]};",
  "const ensureModals=()=>{};",
  "const targetOptions=selected=>['DIRECT','Russia','FOREIGN'].map(x=>'<option value=\"'+x+'\" '+(x===selected?'selected':'')+'>'+x+'</option>').join('');",
  "const muiT=key=>key;",
  "const openModal=id=>{document.getElementById(id).classList.add('open')};",
  "const rulePayloadHint=type=>'Hint '+type;",
  "const loadGeoCategories=()=>Promise.resolve({geosite:['ru'],geoip:['cn']});",
  "window.testLang='ru';window.muiGetLang=()=>window.testLang;",
  "window.MUIRuleLists={decode:rule=>rule.list?{geos:'geosite:ru',domains:'vk.com',noResolve:true}:null,displayCategoryName:x=>x};",
  labelFunctions,
  src.slice(first,last),
  'window.editTest=openRuleModal;window.syncTest=syncRuleForm;window.refreshTypeLabels=refreshRuleTypeLabels;'
].join('\n');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  let checks=0;
  try{
    for(const width of [1280,390]){
      const page=await browser.newPage({viewport:{width,height:850}});
      const fixture='<!doctype html><html><head><style>body{background:#111;color:#eee}.modal-backdrop{display:block}.mihomo-modal{max-width:95vw}.modal-content{max-height:80vh;overflow:auto}:root{--line:#666;--surface-subtle:#292a37}</style><style>'+css+'</style></head><body><div id="mihomo-rule-modal">'+markup+'</div></body></html>';
      await page.setContent(fixture);
      await page.addScriptTag({content:runtime});
      const open=id=>page.evaluate(id=>window.editTest(id),id);
      const visible=sel=>page.locator(sel).isVisible();
      const read=()=>page.locator('#mihomo-rule-form').evaluate(f=>({
        type:f.elements.type.value,payload:f.elements.payload.value,
        target:f.elements.target.value,noResolve:f.elements.noResolve.checked,
        categories:f.elements.geoCategories.value,domainIPs:f.elements.domainIPs.value
      }));
      const detail=page.locator('#mihomo-rule-advanced');
      const summary=page.locator('#mihomo-rule-advanced summary');
      const type='#mihomo-rule-type-field select';
      const target='#mihomo-rule-target-field select';
      const value='#mihomo-rule-payload-field textarea';
      const lists='#mihomo-rule-lists textarea[name=geoCategories]';
      const matchNote='#mihomo-rule-no-conditions';
      const check='#mihomo-no-resolve-field input[name=noResolve]';
      // GEOIP -> Russia, values and No-Resolve are visible/available.
      await open('geo');
      let data=await read();
      if(JSON.stringify([data.type,data.payload,data.target,data.noResolve])!==JSON.stringify(['GEOIP','RU','Russia',true]))throw Error('GEOIP data changed '+JSON.stringify(data));
      if(!(await visible(type))||!(await visible(value))||!(await visible(target)))throw Error('GEOIP type/condition/target hidden');
      if(await visible(lists)||await visible(matchNote))throw Error('Incorrect GEOIP condition widget');
      if((await page.locator('#mihomo-rule-condition-label').textContent())!=='Страна IP назначения')throw Error('GEOIP condition not explained');
      if(!(await visible(check)))throw Error('GEOIP No-Resolve missing');
      const geoLabel=await page.locator(type+' option[value="GEOIP"]').textContent();
      if(geoLabel!=='GEOIP — Страна IP назначения')throw Error('Russian GEOIP type label wrong: '+geoLabel);
      const processLabel=await page.locator(type+' option[value="PROCESS-NAME"]').textContent();
      if(processLabel!=='PROCESS-NAME — Имя программы')throw Error('Russian PROCESS-NAME label wrong');
      if(await page.locator(type).inputValue()!=='GEOIP')throw Error('Localized label changed underlying rule code');
      checks++;
      await summary.click();
      if(await detail.evaluate(e=>e.open))throw Error('No-Resolve section cannot close');
      await summary.click();
      if(!(await detail.evaluate(e=>e.open))||!(await visible(value)))throw Error('No-Resolve section does not reopen');
      if(!(await page.locator(check).isChecked()))throw Error('GEOIP No-Resolve altered');
      checks++;
      // A raw AND -> DIRECT is the same form, with the complete expression.
      await open('and-direct');
      data=await read();
      if(data.type!=='AND'||data.target!=='DIRECT'||!data.payload.includes('DOMAIN-SUFFIX,bank.ru'))throw Error('AND DIRECT data changed');
      if(!(await visible(type))||!(await visible(value))||!(await visible(target)))throw Error('AND DIRECT condition missing');
      if(await visible('#mihomo-rule-advanced'))throw Error('AND should not show irrelevant No-Resolve options');
      if((await page.locator('#mihomo-rule-condition-label').textContent())!=='Логическое условие AND')throw Error('AND expression label missing');
      checks++;
      // Existing list-based rule -> Russia uses the same form, but two fields.
      await open('list-russia');
      data=await read();
      if(data.type!=='LIST'||data.target!=='Russia'||data.categories!=='geosite:ru'||data.domainIPs!=='vk.com')throw Error('List data changed '+JSON.stringify(data));
      if(!(await visible(lists))||!(await visible('#mihomo-rule-lists textarea[name=domainIPs]')))throw Error('List fields hidden');
      if(await visible(value)||await visible(matchNote))throw Error('List should not show unrelated widgets');
      if(!(await visible(type))||!(await visible(target)))throw Error('LIST missing common form fields');
      checks++;
      // MATCH -> FOREIGN keeps the same type/target and explicit no-conditions note.
      await open('match');
      data=await read();
      if(data.type!=='MATCH'||data.target!=='FOREIGN')throw Error('MATCH data changed');
      if(!(await visible(type))||!(await visible(target))||!(await visible(matchNote)))throw Error('MATCH missing unified fields');
      if(await visible(value)||await visible(lists)||await visible('#mihomo-rule-advanced'))throw Error('MATCH showing forbidden conditions');
      if(!(await page.locator(type).isDisabled()))throw Error('MATCH rule type must stay locked');
      if((await page.locator(type+' option[value="MATCH"]').textContent())!=='ВЕСЬ ОСТАЛЬНОЙ ТРАФИК')throw Error('MATCH did not get user-friendly Russian title');
      if(!(await page.locator('#mihomo-rule-no-conditions').isVisible()))throw Error('MATCH no-conditions notice hidden');
      await page.evaluate(()=>{window.testLang='en';window.refreshTypeLabels();});
      if((await page.locator(type+' option[value="MATCH"]').textContent())!=='MATCH')throw Error('English MATCH should keep original code');
      if((await page.locator(type+' option[value="GEOIP"]').textContent())!=='GEOIP')throw Error('English GEOIP should keep original code');
      if(await page.locator(type).inputValue()!=='MATCH')throw Error('Language toggle changed stored MATCH type');
      await page.evaluate(()=>{window.testLang='ru';window.refreshTypeLabels();});
      if((await page.locator(type+' option[value="MATCH"]').textContent())!=='ВЕСЬ ОСТАЛЬНОЙ ТРАФИК')throw Error('Russian label not restored');
      checks++;
      // New rules get a list editor; switching types changes only the
      // condition widget, never the target/field position.
      await open('');
      if(!(await visible(type))||!(await visible(lists))||!(await visible(target)))throw Error('New rule form incomplete');
      await page.locator(type).selectOption('GEOIP');
      await page.evaluate(()=>window.syncTest());
      if(!(await visible(value))||await visible(lists))throw Error('Switch to GEOIP did not change condition editor');
      if(!(await visible(target)))throw Error('Target disappeared when switching types');
      if(await page.locator('#mihomo-rule-conditions-title').textContent()!=='Условия')throw Error('Conditions header disappeared');
      checks++;
      await page.close();
    }
    console.log('PASS: '+checks+' Chromium unified rule editor scenarios, existing/direct/list/GEOIP/MATCH/new, desktop + mobile');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
