// Terminal palettes, tuned to sit on the app's own surfaces (see styles.css tokens).
import { phrase } from './i18n.js';

const DARK = {
  background: '#161618', // = --surface (app.css)
  foreground: '#F2F2F4', // = --text
  cursorAccent: '#161618', // cursor and selection are drawn in the text color (xtermTheme)
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

// Color themes (Settings → Appearance): each one tints the app's surfaces, lines and greys, for the dark and the
// light theme; buttons, highlights and the accent stay the theme's black or white whichever is chosen. Default
// is app.css's own neutral greys. Clay is Claude's desktop app: warm paper and ink on light, warm charcoal on dark.
// `swatch` is the color its button shows in Settings. The keys are what settings store (as `accent`); the labels
// are in English (t() where shown).
const TOKENS = ['chrome', 'surface', 'base', 'raise', 'line', 'line-soft', 'text', 'text-2', 'muted', 'off'];
export const PALETTES = {
  black: { label: phrase('Default'), swatch: { dark: '#FFFFFF', light: '#000000' } },
  pink: {
    label: phrase('Pink'),
    swatch: { dark: '#EE85B5', light: '#C94A86' },
    dark: ['#1F171B', '#1A1317', '#251B20', '#34272D', '#45353C', '#2F2328', '#F8EEF2', '#D2C0C8', '#A08A94', '#6F5E66'],
    light: ['#FBF4F7', '#FFFAFC', '#F7ECF1', '#EEDCE4', '#E2C9D4', '#EEDCE4', '#24161C', '#4D3A43', '#87707B', '#BCA6B0'],
  },
  ember: {
    label: phrase('Clay'),
    swatch: { dark: '#D97757', light: '#C96442' },
    dark: ['#1F1E1D', '#262624', '#2D2C29', '#3A3936', '#45443F', '#34332F', '#FAF9F5', '#C3C2B7', '#9C9A92', '#6B6A64'],
    light: ['#F5F4ED', '#FAF9F5', '#F0EEE6', '#E8E6DC', '#DEDCD1', '#E8E6DC', '#141413', '#3D3D3A', '#73726C', '#A6A49B'],
  },
};

// The CSS custom properties a color theme sets on the page for `mode` ('dark' | 'light'); none for Default.
export function paletteTokens(name, mode) {
  const colors = PALETTES[name]?.[mode];
  return Object.fromEntries(TOKENS.map((token, i) => [`--${token}`, colors ? colors[i] : '']));
}

const rgba = (hex, alpha) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')}, ${alpha})`;

// `seeThrough`: a fully transparent background over the background image (the color is kept for xterm's
// contrast adjustments). The background and text follow the color theme, so a terminal sits on the chat's
// surface; the cursor and selection are drawn in the text color.
export function xtermTheme(mode, paletteName, seeThrough = false) {
  const base = mode === 'light' ? LIGHT : DARK;
  const colors = PALETTES[paletteName]?.[mode];
  const background = colors ? colors[1] : base.background; // --surface
  const foreground = colors ? colors[6] : base.foreground; // --text
  const [sel, inactive] = mode === 'light' ? [0.24, 0.12] : [0.30, 0.16];
  return {
    ...base,
    background: seeThrough ? `${background}00` : background,
    foreground,
    cursorAccent: background,
    cursor: foreground,
    selectionBackground: rgba(foreground, sel),
    selectionInactiveBackground: rgba(foreground, inactive),
  };
}
