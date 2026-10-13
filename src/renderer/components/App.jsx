import { useEffect } from 'preact/hooks';
import { Icon, Toasts, ContextMenu } from './ui.jsx';
import { Sidebar, STATE_WORDS } from './Sidebar.jsx';
import { ChatView } from './chat/ChatView.jsx';
import { MODE_LABELS } from './chat/Prompts.jsx';
import { TerminalStack, TerminalOverlay, TerminalComposer } from './TerminalPane.jsx';
import { NewSessionDialog } from './dialogs/NewSessionDialog.jsx';
import { SettingsDialog } from './dialogs/SettingsDialog.jsx';
import {
  api, active, sessions, settings, saveSettings, claudeCheck, info, newSessionDialog, themeMode,
} from '../lib/store.js';
import { terminalMode } from '../lib/terminal.js';
import { togglePanel } from '../lib/panel.js';
import { SHORTCUTS } from '../lib/keyboard.js';
import { BottomPanel } from './BottomPanel.jsx';
import {
  displayName, openSession, openInTerminal, openInChat, restartTerminal, chooseFolderAndStart,
} from '../lib/sessions.js';
import { basename, tildify, formatCost, formatDuration, formatTokens } from '../lib/format.js';

function Topbar({ s }) {
  const collapsed = settings.value.sidebarCollapsed;
  const kind = s?.kind.value;
  return (
    <header id="topbar" class="drag">
      {collapsed && (
        <button class="icon-btn no-drag" title="Show sidebar" onClick={() => saveSettings({ sidebarCollapsed: false })}>
          <Icon name="sidebar" />
        </button>
      )}
      {s && (
        <div class="topbar-title">
          <span class="top-name">{displayName(s)}</span>
          <button class="path-chip no-drag" title={`Open ${s.cwd}`} onClick={() => api.openPath(s.cwd)}>{tildify(s.cwd)}</button>
          {s.title.value && <span class="top-task">{s.title.value}</span>}
        </div>
      )}
      {s && (
        <div class="topbar-actions no-drag">
          {kind === 'chat' && (
            <button class="text-btn" title="Continue this conversation in Claude Code’s own command-line interface" onClick={() => {
              if (!s.chat.value.busy || window.confirm('Claude is still working. Stop it and switch to the CLI?')) openInTerminal(s);
            }}>
              <Icon name="terminal" />CLI
            </button>
          )}
          {kind === 'terminal' && (
            <button class="text-btn" title="Continue this conversation in the chat view" onClick={() => openInChat(s)}>
              <Icon name="chat" />Chat
            </button>
          )}
          {kind !== 'chat' && (
            <>
              <button class="icon-btn" title={kind === 'terminal' ? 'Restart (continues the conversation)' : 'Restart shell'} onClick={() => restartTerminal(s)}>
                <Icon name="refresh" />
              </button>
              <button class="icon-btn" title="Stop the process" disabled={!s.pid.value} onClick={() => s.ptyId && api.pty.kill(s.ptyId)}>
                <Icon name="stop" />
              </button>
            </>
          )}
        </div>
      )}
    </header>
  );
}

