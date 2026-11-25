'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const css=fs.readFileSync('web/mihomo-settings.css','utf8');
const html=fs.readFileSync('web/index.html','utf8');
assert(html.includes('static/mihomo-settings.css?v=135'));
const must=[
  /\.mihomo-tab\{[\s\S]*?font-size:14\.5px;font-weight:470;/,
  /\.mihomo-tab\{[\s\S]*?padding:8px 17px;/,
  /\.mihomo-tabs \.mihomo-tab-icon\{[\s\S]*?width:29px;height:29px;/,
  /\.mihomo-tabs \.mihomo-tab-icon \.mihomo-tab-glyph\{[\s\S]*?width:20px;height:20px;/,
  /@media\(max-width:760px\)\{[\s\S]*?\.mihomo-tab\{flex:1 1 auto;justify-content:center;padding:9px 11px;font-size:13\.5px\}/,
  /\.fbs-tab\{[\s\S]*?padding:9px 17px;[\s\S]*?font-size:14px;font-weight:500;/,
  /\.fbs-tab-icon\{width:18px;height:18px;flex:none\}/
];
for(const pattern of must)assert(pattern.test(css),'missing expected tab sizing: '+pattern);
console.log('PASS Mihomo main tabs 14.5/13.5px, SVG 20px; filter buttons 14px, SVG 18px; CSS cache-busted');
