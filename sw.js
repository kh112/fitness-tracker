/* Service worker — makes the app launch offline.
 *
 * Caching strategy, and why:
 *
 *   Navigations      network first, with a short timeout, falling back to the
 *                    cached shell. So a deploy is picked up as soon as you open
 *                    the app on a working connection, but a bad gym signal
 *                    never leaves you staring at a spinner.
 *
 *   Everything else  stale-while-revalidate. The cached copy is served straight
 *                    away and a fresh one is fetched in the background for next
 *                    time.
 *
 * The deliberate consequence: a normal deploy needs NO change to this file.
 * Requiring a version bump on every push is a footgun — the one time you forget,
 * the app silently serves last week's code and looks broken. CACHE below is only
 * bumped to deliberately throw away everything cached under the old name.
 *
 * The tradeoff: for one launch after a deploy you can be running a fresh
 * index.html against a not-yet-updated script. Nothing here talks to an API, so
 * the worst case is a stale screen that fixes itself on the next launch.
 */

const CACHE = 'tracker-v3';

const NAV_TIMEOUT_MS = 2500;

/* Relative paths throughout: this is served from a project subpath on GitHub
   Pages (/fitness-tracker/), not from a domain root. */
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/ui.js',
  './js/util.js',
  './js/chart.js',
  './js/backup.js',
  './js/views/weight.js',
  './js/views/lifts.js',
  './js/views/plan.js',
  './js/views/food.js',
  './js/views/body.js',
  './js/views/data.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Individually, so one 404 during development can't fail the whole install.
      Promise.all(PRECACHE.map((url) =>
        cache.add(new Request(url, { cache: 'reload' }))
          .catch((err) => console.warn('[sw] precache miss', url, err))
      ))
    )
  );
  // No skipWaiting: a new worker takes over on the next cold launch rather than
  // reloading the page under you while you're typing a set.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

/** Network, but give up after `ms` and let the caller fall back to cache. */
function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      (response) => { clearTimeout(timer); resolve(response); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

async function handleNavigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetchWithTimeout(request, NAV_TIMEOUT_MS);
    if (fresh && fresh.ok) cache.put('./index.html', fresh.clone());
    return fresh;
  } catch {
    return (await cache.match('./index.html'))
        ?? (await cache.match('./'))
        ?? Response.error();
  }
}

async function handleAsset(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  // Cached copy wins the race when there is one; otherwise wait for the network.
  return cached ?? (await network) ?? Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  // Leave anything cross-origin alone — there isn't any, and silently caching
  // third-party responses is how a cache turns into a mystery.
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    request.mode === 'navigate' ? handleNavigation(request) : handleAsset(request)
  );
});