function StatusBar({ s }) {
  const check = claudeCheck.value;
  const version = check ? (check.ok ? `Claude Code ${check.version}${check.bundled ? '' : ' (custom)'}` : 'Claude Code not found') : '';
  if (!s) return <footer id="statusbar"><span class="spacer" /><span>{version}</span></footer>;
  const panelOpen = s.panel.open.value;
  const panelButton = (
    <button class={`st-btn ${panelOpen ? 'on' : ''}`} aria-pressed={panelOpen}
            title={`${panelOpen ? 'Hide' : 'Open'} a shell in ${s.cwd} (${SHORTCUTS.panel})`} onClick={() => togglePanel(s)}>
      <Icon name="terminal" size={12} />Terminal
    </button>
  );
  s.traceTick.value; // refresh uptime every second
  const status = s.status.value;
  const parts = [];
  if (s.kind.value === 'chat') {
    const chat = s.chat.value;
    if (chat.init?.model) parts.push(chat.init.model.replace(/^claude-/, ''));
    if (chat.init?.permissionMode) parts.push(MODE_LABELS[chat.init.permissionMode] || chat.init.permissionMode);
    const ctx = s.context.value;
    if (ctx?.maxTokens) parts.push(`${formatTokens(ctx.totalTokens)} / ${formatTokens(ctx.maxTokens)} context`);
    if (chat.costTotal) parts.push(`${formatCost(chat.costTotal)} this session`);
  } else {
    if (s.pid.value) parts.push(`pid ${s.pid.value}`);
    if (s.size.value) parts.push(s.size.value);
    if (s.pid.value) parts.push(`up ${formatDuration(Date.now() - s.startedAt.value)}`);
  }
  return (
    <footer id="statusbar">
      <span class="st-state" data-status={status}>{STATE_WORDS[status]}</span>
      {parts.map((p) => <span key={p}>{p}</span>)}
      <span class="spacer" />
      {panelButton}
      <span>{version}</span>
    </footer>
  );
}

function EmptyState() {
  const recent = (settings.value.recent || []).slice(0, 6);
  const check = claudeCheck.value;
  return (
    <div class="empty-state">
      <div class="empty-inner">
        <h1 class="empty-title">Where should Claude <em>work</em> today?</h1>
        <p class="empty-lede">
          Choose a project folder to start a session. Each session is a conversation with Claude Code, shown as a chat
          you can read and steer. Switch any session to Claude Code’s own CLI when you need it.
        </p>
        {check && !check.ok && (
          <p class="notice">
            Claude Code didn’t respond. Reinstall the app, or set the path to a <code>claude</code> executable in Settings.
          </p>
        )}
        <div class="empty-actions">
          <button class="primary-btn" onClick={chooseFolderAndStart}>Choose folder…</button>
          <button class="secondary-btn" onClick={() => { newSessionDialog.value = {}; }}>More options</button>
        </div>
        {recent.length > 0 && (
          <div class="empty-recents">
            <h2 class="section-label">Recent folders</h2>
            {recent.map(({ path }) => (
              <div class="empty-recent" key={path}>
                <div style="min-width:0">
                  <div class="name">{basename(path)}</div>
                  <div class="path">{tildify(path)}</div>
                </div>
                <button class="secondary-btn" onClick={() => openSession({ cwd: path, mode: 'continue' })}>Continue</button>
                <button class="primary-btn" onClick={() => openSession({ cwd: path })}>Start</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function App() {
  const s = active.value;
  const kind = s?.kind.value;
  const platform = info.value.platform;

  useEffect(() => {
    document.body.classList.add(`platform-${platform}`);
  }, [platform]);
  document.body.classList.toggle('sidebar-collapsed', Boolean(settings.value.sidebarCollapsed));
  document.body.classList.toggle('no-session', !s);
  document.title = s ? `${displayName(s)} — ccUI` : 'ccUI';
  sessions.value; // re-render when sessions change

  return (
    <div id="app">
      <Sidebar />
      <main id="main">
        <Topbar s={s} />
        <div id="stage" class={kind && kind !== 'chat' ? `mode-terminal ${terminalMode() === 'dark' && themeMode.value === 'light' ? 'term-dark' : ''}` : ''}>
          <TerminalStack />
          {s && kind !== 'chat' && <TerminalOverlay s={s} />}
          {s && kind === 'chat' && <ChatView key={s.uid} s={s} />}
          {!s && <EmptyState />}
        </div>
        {s && kind !== 'chat' && <TerminalComposer key={s.uid} s={s} />}
        <BottomPanel s={s} />
        <StatusBar s={s} />
      </main>
      <NewSessionDialog />
      <SettingsDialog />
      <Toasts />
      <ContextMenu />
    </div>
  );
}
