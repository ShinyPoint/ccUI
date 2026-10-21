// Message box for chat sessions: slash-command and @file autocomplete, image attachments,
// permission-mode and model menus (with the effort slider), context meter, send / stop.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon, Menu, Popover } from '../ui.jsx';
import { modeLabel } from './Prompts.jsx';
import { api, toast, confirmDialog } from '../../lib/store.js';
import { sendMessage, interrupt, setMode, setModel, setEffort, refreshContext } from '../../lib/sessions.js';
import { commandList, runCommand } from '../../lib/commands.js';
import { EffortSlider } from './EffortSlider.jsx';
import { formatTokens, formatCost } from '../../lib/format.js';
import { SHORTCUTS } from '../../lib/keyboard.js';
import { t, phrase } from '../../lib/i18n.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const BASE_MODES = ['default', 'acceptEdits', 'plan'];
// The mark in front of the permission mode (lib/icons.js), colored per mode in chat.css.
const MODE_ICONS = {
  default: 'modeAsk',
  acceptEdits: 'modeAcceptEdits',
  plan: 'modePlan',
  auto: 'modeAuto',
  bypassPermissions: 'modeBypass',
};

// The model menu's entry for the model in use. Ids may carry a context-size suffix the list doesn't (claude-opus-5-5[1m]
// runs Opus with a 1M window), and the list may name a model by its alias (opus) rather than its id.
const baseId = (id) => String(id || '').replace(/\[\w+\]$/, '').toLowerCase();
const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable'];
function findModel(models, selected, running) {
  const exact = selected && models.find((m) => m.value === selected);
  if (exact) return exact;
  const want = baseId(selected || running);
  if (!want) return null;
  // Nothing chosen: the default, when that is what runs.
  const byDefault = !selected && models.find((m) => m.value === 'default' && m.resolvedModel && baseId(m.resolvedModel) === want);
  if (byDefault) return byDefault;
  const named = models.find((m) => m.value !== 'default' && (baseId(m.value) === want || (m.resolvedModel && baseId(m.resolvedModel) === want)));
  if (named) return named;
  const family = FAMILIES.find((f) => want.includes(f));
  return (family && models.find((m) => m.value !== 'default' && (baseId(m.value) === family || m.displayName?.toLowerCase().startsWith(family)))) || null;
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_IMAGE_BYTES) return reject(new Error(t('{name} is larger than 5 MB.', { name: file.name || t('Image') })));
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve({ mediaType: file.type, data: url.slice(url.indexOf(',') + 1), preview: url });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Subsequence match with a bonus for hits in the file name; lower is better.
function fuzzyScore(path, query) {
  const p = path.toLowerCase();
  const q = query.toLowerCase();
  const nameStart = p.lastIndexOf('/') + 1;
  if (p.startsWith(q, nameStart)) return p.length - nameStart;
  let pos = -1;
  let gaps = 0;
  for (const ch of q) {
    const next = p.indexOf(ch, pos + 1);
    if (next === -1) return Infinity;
    gaps += next - pos - 1;
    pos = next;
  }
  return 1000 + gaps + (pos < nameStart ? 500 : 0);
}

function findTrigger(text, caret) {
  const before = text.slice(0, caret);
  if (/^\/\S*$/.test(before)) return { kind: 'slash', query: before.slice(1), start: 0 };
  const at = /(^|\s)@([^\s@]*)$/.exec(before);
  if (at) return { kind: 'file', query: at[2], start: caret - at[2].length - 1 };
  return null;
}

// Claude Code's names for what fills the context window; others show as they come.
const CONTEXT_ROWS = new Set([
  phrase('System prompt'), phrase('System tools'), phrase('MCP tools'), phrase('Memory files'), phrase('Skills'),
  phrase('Custom agents'), phrase('Messages'), phrase('Free space'), phrase('Autocompact buffer'),
]);
const rowName = (name) => (CONTEXT_ROWS.has(name) ? t(name) : name);

