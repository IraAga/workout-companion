# Portable contract — Off-Season Plan

What this is: a complete, UI-independent description of the app's data and
behaviour, so the whole product can be rebuilt behind a different interface
without rediscovering anything.

What this is not: a framework. There is no runtime dependency, no build step,
and nothing here is imported by `docs/index.html`. The working app is untouched.

---

## 1. How the current app is put together

Everything ships as one file: `docs/index.html` (~5,000 lines). Inside it:

| Concern | Where | Notes |
|---|---|---|
| Static documents | `<section class="doc" data-panel="…">` × 9 | Program, recovery, nutrition, meals, groceries, times, full body, week, log. Hand-written HTML. |
| Content index | `<nav aria-label="Documents">` | 5 groups: Overview, Track, Train, Eat, Shop. Also drives the sub-index on the Week panel. |
| Sub-tabs | `.subtabs` + `.sub[data-sub]` | Program has gym/home/minimal; recovery has 3 options; log has History + Progress, with the workout view opening below the strip rather than as a tab. |
| Catalog | `var CATALOG` (inline JSON) | 4 programs, 10 sessions, 62 exercise slots, 48 unique exercises. |
| Rest times | `var REST` | Exercise id → seconds. Fallback 90. |
| Log engine | rest of the inline script | Storage, validation, editing, history, progress chart, rest timer, sync. |
| Backup/restore + SW registration | second inline script | Deliberately isolated from the log engine. |
| Tab router | third inline script | Hash + `op-tab`. |
| Offline shell | `docs/sw.js` | Network-first navigation with 4 s timeout, stale-while-revalidate assets. Bump `VERSION` on change. |

Three layers are mixed together:

1. **Content** — prose, tables, meal cards. Read-only. Replaceable wholesale.
2. **Catalog** — program structure. Data you may want to keep exactly.
3. **State** — `ol-sessions` and friends. The user's actual work. Must be
   preserved bit-for-bit or migrated deliberately.

A new UI replaces layer 2's rendering and layer 1's presentation. It must keep
layer 3's schema and the rules below.

---

## 2. Data reference

Machine-readable copies live in `data/`:

- `data/catalog.json` — programs → sessions → exercises, a flat `exerciseIndex`
  with `restSeconds` merged in, units, and id conventions.
- `data/app.json` — nav, panel manifest, storage key catalogue, sync/backup
  constants, shared rules.
- `data/content/index.json` — panel metadata and block outline.
- `data/content/<panel>.json` — each panel as typed blocks, plus `sourceHtml`
  (the original markup verbatim) for anything the normaliser did not model.

JSON Schemas for state live in `schema/`.

### Entities

**Program** `{ id, label, sessions[] }`
`gym`, `fullbody`, `home`, `minimal`.

**Session** `{ id, label, note, exercises[] }`
`lift-a`, `lift-b`, `lift-c`, `full`. Ids are only unique *within* a program.

**Exercise definition** `{ id, title, hint, sets, target, unit, suggested, bw }`
- `sets` is a number used to seed draft rows, not a hard cap (max 12 rows).
- `target` is free text (`4x4`, `3x8/leg`). Editing an exercise re-derives
  `sets` from a leading `Nx` in `target`.
- `unit` is `reps` or `sec`; `sec` means the "reps" column holds seconds.
- `bw: true` means bodyweight — only added weight is logged.

**LogSession** — see `schema/log-session.schema.json`. Key facts:
- `id` is `s<epochMs>` and never changes.
- `rev` is the last-write time; `ts` is the creation time. Merge compares `rev`.
- `programLabel` / `sessionLabel` and each exercise's `name` are **snapshots**.
  Renaming a catalog exercise must not rewrite history.
- Only exercises with at least one filled set exist. Empty sets are dropped:
  a set is `{ kg, reps }` with at least one number, the other may be `null`.
- `source: "progress"` marks a manually entered data point.

**Storage keys**

| Key | Contents | Synced | Backed up | Safe to delete |
|---|---|---|---|---|
| `ol-sessions` | `LogSession[]` | yes | yes | no — the user's work |
| `ol-drafts` | per-session unfinished entry | no | yes | loses in-progress typing |
| `ol-plan` | per-session exercise overrides | no | yes | reverts to catalog |
| `ol-prefs` | selection + chart choice | no | yes | re-picks defaults |
| `ol-collapse` | collapsed exercise ids | no | no | yes |
| `ol-tombstones` | `{id: epochMs}` | yes (as `deleted`) | no | yes, risks resurrecting deletions |
| `ol-sync` | GitHub token + status | no | no | disconnects sync |
| `op-tab` | last visible panel | no | no | yes |

