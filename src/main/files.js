// Project files: the list for @-mentions in the composer (git when available, so .gitignore is respected,
// otherwise a walk that skips the usual heavy directories), and reading one for the Changes panel.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const LIMIT = 20000;
const MAX_DIRS = 4000; // a walk of a huge non-git folder (a home folder, a drive) stops here...
const WALK_BUDGET = 1500; // ...or after this many ms
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.venv', 'venv', '__pycache__', 'target', '.idea', '.vscode', 'AppData', 'Library']);
const cache = new Map(); // cwd -> { at, files }

function gitFiles(cwd) {
  return new Promise((resolve) => {
    // -z: names are NUL-separated and never quoted, so non-ASCII file names come through as they are.
    execFile('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd, maxBuffer: 64 << 20, timeout: 8000, windowsHide: true },
      (err, stdout) => resolve(err ? null : stdout.split('\0').filter(Boolean).slice(0, LIMIT)));
  });
}

// Asynchronous and bounded, so a big folder never stalls the app.
async function walk(cwd) {
  const out = [];
  const stack = [''];
  const end = Date.now() + WALK_BUDGET;
  let dirs = 0;
  while (stack.length && out.length < LIMIT && dirs < MAX_DIRS && Date.now() < end) {
    const rel = stack.pop();
    dirs++;
    let entries;
    try { entries = await fs.promises.readdir(path.join(cwd, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith('.')) stack.push(child); }
      else if (e.isFile()) out.push(child);
    }
  }
  return out;
}

async function listFiles(cwd) {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < 20000) return hit.files;
  const files = (await gitFiles(cwd)) || (await walk(cwd));
  cache.set(cwd, { at: Date.now(), files });
  return files;
}

const READ_MAX = 2 * 1024 * 1024;

// `to` is `root` or inside it (both real, absolute paths).
function inside(root, to) {
  const rel = path.relative(root, to);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

// The text of a file inside the project folder `cwd`: { ok, text, size } or { ok: false, reason } with reason
// 'outside' (not in the folder, also through a link), 'missing', 'too-big' or 'binary'.
async function readProjectFile(cwd, file) {
  if (typeof cwd !== 'string' || typeof file !== 'string' || !cwd || !file) return { ok: false, reason: 'missing' };
  let root;
  let real;
  try {
    root = await fs.promises.realpath(path.resolve(cwd));
    const full = path.resolve(root, file);
    if (!inside(root, full)) return { ok: false, reason: 'outside' };
    real = await fs.promises.realpath(full);
  } catch {
    return { ok: false, reason: 'missing' };
  }
  if (!inside(root, real)) return { ok: false, reason: 'outside' };
  const stat = await fs.promises.stat(real).catch(() => null);
  if (!stat?.isFile()) return { ok: false, reason: 'missing' };
  if (stat.size > READ_MAX) return { ok: false, reason: 'too-big', size: stat.size };
  const data = await fs.promises.readFile(real);
  if (data.subarray(0, 8000).includes(0)) return { ok: false, reason: 'binary', size: stat.size };
  return { ok: true, text: data.toString('utf8'), size: stat.size };
}

module.exports = { listFiles, readProjectFile };
