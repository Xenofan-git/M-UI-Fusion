'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require('playwright-core');
const web=path.resolve(__dirname,'../web');
const source=fs.readFileSync(path.join(web,'mihomo-balancer-servers.js'),'utf8');
const cache=fs.readFileSync(path.join(web,'index.html'),'utf8');
assert(cache.includes('static/mihomo-balancer-servers.js?v=121'));
const debug=source.replace(/\}\)\(\);\s*$/,'window.__fbsDebug={refreshStatus,renderRows};})();');
assert(debug!==source,'test instrumentation missing');
const file=path.join(web,'.balancer-flags-copy-regression.html');
const html='<!doctype html><html><head><meta charset="utf-8">'+
 '<link rel="stylesheet" href="mihomo-settings.css"></head><body class="dark">'+
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
   assert.equal(await page.locator('.fbs-tab .fbs-tab-icon').count(),2);
   assert.equal((await page.locator('.fbs-tab').first().innerText()).trim(),'Обновление');
   assert.equal((await page.locator('.fbs-tab').nth(1).innerText()).trim(),'Фильтры');
   assert.equal(await page.locator('.fbs-table-body > tr[data-node]').count(),2);
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
   assert.equal(await page.locator('.fbs-filter-guidance').innerText(),'Вписать по одному по вертикали');
   assert.equal(await page.locator('.fbs-filter-guidance').isVisible(),true);
   await page.locator('.fbs-keep').fill(await page.evaluate(()=>window.__copied));
   assert.equal(await page.locator('.fbs-keep-flag-preview img').count(),1);
   assert.equal((await page.locator('.fbs-keep-flag-preview img').first().getAttribute('src')).includes('pl.svg'),true);
   await page.locator('.fbs-flag-picker[data-flag-for="drop"]').click();
   await page.locator('.fbs-country-search').fill('Россия');
   await page.locator('.fbs-country-choice').first().click();
   assert.equal(await page.locator('.fbs-drop').inputValue(),'🇷🇺');
   assert.equal(await page.locator('.fbs-drop-flag-preview img').count(),1);
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
