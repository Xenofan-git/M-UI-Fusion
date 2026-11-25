'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const js=fs.readFileSync('web/mihomo-balancer-servers.js','utf8');
const editor=fs.readFileSync('web/mihomo-settings.js','utf8');
const css=fs.readFileSync('web/mihomo-settings.css','utf8');
const subsCSS=fs.readFileSync('web/outbound-subscriptions.css','utf8');
const html=fs.readFileSync('web/index.html','utf8');
const i18n=fs.readFileSync('web/i18n.js','utf8');
const locales=fs.readFileSync('web/i18n-locales.js','utf8');
assert(js.includes('class="fbs-tab-icon"'),'SVG icon expected');
assert(!js.includes('tabIcon(\'refresh\')')&&js.includes('tabIcon(\'filter\')'));
assert(!js.includes('🟢 Обновление')&&!js.includes('🟢 Фильтры'));
assert(js.includes('const existing=new Map([...body.querySelectorAll'), 'rows must survive background polling');
assert(!js.slice(js.indexOf(' function renderRows(){'),js.indexOf(' function teardown(){')).includes('body.replaceChildren()'), 'avoid re-creating 130 flag SVGs');
assert(js.includes('body.children[index]!==tr'),'do not reattach stable rows');
assert(js.includes('if(candidate.dataset.candidate===liveCandidate)return'),'candidate flag must be preserved');
assert(js.includes('flag.onclick=async()=>'), 'flag should be clickable');
assert(js.includes('Просто нажмите на флаг, чтобы он скопировался для вставки в фильтр'),'hover must explain click-to-copy');
assert(js.includes("navigator.clipboard?.writeText"),'modern Clipboard API');
assert(js.includes("document.execCommand?.('copy')"),'HTTP/Windows legacy fallback');
assert(js.includes('term=country.flag'),'country picker must insert real flag, not only translated name');
assert(js.includes('const addCountryIcon='),'country picker must use SVG plus icon, not an emoji');
assert(!js.includes('🏳️ Добавить страну'),'unsupported flag emoji must not appear in country picker');
assert(js.includes("document.addEventListener('click',onOutsideClick)"),'country picker must close on outside click');
assert(js.includes('dismissCountryPicker()'),'country picker listener must be released on teardown');
assert(js.includes('statusPollIntervalMs=60000'),'status read must poll once per minute');
assert(js.includes('statusPanelVisible()'),'status poll must stop when the panel is hidden');
assert(js.includes("document.addEventListener('visibilitychange',onVisibilityChange)"),'resume after tab becomes visible');
assert(js.includes('statusRequestPromise'),'deduplicate concurrent status reads');
assert(js.includes('const saveSourceSettings=async('),'balancer must persist source filters on Apply');
assert(js.includes('context.saveSourceSettings=saveSourceSettings'),'Apply must have a source-save callback');
assert(js.includes('fbs-row-filtered'),'live filtering must visually mark mismatching servers');
assert(js.includes('if(!pendingPreview)'),'filter input must cross out in place until Apply');
assert(js.includes('previewRowOrder=new Map('),'unsaved filter must freeze original row order');
assert(css.includes('.fbs-node-name,.fbs-candidate-label,.mihomo-table .mihomo-name,'),
 'outbound node names must be selectable as normal text');
assert(css.includes('.fbs-node-name::selection'),'selection appearance must be explicitly defined');
assert(css.includes('background:#4dd6ae!important'),'selection must show on dark background');
assert(!css.includes('max-width:calc(100% - 40px)'),'node-name selection must not be trapped in a clipped scroller');
assert(js.includes('renderFilterFlagPreviews()'),'old Windows filter preview requires local SVG');
assert(css.includes('.fbs-copy-flag')&&css.includes('.fbs-filter-flag-chip'));
assert(!js.includes('fbs-filter-guidance')&&!css.includes('.fbs-filter-guidance{'),'standalone guidance must be removed');
assert.equal((js.match(/class="fbs-filter-field-title"/g)||[]).length,2,'both field titles should carry inline guidance');
assert.equal((js.match(/\(одна строка = одно условие\)/g)||[]).length,2,'every field needs exact inline hint');
assert(css.includes('.fbs-filter-field-title small{'),'inline hint should use muted label styling');
assert(css.includes('width:18px;height:12px'));
assert(subsCSS.includes('.outsub-dialog .outsub-flag-svg,'));
assert(editor.includes("openMihomoStatusDialog('apply')"));
assert(editor.includes("dialog?.set('success',muiT('mh.operationApplyReady'))"));
assert(editor.includes("dialog?.set('error',error.message)"));
const keys=['mh.operationApplying','mh.operationApplyTitle','mh.operationApplyReady'];
for(const k of keys){
 assert(i18n.includes("'"+k+"':"), 'missing base i18n '+k);
 assert.equal((locales.match(new RegExp('"'+k+'":','g'))||[]).length,9,'missing locale '+k);
}
for(const [file,version] of [
 ['mihomo-balancer-servers.js','144'],['mihomo-settings.js','139'],['mihomo-settings.css','137'],
 ['outbound-subscriptions.css','125'],['i18n.js','123'],['i18n-locales.js','119']
])assert(html.includes('static/'+file+'?v='+version),'asset cache '+file);
console.log('PASS: SVG balancer tabs, stable flags, clipboard fallback, filter preview, centered Apply status, 11 translations');
