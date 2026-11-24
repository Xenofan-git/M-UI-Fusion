const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('web/index.html','utf8');
const login=fs.readFileSync('web/login.html','utf8');
const locales=fs.readFileSync('web/i18n-locales.js','utf8');
const i18n=fs.readFileSync('web/i18n.js','utf8');
const multi=fs.readFileSync('web/multi-control.js','utf8');

const form=html.slice(html.indexOf('<form id="mihomo-basics-form"'),html.indexOf('</form>',html.indexOf('<form id="mihomo-basics-form"')));
const labels=[...form.matchAll(/<label for="(basics-[^"]+)" data-i18n="([^"]+)">([^<]+)<\/label>/g)];
const sections=[...form.matchAll(/<details class="basics-section"[^>]*><summary data-i18n="([^"]+)">([^<]+)<\/summary>/g)];
const choices=[...form.matchAll(/<option value="([^"]+)" data-i18n="([^"]+)">([^<]+)<\/option>/g)];
assert.equal(labels.length,28,'every settings label should have a localization key');
assert.equal(sections.length,6,'every accordion should have a localization key');
assert.equal(choices.length,13,'all Mihomo Basic select options must use explicit localization keys');
assert.equal(new Set(labels.map(m=>m[1])).size,28,'label targets must remain distinct');
assert.equal(new Set(choices.map(m=>m[1])).size,13,'select values unchanged');
for(const [id,key] of labels.map(m=>[m[1],m[2]])){
 assert.ok(form.includes('id="'+id+'"'),'form control lost '+id);
 assert.ok(key.startsWith('mihomo.basic.'),'missing basic key '+id);
}
assert.ok(form.includes('name="mode"'));
assert.ok(form.includes('name="logLevel"'));
assert.ok(form.includes('name="directIpVersion"'));

let language='ru';
const context={
 window:{dispatchEvent(){}},Event:class{},
 localStorage:{getItem:key=>key==='mui-language'?language:null,setItem:(key,value)=>{if(key==='mui-language')language=value}},
 document:{readyState:'loading',documentElement:{getAttribute:()=> language,setAttribute:(key,val)=>{if(key==='data-default-language')language=val}},addEventListener(){},querySelectorAll:()=>[]}
};
vm.createContext(context);
vm.runInContext(locales,context);
vm.runInContext(i18n,context);
for(const key of [...labels.map(m=>m[2]),...choices.map(m=>m[2]),...sections.map(m=>m[1])]){
 const text=context.window.muiT(key);
 assert.notEqual(text,key,'missing Russian translation '+key);
 assert.ok(text.trim(),'empty translation '+key);
 // Technical abbreviations and proper names are intentionally retained.
}
const expected={
 'mihomo.basic.mode':'Режим маршрутизации',
 'mihomo.basic.directIpVersion':'Версия IP для прямых подключений',
 'mihomo.basic.sniffer':'Определение доменов (Sniffer)',
 'mihomo.basic.sniffer-forceDnsMapping':'Принудительное сопоставление DNS',
 'mihomo.basic.inbound-upload':'Учёт отправленного трафика входящих',
 'mihomo.basic.trafficSampleSeconds':'Интервал измерения трафика',
 'mihomo.basic.maskLogAddress':'Скрывать IP-адреса в журнале',
 'mihomo.basic.option.mode.rule':'По правилам',
 'mihomo.basic.option.directIpVersion.dual':'IPv4 и IPv6',
 'mihomo.basic.option.logLevel.debug':'Отладка',
 'mihomo.descInboundUpload':'Учёт отправленного трафика и квоты клиентов всегда включён.',
 'mihomo.descBlockDomains':'Укажите домены, суффиксы, full: для точного совпадения, keyword: для поиска или geosite: для категории.',
 'mc.invalidPairingToken':'Недействительный токен сопряжения Multi-control'
};
for(const [key,value] of Object.entries(expected)){
 assert.equal(context.window.muiT(key),value,'bad RU translation '+key);
}
for(const key of [
 'mihomo.modeWarning','mihomo.descRoutingMode','mihomo.descDirectIpVersion',
 'mihomo.descTestUrl','mihomo.descTcpConcurrent','mihomo.descUnifiedDelay',
 'mihomo.descInboundDownload','mihomo.descOutboundUpload','mihomo.descOutboundDownload',
 'mihomo.descSampleInterval','mihomo.descSaveInterval','mihomo.descLogLevel',
 'mihomo.descLogBuffer','mihomo.descMaskAddress','mihomo.descDnsLog',
 'mihomo.descBlockTorrent','mihomo.descBlockIps','mihomo.descIpv4Routing',
 'mihomo.descWarpRouting'
]){
 const text=context.window.muiT(key);
 assert.notEqual(text,key,key);
 assert.ok(!/[\u3400-\u9FFF]/.test(text),'untranslated Chinese '+key);
}
context.window.muiSetLang('en');
assert.equal(context.window.muiT('mihomo.basic.mode'),'Routing Mode');
assert.equal(context.window.muiT('mihomo.basic.option.mode.rule'),'Rule');
assert.equal(context.window.muiT('mc.invalidPairingToken'),'Invalid Multi-control pairing token');
context.window.muiSetLang('ru');
assert.equal(context.window.muiT('mihomo.basic.mode'),'Режим маршрутизации');

// Login has a final, theme-independent soft-press stylesheet rather
// than the previous forced white plate with almost-black text.
const finalTheme=login.indexOf('href="static/color-skins.css"');
const feedback=login.indexOf('href="static/action-button-feedback.css?v=2"');
assert.ok(finalTheme>=0&&feedback>finalTheme&&feedback<login.indexOf('</head>'));
assert.ok(!login.includes('login-button-hover-legibility'));
const css=fs.readFileSync('web/action-button-feedback.css','utf8');
assert.ok(css.includes('html body #login-button'));
assert.ok(css.includes('-webkit-text-fill-color: var(--mui-press-ink) !important'));
assert.ok(css.includes('linear-gradient(125deg, var(--mui-press-top), var(--mui-press-bottom))'));

assert.ok(multi.includes("muiT('mc.invalidPairingToken')"));
assert.ok(multi.includes('readablePeerError(peer.error'));
assert.match(multi,/invalid pairing token/);
assert.match(multi,/function modalError\(modal,message\).*readablePeerError\(message\)/);
assert.match(multi,/function error\(message\).*readablePeerError\(message\)/);
console.log('PASS: 6 Mihomo sections, 28 labels, 13 select options; RU/EN; hover text; peer errors');
