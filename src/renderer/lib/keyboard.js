// App-wide keyboard shortcuts. Handled in the capture phase so the terminal never sees them.
// On Windows/Linux they use Ctrl+Shift where plain Ctrl+letter means something to Claude Code.
import { sessions, active, settings, saveSettings, newSessionDialog, settingsDialog, findBar, projectSearch } from './store.js';
import { selectSession, endSession, copySelection, pasteInto, writePty } from './sessions.js';
import { togglePanel, copyFromPanel, pasteIntoPanel } from './panel.js';
import { toggleChanges } from './side.js';

const isMac = /Mac/i.test(navigator.platform);
const isWin = /Win/i.test(navigator.platform);

export const SHORTCUTS = {
  newSession: isMac ? '⌘T' : 'Ctrl+Shift+T',
  closeSession: isMac ? '⌘W' : 'Ctrl+Shift+W',
  switchSession: 'Ctrl+Tab / Ctrl+Shift+Tab',
  jump: isMac ? '⌘1 … ⌘9' : 'Ctrl+1 … Ctrl+9',
  composer: isMac ? '⌘⇧K' : 'Ctrl+Shift+K',
  panel: isMac ? '⌃`' : 'Ctrl+`',
  sidebar: isMac ? '⌘⇧B' : 'Ctrl+Shift+B',
  changes: isMac ? '⌘⇧D' : 'Ctrl+Shift+D',
  copy: isMac ? '⌘C' : 'Ctrl+C or Ctrl+Shift+C',
  paste: isMac ? '⌘V' : isWin ? 'Ctrl+V' : 'Ctrl+Shift+V',
  newline: 'Shift+Enter',
  interrupt: 'Esc',
  mode: 'Shift+Tab',
  zoom: isMac ? '⌘+ / ⌘− / ⌘0' : 'Ctrl+= / Ctrl+− / Ctrl+0',
  settings: isMac ? '⌘,' : 'Ctrl+,',
  find: isMac ? '⌘F' : 'Ctrl+F',
  searchProjects: isMac ? '⌘⇧F' : 'Ctrl+Shift+F',
};

export const SHORTCUT_LIST = [
  ['New session', SHORTCUTS.newSession],
  ['End session', SHORTCUTS.closeSession],
  ['Next / previous session', SHORTCUTS.switchSession],
  ['Jump to session', SHORTCUTS.jump],
  ['Focus the message box', SHORTCUTS.composer],
  ['Find in chat', SHORTCUTS.find],
  ['Search projects and sessions', SHORTCUTS.searchProjects],
  ['Show / hide Terminal', SHORTCUTS.panel],
  ['Show / hide sidebar', SHORTCUTS.sidebar],
  ['Show / hide changed files (chat)', SHORTCUTS.changes],
  ['Stop Claude (chat)', SHORTCUTS.interrupt],
  ['Cycle permission mode (chat)', SHORTCUTS.mode],
  ['New line', SHORTCUTS.newline],
  ['Copy / paste in terminal', `${SHORTCUTS.copy} · ${SHORTCUTS.paste}`],
  ['Text size', SHORTCUTS.zoom],
  ['Settings', SHORTCUTS.settings],
];

function zoom(delta) {
  const s = settings.value;
  if (!delta) return saveSettings({ fontSize: 14, chatFontSize: 14 });
  const clamp = (v) => Math.min(24, Math.max(10, v + delta));
  return saveSettings({ fontSize: clamp(s.fontSize), chatFontSize: clamp(s.chatFontSize || 14) });
}

// Opens (or focuses again) the sidebar's search box, showing the sidebar if it is hidden.
export function searchProjects() {
  if (settings.value.sidebarCollapsed) saveSettings({ sidebarCollapsed: false });
  projectSearch.value += 1;
}

export function focusComposer() {
  document.querySelector('.composer-input')?.focus();
}

