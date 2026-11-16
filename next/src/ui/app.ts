import { catalog, restSeconds } from '../core/catalog';
import { backupName, parseBackup } from '../core/backup';
import { byDateDesc, fmtDate, fmtNum, isoDate } from '../core/dates';
import { buildSeries, filled, setText, type Series } from '../core/rules';
import type { Store } from '../core/store';
import type { BuildResult, DraftSet, ExerciseDef } from '../core/types';
import { dateLabel, esc, plural } from './format';

type View = 'history' | 'progress' | 'train' | 'eat' | 'workout';

const ICON_EDIT =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const GRIP_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>';
const ICON_DELETE =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';

interface Toast {
  text: string;
  label?: string;
  run?: () => void;
}

interface RestState {
  end: number;
}

export function mountApp(root: HTMLElement, store: Store): void {
  let view: View = 'history';
  let trainProgramId = store.program().id;
  let addOpen = false;
  let toast: Toast | null = null;
  let toastTimer: number | undefined;
  const rest: RestState = { end: 0 };
  let restTimer: number | undefined;

  const render = (): void => {
    root.innerHTML = shell() + (toast ? toastHtml(toast) : '');
    tickRest();
  };

  const showToast = (text: string, label?: string, run?: () => void): void => {
    toast = { text, label, run };
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast = null; render(); }, 5000);
    render();
  };

  const dismissToast = (): void => {
    toast = null;
    if (toastTimer) window.clearTimeout(toastTimer);
  };

  /* ------------------------------------------------------------- rest */

  function startRest(exId: string): void {
    rest.end = Date.now() + restSeconds(exId) * 1000;
    if (!restTimer) restTimer = window.setInterval(tickRest, 250);
    tickRest();
  }

  function stopRest(): void {
    rest.end = 0;
    if (restTimer) { window.clearInterval(restTimer); restTimer = undefined; }
  }

  function tickRest(): void {
    const el = document.getElementById('rest-time');
    if (!el) return;
    const left = Math.max(0, Math.ceil((rest.end - Date.now()) / 1000));
    el.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    if (left <= 0 && restTimer) {
      window.clearInterval(restTimer);
      restTimer = undefined;
    }
  }

  function restLabel(): string {
    const left = Math.max(0, Math.ceil((rest.end - Date.now()) / 1000));
    return Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
  }

  /* ----------------------------------------------------------- render */

  function shell(): string {
    const week = store.week();
    const dots = Array.from({ length: 3 }, (_, i) =>
      '<i class="' + (i < week.count ? 'on' : '') + '"></i>',
    ).join('');
    const isLog = view === 'history' || view === 'progress';
    const showSegmented = isLog || view === 'workout';
    const selected = isLog ? view : '';

    const chrome = view === 'workout'
      ? '<p class="kicker">Track</p>'
      : '<header class="top">' +
          '<p class="brand">Off-Season</p>' +
          '<p class="tagline">' + esc(longDate()) + '</p>' +
        '</header>' +
        '<div class="week-pill wide"><span>' + week.count + ' of 3 lifts done</span><span class="dots">' + dots + '</span></div>';

    const body = view === 'history' ? historyView()
      : view === 'progress' ? progressView()
        : view === 'train' ? trainView()
          : view === 'eat' ? eatView()
            : workoutView();

    const segmented = showSegmented
      ? '<div class="segmented" role="tablist" aria-label="Log views">' +
          tabButton('history', 'History', selected === 'history') +
          tabButton('progress', 'Progress', selected === 'progress') +
        '</div>'
      : '';

    return (
      '<div class="wrap">' +
        chrome +
        segmented +
        '<main>' + body + '</main>' +
      '</div>' +
      (view === 'workout'
        ? (addOpen ? addSheet() : '')
        : tabbar())
    );
  }

  function classicUrl(hash = ''): string {
    const suffix = hash ? '#' + hash : '';
    return location.pathname.includes('/next/')
      ? '../' + suffix
      : 'https://iraaga.github.io/workout-companion/' + suffix;
  }

  function tabButton(id: View, label: string, active: boolean): string {
    return '<button type="button" role="tab" data-action="tab" data-view="' + id + '"' +
      ' aria-selected="' + (active ? 'true' : 'false') + '">' + label + '</button>';
  }

  function longDate(): string {
    const parts = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).formatToParts(new Date());
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    return get('weekday') + ', ' + get('day') + ' ' + get('month');
  }

  const shortProgram = (label: string): string => label.replace(/\s+program$/i, '');

  function historyView(): string {
    const program = store.program();
    const session = store.session();
    const draft = store.draft();

    const programOptions = catalog.programs.map((p) =>
      '<option value="' + esc(p.id) + '"' + (p.id === program.id ? ' selected' : '') + '>' + esc(shortProgram(p.label)) + '</option>',
    ).join('');
    const sessionOptions = program.sessions.map((s) =>
      '<option value="' + esc(s.id) + '"' + (s.id === session.id ? ' selected' : '') + '>' + esc(s.label) + '</option>',
    ).join('');

    const sections = store.sessions.slice().sort(byDateDesc);
    const list = sections.length
      ? sections.map(sessionRow).join('')
      : '<p class="empty">No sessions saved yet. Start a workout above and save it.</p>';

    return (
      '<section class="history">' +
        '<h1 class="sr-only">History</h1>' +
        '<section class="startcard">' +
          '<div class="sc-head"><b>' + esc(shortProgram(program.label) + ' · ' + session.label) + '</b><span>' + esc(fmtDate(draft.date)) + '</span></div>' +
          '<div class="chips">' +
            '<label class="chip"><span class="sr-only">Program</span><select data-select="program" aria-label="Program">' + programOptions + '</select></label>' +
            '<label class="chip"><span class="sr-only">Session</span><select data-select="session" aria-label="Session">' + sessionOptions + '</select></label>' +
            '<label class="chip datechip"><span class="sr-only">Date</span><span class="chip-value">' + esc(fmtDate(draft.date)) + '</span><input type="date" data-input="date" aria-label="Date" value="' + esc(draft.date) + '"></label>' +
          '</div>' +
          '<button class="btn primary block" data-action="start">Start workout</button>' +
        '</section>' +
        '<h2 class="recent">Recent</h2>' +
        list +
        '<details class="tools">' +
          '<summary>Backup &amp; restore</summary>' +
          '<div class="tools-body">' +
            '<p class="tools-hint">Move the log between this build and the live app. Restoring replaces the four log keys on this device; sync state is left alone.</p>' +
            '<div class="tools-actions">' +
              '<button class="btn" data-action="backup-export">Download backup</button>' +
              '<button class="btn" data-action="backup-import">Restore from file</button>' +
            '</div>' +
            '<input type="file" accept="application/json,.json" data-input="backup-file" hidden>' +
            '<p class="tools-msg" id="backup-msg" role="status" aria-live="polite"></p>' +
            '<p class="classic"><a href="' + classicUrl() + '">Open the classic app ↗</a></p>' +
          '</div>' +
        '</details>' +
      '</section>'
    );
  }

  function sessionRow(s: Store['sessions'][number]): string {
    const exercises = s.exercises ?? [];
    const sets = exercises.reduce((n, e) => n + e.sets.length, 0);
    const items = exercises.map((e) =>
      '<li><b>' + esc(e.name || e.id) + '</b><span>' +
        esc(e.sets.map((x) => setText(x, e.unit)).filter(Boolean).join(' · ')) +
      '</span></li>',
    ).join('');
    return (
      '<details class="session">' +
        '<summary>' +
          '<span class="s-date">' + esc(dateLabel(s.date)) + '</span>' +
          '<span class="s-title">' + esc(s.sessionLabel || s.session) + (s.programLabel ? ' · ' + esc(s.programLabel) : '') + '</span>' +
          '<span class="s-meta">' + plural(exercises.length, 'exercise') + ' · ' + plural(sets, 'set') + '</span>' +
          '<span class="chev" aria-hidden="true"></span>' +
        '</summary>' +
        '<div class="s-body">' +
          '<ul class="s-list">' + items + '</ul>' +
          (s.note ? '<p class="s-note">' + esc(s.note) + '</p>' : '') +
          '<div class="s-actions">' +
            '<button class="iconbtn small" data-action="edit" data-id="' + esc(s.id) + '" aria-label="Edit session" title="Edit session">' + ICON_EDIT + '</button>' +
            '<button class="iconbtn small danger" data-action="delete" data-id="' + esc(s.id) + '" aria-label="Delete session" title="Delete session">' + ICON_DELETE + '</button>' +
          '</div>' +
        '</div>' +
      '</details>'
    );
  }

  function progressView(): string {
    const all = buildSeries(store.sessions);
    if (!all.length) {
      return '<section class="progress"><h1 class="sr-only">Progress</h1>' +
        '<p class="empty">Progress charts appear here once you save a session.</p></section>';
    }
    const wanted = store.prefs().progressEx;
    const selected = all.find((s) => s.key === wanted) ?? all[0]!;
    const options = all.map((s) =>
      '<option value="' + esc(s.key) + '"' + (s.key === selected.key ? ' selected' : '') + '>' +
        esc(s.name + ' (' + s.rows + ')') +
      '</option>',
    ).join('');

    const pts = selected.pts;
    const vals = pts.map((p) => p.v);
    const first = vals[0] ?? 0;
    const latest = vals[vals.length - 1] ?? 0;
    const best = Math.max(...vals);
    const diff = latest - first;
    const diffTxt = pts.length > 1 ? (diff > 0 ? '+' : diff < 0 ? '−' : '') + fmtNum(Math.abs(diff)) : '—';

    const rows = pts.slice().reverse().map((p) =>
      '<tr><td>' + esc(fmtDate(p.date)) + '</td><td>' +
        esc(p.sets.map((x) => setText(x, selected.unit)).filter(Boolean).join(' · ')) +
      '</td><td>' + fmtNum(p.v) + ' ' + selected.mu + '</td></tr>',
    ).join('');

    return (
      '<section class="progress">' +
        '<h1 class="sr-only">Progress</h1>' +
        '<div class="pick one"><label>Exercise<select data-select="progress" aria-label="Exercise">' + options + '</select></label></div>' +
        '<div class="stats">' +
          statCard('Latest', fmtNum(latest), selected.mu) +
          statCard('Best', fmtNum(best), selected.mu) +
          statCard('Since first', diffTxt, pts.length > 1 ? selected.mu : '') +
        '</div>' +
        '<p class="cap">' + esc(selected.metric) + ' per session (' + selected.mu + ')</p>' +
        '<div class="chartbox">' + sparkline(selected) + '</div>' +
        '<div class="tablewrap"><table><thead><tr><th>Date</th><th>Sets</th><th>' +
          esc(selected.metric) +
        '</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '</section>'
    );
  }

  function statCard(k: string, v: string, unit: string): string {
    return '<div class="stat"><span class="k">' + k + '</span><span class="v">' + v +
      (unit ? '<small>' + unit + '</small>' : '') + '</span></div>';
  }

  function sparkline(series: Series): string {
    const pts = series.pts;
    const W = 320;
    const H = 120;
    const L = 10;
    const R = 310;
    const T = 12;
    const B = 104;
    const vals = pts.map((p) => p.v);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const x = (i: number): number => (pts.length === 1 ? W / 2 : L + ((R - L) * i) / (pts.length - 1));
    const y = (v: number): number => B - ((v - min) / span) * (B - T);
    const path = pts.map((p, i) => x(i).toFixed(1) + ',' + y(p.v).toFixed(1)).join(' ');
    const dots = pts.map((p, i) =>
      '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p.v).toFixed(1) + '" r="' +
        (i === pts.length - 1 ? 4.5 : 3) + '" fill="currentColor"/>',
    ).join('');
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      esc(series.name + ': ' + series.metric.toLowerCase() + ', latest ' +
        fmtNum(vals[vals.length - 1] ?? 0) + ' ' + series.mu) + '">' +
      (pts.length > 1
        ? '<polyline points="' + path + '" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'
        : '') +
      dots +
    '</svg>';
  }

  function trainView(): string {
    const active = catalog.programs.find((p) => p.id === trainProgramId) ?? store.program();
    const options = catalog.programs.map((p) =>
      '<option value="' + esc(p.id) + '"' + (p.id === active.id ? ' selected' : '') + '>' + esc(p.label) + '</option>',
    ).join('');

    const sessions = active.sessions.map((s) =>
      '<section class="train-session">' +
        '<h2>' + esc(s.label) + '</h2>' +
        '<p class="meta">' + esc(s.note) + '</p>' +
        '<ul class="train-list">' +
          s.exercises.map((e) =>
            '<li><b>' + esc(e.title) + '</b><span>' +
              esc((e.target || e.sets + ' sets') + (e.suggested ? ' · ' + e.suggested : '')) +
            '</span></li>',
          ).join('') +
        '</ul>' +
      '</section>',
    ).join('');

    return (
      '<section class="train">' +
        '<h1>Train</h1>' +
        '<p class="lead">Program reference from the shared catalog. Logging lives in Log.</p>' +
        '<div class="pick one"><label>Program<select data-select="train-program" aria-label="Program">' + options + '</select></label></div>' +
        sessions +
        '<p class="classic"><a href="' + classicUrl() + '">Open the classic app for notes and timing ↗</a></p>' +
      '</section>'
    );
  }

  function eatView(): string {
    const cards = [
      { title: 'Nutrition plan', desc: 'About 2,550 kcal and 200 g protein a day for a 5 kg fat loss over 10–12 weeks.', hash: 'nutrition' },
      { title: 'Meals', desc: 'Twelve protein-heavy meals with gram amounts for every ingredient.', hash: 'meals' },
      { title: 'Grocery list', desc: 'Monthly staples with a cost estimate.', hash: 'groceries' },
    ].map((c) =>
      '<a class="mini-card" href="' + classicUrl(c.hash) + '">' +
        '<b>' + esc(c.title) + ' ↗</b><span>' + esc(c.desc) + '</span>' +
      '</a>',
    ).join('');

    return (
      '<section class="eat">' +
        '<h1>Eat</h1>' +
        '<p class="lead">Nutrition stays in the classic app while this build focuses on logging. The targets below are the same plan.</p>' +
        '<div class="mini-cards">' + cards + '</div>' +
      '</section>'
    );
  }

  function tabbar(): string {
    const logActive = view === 'history' || view === 'progress';
    const icon = {
      log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11"/></svg>',
      train: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 9h6M9 13h6M9 17h4"/></svg>',
      eat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8c-3-3-7-1-7 3 0 4 4 9 7 9s7-5 7-9c0-4-4-6-7-3Z"/><path d="M12 8c0-2 1-3 3-4"/></svg>',
    };
    const item = (nav: string, label: string, active: boolean): string =>
      '<button type="button" data-action="nav" data-nav="' + nav + '"' +
        (active ? ' aria-current="page"' : '') + '>' + icon[nav as 'log' | 'train' | 'eat'] +
        '<span>' + label + '</span></button>';

    return (
      '<nav class="tabbar" aria-label="Sections">' +
        item('log', 'Log', logActive) +
        item('train', 'Train', view === 'train') +
        item('eat', 'Eat', view === 'eat') +
      '</nav>'
    );
  }

  function customId(): string {
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  }

  function addSheet(): string {
    const existing = new Set(store.exercises().map((e) => e.id));
    const choices = Object.values(catalog.exerciseIndex)
      .filter((e) => !existing.has(e.id))
      .sort((a, b) => a.title.localeCompare(b.title));
    const list = choices.map((e) =>
      '<li data-title="' + esc(e.title.toLowerCase()) + '">' +
        '<button type="button" data-action="add-pick" data-id="' + esc(e.id) + '">' +
          '<b>' + esc(e.title) + '</b>' +
          '<span>' + esc((e.target || e.sets + ' sets') + ' · ' + (e.unit === 'sec' ? 'sec' : 'reps')) + '</span>' +
        '</button>' +
      '</li>',
    ).join('');

    return (
      '<div class="sheet-backdrop" data-backdrop="add">' +
        '<section class="sheet" role="dialog" aria-modal="true" aria-labelledby="add-title">' +
          '<div class="sheet-head">' +
            '<h2 id="add-title">Add exercise</h2>' +
            '<button type="button" class="iconbtn" data-action="add-close" aria-label="Close">×</button>' +
          '</div>' +
          '<label class="add-search"><span class="sr-only">Search exercises</span>' +
            '<input type="search" data-input="add-search" placeholder="Search exercises" autocomplete="off" autofocus>' +
          '</label>' +
          '<ul class="add-list" id="add-list">' + list + '</ul>' +
          '<div class="add-custom">' +
            '<p class="add-custom-title">New exercise</p>' +
            '<div class="add-custom-row">' +
              '<input data-input="custom-name" placeholder="Exercise name" aria-label="New exercise name">' +
              '<select data-input="custom-unit" aria-label="Log as">' +
                '<option value="reps">Reps</option><option value="sec">Seconds</option>' +
              '</select>' +
              '<button type="button" class="btn primary" data-action="add-custom">Add</button>' +
            '</div>' +
            '<p class="tools-msg" id="add-msg" role="status" aria-live="polite"></p>' +
          '</div>' +
        '</section>' +
      '</div>'
    );
  }

  function focusExercise(id: string): void {
    requestAnimationFrame(() => {
      const card = document.querySelector<HTMLElement>('.card[data-ex="' + CSS.escape(id) + '"]');
      card?.scrollIntoView({ block: 'center' });
      card?.querySelector<HTMLInputElement>('input.num')?.focus({ preventScroll: true });
    });
  }

  function addExercise(def: ExerciseDef): void {
    store.addExercise(def);
    addOpen = false;
    render();
    focusExercise(def.id);
  }

  function setAddMessage(text: string, warn = false): void {
    const el = document.getElementById('add-msg');
    if (!el) return;
    el.textContent = text;
    el.className = 'tools-msg' + (warn ? ' warn' : '');
  }

  function workoutView(): string {
    const program = store.program();
    const session = store.session();
    const draft = store.draft();
    const exercises = store.exercises();
    const editing = !!store.editingId;
    const counts = store.counts();

    return (
      '<section class="workout">' +
        '<div class="loghead">' +
          '<h1>Log workout</h1>' +
          '<button class="iconbtn" data-action="discard" aria-label="Discard this workout" title="Discard this workout">×</button>' +
        '</div>' +
        '<p class="template-line">' + esc(shortProgram(program.label)) + ' · ' + esc(session.label) + ' · ' + esc(fmtDate(draft.date)) + '</p>' +
        '<p class="status-line">Saved on this device only · no account sync</p>' +
        (editing
          ? '<div class="banner"><span>Editing saved session.</span><button class="btn ghost" data-action="cancel-edit">Cancel edit</button></div>'
          : '') +
        '<div class="cards">' + exercises.map(card).join('') + '</div>' +
        '<div class="add-row"><button type="button" class="add-circle" data-action="add-open" aria-label="Add exercise" title="Add exercise">+</button></div>' +
        '<label class="note-box">Session notes' +
          '<textarea data-input="note" rows="2" placeholder="How it felt, any pain, what to change next time">' + esc(draft.note) + '</textarea>' +
        '</label>' +
        '<div class="savebar">' +
          '<p class="msg" id="msg" role="status" aria-live="polite"></p>' +
          '<div class="save-row">' +
            '<span class="sum" id="summary">' + summaryText(counts.ex, counts.sets) + '</span>' +
            '<button class="btn primary" id="save" data-action="save"' + (counts.sets ? '' : ' disabled') + '>' +
              (editing ? 'Update session' : 'Save session') +
            '</button>' +
          '</div>' +
          '<div class="rest"' + (rest.end ? '' : ' hidden') + ' id="rest">' +
            '<span class="rest-k">Rest</span><b id="rest-time">' + restLabel() + '</b>' +
            '<button class="btn ghost" data-action="rest-add">+30 s</button>' +
            '<button class="btn ghost" data-action="rest-skip">Skip</button>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function card(ex: ExerciseDef): string {
    const collapsed = store.isCollapsed(ex.id);
    const rows = store.rows(ex.id);
    const last = store.lastTime(ex.id);
    const lastText = last ? last.sets.map((s) => setText(s, ex.unit)).filter(Boolean).join(' · ') : '';
    const fill = rows.filter(filled).length;
    const sum = fill + '/' + rows.length + ' sets' + (last?.sets[0] ? ' · ' + setText(last.sets[last.sets.length - 1]!, ex.unit) : '');

    const grip = '<button type="button" class="grip" data-grip data-ex="' + esc(ex.id) +
      '" aria-label="Reorder ' + esc(ex.title) + '" title="Drag to reorder">' + GRIP_ICON + '</button>';

    if (collapsed) {
      return (
        '<article class="card collapsed" data-ex="' + esc(ex.id) + '">' +
          '<header class="card-head">' +
            grip +
            '<button class="card-toggle" data-action="collapse" data-ex="' + esc(ex.id) + '" aria-expanded="false">' +
              '<span class="chev"></span>' + esc(ex.title) +
            '</button>' +
          '</header>' +
          '<p class="card-sum">' + esc(sum) + '</p>' +
        '</article>'
      );
    }

    const wl = ex.bw ? '+ kg' : 'kg';
    const rl = ex.unit === 'sec' ? 'sec' : 'reps';
    const body = rows.map((r, i) => setRow(ex, r, i, last)).join('');

    return (
      '<article class="card" data-ex="' + esc(ex.id) + '">' +
        '<header class="card-head">' +
          grip +
          '<button class="card-toggle" data-action="collapse" data-ex="' + esc(ex.id) + '" aria-expanded="true">' +
            '<span class="chev"></span>' + esc(ex.title) +
          '</button>' +
        '</header>' +
        (ex.hint ? '<p class="hint">' + esc(ex.hint) + '</p>' : '') +
        '<p class="meta">Target ' + esc(ex.target || '—') + (ex.suggested ? ' · Start ' + esc(ex.suggested) : '') + '</p>' +
        (last ? '<p class="meta last">Last time (' + esc(fmtDate(last.date)) + '): ' + esc(lastText) + '</p>' : '') +
        '<div class="sets">' +
          '<div class="setrow head"><span></span><span>' + wl + '</span><span>' + rl + '</span><span></span></div>' +
          body +
        '</div>' +
        '<div class="card-actions">' +
          '<button class="btn add" data-action="add-set" data-ex="' + esc(ex.id) + '" aria-label="Add set">+</button>' +
          (last ? '<button class="btn ghost" data-action="copy-last" data-ex="' + esc(ex.id) + '">Copy last time</button>' : '') +
        '</div>' +
      '</article>'
    );
  }

  function setRow(
    ex: ExerciseDef,
    r: DraftSet,
    i: number,
    last: ReturnType<Store['lastTime']>,
  ): string {
    const ph = last ? last.sets[i] ?? last.sets[last.sets.length - 1] : null;
    const pk = ph?.kg != null ? fmtNum(ph.kg) : '';
    const pr = ph?.reps != null ? fmtNum(ph.reps) : '';
    const label = ex.title + ', set ' + (i + 1);
    return (
      '<div class="setrow">' +
        '<button class="done' + (r.done ? ' on' : '') + '" data-action="done" data-ex="' + esc(ex.id) + '" data-i="' + i + '"' +
          ' aria-pressed="' + (r.done ? 'true' : 'false') + '" aria-label="' + esc(label) + '">' +
          (r.done ? '✓' : String(i + 1)) +
        '</button>' +
        '<input class="num" inputmode="decimal" autocomplete="off" data-row data-ex="' + esc(ex.id) + '" data-i="' + i + '" data-f="kg"' +
          ' value="' + esc(r.kg) + '" placeholder="' + esc(pk) + '" aria-label="' + esc(label + ' kg') + '">' +
        '<input class="num" inputmode="numeric" autocomplete="off" data-row data-ex="' + esc(ex.id) + '" data-i="' + i + '" data-f="reps"' +
          ' value="' + esc(r.reps) + '" placeholder="' + esc(pr) + '" aria-label="' + esc(label + ' ' + (ex.unit === 'sec' ? 'seconds' : 'reps')) + '">' +
        '<button class="x" data-action="rm-set" data-ex="' + esc(ex.id) + '" data-i="' + i + '" aria-label="Delete set ' + (i + 1) + '">×</button>' +
      '</div>'
    );
  }

  function toastHtml(t: Toast): string {
    return (
      '<div class="toast" role="status">' +
        '<span>' + esc(t.text) + '</span>' +
        (t.label ? '<button class="btn ghost" data-action="toast-action">' + esc(t.label) + '</button>' : '') +
      '</div>'
    );
  }

  function summaryText(ex: number, sets: number): string {
    return sets ? plural(ex, 'exercise') + ' · ' + plural(sets, 'set') : 'Nothing entered yet';
  }

  /* ---------------------------------------------------------- actions */

  function updateSummary(): void {
    const c = store.counts();
    const sum = document.getElementById('summary');
    if (sum) sum.textContent = summaryText(c.ex, c.sets);
    const save = document.getElementById('save') as HTMLButtonElement | null;
    if (save) save.disabled = !c.sets;
  }

  function setBackupMsg(text: string, warn = false): void {
    const el = document.getElementById('backup-msg');
    if (!el) return;
    el.textContent = text;
    el.className = 'tools-msg' + (warn ? ' warn' : '');
  }

  function downloadBackup(): void {
    const backup = store.exportBackup();
    const name = backupName(isoDate());
    try {
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      setBackupMsg('Saved ' + name + ' (' + plural(store.sessions.length, 'session') + ').');
    } catch {
      setBackupMsg('Could not build the file.', true);
    }
  }

  async function importBackupFile(file: File): Promise<void> {
    let text = '';
    try {
      text = await file.text();
    } catch {
      setBackupMsg('Could not read that file.', true);
      return;
    }
    const parsed = parseBackup(text);
    if (!parsed.ok) {
      setBackupMsg(parsed.error, true);
      return;
    }
    const current = store.sessions.length;
    const ok = window.confirm(
      'Replace the log on this device (' + plural(current, 'saved session') + ') with this backup (' +
      plural(parsed.sessions.length, 'saved session') + ')?\n\nThis cannot be undone.',
    );
    if (!ok) {
      setBackupMsg('Restore cancelled.');
      return;
    }
    store.importBackup(parsed.backup);
    setBackupMsg('Restored. Reloading…');
    window.setTimeout(() => location.reload(), 250);
  }

  function setMessage(text: string, warn = false): void {
    const el = document.getElementById('msg');
    if (!el) return;
    el.textContent = text;
    el.className = 'msg' + (warn ? ' warn' : '');
  }

  function save(): void {
    const wasEditing = !!store.editingId;
    const res: BuildResult = store.save();
    if (!res.ok) {
      const fieldErrors = res.errors.filter((e) => e.kind === 'field');
      for (const err of fieldErrors) {
        if (!err.exId || err.row == null || !err.field) continue;
        const sel = '[data-row][data-ex="' + CSS.escape(err.exId) + '"][data-i="' + err.row + '"][data-f="' + err.field + '"]';
        document.querySelector<HTMLInputElement>(sel)?.classList.add('bad');
      }
      document.querySelector<HTMLInputElement>('input.num.bad')?.focus();
      const empty = res.errors[0]?.kind === 'empty';
      setMessage(empty ? 'Enter at least one set first.' : 'Some numbers are not valid. Use digits like 42.5 or 8.', true);
      return;
    }
    const sets = res.session.exercises.reduce((n, e) => n + e.sets.length, 0);
    view = 'history';
    stopRest();
    showToast((wasEditing ? 'Updated: ' : 'Saved: ') + plural(res.session.exercises.length, 'exercise') + ', ' + plural(sets, 'set'));
  }

  function discard(): void {
    if (store.editingId) {
      store.cancelEdit();
      view = 'history';
      stopRest();
      render();
      return;
    }
    const typed = store.counts().sets > 0 || !!store.draft().note.trim();
    if (typed && !window.confirm('Discard this workout?\n\nEverything typed here will be cleared.')) return;
    store.clearDraft();
    view = 'history';
    stopRest();
    render();
  }

  function startWorkout(): void {
    view = 'workout';
    render();
    requestAnimationFrame(() => {
      const first = document.querySelector<HTMLInputElement>('[data-row][data-f="kg"]');
      first?.scrollIntoView({ block: 'center' });
      first?.focus({ preventScroll: true });
    });
  }

  /* ---------------------------------------------------------- events */

  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.dataset.backdrop === 'add') {
      addOpen = false;
      render();
      return;
    }
    const el = target.closest<HTMLElement>('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const exId = el.dataset.ex;
    const index = Number(el.dataset.i);

    switch (action) {
      case 'add-open':
        addOpen = true;
        render();
        requestAnimationFrame(() => {
          document.querySelector<HTMLInputElement>('[data-input="add-search"]')?.focus();
        });
        break;
      case 'add-close':
        addOpen = false;
        render();
        break;
      case 'add-pick': {
        const id = el.dataset.id;
        const meta = id ? catalog.exerciseIndex[id] : undefined;
        if (!meta) break;
        addExercise({
          id: meta.id, title: meta.title, hint: meta.hint, sets: meta.sets,
          target: meta.target, unit: meta.unit, suggested: meta.suggested, bw: meta.bw,
        });
        break;
      }
      case 'add-custom': {
        const name = (document.querySelector<HTMLInputElement>('[data-input="custom-name"]')?.value ?? '').trim();
        const unit = (document.querySelector<HTMLSelectElement>('[data-input="custom-unit"]')?.value === 'sec') ? 'sec' : 'reps';
        if (!name) {
          setAddMessage('Give the exercise a name.', true);
          break;
        }
        addExercise({
          id: customId(), title: name, hint: '', sets: 3, target: '',
          unit, suggested: '', bw: false, custom: true,
        });
        break;
      }
      case 'nav': {
        const nav = el.dataset.nav;
        if (!nav) break;
        if (store.editingId) {
          showToast('Finish or cancel the edit first.');
          break;
        }
        view = nav === 'log' ? 'history' : nav === 'train' ? 'train' : 'eat';
        render();
        break;
      }
      case 'tab': {
        const next = el.dataset.view as View | undefined;
        if (!next) break;
        if (store.editingId) {
          showToast('Finish or cancel the edit first.');
          break;
        }
        view = next;
        render();
        break;
      }
      case 'start':
        startWorkout();
        break;
      case 'discard':
        discard();
        break;
      case 'save':
        save();
        break;
      case 'done': {
        if (!exId) break;
        const nowDone = store.toggleDone(exId, index);
        if (nowDone) startRest(exId);
        render();
        break;
      }
      case 'add-set':
        if (exId) store.addSet(exId);
        break;
      case 'rm-set':
        if (exId) store.removeSet(exId, index);
        break;
      case 'copy-last':
        if (exId) store.copyLast(exId);
        break;
      case 'collapse':
        if (exId) store.toggleCollapse(exId);
        break;
      case 'edit': {
        const id = el.dataset.id;
        if (id && store.startEdit(id)) {
          view = 'workout';
          render();
          requestAnimationFrame(() => {
            const first = document.querySelector<HTMLInputElement>('[data-row][data-f="kg"]');
            first?.scrollIntoView({ block: 'center' });
          });
        }
        break;
      }
      case 'delete': {
        const id = el.dataset.id;
        if (!id) break;
        store.remove(id);
        showToast('Session deleted', 'Undo', () => store.undoRemove());
        break;
      }
      case 'cancel-edit':
        store.cancelEdit();
        view = 'history';
        render();
        break;
      case 'rest-add':
        if (rest.end) { rest.end += 30000; tickRest(); }
        break;
      case 'rest-skip':
        stopRest();
        render();
        break;
      case 'backup-export':
        downloadBackup();
        break;
      case 'backup-import':
        document.querySelector<HTMLInputElement>('[data-input="backup-file"]')?.click();
        break;
      case 'toast-action': {
        const t = toast;
        dismissToast();
        t?.run?.();
        toast = null;
        render();
        break;
      }
    }
  });

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && addOpen) {
      addOpen = false;
      render();
      return;
    }
    const grip = (e.target as HTMLElement).closest<HTMLElement>('[data-grip]');
    if (!grip) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const id = grip.dataset.ex;
    if (!id) return;
    e.preventDefault();
    const list = store.exercises();
    const from = list.findIndex((x) => x.id === id);
    const to = from + (e.key === 'ArrowUp' ? -1 : 1);
    if (from < 0 || to < 0 || to >= list.length) return;
    store.moveExercise(from, to);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-grip][data-ex="' + CSS.escape(id) + '"]')?.focus();
    });
  });

  root.addEventListener('pointerdown', (e) => {
    const grip = (e.target as HTMLElement).closest<HTMLElement>('[data-grip]');
    if (!grip) return;
    const card = grip.closest<HTMLElement>('.card');
    if (!card || !card.dataset.ex) return;
    e.preventDefault();

    const cards = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('.cards .card'));
    const start = cards().map((c) => c.dataset.ex ?? '').join('|');
    card.classList.add('dragging');
    document.body.classList.add('is-dragging');

    const move = (ev: PointerEvent): void => {
      ev.preventDefault();
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const over = under instanceof Element ? under.closest<HTMLElement>('.card') : null;
      if (over && over !== card && over.parentElement) {
        const rect = over.getBoundingClientRect();
        const after = ev.clientY > rect.top + rect.height / 2;
        over.parentElement.insertBefore(card, after ? over.nextSibling : over);
      }
      if (ev.clientY < 90) window.scrollBy(0, -10);
      else if (ev.clientY > window.innerHeight - 90) window.scrollBy(0, 10);
    };

    const done = (): void => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', done);
      document.removeEventListener('pointercancel', done);
      card.classList.remove('dragging');
      document.body.classList.remove('is-dragging');
      const ids = cards().map((c) => c.dataset.ex ?? '').filter(Boolean);
      if (ids.join('|') !== start) store.reorderExercises(ids);
    };

    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', done, { once: true });
    document.addEventListener('pointercancel', done, { once: true });
  });

  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement | HTMLTextAreaElement;
    if (t.matches('[data-input="add-search"]')) {
      const q = t.value.trim().toLowerCase();
      document.querySelectorAll<HTMLElement>('#add-list [data-title]').forEach((li) => {
        li.hidden = !!q && !(li.dataset.title ?? '').includes(q);
      });
      return;
    }
    if (t.matches('[data-row]')) {
      const exId = t.dataset.ex;
      if (!exId) return;
      const field = t.dataset.f === 'reps' ? 'reps' : 'kg';
      t.classList.remove('bad');
      store.setRow(exId, Number(t.dataset.i), field, t.value);
      updateSummary();
      return;
    }
    if (t.matches('[data-input="note"]')) {
      store.setNote(t.value);
    }
  });

  root.addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement | HTMLInputElement;
    if (t.matches('[data-select="program"]')) store.setProgram(t.value);
    else if (t.matches('[data-select="session"]')) store.setSession(t.value);
    else if (t.matches('[data-input="date"]')) store.setDate(t.value || isoDate());
    else if (t.matches('[data-select="progress"]')) {
      const series = buildSeries(store.sessions).find((s) => s.key === t.value);
      if (series) store.setProgress(series.key, series.id);
    }
    else if (t.matches('[data-select="train-program"]')) {
      trainProgramId = t.value;
      render();
    }
    else if (t.matches('[data-input="backup-file"]')) {
      const file = (t as HTMLInputElement).files?.[0];
      if (file) void importBackupFile(file);
    }
  });

  store.subscribe(render);
  render();
}
