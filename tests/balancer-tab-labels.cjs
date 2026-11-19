const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('web/index.html', 'utf8');
const css = fs.readFileSync('web/mihomo-settings.css', 'utf8');
const locales = fs.readFileSync('web/i18n-locales.js', 'utf8');
const core = fs.readFileSync('web/i18n.js', 'utf8');
const expected = {
  ru: ['Балансировщики-исходящие', 'Балансировщики-Подписки'],
  en: ['Outbound Balancers', 'Subscription Balancers'],
  'zh-CN': ['出站均衡器', '订阅均衡器'],
  'zh-TW': ['出站平衡器', '訂閱平衡器'],
  fa: ['متعادل‌سازهای خروجی', 'متعادل‌سازهای اشتراک'],
  tr: ['Giden Dengeleyicileri', 'Abonelik Dengeleyicileri'],
  vi: ['Bộ cân bằng đầu ra', 'Bộ cân bằng thuê bao'],
  es: ['Balanceadores de salida', 'Balanceadores de suscripciones'],
  ja: ['アウトバウンドのバランサー', 'サブスクリプションのバランサー'],
  uk: ['Балансувальники виходів', 'Балансувальники підписок'],
  'pt-BR': ['Balanceadores de saída', 'Balanceadores de assinaturas'],
};
for (const [tab, key, text] of [
  ['balancers', 'mihomo.tabManualBalancers', expected.ru[0]],
  ['subscriptions', 'mihomo.tabSubscriptionBalancers', expected.ru[1]],
]) {
  const match = html.match(new RegExp('data-mihomo-tab="'+tab+'"([\\s\\S]*?)</button>'));
  assert.ok(match, 'missing '+tab+' tab');
  assert.ok(match[1].includes('<svg'), 'tab SVG icon must be preserved');
  assert.ok(match[1].includes('data-i18n="'+key+'">'+text+'</span>'),
    'tab label must be separately translatable without replacing its SVG');
}
const outboundTab = html.match(/data-mihomo-tab="outbounds"([\s\S]*?)<\/button>/);
assert.ok(outboundTab && outboundTab[1].includes('data-i18n="mihomo.tabOutbounds">Исходящие</span>'),
  'Outbounds must have a localized Russian source label with original tab ID');
assert.ok(css.includes('.mihomo-tab-label{white-space:nowrap}'));
for (const [lang, strings] of Object.entries(expected)) {
  const context = {
    window: {},
    localStorage: {getItem:()=>lang},
    document: {
      readyState:'loading',
      documentElement:{getAttribute:()=>lang},
      addEventListener:()=>{},
    },
  };
  vm.createContext(context);
  vm.runInContext(locales, context);
  vm.runInContext(core, context);
  assert.equal(context.window.muiT('mihomo.tabManualBalancers'), strings[0], lang);
  assert.equal(context.window.muiT('mihomo.tabSubscriptionBalancers'), strings[1], lang);
  if(lang==='ru') assert.equal(context.window.muiT('mihomo.tabOutbounds'), 'Исходящие');
  if(lang==='en') assert.equal(context.window.muiT('mihomo.tabOutbounds'), 'Outbounds');
}
console.log('PASS: 11 tab label locales, Russian boot HTML, preserved SVG, unchanged tab IDs');
