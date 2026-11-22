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
assert(js.includes('tabIcon(\'refresh\')')&&js.includes('tabIcon(\'filter\')'));
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
assert(js.includes('renderFilterFlagPreviews()'),'old Windows filter preview requires local SVG');
assert(css.includes('.fbs-copy-flag')&&css.includes('.fbs-filter-flag-chip'));
assert(js.includes('class="fbs-filter-guidance">Вписать по одному по вертикали</p>'));
assert(css.includes('.fbs-filter-guidance{'),'missing visible filter guidance styling');
assert(css.includes('width:16px;height:11px'));
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
 ['mihomo-balancer-servers.js','122'],['mihomo-settings.js','119'],['mihomo-settings.css','122'],
 ['outbound-subscriptions.css','119'],['i18n.js','119'],['i18n-locales.js','119']
])assert(html.includes('static/'+file+'?v='+version),'asset cache '+file);
console.log('PASS: SVG balancer tabs, stable flags, clipboard fallback, filter preview, centered Apply status, 11 translations');
