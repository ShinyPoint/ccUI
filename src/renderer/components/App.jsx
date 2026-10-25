import { useEffect, useState } from 'preact/hooks';
import { Icon, Toasts, ContextMenu, ConfirmHost } from './ui.jsx';
import { Sidebar } from './Sidebar.jsx';
import { ChatView } from './chat/ChatView.jsx';
import { ModelMenu } from './chat/ModelMenu.jsx';
import { ProjectMenu } from './ProjectMenu.jsx';
import { TerminalStack, TerminalOverlay, TerminalComposer } from './TerminalPane.jsx';
import { NewSessionDialog } from './dialogs/NewSessionDialog.jsx';
import { SettingsDialog } from './dialogs/SettingsDialog.jsx';
import { SkillsDialog } from './dialogs/SkillsDialog.jsx';
import { InfoDialog } from './dialogs/InfoDialog.jsx';
import { TaskDialog } from './dialogs/TaskDialog.jsx';
import { PluginsDialog } from './dialogs/PluginsDialog.jsx';
import { SidePanel } from './SidePanel.jsx';
import { toggleChanges } from '../lib/side.js';
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
import { basename, tildify, formatDuration, fileManagerLabel } from '../lib/format.js';
import { t, phrase } from '../lib/i18n.js';

// A CLI or shell session's process, for the title's tooltip: "pid 4868 · 126×19 · up 5s".
function processInfo(s) {
  s.tick.value; // uptime moves every second
  if (!s.pid.value) return '';
  return [t('pid {pid}', { pid: s.pid.value }), s.size.value, t('up {time}', { time: formatDuration(Date.now() - s.startedAt.value) })].filter(Boolean).join(' · ');
}

// Minimize, maximize and close, drawn by the app (not on macOS, which keeps its traffic lights): they look like the
// top bar's other buttons and show the app's tooltips. Closing goes through the window's close handler, which asks
// first when sessions are still running.
function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    api.windowControls.isMaximized().then(setMaximized);
    return api.windowControls.onMaximized(setMaximized);
  }, []);
  if (info.value.platform === 'darwin') return null;
  return (
    <div class="window-controls no-drag">
      <button class="win-btn" title={t('Minimize')} onClick={() => api.windowControls.minimize()}>
        <Icon name="winMinimize" size={15} />
      </button>
      <button class="win-btn" title={maximized ? t('Restore') : t('Maximize')} onClick={() => api.windowControls.toggleMaximize()}>
        <Icon name={maximized ? 'winRestore' : 'winMaximize'} size={15} />
      </button>
      <button class="win-btn close" title={t('Close')} onClick={() => api.windowControls.close()}>
        <Icon name="x" size={15} />
      </button>
    </div>
  );
}

