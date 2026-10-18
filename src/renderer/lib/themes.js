// Terminal palettes, tuned to sit on the app's own surfaces (see styles.css tokens).
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
// Ember is the default and matches the --accent values in app.css.
export const ACCENTS = {
  ember: { label: 'Ember', dark: '#E58A5E', darkInk: '#1B120D', light: '#C4653D', lightInk: '#FFFFFF' },
  red: { label: 'Red', dark: '#EE6A64', darkInk: '#220E0D', light: '#CC3F38', lightInk: '#FFFFFF' },
  pink: { label: 'Pink', dark: '#EE85B5', darkInk: '#22101A', light: '#C94A86', lightInk: '#FFFFFF' },
  purple: { label: 'Purple', dark: '#B48CF0', darkInk: '#170F22', light: '#8A55D6', lightInk: '#FFFFFF' },
  blue: { label: 'Blue', dark: '#62A0F0', darkInk: '#0B1420', light: '#2F6FD6', lightInk: '#FFFFFF' },
  teal: { label: 'Teal', dark: '#5CC2C6', darkInk: '#0B1A1B', light: '#1C8A90', lightInk: '#FFFFFF' },
  green: { label: 'Green', dark: '#6CC88C', darkInk: '#0D1A12', light: '#2E9150', lightInk: '#FFFFFF' },
  gold: { label: 'Gold', dark: '#E8BE55', darkInk: '#1F1806', light: '#A87A0C', lightInk: '#FFFFFF' },
  graphite: { label: 'Graphite', dark: '#A3A8B4', darkInk: '#15171C', light: '#5D6370', lightInk: '#FFFFFF' },
  // Pure black; on the dark theme black would vanish into the background, so it turns white there.
  black: { label: 'Black', dark: '#FFFFFF', darkInk: '#000000', light: '#000000', lightInk: '#FFFFFF' },
};

export function accentColors(name, mode) {
  const a = ACCENTS[name] || ACCENTS.ember;
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

// Colors for the native window-controls overlay on Windows/Linux (sits on the top bar, which is --chrome).
export const chromeColors = (mode) =>
  mode === 'light' ? { color: '#F9FAFB', symbolColor: '#424245' } : { color: '#1A1A1C', symbolColor: '#C2C2C6' };
