import { useEffect, useRef, useState } from 'preact/hooks';
import { Dialog, Segmented } from '../ui.jsx';
import { MODE_LABELS } from '../chat/Prompts.jsx';
import { MODEL_CHOICES } from './NewSessionDialog.jsx';
import { api, info, settings, saveSettings, settingsDialog, claudeCheck, toast, themeMode, backgroundUrl } from '../../lib/store.js';
import { SHORTCUT_LIST } from '../../lib/keyboard.js';
import { ACCENTS, accentColors } from '../../lib/themes.js';

// A row of round color swatches, like macOS's accent color setting.
function AccentPicker({ value, onChange }) {
  return (
    <div class="swatches" role="radiogroup" aria-label="Accent color">
      {Object.entries(ACCENTS).map(([name, a]) => (
        <label key={name} class="swatch" title={a.label} style={{ '--swatch': accentColors(name, themeMode.value).accent }}>
          <input type="radio" name="accent" value={name} checked={value === name} onChange={() => onChange(name)} />
          <span />
        </label>
      ))}
    </div>
  );
}

// Background image: chosen and removed right away (the file is copied by the main process), like the API key.
function BackgroundImage() {
  const url = backgroundUrl.value;
  const run = async (action) => {
    const res = await action();
    if (res?.canceled) return;
    if (!res?.ok) return toast(res?.error || 'The image could not be used.', 'error');
    settings.value = res.settings;
  };
  return (
    <div class="field">
      <span class="field-label">Background image</span>
      <div class="bg-pick">
        <span class={`bg-thumb ${url ? '' : 'empty'}`} style={url ? { backgroundImage: `url("${url}")` } : undefined}>
          {!url && 'None'}
        </span>
        <button type="button" class="secondary-btn" onClick={() => run(api.background.pick)}>{url ? 'Change…' : 'Choose image…'}</button>
        {url && <button type="button" class="secondary-btn" onClick={() => run(api.background.clear)}>Remove</button>}
      </div>
    </div>
  );
}

function ApiKey({ focus }) {
  const s = settings.value;
  const [editing, setEditing] = useState(!s.hasApiKey || s.apiKeyUnreadable);
  const [key, setKey] = useState('');
  const input = useRef(null);
  useEffect(() => { if (focus && editing) input.current?.focus(); }, [focus, editing]);

  const save = async (value) => {
    const res = await api.setApiKey(value);
    if (!res?.ok) return toast(res?.error || 'The key could not be saved.', 'error');
    settings.value = res.settings;
    setKey('');
    setEditing(!value);
    toast(value ? 'API key saved. New chat sessions will use it.' : 'API key removed.');
  };

  return (
    <div class="field">
      <span class="field-label">Anthropic API key</span>
      {editing ? (
        <div class="input-row">
          <input ref={input} type="password" value={key} spellcheck={false} autocomplete="off" placeholder="sk-ant-…"
                 onInput={(e) => setKey(e.currentTarget.value)} />
          <button type="button" class="secondary-btn" disabled={!key.trim()} onClick={() => save(key)}>Save key</button>
        </div>
      ) : (
        <div class="input-row key-saved">
          <span>A key is saved and encrypted on this computer.</span>
          <button type="button" class="secondary-btn" onClick={() => setEditing(true)}>Replace</button>
          <button type="button" class="secondary-btn" onClick={() => save('')}>Remove</button>
        </div>
      )}
      {s.apiKeyUnreadable && (
        <small class="field-note bad">
          The saved key can't be decrypted on this computer (the profile was copied or the system keychain changed).
          Enter it again.
        </small>
      )}
      <small class="field-note">
        Chat sessions use this key. Without one they use Claude Code’s own credentials: an API key, Amazon Bedrock,
        Google Vertex AI or Microsoft Foundry. Claude.ai subscription logins work only in CLI sessions.
      </small>
    </div>
  );
}

