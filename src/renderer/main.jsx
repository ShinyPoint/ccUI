import { render } from 'preact';
import { computed, effect } from '@preact/signals';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import '@xterm/xterm/css/xterm.css';
import './styles/app.css';
import './styles/chat.css';
import { api, info, settings, claudeCheck, themeMode, sessions, active, backgroundUrl } from './lib/store.js';
import { chromeColors, accentColors } from './lib/themes.js';
import { applyTerminalOptions, fitTerminal } from './lib/terminal.js';
import { installShortcuts } from './lib/keyboard.js';
import { restoreSessions } from './lib/sessions.js';
import { App } from './components/App.jsx';

info.value = await api.info();
settings.value = await api.getSettings();

const prefersDark = matchMedia('(prefers-color-scheme: dark)');
const resolveTheme = () => {
  const theme = settings.value.theme;
  return theme === 'system' ? (prefersDark.matches ? 'dark' : 'light') : theme;
};
prefersDark.addEventListener('change', () => { themeMode.value = resolveTheme(); });
effect(() => { themeMode.value = resolveTheme(); });
effect(() => { api.setThemeSource(settings.value.theme); });
effect(() => {
  const mode = themeMode.value;
  document.documentElement.dataset.theme = mode;
  // Over a background image the window buttons sit on the image too.
  const colors = chromeColors(mode);
  api.setChrome(backgroundUrl.value ? { ...colors, color: '#00000000' } : colors);
});
effect(() => {
  // Overrides the default (Ember) --accent of the theme; everything accent-tinted derives from these two.
  const { accent, ink } = accentColors(settings.value.accent, themeMode.value);
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-ink', ink);
});
effect(() => {
  document.documentElement.style.setProperty('--chat-size', `${settings.value.chatFontSize || 14}px`);
});
// Background image: loaded as bytes from the main process (the window can't read files itself) into a blob:
// URL; app.css draws it blurred behind everything and turns the panels see-through.
const backgroundName = computed(() => settings.value.backgroundImage);
let backgroundLoad = 0;
effect(() => {
  const name = backgroundName.value;
  const load = ++backgroundLoad;
  (name ? api.background.read() : Promise.resolve(null)).then((image) => {
    if (load !== backgroundLoad) return;
    if (backgroundUrl.peek()) URL.revokeObjectURL(backgroundUrl.peek());
    backgroundUrl.value = image ? URL.createObjectURL(new Blob([image.data], { type: image.type })) : '';
  });
});
effect(() => {
  const root = document.documentElement;
  const url = backgroundUrl.value;
  root.classList.toggle('has-bg', Boolean(url));
  root.style.setProperty('--bg-image', url ? `url("${url}")` : 'none');
  root.style.setProperty('--bg-show', `${settings.value.backgroundShow ?? 40}%`);
  root.style.setProperty('--bg-blur', `${settings.value.backgroundBlur ?? 8}px`);
});
let glassOn = null;
effect(() => {
  // Frosted-glass sidebar: the window gets the system material, the page turns see-through behind the sidebar.
  // A background image takes its place.
  const on = Boolean(info.value.glassSupported && settings.value.sidebarGlass && !backgroundUrl.value);
  document.documentElement.classList.toggle('glass', on);
  if (on !== glassOn) api.setGlass(on);
  glassOn = on;
});
// Only terminal-related preferences touch the terminals (settings are saved often for other reasons),
// and only the visible terminal is refitted: hidden ones are fitted when selected.
const terminalPrefs = computed(() => {
  const s = settings.value;
  return `${s.fontSize}|${s.lineHeight}|${s.fontFamily}|${s.cursorBlink}|${s.terminalTheme}|${s.accent}|${themeMode.value}|${s.backgroundImage}`;
});
effect(() => {
  terminalPrefs.value;
  applyTerminalOptions(sessions.peek().flatMap((x) => [x.term, x.panel.term]).filter(Boolean));
  requestAnimationFrame(() => {
    const s = active.peek();
    if (s?.term && s.kind.peek() !== 'chat') fitTerminal(s);
    if (s?.panel.open.peek()) fitTerminal(s.panel);
  });
});

await Promise.all([
  document.fonts.load(`${settings.value.fontSize}px "JetBrains Mono"`),
  document.fonts.load(`bold ${settings.value.fontSize}px "JetBrains Mono"`),
  document.fonts.load('14px "Instrument Sans"'),
]).catch(() => {});

installShortcuts();
render(<App />, document.getElementById('root'));

api.detectClaude(settings.value.claudePath).then((res) => { claudeCheck.value = res; });
if (settings.value.restoreSessions) restoreSessions();
