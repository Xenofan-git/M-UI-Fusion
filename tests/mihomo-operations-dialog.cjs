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
assert(js.includes("if(phase==='success')successDismissTimer=setTimeout(close,2500)"),'successful dialog auto-dismisses after 2.5 s');
assert(js.includes("footer.hidden=phase!=='error'"),'only error dialogs should show the Close button');
assert(js.includes('clearTimeout(successDismissTimer)'),'manual close must cancel timer');
const paletteCSS=fs.readFileSync('web/color-skins.css','utf8');
assert(paletteCSS.includes('html body .modal-backdrop:is(.mui-dialog,.mui-balancer-use-backdrop) .modal-footer'),'consistent dialog hover across skins');
assert(paletteCSS.includes('-webkit-text-fill-color:#fff!important'),'older Chromium has readable dialog labels');
assert(css.includes('.mui-mihomo-status-backdrop[data-phase="pending"]'));
assert(css.includes('.mui-mihomo-status-backdrop[data-phase="error"]'));
assert(css.includes('background:linear-gradient(160deg,#009B77,#08795E)'));
for(const [asset,version] of [['mihomo-settings.js','131'],['mihomo-settings.css','132'],['i18n.js','123'],['i18n-locales.js','119']])
 assert(html.includes('static/'+asset+'?v='+version),asset+' cache version');
const keys=['mh.operationSaving','mh.operationSaveTitle','mh.operationRestarting','mh.operationRestartTitle','mh.operationFailureTitle','mh.operationRestartSuccess'];
for(const key of keys){
 assert(cn.includes("'"+key+"':"),'missing base '+key);
 assert.equal((locales.match(new RegExp('"'+key+'":','g'))||[]).length,9,'missing locale '+key);
}
assert(locales.includes('Конфигурация сохранена'));
assert(locales.includes('Mihomo успешно перезапущен.'));
console.log('PASS: centered Mihomo save/restart dialog, pending/success/error, safe text, 11 languages, cache versions');
