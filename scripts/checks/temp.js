// Throwaway folders for a check (its profile, its project), removed when the check's process exits. Each profile
// holds Chromium's caches, and a few hundred runs left behind once filled a disk. A file the window's helper
// processes still hold can keep one from going: folders like these older than an hour go the next time a check
// starts.
const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFIX = 'ccui-';
const made = [];

function remove(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* still in use */ }
}

for (const name of fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(PREFIX))) {
  const dir = path.join(os.tmpdir(), name);
  try {
    if (Date.now() - fs.statSync(dir).mtimeMs > 60 * 60 * 1000) remove(dir);
  } catch { /* gone already */ }
}

// A new empty folder in the system's temp folder, named `ccui-<name>-XXXXXX`.
function tempDir(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${PREFIX}${name}-`));
  made.push(dir);
  return dir;
}

process.on('exit', () => made.forEach(remove));

module.exports = { tempDir };
