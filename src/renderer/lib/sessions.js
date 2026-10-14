// Session lifecycle for chat (Agent SDK) and terminal (pty) sessions, and the glue between
// main-process events and the per-session signals the components read.
import {
  api, sessions, activeUid, settings, saveSettings, toast, makeSession, TRACE_LEN,
} from './store.js';
import { reduce, initialChat } from './chat-reducer.js';
import { createTerminal, fitTerminal } from './terminal.js';
import { disposePanel } from './panel.js';
import { basename, samePath, tildify, pluralize } from './format.js';

const agents = new Map(); // agent id -> session
const ptys = new Map(); // pty id -> session

const IDLE_AFTER = 1600; // terminal: ms of output silence before a session counts as waiting
const ECHO_WINDOW = 300; // terminal: output this soon after input or resize is echo/redraw
const STARTUP_GRACE = 5000;

export const displayName = (s) => s.name.value || basename(s.cwd);

// ---------- status ----------
const isSeen = (s) => s.uid === activeUid.value && document.hasFocus();

function setStatus(s, status) {
  if (s.status.value === status) return;
  s.status.value = status;
  if ((status === 'attention' || status === 'needs-you') && !isSeen(s)) notify(s, status);
  updateBadge();
}

function chatStatus(s) {
  if (s.dormant) return 'idle';
  if (s.problem.value) return 'error';
  if (!s.agentId) return 'exited';
  const chat = s.chat.value;
  if (chat.permissions.length) return 'needs-you';
  if (chat.busy) return 'working';
  const prev = s.status.value;
  if (prev === 'working' || prev === 'needs-you') return isSeen(s) ? 'idle' : 'attention';
  return prev === 'attention' ? 'attention' : 'idle';
}

function notify(s, status) {
  if (!settings.value.notify || document.hasFocus()) return;
  const title = status === 'needs-you' ? `${displayName(s)} needs your answer` : `${displayName(s)} is waiting for you`;
  const n = new Notification(title, { body: s.title.value || tildify(s.cwd) });
  n.onclick = () => {
    api.focusWindow();
    if (!s.removed) selectSession(s);
  };
}

function updateBadge() {
  api.setBadge(sessions.value.filter((s) => s.status.value === 'attention' || s.status.value === 'needs-you').length);
}

window.addEventListener('focus', () => {
  const s = sessions.value.find((x) => x.uid === activeUid.value);
  if (s?.status.value === 'attention') setStatus(s, 'idle');
});

// ---------- chat sessions ----------
function dispatch(s, messages) {
  s.chat.value = reduce(s.chat.value, messages);
  const { sessionId: id, init } = s.chat.value;
  let changed = false;
  // Claude Code can change mode itself (e.g. leaving plan mode once a plan is approved).
  if (init?.permissionMode && init.permissionMode !== s.mode.value) {
    s.mode.value = init.permissionMode;
    changed = true;
  }
  if (id && id !== s.sessionId) {
    s.sessionId = id;
    changed = true;
  }
  if (changed) persistSessions();
  if (changed || (init?.model && init.model !== s.reportedModel)) {
    s.reportedModel = init?.model;
    rememberConversation(s);
  }
  setStatus(s, chatStatus(s));
}

// Model and permission mode per conversation, so resuming it (from history, a restart, or the terminal)
// comes back the way it was left.
function rememberConversation(s) {
  const id = s.chat.value.sessionId || s.sessionId;
  if (!id) return;
  const entry = { model: s.selectedModel.value || s.chat.value.init?.model || '', permissionMode: s.mode.value || '' };
  const all = settings.value.conversations || {};
  const old = all[id];
  if (old && old.model === entry.model && old.permissionMode === entry.permissionMode) return;
  const { [id]: _drop, ...rest } = all;
  const keys = Object.keys(rest);
  for (const k of keys.slice(0, Math.max(0, keys.length - 299))) delete rest[k];
  saveSettings({ conversations: { ...rest, [id]: entry } });
}

