// Settings: a list of sections on the left, grouped rows on the right. Every change applies (and is saved)
// as soon as it is made: switches, choices and swatches right away, sliders when let go (previewed while
// dragging), text fields when they lose focus or on Enter.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Dialog, Dropdown, Segmented, Icon, Collapse, SetGroup as Group, SetRow as Row, Switch } from '../ui.jsx';
import { MODE_LABELS } from '../chat/Prompts.jsx';
import { MODEL_CHOICES } from './NewSessionDialog.jsx';
import { api, info, settings, saveSettings, settingsDialog, claudeCheck, claudeUpdate, toast, themeMode, backgroundUrl } from '../../lib/store.js';
import { SHORTCUT_LIST } from '../../lib/keyboard.js';
import { chatsFolder } from '../../lib/sessions.js';
import { tildify } from '../../lib/format.js';
import { PALETTES } from '../../lib/themes.js';
import { t, phrase, locale, LANGUAGES, systemLocale } from '../../lib/i18n.js';

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

// `live`: the change shows while dragging. Off for the UI scale, which would move the slider under the pointer:
// the number follows the drag and the window changes when the slider is let go. That is the input's own change
// event, listened to directly: preact/compat (loaded for memo) turns an onChange prop into an input listener.
function SliderRow({ setting, label, note, min, max, step, format = String, live = true }) {
  const [dragged, setDragged] = useState(null);
  const input = useRef(null);
  const value = dragged ?? Number(settings.value[setting]);
  useEffect(() => {
    const el = input.current;
    const done = () => { setDragged(null); saveSettings({ [setting]: Number(el.value) }); };
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, [setting]);
  return (
    <Row label={label} note={note}>
      <div class="set-slider">
        <input ref={input} type="range" min={min} max={max} step={step} value={value} aria-label={label}
               style={{ '--f': (value - min) / (max - min) }}
               onInput={(e) => (live ? preview({ [setting]: Number(e.currentTarget.value) }) : setDragged(Number(e.currentTarget.value)))} />
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

// A row of round color swatches, one per color theme (lib/themes.js), like macOS's accent color setting.
function PalettePicker({ value, onChange }) {
  return (
    <div class="swatches" role="radiogroup" aria-label={t('Color theme')}>
      {Object.entries(PALETTES).map(([name, p]) => (
        <label key={name} class="swatch" title={t(p.label)} style={{ '--swatch': p.swatch[themeMode.value] }}>
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
      <p class={`set-note ${check ? (check.ok ? 'ok' : check.missing ? '' : 'bad') : ''}`}>
        {!check ? t('Checking…')
          : check.missing ? t('The built-in Claude Code is downloaded when the first session starts.')
          : !check.ok ? t('Not found. Leave empty to use the built-in Claude Code.')
          : found(check)}
      </p>
    </>
  );
}

const UPDATE_BUSY = ['checking', 'downloading', 'installing'];

// Updates of the built-in Claude Code: what the app has, what npm has, and a button for the next step; then
// which version to use.
function ClaudeUpdates() {
  const u = claudeUpdate.value;
  const own = Boolean((settings.value.claudePath || '').trim());
  const pinned = settings.value.claudeVersion || '';
  const busy = UPDATE_BUSY.includes(u.state);
  const pct = u.total ? Math.min(100, Math.round(((u.received || 0) / u.total) * 100)) : null;
  const v = { latest: u.latest, current: u.current, target: u.target || u.latest, pct };
  const note = own ? t('Not in use: you chose your own Claude Code above. Update that one yourself.')
    : u.state === 'checking' ? t('Checking for a newer version…')
    : u.state === 'available' ? t('Version {latest} is available. You have {current}.', v)
    : u.state === 'pinned' ? t('Version {current}, chosen below. The newest is {latest}.', v)
    : u.state === 'downloading' ? (pct == null ? t('Downloading {target}…', v) : t('Downloading {target}… {pct}%', v))
    : u.state === 'installing' ? t('Installing {target}…', v)
    : u.state === 'up-to-date' ? t('Version {current}, the newest.', v)
    : u.state === 'ready' ? t('Version {target} is ready. New sessions use it; running ones keep their version.', v)
    : u.state === 'error' ? u.error
    : u.current ? t('Version {current}', v)
    : t('Not downloaded yet. It is downloaded when the first session starts.');
  const run = (action) => { action().catch(() => {}); };
  return (
    <>
      <Row label={t('Built-in Claude Code')} note={<span class={u.state === 'error' && !own ? 'bad' : ''}>{note}</span>}>
        {u.state === 'available' && !own
          ? <button type="button" class="primary-btn" onClick={() => run(api.claudeUpdate.run)}>{t('Update to {latest}', v)}</button>
          : !u.current && !own && !busy
            ? <button type="button" class="primary-btn" onClick={() => run(api.claudeUpdate.run)}>{t('Download')}</button>
            : <button type="button" class="secondary-btn" disabled={own || busy} onClick={() => run(api.claudeUpdate.check)}>
                {u.state === 'downloading' || u.state === 'installing' ? t('Updating…') : u.state === 'checking' ? t('Checking…') : t('Check for updates')}
              </button>}
      </Row>
      {u.state === 'downloading' && !own && (
        <div class="set-progress" role="progressbar" aria-label={t('Download')} aria-valuenow={pct ?? undefined}>
          <span style={{ width: `${pct ?? 0}%` }} />
        </div>
      )}
      <ClaudeVersion own={own} />
      <ToggleRow setting="autoUpdateClaude" label={t('Update automatically')} disabled={own || Boolean(pinned)}
                 value={pinned ? false : undefined}
                 note={pinned ? t('Off while a version is chosen above')
                   : t('Checks when ccUI starts and every 6 hours, and downloads new versions in the background')} />
    </>
  );
}

// Which Claude Code version the built-in one is: the newest (kept current), one of the recent ones from npm, or
// any other typed in. A version not on this computer is downloaded first; the choice is saved once it is here.
function ClaudeVersion({ own }) {
  const pinned = settings.value.claudeVersion || '';
  const current = claudeUpdate.value.current;
  const [list, setList] = useState(null); // { ok, versions: [{ version, date, here }] } | { ok: false, error }
  const [other, setOther] = useState(false);
  const [typed, setTyped] = useState('');
  const [choosing, setChoosing] = useState(null); // the version being fetched to be used ('' for the newest)
  // Why the last choice could not be used: shown in the row (a toast would be under this dialog).
  const [error, setError] = useState('');
  // Asked again when the version in use changes: the "on this computer" marks follow the downloads.
  useEffect(() => {
    let live = true;
    api.claudeUpdate.versions().then((res) => { if (live) setList(res || { ok: false }); });
    return () => { live = false; };
  }, [current]);

  const use = async (version) => {
    setChoosing(version);
    setError('');
    const res = await api.claudeUpdate.use(version);
    setChoosing(null);
    if (!res?.ok) return setError(res?.error || t('That version could not be used.'));
    await saveSettings({ claudeVersion: version });
    setOther(false);
    setTyped('');
  };
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString(locale.value, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
  const versions = list?.ok ? list.versions : [];
  const options = [
    { value: 'newest', label: t('Newest'), hint: versions[0]?.version || (list ? '' : t('Loading versions…')) },
    ...versions.map((x) => ({ value: x.version, label: x.version, hint: x.here ? t('{date} · on this computer', { date: day(x.date) }) : day(x.date) })),
    // A version chosen earlier that is no longer among the recent ones.
    ...(pinned && !versions.some((x) => x.version === pinned) ? [{ value: pinned, label: pinned }] : []),
    { value: 'other', label: t('Other version…') },
  ];
  const value = other ? 'other' : choosing != null ? (choosing || 'newest') : pinned || 'newest';
  const valid = /^\d+\.\d+\.\d+$/.test(typed.trim());
  const pick = (choice) => {
    if (choice === 'other') return setOther(true);
    setOther(false);
    if (choice !== (pinned || 'newest')) use(choice === 'newest' ? '' : choice);
  };
  const note = error ? <span class="bad">{error}</span>
    : list && !list.ok ? t('The list of versions could not be loaded. Another version can still be typed in.')
    : t('An older version may not support everything chat sessions do. If sessions stop starting, go back to Newest.');
  return (
    <>
      <Row label={t('Version')} note={note}>
        <Dropdown label={t('Claude Code version')} value={value} options={options} onChange={pick} disabled={own || choosing != null} />
      </Row>
      <Collapse open={other && !own}>
        <div class="set-row set-version-other">
          <div class="input-row">
            <input type="text" value={typed} placeholder="2.1.300" spellcheck={false} aria-label={t('Claude Code version')}
                   onInput={(e) => { setTyped(e.currentTarget.value); setError(''); }}
                   onKeyDown={(e) => { if (e.key === 'Enter' && valid && choosing == null) { e.preventDefault(); use(typed.trim()); } }} />
            <button type="button" class="secondary-btn" disabled={!valid || choosing != null} onClick={() => use(typed.trim())}>
              {choosing ? t('Downloading…') : t('Use')}
            </button>
          </div>
        </div>
      </Collapse>
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
        <Row label={t('Default session')} note={t('What a project’s + opens')}>
          <Segmented name="defaultKind" value={s.defaultKind} onChange={(v) => saveSettings({ defaultKind: v })} options={[
            { value: 'chat', label: t('Chat') },
            { value: 'terminal', label: 'CLI' },
            { value: 'shell', label: t('Shell') },
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
        <Row label={t('Sessions without a project')} note={t('New session starts them in {folder}', { folder: tildify(chatsFolder()) })}>
          <button type="button" class="secondary-btn" onClick={async () => {
            const folder = await api.pickFolder(chatsFolder());
            if (folder) saveSettings({ chatsFolder: folder });
          }}>{t('Change…')}</button>
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
  const palette = PALETTES[s.accent] ? s.accent : 'black';
  const { glassSupported, glassAvailable } = info.value;
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
        <Row label={t('Color theme')} note={t(PALETTES[palette].label)}>
          <PalettePicker value={palette} onChange={(v) => saveSettings({ accent: v })} />
        </Row>
        <SliderRow setting="uiScale" label={t('UI scale')} note={t('The size of everything in the window')} live={false}
                   min={80} max={150} step={5} format={(v) => `${v}%`} />
        <SliderRow setting="chatFontSize" label={t('Chat text size')} min={11} max={22} step={1} format={(v) => `${v}px`} />
      </Group>
      <Group title={t('Window')}>
        <ToggleRow setting="sidebarGlass" label={t('Frosted glass')}
                   note={!glassSupported ? t('Menus and pop-ups are frosted. The window itself needs Windows 11 (22H2 or later) or macOS')
                     : !glassAvailable ? t('Menus and pop-ups are frosted. The window itself needs graphics acceleration, which isn’t available on this computer')
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
