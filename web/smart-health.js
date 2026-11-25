(() => {
  const root=document.getElementById('smart-health-root');
  if(!root)return;
  const el=id=>document.getElementById('smart-health-'+id);
  const modes={disabled:'Отключён',pending:'Ожидает перезапуска Mihomo',starting:'Подготовка проверки',normal:'Штатный',degraded:'Ускоренный',offline:'Нет ответа контрольных сервисов',unknown:'Результат проверки неизвестен',core_unavailable:'Ядро Mihomo недоступно'};
  const en={disabled:'Disabled',pending:'Mihomo restart required',starting:'Preparing check',normal:'Normal',degraded:'Degraded',offline:'Control services unreachable',unknown:'Check result unknown',core_unavailable:'Mihomo unavailable'};
  const ru=()=>window.muiGetLang?.()==='ru'||!window.muiGetLang;
  const mode=s=>(ru()?modes:en)[s]||s||'—';
  const format=t=>t&&new Date(t).getFullYear()>1970?new Date(t).toLocaleString():'—';
  let dirty=false,busy=false,loaded=false,lastSettings="";
  function renderStatus(status){
    el('mode').textContent=mode(status.mode)+(status.running?(ru()?' · опрос…':' · checking…'):'');
    el('info').textContent=(ru()?'Доступно узлов: ':'Healthy nodes: ')+(status.healthy??0)+(ru()?' · групп: ':' · groups: ')+(status.groups??0)+' · '+(ru()?'последняя проверка: ':'last: ')+format(status.last)+' · '+(ru()?'следующая: ':'next: ')+format(status.next);
    el('pending').hidden=!status.pending;
    const results=new Map((status.controls||[]).map(x=>[x.id,x]));
    root.querySelectorAll('[data-smart-result]').forEach(node=>{
      const r=results.get(node.dataset.smartResult);
      const text=!r?'—':r.ok?'✓ '+r.milliseconds+' ms':(ru()?'Нет ответа':'No response');
      node.textContent=text;
      node.style.color=!r?'':r.ok?'#009B77':'var(--danger)';
    });
    const list=el('events');
    const nodes=(status.events||[]).slice().reverse().map(e=>{
      const item=document.createElement('p');item.className='mihomo-muted';item.textContent=format(e.at)+' · '+mode(e.mode);return item;
    });
    if(!nodes.length){const p=document.createElement('p');p.className='mihomo-muted';p.textContent=ru()?'Нет событий':'No events';nodes.push(p)}
    list.replaceChildren(...nodes);
  }
  function fill(data){
    const signature=JSON.stringify(data.settings);
    if(!loaded||(!dirty&&signature!==lastSettings)){
      const s=data.settings;lastSettings=signature;
      el('enabled').checked=!!s.enabled;el('normal').value=s.normalSeconds;el('degraded').value=s.degradedSeconds;el('offline').value=s.offlineSeconds;
      const list=el('services');list.replaceChildren();
      for(const item of data.catalog){
        const row=document.createElement('div');row.className='basics-row';
        const label=document.createElement('label');label.style.display='flex';label.style.alignItems='center';label.style.gap='10px';
        const input=document.createElement('input');input.type='checkbox';input.dataset.smartService=item.id;input.checked=s.services.includes(item.id);
        const name=document.createElement('span');name.textContent=item.name+' · '+item.protocol;label.append(input,name);
        const status=document.createElement('span');status.dataset.smartResult=item.id;status.className='mihomo-muted';status.textContent='—';
        row.append(label,status);list.append(row);
      }
      loaded=true;
    }
    renderStatus(data.status);
  }
  async function load(){
    if(busy)return;
    busy=true;
    try{fill(await api('/api/mihomo/smart-health'))}
    catch(error){el('message').textContent=error.message}
    finally{busy=false;el('save').disabled=!dirty||!loaded}
  }
  root.addEventListener('change',event=>{
    if(event.target.matches('input')){dirty=true;el('save').disabled=!loaded;}
  });
  el('save').onclick=async()=>{
    if(busy||!loaded)return;
    busy=true;el('save').disabled=true;
    try{
      const body={enabled:el('enabled').checked,normalSeconds:Number(el('normal').value),degradedSeconds:Number(el('degraded').value),offlineSeconds:Number(el('offline').value),services:[...root.querySelectorAll('[data-smart-service]:checked')].map(x=>x.dataset.smartService)};
      const data=await api('/api/mihomo/smart-health',{method:'PUT',body:JSON.stringify(body)});
      dirty=false;lastSettings='';fill(data);el('message').textContent=ru()?'Настройки сохранены':'Settings saved';
    }catch(error){el('message').textContent=error.message}
    finally{busy=false;el('save').disabled=!dirty||!loaded}
  };
  document.querySelector('[data-mihomo-tab="smart-health"]')?.addEventListener('click',load);
  setInterval(()=>{if(root.closest('.mihomo-pane')?.classList.contains('active')&&root.closest('.view')?.classList.contains('active'))load()},5000);
})();
