// Find in chat (Ctrl+F): matches in the conversation's visible text are highlighted with the CSS Custom
// Highlight API (no change to the page's DOM); Enter / Shift+Enter step through them. Folded steps are
// not searched until they are opened. The list follows the conversation as it changes.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../ui.jsx';
import { findBar } from '../../lib/store.js';
import { SHORTCUTS } from '../../lib/keyboard.js';
import { t } from '../../lib/i18n.js';

let lastQuery = ''; // kept across sessions and reopenings, like a browser's find bar

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Case-insensitive matches of `query` in the text under `root` that is actually shown, in reading order.
function search(root, query) {
  const ranges = [];
  if (!root || !query) return ranges;
  const re = new RegExp(escape(query), 'giu');
  const shown = new Map(); // element -> visible
  const visible = (el) => {
    if (!shown.has(el)) shown.set(el, !el.closest('.collapse:not(.open)') && el.checkVisibility());
    return shown.get(el);
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement && visible(node.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const m of node.data.matchAll(re)) {
      const range = new Range();
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      ranges.push(range);
    }
  }
  return ranges;
}

function paint(ranges, index) {
  if (!CSS.highlights) return;
  CSS.highlights.set('find', new Highlight(...ranges));
  if (ranges[index]) CSS.highlights.set('find-current', new Highlight(ranges[index]));
  else CSS.highlights.delete('find-current');
}

// Scrolls `range` into the upper part of the chat if it is not comfortably in view (the bar covers the top).
function reveal(range, scroller) {
  const r = range.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  if (r.top < box.top + 56 || r.bottom > box.bottom - 24) scroller.scrollTop += r.top - box.top - box.height / 3;
}

// The first match at or below the top of the view, so a new search starts where you are reading.
function firstInView(ranges, scroller) {
  const top = scroller.getBoundingClientRect().top + 56;
  const i = ranges.findIndex((r) => r.getBoundingClientRect().bottom >= top);
  return i < 0 ? 0 : i;
}

// After a new search: the match where the current one was (or the next one after it). A match whose text
// was re-rendered has left the page; then the same position in the list is kept.
function sameMatch(ranges, old, index) {
  if (!old?.startContainer.isConnected) return Math.min(index, Math.max(0, ranges.length - 1));
  const i = ranges.findIndex((r) => r.compareBoundaryPoints(Range.START_TO_START, old) >= 0);
  return i < 0 ? Math.max(0, ranges.length - 1) : i;
}

export function FindBar({ root, scroller }) {
  const request = findBar.value;
  const input = useRef(null);
  const ranges = useRef([]);
  const [query, setQuery] = useState(lastQuery);
  const [found, setFound] = useState({ count: 0, index: 0 });

  useEffect(() => {
    input.current.focus();
    input.current.select();
  }, [request]);

  const go = (index, scroll = true) => {
    const list = ranges.current;
    const i = list.length ? (index + list.length) % list.length : 0;
    setFound({ count: list.length, index: i });
    paint(list, i);
    if (scroll && list[i]) reveal(list[i], scroller.current);
  };

  // A new query: search again and jump to the first match from where you are reading.
  useLayoutEffect(() => {
    lastQuery = query;
    ranges.current = search(root.current, query);
    go(firstInView(ranges.current, scroller.current));
  }, [query]);

  // The conversation changed (new messages, a step opened or closed): search again, keep the place, don't scroll.
  useEffect(() => {
    let timer = 0;
    const observer = new MutationObserver(() => {
      if (timer) return; // at most every 150 ms while a reply streams in
      timer = setTimeout(() => {
        timer = 0;
        const old = ranges.current[found.index];
        ranges.current = search(root.current, lastQuery);
        go(sameMatch(ranges.current, old, found.index), false);
      }, 150);
    });
    observer.observe(root.current, { childList: true, subtree: true, characterData: true });
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [found.index]);

  useEffect(() => () => {
    CSS.highlights?.delete('find');
    CSS.highlights?.delete('find-current');
  }, []);

  const close = () => {
    findBar.value = 0;
    document.querySelector('.composer-input')?.focus();
  };

  return (
    <div class="find-bar" role="search">
      <Icon name="search" size={14} />
      <input ref={input} type="text" value={query} spellcheck={false} placeholder={t('Find in chat')}
             aria-label={t('Find in chat ({key})', { key: SHORTCUTS.find })}
             onInput={(e) => setQuery(e.currentTarget.value)}
             onKeyDown={(e) => {
               e.stopPropagation();
               if (e.key === 'Enter') { e.preventDefault(); go(found.index + (e.shiftKey ? -1 : 1)); }
               if (e.key === 'Escape') { e.preventDefault(); close(); }
             }} />
      <span class={`find-count ${query && !found.count ? 'none' : ''}`} aria-live="polite">
        {query ? (found.count ? `${found.index + 1}/${found.count}` : t('No results')) : ''}
      </span>
      <button class="icon-btn find-prev" title={t('Previous match (Shift+Enter)')} disabled={!found.count}
              onClick={() => go(found.index - 1)}><Icon name="chevron" size={14} /></button>
      <button class="icon-btn" title={t('Next match (Enter)')} disabled={!found.count}
              onClick={() => go(found.index + 1)}><Icon name="chevron" size={14} /></button>
      <button class="icon-btn" title={t('Close (Esc)')} onClick={close}><Icon name="x" size={13} /></button>
    </div>
  );
}
