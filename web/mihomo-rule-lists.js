/* Human-friendly OR rules for Mihomo: one row, two vertical lists. The
   persisted format remains Mihomo's native AND/OR logical expression. */
(function(){
  'use strict';
  const types=new Set(['GEOSITE','GEOIP','DOMAIN','DOMAIN-SUFFIX','IP-CIDR','IP-CIDR6']);
  const distinct=values=>[...new Set(values)];
  const lines=value=>distinct(String(value||'').split(/[\r\n]+/).map(s=>s.trim()).filter(Boolean));
  function validateIP(value){
    const [host,mask,...rest]=value.split('/');
    if(rest.length)throw Error('Неверный адрес IP/CIDR: '+value);
    if(host.includes(':')){
      if(!/^[0-9a-f:.]+$/i.test(host)||!host.includes(':')||
        (host.match(/::/g)||[]).length>1)throw Error('Неверный IPv6: '+value);
      if(mask!==undefined&&(!/^\d+$/.test(mask)||Number(mask)>128))throw Error('Неверная маска IPv6: '+value);
      return {type:'IP-CIDR6',value:host+(mask===undefined?'/128':'/'+mask)};
    }
    if(!/^(\d{1,3}\.){3}\d{1,3}$/.test(host))throw Error('Неверный IPv4: '+value);
    if(host.split('.').some(part=>Number(part)>255))throw Error('Неверный IPv4: '+value);
    if(mask!==undefined&&(!/^\d+$/.test(mask)||Number(mask)>32))throw Error('Неверная маска IPv4: '+value);
    return {type:'IP-CIDR',value:host+(mask===undefined?'/32':'/'+mask)};
  }
  function classifyDomainOrIP(input){
    const item=String(input||'').trim();
    if(!item||/[(),\s]/.test(item))throw Error('Недопустимая строка домена/IP: '+item);
    if(item.includes(':')&&!/^(full:|domain:)/i.test(item))return validateIP(item);
    if(/^[\d.]+(?:\/\d+)?$/.test(item))return validateIP(item);
    let exact=false,domain=item;
    if(/^(full:|domain:)/i.test(domain)){exact=true;domain=domain.slice(domain.indexOf(':')+1)}
    if(domain.startsWith('*.'))domain=domain.slice(2);
    else if(domain.startsWith('.'))domain=domain.slice(1);
    if(domain.endsWith('.'))domain=domain.slice(0,-1);
    if(!/^[a-z0-9][a-z0-9_.-]{0,252}$/i.test(domain)||domain.includes('..')||
       !domain.includes('.')||domain.split('.').some(part=>!part||part.startsWith('-')||part.endsWith('-'))) {
       throw Error('Неверный домен: '+item);
    }
    return {type:exact?'DOMAIN':'DOMAIN-SUFFIX',value:domain.toLowerCase()};
  }
  function compile(geoText,domainText,catalog,noResolve=true){
    if(!catalog||!Array.isArray(catalog.geosite)||!Array.isArray(catalog.geoip))throw Error('Список категорий GeoSite/GeoIP не загружен');
    const names={geosite:new Set(catalog.geosite.map(s=>s.toLowerCase())),geoip:new Set(catalog.geoip.map(s=>s.toLowerCase()))};
    const conditions=[];
    for(const original of lines(geoText)){
      const value=original.toLowerCase();
      let type,name;
      const match=/^(geosite|geoip):(.+)$/.exec(value);
      if(match){type=match[1];name=match[2].trim()}
      else {
        name=value;
        const site=names.geosite.has(name),ip=names.geoip.has(name);
        if(site&&ip)throw Error('Категория «'+original+'» есть в GeoSite и GeoIP. Уточните geosite:'+name+' или geoip:'+name);
        if(!site&&!ip)throw Error('Категория «'+original+'» отсутствует в установленных GeoSite/GeoIP');
        type=site?'geosite':'geoip';
      }
      if(!names[type].has(name))throw Error('Нет категории '+type+':'+name+' в установленном файле');
      conditions.push({type:type.toUpperCase(),value:name+(type==='geoip'&&noResolve?',no-resolve':'')});
    }
    for(const line of lines(domainText)){
      const item=classifyDomainOrIP(line);
      conditions.push({type:item.type,value:item.value+(item.type.startsWith('IP-')&&noResolve?',no-resolve':'')});
    }
    const unique=distinct(conditions.map(x=>x.type+','+x.value));
    if(!unique.length)throw Error('Добавьте категорию GeoSite/GeoIP, домен или IP');
    if(unique.length>200)throw Error('Допустимо до 200 условий в одном правиле');
    const payload='((OR,('+unique.map(value=>'('+value+')').join(',')+')))';
    if(payload.length>12000)throw Error('Слишком длинный список условий');
    return {type:'AND',payload,noResolve:false};
  }
  function decode(rule){
    if(!rule||rule.type!=='AND'||rule.noResolve)return null;
    const payload=String(rule.payload||'');
    const matches=[...payload.matchAll(/\((GEOSITE|GEOIP|DOMAIN|DOMAIN-SUFFIX|IP-CIDR|IP-CIDR6),([^()]*)\)/g)];
    if(!matches.length)return null;
    const encoded='((OR,('+matches.map(m=>'('+m[1]+','+m[2]+')').join(',')+')))';
    if(payload!==encoded)return null;
    const geos=[],addresses=[];
    let sawNoResolve=false,sawIPWithout=false;
    for(const [,type,raw] of matches){
      const flag=raw.endsWith(',no-resolve');
      const value=flag?raw.slice(0,-11):raw;
      if(!value)return null;
      if(type==='GEOSITE'||type==='GEOIP'){
        geos.push(type.toLowerCase()+':'+value);
      } else if(type==='DOMAIN'){
        addresses.push('full:'+value);
      } else if(type==='DOMAIN-SUFFIX'){
        addresses.push(value);
      } else {
        addresses.push(value);
      }
      if(type==='GEOIP'||type.startsWith('IP-')){
        if(flag)sawNoResolve=true;else sawIPWithout=true;
      }else if(flag)return null;
    }
    if(sawNoResolve&&sawIPWithout)return null;
    return {geos:geos.join('\n'),domains:addresses.join('\n'),noResolve:sawNoResolve||!sawIPWithout,count:matches.length};
  }
  function displayCategoryName(full,catalog){
    const m=/^(geosite|geoip):(.+)$/.exec(full);
    if(!m||!catalog)return full;
    const other=m[1]==='geosite'?'geoip':'geosite';
    return catalog[other]?.some(name=>name.toLowerCase()===m[2].toLowerCase())?full:m[2];
  }
  window.MUIRuleLists={lines,compile,decode,displayCategoryName,classifyDomainOrIP};
})();
