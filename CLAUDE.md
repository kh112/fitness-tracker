# Fitness & Marathon Tracker — Project Brief

Personal-use app for one person (the repo owner). No accounts, no multi-user, no sync
service. Decisions below were settled in a prior planning conversation — treat them as
given unless I say otherwise, and push back if something here turns out to be a bad idea
once you're in the code.

---

## 1. What it is

A phone-first installable web app (PWA) for tracking training toward a marathon. Four
things it must do:

1. Track bodyweight over time
2. Track body measurements over time
3. Log fitness exercises (strength work)
4. Hold a marathon training plan and let me tick runs off against it

## 2. Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Form factor | PWA, installed via Add to Home Screen | No app store, no Apple dev fee, works on iOS + Android |
| Hosting | GitHub Pages, static | Free, permanent, deploy is a `git push` |
| Build step | **None.** Plain HTML/CSS/JS | A bundler turns every deploy into a chore. Keep the repo directly servable. |
| Framework | None, or something tiny with no build (e.g. Preact via CDN) — your call, justify it | Same reason |
| Storage | IndexedDB on device | Data lives on my phone, not a server |
| Units | Metric (kg, cm, km) | |
| Week starts | Monday | |
| Training plan | I type my own plan in | Do **not** build a plan generator |

### Non-goals
- No cloud sync, no login, no backend
- No social features, sharing, or leaderboards
- No auto-generated training plans
- No wearable or Strava integration (maybe later, not now)

> **Changed 2 Aug 2026:** "No calorie/nutrition tracking" was a non-goal and is
> no longer — a Food tab was added on request. It stays within the other
> constraints: no food database, no barcode scanning, no network. You type your
> own numbers, and foods remember what you last gave them.

> **Changed 24 Aug 2026:** the Lifts, Plan and Body tabs are **hidden**, not
> removed. `routes` in `js/app.js` carries `hidden: true` on each; the views,
> the stores and the export are all untouched, and each screen is still
> reachable at its hash (`#/lifts`, `#/plan`, `#/body`) — a hidden screen even
> puts its own tab back in the bar while you are on it, so you can navigate
> away. Unhide by deleting the flag. Do not delete the view modules.

> **Changed 24 Aug 2026:** an automatic step tracker was asked about and is
> **not possible here** — see §9. Nothing was built.

## 3. Features in detail

### Weight
- Log: date + weight (kg, one decimal)
- Chart over time, with a 7-day rolling average line so daily fluctuation doesn't
  dominate the picture
- Editable and deletable entries — I will typo things
- One entry per day; logging again the same day overwrites, with a confirm
- **The two hero tiles both run since the first weigh-in** (changed 24 Aug 2026
  from rolling 7-day and 30-day windows): average change per day **in grams**
  (`-36g`, no unit suffix beyond the g), and total change in kg since that
  date. The far end of both is the 7-day average, so one dehydrated morning
  can't read as progress; the near end is the first entry itself. On a log only
  a few days old that makes the total differ from first-row-minus-last-row —
  the averaging is the point, and the hero line above the tiles shows the
  average it used.
- **No chart range picker** (removed 24 Aug 2026). The chart always draws the
  whole log; the section head names the span. The `.segmented` CSS went with
  it — nothing else used it.

### Body measurements
- Default fields: chest, waist, hips, thigh, upper arm (cm)
- The field list must be editable — let me add or hide measurements
- Logged infrequently (every week or two), so the UI should not nag about gaps
- Show each measurement's trend over time

### Exercise log
- Per entry: exercise name, then sets of (reps × weight)
- Exercise names autocomplete from what I've already logged — repeat entry must be fast,
  because I'm doing this standing in a gym between sets
- Show recent history for an exercise when I start logging it, so I can see what I lifted
  last time without navigating away
- Support bodyweight exercises (no weight value)

### Marathon training plan
- I enter a plan as weeks × days. Each planned session has: distance (km) and type
  (easy / tempo / intervals / long / rest / cross-training)
