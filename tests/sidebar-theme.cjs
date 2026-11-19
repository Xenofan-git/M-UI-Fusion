const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('web/index.html','utf8');
const liquid=fs.readFileSync('web/liquid-optics.css','utf8');
const locales=fs.readFileSync('web/i18n-locales.js','utf8');
const i18n=fs.readFileSync('web/i18n.js','utf8');
assert.equal((html.match(/class="sidebar-logo-img"/g)||[]).length,1);
assert.ok(html.includes('class="sidebar-logo-img" src="media/m-ui_logo.png" alt="M-UI Fusion" width="60" height="60"'));
assert.match(html,/\.sidebar-logo \{\s*width: 60px; height: 60px;/);
assert.ok(liquid.includes('.sidebar-logo { width: 60px; height: 60px;'));
assert.ok(html.includes('body.sider-collapsed .sidebar-logo { width: 42px; height: 42px; }'));
assert.ok(liquid.includes('body.sider-collapsed .sidebar-logo { width: 42px; height: 42px; }'));
assert.ok(!html.includes('id="sidebar-theme"'));
assert.ok(!html.includes('id="sidebar-theme-control"'));
assert.ok(!html.includes('sidebar-dark-toggle'));
assert.ok(!html.includes('sidebar-ultra-toggle'));
assert.equal((html.match(/id="theme-toggle"/g)||[]).length,1);
assert.equal((html.match(/id="top-theme-menu"/g)||[]).length,1);
assert.ok(html.includes('aria-controls="top-theme-menu" aria-expanded="false"'));
assert.ok(html.includes('data-theme-choice="light" aria-checked="false"'));
assert.ok(html.includes('data-i18n="nav.light">Светлая</span>'));
assert.ok(html.includes('data-theme-choice="dark" aria-checked="false"'));
assert.ok(html.includes('data-theme-choice="ultra" aria-checked="false"'));
assert.ok(html.includes('data-i18n="nav.dark">Тёмная</span>'));
assert.ok(html.includes('data-i18n="nav.ultraDark">Очень тёмная</span>'));
assert.ok(html.includes('.top-theme-menu[hidden] { display: none !important; }'));
assert.ok(html.includes('.top-actions #theme-toggle { display: inline-flex; }'));
assert.ok(html.includes('data-i18n="nav.inbounds">Входящие</span>'));
const context={
  window:{},
  localStorage:{getItem:()=> 'ru'},
  document:{readyState:'loading',documentElement:{getAttribute:()=> 'ru'},addEventListener:()=>{}}
};
vm.createContext(context);
vm.runInContext(locales,context);
vm.runInContext(i18n,context);
assert.equal(context.window.muiT('nav.inbounds'),'Входящие');
assert.equal(context.window.muiT('nav.light'),'Светлая');
assert.equal(context.window.muiT('nav.dark'),'Тёмная');
assert.equal(context.window.muiT('nav.ultraDark'),'Очень тёмная');
// Execute the actual theme handlers with a small DOM stub.
const script=html.slice(html.indexOf('    function syncThemeChoices('),html.indexOf('    /* ===== 侧边栏：底部 48px',html.indexOf('    function applyTheme(')));
const handlers=html.slice(html.indexOf("    $('#theme-toggle').onclick="),html.indexOf("    $('#sidebar-logout').onclick=",html.indexOf("    $('#theme-toggle').onclick=")));
const attrs={},stored={},callbacks={};
const bodyClasses=new Set();
const mk=(choice)=>({
  dataset:{themeChoice:choice},
  attributes:{},
  setAttribute(k,v){this.attributes[k]=v},
  focus(){this.focused=true}
});
const light=mk('light'),dark=mk('dark'),ultra=mk('ultra'),trigger=mk();
const skinNames=['graphite','midnight','ivory','emerald','aurora'];
const skins=skinNames.map(choice=>({...mk(choice),dataset:{skinChoice:choice}}));
const choices=[light,dark,ultra,...skins];
const menu={hidden:true,querySelector(sel){
  if(sel.includes('aria-checked'))return choices.find(b=>b.attributes['aria-checked']==='true');
  return light;
}};
const wrapper={classList:{add(){},remove(){}},contains(target){return [trigger,menu,...choices].includes(target)}};
const root={setAttribute(k,v){attrs[k]=v},removeAttribute(k){delete attrs[k]},getAttribute(k){return attrs[k]??null}};
const fakeDocument={
  documentElement:root,
  body:{classList:{toggle(c,v){if(v)bodyClasses.add(c);else bodyClasses.delete(c)},contains(c){return bodyClasses.has(c)}}},
  addEventListener(type,callback){callbacks[type]=callback}
};
const nodes={'#top-theme-control':wrapper,'#top-theme-menu':menu,'#theme-toggle':trigger};
const state={
  window:{},document:fakeDocument,
  localStorage:{getItem:k=>stored[k]??null,setItem:(k,v)=>{stored[k]=v},removeItem:k=>{delete stored[k]}},
  '$':sel=>sel==='#top-theme-menu [aria-checked="true"]'
    ? choices.find(button=>button.attributes['aria-checked']==='true')
    : sel==='#top-theme-menu [data-theme-choice="light"]' ? light : nodes[sel],
  '$$':sel=>sel==='[data-theme-choice]'?[light,dark,ultra]:sel==='[data-skin-choice]'?skins:[],
  setTimeout:()=>1,clearTimeout:()=>{},console
};
vm.createContext(state);
vm.runInContext(fs.readFileSync('web/color-skins.js','utf8'),state);
vm.runInContext(script+handlers,state);
vm.runInContext('applyTheme(true,false)',state);
assert.equal(stored['mui-theme'],'dark');
assert.equal(stored['mui-is-ultra-dark'],'false');
assert.equal(light.attributes['aria-checked'],'false');
assert.equal(dark.attributes['aria-checked'],'true');
assert.equal(ultra.attributes['aria-checked'],'false');
trigger.onclick();
assert.equal(menu.hidden,false);
assert.equal(trigger.attributes['aria-expanded'],'true');
ultra.onclick();
assert.equal(attrs['data-theme'],'ultra-dark');
assert.equal(stored['mui-is-ultra-dark'],'true');
assert.equal(menu.hidden,true);
trigger.onclick();
assert.equal(ultra.focused,true);
callbacks.keydown({key:'Escape',preventDefault(){}});
assert.equal(menu.hidden,true);
trigger.onclick();
callbacks.pointerdown({target:{}});
assert.equal(menu.hidden,true);
trigger.onclick();
dark.onclick();
assert.equal('data-theme' in attrs,false);
assert.equal(stored['mui-is-ultra-dark'],'false');
trigger.onclick();
light.onclick();
assert.equal(bodyClasses.has('dark'),false);
assert.equal(stored['mui-theme'],'light');
assert.equal(stored['mui-is-ultra-dark'],'false');
assert.equal('data-theme' in attrs,false);
assert.equal(light.attributes['aria-checked'],'true');
assert.equal(dark.attributes['aria-checked'],'false');
assert.equal(ultra.attributes['aria-checked'],'false');
trigger.onclick();
assert.equal(light.focused,true);
assert.equal(menu.hidden,false);
// Simulated reload restores the stored light mode and its selected checkmark.
vm.runInContext("applyTheme(localStorage.getItem('mui-theme')==='dark',localStorage.getItem('mui-is-ultra-dark')==='true')",state);
assert.equal(light.attributes['aria-checked'],'true');
dark.onclick();
assert.equal(bodyClasses.has('dark'),true);
assert.equal(dark.attributes['aria-checked'],'true');
console.log('PASS: light/dark/ultra themes, saved selection, reload, outside click/Escape and inbound label');

// The five named skins work as a separate UI-only layer, and the original
// Light/Dark/Ultra Dark preferences remain intact until explicitly changed.
const savedBefore=stored['mui-theme'];
for(const [index,name] of skinNames.entries()){
  trigger.onclick();
  skins[index].onclick();
  assert.equal(attrs['data-color-skin'],name);
  assert.equal(stored['mui-color-skin'],name);
  assert.equal(skins[index].attributes['aria-checked'],'true');
  assert.equal(choices.filter(b=>b.attributes['aria-checked']==='true').length,1);
  assert.equal(bodyClasses.has('dark'),name!=='ivory');
  assert.equal(stored['mui-theme'],savedBefore,'legacy preference must not be overwritten');
}
// Existing buttons clear the custom skin and restore the original preference.
trigger.onclick();
light.onclick();
assert.equal(attrs['data-color-skin'],undefined);
assert.equal(stored['mui-color-skin'],undefined);
assert.equal(light.attributes['aria-checked'],'true');
console.log('PASS: five additional named color skins and legacy preferences');
