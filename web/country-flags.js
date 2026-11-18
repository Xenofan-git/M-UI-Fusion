// ISO-3166 alpha-2 flags derived from public-domain tzdata iso3166.tab.
(() => {
  'use strict';
  const iso = [["AD","Andorra"],["AE","United Arab Emirates"],["AF","Afghanistan"],["AG","Antigua & Barbuda"],["AI","Anguilla"],["AL","Albania"],["AM","Armenia"],["AO","Angola"],["AQ","Antarctica"],["AR","Argentina"],["AS","Samoa (American)"],["AT","Austria"],["AU","Australia"],["AW","Aruba"],["AX","Åland Islands"],["AZ","Azerbaijan"],["BA","Bosnia & Herzegovina"],["BB","Barbados"],["BD","Bangladesh"],["BE","Belgium"],["BF","Burkina Faso"],["BG","Bulgaria"],["BH","Bahrain"],["BI","Burundi"],["BJ","Benin"],["BL","St Barthelemy"],["BM","Bermuda"],["BN","Brunei"],["BO","Bolivia"],["BQ","Caribbean NL"],["BR","Brazil"],["BS","Bahamas"],["BT","Bhutan"],["BV","Bouvet Island"],["BW","Botswana"],["BY","Belarus"],["BZ","Belize"],["CA","Canada"],["CC","Cocos (Keeling) Islands"],["CD","Congo (Dem. Rep.)"],["CF","Central African Rep."],["CG","Congo (Rep.)"],["CH","Switzerland"],["CI","Côte d’Ivoire"],["CK","Cook Islands"],["CL","Chile"],["CM","Cameroon"],["CN","China"],["CO","Colombia"],["CR","Costa Rica"],["CU","Cuba"],["CV","Cape Verde"],["CW","Curaçao"],["CX","Christmas Island"],["CY","Cyprus"],["CZ","Czech Republic"],["DE","Germany"],["DJ","Djibouti"],["DK","Denmark"],["DM","Dominica"],["DO","Dominican Republic"],["DZ","Algeria"],["EC","Ecuador"],["EE","Estonia"],["EG","Egypt"],["EH","Western Sahara"],["ER","Eritrea"],["ES","Spain"],["ET","Ethiopia"],["FI","Finland"],["FJ","Fiji"],["FK","Falkland Islands"],["FM","Micronesia"],["FO","Faroe Islands"],["FR","France"],["GA","Gabon"],["GB","Britain (UK)"],["GD","Grenada"],["GE","Georgia"],["GF","French Guiana"],["GG","Guernsey"],["GH","Ghana"],["GI","Gibraltar"],["GL","Greenland"],["GM","Gambia"],["GN","Guinea"],["GP","Guadeloupe"],["GQ","Equatorial Guinea"],["GR","Greece"],["GS","South Georgia & the South Sandwich Islands"],["GT","Guatemala"],["GU","Guam"],["GW","Guinea-Bissau"],["GY","Guyana"],["HK","Hong Kong"],["HM","Heard Island & McDonald Islands"],["HN","Honduras"],["HR","Croatia"],["HT","Haiti"],["HU","Hungary"],["ID","Indonesia"],["IE","Ireland"],["IL","Israel"],["IM","Isle of Man"],["IN","India"],["IO","British Indian Ocean Territory"],["IQ","Iraq"],["IR","Iran"],["IS","Iceland"],["IT","Italy"],["JE","Jersey"],["JM","Jamaica"],["JO","Jordan"],["JP","Japan"],["KE","Kenya"],["KG","Kyrgyzstan"],["KH","Cambodia"],["KI","Kiribati"],["KM","Comoros"],["KN","St Kitts & Nevis"],["KP","Korea (North)"],["KR","Korea (South)"],["KW","Kuwait"],["KY","Cayman Islands"],["KZ","Kazakhstan"],["LA","Laos"],["LB","Lebanon"],["LC","St Lucia"],["LI","Liechtenstein"],["LK","Sri Lanka"],["LR","Liberia"],["LS","Lesotho"],["LT","Lithuania"],["LU","Luxembourg"],["LV","Latvia"],["LY","Libya"],["MA","Morocco"],["MC","Monaco"],["MD","Moldova"],["ME","Montenegro"],["MF","St Martin (French)"],["MG","Madagascar"],["MH","Marshall Islands"],["MK","North Macedonia"],["ML","Mali"],["MM","Myanmar (Burma)"],["MN","Mongolia"],["MO","Macau"],["MP","Northern Mariana Islands"],["MQ","Martinique"],["MR","Mauritania"],["MS","Montserrat"],["MT","Malta"],["MU","Mauritius"],["MV","Maldives"],["MW","Malawi"],["MX","Mexico"],["MY","Malaysia"],["MZ","Mozambique"],["NA","Namibia"],["NC","New Caledonia"],["NE","Niger"],["NF","Norfolk Island"],["NG","Nigeria"],["NI","Nicaragua"],["NL","Netherlands"],["NO","Norway"],["NP","Nepal"],["NR","Nauru"],["NU","Niue"],["NZ","New Zealand"],["OM","Oman"],["PA","Panama"],["PE","Peru"],["PF","French Polynesia"],["PG","Papua New Guinea"],["PH","Philippines"],["PK","Pakistan"],["PL","Poland"],["PM","St Pierre & Miquelon"],["PN","Pitcairn"],["PR","Puerto Rico"],["PS","Palestine"],["PT","Portugal"],["PW","Palau"],["PY","Paraguay"],["QA","Qatar"],["RE","Réunion"],["RO","Romania"],["RS","Serbia"],["RU","Russia"],["RW","Rwanda"],["SA","Saudi Arabia"],["SB","Solomon Islands"],["SC","Seychelles"],["SD","Sudan"],["SE","Sweden"],["SG","Singapore"],["SH","St Helena"],["SI","Slovenia"],["SJ","Svalbard & Jan Mayen"],["SK","Slovakia"],["SL","Sierra Leone"],["SM","San Marino"],["SN","Senegal"],["SO","Somalia"],["SR","Suriname"],["SS","South Sudan"],["ST","Sao Tome & Principe"],["SV","El Salvador"],["SX","St Maarten (Dutch)"],["SY","Syria"],["SZ","Eswatini (Swaziland)"],["TC","Turks & Caicos Is"],["TD","Chad"],["TF","French S. Terr."],["TG","Togo"],["TH","Thailand"],["TJ","Tajikistan"],["TK","Tokelau"],["TL","East Timor"],["TM","Turkmenistan"],["TN","Tunisia"],["TO","Tonga"],["TR","Turkey"],["TT","Trinidad & Tobago"],["TV","Tuvalu"],["TW","Taiwan"],["TZ","Tanzania"],["UA","Ukraine"],["UG","Uganda"],["UM","US minor outlying islands"],["US","United States"],["UY","Uruguay"],["UZ","Uzbekistan"],["VA","Vatican City"],["VC","St Vincent"],["VE","Venezuela"],["VG","Virgin Islands (UK)"],["VI","Virgin Islands (US)"],["VN","Vietnam"],["VU","Vanuatu"],["WF","Wallis & Futuna"],["WS","Samoa (western)"],["YE","Yemen"],["YT","Mayotte"],["ZA","South Africa"],["ZM","Zambia"],["ZW","Zimbabwe"]];
  const aliases = {"RU":"Россия|Российская Федерация|Russian Federation|Russia|РФ","DE":"Германия|Germany|Deutschland","CH":"Швейцария|Switzerland|Schweiz|Suisse","FR":"Франция|France","US":"США|Соединенные Штаты|Соединённые Штаты|United States|USA","GB":"Великобритания|Англия|United Kingdom|Britain|UK","NL":"Нидерланды|Голландия|Netherlands|Holland","IT":"Италия|Italy","ES":"Испания|Spain","JP":"Япония|Japan","CN":"Китай|China","HK":"Гонконг|Hong Kong","SG":"Сингапур|Singapore","TR":"Турция|Turkey|Türkiye","PL":"Польша|Poland","FI":"Финляндия|Finland","SE":"Швеция|Sweden","NO":"Норвегия|Norway","DK":"Дания|Denmark","BE":"Бельгия|Belgium","AT":"Австрия|Austria","CZ":"Чехия|Czech Republic|Czechia","SK":"Словакия|Slovakia","HU":"Венгрия|Hungary","RO":"Румыния|Romania","BG":"Болгария|Bulgaria","GR":"Греция|Greece","CY":"Кипр|Cyprus","PT":"Португалия|Portugal","IE":"Ирландия|Ireland","IS":"Исландия|Iceland","EE":"Эстония|Estonia","LV":"Латвия|Latvia","LT":"Литва|Lithuania","UA":"Украина|Ukraine","BY":"Беларусь|Белоруссия|Belarus","KZ":"Казахстан|Kazakhstan","KG":"Кыргызстан|Киргизия|Kyrgyzstan","UZ":"Узбекистан|Uzbekistan","GE":"Грузия|Georgia","AM":"Армения|Armenia","AZ":"Азербайджан|Azerbaijan","IN":"Индия|India","ID":"Индонезия|Indonesia","MY":"Малайзия|Malaysia","TH":"Таиланд|Тайланд|Thailand","VN":"Вьетнам|Vietnam","TW":"Тайвань|Taiwan","KR":"Южная Корея|Корея|South Korea","KP":"Северная Корея|North Korea","AE":"ОАЭ|Эмираты|United Arab Emirates","IL":"Израиль|Israel","CA":"Канада|Canada","BR":"Бразилия|Brazil","AR":"Аргентина|Argentina","MX":"Мексика|Mexico","AU":"Австралия|Australia","NZ":"Новая Зеландия|New Zealand","ZA":"ЮАР|South Africa","EG":"Египет|Egypt","MD":"Молдова|Молдавия|Moldova","RS":"Сербия|Serbia","ME":"Черногория|Montenegro","BA":"Босния|Bosnia","MK":"Македония|North Macedonia","AL":"Албания|Albania","HR":"Хорватия|Croatia","SI":"Словения|Slovenia","LU":"Люксембург|Luxembourg","LI":"Лихтенштейн|Liechtenstein","MT":"Мальта|Malta"};
  const ru = new Intl.DisplayNames(['ru'], {type:'region'});
  const en = new Intl.DisplayNames(['en'], {type:'region'});
  const flag = code => Array.from(code.toUpperCase()).map(c=>String.fromCodePoint(127397+c.charCodeAt(0))).join('');
  const countries = iso.map(([code,english])=>({code,english,ru:ru.of(code)||english,flag:flag(code)}));
  const byCode = new Map(countries.map(c=>[c.code,c]));
  // Bitmap-independent flag assets: rendered as local SVG images so old
  // Windows/Chrome installations never fall back to country-code letters.
  // Assets are served by the same panel, including installations behind
  // a secret URL prefix or without public Internet.
  const flagAssetRoot = new URL('flags/',document.currentScript?.src||location.href);
  const createIcon = code => {
    const isoCode=String(code||'').toUpperCase();
    if(!byCode.has(isoCode))return null;
    const icon=document.createElement('img');
    icon.className='outsub-flag-svg';
    icon.alt='';
    icon.loading='lazy';
    icon.decoding='async';
    icon.width=26;
    icon.height=19;
    icon.src=new URL(isoCode.toLowerCase()+'.svg',flagAssetRoot).href;
    icon.onerror=()=>{icon.hidden=true;};
    return icon;
  };
  const fromFilterLine = line => {
    const key=String(line||'').trim().toLocaleLowerCase('ru');
    if(!key)return null;
    return countries.find(country=>
      key===country.flag.toLocaleLowerCase('ru') ||
      key===country.code.toLocaleLowerCase('ru') ||
      key===country.english.toLocaleLowerCase('ru') ||
      key===country.ru.toLocaleLowerCase('ru') ||
      (aliases[country.code]||'').split('|').some(alias=>alias.toLocaleLowerCase('ru')===key)
    )||null;
  };
  const normalize = text=>String(text||'').toLocaleLowerCase('ru').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const labels = countries.flatMap(c=>[c.english,c.ru,en.of(c.code),...(aliases[c.code]||'').split('|')].filter(Boolean).map(label=>({code:c.code,text:normalize(label)}))).filter(x=>x.text.length>=3).sort((a,b)=>b.text.length-a.text.length);
  const read = name=>{
    const str=String(name||'');
    const pair=str.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
    if(pair){const chars=Array.from(pair[0]),code=chars.map(c=>String.fromCharCode(c.codePointAt(0)-127397)).join('');if(byCode.has(code))return byCode.get(code);}
    const upper=str.match(/(?:^|[^A-Za-z])([A-Z]{2})(?=$|[^A-Za-z])/g)||[];
    for(const entry of upper){const code=entry.trim().replace(/[^A-Z]/g,'');if(byCode.has(code))return byCode.get(code);}
    const norm=' '+normalize(str)+' ';
    for(const item of labels)if(norm.includes(' '+item.text+' '))return byCode.get(item.code);
    return null;
  };
  window.MUICountryFlags={countries,byCode,read,flag,aliases,createIcon,fromFilterLine};
})();
