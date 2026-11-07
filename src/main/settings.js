// JSON settings in the user's app data folder. The API key is stored encrypted with the OS keychain
// (Electron safeStorage) and never sent to the window.
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');
const { t } = require('./i18n');

const DEFAULTS = {
  theme: 'system', // 'system' | 'dark' | 'light'
  fontSize: 14,
  lineHeight: 1.2,
  fontFamily: '"JetBrains Mono", Consolas, Menlo, monospace',
  chatFontSize: 14,
  uiScale: 105, // the whole window's size, percent (Settings → Appearance); a touch larger than the page's own
  accent: 'ember', // the color theme, a key of PALETTES in renderer/lib/themes.js: Clay unless chosen (new installs;
  // a saved choice, Default included, stays)
  terminalTheme: 'match', // 'match' (follows the app theme) | 'dark'
  panelHeight: 260, // bottom Terminal panel, px
  sidePanelWidth: 440, // the Changes panel at the right of a chat, px
  sidePanelWrap: false, // and whether it wraps long lines
  language: 'system', // 'system' | 'en' | 'zh-CN' (lib/i18n.js)
  cursorBlink: true,
  copyOnSelect: false,
  scrollback: 10000,
  claudePath: '', // empty: the built-in Claude Code (the Agent SDK's from source, otherwise downloaded)
  autoUpdateClaude: true, // keep the built-in Claude Code current (claude-update.js)
  claudeVersion: '', // empty: the newest built-in Claude Code; a version ("2.1.300"): that one, never updated
  defaultKind: 'chat', // what a project's + opens: 'chat' | 'terminal' | 'shell'
  chatsFolder: '', // where New session's chats (and CLIs) without a project run; empty: ~/ccUI
  taskList: false, // Claude keeps a task list on Opus 5 and later too (Claude Code gives them none by default)
  defaultModel: '', // empty: Claude Code's default
  defaultPermissionMode: 'default',
  defaultEffort: '', // the reasoning effort last chosen, for new sessions ('' = Auto, the model's default)
  defaultArgs: '', // extra CLI arguments for terminal sessions
  dshEnabled: false, // new chats run on DeepSeek Harness (dsh.js) instead of Claude Code, and there are no CLI sessions
  dshModel: 'deepseek-flash', // the model new DeepSeek Harness chats start with
  dshMirror: '', // where DeepSeek Harness is downloaded from: '' (nodejs.org, npm) | 'npmmirror' (dsh-install.js SOURCES)
  // Model providers of DeepSeek Harness chats (dsh-catalog.mjs): DeepSeek's own address and model list when edited (null:
  // dsh's defaults), and the endpoints added: [{ id, name, api, baseURL, models: [{ id, name, contextWindow, maxTokens,
  // image, reasoning }], fetched }]. Their keys are kept apart, encrypted (dshKeysEnc).
  dshOfficial: { baseURL: '', models: null },
  dshProviders: [],
  showStarters: false, // suggested prompts under the question on a new chat
  notify: true,
  confirmClose: true,
  closeAction: 'ask', // the window's close button: 'ask', 'tray' (hide it in the tray) or 'quit'
  restoreSessions: true,
  sidebarCollapsed: false,
  sidebarWidth: 256, // px, set by dragging the sidebar's edge (double-click it for this again)
  sidebarGlass: true, // frosted-glass sidebar (system material; Windows 11 22H2+ and macOS)
  liquidGlass: false, // floating surfaces as Apple's Liquid Glass (lib/liquid.js); experimental
  liquidFrost: 35, // its glass, from clear (0) to frosted (100)
  vividColor: false, // soft patches of color drift behind the sidebar and top bar (lib/vivid.js)
  vividPalette: 'aurora', // their colors: a key of VIVID_PALETTES
  vividStrength: 50, // how strongly they show, 0 to 100
  fillEdge: true, // the chat / CLI area runs out to the window's right edge (no gap there)
  thinkingMark: false, // Claude's ✻ before each thought in a chat (off: the thought alone, still in the steps' column)
  backgroundImage: '', // file name of the background image in <userData>/backgrounds (set by background.js)
  backgroundShow: 40, // how much of the background image shows through, percent
  backgroundBlur: 8, // blur of the background image, px
  recent: [], // [{ path, at }]
  folderOrder: [], // project folders in the order dragged to in the sidebar; folders not in it come first
  lastSessions: [], // [{ kind, cwd, name, sessionId, model, permissionMode, effort }]
  conversations: {}, // sessionId -> { model, permissionMode }, restored when a conversation is resumed
  folders: {}, // folder path -> { collapsed }; cleared at launch, so every folder starts folded
  bounds: null,
  apiKeyEnc: '',
  deepseekKeyEnc: '', // the DeepSeek API key, encrypted like the Anthropic one
  dshKeysEnc: {}, // provider id -> its API key, encrypted (custom DeepSeek Harness providers)
  trustedFolders: [], // folders the user trusted for chat sessions (main process only, see trust.js)
  settingsVersion: 8,
};

// Kept by the main process; the window can neither read nor change them through settings:set.
const PRIVATE = new Set(['apiKeyEnc', 'deepseekKeyEnc', 'dshKeysEnc', 'trustedFolders', 'settingsVersion', 'backgroundImage']);

// A value the window may store under `key`: same type as the default (bounds may also be null).
function acceptable(key, value) {
  if (!(key in DEFAULTS) || PRIVATE.has(key)) return false;
  const def = DEFAULTS[key];
  if (def === null) return value === null || (typeof value === 'object' && !Array.isArray(value));
  if (Array.isArray(def)) return Array.isArray(value);
  return typeof value === typeof def && value !== null;
}