- Mark sessions done, with actual distance and optional notes — planned vs actual both
  need to survive
- Weekly summary: planned km vs actual km
- Plan is typically 16–20 weeks with a target race date; show weeks counting down to it

### Calorie intake (added after the original brief)
- Per-item entries: food name + kcal, grouped into breakfast / lunch / dinner / snacks
- Food names autocomplete from what you've logged before **and carry the calories
  you last gave them**, so a repeat item is two taps
- A single flat daily target, optional. No training-load adjustment — but energy
  needs rise a lot on long-run days, so the target UI is worded as a reference
  rather than a limit
- Day stepper for back-filling yesterday
- **The average and the chart both span the whole log, first entry to today**
  (changed 24 Aug 2026 from a rolling 14 days). The average counts only days
  that have entries — an unlogged day is a day you forgot, not a day you
  fasted, and averaging zeros in would quietly halve the number.
- **Tapping a bar opens that day.** The chart keeps a floor of 16px per day and
  scrolls sideways past that rather than shrinking bars to hairlines, and opens
  scrolled to the day you are reading. The bar hit areas are full-height columns
  and are deliberately *not* keyboard-focusable — a year of logging would be 365
  tab stops; the day stepper is the keyboard and screen-reader path.

### Caching, and why a deploy lands on the first launch

> **Changed 24 Aug 2026** after shipping three changes the phone kept not
> showing.

`sw.js` used to serve *all* assets stale-while-revalidate: cached copy now,
fresh copy quietly stashed for next time. That makes every deploy one launch
behind, and with ES modules it is worse than one behind — `index.html` comes
network-first while its imports come from cache, so a fresh module can import
a stale one and the app runs as a blend of two builds.

Now: navigations and **code** (`.js`, `.css`, `.webmanifest`) are network-first
with a short timeout and a cache fallback; icons stay stale-while-revalidate.
Offline is unaffected — with no route to the host `fetch` rejects immediately
rather than waiting out the timeout, measured at 8ms to boot from cache with
the server dead. `skipWaiting()` is now called, so a new worker takes over on
the launch that finds it rather than the one after.

The Data tab has **Reinstall the app**: clears the offline copy and re-downloads
it, without touching IndexedDB. It also prints the cache name (`tracker-v7`),
which is the closest thing to a version number a build-step-free app gets — if
the phone and the repo disagree about what shipped, that line is where to look.

### Data export
- A visible "Download my data" button producing a single JSON file of everything
- This matters more than usual: **iOS can evict storage from web apps that go unused for
  extended periods.** Make the export obvious, not buried in settings, and consider a
  gentle reminder if the user hasn't exported in a month
- Also build the matching import, so a restore from that file actually works. An export
  you can't re-import is a placebo.

## 4. Data model (starting point, change it if you have a better one)

```
weights:       { id, date, kg }
measurements:  { id, date, field, cm }
measurementFields: { id, name, active, order }
exercises:     { id, name }
workoutSets:   { id, date, exerciseId, setIndex, reps, kg? }
foods:         { id, name, key, lastKcal }
foodEntries:   { id, date, foodId, kcal, meal }
plan:          { id, name, raceDate, startDate }
plannedSessions: { id, planId, weekIndex, dayOfWeek, type, km }
completedSessions: { id, plannedSessionId?, date, km, notes? }
```

Note `completedSessions.plannedSessionId` is optional — I sometimes run something that
wasn't on the plan, and that shouldn't be unrecordable.

## 5. Design direction

