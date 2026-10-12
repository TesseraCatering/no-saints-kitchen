/* No Saints Kitchen Checks: offline support. App files are cached; database calls always go to the network. */
var VERSION="ns-v1";
var SHELL=["./","index.html","store.js","config.js","manifest.webmanifest","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png"];
var CDN=["https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"];
self.addEventListener("install",function(e){e.waitUntil(caches.open(VERSION).then(function(c){return c.addAll(SHELL).then(function(){return Promise.all(CDN.map(function(u){return fetch(u,{mode:"cors"}).then(function(r){if(r.ok)return c.put(u,r)}).catch(function(){})}))})}).then(function(){return self.skipWaiting()}))});
self.addEventListener("activate",function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!==VERSION}).map(function(k){return caches.delete(k)}))}).then(function(){return self.clients.claim()}))});
self.addEventListener("fetch",function(e){var req=e.request,u=new URL(req.url);
  if(req.method!=="GET")return;
  if(/supabase\.co$/.test(u.hostname))return; /* never cache records or sign-in */
  if(req.mode==="navigate"){e.respondWith(fetch(req).then(function(r){var cp=r.clone();caches.open(VERSION).then(function(c){c.put("index.html",cp)});return r}).catch(function(){return caches.match("index.html")}));return}
  var thirdParty=/cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(u.hostname);
  if(u.origin===location.origin||thirdParty){
    e.respondWith(caches.match(req).then(function(hit){var net=fetch(req).then(function(r){if(r&&(r.ok||r.type==="opaque")){var cp=r.clone();caches.open(VERSION).then(function(c){c.put(req,cp)})}return r}).catch(function(){return hit});return hit||net}));
  }
});
