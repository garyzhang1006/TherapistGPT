// Keeps a copy of this release on the device so the page opens with no signal. It stores files
// this site already serves and never sends or saves anything the person types.
//
// On every release, set VERSION to the new ?v= number from index.html and the imports. That is the
// only change needed here: the cache name and the precache URLs below follow it, and
// tests/pwa.test.js fails until the numbers match.
const VERSION = "7";
const CACHE = `therapistgpt-v${VERSION}`;

// Why this can never pair a new module with an old one: a page only asks for the ?v= URLs that its
// own index.html and imports name, and one ?v= URL always has the same contents. This cache holds
// exactly one release, the index.html of that release included, so a cached page finds every
// module of its own release here and nothing from another. A newer release asks for ?v= URLs this
// cache has never held, so those go to the network until its own worker has stored them.
//
// URLs are written exactly as index.html and the imports request them, relative to this file.
const PRECACHE = [
  `css/styles.css?v=${VERSION}`,
  `js/app.js?v=${VERSION}`,
  `js/engine.js?v=${VERSION}`,
  `js/organizer.js?v=${VERSION}`,
  `js/render.js?v=${VERSION}`,
  `js/safety.js?v=${VERSION}`,
  "fonts/atkinson-hyperlegible-next-latin.woff2",
  "fonts/atkinson-hyperlegible-next-latin-ext.woff2",
  "fonts/fraunces-latin.woff2",
  "fonts/fraunces-latin-ext.woff2",
  "fonts/fraunces-italic-latin.woff2",
  "fonts/fraunces-italic-latin-ext.woff2",
  "assets/moon.svg",
  "assets/icon.svg",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/apple-touch-icon.png",
  "manifest.json",
  "index.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // "reload" skips the HTTP cache, where GitHub Pages lets files sit for ten minutes. A stale
      // index.html from the previous release would point at modules this cache does not hold.
      const index = await fetch("index.html", { cache: "reload" });
      if (!index.ok || !(await index.clone().text()).includes(`?v=${VERSION}"`)) {
        throw new Error(`index.html is not release ${VERSION} yet; the browser retries on a later visit`);
      }
      const cache = await caches.open(CACHE);
      const rest = PRECACHE.filter((url) => url !== "index.html");
      await cache.addAll(rest.map((url) => new Request(url, { cache: "reload" })));
      await cache.put("index.html", index);
      // Safe to take over at once: an open page of the old release already has all its modules,
      // and anything it still asks for (a font subset) has the same unversioned URL here.
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Only this app's own caches: every project on garyzhang1006.github.io shares one origin,
      // and with it one cache storage.
      for (const name of await caches.keys()) {
        if (name.startsWith("therapistgpt-") && name !== CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // The optional model POST in engine.js and anything on another origin are left alone: no
  // respondWith, so the browser handles them exactly as if this worker did not exist.
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Network first, so a new release shows up as soon as there is signal. Fresh pages are not
    // stored: this cache's index.html must stay the one that matches its modules.
    event.respondWith(fetch(request).catch(() => caches.open(CACHE).then((cache) => cache.match("index.html"))));
    return;
  }

  // Everything precached belongs to this one release, so cache first. Misses go to the network
  // and are not stored, which keeps the cache an exact copy of one release.
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(request))
      .then((hit) => hit || fetch(request))
  );
});