// Short-lived defaults of the terminal font (settings versions 3 to 5), put back to JetBrains Mono.
const OLD_TERMINAL_FONTS = [
  '"Cascadia Code", Consolas, monospace', 'Consolas, Menlo, monospace',
  'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
];

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = { ...DEFAULTS };
    let stored = null;
    let text = null;
    try { text = fs.readFileSync(this.file, 'utf8'); } catch { /* first run */ }
    if (text != null) {
      try {
        stored = JSON.parse(text);
        Object.assign(this.data, stored);
      } catch {
        // Unreadable: keep a copy before the next save replaces it (recent folders, sessions, the key).
        try { fs.copyFileSync(this.file, `${this.file}.bad-${Date.now()}`); } catch { /* best effort */ }
      }
    }
    if (stored) this.migrate(stored.settingsVersion || 1);
  }

  // One-time upgrades of settings files written by older versions (`version` is what the file says).
  migrate(version) {
    if (version < 2) {
      // Restoring sessions used to default to off (and was saved that way); sessions now restore lazily,
      // so it is cheap and on by default.
      this.data.restoreSessions = true;
    }
    if (version < 6 && OLD_TERMINAL_FONTS.includes(this.data.fontFamily)) {
      // The terminal font briefly defaulted to Cascadia Code, Consolas or the system monospace; a font the user
      // picked is kept.
      this.data.fontFamily = DEFAULTS.fontFamily;
    }
    if (version < 7 && this.data.accent === 'ember') {
      // Ember was the default accent until version 7, when Black took its place; it was saved as such.
      this.data.accent = 'black';
    }
    if (version < 8 && !['black', 'pink', 'ember'].includes(this.data.accent)) {
      // Version 8 keeps three accents (Default, Pink, Clay); the others turn into Default.
      this.data.accent = 'black';
    }
    if (version < 8) {
      this.data.settingsVersion = 8;
      try { this.save(); } catch { /* read-only profile: keep the in-memory upgrade */ }
    }
  }

  // What the window may see.
  get() {
    const { apiKeyEnc, deepseekKeyEnc, dshKeysEnc, trustedFolders, ...rest } = this.data;
    return {
      ...rest,
      hasApiKey: Boolean(apiKeyEnc),
      // A saved key this computer cannot decrypt (profile copied elsewhere, keychain reset): ask for it again.
      apiKeyUnreadable: Boolean(apiKeyEnc) && this.getApiKey() === '',
      hasDeepseekKey: Boolean(deepseekKeyEnc),
      deepseekKeyUnreadable: Boolean(deepseekKeyEnc) && this.getApiKey('deepseekKeyEnc') === '',
      // Which custom providers have a key saved (true) or one this computer can't decrypt (false).
      dshKeys: Object.fromEntries(Object.keys(dshKeysEnc || {}).map((id) => [id, this.getProviderKey(id) !== ''])),
      canEncrypt: safeStorage.isEncryptionAvailable(),
    };
  }

  // From the window: only known keys, with values of the expected type.
  set(patch) {
    for (const [key, value] of Object.entries(patch || {})) {
      if (acceptable(key, value)) this.data[key] = value;
    }
    this.save();
    return this.get();
  }

  // From the main process itself (keys the window may not set).
  setPrivate(patch) {
    Object.assign(this.data, patch);
    this.save();
  }

  // A custom DeepSeek Harness provider's key (dshKeysEnc); '' removes it.
  setProviderKey(id, key) {
    const value = (key || '').trim();
    if (value && !safeStorage.isEncryptionAvailable()) throw new Error(t('This system has no secure storage for the key.'));
    const { [id]: _old, ...rest } = this.data.dshKeysEnc || {};
    this.data.dshKeysEnc = value ? { ...rest, [id]: safeStorage.encryptString(value).toString('base64') } : rest;
    this.save();
    return this.get();
  }

  getProviderKey(id) {
    const enc = this.data.dshKeysEnc?.[id];
    if (!enc) return '';
    try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return ''; }
  }

  // `field`: apiKeyEnc (Anthropic's) or deepseekKeyEnc.
  setApiKey(key, field = 'apiKeyEnc') {
    const value = (key || '').trim();
    if (value && !safeStorage.isEncryptionAvailable()) throw new Error(t('This system has no secure storage for the key.'));
    this.data[field] = value ? safeStorage.encryptString(value).toString('base64') : '';
    this.save();
    return this.get();
  }

  getApiKey(field = 'apiKeyEnc') {
    const enc = this.data[field];
    if (!enc) return '';
    this.decrypted ||= {};
    if (this.decrypted[field]?.enc === enc) return this.decrypted[field].key;
    let key = '';
    try { key = safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { /* unreadable */ }
    this.decrypted[field] = { enc, key };
    return key;
  }

  // Atomic (temp file + rename). On Windows the rename can fail for a moment while antivirus or the indexer
  // holds the file, so it is retried; a save that still fails is reported, not thrown.
  save() {
    const tmp = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      for (let attempt = 0; ; attempt++) {
        try {
          fs.renameSync(tmp, this.file);
          return true;
        } catch (err) {
          if (attempt >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
          sleep(40 * (attempt + 1));
        }
      }
    } catch (err) {
      console.error('Could not save settings:', err.message);
      return false;
    }
  }
}

module.exports = { Settings, DEFAULTS };
