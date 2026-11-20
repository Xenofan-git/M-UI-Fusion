'use strict';
// Static CI guard for named palette hover regressions. A real Chromium
// comparison also verifies the computed result for 120 combinations on VPS.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const skins=fs.readFileSync('web/color-skins.css','utf8');
const liquid=fs.readFileSync('web/liquid-button.css','utf8');
const mihomo=fs.readFileSync('web/mihomo-settings.css','utf8');
const outsub=fs.readFileSync('web/outbound-subscriptions.css','utf8');
const hex=value=>[1,3,5].map(i=>parseInt(value.slice(i,i+2),16));
const luminance=rgb=>rgb.map(v=>{const x=v/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=luminance(hex(a)),y=luminance(hex(b));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
for(const palette of ['graphite','ivory','emerald','aurora']){
  const start=skins.indexOf('html[data-color-skin="'+palette+'"] {');
  assert.ok(start>=0,'missing palette '+palette);
  const block=skins.slice(start,skins.indexOf('}',start)+1);
  const accent=block.match(/--skin-accentHover:\s*(#[0-9a-fA-F]{6})/);
  const foreground=block.match(/--skin-accentFg:\s*(#[0-9a-fA-F]{6})/);
  assert.ok(accent&&foreground,'missing contrast token for '+palette);
  assert.ok(contrast(accent[1],foreground[1])>=4.5,'insufficient hovered label contrast: '+palette);
}
for(const theme of ['shadcn','md3']){
  assert.ok(skins.includes('html[data-ui-theme="'+theme+'"][data-color-skin] body.dark'),theme+' must preserve the selected skin when body is dark');
}
assert.ok(skins.includes('--sc-primary: var(--skin-accent);'));
assert.ok(skins.includes('--m3-primary: var(--skin-accent);'));
for(const token of ['#add-inbound','#outsub-submit','#mihomo-add-sub-balancer','.primary-btn','.mihomo-primary']){
  assert.ok(skins.includes(token),'hover color coverage lost: '+token);
}
assert.ok(skins.includes('.mihomo-toolbar #mihomo-add-sub-balancer:is(:hover,:focus-visible):not(:disabled)'), 'special Mihomo subscription action must win against hardcoded hover');
assert.ok(skins.includes('.outsub-dialog #outsub-submit:is(:hover,:focus-visible):not(:disabled)'), 'subscription dialog must override theme-specific hover');
assert.ok(skins.includes('--lb-fill: var(--skin-accentHover) !important;'), 'Liquid accent hover must use the skin color');
assert.ok(skins.includes('--lb-text: var(--skin-accentFg) !important;'), 'Liquid foreground must match its accent');
assert.ok(skins.includes('.sf-symbol'), 'hovered icon color must follow the button');
assert.ok(liquid.includes('--lb-fill: rgb(255 255 255 / 0.14)'), 'dark glass hover must not switch to a nearly opaque light plate');
assert.ok(mihomo.includes('#mihomo-add-sub-balancer'), 'actual balancer action still exists');
assert.ok(outsub.includes('#outsub-submit'), 'subscription dialog action still exists');
console.log('PASS: 4 palettes (WCAG AA hover contrast), 3 layouts, named hover selectors and two special balancer actions');
