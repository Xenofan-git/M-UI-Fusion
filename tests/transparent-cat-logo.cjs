const fs = require('fs');
const assert = require('assert/strict');
const { createHash } = require('crypto');
const sha256 = data => createHash('sha256').update(data).digest('hex');

const logo = fs.readFileSync('web/media/m-ui_logo.png');
const square = fs.readFileSync('web/media/m-ui_logo_square.png');
const favicon = fs.readFileSync('web/media/m-ui_favicon.png');

assert.equal(sha256(logo), '46ca7281db066a017568f67e074d8f30d78ca2ad91780f44d5da3f6eb398da05',
 'main cat must use the latest approved bright thin-outline original');
assert.equal(sha256(favicon), 'cfab3bd2c2abdf5d3baee96447ad6de28aeffab58c615fe426e6416f6079b3ae',
 'favicon must use the same latest approved mascot, resized to 64');
assert.deepEqual(logo, square, 'legacy square logo uses the latest approved mascot');
assert.notDeepEqual(logo, favicon, 'favicon must differ in resolution from the main logo');
for (const [image, size] of [[logo,192],[favicon,64]]) {
 assert.deepEqual([...image.subarray(0,8)], [137,80,78,71,13,10,26,10]);
 assert.equal(image.readUInt32BE(16), size);
 assert.equal(image.readUInt32BE(20), size);
}
for (const file of ['web/index.html','web/login.html','web/subscription.html']) {
 const html=fs.readFileSync(file,'utf8');
 const ico='rel="icon" type="image/png" sizes="64x64" href="media/m-ui_favicon.png?v=15"';
 const apple='rel="apple-touch-icon" href="media/m-ui_logo.png?v=15"';
 assert.equal(html.split(ico).length-1,1,'favicon link must point to resized approved cat: '+file);
 assert.equal(html.split(apple).length-1,1,'touch icon must point to full-sized approved cat: '+file);
 assert.ok(!html.includes('m-ui_logo.png?v=13'),'old cache query in '+file);
}
const login=fs.readFileSync('web/login.html','utf8');
const index=fs.readFileSync('web/index.html','utf8');
assert.ok(login.includes('img src="media/m-ui_logo.png?v=15" alt="M-UI Fusion" width="96" height="96"'));
assert.ok(index.includes('class="sidebar-logo-img" src="media/m-ui_logo.png?v=15" alt="M-UI Fusion" width="60" height="60"'));
assert.ok(login.includes('object-fit: contain;'));
assert.ok(index.includes('object-fit: contain;'));
console.log('PASS: same approved cat in UI and favicon, transparent and separately sized');
