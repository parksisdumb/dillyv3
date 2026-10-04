/* Dilly service worker.
 *
 * - Precaches only static, unauthenticated assets: the /offline page (and the /_next/static files it uses) and icons.
 * - Navigations: network first; when the network fails, the /offline page. Page HTML is never stored.
 * - /_next/static/* and /icons/*: cache first (content-hashed / immutable, never user data).
 * - Everything else (API routes, server actions, RSC payloads, Supabase) is NOT intercepted and never cached.
 * - Web Push: `push` shows the notification; `notificationclick` focuses Dilly and opens the URL in the payload.
 *
 * Bump VERSION when this file's caching rules change; old caches are deleted on activate.
 */
const VERSION = "v1";
const CACHE = `dilly-static-${VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png", "/icons/badge-72.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE.map((u) => new Request(u, { cache: "reload", credentials: "omit" })));
      // The offline page's own CSS/JS/fonts, so it renders styled with no signal. Best effort.
      try {
        const res = await cache.match(OFFLINE_URL);
        const html = res ? await res.clone().text() : "";
        const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)<>]+/g) || [])];
        await Promise.all(assets.map((a) => cache.add(new Request(a, { credentials: "omit" })).catch(() => undefined)));
      } catch (_) {
        /* the fallback still works unstyled */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("dilly-") && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase and everything cross-origin: untouched.

  if (req.mode === "navigate") {
    // Network first. The response is NOT cached: authenticated HTML must never be stored on the device.
    event.respondWith(
      fetch(req).catch(async () => {
        const offline = await caches.match(OFFLINE_URL, { ignoreSearch: true });
        return offline || new Response("No signal. Dilly needs a connection — try again when you have signal.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }),
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.type === "basic") cache.put(req, res.clone()).catch(() => undefined);
        return res;
      })(),
    );
  }
  // Anything else: default browser handling (no respondWith → no caching).
});

/** Only same-origin paths are opened from a notification. */
function safePath(raw) {
  try {
    const u = new URL(raw || "/app/today", self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search + u.hash : "/app/today";
  } catch (_) {
    return "/app/today";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Dilly";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      data: { url: safePath(data.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const exact = wins.find((w) => w.url === target);
      if (exact) return exact.focus();
      const mine = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (mine) {
        try {
          const nav = await mine.navigate(target);
          return (nav || mine).focus();
        } catch (_) {
          /* uncontrolled window: open a new one */
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
