'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const login=fs.readFileSync('web/login.html','utf8');
const dashboard=fs.readFileSync('web/index.html','utf8');
const i18n=fs.readFileSync('web/i18n.js','utf8');
const backend=fs.readFileSync('internal/app/main.go','utf8');
const api=fs.readFileSync('internal/app/i18n.go','utf8');
const logs=fs.readFileSync('internal/app/i18n_panel_logs.go','utf8');
assert.match(backend,/defaultLanguage\s+=\s+"ru"/,'new panel installations must start in Russian');
assert.match(backend,/sourceMessageLanguage\s+=\s+"zh-CN"/,'old Chinese source catalog must still translate');
assert(api.includes('language == sourceMessageLanguage'));
assert(logs.includes('language == sourceMessageLanguage'));
for(const html of [login,dashboard]){
 assert(html.includes('<html lang="ru" data-default-language="ru"'));
 assert(html.includes('data-l10n-pending="1"'));
}
assert(login.includes("const language = document.documentElement.dataset.defaultLanguage || 'ru'"));
assert(!login.includes("language = localStorage.getItem('mui-language') || language"));
assert(login.includes("applyLanguage(document.documentElement.dataset.defaultLanguage || 'ru')"));
assert(login.includes('root.dataset.defaultLanguage = lang'));
assert(i18n.includes('var value = injected || stored || \'ru\''));
assert(i18n.includes("document.documentElement.setAttribute('data-default-language', next)"));
assert(dashboard.includes('static/i18n.js?v=123'));
assert(dashboard.includes('data-i18n="topbar.refresh">Обновить'));
assert(!dashboard.includes('<span>刷新状态</span>'));
assert(dashboard.includes('id="sidebar-logout"'));
console.log('PASS Russian server-first language, backend defaults and source translation, stale-cache precedence and static HTML');
