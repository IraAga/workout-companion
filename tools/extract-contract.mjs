#!/usr/bin/env node
/*
 * Extract a portable contract from docs/index.html.
 *
 * docs/index.html stays the single source of truth for the working app. This
 * script reads it and writes everything a different UI needs:
 *
 *   contract/data/catalog.json      programs, sessions, exercises, rest times
 *   contract/data/content/*.json    the static documents, as structured blocks
 *   contract/data/content/index.json
 *   contract/data/app.json          navigation, storage keys, sync constants
 *
 * Usage:
 *   node tools/extract-contract.mjs           # write the files
 *   node tools/extract-contract.mjs --check   # fail if files are out of date
 *
 * No dependencies. Node 18+.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'docs', 'index.html');
const OUT = join(ROOT, 'contract');

const src = readFileSync(SRC, 'utf8');

/* ------------------------------------------------------------------ text */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', times: '\u00d7',
  deg: '\u00b0', euro: '\u20ac', frac12: '\u00bd', frac14: '\u00bc',
  frac34: '\u00be', rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c',
  rdquo: '\u201d', rarr: '\u2192', larr: '\u2190', middot: '\u00b7',
  bull: '\u2022', check: '\u2713', minus: '\u2212',
};

function decode(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : m;
  });
}

function tidy(s) {
  return decode(s).replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------- html tree */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);
const TOKEN = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^>]*?)?)(\/?)>/g;
const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function attrs(str) {
  const out = {};
  ATTR.lastIndex = 0;
  let m;
  while ((m = ATTR.exec(str || ''))) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

function parse(html) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  let last = 0;
  let m;
  TOKEN.lastIndex = 0;

  const pushText = (text) => {
    if (text) stack[stack.length - 1].children.push({ tag: '#text', text });
  };

  while ((m = TOKEN.exec(html))) {
    pushText(html.slice(last, m.index));
    last = m.index + m[0].length;

    if (m[0].startsWith('<!--')) continue;

    if (m[1]) {                                  // closing tag
      const tag = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }

    const tag = m[2].toLowerCase();
    const el = { tag, attrs: attrs(m[3]), children: [] };
    stack[stack.length - 1].children.push(el);

    if (VOID.has(tag) || m[4] === '/') continue;
    if (RAW.has(tag)) {
      const close = new RegExp('</' + tag + '\\s*>', 'i');
      const rest = html.slice(last);
      const found = close.exec(rest);
      if (found) {
        el.children.push({ tag: '#text', text: rest.slice(0, found.index) });
        last += found.index + found[0].length;
        TOKEN.lastIndex = last;
      }
      continue;
    }
    stack.push(el);
  }
  pushText(html.slice(last));
  return root;
}

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function serialize(node) {
  if (node.tag === '#text') return escText(node.text);
  if (node.tag === '#root') return node.children.map(serialize).join('');
  const a = Object.entries(node.attrs || {})
    .map(([k, v]) => (v === '' ? ' ' + k : ' ' + k + '="' + escAttr(v) + '"'))
    .join('');
  if (VOID.has(node.tag)) return '<' + node.tag + a + '>';
  return '<' + node.tag + a + '>' + node.children.map(serialize).join('') + '</' + node.tag + '>';
}

function textOf(node) {
  if (node.tag === '#text') return decode(node.text);
  if (node.tag === 'br') return ' ';
  return node.children.map(textOf).join('');
}

const el = (node) => node.tag !== '#text';
const cls = (node) => (node.attrs && node.attrs.class) || '';
const hasCls = (node, name) => cls(node).split(/\s+/).includes(name);
const kids = (node) => node.children.filter(el);
const find = (node, pred) => {
  const out = [];
  const walk = (n) => {
    if (n.tag !== '#text' && pred(n)) out.push(n);
    (n.children || []).forEach(walk);
  };
  walk(node);
  return out;
};
const first = (node, pred) => find(node, pred)[0] || null;

