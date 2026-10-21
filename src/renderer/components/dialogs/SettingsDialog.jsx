// Settings: a list of sections on the left, grouped rows on the right. Every change applies (and is saved)
// as soon as it is made: switches, choices and swatches right away, sliders when let go (previewed while
// dragging), text fields when they lose focus or on Enter.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Dialog, Dropdown, Segmented, Icon, SetGroup as Group, SetRow as Row, Switch } from '../ui.jsx';
import { MODE_LABELS } from '../chat/Prompts.jsx';
import { MODEL_CHOICES } from './NewSessionDialog.jsx';
import { api, info, settings, saveSettings, settingsDialog, claudeCheck, claudeUpdate, toast, themeMode, backgroundUrl } from '../../lib/store.js';
import { SHORTCUT_LIST } from '../../lib/keyboard.js';
import { ACCENTS, accentColors } from '../../lib/themes.js';
import { t, phrase, LANGUAGES, systemLocale } from '../../lib/i18n.js';

const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'];

const DEFAULT_FONT = '"JetBrains Mono", Consolas, Menlo, monospace';

const SECTIONS = [
  { id: 'general', label: phrase('General'), icon: 'settings' },
  { id: 'appearance', label: phrase('Appearance'), icon: 'sun' },
  { id: 'terminal', label: phrase('Terminal'), icon: 'terminal' },
  { id: 'claude', label: phrase('Claude Code'), icon: 'chat' },
  { id: 'shortcuts', label: phrase('Shortcuts'), icon: 'keyboard' },
];
let lastSection = 'general'; // reopening Settings shows the section you left

// Shows a change at once without saving it (a slider being dragged).
const preview = (patch) => { settings.value = { ...settings.value, ...patch }; };

