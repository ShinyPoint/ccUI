// Folder trust for chat sessions. A project's .claude settings can run commands (hooks, apiKeyHelper) and
// set environment variables as soon as Claude Code starts there. The interactive CLI asks "Do you trust the
// files in this folder?" first; Agent SDK sessions do not, so the app asks instead, once per folder.
// A folder counts as trusted when the user trusted it (or a folder above it) here or in Claude Code itself.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { dialog } = require('electron');

const isWin = process.platform === 'win32';

// Comparable form of a folder path: absolute, forward slashes, no trailing slash, case-folded on Windows.
function norm(p) {
  let s = path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '');
  if (isWin) s = s.toLowerCase();
  return s || '/';
}

function withAncestors(p) {
  const out = [];
  let dir = path.resolve(p);
  for (;;) {
    out.push(norm(dir));
    const up = path.dirname(dir);
    if (up === dir) return out;
    dir = up;
  }
}

// Folders Claude Code itself was told to trust (~/.claude.json → projects[path].hasTrustDialogAccepted).
function claudeTrusted() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
    return Object.entries(config.projects || {}).filter(([, v]) => v?.hasTrustDialogAccepted).map(([k]) => norm(k));
  } catch {
    return [];
  }
}

function isTrusted(settings, cwd) {
  const trusted = new Set([...(settings.data.trustedFolders || []).map(norm), ...claudeTrusted()]);
  const home = norm(os.homedir());
  // Trusting the home folder (or a drive root) is not taken to cover everything under it.
  return withAncestors(cwd).some((p, i) => trusted.has(p) && (i === 0 || (p !== home && p.split('/').length > 2)));
}

const asking = new Map(); // normalized folder -> pending answer, so two sessions starting together ask once

// Resolves true when the folder may be used for a chat session.
function ensureTrusted(settings, win, cwd) {
  if (isTrusted(settings, cwd)) return Promise.resolve(true);
  const key = norm(cwd);
  if (asking.has(key)) return asking.get(key);
  const answer = dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Trust this folder', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: 'Do you trust the files in this folder?',
    detail: `${cwd}\n\nClaude Code will be able to read, edit and run files here. A project's settings can also run `
      + 'commands as soon as a session starts. Only trust folders you created or whose contents you know.',
  }).then(({ response }) => {
    asking.delete(key);
    if (response !== 0) return false;
    const list = settings.data.trustedFolders || [];
    if (!list.some((p) => norm(p) === key)) settings.setPrivate({ trustedFolders: [...list, path.resolve(cwd)] });
    return true;
  });
  asking.set(key, answer);
  return answer;
}

module.exports = { ensureTrusted, isTrusted };
