// App-wide state as signals. Session objects are stable; their changing parts are signals.
import { signal, computed } from '@preact/signals';
import { initialChat } from './chat-reducer.js';

export const api = window.ccui;

export const info = signal(null); // { platform, home, version, windowsBuild, hasBundledClaude }
export const settings = signal({});
export const claudeCheck = signal(null); // { ok, version, bundled, chatCapable } | { ok: false, error }
// Updates of the built-in Claude Code (main/claude-update.js): { state, current, latest, received, total, error }
export const claudeUpdate = signal({ state: 'idle' });
export const themeMode = signal('dark');
export const sessions = signal([]);
export const activeUid = signal(null);
export const active = computed(() => sessions.value.find((s) => s.uid === activeUid.value) || null);
export const newSessionDialog = signal(null); // null when closed, else prefill object
export const settingsDialog = signal(false);
export const skillsDialog = signal(null); // the chat session whose skills are being managed, or null
// Find in chat (Ctrl+F) and the sidebar's project search (Ctrl+Shift+F): 0 while closed, otherwise a number
// that goes up each time the shortcut is pressed, so an open box takes the focus again.
export const findBar = signal(0);
export const backgroundUrl = signal(''); // blob: URL of the background image (Settings → Appearance), or ''
export const projectSearch = signal(0);
export const toasts = signal([]);
export const windowFocused = signal(document.hasFocus());

export const TRACE_LEN = 60;
let nextUid = 1;

// kind: 'chat' | 'terminal' (Claude Code TUI) | 'shell'
export function makeSession({ kind, cwd, name = null, sessionId = null }) {
  return {
    uid: nextUid++,
    cwd,
    kind: signal(kind),
    name: signal(name),
    sessionId,
    status: signal('starting'), // starting | working | needs-you | idle | attention | exited | error
    startedAt: signal(Date.now()),
    // chat
    agentId: null,
    chat: signal(initialChat()),
    meta: signal({ commands: [], models: [] }),
    context: signal(null),
    selectedModel: signal(''), // model the conversation runs on ('' = Claude Code default)
    effort: signal(''), // reasoning effort chosen for this session ('' = the model's default)
    mode: signal(''), // permission mode the conversation runs in
    problem: signal(null), // { code, text } when the chat cannot run
    draft: '',
    restore: signal(null), // { text, images }: cancelled queued messages on their way back to the message box
    scrollTop: null,
    openTurns: new Set(), // finished turns whose working steps the user expanded
    // terminal
    term: null,
    fit: null,
    host: null,
    ptyId: null,
    pid: signal(null),
    exitCode: signal(null),
    title: signal(''),
    size: signal(''),
    lastOutputAt: 0,
    lastInputAt: 0,
    lastResizeAt: 0,
    // bottom Terminal panel: a shell in the session's folder (see lib/panel.js)
    panel: { open: signal(false), exited: signal(false), term: null, fit: null, host: null, ptyId: null },
    // the Changes panel at the right of a chat (components/SidePanel.jsx): which turn and file it shows
    side: signal({ open: false, turnKey: null, toolId: null, path: null, tab: 'diff' }),
    // activity trace for the sidebar
    activity: new Array(TRACE_LEN).fill(0),
    bucket: 0,
    traceTick: signal(0),
  };
}

// Applied right away; the main process's copy comes back with each reply, but only the reply to the latest
// save is taken (an older one does not include changes made since).
let saveSeq = 0;
export function saveSettings(patch) {
  settings.value = { ...settings.value, ...patch };
  const seq = ++saveSeq;
  return api.setSettings(patch).then((s) => {
    if (s && seq === saveSeq) settings.value = s;
    return s || settings.value;
  });
}

// Questions for the user (ConfirmHost in ui.jsx shows them one at a time). Resolves true when confirmed.
// `danger`: a red confirm button; `safeDefault` (on with danger): Cancel has the focus.
export const confirms = signal([]);
let confirmId = 0;
export function confirmDialog({ title, message, detail, confirm = 'OK', cancel = 'Cancel', danger = false, safeDefault = danger }) {
  return new Promise((resolve) => {
    confirms.value = [...confirms.value, { id: ++confirmId, title, message, detail, confirm, cancel, danger, safeDefault, resolve }];
  });
}

let toastId = 0;
export function toast(text, tone = 'info') {
  const id = ++toastId;
  toasts.value = [...toasts.value, { id, text, tone }];
  setTimeout(() => { toasts.value = toasts.value.filter((t) => t.id !== id); }, tone === 'error' ? 7000 : 4200);
}

window.addEventListener('focus', () => { windowFocused.value = true; });
window.addEventListener('blur', () => { windowFocused.value = false; });
