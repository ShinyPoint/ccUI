// Liquid glass (Settings → Appearance), after Apple's: the floating surfaces (menus, the right-click menu, the
// / list, tooltips, the find bar, the chat's message box) bend what is behind them near their edges, as a lens
// would, then blur and brighten it; app.css adds the darker rim and the highlights. The bending is an SVG
// displacement map drawn for each surface's size and corner radius and used in its backdrop-filter (Chromium draws
// SVG filters there). Surfaces are found as they appear and redrawn when their size changes.

const SURFACES = '.menu-list, .context-menu, .autocomplete, .tooltip, .find-bar, .chat-composer';
const NS = 'http://www.w3.org/2000/svg';
const KEEP = 48; // displacement maps kept (one per size and radius); the oldest go first

let on = false;
let zoom = 1; // the UI scale: Chromium applies a backdrop's SVG filter in zoomed pixels, not CSS ones
let defs = null;
let seq = 0;
const maps = new Map(); // `${w}x${h}x${r}` -> filter id, in order of last use
const sized = new ResizeObserver((entries) => { for (const e of entries) glaze(e.target); });
const bottoms = new ResizeObserver((entries) => {
  for (const e of entries) e.target.parentElement?.style.setProperty('--chat-bottom-h', `${Math.ceil(e.target.offsetHeight)}px`);
});
const added = new MutationObserver((records) => {
  for (const r of records) {
    for (const node of r.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches(SURFACES)) watch(node);
      node.querySelectorAll(SURFACES).forEach(watch);
      if (node.matches('.chat-bottom')) bottoms.observe(node);
      node.querySelectorAll('.chat-bottom').forEach((el) => bottoms.observe(el));
    }
  }
});

function watch(el) {
  sized.observe(el);
  glaze(el);
}

// The lens: inside a band along the edge (wider on bigger surfaces), each pixel says where to look instead,
// further in along the edge's normal and more so nearer the edge, as a rounded glass slab bends light.
// Red is the x offset and green the y offset, 128 meaning none (feDisplacementMap).
function lensMap(w, h, r) {
  const band = Math.max(6, Math.min(22, Math.min(w, h) * 0.3));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const rr = Math.min(r, cx, cy);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - cx;
      const py = y + 0.5 - cy;
      const qx = Math.abs(px) - (cx - rr);
      const qy = Math.abs(py) - (cy - rr);
      // Distance to the rounded rectangle's edge (negative inside) and the outward normal there.
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const corner = Math.hypot(ox, oy);
      const d = corner + Math.min(Math.max(qx, qy), 0) - rr;
      let nx = 0;
      let ny = 0;
      if (ox > 0 && oy > 0) { nx = (ox / corner) * Math.sign(px); ny = (oy / corner) * Math.sign(py); } else if (qx > qy) nx = Math.sign(px);
      else ny = Math.sign(py);
      const t = d < 0 ? Math.max(0, 1 + d / band) : 0; // 1 at the edge, 0 from the band's inner side on
      const k = t * t * (3 - 2 * t); // eased, so the bending fades in smoothly
      const i = (y * w + x) * 4;
      img.data[i] = Math.round(128 - nx * k * 127);
      img.data[i + 1] = Math.round(128 - ny * k * 127);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // At most half the band, so the bending magnifies without folding over (which smears what is behind into streaks).
  return { url: canvas.toDataURL(), scale: band };
}

function filterFor(w, h, r) {
  const key = `${w}x${h}x${r}@${zoom}`;
  let id = maps.get(key);
  if (id) {
    maps.delete(key);
    maps.set(key, id);
    return id;
  }
  id = `liquid-${++seq}`;
  const { url, scale } = lensMap(w, h, r);
  const filter = document.createElementNS(NS, 'filter');
  filter.id = id;
  // In zoomed pixels: in CSS ones the filter would cover only part of the surface, and past it what is behind
  // would show through unfiltered (sharp).
  const z = zoom;
  for (const [k, v] of Object.entries({ x: 0, y: 0, width: w * z, height: h * z, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' })) filter.setAttribute(k, v);
  const image = document.createElementNS(NS, 'feImage');
  for (const [k, v] of Object.entries({ href: url, x: 0, y: 0, width: w * z, height: h * z, preserveAspectRatio: 'none', result: 'lens' })) image.setAttribute(k, v);
  const shift = document.createElementNS(NS, 'feDisplacementMap');
  for (const [k, v] of Object.entries({ in: 'SourceGraphic', in2: 'lens', scale: scale * z, xChannelSelector: 'R', yChannelSelector: 'G' })) shift.setAttribute(k, v);
  filter.append(image, shift);
  defs.append(filter);
  maps.set(key, id);
  if (maps.size > KEEP) {
    const [oldKey, oldId] = maps.entries().next().value;
    maps.delete(oldKey);
    document.getElementById(oldId)?.remove();
  }
  return id;
}

function glaze(el) {
  if (!on || !el.isConnected) return;
  const w = Math.round(el.offsetWidth);
  const h = Math.round(el.offsetHeight);
  if (w < 4 || h < 4) return;
  const r = Math.round(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0);
  const lens = `url(#${filterFor(w, h, r)})`;
  // The message box holds menus of its own. An element with a backdrop filter is where the filters of everything
  // inside it stop looking (their backdrop root), so those menus would see only the box, not the chat behind them:
  // its glass is a layer behind its content instead (::before, chat.css). Menus and lists are frosted more than
  // bars: they are full of text.
  if (el.matches('.chat-composer')) el.style.setProperty('--lg-lens', lens);
  else el.style.backdropFilter = `${lens} var(${el.matches('.find-bar') ? '--lg-after' : '--lg-after-list'})`;
}

// `scale`: the UI scale (1.05 for 105%).
export function setLiquidGlass(enabled, scale = 1) {
  if (enabled === on && scale === zoom) return;
  const rescaled = scale !== zoom;
  zoom = scale;
  if (enabled && on && rescaled) {
    document.querySelectorAll(SURFACES).forEach(glaze);
    return;
  }
  on = enabled;
  if (on) {
    if (!defs) {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('aria-hidden', 'true');
      svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
      defs = document.createElementNS(NS, 'defs');
      svg.append(defs);
      document.body.append(svg);
    }
    added.observe(document.body, { childList: true, subtree: true });
    document.querySelectorAll(SURFACES).forEach(watch);
    document.querySelectorAll('.chat-bottom').forEach((el) => bottoms.observe(el));
  } else {
    added.disconnect();
    sized.disconnect();
    bottoms.disconnect();
    document.querySelectorAll(SURFACES).forEach((el) => { el.style.backdropFilter = ''; el.style.removeProperty('--lg-lens'); });
    document.querySelectorAll('.chat').forEach((el) => el.style.removeProperty('--chat-bottom-h'));
  }
}
