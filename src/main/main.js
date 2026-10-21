const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { pathToFileURL, fileURLToPath } = require('url');
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu, nativeTheme, screen, session } = require('electron');
const { PtyManager, claudeLaunch } = require('./pty');
const { AgentManager, listHistory, loadHistory, forkBefore } = require('./agent');
const { resolveClaude, bundledClaude, useDownloads } = require('./claude-binary');
const { ClaudeUpdater } = require('./claude-update');
const { shellEnvReady } = require('./shell-env');
const { listFiles, readProjectFile } = require('./files');
const { Settings } = require('./settings');
const { ensureTrusted, askNatively, trustDetail } = require('./trust');
const { t, setLanguage } = require('./i18n');
const { Background } = require('./background');

const isMac = process.platform === 'darwin';
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIR = path.join(__dirname, '..', '..', 'dist-renderer');
const APP_URL = DEV_URL || pathToFileURL(path.join(RENDERER_DIR, 'index.html')).href;

let win = null;
let settings = null;
let background = null;
let updater = null;
let quitConfirmed = false;
let quitAsking = false;

const send = (channel, ...args) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
};
// Questions for the user, shown as the app's own dialogs (ui.jsx confirmDialog): the window answers on app:answer.
// `fallback` (the system's message box) is used when there is no window that can ask.
const asks = new Map();
let askId = 0;
function askWindow(kind, payload, fallback) {
  if (!win || win.isDestroyed() || win.webContents.isCrashed() || win.webContents.isLoading()) return Promise.resolve(fallback());
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  const id = ++askId;
  return new Promise((resolve) => {
    asks.set(id, resolve);
    send('app:ask', id, kind, payload);
  });
}
// A window that reloads or goes away can't answer any more: the questions count as declined.
function dropAsks() {
  for (const resolve of asks.values()) resolve(false);
  asks.clear();
}

const ptys = new PtyManager(send);
const agents = new AgentManager(send);

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

function boundsOnScreen(b) {
  if (!b) return false;
  return screen.getAllDisplays().some(({ workArea: a }) =>
    b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y);
}

const APP_ID = 'dev.ccui.app'; // = build.appId in package.json

// Frosted glass behind the sidebar: the system's own blurred material (acrylic on Windows 11 22H2+, vibrancy
// on macOS). The page is transparent where the sidebar is, so the material shows through it.
const GLASS_SUPPORTED = isMac || (process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621);
const solidBackground = () => (nativeTheme.shouldUseDarkColors ? '#1A1A1C' : '#F9FAFB'); // = --chrome (app.css)

function applyGlass(on) {
  if (!win || win.isDestroyed() || !GLASS_SUPPORTED) return;
  win.setBackgroundColor(on ? '#00000000' : solidBackground());
  if (isMac) win.setVibrancy(on ? 'sidebar' : null);
  else win.setBackgroundMaterial(on ? 'acrylic' : 'none');
}

