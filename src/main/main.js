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
const { shellEnvReady, childEnv } = require('./shell-env');
const { listFiles, readProjectFile } = require('./files');
const { Settings } = require('./settings');
const { ensureTrusted, isTrusted, askNatively, trustDetail } = require('./trust');
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
// Started from source (`electron .`: npm start, npm run dev). Not app.isPackaged, which only looks at the
// executable's name: from source on Windows the app runs as ccUI.exe too (scripts/launch.mjs).
const FROM_SOURCE = Boolean(process.defaultApp);

// Frosted glass behind the sidebar: the system's own blurred material (acrylic on Windows 11 22H2+, vibrancy
// on macOS). The page is transparent where the sidebar is, so the material shows through it.
const GLASS_SUPPORTED = isMac || (process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621);
// The glass also needs the GPU to put the page on it: without hardware compositing (no graphics driver, a virtual
// machine, Remote Desktop, a GPU process that crashed) the window shows the material and nothing else.
const canGlass = () => GLASS_SUPPORTED && app.getGPUFeatureStatus().gpu_compositing === 'enabled';
// Whether the GPU composites is known a moment after start (gpu-info-update, about 0.2 s): the window waits for
// it, 2 s at most. Listened for from the start, as it can come before `ready`.
const gpuKnown = new Promise((resolve) => {
  app.once('gpu-info-update', resolve);
  setTimeout(resolve, 2000);
});
let glassAvailable = null;
const solidBackground = () => (nativeTheme.shouldUseDarkColors ? '#1A1A1C' : '#F9FAFB'); // = --chrome (app.css)

