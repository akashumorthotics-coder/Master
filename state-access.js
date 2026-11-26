/* Shared frontend state helpers. Actual access is enforced by Apps Script. */
(() => {
  'use strict';
  const name=value=>String(value ?? '').replace(/\s+/g,' ').trim();
  const key=value=>name(value).toUpperCase();
  function parse(value){
    const invalid={all:false,states:[],keys:[],invalid:true};
    if(value==null || (typeof value==='string' && (!value.trim() || value.trim().toLowerCase()==='all')))return {all:true,states:[],keys:[],invalid:false};
    if(typeof value!=='string' && !Array.isArray(value))return invalid;
    if(typeof value==='string' && value.length>4000)return invalid;
    const parts=Array.isArray(value)?value:value.split(/[,;\r\n|+]/),seen=new Set(),states=[];
    if(!parts.length || parts.length>64)return invalid;
    for(const part of parts){
      if(typeof part!=='string')return invalid;
      const value=name(part),k=key(value);
      if(!value || value.length>80 || k==='ALL' || /[\x00-\x1F<>\[\]{}*=]/.test(value) || /[,;|+]/.test(value))return invalid;
      if(!seen.has(k)){seen.add(k);states.push(value);}
    }
    states.sort((a,b)=>key(a).localeCompare(key(b)));
    return {all:false,states,keys:states.map(key),invalid:false};
  }
  const forUser=user=>parse(user ? user.state : []);
  const allows=(user,state)=>{const scope=forUser(user);return scope.all || scope.keys.includes(key(state));};
  const fingerprint=user=>JSON.stringify(['states-v2',user?.id || '',user?.role || '',forUser(user).all?'ALL':forUser(user).keys,[...(user?.perms || [])].sort()]);
  window.UMStateAccess={name,key,parse,forUser,allows,fingerprint};
})();
