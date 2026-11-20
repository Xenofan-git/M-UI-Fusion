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
assert.match(html,/width: 77px;\s*height: 77px;/);
assert.ok(html.includes('alt="M-UI Fusion" width="77" height="77"'));
assert.ok(html.includes("ru: { pageTitle:'M-UI Fusion | Вход', title:'Добро пожаловать'"));
assert.ok(html.includes("en: { pageTitle:'M-UI Fusion | Log In', title:'Welcome'"));
for(const theme of themes){
 assert.ok(theme.includes('body .brand-icon { filter: none !important; width: 77px !important; height: 77px !important; }'));
}
console.log('PASS: single static localized welcome and 77px cat icon in all UI themes');
