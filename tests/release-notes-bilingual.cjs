'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const notes = fs.readFileSync('docs/RELEASE-NOTES.md', 'utf8');
const en = fs.readFileSync('docs/INSTALL.en.md', 'utf8');
const ru = fs.readFileSync('docs/INSTALL.ru.md', 'utf8');
const original = fs.readFileSync('docs/DEVELOPMENT-HISTORY.md', 'utf8');
const heading = notes.match(/^# M-UI Fusion (\d+\.\d+\.\d+)/m);
assert.ok(heading, 'Release notes require a semantic version heading');
const version = 'v'+heading[1];
assert.match(notes, /^## English$/m);
assert.match(notes, /^## Русский$/m);
assert.ok(notes.indexOf('## English') < notes.indexOf('## Русский'));
assert.match(notes, /Changes compared with the original m-ui v0\.3\.3/);
assert.match(notes, /по сравнению с исходником/);
for (const item of ['Sniffer', 'GeoSite/GeoIP', '100-ms tolerance', '100 мс',
  'Balancers from Outbounds','Балансировщики из Исходящих']) {
  assert.ok(notes.includes(item), 'Missing a release milestone: '+item);
}
for (const [name, doc] of [['notes',notes],['English guide',en],['Russian guide',ru]]) {
  for (const required of ['ssh USER@SERVER_IP','ssh -p SSH_PORT','ssh -J JUMP_USER@JUMP_HOST',
    'uname -m','--version '+version+' --listen-ip 127.0.0.1 --port 34567 --no-ssl',
    'ssh -N -L 127.0.0.1:34567:127.0.0.1:34567 USER@SERVER_IP',
    '--update --version '+version, 'SHA256SUMS', 'state.json', 'config.yaml']) {
    assert.ok(doc.includes(required), name+': required command/guard missing: '+required);
  }
  assert.ok(!doc.includes('192.168.4.26'), name+': no NanoPi-specific IPs in generic docs');
}
assert.match(notes, /docs\/INSTALL\.en\.md/);
assert.match(notes, /docs\/INSTALL\.ru\.md/);
assert.match(original, /v0\.3\.3-fusion\.39/);
assert.match(en, /Rollback|Roll back/i);
assert.match(ru, /Откат/);
assert.match(notes, /Inherited, not newly invented/);
assert.match(notes, /Унаследовано от исходного/);
console.log('PASS: bilingual release notes, upstream change stages, generic Linux SSH install, backup/rollback, documentation links');
