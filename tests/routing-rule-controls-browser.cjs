'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const src=fs.readFileSync('web/mihomo-settings.js','utf8');
const css=fs.readFileSync('web/mihomo-settings.css','utf8');
const start=src.indexOf('  function ruleIsEnabled(rule)');
const end=src.indexOf('  function targetOptions(',start);
assert.ok(start>0&&end>start,'routing control logic not found');
const chunk=src.slice(start,end);
const boot=[
 "const root=document.querySelector('#mihomo-settings-root');",
 "const $=selector=>document.querySelector(selector);",
 "const $$=(selector,context=document)=>Array.from(context.querySelectorAll(selector));",
 "const SF=icon=>String.fromCharCode();",
 "const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('\"','&quot;');",
 "const muiT=(key)=>({'mh.ruleEnabled':'Включить/выключить','mh.managedRuleSwitch':'Основные','mh.matchAlwaysOn':'Всегда включено','mh.dragPriority':'Перетащить для приоритета','mh.colRuleType':'ТИП','mh.colPayload':'УСЛОВИЯ','mh.colOutbound':'ИСХОДЯЩИЙ','mh.colOptions':'ОПЦИИ','mh.colActions':'ДЕЙСТВИЯ'})[key]||key;",
 "const windowMUI=window.MUIRuleLists={decode:()=>null};",
 "const ruleTypeDisplayLabel=type=>type==='MATCH'?'ВЕСЬ ОСТАЛЬНОЙ ТРАФИК':type;",
 "const ruleReadableType=rule=>ruleTypeDisplayLabel(rule.type);",
 "const ruleReadablePayload=rule=>rule.payload||'Все оставшиеся';",
 "const ruleHelpButton=()=>'';",
 "const basicsRuleRows=()=>[];",
 "const draft={routingRules:[",
 "  {id:'bank',type:'DOMAIN-SUFFIX',payload:'bank.ru',target:'DIRECT'},",
 "  {id:'geo',type:'GEOIP',payload:'RU',target:'Russia',noResolve:true},",
 "  {id:'social',type:'DOMAIN-SUFFIX',payload:'social.ru',target:'Russia'},",
 "  {id:'fallback',type:'MATCH',payload:'',target:'FOREIGN'}",
 "]};",
 "let dirty=false;",
 "const hideRuleHelp=()=>{};",
 "const ensureFinalMatch=()=>{};",
 "const markDirty=()=>{dirty=true;renderRules();};",
 "const openRuleModal=()=>{};",
 "const toast=()=>{};",
 "const muiConfirm=async()=>false;",
 chunk,
 "window.readRuleState=()=>({rules:draft.routingRules.map(r=>({...r})),dirty});",
 "window.tryMove=moveRuleTo;window.tryToggle=toggleRule;window.tryArrow=moveRule;",
 "window.debugPreviewState=()=>({id:draggedRuleID,source:dragSourceRow?.dataset.ruleRow,original:dragOriginalOrder});",
 "renderRules();"
].join('\n');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 let count=0;
 try{
   for(const width of [1280,390]){
     const page=await browser.newPage({viewport:{width,height:860}});
     page.on('pageerror',error=>{throw error;});

     await page.setContent('<!doctype html><html><head><style>:root{--line:#666;--line-strong:#888;--surface:#27293a;--surface-subtle:#333;--surface-hover:#556;--text:#fff;--text-strong:#fff;--muted:#bbb;--teal:#009B77;--skin-accent:#009B77;--table-hover:#445}body{background:#101422;color:#fff;margin:0}</style><style>'+css+'</style></head><body><div id="mihomo-settings-root"><section id="mihomo-rule-table"></section></div></body></html>');
     await page.addScriptTag({content:boot});
     const order=()=>page.evaluate(()=>window.readRuleState().rules.map(r=>r.id));
     const rules=()=>page.evaluate(()=>window.readRuleState().rules);
     const row=id=>page.locator('[data-rule-row="'+id+'"]');
     const toggle=id=>row(id).locator('[data-rule-toggle]');
     assert.deepEqual(await order(),['bank','geo','social','fallback']);
     assert.equal(await toggle('bank').isChecked(),true);
     assert.equal(await toggle('geo').isChecked(),true);
     assert.equal(await toggle('fallback').isChecked(),true);
     assert.equal(await toggle('fallback').isDisabled(),true);
     const matchSwitch=row('fallback').locator('.mihomo-rule-switch-locked');
     assert.equal(await matchSwitch.count(),1,'only MATCH has a padlocked switch');
     assert.equal(await matchSwitch.locator('.mihomo-rule-switch-padlock').count(),1);
     for(const id of ['bank','geo','social'])
       assert.equal(await row(id).locator('.mihomo-rule-switch-padlock').count(),0);
     const lockedPaint=await matchSwitch.evaluate(el=>{
       const track=getComputedStyle(el.querySelector('.mihomo-rule-switch-track'));
       const lock=el.querySelector('.mihomo-rule-switch-padlock');
       const thumb=getComputedStyle(el.querySelector('.mihomo-rule-switch-track'),'::after');
       return {track:track.backgroundColor,thumb:thumb.backgroundColor,
         lock:lock.getBoundingClientRect().width,lockColor:getComputedStyle(lock).color};
     });
     const activePaint=await row('bank').locator('.mihomo-rule-switch-track').evaluate(el=>getComputedStyle(el).backgroundColor);
     assert.notEqual(lockedPaint.track,activePaint,'locked MATCH must be gray, not emerald');
     assert(lockedPaint.lock>=11,'padlock must be visible within the switch');
     const disabledAppearance=await row('fallback').locator('.mihomo-rule-switch').evaluate(el=>{
       const native=el.querySelector('input'),track=el.querySelector('.mihomo-rule-switch-track');
       return {opacity:getComputedStyle(native).opacity,appearance:getComputedStyle(native).appearance,
         track:getComputedStyle(track).backgroundColor,checked:native.checked,disabled:native.disabled};
     });
     assert.equal(disabledAppearance.opacity,'0','native checkbox must not cover the custom track');
     assert.equal(disabledAppearance.appearance,'none','native checkbox appearance must be suppressed');
     assert.equal(disabledAppearance.checked,true,'MATCH always enabled');
     assert.equal(disabledAppearance.disabled,true,'MATCH cannot be disabled');
     // Every toggle is smaller and placed AFTER the action buttons, at the
     // same right edge of the Settings column (including locked MATCH).
     const togglePositions=await page.evaluate(()=>{
       return ['bank','geo','social','fallback'].map(id=>{
         const row=document.querySelector('[data-rule-row="'+id+'"]');
         const cell=row.querySelector('td:last-child');
         const controls=cell.querySelector('.mihomo-rule-controls');
         const toggle=controls.querySelector('.mihomo-rule-switch');
         const r=toggle.getBoundingClientRect(),c=cell.getBoundingClientRect();
         return {id,width:r.width,height:r.height,right:r.right,cellRight:c.right,
           last:controls.lastElementChild===toggle,
           cssMargin:getComputedStyle(toggle).marginLeft,
           check:toggle.querySelector('input').checked};
       });
     });
     for(const item of togglePositions){
       assert.equal(item.last,true,'switch must be last in Settings: '+item.id);
       assert.ok(item.width<=35&&item.width>=32,'switch width should be slightly smaller: '+JSON.stringify(item));
       assert.ok(item.height<=21&&item.height>=19,'switch height should be slightly smaller: '+JSON.stringify(item));
       assert.ok(item.cellRight-item.right<20,'switch must stay next to right-hand edge: '+JSON.stringify(item));
       assert.ok(Math.abs(item.right-togglePositions[0].right)<2,'switches must align vertically: '+JSON.stringify(togglePositions));
     }
     for(const id of ['bank','geo','social']){
       const first=row(id).locator('td').first();
       assert.equal(await first.locator('[data-rule-drag]').count(),1,'drag grip belongs to FIRST column: '+id);
       assert.equal(await row(id).locator('td').last().locator('[data-rule-drag]').count(),0,'no drag grip in actions: '+id);
       assert.equal(await first.locator('.mihomo-rule-priority-number').count(),1,'priority number beside grip: '+id);
     }
     assert.equal(await row('fallback').locator('td').first().locator('.mihomo-rule-locked').count(),1,'MATCH lock belongs to first column');
     assert.equal(await row('fallback').locator('[data-rule-drag]').count(),0,'MATCH drag handle must not exist');
     assert.equal(await row('fallback').locator('[data-rule-delete]').count(),0,'MATCH delete button must not exist');
     assert.equal(await row('fallback').locator('[data-rule-up]').isDisabled(),true);
     assert.equal(await row('fallback').locator('[data-rule-down]').isDisabled(),true);
     count++;
     // Actual Chromium pointer movement, not synthetic HTML DragEvents.
     const dragGrip=()=>row('bank').locator('[data-rule-drag]').boundingBox();
     const coords=async id=>{
       const rect=await row(id).boundingBox();return {x:rect.x+rect.width/2,y:rect.y+rect.height*0.82};
     };
     const grip=await dragGrip(),target=await coords('social');
     assert.ok(grip&&target);
     await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);
     await page.mouse.down();
     await page.mouse.move(grip.x+grip.width/2+12,grip.y+grip.height/2+4,{steps:5});
     await page.mouse.move(target.x,target.y,{steps:18});
     const held=await page.evaluate(()=>{
       const box=document.getElementById('mihomo-rule-table');
       const source=box.querySelector('[data-rule-row="bank"]');
       return {dom:[...box.querySelectorAll('[data-rule-row]')].map(r=>r.dataset.ruleRow),
         draft:window.readRuleState().rules.map(r=>r.id),
         translucent:source.classList.contains('mihomo-rule-preview'),
         opacity:getComputedStyle(source.querySelector('td')).opacity,
         ghost:document.querySelectorAll('.mihomo-rule-drag-ghost').length};
     });
     assert.deepEqual(held.dom,['geo','social','bank','fallback'],'preview should move real row before mouse release');
     assert.deepEqual(held.draft,['bank','geo','social','fallback'],'draft untouched while mouse held');
     assert.ok(held.translucent&&Number(held.opacity)<1&&held.ghost===1,'translucent row and floating label');
     await page.keyboard.press('Escape');
     await page.mouse.up();
     assert.deepEqual(await order(),['bank','geo','social','fallback'],'Escape returns to original order');
     assert.equal(await page.locator('.mihomo-rule-drag-ghost').count(),0,'floating label removed on cancel');
     count++;
     // Committing over MATCH inserts immediately BEFORE protected fallback.
     const grip2=await dragGrip(),match=await coords('fallback');
     await page.mouse.move(grip2.x+grip2.width/2,grip2.y+grip2.height/2);
     await page.mouse.down();
     await page.mouse.move(grip2.x+grip2.width/2+12,grip2.y+grip2.height/2+4,{steps:5});
     await page.mouse.move(match.x,match.y,{steps:15});
     const preview=await page.locator('[data-rule-row]').evaluateAll(rows=>rows.map(r=>r.dataset.ruleRow));
     assert.deepEqual(preview,['geo','social','bank','fallback'],'cannot preview after MATCH');
     await page.mouse.up();
     assert.deepEqual(await order(),preview,'release commits what was previewed');
     assert.equal((await rules()).at(-1).type,'MATCH');
     count++;
     await page.evaluate(()=>window.tryMove('bank','geo'));
     assert.deepEqual(await order(),['bank','geo','social','fallback']);
     await toggle('geo').uncheck();
     assert.equal((await rules()).find(r=>r.id==='geo').enabled,false);
     assert.equal((await rules()).find(r=>r.id==='geo').payload,'RU');
     assert.equal((await rules()).find(r=>r.id==='geo').noResolve,true);
     assert.equal(await row('geo').evaluate(r=>r.classList.contains('mihomo-rule-off')),true);
     count++;
     await row('bank').locator('[data-rule-down]').click();
     assert.deepEqual(await order(),['geo','bank','social','fallback']);
     assert.equal((await rules()).find(r=>r.id==='geo').enabled,false,'priority moving must not enable disabled rule');
     count++;
     await row('social').locator('[data-rule-up]').click();
     assert.deepEqual(await order(),['geo','social','bank','fallback']);
     count++;
     // Native mouse movement: the row previews where it will be dropped
     // before button release, and the draft is unchanged until mouseup.
     if(width===1280){
       const grip=await row('bank').locator('[data-rule-drag]').boundingBox();
       const destination=await row('geo').boundingBox();
       assert.ok(grip&&destination);
       await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);
       await page.mouse.down();
       await page.mouse.move(grip.x+grip.width/2+10,grip.y+grip.height/2-8,{steps:4});
       await page.mouse.move(destination.x+destination.width/2,destination.y+destination.height*.82,{steps:14});
       const held=await page.evaluate(()=>{
         const box=document.getElementById('mihomo-rule-table');
         const source=box.querySelector('[data-rule-row="bank"]');
         return {dom:[...box.querySelectorAll('[data-rule-row]')].map(r=>r.dataset.ruleRow),
           draft:window.readRuleState().rules.map(r=>r.id),
           translucent:source.classList.contains('mihomo-rule-preview'),
           opacity:getComputedStyle(source.querySelector('td')).opacity};
       });
       assert.deepEqual(held.dom,['geo','bank','social','fallback'],'live preview before release');
       assert.deepEqual(held.draft,['geo','social','bank','fallback'],'do not modify draft before release');
       assert.equal(held.translucent,true);
       assert.ok(Number(held.opacity)<1);
       await page.mouse.up();
       assert.deepEqual(await order(),['geo','bank','social','fallback'],'release commits preview');
       count++;
     }
     await page.evaluate(()=>window.tryMove('fallback','bank'));
     await page.evaluate(()=>window.tryMove('geo','fallback'));
     assert.equal((await order()).at(-1),'fallback','MATCH always last');
     assert.equal((await order()).at(-2),'geo','drop onto MATCH inserts just before it');
     count++;
     count++;
     await page.evaluate(()=>window.tryToggle('fallback',false));
     assert.equal((await rules()).find(r=>r.id==='fallback').enabled,undefined,'MATCH never disabled');
     count++;
     await toggle('geo').check();
     assert.equal((await rules()).find(r=>r.id==='geo').enabled,undefined,'on uses legacy enabled semantics');
     assert.equal((await page.evaluate(()=>window.readRuleState().dirty)),true);
     count++;
     await page.close();
   }
   console.log('PASS:',count,'Chromium rule switch, priority drag/arrows and MATCH fixed scenarios at desktop/mobile widths');
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1});
