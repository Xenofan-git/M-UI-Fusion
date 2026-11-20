const fs = require('fs');
const assert = require('assert/strict');
const { createHash } = require('crypto');
const sha256 = data => createHash('sha256').update(data).digest('hex');

const logo = fs.readFileSync('web/media/m-ui_logo.png');
const square = fs.readFileSync('web/media/m-ui_logo_square.png');
const favicon = fs.readFileSync('web/media/m-ui_favicon.png');

assert.equal(sha256(logo), 'ec6ed6bb90dbe74c185f121bd93d968c3b5d0646b48529b276fbc8ed3470a914',
 'main cat must be the user-selected first variant');
assert.equal(sha256(favicon), '1c5959939189f5a446e598a4ab8e07a1c0ea70c7c069fa494ee5203bf6f5b57f',
 'favicon must be the user-selected second variant');
assert.deepEqual(logo, square, 'legacy square logo uses the first, main variant');
assert.notDeepEqual(logo, favicon, 'favicon must differ from the main logo');
for (const [image, size] of [[logo,192],[favicon,64]]) {
 assert.deepEqual([...image.subarray(0,8)], [137,80,78,71,13,10,26,10]);
 assert.equal(image.readUInt32BE(16), size);
 assert.equal(image.readUInt32BE(20), size);
}
for (const file of ['web/index.html','web/login.html','web/subscription.html']) {
 const html=fs.readFileSync(file,'utf8');
 const ico='rel="icon" type="image/png" sizes="64x64" href="media/m-ui_favicon.png?v=14"';
 const apple='rel="apple-touch-icon" href="media/m-ui_logo.png?v=14"';
 assert.equal(html.split(ico).length-1,1,'favicon link must point to second cat: '+file);
 assert.equal(html.split(apple).length-1,1,'touch icon must point to first cat: '+file);
 assert.ok(!html.includes('m-ui_logo.png?v=13'),'old cache query in '+file);
}
const login=fs.readFileSync('web/login.html','utf8');
const index=fs.readFileSync('web/index.html','utf8');
assert.ok(login.includes('img src="media/m-ui_logo.png?v=14" alt="M-UI Fusion" width="96" height="96"'));
assert.ok(index.includes('class="sidebar-logo-img" src="media/m-ui_logo.png?v=14" alt="M-UI Fusion" width="60" height="60"'));
assert.ok(login.includes('object-fit: contain;'));
assert.ok(index.includes('object-fit: contain;'));
console.log('PASS: first cat in full UI, second cat in favicon; 2 distinct transparent PNGs and URLs');
