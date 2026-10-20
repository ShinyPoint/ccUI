// The Changes panel at the right of a chat, a file preview window: one of the files a turn changed fills it (its
// name in the header switches between them), as that turn's diff or as the whole file (read from disk) with the
// lines the turn added marked.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon, Menu, Segmented } from './ui.jsx';
import { DiffView } from './chat/ToolCard.jsx';
import { api, settings, saveSettings, toast } from '../lib/store.js';
import { topLevel, groupTurns } from '../lib/chat-reducer.js';
import { turnChanges, addedLines } from '../lib/diff.js';
import { closeChanges } from '../lib/side.js';
import { highlight, languageForPath } from '../lib/markdown.js';
import { basename, relPath, samePath, pluralize, formatBytes } from '../lib/format.js';
import { SHORTCUTS } from '../lib/keyboard.js';

const MIN_WIDTH = 300;
const SLIDE_MS = 260; // = the slide in chat.css (.side-panel)
const MAX_LINES = 4000; // longer files are cut here: the panel is a preview, not an editor

// Highlighted HTML split into lines, each with the spans that are open at its start reopened, so that every
// line is valid HTML on its own (comments and strings can run over several lines).
function htmlLines(html) {
  const lines = [];
  const open = [];
  let line = '';
  for (const token of html.match(/<span[^>]*>|<\/span>|\n|[^<\n]+|</g) || []) {
    if (token === '\n') {
      lines.push(line + '</span>'.repeat(open.length));
      line = open.join('');
    } else {
      if (token.startsWith('<span')) open.push(token);
      else if (token === '</span>') open.pop();
      line += token;
    }
  }
  lines.push(line + '</span>'.repeat(open.length));
  return lines;
}

const UNREADABLE = {
  outside: 'This file is outside the project folder, so it is not shown here.',
  missing: 'This file is not there any more.',
  'too-big': 'This file is too large to preview.',
  binary: 'This file is not text.',
};