> **Changed 2 Aug 2026:** the visual language references **Apple Health
> (light)** — white cards on a grey canvas, collapsing large titles, bold
> sentence-case section headers with tinted actions, inset hairline separators,
> segmented controls, iOS sheets with grabber + Cancel. Corner radii are
> deliberately about half Apple's.
>
> Theme is **light only** — the earlier dark-only choice was reversed. Accent is
> bright orange `#FF9500` everywhere, by explicit request. Note the cost, which
> is measured at the top of `css/app.css`: as *text* on white that orange is
> ~2.0–2.2:1, below the 4.5:1 AA floor. It is fine as a fill (dark ink on it
> runs 9.5:1), so the primary action is a filled orange tile rather than an
> orange glyph. Five small orange labels remain below floor; they are all
> paired with a black-text neighbour so nothing is orange-only.
>
> **Decimal input:** every decimal field is `type="text"` + `inputmode="decimal"`,
> parsed by `parseDecimal()`. Do not "fix" them back to `type="number"` — on a
> comma-decimal keyboard that makes `.value` return an empty string and the
> number silently vanishes.
>
> **Primary action** sits top-right in the nav bar, not in a floating button.

Read the frontend-design guidance and make real choices, but these constraints come from
how it actually gets used:

- **Phone-first, and I mean it.** Designed for a 390px-wide screen held in one hand,
  possibly sweaty, in a gym with bad lighting. Desktop is a courtesy, not the target.
- Large tap targets. Number entry should use appropriate `inputmode` so the numeric
  keypad appears — nothing worse than hunting for digits mid-workout.
- The most common action is "log the thing I just did." That should be reachable in one
  tap from launch, never buried behind a menu.
- High contrast, legible at a glance. Fine hairline typography will lose to gym lighting.
- Respect `prefers-reduced-motion`, keyboard focus visible.

Don't reach for the default AI look. This is a training tool with real numbers in it —
let the data and the countdown to race day be the memorable thing rather than decoration.

## 6. Build order

Ship something usable early, then extend. Suggested milestones:

1. Static shell + IndexedDB wrapper + weight logging with chart — verify it installs on
   my phone and data survives a reboot **before** building anything else
2. Manifest, service worker, icons, offline capability, deploy to GitHub Pages
3. Exercise log with autocomplete
4. Training plan
5. Measurements
6. Export/import

Step 2 sitting that early is deliberate — I want the install path proven before there's
much to lose.

## 7. Deploy, and a note on git

**My git is fuzzy.** I have a GitHub account but I don't reliably know what the commands
are doing. So:

- When you run git commands, say in one plain line what each one does and what state it
  leaves things in. Not a tutorial, just enough that I'm not blindly trusting output.
- Set up the GitHub Pages deploy once, then write me a short `DEPLOY.md` with the exact
  sequence to publish a change, so I can do it myself later without re-deriving it.
- Flag anything destructive before running it.
- Prefer a plain `main`-branch-serves-the-site setup over anything with GitHub Actions
  unless there's a real reason — fewer moving parts I don't understand.

Testing on the phone: I'd like to be able to hit the local dev server from my phone on
the same network before deploying. Set that up and tell me the URL.

## 8. Open questions

Ask me these when they become relevant rather than guessing:

- Race date and plan length (drives the countdown UI)
- Whether I want dark mode or just one well-chosen theme
- Whether measurement history needs photos attached (I lean no, but ask)

---

## 9. Step tracking — asked, and the answer is no

Assessed 24 Aug 2026. There is no way for a web app to read a step count on
either phone, so this cannot be built without abandoning the PWA decision.

- **Apple Health / HealthKit** has no web API at all. Reading steps requires a
  native app, an Apple developer account, and the App Store — the exact thing
  §2 chose against.
- **Health Connect** on Android is likewise native-only.
- **Google Fit's REST API**, which used to be the one web-reachable option, is
  shut down.
- **`DeviceMotionEvent`** (the accelerometer) is reachable from the browser, and
  counting steps from raw acceleration is a solved problem — but iOS suspends
  JavaScript the moment the screen locks or you switch apps. It would count
  steps only while the app is open, awake, and in your hand, which is not a step
  counter; it is a step counter that stops the second you put your phone away.
  Building it would produce numbers that look real and are wrong.

If step data is wanted later, the honest options are a manual daily number typed
in from the phone's own Health app, or importing Apple Health's `export.xml`.
Both are real work and neither is automatic. Ask before building either.