function tableOf(t) {
  const head = first(t, (n) => n.tag === 'thead');
  const body = first(t, (n) => n.tag === 'tbody');
  const headerRow = head && first(head, (n) => n.tag === 'tr');
  const headers = headerRow
    ? kids(headerRow).filter((n) => n.tag === 'th' || n.tag === 'td').map((n) => tidy(textOf(n)))
    : [];
  const rows = [];
  const scope = body || t;
  kids(scope).filter((n) => n.tag === 'tr').forEach((tr) => {
    const cells = kids(tr).filter((n) => n.tag === 'td' || n.tag === 'th').map((n) => tidy(textOf(n)));
    if (cells.length) rows.push(cells);
  });
  return { type: 'table', headers, rows, class: cls(t) || undefined, html: serialize(t) };
}

function listOf(node) {
  const ordered = node.tag === 'ol';
  const items = kids(node).filter((n) => n.tag === 'li').map((li) => {
    const day = first(li, (n) => hasCls(n, 'day'));
    if (day) {
      const get = (name) => {
        const e = first(day, (n) => hasCls(n, name));
        return e ? tidy(textOf(e)) : '';
      };
      const kind = ['lift', 'ball', 'rest'].find((k) => hasCls(day, k)) || '';
      return { weekday: get('dname'), label: get('tag'), detail: get('what'), kind };
    }
    const iname = first(li, (n) => hasCls(n, 'iname'));
    if (iname) {
      const idesc = first(li, (n) => hasCls(n, 'idesc'));
      const link = first(li, (n) => n.tag === 'a');
      return {
        name: tidy(textOf(iname)),
        description: idesc ? tidy(textOf(idesc)) : '',
        href: link ? link.attrs.href : undefined,
      };
    }
    const strong = first(li, (n) => n.tag === 'strong');
    return {
      text: tidy(textOf(li)),
      lead: strong ? tidy(textOf(strong)) : undefined,
      html: serialize(li),
    };
  });
  const kind = hasCls(node, 'week') ? 'week' : hasCls(node, 'index') ? 'index' : 'list';
  return { type: kind, ordered: ordered || undefined, items };
}

function mealOf(article) {
  const title = first(article, (n) => /^h[1-6]$/.test(n.tag));
  const table = first(article, (n) => n.tag === 'table');
  const macro = first(article, (n) => hasCls(n, 'macro') || hasCls(n, 'meta'));
  const body = kids(article)
    .filter((n) => n !== title && n !== macro && !(n.tag === 'div' && hasCls(n, 'tw')))
    .map((n) => tidy(textOf(n)))
    .filter(Boolean);
  return {
    type: 'meal',
    title: title ? tidy(textOf(title)) : '',
    ingredients: table ? tableOf(table) : undefined,
    note: body.length ? body.join(' ') : undefined,
    macro: macro ? tidy(textOf(macro)) : undefined,
    html: serialize(article),
  };
}

/* Text a block renders, without counting nested blocks twice. Used to prove
   nothing was lost when the panel was normalised. */
function ownText(block) {
  const parts = [];
  const add = (v) => { if (typeof v === 'string' && v) parts.push(v); };
  const strip = (h) => tidy(String(h || '').replace(/<[^>]*>/g, ' '));

  switch (block.type) {
    case 'group':
    case 'section':
      return (block.blocks || []).map(ownText).join(' ');
    case 'meal-grid':
      return (block.meals || []).map(ownText).join(' ');
    case 'meal':
      add(block.title); add(block.note); add(block.macro);
      if (block.ingredients) add(ownText(block.ingredients));
      return parts.join(' ');
    case 'table':
      return [...(block.headers || []), ...((block.rows || []).flat())].join(' ');
    case 'list':
    case 'week':
    case 'index':
      return (block.items || []).map((it) => [it.text, it.weekday, it.label, it.detail, it.name, it.description].filter(Boolean).join(' ')).join(' ');
    case 'subtabs':
      return (block.tabs || []).map((t) => t.label).join(' ');
    case 'widget':
      return block.initialText || '';
    case 'divider':
      return '';
    case 'html':
    case 'details':
      return strip(block.html);
    default:
      add(block.text);
      return parts.join(' ');
  }
}