// How full the context window is: a ring and a percentage that open the breakdown (what takes the space, the
// session's cost) and a button to compact the conversation.
function ContextButton({ s, onCompact }) {
  const context = s.context.value;
  if (!context?.maxTokens) return null;
  const pct = Math.min(100, Math.round(context.percentage ?? (context.totalTokens / context.maxTokens) * 100));
  const r = 7;
  const c = 2 * Math.PI * r;
  const rows = (context.categories || []).filter((x) => x.kind !== 'deferred' && x.tokens > 0);
  const cost = s.chat.value.costTotal;
  return (
    <Popover className={`context-menu-wrap ${pct >= 80 ? 'high' : ''}`} align="right" panelClass="context-pop"
             title={t('Context: {pct}% used', { pct })} onOpen={() => refreshContext(s)}
             button={(
               <span class="context-meter">
                 <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                   <circle cx="9" cy="9" r={r} class="track" />
                   <circle cx="9" cy="9" r={r} class="fill" stroke-dasharray={`${(c * pct) / 100} ${c}`} transform="rotate(-90 9 9)" />
                 </svg>
                 <span class="menu-text">{pct}%</span>
               </span>
             )}>
      {(close) => (
        <>
          <div class="ctx-head">
            <span class="ctx-title">{t('Context')}</span>
            <span class="ctx-total">{formatTokens(context.totalTokens)} / {formatTokens(context.maxTokens)}</span>
          </div>
          <div class="ctx-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <div class="ctx-pct">{t('{pct}% used', { pct })}</div>
          {rows.length > 0 && (
            <ul class="ctx-rows">
              {rows.map((x) => (
                <li key={x.name} class={`ctx-${x.kind}`}><span>{rowName(x.name)}</span><span>{formatTokens(x.tokens)}</span></li>
              ))}
            </ul>
          )}
          <div class="ctx-foot">
            <div class="ctx-cost"><span>{t('This session')}</span><span>{formatCost(cost || 0)}</span></div>
            <button type="button" class="secondary-btn" title={t('Summarize the conversation so far to free up context (/compact)')}
                    onClick={() => { close(); onCompact(); }}>
              {t('Compact conversation')}
            </button>
          </div>
        </>
      )}
    </Popover>
  );
}