// Title of a stored conversation: the same one /resume and the Recents list show.
export const conversationTitle = (h) => h.customTitle || h.summary || h.firstPrompt || '';

function setTitle(s, title) {
  const line = (title || '').split('\n')[0].trim();
  if (line && !s.title.value) s.title.value = line.slice(0, 80);
}

async function loadTitle(s, sessionId) {
  if (s.title.value || !sessionId) return;
  const res = await api.history.list(s.cwd);
  const h = res.ok && res.sessions.find((x) => x.sessionId === sessionId);
  if (h) setTitle(s, conversationTitle(h));
  if (!s.title.value) {
    // Fall back to the first prompt in the replayed conversation.
    const first = s.chat.value.items.find((i) => i.type === 'user' && i.text && !i.text.startsWith('/'));
    if (first) setTitle(s, first.text);
  }
  if (s.title.value) persistSessions();
}

function lastModelIn(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const model = messages[i].type === 'assistant' && messages[i].message?.model;
    if (model && !model.startsWith('<')) return model;
  }
  return '';
}

function activityOf(batch) {
  let n = 0;
  for (const m of batch) {
    if (m.type === 'stream_event') n += m.event?.delta?.text?.length || m.event?.delta?.thinking?.length || m.event?.delta?.partial_json?.length || 0;
    else if (m.type === 'user' || m.type === 'tool_progress') n += 300;
  }
  return n;
}

api.agent.onEvents((id, batch) => {
  const s = agents.get(id);
  if (!s || s.removed) return;
  s.bucket += activityOf(batch);
  dispatch(s, batch);
  if (batch.some((m) => m.type === 'result')) refreshContext(s);
});
const earlyMeta = new Map(); // agent:meta can arrive before agent:start resolves
api.agent.onMeta((id, meta) => {
  const s = agents.get(id);
  if (s) s.meta.value = meta;
  else earlyMeta.set(id, meta);
});
api.agent.onPermission((id, request) => {
  const s = agents.get(id);
  if (s) dispatch(s, [{ type: 'ui/permission', request }]);
});
api.agent.onPermissionCancel((id, requestId) => {
  const s = agents.get(id);
  if (s) dispatch(s, [{ type: 'ui/permission-done', requestId }]);
});
api.agent.onExit((id, { error }) => {
  const s = agents.get(id);
  agents.delete(id);
  if (!s || s.removed) return;
  s.agentId = null;
  const next = s.afterExit;
  s.afterExit = null;
  if (next) return next();
  dispatch(s, [{ type: 'ui/exit', error }]);
});

function startAgent(s, opts) {
  s.starting ??= startAgentNow(s, opts).finally(() => { s.starting = null; });
  return s.starting;
}

async function startAgentNow(s, { resume, model, permissionMode } = {}) {
  s.problem.value = null;
  s.startedAt.value = Date.now();
  setStatus(s, 'starting');
  // Explicit choice > what this conversation used last time > this session's current values >
  // the model recorded in the transcript > defaults.
  const history = resume ? await api.history.messages(resume, s.cwd) : null;
  const remembered = resume ? settings.value.conversations?.[resume] : null;
  const useModel = model ?? remembered?.model
    ?? (s.selectedModel.value || (history?.ok ? lastModelIn(history.messages) : '') || settings.value.defaultModel || '');
  const useMode = permissionMode || remembered?.permissionMode || s.mode.value || settings.value.defaultPermissionMode || 'default';
  const res = await api.agent.start({
    cwd: s.cwd,
    resume: resume || undefined,
    model: useModel || undefined,
    effort: s.effort.value || undefined, // kept across restarts and CLI ⇄ chat switches
    permissionMode: useMode,
  });
  if (s.removed) {
    if (res.ok) api.agent.close(res.id);
    return res;
  }
  if (!res.ok) {
    s.problem.value = { code: res.code || 'error', text: res.error || 'Claude Code could not start.' };
    setStatus(s, 'error');
    return res;
  }
  s.agentId = res.id;
  agents.set(res.id, s);
  if (earlyMeta.has(res.id)) {
    s.meta.value = earlyMeta.get(res.id);
    earlyMeta.delete(res.id);
  }
  s.selectedModel.value = useModel === 'default' ? '' : useModel;
  s.mode.value = useMode;
  if (resume) {
    s.sessionId = resume;
    if (history?.ok && history.messages.length && !s.chat.value.items.length) dispatch(s, [{ type: 'ui/history', messages: history.messages }]);
    loadTitle(s, resume);
  }
  rememberConversation(s);
  setStatus(s, chatStatus(s));
  return res;
}

