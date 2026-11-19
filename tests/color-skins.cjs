const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const css=fs.readFileSync('web/color-skins.css','utf8');
const moduleCode=fs.readFileSync('web/color-skins.js','utf8');
const index=fs.readFileSync('web/index.html','utf8');
const login=fs.readFileSync('web/login.html','utf8');
const extra=fs.readFileSync('web/i18n-locales.js','utf8');
const base=fs.readFileSync('web/i18n.js','utf8');
const skins=['graphite','midnight','ivory','emerald','aurora'];

function rgb(hex){
 assert.match(hex,/^#[0-9a-f]{6}$/);
 return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
  .map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
}
function luminance(hex){
 const c=rgb(hex);
 return .2126*c[0]+.7152*c[1]+.0722*c[2];
}
function contrast(a,b){
 const x=luminance(a),y=luminance(b);
 return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
for(const skin of skins){
 const pattern=new RegExp('html\\[data-color-skin="'+skin+'"\\] \\{([^}]+)\\}');
 const match=css.match(pattern);
 assert.ok(match,'missing palette '+skin);
 const tokens=Object.fromEntries([...match[1].matchAll(/--skin-([A-Za-z]+):\s*(#[0-9a-f]{6});/g)].map(m=>[m[1],m[2]]));
 for(const variable of ['bg','card','soft','hover','active','sidebar','modal','line','text','muted','accent','accentHover','accentFg','glow','focus'])
  assert.ok(tokens[variable],skin+' lacks '+variable);
 for(const backdrop of ['bg','card','soft']){
  assert.ok(contrast(tokens.text,tokens[backdrop])>=4.5,
    skin+' main text lacks contrast on '+backdrop);
  assert.ok(contrast(tokens.muted,tokens[backdrop])>=4.5,
    skin+' muted text lacks contrast on '+backdrop);
 }
 assert.ok(contrast(tokens.accentFg,tokens.accent)>=4.5,
    skin+' primary button text lacks contrast');
 assert.ok(index.includes('data-skin-choice="'+skin+'"'),'skin missing from main theme menu');
 assert.ok(login.includes('<option value="'+skin+'">'),'skin missing from login dropdown');
}
assert.equal(skins.filter(s=>s!=='ivory').length,4);
for(const page of [index,login]){
 assert.ok(page.includes('static/color-skins.css')&&page.includes('static/color-skins.js'));
 assert.ok(page.indexOf('static/color-skins.js')<page.indexOf('static/liquid-glass.css'));
 assert.ok(page.indexOf('static/color-skins.css')>page.indexOf('static/theme-md3.css'));
}
assert.ok(index.includes('role="menuitemradio" data-theme-choice="light"'));
assert.ok(index.includes('role="menuitemradio" data-theme-choice="dark"'));
assert.ok(index.includes('role="menuitemradio" data-theme-choice="ultra"'));
assert.match(css,/html\[data-ui-theme="shadcn"\]\[data-color-skin\] body/);
assert.match(css,/html\[data-ui-theme="md3"\]\[data-color-skin\] body/);
assert.match(css,/html\[data-color-skin\]\[data-ui-theme="liquid"\] body::before/);
assert.ok(css.includes('prefers-reduced-motion'));
for(const statusToken of ['--red:','--danger:','--orange:','--green:'])
 assert.ok(!css.includes(statusToken),'palette cannot alter status semantics: '+statusToken);

// Stored values are whitelisted and the UI does not touch any Mihomo settings.
const attributes={},data={};
const context={
  document:{documentElement:{
    setAttribute:(key,value)=>{attributes[key]=value},
    getAttribute:key=>attributes[key]??null,
    removeAttribute:key=>{delete attributes[key]}
  }},
  localStorage:{
    getItem:key=>data[key]??null,
    setItem:(key,value)=>{data[key]=value},
    removeItem:key=>{delete data[key]}
  },
  window:{}
};
vm.createContext(context);
vm.runInContext(moduleCode,context);
const API=context.window.MUIColorSkins;
assert.deepEqual(Array.from(API.all),skins);
assert.equal(API.current(),'');
for(const skin of skins){
 assert.equal(API.select(skin),skin);
 assert.equal(API.current(),skin);
 assert.equal(data['mui-color-skin'],skin);
 assert.equal(API.isDark(skin),skin!=='ivory');
}
assert.equal(API.select('bogus'),'');
assert.equal(API.current(),'');
assert.equal('mui-color-skin' in data,false);
data['mui-color-skin']='emerald';
delete attributes['data-color-skin'];
vm.runInContext(moduleCode,context);
assert.equal(attributes['data-color-skin'],'emerald','saved skin restores before paint');

const localeContext={window:{},localStorage:{getItem:()=> 'ru'},
 document:{readyState:'loading',documentElement:{getAttribute:()=> 'ru'},addEventListener(){}}};
vm.createContext(localeContext);
vm.runInContext(extra,localeContext);
vm.runInContext(base,localeContext);
assert.equal(localeContext.window.muiT('nav.skin.graphite'),'Графитовая');
assert.equal(localeContext.window.muiT('nav.skin.midnight'),'Полуночная');
assert.equal(localeContext.window.muiT('nav.skin.ivory'),'Слоновая кость');
assert.equal(localeContext.window.muiT('nav.skin.emerald'),'Изумрудная');
assert.equal(localeContext.window.muiT('nav.skin.aurora'),'Аврора');
for(const lang of ['zh-TW','tr','ru','fa','vi','es','ja','uk','pt-BR']){
 const map=localeContext.window.MUI_LOCALES[lang];
 for(const skin of skins){
  assert.ok(map['nav.skin.'+skin]?.trim(),lang+' missing '+skin);
 }
 assert.ok(map['nav.colorSkins']?.trim(),lang+' missing color label');
}
console.log('PASS: 5 accessible color skins, 3 layouts, login and panel, storage, 11 locales');
