// The app's words have their Simplified Chinese: every text the code passes to t(), phrase() or plural()/pluralize()
// is in the dictionary with the same {placeholders}, and the dictionary has nothing the code no longer uses. The same
// for the main process (src/main/i18n.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.join(import.meta.dirname, '..');
const files = (dir, exts) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return ['locales', 'dist', 'node_modules'].includes(e.name) ? [] : files(p, exts);
  return exts.some((x) => e.name.endsWith(x)) ? [p] : [];
});

// A string literal: '…', "…" or `…` without ${}.
const LITERAL = String.raw`'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|\x60((?:[^\x60\\$]|\\.)*)\x60`;
const unescape = (s) => s.replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t' }[c] ?? c));

function keysIn(sources) {
  const keys = new Map(); // key -> first file
  const add = (k, file) => { if (!keys.has(k)) keys.set(k, path.relative(root, file)); };
  for (const file of sources) {
    const code = fs.readFileSync(file, 'utf8');
    for (const m of code.matchAll(new RegExp(String.raw`\b(?:t|phrase)\(\s*(?:${LITERAL})`, 'g'))) add(unescape(m[1] ?? m[2] ?? m[3]), file);
    for (const m of code.matchAll(new RegExp(String.raw`\b(?:plural|pluralize)\([^,()]*(?:\([^()]*\))?[^,()]*,\s*(?:${LITERAL})`, 'g'))) add(`plural:${unescape(m[1] ?? m[2] ?? m[3])}`, file);
  }
  return keys;
}

const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

function compare(label, keys, table) {
  const missing = [...keys].filter(([k]) => !(k in table)).map(([k, f]) => `${f}: ${JSON.stringify(k)}`);
  assert.deepEqual(missing, [], `${label}: texts without a Chinese translation`);
  const unused = Object.keys(table).filter((k) => !keys.has(k));
  assert.deepEqual(unused, [], `${label}: translations nothing uses any more`);
  const mismatched = Object.entries(table).filter(([k, v]) => !k.startsWith('plural:') && holes(k) !== holes(v)).map(([k, v]) => `${k} → ${v}`);
  assert.deepEqual(mismatched, [], `${label}: {placeholders} differ between English and Chinese`);
  const plurals = Object.entries(table).filter(([k, v]) => k.startsWith('plural:') && holes(v) !== 'n').map(([k]) => k);
  assert.deepEqual(plurals, [], `${label}: plural forms need {n}`);
}

test('every text in the window has its Chinese, and the dictionary holds nothing unused', async () => {
  const { default: zh } = await import('../src/renderer/locales/zh-CN/index.js');
  compare('window', keysIn(files(path.join(root, 'src', 'renderer'), ['.js', '.jsx'])), zh);
});

test('every text of the main process has its Chinese', () => {
  const main = path.join(root, 'src', 'main');
  const { ZH } = createRequire(import.meta.url)('../src/main/i18n.js');
  compare('main', keysIn(files(main, ['.js']).filter((f) => !f.endsWith('i18n.js'))), ZH);
});
