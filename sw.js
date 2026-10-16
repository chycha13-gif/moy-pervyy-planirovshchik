"use strict";
// Change this version with every release that changes a cached file.
const VERSION = "2026-10-16-pwa-4";
const CACHE_PREFIX = "personal-expense-planner-shell-" + encodeURIComponent(new URL(self.registration.scope).pathname) + "-";
const CACHE_NAME = CACHE_PREFIX + VERSION;
const ASSETS = [
  "./index.html", "./style.css", "./script.js", "./pwa.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png"
];
const assetURLs = ASSETS.map(path => new URL(path, self.registration.scope).href);
const indexURL = new URL("./index.html", self.registration.scope).href;

function validResponse(url, response) {
  if (!response || !response.ok || response.redirected || response.type !== "basic") return false;
  const type = response.headers.get("content-type") || "";
  return url.endsWith(".js") ? /(?:javascript|ecmascript)/i.test(type) :
    url.endsWith(".css") ? /text\/css/i.test(type) :
    url.endsWith(".png") ? /image\/png/i.test(type) :
    url.endsWith(".html") ? /text\/html/i.test(type) : /(?:json|manifest)/i.test(type);
}
async function completeCache() {
  const cache = await caches.open(CACHE_NAME);
  return (await Promise.all(assetURLs.map(async url => validResponse(url, await cache.match(url))))).every(Boolean);
}
async function downloadRelease() {
  // Fetch everything before writing. Canonical directory URLs avoid index redirects.
  return Promise.all(assetURLs.map(async url => {
    const sourceURL = url === indexURL ? self.registration.scope : url;
    const response = await fetch(new Request(sourceURL, { cache: "reload", credentials: "same-origin" }));
    if (!validResponse(url, response)) throw new Error("Offline files unavailable");
    return [url, response];
  }));
}
async function samePublishedRelease() {
  const url = new URL("./sw.js", self.registration.scope).href;
  const response = await fetch(new Request(url, { cache: "no-store", credentials: "same-origin" }));
  return validResponse(url, response) && (await response.text()).includes('const VERSION = "' + VERSION + '";');
}
let repairing = null;
async function repairCache() {
  if (!repairing) repairing = (async () => {
    if (await completeCache()) return { complete: true, version: VERSION };
    // An old worker must never combine its cached files with a newer release.
    if (!await samePublishedRelease()) return { complete: false, reason: "new-release", version: VERSION };
    const entries = await downloadRelease();
    if (!await samePublishedRelease()) return { complete: false, reason: "new-release", version: VERSION };
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(entries.map(([url, response]) => cache.put(url, response)));
    return { complete: await completeCache(), version: VERSION };
  })().finally(() => { repairing = null; });
  return repairing;
}
self.addEventListener("message", event => {
  const type = event.data && event.data.type, port = event.ports && event.ports[0];
  if (!port || !["planner-offline-check", "planner-offline-repair"].includes(type)) return;
  if (!event.source || new URL(event.source.url).origin !== new URL(self.registration.scope).origin) return;
  event.waitUntil((async () => {
    try { port.postMessage(type === "planner-offline-repair" ? await repairCache() : { complete: await completeCache(), version: VERSION }); }
    catch (_) { port.postMessage({ complete: false, reason: "unavailable", version: VERSION }); }
  })());
});
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const entries = await downloadRelease(), cache = await caches.open(CACHE_NAME);
    try { await Promise.all(entries.map(([url, response]) => cache.put(url, response))); }
    catch (error) { await caches.delete(CACHE_NAME); throw error; }
    // No skipWaiting: wait until all previous app windows are closed.
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url), scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  url.search = ""; url.hash = "";
  const navigation = request.mode === "navigate" && (url.href === scope.href || url.href === indexURL);
  const key = navigation ? indexURL : url.href;
  if (!navigation && !assetURLs.includes(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME), cached = await cache.match(key);
    return cached || fetch(request);
  })());
});
