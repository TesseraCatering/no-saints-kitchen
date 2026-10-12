/* No Saints Kitchen Checks: storage layer
   Records live in Supabase (table kitchen_checks, append-only, one row per check).
   Saves go to a local outbox first, so the app works with no signal and syncs when it can.
   Exposes a small doc/collection API that matches what the app already uses. */
(function(){
"use strict";
var CFG=window.NS_CONFIG||{},URL_=(CFG.url||"").replace(/\/$/,""),KEY=CFG.key||"";
var LS={get:function(k){try{return localStorage.getItem(k)}catch(e){return null}},set:function(k,v){try{localStorage.setItem(k,v);return true}catch(e){return false}},del:function(k){try{localStorage.removeItem(k)}catch(e){}}};
function jget(k,d){try{var v=LS.get(k);return v?JSON.parse(v):d}catch(e){return d}}
function jset(k,v){return LS.set(k,JSON.stringify(v))}

/* ---------- auth (Supabase GoTrue over fetch) ---------- */
var session=jget("ns_session",null),authCbs=[];
function emitAuth(){authCbs.forEach(function(f){try{f(session)}catch(e){}})}
function setSession(s){session=s;if(s)jset("ns_session",s);else LS.del("ns_session");emitAuth()}
function authFetch(path,body){
  return fetch(URL_+"/auth/v1/"+path,{method:"POST",headers:{"apikey":KEY,"Content-Type":"application/json"},body:JSON.stringify(body)})
    .then(function(r){return r.json().then(function(j){if(!r.ok){var e=new Error(j.error_description||j.msg||j.message||"Sign-in failed");e.status=r.status;throw e}return j})})}
function fromToken(j){return {access_token:j.access_token,refresh_token:j.refresh_token,expires_at:Date.now()+(j.expires_in||3600)*1000,email:j.user&&j.user.email}}
var refreshing=null;
function token(){
  if(!session)return Promise.reject(new Error("signed_out"));
  if(Date.now()<session.expires_at-60000)return Promise.resolve(session.access_token);
  if(!navigator.onLine)return Promise.resolve(session.access_token);
  if(!refreshing)refreshing=authFetch("token?grant_type=refresh_token",{refresh_token:session.refresh_token})
    .then(function(j){var s=fromToken(j);s.email=s.email||session.email;setSession(s);return s.access_token})
    .catch(function(e){if(e.status===400||e.status===401)setSession(null);throw e})
    .then(function(t){refreshing=null;return t},function(e){refreshing=null;throw e});
  return refreshing}
var auth={
  configured:!!(URL_&&KEY),
  user:function(){return session&&{email:session.email}},
  onChange:function(f){authCbs.push(f)},
  signIn:function(email,pw){return authFetch("token?grant_type=password",{email:email,password:pw}).then(function(j){setSession(fromToken(j));flush();return session})},
  signUp:function(email,pw){return authFetch("signup",{email:email,password:pw}).then(function(j){if(j.access_token){setSession(fromToken(j));return "in"}return "confirm"})},
  reset:function(email){return authFetch("recover",{email:email})},
  signOut:function(){var t=session&&session.access_token;setSession(null);if(t)fetch(URL_+"/auth/v1/logout",{method:"POST",headers:{apikey:KEY,Authorization:"Bearer "+t}}).catch(function(){})}
};

/* ---------- REST ---------- */
function rest(method,path,body,extra){
  return token().then(function(t){var h={"apikey":KEY,"Authorization":"Bearer "+t,"Content-Type":"application/json"};if(extra)for(var k in extra)h[k]=extra[k];
    return fetch(URL_+"/rest/v1/"+path,{method:method,headers:h,body:body?JSON.stringify(body):undefined})})
  .then(function(r){if(r.status===401||r.status===403){var e=new Error("not_allowed");e.code="not_allowed";throw e}
    if(!r.ok)return r.text().then(function(t){var e=new Error(t||("HTTP "+r.status));e.code="server";throw e});
    return r.text().then(function(t){return t?JSON.parse(t):null})})}

/* ---------- local cache + outbox ---------- */
var CACHE_DAYS=62;
var cache=jget("ns_cache",{}); /* id -> {id,day,entry} */
var outbox=jget("ns_outbox",[]); /* rows not yet on the server */
function trimCache(){var cut=new Date(Date.now()-CACHE_DAYS*864e5).toISOString().slice(0,10);Object.keys(cache).forEach(function(k){if(cache[k].day<cut&&!outbox.some(function(o){return o.id===k}))delete cache[k]})}
function persist(){trimCache();if(!jset("ns_cache",cache)){cache={};outbox.forEach(function(o){cache[o.id]=o});jset("ns_cache",cache)}jset("ns_outbox",outbox)}
function remember(rows){rows.forEach(function(r){cache[r.id]={id:r.id,day:r.day,entry:r.entry}});persist()}
function daysFrom(rows){var by={};rows.forEach(function(r){var d=by[r.day]||(by[r.day]={date:r.day,entries:{}});d.entries[r.id]=r.entry});return by}
function cachedDays(){var rows=Object.keys(cache).map(function(k){return cache[k]});return daysFrom(rows)}

var syncCbs=[],syncState={pending:outbox.length,error:null,last:jget("ns_lastsync",null)};
function emitSync(){syncState.pending=outbox.length;syncCbs.forEach(function(f){try{f(syncState)}catch(e){}})}
var flushing=null;
function flush(){
  if(flushing)return flushing;if(!outbox.length||!session||!navigator.onLine){emitSync();return Promise.resolve()}
  var batch=outbox.slice(0,200);
  flushing=rest("POST","kitchen_checks?on_conflict=id",batch.map(function(o){return {id:o.id,day:o.day,recorded_at:o.entry.at,entry:o.entry}}),{"Prefer":"resolution=ignore-duplicates,return=minimal"})
    .then(function(){var ids={};batch.forEach(function(b){ids[b.id]=1});outbox=outbox.filter(function(o){return !ids[o.id]});syncState.error=null;syncState.last=new Date().toISOString();jset("ns_lastsync",syncState.last);persist();flushing=null;emitSync();if(outbox.length)return flush()})
    .catch(function(e){flushing=null;syncState.error=e.code==="not_allowed"?"not_allowed":"offline";emitSync()});
  return flushing}
window.addEventListener("online",function(){flush();refreshAll()});
document.addEventListener("visibilitychange",function(){if(!document.hidden){flush();refreshAll()}});
setInterval(function(){flush()},30000);

/* ---------- server reads ---------- */
function fetchRange(from,to,order,limitDays){
  var q="kitchen_checks?select=id,day,entry,created_at&order=day."+(order||"asc")+",recorded_at.asc";
  if(from)q+="&day=gte."+from;if(to)q+="&day=lte."+to;
  q+="&limit=20000";
  return rest("GET",q).then(function(rows){rows.forEach(function(r){if(r.created_at){r.entry=Object.assign({},r.entry,{_saved:r.created_at})}delete r.created_at});remember(rows.filter(function(r){return r.day>=new Date(Date.now()-CACHE_DAYS*864e5).toISOString().slice(0,10)}));
    outbox.forEach(function(o){if((!from||o.day>=from)&&(!to||o.day<=to))rows.push(o)});
    return daysFrom(rows)})}

/* ---------- doc / collection API used by the app ---------- */
var docListeners={}; /* day -> [cb] */
function snap(day,d){return {exists:!!d,data:function(){return d}}}
function emitDay(day){var d=cachedDays()[day];(docListeners[day]||[]).forEach(function(l){try{l.cb(snap(day,d))}catch(e){}})}
function refreshDay(day){return fetchRange(day,day).then(function(by){
  /* keep cache exact for that day */
  Object.keys(cache).forEach(function(k){if(cache[k].day===day&&!outbox.some(function(o){return o.id===k}))delete cache[k]});
  var d=by[day];if(d)Object.keys(d.entries).forEach(function(id){cache[id]={id:id,day:day,entry:d.entries[id]}});persist();emitDay(day)}).catch(function(){})}
function refreshAll(){Object.keys(docListeners).forEach(function(d){if(docListeners[d].length)refreshDay(d)})}
setInterval(function(){if(!document.hidden)refreshAll()},60000);

function addEntries(day,entries){
  Object.keys(entries).forEach(function(id){var row={id:id,day:day,entry:entries[id]};outbox.push(row);cache[id]=row});
  persist();emitDay(day);emitSync();flush();return Promise.resolve()}
function doc(path){var day=path.split("/")[1];
  return {
    get:function(){return Promise.resolve(snap(day,cachedDays()[day]))},
    set:function(obj){return addEntries(day,obj.entries||{})},
    update:function(patch){return addEntries(day,patch.entries||{})},
    onSnapshot:function(cb){var l={cb:cb};(docListeners[day]=docListeners[day]||[]).push(l);emitDay(day);refreshDay(day);
      return function(){docListeners[day]=(docListeners[day]||[]).filter(function(x){return x!==l})}}
  }}
function collection(){
  var w={},ord="asc",lim=null;
  var q={
    where:function(f,op,v){if(op===">=")w.from=v;else if(op==="<=")w.to=v;return q},
    orderBy:function(f,dir){ord=dir||"asc";return q},
    limit:function(n){lim=n;return q},
    get:function(){
      /* "latest N days" is used for the recent-days window: ask for a date range instead */
      var from=w.from,to=w.to;if(!from&&lim&&ord==="desc")from=new Date(Date.now()-lim*864e5).toISOString().slice(0,10);
      function out(by){var days=Object.keys(by).sort();if(ord==="desc")days.reverse();if(lim)days=days.slice(0,lim);return {docs:days.map(function(k){return {data:function(){return by[k]}}})}}
      return fetchRange(from,to,ord).then(out).catch(function(e){
        /* offline: answer from the phone's copy (last ~2 months plus anything unsynced) */
        var all=cachedDays(),by={};Object.keys(all).forEach(function(k){if((!from||k>=from)&&(!to||k<=to))by[k]=all[k]});
        var r=out(by);r.offline=true;if(!r.docs.length&&e.code!=="not_allowed"&&!navigator.onLine){}return r})}
  };return q}

window.NSStore={
  auth:auth,
  db:{doc:doc,collection:collection},
  sync:{state:function(){return syncState},onChange:function(f){syncCbs.push(f);f(syncState)},flush:flush},
  ping:function(){return rest("GET","kitchen_checks?select=id&limit=1")}
};
})();
