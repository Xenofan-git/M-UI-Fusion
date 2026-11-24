'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const css=fs.readFileSync('web/mihomo-settings.css','utf8');
const html=fs.readFileSync('web/index.html','utf8');
const js=fs.readFileSync('web/mihomo-settings.js','utf8');
assert(html.includes('mihomo-settings.css?v=130'));
for(const rule of [
 'background:#50606c;border:1px solid #83939f',
 'background:#e6ecf0;border-radius:50%',
 'input:not(:checked)+.mihomo-rule-switch-track',
 'input:checked+.mihomo-rule-switch-track',
 'background:var(--skin-accent,#009B77)',
 'transform:translateX(14px)',
 'input:focus-visible+.mihomo-rule-switch-track',
 'prefers-reduced-motion:reduce'
])assert(css.includes(rule),'Missing contrasting switch state: '+rule);
assert(js.includes('data-rule-toggle')&&js.includes('input.onchange=()=>toggleRule(input.dataset.ruleToggle,input.checked)'),'rule switches must remain interactive');
console.log('PASS explicitly visible OFF thumb and track, emerald ON, focus, reduced motion');
