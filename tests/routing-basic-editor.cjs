const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('web/mihomo-settings.js','utf8');
const i18n = fs.readFileSync('web/i18n.js','utf8');
const locales = fs.readFileSync('web/i18n-locales.js','utf8');
const css = fs.readFileSync('web/mihomo-settings.css','utf8');
const start = source.indexOf('ruleModal.innerHTML=');
const end = source.indexOf(';\n    document.body.appendChild(ruleModal);', start);
assert.ok(start>0 && end>start);
const expression = source.slice(start+'ruleModal.innerHTML='.length,end);
const html = vm.runInNewContext(expression, {
  ruleTypes:['DOMAIN','GEOSITE','GEOIP','SRC-GEOIP','IP-CIDR','DST-PORT','AND','MATCH'],
  SF: () => '',
});
const pos = key => html.indexOf('id="'+key+'"');
assert.ok(pos('mihomo-rule-target-field')>=0);
assert.ok(pos('mihomo-rule-lists')>pos('mihomo-rule-target-field'));
assert.ok(pos('mihomo-rule-advanced')>pos('mihomo-rule-lists'));
assert.ok(pos('mihomo-rule-type-field')>pos('mihomo-rule-advanced'));
assert.ok(pos('mihomo-rule-payload-field')>pos('mihomo-rule-type-field'));
assert.ok(pos('mihomo-no-resolve-field')>pos('mihomo-rule-type-field'));
assert.ok(html.includes('<details class="mihomo-rule-advanced full" id="mihomo-rule-advanced"><summary'));
assert.ok(!html.includes('<details class="mihomo-rule-advanced full" id="mihomo-rule-advanced" open'));
assert.equal((html.match(/name="type"/g)||[]).length,1);
assert.ok(html.includes('<option value="LIST">'));
assert.ok(html.includes('<option value="GEOIP">GEOIP</option>'));
assert.ok(html.includes('<option value="AND">AND</option>'));
assert.ok(!html.includes('<option value="MATCH">'),'MATCH cannot be offered to new rules');
assert.ok(html.includes('name="target"'));
assert.ok(html.includes('name="geoCategories"'));
assert.ok(html.includes('name="domainIPs"'));
assert.ok(html.includes('name="payload"'));
assert.ok(html.includes('name="noResolve"'));
assert.ok(source.includes("typeSelect.disabled=item.type==='MATCH'"));
assert.ok(source.includes("if(item.type==='MATCH')"));
assert.ok(source.includes("form.elements.type.value=decoded?'LIST':item.type"));
assert.ok(source.includes("$('#mihomo-rule-advanced').open=!decoded&&item.type!=='LIST'"));
assert.ok(source.includes("if(!isList)$('#mihomo-rule-advanced').open=true"));
assert.ok(source.includes("window.MUIRuleLists.compile("));
assert.ok(source.includes("if(rule.type==='MATCH'){toast(muiT('mh.matchUndeletable'),true);return;}"));
assert.ok(source.includes("rule.type==='MATCH'?'disabled':''"));
assert.ok(css.includes('.mihomo-rule-advanced[open] summary'));
assert.ok(css.includes('.mihomo-rule-advanced-body{display:grid'));

function translated(lang,key){
  const context={window:{},localStorage:{getItem:()=>lang},
    document:{readyState:'loading',documentElement:{getAttribute:()=>lang},addEventListener:()=>{}}};
  vm.createContext(context);
  vm.runInContext(locales,context);
  vm.runInContext(i18n,context);
  return context.window.muiT(key);
}
assert.equal(translated('ru','mh.advancedSettings'),'Расширенные настройки');
assert.equal(translated('en','mh.advancedSettings'),'Advanced settings');
console.log('PASS: new rules use two-list editor; native types and legacy MATCH retained only in advanced section');
