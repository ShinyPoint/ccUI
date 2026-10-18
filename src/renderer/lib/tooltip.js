// The app's own tooltips, in place of the system's. Any element with a `title` shows it in a small rounded label
// after a short pause; moving on to a neighbour while one shows switches at once. The first time the pointer
// reaches an element its `title` moves to `data-tip`, so the system's tooltip never appears; an element with no
// text of its own keeps the hint as its accessible name. The label is a popover, so it shows over dialogs too.

const DELAY = 450; // ms before the first tooltip
const WARM = 400; // ms after one hides during which the next shows at once
const GAP = 6; // px between the element and the label
const EDGE = 6; // px kept clear of the window's edges

let tip = null;
let timer = 0;
let current = null;
let hiddenAt = 0;

// The hint of `el` (from its title, which it takes over).
function adopt(el) {
  const title = el.getAttribute('title');
  if (title != null) {
    el.removeAttribute('title');
    if (title) el.dataset.tip = title;
    else delete el.dataset.tip;
    if (title && !el.hasAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', title);
  }
  return el.dataset.tip || '';
}

function place(el) {
  const r = el.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  // Below the element; above it when there is no room below.
  let top = r.bottom + GAP;
  if (top + t.height > innerHeight - EDGE) top = Math.max(EDGE, r.top - GAP - t.height);
  const left = Math.min(Math.max(EDGE, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - EDGE);
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

function show(el) {
  if (!el.isConnected || current !== el) return;
  const text = el.dataset.tip;
  if (!text) return;
  tip.textContent = text;
  // Shown again each time, so it comes out above whatever opened since (a dialog, a menu).
  if (tip.matches(':popover-open')) tip.hidePopover();
  tip.showPopover();
  place(el);
}

function hide() {
  clearTimeout(timer);
  current = null;
  if (tip?.matches(':popover-open')) {
    tip.hidePopover();
    hiddenAt = performance.now();
  }
}

export function installTooltips() {
  if (tip) return;
  tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.popover = 'manual';
  tip.setAttribute('role', 'tooltip');
  document.body.append(tip);

  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest?.('[title], [data-tip]');
    if (el === current) return;
    const warm = tip.matches(':popover-open') || performance.now() - hiddenAt < WARM;
    hide();
    if (!el || !adopt(el)) return;
    current = el;
    timer = setTimeout(() => show(el), warm ? 0 : DELAY);
  }, true);
  document.addEventListener('pointerleave', hide);
  // Anything you do hides it: a click, a key, scrolling, the window losing focus.
  for (const type of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(type, hide, true);
  // Scrolling hides it only when it moves the element away (the chat scrolling itself as a reply streams in
  // elsewhere doesn't).
  document.addEventListener('scroll', (e) => {
    if (current && (e.target === document || e.target.contains?.(current))) hide();
  }, true);
  window.addEventListener('blur', hide);
}
