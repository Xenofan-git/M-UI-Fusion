// Remote VPN node subscriptions; independent of client-facing subscription exports.
(() => {
  'use strict';
  const root=document.getElementById('outsub-root');
  if(!root)return;
  const find=(selector,scope=document)=>scope.querySelector(selector);
  const make=(tag,className,text)=>{
    const element=document.createElement(tag);
    if(className)element.className=className;
    if(text!==undefined)element.textContent=String(text);
    return element;
  };
  const base=()=>location.pathname.replace(/[^/]*$/,'');
  const request=async(path,options={})=>{
    const response=await fetch(base()+path.replace(/^\/+/,''),{headers:{'Content-Type':'application/json'},...options});
    let data={};
    try{data=await response.json();}catch{}
    if(response.status===401){location.href=base()+'login';throw Error('Требуется вход в панель');}
    if(!response.ok)throw Error(data.message||'Не удалось выполнить запрос');
    return data.data??data;
  };
  let subscriptions=[],loaded=false;
  const status=(message,error=false)=>{
    const node=find('#outsub-status');
    node.textContent=message||'';
    node.style.color=error?'var(--red,#d54343)':'';
  };
  const formatDate=value=>{
    if(!value)return 'Ещё не обновлялась';
    const date=new Date(value);
    return Number.isFinite(date.getTime())?date.toLocaleString():value;
  };
  const confirmDelete=async message=>{
    return typeof muiConfirm==='function' ? muiConfirm(message,{danger:true}) : false;
  };
  function line(parent,text,important){
    const span=make('span');
    span.appendChild(document.createTextNode(text));
    if(important)span.appendChild(make('strong','',important));
    parent.appendChild(span);
  }
  function groups(){
    const state=typeof app!=='undefined'?app.state?.state:null;
    return (state?.outbounds||[]).filter(item=>item.kind==='group').map(item=>item.name);
  }
  function button(label,action,sub){
    const b=make('button','outline-btn',label);
    b.type='button';
    b.onclick=async()=>{
      if(action==='edit'){openForm(sub);return;}
      if(action==='delete'){
        const ok=await confirmDelete('Удалить подписку '+sub.name+'? Если её узлы используются в правилах/балансировщиках, понадобится сначала убрать ссылки или сохранить узлы.');
        if(!ok)return;
      }
      b.disabled=true;
      status('Выполняется: '+sub.name+'…');
      try{
        const url='/api/mihomo/subscriptions/'+encodeURIComponent(sub.id);
        await request(url+(action==='refresh'?'/refresh':''),{method:action==='refresh'?'POST':'DELETE'});
        await load();
        status(action==='refresh'?'Подписка обновлена, Outbounds синхронизированы':'Подписка удалена');
      }catch(err){
        if(action==='delete'&&await confirmDelete('Удалить запись о подписке, но оставить все её узлы в Outbounds?')){
          try{
            await request('/api/mihomo/subscriptions/'+encodeURIComponent(sub.id)+'?keepNodes=true',{method:'DELETE'});
            await load();status('Запись удалена, узлы сохранены');return;
          }catch(e){status(e.message,true);}
        }else status(err.message,true);
      }finally{b.disabled=false;}
    };
    return b;
  }
  function render(){
    const box=find('#outsub-list');
    box.replaceChildren();
    if(!subscriptions.length){
      box.appendChild(make('div','outsub-empty','Подписок пока нет. Добавьте URL — все узлы автоматически появятся в Mihomo Settings → Outbounds.'));
      return;
    }
    for(const sub of subscriptions){
      const card=make('article','outsub-card');
      const head=make('div','outsub-card-head'),titles=make('div');
      titles.appendChild(make('h3','',sub.name));
      titles.appendChild(make('p','outsub-muted','Интервал: '+sub.intervalMinutes+' мин'+(sub.group?' · Балансировщик: '+sub.group:'')));
      head.appendChild(titles);
      head.appendChild(make('span','outsub-pill'+(sub.enabled?'':' off'),sub.enabled?'Автообновление':'Приостановлено'));
      card.appendChild(head);
      const stats=make('div','outsub-stat');
      line(stats,'Импортировано узлов: ',String(sub.nodeCount||0));
      line(stats,'Обновлено: ',formatDate(sub.lastUpdated));
      card.appendChild(stats);
      if(sub.lastError){const warning=make('div','outsub-error','Ошибка обновления: '+sub.lastError);warning.setAttribute('role','alert');card.appendChild(warning);}
      const actions=make('div','outsub-actions');
      actions.appendChild(button('Обновить', 'refresh',sub));
      actions.appendChild(button('Изменить','edit',sub));
      actions.appendChild(button('Удалить','delete',sub));
      card.appendChild(actions);
      box.appendChild(card);
    }
  }
  async function load(){
    try{
      subscriptions=await request('/api/mihomo/subscriptions');
      loaded=true;render();status('Подписок: '+subscriptions.length);
    }catch(error){status(error.message,true);}
  }
  function modal(){
    let element=find('#outsub-modal');
    if(element)return element;
    element=make('div','outsub-modal');element.id='outsub-modal';
    const dialog=make('div','outsub-dialog');
    dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
    const title=make('h2','', 'Добавить подписку');title.id='outsub-title';dialog.appendChild(title);
    const form=make('form');form.id='outsub-form';
    const field=(labelText,name,type,options)=>{
      const label=make('label','',labelText),input=make('input');
      input.name=name;input.type=type||'text';
      input.required=true;input.autocomplete='off';
      if(options){
        if(options.maxLength)input.maxLength=options.maxLength;
        if(options.min)input.min=options.min;
        if(options.max)input.max=options.max;
        if(options.placeholder)input.placeholder=options.placeholder;
      }
      label.appendChild(input);form.appendChild(label);return input;
    };
    field('Название','name','text',{maxLength:64,placeholder:'Например, Foreign'});
    field('URL подписки','url','url',{maxLength:2048,placeholder:'https://provider.example/subscription/...'});
    field('Интервал автообновления (минут)','intervalMinutes','number',{min:5,max:10080});
    const groupLabel=make('label','', 'Добавлять узлы в балансировщик (необязательно)');
    const group=make('select');group.name='group';groupLabel.appendChild(group);form.appendChild(groupLabel);
    const autoLabel=make('label','inline');
    const auto=make('input');auto.type='checkbox';auto.name='enabled';
    autoLabel.appendChild(auto);autoLabel.appendChild(document.createTextNode('Автоматически обновлять подписку'));
    form.appendChild(autoLabel);
    form.appendChild(make('p','outsub-warning','Ссылка может содержать секретный токен. При ошибке загрузки прежние узлы сохраняются. Передача URL ограничена авторизованным администратором панели.'));
    const actions=make('div','outsub-actions');
    const cancel=make('button','outline-btn','Отмена');cancel.type='button';
    cancel.onclick=()=>element.classList.remove('open');
    const submit=make('button','primary-btn','Сохранить и импортировать');
    submit.type='submit';submit.id='outsub-submit';
    actions.append(cancel,submit);form.appendChild(actions);dialog.appendChild(form);element.appendChild(dialog);
    document.body.appendChild(element);
    element.addEventListener('click',e=>{if(e.target===element)element.classList.remove('open');});
    form.onsubmit=async event=>{
      event.preventDefault();
      const data={
        name:form.elements.name.value.trim(),
        url:form.elements.url.value.trim(),
        enabled:form.elements.enabled.checked,
        intervalMinutes:Number(form.elements.intervalMinutes.value),
        group:form.elements.group.value
      };
      const id=form.dataset.id;
      submit.disabled=true;status('Загрузка, разбор и проверка узлов…');
      try{
        await request('/api/mihomo/subscriptions'+(id?'/'+encodeURIComponent(id):''),{
          method:id?'PUT':'POST',body:JSON.stringify(data)
        });
        element.classList.remove('open');
        await load();
        status('Подписка сохранена и узлы импортированы в Outbounds');
      }catch(error){status(error.message,true);}
      finally{submit.disabled=false;}
    };
    return element;
  }
  function openForm(sub){
    const element=modal(),form=find('#outsub-form',element);
    form.reset();
    form.dataset.id=sub?.id||'';
    find('#outsub-title',element).textContent=sub?'Настройки подписки':'Добавить подписку';
    find('#outsub-submit',element).textContent=sub?'Сохранить':'Сохранить и импортировать';
    form.elements.name.value=sub?.name||'';
    form.elements.url.value=sub?.url||'';
    form.elements.intervalMinutes.value=sub?.intervalMinutes||60;
    form.elements.enabled.checked=sub?!!sub.enabled:true;
    const group=form.elements.group;
    group.replaceChildren(new Option('Только в Outbounds',''));
    for(const name of groups())group.add(new Option(name,name));
    group.value=sub?.group||'';
    element.classList.add('open');
    form.elements.name.focus();
  }
  find('#outsub-create').onclick=()=>openForm(null);
  find('#outsub-reload').onclick=load;
  window.MUIOutboundSubscriptions={load};
  window.addEventListener('mui-langchange',()=>{if(loaded)render();});
})();
