'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const html=fs.readFileSync('web/index.html','utf8');
const js=fs.readFileSync('web/mihomo-settings.js','utf8');
const css=fs.readFileSync('web/mihomo-settings.css','utf8');
const dict=fs.readFileSync('web/i18n.js','utf8');
assert(html.includes('static/mihomo-settings.js?v=138'));
assert(html.includes('static/mihomo-settings.css?v=136'));
assert(html.includes('static/i18n.js?v=123'));
const security=html.match(/<details class="inbound-form-section inbound-security" open>[\s\S]*?<\/details>/)?.[0];
assert(security,'inbound security form section must exist');
assert(!security.includes('<div class="field field-security"><label>Security</label>'),'redundant noninteractive security label must be gone');
assert(security.includes('<summary data-i18n="inbounds.securityTitle">Безопасность</summary>'));
assert(security.includes('<div class="field field-security"><div class="security-mode-control">'));
assert(security.includes('data-security="none" data-i18n="inbounds.securityNoneChoice"'));
assert(security.includes('id="security-none-explanation"'));
assert(security.includes('Не применять дополнительный протокол безопасности'));
assert(security.includes('<select name="securityMode" hidden><option value="none">None</option>'),
 'machine-readable protocol values must not be modified');
assert(html.includes("securityHint.hidden=security!=='none'"),'note must hide when TLS/Reality selected');
assert(html.includes(".drawer .field.field-security { display:block; }"));
assert(html.includes('.drawer .field-security .security-mode-note[hidden]'));
for(const key of ['inbounds.securityTitle','inbounds.securityNoneChoice','inbounds.securityNoneHelp']){
 assert(dict.includes(key),'missing localized key '+key);
}
assert(js.includes('mihomo-rule-switch-locked')&&js.includes('mihomo-rule-switch-padlock'));
assert(css.includes('.mihomo-rule-switch-locked input:checked+.mihomo-rule-switch-track'));
assert(css.includes('#606e7b'),'locked MATCH background is graphite');
assert(css.includes('.mihomo-rule-switch-locked .mihomo-rule-switch-padlock'));
assert(js.includes("if(!rule||rule.type==='MATCH')return"),'MATCH must remain unmodifiable');
console.log('PASS MATCH gray padlock, immutable fallback, inbound security without redundant label, localized None hint');