export async function sendMessage(s, { text, images = [] }) {
  if (s.dormant) wakeSession(s);
  if (s.starting) await s.starting;
  if (!s.agentId) {
    const res = await startAgent(s, { resume: s.chat.value.sessionId || s.sessionId });
    if (!res.ok) {
      if (!s.removed) s.restore.value = { text, images };
      return;
    }
  }
  if (s.removed) return;
  const uuid = crypto.randomUUID();
  dispatch(s, [{ type: 'ui/user', uuid, text, images }]);
  api.agent.send(s.agentId, { text, images, uuid });
}

// Stops the running turn and cancels messages sent while Claude was working that it has not picked up yet.
// Those leave the timeline and go back into the message box.
export async function interrupt(s) {
  if (!s.agentId) return;
  const res = await api.agent.control(s.agentId, 'interrupt');
  const cancelled = (res.ok && res.value?.cancelled) || [];
  const unsent = s.chat.value.items.filter((i) => i.type === 'user' && cancelled.includes(i.key));
  if (!unsent.length) return;
  dispatch(s, [{ type: 'ui/unsent', uuids: unsent.map((i) => i.key) }]);
  s.restore.value = {
    text: unsent.map((i) => i.text).filter(Boolean).join('\n\n'),
    images: unsent.flatMap((i) => i.images || []),
  };
}

export async function setModel(s, value) {
  if (!s.agentId) return;
  const res = await api.agent.control(s.agentId, 'model', value);
  if (!res.ok) return toast(res.error, 'error');
  s.selectedModel.value = value === 'default' ? '' : value;
  rememberConversation(s);
}

// `level`: one of the model's supportedEffortLevels, or '' for the model's default. Resolves to whether it took.
export async function setEffort(s, level) {
  if (!s.agentId) return false;
  const res = await api.agent.control(s.agentId, 'effort', level);
  if (!res.ok) {
    toast(res.error, 'error');
    return false;
  }
  s.effort.value = level;
  return true;
}

export async function setMode(s, mode) {
  if (!s.agentId) return false;
  const res = await api.agent.control(s.agentId, 'mode', mode);
  if (!res.ok) {
    toast(/auto mode unavailable/i.test(res.error) ? 'Auto mode is not available for this model.' : res.error, 'error');
    return false;
  }
  const chat = s.chat.value;
  s.chat.value = { ...chat, init: { ...(chat.init || {}), permissionMode: mode } };
  s.mode.value = mode;
  rememberConversation(s);
  return true;
}

export async function refreshContext(s) {
  if (!s.agentId) return;
  const res = await api.agent.control(s.agentId, 'context');
  if (res.ok && res.value) {
    const { percentage, totalTokens, maxTokens } = res.value;
    s.context.value = { percentage, totalTokens, maxTokens };
  }
}

// answer: { behavior: 'allow', updatedInput?, updatedPermissions? } | { behavior: 'deny', message?, interrupt? }
export function answerPermission(s, request, answer) {
  if (s.agentId) api.agent.reply(s.agentId, request.requestId, answer);
  dispatch(s, [{
    type: 'ui/permission-done',
    requestId: request.requestId,
    toolUseID: request.toolUseID,
    decision: answer.behavior === 'allow' ? 'allowed' : 'denied',
  }]);
}