// One line per problem in <user data>/crash.log, with the memory in use then (kept under 200 KB).
function logProblem(what) {
  try {
    const file = path.join(app.getPath('userData'), 'crash.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 200 * 1024) fs.renameSync(file, `${file}.old`);
    const mem = app.getAppMetrics().map((m) => `${m.type} ${Math.round(m.memory.workingSetSize / 1024)}MB`).join(', ');
    fs.appendFileSync(file, `${new Date().toISOString()} ${what} | ${mem}\n`);
  } catch { /* nowhere to write */ }
}

function createWindow() {
  const saved = settings.get().bounds;
  const glass = GLASS_SUPPORTED && settings.get().sidebarGlass;
  win = new BrowserWindow({
    ...(boundsOnScreen(saved) ? saved : { width: 1320, height: 860 }),
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: 'ccUI',
    // Taskbar / window icon (scripts/make-icon.js). Windows needs the .ico: its small sizes are drawn separately.
    icon: path.join(__dirname, '..', '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    backgroundColor: glass ? '#00000000' : solidBackground(),
    ...(glass ? (isMac ? { vibrancy: 'sidebar' } : { backgroundMaterial: 'acrylic' }) : {}),
    // No system title bar. macOS keeps its traffic lights; elsewhere the top bar draws its own minimize, maximize
    // and close buttons (WindowControls in App.jsx), so they look and explain themselves like the rest of the app.
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 14, y: 13 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.platform === 'win32') {
    // The taskbar takes its icon and name from the app id's details, not the window icon: without this it shows
    // electron.exe's icon and "Electron" when running from source. Windows ignores the icon and the name unless a
    // relaunch command is set too. A packaged build points at its own .exe (it carries the icon, and Windows
    // cannot read files inside app.asar).
    win.setAppDetails({
      appId: APP_ID,
      appIconPath: app.isPackaged ? process.execPath : path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
      appIconIndex: 0,
      relaunchCommand: app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${app.getAppPath()}"`,
      relaunchDisplayName: 'ccUI',
    });
  }

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', '..', 'dist-renderer', 'index.html'));
  win.once('ready-to-show', () => {
    // Maximizing shows the window, so it waits until there is something to show.
    if (saved?.maximized) win.maximize();
    win.show();
  });

  // A reload or a crashed renderer loses every session's UI: end the sessions instead of leaving them running
  // with nobody to answer their permission prompts (a reloaded window would also resume the same conversations).
  let loaded = false;
  win.webContents.on('did-finish-load', () => { loaded = true; });
  win.webContents.on('did-start-loading', () => {
    if (!loaded) return;
    ptys.killAll();
    agents.closeAll();
  });
  // The window's process gone (a crash, or out of memory): noted in crash.log, and the window loads again, which
  // brings the sessions back from the saved list. Not more than three times in ten minutes.
  const crashes = [];
  win.webContents.on('render-process-gone', (_e, details) => {
    ptys.killAll();
    agents.closeAll();
    logProblem(`window process gone: ${details.reason} (exit code ${details.exitCode})`);
    if (details.reason === 'clean-exit' || win.isDestroyed()) return;
    const now = Date.now();
    crashes.push(now);
    while (crashes.length && now - crashes[0] > 10 * 60 * 1000) crashes.shift();
    if (crashes.length <= 3) setTimeout(() => { if (!win.isDestroyed()) win.webContents.reload(); }, 500);
  });
  win.on('unresponsive', () => logProblem('window not responding'));
  win.on('responsive', () => logProblem('window responding again'));

  // Never navigate away from the app shell; links open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!DEV_URL || !url.startsWith(DEV_URL)) e.preventDefault();
  });

  win.webContents.on('did-start-loading', dropAsks);
  win.webContents.on('render-process-gone', dropAsks);
  win.on('close', (e) => {
    const live = ptys.liveCount + agents.liveCount;
    if (!quitConfirmed && live > 0 && settings.get().confirmClose) {
      // Asked in the window; the window closes again once the answer is yes.
      e.preventDefault();
      if (quitAsking) return;
      quitAsking = true;
      askWindow('quit', { count: live }, () => dialog.showMessageBoxSync(win, {
        type: 'question',
        buttons: [t('End sessions and quit'), t('Cancel')],
        defaultId: 0,
        cancelId: 1,
        message: live === 1 ? t('1 session is still running.') : t('{n} sessions are still running.', { n: live }),
        detail: t('Quitting ends them. Conversations are saved, so you can continue them later.'),
      }) === 0).then((yes) => {
        quitAsking = false;
        if (!yes || !win || win.isDestroyed()) return;
        quitConfirmed = true;
        win.close();
      });
      return;
    }
    quitConfirmed = true;
    settings.setPrivate({ bounds: { ...win.getNormalBounds(), maximized: win.isMaximized() } });
    ptys.killAll();
    agents.closeAll();
  });
  for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    win.on(event, () => send('window:maximized', win.isMaximized() || win.isFullScreen()));
  }
  win.on('closed', () => { win = null; dropAsks(); });
}

// Every request from the window must come from the app's own page (not from other content in it).
function fromApp(e) {
  const url = e.senderFrame?.url || '';
  if (!url) return false;
  if (DEV_URL) return url.startsWith(DEV_URL);
  return url === APP_URL || url.startsWith(`${APP_URL}#`) || url.startsWith(`${APP_URL}?`);
}

// The app loads from file:// (where the page's 'self' covers every file: URL). Allow only its own files, and
// never a file: URL with a host: on Windows that is a network share, which would leak the user's credentials
// to that host just by rendering, e.g., an image Claude was tricked into writing.
function guardRequests() {
  const root = path.resolve(RENDERER_DIR).toLowerCase();
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['file://*/*'] }, (details, callback) => {
    let allowed = false;
    try {
      const url = new URL(details.url);
      allowed = !url.host && path.resolve(fileURLToPath(url)).toLowerCase().startsWith(root + path.sep);
    } catch { /* malformed: refuse */ }
    callback({ cancel: !allowed });
  });
  // No camera, microphone, location and the like; notifications are the only permission the app uses.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'notifications'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'notifications');
}

async function detectClaude(custom) {
  await shellEnvReady;
  const claude = resolveClaude(custom);
  const { file, args } = claudeLaunch(claude, ['--version']);
  return new Promise((resolve) => {
    execFile(file, typeof args === 'string' ? [args] : args, {
      timeout: 20000,
      windowsHide: true,
      windowsVerbatimArguments: typeof args === 'string',
    }, (err, stdout) => {
      const match = /(\d+\.\d+\.\d+)/.exec(stdout || '');
      if (match) resolve({ ok: true, version: match[1], bundled: !!claude.bundled, chatCapable: !!claude.file });
      else resolve({ ok: false, error: (err && err.message) || t('No version reported') });
    });
  });
}