// ---------- building blocks ----------

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
               style={{ '--f': (value - min) / (max - min) }}
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
    <div class="swatches" role="radiogroup" aria-label={t('Accent color')}>
      {Object.entries(ACCENTS).map(([name, a]) => (
        <label key={name} class="swatch" title={t(a.label)} style={{ '--swatch': accentColors(name, themeMode.value).accent }}>
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
    if (!res?.ok) return toast(res?.error || t('The image could not be used.'), 'error');
    settings.value = res.settings;
  };
  return (
    <div class="bg-pick">
      <span class={`bg-thumb ${url ? '' : 'empty'}`} style={url ? { backgroundImage: `url("${url}")` } : undefined}>
        {!url && t('None')}
      </span>
      <button type="button" class="secondary-btn" onClick={() => run(api.background.pick)}>{url ? t('Change…') : t('Choose…')}</button>
      {url && <button type="button" class="secondary-btn" onClick={() => run(api.background.clear)}>{t('Remove')}</button>}
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
    if (!res?.ok) return toast(res?.error || t('The key could not be saved.'), 'error');
    settings.value = res.settings;
    setKey('');
    setEditing(!value);
    toast(value ? t('API key saved. New chat sessions will use it.') : t('API key removed.'));
  };

  return (
    <>
      {editing ? (
        <div class="input-row">
          <input ref={input} type="password" value={key} autofocus={focus} spellcheck={false} autocomplete="off" placeholder="sk-ant-…"
                 aria-label={t('Anthropic API key')} onInput={(e) => setKey(e.currentTarget.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter' && key.trim()) { e.preventDefault(); save(key); } }} />
          <button type="button" class="secondary-btn" disabled={!key.trim()} onClick={() => save(key)}>{t('Save key')}</button>
          {s.hasApiKey && !s.apiKeyUnreadable && (
            <button type="button" class="secondary-btn" onClick={() => { setKey(''); setEditing(false); }}>{t('Cancel')}</button>
          )}
        </div>
      ) : (
        <div class="input-row key-saved">
          <span class="key-state"><Icon name="check" size={13} />{t('Saved, encrypted on this computer')}</span>
          <button type="button" class="secondary-btn" onClick={() => setEditing(true)}>{t('Replace')}</button>
          <button type="button" class="secondary-btn" onClick={() => save('')}>{t('Remove')}</button>
        </div>
      )}
      {s.apiKeyUnreadable && (
        <p class="set-note bad">
          {t('The saved key can’t be decrypted on this computer (the profile was copied or the system keychain changed). Enter it again.')}
        </p>
      )}
    </>
  );
}

// "Claude Code 2.1.301 (built in)", and why chat can't use it when it can't.
function found(check) {
  const name = t('Claude Code {version}', { version: check.version });
  const label = check.bundled ? t('{name} (built in)', { name }) : name;
  return check.chatCapable ? label : t('{label}. CLI sessions only: chat needs an executable file', { label });
}

function Executable() {
  const path = settings.value.claudePath || '';
  const [check, setCheck] = useState(claudeCheck.value);
  const builtIn = claudeUpdate.value.current; // checked again when an update replaces the built-in build
  useEffect(() => {
    let live = true;
    setCheck(null);
    api.detectClaude(path).then((res) => {
      if (!live) return;
      setCheck(res);
      claudeCheck.value = res;
    });
    return () => { live = false; };
  }, [path, builtIn]);
  const save = (value) => saveSettings({ claudePath: value.trim() });
  return (
    <>
      <div class="input-row">
        <TextField value={path} placeholder={t('Built-in (recommended)')} label={t('Claude Code executable')} onSave={save} />
        <button type="button" class="secondary-btn" onClick={async () => {
          const file = await api.pickFile(t('Choose the claude executable'));
          if (file) save(file);
        }}>{t('Browse…')}</button>
      </div>
      <p class={`set-note ${check ? (check.ok ? 'ok' : 'bad') : ''}`}>
        {!check ? t('Checking…')
          : !check.ok ? t('Not found. Leave empty to use the built-in Claude Code.')
          : found(check)}
      </p>
    </>
  );
}

// Updates of the built-in Claude Code: what the app has, what npm has, and a button for the next step.
function ClaudeUpdates() {
  const u = claudeUpdate.value;
  const own = Boolean((settings.value.claudePath || '').trim());
  const busy = ['checking', 'downloading', 'installing'].includes(u.state);
  const pct = u.total ? Math.min(100, Math.round(((u.received || 0) / u.total) * 100)) : null;
  const v = { latest: u.latest, current: u.current, pct };
  const note = own ? t('Not in use: you chose your own Claude Code above. Update that one yourself.')
    : u.state === 'checking' ? t('Checking for a newer version…')
    : u.state === 'available' ? t('Version {latest} is available. You have {current}.', v)
    : u.state === 'downloading' ? (pct == null ? t('Downloading {latest}…', v) : t('Downloading {latest}… {pct}%', v))
    : u.state === 'installing' ? t('Installing {latest}…', v)
    : u.state === 'up-to-date' ? t('Version {current}, the newest.', v)
    : u.state === 'ready' ? t('Updated to {latest}. New sessions use it; running ones keep their version.', v)
    : u.state === 'error' ? u.error
    : u.current ? t('Version {current}', v) : '';
  const run = (action) => { action().catch(() => {}); };
  return (
    <>
      <Row label={t('Built-in Claude Code')} note={<span class={u.state === 'error' && !own ? 'bad' : ''}>{note}</span>}>
        {u.state === 'available' && !own
          ? <button type="button" class="primary-btn" onClick={() => run(api.claudeUpdate.run)}>{t('Update to {latest}', v)}</button>
          : <button type="button" class="secondary-btn" disabled={own || busy} onClick={() => run(api.claudeUpdate.check)}>
              {u.state === 'downloading' || u.state === 'installing' ? t('Updating…') : u.state === 'checking' ? t('Checking…') : t('Check for updates')}
            </button>}
      </Row>
      {u.state === 'downloading' && !own && (
        <div class="set-progress" role="progressbar" aria-label={t('Download')} aria-valuenow={pct ?? undefined}>
          <span style={{ width: `${pct ?? 0}%` }} />
        </div>
      )}
      <ToggleRow setting="autoUpdateClaude" label={t('Update automatically')} disabled={own}
                 note={t('Checks when ccUI starts and every 6 hours, and downloads new versions in the background')} />
    </>
  );
}

// ---------- sections ----------

function General() {
  const s = settings.value;
  return (
    <>
      <Group>
        <Row label={t('Language')} note={t('The app’s own words; Claude answers in the language you write in')}>
          {/* Each language named in itself; Follow system says which one that is now. */}
          <Dropdown label={t('Language')} value={s.language || 'system'} onChange={(v) => saveSettings({ language: v })}
                    options={LANGUAGES.map((l) => (l.value === 'system'
                      ? { value: l.value, label: t('Follow system'), hint: LANGUAGES.find((x) => x.value === systemLocale())?.label }
                      : { value: l.value, label: l.label }))} />
        </Row>
      </Group>
      <Group title={t('New sessions')}>
        <Row label={t('Open as')} note={t('What New session starts with')}>
          <Segmented name="defaultKind" value={s.defaultKind} onChange={(v) => saveSettings({ defaultKind: v })} options={[
            { value: 'chat', label: t('Chat') },
            { value: 'terminal', label: 'CLI' },
          ]} />
        </Row>
        <Row label={t('Model')}>
          <Dropdown label={t('Model')} value={s.defaultModel} onChange={(v) => saveSettings({ defaultModel: v })}
                    options={MODEL_CHOICES.map((m) => ({ value: m.value, label: t(m.label) }))} />
        </Row>
        <Row label={t('Permissions')}>
          <Dropdown label={t('Permissions')} value={s.defaultPermissionMode} onChange={(v) => saveSettings({ defaultPermissionMode: v })}
                    options={PERMISSION_MODES.map((m) => ({ value: m, label: t(MODE_LABELS[m]) }))} />
        </Row>
        <Row label={t('CLI arguments')} note={t('Added to every CLI session')}>
          <TextField value={s.defaultArgs} placeholder={t('e.g. --model sonnet')} label={t('CLI arguments')}
                     onSave={(v) => saveSettings({ defaultArgs: v.trim() })} />
        </Row>
      </Group>
      <Group title={t('Behavior')}>
        <ToggleRow setting="showStarters" label={t('Suggested prompts')} note={t('Shown under the question on a new chat')} />
        <ToggleRow setting="notify" label={t('Notifications')} note={t('When a background session needs you')} />
        <ToggleRow setting="restoreSessions" label={t('Reopen sessions')} note={t('Bring back your sessions when the app starts')} />
        <ToggleRow setting="confirmClose" label={t('Ask before quitting')} note={t('When sessions are still running')} />
      </Group>
    </>
  );
}

function Appearance() {
  const s = settings.value;
  const accent = ACCENTS[s.accent] ? s.accent : 'black';
  const glassSupported = info.value.glassSupported;
  return (
    <>
      <Group>
        <Row label={t('Theme')}>
          <Segmented name="theme" value={s.theme} onChange={(v) => saveSettings({ theme: v })} options={[
            { value: 'system', label: t('System') },
            { value: 'dark', label: t('Dark') },
            { value: 'light', label: t('Light') },
          ]} />
        </Row>
        <Row label={t('Accent color')} note={t(ACCENTS[accent].label)}>
          <AccentPicker value={accent} onChange={(v) => saveSettings({ accent: v })} />
        </Row>
        <SliderRow setting="chatFontSize" label={t('Chat text size')} min={11} max={22} step={1} format={(v) => `${v}px`} />
      </Group>
      <Group title={t('Window')}>
        <ToggleRow setting="sidebarGlass" label={t('Frosted glass')}
                   note={!glassSupported ? t('Menus and pop-ups are frosted. The window itself needs Windows 11 (22H2 or later) or macOS')
                     : backgroundUrl.value ? t('Menus and pop-ups are frosted; the background image takes the window’s place')
                     : t('The desktop shows through the sidebar and top bar, and menus and pop-ups are frosted')} />
        <ToggleRow setting="fillEdge" label={t('Work area to the window’s edge')} note={t('No gap to the right of the chat and CLI')} />
        <Row label={t('Background image')} note={t('Drawn blurred behind the whole window')}>
          <BackgroundImage />
        </Row>
        {backgroundUrl.value && (
          <>
            <SliderRow setting="backgroundShow" label={t('Visibility')} note={t('How much of the image shows through')}
                       min={10} max={90} step={5} format={(v) => `${v}%`} />
            <SliderRow setting="backgroundBlur" label={t('Blur')} min={0} max={40} step={1} format={(v) => `${v}px`} />
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
        <Row label={t('Background')} note={t('Claude Code’s colors are designed for a dark terminal')}>
          <Segmented name="terminalTheme" value={s.terminalTheme || 'match'} onChange={(v) => saveSettings({ terminalTheme: v })} options={[
            { value: 'match', label: t('Match theme') },
            { value: 'dark', label: t('Always dark') },
          ]} />
        </Row>
        <SliderRow setting="fontSize" label={t('Text size')} min={10} max={24} step={1} format={(v) => `${v}px`} />
        <SliderRow setting="lineHeight" label={t('Line height')} min={1} max={1.6} step={0.05} format={(v) => Number(v).toFixed(2)} />
        <Row label={t('Font')} stack>
          <TextField value={s.fontFamily} label={t('Terminal font')}
                     onSave={(v) => saveSettings({ fontFamily: v.trim() || DEFAULT_FONT })} />
        </Row>
      </Group>
      <Group>
        <ToggleRow setting="copyOnSelect" label={t('Copy on select')} note={t('Copy text as soon as you select it')} />
        <ToggleRow setting="cursorBlink" label={t('Blinking cursor')} />
      </Group>
    </>
  );
}

function ClaudeCode({ focusAccount }) {
  return (
    <>
      <Group title={t('Account')}>
        <Row stack label={t('Anthropic API key')}
             note={t('Chat sessions use this key. Without one they use Claude Code’s own credentials: an API key, Amazon Bedrock, Google Vertex AI or Microsoft Foundry. Claude.ai subscription logins work only in CLI sessions.')}>
          <ApiKey focus={focusAccount} />
        </Row>
      </Group>
      <Group title={t('Executable')}>
        <Row stack label="Claude Code" note={t('Leave empty to use the version built into the app')}>
          <Executable />
        </Row>
      </Group>
      <Group title={t('Updates')}>
        <ClaudeUpdates />
      </Group>
    </>
  );
}

function Shortcuts() {
  return (
    <Group>
      {SHORTCUT_LIST.map(([label, keys]) => (
        <div class="set-row shortcut" key={label}><span>{t(label)}</span><kbd>{keys}</kbd></div>
      ))}
    </Group>
  );
}

// ---------- the dialog ----------

function SettingsPanel({ start }) {
  const [section, setSection] = useState(start === 'account' ? 'claude' : SECTIONS.some((x) => x.id === start) ? start : lastSection);
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
      <nav class="settings-nav" aria-label={t('Settings sections')}>
        <h3>{t('Settings')}</h3>
        {SECTIONS.map((x) => (
          <button type="button" key={x.id} class={x.id === section ? 'on' : ''} aria-current={x.id === section ? 'page' : undefined}
                  onClick={() => pick(x.id)}>
            <Icon name={x.icon} size={15} />{t(x.label)}
          </button>
        ))}
        <span class="spacer" />
        <p class="settings-saved">{t('Changes are saved as you make them.')}</p>
      </nav>
      <div class="settings-main">
        <header class="settings-head">
          <h2>{t(current.label)}</h2>
          <button type="submit" class="primary-btn">{t('Done')}</button>
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
