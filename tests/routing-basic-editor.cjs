const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('web/mihomo-settings.js','utf8');
const css = fs.readFileSync('web/mihomo-settings.css','utf8');
const start = source.indexOf('ruleModal.innerHTML=');
const end = source.indexOf(';\n    document.body.appendChild(ruleModal);', start);
assert.ok(start>0 && end>start);
const html=vm.runInNewContext(source.slice(start+'ruleModal.innerHTML='.length,end),{
  ruleTypes:['DOMAIN','GEOSITE','GEOIP','SRC-GEOIP','IP-CIDR','DST-PORT','AND','MATCH'],
  SF:()=>'',ruleHelpButton:(kind,type)=>'<button type="button" data-mihomo-rule-type="'+(type||'LIST')+'" class="mihomo-rule-help-trigger">!</button>'
});
const pos = id => html.indexOf('id="'+id+'"');
// Every rule, regardless of outbound, uses one Type -> Conditions -> Outbound
// -> Optional flags form. No type or condition is hidden behind an accordion.
assert.ok(pos('mihomo-rule-type-field')>=0);
assert.ok(pos('mihomo-rule-conditions')>pos('mihomo-rule-type-field'));
assert.ok(pos('mihomo-rule-target-field')>pos('mihomo-rule-conditions'));
assert.ok(pos('mihomo-rule-advanced')>pos('mihomo-rule-target-field'));
assert.ok(pos('mihomo-rule-lists')>pos('mihomo-rule-conditions'));
assert.ok(pos('mihomo-rule-payload-field')>pos('mihomo-rule-lists'));
assert.ok(pos('mihomo-rule-no-conditions')>pos('mihomo-rule-payload-field'));
assert.ok(pos('mihomo-no-resolve-field')>pos('mihomo-rule-advanced'));
assert.equal((html.match(/name="type"/g)||[]).length,1);
assert.equal((html.match(/name="target"/g)||[]).length,1);
for(const name of ['id','geoCategories','domainIPs','payload','noResolve']){
  assert.ok(html.includes('name="'+name+'"'),name);
}
assert.ok(html.includes('<option value="LIST">GEO SITE КАТЕГОРИИ + ДОМЕНЫ И IP</option>'));
assert.ok(html.includes('<option value="GEOIP">GEOIP</option>'));
assert.ok(!html.includes('<option value="GEOSITE">'),'standalone GeoSite hidden for new rules');
assert.ok(source.includes("item.type==='MATCH'||item.type==='GEOSITE'"),'legacy GeoSite remains editable');
assert.ok(!html.includes('<option value="MATCH">'),'MATCH cannot be offered to new rules');
assert.ok(html.includes('<details class="mihomo-rule-advanced full" id="mihomo-rule-advanced">'));
assert.ok(source.includes("typeSelect.disabled=item.type==='MATCH'"));
assert.ok(source.includes("form.elements.type.value=decoded?'LIST':item.type"));
assert.ok(source.includes("$('#mihomo-rule-advanced').hidden=!noResolve"));
assert.ok(source.includes("$('#mihomo-rule-no-conditions').hidden=!isMatch"));
assert.ok(source.includes("$('#mihomo-rule-condition-label').textContent=ruleConditionLabel(type)"));
assert.ok(source.includes("window.MUIRuleLists.compile("));
assert.ok(source.includes("if(rule.type==='MATCH'){toast(muiT('mh.matchUndeletable'),true);return;}"));
assert.ok(css.includes('#mihomo-rule-modal .mihomo-unified-rule-editor'));
assert.ok(css.includes('#mihomo-rule-modal #mihomo-rule-payload-field[hidden]'));
assert.ok(css.includes('#mihomo-rule-modal #mihomo-rule-advanced[hidden]'));
const index=fs.readFileSync('web/index.html','utf8');
assert.ok(index.includes('static/mihomo-settings.js?v=118'));
assert.ok(index.includes('static/mihomo-settings.css?v=117'));
const i18n=fs.readFileSync('web/i18n.js','utf8');
assert.ok(i18n.includes("'mh.ruleConditionsTitle':'Условия'"));
assert.ok(i18n.includes("'mh.ruleNoConditions':'Условий нет: весь оставшийся трафик"));
console.log('PASS: one visible Type → Conditions → Outbound form, optional flags, list/MATCH/single-rule conditions');