function applyGlass(on) {
  if (!win || win.isDestroyed() || !GLASS_SUPPORTED) return;
  on = on && canGlass();
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

// The UI scale (Settings → Appearance) is applied by the window itself (preload setZoom); the smallest window
// grows with it, so the layout keeps the room it was made for.
const MIN_SIZE = [760, 480];
const uiScale = () => Math.min(150, Math.max(80, Number(settings.get().uiScale) || 105)) / 100;
function applyMinSize() {
  if (!win || win.isDestroyed()) return;
  const [w, h] = MIN_SIZE.map((n) => Math.round(n * uiScale()));
  win.setMinimumSize(w, h);
  const [cw, ch] = win.getSize();
  if (cw < w || ch < h) win.setSize(Math.max(cw, w), Math.max(ch, h));
}

function createWindow() {
  const saved = settings.get().bounds;
  const glass = canGlass() && settings.get().sidebarGlass;
  win = new BrowserWindow({
    ...(boundsOnScreen(saved) ? saved : { width: 1320, height: 860 }),
    minWidth: Math.round(MIN_SIZE[0] * uiScale()),
    minHeight: Math.round(MIN_SIZE[1] * uiScale()),
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
    // What pinning the taskbar button relaunches, and with which name and icon (Windows ignores the icon and the
    // name unless a relaunch command is set too). The button itself is named after the executable: from source
    // it is ccUI.exe (scripts/launch.mjs). A packaged build points at its own .exe (it carries the icon, and
    // Windows cannot read files inside app.asar).
    win.setAppDetails({
      appId: APP_ID,
      appIconPath: FROM_SOURCE ? path.join(__dirname, '..', '..', 'assets', 'icon.ico') : process.execPath,
      appIconIndex: 0,
      relaunchCommand: FROM_SOURCE ? `"${process.execPath}" "${app.getAppPath()}"` : `"${process.execPath}"`,
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

// The Claude Code sessions start with: the Settings choice (a file of your own, or the built-in one in the
// version chosen there).
const currentClaude = () => resolveClaude(settings.get().claudePath, settings.get().claudeVersion);

// Like currentClaude, but when the built-in one isn't downloaded yet, it is first (the first session after
// installing). { file | command } or { error } when the download failed.
// What Claude Code gets in its environment from the app's settings, for chat and CLI sessions. Claude Code keeps a
// task list (TodoWrite, the Task tools) on older models only; Opus 5 and later get it when asked for.
const claudeEnv = () => (settings.get().taskList ? { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' } : {});

async function claudeForSession() {
  if (!currentClaude().missing) return currentClaude();
  await updater.ensure();
  const claude = currentClaude();
  if (!claude.missing) return claude;
  return { error: t('Claude Code could not be downloaded: {reason}', { reason: updater.status.error || t('unknown error') }) };
}

async function detectClaude(custom) {
  await shellEnvReady;
  const claude = resolveClaude(custom, settings.get().claudeVersion);
  // Not downloaded yet: not a problem, it is before the first session (claude-update.js).
  if (claude.missing) return { ok: false, missing: true };
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
    hasBundledClaude: Boolean(bundledClaude(settings.get().claudeVersion)),
    glassSupported: GLASS_SUPPORTED,
    glassAvailable: canGlass(),
  }));
  ipc.handle('app:detect-claude', (_e, custom) => detectClaude(custom));
  // A background task's output, for its details in the window: the end of the file Claude Code writes it to. Only
  // such files: <something claude>/…/tasks/<id>.output, under the temp folder.
  ipc.handle('task:output', (_e, file) => {
    const full = path.resolve(String(file || ''));
    const inTemp = [os.tmpdir(), '/tmp'].some((dir) => full.toLowerCase().startsWith(path.resolve(dir).toLowerCase() + path.sep));
    if (!inTemp || !/[\\/]claude[^\\/]*[\\/](?:.+[\\/])?tasks[\\/][^\\/]+\.output$/i.test(full)) return { ok: false };
    try {
      const size = fs.statSync(full).size;
      const length = Math.min(size, 64 * 1024);
      const buf = Buffer.alloc(length);
      const fd = fs.openSync(full, 'r');
      try { fs.readSync(fd, buf, 0, length, size - length); } finally { fs.closeSync(fd); }
      return { ok: true, text: buf.toString('utf8'), cut: size > length };
    } catch {
      return { ok: false };
    }
  });
  // Plugins, through Claude Code's own `claude plugin` commands (what /plugin does in its CLI), so the app and the CLI
  // always agree. `cwd`: the folder whose project settings count (a plugin can be on for one project only).
  const runPlugin = async (args, cwd) => {
    const claude = await claudeForSession();
    if (claude.error) return { code: 1, stdout: '', stderr: claude.error };
    let launch;
    try {
      launch = claudeLaunch(claude, ['plugin', ...args]);
    } catch (err) {
      return { code: 1, stdout: '', stderr: err.message };
    }
    const verbatim = typeof launch.args === 'string';
    return new Promise((resolve) => {
      execFile(launch.file, verbatim ? [launch.args] : launch.args, {
        cwd: cwd && fs.existsSync(cwd) ? cwd : os.homedir(),
        env: childEnv(),
        timeout: 5 * 60 * 1000, // an install clones the plugin's repository
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        windowsVerbatimArguments: verbatim,
      }, (err, stdout, stderr) => resolve({ code: err ? err.code || 1 : 0, stdout: String(stdout), stderr: String(stderr) }));
    });
  };
  // What a --json command printed: the whole output, or its last line that is JSON (a message may come first).
  const pluginJson = (text) => {
    try { return JSON.parse(text); } catch { /* a line of it, then */ }
    for (const line of text.trim().split(/\r?\n/).reverse()) {
      try { return JSON.parse(line); } catch { /* not this one */ }
    }
    return null;
  };
  const firstLine = (text) => text.trim().split(/\r?\n/).find(Boolean) || '';
  ipc.handle('plugins:list', async (_e, cwd) => {
    const [list, markets] = await Promise.all([runPlugin(['list', '--json', '--available'], cwd), runPlugin(['marketplace', 'list', '--json'], cwd)]);
    const data = pluginJson(list.stdout);
    if (!data) return { ok: false, error: firstLine(list.stderr) || firstLine(list.stdout) || t('Claude Code did not list its plugins.') };
    // Installed plugins come without a description (and leave the available list): read from their manifests.
    const installed = (data.installed || []).map((p) => {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(p.installPath, '.claude-plugin', 'plugin.json'), 'utf8'));
        return { ...p, description: typeof manifest.description === 'string' ? manifest.description : '' };
      } catch {
        return p;
      }
    });
    return { ok: true, installed, available: data.available || [], marketplaces: pluginJson(markets.stdout) || [] };
  });
  const PLUGIN_ID = /^[\w.@:/-]+$/;
  ipc.handle('plugins:run', async (_e, { action, id = '', source = '', cwd, accept } = {}) => {
    if (id && !PLUGIN_ID.test(id)) return { ok: false, error: t('Not a plugin name: {name}', { name: id }) };
    const json = ['--json'];
    const args = {
      install: ['install', id, ...json, ...(accept ? ['--accept-command', String(accept)] : [])],
      uninstall: ['uninstall', id, ...json],
      enable: ['enable', id, ...json],
      disable: ['disable', id, ...json],
      update: ['update', id],
      details: ['details', id],
      'marketplace-add': ['marketplace', 'add', String(source).trim()],
      'marketplace-update': ['marketplace', 'update'],
      'marketplace-remove': ['marketplace', 'remove', id],
    }[action];
    if (!args || (action.startsWith('marketplace-add') && !String(source).trim())) return { ok: false, error: t('Nothing to do.') };
    const run = await runPlugin(args, cwd);
    const result = args.includes('--json') ? pluginJson(run.stdout) : null;
    const ok = run.code === 0 && (!result || !result.outcome || result.outcome === 'ok');
    return { ok, result, text: run.stdout.trim(), error: ok ? '' : result?.message || firstLine(run.stderr) || firstLine(run.stdout) };
  });

  // The folder for sessions without a project (New session): made the first time, and trusted, since the app made
  // it (or the user chose it for this in Settings).
  ipc.handle('chats:folder', () => {
    const folder = path.resolve(settings.get().chatsFolder || path.join(os.homedir(), 'ccUI'));
    try {
      fs.mkdirSync(folder, { recursive: true });
    } catch (err) {
      return { ok: false, error: t('The folder for chats could not be made: {error}', { error: err.message }) };
    }
    const list = settings.data.trustedFolders || [];
    if (!isTrusted(settings, folder)) settings.setPrivate({ trustedFolders: [...list, folder] });
    return { ok: true, path: folder };
  });
  ipc.on('app:answer', (_e, id, value) => {
    const resolve = asks.get(id);
    asks.delete(id);
    resolve?.(value === true);
  });

  ipc.handle('settings:get', () => settings.get());
  ipc.handle('settings:set', (_e, patch) => {
    const next = settings.set(patch);
    updater.configure(); // automatic updates, or a Claude Code of your own, may have been switched
    if (patch && 'uiScale' in patch) applyMinSize();
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
  ipc.handle('claude-update:versions', () => updater.recent().then((versions) => ({ ok: true, versions }), (err) => ({ ok: false, error: err.message })));
  ipc.handle('claude-update:use', (_e, version) => updater.use(version));
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
      const claude = opts?.kind === 'shell' ? null : await claudeForSession();
      if (claude?.error) return { ok: false, error: claude.error };
      const { id, proc } = ptys.create({ ...opts, claude, env: claude ? claudeEnv() : {} });
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
    const claude = await claudeForSession();
    if (claude.error) return { ok: false, code: 'no-binary', error: claude.error };
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
    return agents.start({ ...opts, claudeFile: claude.file, apiKey: settings.getApiKey(), env: claudeEnv() });
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
  ipc.on('window:devtools', () => { if (FROM_SOURCE) win?.webContents.toggleDevTools(); });
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
    { label: t('View'), submenu: [{ role: 'reload' }, ...(FROM_SOURCE ? [{ role: 'toggleDevTools' }] : []), { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
}

app.setAppUserModelId(APP_ID);

app.whenReady().then(async () => {
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
  await gpuKnown;
  glassAvailable = canGlass();
  // Hardware compositing can also go later (the GPU process crashed too often): the window turns solid and the
  // page stops leaving the frame see-through.
  app.on('gpu-info-update', () => {
    if (canGlass() === glassAvailable) return;
    glassAvailable = canGlass();
    if (!glassAvailable) applyGlass(false);
    send('window:glass-available', glassAvailable);
  });
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
