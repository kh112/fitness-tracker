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
provide. So the install path gets proven against the deployed GitHub Pages URL
(which is HTTPS), not against the dev server. That's milestone 2.

## Layout

```
index.html        app shell
css/app.css       one dark theme
js/app.js         bootstrap + hash router
js/db.js          IndexedDB wrapper
js/util.js        dates, formatting, rolling average, DOM helper
js/chart.js       hand-rolled SVG line chart
js/views/         one module per screen
serve.py          dev server (not deployed)
```

## Status

- [x] **1** — App shell, IndexedDB, weight logging with chart
- [ ] **2** — Manifest, service worker, icons, offline, GitHub Pages deploy
- [ ] **3** — Exercise log with autocomplete
- [ ] **4** — Training plan
- [ ] **5** — Measurements
- [ ] **6** — Export / import
