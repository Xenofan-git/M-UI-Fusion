'use strict';
const fs=require('node:fs'),vm=require('node:vm');
const {chromium}=require('playwright-core');
const js=fs.readFileSync('web/mihomo-settings.js','utf8');
const css=fs.readFileSync('web/mihomo-settings.css','utf8');
const begin=js.indexOf('  const russianRuleTypes={');
const finish=js.indexOf('  function moveRule(',begin);
if(begin<0||finish<begin)throw Error('routing helper functions moved');
const source=js.slice(begin,finish);
const markupBegin=js.indexOf('ruleModal.innerHTML=');
const markupEnd=js.indexOf(';\n    document.body.appendChild(ruleModal);',markupBegin);
const markup=vm.runInNewContext(js.slice(markupBegin+'ruleModal.innerHTML='.length,markupEnd),{
 ruleTypes:['DOMAIN','GEOIP','AND','MATCH'],
 SF:()=>'',ruleHelpButton:(kind,type)=>'<button type="button" class="mihomo-rule-help-trigger" data-mihomo-help="'+kind+'"'+(type?' data-mihomo-rule-type="'+type+'"':'')+'>!</button>'
});
const translations={
 'mh.colRuleType':'Тип правила','mh.colPayload':'Условия',
 'mh.colOutbound':'Исходящий','mh.colOptions':'Параметры','mh.colActions':'Действия',
 'mh.noResolveHelpTitle':'No-Resolve','mh.ruleTypeHelpTitle':'Тип правила',
 'mh.noResolveHelpText':'No-Resolve не запускает DNS только ради проверки IP-правила. Если IP известен, совпадение возможно. Общий DNS не отключается.',
 'mh.ruleHelpUnknown':'Условие правила','mh.matchAll':'Весь оставшийся трафик'
};
const runtime=[
"const root=document.getElementById('mihomo-root');",
"const $=sel=>root.querySelector(sel);",
"const $$=(sel,target=root)=>[...target.querySelectorAll(sel)];",
"const muiT=key=>window.testTranslations[key]||key;",
"const esc=value=>String(value??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));",
"const SF=()=>'';",
"const draft={routingRules:[{id:'geo',type:'GEOIP',payload:'RU',target:'Russia',noResolve:true},{id:'lists',type:'AND',payload:'',target:'Russia',noResolve:false,list:true},{id:'match',type:'MATCH',payload:'',target:'FOREIGN',noResolve:false}]};",
"const basicsRuleRows=()=>[{type:'IP-CIDR',payload:'192.168.0.0/16',target:'DIRECT'}];",
"const ensureFinalMatch=()=>{};",
"const openRuleModal=()=>{};const deleteRule=()=>{};const moveRule=()=>{};",
"window.MUIRuleLists={decode:rule=>rule.list?{geos:'ru',domains:''}:null,lines:value=>value?value.split('\\n'):[]};",
source,
"window.testHelpers={setupRuleHelp,hideRuleHelp,ruleHelpDescriptions};",
"renderRules();setupRuleHelp();"
].join('\n');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:820}});
   const doc='<html><head><style>:root{--line:#64627a;--surface:#202132;--surface-strong:#27283b;--surface-subtle:#33344a;--text-strong:#f5f5f6;--accent:#009b77}body{background:#1d1e2c;color:white}.mihomo-table-wrap{width:100%;max-width:380px;overflow:auto}</style><style>'+css+'</style></head><body><div id="mihomo-root"><div id="mihomo-rule-table"></div></div><div id="mihomo-rule-modal">'+markup+'</div></body></html>';
   await page.setContent(doc);
   await page.evaluate(value=>{window.testTranslations=value;window.muiGetLang=()=>'ru'},translations);
   await page.addScriptTag({content:runtime});
   const getText=()=>page.locator('#mihomo-rule-help-popup').textContent();
   const popup=page.locator('#mihomo-rule-help-popup');
   const types=page.locator('#mihomo-rule-table [data-mihomo-help=type]');
   if(await types.count()!==4)throw Error('missing type info buttons for builtins and rows');
   const geo=page.locator('#mihomo-rule-table [data-mihomo-rule-type=GEOIP]');
   const badgeBefore=await geo.evaluate(el=>({
     bg:getComputedStyle(el).backgroundColor,
     fg:getComputedStyle(el).color,
     fill:getComputedStyle(el).webkitTextFillColor
   }));
   if(badgeBefore.fg!=='rgb(135, 147, 165)'||badgeBefore.fill!==badgeBefore.fg)
     throw Error('resting (!) mark not subdued: '+JSON.stringify(badgeBefore));
   await geo.hover();
   const badgeOnHover=await geo.evaluate(el=>({
     bg:getComputedStyle(el).backgroundColor,
     fg:getComputedStyle(el).color
   }));
   if(badgeOnHover.bg!==badgeBefore.bg)throw Error('hover filled the help circle: '+JSON.stringify({badgeBefore,badgeOnHover}));
   if(badgeOnHover.fg!=='rgb(255, 255, 255)')throw Error('only the exclamation mark should become white: '+JSON.stringify(badgeOnHover));
   if(await popup.isHidden()||!(await getText()).includes('Страна IP'))throw Error('GEOIP hover tooltip missing');
   const rect=await popup.boundingBox();if(!rect||rect.x<0||rect.x+rect.width>width+2)throw Error('tooltip clipped or outside viewport');
   const list=page.locator('#mihomo-rule-table [data-mihomo-rule-type=LIST]');
   await list.hover();
   if(!(await getText()).includes('Списки GeoSite'))throw Error('List help incorrect');
   const ruleRow=page.locator('#mihomo-rule-table tbody tr').nth(2);
   if(!(await ruleRow.textContent()).includes('GEO SITE КАТЕГОРИИ + ДОМЕНЫ И IP'))throw Error('universal GeoSite list label not visible');
   const nr=page.locator('#mihomo-rule-table [data-mihomo-help=no-resolve]');
   const nrBefore=await nr.evaluate(el=>getComputedStyle(el).color);
   if(nrBefore!=='rgb(135, 147, 165)')throw Error('No-Resolve info badge is not muted: '+nrBefore);
   await nr.hover();
   if((await nr.evaluate(el=>getComputedStyle(el).color))!=='rgb(255, 255, 255)')
     throw Error('No-Resolve exclamation did not turn white');
   if(!(await getText()).includes('не запускает DNS'))throw Error('No-Resolve tooltip missing');
   if(!(await nr.locator('xpath=..').textContent()).includes('No-Resolve'))throw Error('Badge not capitalized');
   await nr.click();
   if(await popup.isHidden())throw Error('No-Resolve click pin failed');
   await page.mouse.click(width-10,800);
   if(!(await popup.isHidden()))throw Error('outside click does not dismiss tooltip');
   await page.evaluate(()=>document.activeElement?.blur?.());
   await geo.focus();
   if(await popup.isHidden())throw Error('keyboard focus missing tooltip');
   await page.keyboard.press('Escape');
   if(!(await popup.isHidden()))throw Error('Escape did not dismiss tooltip');
   const selected=page.locator('#mihomo-rule-modal select[name=type] option[value=LIST]');
   if((await selected.textContent())!=='GEO SITE КАТЕГОРИИ + ДОМЕНЫ И IP')throw Error('selector not uppercase');
   await page.locator('#mihomo-rule-advanced').evaluate(element=>{element.open=true});
   const formHelp=page.locator('#mihomo-no-resolve-field [data-mihomo-help=no-resolve]');
   const checkbox=page.locator('#mihomo-no-resolve-field input[name=noResolve]');
   await formHelp.click();
   if(await checkbox.isChecked())throw Error('tooltip click incorrectly checked No-Resolve');
   if(!(await getText()).includes('Общий DNS не отключается'))throw Error('form tooltip incorrect');
   console.log('PASS browser',width,'px: type tooltips, No-Resolve, uppercase LIST, tooltip hover/click/focus, intact checkbox');
   await page.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
