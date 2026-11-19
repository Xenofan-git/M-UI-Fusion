const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('web/login.html','utf8');
const themes=['web/theme-shadcn.css','web/theme-md3.css'].map(path=>fs.readFileSync(path,'utf8'));
assert.ok(html.includes('<h1 class="headline" data-word="title">Добро пожаловать</h1>'));
assert.equal((html.match(/<h1 class="headline"/g)||[]).length,1);
assert.ok(html.includes("document.querySelector('.headline').textContent = text.title;"));
assert.ok(!html.includes('rotateHeadline('));
assert.ok(!html.includes('words-wrapper'));
assert.ok(!html.includes('data-word="hello"'));
assert.match(html,/width: 96px;\s*height: 96px;/);
assert.ok(html.includes('alt="M-UI Fusion" width="96" height="96"'));
assert.ok(html.includes("ru: { pageTitle:'M-UI Fusion | Вход', title:'Добро пожаловать'"));
assert.ok(html.includes("en: { pageTitle:'M-UI Fusion | Log In', title:'Welcome'"));
for(const theme of themes){
 assert.ok(theme.includes('body .brand-icon { filter: none !important; width: 96px !important; height: 96px !important; }'));
}
console.log('PASS: single static localized welcome and 96px cat icon in all UI themes');
