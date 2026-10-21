// Sidebar: project folders, each holding its open sessions and, on request, its past conversations.
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Icon, Collapse, openContextMenu } from './ui.jsx';
import {
  api, sessions, activeUid, settings, saveSettings, themeMode, newSessionDialog, settingsDialog, toast, TRACE_LEN,
  projectSearch,
} from '../lib/store.js';
import {
  selectSession, endSession, openSession, openConversation, forgetRecent, renameSession,
  openInTerminal, openInChat,
} from '../lib/sessions.js';
import { basename, tildify, samePath, relativeTime } from '../lib/format.js';
import { SHORTCUTS, searchProjects, focusComposer } from '../lib/keyboard.js';
import { t, phrase } from '../lib/i18n.js';

// In English; t() where shown.
export const STATE_WORDS = {
  starting: phrase('Starting'),
  working: phrase('Working'),
  'needs-you': phrase('Needs your answer'),
  idle: phrase('Ready'),
  attention: phrase('Waiting for you'),
  exited: phrase('Ended'),
  error: phrase('Needs setup'),
};

const renamingUid = signal(null);
const recentsOpen = signal(new Set()); // folder paths whose past conversations are listed
const query = signal(''); // the project search box's text

function readColors() {
  const css = getComputedStyle(document.documentElement);
  return Object.fromEntries(['ok', 'wait', 'muted', 'off'].map((k) => [k, css.getPropertyValue(`--${k}`).trim()]));
}

function drawTrace(canvas, values, status) {
  const dpr = devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (values.every((v) => !v)) return; // nothing happened in the last minute: no trace, no stray line
  const colors = readColors();
  const color = status === 'working' ? colors.ok
    : status === 'attention' || status === 'needs-you' ? colors.wait
    : status === 'exited' || status === 'error' ? colors.off : colors.muted;
  const ceiling = Math.log1p(8000);
  const points = values.map((v, i) => [(i / (TRACE_LEN - 1)) * w, h - 1.5 - Math.min(1, Math.log1p(v) / ceiling) * (h - 4)]);
  const path = () => {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  };
  path();
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = color;
  ctx.fill();
  path();
  ctx.globalAlpha = status === 'exited' ? 0.5 : 0.9;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.25;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function RenameInput({ value, onDone }) {
  const ref = useRef(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current.focus();
    ref.current.select();
  }, []);
  const finish = (commit) => {
    if (done.current) return;
    done.current = true;
    onDone(ref.current.value.trim(), commit);
  };
  return (
    <input ref={ref} type="text" defaultValue={value} spellcheck={false}
           onClick={(e) => e.stopPropagation()}
           onKeyDown={(e) => {
             e.stopPropagation();
             if (e.key === 'Enter') finish(true);
             if (e.key === 'Escape') finish(false);
           }}
           onBlur={() => finish(true)} />
  );
}

const KIND_LABEL = { chat: phrase('New chat'), terminal: phrase('CLI session'), shell: phrase('Shell') };
const KIND_ICON = { chat: 'chat', terminal: 'terminal', shell: 'dollar' };
const sessionLabel = (s) => s.name.value || s.title.value || t(KIND_LABEL[s.kind.value]);

function sessionMenu(e, s) {
  const kind = s.kind.value;
  openContextMenu(e, [
    { label: t('Rename'), run: () => { renamingUid.value = s.uid; } },
    kind === 'chat' && { label: t('Open in CLI'), run: () => openInTerminal(s) },
    kind === 'terminal' && { label: t('Open in chat'), run: () => openInChat(s) },
    '-',
    { label: t('End session'), run: () => endSession(s) },
  ].filter(Boolean));
}

