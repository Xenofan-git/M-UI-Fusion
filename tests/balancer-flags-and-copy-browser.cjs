'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require('playwright-core');
const web=path.resolve(__dirname,'../web');
const source=fs.readFileSync(path.join(web,'mihomo-balancer-servers.js'),'utf8');
const cache=fs.readFileSync(path.join(web,'index.html'),'utf8');
assert(cache.includes('static/mihomo-balancer-servers.js?v=132'));
const debug=source.replace(/\}\)\(\);\s*$/,'window.__fbsDebug={refreshStatus,renderRows};})();');
assert(debug!==source,'test instrumentation missing');
const file=path.join(web,'.balancer-flags-copy-regression.html');
const html='<!doctype html><html><head><meta charset="utf-8">'+
 '<link rel="stylesheet" href="mihomo-settings.css"><style>:root{--muted:#8896a8;--text-strong:#f3f5fb}</style></head><body class="dark">'+
 '<form id="fake-editor"><label class="mihomo-field"><span>Серверы подписки</span>'+
 '<select name="proxies" multiple>'+
 '<option value="quatro-vpn | LTE - Россия" selected>RU</option>'+
 '<option value="quatro-vpn | LTE - Польша" selected>PL</option>'+
 '</select></label></form>'+
 '<script src="country-flags.js"></script></body></html>';
