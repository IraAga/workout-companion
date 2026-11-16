#!/usr/bin/env node
/*
 * Keep the template catalogue honest.
 *
 *   node tools/check-templates.mjs
 *
 * Checks that templates/templates.json only refers to things that exist:
 * rule ids in SPEC.md, storage keys in data/app.json, preview files on disk,
 * and a matching <title> inside each SVG. Exits non-zero on any mismatch.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIR = join(ROOT, 'contract', 'templates');

const read = (p) => readFileSync(p, 'utf8');
const catalog = JSON.parse(read(join(DIR, 'templates.json')));
const spec = read(join(ROOT, 'contract', 'SPEC.md'));
const app = JSON.parse(read(join(ROOT, 'contract', 'data', 'app.json')));

const specRules = new Set([...spec.matchAll(/^### R(\d+)\b/gm)].map((m) => 'R' + m[1]));
const storageKeys = new Set(Object.keys(app.storage.keys));
const problems = [];
const seen = new Set();

if (!catalog.templates?.length) problems.push('no templates listed');

for (const t of catalog.templates || []) {
  const where = t.id || '(missing id)';
  if (!t.id || !t.name) problems.push(where + ': id and name are required');
  if (seen.has(t.id)) problems.push(where + ': duplicate id');
  seen.add(t.id);

  if (!['low', 'medium', 'high'].includes(t.buildEffort)) {
    problems.push(where + ': buildEffort must be low, medium or high');
  }
  for (const [k, v] of Object.entries(t.scores || {})) {
    if (!Number.isInteger(v) || v < 1 || v > 5) problems.push(where + ': score ' + k + ' must be 1-5');
  }

  for (const r of t.requires?.rules || []) {
    if (!specRules.has(r)) problems.push(where + ': unknown rule ' + r);
  }
  for (const k of t.requires?.keys || []) {
    if (!storageKeys.has(k)) problems.push(where + ': unknown storage key ' + k);
  }

  if (!t.preview) { problems.push(where + ': no preview'); continue; }
  const files = new Set();
  ["previewStates", "reference"].forEach((key) => {
    (t[key] || []).forEach((st) => {
      if (!st.state || !st.file) problems.push(where + ': ' + key + ' entries need state and file');
      else files.add(st.file);
    });
  });
  files.add(t.preview);

  for (const name of files) {
    const file = join(DIR, name);
    if (!existsSync(file)) { problems.push(where + ': missing ' + name); continue; }
    const svg = read(file);
    const title = (/<title[^>]*>([^<]+)<\/title>/.exec(svg) || [])[1] || '';
    if (!title.includes(t.name)) {
      problems.push(where + ': ' + name + ' title "' + title + '" does not contain "' + t.name + '"');
    }
    if (!/<desc[^>]*>/.test(svg)) problems.push(where + ': ' + name + ' has no <desc>');
  }
}

const rec = catalog.recommendation || {};
for (const id of [rec.base, ...(rec.add || []), ...(rec.defer || [])].filter(Boolean)) {
  if (!seen.has(id)) problems.push('recommendation mentions unknown template ' + id);
}

for (const c of catalog.sharedComponents || []) {
  for (const r of c.rules || []) {
    if (!specRules.has(r)) problems.push('shared component "' + c.component + '": unknown rule ' + r);
  }
}

if (problems.length) {
  console.error('Template check failed:');
  problems.forEach((p) => console.error('  ' + p));
  process.exit(1);
}

const ruleIds = [...specRules].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
console.log(
  'templates ok · ' + catalog.templates.length + ' templates · ' +
  specRules.size + ' rules (' + ruleIds[0] + '\u2013' + ruleIds[ruleIds.length - 1] + ') · ' +
  storageKeys.size + ' storage keys'
);
