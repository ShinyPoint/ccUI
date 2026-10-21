// Reasoning effort, under the model list: a track with a stop for each level the model offers, after Auto
// (the model's default, like /effort auto). Dragging follows the pointer; letting go, a click or the arrow
// keys settle on the nearest stop with a short spring, and only then is the level sent. The thumb and the
// fill move with transforms written straight to a CSS variable, so a drag never re-renders the menu.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { t, phrase } from '../../lib/i18n.js';

// English, as phrases: shown with t().
const LEVELS = {
  '': { label: phrase('Auto'), hint: phrase('The model’s default effort') },
  low: { label: phrase('Low'), hint: phrase('Fastest, least thinking') },
  medium: { label: phrase('Medium'), hint: phrase('Balanced speed and depth') },
  high: { label: phrase('High'), hint: phrase('Thinks harder on complex work') },
  xhigh: { label: phrase('Extra high'), hint: phrase('More thinking for hard problems') },
  max: { label: phrase('Max'), hint: phrase('Most thinking, slowest') },
};
const ORDER = Object.keys(LEVELS);
const THUMB = 16; // px, = .effort-thumb width
const INSET = 3; // px between the thumb and the track's edge (chat.css .effort-travel)

export const effortLabel = (level) => (LEVELS[level] ? t(LEVELS[level].label) : level);

export function EffortSlider({ levels, value, onChange }) {
  const stops = ['', ...levels.filter((l) => l in LEVELS && l).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))];
  const disabled = stops.length < 2;
  const last = stops.length - 1;
  // A level the model doesn't offer runs as the next one down (Claude Code downgrades it the same way).
  const settled = stops.reduce((at, level, i) => (ORDER.indexOf(level) <= ORDER.indexOf(value || '') ? i : at), 0);
  const [pending, setPending] = useState(null); // stop sent, waiting for the session to take it
  const [dragging, setDragging] = useState(false);
  const [near, setNear] = useState(0); // stop under the thumb while dragging
  const root = useRef(null);
  const track = useRef(null);
  const drag = useRef(null);
  const sent = useRef(0);

  const current = pending ?? settled;
  const shown = dragging ? near : current;

  // Outside a drag the thumb sits on its stop; changing --p here is what the transition animates.
  useLayoutEffect(() => {
    if (!dragging) root.current.style.setProperty('--p', last ? current / last : 0);
  });

  const fractionAt = (x) => {
    const r = track.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (x - r.left - INSET - THUMB / 2) / (r.width - 2 * INSET - THUMB)));
  };

  const commit = (i) => {
    const stop = Math.min(last, Math.max(0, i));
    if (stop === current) return;
    const token = ++sent.current;
    setPending(stop);
    Promise.resolve(onChange(stops[stop])).then(() => {
      // Taken: `value` now matches. Refused: back to where it was.
      if (token === sent.current) setPending(null);
    });
  };

  const onPointerDown = (e) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault(); // (and no focus ring: the keyboard reaches it with Tab)
    track.current.setPointerCapture(e.pointerId);
    root.current.classList.add('pressed');
    drag.current = { id: e.pointerId, x: e.clientX, moved: false };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.x) < 3) return; // a click, so far
      d.moved = true;
      setDragging(true);
    }
    const f = fractionAt(e.clientX);
    root.current.style.setProperty('--p', f);
    const n = Math.round(f * last);
    if (n !== d.near) {
      d.near = n;
      setNear(n);
    }
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    root.current.classList.remove('pressed');
    setDragging(false);
    commit(Math.round(fractionAt(e.clientX) * last));
  };
  const onPointerCancel = () => {
    drag.current = null;
    root.current.classList.remove('pressed');
    setDragging(false);
  };
  const onKeyDown = (e) => {
    if (disabled) return;
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    if (step) commit(current + step);
    else if (e.key === 'Home') commit(0);
    else if (e.key === 'End') commit(last);
    else return;
    e.preventDefault();
  };

  const level = LEVELS[stops[shown]];
  return (
    <div ref={root} class={`effort ${dragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}>
      <div class="effort-head">
        <span class="effort-title">{t('Effort')}</span>
        <span class="effort-value">{disabled ? '—' : t(level.label)}</span>
      </div>
      <div ref={track} class="effort-track" role="slider" tabIndex={disabled ? -1 : 0}
           aria-label={t('Reasoning effort')} aria-disabled={disabled}
           aria-valuemin={0} aria-valuemax={last} aria-valuenow={shown} aria-valuetext={t(level.label)}
           onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
           onPointerCancel={onPointerCancel} onKeyDown={onKeyDown}>
        <span class="effort-rail" />
        <span class="effort-fill" />
        {stops.map((stop, i) => (
          <span key={stop || 'auto'} class={`effort-stop ${i <= shown ? 'on' : ''}`} style={{ '--at': last ? i / last : 0 }} />
        ))}
        <span class="effort-travel"><span class="effort-thumb" /></span>
      </div>
      <div class="effort-hint">{disabled ? t('This model has no effort levels') : t(level.hint)}</div>
    </div>
  );
}
