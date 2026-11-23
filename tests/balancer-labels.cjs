const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source=fs.readFileSync('web/mihomo-settings.js','utf8');
const start=source.indexOf('  function displayedCurrentNode(');
const end=source.indexOf('  function groupTypeLabel(',start);
assert.ok(start>=0&&end>start,'display helpers exist');
let lang='ru';
const knownCodes=['FI','SE','NL','DE','RU','JP','LV','GB'];
const flags={
  byCode:new Map(knownCodes.map(code=>[code,{code,ru:({FI:'Финляндия',RU:'Россия',LV:'Латвия',NL:'Нидерланды'})[code]||code}])),
  read(name){
    const match=String(name).match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
    if(match) {
      const code=[...match[0]].map(c=>String.fromCharCode(c.codePointAt(0)-127397)).join('');
      return this.byCode.get(code)||null;
    }
    if(String(name).includes('Латвия'))return this.byCode.get('LV');
    if(String(name).includes('Москва'))return this.byCode.get('RU');
    return null;
  }
};
const sandbox={window:{muiGetLang:()=>lang,MUICountryFlags:flags}};
vm.createContext(sandbox);
vm.runInContext(source.slice(start,end),sandbox);
const node=sandbox.displayedCurrentNode;
const meta=sandbox.currentNodeMeta;
const result=sandbox.currentNodeMeta('FOREIGN','INT | lv 🟩 🔥 ⭐ 0.1X - LTE №51 - Латвия');
assert.equal(result.code,'LV');
assert.equal(result.label,'🟩 🔥 ⭐ 0.1X - LTE №51 - Латвия');
const russia=meta('Russia','RU | ru 0.1X - LTE №65 - Москва');
assert.equal(russia.code,'RU');
assert.equal(russia.label,'0.1X - LTE №65 - Москва');
assert.equal(meta('FOREIGN','FI 🟢 ⚡ ⭐ 0.1X - LTE №8 - Финляндия').label,'🟢 ⚡ ⭐ 0.1X - LTE №8 - Финляндия');
assert.equal(meta('Foreign-quatro-vpn','quatro-vpn | se 🟢 ⚡ LTE №1').label,'🟢 ⚡ LTE №1');
assert.equal(meta('FOREIGN','INT | NL 🟢 LTE Авто').code,'NL');
assert.equal(meta('FOREIGN','INT | NL 🟢 LTE Авто').label,'🟢 LTE Авто');
assert.equal(meta('FOREIGN','🇩🇪 DE 🟢 Германия').label,'🟢 Германия');
assert.equal(meta('Russia','RU Moscow #5').label,'Moscow #5');
assert.equal(meta('FOREIGN','Текущий не определён').code,'');
assert.equal(meta('FOREIGN','DE').code,'DE');
assert.equal(meta('FOREIGN','DE').label,'DE'); // no country description in local mock
assert.equal(meta('FOREIGN','[JP] Tokyo').label,'Tokyo');
assert.equal(meta('FOREIGN','Proxy without known country').label,'Proxy without known country');
assert.equal(meta('FOREIGN','INT | lv 🟩 🔥').original,'INT | lv 🟩 🔥');

const groupLogic=source.slice(source.indexOf('  function groupResultLabel('),source.indexOf('  function groupTestNote('));
const runtime={currentNodeMeta:meta,activeGroupResults:new Map([
 ['FOREIGN',{running:true,applied:true,current:'INT | lv 🟩 LTE - Латвия'}],
 ['Russia',{running:true,applied:true,current:'RU | ru Москва'}],
 ['Waiting',{running:false,applied:false,current:''}]
])};
vm.createContext(runtime);vm.runInContext(groupLogic,runtime);
assert.equal(runtime.groupResultLabel('FOREIGN'),'🟩 LTE - Латвия');
assert.equal(runtime.groupResultLabel('Russia'),'Москва');
assert.equal(runtime.groupResultLabel('Waiting'),'Mihomo недоступен');

