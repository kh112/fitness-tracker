/* Bootstrap + hash router.
 *
 * No framework. The app is a handful of screens that each render into one
 * container, and `el()` in util.js covers the DOM building — a runtime
 * downloaded from a CDN would be the largest thing here and would have to be
 * vendored into the service worker cache anyway to keep the app offline.
 */

import * as weight from './views/weight.js';
import { el } from './util.js';

const routes = [
  { path: '#/weight', label: 'Weight', title: 'Weight', view: weight },
];

const DEFAULT_ROUTE = routes[0].path;

function currentRoute() {
  return routes.find((r) => r.path === location.hash) ?? routes[0];
}

async function renderRoute() {
  const route = currentRoute();
  const view = document.getElementById('view');

  document.querySelector('.topbar__title').textContent = route.title;
  document.title = `${route.title} · Training`;

  try {
    await route.view.render(view);
  } catch (err) {
    console.error(err);
    view.replaceChildren(
      el('div', { class: 'panel empty' },
        el('strong', {}, "Couldn't load your data"),
        String(err && err.message ? err.message : err),
      ),
    );
  }

  syncTabs();
}

/* The tab bar only exists once there's more than one place to go — a
   single-item tab bar is furniture pretending to be navigation. */
function syncTabs() {
  const bar = document.getElementById('tabbar');
  if (routes.length < 2) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.replaceChildren(
    routes.map((r) =>
      el('a', {
        href: r.path,
        'aria-current': r.path === currentRoute().path ? 'page' : null,
      }, r.label),
    ),
  );
}

/* Register the service worker that makes the app launch offline.
 *
 * Silently absent over plain http://<lan-ip> during development — service
 * workers require a secure context, and localhost and the deployed HTTPS site
 * are the two places it runs. Nothing else depends on it, so the app is fully
 * usable either way. */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    // Resolved against this module's URL so it points at the repo root
    // regardless of the subpath the site is served from.
    await navigator.serviceWorker.register(new URL('../sw.js', import.meta.url));
  } catch (err) {
    console.warn('Service worker registration failed:', err);
  }
}

/* iOS can evict storage for web apps that go unused. Persistent storage makes
   that less likely; the export button (later milestone) is the real backstop. */
async function requestPersistence() {
  if (!navigator.storage?.persist) return;
  try {
    if (await navigator.storage.persisted()) return;
    await navigator.storage.persist();
  } catch {
    /* Not supported here, or the browser said no. Nothing to do about it. */
  }
}

window.addEventListener('hashchange', renderRoute);

// Normalise an unknown or missing hash without firing a navigation event, so
// there's exactly one render on startup.
if (!routes.some((r) => r.path === location.hash)) {
  history.replaceState(null, '', `${location.pathname}${DEFAULT_ROUTE}`);
}

renderRoute();
registerServiceWorker();
requestPersistence();