`ol-drafts`, `ol-plan` and `ol-prefs` are keyed by `"<program>/<session>"`,
except prefs, which holds a single current selection.

**Sync state** is device-local and contains a plaintext PAT. A new UI should
keep it out of exported data, as the current one does.

---

## 3. Behaviour rules

Each rule is something a replacement UI has to reproduce or consciously drop.
They are ordered roughly by how easy they are to get wrong.

### R1 — Program and session selection
`program()` = the prefs program if it still exists in the catalog, else the
first program (`gym`). `session()` = the prefs session inside that program,
else the program's first session. On first run, the session is picked by
weekday: Mon → `lift-a`, Wed → `lift-b`, Fri → `lift-c`, else `lift-a`.
Changing the program clears the session and re-normalises.

### R2 — The catalog is a suggestion
`exercises()` returns `plan["<program>/<session>"]` when that key exists —
*including when it is an empty array*, which means "this session has no
exercises". Otherwise it returns the catalog session's exercises. The first
edit clones the catalog list into `ol-plan`. "Reset to suggested exercises"
deletes the key. Never merge catalog and override.

### R3 — Drafts are per program/session and use strings
A draft is created on demand with one row per suggested set. Row values are
raw input strings; `''` means empty. Typing saves after a 300 ms debounce.
Rows are capped at 12. Reducing `sets` on an exercise removes only empty
trailing rows; filled rows are never dropped. `done` is a UI tick that is
never written into a saved session. Drafts are not cleared after saving an
*existing* session — only after creating a new one.

### R4 — Saving a session
1. Refuse while an exercise card is still being edited.
2. Produce sets from draft rows, skipping rows where both fields are empty.
3. Parse numbers with `,` → `.`; reject negatives and non-numbers and mark
   those inputs. Empty → `null`.
4. Drop exercises with zero usable sets. Require at least one exercise.
5. `date` = the date field, else today, always local `YYYY-MM-DD`.
6. New: `id = "s" + Date.now()`, `ts = rev = Date.now()`, unshift into the
   array, delete that program/session's draft.
7. Edit: keep `id`, `ts`, `program`, `programLabel`, `session`, `sessionLabel`
   and `source` from the stored session; set `rev = Date.now()`; replace in
   place.
8. `note` is trimmed; `unit` defaults to `reps`.
9. Persist the whole array, then queue sync (~2.5 s). Saving must be idempotent
   under double taps (guard with a `saving` flag).

### R5 — Editing a saved session borrows the working slot
History edit copies the saved session into a temporary `plan` entry and
`draft`, switches selection to that program/session, and restores the previous
plan/draft/selection/date on exit. In the current UI it opens the workout view
immediately (R16); the banner's Cancel edit and the × both cancel the edit.
This is why edits are field-for-field faithful and why saved sets are mapped
back by index. If the new UI keeps a separate edit buffer, it must still
preserve `id` and `ts` and bump `rev`.

### R6 — Deletion and undo
Delete removes the session and writes a tombstone `{id: now}`. An undo window
re-inserts at the same index and clears the tombstone. Tombstones beat sessions
in merge unless the session's `rev` is newer (logged again after deleting).
Prune tombstones older than 365 days.

### R7 — "Last time" lookup
Sort sessions by date descending, then `ts` descending. The first session with
that exercise id and at least one set wins. Used for input placeholders (same
index, falling back to the last set), "Fill from last time" (only fills empty
fields) and "Copy last time" (replaces rows with the previous numbers).

### R8 — Weekly status
Monday-to-Sunday in local time, inclusive. Count distinct `session` ids among
`lift-a`, `lift-b`, `lift-c` for sessions whose date is in range, ignoring
`source === "progress"`. Display "N of 3 lifts done" plus three dots.

### R9 — Progress series and chart
- Series key: `"n|" + name.trim().toLowerCase().replace(/\s+/g, " ")`.
  Keying by **name** (not id) means a rename starts a new series instead of
  silently merging two different exercises.
- Rows are appended oldest-first; the latest id, spelling and unit win, which
  lets a renamed-and-reidentified exercise keep one label.
- Value per session: if **every** session row for that series has at least one
  `kg > 0`, plot the max `kg` (metric "Top weight"); otherwise plot the max
  reps where `reps || 0` ("Best reps", or "Best hold" for `sec`).
