const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('web/index.html','utf8');
const i18n=fs.readFileSync('web/i18n.js','utf8');
const locales=fs.readFileSync('web/i18n-locales.js','utf8');

assert.ok(!html.includes('data-view="subtemplates"'),'templates menu entry must be hidden');
assert.ok(html.includes('id="view-subtemplates"'),'backend template page remains available');
assert.ok(html.includes('id="credentials-form"'));
assert.ok(html.includes('name="oldPassword" type="password" autocomplete="current-password" required'));
assert.ok(html.includes('id="credentials-status"'));
assert.ok(html.includes("$('#credentials-form').onsubmit=saveCredentials"));
assert.ok(!html.includes("$('#save-credentials').onclick=saveCredentials"));
assert.ok(html.includes('form.elements.oldPassword.value='));
assert.ok(html.includes('new FormData(form)'));
assert.ok(html.includes('await api(\'/api/auth/credentials\''));
const ctx={window:{},localStorage:{getItem:()=> 'ru'},
 document:{readyState:'loading',documentElement:{getAttribute:()=> 'ru'},addEventListener:()=>{}}};
vm.createContext(ctx);
vm.runInContext(locales,ctx);
vm.runInContext(i18n,ctx);
const fields={
 'settings.listenIp':'Прослушиваемый IP',
 'settings.listenDomain':'Прослушиваемый домен',
 'settings.listenPort':'Прослушиваемый порт',
 'settings.uriPath':'URL путь панели',
 'settings.trafficNotify':'Уведомление об истечении порога карты',
 'settings.publicKeyPath':'Путь к публичному ключу',
 'settings.privateKeyPath':'Путь к приватному ключу',
 'settings.extTrafficInform':'Отправлять сведения о трафике во внешний сервис',
 'settings.extTrafficUri':'URL внешнего сервиса статистики',
 'settings.timeZone':'Временная зона',
 'settings.corePath':'Путь к ядру Mihomo',
 'settings.apiAddress':'Адрес API Mihomo',
 'settings.apiSecret':'Ключ доступа к API',
 'settings.mode':'Режим маршрутизации',
 'settings.logLevel':'Уровень журналирования',
 'settings.allowLan':'Разрешить подключения из локальной сети',
 'mc.pairingToken':'Токен сопряжения',
 'mc.advertisedAddress':'Адрес подключения других панелей',
 'settings.currentUsername':'Текущий логин',
 'settings.currentPassword':'Текущий пароль',
 'settings.newUsername':'Новый логин',
 'settings.newPassword':'Новый пароль',
 'settings.updateCredentials':'Сохранить учётные данные'
};
for(const [key,expected] of Object.entries(fields)){
 assert.equal(ctx.window.muiT(key),expected,'bad Russian translation '+key);
}
for(const key of [
 'settings.descListenIp','settings.descListenDomain','settings.descListenPort',
 'settings.descUriPath','settings.descSession','settings.descPageSize',
 'settings.descPublicKey','settings.descPrivateKey','settings.descExtInform',
 'settings.descExtUri','settings.descTimeZone','settings.descCorePath',
 'settings.descApiAddress','settings.descApiSecret','settings.descMode',
 'settings.descLogLevel','settings.descAllowLan','settings.credentialsHelp',
 'mc.endpointDesc'
]){
 const value=ctx.window.muiT(key);
 assert.notEqual(value,key,'description missing: '+key);
 assert.ok(!/[一-龥]/.test(value),'untranslated Chinese: '+key);
}
for (const [value,label] of Object.entries({
 silent:'Без журналирования',error:'Только ошибки',warning:'Предупреждения',
 info:'Информация',debug:'Отладочная информация'
})){
 assert.ok(html.includes('value="'+value+'" data-i18n="settings.log'+
  ({silent:'Silent',error:'Error',warning:'Warning',info:'Info',debug:'Debug'}[value])+'">'+label));
}
// Exercise the actual credentials form function without ever using live credentials.
const start=html.indexOf('    async function saveCredentials(event)');
const end=html.indexOf('    async function restartPanel()',start);
assert.ok(start>0&&end>start);
const source=html.slice(start,end);
const status={hidden:true,textContent:'',dataset:{},removeAttribute(){delete this.dataset.error}};
const button={disabled:false};
const form={
 elements:{oldPassword:{value:'old-placeholder',focus(){this.focused=true}},
           newPassword:{value:'new-placeholder'}},
 values:{oldUsername:'current',oldPassword:'valid',newUsername:'changed',newPassword:''},
 reset(){this.resetCalled=true}
};
const state={FormData:class{constructor(f){this.f=f}entries(){return Object.entries(this.f.values)[Symbol.iterator]()}},
 window:{},
 '$':selector=>({'#credentials-form':form,'#save-credentials':button,'#credentials-status':status})[selector],
 muiT:key=>key,panelURL:()=>'/login',location:{href:'/panel'},
 api:async (path,opts)=>{state.calls.push({path,opts})},calls:[]};
vm.createContext(state);vm.runInContext(source+';this.submit=saveCredentials;',state);
(async()=>{
 await state.submit({preventDefault(){}});
 assert.equal(state.calls.length,1);
 assert.equal(state.calls[0].path,'/api/auth/credentials');
 assert.deepEqual(JSON.parse(state.calls[0].opts.body),form.values);
 assert.equal(state.location.href,'/login');
 assert.equal(button.disabled,false);
 console.log('PASS: Russian panel settings, hidden templates, auth form submission and Mihomo log levels');
})().catch(e=>{console.error(e);process.exitCode=1});
