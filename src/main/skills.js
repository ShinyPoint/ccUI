// Skills for the chat's Skills panel. Claude Code's own /skills menu is interactive and only exists in its CLI;
// it turns a skill on or off with a `skillOverrides` entry in a settings file, which the Agent SDK won't write
// (update_settings refuses the key). So the entry is written here, the same way, and the session reloads its
// skills afterwards (see AgentSession.control in agent.js).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { t } = require('./i18n');

// What a skill can be set to, as Claude Code's settings name them. Absent means 'on'.
const STATES = ['on', 'name-only', 'user-invocable-only', 'off'];

const configDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

// The settings file a change goes to: this project only (where Claude Code's /skills writes), or every project.
function settingsFile(scope, cwd) {
  return scope === 'user' ? path.join(configDir(), 'settings.json') : path.join(cwd, '.claude', 'settings.local.json');
}

// `name` and `description` from a SKILL.md's frontmatter (simple `key: value` lines; quotes are dropped).
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/, '$2').trim();
  }
  return out;
}

// Skills in the user's and the project's skills folders: name -> { description, dir, source }. Includes skills
// that are turned off, which Claude Code no longer reports.
function skillsOnDisk(cwd) {
  const found = new Map();
  const scan = (root, source) => {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      let text;
      try { text = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'); } catch { continue; }
      const meta = frontmatter(text);
      const name = meta.name || entry.name;
      if (!found.has(name)) found.set(name, { description: meta.description || '', dir, source });
    }
  };
  scan(path.join(cwd, '.claude', 'skills'), 'projectSettings');
  scan(path.join(configDir(), 'skills'), 'userSettings');
  return found;
}

function readJson(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
  if (!text.trim()) return {};
  try {
    const data = JSON.parse(text);
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch { /* below */ }
  throw new Error(t('{file} isn\'t valid JSON, so it was left alone. Fix it and try again.', { file }));
}

// The skillOverrides entry for `name` in one settings file ('' when there is none).
function overrideIn(scope, cwd, name) {
  try { return readJson(settingsFile(scope, cwd)).skillOverrides?.[name] || ''; } catch { return ''; }
}

// Sets `name` to `state` in the scope's settings file; null removes the entry. Everything else in the file is kept.
function writeOverride(scope, cwd, name, state) {
  if (state !== null && !STATES.includes(state)) throw new Error(`Unknown skill state ${state}`);
  const file = settingsFile(scope, cwd);
  const data = readJson(file);
  const overrides = { ...(data.skillOverrides || {}) };
  if (state === null) delete overrides[name];
  else overrides[name] = state;
  if (Object.keys(overrides).length) data.skillOverrides = overrides;
  else delete data.skillOverrides;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.ccui-${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return file;
}

module.exports = { STATES, skillsOnDisk, overrideIn, writeOverride, settingsFile, configDir };
