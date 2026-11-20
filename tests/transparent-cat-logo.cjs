const fs = require('fs');
const assert = require('assert/strict');
const { createHash }= require('crypto');
const image=fs.readFileSync('web/media/m-ui_logo.png');
const square=fs.readFileSync('web/media/m-ui_logo_square.png');
assert.equal(createHash('sha256').update(image).digest('hex'),
 'f5c1f2e2fea5a1397c131c1045efca7011e305ecfc6709c6f90d3be849e99673',
 'wrong cat artwork: expected the first generated variant with transparent crop');
assert.deepEqual(image,square,'all locations must use the same transparent cat');
assert.deepEqual([...image.subarray(0,8)],[137,80,78,71,13,10,26,10]);
assert.equal(image.readUInt32BE(16),192);
assert.equal(image.readUInt32BE(20),192);
for(const file of ['web/index.html','web/login.html','web/subscription.html']){
 const html=fs.readFileSync(file,'utf8');
 const ico='rel="icon" type="image/png" sizes="192x192" href="media/m-ui_logo.png?v=13"';
 const touch='rel="apple-touch-icon" href="media/m-ui_logo.png?v=13"';
 assert.equal(html.split(ico).length-1,1,file);
 assert.equal(html.split(touch).length-1,1,file);
 assert.ok(!html.includes('m-ui_logo.png?v=12'),file);
}
const login=fs.readFileSync('web/login.html','utf8');
const index=fs.readFileSync('web/index.html','utf8');
assert.ok(login.includes('img src="media/m-ui_logo.png?v=13" alt="M-UI Fusion" width="96" height="96"'));
assert.ok(index.includes('class="sidebar-logo-img" src="media/m-ui_logo.png?v=13" alt="M-UI Fusion" width="60" height="60"'));
function styleBlock(text,selector){
 const idx=text.indexOf(selector+' {');
 assert.ok(idx>=0,'missing CSS: '+selector);
 return text.slice(text.indexOf('{',idx)+1,text.indexOf('}',idx));
}
const loginBrand=styleBlock(login,'.brand-icon');
const loginImage=styleBlock(login,'.brand-icon img');
const sidebar=styleBlock(index,'.sidebar-logo');
const sidebarImage=styleBlock(index,'.sidebar-logo img,\n    .sidebar-logo-img');
for(const block of [loginBrand,sidebar]) {
 assert.ok(block.includes('background: transparent;'), 'logo container must not have a tile');
 assert.ok(block.includes('filter: none;'), 'logo container must not have dark shadow');
}
for(const block of [loginImage,sidebarImage]) {
 assert.ok(block.includes('object-fit: contain;'), 'mascot must never be cropped by CSS');
 assert.ok(block.includes('border-radius: 0;'));
}
console.log('PASS: first generated cat PNG, consistent transparent favicon/logo, no dark tile in UI');
