// Terminal-mode pieces: the persistent xterm container, the exit panel, and the helper input with
// quick-command chips.
import { Component, createRef } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './ui.jsx';
import { active, api } from '../lib/store.js';
import { termStack, fitTerminal } from '../lib/terminal.js';
import { restartTerminal, closeSession, openInChat, writePty } from '../lib/sessions.js';
import { quotePath } from '../lib/format.js';

// Preact never re-renders this; the terminals inside are managed imperatively.
export class TerminalStack extends Component {
  shouldComponentUpdate() {
    return false;
  }

  host = createRef();

  componentDidMount() {
    this.host.current.append(termStack);
    let frame = 0;
    this.observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      // Only the visible terminal follows the layout. Resizing hidden ones (e.g. when a chat session's
      // different layout is shown) makes their TUIs redraw and pile up duplicate frames.
      frame = requestAnimationFrame(() => {
        const s = active.value;
        if (s?.term && s.kind.value !== 'chat') fitTerminal(s);
      });
    });
    this.observer.observe(this.host.current);
  }

  componentWillUnmount() {
    this.observer.disconnect();
  }

  render() {
    return <div ref={this.host} class="term-stack-host" />;
  }
}

export function TerminalOverlay({ s }) {
  const [dropping, setDropping] = useState(false);
  const status = s.status.value;
  const isClaude = s.kind.value === 'terminal';
  const code = s.exitCode.value;

  // Drops land on the terminal underneath this click-through overlay, so listen on the stage.
  useEffect(() => {
    const stage = document.getElementById('stage');
    const handlers = {
      dragenter: (e) => { if (s.ptyId && e.dataTransfer.types.includes('Files')) setDropping(true); },
      dragover: (e) => e.preventDefault(),
      dragleave: (e) => { if (!stage.contains(e.relatedTarget)) setDropping(false); },
      drop: (e) => {
        e.preventDefault();
        setDropping(false);
        const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
        if (paths.length && s.ptyId) {
          writePty(s, `${paths.map(quotePath).join(' ')} `);
          s.term.focus();
        }
      },
    };
    for (const [name, fn] of Object.entries(handlers)) stage.addEventListener(name, fn);
    return () => { for (const [name, fn] of Object.entries(handlers)) stage.removeEventListener(name, fn); };
  }, [s]);

  return (
    <div class="term-overlay">
      {dropping && <div class="drop-hint">Drop to insert file paths</div>}
      {status === 'exited' && (
        <div class="exit-panel">
          <span class="msg">{isClaude ? 'Claude Code' : 'The shell'} exited{code ? ` with code ${code}` : ''}.</span>
          <div class="actions">
            {isClaude && <button class="primary-btn" onClick={() => restartTerminal(s)}>Continue conversation</button>}
            {isClaude && <button class="secondary-btn" onClick={() => openInChat(s)}>Open in chat</button>}
            <button class={isClaude ? 'secondary-btn' : 'primary-btn'} onClick={() => restartTerminal(s, { fresh: true })}>
              {isClaude ? 'Start fresh' : 'Restart shell'}
            </button>
            <button class="secondary-btn" onClick={() => closeSession(s)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

const CHIPS = [
  { label: 'Esc', hint: 'interrupt', send: '\x1b', title: 'Interrupt Claude (Esc)' },
  { label: '⇧Tab', hint: 'mode', send: '\x1b[Z', title: 'Cycle permission mode (Shift+Tab)' },
  ...['/compact', '/clear', '/context', '/model', '/resume', '/mcp', '/help'].map((c) => ({ label: c, command: c })),
];

export function TerminalComposer({ s }) {
  const [text, setText] = useState('');
  const history = useRef([]);
  const index = useRef(-1);
  const input = useRef(null);
  const isClaude = s.kind.value === 'terminal';
  useLayoutEffect(() => {
    const el = input.current;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const runChip = (chip) => {
    if (!s.ptyId) return;
    if (chip.send) writePty(s, chip.send);
    else {
      writePty(s, chip.command);
      setTimeout(() => writePty(s, '\r'), 60);
    }
    s.term.focus();
  };

  const send = () => {
    const value = text.replace(/\s+$/, '');
    if (!s.ptyId || !value) return;
    if (value.includes('\n')) s.term.paste(value); // bracketed paste keeps the lines together
    else writePty(s, value);
    setTimeout(() => writePty(s, '\r'), 80);
    history.current.unshift(value);
    index.current = -1;
    setText('');
    s.term.focus();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape') {
      s.term.focus();
    } else if (e.key === 'ArrowUp' && e.currentTarget.selectionStart === 0 && history.current[index.current + 1]) {
      e.preventDefault();
      setText(history.current[++index.current]);
    } else if (e.key === 'ArrowDown' && index.current >= 0) {
      e.preventDefault();
      index.current--;
      setText(index.current >= 0 ? history.current[index.current] : '');
    }
  };

  return (
    <div class="composer">
      {isClaude && (
        <div class="chips">
          {CHIPS.map((c) => (
            <button key={c.label} class={c.send ? 'chip key' : 'chip'} title={c.title || `Run ${c.command}`} onClick={() => runChip(c)}>
              {c.hint ? `${c.label} ${c.hint}` : c.label}
            </button>
          ))}
        </div>
      )}
      <div class="composer-row">
        <textarea ref={input} class="composer-input" rows={1} spellcheck={false} value={text}
                  placeholder={isClaude ? 'Write a prompt here. Enter sends it to Claude, Shift+Enter adds a line.' : 'Type a command. Enter runs it in the shell.'}
                  onInput={(e) => setText(e.currentTarget.value)} onKeyDown={onKeyDown} />
        <button class="send-btn" title="Send to session" disabled={!s.ptyId || !text.trim()} onClick={send}>
          <Icon name="send" size={15} />
        </button>
      </div>
    </div>
  );
}