function blocksOf(children) {
  const out = [];
  children.forEach((node) => {
    if (!el(node)) {
      const t = tidy(node.text);
      if (t) out.push({ type: 'text', text: t });
      return;
    }

    const c = cls(node);
    const push = (b) => out.push(b);

    if (/^h[1-6]$/.test(node.tag)) {
      push({ type: 'heading', level: Number(node.tag[1]), text: tidy(textOf(node)) });
      return;
    }

    if (hasCls(node, 'kicker')) { push({ type: 'kicker', text: tidy(textOf(node)) }); return; }
    if (node.tag === 'p') {
      const type = hasCls(node, 'meta') ? 'meta' : hasCls(node, 'macro') ? 'macro' : hasCls(node, 'hint') ? 'hint' : 'paragraph';
      push({ type, text: tidy(textOf(node)), html: serialize(node) });
      return;
    }

    if (node.tag === 'ul' || node.tag === 'ol') { push(listOf(node)); return; }

    if (node.tag === 'table') { push(tableOf(node)); return; }

    if (hasCls(node, 'tw')) {
      const t = first(node, (n) => n.tag === 'table');
      if (t) { push(tableOf(t)); return; }
    }

    if (hasCls(node, 'meal-grid')) {
      const meals = kids(node).filter((n) => n.tag === 'article' || hasCls(n, 'meal')).map(mealOf);
      push({ type: 'meal-grid', meals, html: serialize(node) });
      return;
    }

    if (hasCls(node, 'meal')) {
      push({ type: 'meal', ...mealOf(node) });
      return;
    }

    if (hasCls(node, 'subtabs')) {
      const tabs = kids(node)
        .filter((n) => n.tag === 'button' || n.tag === 'a')
        .map((n) => ({ id: n.attrs['data-sub'] || '', label: tidy(textOf(n)) }));
      push({ type: 'subtabs', tabs });
      return;
    }

    if (hasCls(node, 'sub')) {
      push({ type: 'section', id: node.attrs.id, key: node.attrs['data-sub'] || '', blocks: blocksOf(kids(node)) });
      return;
    }

    if (hasCls(node, 'week-status')) {
      const text = first(node, (n) => n.attrs && n.attrs.id === 'week-status-text');
      push({
        type: 'widget',
        name: 'week-status',
        initialText: text ? tidy(textOf(text)) : '',
        description: 'Live count of lift sessions logged in the current Monday-Sunday week.',
      });
      return;
    }

    if (node.tag === 'details') {
      const summary = first(node, (n) => n.tag === 'summary');
      push({
        type: 'details',
        summary: summary ? tidy(textOf(summary)) : '',
        id: node.attrs.id || undefined,
        html: serialize(node),
      });
      return;
    }

    if (node.tag === 'hr') { push({ type: 'divider' }); return; }

    if (['div', 'section', 'article', 'header', 'footer', 'aside', 'main', 'form', 'fieldset', 'dl'].includes(node.tag) && !c) {
      const inner = blocksOf(kids(node));
      if (inner.length) { inner.forEach(push); return; }
    }

    if (['div', 'section', 'article', 'header', 'footer', 'aside', 'main', 'form', 'fieldset', 'dl', 'span'].includes(node.tag)) {
      const inner = blocksOf(kids(node));
      if (inner.length === 1 && inner[0].type === 'table') { push(inner[0]); return; }
      if (inner.length) { push({ type: 'group', class: c || undefined, blocks: inner, html: serialize(node) }); return; }
    }

    const t = tidy(textOf(node));
    if (t || node.tag === 'input' || node.tag === 'button') {
      push({ type: 'html', tag: node.tag, text: t || undefined, html: serialize(node) });
    }
  });
  return out;
}

/* --------------------------------------------------------- source pieces */

function section(startRe, endRe, what) {
  const s = src.search(startRe);
  if (s < 0) throw new Error('Could not find ' + what + ' start');
  const rest = src.slice(s);
  const e = rest.search(endRe);
  if (e < 0) throw new Error('Could not find ' + what + ' end');
  return rest.slice(0, e + rest.match(endRe)[0].length);
}

function extractCatalog() {
  const m = /^[ \t]*var CATALOG = (\[.*\]);$/m.exec(src);
  if (!m) throw new Error('CATALOG not found');
  return JSON.parse(m[1]);
}

