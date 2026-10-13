// Message box for chat sessions: slash-command and @file autocomplete, image attachments,
// permission-mode and model menus, context meter, send / stop.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon, Menu } from '../ui.jsx';
import { MODE_LABELS } from './Prompts.jsx';
import { api, toast } from '../../lib/store.js';
import { sendMessage, interrupt, setMode, setModel } from '../../lib/sessions.js';
import { formatTokens } from '../../lib/format.js';
import { SHORTCUTS } from '../../lib/keyboard.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const BASE_MODES = ['default', 'acceptEdits', 'plan'];

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

function ContextMeter({ context }) {
  if (!context?.maxTokens) return null;
  const pct = Math.min(100, Math.round(context.percentage ?? (context.totalTokens / context.maxTokens) * 100));
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <span class={`context-meter ${pct >= 80 ? 'high' : ''}`}
          title={`Context: ${formatTokens(context.totalTokens)} of ${formatTokens(context.maxTokens)} tokens used (${pct}%). Send /compact to summarize the conversation.`}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r={r} class="track" />
        <circle cx="9" cy="9" r={r} class="fill" stroke-dasharray={`${(c * pct) / 100} ${c}`} transform="rotate(-90 9 9)" />
      </svg>
      {pct}%
    </span>
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

  async function updateAutocomplete(value, caret) {
    const trigger = findTrigger(value, caret);
    if (!trigger) return setAc(null);
    let items;
    if (trigger.kind === 'slash') {
      const hidden = new Set(chat.init?.terminalCommands || []);
      items = (meta.commands || [])
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

  function send() {
    const value = text.trim();
    if (!value && !images.length) return;
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
          label={<><span class={`mode-dot mode-${mode}`} />{MODE_LABELS[mode] || mode}</>}
          value={mode}
          options={[...modes, 'bypassPermissions'].map((m) => ({ value: m, label: MODE_LABELS[m], hint: MODE_HINTS[m] }))}
          onSelect={(m) => {
            if (m === 'bypassPermissions' && mode !== m && !window.confirm(BYPASS_WARNING)) return;
            setMode(s, m);
          }}
        />
        {models.length > 0 && (
          <Menu
            title="Model"
            label={modelLabel}
            value={currentModel?.value}
            options={models.map((m) => ({ value: m.value, label: m.displayName, hint: m.description }))}
            onSelect={(v) => setModel(s, v)}
          />
        )}
        <button type="button" class="icon-btn" title="Attach images" onClick={() => fileInput.current.click()}>
          <Icon name="clip" />
        </button>
        <input ref={fileInput} type="file" accept="image/*" multiple hidden
               onChange={(e) => { addFiles([...e.currentTarget.files]); e.currentTarget.value = ''; }} />
        <span class="spacer" />
        <ContextMeter context={s.context.value} />
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
const BYPASS_WARNING = 'Bypass permissions?\n\nClaude will edit files and run any command in this session without asking you first, '
  + 'including ones that delete files or reach the internet. Use it only in a folder you can afford to lose, '
  + 'such as a disposable copy or a container.';
