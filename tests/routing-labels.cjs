const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('web/mihomo-settings.js', 'utf8');
const locales = fs.readFileSync('web/i18n-locales.js', 'utf8');
const i18n = fs.readFileSync('web/i18n.js', 'utf8');
const newButton = 'Выбрать категорию из списка';
const noResolve = 'No-Resolve — не выполнять DNS-разрешение при проверке правила';

assert.equal(source.split('data-i18n="mh.chooseGeoCategories">'+newButton).length-1, 2,
  'both category picker button and dialog title must use the new label');
assert.ok(source.includes('<span data-i18n="mh.noResolveLabel">No-Resolve — Не выполнять DNS-разрешение при проверке правила</span>'),
  'the no-resolve checkbox should have a localized visible text span');
assert.ok(source.includes('name="noResolve" type="checkbox"'),
  'the existing noResolve checkbox must be preserved');
assert.ok(!source.includes('data-i18n-multi="mh.noResolveLabel"'),
  'avoid dynamic mixed-script text for the label');

function getTranslation(language, key) {
  const context = {
    window: {},
    localStorage: {getItem:()=>language},
    document: {
      readyState:'loading',
      documentElement:{getAttribute:()=>language},
      addEventListener:()=>{},
    },
  };
  vm.createContext(context);
  vm.runInContext(locales,context);
  vm.runInContext(i18n,context);
  return context.window.muiT(key);
}
assert.equal(getTranslation('ru','mh.chooseGeoCategories'),newButton);
assert.equal(getTranslation('ru','mh.noResolveLabel'),noResolve);
assert.equal(getTranslation('en','mh.chooseGeoCategories'),'Choose from list');
assert.equal(getTranslation('en','mh.noResolveLabel'),
  'No-Resolve — do not perform DNS lookups for this rule');
assert.ok(source.includes('ruleHelpButton(\'no-resolve\')'),'No-Resolve has an info icon');
console.log('PASS: localized No-Resolve label, routing button, modal title and info icon');
