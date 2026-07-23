# Deploying

The site is the repo. GitHub Pages serves the files on the `main` branch exactly
as they are — there is no build, no Actions workflow, nothing to go wrong
between pushing and the site changing.

Your site: **https://kh112.github.io/fitness-tracker/**

---

## Part 1 — one-time setup

You only ever do this once. If the site is already live, skip to Part 2.

### 1. Create an empty repo on GitHub

Go to <https://github.com/new> and set:

| Field | Value |
|---|---|
| Repository name | `fitness-tracker` |
| Visibility | Public — **required**, GitHub Pages needs Public on a free account |
| Add a README | **Leave unticked** |
| Add .gitignore | **Leave unticked** |
| Add a licence | **Leave unticked** |

Those three must stay unticked. If GitHub puts files in the repo, it and your
local copy will have unrelated histories and the first push gets rejected.

Click **Create repository**.

### 2. Point your local repo at it

```bash
git remote add origin https://github.com/YOUR-USERNAME/fitness-tracker.git
```

Records the GitHub URL under the name `origin`. Nothing is sent yet — this only
writes a line into `.git/config`.

```bash
git push -u origin main
```

Uploads your commits to GitHub and remembers the destination, so from now on a
bare `git push` knows where to go. First time, a browser window or a credential
prompt will ask you to sign in to GitHub.

### 3. Turn Pages on

On GitHub: your repo → **Settings** → **Pages** (left sidebar).

- **Source:** `Deploy from a branch`
- **Branch:** `main`, folder `/ (root)`
- **Save**

Wait a couple of minutes for the first build, then your site is at:

**https://YOUR-USERNAME.github.io/fitness-tracker/**

### 4. Install it on your phone

Open that URL on your phone — the HTTPS one, not the local dev server. Installing
as a real app needs HTTPS, which is why this step waits for the deploy.

- **iPhone (Safari):** Share button → *Add to Home Screen*. Must be Safari;
  Chrome on iOS cannot install web apps.
- **Android (Chrome):** menu → *Install app* / *Add to Home screen*.

Then turn on aeroplane mode and open it from the home screen. It should launch
normally with your data intact. If it does, the install path is proven.

---

## Part 2 — publishing a change

This is the whole routine, every time.

```bash
git add -A
```

Stages every change in the folder — new files, edits, deletions — ready to be
committed. Nothing has been recorded yet.

```bash
git commit -m "Describe what changed"
```

Records the staged changes as a permanent snapshot in your local history. Still
only on your machine.

```bash
git push
```

Sends the new commits to GitHub. Pages notices and rebuilds within about a
minute. This is the step that changes the live site.

### Checking it worked

Repo page on GitHub → the **Actions** tab, or the small status dot next to the
latest commit. Green tick means published. It is genuinely just the file upload —
if the push succeeded and the tick is green, the site has your change.

---

## Things worth knowing

**Your phone may show the old version once after a deploy.** The service worker
serves the cached copy immediately so the app opens instantly offline, and picks
up the new one in the background. Close the app fully and reopen it and you'll
have the update. This is deliberate: see the comment at the top of `sw.js`.

**A normal deploy needs no change to `sw.js`.** The `CACHE` constant in there is
not a version you have to bump each time. It only exists for deliberately
throwing away everything currently cached, which is rare.

**Nothing you do here touches your data.** Your weigh-ins live in IndexedDB on
your phone, not in the repo. Deploying cannot delete them — but browser storage
is not a backup, which is what the export button in milestone 6 is for.

**Your data never goes to GitHub.** The repo contains only the app's code.

---

## If something goes wrong

**`git push` rejected, "fetch first" or "unrelated histories"** — GitHub has a
commit you don't. Usually means the repo was created with a README. Easiest fix
is to delete the repo on GitHub and redo Part 1 with all three boxes unticked.

**404 at the Pages URL** — either the first build hasn't finished (give it five
minutes) or Settings → Pages isn't set to `main` / `/ (root)`. Note the trailing
slash matters: `/fitness-tracker/`, not `/fitness-tracker`.

**Site loads but is unstyled or blank** — a path is wrong. Every path in the app
is relative on purpose, because the site lives at `/fitness-tracker/` rather than
at a domain root. A leading `/` anywhere in a `src` or `href` will break it.

**Changes not appearing even after reopening** — on the phone, load the site in
the browser (not the installed icon) and pull down to refresh. If the browser
shows the change but the installed app doesn't, delete the home screen icon and
re-add it.

**Ask me.** Paste whatever the command printed. Nothing in Part 2 is destructive
and none of it can lose committed work.
