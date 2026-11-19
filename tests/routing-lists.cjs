const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const context={window:{}};
vm.createContext(context);
vm.runInContext(fs.readFileSync('web/mihomo-rule-lists.js','utf8'),context);
const lists=context.window.MUIRuleLists;
const catalog={geosite:['youtube','category-ru','google','telegram'],geoip:['ru','cn','google','telegram']};
const result=lists.compile('youtube\ncategory-ru\nru',
  'example.org\nfull:api.example.org\n192.0.2.12\n2001:db8::1',catalog,true);
assert.equal(result.type,'AND');
assert.equal(result.noResolve,false);
assert.ok(result.payload.includes('(GEOSITE,youtube)'));
assert.ok(result.payload.includes('(GEOSITE,category-ru)'));
assert.ok(result.payload.includes('(GEOIP,ru,no-resolve)'));
assert.ok(result.payload.includes('(DOMAIN-SUFFIX,example.org)'));
assert.ok(result.payload.includes('(DOMAIN,api.example.org)'));
assert.ok(result.payload.includes('(IP-CIDR,192.0.2.12/32,no-resolve)'));
assert.ok(result.payload.includes('(IP-CIDR6,2001:db8::1/128,no-resolve)'));
const parsed=lists.decode(result);
assert.ok(parsed);
assert.equal(parsed.noResolve,true);
assert.equal(parsed.count,7);
assert.equal(lists.compile(parsed.geos,parsed.domains,catalog,parsed.noResolve).payload,result.payload);
assert.equal(lists.decode({type:'AND',payload:'((IN-NAME,x),(OR,((GEOIP,ru),(GEOSITE,youtube))))'}),null);
assert.equal(lists.decode({type:'MATCH',payload:''}),null);
assert.equal(lists.decode({type:'GEOIP',payload:'ru'}),null);
assert.equal(lists.compile('youtube', '',catalog,true).type,'AND');
assert.equal(lists.displayCategoryName('geosite:youtube',catalog),'youtube');
assert.equal(lists.displayCategoryName('geosite:google',catalog),'geosite:google');
for(const geo of ['nonexistent','google','telegram']){
 assert.throws(()=>lists.compile(geo,'',catalog,true),/Категория/);
}
assert.ok(lists.compile('geosite:google\ngeoip:google','',catalog,true).payload.includes('(GEOIP,google,no-resolve)'));
for(const invalid of ['300.2.3.4','192.0.2.1/33','a..example','192.0.2.1,REJECT','not a domain']) {
 assert.throws(()=>lists.compile('',invalid,catalog,true),/(Неверн|Недопустим)/);
}
assert.throws(()=>lists.compile('','',catalog,true),/Добавьте/);
assert.throws(()=>lists.compile('youtube','',null,true),/не загружен/);
const withoutNoResolve=lists.compile('ru','192.0.2.0/24',catalog,false);
assert.ok(!withoutNoResolve.payload.includes('no-resolve'));
assert.equal(lists.decode(withoutNoResolve).noResolve,false);

// Do not mutate existing production logical rules when the new UI is opened.
const editor=fs.readFileSync('web/mihomo-settings.js','utf8');
assert.ok(editor.includes('const decoded=window.MUIRuleLists?.decode(item)'));
assert.ok(editor.includes("form.elements.type.value=decoded?'LIST':item.type"));
assert.ok(editor.includes("Object.assign(item,window.MUIRuleLists.compile("));
assert.ok(editor.includes('if(index>=0)draft.routingRules[index]=item;'));
assert.ok(editor.includes('function ruleReadablePayload(rule)'));
assert.ok(editor.includes('mihomo-geo-picker-modal'));
assert.ok(editor.includes('/api/mihomo/geo-categories'));
const html=fs.readFileSync('web/index.html','utf8');
assert.ok(html.includes('<script src="static/mihomo-rule-lists.js"></script>'));
assert.ok(html.indexOf('static/mihomo-rule-lists.js')<html.indexOf('static/mihomo-settings.js'));
const locale=fs.readFileSync('web/i18n.js','utf8');
assert.ok(locale.includes("'mh.colRuleType':'Тип правила'"));
assert.ok(locale.includes("'mh.colOutbound':'Исходящий'"));
console.log('PASS: Mihomo routing two-list editor, OR expression, round-trip, validation, legacy compatibility');
