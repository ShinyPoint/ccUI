// Message box for chat sessions: slash-command and @file autocomplete, image attachments,
// permission-mode and model menus (with the effort slider), context meter, send / stop.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon, Menu, Popover } from '../ui.jsx';
import { MODE_LABELS } from './Prompts.jsx';
import { api, toast, skillsDialog, confirmDialog } from '../../lib/store.js';
import { sendMessage, interrupt, setMode, setModel, setEffort, refreshContext } from '../../lib/sessions.js';
import { EffortSlider } from './EffortSlider.jsx';
import { formatTokens, formatCost } from '../../lib/format.js';
import { SHORTCUTS } from '../../lib/keyboard.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// Commands the app answers itself in a chat, in place of Claude Code's interactive CLI screens.
const APP_COMMANDS = [
  { name: 'skills', description: 'Manage skills: turn them on or off, see what they cost in context', run: (s) => { skillsDialog.value = s; } },
];
// Claude Code's commands that only work in its CLI. The session names them in its first reply
// (terminal_slash_commands); these are the ones it names today, for before that.
const CLI_ONLY = ['doctor', 'color', 'focus', 'reload-plugins'];
// `/name` at the start of a message (not a path like /usr/bin).
const commandName = (text) => /^\/([\w:.-]+)(?:\s|$)/.exec(text)?.[1] || null;
const BASE_MODES = ['default', 'acceptEdits', 'plan'];
// The mark in front of the permission mode (lib/icons.js), colored per mode in chat.css.
const MODE_ICONS = {
  default: 'modeAsk',
  acceptEdits: 'modeAcceptEdits',
  plan: 'modePlan',
  auto: 'modeAuto',
  bypassPermissions: 'modeBypass',
};

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_IMAGE_BYTES) return reject(new Error(`${file.name || 'Image'} is larger than 5 MB.`));
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
             title={`Context: ${pct}% used`} onOpen={() => refreshContext(s)}
             button={(
               <span class="context-meter">
                 <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                   <circle cx="9" cy="9" r={r} class="track" />
                   <circle cx="9" cy="9" r={r} class="fill" stroke-dasharray={`${(c * pct) / 100} ${c}`} transform="rotate(-90 9 9)" />
                 </svg>
                 {pct}%
               </span>
             )}>
      {(close) => (
        <>
          <div class="ctx-head">
            <span class="ctx-title">Context</span>
            <span class="ctx-total">{formatTokens(context.totalTokens)} / {formatTokens(context.maxTokens)}</span>
          </div>
          <div class="ctx-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <div class="ctx-pct">{pct}% used</div>
          {rows.length > 0 && (
            <ul class="ctx-rows">
              {rows.map((x) => (
                <li key={x.name} class={`ctx-${x.kind}`}><span>{x.name}</span><span>{formatTokens(x.tokens)}</span></li>
              ))}
            </ul>
          )}
          <div class="ctx-foot">
            <div class="ctx-cost"><span>This session</span><span>{formatCost(cost || 0)}</span></div>
            <button type="button" class="secondary-btn" title="Summarize the conversation so far to free up context (/compact)"
                    onClick={() => { close(); onCompact(); }}>
              Compact conversation
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
  const [images, setImages] = useState([]);
  const [ac, setAc] = useState(null); // { kind, query, start, items, index }
  const input = useRef(null);
  const fileInput = useRef(null);
  const files = useRef(null);
  const historyIndex = useRef(-1);

  useEffect(() => { s.draft = text; }, [text]);
  useEffect(() => { input.current?.focus(); }, [s.uid]);
  // Queued messages that Stop cancelled come back here, in front of whatever is being typed.
  const restore = s.restore.value;
  useEffect(() => {
    if (!restore) return;
    s.restore.value = null;
    setText((t) => [restore.text, t].filter(Boolean).join('\n\n'));
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
  const currentModel = models.find((m) => m.value === s.selectedModel.value)
    || models.find((m) => m.resolvedModel && m.resolvedModel === chat.init?.model)
    || models.find((m) => chat.init?.model && m.value === chat.init.model);
  const modelLabel = currentModel?.displayName || chat.init?.model || s.selectedModel.value || 'Default model';
  const modes = currentModel?.supportsAutoMode ? [...BASE_MODES, 'auto'] : BASE_MODES;
  // Effort levels come from the running model; before the first turn names it, from Claude Code's default.
  const effortModel = currentModel || (!s.selectedModel.value && models.find((m) => m.value === 'default'));
  const effortLevels = effortModel?.supportsEffort ? effortModel.supportedEffortLevels || [] : [];

  async function updateAutocomplete(value, caret) {
    const trigger = findTrigger(value, caret);
    if (!trigger) return setAc(null);
    let items;
    if (trigger.kind === 'slash') {
      const hidden = new Set(chat.init?.terminalCommands || CLI_ONLY);
      items = [...APP_COMMANDS, ...(meta.commands || []).filter((c) => !APP_COMMANDS.some((a) => a.name === c.name))]
        .filter((c) => !hidden.has(c.name))
        .filter((c) => c.name.replace(/^\//, '').toLowerCase().includes(trigger.query.toLowerCase()))
        .sort((a, b) => a.name.replace(/^\//, '').indexOf(trigger.query) - b.name.replace(/^\//, '').indexOf(trigger.query))
        .slice(0, 8)
        .map((c) => ({ value: `/${c.name.replace(/^\//, '')}`, label: `/${c.name.replace(/^\//, '')}`, hint: c.argumentHint ? `${c.argumentHint} · ${c.description}` : c.description }));
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

  // A slash command the chat can't run: the app's own (/skills) runs here; one only Claude Code's CLI has would
  // otherwise reach Claude as an ordinary message. Returns 'ran' or 'blocked' (the text stays to be fixed), or
  // false to send it.
  function handleCommand(value) {
    const name = commandName(value);
    if (!name) return false;
    const own = APP_COMMANDS.find((c) => c.name === name);
    if (own) {
      own.run(s);
      return 'ran';
    }
    const commands = meta.commands || [];
    if (!commands.length) return false; // not loaded yet: let Claude Code decide
    const known = commands.some((c) => c.name === name || c.aliases?.includes(name));
    const cliOnly = (chat.init?.terminalCommands || CLI_ONLY).includes(name);
    if (known && !cliOnly) return false;
    toast(`/${name} ${known ? 'only works' : 'isn’t a command here. If it is one of Claude Code’s, it works'} in the CLI: switch with the CLI button at the top.`, 'error');
    return 'blocked';
  }

  function send() {
    const value = text.trim();
    if (!value && !images.length) return;
    const handled = !images.length && handleCommand(value);
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
        if (path) setText((t) => `${t}${t && !/\s$/.test(t) ? ' ' : ''}@${path} `);
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
        setAc({ ...ac, index: (ac.index + step + ac.items.length) % ac.items.length });
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
    <div class="chat-composer" onDragOver={(e) => e.preventDefault()}
         onDrop={(e) => { e.preventDefault(); addFiles([...e.dataTransfer.files]); }}>
      {ac && (
        <ul class="autocomplete" role="listbox">
          {ac.items.map((item, i) => (
            <li key={item.value}>
              <button type="button" role="option" aria-selected={i === ac.index} class={i === ac.index ? 'selected' : ''}
                      onMouseDown={(e) => { e.preventDefault(); accept(item); }}>
                <span class="ac-label">{item.label}</span>
                {item.hint && <span class="ac-hint">{item.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {images.length > 0 && (
        <div class="attachments">
          {images.map((img, i) => (
            <div class="attachment" key={i}>
              <img src={img.preview} alt="Attachment" />
              <button type="button" class="icon-btn" title="Remove image" onClick={() => setImages(images.filter((_, j) => j !== i))}>
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
        placeholder={busy ? 'Claude is working. Send a message to queue it: Claude reads it at its next step. Stop cancels it.' : 'Ask Claude to build, fix or explain something. Type / for commands and @ for files.'}
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
          title={`Permission mode (${SHORTCUTS.mode} to switch)`}
          label={<><span class={`mode-icon mode-${mode}`}><Icon name={MODE_ICONS[mode] || 'modeAsk'} size={14} /></span>{MODE_LABELS[mode] || mode}</>}
          value={mode}
          options={[...modes, 'bypassPermissions'].map((m) => ({ value: m, label: MODE_LABELS[m], hint: MODE_HINTS[m] }))}
          onSelect={async (m) => {
            if (m === 'bypassPermissions' && mode !== m && !(await confirmDialog({
              title: 'Bypass permissions?', message: BYPASS_WARNING, confirm: 'Bypass permissions', danger: true,
            }))) return;
            setMode(s, m);
          }}
        />
        <button type="button" class="icon-btn" title="Attach images" onClick={() => fileInput.current.click()}>
          <Icon name="clip" />
        </button>
        <input ref={fileInput} type="file" accept="image/*" multiple hidden
               onChange={(e) => { addFiles([...e.currentTarget.files]); e.currentTarget.value = ''; }} />
        <span class="spacer" />
        {models.length > 0 && (
          <Menu
            title="Model and effort"
            align="right"
            label={modelLabel}
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
          <button type="button" class="send-btn stop" title={`Stop (${SHORTCUTS.interrupt})`} onClick={() => interrupt(s)}>
            <Icon name="stop" size={14} />
          </button>
        ) : (
          <button type="button" class="send-btn" title="Send (Enter)" disabled={!canSend} onClick={send}>
            <Icon name="send" size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

const MODE_HINTS = {
  default: 'Claude asks before editing files or running commands',
  acceptEdits: 'File edits are applied without asking',
  plan: 'Claude researches and proposes a plan before changing anything',
  auto: 'A safety classifier approves routine actions',
  bypassPermissions: 'Claude acts without asking, for anything',
};

// Bypass is only chosen on purpose: it is in the menu (with this warning), not in the Shift+Tab cycle.
const BYPASS_WARNING = 'Claude will edit files and run any command in this session without asking you first, '
  + 'including ones that delete files or reach the internet. Use it only in a folder you can afford to lose, '
  + 'such as a disposable copy or a container.';
