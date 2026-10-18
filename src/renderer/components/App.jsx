import { useEffect } from 'preact/hooks';
import { Icon, Toasts, ContextMenu, openContextMenu, ConfirmHost } from './ui.jsx';
import { Sidebar } from './Sidebar.jsx';
import { ChatView } from './chat/ChatView.jsx';
import { TerminalStack, TerminalOverlay, TerminalComposer } from './TerminalPane.jsx';
import { NewSessionDialog } from './dialogs/NewSessionDialog.jsx';
import { SettingsDialog } from './dialogs/SettingsDialog.jsx';
import { SkillsDialog } from './dialogs/SkillsDialog.jsx';
import { SidePanel } from './SidePanel.jsx';
import { toggleChanges } from '../lib/side.js';
import {
  api, active, sessions, settings, saveSettings, claudeCheck, info, newSessionDialog, themeMode, toast,
} from '../lib/store.js';
import { terminalMode } from '../lib/terminal.js';
import { togglePanel } from '../lib/panel.js';
import { SHORTCUTS } from '../lib/keyboard.js';
import { BottomPanel } from './BottomPanel.jsx';
import {
  displayName, openSession, openInTerminal, openInChat, restartTerminal, chooseFolderAndStart,
} from '../lib/sessions.js';
import { basename, tildify, formatDuration } from '../lib/format.js';

// A CLI or shell session's process, for the title's tooltip: "pid 4868 · 126×19 · up 5s".
function processInfo(s) {
  s.traceTick.value; // uptime moves every second
  if (!s.pid.value) return '';
  return [`pid ${s.pid.value}`, s.size.value, `up ${formatDuration(Date.now() - s.startedAt.value)}`].filter(Boolean).join(' · ');
}

function Topbar({ s }) {
  const collapsed = settings.value.sidebarCollapsed;
  const kind = s?.kind.value;
  const proc = s && kind !== 'chat' ? processInfo(s) : '';
  const panelOpen = s?.panel.open.value;
  return (
    <header id="topbar" class="drag">
      {collapsed && (
        <button class="icon-btn no-drag" title="Show sidebar" onClick={() => saveSettings({ sidebarCollapsed: false })}>
          <Icon name="sidebar" />
        </button>
      )}
      {s && (
        <div class="topbar-title">
          <button class="project-btn no-drag" title={`${tildify(s.cwd)}
Click to open in the file manager${proc ? `
${proc}` : ''}`}
                  onClick={() => api.openPath(s.cwd)}
                  onContextMenu={(e) => openContextMenu(e, [
                    { label: 'Open in file manager', run: () => api.openPath(s.cwd) },
                    { label: 'Copy path', run: () => { api.writeClipboard(s.cwd); toast('Path copied.'); } },
                  ])}>
            <Icon name="folder" size={15} />
            <span>{basename(s.cwd)}</span>
          </button>
          {s.title.value && <span class="top-task" title={proc || s.title.value}>{s.title.value}</span>}
        </div>
      )}
      {s && (
        <div class="topbar-actions no-drag">
          {kind === 'chat' && (
            <button class="text-btn" title="Continue this conversation in Claude Code’s own command-line interface" onClick={() => {
              openInTerminal(s); // asks first if Claude is working or has background tasks running
            }}>
              <Icon name="terminal" />CLI
            </button>
          )}
          {kind === 'terminal' && (
            <button class="text-btn" title="Continue this conversation in the chat view" onClick={() => openInChat(s)}>
              <Icon name="chat" />Chat
            </button>
          )}
          {kind === 'chat' && (
            <button class={`icon-btn changes-toggle ${s.side.value.open ? 'on' : ''}`} aria-pressed={s.side.value.open}
                    title={`${s.side.value.open ? 'Hide' : 'Show'} the files Claude changed (${SHORTCUTS.changes})`}
                    onClick={() => toggleChanges(s)}>
              <Icon name="panelRight" />
            </button>
          )}
          <button class={`icon-btn panel-toggle ${panelOpen ? 'on' : ''}`} aria-pressed={panelOpen}
                  title={`${panelOpen ? 'Hide' : 'Open'} a terminal in ${tildify(s.cwd)} (${SHORTCUTS.panel})`}
                  onClick={() => togglePanel(s)}>
            <Icon name="panelBottom" />
          </button>
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
          {s && kind === 'chat' && <SidePanel key={s.uid} s={s} />}
          {!s && <EmptyState />}
        </div>
        {s && kind !== 'chat' && <TerminalComposer key={s.uid} s={s} />}
        <BottomPanel s={s} />
      </main>
      <NewSessionDialog />
      <SettingsDialog />
      <SkillsDialog />
      <Toasts />
      <ContextMenu />
      <ConfirmHost />
    </div>
  );
}