// `index`: its place in the folder, for the rows' staggered slide-in when the folder opens (chat.css).
function SessionRow({ s, index = 0 }) {
  const canvas = useRef(null);
  const status = s.status.value;
  const tick = s.traceTick.value;
  const theme = themeMode.value;
  useEffect(() => { if (canvas.current) drawTrace(canvas.current, s.activity, status); }, [tick, status, theme]);

  const kind = s.kind.value;
  const exitCode = s.exitCode.value;
  const word = status === 'exited' && exitCode ? t('Ended ({code})', { code: exitCode }) : t(STATE_WORDS[status]);
  const renaming = renamingUid.value === s.uid;

  return (
    <li class="session" style={{ '--i': index }} data-status={status} aria-current={String(s.uid === activeUid.value)}
        onContextMenu={(e) => sessionMenu(e, s)}>
      <button class="session-main" title={s.title.value || s.cwd} onClick={() => selectSession(s)}
              onDblClick={() => { renamingUid.value = s.uid; }}>
        <span class="session-icon" title={t(KIND_LABEL[kind])}>
          <Icon name={KIND_ICON[kind]} size={22} />
          <span class="status-badge" />
        </span>
        <span class="session-text">
          <span class="session-name">
            {renaming ? (
              <RenameInput value={sessionLabel(s)} onDone={(name, commit) => {
                if (commit) renameSession(s, name);
                renamingUid.value = null;
              }} />
            ) : sessionLabel(s)}
          </span>
          <span class="session-sub"><span class="state-word">{word}</span></span>
        </span>
        <canvas class="trace" ref={canvas} aria-hidden="true" />
      </button>
      <button class="icon-btn session-close" title={t('End session')} onClick={(e) => { e.stopPropagation(); endSession(s); }}>
        <Icon name="x" size={13} />
      </button>
    </li>
  );
}

const conversationTitle = (h) => h.customTitle || h.summary || h.firstPrompt || t('Untitled conversation');

