// Settings: a list of sections on the left, grouped rows on the right. Every change applies (and is saved)
// as soon as it is made: switches, choices and swatches right away, sliders when let go (previewed while
// dragging), text fields when they lose focus or on Enter.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Dialog, Segmented, Icon } from '../ui.jsx';
import { MODE_LABELS } from '../chat/Prompts.jsx';
import { MODEL_CHOICES } from './NewSessionDialog.jsx';
import { api, info, settings, saveSettings, settingsDialog, claudeCheck, toast, themeMode, backgroundUrl } from '../../lib/store.js';
import { SHORTCUT_LIST } from '../../lib/keyboard.js';
import { ACCENTS, accentColors } from '../../lib/themes.js';

const DEFAULT_FONT = '"JetBrains Mono", Consolas, Menlo, monospace';

const SECTIONS = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'appearance', label: 'Appearance', icon: 'sun' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal' },
  { id: 'claude', label: 'Claude Code', icon: 'chat' },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'keyboard' },
];
let lastSection = 'general'; // reopening Settings shows the section you left

// Shows a change at once without saving it (a slider being dragged).
const preview = (patch) => { settings.value = { ...settings.value, ...patch }; };

// ---------- building blocks ----------

function Group({ title, children }) {
  return (
    <section class="set-group">
      {title && <h4>{title}</h4>}
      <div class="set-card">{children}</div>
    </section>
  );
}

// A setting: its name and an optional note on the left, the control on the right (`stack`: under them).
function Row({ label, note, stack, children }) {
  return (
    <div class={`set-row ${stack ? 'stack' : ''}`}>
      <div class="set-text">
        <div class="set-label">{label}</div>
        {note && <div class="set-note">{note}</div>}
      </div>
      <div class="set-control">{children}</div>
    </div>
  );
}

function Switch({ checked, disabled, onChange, label }) {
  return (
    <label class="switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled}
             onChange={(e) => onChange(e.currentTarget.checked)} />
      <span />
    </label>
  );
}

function ToggleRow({ setting, label, note, disabled, value }) {
  return (
    <Row label={label} note={note}>
      <Switch label={label} disabled={disabled} checked={value ?? Boolean(settings.value[setting])}
              onChange={(on) => saveSettings({ [setting]: on })} />
    </Row>
  );
}

function SliderRow({ setting, label, note, min, max, step, format = String }) {
  const value = Number(settings.value[setting]);
  return (
    <Row label={label} note={note}>
      <div class="set-slider">
        <input type="range" min={min} max={max} step={step} value={value} aria-label={label}
               onInput={(e) => preview({ [setting]: Number(e.currentTarget.value) })}
               onChange={(e) => saveSettings({ [setting]: Number(e.currentTarget.value) })} />
        <output>{format(value)}</output>
      </div>
    </Row>
  );
}

// A text setting, saved when the field loses focus, on Enter, or when Settings closes while it is being edited.
function TextField({ value, onSave, placeholder, mono = true, label }) {
  const [text, setText] = useState(value);
  const latest = useRef({ text, value, onSave });
  latest.current = { text, value, onSave };
  useEffect(() => { setText(value); }, [value]);
  useEffect(() => () => {
    const l = latest.current;
    if (l.text !== l.value) l.onSave(l.text);
  }, []);
  const commit = () => { if (text !== value) onSave(text); };
  return (
    <input type="text" class={mono ? '' : 'plain'} value={text} spellcheck={false} placeholder={placeholder} aria-label={label}
           onInput={(e) => setText(e.currentTarget.value)} onBlur={commit}
           onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} />
  );
}

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

