'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const locales=fs.readFileSync('web/i18n-locales.js','utf8');
const i18n=fs.readFileSync('web/i18n.js','utf8');
const html=fs.readFileSync('web/index.html','utf8');
const context={
  window:{},localStorage:{getItem:()=> 'ru'},
  document:{readyState:'loading',documentElement:{getAttribute:()=> 'ru'},addEventListener:()=>{}}
};
vm.createContext(context);
vm.runInContext(locales,context);
vm.runInContext(i18n,context);
const t=context.window.muiT;
for(const [key,expected] of Object.entries({
  'common.save':'Сохранить',
  'common.delete':'Удалить',
  'common.cancel':'Отмена',
  'dash.coreRunning':'Работает',
  'dash.logs':'Журналы',
  'mh.colOutbound':'Исходящий',
  'mh.confirmDeleteOutbound':'Удалить исходящий «Russia»? После сохранения конфигурации он больше не будет использоваться.',
  'msg.coreStarted':'Ядро запущено'
})){
  const params=key==='mh.confirmDeleteOutbound'?{name:'Russia'}:undefined;
  assert.equal(t(key,params),expected,key);
}
assert.equal(t('dash.cpuCaption',{cores:4,coreUnit:'ядра'}),'ЦП: 4 ядра');
const badWords=['Коры','Логс','Спасти','инвалид','Выходи.','крах/expand','Тихая капля','Ядро началось'];
for(const bad of badWords){
  assert.ok(!locales.slice(locales.indexOf('"ru": {'),locales.indexOf('"fa": {')).includes(bad),'Russian translation still contains '+bad);
}
const source=html.slice(html.indexOf('    function russianCpuCoreUnit(count) {'),html.indexOf('    function renderState() {'));
assert.ok(source.includes('function russianCpuCoreUnit'));
const check=vm.runInNewContext(source+';russianCpuCoreUnit');
for(const [n,want] of [[0,'ядер'],[1,'ядро'],[2,'ядра'],[4,'ядра'],[5,'ядер'],[11,'ядер'],[14,'ядер'],[21,'ядро'],[22,'ядра'],[24,'ядра'],[25,'ядер'],[111,'ядер']]){
  assert.equal(check(n),want,'CPU core plural '+n);
}

const makeTranslator=lang=>{
  const runtime={window:{},localStorage:{getItem:()=>lang},
    document:{readyState:'loading',documentElement:{getAttribute:()=>lang},addEventListener:()=>{}}};
  vm.createContext(runtime);vm.runInContext(locales,runtime);vm.runInContext(i18n,runtime);
  return runtime.window.muiT;
};
const english=makeTranslator('en');
const russian=makeTranslator('ru');
const ruSection=locales.slice(locales.indexOf('    "ru": {'),locales.indexOf('    "fa": {'));
const keys=[...ruSection.matchAll(/^      "([^"]+)":/gm)].map(match=>match[1]);
assert.ok(keys.length>=925,'all Russian localization keys must be present');
assert.equal(keys.length,new Set(keys).size,'no duplicate RU keys');
for(const key of keys){
  const placeholders=value=>[...new Set([...value.matchAll(/\{[a-zA-Z]\w*\}/g)].map(item=>item[0]))].sort();
  if(key==='dash.cpuCaption'){
    assert.deepEqual(placeholders(russian(key)),['{coreUnit}','{cores}']);
    continue;
  }
  assert.deepEqual(placeholders(russian(key)),placeholders(english(key)),'placeholder set: '+key);
}
assert.equal(russian('cs.urlNote').includes('<code>/clash</code>'),true);

console.log('PASS: essential Russian UI strings and correct CPU core endings');