// ---------- acting on one of the user's earlier messages ----------
const messageDraft = (item) => ({ text: item.text || '', images: item.images || [] });
function canActOn(s, item) {
  if (item.queued) return false;
  if (!s.chat.value.busy) return true;
  toast('Claude is still working. Stop it first.', 'error');
  return false;
}

// What undoing would change: { count, insertions, deletions } or null when it cannot be done.
async function fileChangesSince(s, item) {
  if (s.dormant) wakeSession(s);
  if (s.starting) await s.starting;
  if (!s.agentId) {
    const started = await startAgent(s, { resume: s.chat.value.sessionId || s.sessionId });
    if (!started.ok) return null;
  }
  const res = await api.agent.control(s.agentId, 'rewind', { uuid: item.key, dryRun: true });
  if (!res.ok || !res.value?.canRewind) {
    toast(res.value?.error || res.error || 'There is no saved file state for this message.', 'error');
    return null;
  }
  const { filesChanged = [], insertions = 0, deletions = 0 } = res.value;
  return { count: filesChanged.length, insertions, deletions };
}

// Puts files back the way they were when this message was sent. Returns false when nothing was done.
export async function undoFileChanges(s, item, { silentIfNone = false } = {}) {
  if (!canActOn(s, item)) return false;
  const changes = await fileChangesSince(s, item);
  if (!changes) return false;
  if (!changes.count) {
    if (!silentIfNone) toast('No file changes to undo since this message.');
    return silentIfNone;
  }
  const what = `${pluralize(changes.count, 'file')} (+${changes.insertions} −${changes.deletions})`;
  if (!window.confirm(`Undo Claude's changes to ${what} made since this message?\n\nChanges you made yourself to those files since then are undone too.`)) return false;
  const res = await api.agent.control(s.agentId, 'rewind', { uuid: item.key });
  if (!res.ok || !res.value?.canRewind) {
    toast(res.value?.error || res.error || 'The files could not be restored.', 'error');
    return false;
  }
  toast(`Restored ${pluralize(changes.count, 'file')} to how ${changes.count === 1 ? 'it was' : 'they were'} before this message.`);
  return true;
}

// Goes back to just before this message: the conversation continues from there and the message returns to
// the message box to edit and send again. The conversation as it was stays available under Recents.
// `files`: also undo the file changes made since.
export async function rewindTo(s, item, { files = false } = {}) {
  if (!canActOn(s, item)) return;
  if (s.starting) await s.starting;
  const sessionId = s.chat.value.sessionId || s.sessionId;
  if (!sessionId || s.removed) return;
  if (files && !(await undoFileChanges(s, item, { silentIfNone: true }))) return;
  const fork = await api.history.fork(sessionId, s.cwd, item.key);
  if (!fork.ok) return toast(fork.error, 'error');
  const go = async () => {
    s.chat.value = initialChat();
    s.openTurns.clear();
    s.scrollTop = null;
    s.sessionId = fork.sessionId;
    const res = await startAgent(s, { resume: fork.sessionId || undefined, model: s.selectedModel.value, permissionMode: s.mode.value });
    if (res.ok) s.restore.value = messageDraft(item);
    persistSessions();
  };
  if (s.agentId) {
    s.afterExit = go;
    api.agent.close(s.agentId);
  } else go();
}

// Same starting point, but in a new session next to this one, which is left untouched.
export async function forkFrom(s, item) {
  if (item.queued) return;
  const sessionId = s.chat.value.sessionId || s.sessionId;
  if (!sessionId) return;
  const fork = await api.history.fork(sessionId, s.cwd, item.key);
  if (!fork.ok) return toast(fork.error, 'error');
  const res = await openSession({
    cwd: s.cwd, kind: 'chat', mode: fork.sessionId ? 'resume' : 'new', resume: fork.sessionId || undefined,
    title: s.title.value ? `${s.title.value} (fork)` : '', model: s.selectedModel.value, permissionMode: s.mode.value,
  });
  if (res.ok) res.session.restore.value = messageDraft(item);
}