- Panel shows latest, best ('max' of all values, not latest), change since
  first, a line chart, and a reverse-chronological table.
- Series list order: row count desc, then name ascending.
- Selection lives in `prefs.progressEx` (series key); `prefs.progressId`
  (exercise id) is a legacy fallback for data written by older builds.

### R10 — Manual progress entries
Adds a one-set session with `source: "progress"`, `sessionLabel: "Progress
entry"`, and the current program/session ids. New names reuse a known exercise
id when the normalised title matches; otherwise mint
`x<base36 time><3 chars>`. Requires a weight or reps value.

### R11 — Rest timer
Per exercise id from `catalog.restSeconds`, fallback 90 s. Completing a set
starts it. Offers +30 s and skip. Beeps via WebAudio (created lazily on user
gesture) and holds a screen wake lock while the entry form is visible.
Cosmetic; safe to reimplement natively.

### R12 — Exercise identity on add/rename
Typing a title that matches another catalog exercise exactly (normalised) swaps
the card to that exercise, inheriting its metadata and history. Any other title
is a rename that keeps the current id. You cannot add the same id twice to one
session. New custom exercises get `custom: true` and default to 3 sets.

### R13 — Ordering, dates, numbers
Sessions sort by date desc, then `ts` desc. Dates are local `YYYY-MM-DD`
strings and display as `d MMM` via `toLocaleDateString(undefined, …)`.
Numbers display without trailing zeros (`42.50` → `42.5`). Set text reads
`"50 kg × 4"`, `"50 kg"` or `"8 reps"` / `"30 s"`.

### R14 — Backup and restore
Download writes `{format, schema, exportedAt, sessions, keys}`, where `keys`
holds the **raw JSON strings** of `ol-prefs`, `ol-plan`, `ol-drafts`,
`ol-sessions`. Restore validates `keys`, asks once for confirmation, then
replaces exactly those four keys and reloads. It never touches `ol-sync` or
`ol-tombstones`. See `schema/backup.schema.json`.

### R15 — Sync
Offline-first. localStorage is authoritative locally; GitHub is the shared
copy. On any change, mark dirty and reconcile after ~2.5 s (1.2 s after load,
600 ms if another sync was requested while busy). Read `log.json`, merge, write
back if the merge differs, retry once on `409`/`422`, then adopt the merged
result locally. Merge algorithm: highest `rev` per session id, union of
tombstone maps taking the max timestamp, drop sessions covered by a tombstone,
sort by `ts` desc. Auth is `Bearer <PAT>`. Network failures never block logging.

### R16 — Starting, discarding and finishing a workout
History is the home of the log tab and the only permanent state: template
pickers, **Start workout**, the saved sessions, backup and sync. There is no
entry tab.

- Start opens the workout view *below* the sub-tab strip. The strip stays
  visible but **no tab is selected**, and the chosen template is echoed in a
  line ("Gym · Lift A · Sun 15 Nov"). Starting scrolls to the first kg input.
- Reloading returns to History. The draft survives (R3), so Start resumes it.
- × ("Discard this workout") never deletes a saved session:
  - during a history edit it cancels the edit, restores the borrowed
    plan/draft/selection and shows "Edit cancelled" — the same effect as the
    banner's Cancel edit;
  - otherwise it confirms only when a set or the note was typed, then deletes
    that program/session's draft and returns to History.
- Saving a new session or updating an edited one closes the view, returns to
  History and shows a toast. Only this writes `ol-sessions`; drafts autosave.
- "Fill from last time", collapse/expand, the save bar, the rest timer and the
  save-status line all live inside the workout view, not on History.

---

## 4. UI surface a replacement must cover

Content (static): 9 panels, 5 nav groups, 3 sub-tab sets (the log's has two,
History and Progress). Data in `data/content/`.

Interactive:

1. Week overview with the live weekly lift count (R8).
2. Program reference for 4 programs / 10 sessions, read from the catalog.
3. History: saved sessions grouped by date, expand, edit and delete with undo
   (R5, R6).
4. Template pickers (program/session/date) and Start workout (R16).
5. Workout view: one collapsible card per exercise, per-set weight/reps, set
   done ticks, add/remove sets (max 12), add/remove/edit exercises, "Fill from
   last time", session note, save or discard, rest timer (R2–R4, R7, R11–R13).
6. Progress: series picker, latest/best/change, chart, table, manual entry
   (R9, R10).