function Topbar({ s }) {
  const collapsed = settings.value.sidebarCollapsed;
  const kind = s?.kind.value;
  const proc = s && kind !== 'chat' ? processInfo(s) : '';
  const panelOpen = s?.panel.open.value;
  const task = s && (s.name.value || s.title.value); // a name you gave the session wins, as in the sidebar
  return (
    <header id="topbar" class="drag">
      {collapsed && (
        <button class="icon-btn no-drag" title={t('Show sidebar')} onClick={() => saveSettings({ sidebarCollapsed: false })}>
          <Icon name="sidebar" />
        </button>
      )}
      {s && (
        <div class="topbar-title">
          <ProjectMenu s={s} proc={proc} />
          {kind === 'chat' && <div class="no-drag"><ModelMenu s={s} /></div>}
          {task && <span class="top-task" title={proc || task}>{task}</span>}
        </div>
      )}
      {s && (
        <div class="topbar-actions no-drag">
          {kind === 'chat' && (
            <button class="text-btn" title={t('Continue this conversation in Claude Code’s own command-line interface')} onClick={() => {
              openInTerminal(s); // asks first if Claude is working or has background tasks running
            }}>
              <Icon name="terminal" />CLI
            </button>
          )}
          {kind === 'terminal' && (
            <button class="text-btn" title={t('Continue this conversation in the chat view')} onClick={() => openInChat(s)}>
              <Icon name="chat" />{t('Chat')}
            </button>
          )}
          <button class="icon-btn open-folder" title={`${fileManagerLabel()}: ${tildify(s.cwd)}`} onClick={() => api.openPath(s.cwd)}>
            <Icon name="folder" />
          </button>
          {kind === 'chat' && (
            <button class={`icon-btn changes-toggle ${s.side.value.open ? 'on' : ''}`} aria-pressed={s.side.value.open}
                    title={s.side.value.open ? t('Hide the files Claude changed ({key})', { key: SHORTCUTS.changes }) : t('Show the files Claude changed ({key})', { key: SHORTCUTS.changes })}
                    onClick={() => toggleChanges(s)}>
              <Icon name="panelRight" />
            </button>
          )}
          <button class={`icon-btn panel-toggle ${panelOpen ? 'on' : ''}`} aria-pressed={panelOpen}
                  title={t(panelOpen ? phrase('Hide a terminal in {folder} ({key})') : phrase('Open a terminal in {folder} ({key})'), { folder: tildify(s.cwd), key: SHORTCUTS.panel })}
                  onClick={() => togglePanel(s)}>
            <Icon name="panelBottom" />
          </button>
          {kind !== 'chat' && (
            <>
              <button class="icon-btn" title={kind === 'terminal' ? t('Restart (continues the conversation)') : t('Restart shell')} onClick={() => restartTerminal(s)}>
                <Icon name="refresh" />
              </button>
              <button class="icon-btn" title={t('Stop the process')} disabled={!s.pid.value} onClick={() => s.ptyId && api.pty.kill(s.ptyId)}>
                <Icon name="stop" />
              </button>
            </>
          )}
        </div>
      )}
      <WindowControls />
    </header>
  );
}

function EmptyState() {
  const recent = (settings.value.recent || []).slice(0, 6);
  const check = claudeCheck.value;
  const [askBefore, askAfter] = t('Where should Claude {work} today?').split('{work}');
  const [missingBefore, missingAfter] = t('Claude Code didn’t respond. Reinstall the app, or set the path to a {claude} executable in Settings.').split('{claude}');
  return (
    <div class="empty-state">
      <div class="empty-inner">
        <h1 class="empty-title">{askBefore}<em>{t('work')}</em>{askAfter}</h1>
        <p class="empty-lede">
          {t('Choose a project folder to start a session. Each session is a conversation with Claude Code, shown as a chat you can read and steer. Switch any session to Claude Code’s own CLI when you need it.')}
        </p>
        {/* Not downloaded yet (just installed) is fine: the first session downloads it. */}
        {check && !check.ok && !check.missing && (
          <p class="notice">
            {missingBefore}<code>claude</code>{missingAfter}
          </p>
        )}
        <div class="empty-actions">
          <button class="primary-btn" onClick={chooseFolderAndStart}>{t('Choose folder…')}</button>
          <button class="secondary-btn" onClick={() => { newSessionDialog.value = {}; }}>{t('More options')}</button>
        </div>
        {recent.length > 0 && (
          <div class="empty-recents">
            <h2 class="section-label">{t('Recent folders')}</h2>
            {recent.map(({ path }) => (
              <div class="empty-recent" key={path}>
                <div style="min-width:0">
                  <div class="name">{basename(path)}</div>
                  <div class="path">{tildify(path)}</div>
                </div>
                <button class="secondary-btn" onClick={() => openSession({ cwd: path, mode: 'continue' })}>{t('Continue')}</button>
                <button class="primary-btn" onClick={() => openSession({ cwd: path })}>{t('Start')}</button>
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
          {s && kind === 'chat' && <SidePanel key={`side-${s.uid}`} s={s} />}
          {!s && <EmptyState />}
        </div>
        {s && kind !== 'chat' && <TerminalComposer key={s.uid} s={s} />}
        <BottomPanel s={s} />
      </main>
      <NewSessionDialog />
      <SettingsDialog />
      <SkillsDialog />
      <InfoDialog />
      <TaskDialog />
      <PluginsDialog />
      <Toasts />
      <ContextMenu />
      <ConfirmHost />
    </div>
  );
}