function FileView({ s, file, turnKey, shown }) {
  const [state, setState] = useState({ loading: true });
  const body = useRef(null);
  useEffect(() => {
    let live = true;
    setState({ loading: true });
    shown.current = null;
    api.readFile(s.cwd, file.path).then((res) => {
      if (!live) return;
      setState(res);
      shown.current = res.ok ? res.text : null;
    });
    return () => { live = false; };
  }, [s.cwd, file.path, turnKey]);
  const added = useMemo(() => addedLines(file.patches), [file]);
  const lines = useMemo(() => {
    if (!state.ok) return null;
    const text = state.text.split('\n').slice(0, MAX_LINES).join('\n');
    return htmlLines(highlight(text, languageForPath(file.path)) || '');
  }, [state, file.path]);
  // The first line the turn added comes into view (only up and down: the line numbers stay in sight).
  useEffect(() => {
    body.current?.querySelector('.fv-line.added')?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [lines]);

  if (state.loading) return <p class="side-note">Loading…</p>;
  if (!state.ok) return <p class="side-note">{UNREADABLE[state.reason] || 'This file could not be read.'}</p>;
  const total = state.text.split('\n').length;
  return (
    <>
      <p class="side-note small">The file as it is now. Lines this turn added are marked; later changes may have moved them.</p>
      <div class="file-view code-sheet" ref={body} style={{ '--ln': `calc(${String(lines.length).length}ch + 18px)` }}>
        {lines.map((html, i) => (
          <div class={`fv-line ${added.has(i + 1) ? 'added' : ''}`} key={i}>
            <span class="ln">{i + 1}</span>
            <code dangerouslySetInnerHTML={{ __html: html || ' ' }} />
          </div>
        ))}
        {total > MAX_LINES && <div class="more">{pluralize(total - MAX_LINES, 'more line')} not shown ({formatBytes(state.size)})</div>}
      </div>
    </>
  );
}

export function SidePanel({ s }) {
  const side = s.side.value;
  const chat = s.chat.value;
  const [width, setWidth] = useState(settings.value.sidePanelWidth || 440);
  const panel = useRef(null);
  const shown = useRef(null); // the text the File view shows, for Copy
  // Opening slides the panel in from the right while the chat makes room, like the sidebar; closing slides it
  // out, and it leaves once that has played. Switching to a session that has it open shows it at once.
  const [mounted, setMounted] = useState(side.open);
  const [slidIn, setSlidIn] = useState(side.open);
  useLayoutEffect(() => {
    if (!side.open) {
      setSlidIn(false);
      const timer = setTimeout(() => setMounted(false), SLIDE_MS);
      return () => clearTimeout(timer);
    }
    setMounted(true);
    // Paint it outside first, so the slide has somewhere to start from.
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => setSlidIn(true)); });
    return () => cancelAnimationFrame(frame);
  }, [side.open]);
  // The chat next to the panel makes room for it (#stage --side-w, chat.css).
  useEffect(() => {
    const stage = panel.current?.parentElement;
    if (!stage) return undefined;
    stage.style.setProperty('--side-w', `${slidIn ? width : 0}px`);
    return () => stage.style.removeProperty('--side-w');
  }, [width, slidIn, mounted]);
  // Turns that changed files, numbered as in the conversation.
  const turns = useMemo(() => {
    const groups = groupTurns(topLevel(chat), chat.busy).filter((g) => g.kind === 'turn');
    return groups.map((g, i) => ({ g, n: i + 1, changes: turnChanges(chat, g) })).filter((t) => t.changes.length);
  }, [chat.items, chat.busy]);

  if (!mounted) return null;
  const turn = turns.find((t) => t.g.key === side.turnKey)
    || (side.toolId && turns.find((t) => t.changes.some((c) => c.tools.includes(side.toolId))))
    || turns[turns.length - 1];
  const files = turn?.changes || [];
  const file = files.find((f) => side.path && samePath(f.path, side.path)) || files[0];
  const tab = side.tab || 'diff';
  const update = (patch) => { s.side.value = { ...s.side.value, ...patch }; };

  const startResize = (e) => {
    e.preventDefault();
    const x = e.clientX;
    const w = width;
    let latest = w;
    const move = (ev) => {
      const max = Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.6));
      latest = Math.min(max, Math.max(MIN_WIDTH, w + x - ev.clientX));
      setWidth(latest);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('resizing-side');
      saveSettings({ sidePanelWidth: latest });
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.body.classList.add('resizing-side');
  };

  const turnLabel = (t) => `Turn ${t.n}`;
  const turnHint = (t) => {
    const add = t.changes.reduce((n, c) => n + c.add, 0);
    const del = t.changes.reduce((n, c) => n + c.del, 0);
    const said = (t.g.user.text || '').replace(/\s+/g, ' ').trim();
    return `${said ? `${said.slice(0, 48)}${said.length > 48 ? '…' : ''} · ` : ''}${pluralize(t.changes.length, 'file')} · +${add} −${del}`;
  };
  const folder = (f) => relPath(f.path, s.cwd).replace(/[\\/]?[^\\/]*$/, '');
  const stat = (f) => <span class="diffstat"><span class="add">+{f.add}</span> <span class="del">−{f.del}</span></span>;
  const wrap = Boolean(settings.value.sidePanelWrap);
  // Copy: the file as shown in File; in Changes, the file's lines as this turn left them (the new side of the diff).
  const copy = () => {
    const text = tab === 'file'
      ? shown.current
      : file.patches.map((h) => h.lines.filter((l) => l[0] === '+' || l[0] === ' ').map((l) => l.slice(1)).join('\n')).join('\n…\n');
    if (text == null) return;
    api.writeClipboard(text);
    toast(tab === 'file' ? `Copied ${basename(file.path)}.` : 'Copied the changed lines.');
  };

  return (
    <aside class={`side-panel ${slidIn ? 'in' : ''}`} ref={panel} style={{ width: `${width}px` }} aria-label="Changes" inert={!side.open}>
      <div class="side-resize" onMouseDown={startResize} title="Drag to resize" />
      <header class="side-head">
        {file ? (
          <>
            <span class="side-file-icon"><Icon name="toolRead" size={15} /></span>
            {files.length > 1 ? (
              <Menu className="side-files" title="Files this turn changed" up={false}
                    label={<span class="sf-name">{basename(file.path)}</span>} value={file.path}
                    options={files.map((f) => ({
                      value: f.path,
                      label: <span class="sf-option"><span class="sf-name">{basename(f.path)}</span>{f.created && <span class="sf-new">new</span>}{stat(f)}</span>,
                      hint: folder(f) || undefined,
                    }))}
                    onSelect={(path) => update({ path })} />
            ) : <span class="sf-name single" title={file.path}>{basename(file.path)}</span>}
            <span class="sf-dir" title={file.path}><bdi>{folder(file)}</bdi></span>
            {file.created && <span class="sf-new">new</span>}
            {stat(file)}
          </>
        ) : <span class="side-title"><Icon name="diff" size={15} />Changes</span>}
        <span class="spacer" />
        {file && (
          <>
            <button class="icon-btn" title={tab === 'file' ? 'Copy the file' : 'Copy the changed lines'} onClick={copy}><Icon name="copy" size={15} /></button>
            <button class="icon-btn" title="Open in the default app" onClick={() => api.openPath(file.path)}><Icon name="external" size={15} /></button>
          </>
        )}
        <button class="icon-btn" title={`Close (${SHORTCUTS.changes})`} aria-label="Close" onClick={() => closeChanges(s)}>
          <Icon name="x" size={15} />
        </button>
      </header>
      {turns.length > 0 && (
        <div class="side-bar">
          <Menu className="side-turns" title="Choose a turn" up={false}
                label={turnLabel(turn)} value={turn.g.key}
                options={[...turns].reverse().map((t) => ({ value: t.g.key, label: turnLabel(t), hint: turnHint(t) }))}
                onSelect={(key) => update({ turnKey: key, toolId: null, path: null })} />
          <span class="spacer" />
          {file && (
            <>
              <Segmented name="side-tab" value={tab} onChange={(v) => update({ tab: v })} options={[
                { value: 'diff', label: 'Changes' },
                { value: 'file', label: 'File' },
              ]} />
              <button class={`icon-btn side-wrap ${wrap ? 'on' : ''}`} aria-pressed={wrap} title={wrap ? 'Don’t wrap long lines' : 'Wrap long lines'}
                      onClick={() => saveSettings({ sidePanelWrap: !wrap })}>
                <Icon name="wrap" size={15} />
              </button>
            </>
          )}
        </div>
      )}
      {/* The one scroller: its scrollbars are the panel's bottom and right edges, wherever it is scrolled to. */}
      <div class={`side-file-body ${wrap ? 'wrap' : ''}`}>
        {!turn ? (
          <p class="side-note">No file changes in this conversation yet. When Claude edits files, each turn’s changes show here.</p>
        ) : !file ? null : tab === 'diff' ? (
          file.patches.length ? <DiffView patches={file.patches} path={file.path} /> : <p class="side-note">No line changes to show for this file.</p>
        ) : <FileView s={s} file={file} turnKey={turn.g.key} shown={shown} />}
      </div>
    </aside>
  );
}