export async function retryChat(s) {
  if (s.starting) await s.starting;
  if (s.agentId) return { ok: true };
  s.chat.value = initialChat();
  return startAgent(s, { resume: s.sessionId || undefined });
}

// ---------- terminal sessions ----------
const cleanTitle = (raw) => {
  const t = (raw || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
  return /^claude( code)?$/i.test(t) || /^([a-z]:\\|\/|~)/i.test(t) || /\.exe$/i.test(t) ? '' : t;
};

export function writePty(s, data) {
  if (!s.ptyId) return;
  s.lastInputAt = Date.now();
  api.pty.write(s.ptyId, data);
}

export function copySelection(s) {
  api.writeClipboard(s.term.getSelection());
  s.term.clearSelection();
}

export async function pasteInto(s) {
  const text = await api.readClipboard();
  if (text) s.term.paste(text);
  else writePty(s, '\x16'); // no text: let Claude Code try to paste an image itself
}

function attachTerminal(s) {
  const { term, fit, host } = createTerminal({
    onData: (data) => writePty(s, data),
    onResize: (cols, rows) => {
      s.size.value = `${cols}×${rows}`;
      // Every resize makes Claude Code redraw its whole screen; send only the size the layout settles on.
      clearTimeout(s.resizeTimer);
      s.resizeTimer = setTimeout(() => {
        s.lastResizeAt = Date.now();
        if (s.ptyId && s.term) api.pty.resize(s.ptyId, s.term.cols, s.term.rows);
      }, 150);
    },
    // Claude Code's generic "Claude Code" title must not wipe a real conversation title.
    onTitle: (title) => {
      const clean = cleanTitle(title);
      if (clean) s.title.value = clean;
    },
    onContextMenu: () => (s.term.hasSelection() ? copySelection(s) : pasteInto(s)),
  });
  Object.assign(s, { term, fit, host });
  host.classList.toggle('active', s.uid === activeUid.value);
}

function disposeTerminal(s) {
  if (!s.term) return;
  s.term.dispose();
  s.host.remove();
  Object.assign(s, { term: null, fit: null, host: null });
}

// Two frames: the component tree re-renders for the new session kind, then layout settles.
const layoutSettled = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

function claudeArgs(s, resume) {
  const args = resume ? ['--resume', resume] : [];
  if (s.selectedModel.value) args.push('--model', s.selectedModel.value);
  if (s.mode.value && s.mode.value !== 'default') args.push('--permission-mode', s.mode.value);
  if (s.mode.value === 'bypassPermissions') args.push('--allow-dangerously-skip-permissions'); // the CLI refuses the mode without it
  return args;
}

function startTerminal(s, opts) {
  s.ptyStarting ??= startTerminalNow(s, opts).finally(() => { s.ptyStarting = null; });
  return s.ptyStarting;
}

async function startTerminalNow(s, { resume, extraArgs } = {}) {
  if (!s.term) attachTerminal(s);
  // Start the process at its final size: a resize right after start makes the TUI print duplicate frames.
  await layoutSettled();
  // Closed, or switched to chat (which disposes the terminal), while waiting.
  if (s.removed || !s.term || s.kind.value === 'chat') return { ok: false, error: 'Session closed.' };
  fitTerminal(s);
  const isClaude = s.kind.value === 'terminal';
  const res = await api.pty.create({
    kind: isClaude ? 'terminal' : 'shell',
    cwd: s.cwd,
    args: isClaude ? claudeArgs(s, resume) : [],
    extraArgs: isClaude ? (extraArgs ?? settings.value.defaultArgs) : '',
    cols: s.term.cols,
    rows: s.term.rows,
  });
  if (res.ok && s.removed) api.pty.kill(res.id);
  if (!res.ok || s.removed) return res;
  s.ptyId = res.id;
  s.pid.value = res.pid;
  s.exitCode.value = null;
  s.startedAt.value = Date.now();
  s.lastOutputAt = 0;
  if (resume) {
    s.sessionId = resume;
    loadTitle(s, resume);
  }
  ptys.set(res.id, s);
  setStatus(s, 'starting');
  return res;
}

api.pty.onData((id, data) => {
  const s = ptys.get(id);
  if (!s || s.removed || !s.term) return;
  s.term.write(data);
  const now = Date.now();
  if (now - s.lastInputAt < ECHO_WINDOW || now - s.lastResizeAt < ECHO_WINDOW) return;
  s.bucket += data.length;
  s.lastOutputAt = now;
  const status = s.status.value;
  if (status === 'idle' || status === 'attention') setStatus(s, 'working');
  else if (status === 'starting' && now - s.startedAt.value > STARTUP_GRACE) setStatus(s, 'working');
});

api.pty.onExit((id, { exitCode }) => {
  const s = ptys.get(id);
  ptys.delete(id);
  if (!s || s.removed) return;
  s.ptyId = null;
  s.pid.value = null;
  s.exitCode.value = exitCode;
  const next = s.afterExit;
  s.afterExit = null;
  if (next) return next();
  setStatus(s, 'exited');
});

// Output silence decides when a terminal session is waiting (the TUI has no structured events).
setInterval(() => {
  const now = Date.now();
  for (const s of sessions.value) {
    if (s.kind.value === 'chat') continue;
    const status = s.status.value;
    if (status !== 'working' && status !== 'starting') continue;
    if (now - s.lastOutputAt < IDLE_AFTER || now - s.startedAt.value < 800) continue;
    const settling = status === 'starting' || now - s.startedAt.value < STARTUP_GRACE;
    setStatus(s, isSeen(s) || settling ? 'idle' : 'attention');
  }
}, 250);

// Sidebar activity traces: one bucket per second.
setInterval(() => {
  for (const s of sessions.value) {
    s.activity.push(s.bucket);
    if (s.activity.length > TRACE_LEN) s.activity.shift();
    s.bucket = 0;
    s.traceTick.value++;
  }
}, 1000);

export function restartTerminal(s, { fresh = false } = {}) {
  const run = async () => {
    s.term?.reset();
    let resume;
    if (s.kind.value === 'terminal' && !fresh) resume = s.sessionId || (await latestSessionId(s.cwd));
    const res = await startTerminal(s, { resume });
    if (!res.ok) {
      toast(res.error, 'error');
      setStatus(s, 'exited');
    }
    s.term?.focus();
  };
  if (s.ptyId) {
    s.afterExit = run;
    api.pty.kill(s.ptyId);
  } else run();
}

// ---------- switching a conversation between chat and terminal ----------
async function latestSessionId(cwd) {
  const res = await api.history.list(cwd);
  return res.ok ? res.sessions[0]?.sessionId : undefined;
}

export async function openInTerminal(s) {
  s.dormant = null;
  if (s.starting) await s.starting;
  const resume = s.chat.value.sessionId || s.sessionId || undefined;
  const go = async () => {
    s.kind.value = 'terminal';
    s.chat.value = initialChat();
    s.problem.value = null;
    selectSession(s);
    const res = await startTerminal(s, { resume });
    if (!res.ok) {
      toast(res.error, 'error');
      setStatus(s, 'exited');
    }
    s.term?.focus();
    persistSessions();
  };
  if (s.agentId) {
    s.afterExit = go;
    api.agent.close(s.agentId);
  } else go();
}

export async function openInChat(s) {
  s.dormant = null;
  if (s.ptyStarting) await s.ptyStarting;
  const go = async () => {
    // Prefer this session's own conversation; other sessions may share the folder.
    const resume = s.sessionId || (await latestSessionId(s.cwd)) || undefined;
    disposeTerminal(s);
    s.kind.value = 'chat';
    s.chat.value = initialChat();
    await startAgent(s, { resume });
    persistSessions();
  };
  if (s.ptyId) {
    s.afterExit = go;
    api.pty.kill(s.ptyId);
  } else go();
}

// ---------- opening, selecting, closing ----------
// kind: 'chat' | 'terminal' | 'shell'; mode: 'new' | 'continue' | 'resume' (with `resume` = session id)
export async function openSession(opts, { activate = true } = {}) {
  const kind = opts.kind || settings.value.defaultKind || 'chat';
  let resume = opts.resume;
  if (opts.mode === 'continue' && !resume && kind !== 'shell') {
    resume = await latestSessionId(opts.cwd);
    if (!resume) toast('No earlier conversation in this folder, so a new one was started.');
  }
  const s = makeSession({ kind, cwd: opts.cwd, name: opts.name, sessionId: resume || null });
  if (resume && opts.title) setTitle(s, opts.title);
  if (kind === 'terminal') {
    const remembered = resume ? settings.value.conversations?.[resume] : null;
    s.selectedModel.value = opts.model ?? remembered?.model ?? '';
    s.mode.value = opts.permissionMode ?? remembered?.permissionMode ?? '';
  }
  sessions.value = [...sessions.value, s];
  const folders = settings.value.folders || {};
  const folderKey = Object.keys(folders).find((p) => samePath(p, opts.cwd));
  if (folderKey && folders[folderKey].collapsed) {
    saveSettings({ folders: { ...folders, [folderKey]: { ...folders[folderKey], collapsed: false } } });
  }
  if (opts.lazy) {
    // Restored at launch: listed (with its history) right away, started when first selected.
    s.dormant = { resume, model: opts.model, permissionMode: opts.permissionMode, extraArgs: opts.extraArgs };
    const remembered = resume ? settings.value.conversations?.[resume] : null;
    s.selectedModel.value = opts.model ?? remembered?.model ?? '';
    s.mode.value = opts.permissionMode ?? remembered?.permissionMode ?? '';
    s.status.value = 'idle';
    if (kind === 'chat' && resume) preloadHistory(s, resume);
    else if (resume) loadTitle(s, resume);
    return { ok: true, session: s };
  }
  if (activate || !activeUid.value) selectSession(s);

  const res = kind === 'chat'
    ? await startAgent(s, { resume, model: opts.model, permissionMode: opts.permissionMode })
    : await startTerminal(s, { resume, extraArgs: opts.extraArgs });
  if (!res.ok && (kind !== 'chat' || res.code === 'folder')) {
    closeSession(s);
    toast(res.error, 'error');
    return res;
  }
  addRecent(opts.cwd);
  persistSessions();
  return { ok: true, session: s };
}

// Open a past conversation, or switch to it if a session already shows it.
export function openConversation(cwd, sessionId, kind = 'chat', title = '') {
  const open = sessions.value.find((x) => (x.chat.value.sessionId || x.sessionId) === sessionId);
  if (open) return selectSession(open);
  return openSession({ cwd, kind, mode: 'resume', resume: sessionId, title });
}

async function preloadHistory(s, sessionId) {
  const history = await api.history.messages(sessionId, s.cwd);
  if (history.ok && history.messages.length && !s.chat.value.items.length && !s.removed) {
    dispatch(s, [{ type: 'ui/history', messages: history.messages }]);
  }
  loadTitle(s, sessionId);
}

// Start a session restored at launch (see openSession `lazy`).
function wakeSession(s) {
  const d = s.dormant;
  if (!d) return;
  s.dormant = null;
  if (s.agentId || s.ptyId || s.starting || s.ptyStarting) return; // already started another way
  if (s.kind.value === 'chat') {
    startAgent(s, { resume: d.resume, model: d.model, permissionMode: d.permissionMode });
  } else {
    startTerminal(s, { resume: d.resume, extraArgs: d.extraArgs }).then((res) => {
      if (res.ok || s.removed) return;
      toast(res.error, 'error');
      setStatus(s, 'exited');
    });
  }
}

export function selectSession(s) {
  const changed = activeUid.value !== (s ? s.uid : null);
  activeUid.value = s ? s.uid : null;
  for (const x of sessions.value) x.host?.classList.toggle('active', x === s);
  if (changed) persistSessions(); // remembers which session to reopen next launch
  if (!s) return;
  if (s.dormant) wakeSession(s);
  if (s.status.value === 'attention') setStatus(s, 'idle');
  if (s.term) {
    requestAnimationFrame(() => {
      if (!s.term) return; // closed or switched to chat meanwhile
      fitTerminal(s);
      if (!document.querySelector('dialog[open]')) s.term.focus();
    });
  }
}

export function closeSession(s) {
  s.removed = true;
  if (s.agentId) api.agent.close(s.agentId);
  if (s.ptyId) api.pty.kill(s.ptyId);
  disposeTerminal(s);
  disposePanel(s);
  const list = sessions.value;
  const index = list.indexOf(s);
  const rest = list.filter((x) => x !== s);
  sessions.value = rest;
  if (activeUid.value === s.uid) selectSession(rest[Math.min(index, rest.length - 1)] || null);
  persistSessions();
  updateBadge();
}

let restoring = false; // while true, the saved list is still being read back: don't overwrite it

export function persistSessions() {
  if (restoring) return;
  saveSettings({
    lastSessions: sessions.value.map((s) => ({
      kind: s.kind.value,
      cwd: s.cwd,
      name: s.name.value,
      title: s.title.value,
      sessionId: s.chat.value.sessionId || s.sessionId,
      model: s.selectedModel.value,
      permissionMode: s.mode.value,
      active: s.uid === activeUid.value,
    })),
  });
}

// Bring back last launch's sessions. All of them are listed immediately; only the one that was
// active starts now, the others when they are first selected.
export async function restoreSessions() {
  const saved = settings.value.lastSessions || [];
  const restored = [];
  restoring = true;
  try {
    await restoreEntries(saved, restored);
  } finally {
    restoring = false;
  }
  const target = restored.find(Boolean) || sessions.value[0];
  if (target) selectSession(target);
}

async function restoreEntries(saved, restored) {
  for (const entry of saved) {
    const legacy = entry.kind === 'claude'; // written by the first version of the app
    const res = await openSession({
      kind: legacy ? 'terminal' : entry.kind,
      cwd: entry.cwd,
      name: entry.name,
      title: entry.title,
      resume: entry.sessionId || undefined,
      // A chat that never got a message comes back empty, not attached to some other conversation.
      mode: entry.sessionId ? 'resume' : legacy ? 'continue' : 'new',
      model: entry.model || undefined,
      permissionMode: entry.permissionMode || undefined,
      lazy: true,
    }, { activate: false });
    restored.push(res.session && entry.active ? res.session : null);
  }
}

export function renameSession(s, name) {
  s.name.value = name || null;
  persistSessions();
}

// ---------- recent folders ----------
export function addRecent(path) {
  const recent = [{ path, at: Date.now() }, ...(settings.value.recent || []).filter((r) => !samePath(r.path, path))].slice(0, 12);
  saveSettings({ recent });
}

export function forgetRecent(path) {
  saveSettings({ recent: (settings.value.recent || []).filter((r) => !samePath(r.path, path)) });
}

export async function chooseFolderAndStart() {
  const folder = await api.pickFolder(settings.value.recent?.[0]?.path);
  if (folder) openSession({ cwd: folder });
}