// Background image: chosen and removed right away (the file is copied by the main process).
function BackgroundImage() {
  const url = backgroundUrl.value;
  const run = async (action) => {
    const res = await action();
    if (res?.canceled) return;
    if (!res?.ok) return toast(res?.error || 'The image could not be used.', 'error');
    settings.value = res.settings;
  };
  return (
    <div class="bg-pick">
      <span class={`bg-thumb ${url ? '' : 'empty'}`} style={url ? { backgroundImage: `url("${url}")` } : undefined}>
        {!url && 'None'}
      </span>
      <button type="button" class="secondary-btn" onClick={() => run(api.background.pick)}>{url ? 'Change…' : 'Choose…'}</button>
      {url && <button type="button" class="secondary-btn" onClick={() => run(api.background.clear)}>Remove</button>}
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
    <>
      {editing ? (
        <div class="input-row">
          <input ref={input} type="password" value={key} autofocus={focus} spellcheck={false} autocomplete="off" placeholder="sk-ant-…"
                 aria-label="Anthropic API key" onInput={(e) => setKey(e.currentTarget.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter' && key.trim()) { e.preventDefault(); save(key); } }} />
          <button type="button" class="secondary-btn" disabled={!key.trim()} onClick={() => save(key)}>Save key</button>
          {s.hasApiKey && !s.apiKeyUnreadable && (
            <button type="button" class="secondary-btn" onClick={() => { setKey(''); setEditing(false); }}>Cancel</button>
          )}
        </div>
      ) : (
        <div class="input-row key-saved">
          <span class="key-state"><Icon name="check" size={13} />Saved, encrypted on this computer</span>
          <button type="button" class="secondary-btn" onClick={() => setEditing(true)}>Replace</button>
          <button type="button" class="secondary-btn" onClick={() => save('')}>Remove</button>
        </div>
      )}
      {s.apiKeyUnreadable && (
        <p class="set-note bad">
          The saved key can’t be decrypted on this computer (the profile was copied or the system keychain changed).
          Enter it again.
        </p>
      )}
    </>
  );
}

function Executable() {
  const path = settings.value.claudePath || '';
  const [check, setCheck] = useState(claudeCheck.value);
  useEffect(() => {
    let live = true;
    setCheck(null);
    api.detectClaude(path).then((res) => {
      if (!live) return;
      setCheck(res);
      claudeCheck.value = res;
    });
    return () => { live = false; };
  }, [path]);
  const save = (value) => saveSettings({ claudePath: value.trim() });
  return (
    <>
      <div class="input-row">
        <TextField value={path} placeholder="Built-in (recommended)" label="Claude Code executable" onSave={save} />
        <button type="button" class="secondary-btn" onClick={async () => {
          const file = await api.pickFile('Choose the claude executable');
          if (file) save(file);
        }}>Browse…</button>
      </div>
      <p class={`set-note ${check ? (check.ok ? 'ok' : 'bad') : ''}`}>
        {!check ? 'Checking…'
          : !check.ok ? 'Not found. Leave empty to use the built-in Claude Code.'
          : `Claude Code ${check.version}${check.bundled ? ' (built in)' : ''}${check.chatCapable ? '' : '. CLI sessions only: chat needs an executable file'}`}
      </p>
    </>
  );
}

// ---------- sections ----------

function General() {
  const s = settings.value;
  return (
    <>
      <Group title="New sessions">
        <Row label="Open as" note="What New session starts with">
          <Segmented name="defaultKind" value={s.defaultKind} onChange={(v) => saveSettings({ defaultKind: v })} options={[
            { value: 'chat', label: 'Chat' },
            { value: 'terminal', label: 'CLI' },
          ]} />
        </Row>
        <Row label="Model">
          <select value={s.defaultModel} aria-label="Model" onChange={(e) => saveSettings({ defaultModel: e.currentTarget.value })}>
            {MODEL_CHOICES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </Row>
        <Row label="Permissions">
          <select value={s.defaultPermissionMode} aria-label="Permissions"
                  onChange={(e) => saveSettings({ defaultPermissionMode: e.currentTarget.value })}>
            {['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'].map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
          </select>
        </Row>
        <Row label="CLI arguments" note="Added to every CLI session">
          <TextField value={s.defaultArgs} placeholder="e.g. --model sonnet" label="CLI arguments"
                     onSave={(v) => saveSettings({ defaultArgs: v.trim() })} />
        </Row>
      </Group>
      <Group title="Behavior">
        <ToggleRow setting="showStarters" label="Suggested prompts" note="Shown under the question on a new chat" />
        <ToggleRow setting="notify" label="Notifications" note="When a background session needs you" />
        <ToggleRow setting="restoreSessions" label="Reopen sessions" note="Bring back your sessions when the app starts" />
        <ToggleRow setting="confirmClose" label="Ask before quitting" note="When sessions are still running" />
      </Group>
    </>
  );
}

function Appearance() {
  const s = settings.value;
  const accent = ACCENTS[s.accent] ? s.accent : 'ember';
  const glassSupported = info.value.glassSupported;
  return (
    <>
      <Group>
        <Row label="Theme">
          <Segmented name="theme" value={s.theme} onChange={(v) => saveSettings({ theme: v })} options={[
            { value: 'system', label: 'System' },
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]} />
        </Row>
        <Row label="Accent color" note={ACCENTS[accent].label}>
          <AccentPicker value={accent} onChange={(v) => saveSettings({ accent: v })} />
        </Row>
        <SliderRow setting="chatFontSize" label="Chat text size" min={11} max={22} step={1} format={(v) => `${v}px`} />
      </Group>
      <Group title="Window">
        <ToggleRow setting="sidebarGlass" label="Frosted glass sidebar" disabled={!glassSupported}
                   value={Boolean(glassSupported && s.sidebarGlass)}
                   note={!glassSupported ? 'Needs Windows 11 (22H2 or later) or macOS'
                     : backgroundUrl.value ? 'The background image takes its place' : 'The desktop shows through, blurred'} />
        <Row label="Background image" note="Drawn blurred behind the whole window">
          <BackgroundImage />
        </Row>
        {backgroundUrl.value && (
          <>
            <SliderRow setting="backgroundShow" label="Visibility" note="How much of the image shows through"
                       min={10} max={90} step={5} format={(v) => `${v}%`} />
            <SliderRow setting="backgroundBlur" label="Blur" min={0} max={40} step={1} format={(v) => `${v}px`} />
          </>
        )}
      </Group>
    </>
  );
}

function Terminal() {
  const s = settings.value;
  return (
    <>
      <Group>
        <Row label="Background" note="Claude Code’s colors are designed for a dark terminal">
          <Segmented name="terminalTheme" value={s.terminalTheme || 'match'} onChange={(v) => saveSettings({ terminalTheme: v })} options={[
            { value: 'match', label: 'Match theme' },
            { value: 'dark', label: 'Always dark' },
          ]} />
        </Row>
        <SliderRow setting="fontSize" label="Text size" min={10} max={24} step={1} format={(v) => `${v}px`} />
        <SliderRow setting="lineHeight" label="Line height" min={1} max={1.6} step={0.05} format={(v) => Number(v).toFixed(2)} />
        <Row label="Font" stack>
          <TextField value={s.fontFamily} label="Terminal font"
                     onSave={(v) => saveSettings({ fontFamily: v.trim() || DEFAULT_FONT })} />
        </Row>
      </Group>
      <Group>
        <ToggleRow setting="copyOnSelect" label="Copy on select" note="Copy text as soon as you select it" />
        <ToggleRow setting="cursorBlink" label="Blinking cursor" />
      </Group>
    </>
  );
}

function ClaudeCode({ focusAccount }) {
  return (
    <>
      <Group title="Account">
        <Row stack label="Anthropic API key"
             note="Chat sessions use this key. Without one they use Claude Code’s own credentials: an API key, Amazon Bedrock, Google Vertex AI or Microsoft Foundry. Claude.ai subscription logins work only in CLI sessions.">
          <ApiKey focus={focusAccount} />
        </Row>
      </Group>
      <Group title="Executable">
        <Row stack label="Claude Code" note="Leave empty to use the version built into the app">
          <Executable />
        </Row>
      </Group>
    </>
  );
}

function Shortcuts() {
  return (
    <Group>
      {SHORTCUT_LIST.map(([label, keys]) => (
        <div class="set-row shortcut" key={label}><span>{label}</span><kbd>{keys}</kbd></div>
      ))}
    </Group>
  );
}

// ---------- the dialog ----------

function SettingsPanel({ start }) {
  const [section, setSection] = useState(start === 'account' ? 'claude' : lastSection);
  const body = useRef(null);
  // Opening the dialog focuses its first button, with a focus ring; the page (or the key field, when Settings
  // opened for it) is marked autofocus instead. showModal runs after this renders, so a focus() here would lose.
  const pick = (id) => {
    lastSection = id;
    setSection(id);
    body.current.scrollTop = 0;
  };
  const current = SECTIONS.find((x) => x.id === section);
  // Done round-trips the settings through the main process, so anything it changed itself shows too.
  const done = (e) => {
    e.preventDefault();
    document.activeElement?.blur();
    saveSettings({});
    settingsDialog.value = false;
  };
  return (
    <form class="settings" onSubmit={done}>
      <nav class="settings-nav" aria-label="Settings sections">
        <h3>Settings</h3>
        {SECTIONS.map((x) => (
          <button type="button" key={x.id} class={x.id === section ? 'on' : ''} aria-current={x.id === section ? 'page' : undefined}
                  onClick={() => pick(x.id)}>
            <Icon name={x.icon} size={15} />{x.label}
          </button>
        ))}
        <span class="spacer" />
        <p class="settings-saved">Changes are saved as you make them.</p>
      </nav>
      <div class="settings-main">
        <header class="settings-head">
          <h2>{current.label}</h2>
          <button type="submit" class="primary-btn">Done</button>
        </header>
        <div class="settings-body" ref={body} tabIndex={-1} autofocus={start !== 'account'}>
          {section === 'general' && <General />}
          {section === 'appearance' && <Appearance />}
          {section === 'terminal' && <Terminal />}
          {section === 'claude' && <ClaudeCode focusAccount={start === 'account'} />}
          {section === 'shortcuts' && <Shortcuts />}
        </div>
      </div>
    </form>
  );
}

export function SettingsDialog() {
  const open = settingsDialog.value;
  return (
    <Dialog open={Boolean(open)} className="dialog-settings" onClose={() => { settingsDialog.value = false; }}>
      {open && <SettingsPanel start={open} />}
    </Dialog>
  );
}
