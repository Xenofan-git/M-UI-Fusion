'use strict';
// Static CI guard. Chromium tests also click nodes and measure Save contrast.
const fs=require('node:fs'),assert=require('node:assert/strict');
const js=fs.readFileSync('web/mihomo-settings.js','utf8');
const css=fs.readFileSync('web/color-skins.css','utf8');
const html=fs.readFileSync('web/index.html','utf8');
const i18n=fs.readFileSync('web/i18n-locales.js','utf8');
assert.ok(js.includes('function outboundTestUnavailableReason(item)'));
assert.ok(js.includes("(app.state?.state?.outbounds||[])"),'test active saved configuration, not draft');
const btn=js.match(/data-test-outbound[^\n]+/);
assert.ok(btn,'rendered node test button missing');
assert.ok(js.includes('paintOutboundTransientState(box,rows,showTraffic)'));
assert.ok(js.includes("button.classList.toggle('mihomo-test-running',testing)"),
 'Test must stay yellow while a delay check is pending');
assert.ok(css.includes('button.mihomo-icon[data-test-outbound].mihomo-test-running'),
 'pending Test button needs a visible yellow icon and frame');
assert.ok(css.includes('button.mihomo-icon.danger:not(:disabled)'),
 'delete icon must remain red instead of green');
assert.ok(css.includes('width:12px!important;height:12px!important'),
 'dialog scrollbars need a visible 12px track');
assert.ok(css.includes('background:#15b58a!important'),
 'hovered scrollbar thumb must be visibly green');
assert.ok(js.includes('button.disabled=!!reason'));
assert.ok(js.includes('outboundTestUnavailableReason(item)'));
assert.ok(!btn[0].includes('dirty||'),'a draft cannot block probing an existing node');
assert.ok(js.includes("api('/api/mihomo/outbound/delay'"));
assert.ok(js.includes("if(!item||outboundTestUnavailableReason(item))return"));
assert.ok(i18n.includes('"mh.testUnavailable": "Этот исходящий не поддерживает проверку задержки"'));
assert.ok(css.includes('#mihomo-settings-root .mihomo-actionbar #mihomo-save:is(:hover,:focus-visible):not(:disabled)'),'Save hover must be legible');
assert.ok(css.includes('#mihomo-settings-root .mihomo-actionbar #mihomo-save:disabled'),'disabled Save must remain visible');
assert.ok(html.includes('static/color-skins.css?v=116'));
assert.ok(html.includes('static/mihomo-settings.js?v=132'));
console.log('PASS: saved outbounds testable with dirty draft, unsupported nodes blocked, Save visible');
