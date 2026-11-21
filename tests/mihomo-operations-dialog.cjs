'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const js=fs.readFileSync('web/mihomo-settings.js','utf8');
const css=fs.readFileSync('web/mihomo-settings.css','utf8');
const html=fs.readFileSync('web/index.html','utf8');
const cn=fs.readFileSync('web/i18n.js','utf8');
const locales=fs.readFileSync('web/i18n-locales.js','utf8');
assert(js.includes("backdrop.className='modal-backdrop mui-dialog mui-balancer-use-backdrop mui-mihomo-status-backdrop open'"));
assert(js.includes("panel.setAttribute('role','dialog')"));
assert(js.includes("panel.setAttribute('aria-modal','true')"));
assert(js.includes("detail.textContent=String(message||'')"),'errors must never become HTML');
assert(js.includes("const dialog=openMihomoStatusDialog('save')"));
assert(js.includes("const dialog=openMihomoStatusDialog('restart')"));
assert(js.includes("await api('/api/core/restart',{method:'POST'})"));
assert(js.includes("dialog.set('success',muiT('mh.settingsSaved'))"));
assert(js.includes("dialog.set('success',muiT('mh.operationRestartSuccess'))"));
assert(js.includes("dialog.set('error',error.message)"));
assert(js.includes("$('#mihomo-restart').onclick=restartMihomoFromSettings"));
assert(js.includes("if(mihomoActionBusy)return"),'prevent double execution');
assert(js.includes("if(busy)return"),'pending dialog cannot be dismissed');
assert(css.includes('.mui-mihomo-status-backdrop[data-phase="pending"]'));
assert(css.includes('.mui-mihomo-status-backdrop[data-phase="error"]'));
assert(css.includes('background:linear-gradient(160deg,#009B77,#08795E)'));
for(const asset of ['mihomo-settings.js','mihomo-settings.css','i18n.js','i18n-locales.js'])
 assert(html.includes('static/'+asset+'?v='+(asset.startsWith('mihomo-settings.')?'117':'116')),asset+' cache version');
const keys=['mh.operationSaving','mh.operationSaveTitle','mh.operationRestarting','mh.operationRestartTitle','mh.operationFailureTitle','mh.operationRestartSuccess'];
for(const key of keys){
 assert(cn.includes("'"+key+"':"),'missing base '+key);
 assert.equal((locales.match(new RegExp('"'+key+'":','g'))||[]).length,9,'missing locale '+key);
}
assert(locales.includes('Конфигурация сохранена'));
assert(locales.includes('Mihomo успешно перезапущен.'));
console.log('PASS: centered Mihomo save/restart dialog, pending/success/error, safe text, 11 languages, cache versions');