function extractRest() {
  const body = section(/var REST = \{/, /\n[ \t]*\};/, 'REST');
  const out = {};
  const re = /'([^']+)'\s*:\s*(\d+)/g;
  let m;
  while ((m = re.exec(body))) out[m[1]] = Number(m[2]);
  return out;
}

function extractPanels() {
  const re = /<section class="doc" data-panel="([^"]+)"([^>]*)>([\s\S]*?)<\/section>/g;
  const out = [];
  let m;
  while ((m = re.exec(src))) {
    out.push({ id: m[1], attrs: attrs(m[2]), html: m[3] });
  }
  if (!out.length) throw new Error('No panels found');
  return out;
}

function extractNav() {
  const body = section(/<nav aria-label="Documents">/, /<\/nav>/, 'nav');
  const groups = [];
  const gre = /<div class="grp">([\s\S]*?)<\/div>/g;
  let gm;
  while ((gm = gre.exec(body))) {
    const label = /<span class="glabel">([\s\S]*?)<\/span>/.exec(gm[1]);
    const links = [];
    const lre = /<a href="#([^"]+)" data-tab="([^"]+)">([\s\S]*?)<\/a>/g;
    let lm;
    while ((lm = lre.exec(gm[1]))) {
      links.push({ tab: lm[2], hash: lm[1], label: tidy(lm[3]) });
    }
    if (links.length) groups.push({ label: label ? tidy(label[1]) : '', links });
  }
  return groups;
}

/* ------------------------------------------------------------- assemble */

const CATALOG = extractCatalog();
const REST = extractRest();
const NAV = extractNav();
const PANELS = extractPanels();

const exerciseIndex = {};
CATALOG.forEach((p) => p.sessions.forEach((s) => s.exercises.forEach((e) => {
  if (!exerciseIndex[e.id]) {
    exerciseIndex[e.id] = { ...e, programs: [], restSeconds: REST[e.id] || 90 };
  }
  if (!exerciseIndex[e.id].programs.includes(p.id)) exerciseIndex[e.id].programs.push(p.id);
})));

const catalog = {
  source: 'docs/index.html',
  description: 'Exercise catalog. A suggestion, not a constraint: the app stores per-session overrides in ol-plan.',
  exerciseIdPattern: 'catalog slugs, or "x" + base36 timestamp + 3 random chars for custom exercises',
  units: ['reps', 'sec'],
  restFallbackSeconds: 90,
  programs: CATALOG,
  exerciseIndex,
};

/* Structural assertions: cheap, and they catch a half-edited catalog early. */
function validate() {
  const problems = [];
  const programIds = new Set();
  const sessionIds = new Set();

  CATALOG.forEach((p) => {
    if (!p.id || !p.label) problems.push('program without id/label');
    if (programIds.has(p.id)) problems.push('duplicate program id: ' + p.id);
    programIds.add(p.id);
    if (!Array.isArray(p.sessions) || !p.sessions.length) problems.push('program ' + p.id + ' has no sessions');

    (p.sessions || []).forEach((s) => {
      if (!s.id || !s.label) problems.push('session without id/label in ' + p.id);
      const key = p.id + '/' + s.id;
      if (sessionIds.has(key)) problems.push('duplicate session key: ' + key);
      sessionIds.add(key);
      if (!Array.isArray(s.exercises) || !s.exercises.length) problems.push('session ' + key + ' has no exercises');

      (s.exercises || []).forEach((e) => {
        if (!e.id || !e.title) problems.push('exercise without id/title in ' + key);
        if (!['reps', 'sec'].includes(e.unit)) problems.push('bad unit on ' + key + '/' + e.id);
        if (!Number.isInteger(e.sets) || e.sets < 1) problems.push('bad sets on ' + key + '/' + e.id);
        if (!REST[e.id]) problems.push('no rest time for ' + e.id);
      });
    });
  });

  Object.keys(REST).forEach((id) => {
    if (!exerciseIndex[id]) problems.push('rest time for unknown exercise: ' + id);
  });

  const navTabs = NAV.flatMap((g) => g.links.map((l) => l.tab));
  const panelIds = PANELS.map((p) => p.id);
  navTabs.forEach((t, i) => {
    if (navTabs.indexOf(t) !== i) problems.push('duplicate nav tab: ' + t);
    if (!panelIds.includes(t)) problems.push('nav tab without panel: ' + t);
  });
  panelIds.forEach((id) => {
    if (!navTabs.includes(id)) problems.push('panel without nav link: ' + id);
  });

  if (problems.length) {
    throw new Error('Catalog/content integrity failed:\n  ' + problems.join('\n  '));
  }
}
validate();

