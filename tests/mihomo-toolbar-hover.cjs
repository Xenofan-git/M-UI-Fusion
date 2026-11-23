'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const markup=fs.readFileSync('web/index.html','utf8');
const css=fs.readFileSync('web/color-skins.css','utf8');
const palettes=['graphite','ivory','emerald','aurora'];
const controls=['mihomo-add-outbound','mihomo-add-balancer','mihomo-add-sub-balancer','mihomo-add-rule'];
for(const id of controls){
  const m=markup.match(new RegExp('<button\\b[^>]*\\bid="'+id+'"[^>]*>'));
  assert.ok(m,'Missing visible toolbar button '+id);
  assert.match(m[0],/class="mihomo-primary"/);
}
assert.match(markup, /static\/color-skins\.css\?v=115/, 'cache-busting for existing browsers');
const block=css.slice(css.indexOf('/* v1.0.4: Mihomo toolbar primary actions'));
assert.ok(block.length>2000,'toolbar override block must exist');
for(const token of ['#mihomo-settings-root','.mihomo-toolbar > button.mihomo-primary',
                    '--skin-accentHover','--skin-accentFg','--sc-primary-fg','--m3-on-primary',
                    '-webkit-text-fill-color','background: var(--skin-accentHover) !important;']){
 assert.ok(block.includes(token),'missing toolbar hover fallback '+token);
}
assert.ok(!/\b(?:background|border-color|color|fill):\s*color-mix\(/.test(block),'toolbar fallback declarations must work on Chrome 109');
const getcolor=(palette,token)=>{
 const start=css.indexOf('html[data-color-skin="'+palette+'"] {');
 assert.ok(start>=0);
 return css.slice(start,css.indexOf('}',start)).match(new RegExp('--skin-'+token+':\\s*(#[0-9a-fA-F]{6})'))?.[1];
};
function luminance(color){
 const components=color.match(/[a-f0-9]{2}/ig).map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
 return .2126*components[0]+.7152*components[1]+.0722*components[2];
}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
for(const p of palettes)for(const t of ['accent','accentHover']){
 assert.ok(contrast(getcolor(p,t),getcolor(p,'accentFg'))>=4.5,p+': '+t+' contrast too weak');
}
console.log('PASS: exact four Mihomo toolbar button IDs, old-Chrome fallback, cache buster and named-skin contrast');
