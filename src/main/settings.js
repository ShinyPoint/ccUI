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
  accent: 'black', // the color theme, a key of PALETTES in renderer/lib/themes.js
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
  defaultKind: 'chat', // 'chat' | 'terminal'
  defaultModel: '', // empty: Claude Code's default
  defaultPermissionMode: 'default',
  defaultArgs: '', // extra CLI arguments for terminal sessions
  showStarters: false, // suggested prompts under the question on a new chat
  notify: true,
  confirmClose: true,
  restoreSessions: true,
  sidebarCollapsed: false,
  sidebarGlass: true, // frosted-glass sidebar (system material; Windows 11 22H2+ and macOS)
  fillEdge: true, // the chat / CLI area runs out to the window's right edge (no gap there)
  backgroundImage: '', // file name of the background image in <userData>/backgrounds (set by background.js)
  backgroundShow: 40, // how much of the background image shows through, percent
  backgroundBlur: 8, // blur of the background image, px
  recent: [], // [{ path, at }]
  lastSessions: [], // [{ kind, cwd, name, sessionId, model, permissionMode }]
  conversations: {}, // sessionId -> { model, permissionMode }, restored when a conversation is resumed
  folders: {}, // folder path -> { collapsed }; cleared at launch, so every folder starts folded
  bounds: null,
  apiKeyEnc: '',
  trustedFolders: [], // folders the user trusted for chat sessions (main process only, see trust.js)
  settingsVersion: 8,
};

// Kept by the main process; the window can neither read nor change them through settings:set.
const PRIVATE = new Set(['apiKeyEnc', 'trustedFolders', 'settingsVersion', 'backgroundImage']);

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
    const { apiKeyEnc, trustedFolders, ...rest } = this.data;
    return {
      ...rest,
      hasApiKey: Boolean(apiKeyEnc),
      // A saved key this computer cannot decrypt (profile copied elsewhere, keychain reset): ask for it again.
      apiKeyUnreadable: Boolean(apiKeyEnc) && this.getApiKey() === '',
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

  setApiKey(key) {
    const value = (key || '').trim();
    if (value && !safeStorage.isEncryptionAvailable()) throw new Error(t('This system has no secure storage for the key.'));
    this.data.apiKeyEnc = value ? safeStorage.encryptString(value).toString('base64') : '';
    this.save();
    return this.get();
  }

  getApiKey() {
    if (!this.data.apiKeyEnc) return '';
    if (this.decrypted?.enc === this.data.apiKeyEnc) return this.decrypted.key;
    let key = '';
    try { key = safeStorage.decryptString(Buffer.from(this.data.apiKeyEnc, 'base64')); } catch { /* unreadable */ }
    this.decrypted = { enc: this.data.apiKeyEnc, key };
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
