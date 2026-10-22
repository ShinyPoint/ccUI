// Your messages in this conversation, for moving through a long one (like Claude Code's Esc Esc list). Along the
// chat's right edge: pointing there shows a tick per message, where it sits in the conversation, and a button
// that opens the list; double Esc in an empty message box opens it too. Choosing one scrolls to it.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../ui.jsx';
import { historyRail } from '../../lib/store.js';
import { formatClock } from '../../lib/format.js';
import { t } from '../../lib/i18n.js';

const firstLine = (item) => (item.text || '').trim().split('\n')[0] || (item.images?.length ? t('Image') : '');

// `scroller`: the chat's scrolling box; `onJump(key)`: scrolls the message with that key into view.
export function HistoryRail({ chat, scroller, onJump }) {
  const prompts = chat.items.filter((i) => i.type === 'user' && !i.parent && (i.text || i.images?.length));
  const [height, setHeight] = useState(0);
  const [marks, setMarks] = useState({}); // key → 0…1, where the message sits in the conversation
  const [current, setCurrent] = useState(null); // the key of the message at the top of the view
  const [index, setIndex] = useState(-1); // the one picked with the arrow keys
  const open = historyRail.value;
  const panel = useRef(null);
  const [shown, setShown] = useState(open); // kept while it animates away

  // Where each message is, and which one the view is at: read from the page, when it is needed.
  const measure = () => {
    const el = scroller.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const next = {};
    let at = null;
    for (const node of el.querySelectorAll('.msg-user-wrap[data-key]')) {
      const top = node.getBoundingClientRect().top - box.top + el.scrollTop;
      next[node.dataset.key] = el.scrollHeight > 0 ? top / el.scrollHeight : 0;
      if (top <= el.scrollTop + 48) at = node.dataset.key;
    }
    setMarks(next);
    setCurrent(at ?? prompts[0]?.key ?? null);
  };

  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const resize = new ResizeObserver(() => setHeight(el.clientHeight));
    resize.observe(el);
    let frame = 0;
    const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { resize.disconnect(); el.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, []);
  useEffect(() => { if (open) measure(); }, [open, prompts.length]);

  // Opens with a slide from the right, closes the same way back (Web Animations, like the app's other panels).
  useLayoutEffect(() => {
    if (open) {
      setShown(true);
      setIndex(-1);
      return undefined;
    }
    const el = panel.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(false); return undefined; }
    const anim = el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(12px)' }], { duration: 160, easing: 'ease-in' });
    anim.onfinish = () => setShown(false);
    return () => anim.cancel();
  }, [open]);
  useEffect(() => { if (open && shown) panel.current?.focus(); }, [open, shown]);

  if (prompts.length < 2) return null;
  const jump = (key) => { onJump(key); setCurrent(key); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); historyRail.value = false; return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const from = index >= 0 ? index : prompts.findIndex((p) => p.key === current);
      const next = Math.max(0, Math.min(prompts.length - 1, from + (e.key === 'ArrowDown' ? 1 : -1)));
      setIndex(next);
      jump(prompts[next].key);
      panel.current?.querySelectorAll('.history-item')[next]?.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter' && index >= 0) { e.preventDefault(); historyRail.value = false; }
  };

  return (
    <div class={`history-rail ${shown ? 'open' : ''}`} style={{ height: height ? `${height}px` : undefined }} onMouseEnter={measure}>
      {!shown && (
        <>
          <button type="button" class="history-open" title={t('Your messages in this conversation (Esc Esc)')}
                  onClick={() => { historyRail.value = true; }}>
            <Icon name="history" size={14} />
          </button>
          {prompts.map((p) => marks[p.key] != null && (
            <button type="button" key={p.key} class={`history-tick ${p.key === current ? 'current' : ''}`} title={firstLine(p)}
                    style={{ top: `calc(40px + ${marks[p.key]} * (100% - 56px))` }} onClick={() => jump(p.key)} />
          ))}
        </>
      )}
      {shown && (
        <div ref={panel} class="history-panel" tabIndex={-1} onKeyDown={onKey} role="listbox" aria-label={t('Your messages')}>
          <div class="history-head">
            <span>{t('Your messages')}</span>
            <span class="history-count">{prompts.length}</span>
            <button type="button" class="icon-btn" title={t('Close (Esc)')} onClick={() => { historyRail.value = false; }}><Icon name="x" size={13} /></button>
          </div>
          <ul class="history-list">
            {prompts.map((p, i) => (
              <li key={p.key}>
                <button type="button" role="option" aria-selected={p.key === current}
                        class={`history-item ${p.key === current ? 'current' : ''} ${i === index ? 'picked' : ''}`}
                        title={p.text || ''} onClick={() => { setIndex(i); jump(p.key); }}>
                  <span class="history-text">{firstLine(p)}</span>
                  {p.at && <span class="history-time">{formatClock(p.at)}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