function Form({ focusAccount }) {
  const initial = settings.value;
  const [form, setForm] = useState(initial);
  const [check, setCheck] = useState(claudeCheck.value);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const field = (key) => (e) => set(key)(e.currentTarget.type === 'checkbox' ? e.currentTarget.checked : e.currentTarget.value);

  useEffect(() => {
    let live = true;
    setCheck(null);
    const t = setTimeout(() => api.detectClaude(form.claudePath).then((res) => { if (live) setCheck(res); }), 400);
    return () => { live = false; clearTimeout(t); };
  }, [form.claudePath]);

  const submit = async (e) => {
    e.preventDefault();
    await saveSettings({
      theme: form.theme,
      accent: ACCENTS[form.accent] ? form.accent : 'ember',
      fontSize: Number(form.fontSize),
      lineHeight: Number(form.lineHeight),
      fontFamily: form.fontFamily.trim() || '"JetBrains Mono", monospace',
      chatFontSize: Number(form.chatFontSize),
      terminalTheme: form.terminalTheme || 'match',
      claudePath: form.claudePath.trim(),
      defaultKind: form.defaultKind,
      defaultModel: form.defaultModel,
      defaultPermissionMode: form.defaultPermissionMode,
      defaultArgs: form.defaultArgs.trim(),
      notify: form.notify,
      showStarters: Boolean(form.showStarters),
      sidebarGlass: Boolean(form.sidebarGlass),
      backgroundShow: Number(form.backgroundShow),
      backgroundBlur: Number(form.backgroundBlur),
      restoreSessions: form.restoreSessions,
      confirmClose: form.confirmClose,
      copyOnSelect: form.copyOnSelect,
      cursorBlink: form.cursorBlink,
    });
    if (form.claudePath.trim() !== (initial.claudePath || '')) api.detectClaude(form.claudePath).then((res) => { claudeCheck.value = res; });
    settingsDialog.value = false;
  };

  return (
    <form onSubmit={submit}>
      <div class="settings-grid">
        <section>
          <h4>Account</h4>
          <ApiKey focus={focusAccount} />

          <h4>Claude Code</h4>
          <label class="field">
            <span class="field-label">Executable</span>
            <div class="input-row">
              <input type="text" value={form.claudePath} spellcheck={false} placeholder="Built-in (recommended)" onInput={field('claudePath')} />
              <button type="button" class="secondary-btn" onClick={async () => {
                const file = await api.pickFile('Choose the claude executable');
                if (file) set('claudePath')(file);
              }}>Browse…</button>
            </div>
            <small class={`field-note ${check ? (check.ok ? 'ok' : 'bad') : ''}`}>
              {!check ? 'Checking…'
                : !check.ok ? 'Not found. Leave empty to use the built-in Claude Code.'
                : `Claude Code ${check.version}${check.bundled ? ' (built in)' : ''}${check.chatCapable ? '' : '. CLI sessions only: chat needs an executable file'}`}
            </small>
          </label>

          <h4>New sessions</h4>
          <div class="field">
            <span class="field-label">Open as</span>
            <Segmented name="defaultKind" value={form.defaultKind} onChange={set('defaultKind')} options={[
              { value: 'chat', label: 'Chat' },
              { value: 'terminal', label: 'CLI' },
            ]} />
          </div>
          <div class="field-pair">
            <label class="field">
              <span class="field-label">Model</span>
              <select value={form.defaultModel} onChange={field('defaultModel')}>
                {MODEL_CHOICES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </label>
            <label class="field">
              <span class="field-label">Permissions</span>
              <select value={form.defaultPermissionMode} onChange={field('defaultPermissionMode')}>
                {['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'].map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
              </select>
            </label>
          </div>
          <label class="field">
            <span class="field-label">CLI arguments <em>optional</em></span>
            <input type="text" value={form.defaultArgs} spellcheck={false} placeholder="e.g. --model sonnet" onInput={field('defaultArgs')} />
          </label>
        </section>

        <section>
          <h4>Appearance</h4>
          <div class="field">
            <span class="field-label">Theme</span>
            <Segmented name="theme" value={form.theme} onChange={set('theme')} options={[
              { value: 'system', label: 'System' },
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]} />
          </div>
          <div class="field">
            <span class="field-label">Accent color <output>{(ACCENTS[form.accent] || ACCENTS.ember).label}</output></span>
            <AccentPicker value={ACCENTS[form.accent] ? form.accent : 'ember'} onChange={set('accent')} />
          </div>
          <label class="check">
            <input type="checkbox" disabled={!info.value.glassSupported}
                   checked={Boolean(info.value.glassSupported && form.sidebarGlass)} onChange={field('sidebarGlass')} />
            <span>
              Frosted glass sidebar
              {!info.value.glassSupported && <small class="field-note">Needs Windows 11 (22H2 or later) or macOS.</small>}
              {info.value.glassSupported && backgroundUrl.value && <small class="field-note">The background image takes its place.</small>}
            </span>
          </label>
          <BackgroundImage />
          {backgroundUrl.value && (
            <div class="field-pair">
              <label class="field">
                <span class="field-label" title="How much of the image shows through the panels">Visibility <output>{form.backgroundShow}%</output></span>
                <input type="range" min="10" max="90" step="5" value={form.backgroundShow} onInput={field('backgroundShow')} />
              </label>
              <label class="field">
                <span class="field-label">Blur <output>{form.backgroundBlur}px</output></span>
                <input type="range" min="0" max="40" step="1" value={form.backgroundBlur} onInput={field('backgroundBlur')} />
              </label>
            </div>
          )}
          <div class="field">
            <span class="field-label">Terminal background</span>
            <Segmented name="terminalTheme" value={form.terminalTheme || 'match'} onChange={set('terminalTheme')} options={[
              { value: 'match', label: 'Match app theme' },
              { value: 'dark', label: 'Always dark', title: 'Claude Code’s colors are designed for a dark terminal' },
            ]} />
          </div>
          <label class="field">
            <span class="field-label">Chat text size <output>{form.chatFontSize}px</output></span>
            <input type="range" min="11" max="22" step="1" value={form.chatFontSize} onInput={field('chatFontSize')} />
          </label>
          <label class="field">
            <span class="field-label">Terminal text size <output>{form.fontSize}px</output></span>
            <input type="range" min="10" max="24" step="1" value={form.fontSize} onInput={field('fontSize')} />
          </label>
          <label class="field">
            <span class="field-label">Terminal line height <output>{Number(form.lineHeight).toFixed(2)}</output></span>
            <input type="range" min="1" max="1.6" step="0.05" value={form.lineHeight} onInput={field('lineHeight')} />
          </label>
          <label class="field">
            <span class="field-label">Terminal font</span>
            <input type="text" value={form.fontFamily} spellcheck={false} onInput={field('fontFamily')} />
          </label>

          <h4>Behavior</h4>
          <label class="check"><input type="checkbox" checked={Boolean(form.showStarters)} onChange={field('showStarters')} /><span>Show suggested prompts on new chats</span></label>
          <label class="check"><input type="checkbox" checked={form.notify} onChange={field('notify')} /><span>Notify me when a background session needs me</span></label>
          <label class="check"><input type="checkbox" checked={form.restoreSessions} onChange={field('restoreSessions')} /><span>Reopen my sessions when the app starts</span></label>
          <label class="check"><input type="checkbox" checked={form.confirmClose} onChange={field('confirmClose')} /><span>Ask before quitting with sessions running</span></label>
          <label class="check"><input type="checkbox" checked={form.copyOnSelect} onChange={field('copyOnSelect')} /><span>Terminal: copy text as soon as I select it</span></label>
          <label class="check"><input type="checkbox" checked={form.cursorBlink} onChange={field('cursorBlink')} /><span>Terminal: blinking cursor</span></label>
        </section>
      </div>
      <div class="shortcut-table">
        {SHORTCUT_LIST.map(([label, keys]) => <div key={label}><span>{label}</span><kbd>{keys}</kbd></div>)}
      </div>
      <div class="dialog-actions">
        <button type="button" class="secondary-btn" onClick={() => { settingsDialog.value = false; }}>Cancel</button>
        <button type="submit" class="primary-btn">Save settings</button>
      </div>
    </form>
  );
}

export function SettingsDialog() {
  const open = settingsDialog.value;
  return (
    <Dialog open={Boolean(open)} wide title="Settings" onClose={() => { settingsDialog.value = false; }}>
      {open && <Form focusAccount={open === 'account'} />}
    </Dialog>
  );
}