function registerIpc() {
  // Like ipcMain, but every handler first checks where the request comes from.
  const ipc = {
    handle: (channel, fn) => ipcMain.handle(channel, (e, ...args) => (fromApp(e) ? fn(e, ...args) : undefined)),
    on: (channel, fn) => ipcMain.on(channel, (e, ...args) => { if (fromApp(e)) fn(e, ...args); }),
  };
  ipc.handle('app:info', () => ({
    platform: process.platform,
    home: os.homedir(),
    version: app.getVersion(),
    windowsBuild: process.platform === 'win32' ? Number(os.release().split('.')[2]) : 0,
    hasBundledClaude: Boolean(bundledClaude()),
    glassSupported: GLASS_SUPPORTED,
  }));
  ipc.handle('app:detect-claude', (_e, custom) => detectClaude(custom));
  ipc.on('app:answer', (_e, id, value) => {
    const resolve = asks.get(id);
    asks.delete(id);
    resolve?.(value === true);
  });

  ipc.handle('settings:get', () => settings.get());
  ipc.handle('settings:set', (_e, patch) => {
    const next = settings.set(patch);
    updater.configure(); // automatic updates, or a Claude Code of your own, may have been switched
    if (patch && 'language' in patch) {
      setLanguage(next.language, app.getLocale());
      buildMenu();
    }
    return next;
  });

  // Updates of the built-in Claude Code (claude-update.js)
  ipc.handle('claude-update:state', () => updater.status);
  ipc.handle('claude-update:check', () => updater.check());
  ipc.handle('claude-update:run', () => updater.update());
  ipc.handle('settings:set-api-key', (_e, key) => {
    try {
      return { ok: true, settings: settings.setApiKey(key) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipc.handle('dialog:pick-folder', async (_e, defaultPath) => {
    const result = await dialog.showOpenDialog(win, {
      title: t('Choose a project folder'),
      defaultPath: defaultPath || os.homedir(),
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipc.handle('dialog:pick-file', async (_e, title) => {
    const result = await dialog.showOpenDialog(win, { title, properties: ['openFile'] });
    return result.canceled ? null : result.filePaths[0];
  });

  // Terminal sessions
  ipc.handle('pty:create', async (_e, opts) => {
    try {
      await shellEnvReady;
      const { id, proc } = ptys.create({ ...opts, claude: resolveClaude(settings.get().claudePath) });
      // ConPTY reports the pid a moment after spawning.
      for (let i = 0; i < 40 && !proc.pid; i++) await new Promise((r) => setTimeout(r, 25));
      return { ok: true, id, pid: proc.pid };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipc.on('pty:write', (_e, id, data) => ptys.write(id, data));
  ipc.on('pty:resize', (_e, id, cols, rows) => ptys.resize(id, cols, rows));
  ipc.on('pty:kill', (_e, id) => ptys.kill(id));

  // Chat sessions
  ipc.handle('agent:start', async (_e, opts) => {
    if (!opts?.cwd || !fs.existsSync(opts.cwd) || !fs.statSync(opts.cwd).isDirectory()) {
      return { ok: false, code: 'folder', error: t('Folder not found: {path}', { path: opts?.cwd }) };
    }
    const claude = resolveClaude(settings.get().claudePath);
    if (!claude.file) {
      return {
        ok: false,
        code: 'no-binary',
        error: t('Chat sessions need a Claude Code executable (claude.exe or claude), not a command name or a .cmd script. Choose one in Settings, or leave the setting empty to use the built-in Claude Code.'),
      };
    }
    const askTrust = (cwd) => askWindow('trust', { folder: cwd, detail: trustDetail() }, () => askNatively(win, cwd));
    if (!(await ensureTrusted(settings, win, opts.cwd, askTrust))) {
      return { ok: false, code: 'untrusted', error: t('You did not trust this folder, so Claude Code was not started there.') };
    }
    return agents.start({ ...opts, claudeFile: claude.file, apiKey: settings.getApiKey() });
  });
  ipc.on('agent:send', (_e, id, payload) => agents.get(id)?.send(payload));
  ipc.on('agent:permission-reply', (_e, id, requestId, answer) => agents.get(id)?.answerPermission(requestId, answer));
  ipc.handle('agent:control', (_e, id, action, arg) =>
    agents.get(id)?.control(action, arg) ?? { ok: false, error: t('Session is not running.') });
  ipc.on('agent:close', (_e, id) => agents.close(id));

  ipc.handle('history:list', async (_e, cwd) => {
    try {
      return { ok: true, sessions: await listHistory(cwd) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipc.handle('history:messages', async (_e, sessionId, cwd) => {
    try {
      return { ok: true, messages: await loadHistory(sessionId, cwd) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipc.handle('history:fork', async (_e, sessionId, cwd, uuid) => {
    try {
      return { ok: true, ...(await forkBefore(sessionId, cwd, uuid)) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipc.handle('files:list', (_e, cwd) => listFiles(cwd).catch(() => []));
  // /export: the conversation as text, saved where the user picks (the system's Save dialog).
  ipc.handle('dialog:save-text', async (_e, { name, text, cwd }) => {
    if (typeof text !== 'string') return { ok: false, error: t('Nothing to save.') };
    const result = await dialog.showSaveDialog(win, {
      title: t('Export the conversation'),
      defaultPath: path.join(cwd && fs.existsSync(cwd) ? cwd : app.getPath('documents'), path.basename(String(name || 'conversation.txt'))),
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(result.filePath, text);
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  // /memory: opens an instructions file Claude Code reads in the system's editor, created empty if it isn't there
  // yet. Only CLAUDE.md / CLAUDE.local.md, in a folder that exists.
  ipc.handle('files:open-memory', async (_e, file) => {
    const full = path.resolve(String(file || ''));
    if (!/^CLAUDE(\.local)?\.md$/i.test(path.basename(full)) || !fs.existsSync(path.dirname(full))) return { ok: false, error: t('Not an instructions file.') };
    try {
      if (!fs.existsSync(full)) fs.writeFileSync(full, '', { flag: 'wx' });
      const error = await shell.openPath(full);
      return error ? { ok: false, error } : { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipc.handle('files:read', (_e, cwd, file) => readProjectFile(cwd, file).catch(() => ({ ok: false, reason: 'missing' })));

  ipc.handle('clipboard:read', () => clipboard.readText());
  ipc.on('clipboard:write', (_e, text) => clipboard.writeText(String(text)));

  // Only folders (e.g. "Open in file manager"): opening a file would run it if it is a program.
  ipc.on('shell:open-path', (_e, p) => {
    try {
      if (typeof p === 'string' && fs.statSync(p).isDirectory()) shell.openPath(p);
    } catch { /* gone */ }
  });
  ipc.on('shell:open-external', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
  });

  ipc.on('theme:source', (_e, source) => { nativeTheme.themeSource = source; });
  ipc.on('window:glass', (_e, on) => applyGlass(Boolean(on)));
  ipc.handle('background:pick', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: t('Choose a background image'),
      properties: ['openFile'],
      filters: [{ name: t('Images'), extensions: Background.extensions() }],
    });
    return result.canceled ? { ok: false, canceled: true } : background.use(result.filePaths[0]);
  });
  ipc.handle('background:clear', () => background.clear());
  ipc.handle('background:read', () => background.read());
  // The window buttons drawn by the top bar (not on macOS).
  ipc.on('window:minimize', () => win?.minimize());
  ipc.on('window:toggle-maximize', () => {
    if (!win) return;
    if (win.isFullScreen()) win.setFullScreen(false);
    else if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipc.on('window:close', () => win?.close()); // asks first when sessions are running (the close handler)
  ipc.handle('window:is-maximized', () => Boolean(win && (win.isMaximized() || win.isFullScreen())));
  ipc.on('window:focus', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  ipc.on('window:devtools', () => { if (!app.isPackaged) win?.webContents.toggleDevTools(); });
  ipc.on('window:badge', (_e, count) => {
    if (isMac) app.dock?.setBadge(count ? String(count) : '');
    else if (win && !win.isFocused() && count) win.flashFrame(true);
  });
}

// Built again when the language changes (settings:set).
function buildMenu() {
  // The window has no visible menu bar; on macOS the menu keeps standard Cmd shortcuts working.
  if (!isMac) return Menu.setApplicationMenu(null);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: t('View'), submenu: [{ role: 'reload' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]), { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
}

app.setAppUserModelId(APP_ID);

app.whenReady().then(() => {
  if (!primaryInstance) return;
  settings = new Settings(app.getPath('userData'));
  setLanguage(settings.get().language, app.getLocale()); // before the menu and any dialog
  background = new Background(app.getPath('userData'), settings);
  useDownloads(path.join(app.getPath('userData'), 'claude-code'));
  updater = new ClaudeUpdater(path.join(app.getPath('userData'), 'claude-code'), settings, send);
  updater.configure();
  nativeTheme.themeSource = settings.get().theme;
  guardRequests();
  registerIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});

// Quitting (Cmd+Q, the Dock, the app menu) goes through the window's close handler first, so that "sessions
// are still running" can be answered before anything is ended.
app.on('before-quit', (e) => {
  if (!quitConfirmed && win && !win.isDestroyed()) {
    e.preventDefault();
    win.close();
    return;
  }
  ptys.killAll();
  agents.closeAll();
});
app.on('window-all-closed', () => app.quit());
