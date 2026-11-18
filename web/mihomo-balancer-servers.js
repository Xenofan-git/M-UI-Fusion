/* HydraRoute-style subscribed balancer server management with live Mihomo data.
   This enhances the group editor only for groups linked to URL subscriptions. */
(() => {
 'use strict';
 let panel=null, context=null, items=[],selected=new Set(),excluded=new Set();
 let liveCandidate='',refreshTimer=0,controller=null,probing=false,sortBy='name',ascending=true,searchText='',showOnly='all';
 const q=(s,parent=document)=>parent.querySelector(s);
 const elt=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=String(text);return e;};
 const request=async(path,opts={})=>{
   const prefix=location.pathname.replace(/[^/]*$/,'');
   const r=await fetch(prefix+path.replace(/^\/+/,''),{credentials:'same-origin',headers:{'Content-Type':'application/json'},...opts});
   if(!r.ok){let error={};try{error=await r.json();}catch{}throw Error(error.message||'HTTP '+r.status);}
   const data=await r.json();return data.data??data;
 };
 const setStatus=(message,bad=false)=>{const target=q('.fbs-status',panel);if(target){target.textContent=message;target.classList.toggle('bad',bad);}};
 function selectedSources(group,subs){
   const set=new Set(group.subscriptionIds||[]);
   for(const src of subs||[])if(src.group===group.name)set.add(src.id);
   return Array.from(set);
 }
 function contextNodes(){
   if(!context)return[];
   const ids=new Set(selectedSources(context.group,context.subs));
   return context.outbounds.filter(n=>n.kind==='proxy'&&ids.has(n.sourceSubscriptionId));
 }
 function renderStatusText(){
   if(!panel)return;
   const count=items.length,enabled=items.filter(n=>selected.has(n.name)).length;
   const down=items.filter(n=>n.member&&n.alive===false).length;
   q('.fbs-count',panel).textContent='В пуле '+enabled+' из '+count+' · исключено '+(count-enabled)+' · недоступно '+down;
   const candidate=q('.fbs-candidate',panel);
   candidate.replaceChildren();
   if(liveCandidate){
     const country=window.MUICountryFlags?.read(liveCandidate);
     const flag=window.MUICountryFlags?.createIcon(country?.code);
     if(flag)candidate.append(flag);
     candidate.append(elt('span','',rowName({name:liveCandidate})));
   }else candidate.textContent='Нет данных от Mihomo';
   candidate.title=liveCandidate||'Сначала примените конфигурацию группы';
 }
 function rowName(item){
   return item.name.replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu,' ').replace(/[\r\n\t ]+/g,' ').trim();
 }
 function addFlag(container,item){
   const flags=window.MUICountryFlags;
   const country=flags?.byCode.get(item.countryCode)||flags?.read(item.name);
   const icon=flags?.createIcon(country?.code||item.countryCode);
   if(icon)container.appendChild(icon);
   else container.textContent='🌐';
 }
 function latest(item){
   const value=Number(item.delay)||0;
   return value>0?value+' мс':item.alive===false?'● offline':'—';
 }
 function updateSelection(){
   if(!context)return;
   const form=context.form,select=form.elements.proxies;
   for(const option of select.options){
     const known=contextNodes().some(n=>n.name===option.value);
     if(known)option.selected=selected.has(option.value);
   }
   excluded=new Set(contextNodes().filter(n=>!selected.has(n.name)).map(n=>n.name));
   context.updateDefaults?.();
   renderStatusText();
 }
 function renderRows(){
   if(!panel)return;
   renderStatusText();
   const lower=searchText.toLocaleLowerCase('ru');
   const listing=items.filter(n=>{
     if(showOnly==='online'&&n.alive!==true)return false;
     if(showOnly==='offline'&&n.alive!==false)return false;
     if(lower){
       const flags=window.MUICountryFlags;
       const country=flags?.byCode.get(n.countryCode)||flags?.read(n.name);
       const haystack=[n.name,n.protocol,country?.code,country?.english,country?.ru,country?.flag].filter(Boolean).join(' ').toLocaleLowerCase('ru');
       if(!haystack.includes(lower))return false;
     }
     return true;
   }).sort((a,b)=>{
     let result=0;
     if(sortBy==='latency')result=(a.delay||999999)-(b.delay||999999);
     else if(sortBy==='ping')result=(a.ping||999999)-(b.ping||999999);
     else result=a.name.localeCompare(b.name,'ru');
     return ascending?result:-result;
   });
   const body=q('.fbs-table-body',panel);
   body.replaceChildren();
   for(const item of listing){
     const tr=elt('tr',!selected.has(item.name)?'fbs-row-excluded':'');
     tr.dataset.node=item.name;
     const selectCol=elt('td');
     const check=elt('input');check.type='checkbox';check.checked=selected.has(item.name);
     check.setAttribute('aria-label','Использовать сервер '+item.name);
     check.onchange=()=>{if(check.checked)selected.add(item.name);else selected.delete(item.name);updateSelection();renderRows();};
     selectCol.append(check);tr.append(selectCol);
     const proto=elt('td','fbs-protocol',item.protocol||'proxy');tr.append(proto);
     const name=elt('td','fbs-node');name.title=item.name;
     const flag=elt('span','fbs-flag');addFlag(flag,item);name.append(flag);
     const label=elt('span','fbs-node-name',rowName(item));label.title=item.name;
     if(item.name===liveCandidate){label.classList.add('fbs-active-candidate');label.title='Текущий кандидат: '+item.name;}
     name.append(label);tr.append(name);
     const ping=elt('td','fbs-ping',item.ping>0?item.ping+' мс':'—');ping.title='ICMP echo до хоста (не показатель исправности VPN)';tr.append(ping);
     const delay=elt('td','fbs-delay',latest(item));delay.title='Проверка HTTP-задержки через Mihomo';
     if(item.alive===false)delay.classList.add('fbs-down');
     else if(item.alive===true)delay.classList.add('fbs-up');
     tr.append(delay);
     body.append(tr);
   }
   if(!listing.length){
     const empty=elt('tr');const td=elt('td','fbs-empty','Серверы не найдены');td.colSpan=5;empty.append(td);body.append(empty);
   }
   q('.fbs-show-count',panel).textContent='Показано '+listing.length+' из '+items.length;
 }
 function teardown(){
   if(context?.form?.elements.proxies){
     const field=context.form.elements.proxies.closest('.mihomo-field');
     if(field)field.hidden=false;
     context.form.elements.proxies.classList.remove('fbs-native-members');
   }
   if(refreshTimer){clearInterval(refreshTimer);refreshTimer=0;}
   controller?.abort();controller=null;probing=false;
   if(panel){panel.remove();panel=null;}
   context=null;items=[];selected.clear();excluded.clear();liveCandidate='';
 }
 async function refreshStatus(){
   if(!panel||!context)return;
   const ctx=context;
   try{
     const data=await request('/api/mihomo/balancers/status?group='+encodeURIComponent(ctx.group.name));
     if(!panel||context!==ctx)return;
     liveCandidate=data.candidate||'';
     const existingByName=new Map(items.map(n=>[n.name,n]));
     // The editable source list, not all panel Outbounds, is authoritative.
     items=data.nodes.map(n=>({...n,ping:existingByName.get(n.name)?.ping||0}));
     // Keep unsaved checkbox choices across background health refresh.
     if(!ctx.selectionInitialized){
       const formerlyExcluded=new Set(ctx.group.excludedSubscriptionMembers||[]);
       selected=new Set(items.filter(n=>n.member&&!formerlyExcluded.has(n.name)).map(n=>n.name));
       ctx.selectionInitialized=true;
     }
     if(data.message)setStatus(data.message,true);
     else setStatus(data.available?'Состояние Mihomo обновлено':'Нет текущих измерений');
     renderRows();
   }catch(error){
     if(panel&&ctx===context){setStatus(error.message,true);renderRows();}
   }
 }
 function renderMarkup(){
   const wrapper=elt('div','fbs-editor');
   wrapper.innerHTML=
   '<div class="fbs-heading"><div><strong>Серверы подписки</strong><p class="fbs-count"></p></div><button type="button" class="outline-btn fbs-close" title="Закрыть список" aria-label="Закрыть список">×</button></div>'+
   '<div class="fbs-candidate-line">Кандидат балансировщика: <strong class="fbs-candidate">Определяется…</strong></div>'+
   '<div class="fbs-toolbar"><input type="search" class="fbs-search" placeholder="⌕ Поиск серверов, стран и флагов…"><button type="button" class="outline-btn fbs-refresh-source">⇩ Обновить подписку</button><button type="button" class="outline-btn fbs-probe">↻ Опросить серверы</button><button type="button" class="outline-btn fbs-stop" hidden>Остановить</button></div>'+
   '<div class="fbs-table-wrap"><table class="fbs-table"><thead><tr><th><label><input type="checkbox" class="fbs-toggle-all"> Все</label></th><th>Протокол</th><th><button type="button" data-sort="name">Имя ↕</button></th><th><button type="button" data-sort="ping">Пинг ↕</button></th><th><button type="button" data-sort="latency">Задержка ↕</button></th></tr></thead><tbody class="fbs-table-body"></tbody></table></div>'+
   '<div class="fbs-toolbar fbs-table-actions"><button type="button" class="outline-btn fbs-exclude-offline">Исключить недоступные</button><button type="button" class="outline-btn fbs-select-all">Выбрать все</button><button type="button" class="outline-btn fbs-select-none">Снять все</button><select class="fbs-filter-status" aria-label="Фильтр состояния"><option value="all">Все серверы</option><option value="online">Только online</option><option value="offline">Только offline</option></select><span class="fbs-show-count"></span></div>'+
   '<p class="fbs-status" role="status">Получение состояния Mihomo…</p>'+
   '<div class="fbs-options"><button type="button" class="fbs-tab active" data-sub-pane="update">🟢 Обновление</button><button type="button" class="fbs-tab" data-sub-pane="filters">🟢 Фильтры</button>'+
   '<div class="fbs-settings-source">Источник: <select class="fbs-source" aria-label="Подписка для настройки"></select></div>'+
   '<div class="fbs-panel" data-sub-panel="update"><label class="fbs-check"><input type="checkbox" class="fbs-auto"> Обновлять подписку автоматически</label><div class="fbs-interval"><label>Интервал: <input type="number" min="0" max="168" class="fbs-hours"> ч</label><label><input type="number" min="0" max="59" class="fbs-minutes"> м</label></div></div>'+
   '<div class="fbs-panel" data-sub-panel="filters" hidden><div class="fbs-filter-fields"><label>Оставить только<textarea class="fbs-keep" rows="3" placeholder="Germany&#10;🇩🇪"></textarea><button type="button" class="outline-btn fbs-flag-picker" data-flag-for="keep">🏳️ Добавить страну</button></label><label>Исключить<textarea class="fbs-drop" rows="3" placeholder="Россия&#10;Russia"></textarea><button type="button" class="outline-btn fbs-flag-picker" data-flag-for="drop">🏳️ Добавить страну</button></label></div><div class="fbs-country-menu" hidden><input type="search" class="fbs-country-search" placeholder="Поиск страны…"><div class="fbs-country-list"></div></div></div>'+
   '<div class="fbs-settings-actions"><button type="button" class="outline-btn fbs-source-save">Сохранить настройки подписки</button><span class="fbs-save-hint">Ручной выбор серверов сохраняется кнопкой «Применить к конфигурации».</span></div></div>';
   return wrapper;
 }
 function bindHandlers(){
   const el=panel;
   q('.fbs-close',el).onclick=()=>{el.querySelector('.fbs-table-wrap').hidden=true;};
   const search=q('.fbs-search',el);
   const applySearch=e=>{searchText=e.target.value;renderRows();};
   search.oninput=applySearch;
   search.onsearch=applySearch;
   search.onchange=applySearch;
   q('.fbs-filter-status',el).onchange=e=>{showOnly=e.target.value;renderRows();};
   for(const button of el.querySelectorAll('[data-sort]'))button.onclick=()=>{
     const key=button.dataset.sort;
     if(sortBy===key)ascending=!ascending;else{sortBy=key;ascending=true;}
     renderRows();
   };
   q('.fbs-toggle-all',el).onchange=e=>{
     if(e.target.checked)for(const item of items)selected.add(item.name);
     else for(const item of items)selected.delete(item.name);
     updateSelection();renderRows();
   };
   q('.fbs-select-all',el).onclick=()=>{for(const item of items)selected.add(item.name);updateSelection();renderRows();};
   q('.fbs-select-none',el).onclick=()=>{for(const item of items)selected.delete(item.name);updateSelection();renderRows();};
   q('.fbs-exclude-offline',el).onclick=()=>{
     const bad=items.filter(n=>n.alive===false&&n.member);
     for(const item of bad)selected.delete(item.name);
     updateSelection();renderRows();setStatus('Исключено недоступных узлов: '+bad.length+'. Нажмите «Применить к конфигурации».');
   };
   q('.fbs-refresh-source',el).onclick=async()=>{
     if(probing){setStatus('Сначала завершите опрос',true);return;}
     if(context?.isDirty?.()){setStatus('Сначала сохраните изменения настроек Mihomo',true);return;}
     const id=selectedSources(context.group,context.subs);
     if(!id.length){setStatus('Подписка не привязана',true);return;}
     const button=q('.fbs-refresh-source',el);button.disabled=true;setStatus('Обновление подписки…');
     try{
       for(const sourceID of id)await request('/api/mihomo/subscriptions/'+encodeURIComponent(sourceID)+'/refresh',{method:'POST'});
       await context.afterRefresh?.();
       setStatus('Подписка обновлена. При необходимости переоткройте настройки балансировщика.');
     }catch(error){setStatus(error.message,true);}finally{button.disabled=false;}
   };
   q('.fbs-probe',el).onclick=probeServers;
   q('.fbs-stop',el).onclick=()=>{controller?.abort();setStatus('Опрос остановлен');};
   const sourceChoice=q('.fbs-source',el);
   const sourceList=context.subs.filter(src=>selectedSources(context.group,context.subs).includes(src.id));
   sourceChoice.replaceChildren();
   for(const sub of sourceList)sourceChoice.add(new Option(sub.name,sub.id));
   const currentSource=()=>sourceList.find(sub=>sub.id===sourceChoice.value);
   function fillSource(){
     const sub=currentSource();if(!sub)return;
     q('.fbs-auto',el).checked=!!sub.enabled;
     q('.fbs-hours',el).value=Math.floor((sub.intervalMinutes||1440)/60);
     q('.fbs-minutes',el).value=(sub.intervalMinutes||1440)%60;
     q('.fbs-keep',el).value=sub.filterKeep||'';
     q('.fbs-drop',el).value=sub.filterExclude||'';
   }
   sourceChoice.onchange=fillSource;
   fillSource();
   q('.fbs-source-save',el).onclick=async()=>{
     const sub=currentSource();if(!sub)return;
     if(context?.isDirty?.()){setStatus('Сначала сохраните изменения в Mihomo Settings',true);return;}
     const h=Number(q('.fbs-hours',el).value),m=Number(q('.fbs-minutes',el).value);
     const interval=h*60+m;
     if(!Number.isInteger(h)||h<0||h>168||!Number.isInteger(m)||m<0||m>59||interval<5||interval>10080){
       setStatus('Интервал должен быть от 5 минут до 7 суток',true);return;
     }
     const sourceSave=q('.fbs-source-save',el);
     sourceSave.disabled=true;
     setStatus('Сохранение подписки и применение фильтров…');
     try{
       const body={...sub,enabled:q('.fbs-auto',el).checked,intervalMinutes:interval,
         filterKeep:q('.fbs-keep',el).value,filterExclude:q('.fbs-drop',el).value};
       await request('/api/mihomo/subscriptions/'+encodeURIComponent(sub.id),{method:'PUT',body:JSON.stringify(body)});
       Object.assign(sub,body);
       await context.afterRefresh?.();
       setStatus('Подписка сохранена, фильтры применены. Переоткройте окно для актуального состава.');
     }catch(error){setStatus(error.message,true);}
     finally{sourceSave.disabled=false;}
   };
   const countryMenu=q('.fbs-country-menu',el),countrySearch=q('.fbs-country-search',el),countryList=q('.fbs-country-list',el);
   let targetArea=null;
   function renderCountryChoices(){
     const countryText=countrySearch.value.toLocaleLowerCase('ru').trim();
     countryList.replaceChildren();
     const directory=window.MUICountryFlags;
     for(const country of (directory?.countries||[]).filter(c=>
       (c.ru+' '+c.english+' '+c.code).toLocaleLowerCase('ru').includes(countryText)
     ).slice(0,125).sort((a,b)=>a.ru.localeCompare(b.ru,'ru'))){
       const button=elt('button','fbs-country-choice');button.type='button';
       const image=directory.createIcon(country.code);if(image)button.append(image);
       button.append(elt('span','',country.ru+' ('+country.code+')'));
       button.onclick=()=>{
         const current=targetArea.value.trimEnd();
         const term=country.english;
         if(!current.split(/\r?\n/).includes(term))targetArea.value=current+(current?'\n':'')+term;
         countryMenu.hidden=true;
         targetArea.focus();
       };
       countryList.append(button);
     }
   }
   for(const button of el.querySelectorAll('[data-flag-for]'))button.onclick=()=>{
     targetArea=q(button.dataset.flagFor==='keep'?'.fbs-keep':'.fbs-drop',el);
     countryMenu.hidden=false;countrySearch.value='';renderCountryChoices();countrySearch.focus();
   };
   countrySearch.oninput=renderCountryChoices;
   for(const b of el.querySelectorAll('[data-sub-pane]'))b.onclick=()=>{
     for(const other of el.querySelectorAll('[data-sub-pane]'))other.classList.toggle('active',other===b);
     for(const page of el.querySelectorAll('[data-sub-panel]'))page.hidden=page.dataset.subPanel!==b.dataset.subPane;
   };
 }
 async function probeServers(){
   if(!panel||probing)return;
   const names=items.filter(n=>selected.has(n.name)&&n.member).map(n=>n.name);
   if(!names.length){setStatus('Выберите хотя бы один действующий сервер',true);return;}
   const ctx=context;probing=true;
   const go=q('.fbs-probe',panel),stop=q('.fbs-stop',panel);
   go.disabled=true;stop.hidden=false;
   controller=new AbortController();
   let count=0;
   try{
     const prefix=location.pathname.replace(/[^/]*$/,'');
     const response=await fetch(prefix+'api/mihomo/balancers/probe',{
       method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({group:ctx.group.name,names}),signal:controller.signal
     });
     if(!response.ok){
       let problem={};try{problem=await response.json();}catch{}
       throw Error(problem.message||'HTTP '+response.status);
     }
     if(!response.body)throw Error('Браузер не поддерживает потоковый опрос');
     const reader=response.body.getReader(),decoder=new TextDecoder();
     let buffer='';
     while(true){
       const chunk=await reader.read();if(chunk.done)break;
       buffer+=decoder.decode(chunk.value,{stream:true});
       let boundary;
       while((boundary=buffer.indexOf('\n\n'))>=0){
         const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
         const line=block.split(/\r?\n/).find(v=>v.startsWith('data:'));
         if(!line)continue;
         const evt=JSON.parse(line.slice(5).trim());
         if(evt.done)continue;
         count++;
         const node=items.find(n=>n.name===evt.name);
         if(node){node.delay=evt.delay||0;node.ping=evt.ping||0;node.alive=!!evt.alive;node.checkedAt=new Date().toISOString();}
         setStatus('Опрос '+count+' из '+names.length+' · '+(evt.alive?'online':'offline')+': '+evt.name);
         if(panel&&context===ctx)renderRows();
       }
     }
     setStatus('Опрос завершён: '+count+' из '+names.length);
     if(panel&&context===ctx)await refreshStatus();
   }catch(error){
     if(error.name!=='AbortError')setStatus(error.message,true);
   }finally{
     probing=false;controller=null;
     if(panel){q('.fbs-probe',panel).disabled=false;q('.fbs-stop',panel).hidden=true;}
   }
 }
 function attach({form,group,subs,outbounds,updateDefaults,afterRefresh,isDirty}){
   teardown();
   if(!form||group.kind!=='group')return false;
   const ids=selectedSources(group,subs);
   if(!ids.length)return false;
   const label=form.elements.proxies?.closest('.mihomo-field');
   if(!label)return false;
   const nativeSelect=form.elements.proxies;
   // Keep native control for validated form serialization, but prevent the
   // full Outbounds dropdown leaking into subscription group editing.
   nativeSelect.classList.add('fbs-native-members');
   const title=label.querySelector('span');
   if(title)title.textContent='Серверы подписки';
   context={form,group,subs,outbounds,updateDefaults,afterRefresh,isDirty,selectionInitialized:false};
   items=contextNodes().map(node=>({
     name:node.name,protocol:node.type,sourceId:node.sourceSubscriptionId,
     countryCode:window.MUICountryFlags?.read(node.name)?.code||'',member:(group.proxies||[]).includes(node.name),alive:null,delay:0
   }));
   const blocked=new Set(group.excludedSubscriptionMembers||[]);
   selected=new Set(items.filter(n=>n.member&&!blocked.has(n.name)).map(n=>n.name));
   context.selectionInitialized=true;
   panel=renderMarkup();
   label.hidden=true;
   label.after(panel);
   bindHandlers();
   renderRows();
   refreshStatus();
   refreshTimer=setInterval(()=>{if(!probing&&panel)refreshStatus();},7500);
   return true;
 }
 const getExcluded=()=>context&&panel?Array.from(excluded):null;
 const active=()=>!!panel;
 window.MUIBalancerServers={attach,teardown,getExcluded,active};
})();
