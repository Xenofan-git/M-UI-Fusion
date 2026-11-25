'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const flagsSource=fs.readFileSync('web/country-flags.js','utf8');
const script=fs.readFileSync('web/mihomo-balancer-servers.js','utf8');
const html=fs.readFileSync('web/index.html','utf8');
const sandbox={window:{},document:{currentScript:{src:'http://localhost/static/country-flags.js'}},
  location:{href:'http://localhost/'},URL,Intl};
vm.createContext(sandbox);
vm.runInContext(flagsSource,sandbox);
const flags=sandbox.window.MUICountryFlags;
for(const [condition,expected] of [
  ['США','US'],['🇺🇸','US'],['US','US'],['United States','US'],
  ['Россия','RU'],['🇷🇺','RU'],['RU','RU']
])assert.equal(flags.fromFilterLine(condition)?.code,expected,condition);
for(const name of [
 'quatro-vpn | 🇺🇸 ⭐ 0.1X - LTE №74 - США· Атланта',
 'quatro-vpn | 🇺🇸 ⭐ LTE Авто - США'
])assert.equal(flags.read(name)?.code,'US',name);
assert.equal(flags.read('quatro-vpn | 🇩🇪 LTE Германия')?.code,'DE');
assert(html.includes('static/mihomo-balancer-servers.js?v=143'),'updated JS must bypass browser cache');
assert(script.includes('function repaintFilterRowsInPlace()'),
 'textarea must repaint existing table rows synchronously');
assert(script.includes('function activeFilterSourceID()')&&
  script.includes('return ids.length===1?ids[0]:\'\';'),
 'single attached source must be resolved even when the HTML chooser is empty');
assert(script.includes('row.classList.toggle(\'fbs-row-filtered\',blocked)'),
 'input must immediately strike excluded rows');
assert(!script.slice(script.indexOf('const previewInput='),script.indexOf('function fillSource(){')).includes('renderRows();'),
 'typing must never rebuild/reorder the server table');
assert(script.includes("area.addEventListener('input',previewInput)"),'native textarea input must repaint directly');
assert(script.includes("area.addEventListener('change',previewInput)"),'paste or blur must repaint directly');
assert(script.includes("area.addEventListener('keyup',previewInput)"),'legacy keyboard event must repaint directly');
assert(script.includes('filterEditBaseline=new Map(sourceList.map('),
 'filter preview must compare against immutable initial subscription baseline');
assert(script.includes('filterDraftTouched.add(activeID)')&&
  script.includes('filterDraftTouched.delete(key)'),
 'input edits must hold preview until Apply, even if live metadata changes');
assert(script.includes('term.code===country?.code||'),
 'US must not accidentally match Russia via substring');
assert(script.includes('if(!pending){renderRows();return;}')&&script.includes("' · предпросмотр до «Применить»'"),
 'draft mode must be visually distinguished from saved filtering');
console.log('PASS: Cyrillic USA, flag and ISO country matching plus immediate in-place filter preview');