export function Composer({ s, prefill }) {
  const chat = s.chat.value;
  const meta = s.meta.value;
  const [text, setText] = useState(s.draft || '');
  const [images, setImages] = useState(s.draftImages || []);
  const [ac, setAc] = useState(null); // { kind, query, start, items, index }
  const input = useRef(null);
  const root = useRef(null);
  const acList = useRef(null);
  const fileInput = useRef(null);
  const files = useRef(null);
  const historyIndex = useRef(-1);

  // What is being written stays with the session while another one is shown (the composer is made anew).
  useEffect(() => { s.draft = text; }, [text]);
  useEffect(() => { s.draftImages = images; }, [images]);
  useEffect(() => { input.current?.focus(); }, [s.uid]);
  // Queued messages that Stop cancelled come back here, in front of whatever is being typed.
  const restore = s.restore.value;
  useEffect(() => {
    if (!restore) return;
    s.restore.value = null;
    setText((typed) => [restore.text, typed].filter(Boolean).join('\n\n'));
    setImages((list) => [...restore.images.map((img) => ({ ...img, preview: img.preview || `data:${img.mediaType};base64,${img.data}` })), ...list]);
    input.current?.focus();
  }, [restore]);
  useEffect(() => {
    if (!prefill) return;
    setText(prefill.text);
    input.current?.focus();
  }, [prefill]);
  useLayoutEffect(() => {
    const el = input.current;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const busy = chat.busy;
  const mode = chat.init?.permissionMode || s.mode.value || 'default';
  const models = meta.models || [];
  const currentModel = findModel(models, s.selectedModel.value, chat.init?.model);
  const longContext = /\[1m\]$/i.test(s.selectedModel.value || chat.init?.model || '');
  const modelLabel = currentModel ? `${currentModel.displayName}${longContext && !/1m/i.test(currentModel.displayName) ? ' · 1M' : ''}`
    : chat.init?.model || s.selectedModel.value || t('Default model');
  const modes = currentModel?.supportsAutoMode ? [...BASE_MODES, 'auto'] : BASE_MODES;
  // Effort levels come from the running model; before the first turn names it, from Claude Code's default.
  const effortModel = currentModel || (!s.selectedModel.value && models.find((m) => m.value === 'default'));
  const effortLevels = effortModel?.supportsEffort ? effortModel.supportedEffortLevels || [] : [];

  async function updateAutocomplete(value, caret) {
    const trigger = findTrigger(value, caret);
    if (!trigger) return setAc(null);
    let items;
    if (trigger.kind === 'slash') {
      // Every command, those whose name starts with what is typed first, then those with it elsewhere (or in
      // another name for it). The ones only the CLI can show are marked.
      const q = trigger.query.toLowerCase();
      const rank = (c) => {
        const names = [c.name, ...(c.aliases || [])].map((n) => n.replace(/^\//, '').toLowerCase());
        if (names[0].startsWith(q)) return 0;
        if (names.some((n) => n.startsWith(q))) return 1;
        return names.some((n) => n.includes(q)) ? 2 : -1;
      };
      items = commandList(s)
        .map((c) => [c, rank(c)])
        .filter(([, r]) => r >= 0)
        .sort((a, b) => a[1] - b[1])
        .map(([c]) => {
          const name = `/${c.name.replace(/^\//, '')}`;
          // (The app's own commands' texts are translated; Claude Code's come in English and show as they are.)
          const description = c.description ? t(c.description) : '';
          return { value: name, label: name, hint: c.argumentHint ? `${t(c.argumentHint)} · ${description}` : description, cli: c.cli };
        });
    } else {
      if (!files.current) {
        files.current = await api.listFiles(s.cwd);
        // The file list took a moment: only show it if the text still has this @-mention under the caret.
        const el = input.current;
        if (!el || el.value !== value || el.selectionStart !== caret) return;
      }
      items = trigger.query
        ? files.current.map((f) => [f, fuzzyScore(f, trigger.query)]).filter(([, sc]) => sc < Infinity).sort((a, b) => a[1] - b[1]).slice(0, 8).map(([f]) => f)
        : files.current.slice(0, 8);
      items = items.map((f) => ({ value: f, label: f }));
    }
    setAc(items.length ? { ...trigger, items, index: 0 } : null);
  }

  function accept(item) {
    const el = input.current;
    const caret = el.selectionStart;
    const insert = ac.kind === 'slash' ? `${item.value} ` : `@${item.value} `;
    const next = text.slice(0, ac.start) + insert + text.slice(caret);
    setText(next);
    setAc(null);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = ac.start + insert.length;
    });
  }

  // What a command (lib/commands.js) may ask of the message box.
  const ui = {
    openModelMenu: () => {
      const button = root.current?.querySelector('.model-menu .menu-button');
      if (button) button.click();
      else toast(t('The models aren’t loaded yet: send a message first.'));
    },
    openContext: () => {
      const button = root.current?.querySelector('.context-menu-wrap .menu-button');
      if (button) button.click();
      else toast(t('Context usage shows after Claude’s first reply.'));
    },
    // After the message box empties for the command that asked.
    showAll: () => {
      requestAnimationFrame(() => {
        setText('/');
        input.current?.focus();
        if (input.current) input.current.selectionStart = input.current.selectionEnd = 1;
        updateAutocomplete('/', 1);
      });
    },
  };

  function send() {
    const value = text.trim();
    if (!value && !images.length) return;
    const handled = !images.length && runCommand(s, value, ui);
    if (handled) {
      if (handled === 'ran') setText('');
      setAc(null);
      return;
    }
    sendMessage(s, { text: value, images: images.map(({ mediaType, data }) => ({ mediaType, data })) });
    if (!s.title.value && value && !value.startsWith('/')) s.title.value = value.split('\n')[0].slice(0, 80);
    setText('');
    setImages([]);
    setAc(null);
    historyIndex.current = -1;
  }

  async function addFiles(fileList) {
    for (const file of fileList) {
      if (file.type.startsWith('image/')) {
        try {
          const img = await readImage(file);
          setImages((list) => [...list, img]);
        } catch (err) {
          toast(err.message, 'error');
        }
      } else {
        const path = api.pathForFile(file);
        if (path) setText((typed) => `${typed}${typed && !/\s$/.test(typed) ? ' ' : ''}@${path} `);
      }
    }
  }

  function cycleMode() {
    const next = modes[(modes.indexOf(mode) + 1) % modes.length];
    setMode(s, next);
  }

  function onKeyDown(e) {
    if (ac) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const index = (ac.index + step + ac.items.length) % ac.items.length;
        setAc({ ...ac, index });
        requestAnimationFrame(() => acList.current?.children[index]?.scrollIntoView({ block: 'nearest' }));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        // The command is already typed out in full: Enter runs it instead of completing it again.
        if (e.key === 'Enter' && ac.kind === 'slash' && ac.items[ac.index].value === text.trim()) {
          setAc(null);
          send();
          return;
        }
        accept(ac.items[ac.index]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setAc(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape' && busy) {
      e.preventDefault();
      interrupt(s);
    } else if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      cycleMode();
    } else if (e.key === 'ArrowUp' && !text && e.currentTarget.selectionStart === 0) {
      const prompts = chat.items.filter((i) => i.type === 'user' && i.text).map((i) => i.text).reverse();
      const next = prompts[historyIndex.current + 1];
      if (next) {
        e.preventDefault();
        historyIndex.current++;
        setText(next);
      }
    }
  }

  const canSend = text.trim() || images.length;
  return (
    <div class="chat-composer" ref={root} onDragOver={(e) => e.preventDefault()}
         onDrop={(e) => { e.preventDefault(); addFiles([...e.dataTransfer.files]); }}>
      {ac && (
        <ul class="autocomplete" role="listbox" ref={acList}>
          {ac.items.map((item, i) => (
            <li key={item.value}>
              <button type="button" role="option" aria-selected={i === ac.index} class={i === ac.index ? 'selected' : ''}
                      onMouseDown={(e) => { e.preventDefault(); accept(item); }}>
                <span class="ac-label">{item.label}</span>
                {item.hint && <span class="ac-hint">{item.hint}</span>}
                {item.cli && <span class="ac-tag" title={t('Shown in Claude Code’s CLI: the chat offers to continue there')}>CLI</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {images.length > 0 && (
        <div class="attachments">
          {images.map((img, i) => (
            <div class="attachment" key={i}>
              <img src={img.preview} alt={t('Attachment')} />
              <button type="button" class="icon-btn" title={t('Remove image')} onClick={() => setImages(images.filter((_, j) => j !== i))}>
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={input}
        class="composer-input"
        rows={1}
        spellcheck={false}
        value={text}
        placeholder={busy ? t('Claude is working. Send a message to queue it: Claude reads it at its next step. Stop cancels it.') : t('Ask Claude to build, fix or explain something. Type / for commands and @ for files.')}
        onInput={(e) => {
          setText(e.currentTarget.value);
          updateAutocomplete(e.currentTarget.value, e.currentTarget.selectionStart);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setAc(null), 120)}
        onPaste={(e) => {
          const pasted = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
          if (pasted.length) {
            e.preventDefault();
            addFiles(pasted);
          }
        }}
      />
      <div class="composer-bar">
        <Menu
          className="mode-menu"
          title={t('Permission mode ({key} to switch)', { key: SHORTCUTS.mode })}
          label={<><span class={`mode-icon mode-${mode}`}><Icon name={MODE_ICONS[mode] || 'modeAsk'} size={14} /></span><span class="menu-text">{modeLabel(mode)}</span></>}
          value={mode}
          options={[...modes, 'bypassPermissions'].map((m) => ({ value: m, label: modeLabel(m), hint: t(MODE_HINTS[m]) }))}
          onSelect={async (m) => {
            if (m === 'bypassPermissions' && mode !== m && !(await confirmDialog({
              title: t('Bypass permissions?'), message: t(BYPASS_WARNING), confirm: t('Bypass permissions'), danger: true,
            }))) return;
            setMode(s, m);
          }}
        />
        <button type="button" class="icon-btn" title={t('Attach images')} onClick={() => fileInput.current.click()}>
          <Icon name="clip" />
        </button>
        <input ref={fileInput} type="file" accept="image/*" multiple hidden
               onChange={(e) => { addFiles([...e.currentTarget.files]); e.currentTarget.value = ''; }} />
        <span class="spacer" />
        {models.length > 0 && (
          <Menu
            className="model-menu"
            title={t('Model and effort')}
            align="right"
            label={<span class="menu-text">{modelLabel}</span>}
            value={currentModel?.value}
            options={models.map((m) => ({ value: m.value, label: m.displayName, hint: m.description }))}
            onSelect={(v) => setModel(s, v)}
            footer={(
              <EffortSlider
                levels={effortLevels}
                value={s.effort.value}
                onChange={(level) => setEffort(s, level)}
              />
            )}
          />
        )}
        <ContextButton s={s} onCompact={() => sendMessage(s, { text: '/compact' })} />
        {busy && !canSend ? (
          <button type="button" class="send-btn stop" title={t('Stop ({key})', { key: SHORTCUTS.interrupt })} onClick={() => interrupt(s)}>
            <Icon name="stop" size={14} />
          </button>
        ) : (
          <button type="button" class="send-btn" title={t('Send (Enter)')} disabled={!canSend} onClick={send}>
            <Icon name="send" size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

const MODE_HINTS = {
  default: phrase('Claude asks before editing files or running commands'),
  acceptEdits: phrase('File edits are applied without asking'),
  plan: phrase('Claude researches and proposes a plan before changing anything'),
  auto: phrase('A safety classifier approves routine actions'),
  bypassPermissions: phrase('Claude acts without asking, for anything'),
};

// Bypass is only chosen on purpose: it is in the menu (with this warning), not in the Shift+Tab cycle.
const BYPASS_WARNING = phrase('Claude will edit files and run any command in this session without asking you first, including ones that delete files or reach the internet. Use it only in a folder you can afford to lose, such as a disposable copy or a container.');