7. Backup download/restore (R14) and GitHub sync: connect, status, sync now,
   disconnect (R15).
8. Tab persistence and hash routing (`op-tab`), plus the PWA install and
   offline shell.

If a replacement drops 7–8 it still preserves all user work as long as it reads
the same keys, but cross-device continuity and installability are lost.

---

## 5. UI templates

Four layouts over this contract, drawn as annotated wireframes in `templates/`
(open `templates/index.html` for the gallery):

| | Template | Viewport | Home | Effort | Rules exercised |
|---|---|---|---|---|---|
| A | Pocket Log (restyle, 2 states) | Phone | Week | Low | R1–R16 |
| B | Workbench | Desktop / tablet | Active session | Medium | R1–R9, R11–R13, R16 |
| C | Focus | Phone | Exercise *n* of 6 | Low | R1–R4, R7, R11, R13 |
| D | Dashboard | Phone / desktop | This week | Medium | R1, R4, R8, R9 |

Recommendation: **ship A, add C, lay out B at the wide breakpoint, defer D.**
A is the lowest-risk base because it keeps every surface and rule; it is drawn
in both of its states, History and the workout open below the strip
(`pocket-log-workout.svg`). Those drawings are a restyle proposal; the literal
current screens are kept as `pocket-log-shipped.svg` and
`pocket-log-workout-shipped.svg`, captured from the running app. C is a workout
*mode*, not a destination, and fixes one-handed entry. B is the same
session/set/rest components in three panes, not a second app. D optimises for
adherence rather than entry and needs weeks of data to be worth its space.

`templates/templates.json` holds the machine-readable version (surfaces, keys,
rules, scores). `tools/check-templates.mjs` verifies that every referenced rule,
key and preview file exists. The SVGs are illustrations, not generated output:
if the catalog changes, update their numbers by hand.

---

## 6. Porting in six steps

1. **Copy `docs/index.html` somewhere read-only.** It is the reference and the
   only place the old UI can still run.
2. **Decide the storage seam.** For web, keep the exact `localStorage` keys and
   the `"<program>/<session>"` key format — then an existing install keeps its
   log with no migration. For native or a new origin, import a backup file
   (R14) or read `ol-sessions` and map it into your store.
3. **Port the catalog first.** Load `data/catalog.json`; render programs and
   sessions from it. Do not hardcode exercise metadata in components.
4. **Port the log rules next, in this order:** last-time lookup → save
   validation → weekly status → progress series. Those four cover most of the
   product value.
5. **Port history and progress.** They are read-only views over the same array.
6. **Add sync last.** It is genuinely optional and orthogonal to the UI; keep
   the envelope and merge rules if you want the same data repo to keep working.

Keep the same repo origin if you can: `localStorage` is per origin, so a new
URL means an empty log unless the user restores from a backup.

---

## 7. Gotchas worth knowing before rewriting

- **Never re-sort in place by `ts` only.** Date is the user's intent; `ts`
  breaks ties.
- **Reps are seconds for `sec` exercises.** The column label changes; the field
  name does not.
- **The progress chart's "Best" is the max across sessions, not the latest.**
- **Renaming an exercise keeps its id**, so history follows the id while the
  progress series follows the name. Both behaviours are intentional.
- **Clearing a program's override array is meaningful.** `[]` ≠ "use catalog".
- **Labels are snapshots.** If you normalise them from the current catalog you
  will rewrite history when a program is renamed or removed.
- **`ol-sync` contains a token in plaintext.** Do not include it in exports.
- **Sync failures are silent by design.** A workout in a basement must save.
- The `mode === 'db'` branches (Firestore via `window.claude.use('db')`) are
  inert: `initStore` always falls back to `mode = 'local'` because the host does
  not provide the db. Treat local storage + GitHub as the only real backend.

---

## 8. Keeping this in sync

`docs/index.html` is canonical. Regenerate and verify:

```bash
node tools/extract-contract.mjs           # rewrite data/
node tools/extract-contract.mjs --check   # non-zero exit if out of date
node tools/check-templates.mjs            # rules, keys and previews still exist
```

The extractor fails if a panel's text is not fully represented in its blocks,
so silent content loss during normalisation is caught at generation time.
`sourceHtml` on every panel keeps a verbatim fallback regardless.

When you change the log format or a rule, change `SPEC.md` and the relevant
schema in the same commit. When you retire `docs/index.html`, move the
extractor's source path (one constant) to whatever replaces it, or freeze
`contract/` and treat it as the spec.
