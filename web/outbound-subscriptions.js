// Subscription-powered balancers. The UI never exposes provider credentials,
// and node selection/filters are independently verified by the Go API.
(() => {
  'use strict';
  const root=document.getElementById('outsub-root');
  if(!root)return;
  const q=(selector,parent=document)=>parent.querySelector(selector);
  const make=(tag,className,value)=>{
    const element=document.createElement(tag);
    if(className)element.className=className;
    if(value!==undefined)element.textContent=String(value);
    return element;
  };
  const base=()=>location.pathname.replace(/[^/]*$/,'');
  async function request(path,options={}){
    const response=await fetch(base()+path.replace(/^\/+/,''),{
      headers:{'Content-Type':'application/json'},credentials:'same-origin',...options
    });
    let json={};
    try{json=await response.json();}catch{}
    if(response.status===401){location.href=base()+'login';throw Error('Требуется вход в панель');}
    if(!response.ok)throw Error(json.message||'Ошибка обращения к панели');
    return json.data??json;
  }
  let subs=[],previewNodes=[],excluded=new Set(),loadedURL='',ascending=true;
  const status=(msg,error=false)=>{
    const element=q('#outsub-status');
    element.textContent=msg||'';
    element.style.color=error?'var(--red,#d54343)':'';
  };
  function date(value){
    if(!value)return 'Ещё не обновлялась';
    const parsed=new Date(value);
    return Number.isFinite(parsed.getTime())?parsed.toLocaleString():value;
  }
  async function confirmAction(message){
    return typeof muiConfirm==='function' ? muiConfirm(message,{danger:true}) : false;
  }
  function safeGroups(){
    const state=typeof app!=='undefined'?app.state?.state:{};
    return (state?.outbounds||[]).filter(x=>x.kind==='group').map(x=>x.name);
  }
  function newButton(text,action,sub){
    const button=make('button','outline-btn',text);
    button.type='button';
    button.onclick=async()=>{
      if(action==='edit'){openForm(sub,'source');return;}
      if(action==='delete' && !await confirmAction('Удалить подписку «'+sub.name+'»? Узлы, используемые правилами, будут защищены.'))return;
      button.disabled=true;
      status('Выполняется: '+sub.name+'…');
      const path='/api/mihomo/subscriptions/'+encodeURIComponent(sub.id);
      try{
        await request(path+(action==='refresh'?'/refresh':''),{method:action==='refresh'?'POST':'DELETE'});
        await refreshPanel();
        await load();
        status(action==='refresh'?'Узлы и балансировщики обновлены':'Подписка удалена');
      }catch(error){
        if(action==='delete' && await confirmAction('Удалить запись подписки, оставив её узлы в Outbounds?')){
          try {
            await request(path+'?keepNodes=true',{method:'DELETE'});
            await refreshPanel();await load();status('Подписка удалена; узлы сохранены');return;
          }catch(next){status(next.message,true);}
        }else{status(error.message,true);}
      }finally{button.disabled=false;}
    };
    return button;
  }
  function renderList(){
    const container=q('#outsub-list');
    container.replaceChildren();
    if(!subs.length){
      container.appendChild(make('div','outsub-empty','Подписок пока нет. Нажмите «Добавить подписку», чтобы загрузить источник. После этого он появится в списке выбора балансировщиков.'));
      return;
    }
    for(const sub of subs){
      const card=make('article','outsub-card');
      // Keep all subscription metadata inside a dedicated compact frame;
      // action buttons remain outside so information and actions are distinct.
      const info=make('div','outsub-info-frame');
      const title=make('div','outsub-card-head'),block=make('div','outsub-card-title');
      block.appendChild(make('h3','',sub.name));
      title.appendChild(block);
      const statusBadge=make('span','outsub-pill'+(sub.enabled?'':' off'));
      if(sub.enabled){
        const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
        icon.setAttribute('viewBox','0 0 24 24');
        icon.setAttribute('aria-hidden','true');
        icon.classList.add('outsub-refresh-icon');
        const path=document.createElementNS('http://www.w3.org/2000/svg','path');
        path.setAttribute('d','M20 11a8 8 0 0 0-14.9-4M4 4v5h5M4 13a8 8 0 0 0 14.9 4M20 20v-5h-5');
        icon.appendChild(path);
        statusBadge.appendChild(icon);
      }
      statusBadge.appendChild(make('span','',sub.enabled?'Автообновление':'Приостановлено'));
      title.appendChild(statusBadge);
      info.appendChild(title);
      info.appendChild(make('p','outsub-muted outsub-card-meta',
        (sub.group?'Исходная группа: '+sub.group:'Общий источник без собственной группы')+
        ' · интервал '+sub.intervalMinutes+' мин'));
      const stats=make('div','outsub-stat');
      stats.appendChild(make('span','outsub-count-badge',String(sub.nodeCount||0)+' узлов'));
      stats.appendChild(make('span','outsub-last-updated','Обновлено '+date(sub.lastUpdated)));
      info.appendChild(stats);
      if(sub.lastError){
        const problem=make('div','outsub-error','Ошибка: '+sub.lastError);
        problem.setAttribute('role','alert');
        info.appendChild(problem);
      }
      card.appendChild(info);
      const actions=make('div','outsub-actions');
      for(const [caption,action] of [['Обновить','refresh'],['Параметры подписки','edit'],['Удалить','delete']]){
        actions.appendChild(newButton(caption,action,sub));
      }
      card.appendChild(actions);
      container.appendChild(card);
    }
  }
  async function load(){
    try{
      const data=await request('/api/mihomo/subscriptions');
      // Put canonical sources first; preserve legacy source order within
      // each group so existing cards and saved user choices do not jump.
      subs=Array.isArray(data)?[...data].sort((a,b)=>
        Number(!!a.group)-Number(!!b.group)):[];
      renderList();status('Подписок: '+subs.length);
      window.dispatchEvent(new CustomEvent('mui-balancer-subscriptions-loaded',{
        detail:{subscriptions:subs.map(source=>({id:source.id,group:source.group,name:source.name}))}
      }));
    }
    catch(error){status(error.message,true);}
  }
  const matchWords=text=>String(text||'').replace(/\r\n/g,'\n').split('\n').map(x=>x.trim().toLowerCase()).filter(x=>x&&!x.startsWith('#'));
  function passesFilter(name,keep,drop){
    const node=typeof name==='string'?{name}:name;
    const location=window.MUICountryFlags?.byCode.get(node.countryCode||window.MUICountryFlags?.read(node.name)?.code);
    const parts=[node.name,node.flag,location?.flag,location?.english,location?.ru,location?.code,
      window.MUICountryFlags?.aliases?.[location?.code]];
    const text=parts.filter(Boolean).join(' ').toLocaleLowerCase('ru');
    return (!keep.length||keep.some(word=>text.includes(word)))&&!drop.some(word=>text.includes(word));
  }
  function currentSelection(form){
    const keep=matchWords(form.elements.filterKeep.value),drop=matchWords(form.elements.filterExclude.value);
    const eligible=previewNodes.filter(n=>passesFilter(n,keep,drop));
    const selected=eligible.filter(n=>!excluded.has(n.key));
    return {keep,drop,eligible,selected};
  }
  function renderPreview(){
    const modal=q('#outsub-modal');
    if(!modal)return;
    const form=q('#outsub-form',modal),box=q('#outsub-preview-list',modal);
    if(!previewNodes.length){
      q('#outsub-preview-count',modal).textContent='Нажмите «Загрузить серверы» для проверки подписки';
      box.replaceChildren();return;
    }
    const selection=currentSelection(form);
    q('#outsub-preview-count',modal).textContent='Выбрано '+selection.selected.length+' из '+previewNodes.length+
      ' · скрыто фильтрами '+(previewNodes.length-selection.eligible.length)+
      ' · исключено вручную '+selection.eligible.filter(n=>excluded.has(n.key)).length;
    const search=form.elements.search.value.trim().toLowerCase();
    const candidates=previewNodes.filter(n=>!search||passesFilter(n,search? [search]:[],[]));
    candidates.sort((a,b)=>(ascending?1:-1)*a.name.localeCompare(b.name,'ru'));
    box.replaceChildren();
    for(const node of candidates.slice(0,250)){
      const eligible=passesFilter(node,selection.keep,selection.drop);
      const row=make('label','outsub-node'+(eligible?'':' filtered'));
      row.title=node.name;
      const check=make('input');check.type='checkbox';check.disabled=!eligible;
      check.checked=eligible&&!excluded.has(node.key);
      check.onchange=()=>{if(check.checked)excluded.delete(node.key);else excluded.add(node.key);renderPreview();};
      row.appendChild(check);
      const country=window.MUICountryFlags?.byCode.get(node.countryCode) || window.MUICountryFlags?.read(node.name);
      const flag=make('span','outsub-node-flag');
      const icon=window.MUICountryFlags?.createIcon(country?.code||node.countryCode);
      if(icon)flag.appendChild(icon);
      else flag.textContent='🌐';
      flag.title=country?.ru||country?.english||'Страна не определена по названию';
      row.appendChild(flag);
      // Hide duplicate Unicode flags in the *display label* only.
      // Original Outbound names and filtering data remain untouched.
      const displayName=icon?node.name.replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu,' ').replace(/\s+/g,' ').trim():node.name;
      const title=make('strong','outsub-node-name',displayName||node.name.replace(/[\r\n]+/g,' '));
      title.title=node.name;
      title.setAttribute('dir','auto');
      row.appendChild(title);
      const protocol=make('small','outsub-node-protocol',node.protocol||'proxy');
      protocol.title=eligible?'Протокол':'Скрыт фильтрами';
      row.appendChild(protocol);
      box.appendChild(row);
    }
    if(candidates.length>250){
      box.appendChild(make('div','outsub-muted','Показаны первые 250 из '+candidates.length+' узлов. Используйте поиск для остальных.'));
    }
    if(!candidates.length){box.appendChild(make('div','outsub-muted','По запросу узлы не найдены'));}
  }
  async function preview(form){
    const button=q('#outsub-preview-button');
    button.disabled=true;
    q('#outsub-preview-count').textContent='Получение списка серверов…';
    try{
      const choosing=form.dataset.mode==='balancer';
      const sourceID=form.elements.sourceId.value;
      if(choosing&&!sourceID)throw Error('Выберите подписку из списка');
      const data=choosing?null:{
        name:form.elements.name.value.trim()||'Preview',
        url:form.elements.url.value.trim(),
        enabled:form.elements.enabled.checked,
        intervalMinutes:Number(form.elements.intervalMinutes.value),
        filterKeep:form.elements.filterKeep.value,
        filterExclude:form.elements.filterExclude.value,
        excludedNodeKeys:Array.from(excluded)
      };
      const result=choosing
        ?await request('/api/mihomo/subscriptions/'+encodeURIComponent(sourceID)+'/nodes')
        :await request('/api/mihomo/subscriptions/preview',{method:'POST',body:JSON.stringify(data)});
      previewNodes=result.nodes||[];
      loadedURL=choosing?'source:'+sourceID:data.url;
      renderPreview();
      return result;
    }catch(error){
      q('#outsub-preview-count').textContent='Ошибка: '+error.message;
      status(error.message,true);
      throw error;
    }finally{button.disabled=false;}
  }
  function field(form,label,name,type,options={}){
    const wrapper=make('label','',label),control=make('input');
    control.name=name;control.type=type||'text';control.autocomplete='off';
    control.required=options.required!==false;
    if(options.placeholder)control.placeholder=options.placeholder;
    if(options.min)control.min=options.min;
    if(options.max)control.max=options.max;
    if(options.maxLength)control.maxLength=options.maxLength;
    wrapper.appendChild(control);form.appendChild(wrapper);
    return control;
  }
  // HydraRoute-style flag insertion, backed by ISO 3166 (249 regions).
  // A flag inserted here is a real filter expression; server-side matching
  // resolves it against a server name (even if the provider omitted emoji).
  function attachFlagPicker(wrapper,area){
    const choose=make('button','outline-btn outsub-flag-trigger');
    // An emoji flag button becomes a missing-glyph square on older Windows.
    // Draw the action using a local SVG symbol instead of platform emoji fonts.
    const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
    icon.setAttribute('viewBox','0 0 24 24');
    icon.setAttribute('aria-hidden','true');
    icon.classList.add('outsub-add-flag-icon');
    const flagPath=document.createElementNS('http://www.w3.org/2000/svg','path');
    flagPath.setAttribute('d','M5 21V4m0 1c4-3 7 2 13-1v11c-6 3-9-2-13 1');
    flagPath.setAttribute('fill','none');
    flagPath.setAttribute('stroke','currentColor');
    flagPath.setAttribute('stroke-width','1.8');
    flagPath.setAttribute('stroke-linecap','round');
    flagPath.setAttribute('stroke-linejoin','round');
    icon.appendChild(flagPath);
    choose.append(icon,document.createTextNode('Добавить флаг'));
    choose.type='button';
    choose.setAttribute('aria-label','Добавить флаг в '+(area.name==='filterKeep'?'Оставить только':'Исключить'));
    const menu=make('div','outsub-flag-picker');
    menu.hidden=true;
    const search=make('input');search.type='search';search.placeholder='Поиск страны или флага…';
    search.setAttribute('aria-label','Поиск страны');
    const list=make('div','outsub-flag-list');
    // Country selections remain visible as SVG chips below the editable
    // text field. Plain textareas cannot display image glyphs on Windows.
    const selected=make('div','outsub-selected-country-flags');
    selected.setAttribute('aria-label','Выбранные страны');
    function showSelectedCountries(){
      selected.replaceChildren();
      const directory=window.MUICountryFlags;
      for(const line of area.value.split(/\r?\n/)){
        const country=directory?.fromFilterLine(line);
        if(!country)continue;
        const chip=make('span','outsub-country-chip');
        const icon=directory.createIcon(country.code);
        if(icon)chip.appendChild(icon);
        chip.title=country.ru+' ('+country.code+')';
        chip.setAttribute('aria-label',country.ru+' — '+country.flag);
        // The chip itself must show the flag only; the country name remains
        // available in the tooltip / accessibility label.
        if(!icon)chip.textContent=country.flag;
        selected.appendChild(chip);
      }
    }
    area.addEventListener('input',showSelectedCountries);
    function populate(){
      list.replaceChildren();
      const countries=window.MUICountryFlags?.countries||[];
      const term=search.value.trim().toLocaleLowerCase('ru');
      const matching=countries.filter(item=>(item.ru+' '+item.english+' '+item.code+' '+item.flag+' '+(window.MUICountryFlags?.aliases?.[item.code]||'')).toLocaleLowerCase('ru').includes(term))
        .sort((a,b)=>a.ru.localeCompare(b.ru,'ru'));
      for(const country of matching.slice(0,100)){
        const button=make('button','outsub-country-option');
        const svg=window.MUICountryFlags?.createIcon(country.code);
        if(svg)button.appendChild(svg);
        button.appendChild(make('span','',country.ru+' ('+country.code+')'));
        button.type='button';
        button.title=country.english+' — '+country.code;
        button.onclick=()=>{
          const existing=area.value.trimEnd();
          const lines=existing.split(String.fromCharCode(10));
          // The persisted filter expression is the actual Unicode flag.
          // Mihomo's server filter resolves it against the detected country
          // even if the provider's node name does not contain an emoji.
          const term=country.flag;
          if(!lines.includes(term))area.value=existing+(existing?String.fromCharCode(10):'')+term;
          area.dispatchEvent(new Event('input',{bubbles:true}));
          menu.hidden=true;
          choose.focus();
        };
        list.appendChild(button);
      }
      if(!matching.length)list.appendChild(make('p','outsub-muted','Страна не найдена'));
      else if(matching.length>100)list.appendChild(make('p','outsub-muted','Уточните поиск для остальных стран'));
    }
    search.oninput=populate;
    choose.onclick=()=>{
      menu.hidden=!menu.hidden;
      if(!menu.hidden){populate();search.focus();}
    };
    menu.append(search,list);
    const toolbar=make('div','outsub-flag-toolbar');toolbar.appendChild(choose);
    wrapper.appendChild(toolbar);wrapper.appendChild(selected);wrapper.appendChild(menu);
  }
  function modal(){
    let overlay=q('#outsub-modal');
    if(overlay)return overlay;
    overlay=make('div','outsub-modal');overlay.id='outsub-modal';
    const dialog=make('div','outsub-dialog outsub-dialog-wide');
    dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
    const heading=make('h2','', 'Добавить балансировщик из подписки');
    heading.id='outsub-title';dialog.appendChild(heading);
    const form=make('form');form.id='outsub-form';
    field(form,'Имя балансировщика','groupName','text',{maxLength:120,placeholder:'Например, Foreign'});
    const typeLabel=make('label','', 'Режим балансировки'),type=make('select');
    type.name='groupType';
    for(const [id,label] of [['url-test','URL-тест — наименьшая задержка'],['fallback','Fallback — по приоритету'],['load-balance','Load Balance'],['select','Select — вручную']]){
      type.add(new Option(label,id));
    }
    typeLabel.appendChild(type);form.appendChild(typeLabel);
    const sourceLabel=make('label','outsub-source-choice-label','Выбрать подписку');
    const sourcePicker=make('select');sourcePicker.name='sourceId';sourcePicker.id='outsub-source-picker';
    sourcePicker.required=false;
    sourceLabel.appendChild(sourcePicker);
    form.appendChild(sourceLabel);
    field(form,'Название подписки','name','text',{maxLength:64,placeholder:'Например, My VPN'});
    field(form,'URL подписки','url','url',{maxLength:2048,placeholder:'https://provider.example/subscription/...'});
    const existing=make('label','outsub-existing','Подключить к существующему балансировщику');
    const group=make('select');group.name='group';existing.appendChild(group);form.appendChild(existing);
    field(form,'Интервал автообновления (минут)','intervalMinutes','number',{min:5,max:10080});
    const autoLabel=make('label','inline'),auto=make('input');auto.type='checkbox';auto.name='enabled';
    autoLabel.appendChild(auto);autoLabel.appendChild(document.createTextNode('Автоматически обновлять подписку'));
    form.appendChild(autoLabel);
    const filters=make('div','outsub-filters');
    for(const [name,label,placeholder] of [
      ['filterKeep','Оставить только','Germany\n🇩🇪\nLTE'],
      ['filterExclude','Исключить','Россия\nRussia\n🇺🇸']]){
      const wrapper=make('label','',label),area=make('textarea');
      area.name=name;area.rows=3;area.maxLength=4096;area.placeholder=placeholder;
      area.oninput=()=>renderPreview();
      wrapper.classList.add('outsub-filter-field');
      wrapper.appendChild(area);
      attachFlagPicker(wrapper,area);
      filters.appendChild(wrapper);
    }
    form.appendChild(filters);
    const toolbar=make('div','outsub-preview-toolbar');
    const loadBtn=make('button','outline-btn','Загрузить серверы');loadBtn.id='outsub-preview-button';loadBtn.type='button';
    loadBtn.onclick=()=>{preview(form).catch(()=>{});};
    toolbar.appendChild(loadBtn);
    sourcePicker.onchange=()=>{
      previewNodes=[];excluded=new Set();loadedURL='';renderPreview();
      if(sourcePicker.value)preview(form).catch(()=>{});
    };
    const search=make('input');search.name='search';search.type='search';search.placeholder='Поиск серверов…';
    search.oninput=renderPreview;toolbar.appendChild(search);
    const sort=make('button','outline-btn','Имя ↕');sort.type='button';sort.onclick=()=>{ascending=!ascending;renderPreview();};toolbar.appendChild(sort);
    form.appendChild(toolbar);
    const actionRow=make('div','outsub-preview-controls');
    const all=make('button','outline-btn','Выделить все');all.type='button';
    all.onclick=()=>{const selected=currentSelection(form);for(const node of selected.eligible)excluded.delete(node.key);renderPreview();};
    const none=make('button','outline-btn','Снять все');none.type='button';
    none.onclick=()=>{const selected=currentSelection(form);for(const node of selected.eligible)excluded.add(node.key);renderPreview();};
    actionRow.append(all,none);form.appendChild(actionRow);
    const counter=make('p','outsub-preview-count','Нажмите «Загрузить серверы» для проверки подписки');
    counter.id='outsub-preview-count';form.appendChild(counter);
    const nodeList=make('div','outsub-preview-list');nodeList.id='outsub-preview-list';form.appendChild(nodeList);
    form.appendChild(make('p','outsub-warning','Фильтры как в HydraRoute: по одной фразе на строку, без учёта регистра. «Оставить только» — совпадение с любой строкой; «Исключить» — исключает совпадения. Выбор узлов и фильтры сохраняются при автообновлении.'));
    const buttons=make('div','outsub-actions');
    const cancel=make('button','outline-btn','Отмена');cancel.type='button';cancel.onclick=()=>overlay.classList.remove('open');
    const save=make('button','primary-btn outsub-submit-primary','Создать балансировщик из подписки');save.id='outsub-submit';save.type='submit';
    buttons.append(cancel,save);form.appendChild(buttons);
    dialog.appendChild(form);overlay.appendChild(dialog);document.body.appendChild(overlay);
    overlay.addEventListener('click',event=>{if(event.target===overlay)overlay.classList.remove('open');});
    form.onsubmit=async event=>{
      event.preventDefault();
      if(window.MUIMihomoSettings?.isDirty?.()){
        status('Сначала сохраните изменения в Mihomo Settings',true);return;
      }
      const creatingGroup=form.dataset.mode==='balancer';
      save.disabled=true;status(creatingGroup?'Создание балансировщика из выбранной подписки…':'Сохранение источника подписки…');
      let saved=false;
      try{
        if(creatingGroup){
          const sourceID=form.elements.sourceId.value;
          if(!sourceID)throw Error('Сначала добавьте подписку во вкладке «Подписки»');
          if(!previewNodes.length||loadedURL!=='source:'+sourceID)await preview(form);
          if(currentSelection(form).selected.length===0)throw Error('Не выбрано ни одного узла');
          const groupName=form.elements.groupName.value.trim();
          if(!groupName)throw Error('Укажите имя балансировщика');
          await request('/api/mihomo/subscriptions/groups',{
            method:'POST',body:JSON.stringify({
              sourceId:sourceID,group:groupName,groupType:form.elements.groupType.value,
              filterKeep:form.elements.filterKeep.value,filterExclude:form.elements.filterExclude.value,
              excludedNodeKeys:Array.from(excluded)
            })
          });
        }else{
          const isNew=!form.dataset.id;
          // A source is imported only here. Groups reuse the same source ID,
          // nodes and auto-refresh interval without any new provider GET.
          const body={
            name:form.elements.name.value.trim(),
            url:form.elements.url.value.trim(),
            enabled:form.elements.enabled.checked,
            intervalMinutes:Number(form.elements.intervalMinutes.value),
            group:form.elements.group.value||'',
            filterKeep:form.elements.filterKeep.value,
            filterExclude:form.elements.filterExclude.value,
            excludedNodeKeys:Array.from(excluded),
            createGroup:false
          };
          await request('/api/mihomo/subscriptions'+(isNew?'':'/'+encodeURIComponent(form.dataset.id)),{
            method:isNew?'POST':'PUT',body:JSON.stringify(body)
          });
        }
        saved=true;
        overlay.classList.remove('open');
        status(creatingGroup?'Балансировщик создан. Используются общие узлы источника.':'Подписка сохранена');
      }catch(error){
        status(error.message,true);
        q('#outsub-preview-count').textContent='Ошибка сохранения: '+error.message;
      }finally{save.disabled=false;}
      if(saved){
        // The server commit has already succeeded. A disconnected panel
        // refresh must not be shown as a failed Save (or create duplicates).
        try{await refreshPanel();await load();}
        catch(error){status('Изменения сохранены. Обновите список после восстановления связи: '+error.message,true);}
      }
    };
    return overlay;
  }
  async function refreshPanel(){
    if(typeof refresh==='function')await refresh();
    window.MUIMihomoSettings?.refreshOutbounds?.();
  }
  function openForm(sub,mode='source'){
    const overlay=modal(),form=q('#outsub-form',overlay);
    form.reset();previewNodes=[];excluded=new Set(sub?.excludedNodeKeys||[]);loadedURL='';
    form.dataset.id=sub?.id||'';
    form.dataset.mode=mode;
    const creatingGroup=mode==='balancer';
    const isNew=!sub;
    q('#outsub-title',overlay).textContent=creatingGroup?'Добавить балансировщик из подписки':
      isNew?'Добавить подписку':'Настройки подписки '+sub.name;
    q('#outsub-submit',overlay).textContent=creatingGroup?'Создать балансировщик':
      isNew?'Добавить подписку':'Сохранить подписку';
    q('#outsub-preview-count',overlay).textContent='Нажмите «Загрузить серверы» для проверки подписки';
    q('#outsub-preview-list',overlay).replaceChildren();
    form.elements.groupName.closest('label').hidden=!creatingGroup;
    form.elements.groupName.required=creatingGroup;
    form.elements.groupType.closest('label').hidden=!creatingGroup;
    form.elements.group.closest('label').hidden=true;
    form.elements.sourceId.closest('label').hidden=!creatingGroup;
    form.elements.sourceId.required=creatingGroup;
    for(const name of ['name','url','intervalMinutes']){
      form.elements[name].closest('label').hidden=creatingGroup;
      form.elements[name].required=!creatingGroup;
    }
    form.elements.enabled.closest('label').hidden=creatingGroup;
    form.querySelector('.outsub-filters').hidden=!creatingGroup;
    form.querySelector('.outsub-preview-toolbar').hidden=!creatingGroup;
    form.querySelector('.outsub-preview-controls').hidden=!creatingGroup;
    form.querySelector('.outsub-preview-count').hidden=!creatingGroup;
    form.querySelector('.outsub-preview-list').hidden=!creatingGroup;
    form.querySelector('.outsub-warning').hidden=!creatingGroup;
    const sourceChoice=form.elements.sourceId;
    sourceChoice.replaceChildren(new Option(subs.length?'Выберите подписку…':
      'Подписок нет — добавьте их во вкладке «Подписки»',''));
    for(const source of subs){
      const limited=source.group&&(source.filterKeep||source.filterExclude||source.excludedNodeKeys?.length);
      const display=source.name+' · '+(source.group?'группа '+source.group:'общий источник')+
        ' · '+source.nodeCount+' серверов'+(limited?' · ранее отфильтрована':'')+
        (source.enabled?'':' · автообновление выключено');
      sourceChoice.add(new Option(display,source.id));
    }
    form.elements.groupName.value=sub?.group||'';
    form.elements.groupType.value='url-test';
    const select=form.elements.group;
    select.replaceChildren(new Option('Не связывать с группой',''));
    for(const name of safeGroups())select.add(new Option(name,name));
    if(sub?.group&&!safeGroups().includes(sub.group))select.add(new Option(sub.group,sub.group));
    select.value=sub?.group||'';
    form.elements.name.value=sub?.name||'';
    form.elements.url.value=sub?.url||'';
    form.elements.intervalMinutes.value=sub?.intervalMinutes||1440;
    form.elements.enabled.checked=sub?!!sub.enabled:true;
    form.elements.filterKeep.value=sub?.filterKeep||'';
    form.elements.filterExclude.value=sub?.filterExclude||'';
    form.elements.filterKeep.dispatchEvent(new Event('input',{bubbles:true}));
    form.elements.filterExclude.dispatchEvent(new Event('input',{bubbles:true}));
    overlay.classList.add('open');
    (isNew?form.elements.groupName:form.elements.name).focus();
  }
  q('#outsub-reload').onclick=load;
  window.MUIOutboundSubscriptions={
    load,
    openCreate:async()=>{await load();openForm(null,'balancer');},
    openSource:()=>openForm(null,'source')
  };
})();
