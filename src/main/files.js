// Project file list for @-mentions in the composer. Uses git when available (respects .gitignore),
// otherwise walks the folder while skipping the usual heavy directories.
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

module.exports = { listFiles };