function Recents({ path }) {
  const [state, setState] = useState({ loading: true, list: [] });
  useEffect(() => {
    let live = true;
    api.history.list(path).then((res) => {
      if (live) setState({ loading: false, list: res.ok ? res.sessions : [], error: res.ok ? '' : res.error });
    });
    return () => { live = false; };
  }, [path]);
  const close = () => {
    const next = new Set(recentsOpen.value);
    next.delete(path);
    recentsOpen.value = next;
  };
  const openIds = new Set(sessions.value.map((s) => s.chat.value.sessionId || s.sessionId).filter(Boolean));

  return (
    <div class="recents">
      <div class="recents-head">
        <span>{t('Recent conversations')}</span>
        <button class="icon-btn" title={t('Hide recent conversations')} onClick={close}><Icon name="x" size={12} /></button>
      </div>
      {state.loading && <p class="recents-note">{t('Loading…')}</p>}
      {!state.loading && !state.list.length && <p class="recents-note">{state.error || t('No conversations in this folder yet.')}</p>}
      <ul>
        {state.list.map((h) => (
          <li key={h.sessionId}>
            <button class={openIds.has(h.sessionId) ? 'is-open' : ''} title={conversationTitle(h)}
                    onClick={() => openConversation(path, h.sessionId, 'chat', conversationTitle(h))}
                    onContextMenu={(e) => openContextMenu(e, [
                      { label: t('Open in chat'), run: () => openConversation(path, h.sessionId, 'chat', conversationTitle(h)) },
                      { label: t('Open in CLI'), run: () => openConversation(path, h.sessionId, 'terminal', conversationTitle(h)) },
                      '-',
                      { label: t('Copy conversation ID'), run: () => api.writeClipboard(h.sessionId) },
                    ])}>
              <span class="r-title">{conversationTitle(h)}</span>
              <span class="r-meta">{relativeTime(h.lastModified)}{h.gitBranch ? ` · ${h.gitBranch}` : ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function setCollapsed(path, collapsed) {
  const folders = { ...(settings.value.folders || {}) };
  folders[path] = { ...(folders[path] || {}), collapsed };
  saveSettings({ folders });
}

function toggleRecents(path, show) {
  const next = new Set(recentsOpen.value);
  if (show ?? !next.has(path)) next.add(path);
  else next.delete(path);
  recentsOpen.value = next;
  if (next.has(path)) setCollapsed(path, false);
}

function folderMenu(e, path, open) {
  openContextMenu(e, [
    { label: t('New chat'), run: () => openSession({ cwd: path, kind: 'chat' }) },
    { label: t('New CLI session'), run: () => openSession({ cwd: path, kind: 'terminal' }) },
    { label: t('New shell'), run: () => openSession({ cwd: path, kind: 'shell' }) },
    '-',
    { label: t('Continue latest conversation'), run: () => openSession({ cwd: path, mode: 'continue' }) },
    { label: t('Recents'), hint: t('past conversations'), checked: recentsOpen.value.has(path), run: () => toggleRecents(path) },
    '-',
    { label: t('Open in file manager'), run: () => api.openPath(path) },
    { label: t('Copy path'), run: () => { api.writeClipboard(path); toast(t('Path copied.')); } },
    {
      label: t('Remove from list'),
      hint: open.length ? t('end its sessions first') : '',
      disabled: open.length > 0,
      run: () => forgetRecent(path),
    },
  ]);
}

// `open`: the folder's sessions; `shown`: those that match the search (all of them when not searching).
// While searching, folders with matches are shown open.
function Folder({ path, open, shown = open, searching }) {
  // Folded unless opened since launch (main.jsx clears the folder states at launch).
  const collapsed = !searching && (settings.value.folders?.[path]?.collapsed ?? true);
  const showRecents = recentsOpen.value.has(path);
  const busy = open.some((s) => s.status.value === 'working');
  const waiting = open.some((s) => s.status.value === 'attention' || s.status.value === 'needs-you');
  const containsActive = open.some((s) => s.uid === activeUid.value);

  return (
    <li class={`folder ${collapsed ? 'collapsed' : ''} ${containsActive ? 'has-active' : ''}`}>
      <div class="folder-row" onContextMenu={(e) => folderMenu(e, path, open)}>
        <button class="folder-main" title={tildify(path)} aria-expanded={!collapsed} onClick={() => setCollapsed(path, !collapsed)}>
          <span class="folder-chevron"><Icon name="chevron" size={13} /></span>
          <span class="folder-icon"><Icon name="folder" size={15} /></span>
          <span class="folder-name">{basename(path)}</span>
          {collapsed && waiting && <span class="folder-flag wait" title={t('A session here is waiting for you')} />}
          {collapsed && !waiting && busy && <span class="folder-flag busy" title={t('A session here is working')} />}
        </button>
        <button class="icon-btn folder-more" title={t('More options (or right-click)')} onClick={(e) => folderMenu(e, path, open)}>
          <Icon name="more" size={14} />
        </button>
        <button class="icon-btn folder-add" title={t('New session here')} onClick={() => openSession({ cwd: path })}>
          <Icon name="plus" size={14} />
        </button>
        {/* At the row's right end, with ⋯ and + showing to its left on hover. */}
        <span class="count">{open.length || ''}</span>
      </div>
      <Collapse open={!collapsed && shown.length > 0}>
        <ul class="session-list">{shown.map((s, i) => <SessionRow key={s.uid} s={s} index={i} />)}</ul>
      </Collapse>
      <Collapse open={!collapsed && showRecents && !searching}><Recents path={path} /></Collapse>
    </li>
  );
}

// Project search (Ctrl+Shift+F): filters the list by folder name or path and by session name as you type.
// Enter opens the first matching session, Esc clears and closes the box.
function ProjectSearch({ first }) {
  const input = useRef(null);
  const request = projectSearch.value;
  useEffect(() => {
    input.current.focus();
    input.current.select();
  }, [request]);
  const close = (refocus) => {
    query.value = '';
    projectSearch.value = 0;
    if (refocus) focusComposer();
  };
  return (
    <div class="project-search" role="search">
      <Icon name="search" size={14} />
      <input ref={input} type="text" value={query.value} spellcheck={false} placeholder={t('Search projects and sessions')}
             aria-label={t('Search projects and sessions ({key})', { key: SHORTCUTS.searchProjects })}
             onInput={(e) => { query.value = e.currentTarget.value; }}
             onBlur={() => { if (!query.value.trim()) close(false); }}
             onKeyDown={(e) => {
               e.stopPropagation();
               if (e.key === 'Escape') { e.preventDefault(); close(true); }
               if (e.key === 'Enter' && first) { e.preventDefault(); selectSession(first); close(false); }
             }} />
      {query.value && (
        <button class="icon-btn" title={t('Clear (Esc)')} onMouseDown={(e) => e.preventDefault()} onClick={() => close(true)}>
          <Icon name="x" size={12} />
        </button>
      )}
    </div>
  );
}

const includes = (text, q) => Boolean(text) && text.toLowerCase().includes(q);

export function Sidebar() {
  const list = sessions.value;
  // Folders: those with open sessions first (in opening order), then recent folders.
  const folders = [];
  for (const p of [...list.map((s) => s.cwd), ...(settings.value.recent || []).map((r) => r.path)]) {
    if (!folders.some((f) => samePath(f, p))) folders.push(p);
  }
  const searching = projectSearch.value > 0;
  const q = searching ? query.value.trim().toLowerCase() : '';
  // Each folder with its sessions and the sessions to show: a folder whose name or path matches shows all of
  // them, otherwise only the matching ones; folders with no match are left out.
  const rows = folders.map((path) => {
    const open = list.filter((s) => samePath(s.cwd, path));
    if (!q) return { path, open, shown: open };
    if (includes(basename(path), q) || includes(tildify(path), q)) return { path, open, shown: open };
    const shown = open.filter((s) => includes(sessionLabel(s), q) || includes(s.title.value, q));
    return shown.length ? { path, open, shown } : null;
  }).filter(Boolean);
  const collapse = () => saveSettings({ sidebarCollapsed: true });
  const toggleTheme = () => saveSettings({ theme: themeMode.value === 'dark' ? 'light' : 'dark' });

  return (
    <aside id="sidebar">
      <div class="sidebar-top drag">
        <div class="wordmark"><span class="wm-cc">cc</span><span class="wm-ui">UI</span></div>
        <button class="icon-btn no-drag" title={t('Hide sidebar')} onClick={collapse}><Icon name="sidebar" /></button>
      </div>

      <button class="new-session" onClick={() => { newSessionDialog.value = {}; }}>
        <Icon name="plus" />
        <span>{t('New session')}</span>
        <kbd>{SHORTCUTS.newSession}</kbd>
      </button>

      <div class="sidebar-scroll">
        <h2 class="section-label">
          {t('Projects')}
          {!searching && folders.length > 0 && (
            <button class="icon-btn section-action" title={t('Search projects and sessions ({key})', { key: SHORTCUTS.searchProjects })}
                    onClick={searchProjects}><Icon name="search" size={13} /></button>
          )}
        </h2>
        {searching && <ProjectSearch first={rows.find((r) => r.shown.length)?.shown[0]} />}
        {rows.length ? (
          <ul class="folder-list">
            {rows.map((r) => <Folder key={r.path} path={r.path} open={r.open} shown={r.shown} searching={Boolean(q)} />)}
          </ul>
        ) : (
          <p class="sidebar-hint">
            {q ? t('No projects or sessions match.') : t('Open a folder to start. Right-click a project for more options.')}
          </p>
        )}
      </div>

      <div class="sidebar-bottom">
        <button class="ghost-btn footer-row" onClick={() => { settingsDialog.value = true; }}>
          <span class="footer-icon"><Icon name="settings" /></span>{t('Settings')}
        </button>
        <button class="icon-btn" title={themeMode.value === 'dark' ? t('Switch to light theme') : t('Switch to dark theme')} onClick={toggleTheme}>
          <Icon name={themeMode.value === 'dark' ? 'sun' : 'moon'} />
        </button>
      </div>
    </aside>
  );
}
