// Terminal palettes, tuned to sit on the app's own surfaces (see styles.css tokens).
import { phrase } from './i18n.js';

const DARK = {
  background: '#161618', // = --surface (app.css)
  foreground: '#F2F2F4', // = --text
  cursorAccent: '#161618', // cursor and selection follow the accent color (xtermTheme)
  scrollbarSliderBackground: 'rgba(242, 242, 244, 0.20)', // = CSS scrollbars (app.css)
  scrollbarSliderHoverBackground: 'rgba(242, 242, 244, 0.34)',
  scrollbarSliderActiveBackground: 'rgba(242, 242, 244, 0.46)',
  black: '#2C2C2E',
  red: '#E5685F',
  green: '#8CC79A',
  yellow: '#E9B860',
  blue: '#7EA6E6',
  magenta: '#C792D8',
  cyan: '#6EC4C4',
  white: '#C7C7CC',
  brightBlack: '#636366',
  brightRed: '#F08A80',
  brightGreen: '#A6DCB2',
  brightYellow: '#F3CC80',
  brightBlue: '#9DBDF0',
  brightMagenta: '#DAAEE6',
  brightCyan: '#8FD8D6',
  brightWhite: '#F5F5F7',
};

const LIGHT = {
  background: '#FCFCFC',
  foreground: '#1D1D1F',
  cursorAccent: '#FCFCFC',
  scrollbarSliderBackground: 'rgba(29, 29, 31, 0.20)',
  scrollbarSliderHoverBackground: 'rgba(29, 29, 31, 0.34)',
  scrollbarSliderActiveBackground: 'rgba(29, 29, 31, 0.46)',
  black: '#1D1D1F',
  red: '#C4423A',
  green: '#2F8A52',
  yellow: '#9A6B0E',
  blue: '#2F63C0',
  magenta: '#9248AD',
  cyan: '#1C8585',
  white: '#8E8E93',
  brightBlack: '#6E6E73',
  brightRed: '#D9574E',
  brightGreen: '#3DA265',
  brightYellow: '#B9831C',
  brightBlue: '#4479D6',
  brightMagenta: '#A85EC2',
  brightCyan: '#2A9C9C',
  brightWhite: '#C7C7CC',
};

// Accent colors to choose from (Settings → Appearance). Each has a shade tuned for the dark and the light
// theme, and `ink`: the color of text and icons drawn on top of it (the send button, primary buttons).
// Default (black) matches the --accent values in app.css. The keys are what settings store; the labels are in
// English (t() where shown).
export const ACCENTS = {
  // Black; on the dark theme black would vanish into the background, so it turns white there.
  black: { label: phrase('Default'), dark: '#FFFFFF', darkInk: '#000000', light: '#000000', lightInk: '#FFFFFF' },
  pink: { label: phrase('Pink'), dark: '#EE85B5', darkInk: '#22101A', light: '#C94A86', lightInk: '#FFFFFF' },
  ember: { label: phrase('Clay'), dark: '#D97757', darkInk: '#1B110C', light: '#C96442', lightInk: '#FFFFFF' },
};

export function accentColors(name, mode) {
  const a = ACCENTS[name] || ACCENTS.black;
  return mode === 'light' ? { accent: a.light, ink: a.lightInk } : { accent: a.dark, ink: a.darkInk };
}

const rgba = (hex, alpha) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')}, ${alpha})`;

// `seeThrough`: a fully transparent background over the background image (the color is kept for xterm's
// contrast adjustments).
export function xtermTheme(mode, accentName, seeThrough = false) {
  const base = mode === 'light' ? LIGHT : DARK;
  const { accent } = accentColors(accentName, mode);
  const [sel, inactive] = mode === 'light' ? [0.24, 0.12] : [0.30, 0.16];
  return {
    ...base,
    ...(seeThrough ? { background: `${base.background}00` } : {}),
    cursor: accent,
    selectionBackground: rgba(accent, sel),
    selectionInactiveBackground: rgba(accent, inactive),
  };
}

