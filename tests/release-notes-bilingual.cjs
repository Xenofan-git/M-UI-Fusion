'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const notes = fs.readFileSync('docs/RELEASE-NOTES.md', 'utf8');
const en = fs.readFileSync('docs/INSTALL.en.md', 'utf8');
const ru = fs.readFileSync('docs/INSTALL.ru.md', 'utf8');
const original = fs.readFileSync('docs/DEVELOPMENT-HISTORY.md', 'utf8');
const modalPrimaryNotes = fs.readFileSync('docs/releases/v1.0.8.md','utf8');
assert.match(modalPrimaryNotes, /^# M-UI Fusion 1\.0\.8/m);
assert.match(modalPrimaryNotes, /^## English$/m);
assert.match(modalPrimaryNotes, /^## Русский$/m);
assert.match(modalPrimaryNotes, /270 real Chromium checks/);
assert.match(modalPrimaryNotes, /WCAG AA/);
assert.match(modalPrimaryNotes, /Apply/);
assert.match(modalPrimaryNotes, /«Применить»/);
assert.match(modalPrimaryNotes, /No configuration migration/);
const ruleEditNotes = fs.readFileSync('docs/releases/v1.0.7.md','utf8');
assert.match(ruleEditNotes, /^# M-UI Fusion 1\.0\.7/m);
assert.match(ruleEditNotes, /^## English$/m);
assert.match(ruleEditNotes, /^## Русский$/m);
assert.match(ruleEditNotes, /GEOIP,RU/);
assert.match(ruleEditNotes, /No-Resolve/);
assert.match(ruleEditNotes, /\?v=107/);
const ruleAdvancedNotes = fs.readFileSync('docs/releases/v1.0.6.md','utf8');
assert.match(ruleAdvancedNotes, /^# M-UI Fusion 1\.0\.6/m);
assert.match(ruleAdvancedNotes, /^## English$/m);
assert.match(ruleAdvancedNotes, /^## Русский$/m);
assert.match(ruleAdvancedNotes, /no-resolve/);
assert.match(ruleAdvancedNotes, /14 real Chromium checks/);
assert.match(ruleAdvancedNotes, /No migration or configuration change/);
const activeFlagsNotes = fs.readFileSync('docs/releases/v1.0.5.md','utf8');
assert.match(activeFlagsNotes, /^# M-UI Fusion 1\.0\.5/m);
assert.match(activeFlagsNotes, /^## English$/m);
assert.match(activeFlagsNotes, /^## Русский$/m);
assert.match(activeFlagsNotes, /LV\/RU/);
assert.match(activeFlagsNotes, /SVG/);
assert.match(activeFlagsNotes, /presentation only/);
const mihomoHoverNotes = fs.readFileSync('docs/releases/v1.0.4.md','utf8');
assert.match(mihomoHoverNotes, /^# M-UI Fusion 1\.0\.4/m);
assert.match(mihomoHoverNotes, /^## English$/m);
assert.match(mihomoHoverNotes, /^## Русский$/m);
assert.match(mihomoHoverNotes, /480/);
assert.match(mihomoHoverNotes, /Routing Rules/);
assert.match(mihomoHoverNotes, /purely visual/);
const hoverNotes = fs.readFileSync('docs/releases/v1.0.3.md','utf8');
assert.match(hoverNotes, /^# M-UI Fusion 1\.0\.3/m);
assert.match(hoverNotes, /^## English$/m);
assert.match(hoverNotes, /^## Русский$/m);
assert.match(hoverNotes, /Liquid Glass/);
assert.match(hoverNotes, /120/);
assert.match(hoverNotes, /4,5:1/);
assert.match(hoverNotes, /Pure CSS\/visual change/);
const translationNotes = fs.readFileSync('docs/releases/v1.0.2.md','utf8');
assert.match(translationNotes, /^# M-UI Fusion 1\.0\.2/m);
assert.match(translationNotes, /^## English$/m);
assert.match(translationNotes, /^## Русский$/m);
assert.match(translationNotes, /630/);
assert.match(translationNotes, /925/);
assert.match(translationNotes, /ЦП: 4 ядра/);
assert.match(translationNotes, /No configuration migration/);
const patchNotes = fs.readFileSync('docs/releases/v1.0.1.md','utf8');
assert.match(patchNotes, /^# M-UI Fusion 1\.0\.1/m);
assert.match(patchNotes, /^## English$/m);
assert.match(patchNotes, /^## Русский$/m);
assert.match(patchNotes, /AND → Russia/);
assert.match(patchNotes, /GEOIP → Russia/);
assert.match(patchNotes, /--update --version v1\.0\.1/);
assert.match(patchNotes, /не удаляет и не изменяет правила/);

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
