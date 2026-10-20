// The bottom Terminal panel: a shell in the active session's folder.
import { Component, createRef } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './ui.jsx';
import { active, settings, saveSettings, themeMode } from '../lib/store.js';
import { panelStack, fitTerminal, terminalMode } from '../lib/terminal.js';
import { showPanel, togglePanel, restartPanel } from '../lib/panel.js';
import { tildify } from '../lib/format.js';
import { SHORTCUTS } from '../lib/keyboard.js';

// Preact never re-renders this; the shells inside are managed imperatively.
class PanelStack extends Component {
  host = createRef();

  shouldComponentUpdate() {
    return false;
  }

  componentDidMount() {
    this.host.current.append(panelStack);
    let frame = 0;
    this.observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const s = active.value;
        if (s?.panel.open.value) fitTerminal(s.panel);
      });
    });
    this.observer.observe(this.host.current);
  }

  componentWillUnmount() {
    this.observer.disconnect();
  }

  render() {
    return <div ref={this.host} class="panel-stack-host" />;
  }
}

const MIN_HEIGHT = 110;

export function BottomPanel({ s }) {
  const open = Boolean(s?.panel.open.value);
  const exited = Boolean(s?.panel.exited.value);
  const [height, setHeight] = useState(settings.value.panelHeight || 260);
  const drag = useRef(null);

  useEffect(() => { showPanel(s); }, [s?.uid, open]);

  const startResize = (e) => {
    e.preventDefault();
    drag.current = { y: e.clientY, h: height };
    let latest = height;
    const move = (ev) => {
      const max = Math.round(window.innerHeight * 0.75);
      latest = Math.min(max, Math.max(MIN_HEIGHT, drag.current.h + drag.current.y - ev.clientY));
      setHeight(latest);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('resizing-panel');
      saveSettings({ panelHeight: latest });
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.body.classList.add('resizing-panel');
  };

  return (
    <section class={`bottom-panel ${terminalMode() === 'dark' && themeMode.value === 'light' ? 'term-dark' : ''}`}
             hidden={!open} style={{ height: `${height}px` }} aria-label="Terminal">
      <div class="panel-resize" onMouseDown={startResize} title="Drag to resize" />
      <header class="panel-head">
        <span class="panel-title"><Icon name="terminal" size={14} />Terminal</span>
        {s && <><span class="panel-sep">·</span><span class="panel-path" title={s.cwd}><bdi>{tildify(s.cwd)}</bdi></span></>}
        <span class="spacer" />
        <button class="icon-btn" title="Restart the shell" onClick={() => restartPanel(s)}><Icon name="refresh" size={14} /></button>
        <button class="icon-btn" title={`Hide (${SHORTCUTS.panel})`} onClick={() => togglePanel(s, false)}><Icon name="chevron" size={15} /></button>
      </header>
      <div class="panel-body">
        <PanelStack />
        {exited && (
          <div class="panel-exited">
            The shell exited.
            <button class="link-btn" onClick={() => restartPanel(s)}>Start a new one</button>
          </div>
        )}
      </div>
    </section>
  );
}
