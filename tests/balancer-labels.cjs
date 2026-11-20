const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('web/mihomo-settings.js', 'utf8');
const start = source.indexOf('  function displayedCurrentNode(');
const end = source.indexOf('  function groupResultLabel(', start);
assert.ok(start >= 0 && end > start, 'balancer display helpers must exist');
let lang = 'ru';
const sandbox = {window: {muiGetLang: () => lang}};
vm.createContext(sandbox);
vm.runInContext(source.slice(start, end), sandbox);
const node = sandbox.displayedCurrentNode;
const strategy = sandbox.groupTypeLabel;
const withFlag = sandbox.currentNodeWithFlag;
assert.equal(withFlag('FOREIGN','FI 🟢 ⚡ ⭐ 0.1X - LTE №8 - Финляндия'),
  '🇫🇮 FI 🟢 ⚡ ⭐ 0.1X - LTE №8 - Финляндия');
assert.equal(withFlag('Foreign-quatro-vpn','quatro-vpn | se 🟢 ⚡ LTE №1'),
  '🇸🇪 se 🟢 ⚡ LTE №1');
assert.equal(withFlag('FOREIGN','INT | NL 🟢 LTE Авто'), '🇳🇱 INT | NL 🟢 LTE Авто');
assert.equal(withFlag('FOREIGN','🇩🇪 DE 🟢 Германия'), '🇩🇪 DE 🟢 Германия');
assert.equal(withFlag('Russia','RU Moscow #5'), '🇷🇺 RU Moscow #5');
assert.equal(withFlag('Russia','Текущий не определён'),'Текущий не определён');
assert.equal(withFlag('FOREIGN','DE'), '🇩🇪 DE');
assert.equal(withFlag('FOREIGN','[JP] Tokyo'), '🇯🇵 [JP] Tokyo');
const groupLogic = source.slice(source.indexOf('  function groupResultLabel('),
  source.indexOf('  function groupTestNote(',source.indexOf('  function groupResultLabel(')));
const runtime = {currentNodeWithFlag:withFlag,activeGroupResults:new Map([
 ['FOREIGN',{running:true,applied:true,current:'FI 🟢 ⚡ ⭐ 0.1X - LTE №8 - Финляндия'}],
 ['Russia',{running:true,applied:true,current:'RU Moscow #5'}],
 ['Waiting',{running:false,applied:false,current:''}]
])};
vm.createContext(runtime);
vm.runInContext(groupLogic,runtime);
assert.equal(runtime.groupResultLabel('FOREIGN'),'🇫🇮 FI 🟢 ⚡ ⭐ 0.1X - LTE №8 - Финляндия');
assert.equal(runtime.groupResultLabel('Russia'),'🇷🇺 RU Moscow #5');
assert.equal(runtime.groupResultLabel('Waiting'),'Mihomo недоступен');


// Only duplicate, group-matching provider labels are hidden, never the actual node name.
assert.equal(node('Foreign-quatro-vpn', 'quatro-vpn | se 🟢 ⚡ ★ LTE - Безлимитный #2'),
  'se 🟢 ⚡ ★ LTE - Безлимитный #2');
assert.equal(node('FOREIGN', 'quatro-vpn | se 🟢 ⚡ ★ LTE - Безлимитный #2'),
  'quatro-vpn | se 🟢 ⚡ ★ LTE - Безлимитный #2');
assert.equal(node('Russia', 'RU Moscow #5'), 'RU Moscow #5');
assert.equal(node('Russia', 'Russia | RU Moscow #5'), 'RU Moscow #5');
assert.equal(strategy('url-test'), 'URL-тест');
assert.equal(strategy('url-test', 'URL Test'), 'URL-тест');
assert.equal(strategy('fallback', 'Fallback'), 'Fallback');
lang = 'en';
assert.equal(strategy('url-test'), 'url-test');
assert.equal(strategy('url-test', 'URL Test'), 'URL Test');

const locale = fs.readFileSync('web/i18n-locales.js', 'utf8');
assert.ok(locale.includes('"mh.colKind": "Источник"'));
assert.ok(locale.includes('"mh.colActions": "Настройки"'));
assert.ok(!locale.includes('"mh.colKind": "Добрый"'));
assert.ok(!locale.includes('"mh.colActions": "Меры"'));
assert.ok(fs.readFileSync('web/outbound-subscriptions.js', 'utf8')
  .includes("['url-test','URL-тест — наименьшая задержка']"));
assert.ok(source.includes('if(group.current)return currentNodeWithFlag(name,group.current);'));
assert.ok(!source.includes("'Текущий: '+group.current"));
console.log('PASS: Russian balancer labels, live member display and unchanged backend keys');
