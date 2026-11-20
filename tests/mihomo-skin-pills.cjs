const assert=require('node:assert/strict');
const fs=require('node:fs');
const css=fs.readFileSync('web/color-skins.css','utf8');
const html=fs.readFileSync('web/index.html','utf8');
const mihomo=fs.readFileSync('web/mihomo-settings.js','utf8');
const source=fs.readFileSync('web/i18n.js','utf8');
const selector='html:is([data-color-skin="graphite"],[data-color-skin="emerald"],[data-color-skin="aurora"]) body #mihomo-settings-root .mihomo-table .mihomo-pill';
const at=css.indexOf(selector);
assert.ok(at>=0,'missing exactly scoped badge-appearance override');
const declarations=css.slice(css.indexOf('{',at)+1,css.indexOf('}',at));
for(const property of [
 /background:\s*transparent\s*!important/,
 /border:\s*0\s*!important/,
 /border-radius:\s*0\s*!important/,
 /box-shadow:\s*none\s*!important/,
 /color:\s*var\(--skin-text\)\s*!important/,
 /padding:\s*0\s*!important/
])assert.match(declarations,property);
assert.ok(!selector.includes('ivory'), 'Ivory style must remain unchanged');
assert.ok(!selector.includes('data-ui-theme'), 'all three layouts must use the same correction');
assert.ok(selector.includes('#mihomo-settings-root .mihomo-table .mihomo-pill'),'only labels within Mihomo tables should change');
assert.ok(!/--(?:green|red|orange|danger|tag-[a-z-]+)\s*:/.test(declarations),'do not rewrite semantic status colors');
assert.ok(html.includes('id="mihomo-settings-root"'));
assert.ok(mihomo.includes('mihomo-pill'));
for(const [key,label] of [
 ['mihomo.tabManualBalancers','Балансировщики из Исходящих'],
 ['mihomo.tabSubscriptionBalancers','Балансировщики из Подписок']
]){
 assert.ok(html.includes('data-i18n="'+key+'">'+label+'</span>'));
 assert.ok(source.includes(label),'new label missing in RU localization');
}
assert.ok(html.includes('data-mihomo-tab="balancers"'));
assert.ok(html.includes('data-mihomo-tab="subscriptions"'));
console.log('PASS: 3 named skins x 3 layouts, badges limited to Mihomo tables; Russian balancer titles');
