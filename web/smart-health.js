(() => {
  const root=document.getElementById('smart-health-root');
  if(!root)return;
  const el=id=>document.getElementById('smart-health-'+id);
  const modes={disabled:'Отключён',pending:'Ожидает перезапуска Mihomo',starting:'Подготовка проверки',normal:'Штатный',degraded:'Ускоренный',offline:'Аварийный — нет ответа контрольных сервисов',unknown:'Результат проверки неизвестен',core_unavailable:'Ядро Mihomo недоступно'};
  const en={disabled:'Disabled',pending:'Mihomo restart required',starting:'Preparing check',normal:'Normal',degraded:'Degraded',offline:'Emergency — control services unreachable',unknown:'Check result unknown',core_unavailable:'Mihomo unavailable'};
  const ru=()=>window.muiGetLang?.()==='ru'||!window.muiGetLang;
  const mode=s=>(ru()?modes:en)[s]||s||'—';
  const format=t=>t&&new Date(t).getFullYear()>1970?new Date(t).toLocaleString():'—';
  let dirty=false,busy=false,loaded=false,lastSettings="",catalog=[],selected=new Set(),editingID=null;
  const editor=el('editor');
  const count=()=>{el('count').textContent=(ru()?'Выбрано: ':'Selected: ')+selected.size+' / '+catalog.length;};
  function markDirty(){dirty=true;el('save').disabled=busy||!loaded;count();}
  function updateEditorHint(){
    el('editor-hint').textContent=({HTTPS:'HTTPS · 443 · HEAD /',DoH:'DoH · 443 · /dns-query',DoT:'DoT · 853'})[el('editor-protocol').value]||'';
  }
  function openEditor(id=null){
    if(busy||!loaded)return;
    if(!id&&catalog.length>=32){el('message').textContent='Максимум 32 контрольных сервиса';return;}
    editingID=id;
    const item=catalog.find(x=>x.id===id);
    el('editor-title').textContent=item?'Редактировать контрольный сервис':'Добавить контрольный сервис';
    el('editor-submit').textContent=item?'Применить':'Добавить';
    el('editor-name').value=item?.name||'';
    el('editor-host').value=item?.host||'';
    el('editor-protocol').value=item?.protocol||'HTTPS';
    el('editor-error').textContent='';
    updateEditorHint();
    editor.showModal();el('editor-name').focus();
  }
  function renderCatalog(){
    const list=el('services');list.replaceChildren();
    for(const item of catalog){
      const row=document.createElement('div');row.className='smart-health-service-row';
      const input=document.createElement('input');input.type='checkbox';input.dataset.smartService=item.id;input.checked=selected.has(item.id);input.setAttribute('aria-label','Опрос: '+item.name+' · '+item.protocol);
      input.onchange=()=>{if(input.checked)selected.add(item.id);else selected.delete(item.id);markDirty();};
      const name=document.createElement('button');name.type='button';name.className='smart-health-service-name';name.dataset.smartEdit=item.id;name.textContent=item.name;
      name.title=item.host;name.setAttribute('aria-label','Редактировать '+item.name+' · '+item.protocol);name.onclick=()=>openEditor(item.id);
      const protocol=document.createElement('span');protocol.className='smart-health-protocol';protocol.dataset.protocol=item.protocol;protocol.textContent=item.protocol;
      const status=document.createElement('span');status.dataset.smartResult=item.id;status.className='smart-health-service-status mihomo-muted';status.textContent='—';
      const remove=document.createElement('button');remove.type='button';remove.className='smart-health-service-remove';remove.dataset.smartRemove=item.id;remove.textContent='×';remove.title='Удалить';remove.setAttribute('aria-label','Удалить '+item.name+' · '+item.protocol);
      remove.onclick=()=>{if(busy)return;catalog=catalog.filter(x=>x.id!==item.id);selected.delete(item.id);renderCatalog();markDirty();};
      row.append(input,name,protocol,status,remove);list.append(row);
    }
    count();
  }
  el('add').onclick=()=>openEditor();
  el('editor-cancel').onclick=()=>editor.close();
  el('editor-protocol').onchange=updateEditorHint;
  el('editor-form').onsubmit=event=>{
    event.preventDefault();
    const name=el('editor-name').value.trim(),host=el('editor-host').value.trim().toLowerCase(),protocol=el('editor-protocol').value;
    if(!name||!host.includes('.')||!host.split('.').every(x=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x))||!/[a-z]/.test(host.split('.').slice(-1)[0])){el('editor-error').textContent='Укажите название и публичный домен без схемы, пути или порта.';return;}
    if(catalog.some(x=>x.id!==editingID&&x.host===host&&x.protocol===protocol)){el('editor-error').textContent='Этот сервис уже есть в списке.';return;}
    let id=editingID;
    if(!id){
      do{id='custom-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);}while(catalog.some(x=>x.id===id));
      catalog.push({id,name,host,protocol});selected.add(id);
    }else{catalog=catalog.map(x=>x.id===id?{id,name,host,protocol}:x);}
    editor.close();renderCatalog();markDirty();
  };
  function renderStatus(status){
    el('mode').dataset.mode=status.mode;
    el('mode').textContent=mode(status.mode)+(status.running?(ru()?' · опрос…':' · checking…'):'');
    el('info').textContent=(ru()?'Доступно узлов: ':'Healthy nodes: ')+(status.healthy??0)+(ru()?' · групп: ':' · groups: ')+(status.groups??0)+' · '+(ru()?'последняя проверка: ':'last: ')+format(status.last)+' · '+(ru()?'следующая: ':'next: ')+format(status.next);
    el('pending').hidden=!status.pending;
    const results=new Map((status.controls||[]).map(x=>[x.id,x]));
    root.querySelectorAll('[data-smart-result]').forEach(node=>{
      const r=results.get(node.dataset.smartResult);
      const text=!r?'—':r.ok?'✓ '+r.milliseconds+' ms':(ru()?'Нет ответа':'No response');
      node.textContent=text;
      node.dataset.mode=!r?'disabled':r.ok?'normal':'offline';
    });
    const list=el('events');
    const nodes=(status.events||[]).slice().reverse().map(e=>{
      const item=document.createElement('div');item.className='smart-health-event';
      const time=document.createElement('time');time.textContent=format(e.at);
      const state=document.createElement('strong');state.className='smart-health-event-state';state.dataset.mode=e.mode;state.textContent=mode(e.mode);
      item.append(time,state);return item;
    });
    if(!nodes.length){const p=document.createElement('p');p.className='mihomo-muted';p.textContent=ru()?'Нет событий':'No events';nodes.push(p)}
    list.replaceChildren(...nodes);
  }
  function fill(data){
    const signature=JSON.stringify([data.settings,data.catalog]);
    if(!loaded||(!dirty&&signature!==lastSettings)){
      const s=data.settings;lastSettings=signature;
      el('enabled').checked=!!s.enabled;el('normal').value=s.normalSeconds;el('degraded').value=s.degradedSeconds;el('offline').value=s.offlineSeconds;
      catalog=(data.catalog||[]).map(x=>({...x}));
      selected=new Set(s.services);
      renderCatalog();
      el('add').disabled=false;
      loaded=true;
    }
    renderStatus(data.status);
  }
  async function load(){
    if(busy||editor.open)return;
    busy=true;
    try{fill(await api('/api/mihomo/smart-health'))}
    catch(error){el('message').textContent=error.message}
    finally{busy=false;el('save').disabled=!dirty||!loaded}
  }
  root.addEventListener('change',event=>{
    if(event.target.matches('input')&&!editor.contains(event.target)&&!event.target.matches('[data-smart-service]'))markDirty();
  });
  el('save').onclick=async()=>{
    if(busy||!loaded||editor.open)return;
    if(!selected.size){el('message').textContent='Выберите хотя бы один контрольный сервис.';return;}
    busy=true;el('save').disabled=true;
    const inputs=[...root.querySelectorAll('input,button')].filter(x=>x!==el('save')&&!editor.contains(x));inputs.forEach(x=>x.disabled=true);
    try{
      const body={enabled:el('enabled').checked,normalSeconds:Number(el('normal').value),degradedSeconds:Number(el('degraded').value),offlineSeconds:Number(el('offline').value),services:catalog.filter(x=>selected.has(x.id)).map(x=>x.id),catalog:catalog.map(x=>({...x}))};
      const data=await api('/api/mihomo/smart-health',{method:'PUT',body:JSON.stringify(body)});
      dirty=false;lastSettings='';fill(data);el('message').textContent=ru()?'Настройки сохранены':'Settings saved';
      if(data.status.pending){
        const accepted=await window.muiConfirm(
          ru()?'Настройки монитора сохранены. Для их применения требуется перезапустить Mihomo. Во время перезапуска соединения могут кратковременно прерваться. Перезапустить сейчас?'
              :'Monitor settings saved. Restart Mihomo to apply the scheduling change. Connections may be briefly interrupted. Restart now?',
          {title:ru()?'Требуется перезапуск Mihomo':'Mihomo restart required',
           confirmText:ru()?'Перезапустить Mihomo':'Restart Mihomo',
           cancelText:ru()?'Позже':'Later',danger:true}
        );
        if(accepted){
          const restarted=await window.MUIMihomoSettings.restart();
          if(restarted)fill(await api('/api/mihomo/smart-health'));
        }
      }

    }catch(error){el('message').textContent=error.message}
    finally{inputs.forEach(x=>x.disabled=false);busy=false;el('save').disabled=!dirty||!loaded}
  };
  document.querySelector('[data-mihomo-tab="smart-health"]')?.addEventListener('click',load);
  setInterval(()=>{if(root.closest('.mihomo-pane')?.classList.contains('active')&&root.closest('.view')?.classList.contains('active'))load()},5000);
})();
