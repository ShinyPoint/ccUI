// Shared UI pieces: icons, dropdown menus, the dialog wrapper, toasts.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { toasts } from '../lib/store.js';
import { ICONS, ICON_STROKE } from '../lib/icons.js';


export function Icon({ name, size = 16 }) {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width={ICON_STROKE} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
         dangerouslySetInnerHTML={{ __html: ICONS[name] || '' }} />
  );
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Animated expand / collapse for the content under a bar. The content mounts when it opens and stays mounted
// until the closing animation has played; while settled open it is not clipped (focus rings, shadows).
export function Collapse({ open, children }) {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);
  const [settled, setSettled] = useState(open);
  const first = useRef(true);
  const shown = useRef(expanded);
  shown.current = expanded;
  useLayoutEffect(() => {
    if (first.current) { // already in its initial state, without animating
      first.current = false;
      return undefined;
    }
    setSettled(false);
    if (!open) {
      setExpanded(false);
      // Nothing to animate (closed again before it started opening, or reduced motion): unmount now, since no
      // transitionend will come.
      if (!shown.current || reducedMotion()) setMounted(false);
      return undefined;
    }
    setMounted(true);
    if (reducedMotion()) {
      setExpanded(true);
      setSettled(true);
      return undefined;
    }
    // Paint the closed state first, so the height has something to grow from.
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => setExpanded(true)); });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  if (!mounted) return null;
  const onEnd = (e) => {
    // Height and opacity run for the same time; either one ending will do (the height does not transition
    // when the content has no height).
    if (e.target !== e.currentTarget || (e.propertyName !== 'height' && e.propertyName !== 'opacity')) return;
    if (open) setSettled(true);
    else setMounted(false);
  };
  return (
    <div class={`collapse ${expanded ? 'open' : ''} ${settled && open ? 'settled' : ''}`} onTransitionEnd={onEnd}>
      <div class="collapse-inner">{children}</div>
    </div>
  );
}

// A button that opens a small menu of options. `options`: [{ value, label, hint, disabled }]; `footer`: more
// controls under the options (picking one of them leaves the menu open).
export function Menu({ label, title, value, options, onSelect, footer, align = 'left', up = true, className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc, true);
    };
  }, [open]);
  return (
    <div class={`menu ${className}`} ref={ref}>
      <button type="button" class="menu-button" title={title} aria-haspopup="listbox" aria-expanded={open}
              onClick={() => setOpen(!open)}>
        {label}<Icon name="chevron" size={13} />
      </button>
      {open && (
        <ul class={`menu-list ${up ? 'up' : 'down'} ${align}`} role="listbox">
          {options.map((o) => (
            <li key={o.value}>
              <button type="button" role="option" aria-selected={o.value === value} disabled={o.disabled}
                      class={o.value === value ? 'selected' : ''}
                      onClick={() => { setOpen(false); onSelect(o.value); }}>
                <span class="menu-label">{o.label}</span>
                {o.hint && <span class="menu-hint">{o.hint}</span>}
              </button>
            </li>
          ))}
          {footer && <li class="menu-footer" role="presentation">{footer}</li>}
        </ul>
      )}
    </div>
  );
}

// <dialog> driven by an `open` flag; closing (Esc, backdrop, buttons) calls onClose.
// `title`: shown as the heading (leave it out to lay the dialog out yourself); `className`: extra classes.
export function Dialog({ open, onClose, wide, title, className = '', children }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} class={`dialog ${wide ? 'dialog-wide' : ''} ${className}`} onClose={onClose}
            onMouseDown={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <div class="dialog-body">
          {title && <h3>{title}</h3>}
          {children}
        </div>
      )}
    </dialog>
  );
}

// Right-click menus. `items`: [{ label, run, hint?, disabled?, checked? } | '-'].
export const contextMenu = signal(null);

export function openContextMenu(e, items) {
  e.preventDefault();
  e.stopPropagation();
  contextMenu.value = { x: e.clientX, y: e.clientY, items };
}

export function ContextMenu() {
  const menu = contextMenu.value;
  const ref = useRef(null);
  const close = () => { contextMenu.value = null; };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Keep the menu inside the window.
    const { innerWidth: w, innerHeight: h } = window;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(4, Math.min(menu.x, w - r.width - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(menu.y, h - r.height - 4))}px`;
    el.querySelector('button:not(:disabled)')?.focus();
  }, [menu]);

  useEffect(() => {
    if (!menu) return undefined;
    const outside = (e) => { if (!ref.current?.contains(e.target)) close(); };
    const keys = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const buttons = [...ref.current.querySelectorAll('button:not(:disabled)')];
      const i = buttons.indexOf(document.activeElement);
      buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    };
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', keys, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('keydown', keys, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  if (!menu) return null;
  return (
    <ul ref={ref} class="context-menu" role="menu" style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
        onContextMenu={(e) => e.preventDefault()}>
      {menu.items.map((item, i) => (item === '-' ? <li key={i} class="sep" role="separator" /> : (
        <li key={i}>
          <button type="button" role="menuitem" disabled={item.disabled}
                  onClick={() => { close(); item.run(); }}>
            <span class="cm-check">{item.checked ? <Icon name="check" size={13} /> : null}</span>
            <span class="cm-label">{item.label}</span>
            {item.hint && <span class="cm-hint">{item.hint}</span>}
          </button>
        </li>
      )))}
    </ul>
  );
}

export function Toasts() {
  return (
    <div class="toasts" role="status">
      {toasts.value.map((t) => <div key={t.id} class={`toast ${t.tone}`}>{t.text}</div>)}
    </div>
  );
}

export function Segmented({ name, value, options, onChange }) {
  return (
    <div class="segmented" role="radiogroup">
      {options.map((o) => (
        <label key={o.value} title={o.title}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}
