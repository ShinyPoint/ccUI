// The bottom Terminal panel: a plain shell per session, started in the session's project folder.
// Created the first time the panel opens, kept running while hidden, ended with the session.
import { api, sessions, activeUid } from './store.js';
import { createTerminal, fitTerminal, panelStack } from './terminal.js';

const panelPtys = new Map(); // pty id -> session

const nextFrames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

function writePanel(s, data) {
  if (s.panel.ptyId) api.pty.write(s.panel.ptyId, data);
}

export function copyFromPanel(s) {
  const { term } = s.panel;
  api.writeClipboard(term.getSelection());
  term.clearSelection();
}

export async function pasteIntoPanel(s) {
  const text = await api.readClipboard();
  if (text) s.panel.term.paste(text);
}

function create(s) {
  const p = s.panel;
  const { term, fit, host } = createTerminal({
    onData: (data) => writePanel(s, data),
    onResize: () => {
      clearTimeout(p.resizeTimer);
      p.resizeTimer = setTimeout(() => {
        if (p.ptyId && p.term) api.pty.resize(p.ptyId, p.term.cols, p.term.rows);
      }, 120);
    },
    onTitle: () => {},
    onContextMenu: () => (p.term.hasSelection() ? copyFromPanel(s) : pasteIntoPanel(s)),
  }, panelStack);
  Object.assign(p, { term, fit, host });
}

async function spawn(s) {
  const p = s.panel;
  p.exited.value = false;
  const res = await api.pty.create({ kind: 'shell', cwd: s.cwd, cols: p.term.cols, rows: p.term.rows });
  if (!res.ok) {
    p.term?.write(`\r\n\x1b[31m${res.error}\x1b[0m\r\n`); // the panel may have been disposed meanwhile
    p.exited.value = true;
    return;
  }
  if (s.removed) {
    api.pty.kill(res.id);
    return;
  }
  p.ptyId = res.id;
  panelPtys.set(res.id, s);
}

api.pty.onData((id, data) => {
  const s = panelPtys.get(id);
  if (s?.panel.term) s.panel.term.write(data);
});

api.pty.onExit((id) => {
  const s = panelPtys.get(id);
  panelPtys.delete(id);
  if (!s) return;
  const p = s.panel;
  p.ptyId = null;
  const next = p.afterExit;
  p.afterExit = null;
  if (next) next();
  else p.exited.value = true;
});

// Show the active session's shell; create and start it on first use.
export async function showPanel(s) {
  for (const x of sessions.value) x.panel.host?.classList.toggle('active', x === s);
  if (!s?.panel.open.value) return;
  await nextFrames(); // the panel is laid out before the shell is sized
  const p = s.panel;
  if (!p.open.value || s.uid !== activeUid.value || s.removed) return;
  if (!p.term) {
    create(s);
    p.host.classList.add('active');
  }
  fitTerminal(p);
  if (!p.ptyId && !p.exited.value && !p.starting) {
    p.starting = spawn(s).finally(() => { p.starting = null; });
    await p.starting;
  }
}

export async function togglePanel(s, force) {
  if (!s) return;
  const open = force ?? !s.panel.open.value;
  s.panel.open.value = open;
  if (open) {
    await showPanel(s);
    s.panel.term?.focus();
  } else if (s.term) {
    s.term.focus();
  } else {
    document.querySelector('.composer-input')?.focus();
  }
}

export function restartPanel(s) {
  const p = s.panel;
  const run = async () => {
    p.term?.reset();
    p.exited.value = false;
    await showPanel(s);
    p.term?.focus();
  };
  if (p.ptyId) {
    p.afterExit = run;
    api.pty.kill(p.ptyId);
  } else run();
}

export function disposePanel(s) {
  const p = s.panel;
  if (p.ptyId) api.pty.kill(p.ptyId);
  p.term?.dispose();
  p.host?.remove();
  Object.assign(p, { term: null, fit: null, host: null });
}
