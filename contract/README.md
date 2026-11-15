# contract/ — the app's portable core

Everything needed to rebuild the Off-Season Plan UI without touching the
working app. Generated from `docs/index.html`; no runtime dependency.

```
contract/
  SPEC.md                      ← read this first: data model + behaviour rules
  data/
    app.json                   nav, panels, storage keys, sync/backup constants
    catalog.json               4 programs, 10 sessions, 48 exercises, rest times
    content/
      index.json               panel manifest + block outline
      week.json … log.json     one file per panel, as typed blocks + verbatim HTML
  schema/
    log-session.schema.json    the user's saved workouts (the important one)
    drafts.schema.json         in-progress entries
    plan.schema.json           per-session exercise overrides
    prefs.schema.json          program/session/chart selection
    sync.schema.json           GitHub token + status
    log-doc.schema.json        the JSON committed to GitHub
    backup.schema.json         downloaded backup file
  example/index.html           small vanilla-JS renderer proving the data is enough
```

## Read it in three passes

1. **`SPEC.md` §1–2** — how the single file is layered, and the entities.
2. **`SPEC.md` §3** — 15 numbered behaviour rules. These are the product.
   R4 (save), R7 (last time), R8 (week), R9 (progress) are the core.
3. **`data/content/week.json`** — a small, readable example of the content
   block format.

## Quick start for a new UI

```js
const catalog = await (await fetch('contract/data/catalog.json')).json();
const program = catalog.programs.find(p => p.id === 'gym');

program.sessions.forEach(session => {
  // exercise definitions ready to render
  session.exercises.forEach(ex => {
    ex.sets;      // suggested row count
    ex.target;    // "4x4"
    ex.unit;      // "reps" | "sec"
    catalog.exerciseIndex[ex.id].restSeconds;
  });
});
```

Content blocks are self-describing; switch on `block.type`:

`kicker · heading · paragraph · meta · hint · macro · list · week · index ·
table · meal-grid · meal · subtabs · section · widget · details · html · group`

`html` is the escape hatch: blocks the normaliser does not model carry the
original markup, and every panel also keeps `sourceHtml` verbatim. Nothing is
lost and nothing is fetched from the network.

## Try the example

```bash
cd /Users/iagathis/workout-companion
python3 -m http.server 8080
# open http://localhost:8080/contract/example/
```

It reads the JSON and renders the weekly schedule plus the selected program —
no app code reused.

## Regenerate after editing the app

`docs/index.html` stays canonical.

```bash
node tools/extract-contract.mjs           # rewrite data/
node tools/extract-contract.mjs --check   # non-zero exit if out of date
```

The extractor also fails if any panel's words are missing from the normalised
blocks, so content cannot silently disappear.

## Migrating real user data

The one irreplaceable thing is `ol-sessions`. Options, in order of safety:

1. Keep the same origin **and** the same keys → the log is already there.
2. Export a backup in the app (`Log → History → Download backup`) and import it
   through your own restore path. The file embeds the raw JSON for
   `ol-prefs`, `ol-plan`, `ol-drafts`, `ol-sessions`
   (see `schema/backup.schema.json`).
3. Keep syncing to the same GitHub repo (`IraAga/workout-companion-data`,
   `log.json`) and read the envelope in `schema/log-doc.schema.json`.

Do not hand-edit dates or ids: `id` is the identity, `rev` drives merges, and
`ts` is the creation time.
