# Fitness & Marathon Tracker

A phone-first PWA for tracking bodyweight, measurements, strength work, and a
marathon training plan. Static files, no build step, no backend — your data
lives in IndexedDB on your device.

See [CLAUDE.md](CLAUDE.md) for the project brief and the decisions behind it.

## Running it locally

```bash
python serve.py
```

It prints two URLs:

- `http://localhost:8000/` — this machine
- `http://<your-lan-ip>:8000/` — **open this one on your phone**, same Wi-Fi

Pass a different port as an argument if 8000 is busy: `python serve.py 8080`.

The server exists only for development. It forces correct MIME types (Windows
can otherwise serve `.js` as `text/plain`, which breaks ES modules) and sends
no-cache headers so a refresh on your phone actually shows your latest edit.

### One thing to know about testing on your phone

Over `http://<lan-ip>` you can use the whole app and your data will save —
IndexedDB works fine on plain HTTP. But **service workers and "Add to Home
Screen" as a real installed app need HTTPS**, which the LAN dev server doesn't
provide. Offline mode and installing are therefore proven against the deployed
GitHub Pages URL, not the dev server. On `localhost` the service worker does
run, because browsers treat localhost as a secure context.

## Deploying

See [DEPLOY.md](DEPLOY.md). Short version: `git add -A`, `git commit`, `git push`.

## Layout

```
index.html              app shell
manifest.webmanifest    PWA metadata
sw.js                   service worker — offline caching
css/app.css             one dark theme
js/app.js               bootstrap + hash router
js/db.js                IndexedDB wrapper
js/util.js              dates, formatting, rolling average, DOM helper
js/chart.js             hand-rolled SVG line chart
js/views/               one module per screen (weight, lifts, plan, food, body, data)
icons/                  generated PNGs, committed
tools/make_icons.py     regenerates icons/ — only run when the mark changes
serve.py                dev server (not part of the deployed app)
```

## Status

- [x] **1** — App shell, IndexedDB, weight logging with chart
- [x] **2** — Manifest, service worker, icons, offline capability
- [x] **3** — Exercise log with autocomplete
- [x] **4** — Training plan
- [x] **5** — Measurements
- [x] **6** — Export / import

All six are in. Race day is set to **18 October 2026**; the plan derives its
week count from your start date, so a block of any length works.

## Developing against the service worker

The service worker serves cached assets first, so an edit may not show up on a
refresh. In DevTools → Application → Service Workers tick **Update on reload**,
or paste this into the console once:

```js
(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  location.reload();
})();
```
