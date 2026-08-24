/* Service worker — makes the app launch offline.
 *
 * Caching strategy, and why:
 *
 *   Navigations      network first, short timeout, falling back to the cached
 *                    shell.
 *
 *   Code (js, css)   network first too, shorter timeout, falling back to cache.
 *
 *   Everything else  stale-while-revalidate — icons and the manifest, which
 *                    change about never and are the largest files here.
 *
 * Code used to be stale-while-revalidate as well, and that was a mistake worth
 * recording. Serving the cached copy and refreshing it in the background means
 * every deploy is one launch behind: you open the app, get last week's
 * JavaScript, and only see the new build the *second* time. With ES modules it
 * is worse than one-behind — index.html arrives fresh from the network while
 * its imports come from cache, so a fresh module can import a stale one and
 * the app runs as a mixture of two builds. Shipping a fix and being told it
 * isn't there is the symptom, and "just load it twice" is not a caching
 * strategy, it's an apology.
 *
 * So code is network first. The cost is a round trip at launch; the whole app
 * is about 60KB of text across a dozen files, fetched in parallel. Offline is
 * unaffected — with no route to the host, fetch rejects immediately rather
 * than waiting out the timeout, and the cached copy is served. The timeout
 * only bites on a connection that is present but crawling, which is why it is
 * short and why it falls back rather than failing.
 *
 * Bump CACHE only to deliberately throw away everything under the old name.
 * A deploy does not need it.
 */

const CACHE = 'tracker-v7';

const NAV_TIMEOUT_MS = 2500;

/* Shorter than the navigation timeout: by the time code is being fetched the
   shell is already on screen, so a stall here is a visibly hanging app. */
const CODE_TIMEOUT_MS = 1500;

/** Is this request for something that changes when I deploy? */
function isCode(url) {
  return /\.(?:js|css|webmanifest)$/.test(new URL(url).pathname);
}

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
  // Take over as soon as this worker is installed. The old note here worried
  // about "reloading the page under you while you're typing a set" — but
  // skipWaiting only changes which worker answers fetches; nothing in this app
  // listens for controllerchange, so no page reloads itself. Waiting for a
  // cold launch just meant a third launch before a deploy landed.
  self.skipWaiting();
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

/** Code: network first, cache as the safety net. */
async function handleCode(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetchWithTimeout(request, CODE_TIMEOUT_MS);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    return (await cache.match(request)) ?? Response.error();
  }
}

/** Everything else: stale-while-revalidate. */
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
    request.mode === 'navigate' ? handleNavigation(request)
      : isCode(request.url) ? handleCode(request)
      : handleAsset(request)
  );
});
