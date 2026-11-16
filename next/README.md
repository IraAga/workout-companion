# next/ — logging slice

The first implementation on the portable contract: **History → Start → workout →
save**, plus Progress, edit, delete/undo, drafts, last-time numbers, rest timer,
the weekly count and backup import/export.

Vite + TypeScript, no UI framework. The core is pure functions; the UI is a thin
DOM layer. The catalog is imported straight from `../contract/data/catalog.json`,
so a catalog edit in the contract shows up here on the next build.

Not deployed. `docs/` is still the live app.

## Run

```bash
cd next
npm install
npm run dev        # http://localhost:5173
npm test           # 27 core tests
npm run build      # type-check + production build into next/dist
```

Requires Node 22.12+ (Vite 8).

## What it covers

| Rule | Status |
|---|---|
| R1 program/session selection | ✅ |
| R2 catalog is a suggestion (`ol-plan` respected) | ✅ reads overrides |
| R3 drafts, autosave, row rules | ✅ |
| R4 save/update, id/rev/ts, validation | ✅ |
| R5 history edit borrows the slot | ✅ |
| R6 delete + undo | ✅ |
| R7 last-time lookup | ✅ |
| R8 weekly lift count | ✅ |
| R9 progress series, stats, chart | ✅ read-only view |
| R11 rest timer (+30 s, skip) | ✅ |
| R13 ordering, dates, number format | ✅ |
| R16 start / discard / close | ✅ |

**Not in this slice:** the content panels, manual progress entries, GitHub sync,
PWA/offline shell, adding or editing exercise definitions, and the proposed
four-item bottom navigation (its other three destinations do not exist yet).

History, Progress and the workout state follow `pocket-log.svg` and
`pocket-log-workout.svg` closely; the bottom nav is the one structural element
left out on purpose. The shipped references remain in
`../contract/templates/pocket-log-shipped.svg` and
`pocket-log-workout-shipped.svg`.

## Data compatibility

It reads and writes exactly the shipped keys:

```
ol-sessions   saved sessions
ol-drafts     in-progress entry, keyed "program/session"
ol-plan       per-session exercise overrides (read-only here)
ol-prefs      selected program/session
ol-collapse   collapsed cards
```

The session shape matches `contract/schema/log-session.schema.json`; drafts
match `drafts.schema.json`.

`localStorage` is per origin, so `localhost:5173` starts empty. Two ways to use
the log from the live app:

### A. Restore a backup (works anywhere)

1. In the live app: **Workout log → History → Backup & restore → Download backup**.
2. In this app: **History → Backup & restore → Restore from file**.
3. Confirm the replace. The four `ol-*` keys are restored verbatim; GitHub sync
   state and tombstones are left alone.

Export back the same way if you need to move the log the other direction.

### B. Same origin (no migration at all)

```bash
npm run build:pages     # writes ../docs/next
```

Commit `docs/next/` and open `https://iraaga.github.io/workout-companion/next/`.
Same host means the new app sees the existing `ol-sessions` immediately — no
import step.

Caveats: both apps then share the same keys, so do not write in both at once
while testing. The existing service worker also controls `/next/`; its offline
fallback serves the old shell. Test online, and add a nested service worker or
unregister the old one before relying on offline mode.

## Structure

```
next/
  index.html                 shell + fonts
  src/main.ts                mount
  src/styles.css             tokens and layout
  src/core/
    types.ts                 contract types
    catalog.ts               JSON import + lookups
    dates.ts                 local dates, parsing, formatting
    storage.ts               key/value seam (localStorage or memory)
    rules.ts                 pure R1–R9 helpers + buildSession + buildSeries
    store.ts                 state, drafts, edit/delete/undo, backup
    backup.ts                parse/restore/collect the shipped backup format
    rules.test.ts            16 tests
    store.test.ts            7 tests
    backup.test.ts           4 tests
  src/ui/
    app.ts                   DOM render + event delegation
    format.ts                escaping, labels
```

`core/` has no DOM access, which is why the tests run in Node and why another
UI can reuse it.

## Verified flows

Automated in headless Chrome at **412×924, DPR 2.625 (Pixel 10)**, against the
production build, with no horizontal overflow:

- empty state and week pill (`0 of 3`)
- Start → 6 cards, correct template line, drafts
- typing + ticking two sets → `1 exercise · 2 sets`, rest starts at `2:00`
- save → History row, toast, `ol-sessions` contains the expected JSON
- reload → row persists, week pill `1 of 3`
- edit → prefilled `60`, save `65`, same id, `rev` bumped, `ts` kept
- delete → `Undo` restores the session
- invalid input → error visible in the sticky save bar, field marked
- last time renders on the next workout
- Progress tab: series picker, latest/best/since-first, sparkline, table
- segmented control: History/Progress active states, none while logging
- backup export then import into a cleared origin restores every session

No console errors.

## Next steps

1. Bottom navigation + the Week/Train/Eat destinations it needs.
2. Add/rename exercise definitions (R12) and "reset to suggested".
3. Sync UI (R15) after the import path has been exercised.
4. Content panels from `contract/data/content/` — static and low risk.
5. PWA shell and same-origin deployment.
