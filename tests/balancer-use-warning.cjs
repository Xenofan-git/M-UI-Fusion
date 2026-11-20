const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync('web/mihomo-settings.js','utf8');
const locales=fs.readFileSync('web/i18n-locales.js','utf8');
const i18n=fs.readFileSync('web/i18n.js','utf8');
const css=fs.readFileSync('web/mihomo-settings.css','utf8');
function translate(lang){
  const context={
    window:{},localStorage:{getItem:()=>lang},
    document:{readyState:'loading',documentElement:{getAttribute:()=>lang},addEventListener:()=>{}}
  };
  vm.createContext(context);
  vm.runInContext(locales,context);
  vm.runInContext(i18n,context);
  return context.window.muiT;
}
for(const lang of ['zh-CN','zh-TW','en','ja','ru','fa','vi','es','tr','uk','pt-BR']){
  const t=translate(lang);
  assert.notEqual(t('mh.balancerInUseTitle'),'mh.balancerInUseTitle');
  assert.notEqual(t('mh.balancerGoToRules'),'mh.balancerGoToRules');
  assert.match(t('mh.balancerUsedSingle',{name:'Russia',rule:'GEOIP → Russia'}),/Russia/);
  assert.match(t('mh.balancerResolveMultiple',{name:'Russia'}),/Russia/);
}
assert.equal(translate('ru')('mh.balancerInUseTitle'),'Балансировщик используется');
assert.equal(translate('ru')('mh.balancerGoToRules'),'Перейти к правилам');
assert.match(css,/mui-balancer-use-backdrop/);
assert.match(css,/mui-balancer-use-icon/);
assert.match(css,/mihomo-dependent-rule/);
assert.match(code,/if\(item\.kind==='group'&&rules\.length&&rules\.length===dependencies\.length\)/);
assert.match(code,/showBalancerDependencyWarning\(item,rules\)/);
assert.match(code,/draft\.outbounds=draft\.outbounds\.filter/); // unchanged confirmation path
const start=code.indexOf('  function showBalancerDependencyWarning(item,rules){');
const end=code.indexOf('  async function deleteOutbound(id){',start);
assert.ok(start>0&&end>start,'warning function exists');

class Element{
  constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.handlers={};this.dataset={};this.classes=[];this.classList={add:x=>this.classes.push(x)};this.textContent='';this.parent=null;this.focused=false;}
  append(...args){for(const child of args)this.appendChild(child);}
  appendChild(child){this.children.push(child);child.parent=this;}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(k,cb){this.handlers[k]=cb;}
  remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);}
  focus(){this.focused=true;}
  scrollIntoView(){this.scrolled=true;}
  querySelector(q){return q==='[data-rule-edit]'?this.editButton:null;}
}
function runCase(rules,lang){
  const body=new Element('body');
  const oldFocus=new Element('button');
  const rows=Array.from({length:4},()=>new Element('tr'));
  rows.forEach(r=>r.editButton=new Element('button'));
  const document={
    activeElement:oldFocus,
    body,
    createElement:tag=>new Element(tag),
    addEventListener(){},
    removeEventListener(){},
    contains:el=>el===oldFocus
  };
  const draft={routingRules:[
    {id:'direct',type:'AND',target:'DIRECT'},
    {id:'r2',type:'AND',target:'Russia'},
    {id:'r3',type:'GEOIP',target:'Russia'},
    {id:'fallback',type:'MATCH',target:'FOREIGN'}
  ]};
  let nav='';
  const context={document,draft,muiT:translate(lang),requestAnimationFrame:cb=>cb(),setTab:v=>nav=v,
    $:()=>({children:rows}),basicsRuleRows:()=>[]};
  vm.createContext(context);
  vm.runInContext(code.slice(start,end)+'\nthis.showWarning=showBalancerDependencyWarning;',context);
  context.showWarning({name:'Russia',kind:'group'},rules);
  assert.equal(body.children.length,1,'warning must be centered in an actual backdrop');
  const backdrop=body.children[0];
  const panel=backdrop.children[0];
  assert.equal(panel.attributes.role,'alertdialog');
  assert.equal(panel.attributes['aria-modal'],'true');
  const header=panel.children[0],main=panel.children[1],footer=panel.children[2];
  assert.equal(header.children[0].textContent,'!');
  assert.match(main.children[0].textContent,/Russia/);
  if(rules.length===2){
    assert.equal(main.children[1].tag,'ul');
    assert.deepEqual(main.children[1].children.map(x=>x.textContent),['AND → Russia','GEOIP → Russia']);
    assert.match(main.children[2].textContent,/Russia/);
  }else{
    assert.equal(main.children.length,2);
    assert.match(main.children[0].textContent,/GEOIP → Russia/);
  }
  assert.equal(footer.children.length,2);
  assert.equal(body.children.length,1);
  assert.equal(nav,'','warning alone must never edit routes');
  footer.children[1].onclick();
  assert.equal(body.children.length,0,'modal closes');
  assert.equal(nav,'routing','route button opens the rules tab');
  const expectedIndices=rules.map(r=>draft.routingRules.findIndex(d=>d.id===r.id));
  for(const i of expectedIndices)assert.ok(rows[i].classes.includes('mihomo-dependent-rule'));
  assert.ok(rows[expectedIndices[0]].scrolled);
  assert.ok(rows[expectedIndices[0]].editButton.focused);
  return true;
}
runCase([{id:'r2',type:'AND',target:'Russia'},{id:'r3',type:'GEOIP',target:'Russia'}],'ru');
runCase([{id:'r3',type:'GEOIP',target:'Russia'}],'en');
console.log('PASS: blocking balancer modal, translations, warning icon, multi/single rules, safe navigation and highlighting');
