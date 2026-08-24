/* Bootstrap + hash router.
 *
 * No framework. The app is a handful of screens that each render into one
 * container, and `el()` in util.js covers the DOM building — a runtime
 * downloaded from a CDN would be the largest thing here and would have to be
 * vendored into the service worker cache anyway to keep the app offline.
 */

import * as weight from './views/weight.js';
import * as lifts from './views/lifts.js';
import * as plan from './views/plan.js';
import * as food from './views/food.js';
import * as body from './views/body.js';
import * as data from './views/data.js';
import { el, mount } from './util.js';
import { icon, clearNavAction } from './ui.js';

/* `tint` is the Health-style category colour for the screen — used on card
   headers, not on controls. The accent stays uniform across the app.

   `hidden: true` keeps a screen out of the tab bar without removing it. The
   route still resolves, so its data is untouched, the export still carries it,
   and the screen is one URL away (#/lifts, #/plan, #/body) if you want it back
   — flip the flag, or just type the hash. Deleting the view modules instead
   would have thrown away working code to hide three buttons. */
const routes = [
  { path: '#/weight', label: 'Weight', title: 'Weight',   icon: 'weight', tint: 'weight', view: weight },
  { path: '#/lifts',  label: 'Lifts',  title: 'Lifts',    icon: 'lifts',  tint: 'lifts',  view: lifts,  hidden: true },
  { path: '#/plan',   label: 'Plan',   title: 'Training', icon: 'plan',   tint: 'plan',   view: plan,   hidden: true },
  { path: '#/food',   label: 'Food',   title: 'Nutrition', icon: 'food',  tint: 'food',   view: food },
  { path: '#/body',   label: 'Body',   title: 'Body',     icon: 'body',   tint: 'body',   view: body,   hidden: true },
  { path: '#/data',   label: 'Data',   title: 'Data',     icon: 'data',   tint: 'data',   view: data },
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
  // Scopes the screen's category colour; card headers read it via var(--tint).
  view.style.setProperty('--tint', `var(--c-${route.tint})`);

  syncTabs();          // highlight the tab immediately, before any await
  // Each view installs its own; clear first so a screen with no primary
  // action doesn't inherit the previous screen's button.
  clearNavAction();

  try {
    await route.view.render(view);
  } catch (err) {
    console.error(err);
    mount(view,
      el('h1', { class: 'large-title', text: route.title }),
      el('div', { class: 'panel empty' },
        el('strong', {}, "Couldn't load this screen"),
        String(err && err.message ? err.message : err),
      ),
    );
  }

  window.scrollTo(0, 0);
  syncNav();
}

/* Health's collapsing title: the big heading lives in the content, and the
   nav bar only grows a background and its own title once you've scrolled
   past it. Threshold is the large title's own height, so the swap happens
   exactly as it leaves the screen. */
function syncNav() {
  const bar = document.querySelector('.topbar');
  const title = document.querySelector('.large-title');
  const threshold = title ? title.offsetTop + title.offsetHeight - 44 : 8;
  bar.classList.toggle('topbar--scrolled', window.scrollY > Math.max(threshold, 8));
}

window.addEventListener('scroll', syncNav, { passive: true });

function syncTabs() {
  const bar = document.getElementById('tabbar');
  const here = currentRoute().path;
  bar.hidden = false;
  mount(bar,
    routes.filter((r) => !r.hidden || r.path === here).map((r) =>
      el('a', {
        href: r.path,
        'aria-current': r.path === here ? 'page' : null,
        'aria-label': r.title,
      }, icon(r.icon), r.label),
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
    await navigator.serviceWorker.register(new URL('../sw.js', import.meta.url));
  } catch (err) {
    console.warn('Service worker registration failed:', err);
  }
}

/* iOS can evict storage for web apps that go unused. Persistent storage makes
   that less likely; the export button on the Data tab is the real backstop. */
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
