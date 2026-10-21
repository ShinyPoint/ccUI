// Finds the Claude Code executable: a user-chosen file, or the built-in one. The built-in one is the newer of
// the build shipped with the Agent SDK (only when run from source: installers leave it out, see package.json) and
// the newest one downloaded by claude-update.js, or exactly the version chosen in Settings (claudeVersion).
const fs = require('fs');
const path = require('path');

const isWin = process.platform === 'win32';
const EXE = isWin ? 'claude.exe' : 'claude';
const VERSION = /^\d+\.\d+\.\d+$/;

function isMusl() {
  if (process.platform !== 'linux') return false;
  try {
    return !process.report.getReport().header.glibcVersionRuntime;
  } catch {
    return false;
  }
}

// The npm package holding the executable for this computer.
const platformPackage = () => `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${isMusl() ? '-musl' : ''}`;

// -1, 0 or 1, like a sort comparator, for "1.2.3" versions.
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

// The build shipped with the app: { file, version } (the Claude Code version, from the SDK's package.json).
function shipped() {
  try {
    const dir = path.dirname(require.resolve(`${platformPackage()}/package.json`));
    // Executables cannot run from inside app.asar; electron-builder unpacks them next to it.
    const file = path.join(dir, EXE).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    if (!fs.existsSync(file)) return null;
    let version = null;
    try {
      // The SDK's own package.json is not exported, so it is read from next to the platform package.
      version = JSON.parse(fs.readFileSync(path.join(dir, '..', 'claude-agent-sdk', 'package.json'), 'utf8')).claudeCodeVersion || null;
    } catch { /* unknown: any download is used instead */ }
    return { file, version };
  } catch {
    return null;
  }
}

let downloadsDir = null;
// Where claude-update.js puts downloaded builds: <dir>/<version>/claude(.exe). Set once at startup.
function useDownloads(dir) { downloadsDir = dir; }

// The newest downloaded build: { file, version }, or null.
function downloaded(dir = downloadsDir) {
  if (!dir) return null;
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return null; }
  const found = names.filter((n) => VERSION.test(n) && fs.existsSync(path.join(dir, n, EXE)))
    .sort((a, b) => compareVersions(b, a));
  return found.length ? { file: path.join(dir, found[0], EXE), version: found[0] } : null;
}

// The built-in Claude Code: { file, version, downloaded }, or null when there is none yet (it is downloaded
// then, claude-update.js). `pinned`: a version chosen in Settings, used as it is and no other.
function builtIn(pinned = '') {
  const ship = shipped();
  if (VERSION.test(pinned || '')) {
    const file = downloadsDir && path.join(downloadsDir, pinned, EXE);
    if (file && fs.existsSync(file)) return { file, version: pinned, downloaded: true };
    return ship?.version === pinned ? { ...ship, downloaded: false } : null;
  }
  const down = downloaded();
  if (down && (!ship || !ship.version || compareVersions(down.version, ship.version) > 0)) return { ...down, downloaded: true };
  return ship ? { ...ship, downloaded: false } : null;
}

function bundledClaude(pinned = '') {
  return builtIn(pinned)?.file || null;
}

// `custom` is the Settings value: empty for the built-in build, otherwise a path or a command name. `pinned`:
// the version chosen in Settings. With no built-in build yet, `missing` is set: claude-update.js downloads one.
function resolveClaude(custom, pinned = '') {
  const value = (custom || '').trim();
  // A .cmd/.bat (e.g. npm's claude.cmd shim) cannot be started directly; it runs through cmd.exe instead,
  // which only terminal sessions do.
  if (isWin && /\.(cmd|bat)$/i.test(value) && fs.existsSync(value)) return { command: `"${value}"` };
  if (value && fs.existsSync(value) && fs.statSync(value).isFile()) return { file: value };
  if (value) return { command: value }; // e.g. "claude" on PATH; only usable in terminal sessions
  const bundled = bundledClaude(pinned);
  return bundled ? { file: bundled, bundled: true } : { command: 'claude', missing: true };
}

module.exports = { EXE, VERSION, platformPackage, compareVersions, shipped, downloaded, useDownloads, builtIn, bundledClaude, resolveClaude };