(async()=>{
 fs.writeFileSync(file,html);
 let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.MUI_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--allow-file-access-from-files']});
  for(const width of [390,1440]){
   const page=await browser.newPage({viewport:{width,height:900}});
   const pageErrors=[];
   page.on('pageerror',e=>pageErrors.push(e.message));
   await page.goto(pathToFileURL(file).href);
   await page.evaluate(()=>{
    window.__serverCalls=0;
    window.__pollIntervals=[];
    const originalSetInterval=window.setInterval;
    window.setInterval=(callback,ms)=>{
      window.__pollIntervals.push({callback,ms});
      return originalSetInterval(callback,ms);
    };
    window.__forceHidden=false;
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__forceHidden});
    window.fetch=async()=>{
      window.__serverCalls++;
      return {ok:true,json:async()=>({data:{
       candidate:'quatro-vpn | LTE - Россия',available:true,
       nodes:[
        {name:'quatro-vpn | LTE - Россия',countryCode:'RU',protocol:'vless',member:true,alive:true,delay:24+window.__serverCalls,ping:3},
        {name:'quatro-vpn | LTE - Польша',countryCode:'PL',protocol:'vless',member:true,alive:true,delay:55,ping:6}
       ]
      }})};
    };
   });
   await page.addScriptTag({content:debug});
   await page.evaluate(()=>{
     const form=document.querySelector('#fake-editor');
     const nodes=['Россия','Польша'].map((country,i)=>({
       id:'managed'+i,kind:'proxy',type:'vless',
       sourceSubscriptionId:'sub1',name:'quatro-vpn | LTE - '+country
     }));
     window.MUIBalancerServers.attach({
       form,group:{id:'group',name:'Foreign-quatro-vpn',kind:'group',type:'url-test',proxies:nodes.map(n=>n.name),subscriptionIds:['sub1']},
       subs:[{id:'sub1',name:'quatro-vpn',group:'Foreign-quatro-vpn',enabled:true,intervalMinutes:1440}],
       outbounds:nodes,updateDefaults:()=>{},isDirty:()=>false,persistedName:'Foreign-quatro-vpn'
     });
   });
   await page.waitForFunction(()=>document.querySelector('.fbs-status')?.textContent==='Состояние Mihomo обновлено');
   assert.deepEqual(await page.evaluate(()=>window.__pollIntervals.map(i=>i.ms)),[500,60000],
     '60-second network status timer plus local 500ms diagnostic watchdog (no network until USA input)');
   const initialCalls=await page.evaluate(()=>window.__serverCalls);
   assert.equal(initialCalls,1,'opening a balancer must fetch status immediately');
   // An invisible browser tab or hidden modal must not send background requests.
   await page.evaluate(()=>{window.__forceHidden=true;window.__pollIntervals.find(i=>i.ms===60000).callback();document.dispatchEvent(new Event('visibilitychange'));});
   assert.equal(await page.evaluate(()=>window.__serverCalls),initialCalls,'background status requests must stop');
   await page.evaluate(()=>{window.__forceHidden=false;document.dispatchEvent(new Event('visibilitychange'));});
   await page.waitForFunction(()=>window.__serverCalls===2);
   // Never pile up overlapping status requests during a stalled response.
   const beforeOverlap=await page.evaluate(()=>window.__serverCalls);
   await page.evaluate(async()=>{
     window.__serverDelay=null;
     const oldFetch=window.fetch;
     window.__baseFetch=oldFetch;
     window.fetch=async(...args)=>{
       await new Promise(resolve=>{window.__serverDelay=resolve;});
       return oldFetch(...args);
     };
     window.__pollIntervals.find(i=>i.ms===60000).callback();
     window.__pollIntervals.find(i=>i.ms===60000).callback();
     window.__pollIntervals.find(i=>i.ms===60000).callback();
   });
   // A pending status request is one request even if many polls fire.
   assert.equal(await page.evaluate(()=>window.__serverCalls),beforeOverlap);
   await page.evaluate(()=>window.__serverDelay());
   await page.waitForFunction(n=>window.__serverCalls===n+1,beforeOverlap);
   await page.evaluate(()=>{window.fetch=window.__baseFetch;});
   assert.equal(await page.locator('.fbs-tab .fbs-tab-icon').count(),2);
   assert.equal((await page.locator('.fbs-tab').first().innerText()).trim(),'Обновление');
   assert.equal((await page.locator('.fbs-tab').nth(1).innerText()).trim(),'Фильтры');
   assert.equal(await page.locator('.fbs-table-body > tr[data-node]').count(),2);
   for(const selector of ['.fbs-node-name','.fbs-candidate-label']){
     const selection=await page.locator(selector).first().evaluate(el=>{
       const style=getComputedStyle(el);
       const range=document.createRange();range.selectNodeContents(el);
       const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);
       const picked=sel.toString();sel.removeAllRanges();
       return {userSelect:style.userSelect,webkitUserSelect:style.webkitUserSelect,picked};
     });
     assert.equal(selection.userSelect,'text',JSON.stringify(selection));
     assert(selection.picked.length>0,'node text must be selectable');
   }
   // Actual mouse drag, not a synthetic range: the user must see the
   // selection and be able to issue ordinary Ctrl+C on an outbound name.
   const mark=await page.locator('.fbs-node-name').first().evaluate(el=>{
     const text=el.firstChild;
     const rectAt=(start,end)=>{
       const range=document.createRange();
       range.setStart(text,start);range.setEnd(text,end);
       const r=range.getBoundingClientRect();
       return {x:r.x,y:r.y,w:r.width,h:r.height};
     };
     return {begin:rectAt(0,1),end:rectAt(12,13)};
   });
   await page.mouse.move(mark.begin.x+1,mark.begin.y+mark.begin.h/2);
   await page.mouse.down();
   await page.mouse.move(mark.end.x+mark.end.w,mark.end.y+mark.end.h/2,{steps:12});
   await page.mouse.up();
   const copiedSelection=await page.evaluate(()=>window.getSelection().toString());
   assert(copiedSelection.length>=6,'mouse drag must visibly select the node name: '+JSON.stringify({mark,copiedSelection}));
   const selectionPaint=await page.locator('.fbs-node-name').first().evaluate(el=>{
     const css=getComputedStyle(el,'::selection');
     return {background:css.backgroundColor,foreground:css.color};
   });
   assert.equal(selectionPaint.background,'rgb(77, 214, 174)','selected text has bright teal background');
   assert.equal(selectionPaint.foreground,'rgb(7, 28, 24)','selected text is legible on bright background');
   await page.evaluate(()=>document.addEventListener('copy',()=>{window.__nameSelectedForCopy=window.getSelection().toString()}, {once:true}));
   await page.keyboard.press('Control+c');
   assert.equal(await page.evaluate(()=>window.__nameSelectedForCopy),copiedSelection,'Ctrl+C must copy selected node text');
   await page.evaluate(()=>window.getSelection().removeAllRanges());
   const normalTable=await page.evaluate(()=>{
     const cell=document.createElement('td');cell.className='mihomo-name';cell.textContent='Outgoing - example';
     const table=document.createElement('table');table.className='mihomo-table';table.append(cell);document.body.append(table);
     const value=getComputedStyle(cell).userSelect;table.remove();return value;
   });
   assert.equal(normalTable,'text','outgoing table node names must be selectable');
   assert.equal(await page.locator('.fbs-table-body .fbs-copy-flag').first().getAttribute('title'),'Просто нажмите на флаг, чтобы он скопировался для вставки в фильтр');
   await page.waitForFunction(()=>[...document.querySelectorAll('.fbs-node .fbs-flag img')].every(e=>e.complete&&e.naturalWidth>0));
   await page.evaluate(()=>{
     window.__row=document.querySelector('.fbs-table-body > tr');
     window.__rowFlag=window.__row.querySelector('.fbs-flag img');
     window.__candidateFlag=document.querySelector('.fbs-candidate img');
     window.__removed=0;
     window.__mutation=new MutationObserver(records=>{
       for(const record of records){
         if([...record.removedNodes].some(node=>node.nodeType===1&&(node.matches('tr, img')||node.querySelector?.('img'))))window.__removed++;
       }
     });
     window.__mutation.observe(document.querySelector('.fbs-table-body'),{childList:true,subtree:true});
   });
   await page.evaluate(async()=>{
     for(let i=0;i<16;i++)await window.__fbsDebug.refreshStatus();
   });
   const observed=await page.evaluate(()=>{
     const row=document.querySelector('.fbs-table-body > tr');
     const candidate=document.querySelector('.fbs-candidate img');
     return {sameRow:row===window.__row,sameFlag:row.querySelector('.fbs-flag img')===window.__rowFlag,
       sameCandidate:candidate===window.__candidateFlag,
       removed:window.__removed,flagSize:[
        getComputedStyle(window.__rowFlag).width,getComputedStyle(window.__rowFlag).height
       ],candidateSize:[getComputedStyle(candidate).width,getComputedStyle(candidate).height],
       delay:row.querySelector('.fbs-delay').textContent};
   });
   assert.equal(observed.sameRow,true,JSON.stringify(observed));
   assert.equal(observed.sameFlag,true,JSON.stringify(observed));
   assert.equal(observed.sameCandidate,true,JSON.stringify(observed));
   assert.equal(observed.removed,0,JSON.stringify(observed));
   assert.deepEqual(observed.flagSize,['16px','11px']);
   assert.deepEqual(observed.candidateSize,['16px','11px']);
   assert.match(observed.delay,/мс/);
   await page.evaluate(()=>{
     Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
       writeText:async text=>{window.__copied=text}
     }});
   });
   await page.locator('.fbs-table-body tr[data-node] .fbs-copy-flag').first().click();
   assert.equal(await page.evaluate(()=>window.__copied),'🇵🇱');
   await page.locator('.fbs-tab[data-sub-pane="filters"]').click();
   assert.equal(await page.locator('.fbs-filter-guidance').count(),0,'old standalone hint must be removed');
   const titles=await page.locator('.fbs-filter-field-title').allTextContents();
   assert.deepEqual(titles.map(t=>t.replace(/\s+/g,' ').trim()),[
     'Оставить только(одна строка = одно условие)',
     'Исключить(одна строка = одно условие)'
   ]);
   for(const title of await page.locator('.fbs-filter-field-title').all()){
     const parts=await title.locator('span,small').all();
     assert.equal(parts.length,2);
     assert.equal(await parts[1].evaluate(el=>getComputedStyle(el).color!==getComputedStyle(el.parentElement).color),true,'inline hint should be muted');
   }
   // Descending name order deliberately places RU before PL. Typing a PL
   // condition must strike RU immediately *without* moving either row.
   await page.locator('[data-sort="name"]').click();
   assert.match(await page.locator('.fbs-table-body > tr[data-node]').first().getAttribute('data-node'),/Россия/);
   await page.locator('.fbs-keep').fill(await page.evaluate(()=>window.__copied));
   assert.equal(await page.locator('.fbs-keep-flag-preview img').count(),1);
   assert.equal((await page.locator('.fbs-keep-flag-preview img').first().getAttribute('src')).includes('pl.svg'),true);
   const previewRows=await page.locator('.fbs-table-body tr[data-node]').evaluateAll(rows=>rows.map(row=>({
     name:row.dataset.node,filtered:row.classList.contains('fbs-row-filtered'),
     disabled:row.querySelector('input[type=checkbox]').disabled
   })));
   assert.match(previewRows[0].name,/Россия/,'RU must not move while the filter draft is being typed');
   assert.equal(previewRows[0].filtered,true,'RU is crossed out immediately');
   assert.equal(previewRows[0].disabled,true,'crossed-out draft preview cannot be selected');
   assert.match(previewRows[1].name,/Польша/,'PL keeps its original sort position');
   assert.equal(previewRows[1].filtered,false);
   assert.equal(await page.locator('.fbs-filtered-divider').count(),0,
     'do not create the excluded group until filters are applied');
   assert.match(await page.locator('.fbs-show-count').innerText(),/предпросмотр до «Применить»/);
   const struck=await page.locator('.fbs-row-filtered .fbs-node-name').evaluate(el=>({
     decoration:getComputedStyle(el).textDecorationLine,color:getComputedStyle(el).color
   }));
   assert.match(struck.decoration,/line-through/,'filtered name is immediately struck through');
   assert.notEqual(struck.color,'rgb(255, 255, 255)','excluded name is dimmed');
   await page.evaluate(()=>window.__fbsDebug.refreshStatus());
   assert.match(await page.locator('.fbs-table-body tr[data-node]').first().getAttribute('data-node'),/Россия/,
     'status polling cannot regroup unsaved filtered rows');
   assert.equal(await page.locator('.fbs-filtered-divider').count(),0);
   // Every filter textarea needs real editable text selection, Ctrl+C,
   // Ctrl+X and Delete; a bright selection must remain legible in dark mode.
   for(const selector of ['.fbs-keep','.fbs-drop']){
     const area=page.locator(selector);
     const original=await area.inputValue();
     await area.fill('Москва МСК');
     const style=await area.evaluate(el=>({
       select:getComputedStyle(el).userSelect,
       background:getComputedStyle(el,'::selection').backgroundColor,
       foreground:getComputedStyle(el,'::selection').color
     }));
     assert.equal(style.select,'text',selector);
     assert.equal(style.background,'rgb(77, 214, 174)',selector);
     assert.equal(style.foreground,'rgb(7, 28, 24)',selector);
     const box=await area.boundingBox();
     await page.mouse.move(box.x+11,box.y+15);
     await page.mouse.down();
     await page.mouse.move(box.x+85,box.y+15,{steps:9});
     await page.mouse.up();
     const range=await area.evaluate(el=>({start:el.selectionStart,end:el.selectionEnd}));
     assert(range.end>range.start,'mouse drag must select text: '+selector+JSON.stringify(range));
     await page.evaluate(()=>document.addEventListener('copy',()=>{
       window.__filterCopy=document.activeElement.value.slice(
         document.activeElement.selectionStart,document.activeElement.selectionEnd);
     },{once:true}));
     await page.keyboard.press('Control+c');
     assert((await page.evaluate(()=>window.__filterCopy)).length>0,'Ctrl+C captures text in '+selector);
     await page.keyboard.press('Control+x');
     assert((await area.inputValue()).length<'Москва МСК'.length,'Ctrl+X cuts selected text in '+selector);
     await area.fill('Москва МСК');
     await area.evaluate(el=>{el.focus();el.setSelectionRange(0,6)});
     await page.keyboard.press('Delete');
     assert.equal(await area.inputValue(),' МСК','Delete removes only selected condition in '+selector);
     await area.fill(original);
   }
   assert.equal(await page.evaluate(()=>window.MUIBalancerServers.hasUnsavedFilterEdits()),true);
   await page.locator('.fbs-keep').fill('');
   assert.equal(await page.locator('.fbs-table-body tr.fbs-row-filtered').count(),0);
   assert.equal(await page.locator('.fbs-table-body input:disabled').count(),0);
   await page.locator('.fbs-keep').fill('🇵🇱');
   assert.equal(await page.locator('.fbs-flag-picker .fbs-country-add-icon').count(),2);
   assert.equal((await page.locator('.fbs-flag-picker').first().innerText()).trim(),'Добавить страну');
   assert.equal(await page.locator('.fbs-flag-picker').first().evaluate(el=>getComputedStyle(el.querySelector('svg')).width),'14px');
   // Free area closes the menu, without touching filter contents or selections.
   await page.locator('.fbs-flag-picker[data-flag-for="keep"]').click();
   assert.equal(await page.locator('.fbs-country-menu').isVisible(),true);
   await page.locator('.fbs-country-search').fill('Австрия');
   await page.locator('.fbs-country-search').click();
   assert.equal(await page.locator('.fbs-country-menu').isVisible(),true,'inside menu must stay open');
   await page.locator('.fbs-filter-field-title').first().click();
   assert.equal(await page.locator('.fbs-country-menu').isHidden(),true,'click on empty panel closes menu');
   assert.equal(await page.locator('.fbs-keep').inputValue(),'🇵🇱','outside click must not alter current filter');
   await page.locator('.fbs-flag-picker[data-flag-for="keep"]').click();
   await page.keyboard.press('Escape');
   assert.equal(await page.locator('.fbs-country-menu').isHidden(),true,'Escape closes menu');
   await page.locator('.fbs-flag-picker[data-flag-for="keep"]').click();
   await page.locator('.fbs-flag-picker[data-flag-for="keep"]').click();
   assert.equal(await page.locator('.fbs-country-menu').isHidden(),true,'second click toggles menu');
   await page.locator('.fbs-flag-picker[data-flag-for="keep"]').click();
   await page.mouse.click(2,2);
   assert.equal(await page.locator('.fbs-country-menu').isHidden(),true,'outside dialog closes menu');
   await page.locator('.fbs-flag-picker[data-flag-for="drop"]').click();
   await page.locator('.fbs-country-search').fill('Россия');
   await page.locator('.fbs-country-choice').first().click();
   assert.equal(await page.locator('.fbs-country-menu').isHidden(),true,'choosing a country closes menu');
   assert.equal(await page.locator('.fbs-drop').inputValue(),'🇷🇺');
   assert.equal(await page.locator('.fbs-drop-flag-preview img').count(),1);
   // Failed provider download must not discard the pending edits or pretend
   // the filters have been stored.
   await page.evaluate(async()=>{
     const previous=window.fetch;
     window.fetch=async(url,opts)=>opts?.method==='PUT'
       ?{ok:false,json:async()=>({message:'Provider unavailable'})}
       :previous(url,opts);
     try{await window.MUIBalancerServers.saveSourceSettings();window.__sourceFailure='NOT_REJECTED';}
     catch(error){window.__sourceFailure=error.message;}
     window.fetch=previous;
   });
   assert.equal(await page.evaluate(()=>window.__sourceFailure),'Provider unavailable');
   assert.equal(await page.evaluate(()=>window.MUIBalancerServers.hasUnsavedFilterEdits()),true);
   assert.equal(await page.locator('.fbs-keep').inputValue(),'🇵🇱');
   // The modal Apply path calls this same API operation. It must persist
   // *both* filter fields without requiring the extra subscription button.
   await page.evaluate(async()=>{
     const fetchBase=window.fetch;
     window.fetch=async(url,options)=>{
       if(options?.method==='PUT'){
         window.__lastSourcePUT={url,body:JSON.parse(options.body)};
         return {ok:true,json:async()=>({data:{}})};
       }
       return fetchBase(url,options);
     };
     window.__saveResult=await window.MUIBalancerServers.saveSourceSettings();
   });
   assert.equal(await page.evaluate(()=>window.__saveResult),true);
   const stored=await page.evaluate(()=>window.__lastSourcePUT);
   assert.match(stored.url,/api\/mihomo\/subscriptions\/sub1$/);
   assert.equal(stored.body.filterKeep,'🇵🇱');
   assert.equal(stored.body.filterExclude,'🇷🇺');
   assert.equal(stored.body.intervalMinutes,1440);
   assert.equal(await page.evaluate(()=>window.MUIBalancerServers.hasUnsavedFilterEdits()),false);
   const appliedRows=await page.locator('.fbs-table-body tr[data-node]').evaluateAll(rows=>rows.map(r=>({
     name:r.dataset.node,filtered:r.classList.contains('fbs-row-filtered')
   })));
   assert.match(appliedRows[0].name,/Польша/,'only Apply may move matching nodes to the top');
   assert.equal(appliedRows[0].filtered,false);
   assert.match(appliedRows[1].name,/Россия/);
   assert.equal(appliedRows[1].filtered,true);
   assert.equal(await page.locator('.fbs-filtered-toggle').innerText(),'▾ Скрыто фильтрами · 1');
   await page.locator('.fbs-filtered-divider button').click();
   assert.equal(await page.locator('tr[data-node*="Россия"]').isHidden(),true);
   await page.locator('.fbs-filtered-divider button').click();
   assert.equal(await page.locator('tr[data-node*="Россия"]').isVisible(),true);
   const beforeEditingApplied=await page.locator('.fbs-table-body tr[data-node]').evaluateAll(rows=>rows.map(r=>r.dataset.node));
   await page.locator('.fbs-keep').fill('🇷🇺');
   assert.deepEqual(await page.locator('.fbs-table-body tr[data-node]').evaluateAll(rows=>rows.map(r=>r.dataset.node)),
     beforeEditingApplied,'editing an already-applied filter cannot reorder existing table rows');
   assert.equal(await page.locator('.fbs-filtered-divider').count(),0,
     'applied divider hidden during new unsaved filter preview');
   await page.locator('.fbs-keep').fill('🇵🇱');
   assert.equal(await page.locator('.fbs-filtered-divider').count(),0,
     'an edited filter remains in preview until explicit Apply even if text returns to saved value');
   await page.evaluate(()=>window.MUIBalancerServers.saveSourceSettings());
   assert.equal(await page.locator('.fbs-filtered-divider').count(),1,
     'explicit Apply restores the saved grouping when no field differs');
   // Reopening the same existing group must show the values fetched from
   // canonical subscription metadata, not empty editor defaults.
   await page.evaluate(()=>{
     // Simulate reopening a legacy filtered subscription: its excluded proxy
     // no longer exists among persisted active Outbounds on the NanoPi.
     const prior=window.fetch;
     window.fetch=async(url,options)=>{
       if(String(url).includes('/api/mihomo/subscriptions/preview')){
         window.__legacyPreviewCalls=(window.__legacyPreviewCalls||0)+1;
         return {ok:true,json:async()=>({data:{nodes:[
           {name:'LTE - Россия',protocol:'vless',countryCode:'RU',included:false},
           {name:'LTE - Польша',protocol:'vless',countryCode:'PL',included:true}
         ]}})};
       }
       if(String(url).includes('/api/mihomo/balancers/status'))
         return {ok:true,json:async()=>({data:{
           candidate:'quatro-vpn | LTE - Польша',available:true,nodes:[
             {name:'quatro-vpn | LTE - Польша',sourceId:'sub1',protocol:'vless',
              member:true,countryCode:'PL',alive:true,delay:33}
           ]
         }})};
       return prior(url,options);
     };
     const group={id:'group',name:'Foreign-quatro-vpn',kind:'group',type:'url-test',
       proxies:['quatro-vpn | LTE - Польша'],subscriptionIds:['sub1']};
     const outbounds=[{id:'managed-pl',kind:'proxy',type:'vless',
       sourceSubscriptionId:'sub1',name:'quatro-vpn | LTE - Польша'}];
     window.MUIBalancerServers.attach({
       form:document.querySelector('#fake-editor'),group,
       subs:[{id:'sub1',name:'quatro-vpn',group:group.name,enabled:true,intervalMinutes:1440,
         filterKeep:window.__lastSourcePUT.body.filterKeep,
         filterExclude:window.__lastSourcePUT.body.filterExclude}],
       outbounds,updateDefaults:()=>{},isDirty:()=>false,persistedName:group.name
     });
   });
   await page.locator('.fbs-tab[data-sub-pane="filters"]').click();
   assert.equal(await page.locator('.fbs-keep').inputValue(),'🇵🇱');
   assert.equal(await page.locator('.fbs-drop').inputValue(),'🇷🇺');
   assert.equal(await page.evaluate(()=>window.MUIBalancerServers.hasUnsavedFilterEdits()),false);
   await page.waitForFunction(()=>document.querySelectorAll('.fbs-table-body tr[data-node]').length===2);
   assert.equal(await page.evaluate(()=>window.__legacyPreviewCalls),1,'load legacy filtered names read-only');
   assert.equal(await page.locator('.fbs-row-filtered .fbs-node-name').innerText(),'quatro-vpn | LTE - Россия');
   assert.match(await page.locator('.fbs-row-filtered .fbs-node-name').evaluate(el=>getComputedStyle(el).textDecorationLine),/line-through/);
   assert.equal(await page.locator('.fbs-filtered-toggle').innerText(),'▾ Скрыто фильтрами · 1');
   await page.locator('.fbs-keep').fill('');
   await page.locator('.fbs-drop').fill('');
   const reenabled=page.locator('tr[data-node*="Россия"]');
   assert.equal(await reenabled.evaluate(el=>el.classList.contains('fbs-row-filtered')),false,
     'removing a filter must visually restore a formerly excluded name immediately');
   assert.equal(await reenabled.locator('input[type=checkbox]').isDisabled(),true,
     'the restored preview must not become active until Apply reimports it');
   assert.equal(await page.locator('.fbs-filtered-divider').count(),0,
     'removing the filter must not regroup before Apply');
   await page.locator('.fbs-keep').fill('🇵🇱');
   await page.locator('.fbs-drop').fill('🇷🇺');
   assert.equal(await reenabled.evaluate(el=>el.classList.contains('fbs-row-filtered')),true,
     'typing the excluded term again must cross the server out immediately');
   assert.equal(await page.locator('.fbs-filtered-divider').count(),0,
     'previously changed filters remain ungrouped until explicitly applied');
   await page.evaluate(()=>window.MUIBalancerServers.saveSourceSettings());
   assert.equal(await page.locator('.fbs-filtered-divider').count(),1,
     'saving the restored filter should regroup excluded nodes');
   await page.locator('.fbs-select-all').click();
   assert.equal(await page.locator('.fbs-row-filtered input[type=checkbox]').isChecked(),false,
     'bulk select must never activate a filtered preview-only proxy');
   await page.evaluate(()=>window.__fbsDebug.refreshStatus());
   assert.equal(await page.locator('.fbs-table-body tr[data-node]').count(),2,
      'persisted filtered server should remain visible across status polls');
   await page.evaluate(()=>{
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('insecure HTTP')}}});
      document.execCommand=()=>{window.__fallbackCopied=document.activeElement.value;return true;};
   });
   await page.locator('.fbs-copy-flag').first().click();
   assert.equal(await page.evaluate(()=>window.__fallbackCopied),'🇵🇱');
   assert.deepEqual(pageErrors,[]);
   console.log('PASS',width,'SVG tabs, stable row and candidate through 16 refreshes, flags 16x11, copy/paste and old-browser fallback');
   await page.close();
  }
 }finally{await browser?.close();fs.rmSync(file,{force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
