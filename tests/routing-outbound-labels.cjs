const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('web/mihomo-settings.js','utf8');
const start=source.indexOf("  const builtins=['DIRECT'");
const end=source.indexOf('  const defaultTestURL=',start);
const helperStart=source.indexOf('  function targetOptions(');
const helperEnd=source.indexOf('  function ensureModals()',helperStart);
assert.ok(start>=0&&end>start&&helperStart>=0&&helperEnd>helperStart);
let lang='ru';
const context={
  window:{muiGetLang:()=>lang},
  draft:{outbounds:[{name:'Russia'},{name:'Foreign-quatro-vpn'}]},
  esc:value=>String(value),
};
vm.createContext(context);
vm.runInContext(source.slice(start,end)+source.slice(helperStart,helperEnd),context);
const pairs=[
  ['DIRECT','ПРЯМОЙ'],
  ['REJECT','БЛОКИРОВАТЬ'],
  ['REJECT-DROP','ОТБРОСИТЬ БЕЗ ОТВЕТА'],
  ['PASS','ПРОПУСТИТЬ'],
  ['PASS-RULE','ПРОПУСТИТЬ ПОДПРАВИЛО'],
  ['COMPATIBLE','СОВМЕСТИМОСТЬ'],
  ['GLOBAL','ГЛОБАЛЬНЫЙ']
];
const html=context.targetOptions('DIRECT');
for(const [name,russian] of pairs){
  const expected='<option value="'+name+'" '+(name==='DIRECT'?'selected':'')+'>'+name+' ('+russian+')</option>';
  assert.ok(html.includes(expected),'ru label/value mismatch for '+name);
}
assert.ok(html.includes('<option value="Russia" >Russia</option>'));
assert.ok(html.includes('<option value="Foreign-quatro-vpn" >Foreign-quatro-vpn</option>'));
const match=html.match(/<option value="([^"]*)" selected>([^<]*)<\/option>/);
assert.equal(match[1],'DIRECT');
assert.equal(match[2],'DIRECT (ПРЯМОЙ)');
lang='en';
const en=context.targetOptions('DIRECT');
for(const [name] of pairs){
  assert.ok(en.includes('<option value="'+name+'" '+(name==='DIRECT'?'selected':'')+'>'+name+'</option>'),'en must not be translated: '+name);
}
lang='ru';
const group=context.targetOptions('REJECT',true);
assert.ok(group.includes('REJECT (БЛОКИРОВАТЬ)'));
assert.ok(!group.includes('PASS-RULE ('),'group built-in set must stay unchanged');
console.log('PASS: seven Russian Mihomo outbound hints; original values, group whitelist and English unchanged');
