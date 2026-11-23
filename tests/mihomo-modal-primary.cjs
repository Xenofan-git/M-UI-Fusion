'use strict';
// Immutable CI checks for the real modal submission buttons, their short
// localized labels and the opaque, themed hover surfaces.
const fs=require('node:fs'),assert=require('node:assert/strict');
const read=name=>fs.readFileSync(name,'utf8');
const html=read('web/index.html');
const js=read('web/mihomo-settings.js');
const i18n=read('web/i18n.js');
const locales=read('web/i18n-locales.js');
const css=read('web/color-skins.css');
const keys=[
 'static/color-skins.css?v=116',
 'static/mihomo-settings.css?v=128',
 'static/mihomo-settings.js?v=128',
 'static/i18n.js?v=119',
 'static/i18n-locales.js?v=119'
];
for(const asset of keys)assert.ok(html.includes(asset),'missing cache-busting for '+asset);
assert.equal((js.match(/data-i18n="mh.applyToDraft">Apply<\/button>/g)||[]).length,2,'rule and outbound editors must show Apply');
assert.ok(i18n.includes("'mh.applyToDraft': 'Apply'"));
assert.ok(i18n.includes("'mh.applyToDraft': '应用'"));
assert.ok(locales.includes('"mh.applyToDraft": "Применить"'));
const translations=[...locales.matchAll(/"mh\.applyToDraft": "([^"]+)"/g)].map(match=>match[1]);
assert.equal(translations.length,9,'nine additional locales must have short Apply translation');
for(const value of translations){
 assert.ok(value.length<=15,'excessively long modal action translation: '+value);
 assert.ok(!/(черновик|чернетк|draft|project|tasar|проект|草稿|драфт|nháp| پیش نویس)/iu.test(value),'no draft jargon in modal action: '+value);
}
const selectors='html body :is(#mihomo-rule-modal,#mihomo-outbound-modal,#vpngate-modal) .modal-footer button.primary-btn';
assert.ok(css.includes(selectors+':not(:disabled) {'),'missing visible normal button color');
assert.ok(css.includes(selectors+':is(:hover,:focus-visible,:active):not(:disabled) {'),'missing hover/focus/touch contrast');
for(const value of ['--skin-accent, #009B77','--skin-accentHover, #20b88d','--skin-accentFg, #071c18','background-image: none !important','-webkit-text-fill-color','opacity: 1 !important']){
 assert.ok(css.includes(value),'missing opacity/background/text guard '+value);
}
assert.ok(js.includes('closeModal($(\'#mihomo-rule-modal\'))')&&js.includes('markDirty();'),'Apply must still stage changes for the top-level Save');
console.log('PASS: 11 locales short Apply button, 3 modal CSS hover/focus overrides and cache-busting');
