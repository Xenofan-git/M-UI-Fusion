(() => {
  const proxyTypes=[['direct','Direct'],['ss','Shadowsocks'],['snell','Snell'],['socks5','SOCKS5'],['http','HTTP / HTTPS'],['vmess','VMess'],['vless','VLESS'],['trojan','Trojan'],['hysteria2','Hysteria2'],['tuic','TUIC'],['wireguard','WireGuard'],['openvpn','OpenVPN']];
  const groupTypes=[['select','Select'],['url-test','URL Test'],['fallback','Fallback'],['load-balance','Load Balance']];
  const ruleTypes=['DOMAIN','DOMAIN-SUFFIX','DOMAIN-KEYWORD','DOMAIN-WILDCARD','DOMAIN-REGEX','GEOSITE','IP-CIDR','IP-CIDR6','IP-SUFFIX','IP-ASN','GEOIP','SRC-GEOIP','SRC-IP-ASN','SRC-IP-CIDR','SRC-IP-SUFFIX','DST-PORT','SRC-PORT','IN-PORT','IN-TYPE','IN-USER','IN-NAME','REMATCH-NAME','PROCESS-PATH','PROCESS-PATH-WILDCARD','PROCESS-PATH-REGEX','PROCESS-NAME','PROCESS-NAME-WILDCARD','PROCESS-NAME-REGEX','UID','NETWORK','DSCP','AND','MATCH'];
  const builtins=['DIRECT','REJECT','REJECT-DROP','PASS','PASS-RULE','COMPATIBLE','GLOBAL'];
  const groupBuiltins=['DIRECT','REJECT','REJECT-DROP','COMPATIBLE'];
  // Display-only hints for Mihomo built-ins; keep raw option values unchanged.
  const builtinOutboundRu={
    'DIRECT':'ПРЯМОЙ',
    'REJECT':'БЛОКИРОВАТЬ',
    'REJECT-DROP':'ОТБРОСИТЬ БЕЗ ОТВЕТА',
    'PASS':'ПРОПУСТИТЬ',
    'PASS-RULE':'ПРОПУСТИТЬ ПОДПРАВИЛО',
    'COMPATIBLE':'СОВМЕСТИМОСТЬ',
    'GLOBAL':'ГЛОБАЛЬНЫЙ'
  };
  const targetDisplayName=name=>window.muiGetLang?.()==='ru'&&
    Object.prototype.hasOwnProperty.call(builtinOutboundRu,name)
    ? name+' ('+builtinOutboundRu[name]+')' : name;
  const defaultTestURL='https://www.gstatic.com/generate_204';
  // Defaults apply only when CREATING a manual (Outbounds) balancer.
  // Existing balancers and subscription balancers retain their stored values.
  const newManualBalancerDefaults=()=>({
    kind:'group',type:'url-test',testUrl:defaultTestURL,
    interval:180,timeout:8000,tolerance:100,disableUdp:false,
    subscriptionIds:[],excludedSubscriptionMembers:[]
  });
  const defaultBasics=()=>({watchdogEnabled:false,mode:'rule',directIpVersion:'dual',ipv6:true,tcpConcurrent:false,unifiedDelay:false,outboundTestUrl:defaultTestURL,trafficSampleSeconds:1,trafficSaveSeconds:5,outboundUploadStatistics:false,outboundDownloadStatistics:false,logLevel:'info',logBufferSize:300,maskLogAddress:false,blockIps:[],blockDomains:[],ipv4Domains:[],warpDomains:[],sniffer:{enabled:false,http:true,tls:true,quic:true,forceDnsMapping:true,parsePureIp:true,overrideDestination:false}});
  const delayResults=new Map();
  const activeGroupResults=new Map();
  // The global /api/state poll calls render() every 5 seconds. Keep table
  // DOM nodes when the markup is structurally identical, preserving SVG flags.
  const outboundTableMarkup=new WeakMap();
  let activeGroupRequest=null;
  let geoCategoryCatalog=null,geoCategoryLoading=null;
  let warpData=null,warpBusy=false;
  const clone=value=>JSON.parse(JSON.stringify(value??null));
  const root=$('#mihomo-settings-root');
  if(!root)return;

  let lastSyncedOutbounds=[],lastSyncedBasics={},lastSyncedRules=[];
  let draft={outbounds:[],routingRules:[],basics:defaultBasics()},dirty=false,currentTab='basics',editingOutbound='',editingRule='',outboundMode='form',outboundBusy=false,editingOriginal=null;
  let balancerSubscriptions=[];
  // The shared editor is used by two mutually exclusive balancer tabs.
  // Only the subscription tab may expose/bind subscription sources.
  let editingSubscriptionGroup=false,creatingSubscriptionGroup=false;
  let outboundFormChanged=false,outboundYAMLCached=false;

  function freshID(prefix){return prefix+'-'+crypto.randomUUID().replaceAll('-','').slice(0,12);}
  function ensureFinalMatch(){
    const index=draft.routingRules.findIndex(rule=>String(rule.type).toUpperCase()==='MATCH');
    if(index<0){draft.routingRules.push({id:freshID('rule'),type:'MATCH',payload:'',target:'DIRECT',noResolve:false});return;}
    if(index!==draft.routingRules.length-1){
      const [match]=draft.routingRules.splice(index,1);
      draft.routingRules.push(match);
    }
  }
  function syncFromState(){
    if(dirty)return;
    const state=app.state?.state||{};
    draft={outbounds:clone(state.outbounds||[])||[],routingRules:clone(state.routingRules||[])||[],basics:{...defaultBasics(),...clone(state.mihomoBasics||{}),mode:state.settings?.mode||'rule',logLevel:state.settings?.logLevel||'info'}};
    fillBasicsForm();
    ensureFinalMatch();
    // Remember the editor's baseline. A subscription may refresh while dirty.
    lastSyncedOutbounds=clone(draft.outbounds);
    lastSyncedBasics=clone(draft.basics);
    lastSyncedRules=clone(draft.routingRules);
    const persistedGroups=new Set(draft.outbounds.filter(x=>x.kind==='group').map(x=>x.name));
    for(const key of activeGroupResults.keys())if(!persistedGroups.has(key))activeGroupResults.delete(key);
    render();
  }
  function markDirty(){dirty=true;root.classList.add('mihomo-dirty');syncButtons();render();}
  function syncButtons(){
    $('#mihomo-save').disabled=!dirty;
    $('#mihomo-restart').disabled=dirty;
  }
  function setTab(tab){
    currentTab=tab;
    $$('.mihomo-tab',root).forEach(button=>button.classList.toggle('active',button.dataset.mihomoTab===tab));
    $$('.mihomo-pane',root).forEach(pane=>pane.classList.toggle('active',pane.dataset.mihomoPane===tab));
    if(typeof syncInkBars==='function')syncInkBars();
    render();
    if(tab==='sources'||tab==='subscriptions')window.MUIOutboundSubscriptions?.load();
  }
  function render(){
    renderWarpRouting();
    if(currentTab==='basics')renderBasicsIndicators();
    else if(currentTab==='routing')renderRules();
    else if(currentTab==='outbounds'||currentTab==='balancers'||currentTab==='subscriptions')renderOutbounds();
    syncButtons();
  }
  function outboundAddress(item){
    if(item.vpngate)return `vpn_vpn${item.vpngate.slot} · table ${100+Number(item.vpngate.slot)}`;
    if(item.kind==='group'){
      const sources=app.state?.state?.outboundSubscriptions||[];
      const subscribed=new Set(item.subscriptionIds||[]);
      for(const source of [...(Array.isArray(sources)?sources:[]),...balancerSubscriptions]){
        if(source.group===item.name&&source.id)subscribed.add(source.id);
      }
      if(!isSubscriptionGroup(item))return String((item.proxies||[]).length)+' исходящих';
      const count=subscribed.size;
      return String((item.proxies||[]).length)+' узлов · '+count+' '+(count===1?'подписка':count>1&&count<5?'подписки':'подписок');
    }
    return `${item.server||'—'}${item.port?':'+item.port:''}`;
  }
  function outboundRows(){
    const fixed=[
      {name:'DIRECT',kind:'builtin',type:'direct',address:muiT('mh.directConnection')},
      {name:'REJECT',kind:'builtin',type:'reject',address:muiT('mh.rejectConnection')},
      {name:'REJECT-DROP',kind:'builtin',type:'reject-drop',address:muiT('mh.silentDrop')},
    ];
    if(draft.basics.directIpVersion!=='dual')fixed.push({name:'MUI-DIRECT',kind:'builtin',type:'direct',address:'Basics / '+draft.basics.directIpVersion});
    if(draft.basics.ipv4Domains.length)fixed.push({name:'MUI-IPV4',kind:'builtin',type:'direct',address:'Basics / IPv4'});
    return fixed.concat(draft.outbounds.map(item=>({...item,address:outboundAddress(item)})));
  }
  // The saved subscription metadata only contains a filtered node's name,
  // protocol, flag and country code (not its connection/credentials). Match
  // by full display name, after removing a known source prefix, and protocol.
  // This is a VIEW filter: keep every outbound in the draft, group memberships,
  // routing references, URLTest schedules and runtime Mihomo config untouched.
  function filteredOutboundIdentity(name,protocol){
    const label=String(name||'').normalize('NFC').trim();
    const sep=label.indexOf(' | ');
    const nodeName=sep>=0?label.slice(sep+3).trim():label;
    return nodeName+'\u0000'+String(protocol||'').toLowerCase();
  }
  function excludedSubscriptionOutbounds(){
    const sources=app.state?.state?.outboundSubscriptions||[];
    const names=new Set();
    for(const source of sources){
      for(const node of source?.filteredNodes||[]){
        if(node?.name)names.add(filteredOutboundIdentity(node.name,node.protocol));
      }
    }
    return names;
  }
  function delayLabel(name){const value=delayResults.get(name);return value==='Testing'?muiT('mh.testing'):value||'';}
  // Display only: hide a provider label already identified by the balancer name.
  // Never change Mihomo's actual selected member or the stored proxy name.
  function displayedCurrentNode(groupName,current){
    const value=String(current||''),divider=value.indexOf(' | ');
    if(divider<1)return value;
    const provider=value.slice(0,divider).trim().toLowerCase();
    const group=String(groupName||'').toLowerCase();
    const sourceGroups=(typeof app!=='undefined'&&app?.state?.state?.outboundSubscriptions)||[];
    const cachedSources=typeof balancerSubscriptions==='undefined'?[]:balancerSubscriptions||[];
    const groupEntry=typeof draft==='undefined'?null:draft?.outbounds?.find(x=>x.kind==='group'&&x.name===groupName);
    const linked=new Set(groupEntry?.subscriptionIds||[]);
    const fromKnownSubscription=[...sourceGroups,...cachedSources].some(sub=>
      String(sub?.nodeNamePrefix||sub?.name||'').trim().toLowerCase()===provider&&
      (String(sub.group||'').toLowerCase()===group||linked.has(sub.id))
    );
    // Only remove a *known provider* prefix, never a protocol/region prefix
    // such as "INT |" if it identifies the actual outbound.
    return provider&&(group===provider||group.endsWith('-'+provider)||fromKnownSubscription)
      ?value.slice(divider+3):value;
  }
  // UI-only: use the same local SVG country flags as the subscription
  // node list. Regional-indicator emoji show as plain LV/RU letters on
  // Windows without a color flag font. Never rename the Mihomo member.
  function currentNodeMeta(groupName,current){
    const original=displayedCurrentNode(groupName,current);
    const flags=window.MUICountryFlags;
    const emoji=original.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
    // Provider + ISO code: "INT | lv ...", "RU | ru ...",
    // "quatro-vpn | se ..." — also support standalone [JP] or DE.
    let label=original.replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu,' ').trim();
    const match=label.match(/^(?:([^|/]+)\s*[|/]\s*)?(?:\[([A-Za-z]{2})\]|([A-Za-z]{2}))(?=\s|[|/•·\-]|$)/);
    const prefixCode=(match?.[2]||match?.[3]||'').toUpperCase();
    const isoCode=prefixCode==='UK'?'GB':prefixCode;
    let country=flags?.byCode?.get(isoCode);
    if(!country&&emoji)country=flags?.read?.(emoji[0]);
    if(!country)country=flags?.read?.(original);
    if(match&&country?.code===isoCode){
      // Remove the provider and country code ONLY for a recognized ISO code.
      label=label.slice(match[0].length).replace(/^\s*[|/•·\-]\s*/,'').trim();
    }
    if(!label&&country)label=country.ru||country.english||country.code;
    return {label:label||original,code:country?.code||'',original};
  }
  function groupTypeLabel(type,label=type){
    return type==='url-test'&&window.muiGetLang?.()==='ru'?'URL-тест':label;
  }
  function groupResultLabel(name){
    const group=activeGroupResults.get(name);
    if(!group)return 'Определяется…';
    if(!group.running)return 'Mihomo недоступен';
    if(!group.applied)return 'Группа не применена';
    if(group.noAvailable)return 'Нет доступных узлов';
    if(group.currentUnavailable)return 'Текущий узел недоступен';
    if(group.current)return currentNodeMeta(name,group.current).label;
    if(group.perConnection)return 'Выбор для каждого соединения';
    return 'Текущий не определён';
  }
  function groupTestNote(name){
    const result=delayResults.get(name);
    if(!result)return '';
    if(result==='Testing')return 'Проверка задержки…';
    if(/^\d+ ms$/.test(result))return 'Задержка: '+result;
    return 'Тест задержки не прошёл';
  }
  function groupResultTitle(name){
    const result=delayResults.get(name);
    return groupResultLabel(name)+(result&&result!=='Testing'&&!/^\d+ ms$/.test(result)?'\nОшибка теста: '+result:'');
  }
  // Build flag + label as separate DOM nodes so names remain escaped and
  // the local vector image is available even on older Windows browsers.
  function paintCurrentGroupNode(node,name){
    const group=activeGroupResults.get(name);
    if(!group?.running||!group.applied||!group.current||group.noAvailable||group.currentUnavailable){
      node.textContent=groupResultLabel(name);
      node.title=groupResultTitle(name);
      return;
    }
    const meta=currentNodeMeta(name,group.current);
    // Reuse the loaded SVG on each 9-second health refresh. Replacing <img>
    // with the very same URL repeatedly makes the flag visibly blink.
    const previousFlag=node.querySelector(':scope > img.mihomo-current-country-flag');
    const previousLabel=node.querySelector(':scope > .mihomo-current-country-label');
    if(previousFlag&&previousLabel&&previousFlag.getAttribute('aria-label')===meta.code){
      if(previousLabel.textContent!==meta.label)previousLabel.textContent=meta.label;
      node.title=meta.original+(groupTestNote(name)?'\n'+groupTestNote(name):'');
      return;
    }
    const icon=window.MUICountryFlags?.createIcon?.(meta.code);
    if(icon){
      icon.classList.add('mihomo-current-country-flag');
      icon.setAttribute('aria-label',meta.code);
      icon.alt=meta.code;
      const label=document.createElement('span');
      label.className='mihomo-current-country-label';
      label.textContent=meta.label;
      node.replaceChildren(icon,label);
    }else{
      node.textContent=meta.label;
    }
    // Preserve the original name for inspection without changing any backend
    // data, and keep the existing delay-test tooltip.
    node.title=meta.original+(groupTestNote(name)?'\n'+groupTestNote(name):'');
  }
  // Update visible text nodes without rebuilding the table or losing focus.
  function paintActiveGroupResults(){
    $$('[data-active-group]',root).forEach(node=>{
      const name=node.dataset.activeGroup;
      paintCurrentGroupNode(node,name);
    });
    $$('[data-active-group-note]',root).forEach(node=>{
      const value=groupTestNote(node.dataset.activeGroupNote);
      node.textContent=value;
      node.hidden=!value;
    });
  }
  async function refreshActiveGroups(){
    if(!['balancers','subscriptions'].includes(currentTab)||document.hidden||activeGroupRequest)return;
    activeGroupRequest=api('/api/mihomo/balancers/current');
    try{
      const info=await activeGroupRequest;
      if(info?.groups&&typeof info.groups==='object'){
        activeGroupResults.clear();
        for(const [name,value] of Object.entries(info.groups)){
          activeGroupResults.set(name,{...value,running:!!info.running});
        }
      }
    }catch{
      activeGroupResults.clear();
    }finally{
      activeGroupRequest=null;
      paintActiveGroupResults();
    }
  }
  // Mihomo may switch URLTest/Fallback choices without user interaction.
  setInterval(()=>{if(['balancers','subscriptions'].includes(currentTab))refreshActiveGroups();},9000);
  function outboundSupportsDelay(item){return !['reject','reject-drop'].includes(String(item.type||'').toLowerCase());}
  // Delay checks query the running Mihomo configuration, not the unsaved
  // draft. Keep saved nodes clickable even if unrelated fields are dirty.
  function outboundTestUnavailableReason(item){
    if(!outboundSupportsDelay(item)||item.kind==='builtin'&&item.name!=='DIRECT')
      return muiT('mh.testUnavailable');
    if(delayResults.get(item.name)==='Testing')return muiT('mh.testing');
    if(item.kind!=='builtin'&&!(app.state?.state?.outbounds||[])
      .some(saved=>saved.name===item.name&&outboundSupportsDelay(saved)))
      return muiT('mh.saveFirst');
    return '';
  }
  // Some existing subscription groups use the provider's group name and
  // intentionally have no subscriptionIds field in state.json. Respect both
  // the source's group binding and explicit subscriptionIds when classifying.
  function subscriptionGroupNames(){
    const saved=app.state?.state?.outboundSubscriptions||[];
    const linked=[...(Array.isArray(saved)?saved:[]),...balancerSubscriptions];
    return new Set(linked.map(source=>source?.group).filter(Boolean));
  }
  function isSubscriptionGroup(item){
    if(item?.kind!=='group')return false;
    if(item.subscriptionManaged||(item.subscriptionIds||[]).length>0||
      subscriptionGroupNames().has(item.name))return true;
    // Older versions cleared subscriptionIds when deleting a source with
    // "keep nodes". Recover orphaned subscription groups by their members:
    // ALL members must retain one known provider's "source | node" prefix.
    // Ordinary mixed/manual groups (including Russia with RU | nodes) stay
    // under "Балансировщики из Исходящих".
    const members=item.proxies||[];
    if(!members.length)return false;
    const sources=[...(app.state?.state?.outboundSubscriptions||[]),...balancerSubscriptions]
      .map(source=>source?.nodeNamePrefix||source?.name).filter(Boolean);
    return sources.some(name=>members.every(member=>String(member).startsWith(name+' | ')));
  }
  function visibleGroupPeers(item){
    return draft.outbounds.filter(entry=>entry.kind===item.kind&&(
      entry.kind!=='group'||isSubscriptionGroup(entry)===isSubscriptionGroup(item)
    ));
  }
  function renderOutbounds(){
    const manual=currentTab==='balancers',subscribed=currentTab==='subscriptions';
    const box=$(manual?'#mihomo-balancer-table':subscribed?'#mihomo-subscription-balancer-table':'#mihomo-outbound-table');
    const allRows=outboundRows().filter(item=>
      manual?item.kind==='group'&&!isSubscriptionGroup(item):
      subscribed?isSubscriptionGroup(item):
      item.kind!=='group'
    );
    const hideFiltered=!manual&&!subscribed&&$('#mihomo-hide-filtered-outbounds')?.checked===true;
    const hiddenKeys=hideFiltered?excludedSubscriptionOutbounds():null;
    const rows=hiddenKeys?allRows.filter(item=>
      item.kind!=='proxy'||!hiddenKeys.has(filteredOutboundIdentity(item.name,item.type))
    ):allRows;
    const hiddenCount=$('#mihomo-hidden-filtered-count');
    if(hiddenCount){
      const count=allRows.length-rows.length;
      const label='Скрыто: '+count;
      if(hiddenCount.textContent!==label)hiddenCount.textContent=label;
      hiddenCount.hidden=!hideFiltered;
    }
    const showTraffic=draft.basics.outboundUploadStatistics||draft.basics.outboundDownloadStatistics;
    const markup=`<div class="mihomo-table-wrap"><table class="mihomo-table"><thead><tr><th>#</th><th>${muiT('mh.colName')}</th><th>${muiT('mh.colKind')}</th><th>${muiT('mh.colStrategy')}</th><th>${muiT('mh.colMembers')}</th><th>Dialer Proxy</th>${showTraffic?`<th>${muiT('mh.colUpDown')}</th>`:''}<th>${manual||subscribed?'Текущий исходящий':muiT('mh.colTestResult')}</th><th>${muiT('mh.colTest')}</th><th>${muiT('mh.colActions')}</th></tr></thead><tbody>${rows.map((item,index)=>{
      const peers=visibleGroupPeers(item),custom=item.kind!=='builtin',position=peers.findIndex(entry=>entry.id===item.id),lastPosition=peers.length-1,kind=item.sourceSubscriptionId?'Подписка':item.vpngate?muiT('mh.vpngate'):isSubscriptionGroup(item)?'Из подписки':item.kind==='group'?muiT('mh.kindGroup'):item.kind==='proxy'?muiT('mh.kindProxy'):muiT('mh.kindBuiltin'),type=item.vpngate?'VPNGate':item.type;
      return `<tr><td>${index+1}</td><td class="mihomo-name">${esc(item.name)}</td><td><span class="mihomo-pill ${item.kind==='group'?'group':''}">${esc(kind)}</span></td><td><span class="protocol-pill ${item.kind==='proxy'?'':'transport'}">${esc(item.kind==='group'?groupTypeLabel(type):type)}</span></td><td><div class="mihomo-member-summary" title="${esc(item.address||'')}">${esc(item.address||'—')}</div>${vpnGateStatusHTML(item)}</td><td>${esc(item.dialerProxy||'—')}</td>${showTraffic?`<td data-outbound-traffic="${esc(item.name)}"></td>`:''}<td>${item.kind==='group'
        ?`<span class="mihomo-delay-result mihomo-current-group" data-active-group="${esc(item.name)}"></span><small class="mihomo-current-note" data-active-group-note="${esc(item.name)}" hidden></small>`
        :`<span class="mihomo-delay-result" data-outbound-delay="${esc(item.name)}"></span>`}</td><td><button type="button" class="mihomo-icon" data-test-outbound="${esc(item.name)}">${SF('thunderbolt')}</button></td><td><div class="mihomo-actions">${custom&&!item.sourceSubscriptionId?`<button class="mihomo-icon" data-outbound-up="${esc(item.id)}" title="${muiT('mh.moveUp')}" ${position===0?'disabled':''}>${SF('arrow-up')}</button><button class="mihomo-icon" data-outbound-down="${esc(item.id)}" title="${muiT('mh.moveDown')}" ${position===lastPosition?'disabled':''}>${SF('arrow-down')}</button><button class="mihomo-icon" data-outbound-edit="${esc(item.id)}" title="${muiT('action.edit')}">${SF('edit')}</button><button class="mihomo-icon danger" data-outbound-delete="${esc(item.id)}" title="${muiT('common.delete')}">${SF('delete')}</button>`:'—'}</div></td></tr>`;
    }).join('')}</tbody></table></div>`;
    // Skip the destructive innerHTML update on the 5-second state poll.
    // Transient results and counters are painted in place after the cache check.
    if(outboundTableMarkup.get(box)!==markup||!box.querySelector('.mihomo-table')){
      box.innerHTML=markup;
      outboundTableMarkup.set(box,markup);
      bindOutboundTable();
      $$('[data-test-outbound]',box).forEach(button=>button.onclick=()=>testOutbound(button));
    }
    paintOutboundTransientState(box,rows,showTraffic);
    if(manual||subscribed){
      paintActiveGroupResults();
      refreshActiveGroups();
    }
  }
  function paintOutboundTransientState(box,rows,showTraffic){
    const byName=new Map(rows.map(item=>[item.name,item]));
    $$('[data-outbound-delay]',box).forEach(node=>{
      const result=delayLabel(node.dataset.outboundDelay)||'—';
      if(node.textContent!==result)node.textContent=result;
      if(node.title!==result)node.title=result;
    });
    $$('[data-test-outbound]',box).forEach(button=>{
      const item=byName.get(button.dataset.testOutbound);
      if(!item)return;
      const reason=outboundTestUnavailableReason(item);
      const testing=delayResults.get(button.dataset.testOutbound)==='Testing';
      button.disabled=!!reason||testing;
      button.classList.toggle('mihomo-test-running',testing);
      const title=reason||muiT('mh.testOutbound');
      if(button.title!==title)button.title=title;
    });
    if(showTraffic)$$('[data-outbound-traffic]',box).forEach(node=>{
      const counters=app.state?.state?.outboundTraffic?.[node.dataset.outboundTraffic];
      const traffic=fmt(counters?.up||0)+' / '+fmt(counters?.down||0);
      if(node.textContent!==traffic)node.textContent=traffic;
    });
  }
  function bindOutboundTable(){
    $$('[data-outbound-edit]',root).forEach(button=>button.onclick=()=>openOutboundModal(button.dataset.outboundEdit));
    $$('[data-outbound-delete]',root).forEach(button=>button.onclick=()=>deleteOutbound(button.dataset.outboundDelete));
    $$('[data-outbound-up]',root).forEach(button=>button.onclick=()=>moveOutbound(button.dataset.outboundUp,-1));
    $$('[data-outbound-down]',root).forEach(button=>button.onclick=()=>moveOutbound(button.dataset.outboundDown,1));
  }
  function moveOutbound(id,delta){
    const index=draft.outbounds.findIndex(item=>item.id===id);
    const kind=draft.outbounds[index]?.kind;
    const peers=draft.outbounds.map((item,position)=>({item,position})).filter(x=>
      x.item.kind===kind && (kind!=='group'||isSubscriptionGroup(x.item)===isSubscriptionGroup(draft.outbounds[index]))
    );
    const at=peers.findIndex(x=>x.position===index);
    const next=peers[at+delta]?.position??-1;
    if(index<0||next<0||next>=draft.outbounds.length)return;
    [draft.outbounds[index],draft.outbounds[next]]=[draft.outbounds[next],draft.outbounds[index]];
    markDirty();
  }
  function outboundDependencies(name){
    const result=[];
    for(const item of draft.outbounds){
      if(item.kind==='group'&&(item.proxies||[]).includes(name))result.push(muiT('mh.depGroup',{name:item.name}));
      if(item.kind==='proxy'&&item.dialerProxy===name)result.push(`Dialer Proxy ${item.name}`);
    }
    for(const rule of draft.routingRules)if(rule.target===name)result.push(muiT('mh.depRule',{type:rule.type}));
    if(currentWarpOutbound()?.name===name&&(draft.basics.warpDomains||[]).length)result.push('Basics / WARP Routing');
    return result;
  }
  // A balancer cannot be deleted while routing rules still target it.
  // Display ALL referenced rules without changing configuration on dismissal.
  function showBalancerDependencyWarning(item,rules){
    const previousFocus=document.activeElement;
    const backdrop=document.createElement('div');
    backdrop.id='mihomo-balancer-use-warning';
    backdrop.className='modal-backdrop mui-dialog mui-balancer-use-backdrop open';
    const panel=document.createElement('section');
    panel.className='modal-panel narrow mui-dialog-panel mui-balancer-use-panel';
    panel.setAttribute('role','alertdialog');
    panel.setAttribute('aria-modal','true');
    panel.setAttribute('aria-labelledby','mihomo-balancer-use-title');
    panel.setAttribute('aria-describedby','mihomo-balancer-use-message');

    const header=document.createElement('header');
    header.className='mui-balancer-use-header';
    const icon=document.createElement('span');
    icon.className='mui-balancer-use-icon';
    icon.textContent='!';
    icon.setAttribute('aria-hidden','true');
    const title=document.createElement('h2');
    title.id='mihomo-balancer-use-title';
    title.textContent=muiT('mh.balancerInUseTitle');
    header.append(icon,title);
    const body=document.createElement('div');
    body.className='modal-content mui-balancer-use-content';
    body.id='mihomo-balancer-use-message';
    const intro=document.createElement('p');
    intro.className='mui-balancer-use-intro';
    const description=document.createElement('p');
    description.className='mui-balancer-use-advice';

    if(rules.length===1){
      const label=rules[0].type+' → '+rules[0].target;
      intro.textContent=muiT('mh.balancerUsedSingle',{name:item.name,rule:label});
      description.textContent=muiT('mh.balancerResolveSingle',{name:item.name,rule:label});
      body.append(intro,description);
    }else{
      intro.textContent=muiT('mh.balancerUsedMultiple',{name:item.name});
      const list=document.createElement('ul');
      list.className='mui-balancer-use-rules';
      for(const rule of rules){
        const entry=document.createElement('li');
        entry.textContent=rule.type+' → '+rule.target;
        list.appendChild(entry);
      }
      description.textContent=muiT('mh.balancerResolveMultiple',{name:item.name});
      body.append(intro,list,description);
    }
    const footer=document.createElement('footer');
    footer.className='modal-footer mui-balancer-use-actions';
    const dismiss=document.createElement('button');
    dismiss.type='button';
    dismiss.className='outline-btn';
    dismiss.textContent=muiT('mh.balancerUnderstood');
    const navigate=document.createElement('button');
    navigate.type='button';
    navigate.className='primary-btn';
    navigate.textContent=muiT('mh.balancerGoToRules');
    footer.append(dismiss,navigate);
    panel.append(header,body,footer);
    backdrop.appendChild(panel);

    const finish=(goToRules=false)=>{
      document.removeEventListener('keydown',onKey,true);
      backdrop.remove();
      if(goToRules){
        setTab('routing');
        const tbody=$('#mihomo-rule-table tbody');
        const rowNodes=tbody?Array.from(tbody.children):[];
        const managedCount=basicsRuleRows().length;
        let first=null;
        for(const rule of rules){
          const index=draft.routingRules.findIndex(candidate=>candidate.id===rule.id);
          const row=index>=0?rowNodes[index+managedCount]:null;
          if(row){row.classList.add('mihomo-dependent-rule');first ||= row;}
        }
        if(first){
          first.scrollIntoView({block:'center',behavior:'smooth'});
          first.querySelector('[data-rule-edit]')?.focus({preventScroll:true});
        }
      }else if(previousFocus&&document.contains(previousFocus)){
        previousFocus.focus?.({preventScroll:true});
      }
    };
    const onKey=event=>{
      if(event.key==='Escape'){
        event.preventDefault();event.stopPropagation();finish();
      }else if(event.key==='Tab'){
        event.preventDefault();
        const controls=[dismiss,navigate];
        const index=controls.indexOf(document.activeElement);
        controls[(index+(event.shiftKey?controls.length-1:1)+controls.length)%controls.length].focus();
        // The two controls form a closed focus loop.
      }
    };
    dismiss.onclick=()=>finish();
    navigate.onclick=()=>finish(true);
    backdrop.addEventListener('mousedown',event=>{if(event.target===backdrop)finish();});
    document.addEventListener('keydown',onKey,true);
    document.body.appendChild(backdrop);
    requestAnimationFrame(()=>dismiss.focus());
  }

  async function deleteOutbound(id){
    const item=draft.outbounds.find(candidate=>candidate.id===id);if(!item)return;
    const dependencies=outboundDependencies(item.name);
    if(dependencies.length){
      const rules=draft.routingRules.filter(rule=>rule.target===item.name);
      if(item.kind==='group'&&rules.length&&rules.length===dependencies.length){
        showBalancerDependencyWarning(item,rules);
      }else{
        toast(muiT('mh.cannotDelete',{deps:dependencies.join(muiT('common.listSep')),name:item.name}),true);
      }
      return;
    }
    if(!await muiConfirm(muiT('mh.confirmDeleteOutbound',{name:item.name}),{danger:true}))return;
    draft.outbounds=draft.outbounds.filter(candidate=>candidate.id!==id);markDirty();
  }

  function basicsRuleRows(){
    const b=draft.basics,rows=[];
    const domain=(value,target)=>{const colon=value.indexOf(':'),prefix=colon<0?'domain':value.slice(0,colon),payload=colon<0?value:value.slice(colon+1);return {type:({geosite:'GEOSITE',domain:'DOMAIN-SUFFIX',full:'DOMAIN',keyword:'DOMAIN-KEYWORD'})[prefix]||'DOMAIN-SUFFIX',payload,target};};
    for(const value of b.blockIps||[])rows.push({type:value==='private'||value.startsWith('geoip:')?'GEOIP':'IP-CIDR',payload:value==='private'?'LAN':value.replace(/^geoip:/,''),target:'REJECT'});
    for(const value of b.blockDomains||[])rows.push(domain(value,'REJECT'));
    for(const value of b.ipv4Domains||[])rows.push(domain(value,'MUI-IPV4'));
    const warp=currentWarpOutbound();for(const value of b.warpDomains||[])rows.push(domain(value,warp?.name||'warp'));
    return rows;
  }
  // Only the visible label is translated. Stored rule.type/option.value,
  // API payloads and the generated Mihomo YAML retain their exact codes.
  const russianRuleTypes={
    LIST:'GEO SITE КАТЕГОРИИ + ДОМЕНЫ И IP',
    DOMAIN:'Точное совпадение домена',
    'DOMAIN-SUFFIX':'Домен и его поддомены',
    'DOMAIN-KEYWORD':'Слово или часть домена',
    'DOMAIN-WILDCARD':'Домен по шаблону',
    'DOMAIN-REGEX':'Домен по регулярному выражению',
    GEOSITE:'Категория сайтов GeoSite',
    'IP-CIDR':'Подсеть IP назначения',
    'IP-CIDR6':'Подсеть IPv6 назначения',
    'IP-SUFFIX':'Суффикс IP назначения',
    'IP-ASN':'Автономная система IP назначения',
    GEOIP:'Страна IP назначения',
    'SRC-GEOIP':'Страна IP источника',
    'SRC-IP-ASN':'Автономная система IP источника',
    'SRC-IP-CIDR':'Подсеть IP источника',
    'SRC-IP-SUFFIX':'Суффикс IP источника',
    'DST-PORT':'Порт назначения',
    'SRC-PORT':'Исходный порт',
    'IN-PORT':'Порт входящего подключения',
    'IN-TYPE':'Тип входящего подключения',
    'IN-USER':'Пользователь входящего подключения',
    'IN-NAME':'Имя входящего подключения',
    'REMATCH-NAME':'Имя повторного маршрута',
    'PROCESS-PATH':'Путь к программе',
    'PROCESS-PATH-WILDCARD':'Шаблон пути к программе',
    'PROCESS-PATH-REGEX':'Путь программы по регулярному выражению',
    'PROCESS-NAME':'Имя программы',
    'PROCESS-NAME-WILDCARD':'Шаблон имени программы',
    'PROCESS-NAME-REGEX':'Имя программы по регулярному выражению',
    UID:'Идентификатор пользователя процесса',
    NETWORK:'Сетевой протокол TCP или UDP',
    DSCP:'Метка приоритета трафика',
    AND:'Все вложенные условия одновременно'
  };
  function ruleTypeDisplayLabel(type,full=false){
    if(type==='MATCH')return window.muiGetLang?.()==='ru'?'ВЕСЬ ОСТАЛЬНОЙ ТРАФИК':'MATCH';
    if(type==='LIST'){
      if(window.muiGetLang?.()!=='ru')return full?'LISTS OF CATEGORIES, DOMAINS AND IPs':'LISTS';
      return russianRuleTypes.LIST;
    }
    const description=window.muiGetLang?.()==='ru'?russianRuleTypes[type]:null;
    return description?type+' — '+description:type;
  }
  function refreshRuleTypeLabels(){
    const select=$('#mihomo-rule-form')?.elements.type;
    if(!select)return;
    for(const option of select.options)option.textContent=ruleTypeDisplayLabel(option.value,true);
  }
  function ruleReadableType(rule){
    return ruleTypeDisplayLabel(window.MUIRuleLists?.decode(rule)?'LIST':rule.type);
  }
  function ruleReadablePayload(rule){
    const decoded=window.MUIRuleLists?.decode(rule);
    if(!decoded)return rule.type==='MATCH'?muiT('mh.matchAll'):rule.payload||'—';
    const geo=window.MUIRuleLists.lines(decoded.geos).length;
    const domains=window.MUIRuleLists.lines(decoded.domains).length;
    return window.muiGetLang?.()==='ru'
      ?'Категории: '+geo+' · Домены/IP: '+domains
      :'Geo categories: '+geo+' · Domains/IPs: '+domains;
  }
  // Help in a fixed, shared tooltip to avoid being clipped by table overflow.
  const ruleHelpDescriptions={
    LIST:['Списки GeoSite/GeoIP, доменов и IP; совпадения одного условия достаточно.','GeoSite/GeoIP, domain and IP lists. Any one entry can match.'],
    DOMAIN:['Точное совпадение доменного имени.','Exact domain name match.'],
    'DOMAIN-SUFFIX':['Домен и все его поддомены.','Domain and its subdomains.'],
    'DOMAIN-KEYWORD':['Фрагмент в доменном имени.','Keyword inside a domain name.'],
    'DOMAIN-WILDCARD':['Шаблон домена с символами * и ?.','Domain matching with * and ? wildcards.'],
    'DOMAIN-REGEX':['Домен по регулярному выражению.','Domain matched by a regular expression.'],
    GEOSITE:['Домен из указанной категории GeoSite.','Domain belonging to a GeoSite category.'],
    'IP-CIDR':['IP назначения в заданном диапазоне CIDR.','Destination IP in a CIDR range.'],
    'IP-CIDR6':['IPv6 назначения в заданном диапазоне CIDR.','Destination IPv6 in a CIDR range.'],
    'IP-SUFFIX':['Проверяет суффикс IP назначения.','Matches a destination IP suffix.'],
    'IP-ASN':['Автономная система (ASN) IP назначения.','Autonomous system (ASN) of the destination IP.'],
    GEOIP:['Страна IP назначения. RU означает Россию; домен иногда требуется разрешить через DNS.','Destination IP country. RU means Russia; a domain may need DNS resolution.'],
    'SRC-GEOIP':['Страна IP-адреса источника.','Country of the source IP.'],
    'SRC-IP-ASN':['Автономная система (ASN) IP источника.','ASN of the source IP.'],
    'SRC-IP-CIDR':['IP источника в диапазоне CIDR.','Source IP in a CIDR range.'],
    'SRC-IP-SUFFIX':['Суффикс IP источника.','Source IP suffix.'],
    'DST-PORT':['Порт назначения или диапазон портов.','Destination port or range.'],
    'SRC-PORT':['Исходный порт или диапазон портов.','Source port or range.'],
    'IN-PORT':['Порт входящего подключения Mihomo.','Mihomo inbound port.'],
    'IN-TYPE':['Тип входящего подключения, например SOCKS.','Inbound type, e.g. SOCKS.'],
    'IN-USER':['Имя пользователя входящего подключения.','Inbound username.'],
    'IN-NAME':['Имя входящего подключения.','Inbound name.'],
    'REMATCH-NAME':['Имя, установленное исходящим rematch.','Name set by rematch outbound.'],
    'PROCESS-PATH':['Путь программы, создавшей соединение.','Path of the application opening the connection.'],
    'PROCESS-PATH-WILDCARD':['Шаблон пути программы с * и ?.','Process path using * and ? wildcards.'],
    'PROCESS-PATH-REGEX':['Путь программы по регулярному выражению.','Process path regular expression.'],
    'PROCESS-NAME':['Имя программы, создавшей соединение.','Process name opening the connection.'],
    'PROCESS-NAME-WILDCARD':['Шаблон имени программы.','Process name using wildcards.'],
    'PROCESS-NAME-REGEX':['Имя программы по регулярному выражению.','Process name regular expression.'],
    UID:['Числовой идентификатор пользователя процесса.','Numeric user ID (UID) of the process.'],
    NETWORK:['Сетевой протокол TCP или UDP.','Network protocol TCP or UDP.'],
    DSCP:['Маркировка трафика DSCP.','DSCP traffic marking.'],
    AND:['Логическое И: необходимы все вложенные условия.','Logical AND: every nested condition must match.'],
    MATCH:['Весь оставшийся трафик; обычно последнее правило.','Matches all remaining traffic; normally the last rule.']
  };
  function ruleHelpButton(kind,type=''){
    const isType=kind==='type';
    const label=isType?muiT('mh.ruleTypeHelpTitle')+': '+ruleTypeDisplayLabel(type):muiT('mh.noResolveHelpTitle');
    return '<button class="mihomo-rule-help-trigger" type="button" data-mihomo-help="'+kind+'"'+
      (isType?' data-mihomo-rule-type="'+esc(type)+'"':'')+
      ' aria-label="'+esc(label)+'" aria-controls="mihomo-rule-help-popup" aria-expanded="false">!</button>';
  }
  function ruleHelpText(button){
    if(button.dataset.mihomoHelp==='smart-health')return window.muiGetLang?.()==='ru'
      ? 'Тонкие настройки мониторинга здоровья серверов. Рекомендуется не менять значения по умолчанию. Меняйте если только знаете зачем.'
      : 'Advanced server health monitoring settings. Keeping the default values is recommended. Change them only if you know why.';
    if(button.dataset.mihomoHelp==='no-resolve')return muiT('mh.noResolveHelpText');
    const type=String(button.dataset.mihomoRuleType||'').toUpperCase();
    const parts=ruleHelpDescriptions[type];
    return parts?parts[window.muiGetLang?.()==='ru'?0:1]:muiT('mh.ruleHelpUnknown');
  }
  let ruleHelpPopup=null,ruleHelpAnchor=null,ruleHelpPinned=false;
  function hideRuleHelp(){
    if(!ruleHelpPopup)return;
    ruleHelpPopup.hidden=true;
    ruleHelpAnchor?.setAttribute('aria-expanded','false');
    ruleHelpAnchor=null;ruleHelpPinned=false;
  }
  function showRuleHelp(button,pinned=false){
    if(!ruleHelpPopup||!button?.isConnected)return;
    if(ruleHelpAnchor!==button)ruleHelpAnchor?.setAttribute('aria-expanded','false');
    ruleHelpAnchor=button;ruleHelpPinned=pinned;
    ruleHelpPopup.textContent=ruleHelpText(button);
    ruleHelpPopup.hidden=false;
    button.setAttribute('aria-expanded','true');
    const anchor=button.getBoundingClientRect(),popup=ruleHelpPopup.getBoundingClientRect();
    ruleHelpPopup.style.left=Math.max(8,Math.min(window.innerWidth-popup.width-8,anchor.left+anchor.width/2-popup.width/2))+'px';
    ruleHelpPopup.style.top=(anchor.bottom+popup.height+10<window.innerHeight?anchor.bottom+8:Math.max(8,anchor.top-popup.height-8))+'px';
  }
  function setupRuleHelp(){
    ruleHelpPopup=document.createElement('div');
    ruleHelpPopup.id='mihomo-rule-help-popup';
    ruleHelpPopup.className='mihomo-rule-help-popup';
    ruleHelpPopup.setAttribute('role','tooltip');
    ruleHelpPopup.hidden=true;
    document.body.appendChild(ruleHelpPopup);
    const trigger=target=>target?.closest?.('[data-mihomo-help]');
    document.addEventListener('pointerover',event=>{const button=trigger(event.target);if(button&&!ruleHelpPinned)showRuleHelp(button);});
    document.addEventListener('pointerout',event=>{
      const button=trigger(event.target);
      if(button&&button===ruleHelpAnchor&&!button.contains(event.relatedTarget)&&!ruleHelpPinned)hideRuleHelp();
    });
    document.addEventListener('focusin',event=>{const button=trigger(event.target);if(button&&!ruleHelpPinned)showRuleHelp(button);});
    document.addEventListener('focusout',event=>{
      const button=trigger(event.target);
      if(button&&button===ruleHelpAnchor&&!button.contains(event.relatedTarget)&&!ruleHelpPinned)hideRuleHelp();
    });
    document.addEventListener('click',event=>{
      const button=trigger(event.target);
      if(!button){if(ruleHelpAnchor)hideRuleHelp();return;}
      if(button===ruleHelpAnchor&&ruleHelpPinned)hideRuleHelp();else showRuleHelp(button,true);
    });
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&ruleHelpAnchor){hideRuleHelp();event.stopPropagation();}
    });
    document.addEventListener('scroll',()=>{
      // Keyboard focus may scroll the table into view: reposition rather than
      // immediately hiding the help that a keyboard user just opened.
      if(ruleHelpAnchor&&document.activeElement===ruleHelpAnchor)showRuleHelp(ruleHelpAnchor,ruleHelpPinned);
      else hideRuleHelp();
    },true);
    window.addEventListener('resize',hideRuleHelp);
  }
  // Every user rule is retained in state.json, even when disabled. The
  // backend omits disabled rules from Mihomo, but requires MATCH always ON.
  function ruleIsEnabled(rule){return rule.enabled!==false;}
  let draggedRuleID='';
  let dragSourceRow=null;
  let dragOriginalOrder=null;
  let dragOriginalSlots=null;
  function beginRulePreview(handle){
    const row=handle.closest('[data-rule-row]');
    if(!row||!draft.routingRules.some(rule=>rule.id===row.dataset.ruleRow&&rule.type!=='MATCH'))return false;
    draggedRuleID=row.dataset.ruleRow;
    dragSourceRow=row;
    dragOriginalOrder=draft.routingRules.map(rule=>rule.id);
    // Freeze the initial slot centres: moving a live DOM row shifts the
    // neighbouring rows, so hit-testing their *new* rectangles can oscillate.
    dragOriginalSlots=$$('[data-rule-row]',$('#mihomo-rule-table'))
      .filter(item=>item!==row)
      .map(item=>({
        id:item.dataset.ruleRow,
        midpoint:(item.getBoundingClientRect().top+item.getBoundingClientRect().bottom)/2,
        locked:draft.routingRules.some(rule=>rule.id===item.dataset.ruleRow&&rule.type==='MATCH')
      }));
    row.classList.add('mihomo-rule-preview');
    $('#mihomo-rule-table').classList.add('mihomo-rule-previewing');
    return true;
  }
  // The visible row moves into its proposed slot while the pointer is still
  // held. No draft state is changed until drop, so cancellation is lossless.
  function previewRuleAtPointer(clientY){
    if(!dragSourceRow||!dragOriginalSlots)return;
    // Work in stable original priority slots. The fallback is never counted
    // as an insertion point: everything always lands before MATCH.
    const regular=dragOriginalSlots.filter(slot=>!slot.locked);
    const index=regular.filter(slot=>clientY>slot.midpoint).length;
    const box=$('#mihomo-rule-table');
    const otherRows=$$('[data-rule-row]',box).filter(row=>row!==dragSourceRow);
    const before=otherRows[index];
    if(!before||before===dragSourceRow.nextElementSibling)return;
    before.before(dragSourceRow);
    const managedCount=basicsRuleRows().length;
    $$('[data-rule-row]',box).forEach((row,position)=>{
      const number=row.querySelector('.mihomo-rule-priority-number');
      if(number)number.textContent=managedCount+position+1;
    });
  }
  function finishRulePreview(apply){
    if(!dragSourceRow)return;
    const box=$('#mihomo-rule-table'),row=dragSourceRow;
    const ordered=$$('[data-rule-row]',box).map(element=>element.dataset.ruleRow);
    const original=dragOriginalOrder||[];
    const valid=apply&&ordered.length===original.length&&
      ordered[ordered.length-1]===original[original.length-1]&&
      ordered.every(id=>original.includes(id));
    const changed=valid&&ordered.some((id,index)=>id!==original[index]);
    if(!changed){
      // Restore DOM order on Escape, pointercancel and drops outside the table.
      const tbody=row.closest('tbody');
      if(tbody){
        const nodes=new Map($$('[data-rule-row]',box).map(item=>[item.dataset.ruleRow,item]));
        original.forEach(id=>{const item=nodes.get(id);if(item)tbody.appendChild(item);});
      }
    }
    row.classList.remove('mihomo-rule-preview');
    box.classList.remove('mihomo-rule-previewing');
    draggedRuleID='';dragSourceRow=null;dragOriginalOrder=null;dragOriginalSlots=null;
    if(changed){
      const byID=new Map(draft.routingRules.map(rule=>[rule.id,rule]));
      draft.routingRules=ordered.map(id=>byID.get(id));
      markDirty();
    }else{
      const managedCount=basicsRuleRows().length;
      $$('[data-rule-row]',box).forEach((item,index)=>{
        const number=item.querySelector('.mihomo-rule-priority-number');
        if(number)number.textContent=managedCount+index+1;
      });
    }
  }
  // Pointer-driven drag avoids the native HTML DnD cancellation that occurs
  // when a dragged table row is reparented during the live preview.
  let pendingRulePointer=null;
  let floatingRuleGhost=null;
  function clearFloatingRuleGhost(){
    floatingRuleGhost?.remove();
    floatingRuleGhost=null;
  }
  function placeFloatingRuleGhost(x,y){
    if(!floatingRuleGhost)return;
    floatingRuleGhost.style.left=(x+16)+'px';
    floatingRuleGhost.style.top=(y+12)+'px';
  }
  function startFloatingRuleGhost(handle,x,y){
    const rule=draft.routingRules.find(item=>item.id===handle.dataset.ruleDrag);
    if(!rule)return;
    floatingRuleGhost=document.createElement('div');
    floatingRuleGhost.className='mihomo-rule-drag-ghost';
    const name=document.createElement('strong'),outbound=document.createElement('span');
    name.textContent=ruleReadableType(rule);
    outbound.textContent='→ '+rule.target;
    floatingRuleGhost.append(name,outbound);
    document.body.appendChild(floatingRuleGhost);
    placeFloatingRuleGhost(x,y);
  }
  function stopRulePointer(commit){
    if(!pendingRulePointer)return;
    const wasDragging=!!dragSourceRow;
    pendingRulePointer=null;
    clearFloatingRuleGhost();
    if(wasDragging)finishRulePreview(commit);
  }
  function onRulePointerMove(event){
    if(!pendingRulePointer||pendingRulePointer.id!==event.pointerId)return;
    const pending=pendingRulePointer;
    if(!dragSourceRow&&Math.hypot(event.clientX-pending.x,event.clientY-pending.y)<5)return;
    if(!dragSourceRow){
      if(!beginRulePreview(pending.handle)){stopRulePointer(false);return;}
      startFloatingRuleGhost(pending.handle,event.clientX,event.clientY);
    }
    event.preventDefault();
    placeFloatingRuleGhost(event.clientX,event.clientY);
    previewRuleAtPointer(event.clientY);
  }
  function onRulePointerUp(event){
    if(!pendingRulePointer||pendingRulePointer.id!==event.pointerId)return;
    const box=$('#mihomo-rule-table');
    const table=box?.querySelector('table');
    const rect=table?.getBoundingClientRect();
    const within=!!rect&&event.clientX>=rect.left&&event.clientX<=rect.right&&
      event.clientY>=rect.top&&event.clientY<=rect.bottom;
    if(within)previewRuleAtPointer(event.clientY);
    stopRulePointer(within);
  }
  function onRulePointerCancel(event){
    if(pendingRulePointer?.id===event.pointerId)stopRulePointer(false);
  }
  function onRuleDragEscape(event){
    if(event.key==='Escape'&&pendingRulePointer){
      event.preventDefault();stopRulePointer(false);
    }
  }
  document.addEventListener('pointermove',onRulePointerMove,{passive:false});
  document.addEventListener('pointerup',onRulePointerUp);
  document.addEventListener('pointercancel',onRulePointerCancel);
  document.addEventListener('keydown',onRuleDragEscape);
  function moveRuleTo(id,targetID,after=false){
    if(!id||!targetID||id===targetID)return;
    const from=draft.routingRules.findIndex(rule=>rule.id===id);
    const target=draft.routingRules.findIndex(rule=>rule.id===targetID);
    if(from<0||target<0||draft.routingRules[from].type==='MATCH')return;
    const [rule]=draft.routingRules.splice(from,1);
    const to=draft.routingRules.findIndex(item=>item.id===targetID);
    // Dragging onto MATCH inserts immediately before it; MATCH never moves.
    const insertAt=draft.routingRules[to].type==='MATCH'?to:to+(after?1:0);
    draft.routingRules.splice(insertAt,0,rule);
    markDirty();
  }
  function toggleRule(id,enabled){
    const rule=draft.routingRules.find(item=>item.id===id);
    if(!rule||rule.type==='MATCH')return;
    if(ruleIsEnabled(rule)===enabled)return;
    if(enabled)delete rule.enabled; // legacy ON serializes identically
    else rule.enabled=false;
    markDirty();
  }
  function renderRules(){
    hideRuleHelp();
    const box=$('#mihomo-rule-table');
    ensureFinalMatch();
    const managed=basicsRuleRows();
    const enabledTitle=muiT('mh.ruleEnabled');
    const readonlyTitle=muiT('mh.managedRuleSwitch');
    const lockedTitle=muiT('mh.matchAlwaysOn');
    const managedHTML=managed.map((rule,index)=>
      '<tr class="mihomo-managed-rule"><td>'+(index+1)+'</td>'+
      '<td><span class="mihomo-rule-type-with-help"><span class="mihomo-pill">'+esc(ruleTypeDisplayLabel(rule.type))+
      '</span>'+ruleHelpButton('type',rule.type)+'</span></td><td>'+esc(rule.payload)+'</td><td>'+esc(rule.target)+'</td><td>—</td>'+
      '<td><div class="mihomo-actions mihomo-rule-controls"><span class="mihomo-pill group">Basics</span>'+
      '<label class="mihomo-rule-switch" title="'+esc(readonlyTitle)+'"><input type="checkbox" checked disabled aria-label="'+esc(readonlyTitle)+'"><span class="mihomo-rule-switch-track"></span></label></div></td></tr>').join('');
    const rows=draft.routingRules.map((rule,index)=>{
      const locked=rule.type==='MATCH';
      const enabled=ruleIsEnabled(rule);
      const next=draft.routingRules[index+1];
      const toggleLabel=locked?lockedTitle:enabledTitle;
      return '<tr data-rule-row="'+esc(rule.id)+'" class="'+(!enabled?'mihomo-rule-off ':'')+(locked?'mihomo-rule-default':'')+'">'+
        '<td class="mihomo-rule-order"><div class="mihomo-rule-priority-cell">'+
        (locked?'<span class="mihomo-rule-locked" title="'+esc(lockedTitle)+'" aria-label="'+esc(lockedTitle)+'">🔒</span>':
        '<span class="mihomo-rule-drag" role="button" tabindex="0" data-rule-drag="'+esc(rule.id)+'" title="'+esc(muiT('mh.dragPriority'))+'" aria-label="'+esc(muiT('mh.dragPriority'))+'">⠿</span>')+
        '<span class="mihomo-rule-priority-number">'+(managed.length+index+1)+'</span></div></td>'+
        '<td><span class="mihomo-rule-type-with-help"><span class="mihomo-pill">'+esc(ruleReadableType(rule))+'</span>'+
        ruleHelpButton('type',window.MUIRuleLists?.decode(rule)?'LIST':rule.type)+'</span></td>'+
        '<td><div class="mihomo-rule-payload" title="'+esc(rule.payload||'')+'">'+esc(ruleReadablePayload(rule))+'</div></td>'+
        '<td class="mihomo-name">'+esc(rule.target)+'</td>'+
        '<td>'+(rule.noResolve?'<span class="mihomo-rule-type-with-help"><span class="mihomo-pill group">No-Resolve</span>'+
        ruleHelpButton('no-resolve')+'</span>':'—')+'</td>'+
        '<td><div class="mihomo-actions mihomo-rule-controls">'+
        '<button class="mihomo-icon" data-rule-up="'+esc(rule.id)+'" title="'+esc(muiT('mh.moveUp'))+'"'+
        (index===0||locked?' disabled':'')+'>'+SF('arrow-up')+'</button>'+
        '<button class="mihomo-icon" data-rule-down="'+esc(rule.id)+'" title="'+esc(muiT('mh.moveDown'))+'"'+
        (locked||!next||next.type==='MATCH'?' disabled':'')+'>'+SF('arrow-down')+'</button>'+
        '<button class="mihomo-icon" data-rule-edit="'+esc(rule.id)+'" title="'+esc(muiT('action.edit'))+'">'+SF('edit')+'</button>'+
        (locked?'':'<button class="mihomo-icon danger" data-rule-delete="'+esc(rule.id)+'" title="'+esc(muiT('common.delete'))+'">'+SF('delete')+'</button>')+
        '<label class="mihomo-rule-switch'+(locked?' mihomo-rule-switch-locked':'')+'" title="'+esc(toggleLabel)+'"><input type="checkbox" data-rule-toggle="'+esc(rule.id)+'"'+
        (enabled?' checked':'')+(locked?' disabled':'')+' aria-label="'+esc(toggleLabel)+'"><span class="mihomo-rule-switch-track"></span>'+
        (locked?'<svg class="mihomo-rule-switch-padlock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>':'')+'</label>'+
        '</div></td></tr>';
    }).join('');
    box.innerHTML='<div class="mihomo-table-wrap"><table class="mihomo-table"><thead><tr><th>#</th><th>'+muiT('mh.colRuleType')+
      '</th><th>'+muiT('mh.colPayload')+'</th><th>'+muiT('mh.colOutbound')+'</th><th>'+muiT('mh.colOptions')+
      '</th><th>'+muiT('mh.colActions')+'</th></tr></thead><tbody>'+managedHTML+rows+'</tbody></table></div>';
    $$('[data-rule-edit]',root).forEach(button=>button.onclick=()=>openRuleModal(button.dataset.ruleEdit));
    $$('[data-rule-delete]',root).forEach(button=>button.onclick=()=>deleteRule(button.dataset.ruleDelete));
    $$('[data-rule-up]',root).forEach(button=>button.onclick=()=>moveRule(button.dataset.ruleUp,-1));
    $$('[data-rule-down]',root).forEach(button=>button.onclick=()=>moveRule(button.dataset.ruleDown,1));
    $$('[data-rule-toggle]',root).forEach(input=>input.onchange=()=>toggleRule(input.dataset.ruleToggle,input.checked));
    // One predictable pointer interaction for mouse, pen and touch.
    // Keep listeners on document: moving the real row detaches its original
    // handle, which would otherwise drop pointer capture prematurely.
    $$('[data-rule-drag]',box).forEach(handle=>{
      handle.onpointerdown=event=>{
        if(event.button!==0||pendingRulePointer)return;
        pendingRulePointer={id:event.pointerId,x:event.clientX,y:event.clientY,handle};
        event.preventDefault();
      };
      // Keyboard users can continue using the adjacent up/down buttons.
      handle.onkeydown=event=>{
        if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')return;
        event.preventDefault();
        moveRule(handle.dataset.ruleDrag,event.key==='ArrowUp'?-1:1);
      };
    });
  }
  function moveRule(id,delta){
    const index=draft.routingRules.findIndex(rule=>rule.id===id),next=index+delta;
    if(index<0||next<0||next>=draft.routingRules.length||draft.routingRules[index].type==='MATCH'||draft.routingRules[next].type==='MATCH')return;
    [draft.routingRules[index],draft.routingRules[next]]=[draft.routingRules[next],draft.routingRules[index]];markDirty();
  }
  async function deleteRule(id){
    const rule=draft.routingRules.find(item=>item.id===id);if(!rule)return;
    if(rule.type==='MATCH'){toast(muiT('mh.matchUndeletable'),true);return;}
    if(!await muiConfirm(muiT('mh.confirmDeleteRule',{type:rule.type}),{danger:true}))return;
    draft.routingRules=draft.routingRules.filter(item=>item.id!==id);markDirty();
  }

  function targetOptions(selected='',forGroup=false,exclude=''){
    const base=forGroup?groupBuiltins:builtins;
    const names=[...base,...draft.outbounds.map(item=>item.name).filter(name=>name!==exclude)];
    return [...new Set(names)].map(name=>`<option value="${esc(name)}" ${name===selected?'selected':''}>${esc(targetDisplayName(name))}</option>`).join('');
  }
  function ensureModals(){
    if($('#mihomo-outbound-modal'))return;
    const outboundModal=document.createElement('div');outboundModal.className='modal-backdrop';outboundModal.id='mihomo-outbound-modal';outboundModal.innerHTML=`<section class="modal-panel mihomo-modal" role="dialog" aria-modal="true" aria-labelledby="mihomo-outbound-title"><header class="modal-titlebar"><span id="mihomo-outbound-title">Add Outbound</span><button type="button" class="modal-close" id="mihomo-outbound-close" data-mihomo-close aria-label="Закрыть">×</button></header><form id="mihomo-outbound-form" novalidate><div class="modal-content"><div class="mihomo-editor-tabs" role="tablist" aria-label="Outbound input"><button type="button" role="tab" id="outbound-form-tab" aria-controls="outbound-form-panel" aria-selected="true" data-outbound-mode="form">Form</button><button type="button" role="tab" id="outbound-yaml-tab" aria-controls="outbound-yaml-panel" aria-selected="false" data-outbound-mode="yaml">YAML</button><span class="ink-bar"></span></div><div id="outbound-form-panel" role="tabpanel" aria-labelledby="outbound-form-tab"><div class="mihomo-form-note" data-i18n-html="mh.formNote">Proxy Node 会写入 <code>proxies</code>；Proxy Group 会写入 <code>proxy-groups</code>。两者都可作为 Routing Rule 的目标。</div><div class="mihomo-form-grid">
      <input name="id" type="hidden"><input name="kind" type="hidden" value="proxy"><label class="mihomo-field"><span>Name</span><input name="name" maxlength="128" required placeholder="Hong Kong / Proxy"></label>
      <label class="mihomo-field"><span>Type</span><select name="type"></select></label><label class="mihomo-field" data-kind="proxy" data-types="ss,snell,socks5,http,vmess,vless,trojan,hysteria2,tuic,wireguard,openvpn"><span>Server</span><input name="server" placeholder="example.com"></label><label class="mihomo-field" data-kind="proxy" data-types="ss,snell,socks5,http,vmess,vless,trojan,hysteria2,tuic,wireguard,openvpn"><span>Port</span><input name="port" type="number" min="1" max="65535" placeholder="443"></label>
      <label class="mihomo-field" data-kind="proxy" data-types="socks5,http,openvpn"><span>Username</span><input name="username" autocomplete="off"></label><label class="mihomo-field" data-kind="proxy" data-types="ss,socks5,http,trojan,hysteria2,tuic,openvpn"><span>Password</span><input name="password" autocomplete="new-password"></label><label class="mihomo-field" data-kind="proxy" data-types="snell"><span data-i18n="mihomo.snellPsk">PSK</span><input name="snellPsk" autocomplete="new-password"></label>
      <label class="mihomo-field" data-kind="proxy" data-types="vmess,vless,tuic"><span>UUID</span><div style="display:flex;gap:7px"><input name="uuid" autocomplete="off"><button class="outline-btn" id="mihomo-generate-uuid" type="button" data-i18n="mh.generate">Generate</button></div></label><label class="mihomo-field" data-kind="proxy" data-types="tuic"><span>Token (TUIC v4)</span><input name="token" autocomplete="new-password"><small data-i18n="mh.tuicTokenNote">填写 Token，或使用 UUID + Password。</small></label>
      <label class="mihomo-field" data-kind="proxy" data-types="ss"><span>Cipher</span><select name="cipher"><option>aes-128-gcm</option><option selected>aes-256-gcm</option><option>chacha20-ietf-poly1305</option><option>2022-blake3-aes-128-gcm</option><option>2022-blake3-aes-256-gcm</option><option>2022-blake3-chacha20-poly1305</option></select></label><label class="mihomo-field" data-kind="proxy" data-types="vmess"><span>Alter ID</span><input name="alterId" type="number" min="0" value="0"></label>
      <label class="mihomo-field" data-kind="proxy" data-types="vmess"><span>VMess Cipher</span><select name="vmessCipher"><option>auto</option><option>none</option><option>aes-128-gcm</option><option>chacha20-poly1305</option></select></label><label class="mihomo-field" data-kind="proxy" data-types="vless"><span>Flow</span><input name="flow" placeholder="xtls-rprx-vision"></label><label class="mihomo-field" data-kind="proxy" data-types="vless"><span>Encryption</span><input name="encryption" value="none"></label>
      <label class="mihomo-field" data-kind="proxy" data-types="vmess,vless,trojan"><span>Network</span><select name="network"><option value="tcp">TCP</option><option value="ws">WebSocket</option><option value="grpc">gRPC</option></select></label><label class="mihomo-field" data-kind="proxy" data-network="ws"><span>WebSocket Path</span><input name="wsPath" placeholder="/"></label><label class="mihomo-field" data-kind="proxy" data-network="ws"><span>WebSocket Host</span><input name="wsHost"></label><label class="mihomo-field" data-kind="proxy" data-network="grpc"><span>gRPC Service Name</span><input name="grpcServiceName"></label>
      <label class="mihomo-field" data-kind="proxy" data-types="socks5,http,vmess,vless"><span>TLS</span><select name="tls"><option value="false">Disabled</option><option value="true">Enabled</option></select></label><label class="mihomo-field" data-kind="proxy" data-types="socks5,http,vmess,vless,trojan,hysteria2,tuic"><span>SNI / Server Name</span><input name="sni"></label><label class="mihomo-field" data-kind="proxy" data-types="vmess,vless,trojan,hysteria2,tuic"><span>ALPN</span><input name="alpn" placeholder="h2,http/1.1"></label><label class="mihomo-field" data-kind="proxy" data-types="ss,vmess,vless,trojan"><span>Client Fingerprint</span><input name="clientFingerprint" placeholder="chrome"></label>
      <label class="mihomo-field" data-kind="proxy" data-types="hysteria2"><span>Upload Bandwidth</span><input name="up" placeholder="100 Mbps"></label><label class="mihomo-field" data-kind="proxy" data-types="hysteria2"><span>Download Bandwidth</span><input name="down" placeholder="200 Mbps"></label><label class="mihomo-field" data-kind="proxy" data-types="hysteria2"><span>Obfs</span><select name="obfs"><option value="">None</option><option value="salamander">Salamander</option><option value="gecko">Gecko</option></select></label><label class="mihomo-field" data-kind="proxy" data-types="hysteria2"><span>Obfs Password</span><input name="obfsPassword"></label>
      <label class="mihomo-field" data-kind="proxy" data-types="tuic"><span>Congestion Controller</span><select name="congestionController"><option value="" data-i18n="proto.defaultPlain">Default</option><option value="cubic">cubic</option><option value="new_reno">new_reno</option><option value="bbr">bbr</option></select></label><label class="mihomo-field" data-kind="proxy" data-types="tuic"><span>UDP Relay Mode</span><select name="udpRelayMode"><option value="" data-i18n="proto.defaultPlain">Default</option><option value="native">native</option><option value="quic">quic</option></select></label>
      <div class="mihomo-field full" data-kind="proxy" data-types="snell"><span>Snell</span><div class="mihomo-form-grid"><label class="mihomo-field"><span data-i18n="mihomo.snellVersion">Version</span><select name="snellVersion"><option value="1">v1</option><option value="2">v2</option><option value="3">v3</option><option value="4">v4</option><option value="5">v5</option></select></label><label class="mihomo-check"><input name="snellReuse" type="checkbox"><span data-i18n="mihomo.snellReuse">Connection Reuse (v4/v5)</span></label><label class="mihomo-field"><span data-i18n="mihomo.snellObfsMode">Obfs Mode</span><select name="snellObfsMode"><option value="">none</option><option value="http">http</option><option value="tls">tls</option></select></label><label class="mihomo-field"><span data-i18n="mihomo.snellObfsHost">Obfs Host</span><input name="snellObfsHost" placeholder="bing.com"></label></div></div>
      <label class="mihomo-field" data-kind="proxy"><span>IP Version</span><select name="ipVersion"><option value="" data-i18n="proto.defaultDual">Default (dual)</option><option value="dual">dual</option><option value="ipv4">ipv4</option><option value="ipv6">ipv6</option><option value="ipv4-prefer">ipv4-prefer</option><option value="ipv6-prefer">ipv6-prefer</option></select></label><label class="mihomo-field" data-kind="proxy"><span>Interface Name</span><input name="interfaceName" placeholder="tun0 / ppp0"></label><label class="mihomo-field" data-kind="proxy"><span>Routing Mark</span><input name="routingMark" type="number" min="0" placeholder="0"></label><label class="mihomo-field" data-kind="proxy"><span>Dialer Proxy</span><select name="dialerProxy"></select></label>
      <div class="mihomo-field full" data-kind="proxy" data-types="wireguard"><span>WireGuard</span><div class="mihomo-form-grid"><label class="mihomo-field"><span>Local IPv4 / CIDR</span><input name="wireGuardIp" placeholder="10.0.0.2/24"></label><label class="mihomo-field"><span>Local IPv6 / CIDR</span><input name="wireGuardIpv6" placeholder="fd00::2/64"></label><label class="mihomo-field"><span>Private Key</span><input name="wireGuardPrivateKey" autocomplete="off"></label><label class="mihomo-field"><span>Peer Public Key</span><input name="wireGuardPublicKey" autocomplete="off"></label><label class="mihomo-field"><span>Pre-shared Key</span><input name="wireGuardPreSharedKey" autocomplete="off"></label><label class="mihomo-field"><span>Reserved</span><input name="wireGuardReserved" pattern="[0-9]{1,3}( *, *[0-9]{1,3}){2}" placeholder="209,98,59"></label><label class="mihomo-field"><span>MTU</span><input name="wireGuardMtu" type="number" min="0" placeholder="1420"></label><label class="mihomo-field"><span>Persistent Keepalive</span><input name="wireGuardPersistentKeepalive" type="number" min="0"></label><label class="mihomo-field"><span>Workers</span><input name="wireGuardWorkers" type="number" min="0"></label><label class="mihomo-field"><span>DNS</span><input name="wireGuardDns" placeholder="1.1.1.1,8.8.8.8"></label><label class="mihomo-check"><input name="wireGuardRemoteDnsResolve" type="checkbox">Remote DNS Resolve</label><label class="mihomo-field"><span>Refresh Server IP (s)</span><input name="wireGuardRefreshServerIpInterval" type="number" min="0"></label></div></div>
      <div class="mihomo-field full" data-kind="proxy" data-types="openvpn"><span>OpenVPN</span><div class="mihomo-form-grid"><label class="mihomo-field"><span>Protocol</span><select name="openVpnProto"><option value="udp">udp</option><option value="tcp">tcp</option></select></label><label class="mihomo-field"><span>Device</span><select name="openVpnDev"><option value="tun">tun</option></select></label><label class="mihomo-field"><span>Cipher</span><select name="openVpnCipher"><option>AES-128-GCM</option><option>AES-192-GCM</option><option>AES-256-GCM</option><option>AES-128-CBC</option><option>AES-192-CBC</option><option>AES-256-CBC</option><option>CHACHA20-POLY1305</option></select></label><label class="mihomo-field"><span>Auth</span><select name="openVpnAuth"><option>SHA256</option><option>MD5</option><option>SHA1</option><option>SHA384</option><option>SHA512</option></select></label><label class="mihomo-field"><span>Data Ciphers</span><input name="openVpnDataCiphers" placeholder="AES-256-GCM,AES-128-GCM"></label><label class="mihomo-field"><span>Fallback Cipher</span><input name="openVpnDataCipherFallback"></label><label class="mihomo-field"><span>Comp LZO</span><select name="openVpnCompLzo"><option value="">none</option><option>yes</option><option>no</option><option>adaptive</option></select></label><label class="mihomo-field"><span>Key Direction</span><select name="openVpnKeyDirection"><option value="">bidirectional</option><option>0</option><option>1</option></select></label><label class="mihomo-field full"><span>CA PEM</span><textarea name="openVpnCa" rows="3"></textarea></label><label class="mihomo-field full"><span>Client Cert PEM</span><textarea name="openVpnCert" rows="3"></textarea></label><label class="mihomo-field full"><span>Client Key PEM</span><textarea name="openVpnKey" rows="3"></textarea></label><label class="mihomo-field full"><span>TLS Auth PEM</span><textarea name="openVpnTlsAuth" rows="3"></textarea></label><label class="mihomo-field full"><span>TLS Crypt PEM</span><textarea name="openVpnTlsCrypt" rows="3"></textarea></label><label class="mihomo-field full"><span>TLS Crypt v2 PEM</span><textarea name="openVpnTlsCryptV2" rows="3"></textarea></label><label class="mihomo-field"><span>Ping (s)</span><input name="openVpnPing" type="number" min="0"></label><label class="mihomo-field"><span>Ping Restart (s)</span><input name="openVpnPingRestart" type="number" min="0"></label><label class="mihomo-field"><span>Handshake Timeout (s)</span><input name="openVpnHandshakeTimeout" type="number" min="0"></label><label class="mihomo-field"><span>MTU</span><input name="openVpnMtu" type="number" min="0"></label><label class="mihomo-field"><span>DNS</span><input name="openVpnDns" placeholder="1.1.1.1,8.8.8.8"></label><label class="mihomo-check"><input name="openVpnRemoteDnsResolve" type="checkbox">Remote DNS Resolve</label></div></div>
      <div class="mihomo-field full" data-kind="proxy"><span>Common Options</span><div class="mihomo-checks"><label class="mihomo-check" data-types="ss,snell,socks5,vmess,vless,trojan,wireguard"><input name="udp" type="checkbox">UDP</label><label class="mihomo-check"><input name="tfo" type="checkbox">TCP Fast Open</label><label class="mihomo-check"><input name="mptcp" type="checkbox">MPTCP</label><label class="mihomo-check" data-types="socks5,http,vmess,vless,trojan,hysteria2,tuic"><input name="skipCertVerify" type="checkbox">Skip Certificate Verify</label></div></div>
      <label class="mihomo-field full mihomo-subscription-field" data-kind="group"><span>Подписки (все узлы автоматически)</span><select name="subscriptionIds" multiple size="4"></select><small>Можно выбрать несколько подписок. Все новые узлы автоматически добавляются в балансировщик при синхронизации.</small></label>
      <label class="mihomo-field full" data-kind="group"><span>Members</span><select name="proxies" multiple></select><small data-i18n="mh.membersNote">按 Ctrl / Cmd 多选；成员可以是代理、内置策略或其他无循环依赖的策略组。</small></label><label class="mihomo-field" data-kind="group" data-group-health><span>Test URL</span><input name="testUrl" value="${defaultTestURL}"></label><label class="mihomo-field" data-kind="group" data-group-health><span>Interval (seconds)</span><input name="interval" type="number" min="0" value="180"></label><label class="mihomo-field" data-kind="group" data-group-health><span>Timeout (ms)</span><input name="timeout" type="number" min="0" value="8000"></label><label class="mihomo-field" data-kind="group" data-group-type="url-test"><span>Tolerance (ms)</span><input name="tolerance" type="number" min="0" value="100"></label><label class="mihomo-field" data-kind="group" data-group-type="load-balance"><span>Strategy</span><select name="strategy"><option value="consistent-hashing">consistent-hashing</option><option value="round-robin">round-robin</option><option value="sticky-sessions">sticky-sessions</option></select></label><label class="mihomo-field" data-kind="group" data-group-type="select"><span>Default Selected</span><select name="defaultSelected"></select></label><div class="mihomo-field" data-kind="group"><span>Group Options</span><label class="mihomo-check"><input name="disableUdp" type="checkbox">Disable UDP</label></div>
    </div></div><div id="outbound-yaml-panel" role="tabpanel" aria-labelledby="outbound-yaml-tab" hidden>
      <div class="outbound-link-row"><label for="outbound-share-link">Link</label><input id="outbound-share-link" type="text" autocomplete="off" spellcheck="false" placeholder="vmess:// / vless:// / trojan:// / ss:// / hysteria2://"><button type="button" id="outbound-parse-link" title="Parse Link to YAML" aria-label="Parse Link to YAML" data-i18n-title="mh.parseLink" data-i18n-aria="mh.parseLink">${SF('edit')}</button></div>
      <div class="outbound-yaml-editor"><pre id="outbound-yaml-lines" aria-hidden="true">1</pre><textarea id="outbound-yaml" aria-label="Outbound YAML" spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off"></textarea></div>
    </div><div id="outbound-import-error" role="alert" hidden></div></div><footer class="modal-footer"><button type="button" class="outline-btn" data-mihomo-close data-i18n="common.cancel">Cancel</button><button type="submit" class="primary-btn" id="outbound-apply" data-i18n="mh.applyToDraft">Apply</button></footer></form></section>`;
    document.body.appendChild(outboundModal);

    const ruleModal=document.createElement('div');ruleModal.className='modal-backdrop';ruleModal.id='mihomo-rule-modal';ruleModal.innerHTML=`<section class="modal-panel mihomo-modal" role="dialog" aria-modal="true" aria-labelledby="mihomo-rule-title"><header class="modal-titlebar"><span id="mihomo-rule-title">Add Routing Rule</span><button type="button" class="modal-close" data-mihomo-close>${SF('close')}</button></header><form id="mihomo-rule-form"><div class="modal-content"><div class="mihomo-form-note" data-i18n="mh.ruleNote">Mihomo 从上到下匹配规则；首个命中的规则决定 Outbound。MATCH 固定作为最后兜底。</div><div class="mihomo-form-grid mihomo-unified-rule-editor"><input name="id" type="hidden">
      <label class="mihomo-field full" id="mihomo-rule-type-field">
        <span class="mihomo-rule-editor-type-label"><span data-i18n="mh.colRuleType">Тип правила</span>${ruleHelpButton('type','LIST')}</span>
        <select name="type"><option value="LIST">GEO SITE КАТЕГОРИИ + ДОМЕНЫ И IP</option>${ruleTypes.filter(type=>type!=='MATCH'&&type!=='GEOSITE').map(type=>`<option value="${type}">${type}</option>`).join('')}</select>
      </label>
      <section class="mihomo-rule-conditions full" id="mihomo-rule-conditions" aria-labelledby="mihomo-rule-conditions-title">
        <div class="mihomo-rule-section-heading" id="mihomo-rule-conditions-title" data-i18n="mh.ruleConditionsTitle">Условия</div>
        <div class="mihomo-rule-lists full" id="mihomo-rule-lists">
          <div class="mihomo-rule-list-grid">
            <label class="mihomo-field"><span>GeoSite/GeoIP</span><textarea name="geoCategories" rows="9" spellcheck="false" placeholder="youtube&#10;category-ru&#10;ru"></textarea></label>
            <label class="mihomo-field"><span data-i18n="mh.domainsAndIP">Домены и IP</span><textarea name="domainIPs" rows="9" spellcheck="false" placeholder="example.com&#10;full:api.example.com&#10;192.168.1.0/24"></textarea></label>
          </div>
          <div class="mihomo-rule-list-toolbar"><button type="button" class="mihomo-tool" id="mihomo-geo-picker-open" data-i18n="mh.chooseGeoCategories">Выбрать категорию из списка</button><small data-i18n="mh.ruleListHelp">По одному значению в строке. Условия объединяются через ИЛИ, все направляются в выбранный исходящий.</small></div>
        </div>
        <label class="mihomo-field full" id="mihomo-rule-payload-field">
          <span id="mihomo-rule-condition-label">Условие правила</span>
          <textarea name="payload" rows="3" spellcheck="false"></textarea>
          <small id="mihomo-rule-hint"></small>
        </label>
        <p class="mihomo-rule-no-conditions" id="mihomo-rule-no-conditions" hidden data-i18n="mh.ruleNoConditions">Условий нет: весь оставшийся трафик направляется в выбранный исходящий.</p>
      </section>
      <label class="mihomo-field full" id="mihomo-rule-target-field"><span data-i18n="mh.colOutbound">Исходящий</span><select name="target"></select></label>
      <details class="mihomo-rule-advanced full" id="mihomo-rule-advanced"><summary data-i18n="mh.advancedSettings">Расширенные настройки</summary><div class="mihomo-rule-advanced-body">
        <div class="mihomo-field full" id="mihomo-no-resolve-field"><div class="mihomo-no-resolve-row"><label class="mihomo-check"><input name="noResolve" type="checkbox"><span data-i18n="mh.noResolveLabel">No-Resolve — Не выполнять DNS-разрешение при проверке правила</span></label>${ruleHelpButton('no-resolve')}</div></div>
      </div></details>
    </div></div><footer class="modal-footer"><button type="button" class="outline-btn" data-mihomo-close data-i18n="common.cancel">Cancel</button><button type="submit" class="primary-btn" data-i18n="mh.applyToDraft">Apply</button></footer></form></section>`;
    document.body.appendChild(ruleModal);
    refreshRuleTypeLabels();
    const geoPicker=document.createElement('div');
    geoPicker.id='mihomo-geo-picker-modal';geoPicker.className='modal-backdrop';
    geoPicker.innerHTML='<section class="modal-panel mihomo-modal mihomo-geo-picker" role="dialog" aria-modal="true" aria-labelledby="mihomo-geo-picker-title"><header class="modal-titlebar"><span id="mihomo-geo-picker-title" data-i18n="mh.chooseGeoCategories">Выбрать категорию из списка</span><button type="button" class="modal-close" id="mihomo-geo-picker-close" title="Закрыть">'+SF('close')+'</button></header><div class="modal-content"><div class="mihomo-geo-picker-filter"><select id="mihomo-geo-picker-source" aria-label="Источник категорий"><option value="all">GeoSite + GeoIP</option><option value="geosite">GeoSite</option><option value="geoip">GeoIP</option></select><label class="mihomo-geo-picker-search-label" for="mihomo-geo-picker-search">Поиск категорий<input id="mihomo-geo-picker-search" type="search" placeholder="Найти категорию…" autocomplete="off" spellcheck="false"></label></div><p class="mihomo-geo-picker-count" id="mihomo-geo-picker-count"></p><div class="mihomo-geo-picker-list" id="mihomo-geo-picker-list" role="list"></div></div><footer class="modal-footer"><button type="button" class="outline-btn" id="mihomo-geo-picker-done" data-i18n="common.close">Закрыть</button></footer></section>';
    document.body.appendChild(geoPicker);
    $('#mihomo-geo-picker-close').onclick=$('#mihomo-geo-picker-done').onclick=()=>closeModal(geoPicker);
    geoPicker.onclick=event=>{if(event.target===geoPicker)closeModal(geoPicker);};
    $('#mihomo-geo-picker-search').oninput=renderGeoPicker;
    $('#mihomo-geo-picker-source').onchange=renderGeoPicker;
    $('#mihomo-geo-picker-open').onclick=openGeoPicker;
    $$('[data-mihomo-close]').forEach(button=>button.onclick=()=>{if(outboundBusy&&button.closest('#mihomo-outbound-modal'))return;window.MUIBalancerServers?.teardown();closeModal(button.closest('.modal-backdrop'));});
    for(const modal of [outboundModal,ruleModal])modal.onclick=event=>{if(event.target===modal&&!(outboundBusy&&modal===outboundModal)){window.MUIBalancerServers?.teardown();closeModal(modal);}};
    $('#mihomo-outbound-form').onsubmit=saveOutboundDraft;
    $('#mihomo-outbound-form').elements.kind.onchange=syncOutboundForm;
    $('#mihomo-outbound-form').elements.type.onchange=syncOutboundForm;
    $('#mihomo-outbound-form').elements.network.onchange=syncOutboundForm;
    $('#mihomo-outbound-form').elements.snellVersion.onchange=syncSnellOutboundForm;
    $('#mihomo-outbound-form').elements.snellObfsMode.onchange=syncSnellOutboundForm;
    $('#mihomo-outbound-form').elements.proxies.onchange=()=>syncGroupDefaultOptions();
    $('#mihomo-outbound-form').elements.subscriptionIds.onchange=()=>{syncBalancerSubscriptionMembers();attachSubscriptionServerEditor();};
    $$('[data-outbound-mode]').forEach(button=>button.onclick=()=>switchOutboundMode(button.dataset.outboundMode));
    $('#outbound-parse-link').onclick=parseOutboundLink;
    $('#outbound-share-link').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();parseOutboundLink();}};
    $('#outbound-yaml').oninput=()=>{syncYAMLLines();showImportError('');};
    $('#outbound-yaml').onscroll=()=>{$('#outbound-yaml-lines').scrollTop=$('#outbound-yaml').scrollTop;};
    for(const eventName of ['input','change'])$('#outbound-form-panel').addEventListener(eventName,()=>{outboundFormChanged=true;showImportError('');});
    $('#mihomo-generate-uuid').onclick=async()=>{try{const value=await api('/api/tools/uuid',{method:'POST'});$('#mihomo-outbound-form').elements.uuid.value=value.uuid;outboundFormChanged=true;}catch(error){toast(error.message,true);}};
    $('#mihomo-rule-form').onsubmit=saveRuleDraft;
    $('#mihomo-rule-form').elements.type.onchange=syncRuleForm;
  }

  function setFormValue(form,name,value){const field=form.elements[name];if(!field)return;if(field.type==='checkbox')field.checked=!!value;else field.value=value??'';}
  function fillOutboundForm(item){
    const form=$('#mihomo-outbound-form');
    const yamlDraft=$('#outbound-yaml').value,linkDraft=$('#outbound-share-link').value;
    form.reset();form.elements.kind.value=item.kind||'proxy';populateOutboundTypes(form,item.type);syncOutboundTargets(item);
    for(const field of form.querySelectorAll('[name]')){
      if(['kind','type','proxies','defaultSelected','subscriptionIds'].includes(field.name))continue;
      // Historical URL Test groups may have missing health knobs. Show the
      // same editable defaults as a newly added group without replacing a
      // user's explicitly saved zero or custom value.
      const groupHealthDefaults=item.kind==='group'&&item.type!=='select'
        ?(field.name==='timeout'?8000:field.name==='tolerance'&&item.type==='url-test'?100:undefined)
        :undefined;
      setFormValue(form,field.name,item[field.name]??groupHealthDefaults??(field.type==='checkbox'?false:''));
    }
    form.elements.tls.value=String(!!item.tls);
    form.elements.network.value=item.network||'tcp';
    form.elements.vmessCipher.value=item.type==='vmess'?item.cipher||'auto':'auto';
    form.elements.openVpnProto.value=item.openVpnProto||'udp';
    form.elements.openVpnDev.value=item.openVpnDev||'tun';
    form.elements.openVpnCipher.value=item.openVpnCipher||'AES-128-GCM';
    form.elements.openVpnAuth.value=item.openVpnAuth||'SHA256';
    form.elements.snellVersion.value=String(item.snellVersion||1);
    for(const option of form.elements.proxies.options)option.selected=(item.proxies||[]).includes(option.value);
    syncBalancerSubscriptionOptions(item);
    if(editingSubscriptionGroup)syncBalancerSubscriptionMembers();
    syncOutboundForm();syncGroupDefaultOptions(item.defaultSelected||'');
    attachSubscriptionServerEditor();
    $('#outbound-yaml').value=yamlDraft;$('#outbound-share-link').value=linkDraft;syncYAMLLines();
  }
  async function openOutboundModal(id='',requestedKind='proxy'){
    const requestedItem=draft.outbounds.find(item=>item.id===id);
    // Normal balancers select individual Outbounds and must not fetch,
    // display or attach a subscription, even when a source exists globally.
    editingSubscriptionGroup=(requestedItem?.kind||requestedKind)==='group'
      &&currentTab==='subscriptions';
    creatingSubscriptionGroup=editingSubscriptionGroup&&!id;
    balancerSubscriptions=[];
    if(editingSubscriptionGroup){
      // /api/mihomo/subscriptions returns exactly the records already present
      // in /api/state, which this view polls every five seconds. Do not make
      // the pencil click wait on another round trip before opening the modal.
      const cached=app.state?.state?.outboundSubscriptions;
      const linkedIDs=new Set(requestedItem?.subscriptionIds||[]);
      // An empty or incomplete state snapshot is NOT a usable source list.
      // Otherwise the editor has group.subscriptionIds but no matching
      // subscription object; its source <select> is blank and live preview
      // silently returns without crossing any nodes.
      const hasLinkedSource=Array.isArray(cached)&&cached.some(src=>
        src.group===requestedItem?.name||linkedIDs.has(src.id));
      const complete=hasLinkedSource&&[...linkedIDs].every(id=>
        cached.some(src=>src.id===id));
      if(complete)balancerSubscriptions=clone(cached);
      else{
        try{balancerSubscriptions=await api('/api/mihomo/subscriptions');}
        catch(error){toast('Не удалось загрузить подписки: '+error.message,true);return;}
      }
    }
    if(draft.outbounds.find(item=>item.id===id)?.vpngate){await openVPNGateModal(id);return;}
    window.MUIBalancerServers?.teardown();
    ensureModals();editingOutbound=id;
    editingOriginal=clone(requestedItem||(requestedKind==='group'&&!editingSubscriptionGroup
      ?{...newManualBalancerDefaults(),port:443,cipher:'aes-256-gcm',network:'tcp',udp:true,strategy:'consistent-hashing'}
      :{kind:requestedKind,type:requestedKind==='group'?'url-test':'ss',port:443,cipher:'aes-256-gcm',network:'tcp',udp:true,testUrl:draft.basics.outboundTestUrl||defaultTestURL,interval:60,
        // Defaults for newly created subscription balancers; never alter saved groups.
        ...(requestedKind==='group'?{timeout:8000,tolerance:100}:{}),
        strategy:'consistent-hashing'}));
    fillOutboundForm(editingOriginal);showImportError('');$('#outbound-share-link').value='';setYAML('');
    outboundFormChanged=false;outboundYAMLCached=false;
    setOutboundMode('form');
    $('#mihomo-outbound-title').textContent=editingOriginal.kind==='group'
      ?(id?'Настройки балансировщика':'Добавить балансировщик')
      :muiT(id?'mh.editOutbound':'mihomo.addOutbound');
    const editorTabs=$('#mihomo-outbound-modal .mihomo-editor-tabs');
    editorTabs.style.display=creatingSubscriptionGroup?'none':'';
    $('#mihomo-outbound-modal').dataset.creatingSubscription=String(creatingSubscriptionGroup);
    if(creatingSubscriptionGroup)$('#outbound-apply').textContent='Создать балансировщик';else $('#outbound-apply').textContent=muiT('mh.applyToDraft');
    openModal('mihomo-outbound-modal');
    requestAnimationFrame(()=>{if(typeof syncInkBars==='function')syncInkBars();});
    if(editingOriginal.native&&!window.MUIBalancerServers?.active()){await switchOutboundMode('yaml',editingOriginal);}else $('#mihomo-outbound-form').elements.name.focus();
  }
  function populateOutboundTypes(form,selected=''){
    const options=form.elements.kind.value==='group'?groupTypes:proxyTypes;
    form.elements.type.innerHTML=options.map(([value,label])=>`<option value="${value}">${groupTypeLabel(value,label)}</option>`).join('');
    if(options.some(([value])=>value===selected))form.elements.type.value=selected;
  }
  function syncOutboundTargets(item={}){
    const form=$('#mihomo-outbound-form'),name=item.name||'',selectedDialer=item.dialerProxy||'';
    form.elements.dialerProxy.innerHTML=`<option value="">${muiT('inbounds.statusNone')}</option>${targetOptions(selectedDialer,false,name)}`;
    form.elements.proxies.innerHTML=targetOptions('',true,name);
    for(const member of item.proxies||[])if(!Array.from(form.elements.proxies.options).some(option=>option.value===member))form.elements.proxies.add(new Option(member,member));
    if(selectedDialer&&!Array.from(form.elements.dialerProxy.options).some(option=>option.value===selectedDialer))form.elements.dialerProxy.add(new Option(selectedDialer,selectedDialer,true,true));
  }
  function attachSubscriptionServerEditor(){
    const handler=window.MUIBalancerServers;
    if(!handler)return;
    const form=$('#mihomo-outbound-form');
    if(!form||form.elements.kind.value!=='group'){handler.teardown();return;}
    const selectedIDs=Array.from(form.elements.subscriptionIds.selectedOptions,option=>option.value).filter(Boolean);
    const group={...clone(editingOriginal||{}),
      name:form.elements.name.value.trim()||editingOriginal?.name||'',
      ...(creatingSubscriptionGroup?{proxies:Array.from(form.elements.proxies.selectedOptions,o=>o.value)}:{}),
      subscriptionIds:editingSubscriptionGroup?selectedIDs:[]};
    const active=handler.attach({
      form,group,subs:balancerSubscriptions,outbounds:draft.outbounds,creating:creatingSubscriptionGroup,
      // Existing groups can be probed; new or renamed unsaved groups cannot.
      persistedName:editingOriginal?.id?editingOriginal.name:'',
      updateDefaults:()=>syncGroupDefaultOptions(),
      isDirty:()=>dirty,
      afterRefresh:async()=>{
        await refresh();
        if(!dirty)syncFromState();
      }
    });
    if(!active){
      const label=form.elements.proxies.closest('.mihomo-field');
      label.querySelector('span').textContent='Серверы балансировщика';
      form.elements.proxies.classList.remove('fbs-native-members');
    }
  }
  function syncBalancerSubscriptionOptions(item={}){
    const select=$('#mihomo-outbound-form').elements.subscriptionIds;
    if(!select)return;
    select.replaceChildren();
    select.multiple=!creatingSubscriptionGroup;
    select.size=creatingSubscriptionGroup?1:4;
    if(!editingSubscriptionGroup)return;
    if(creatingSubscriptionGroup)select.add(new Option('Выберите подписку…',''));
    for(const source of balancerSubscriptions){
      const option=new Option(source.name+' ('+String(source.nodeCount||0)+')',source.id);
      option.selected=!creatingSubscriptionGroup&&((item.subscriptionIds||[]).includes(source.id)||source.group===item.name);
      select.add(option);
    }
    if(creatingSubscriptionGroup)select.value='';
  }
  function syncBalancerSubscriptionMembers(){
    const form=$('#mihomo-outbound-form');
    if(!editingSubscriptionGroup||form.elements.kind.value!=='group')return;
    const ids=new Set(Array.from(form.elements.subscriptionIds.selectedOptions,option=>option.value));
    const previouslyAttached=new Set((editingOriginal?.subscriptionIds||[]));
    for(const source of balancerSubscriptions)if(source.group===editingOriginal?.name)previouslyAttached.add(source.id);
    for(const option of form.elements.proxies.options){
      const node=draft.outbounds.find(candidate=>candidate.name===option.value);
      if(!node?.sourceSubscriptionId)continue;
      if(ids.has(node.sourceSubscriptionId))option.selected=!(editingOriginal?.excludedSubscriptionMembers||[]).includes(option.value);
      else if(creatingSubscriptionGroup||previouslyAttached.has(node.sourceSubscriptionId))option.selected=false;
    }
    syncGroupDefaultOptions();
  }
  function syncOutboundForm(){
    const form=$('#mihomo-outbound-form'),kind=form.elements.kind.value,previous=form.elements.type.value;
    // Shared dialog: use a descriptive name label only for balancers.
    const nameCaption=form.elements.name.closest('.mihomo-field')?.querySelector(':scope > span');
    if(nameCaption)nameCaption.textContent=kind==='group'?'Название балансировщика':'Name';
    const allowed=kind==='group'?groupTypes:proxyTypes;if(!allowed.some(([value])=>value===previous))populateOutboundTypes(form);
    const type=form.elements.type.value,network=form.elements.network.value;
    $$('[data-kind]',form).forEach(field=>{
      field.hidden=field.dataset.kind!==kind||
        (field.classList.contains('mihomo-subscription-field')&&!editingSubscriptionGroup);
    });
    $$('[data-types]',form).forEach(field=>field.hidden=kind!=='proxy'||!field.dataset.types.split(',').includes(type));
    $$('[data-network]',form).forEach(field=>field.hidden=kind!=='proxy'||!['vmess','vless','trojan'].includes(type)||field.dataset.network!==network);
    $$('[data-group-health]',form).forEach(field=>field.hidden=kind!=='group'||type==='select');
    $$('[data-group-type]',form).forEach(field=>field.hidden=kind!=='group'||field.dataset.groupType!==type);
    form.elements.server.required=kind==='proxy'&&type!=='direct';form.elements.port.required=kind==='proxy'&&type!=='direct';form.elements.proxies.required=kind==='group';
    for(const field of form.querySelectorAll('#outbound-form-panel [name]'))field.disabled=!!field.closest('[hidden]');
    syncSnellOutboundForm();
    syncGroupDefaultOptions();
  }
  function syncSnellOutboundForm(){
    const form=$('#mihomo-outbound-form');if(!form?.elements.snellVersion)return;
    const active=form.elements.kind.value==='proxy'&&form.elements.type.value==='snell',version=Number(form.elements.snellVersion.value)||1;
    if(!active)return;
    form.elements.snellReuse.disabled=version<4;if(version<4)form.elements.snellReuse.checked=false;
    form.elements.udp.disabled=version<3;if(version<3)form.elements.udp.checked=false;
    form.elements.snellObfsHost.disabled=!form.elements.snellObfsMode.value;
  }
  function syncGroupDefaultOptions(selected){
    const form=$('#mihomo-outbound-form'),members=Array.from(form.elements.proxies.selectedOptions).map(option=>option.value),current=selected??form.elements.defaultSelected.value;
    form.elements.defaultSelected.innerHTML=`<option value="">${muiT('mh.firstMember')}</option>${members.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('')}`;
    if(members.includes(current))form.elements.defaultSelected.value=current;
  }
  function orderedMembers(form){
    const selected=Array.from(form.elements.proxies.selectedOptions).map(option=>option.value);
    return [...(editingOriginal?.proxies||[]).filter(name=>selected.includes(name)),...selected.filter(name=>!(editingOriginal?.proxies||[]).includes(name))];
  }
  function readOutboundForm(){
    const form=$('#mihomo-outbound-form'),kind=form.elements.kind.value,type=form.elements.type.value;
    const csv=value=>String(value||'').split(',').map(part=>part.trim()).filter(Boolean);
    const csvInts=value=>csv(value).map(part=>Number(part)).filter(Number.isFinite);
    const item={...clone(editingOriginal||{}),id:form.elements.id.value||freshID('outbound'),kind,subscriptionIds:kind==='group'&&editingSubscriptionGroup?Array.from(form.elements.subscriptionIds.selectedOptions,option=>option.value):[],name:form.elements.name.value.trim(),type,server:type==='direct'?'':form.elements.server.value.trim(),port:type==='direct'?0:Number(form.elements.port.value)||0,username:form.elements.username.value.trim(),password:form.elements.password.value,snellPsk:form.elements.snellPsk.value,snellVersion:Number(form.elements.snellVersion.value)||1,snellReuse:form.elements.snellReuse.checked,snellObfsMode:form.elements.snellObfsMode.value,snellObfsHost:form.elements.snellObfsHost.value.trim(),uuid:form.elements.uuid.value.trim(),alterId:Number(form.elements.alterId.value)||0,cipher:type==='vmess'?form.elements.vmessCipher.value:form.elements.cipher.value,udp:form.elements.udp.checked,tls:form.elements.tls.value==='true',skipCertVerify:form.elements.skipCertVerify.checked,sni:form.elements.sni.value.trim(),alpn:form.elements.alpn.value.trim(),network:form.elements.network.value,wsPath:form.elements.wsPath.value.trim(),wsHost:form.elements.wsHost.value.trim(),grpcServiceName:form.elements.grpcServiceName.value.trim(),flow:form.elements.flow.value.trim(),encryption:form.elements.encryption.value.trim(),clientFingerprint:form.elements.clientFingerprint.value.trim(),ipVersion:form.elements.ipVersion.value,dialerProxy:form.elements.dialerProxy.value,interfaceName:form.elements.interfaceName.value.trim(),routingMark:Number(form.elements.routingMark.value)||0,tfo:form.elements.tfo.checked,mptcp:form.elements.mptcp.checked,wireGuardIp:form.elements.wireGuardIp.value.trim(),wireGuardIpv6:form.elements.wireGuardIpv6.value.trim(),wireGuardPrivateKey:form.elements.wireGuardPrivateKey.value.trim(),wireGuardPublicKey:form.elements.wireGuardPublicKey.value.trim(),wireGuardPreSharedKey:form.elements.wireGuardPreSharedKey.value.trim(),wireGuardReserved:csvInts(form.elements.wireGuardReserved.value),wireGuardPersistentKeepalive:Number(form.elements.wireGuardPersistentKeepalive.value)||0,wireGuardMtu:Number(form.elements.wireGuardMtu.value)||0,wireGuardWorkers:Number(form.elements.wireGuardWorkers.value)||0,wireGuardDns:csv(form.elements.wireGuardDns.value),wireGuardRemoteDnsResolve:form.elements.wireGuardRemoteDnsResolve.checked,wireGuardRefreshServerIpInterval:Number(form.elements.wireGuardRefreshServerIpInterval.value)||0,openVpnProto:form.elements.openVpnProto.value,openVpnDev:form.elements.openVpnDev.value,openVpnCipher:form.elements.openVpnCipher.value,openVpnDataCiphers:csv(form.elements.openVpnDataCiphers.value),openVpnDataCipherFallback:form.elements.openVpnDataCipherFallback.value.trim(),openVpnAuth:form.elements.openVpnAuth.value,openVpnCompLzo:form.elements.openVpnCompLzo.value,openVpnCa:form.elements.openVpnCa.value.trim(),openVpnCert:form.elements.openVpnCert.value.trim(),openVpnKey:form.elements.openVpnKey.value.trim(),openVpnTlsAuth:form.elements.openVpnTlsAuth.value.trim(),openVpnKeyDirection:form.elements.openVpnKeyDirection.value,openVpnTlsCrypt:form.elements.openVpnTlsCrypt.value.trim(),openVpnTlsCryptV2:form.elements.openVpnTlsCryptV2.value.trim(),openVpnPing:Number(form.elements.openVpnPing.value)||0,openVpnPingRestart:Number(form.elements.openVpnPingRestart.value)||0,openVpnHandshakeTimeout:Number(form.elements.openVpnHandshakeTimeout.value)||0,openVpnMtu:Number(form.elements.openVpnMtu.value)||0,openVpnDns:csv(form.elements.openVpnDns.value),openVpnRemoteDnsResolve:form.elements.openVpnRemoteDnsResolve.checked,up:form.elements.up.value.trim(),down:form.elements.down.value.trim(),obfs:form.elements.obfs.value,obfsPassword:form.elements.obfsPassword.value,token:form.elements.token.value.trim(),congestionController:form.elements.congestionController.value,udpRelayMode:form.elements.udpRelayMode.value,proxies:orderedMembers(form),testUrl:form.elements.testUrl.value.trim(),interval:Number(form.elements.interval.value)||0,timeout:Number(form.elements.timeout.value)||0,tolerance:Number(form.elements.tolerance.value)||0,strategy:form.elements.strategy.value,defaultSelected:form.elements.defaultSelected.value,disableUdp:form.elements.disableUdp.checked};
    if(kind==='group'){
      const exclusions=window.MUIBalancerServers?.getExcluded();
      if(editingSubscriptionGroup){
        if(exclusions!==null&&exclusions!==undefined)item.excludedSubscriptionMembers=exclusions;
      }else item.excludedSubscriptionMembers=[];
      // Preserve advanced native YAML knobs while keeping form-edited group
      // members, strategy and health settings in sync with that native YAML.
      if(item.native){
        const native={...item.native,name:item.name,type:item.type,proxies:[...item.proxies]};
        if(item.type==='select'){
          delete native.url;delete native.interval;delete native.timeout;
          delete native.tolerance;delete native.strategy;
          if(item.defaultSelected)native['default-selected']=item.defaultSelected;
          else delete native['default-selected'];
        }else{
          native.url=item.testUrl||defaultTestURL;
          native.interval=item.interval||60;
          if(item.timeout>0)native.timeout=item.timeout;else delete native.timeout;
          if(item.type==='url-test'&&item.tolerance>0)native.tolerance=item.tolerance;
          else delete native.tolerance;
          if(item.type==='load-balance')native.strategy=item.strategy||'consistent-hashing';
          else delete native.strategy;
          delete native['default-selected'];
        }
        if(item.disableUdp)native['disable-udp']=true;else delete native['disable-udp'];
        item.native=native;
      }
    }
    return item;
  }
  function importRequest(extra){return {context:draft.outbounds,editingId:editingOutbound,...extra};}
  function showImportError(message){const box=$('#outbound-import-error');box.textContent=message;box.hidden=!message;}
  function setImportBusy(busy){outboundBusy=busy;$('#outbound-apply').disabled=busy;$('#outbound-parse-link').disabled=busy;$$('[data-outbound-mode]').forEach(button=>button.disabled=busy);}
  function setYAML(value){$('#outbound-yaml').value=value;outboundYAMLCached=true;syncYAMLLines();}
  function syncYAMLLines(){const lines=$('#outbound-yaml').value.split('\n').length;$('#outbound-yaml-lines').textContent=Array.from({length:lines},(_,index)=>index+1).join('\n');}
  function setOutboundMode(mode){
    outboundMode=mode;$('#outbound-form-panel').hidden=mode!=='form';$('#outbound-yaml-panel').hidden=mode!=='yaml';
    $$('[data-outbound-mode]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.outboundMode===mode)));
    if(typeof syncInkBars==='function')syncInkBars();
    if(mode==='form')syncOutboundForm();
  }
  async function switchOutboundMode(mode,initialItem){
    if(outboundBusy||outboundMode===mode)return;
    setImportBusy(true);showImportError('');
    try{
      if(mode==='yaml'){
        if(outboundYAMLCached&&!outboundFormChanged&&!initialItem){setOutboundMode('yaml');return;}
        const response=await api('/api/mihomo/outbound/parse',{method:'POST',body:JSON.stringify({outbound:initialItem||readOutboundForm()})});
        setYAML(response.yaml);outboundFormChanged=false;setOutboundMode('yaml');
      }else{
        const response=await api('/api/mihomo/outbound/parse',{method:'POST',body:JSON.stringify({yaml:$('#outbound-yaml').value,preview:true})});
        const item=response.outbounds?.length===1?response.outbounds[0]:null;
        const types=item?.kind==='group'?groupTypes:proxyTypes;
        if(item&&(!item.type||types.some(([type])=>type===item.type))&&(!item.network||['tcp','ws','grpc'].includes(item.network))){
          item.id=editingOutbound;editingOriginal=clone(item);fillOutboundForm(item);
        }
        outboundFormChanged=false;setOutboundMode('form');
      }
    }catch{
      // Incomplete YAML stays in its editor while navigation remains available.
      setOutboundMode(mode);
    }finally{setImportBusy(false);}
  }
  async function parseOutboundLink(){
    if(outboundBusy)return;setImportBusy(true);showImportError('');
    try{
      const response=await api('/api/mihomo/outbound/parse',{method:'POST',body:JSON.stringify(importRequest({link:$('#outbound-share-link').value}))});
      setYAML(response.yaml);
    }catch(error){showImportError(error.message);}finally{setImportBusy(false);}
  }
  function renameReferences(items,rules,oldName,newName){
    for(const candidate of items){
      candidate.proxies=(candidate.proxies||[]).map(name=>name===oldName?newName:name);
      if(candidate.defaultSelected===oldName)candidate.defaultSelected=newName;
      if(candidate.dialerProxy===oldName)candidate.dialerProxy=newName;
      if(candidate.native){
        if(Array.isArray(candidate.native.proxies))candidate.native.proxies=candidate.native.proxies.map(name=>name===oldName?newName:name);
        for(const key of ['default-selected','dialer-proxy'])if(candidate.native[key]===oldName)candidate.native[key]=newName;
      }
    }
    for(const rule of rules)if(rule.target===oldName)rule.target=newName;
  }
  async function createSubscriptionBalancer(){
    if(dirty){showImportError('Сначала сохраните изменения Mihomo Settings');return;}
    const form=$('#mihomo-outbound-form');let payload;
    try{payload=window.MUIBalancerServers?.creationPayload?.();}catch(error){showImportError(error.message);return;}
    if(!payload?.sourceId){showImportError('Выберите подписку');return;}
    if(!form.elements.name.value.trim()){showImportError('Укажите название балансировщика');return;}
    setImportBusy(true);showImportError('');
    try{
      await api('/api/mihomo/subscriptions/groups',{method:'POST',body:JSON.stringify({...payload,
        group:form.elements.name.value.trim(),groupType:form.elements.type.value,
        settings:{testUrl:form.elements.testUrl.value,interval:Number(form.elements.interval.value)||0,
          timeout:Number(form.elements.timeout.value)||0,tolerance:Number(form.elements.tolerance.value)||0,
          strategy:form.elements.strategy.value,disableUdp:form.elements.disableUdp.checked,
          defaultSelected:form.elements.defaultSelected.value}
      })});
      window.MUIBalancerServers?.teardown();closeModal($('#mihomo-outbound-modal'));
      toast('Балансировщик создан');
      try{await refresh();syncFromState();}catch(error){toast('Балансировщик сохранён. Обновите страницу.',true);}
    }catch(error){showImportError(error.message);}finally{setImportBusy(false);}
  }

  async function saveOutboundDraft(event){
    event.preventDefault();if(outboundBusy)return;
    if(outboundMode==='form'&&!event.currentTarget.reportValidity())return;
    if(creatingSubscriptionGroup){await createSubscriptionBalancer();return;}
    setImportBusy(true);showImportError('');
    const applyingGroup=$('#mihomo-outbound-form').elements.kind.value==='group';
    const dialog=applyingGroup?openMihomoStatusDialog('apply'):null;
    try{
      let yaml=$('#outbound-yaml').value;
      if(outboundMode==='form'){
        const exported=await api('/api/mihomo/outbound/parse',{method:'POST',body:JSON.stringify({outbound:readOutboundForm()})});yaml=exported.yaml;
      }
      const response=await api('/api/mihomo/outbound/parse',{method:'POST',body:JSON.stringify(importRequest({yaml}))});
      // The balancer's Apply action must also persist source filters.
      // Previously it closed the dialog and discarded them unless a separate
      // subscription Save button was pressed first.
      const sourceFiltersSaved=applyingGroup?await window.MUIBalancerServers?.saveSourceSettings?.():false;
      const groupSubscriptionIDs=editingSubscriptionGroup
        ?Array.from($('#mihomo-outbound-form').elements.subscriptionIds.selectedOptions,option=>option.value):[];
      if(response.outbounds.length===1 && response.outbounds[0].kind==='group'){
        response.outbounds[0].subscriptionIds=groupSubscriptionIDs;
        const exclusions=window.MUIBalancerServers?.getExcluded();
        response.outbounds[0].excludedSubscriptionMembers=editingSubscriptionGroup
          ?exclusions??editingOriginal?.excludedSubscriptionMembers??[]:[];
        // Native YAML editing does not carry panel-only metadata. Retain
        // group-scoped filters and shared subscription IDs across Apply.
        if(editingSubscriptionGroup){
          const lastSaved=sourceFiltersSaved
            ?(app.state?.state?.outbounds||[]).find(x=>x.kind==='group'&&x.name===response.outbounds[0].name)
            :null;
          const original=lastSaved||editingOriginal||{};
          response.outbounds[0].subscriptionManaged=!!original.subscriptionManaged;
          response.outbounds[0].subscriptionRetainedMembers=[...(original.subscriptionRetainedMembers||[])];
          response.outbounds[0].subscriptionFilterKeep=original.subscriptionFilterKeep||'';
          response.outbounds[0].subscriptionFilterExclude=original.subscriptionFilterExclude||'';
          response.outbounds[0].subscriptionExcludedNodeKeys=[...(original.subscriptionExcludedNodeKeys||[])];
        }
      }
      if(sourceFiltersSaved&&response.outbounds.length===1&&response.outbounds[0].kind==='group'){
        // Source PUT can replace the managed nodes, so discard stale names
        // before staging the group for the outer Mihomo Save action.
        await refresh();
        const live=app.state?.state||{};
        if(!dirty)syncFromState();
        const activeNodes=live.outbounds||[];
        const byName=new Map(activeNodes.map(node=>[node.name,node]));
        const group=response.outbounds[0];
        const sources=new Set([...groupSubscriptionIDs,
          ...(live.outboundSubscriptions||[]).filter(sub=>sub.group===group.name).map(sub=>sub.id)]);
        const excluded=new Set(group.excludedSubscriptionMembers||[]);
        const manual=(group.proxies||[]).filter(name=>{
          const node=byName.get(name);
          return node&&!node.sourceSubscriptionId;
        });
        const liveGroup=activeNodes.find(node=>node.kind==='group'&&node.name===group.name);
        const liveMembers=new Set(liveGroup?.proxies||[]);
        const fresh=activeNodes.filter(node=>node.sourceSubscriptionId&&sources.has(node.sourceSubscriptionId)
          &&(liveGroup?liveMembers.has(node.name):true)&&!excluded.has(node.name)).map(node=>node.name);
        if(liveGroup){
          group.subscriptionFilterKeep=liveGroup.subscriptionFilterKeep||'';
          group.subscriptionFilterExclude=liveGroup.subscriptionFilterExclude||'';
          group.subscriptionExcludedNodeKeys=[...(liveGroup.subscriptionExcludedNodeKeys||[])];
        }
        if(liveGroup?.subscriptionRetainedMembers?.length){
          group.subscriptionManaged=true;
          group.subscriptionRetainedMembers=[...liveGroup.subscriptionRetainedMembers];
          group.proxies=[...(liveGroup.proxies||[])];
        }else group.proxies=Array.from(new Set([...manual,...fresh]));
        if(group.native)group.native.proxies=[...group.proxies];
      }
      const next=clone(draft),index=next.outbounds.findIndex(item=>item.id===editingOutbound);
      if(index>=0){
        const previous=next.outbounds[index],item=response.outbounds[0];item.id=editingOutbound;
        next.outbounds[index]=item;
        if(previous.name!==item.name)renameReferences(next.outbounds,next.routingRules,previous.name,item.name);
      }else next.outbounds.push(...response.outbounds);
      draft=next;window.MUIBalancerServers?.teardown();closeModal($('#mihomo-outbound-modal'));markDirty();
      dialog?.set('success',muiT('mh.operationApplyReady'));
    }catch(error){showImportError(error.message);dialog?.set('error',error.message);}finally{setImportBusy(false);}
  }

  function rulePayloadHint(type){
    if(type==='AND')return muiT('mh.hintAnd');
    if(type.startsWith('DOMAIN'))return muiT(type==='DOMAIN'?'mh.hintDomainFull':'mh.hintDomain');
    if(type==='GEOSITE')return muiT('mh.hintGeosite');
    if(type.includes('CIDR'))return muiT('mh.hintCidr');
    if(type.includes('PORT'))return muiT('mh.hintPort');
    if(type==='NETWORK')return muiT('mh.hintNetwork');
    if(type==='IN-NAME')return muiT('mh.hintInName');
    if(type==='IN-USER')return muiT('mh.hintInUser');
    if(type.includes('PROCESS'))return muiT('mh.hintProcess');
    if(type==='GEOIP'||type==='SRC-GEOIP')return muiT('mh.hintGeoip');
    return muiT('mh.hintDefault');
  }
  async function loadGeoCategories(){
    if(geoCategoryCatalog)return geoCategoryCatalog;
    if(!geoCategoryLoading){
      geoCategoryLoading=api('/api/mihomo/geo-categories').then(data=>{
        if(!Array.isArray(data.geosite)||!Array.isArray(data.geoip))throw Error('Неверный ответ каталога GeoSite/GeoIP');
        geoCategoryCatalog=data;
        return data;
      }).finally(()=>{geoCategoryLoading=null;});
    }
    return geoCategoryLoading;
  }
  function renderGeoPicker(){
    const container=$('#mihomo-geo-picker-list'),count=$('#mihomo-geo-picker-count');
    container.replaceChildren();
    if(!geoCategoryCatalog){count.textContent='Загрузка категорий…';return;}
    const source=$('#mihomo-geo-picker-source').value;
    const search=$('#mihomo-geo-picker-search').value.toLowerCase().trim();
    const collection=[];
    for(const kind of ['geosite','geoip']){
      if(source!=='all'&&source!==kind)continue;
      for(const name of geoCategoryCatalog[kind])if(!search||name.includes(search))collection.push({kind,name});
    }
    const limited=collection.slice(0,250);
    count.textContent='Найдено: '+collection.length+(limited.length<collection.length?' · показаны первые 250':'');
    if(!collection.length){
      const node=document.createElement('div');node.className='mihomo-geo-picker-empty';
      node.textContent='Категорий не найдено';container.appendChild(node);
      return;
    }
    for(const item of limited){
      const line=document.createElement('div');line.className='mihomo-geo-picker-item';line.setAttribute('role','listitem');
      const name=document.createElement('span');name.className='mihomo-geo-picker-name';name.textContent=item.name;
      const sourceTag=document.createElement('small');sourceTag.textContent=item.kind==='geosite'?'GeoSite':'GeoIP';
      const add=document.createElement('button');add.type='button';add.className='mihomo-tool';add.textContent='Добавить';
      add.onclick=()=>{
        const field=$('#mihomo-rule-form').elements.geoCategories;
        const existing=window.MUIRuleLists.lines(field.value);
        const other=item.kind==='geosite'?'geoip':'geosite';
        const ambiguous=geoCategoryCatalog[other].includes(item.name);
        const value=ambiguous?item.kind+':'+item.name:item.name;
        if(!existing.includes(value)&&!existing.includes(item.kind+':'+item.name)){
          existing.push(value);field.value=existing.join('\n');field.dispatchEvent(new Event('input',{bubbles:true}));
        }
        add.textContent='Добавлено';
      };
      line.append(name,sourceTag,add);container.appendChild(line);
    }
  }
  async function openGeoPicker(){
    if($('#mihomo-rule-form').elements.type.value!=='LIST')return;
    $('#mihomo-geo-picker-search').value='';
    $('#mihomo-geo-picker-source').value='all';
    openModal('mihomo-geo-picker-modal');
    renderGeoPicker();
    try{
      await loadGeoCategories();
      renderGeoPicker();
    }catch(error){
      $('#mihomo-geo-picker-count').textContent='Каталог недоступен';
      $('#mihomo-geo-picker-list').textContent=error.message;
    }
    $('#mihomo-geo-picker-search').focus();
  }
  function openRuleModal(id=''){
    ensureModals();editingRule=id;
    const form=$('#mihomo-rule-form');
    const item=draft.routingRules.find(rule=>rule.id===id)||
      {id:'',type:'LIST',payload:'',target:'DIRECT',noResolve:false};
    const decoded=window.MUIRuleLists?.decode(item);
    form.reset();
    form.elements.id.value=item.id||'';
    // Standalone GEOSITE stays editable on existing rules, but new rules
    // use the universal LIST editor. MATCH remains protected.
    const typeSelect=form.elements.type;
    for(const legacy of ['MATCH','GEOSITE'])
      typeSelect.querySelector('option[value="'+legacy+'"]')?.remove();
    if(item.type==='MATCH'||item.type==='GEOSITE'){
      const option=document.createElement('option');
      option.value=item.type;
      option.textContent=ruleTypeDisplayLabel(item.type);
      typeSelect.appendChild(option);
    }
    refreshRuleTypeLabels();
    typeSelect.disabled=item.type==='MATCH';
    form.elements.type.value=decoded?'LIST':item.type;
    // The same type -> conditions -> outbound layout is visible for every
    // rule, including existing AND -> DIRECT and GEOIP -> Russia.
    // Advanced options only contain type-specific flags such as No-Resolve.
    $('#mihomo-rule-advanced').open=!!id&&!!item.noResolve;
    $('#mihomo-rule-type-field [data-mihomo-rule-type]').dataset.mihomoRuleType=form.elements.type.value;
    form.elements.payload.value=item.payload||'';
    form.elements.geoCategories.value=decoded?.geos||'';
    form.elements.domainIPs.value=decoded?.domains||'';
    form.elements.target.innerHTML=targetOptions(item.target||'DIRECT');
    form.elements.target.value=item.target||'DIRECT';
    form.elements.noResolve.checked=decoded?.noResolve??(item.type==='LIST'?true:!!item.noResolve);
    syncRuleForm();
    $('#mihomo-rule-title').textContent=muiT(id?'mh.editRule':'mh.addRule');
    openModal('mihomo-rule-modal');
    (item.type==='MATCH'?form.elements.target:form.elements.type.value==='LIST'?form.elements.geoCategories:form.elements.payload).focus();
    if(form.elements.type.value==='LIST'){
      const original=form.elements.geoCategories.value;
      loadGeoCategories().then(catalog=>{
        // Show bare category names when their GeoSite/GeoIP source is unique.
        if(form.elements.geoCategories.value!==original)return;
        form.elements.geoCategories.value=original.split('\n').map(value=>window.MUIRuleLists.displayCategoryName(value,catalog)).join('\n');
      }).catch(()=>{});
    }
  }
  function ruleConditionLabel(type){
    const ru=window.muiGetLang?.()==='ru';
    if(type==='GEOIP')return ru?'Страна IP назначения':'Destination IP country';
    if(type==='SRC-GEOIP')return ru?'Страна IP источника':'Source IP country';
    if(type==='GEOSITE')return ru?'Категория сайтов GeoSite':'GeoSite category';
    if(type==='IP-ASN'||type==='SRC-IP-ASN')return ru?'Номер автономной системы (ASN)':'Autonomous system (ASN)';
    if(type.includes('IP-'))return ru?'IP-адрес / диапазон':'IP address / range';
    if(type.startsWith('DOMAIN'))return ru?'Домен / шаблон':'Domain / pattern';
    if(type.endsWith('PORT'))return ru?'Порт / диапазон':'Port / range';
    if(type==='NETWORK')return ru?'Протокол (TCP / UDP)':'Protocol (TCP / UDP)';
    if(type==='AND')return ru?'Логическое условие AND':'Logical AND expression';
    return ru?'Условие правила':'Rule condition';
  }
  function syncRuleForm(){
    const typeHelp=$('#mihomo-rule-type-field [data-mihomo-rule-type]');
    if(typeHelp)typeHelp.dataset.mihomoRuleType=$('#mihomo-rule-form').elements.type.value;
    const form=$('#mihomo-rule-form'),type=form.elements.type.value;
    const isMatch=type==='MATCH',isList=type==='LIST';
    const noResolve=isList||['GEOIP','IP-ASN','IP-CIDR','IP-CIDR6','IP-SUFFIX'].includes(type);
    $('#mihomo-rule-lists').hidden=!isList;
    $('#mihomo-rule-payload-field').hidden=isMatch||isList;
    $('#mihomo-rule-no-conditions').hidden=!isMatch;
    form.elements.payload.required=!isMatch&&!isList;
    $('#mihomo-rule-condition-label').textContent=ruleConditionLabel(type);
    $('#mihomo-rule-advanced').hidden=!noResolve;
    $('#mihomo-no-resolve-field').hidden=!noResolve;
    // Do not clear a temporarily hidden checkbox: switching rule types in
    // the unsaved form should not destroy the user's pending selection.
    $('#mihomo-rule-hint').textContent=rulePayloadHint(type);
  }
  async function saveRuleDraft(event){
    event.preventDefault();
    const form=event.currentTarget,type=form.elements.type.value;
    const original=draft.routingRules.find(rule=>rule.id===form.elements.id.value);
    const permitsNoResolve=type==='LIST'||['GEOIP','IP-ASN','IP-CIDR','IP-CIDR6','IP-SUFFIX'].includes(type);
    const item={
      id:form.elements.id.value||freshID('rule'),type,
      payload:type==='MATCH'?'':form.elements.payload.value.trim(),
      target:form.elements.target.value,
      // Hidden options must never silently overwrite a saved rule. If the
      // user changed to an unrelated type, do not carry the old IP flag over.
      noResolve:type==='MATCH'?false:permitsNoResolve?form.elements.noResolve.checked:
        original?.type===type?!!original.noResolve:false,
      ...(original?.enabled===false?{enabled:false}:{})
    };
    if(type==='LIST'){
      try{
        const catalog=await loadGeoCategories();
        Object.assign(item,window.MUIRuleLists.compile(
          form.elements.geoCategories.value,form.elements.domainIPs.value,catalog,form.elements.noResolve.checked));
      }catch(error){toast(error.message,true);return;}
    }else if(type!=='MATCH'&&!item.payload){toast(muiT('mh.payloadRequired',{type}),true);return;}
    const duplicateMatch=draft.routingRules.some(rule=>rule.type==='MATCH'&&rule.id!==item.id);
    if(type==='MATCH'&&duplicateMatch){toast(muiT('mh.singleMatch'),true);return;}
    const index=draft.routingRules.findIndex(rule=>rule.id===item.id);
    if(index>=0)draft.routingRules[index]=item;
    else {
      const matchIndex=draft.routingRules.findIndex(rule=>rule.type==='MATCH');
      draft.routingRules.splice(matchIndex<0?draft.routingRules.length:matchIndex,0,item);
    }
    const match=draft.routingRules.find(rule=>rule.type==='MATCH');
    draft.routingRules=draft.routingRules.filter(rule=>rule.type!=='MATCH');
    if(match)draft.routingRules.push(match);else ensureFinalMatch();
    closeModal($('#mihomo-rule-modal'));
    markDirty();
  }


  function fillBasicsForm(){
    const form=$('#mihomo-basics-form');
    for(const field of form.querySelectorAll('[name]')){
      const value=field.dataset.snifferField ? (draft.basics.sniffer||defaultBasics().sniffer)[field.dataset.snifferField] : draft.basics[field.name];
      if(field.type==='checkbox')field.checked=!!value;else field.value=value??'';
    }
    for(const field of $$('[data-basics-list]'))renderBasicsTags(field.dataset.basicsList);
    renderBasicsIndicators();
  }
  function renderBasicsIndicators(){
    $('#basics-mode-warning').hidden=draft.basics.mode==='rule';
    $('#basics-dns-log').checked=draft.basics.logLevel==='debug';
    const watchdogStatus=$('#basics-watchdog-status');
    if(watchdogStatus){
      const watchdog=app.state?.mihomoWatchdog;
      const state=watchdog?.state||'disabled';
      const key='mihomo.basic.watchdogStatus.'+state;
      const next=muiT(key)+(watchdog?.attempts?' · '+muiT('mihomo.basic.watchdogAttempts')+': '+watchdog.attempts+'/3':'');
      if(watchdogStatus.textContent!==next)watchdogStatus.textContent=next;
    }
  }
  function renderBasicsTags(name){
    const box=$('[data-basics-tags="'+name+'"] [data-tag-items]');
    box.innerHTML=(draft.basics[name]||[]).map((value,index)=>'<span class="basics-tag">'+esc(value)+'<button type="button" data-remove-tag="'+index+'" aria-label="'+esc(muiT('mh.removeTag',{value:value}))+'">'+SF('close')+'</button></span>').join('');
    $$('[data-remove-tag]',box).forEach(button=>button.onclick=()=>{draft.basics[name].splice(Number(button.dataset.removeTag),1);renderBasicsTags(name);markDirty();});
  }
  function commitBasicsTags(input){
    const items=input.value.split(/[,\n]+/).map(value=>value.trim()).filter(Boolean);
    if(!items.length)return;
    const name=input.dataset.basicsList;
    draft.basics[name]=[...new Set([...(draft.basics[name]||[]),...items])];
    input.value='';renderBasicsTags(name);markDirty();
  }
  function setupBasics(){
    const form=$('#mihomo-basics-form');
    form.onsubmit=event=>{event.preventDefault();saveSettings();};
    for(const eventName of ['input','change'])form.addEventListener(eventName,event=>{
      const field=event.target;
      if(field.dataset.snifferField){
        draft.basics.sniffer ||= clone(defaultBasics().sniffer);
        draft.basics.sniffer[field.dataset.snifferField]=field.type==='checkbox'?field.checked:field.value;
        markDirty();
      }else if(field.name in draft.basics){
        draft.basics[field.name]=field.type==='checkbox'?field.checked:field.type==='number'?Number(field.value):field.value;
        markDirty();
      }else if(field.dataset.basicsList)markDirty();
    });
    for(const field of $$('[data-basics-list]')){
      field.onkeydown=event=>{if(event.key==='Enter'||event.key===','){event.preventDefault();commitBasicsTags(field);}};
      field.onblur=()=>commitBasicsTags(field);
    }
    $('#basics-reset').onclick=async()=>{
      if(!await muiConfirm(muiT('mh.confirmResetBasics'),{danger:true}))return;
      draft.basics=defaultBasics();for(const field of $$('[data-basics-list]'))field.value='';fillBasicsForm();markDirty();
    };
  }
  async function testOutbound(button){
    const name=button.dataset.testOutbound;
    const item=outboundRows().find(row=>row.name===name);
    if(!item||outboundTestUnavailableReason(item))return;
    button.disabled=true;delayResults.set(name,'Testing');
    renderOutbounds();
    try{
      const result=await api('/api/mihomo/outbound/delay',{method:'POST',body:JSON.stringify({name})});
      delayResults.set(name,result.delay+' ms');
    }catch(error){delayResults.set(name,error.message);}finally{
      if(['outbounds','balancers','subscriptions'].includes(currentTab))renderOutbounds();
    }
  }


  function currentWarpOutbound(){
    return draft.outbounds.find(item=>item.type==='wireguard'&&item.warpDeviceId)||draft.outbounds.find(item=>item.type==='wireguard'&&item.name==='warp');
  }
  function renderWarpRouting(){
    const item=currentWarpOutbound(),tags=$('[data-basics-tags="warpDomains"]');
    $('#basics-warp').hidden=!!item;
    tags.hidden=!item&&!(draft.basics.warpDomains||[]).length;
  }
  function ensureWarpModal(){
    if($('#warp-modal'))return;
    const modal=document.createElement('div');modal.id='warp-modal';modal.className='modal-backdrop';
    modal.innerHTML=`<section class="modal-panel warp-modal" role="dialog" aria-modal="true" aria-labelledby="warp-title">
      <header class="modal-titlebar"><span id="warp-title">Cloudflare WARP</span><button type="button" class="modal-close" id="warp-close" aria-label="Close" data-i18n-aria="common.close">${SF('close')}</button></header>
      <div class="modal-content">
        <div id="warp-loading" role="status" hidden data-i18n="mh.warpLoading">Loading...</div>
        <div id="warp-error" role="alert" hidden></div>
        <div id="warp-empty"><button class="outline-btn" id="warp-create" type="button" data-i18n="common.create">Create</button><p class="warp-note" data-i18n-html="mh.warpNote">Create 会向 Cloudflare 注册 WARP 设备并接受 <a href="https://www.cloudflare.com/application/terms/" target="_blank" rel="noreferrer">WARP 服务条款</a>。</p></div>
        <div id="warp-details" hidden>
          <table class="warp-info"><tbody>
            <tr><th data-i18n="mh.accessToken">Access Token</th><td id="warp-access-token"></td></tr><tr><th data-i18n="mh.deviceId">Device ID</th><td id="warp-device-id"></td></tr>
            <tr><th data-i18n="mh.licenseKey">License Key</th><td id="warp-license-value"></td></tr><tr><th data-i18n="drawer.privateKey">Private Key</th><td id="warp-private-key"></td></tr>
          </tbody></table>
          <button class="danger-btn" id="warp-delete" type="button" data-i18n="common.delete">Delete</button>
          <h3 class="warp-divider" data-i18n="mh.warpSettings">Settings</h3>
          <details class="basics-section warp-license"><summary>WARP/WARP+ License Key</summary><form id="warp-license-form" autocomplete="off"><label for="warp-license-input">Key</label><input id="warp-license-input" autocomplete="off" spellcheck="false"><button id="warp-license-update" type="submit" class="outline-btn" disabled data-i18n="common.update">Update</button></form></details>
          <h3 class="warp-divider" data-i18n="mh.warpAccountInfo">Account Information</h3>
          <button class="mihomo-primary" id="warp-refresh" type="button" data-i18n="mh.warpMoreInfo">More Information</button>
          <table class="warp-info"><tbody>
            <tr><th data-i18n="mh.deviceName">Device Name</th><td id="warp-device-name"></td></tr><tr><th data-i18n="mh.deviceModel">Device Model</th><td id="warp-device-model"></td></tr>
            <tr><th data-i18n="mh.deviceEnabled">Device Enabled</th><td id="warp-device-enabled"></td></tr><tr><th data-i18n="mh.accountType">Account Type</th><td id="warp-account-type"></td></tr>
            <tr><th data-i18n="mh.role">Role</th><td id="warp-account-role"></td></tr><tr><th data-i18n="mh.warpPlusData">WARP+ Data</th><td id="warp-premium"></td></tr>
            <tr><th data-i18n="mh.quota">Quota</th><td id="warp-quota"></td></tr><tr><th data-i18n="dash.usage">Usage</th><td id="warp-usage"></td></tr>
          </tbody></table>
          <div id="warp-config-error" role="status" hidden></div>
          <h3 class="warp-divider" data-i18n="mh.warpOutboundStatus">Outbound Status</h3>
          <div class="warp-outbound-status"><span class="mihomo-pill" id="warp-outbound-status"></span><span id="warp-pending" hidden data-i18n="mh.warpPending">Pending Save</span><button type="button" id="warp-add" class="mihomo-primary">Add Outbound</button></div>
        </div>
      </div>
    </section>`;
    document.body.appendChild(modal);
    $('#warp-close').onclick=()=>{if(!warpBusy)closeModal(modal);};
    modal.onclick=event=>{if(event.target===modal&&!warpBusy)closeModal(modal);};
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!warpBusy&&modal.classList.contains('open'))closeModal(modal);});
    $('#warp-create').onclick=()=>warpAction('/create');
    $('#warp-refresh').onclick=()=>warpAction('/refresh');
    $('#warp-delete').onclick=deleteWarp;
    $('#warp-add').onclick=addWarpOutbound;
    $('#warp-license-input').oninput=syncWarpButtons;
    $('#warp-license-form').onsubmit=event=>{event.preventDefault();if(!$('#warp-license-update').disabled)warpAction('/license',{license:$('#warp-license-input').value.trim()});};
  }
  let vpngateData=null,vpngateBusy=false,vpngateTimer=null,vpngateEditingId='',vpngateFetching=false,vpngateFetchedAt=0;
  function vpnGateUsedSlots(){
    const original=(app.state?.state?.outbounds||[]).find(item=>item.id===vpngateEditingId)?.vpngate?.slot;
    return new Set([...(vpngateData?.usedSlots||[]).filter(slot=>slot!==original),...draft.outbounds.filter(item=>item.vpngate&&item.id!==vpngateEditingId).map(item=>item.vpngate.slot)]);
  }
  function vpnGatePending(item){
    const saved=(app.state?.state?.outbounds||[]).find(candidate=>candidate.id===item.id);
    return !saved?.vpngate||saved.name!==item.name||JSON.stringify(saved.vpngate)!==JSON.stringify(item.vpngate);
  }
  async function refreshVPNGateData(force=false){
    if(vpngateFetching||(!force&&Date.now()-vpngateFetchedAt<5000))return;
    vpngateFetching=true;
    try{vpngateData=await api('/api/mihomo/vpngate');vpngateFetchedAt=Date.now();if($('#vpngate-modal')?.classList.contains('open'))renderVPNGateModal();else if(currentTab==='outbounds')renderOutbounds();}
    catch(error){if($('#vpngate-modal')?.classList.contains('open'))showVPNGateError(error.message);}
    finally{vpngateFetching=false;}
  }
  function vpnGateCountryInfo(code){return (vpngateData?.presets||[]).find(item=>item.code===code)||null;}
  function validVPNGateCountry(code){return /^[A-Z]{2}$/.test(String(code||''));}
  function vpnGateStatusForSlot(slot){return (vpngateData?.statuses||[]).find(item=>Number(item.slot)===Number(slot))||null;}
  function vpnGateStateLabel(state){return muiT({'starting':'mh.vpngateStarting','searching':'mh.vpngateSearching','connecting':'mh.vpngateConnecting','connected':'mh.vpngateConnected','reconnecting':'mh.vpngateReconnecting','error':'mh.vpngateError','pending':'mh.vpngatePending'}[state]||'mh.vpngateUnknown');}
  function vpnGateStatusHTML(item){
    if(!item?.vpngate)return '';
    const status=vpnGatePending(item)?null:vpnGateStatusForSlot(item.vpngate.slot);
    if(!status)return `<div class="vpngate-row-status"><span class="mihomo-pill">${esc(muiT(vpnGatePending(item)?'mh.vpngatePending':'mh.vpngateWaiting'))}</span></div>`;
    const details=[status.node,status.isp||status.asn].filter(Boolean).join(' · ');
    return `<div class="vpngate-row-status"><span class="mihomo-pill ${status.connected?'group':''}">${esc(vpnGateStateLabel(status.state))}</span>${status.fallback?`<span class="mihomo-pill fallback">${esc(muiT('mh.vpngateFallback'))}</span>`:''}<span class="vpngate-row-detail">${esc(details||status.lastError||'—')}</span></div>`;
  }
  function scheduleVPNGatePoll(delay=1500){
    clearTimeout(vpngateTimer);vpngateTimer=setTimeout(async()=>{vpngateTimer=null;if(!$('#vpngate-modal')?.classList.contains('open'))return;try{vpngateData=await api('/api/mihomo/vpngate');renderVPNGateModal();if(vpngateData?.install?.running)scheduleVPNGatePoll(1000);else if(vpngateData?.statuses?.length)scheduleVPNGatePoll(5000);}catch(error){showVPNGateError(error.message);}},delay);
  }
  // The alert sits at the top of a long dialog; bring it into view so an action at the bottom (Uninstall, Reconnect) never looks like it did nothing.
  function showVPNGateError(message){const box=$('#vpngate-error');if(box){box.textContent=message;box.hidden=!message;if(message)box.scrollIntoView({block:'nearest',behavior:'smooth'});}}
  function syncVPNGateForm(){
    const form=$('#vpngate-form');if(!form)return;
    const country=form.elements.country.value.trim().toUpperCase();form.elements.country.value=country;
	if(form.dataset.country&&form.dataset.country!==country)form.elements.isp.value='';
	form.dataset.country=country;
    const valid=validVPNGateCountry(country),info=vpnGateCountryInfo(country),isp=form.elements.isp;
    isp.disabled=!valid;
    const note=$('#vpngate-isp-note');if(note)note.textContent=!valid?muiT('mh.vpngateChooseCountry'):country==='KR'?muiT('mh.vpngateKoreaOnly'):info?.keyword?muiT('mh.vpngateKeywordHint'):muiT('mh.vpngateKeywordOnly');
    const slot=Number(form.elements.slot.value)||0,used=vpnGateUsedSlots();
    for(const option of form.elements.slot.options)option.disabled=used.has(Number(option.value));
    const preview=$('#vpngate-slot-preview');if(preview)preview.textContent=muiT('mh.vpngateSlotPreview',{iface:`vpn_vpn${slot}`,table:100+slot});
	const raw=isp.value.trim(),preset=(info?.isps||[]).find(item=>item.label.toLowerCase()===raw.toLowerCase()||item.id.toLowerCase()===raw.toLowerCase()),add=$('#vpngate-add');
	if(add)add.disabled=vpngateBusy||!valid||used.has(slot)||!raw||(country==='KR'&&!preset);
  }
  function vpnGateFormConfig(){
    const form=$('#vpngate-form'),country=form.elements.country.value.trim().toUpperCase(),raw=form.elements.isp.value.trim(),info=vpnGateCountryInfo(country),preset=(info?.isps||[]).find(item=>item.label.toLowerCase()===raw.toLowerCase()||item.id.toLowerCase()===raw.toLowerCase());
    return {country,isp:preset?.id||'',ispKeyword:preset?'':raw,slot:Number(form.elements.slot.value)||0,name:form.elements.name.value.trim()};
  }
  function resetVPNGateForm(){
    const form=$('#vpngate-form');if(!form)return;form.reset();form.dataset.originalSlot='';form.dataset.country='';vpngateEditingId='';
    const option=Array.from(form.elements.slot.options).find(candidate=>!vpnGateUsedSlots().has(Number(candidate.value)));if(option)form.elements.slot.value=option.value;
    syncVPNGateForm();
  }
  function renderVPNGateStatuses(){
    const box=$('#vpngate-status-list');if(!box)return;
    const saved=(draft.outbounds||[]).filter(item=>item.vpngate),bySlot=new Map(saved.map(item=>[Number(item.vpngate.slot),item])),statuses=vpngateData?.statuses||[];
    for(const status of statuses)if(!bySlot.has(Number(status.slot)))bySlot.set(Number(status.slot),{name:status.outbound||'VPNGate',vpngate:{slot:Number(status.slot),country:status.country||'',ispKeyword:status.target||''}});
    const rows=[...bySlot.entries()].sort((a,b)=>a[0]-b[0]);
    if(!rows.length){box.innerHTML=`<div class="mihomo-empty"><strong>${esc(muiT('mh.vpngateNoSaved'))}</strong><span>${esc(muiT('mh.vpngateNoSavedNote'))}</span></div>`;return;}
    box.innerHTML=rows.map(([slot,item])=>{const status=vpnGateStatusForSlot(slot),config=item.vpngate;return `<div class="vpngate-status-row"><div class="vpngate-status-main"><strong>${esc(item.name)}</strong><span>${esc(config.country)} · ${esc(vpnGateISPLabelForUI(config))} · vpn_vpn${slot} · table ${100+slot}</span></div><div class="vpngate-status-state"><span class="mihomo-pill ${status?.connected?'group':''}">${esc(vpnGateStateLabel(status?.state||'pending'))}</span>${status?.fallback?`<span class="mihomo-pill fallback">${esc(muiT('mh.vpngateFallback'))}</span>`:''}${status?.node?`<span class="vpngate-row-detail">${esc(status.node)}${status.isp?` · ${esc(status.isp)}`:''}</span>`:''}${status?.lastError?`<small class="vpngate-status-error">${esc(status.lastError)}</small>`:''}</div><div class="mihomo-actions"><button type="button" class="mihomo-icon" data-vpngate-edit="${esc(String(slot))}" title="${esc(muiT('action.edit'))}">${SF('edit')}</button><button type="button" class="outline-btn" data-vpngate-reconnect="${esc(String(slot))}" ${status?'':'disabled'}>${esc(muiT('mh.vpngateReconnect'))}</button>${item.id?`<button type="button" class="danger-btn" data-vpngate-uninstall="${esc(item.id)}">${esc(muiT('mh.vpngateUninstall'))}</button>`:''}</div></div>`;}).join('');
    $$('[data-vpngate-edit]',box).forEach(button=>button.onclick=()=>editVPNGateSlot(Number(button.dataset.vpngateEdit)));
    $$('[data-vpngate-reconnect]',box).forEach(button=>button.onclick=()=>reconnectVPNGate(Number(button.dataset.vpngateReconnect)));
	$$('[data-vpngate-uninstall]',box).forEach(button=>button.onclick=()=>stageVPNGateUninstall(button.dataset.vpngateUninstall));
  }
  function vpnGateISPLabelForUI(config){const info=vpnGateCountryInfo(config.country),preset=(info?.isps||[]).find(item=>item.id===config.isp);return preset?.label||config.ispKeyword||'—';}
  function renderVPNGateModal(){
    const modal=$('#vpngate-modal');if(!modal)return;
    const install=vpngateData?.install||{},installBox=$('#vpngate-install'),form=$('#vpngate-form'),button=$('#vpngate-install-button'),message=$('#vpngate-install-message'),error=$('#vpngate-install-error');
    if(message)message.textContent=install.installed?muiT('mh.vpngateInstalled',{version:install.version||''}):install.running?`${muiT('mh.vpngateInstalling')} ${install.message||''}`:install.reason||muiT('mh.vpngateNotInstalled');
    if(error){error.textContent=install.error||'';error.hidden=!install.error;}
    if(button){button.hidden=!!install.installed||!install.supported;button.disabled=vpngateBusy||!!install.running;button.textContent=install.running?muiT('mh.vpngateInstalling'):muiT('mh.vpngateInstall');}
    if(installBox)installBox.classList.toggle('installed',!!install.installed);
    if(form){form.hidden=!install.installed;syncVPNGateForm();}
    renderVPNGateStatuses();
    if(typeof muiApply==='function')muiApply(modal);
    if(vpngateData?.install?.running)scheduleVPNGatePoll(1000);
    if(currentTab==='outbounds')renderOutbounds();
  }
  function ensureVPNGateModal(){
    if($('#vpngate-modal'))return;
    const modal=document.createElement('div');modal.id='vpngate-modal';modal.className='modal-backdrop';
    modal.innerHTML=`<section class="modal-panel vpngate-modal" role="dialog" aria-modal="true" aria-labelledby="vpngate-title"><header class="modal-titlebar"><span id="vpngate-title" data-i18n="mh.vpngateTitle">VPNGate</span><button type="button" class="modal-close" id="vpngate-close" data-i18n-aria="common.close" aria-label="Close">${SF('close')}</button></header><div class="modal-content"><div id="vpngate-error" role="alert" hidden></div><div id="vpngate-install" class="vpngate-install-card"><div><strong data-i18n="mh.vpngateClient">VPNGate Client</strong><p id="vpngate-install-message"></p><p data-i18n="mh.vpngateInstallNote">Installs the pinned official SoftEther VPN Client after checking Linux dependencies. Read and accept the included SoftEther licence before use.</p></div><button type="button" class="primary-btn" id="vpngate-install-button">Install</button><div id="vpngate-install-error" class="vpngate-status-error" role="alert" hidden></div></div><form id="vpngate-form" hidden><div class="mihomo-form-grid"><label class="mihomo-field"><span data-i18n="mh.vpngateCountry">Country</span><input name="country" maxlength="2" minlength="2" pattern="[A-Z]{2}" autocomplete="off" spellcheck="false" style="text-transform:uppercase" placeholder="JP" required></label><label class="mihomo-field"><span data-i18n="mh.vpngateISP">ISP / ASN keyword</span><input name="isp" autocomplete="off" spellcheck="false" disabled required><small id="vpngate-isp-note"></small></label><label class="mihomo-field"><span data-i18n="mh.vpngateName">Outbound name</span><input name="name" maxlength="128" placeholder="vpngate-jp-0"></label><label class="mihomo-field"><span data-i18n="mh.vpngateSlot">VPNGate NIC index</span><select name="slot">${Array.from({length:10},(_,index)=>`<option value="${index}">${index}</option>`).join('')}</select><small id="vpngate-slot-preview"></small></label></div><footer class="modal-footer"><button type="button" class="outline-btn" id="vpngate-cancel" data-i18n="common.cancel">Cancel</button><button type="submit" class="primary-btn" id="vpngate-add" data-i18n="mh.vpngateAdd">Add to Draft</button></footer></form><h3 class="warp-divider" data-i18n="mh.vpngateStatus">Saved VPNGate Outbounds</h3><div id="vpngate-status-list"></div></div></section>`;
    document.body.appendChild(modal);
    if(typeof window.muiUpgradeCombobox==='function'){
      window.muiUpgradeCombobox(modal.querySelector('[name="country"]'),function(){
        const presets=vpngateData?.presets;
        if(presets&&presets.length){
          return presets.map(item=>{
            const label=item.code==='JP'?'Japan':item.code==='KR'?'Korea':item.code;
            return {value:item.code,label,sublabel:label};
          });
        }
        return [
          {value:'JP',label:'Japan',sublabel:'Japan'},
          {value:'KR',label:'Korea',sublabel:'Korea'}
        ];
      });
      window.muiUpgradeCombobox(modal.querySelector('[name="isp"]'),function(){
        const form=$('#vpngate-form');if(!form)return [];
        const country=form.elements.country.value.trim().toUpperCase();
        const info=vpnGateCountryInfo(country);
        return (info?.isps||[]).map(item=>({value:item.label,label:item.label}));
      });
    }
    $('#vpngate-close').onclick=()=>{if(!vpngateBusy){if(window.muiCloseSelects)window.muiCloseSelects();clearTimeout(vpngateTimer);closeModal(modal);}};
    $('#vpngate-cancel').onclick=()=>{if(!vpngateBusy){if(window.muiCloseSelects)window.muiCloseSelects();vpngateEditingId='';closeModal(modal);}};
    modal.onclick=event=>{if(event.target===modal&&!vpngateBusy){if(window.muiCloseSelects)window.muiCloseSelects();clearTimeout(vpngateTimer);closeModal(modal);}};
    $('#vpngate-install-button').onclick=installVPNGate;
    $('#vpngate-form').onsubmit=saveVPNGateDraft;
    $('#vpngate-form').elements.country.oninput=syncVPNGateForm;
    $('#vpngate-form').elements.country.onchange=syncVPNGateForm;
    $('#vpngate-form').elements.isp.oninput=syncVPNGateForm;
    $('#vpngate-form').elements.slot.onchange=syncVPNGateForm;
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!vpngateBusy&&modal.classList.contains('open')){clearTimeout(vpngateTimer);closeModal(modal);}});
  }
  async function openVPNGateModal(id=''){
    ensureVPNGateModal();openModal('vpngate-modal');if(vpngateBusy)return;
    vpngateEditingId='';showVPNGateError('');resetVPNGateForm();vpngateBusy=true;renderVPNGateModal();
    try{vpngateData=await api('/api/mihomo/vpngate');vpngateFetchedAt=Date.now();resetVPNGateForm();renderVPNGateModal();const item=draft.outbounds.find(candidate=>candidate.id===id);if(item?.vpngate)editVPNGateSlot(item.vpngate.slot);scheduleVPNGatePoll();}catch(error){showVPNGateError(error.message);}finally{vpngateBusy=false;renderVPNGateModal();}
  }
  async function installVPNGate(){
    if(vpngateBusy)return;vpngateBusy=true;showVPNGateError('');renderVPNGateModal();
    try{vpngateData=await api('/api/mihomo/vpngate/install',{method:'POST'});renderVPNGateModal();}catch(error){showVPNGateError(error.message);}finally{vpngateBusy=false;renderVPNGateModal();}
  }
  function editVPNGateSlot(slot){
    const item=draft.outbounds.find(candidate=>candidate.vpngate&&Number(candidate.vpngate.slot)===slot);if(!item)return;
    const form=$('#vpngate-form');if(!form||form.hidden)return;vpngateEditingId=item.id;form.dataset.originalSlot=String(slot);form.dataset.country=item.vpngate.country;form.elements.country.value=item.vpngate.country;form.elements.isp.value=vpnGateISPLabelForUI(item.vpngate);form.elements.name.value=item.name||'';form.elements.slot.value=String(slot);syncVPNGateForm();form.elements.country.focus();
  }
  async function reconnectVPNGate(slot){
    if(vpngateBusy)return;vpngateBusy=true;showVPNGateError('');try{vpngateData=await api('/api/mihomo/vpngate/reconnect',{method:'POST',body:JSON.stringify({slot})});renderVPNGateModal();scheduleVPNGatePoll(1000);}catch(error){showVPNGateError(error.message);}finally{vpngateBusy=false;renderVPNGateModal();}
  }
	async function stageVPNGateUninstall(id){
	  const item=draft.outbounds.find(candidate=>candidate.id===id&&candidate.vpngate);if(!item)return;
	  const dependencies=outboundDependencies(item.name);
	  for(const inbound of app.state?.state?.inbounds||[])if(inbound.proxy===item.name)dependencies.push('Inbound '+inbound.name);
	  if(dependencies.length){const message=muiT('mh.cannotDelete',{deps:dependencies.join(muiT('common.listSep')),name:item.name});showVPNGateError(message);toast(message,true);return;}
	  if(!await muiConfirm(muiT('mh.vpngateConfirmUninstall',{name:item.name}),{danger:true}))return;
	  draft.outbounds=draft.outbounds.filter(candidate=>candidate.id!==id);vpngateEditingId='';markDirty();
	  clearTimeout(vpngateTimer);closeModal($('#vpngate-modal'));toast(muiT('mh.vpngateUninstallDrafted'));
	}
  async function saveVPNGateDraft(event){
    event.preventDefault();if(vpngateBusy)return;
    const form=event.currentTarget,config=vpnGateFormConfig();
    if(!validVPNGateCountry(config.country)){showVPNGateError(muiT('mh.vpngateCountryInvalid'));return;}
    const info=vpnGateCountryInfo(config.country),preset=(info?.isps||[]).find(item=>item.id===config.isp);
    if(config.country==='KR'&&!preset){showVPNGateError(muiT('mh.vpngateKoreaOnly'));return;}
    if(!config.isp&&!config.ispKeyword){showVPNGateError(muiT('mh.vpngateISPRequired'));return;}
    if(config.name&&draft.outbounds.some(item=>item.id!==vpngateEditingId&&item.name===config.name)){showVPNGateError(muiT('mh.vpngateNameTaken'));return;}
    const used=vpnGateUsedSlots();if(used.has(config.slot)){showVPNGateError(muiT('mh.vpngateSlotUsed'));return;}
    vpngateBusy=true;showVPNGateError('');
    try{
      const item=clone(await api('/api/mihomo/vpngate/outbound',{method:'POST',body:JSON.stringify(config)})),next=clone(draft),editing=vpngateEditingId?next.outbounds.findIndex(candidate=>candidate.id===vpngateEditingId):-1;
      item.id=editing>=0?vpngateEditingId:freshID('vpngate');
      if(editing>=0){const previous=next.outbounds[editing];next.outbounds[editing]=item;if(previous.name!==item.name)renameReferences(next.outbounds,next.routingRules,previous.name,item.name);}else next.outbounds.push(item);
      draft=next;markDirty();vpngateEditingId='';form.dataset.originalSlot='';closeModal($('#vpngate-modal'));
    }catch(error){showVPNGateError(error.message);}finally{vpngateBusy=false;renderVPNGateModal();}
  }

  function showWarpError(message){const box=$('#warp-error');box.textContent=message;box.hidden=!message;}
  function syncWarpButtons(){
    for(const id of ['warp-create','warp-refresh','warp-delete','warp-close'])$('#'+id).disabled=warpBusy;
    $('#warp-license-input').disabled=warpBusy;
    $('#warp-license-update').disabled=warpBusy||!/^[A-Za-z0-9]{8}-[A-Za-z0-9]{8}-[A-Za-z0-9]{8}$/.test($('#warp-license-input').value.trim());
    $('#warp-add').disabled=warpBusy||!warpData?.outbound;
    $('#warp-loading').hidden=!warpBusy;
  }
  function renderWarpModal(){
    const account=warpData?.account,device=account?.device||{},info=device.account||{},item=currentWarpOutbound();
    $('#warp-empty').hidden=!!account;$('#warp-details').hidden=!account;
    const values={'access-token':account?.accessToken,'device-id':account?.deviceId,'license-value':account?.licenseKey,'private-key':account?.privateKey,'device-name':device.name,'device-model':device.model,'device-enabled':device.enabled,'account-type':info.account_type,'account-role':info.role,premium:fmt(info.premium_data||0),quota:fmt(info.quota||0),usage:fmt(info.usage||0)};
    for(const [id,value] of Object.entries(values))$('#warp-'+id).textContent=value===undefined||value===null||value===''?'—':String(value);
    $('#warp-outbound-status').textContent=muiT(item?'common.enabled':'inbounds.statusDisabled');
    $('#warp-outbound-status').classList.toggle('group',!!item);
    $('#warp-add').textContent=muiT(item?'mh.resetOutbound':'mihomo.addOutbound');
    $('#warp-pending').hidden=!dirty;
    $('#warp-config-error').textContent=warpData?.configError||'';$('#warp-config-error').hidden=!warpData?.configError;
    syncWarpButtons();
  }
  async function openWarpModal(){
    ensureWarpModal();openModal('warp-modal');if(warpBusy)return;
    warpData=null;showWarpError('');warpBusy=true;renderWarpModal();
    try{warpData=await api('/api/mihomo/warp');}catch(error){showWarpError(error.message);}finally{warpBusy=false;renderWarpModal();}
  }
  async function warpAction(action,input){
    if(warpBusy)return;warpBusy=true;showWarpError('');syncWarpButtons();
    try{
      warpData=await api('/api/mihomo/warp'+action,{method:'POST',...(input?{body:JSON.stringify(input)}:{})});
      if(action==='/license')$('#warp-license-input').value='';
    }catch(error){showWarpError(error.message);}finally{warpBusy=false;renderWarpModal();}
  }
  function addWarpOutbound(){
    if(warpBusy||!warpData?.outbound)return;
    const existing=currentWarpOutbound(),item=clone(warpData.outbound);
    if(!existing&&draft.outbounds.some(candidate=>candidate.name===item.name)){showWarpError(muiT('mh.warpNameTaken'));return;}
    if(existing){
      item.id=existing.id;item.name=existing.name;item.native.name=existing.name;
      draft.outbounds[draft.outbounds.findIndex(candidate=>candidate.id===existing.id)]=item;
    }else{item.id=freshID('warp');draft.outbounds.push(item);}
    markDirty();renderWarpRouting();closeModal($('#warp-modal'));
  }
  async function deleteWarp(){
    if(warpBusy)return;
    const existing=currentWarpOutbound();
    if(existing){
      const dependencies=outboundDependencies(existing.name).filter(value=>value!=='Basics / WARP Routing');
      for(const inbound of app.state?.state?.inbounds||[])if(inbound.proxy===existing.name)dependencies.push('Inbound '+inbound.name);
      if(dependencies.length){showWarpError(muiT('mh.warpRemoveRefs',{deps:dependencies.join(muiT('common.listSep'))}));return;}
    }
    if(!await muiConfirm(muiT('mh.confirmDeleteWarp'),{danger:true}))return;
    warpBusy=true;showWarpError('');syncWarpButtons();
    try{
      warpData=await api('/api/mihomo/warp',{method:'DELETE'});
      if(existing){draft.outbounds=draft.outbounds.filter(item=>item.id!==existing.id);draft.basics.warpDomains=[];$('#basics-warpDomains-input').value='';renderBasicsTags('warpDomains');markDirty();}
      renderWarpRouting();
    }catch(error){showWarpError(error.message);}finally{warpBusy=false;renderWarpModal();}
  }


  // Reuse the existing centered M-UI dialog design for Save and Restart.
  // A busy dialog is intentionally not dismissible while the request runs.
  let mihomoActionBusy=false;
  function openMihomoStatusDialog(kind){
    const previousFocus=document.activeElement;
    const backdrop=document.createElement('div');
    backdrop.id='mihomo-operation-status';
    backdrop.className='modal-backdrop mui-dialog mui-balancer-use-backdrop mui-mihomo-status-backdrop open';
    const panel=document.createElement('section');
    panel.className='modal-panel narrow mui-dialog-panel mui-balancer-use-panel mui-mihomo-status-panel';
    panel.setAttribute('role','dialog');
    panel.setAttribute('aria-modal','true');
    panel.setAttribute('aria-labelledby','mihomo-operation-title');
    panel.setAttribute('aria-describedby','mihomo-operation-message');
    const header=document.createElement('header');
    header.className='mui-balancer-use-header mui-mihomo-status-header';
    const indicator=document.createElement('span');
    indicator.className='mui-balancer-use-icon mui-mihomo-status-indicator';
    indicator.setAttribute('aria-hidden','true');
    const title=document.createElement('h2');
    title.id='mihomo-operation-title';
    header.append(indicator,title);
    const body=document.createElement('div');
    body.className='modal-content mui-balancer-use-content mui-mihomo-status-content';
    const detail=document.createElement('p');
    detail.id='mihomo-operation-message';
    detail.setAttribute('role','status');
    detail.setAttribute('aria-live','polite');
    body.appendChild(detail);
    const footer=document.createElement('footer');
    footer.className='modal-footer mui-balancer-use-actions mui-mihomo-status-actions';
    const dismiss=document.createElement('button');
    dismiss.type='button';
    dismiss.className='primary-btn mui-status-error-close';
    dismiss.textContent=muiT('common.close');
    dismiss.disabled=true;
    footer.append(dismiss);
    panel.append(header,body,footer);
    backdrop.appendChild(panel);
    let busy=true,successDismissTimer=0;
    const close=()=>{
      if(busy)return;
      if(successDismissTimer){clearTimeout(successDismissTimer);successDismissTimer=0;}
      document.removeEventListener('keydown',onKey,true);
      backdrop.remove();
      if(previousFocus&&document.contains(previousFocus))previousFocus.focus?.({preventScroll:true});
    };
    const onKey=event=>{
      if(event.key==='Escape'){
        event.preventDefault();
        event.stopPropagation();
        close();
      }else if(event.key==='Tab'){
        if(busy||backdrop.dataset.phase==='success'){event.preventDefault();return;}
        event.preventDefault();
        dismiss.focus();
      }
    };
    dismiss.onclick=close;
    backdrop.addEventListener('mousedown',event=>{if(event.target===backdrop)close();});
    document.addEventListener('keydown',onKey,true);
    document.body.appendChild(backdrop);
    panel.tabIndex=-1;
    panel.focus({preventScroll:true});
    const set=(phase,message)=>{
      if(successDismissTimer){clearTimeout(successDismissTimer);successDismissTimer=0;}
      busy=phase==='pending';
      backdrop.dataset.phase=phase;
      indicator.textContent=phase==='pending'?'':(phase==='success'?'✓':'!');
      title.textContent=muiT(phase==='error'?'mh.operationFailureTitle':
        phase==='success'?(kind==='save'?'mh.operationSaveTitle':kind==='apply'?'mh.operationApplyTitle':'mh.operationRestartTitle'):
        (kind==='save'?'mh.operationSaving':kind==='apply'?'mh.operationApplying':'mh.operationRestarting'));
      detail.textContent=String(message||'');
      // Pending/success notifications have no close button; success
      // disappears after 2.5 s. Errors keep an accessible Close action.
      footer.hidden=phase!=='error';
      dismiss.disabled=phase!=='error';
      if(phase==='error')dismiss.focus({preventScroll:true});
      else panel.focus({preventScroll:true});
      // Successful saves/apply/restarts dismiss themselves; errors stay visible
      // until explicitly closed. The timer is canceled on manual dismissal.
      if(phase==='success')successDismissTimer=setTimeout(close,2500);
    };
    set('pending',muiT(kind==='save'?'mh.operationSaving':kind==='apply'?'mh.operationApplying':'mh.operationRestarting'));
    return {set,close};
  }

  async function restartMihomoFromSettings(){
    if(mihomoActionBusy)return false;
    if(dirty){toast(muiT('mh.saveFirst'),true);return false;}
    mihomoActionBusy=true;
    const button=$('#mihomo-restart');
    button.disabled=true;
    const dialog=openMihomoStatusDialog('restart');
    try{
      await api('/api/core/restart',{method:'POST'});
      dialog.set('success',muiT('mh.operationRestartSuccess'));
      await refresh();
      return true;
    }catch(error){dialog.set('error',error.message);return false;}
    finally{mihomoActionBusy=false;syncButtons();}
  }

  async function saveSettings(){
    if(mihomoActionBusy)return;
    for(const field of $$('[data-basics-list]'))commitBasicsTags(field);
    mihomoActionBusy=true;
    const button=$('#mihomo-save');button.disabled=true;
    const dialog=openMihomoStatusDialog('save');
    try{
      // Never submit the full list of subscription nodes for a manual group
      // edit (e.g. deleting FOREIGN). The server applies only changed IDs
      // against its live subscription snapshot under one mutex.
      const same= (a,b)=>JSON.stringify(a)===JSON.stringify(b);
      // The subscription service owns proxy nodes. Their current/previous
      // snapshots can diverge while an editor draft is open (refresh, filter,
      // status updates). Never send these read-only entries to editor PUT.
      const editable=items=>items.filter(item=>!item.sourceSubscriptionId);
      const lastEditable=editable(lastSyncedOutbounds);
      const currentEditable=editable(draft.outbounds);
      const changedOutbounds=!same(currentEditable,lastEditable);
      const changedBasics=!same(draft.basics,lastSyncedBasics);
      const changedRules=!same(draft.routingRules,lastSyncedRules);
      const routingOnly=!changedOutbounds&&!changedBasics;
      let response;
      if(routingOnly){
        response=await api('/api/mihomo/rules',{method:'PUT',body:JSON.stringify({routingRules:draft.routingRules})});
      }else{
        const previous=new Map(lastEditable.map(item=>[item.id,item]));
        const current=new Set(currentEditable.map(item=>item.id));
        const deleteIds=lastEditable.filter(item=>!current.has(item.id)).map(item=>item.id);
        const upserts=currentEditable.filter(item=>!previous.has(item.id)||!same(item,previous.get(item.id)));
        const manualOrder=items=>items.map(item=>item.id);
        const order=manualOrder(currentEditable);
        const changes={upserts,deleteIds};
        if(!same(order,manualOrder(lastEditable)))changes.order=order;
        if(changedRules)changes.routingRules=draft.routingRules;
        if(changedBasics)changes.basics=draft.basics;
        response=await api('/api/mihomo/editor',{method:'PUT',body:JSON.stringify(changes)});
      }
      dirty=false;root.classList.remove('mihomo-dirty');
      if(app.state?.state){
        if(changedBasics){
          app.state.state.mihomoBasics=clone(draft.basics);
          app.state.state.settings.mode=draft.basics.mode;
          app.state.state.settings.logLevel=draft.basics.logLevel;
        }
        if(changedRules)app.state.state.routingRules=clone(draft.routingRules);
        // Deliberately do NOT replace live Outbounds with a stale draft.
        // refresh() reloads the canonical subscribed nodes after the save.
      }
      dialog.set('success',muiT('mh.settingsSaved'));
      await refresh();
    }catch(error){dialog.set('error',error.message);}
    finally{mihomoActionBusy=false;syncButtons();}
  }

  ensureModals();
  setupRuleHelp();
  $$('.mihomo-tab',root).forEach(button=>button.onclick=()=>setTab(button.dataset.mihomoTab));
  const hideFilteredToggle=$('#mihomo-hide-filtered-outbounds');
  if(hideFilteredToggle){
    try{hideFilteredToggle.checked=localStorage.getItem('mui-hide-filtered-outbounds')==='1';}catch{}
    hideFilteredToggle.onchange=()=>{
      try{localStorage.setItem('mui-hide-filtered-outbounds',hideFilteredToggle.checked?'1':'0');}catch{}
      if(currentTab==='outbounds')renderOutbounds();
    };
  }
  $('#mihomo-add-outbound').onclick=()=>openOutboundModal();
  $('#mihomo-add-balancer').onclick=()=>openOutboundModal('', 'group');
  $('#mihomo-add-sub-balancer').onclick=()=>{if(dirty){toast('Сначала сохраните изменения Mihomo Settings',true);return;}openOutboundModal('', 'group');};
  $('#mihomo-add-source').onclick=()=>{if(dirty){toast('Сначала сохраните изменения Mihomo Settings',true);return;}window.MUIOutboundSubscriptions?.openSource();};
  $('#mihomo-add-rule').onclick=()=>openRuleModal();
  $('#mihomo-warp').onclick=openWarpModal;
  $('#mihomo-vpngate').onclick=()=>openVPNGateModal();
  $('#basics-warp').onclick=openWarpModal;
  // Saved metadata lives on the server. Never silently discard the unsaved
  // Mihomo editor or subscription filter inputs on browser reload.
  window.addEventListener('beforeunload',event=>{
    if(!dirty&&!window.MUIBalancerServers?.hasUnsavedFilterEdits?.())return;
    event.preventDefault();event.returnValue='';
  });
  $('#mihomo-save').onclick=saveSettings;
  $('#mihomo-restart').onclick=restartMihomoFromSettings;

  const baseRenderState=renderState;
  renderState=function(){baseRenderState();syncFromState();if(app.currentView==='mihomo'&&currentTab==='outbounds'&&draft.outbounds.some(item=>item.vpngate))refreshVPNGateData();};
  const baseSetView=setView;
  setView=function(name){baseSetView(name);if(name==='mihomo'){render();if(draft.outbounds.some(item=>item.vpngate))refreshVPNGateData();}};
  window.addEventListener('mui-langchange',()=>{
    hideRuleHelp();
    refreshRuleTypeLabels();
    const cond=$('#mihomo-rule-condition-label');
    if(cond)cond.textContent=ruleConditionLabel($('#mihomo-rule-form').elements.type.value);
    render();
    for(const field of $$('[data-basics-list]'))renderBasicsTags(field.dataset.basicsList);
    if($('#mihomo-outbound-modal')?.classList.contains('open')){
      $('#mihomo-outbound-title').textContent=muiT(editingOutbound?'mh.editOutbound':'mihomo.addOutbound');
      const form=$('#mihomo-outbound-form');
      if(form.elements.kind.value==='group')populateOutboundTypes(form,form.elements.type.value);
    }
    if($('#mihomo-rule-modal')?.classList.contains('open')){$('#mihomo-rule-title').textContent=muiT(editingRule?'mh.editRule':'mh.addRule');syncRuleForm();}
    if($('#warp-modal')?.classList.contains('open'))renderWarpModal();
    if($('#vpngate-modal')?.classList.contains('open'))renderVPNGateModal();
  });
  // Subscription reload is asynchronous; refresh classification when it
  // completes, without navigating away or overwriting unsaved edits.
  window.addEventListener('mui-balancer-subscriptions-loaded',event=>{
    balancerSubscriptions=Array.isArray(event.detail?.subscriptions)?event.detail.subscriptions:[];
    if(currentTab==='subscriptions'||currentTab==='balancers')renderOutbounds();
  });
  window.MUIMihomoSettings={openTab:setTab,isDirty:()=>dirty,refreshOutbounds:syncFromState,restart:restartMihomoFromSettings};
  setupBasics();syncFromState();setTab('basics');
})();
