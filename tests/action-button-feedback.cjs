'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const login=fs.readFileSync('web/login.html','utf8');
const panel=fs.readFileSync('web/index.html','utf8');
const css=fs.readFileSync('web/action-button-feedback.css','utf8');
const link='static/action-button-feedback.css?v=6';
for(const [name,html] of [['login',login],['panel',panel]]){
  const skin=html.indexOf('static/color-skins.css');
  const feedback=html.indexOf(link);
  assert(skin>=0&&feedback>skin&&feedback<html.indexOf('</head>'),name+' must load feedback after skin styles');
  assert.equal(html.split(link).length-1,1,name+' must load stylesheet exactly once');
}
assert(!login.includes('login-button-hover-legibility'),'old forced-white Login hover must be gone');
for(const button of ['#login-button','#mihomo-save','#save-settings','#save-credentials',
                     '#save-client','#save-inbound','#outsub-submit','.modal-footer button.primary-btn']){
  assert(css.includes(button),'missing press style for '+button);
}
for(const rule of ['--skin-accent','--skin-accentFg','linear-gradient(125deg',
                   ':hover:not(:disabled)',':active:not(:disabled)',
                   ':focus-visible',':disabled', 'translateY(1px) scale(.985)',
                   'box-shadow', '-webkit-text-fill-color', 'prefers-reduced-motion: reduce']){
  assert(css.includes(rule),'missing visual feedback '+rule);
}
assert(!css.includes('background: #ffffff')&&!css.includes('background: #000000'),
 'no pure white or black background is allowed on action buttons');
assert(!css.includes('setTimeout'),'visual transitions must not alter business logic or scheduling');
console.log('PASS Login and Save soft emerald press, per-theme ink, disabled/focus/reduced-motion, loaded last');