const renderStart=source.indexOf('  function paintCurrentGroupNode(');
const renderEnd=source.indexOf('  // Update visible text nodes',renderStart);
assert.ok(renderStart>0&&renderEnd>renderStart);
class FakeElement {
  constructor(tag){this.tag=tag;this.children=[];this.className='';this.textContent='';this.title='';this.attributes={};
    this.classList={add:x=>{this.className+=' '+x}};}
  setAttribute(k,v){this.attributes[k]=v;}
  getAttribute(k){return this.attributes[k]||null;}
  querySelector(selector){
    if(selector===':scope > img.mihomo-current-country-flag')
      return this.children.find(c=>c.tag==='img'&&c.className.includes('mihomo-current-country-flag'))||null;
    if(selector===':scope > .mihomo-current-country-label')
      return this.children.find(c=>c.className.includes('mihomo-current-country-label'))||null;
    return null;
  }
  replaceChildren(...items){this.children=items;this.textContent='';}
}
const document={createElement:tag=>new FakeElement(tag)};
const runtime2={window:{MUICountryFlags:{createIcon:code=>{
  if(!code)return null;
  const element=new FakeElement('img');element.src='flags/'+code.toLowerCase()+'.svg';return element;
}}},document,activeGroupResults:runtime.activeGroupResults,
  currentNodeMeta:meta,groupResultLabel:runtime.groupResultLabel,
  groupResultTitle:()=>'',groupTestNote:()=>''};
vm.createContext(runtime2);vm.runInContext(source.slice(renderStart,renderEnd)+'\nthis.paint=paintCurrentGroupNode;',runtime2);
const el=new FakeElement('span');
runtime2.paint(el,'FOREIGN');
assert.equal(el.children.length,2);
assert.equal(el.children[0].tag,'img');
assert.equal(el.children[0].src,'flags/lv.svg');
assert.equal(el.children[0].attributes['aria-label'],'LV');
assert.equal(el.children[1].textContent,'🟩 LTE - Латвия');
assert.equal(el.title,'INT | lv 🟩 LTE - Латвия');
const originalImage=el.children[0];
runtime2.paint(el,'FOREIGN');
assert.equal(el.children[0],originalImage,'refresh must reuse SVG to prevent blinking');
runtime2.paint(el,'Russia');
assert.equal(el.children[0].src,'flags/ru.svg');
assert.equal(el.children[1].textContent,'Москва');
runtime2.paint(el,'Waiting');
assert.equal(el.children.length,2); // plain status via textContent in fake (children retained)
assert.equal(el.textContent,'Mihomo недоступен');

// Backend proxy names are unchanged. Only the current visible entry is formatted.
assert.equal(node('Foreign-quatro-vpn','quatro-vpn | se 🟢 ⚡ ★ LTE - Безлимитный #2'),'se 🟢 ⚡ ★ LTE - Безлимитный #2');
assert.equal(node('Russia','RU Moscow #5'),'RU Moscow #5');
const css=fs.readFileSync('web/mihomo-settings.css','utf8');
const html=fs.readFileSync('web/index.html','utf8');
assert.ok(css.includes('.mihomo-current-country-flag'));
assert.ok(html.includes('mihomo-settings.js?v=125'));
assert.ok(html.includes('mihomo-settings.css?v=127'));
for(const code of ['lv','ru','fi','de']){
  const svg=fs.readFileSync('web/flags/'+code+'.svg','utf8');
  assert.ok(svg.startsWith('<svg ')&&svg.includes('viewBox='),'local SVG asset '+code);
}
assert.ok(source.includes('paintActiveGroupResults();\n      refreshActiveGroups();'),'render must restore SVG after table rebuild');
assert.ok(!source.includes('currentNodeWithFlag'),'regional-indicator emojis must not be used in the active server label');

console.log('PASS: country SVGs for active outbound Latvia/Russia, labels without codes, safe DOM update and unchanged keys');
