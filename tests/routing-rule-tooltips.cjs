'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const js=fs.readFileSync('web/mihomo-settings.js','utf8');
const css=fs.readFileSync('web/mihomo-settings.css','utf8');
const i18n=fs.readFileSync('web/i18n.js','utf8');
const html=fs.readFileSync('web/index.html','utf8');
const raw=js.match(/const ruleTypes=\[([^\]]+)\]/);
assert.ok(raw,'Mihomo rule types missing');
const types=[...raw[1].matchAll(/'([^']+)'/g)].map(x=>x[1]);
const start=js.indexOf('  const ruleHelpDescriptions={');
const end=js.indexOf('  function ruleHelpButton(',start);
assert.ok(start>0&&end>start);
const ctx={};vm.createContext(ctx);
vm.runInContext(js.slice(start,end).replace('const ruleHelpDescriptions=', 'this.descriptions='),ctx);
for(const type of ['LIST',...types]){
 const help=ctx.descriptions[type];
 assert.ok(help,'missing tooltip for rule type '+type);
 assert.equal(help.length,2,'bilingual rule help required: '+type);
 for(const text of help)assert.ok(text.length>=10,'tooltip explanation too short: '+type);
}
assert.match(js,/function ruleHelpButton\(/);
assert.match(js,/data-mihomo-help/);
assert.match(js,/ruleHelpButton\('type',rule\.type\)/);
assert.match(js,/ruleHelpButton\('no-resolve'\)/);
assert.match(js,/window\.MUIRuleLists\?\.decode\(rule\)\?'LIST':rule\.type/);
assert.match(js,/ruleHelpPopup\.textContent=ruleHelpText\(button\)/,'safe plain-text popup');
assert.match(js,/ruleHelpPopup\.style\.left/,'viewport-aware popup positioning');
assert.match(js,/document\.addEventListener\('pointerover'/);
assert.match(js,/document\.addEventListener\('focusin'/);
assert.match(js,/document\.addEventListener\('keydown'/);
assert.match(js,/ruleHelpAnchor.*hideRuleHelp/);
assert.ok(js.includes('GEO SITE КАТЕГОРИИ + ДОМЕНЫ И IP'));
assert.match(js,/return russianRuleTypes.LIST/);
assert.match(js,/No-Resolve/);
assert.doesNotMatch(js,/<span class="mihomo-pill group">no-resolve<\/span>/);
for(const marker of ['.mihomo-rule-help-trigger{','.mihomo-rule-help-popup{','.mihomo-rule-help-popup[hidden]','.mihomo-rule-type-with-help']){
 assert.ok(css.includes(marker),'missing CSS '+marker);
}
assert.match(i18n,/No-Resolve — не выполнять DNS-разрешение/);
assert.match(i18n,/No-Resolve запрещает/);
assert.match(i18n,/No-Resolve stops/);
assert.ok(html.includes('mihomo-settings.js?v=125')&&html.includes('mihomo-settings.css?v=127'));
console.log('PASS: '+types.length+' Mihomo rule type help texts, No-Resolve popovers, uppercase LIST, safe UI and cache version');
