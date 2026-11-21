'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const source=fs.readFileSync('web/mihomo-settings.js','utf8');
const index=fs.readFileSync('web/index.html','utf8');
const locales=fs.readFileSync('web/i18n-locales.js','utf8');
const i18n=fs.readFileSync('web/i18n.js','utf8');
const values=source.match(/const ruleTypes=\[([^\]]+)\]/);
assert.ok(values,'ruleTypes list not found');
const types=[...values[1].matchAll(/'([^']+)'/g)].map(x=>x[1]);
const a=source.indexOf('  const russianRuleTypes={');
const b=source.indexOf('  function ruleReadablePayload(',a);
assert.ok(a>0&&b>a,'rule labels mapping and helpers missing');
let lang='ru';
const ctx={window:{muiGetLang:()=>lang,MUIRuleLists:{decode:()=>null}},$ :()=>null};
vm.createContext(ctx);
vm.runInContext(source.slice(a,b),ctx);
// above rewrite also modifies first declaration; exercise display function explicitly.
const label=type=>vm.runInContext('ruleTypeDisplayLabel('+JSON.stringify(type)+',true)',ctx);
for(const type of types){
  const text=label(type);
  assert.ok(text&&typeof text==='string',type);
  if(type==='MATCH'){assert.equal(text,'ВЕСЬ ОСТАЛЬНОЙ ТРАФИК');continue;}
  assert.match(text,new RegExp('^'+type+' — .{7,}$'),'missing Russian explanation of '+type);
}
assert.equal(label('LIST'),'GEO SITE КАТЕГОРИИ + ДОМЕНЫ И IP');
lang='en';
for(const type of types)assert.equal(label(type),type,'non-Russian technical type must remain unchanged');
assert.match(label('LIST'),/^LISTS /);
assert.ok(source.includes("item.type==='MATCH'||item.type==='GEOSITE'"));
assert.ok(source.includes("for(const option of select.options)option.textContent=ruleTypeDisplayLabel(option.value,true)"));
assert.ok(source.includes("typeSelect.disabled=item.type==='MATCH'"),'MATCH guard must stay');
assert.ok(source.includes("return ruleTypeDisplayLabel(window.MUIRuleLists?.decode(rule)?'LIST':rule.type)"));
assert.ok(index.includes('mihomo-settings.js?v=118')&&index.includes('i18n-locales.js?v=116')&&index.includes('i18n.js?v=116'));
assert.ok(locales.includes('«ВЕСЬ ОСТАЛЬНОЙ ТРАФИК» всегда находится последним'));
assert.ok(i18n.includes("'mh.ruleNoConditions':'Условий нет: весь оставшийся трафик"));
console.log('PASS: '+types.length+' Mihomo types localized in Russian, original codes in other languages, protected MATCH and stable cache versions');
