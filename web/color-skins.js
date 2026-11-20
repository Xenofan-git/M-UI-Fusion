/* User-selectable color skins. Independent of the server-side UI layout theme. */
(function(){
  'use strict';
  const KEY='mui-color-skin';
  const DARK=['graphite','emerald','aurora'];
  const ALL=['graphite','ivory','emerald','aurora'];
  const valid=value=>ALL.includes(value)?value:'';
  const safeGet=()=>{try{return valid(localStorage.getItem(KEY));}catch(_){return '';}};
  const set=value=>{
    const skin=valid(value);
    if(skin)document.documentElement.setAttribute('data-color-skin',skin);
    else document.documentElement.removeAttribute('data-color-skin');
    try{if(skin)localStorage.setItem(KEY,skin);else localStorage.removeItem(KEY);}catch(_){}
    return skin;
  };
  const current=()=>valid(document.documentElement.getAttribute('data-color-skin'));
  const initial=safeGet();
  if(initial)document.documentElement.setAttribute('data-color-skin',initial);
  else {
    // Midnight is discontinued: preserve a readable dark-mode default.
    try{
      if(localStorage.getItem(KEY)==='midnight'){
        localStorage.removeItem(KEY);
        localStorage.setItem('mui-theme','dark');
      }
    }catch(_){}
    document.documentElement.removeAttribute('data-color-skin');
  }
  window.MUIColorSkins=Object.freeze({
    all:Object.freeze(ALL),
    current,
    select:set,
    isDark:skin=>DARK.includes(skin),
    isValid:skin=>ALL.includes(skin)
  });
})();
