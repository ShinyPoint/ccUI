// Vivid color (Settings → Appearance → Window): soft, irregular patches of color drift slowly behind the frame around
// the work area (the sidebar, the top bar, the gaps), so the frame isn't one flat color over a plain desktop. They
// live in a layer of their own behind #app (app.css html.vivid), which turns the frame's tint lighter while they
// are on. Each patch is a soft radial gradient; stretched, turned and moved by its own long animation (transforms
// only, so the compositor does the work), several overlapping make shapes that never repeat exactly. With reduced
// motion they stay where they are; while the window is hidden they stop.
import { phrase } from './i18n.js';

// Each set's colors for the light and the dark theme, and the swatch Settings shows for it. Labels are English
// (t() where shown).
export const VIVID_PALETTES = {
  aurora: { label: phrase('Aurora'), light: ['#7AA2FF', '#B98CFF', '#5ED6CF', '#FF9CC8', '#8FB8FF'], dark: ['#3557C9', '#6B3FC4', '#1E8F8A', '#B0407A', '#2E6BB8'] },
  sunset: { label: phrase('Sunset'), light: ['#FFA477', '#FF7F9C', '#FFD27A', '#C99BFF', '#FFB38A'], dark: ['#B5502A', '#A3304F', '#A67A1E', '#6A3FA8', '#8E3A2E'] },
  ocean: { label: phrase('Ocean'), light: ['#6FA0FF', '#55D4F0', '#8D84FF', '#6FE6C2', '#7FC1FF'], dark: ['#2950B8', '#1A7FA0', '#4B3FB0', '#1B8A6A', '#2A5F9E'] },
  meadow: { label: phrase('Meadow'), light: ['#9BE37A', '#5ED6B4', '#F5DE7A', '#7EC8FF', '#B6E88A'], dark: ['#3F8A2A', '#1F8A6E', '#8F7A1E', '#2A6AA3', '#4E7F25'] },
};
export const swatchFor = (name, dark) => {
  const c = (VIVID_PALETTES[name] || VIVID_PALETTES.aurora)[dark ? 'dark' : 'light'];
  return `radial-gradient(circle at 30% 30%, ${c[0]}, transparent 70%), radial-gradient(circle at 75% 70%, ${c[1]}, transparent 70%), ${c[2]}`;
};

const COUNT = 6;
let layer = null;
let animations = [];
let shown = null; // what is drawn now: `${palette}:${dark}:${sidebar}`

const rand = (a, b) => a + Math.random() * (b - a);

function build(colors, sidebar) {
  layer.replaceChildren();
  for (const a of animations) a.cancel();
  animations = [];
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (let i = 0; i < COUNT; i++) {
    const blob = document.createElement('span');
    blob.className = 'vivid-blob';
    // Most of them where the frame is widest, the sidebar; two along the top bar.
    const onTop = i >= COUNT - 2;
    const size = rand(320, 560);
    const x = onTop ? rand(sidebar, w) : rand(-size * 0.4, sidebar + 80);
    const y = onTop ? rand(-size * 0.55, -size * 0.2) : rand(-size * 0.3, h - size * 0.4);
    Object.assign(blob.style, {
      left: `${x - size / 2}px`, top: `${y}px`, width: `${size}px`, height: `${size * rand(0.7, 1.2)}px`,
      background: `radial-gradient(closest-side, ${colors[i % colors.length]}, transparent)`,
    });
    layer.append(blob);
    const step = () => `translate(${rand(-140, 140).toFixed(0)}px, ${rand(-180, 180).toFixed(0)}px) rotate(${rand(-60, 60).toFixed(0)}deg) scale(${rand(0.8, 1.45).toFixed(2)}, ${rand(0.65, 1.2).toFixed(2)})`;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      animations.push(blob.animate([{ transform: step() }, { transform: step() }, { transform: step() }], {
        duration: rand(26000, 52000), direction: 'alternate', iterations: Infinity, easing: 'ease-in-out', delay: -rand(0, 26000),
      }));
    }
  }
}

document.addEventListener('visibilitychange', () => {
  for (const a of animations) {
    if (document.hidden) a.pause();
    else a.play();
  }
});

// `palette`: a key of VIVID_PALETTES; `strength`: 0 to 100; `sidebar`: its width in px (where the patches gather).
export function setVivid(on, { palette = 'aurora', dark = false, strength = 50, sidebar = 256 } = {}) {
  const root = document.documentElement;
  root.style.setProperty('--vivid-strength', String(Math.min(100, Math.max(0, strength)) / 100));
  if (!on) {
    if (!layer) return;
    const gone = layer;
    layer = null;
    shown = null;
    root.classList.remove('vivid');
    gone.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, easing: 'ease-out' }).finished
      .then(() => { gone.remove(); }, () => gone.remove());
    for (const a of animations) a.cancel();
    animations = [];
    return;
  }
  const key = `${palette}:${dark}:${Math.round(sidebar / 40)}`;
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'vivid';
    layer.setAttribute('aria-hidden', 'true');
    document.body.prepend(layer);
    layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, easing: 'ease-out' });
  }
  root.classList.add('vivid');
  if (key !== shown) {
    shown = key;
    build((VIVID_PALETTES[palette] || VIVID_PALETTES.aurora)[dark ? 'dark' : 'light'], sidebar);
  }
}
