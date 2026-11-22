/* HydraRoute-style server manager for manual and subscription balancers.
   Subscribed groups only contain their providers' nodes; manual groups list
   only selected members and have a separate any-Outbound add picker. */
(() => {
 'use strict';
 let panel=null, context=null, items=[],selected=new Set(),excluded=new Set();
 let liveCandidate='',refreshTimer=0,controller=null,probing=false,sortBy='name',ascending=true,searchText='',showOnly='all',filteredCollapsed=false;
 let dismissCountryPicker=null,removeVisibilityListener=null,statusRequestPromise=null;
 const statusPollIntervalMs=60000;
 const q=(s,parent=document)=>parent.querySelector(s);
 const elt=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=String(text);return e;};
 const request=async(path,opts={})=>{
   const prefix=location.pathname.replace(/[^/]*$/,'');
   const r=await fetch(prefix+path.replace(/^\/+/,''),{credentials:'same-origin',headers:{'Content-Type':'application/json'},...opts});
   if(!r.ok){let error={};try{error=await r.json();}catch{}throw Error(error.message||'HTTP '+r.status);}
   const data=await r.json();return data.data??data;
 };
 // Inline SVG icons are independent of emoji fonts (Windows 8.1 in particular).
 const tabIcon=type=>type==='refresh'
   ?'<svg class="fbs-tab-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M5.7 8.9a7.5 7.5 0 0 1 12.6-2L20 12M4 12l1.7 3.1a7.5 7.5 0 0 0 12.6-2"/></svg>'
   :'<svg class="fbs-tab-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16l-6.5 7.5V19l-3 1v-7.5L4 5z"/></svg>';
 const addCountryIcon='<svg class="fbs-country-add-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
 const copyFlag=async(country)=>{
   if(!country?.flag)return false;
   const value=country.flag;
   try{
     if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(value);return true;}
   }catch{}
   // Intranet HTTP and older browsers lack navigator.clipboard; use a
   // temporary focused textarea so Ctrl+V receives the real Unicode flag.
   const before=document.activeElement;
   const copyBox=elt('textarea','fbs-clipboard-copy');
   copyBox.value=value;
   copyBox.style.cssText='position:fixed;left:-9999px;top:0;opacity:0';
   document.body.append(copyBox);
   copyBox.focus();copyBox.select();
   const success=!!document.execCommand?.('copy');
   copyBox.remove();
   before?.focus?.({preventScroll:true});
   return success;
 };
 const setStatus=(message,bad=false)=>{const target=q('.fbs-status',panel);if(target){target.textContent=message;target.classList.toggle('bad',bad);}};
 function selectedSources(group,subs){
   const set=new Set(group.subscriptionIds||[]);
   for(const src of subs||[])if(src.group===group.name)set.add(src.id);
   return Array.from(set);
 }
 function contextNodes(){
   if(!context)return[];
   if(!context.subscribed)return context.available;
   const ids=new Set(selectedSources(context.group,context.subs));
   return context.outbounds.filter(n=>n.kind==='proxy'&&ids.has(n.sourceSubscriptionId));
 }
 function basicNode(outbound){
   const name=outbound.name;
   return {name,protocol:outbound.type||outbound.kind||'proxy',
     countryCode:window.MUICountryFlags?.read(name)?.code||'',
     sourceId:outbound.sourceSubscriptionId||'',member:(context.group.proxies||[]).includes(name),
     alive:null,delay:0,ping:0};
 }
 function renderManualPicker(){
   if(!panel||context?.subscribed)return;
   const results=q('.fbs-add-results',panel);
   if(!results)return;
   const input=q('.fbs-add-search',panel);
   const query=String(input?.value||'').trim().toLocaleLowerCase('ru');
   results.replaceChildren();
   let count=0;
   for(const item of context.available){
     if(selected.has(item.name))continue;
     const country=window.MUICountryFlags?.read(item.name);
     const lookup=[item.name,item.type,item.kind,country?.ru,country?.english,country?.code].filter(Boolean).join(' ').toLocaleLowerCase('ru');
     if(query&&!lookup.includes(query))continue;
     if(++count>120)break;
     const button=elt('button','fbs-add-result');
     button.type='button';
     const flag=elt('span','fbs-flag');addFlag(flag,basicNode(item));button.append(flag);
     button.append(elt('span','fbs-add-name',rowName(item)));
     button.append(elt('small','fbs-protocol',item.type||item.kind||'proxy'));
     button.title=item.name;
     button.onclick=()=>{
       if(!items.some(row=>row.name===item.name))items.push(basicNode(item));
       selected.add(item.name);
       updateSelection();renderRows();renderManualPicker();
       setStatus('Сервер добавлен. Нажмите «Применить к конфигурации», затем «Сохранить».');
     };
     results.append(button);
   }
   if(!count)results.append(elt('p','fbs-empty',query?'Совпадений нет':'Все доступные Outbounds уже выбраны'));
   q('.fbs-add-counter',panel).textContent='Доступно для добавления: '+Math.min(count,120)+(count>120?' (показаны первые 120)':'');
 }
 function renderStatusText(){
   if(!panel)return;
   const count=items.length,enabled=items.filter(n=>selected.has(n.name)&&!isFilteredRow(n)).length;
   const down=items.filter(n=>n.member&&n.alive===false).length;
   const filtered=items.filter(isFilteredRow).length;
   q('.fbs-count',panel).textContent='В пуле '+enabled+' из '+count+
     ' · исключено '+(count-enabled)+' · недоступно '+down+
     (sourceFilterActive()?' · по фильтрам '+filtered:'');
   const candidate=q('.fbs-candidate',panel);
   if(candidate.dataset.candidate===liveCandidate)return;
   candidate.dataset.candidate=liveCandidate;
   const country=window.MUICountryFlags?.read(liveCandidate);
   const code=country?.code||'';
   const oldFlag=candidate.querySelector(':scope > img.outsub-flag-svg');
   if(oldFlag?.dataset.countryCode!==code){
     oldFlag?.remove();
     if(code){
       const icon=window.MUICountryFlags?.createIcon(code);
       if(icon){icon.dataset.countryCode=code;candidate.prepend(icon);}
     }
   }
   let label=candidate.querySelector(':scope > span.fbs-candidate-label');
   if(!label){label=elt('span','fbs-candidate-label');candidate.append(label);}
   const value=liveCandidate?rowName({name:liveCandidate}):'Нет данных от Mihomo';
   if(label.textContent!==value)label.textContent=value;
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
   excluded=context.subscribed
     ?new Set(contextNodes().filter(n=>!selected.has(n.name)).map(n=>n.name))
     :new Set();
   context.updateDefaults?.();
   renderStatusText();
   if(!context.subscribed)renderManualPicker();
 }
 // HydraRoute-style preview: one term per line, OR for keep, exclude wins.
 const filterWords=value=>String(value||'').replace(/\r\n/g,'\n').split('\n')
   .map(word=>word.trim().toLocaleLowerCase('ru'))
   .filter(word=>word&&!word.startsWith('#'));
 function passesSourceFilters(item){
   if(!context?.subscribed||!panel)return true;
   const sourceId=q('.fbs-source',panel)?.value;
   if(!sourceId||item.sourceId!==sourceId)return true;
   const keep=filterWords(q('.fbs-keep',panel)?.value);
   const drop=filterWords(q('.fbs-drop',panel)?.value);
   const flags=window.MUICountryFlags;
   const code=item.countryCode||flags?.read(item.name)?.code;
   const country=flags?.byCode.get(code);
   const haystack=[item.name,country?.flag,country?.english,country?.ru,
     country?.code,flags?.aliases?.[country?.code]]
     .filter(Boolean).join(' ').toLocaleLowerCase('ru');
   return (!keep.length||keep.some(term=>haystack.includes(term)))&&
     !drop.some(term=>haystack.includes(term));
 }
 const isFilteredRow=item=>Boolean(
   !passesSourceFilters(item)||
   ((item.filtered||item.previewOnly)&&!sourceFilterActive())||
   (item.filtered&&item.sourceId&&item.sourceId!==q('.fbs-source',panel)?.value)
 );
 function sourceFilterActive(){
   return !!context?.subscribed&&!!panel&&(
     filterWords(q('.fbs-keep',panel)?.value).length>0||
     filterWords(q('.fbs-drop',panel)?.value).length>0
   );
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
     const x=isFilteredRow(a),y=isFilteredRow(b);
     if(x!==y)return x?1:-1;
     let result=0;
     if(sortBy==='latency')result=(a.delay||999999)-(b.delay||999999);
     else if(sortBy==='ping')result=(a.ping||999999)-(b.ping||999999);
     else result=a.name.localeCompare(b.name,'ru');
     return ascending?result:-result;
   });
   const body=q('.fbs-table-body',panel);
   // The divider is presentation only. Remove before stable row reordering.
   body.querySelector(':scope > tr.fbs-filtered-divider')?.remove();
   // Even at a 60-second poll, reuse tr/img nodes: preserve text selection and SVG flags.
   // replacing tbody children caused the flag SVGs to blink after each poll.
   const existing=new Map([...body.querySelectorAll(':scope > tr[data-node]')].map(tr=>[tr.dataset.node,tr]));
   const visible=new Set(listing.map(item=>item.name));
   for(const [name,row] of existing)if(!visible.has(name))row.remove();
   const emptyRow=body.querySelector(':scope > tr.fbs-empty-row');
   emptyRow?.remove();
   for(let index=0;index<listing.length;index++){
     const item=listing[index];
     let tr=existing.get(item.name);
     if(!tr){
       tr=elt('tr');
       tr.dataset.node=item.name;
       const selectCol=elt('td');
       const check=elt('input');check.type='checkbox';
       check.setAttribute('aria-label','Использовать сервер '+item.name);
       check.onchange=()=>{if(check.checked)selected.add(item.name);else selected.delete(item.name);updateSelection();renderRows();};
       selectCol.append(check);tr.append(selectCol);
       tr.append(elt('td','fbs-protocol'));
       const name=elt('td','fbs-node');name.title=item.name;
       const flag=elt('button','fbs-flag fbs-copy-flag');
       flag.type='button';
       flag.setAttribute('aria-label','Копировать флаг страны узла '+item.name);
       flag.title='Просто нажмите на флаг, чтобы он скопировался для вставки в фильтр';
       addFlag(flag,item);
       flag.onclick=async()=>{
         const flags=window.MUICountryFlags;
         const country=flags?.byCode.get(item.countryCode)||flags?.read(item.name);
         const copied=await copyFlag(country);
         setStatus(copied?'Флаг «'+country.ru+'» скопирован. Вставьте его в «Оставить только» или «Исключить».':'Не удалось скопировать флаг',!copied);
       };
       name.append(flag);
       const label=elt('span','fbs-node-name');label.title=item.name;name.append(label);
       tr.append(name);
       const ping=elt('td','fbs-ping');ping.title='ICMP echo до хоста (не показатель исправности VPN)';tr.append(ping);
       const delay=elt('td','fbs-delay');delay.title='Проверка HTTP-задержки через Mihomo';tr.append(delay);
     }
     const filtered=isFilteredRow(item);
     const enabled=!filtered&&selected.has(item.name);
     tr.classList.toggle('fbs-row-filtered',filtered);
     tr.classList.toggle('fbs-row-excluded',filtered||!enabled);
     tr.hidden=filtered&&filteredCollapsed;
     const check=q('input[type=checkbox]',tr);
     check.disabled=filtered||!!item.filtered||!!item.previewOnly;
     check.title=filtered?'Исключён фильтром':
       (item.filtered||item.previewOnly?'Будет доступен после применения изменений':'Выбрать сервер');
     if(check.checked!==enabled)check.checked=enabled;
     const proto=q('.fbs-protocol',tr),protocol=item.protocol||'proxy';
     if(proto.textContent!==protocol)proto.textContent=protocol;
     const label=q('.fbs-node-name',tr),name=rowName(item);
     if(label.textContent!==name)label.textContent=name;
     label.classList.toggle('fbs-active-candidate',item.name===liveCandidate);
     label.title=item.name===liveCandidate?'Текущий кандидат: '+item.name:item.name;
     const ping=q('.fbs-ping',tr),pingText=item.ping>0?item.ping+' мс':'—';
     if(ping.textContent!==pingText)ping.textContent=pingText;
     const delay=q('.fbs-delay',tr),delayText=latest(item);
     if(delay.textContent!==delayText)delay.textContent=delayText;
     const checked=Date.parse(item.checkedAt||'');
     const checkedTitle=Number.isFinite(checked)
       ?'Последняя проверка: '+new Date(checked).toLocaleString('ru-RU')
       :'Время последней проверки неизвестно';
     if(delay.title!==checkedTitle)delay.title=checkedTitle;
     delay.classList.toggle('fbs-down',item.alive===false);
     delay.classList.toggle('fbs-up',item.alive===true);
     if(body.children[index]!==tr)body.insertBefore(tr,body.children[index]||null);
   }
   if(!listing.length){
     const row=elt('tr','fbs-empty-row'),td=elt('td','fbs-empty','Серверы не найдены');
     td.colSpan=5;row.append(td);body.append(row);
   }
   const filteredCount=listing.filter(isFilteredRow).length;
   if(filteredCount){
     const first=body.querySelector('tr.fbs-row-filtered');
     const divider=elt('tr','fbs-filtered-divider');
     const td=elt('td');td.colSpan=5;
     const toggle=elt('button','fbs-filtered-toggle',
       (filteredCollapsed?'▸ ':'▾ ')+'Скрыто фильтрами · '+filteredCount);
     toggle.type='button';
     toggle.setAttribute('aria-expanded',String(!filteredCollapsed));
     toggle.onclick=()=>{filteredCollapsed=!filteredCollapsed;renderRows();};
     td.append(toggle);divider.append(td);
     if(first)body.insertBefore(divider,first);
   }
   q('.fbs-show-count',panel).textContent='Показано '+listing.length+' из '+items.length+
     ' · подходит '+(listing.length-filteredCount)+' · отфильтровано '+filteredCount;
 }
 function teardown(){
   if(context?.form?.elements.proxies){
     const field=context.form.elements.proxies.closest('.mihomo-field');
     if(field)field.hidden=false;
     context.form.elements.proxies.classList.remove('fbs-native-members');
   }
   if(refreshTimer){clearInterval(refreshTimer);refreshTimer=0;}
   if(removeVisibilityListener){removeVisibilityListener();removeVisibilityListener=null;}
   // A pending request belongs to the previous context; it must not block a new modal.
   statusRequestPromise=null;
   if(dismissCountryPicker){dismissCountryPicker();dismissCountryPicker=null;}
   controller?.abort();controller=null;probing=false;
   if(panel){panel.remove();panel=null;}
   context=null;items=[];selected.clear();excluded.clear();liveCandidate='';
 }
 const statusPanelVisible=()=>{
   if(!panel?.isConnected||document.hidden)return false;
   const modal=panel.closest('.modal-backdrop');
   return !modal||modal.classList.contains('open');
 };
 function refreshStatus(){
   if(!panel||!context)return Promise.resolve();
   // Never overlap requests to the same group while the previous one is running.
   if(statusRequestPromise)return statusRequestPromise;
   const task=loadBalancerStatus();
   statusRequestPromise=task;
   return task.finally(()=>{if(statusRequestPromise===task)statusRequestPromise=null;});
 }
 async function loadBalancerStatus(){
   if(!panel||!context)return;
   const ctx=context;
   if(!ctx.persistedName||ctx.persistedName!==ctx.group.name){
     setStatus('Измерения будут доступны после сохранения балансировщика.');
     return;
   }
   try{
     const data=await request('/api/mihomo/balancers/status?group='+encodeURIComponent(ctx.persistedName));
     if(!panel||context!==ctx)return;
     liveCandidate=data.candidate||'';
     const existingByName=new Map(items.map(n=>[n.name,n]));
     // The chosen group scope, never all Outbounds, controls the table.
     // Manual edits may contain unsaved additions; a remote refresh must not
     // silently remove those locally selected members.
     if(ctx.subscribed){
       const names=new Set((data.nodes||[]).map(n=>n.name));
       const extra=(ctx.previewNodes||[]).filter(n=>!names.has(n.name));
       items=[...(data.nodes||[]),...extra].map(n=>({...n,
         sourceId:existingByName.get(n.name)?.sourceId||n.sourceId||'',
         ping:existingByName.get(n.name)?.ping||0}));
     }else{
       const remote=new Map((data.nodes||[]).map(node=>[node.name,node]));
       items=items.map(node=>({
         ...node,...(remote.get(node.name)||{}),
         ping:existingByName.get(node.name)?.ping||0
       }));
     }
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
 // Existing subscriptions created before display-only filtered metadata was
 // introduced can still show excluded names immediately. This is a read-only
 // preview request: no proxy credentials or routes are modified.
 async function loadLegacyFilteredPreview(ctx){
   if(!ctx.subscribed)return;
   ctx.previewNodes=[];
   const linked=new Set(selectedSources(ctx.group,ctx.subs));
   for(const sub of ctx.subs.filter(x=>linked.has(x.id))){
     if(sub.filteredNodes?.length||
        (!filterWords(sub.filterKeep).length&&!filterWords(sub.filterExclude).length&&
         !(sub.excludedNodeKeys||[]).length))continue;
     try{
       const response=await request('/api/mihomo/subscriptions/preview',{
         method:'POST',body:JSON.stringify(sub)
       });
       if(context!==ctx)return;
       const existing=new Set(items.map(n=>n.name));
       for(const node of response.nodes||[]){
         if(node.included)continue;
         const name=sub.name+' | '+node.name;
         if(existing.has(name))continue;
         existing.add(name);
         ctx.previewNodes.push({name,protocol:node.protocol,
           countryCode:node.countryCode,sourceId:sub.id,
           member:false,filtered:true,previewOnly:true,alive:null,delay:0,ping:0});
       }
       items.push(...ctx.previewNodes.filter(n=>!items.some(row=>row.name===n.name)));
       renderRows();
     }catch(error){
       if(context===ctx)setStatus('Список исключённых узлов временно недоступен: '+error.message,true);
     }
   }
 }
 function renderMarkup(){
   const wrapper=elt('div','fbs-editor');
   wrapper.innerHTML=
   '<div class="fbs-heading"><div><strong>'+(context.subscribed?'Серверы подписки':'Серверы балансировщика')+'</strong><p class="fbs-count"></p></div></div>'+
   '<div class="fbs-candidate-line">Кандидат балансировщика: <strong class="fbs-candidate">Определяется…</strong></div>'+
   '<div class="fbs-toolbar"><input type="search" class="fbs-search" placeholder="⌕ Поиск серверов, стран и флагов…"><button type="button" class="outline-btn fbs-refresh-source">⇩ Обновить подписку</button><button type="button" class="outline-btn fbs-probe">↻ Опросить серверы</button><button type="button" class="outline-btn fbs-stop" hidden>Остановить</button></div>'+
   '<div class="fbs-table-wrap"><table class="fbs-table"><thead><tr><th><label><input type="checkbox" class="fbs-toggle-all"> Все</label></th><th>Протокол</th><th><button type="button" data-sort="name">Имя ↕</button></th><th><button type="button" data-sort="ping">Пинг ↕</button></th><th><button type="button" data-sort="latency">Задержка ↕</button></th></tr></thead><tbody class="fbs-table-body"></tbody></table></div>'+
   '<div class="fbs-toolbar fbs-table-actions"><button type="button" class="outline-btn fbs-exclude-offline">Исключить недоступные</button><button type="button" class="outline-btn fbs-select-all">Выбрать все</button><button type="button" class="outline-btn fbs-select-none">Снять все</button><select class="fbs-filter-status" aria-label="Фильтр состояния"><option value="all">Все серверы</option><option value="online">Только online</option><option value="offline">Только offline</option></select><span class="fbs-show-count"></span></div>'+
   '<p class="fbs-status" role="status">Получение состояния Mihomo…</p>'+
   '<div class="fbs-options"><button type="button" class="fbs-tab active" data-sub-pane="update">'+tabIcon('refresh')+'<span>Обновление</span></button><button type="button" class="fbs-tab" data-sub-pane="filters">'+tabIcon('filter')+'<span>Фильтры</span></button>'+
   '<div class="fbs-settings-source">Источник: <select class="fbs-source" aria-label="Подписка для настройки"></select></div>'+
   '<div class="fbs-panel" data-sub-panel="update"><label class="fbs-check"><input type="checkbox" class="fbs-auto"> Обновлять подписку автоматически</label><div class="fbs-interval"><label>Интервал: <input type="number" min="0" max="168" class="fbs-hours"> ч</label><label><input type="number" min="0" max="59" class="fbs-minutes"> м</label></div></div>'+
   '<div class="fbs-panel" data-sub-panel="filters" hidden><div class="fbs-filter-fields"><label><span class="fbs-filter-field-title"><span>Оставить только</span><small>(одна строка = одно условие)</small></span><textarea class="fbs-keep" rows="3" placeholder="Germany&#10;🇩🇪"></textarea><button type="button" class="outline-btn fbs-flag-picker" data-flag-for="keep">'+addCountryIcon+'Добавить страну</button></label><label><span class="fbs-filter-field-title"><span>Исключить</span><small>(одна строка = одно условие)</small></span><textarea class="fbs-drop" rows="3" placeholder="Россия&#10;Russia"></textarea><button type="button" class="outline-btn fbs-flag-picker" data-flag-for="drop">'+addCountryIcon+'Добавить страну</button></label></div><div class="fbs-country-menu" hidden><input type="search" class="fbs-country-search" placeholder="Поиск страны…"><div class="fbs-country-list"></div></div></div>'+
   '<div class="fbs-settings-actions"><button type="button" class="outline-btn fbs-source-save">Сохранить настройки подписки</button><span class="fbs-save-hint">Фильтры сохраняются также при нажатии «Применить к конфигурации». Другие параметры группы — после «Сохранить».</span></div></div>';
   if(!context.subscribed){
     const toolbar=q('.fbs-toolbar',wrapper);
     q('.fbs-refresh-source',wrapper).hidden=true;
     q('.fbs-options',wrapper).hidden=true;
     const picker=elt('div','fbs-manual-picker');
     picker.innerHTML='<button type="button" class="outline-btn fbs-add-toggle">＋ Добавить Outbound</button>'+
       '<div class="fbs-add-menu" hidden><input class="fbs-add-search" type="search" placeholder="Поиск Outbounds по имени, флагу и протоколу…">'+
       '<div class="fbs-add-results"></div><small class="fbs-add-counter"></small></div>';
     toolbar.after(picker);
   }
   return wrapper;
 }
 function bindHandlers(){
   const el=panel;
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
   const selectable=item=>!isFilteredRow(item)&&!item.filtered&&!item.previewOnly;
   q('.fbs-toggle-all',el).onchange=e=>{
     if(e.target.checked){for(const item of items)if(selectable(item))selected.add(item.name);}
     else{for(const item of items)selected.delete(item.name);}
     updateSelection();renderRows();
   };
   q('.fbs-select-all',el).onclick=()=>{
     for(const item of items)if(selectable(item))selected.add(item.name);
     updateSelection();renderRows();
   };
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
   if(!context.subscribed){
     const toggle=q('.fbs-add-toggle',el),menu=q('.fbs-add-menu',el);
     toggle.onclick=()=>{menu.hidden=!menu.hidden;if(!menu.hidden){renderManualPicker();q('.fbs-add-search',el).focus();}};
     q('.fbs-add-search',el).oninput=renderManualPicker;
     return;
   }
   const sourceChoice=q('.fbs-source',el);
   const sourceList=context.subs.filter(src=>selectedSources(context.group,context.subs).includes(src.id));
   sourceChoice.replaceChildren();
   for(const sub of sourceList)sourceChoice.add(new Option(sub.name,sub.id));
   const currentSource=()=>sourceList.find(sub=>sub.id===sourceChoice.value);
   const pendingSources=new Map();
   let activeSourceID=sourceChoice.value;
   const makeSourceChange=sub=>{
     const hours=Number(q('.fbs-hours',el).value),minutes=Number(q('.fbs-minutes',el).value);
     const interval=hours*60+minutes;
     if(!Number.isInteger(hours)||hours<0||hours>168||
        !Number.isInteger(minutes)||minutes<0||minutes>59||
        interval<5||interval>10080)throw Error('Интервал должен быть от 5 минут до 7 суток');
     const body={...sub,enabled:q('.fbs-auto',el).checked,intervalMinutes:interval,
       filterKeep:q('.fbs-keep',el).value,filterExclude:q('.fbs-drop',el).value};
     const modified=['enabled','intervalMinutes','filterKeep','filterExclude']
       .some(key=>(body[key]??'')!==(sub[key]??''));
     return modified?body:null;
   };
   const captureSource=()=>{
     const sub=sourceList.find(item=>item.id===activeSourceID);
     if(!sub)return;
     const update=makeSourceChange(sub);
     if(update)pendingSources.set(sub.id,update);
     else pendingSources.delete(sub.id);
   };
   const saveSourceSettings=async({refreshAfter=false}={})=>{
     captureSource();
     const changes=Array.from(pendingSources.values());
     if(!changes.length)return !!context.wasSourceSaved;
     // The backend validates every filter, re-imports from subscription URL,
     // and atomically writes the accepted nodes and filter metadata to state.
     for(const change of changes){
       await request('/api/mihomo/subscriptions/'+encodeURIComponent(change.id),{
         method:'PUT',body:JSON.stringify(change)
       });
       const sub=sourceList.find(item=>item.id===change.id);
       if(sub)Object.assign(sub,change);
       pendingSources.delete(change.id);
       context.wasSourceSaved=true;
     }
     if(refreshAfter)await context.afterRefresh?.();
     return true;
   };
   context.saveSourceSettings=saveSourceSettings;
   context.hasUnsavedSourceChanges=()=>{
     try{captureSource();return pendingSources.size>0;}
     catch{return true;}
   };
   function renderFilterFlagPreviews(){
     for(const [areaClass,previewClass] of [['.fbs-keep','.fbs-keep-flag-preview'],['.fbs-drop','.fbs-drop-flag-preview']]){
       const area=q(areaClass,el),parent=area.parentElement;
       let preview=q(previewClass,parent);
       if(!preview){preview=elt('div','fbs-filter-flags '+previewClass.slice(1));area.after(preview);}
       const flags=window.MUICountryFlags,seen=new Set();
       const countries=area.value.split(/\r?\n/).map(v=>flags?.fromFilterLine(v)).filter(country=>{
         if(!country||seen.has(country.code))return false;seen.add(country.code);return true;
       });
       // Stable preview nodes: do not replace them every 7.5 second poll.
       if(preview.dataset.codes===countries.map(c=>c.code).join(','))continue;
       preview.dataset.codes=countries.map(c=>c.code).join(',');
       preview.replaceChildren();
       for(const country of countries){
         const chip=elt('span','fbs-filter-flag-chip');
         const icon=flags?.createIcon(country.code);if(icon)chip.append(icon);
         chip.append(elt('span','',country.ru));
         preview.append(chip);
       }
     }
   }
   for(const selector of ['.fbs-keep','.fbs-drop'])q(selector,el).addEventListener('input',()=>{
     renderFilterFlagPreviews();filteredCollapsed=false;renderRows();
   });
   function fillSource(){
     const sub=currentSource();if(!sub)return;
     const value=pendingSources.get(sub.id)||sub;
     q('.fbs-auto',el).checked=!!value.enabled;
     q('.fbs-hours',el).value=Math.floor((value.intervalMinutes||1440)/60);
     q('.fbs-minutes',el).value=(value.intervalMinutes||1440)%60;
     q('.fbs-keep',el).value=value.filterKeep||'';
     q('.fbs-drop',el).value=value.filterExclude||'';
     renderFilterFlagPreviews();filteredCollapsed=false;renderRows();
   }
   sourceChoice.onchange=()=>{
     try{captureSource();}
     catch(error){sourceChoice.value=activeSourceID;setStatus(error.message,true);return;}
     activeSourceID=sourceChoice.value;fillSource();
   };
   fillSource();
   q('.fbs-source-save',el).onclick=async()=>{
     if(context?.isDirty?.()){setStatus('Сначала сохраните изменения в Mihomo Settings',true);return;}
     const button=q('.fbs-source-save',el);
     button.disabled=true;setStatus('Сохранение фильтров и настроек подписки…');
     try{
       const changed=await saveSourceSettings({refreshAfter:true});
       setStatus(changed?'Фильтры подписки сохранены. Переоткройте окно для актуального состава.':'Изменений для сохранения нет');
     }catch(error){setStatus(error.message,true);}
     finally{button.disabled=false;}
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
         const term=country.flag;
         if(!current.split(/\r?\n/).includes(term))targetArea.value=current+(current?'\n':'')+term;
         targetArea.dispatchEvent(new Event('input',{bubbles:true}));
         const area=targetArea;
         closeCountryMenu();
         area.focus();
       };
       countryList.append(button);
     }
   }
   const pickerButtons=Array.from(el.querySelectorAll('[data-flag-for]'));
   const closeCountryMenu=()=>{countryMenu.hidden=true;targetArea=null;};
   for(const button of pickerButtons)button.onclick=()=>{
     const area=q(button.dataset.flagFor==='keep'?'.fbs-keep':'.fbs-drop',el);
     if(!countryMenu.hidden&&targetArea===area){closeCountryMenu();return;}
     targetArea=area;
     countryMenu.hidden=false;countrySearch.value='';renderCountryChoices();countrySearch.focus();
   };
   // Close on any click outside the picker, including free space in the dialog.
   const onOutsideClick=event=>{
     if(countryMenu.hidden||countryMenu.contains(event.target)||pickerButtons.some(b=>b.contains(event.target)))return;
     closeCountryMenu();
   };
   const onEscape=event=>{
     if(event.key==='Escape'&&!countryMenu.hidden){closeCountryMenu();event.preventDefault();}
   };
   document.addEventListener('click',onOutsideClick);
   document.addEventListener('keydown',onEscape);
   dismissCountryPicker=()=>{
     document.removeEventListener('click',onOutsideClick);
     document.removeEventListener('keydown',onEscape);
   };
   countrySearch.oninput=renderCountryChoices;
   for(const b of el.querySelectorAll('[data-sub-pane]'))b.onclick=()=>{
     if(b.dataset.subPane!=='filters')closeCountryMenu();
     for(const other of el.querySelectorAll('[data-sub-pane]'))other.classList.toggle('active',other===b);
     for(const page of el.querySelectorAll('[data-sub-panel]'))page.hidden=page.dataset.subPanel!==b.dataset.subPane;
   };
 }
 async function probeServers(){
   if(!panel||probing)return;
   if(!context.persistedName||context.persistedName!==context.group.name){
     setStatus('Сначала сохраните балансировщик — затем станет доступен опрос.',true);
     return;
   }
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
 function attach({form,group,subs,outbounds,updateDefaults,afterRefresh,isDirty,persistedName}){
   teardown();
   if(!form||group.kind!=='group')return false;
   const label=form.elements.proxies?.closest('.mihomo-field');
   if(!label)return false;
   const ids=selectedSources(group,subs);
   const subscribed=ids.length>0;
   const nativeSelect=form.elements.proxies;
   nativeSelect.classList.add('fbs-native-members');
   const title=label.querySelector('span');
   if(title)title.textContent=subscribed?'Серверы подписки':'Серверы балансировщика';
   const byName=new Map(outbounds.map(node=>[node.name,node]));
   const available=Array.from(nativeSelect.options)
     .filter(option=>option.value&&option.value!==group.name)
     .map(option=>byName.get(option.value)||{
       kind:'builtin',name:option.value,type:'builtin'
     });
   filteredCollapsed=false;
   context={form,group,subs,outbounds,available,subscribed,updateDefaults,afterRefresh,
     isDirty,persistedName:persistedName||'',selectionInitialized:false};
   const initial=contextNodes();
   if(subscribed){
     items=initial.map(basicNode);
     const blocked=new Set(group.excludedSubscriptionMembers||[]);
     selected=new Set(items.filter(n=>n.member&&!blocked.has(n.name)).map(n=>n.name));
   }else{
     // Only current members appear in this table. Available unselected
     // Outbounds are offered separately through "Добавить Outbound".
     const selectedNames=Array.from(nativeSelect.selectedOptions,option=>option.value);
     const map=new Map(available.map(node=>[node.name,node]));
     items=selectedNames.map(name=>basicNode(map.get(name)||{name,kind:'builtin',type:'builtin'}));
     selected=new Set(selectedNames);
   }
   context.selectionInitialized=true;
   panel=renderMarkup();
   label.hidden=true;
   label.after(panel);
   bindHandlers();
   renderRows();
   // Immediate initial read; recurring reads only while the dialog is visible.
   void refreshStatus();
   void loadLegacyFilteredPreview(context);
   const pollVisibleStatus=()=>{if(!probing&&statusPanelVisible())void refreshStatus();};
   refreshTimer=setInterval(pollVisibleStatus,statusPollIntervalMs);
   const onVisibilityChange=()=>{if(!document.hidden)pollVisibleStatus();};
   document.addEventListener('visibilitychange',onVisibilityChange);
   removeVisibilityListener=()=>document.removeEventListener('visibilitychange',onVisibilityChange);
   return true;
 }
 const getExcluded=()=>context?.subscribed&&panel?Array.from(excluded):null;
 const active=()=>!!panel;
 const hasUnsavedFilterEdits=()=>!!context?.hasUnsavedSourceChanges?.();
 const saveSourceSettings=async()=>context?.saveSourceSettings?.()??false;
 window.MUIBalancerServers={attach,teardown,getExcluded,active,hasUnsavedFilterEdits,saveSourceSettings};
})();
