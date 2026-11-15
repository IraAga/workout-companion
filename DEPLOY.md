# Deploy & install

The app is a single HTML file plus a manifest, a service worker and three icons.
Everything in `docs/` is exactly what gets published — nothing else in this
folder is served.

```
docs/
  index.html              the app (canonical copy from now on)
  manifest.webmanifest    name, icon, standalone display
  sw.js                   offline cache
  icons/                  192, 512, 512 maskable
```

## 1. Publish it once (GitHub Pages)

Requires a free GitHub account. The site ends up at
`https://<your-username>.github.io/workout-companion/`.

**This URL is permanent — don't change it later.** Your workout log is stored per
origin (`scheme://host`). A new URL means an empty log.

Pick one route:

### With the `gh` CLI

```bash
cd /Users/iagathis/workout-companion
gh repo create workout-companion --public --source=. --remote=origin --push

# turn on Pages, serving the /docs folder of main
gh api -X POST repos/{owner}/workout-companion/pages \
  -f 'source[branch]=main' -f 'source[path]=/docs'
```

If the repo already exists, skip `gh repo create` and just `git push -u origin main`.

### Without the CLI

1. Create an empty **public** repo named `workout-companion` on github.com.
2. `git remote add origin https://github.com/<you>/workout-companion.git`
3. `git branch -M main && git push -u origin main`
4. Repo → **Settings → Pages** → Source: *Deploy from a branch* →
   Branch `main`, folder **`/docs`** → Save.
5. Wait ~1 minute, then open `https://<you>.github.io/workout-companion/`.

Only `docs/` is published. `transfer/` (nutrition notes, grocery prices) and the
`.diff` files are git-ignored, so they never reach the public repo.

## 2. Install on the Android phone

1. Open the URL in **Chrome** (not Firefox — it doesn't support install).
2. Wait for the page to fully load once, so the service worker can cache it.
3. Tap the **⋮** menu → **Add to Home screen** → **Install**.
   (Chrome may also offer an *Install app* chip in the address bar or a banner.)
4. Open it from the app drawer or home screen. It runs fullscreen, no address bar.

To confirm it's real: the icon is the green barbell, the app appears in
**Settings → Apps** as *Off-Season*, and airplane mode still opens it.

Chrome shares storage with the installed app for the same origin, so anything
you logged in a tab before installing is already there. Log in the installed app
from now on.

## 3. Backups (do this once now, then monthly)

**Workout log → History → Backup & restore → Download backup**

Writes `workout-log-YYYY-MM-DD.json` to your Downloads folder. Keep it in Google
Drive / email it to yourself / drop it in a synced folder — anywhere off the phone.

Restore on a new phone: install the app, then **History → Backup & restore →
Restore from file** and pick the JSON. It replaces whatever is on the device, and
asks for confirmation first (with session counts) before doing so.

What's inside: `ol-sessions` (your logged workouts), `ol-plan` (exercise
customisations), `ol-prefs` (selected program) and `ol-drafts` (unsaved form
state). Plain JSON, readable and portable.

## 4. Updating the app

```bash
# edit docs/index.html
# bump VERSION in docs/sw.js (e.g. 'v1' -> 'v2') so the old cache is dropped
git add -A && git commit -m "..." && git push
```

GitHub Pages redeploys in under a minute. Open the app once, close it, open it
again — the update lands on relaunch, and your data is untouched.

## 5. Optional: sync the log to a private GitHub repo

The app works offline-first: localStorage is authoritative on the device, and the
repo copy is reconciled whenever there's a connection. Nothing waits on the network.

**One-time setup**

1. Create a **private** repo named `workout-companion-data` (empty, no README).
2. GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token:
   - Resource owner: your account
   - Repository access: **Only select repositories** → `workout-companion-data`
   - Permissions → Repository permissions → **Contents: Read and write**
   - Expiration: 1 year
3. In the app: **Workout log → History → Sync** → paste the token → **Connect**.

**How it behaves**

- `log.json` is written at the repo root; **every sync is a commit**, so the whole
  history of your log is recoverable from GitHub.
- Merging is by session id on a `rev` field (bumped on every save and edit), plus
  tombstones so a deleted session can't come back from another device. Two devices
  can be offline for weeks and converge without losing a workout.
- Sync runs on app launch, when the connection returns, ~2.5s after each save, and
  via **Sync now**.
- The token lives in `localStorage` on the device. Use a separate token per device so
  either can be revoked independently.
- Disconnecting leaves the log on the device and in GitHub; reconnecting merges again.

If sync shows *"token rejected"*, the token is missing **Contents** permission or
was created for a different repo. *"repo not found"* means the name is wrong or the
token can't see it.

## Known limits

- **iPhone:** needs a couple of extra Apple meta tags and a 180px icon. Ask and
  they can be added, but the app is built for the Android install flow here.
- **One device, one log.** There is no account and no sync. Two phones means two
  separate logs — export from one, import on the other.
- **`ol-*` data is per-browser.** Chrome "Clear storage" for this site, or
  uninstalling it, deletes the log. That's what the backup button is for.
- The app tries to mark its storage as persistent (`navigator.storage.persist`),
  which protects it from automatic eviction, but not from a manual clear.