function onKeyDown(e) {
  const key = e.key.toLowerCase();
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const s = active.value;
  const handled = () => { e.preventDefault(); e.stopPropagation(); };
  if (document.querySelector('dialog[open]')) return;

  if (e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'Backquote') {
    handled();
    togglePanel(s);
    return;
  }

  // Copy/paste in the bottom Terminal panel
  const panelTerm = s?.panel.term;
  if (panelTerm && document.activeElement === panelTerm.textarea) {
    const copy = isMac ? e.metaKey && key === 'c' : e.ctrlKey && key === 'c' && (e.shiftKey || panelTerm.hasSelection());
    if (copy) {
      handled();
      if (panelTerm.hasSelection()) copyFromPanel(s);
      return;
    }
    const paste = isMac ? e.metaKey && !e.shiftKey && key === 'v' : e.ctrlKey && key === 'v' && (e.shiftKey || isWin);
    if (paste) {
      handled();
      pasteIntoPanel(s);
      return;
    }
  }

  // Terminal copy/paste/newline
  if (s?.term && document.activeElement === s.term.textarea) {
    const copy = isMac ? e.metaKey && key === 'c' : e.ctrlKey && key === 'c' && (e.shiftKey || s.term.hasSelection());
    if (copy) {
      handled();
      if (s.term.hasSelection()) copySelection(s);
      return;
    }
    const paste = isMac ? e.metaKey && !e.shiftKey && key === 'v' : e.ctrlKey && key === 'v' && (e.shiftKey || isWin);
    if (paste) {
      handled();
      pasteInto(s);
      return;
    }
    if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && s.kind.value === 'terminal') {
      handled();
      writePty(s, '\x1b\r'); // Meta+Enter: Claude Code inserts a newline
      return;
    }
  }

  // Find: Ctrl+F in a chat, Ctrl+Shift+F (or Ctrl+F from the sidebar or a CLI session) in the project list.
  // In a focused terminal Ctrl+F stays the terminal's (Claude Code and shells use it).
  if ((isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && key === 'f') {
    const inTerminal = !isMac && [s?.term, panelTerm].some((t) => t && document.activeElement === t.textarea);
    if (e.shiftKey) { handled(); searchProjects(); return; }
    if (!inTerminal) {
      handled();
      if (s?.kind.value === 'chat' && !document.activeElement?.closest('#sidebar')) findBar.value += 1;
      else searchProjects();
      return;
    }
  }

  const appMod = isMac ? e.metaKey : e.ctrlKey && e.shiftKey;
  if (appMod && key === 't') { handled(); newSessionDialog.value = {}; return; }
  if (appMod && key === 'w') { handled(); if (s) endSession(s); return; }
  if (appMod && key === 'b') { handled(); saveSettings({ sidebarCollapsed: !settings.value.sidebarCollapsed }); return; }
  if (appMod && key === 'k') { handled(); focusComposer(); return; }
  if (appMod && key === 'd' && s?.kind.value === 'chat') { handled(); toggleChanges(s); return; }
  if (e.ctrlKey && e.shiftKey && key === 'i') { handled(); window.ccui.toggleDevTools(); return; }
  if (mod && key === ',') { handled(); settingsDialog.value = true; return; }
  const list = sessions.value;
  if (e.ctrlKey && e.key === 'Tab' && list.length > 1) {
    handled();
    const i = list.indexOf(s);
    selectSession(list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length]);
    return;
  }
  if (mod && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
    const target = list[Number(e.key) - 1];
    if (target) { handled(); selectSession(target); }
    return;
  }
  if (mod && !e.altKey && (e.key === '=' || e.key === '+')) { handled(); zoom(1); return; }
  if (mod && !e.altKey && (e.key === '-' || e.key === '_')) { handled(); zoom(-1); return; }
  if (mod && !e.altKey && !e.shiftKey && e.key === '0') { handled(); zoom(0); }
}

export function installShortcuts() {
  window.addEventListener('keydown', onKeyDown, true);
}