const counts = {
  programs: CATALOG.length,
  sessions: CATALOG.reduce((n, p) => n + p.sessions.length, 0),
  exerciseSlots: CATALOG.reduce((n, p) => n + p.sessions.reduce((m, s) => m + s.exercises.length, 0), 0),
  exercises: Object.keys(exerciseIndex).length,
  panels: PANELS.length,
  navGroups: NAV.length,
};

const contentIndex = [];
const panelFiles = [];

PANELS.forEach((panel, order) => {
  const tree = parse(panel.html);
  const blocks = blocksOf(kids(tree));
  const kicker = blocks.find((b) => b.type === 'kicker');
  const title = blocks.find((b) => b.type === 'heading' && b.level === 1);
  const subtabs = blocks.find((b) => b.type === 'subtabs');
  const navLink = NAV.flatMap((g) => g.links).find((l) => l.tab === panel.id);
  const group = NAV.find((g) => g.links.some((l) => l.tab === panel.id));

  const doc = {
    id: panel.id,
    order,
    navLabel: navLink ? navLink.label : panel.id,
    group: group ? group.label : '',
    kicker: kicker ? kicker.text : '',
    title: title ? title.text : '',
    dynamic: blocks.some((b) => b.type === 'widget' || b.type === 'html') || panel.id === 'log' ? true : undefined,
    subtabs: subtabs ? subtabs.tabs : undefined,
    blocks,
    sourceHtml: panel.html.trim(),
  };
  panelFiles.push({ id: panel.id, doc });

  const rich = blocks.map(ownText).join(' ');
  const flat = tidy(panel.html.replace(/<[^>]*>/g, ' '));
  const words = (s) => new Set(s.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const srcWords = words(flat);
  const outWords = words(rich);
  const kept = [...srcWords].filter((w) => outWords.has(w)).length;
  const fidelity = srcWords.size ? kept / srcWords.size : 1;
  if (fidelity < 0.999) {
    const missing = [...srcWords].filter((w) => !outWords.has(w)).slice(0, 12);
    throw new Error('Panel "' + panel.id + '" lost text: ' + missing.join(', '));
  }

  contentIndex.push({
    id: doc.id,
    order: doc.order,
    group: doc.group,
    navLabel: doc.navLabel,
    kicker: doc.kicker,
    title: doc.title,
    dynamic: doc.dynamic || false,
    subtabs: doc.subtabs || [],
    blockTypes: blocks.map((b) => b.type),
    textCoverage: Number(fidelity.toFixed(4)),
    file: 'content/' + doc.id + '.json',
  });
});

const app = {
  name: 'Off-Season Plan',
  source: 'docs/index.html',
  purpose: 'Off-season basketball training plan, workout log and nutrition baseline. Offline-first PWA.',
  schemaVersion: 1,
  counts,
  nav: NAV,
  panels: contentIndex.map((p) => ({ id: p.id, label: p.navLabel, group: p.group, file: p.file })),
  storage: {
    prefix: 'ol-',
    keys: {
      'ol-sessions': {
        type: 'array<LogSession>',
        description: 'Saved workout sessions. The only key that holds user work; synced to GitHub.',
        schema: 'schema/log-session.schema.json',
      },
      'ol-drafts': {
        type: 'object',
        description: 'Unfinished entry per program/session, keyed "program/session". Values are strings, not numbers.',
        schema: 'schema/drafts.schema.json',
      },
      'ol-plan': {
        type: 'object',
        description: 'Per program/session exercise overrides, keyed "program/session". Absent key = use catalog.',
        schema: 'schema/plan.schema.json',
      },
      'ol-prefs': {
        type: 'object',
        description: 'Selected program, session and progress chart selection.',
        schema: 'schema/prefs.schema.json',
      },
      'ol-collapse': {
        type: 'object',
        description: 'UI only: exercise ids mapped to true when their log card is collapsed.',
      },
      'ol-tombstones': {
        type: 'object',
        description: 'Deletion markers {sessionId: epochMs} for sync. Pruned after 365 days.',
      },
      'ol-sync': {
        type: 'object',
        description: 'GitHub sync state and token. Device-local; never synced.',
        schema: 'schema/sync.schema.json',
      },
    },
    uiKeys: {
      'op-tab': 'Last visible panel id. Not part of the log.',
    },
  },
  sync: {
    transport: 'GitHub Contents API',
    api: 'https://api.github.com',
    owner: 'IraAga',
    repo: 'workout-companion-data',
    path: 'log.json',
    branch: 'default',
    auth: 'Bearer <fine-grained PAT with Contents read/write>',
    envelope: { schema: 1, app: 'off-season-plan', updatedAt: 'ISO-8601', sessions: 'LogSession[]', deleted: '{id: epochMs}' },
    strategy: 'offline-first, last-write-wins per session id on rev, union of tombstones, retry once on 409/422',
    tombstoneRetentionDays: 365,
  },
  backup: {
    format: 'off-season-plan/backup',
    schema: 1,
    filename: 'workout-log-YYYY-MM-DD.json',
    keys: ['ol-prefs', 'ol-plan', 'ol-drafts', 'ol-sessions'],
    valueEncoding: 'raw JSON strings, restored verbatim',
    restoreMode: 'replace keys listed above; leave ol-sync and ol-tombstones alone',
  },
  rules: {
    defaultProgram: 'gym',
    defaultSessionByWeekday: { 1: 'lift-a', 3: 'lift-b', 5: 'lift-c' },
    defaultSessionFallback: 'lift-a',
    weekLiftSessions: ['lift-a', 'lift-b', 'lift-c'],
    progressSeriesPrefix: 'n|',
    restTimerStepSeconds: 30,
    draftSaveDebounceMs: 300,
    sessionIdPattern: 's<epochMs>',
    customExerciseIdPattern: 'x<base36 epochMs><3 random base36 chars>',
    dateFormat: 'YYYY-MM-DD (local time, never UTC)',
    sort: 'date desc, then ts desc',
  },
};

/* --------------------------------------------------------------- output */

const files = new Map();
files.set('data/catalog.json', catalog);
files.set('data/app.json', app);
files.set('data/content/index.json', { source: 'docs/index.html', panels: contentIndex });
panelFiles.forEach(({ id, doc }) => files.set('data/content/' + id + '.json', doc));

const check = process.argv.includes('--check');
const diffs = [];
let written = 0;

for (const [rel, value] of files) {
  const path = join(OUT, rel);
  const next = JSON.stringify(value, null, 2) + '\n';
  let prev = null;
  try { prev = readFileSync(path, 'utf8'); } catch (e) { prev = null; }

  if (check) {
    if (prev !== next) diffs.push(rel);
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  if (prev !== next) { writeFileSync(path, next); written++; }
}

// Content files whose panel no longer exists.
const contentDir = join(OUT, 'data', 'content');
if (existsSync(contentDir)) {
  for (const name of readdirSync(contentDir)) {
    if (name === 'index.json' || !name.endsWith('.json')) continue;
    const id = name.replace(/\.json$/, '');
    if (!panelFiles.some((p) => p.id === id)) {
      if (check) diffs.push('data/content/' + name + ' (stale)');
      else { rmSync(join(contentDir, name)); written++; }
    }
  }
}

if (check) {
  if (diffs.length) {
    console.error('contract/ is out of date:');
    diffs.forEach((d) => console.error('  ' + d));
    console.error('\nRun: node tools/extract-contract.mjs');
    process.exit(1);
  }
  console.log('contract/ is up to date.');
} else {
  console.log(
    'Wrote ' + files.size + ' files (' + written + ' changed) to contract/ · ' +
    CATALOG.length + ' programs · ' + Object.keys(exerciseIndex).length + ' exercises · ' +
    PANELS.length + ' panels'
  );
}
