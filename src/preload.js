const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron');

// One ipcRenderer listener per channel, fanned out to page subscribers.
function channel(name) {
  const listeners = new Set();
  ipcRenderer.on(name, (_e, ...args) => listeners.forEach((fn) => fn(...args)));
  return (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
}

contextBridge.exposeInMainWorld('ccui', {
  info: () => ipcRenderer.invoke('app:info'),
  detectClaude: (custom) => ipcRenderer.invoke('app:detect-claude', custom),
  // Questions from the main process (quitting with sessions running, folder trust), answered with true/false.
  onAsk: channel('app:ask'),
  answer: (id, value) => ipcRenderer.send('app:answer', id, value),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  setApiKey: (key) => ipcRenderer.invoke('settings:set-api-key', key),
  setThemeSource: (source) => ipcRenderer.send('theme:source', source),

  pickFolder: (defaultPath) => ipcRenderer.invoke('dialog:pick-folder', defaultPath),
  chatsFolder: () => ipcRenderer.invoke('chats:folder'),
  taskOutput: (file) => ipcRenderer.invoke('task:output', file),
  plugins: {
    list: (cwd) => ipcRenderer.invoke('plugins:list', cwd),
    run: (request) => ipcRenderer.invoke('plugins:run', request),
  },
  pickFile: (title) => ipcRenderer.invoke('dialog:pick-file', title),
  saveText: (name, text, cwd) => ipcRenderer.invoke('dialog:save-text', { name, text, cwd }),
  openMemoryFile: (file) => ipcRenderer.invoke('files:open-memory', file),
  pathForFile: (file) => webUtils.getPathForFile(file),
  openPath: (p) => ipcRenderer.send('shell:open-path', p),
  openExternal: (url) => ipcRenderer.send('shell:open-external', url),
  listFiles: (cwd) => ipcRenderer.invoke('files:list', cwd),
  // A text file inside the project folder (Changes panel): { ok, text } or { ok: false, reason }.
  readFile: (cwd, file) => ipcRenderer.invoke('files:read', cwd, file),

  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (text) => ipcRenderer.send('clipboard:write', text),

  pty: {
    create: (opts) => ipcRenderer.invoke('pty:create', opts),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('pty:kill', id),
    onData: channel('pty:data'),
    onExit: channel('pty:exit'),
  },

  agent: {
    start: (opts) => ipcRenderer.invoke('agent:start', opts),
    send: (id, payload) => ipcRenderer.send('agent:send', id, payload),
    reply: (id, requestId, answer) => ipcRenderer.send('agent:permission-reply', id, requestId, answer),
    control: (id, action, arg) => ipcRenderer.invoke('agent:control', id, action, arg),
    close: (id) => ipcRenderer.send('agent:close', id),
    onEvents: channel('agent:events'),
    onMeta: channel('agent:meta'),
    onPermission: channel('agent:permission'),
    onPermissionCancel: channel('agent:permission-cancel'),
    onExit: channel('agent:exit'),
  },

  history: {
    list: (cwd) => ipcRenderer.invoke('history:list', cwd),
    messages: (sessionId, cwd) => ipcRenderer.invoke('history:messages', sessionId, cwd),
    fork: (sessionId, cwd, uuid) => ipcRenderer.invoke('history:fork', sessionId, cwd, uuid),
  },

  windowControls: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximized: channel('window:maximized'),
  },
  setGlass: (on) => ipcRenderer.send('window:glass', on),
  // The UI scale: the whole page drawn larger or smaller, like the browser's zoom (1 = 100%).
  setZoom: (factor) => webFrame.setZoomFactor(Math.min(1.5, Math.max(0.8, Number(factor) || 1))),
  onGlassAvailable: channel('window:glass-available'),
  background: {
    pick: () => ipcRenderer.invoke('background:pick'),
    clear: () => ipcRenderer.invoke('background:clear'),
    read: () => ipcRenderer.invoke('background:read'),
  },
  claudeUpdate: {
    state: () => ipcRenderer.invoke('claude-update:state'),
    check: () => ipcRenderer.invoke('claude-update:check'),
    run: () => ipcRenderer.invoke('claude-update:run'),
    versions: () => ipcRenderer.invoke('claude-update:versions'),
    use: (version) => ipcRenderer.invoke('claude-update:use', String(version || '')),
    onState: channel('claude-update:state'),
  },
  focusWindow: () => ipcRenderer.send('window:focus'),
  toggleDevTools: () => ipcRenderer.send('window:devtools'),
  setBadge: (count) => ipcRenderer.send('window:badge', count),
});
