// Reordering by dragging (the sidebar's project folders and sessions). Press on an item and move a few pixels: it
// lifts and follows the pointer while the others of its group slide aside to make room; letting go puts it there
// (`onDrop(from, to)`, indexes in the group). A press that doesn't move stays a click; Esc puts it back. Near the
// top or bottom of the scrolling list, the list scrolls by itself.

const THRESHOLD = 5; // px of movement before a press becomes a drag
const EDGE = 32; // px from the list's top or bottom where it scrolls by itself
const SPEED = 10; // px per frame at the very edge

// `item`: the element to move; `items()`: its group, in order, the item among them; `scroller`: the element
// that scrolls them. Call from the item's pointerdown.
export function pressToSort(e, { item, items, scroller, onDrop }) {
  if (e.button !== 0 || e.target.closest('input, textarea, .icon-btn')) return;
  const pointerId = e.pointerId;
  const startY = e.clientY;
  const startScroll = scroller.scrollTop;
  let y = startY;
  let drag = null;

  const begin = () => {
    const list = items();
    const from = list.indexOf(item);
    if (from < 0 || list.length < 2) return null;
    // Positions in the list's own coordinates, so scrolling while dragging doesn't move the targets.
    const boxes = list.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top + scroller.scrollTop, height: r.height };
    });
    const gap = from + 1 < boxes.length ? boxes[from + 1].top - (boxes[from].top + boxes[from].height)
      : from > 0 ? boxes[from].top - (boxes[from - 1].top + boxes[from - 1].height) : 0;
    scroller.classList.add('sorting');
    item.classList.add('sort-lifted');
    document.body.classList.add('sorting-now');
    return { list, from, to: from, boxes, step: boxes[from].height + Math.max(0, gap), frame: 0 };
  };

  const update = () => {
    const { list, from, boxes, step } = drag;
    const dy = y - startY + (scroller.scrollTop - startScroll);
    const center = boxes[from].top + boxes[from].height / 2 + dy;
    let to = from;
    for (let i = from + 1; i < boxes.length; i++) if (center > boxes[i].top + boxes[i].height / 2) to = i;
    for (let i = from - 1; i >= 0; i--) if (center < boxes[i].top + boxes[i].height / 2) to = i;
    drag.to = to;
    list.forEach((el, i) => {
      if (i === from) el.style.transform = `translateY(${dy}px)`;
      else if (i > from && i <= to) el.style.transform = `translateY(${-step}px)`;
      else if (i < from && i >= to) el.style.transform = `translateY(${step}px)`;
      else el.style.transform = '';
    });
  };

  // Near an edge, the list scrolls a little every frame, faster the closer the pointer is.
  const tick = () => {
    if (!drag) return;
    const r = scroller.getBoundingClientRect();
    const near = y < r.top + EDGE ? -(r.top + EDGE - y) : y > r.bottom - EDGE ? y - (r.bottom - EDGE) : 0;
    if (near) {
      const before = scroller.scrollTop;
      scroller.scrollTop += Math.sign(near) * Math.ceil(SPEED * Math.min(1, Math.abs(near) / EDGE));
      if (scroller.scrollTop !== before) update();
    }
    drag.frame = requestAnimationFrame(tick);
  };

  const finish = (drop) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key, true);
    if (!drag) return;
    cancelAnimationFrame(drag.frame);
    const { list, from, to } = drag;
    drag = null;
    // Back in place without sliding: the list is redrawn in its new order before the next frame.
    scroller.classList.remove('sorting');
    item.classList.remove('sort-lifted');
    document.body.classList.remove('sorting-now');
    for (const el of list) el.style.transform = '';
    // The press ends in a click on what was dragged; it isn't one.
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    if (drop && to !== from) onDrop(from, to);
  };

  const move = (ev) => {
    if (ev.pointerId !== pointerId) return;
    y = ev.clientY;
    if (!drag) {
      if (Math.abs(y - startY) < THRESHOLD) return;
      drag = begin();
      if (!drag) return finish(false);
      drag.frame = requestAnimationFrame(tick);
    }
    update();
  };
  const up = (ev) => { if (ev.pointerId === pointerId) finish(true); };
  const cancel = (ev) => { if (ev.pointerId === pointerId) finish(false); };
  const key = (ev) => {
    if (ev.key !== 'Escape' || !drag) return;
    ev.stopPropagation();
    finish(false);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key, true);
}

// `list` with the item at `from` moved to `to`.
export function moved(list, from, to) {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
