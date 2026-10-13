// Finds the Claude Code executable: a user-chosen file, or the one bundled with the Agent SDK.
const fs = require('fs');
const path = require('path');

const isWin = process.platform === 'win32';

function isMusl() {
  if (process.platform !== 'linux') return false;
  try {
    return !process.report.getReport().header.glibcVersionRuntime;
  } catch {
    return false;
  }
}

function bundledClaude() {
  const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${isMusl() ? '-musl' : ''}`;
  try {
    const dir = path.dirname(require.resolve(`${pkg}/package.json`));
    // Executables cannot run from inside app.asar; electron-builder unpacks them next to it.
    const file = path.join(dir, isWin ? 'claude.exe' : 'claude')
      .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    return fs.existsSync(file) ? file : null;
  } catch {
    return null;
  }
}

// `custom` is the Settings value: empty for the bundled build, otherwise a path or a command name.
function resolveClaude(custom) {
  const value = (custom || '').trim();
  // A .cmd/.bat (e.g. npm's claude.cmd shim) cannot be started directly; it runs through cmd.exe instead,
  // which only terminal sessions do.
  if (isWin && /\.(cmd|bat)$/i.test(value) && fs.existsSync(value)) return { command: `"${value}"` };
  if (value && fs.existsSync(value) && fs.statSync(value).isFile()) return { file: value };
  if (value) return { command: value }; // e.g. "claude" on PATH; only usable in terminal sessions
  const bundled = bundledClaude();
  return bundled ? { file: bundled, bundled: true } : { command: 'claude' };
}

module.exports = { bundledClaude, resolveClaude };
