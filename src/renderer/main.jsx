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
import { api, info, settings, saveSettings, claudeCheck, claudeUpdate, dshInstall, themeMode, sessions, active, backgroundUrl, toast, confirmDialog } from './lib/store.js';
import { paletteTokens } from './lib/themes.js';
import { applyTerminalOptions, fitTerminal } from './lib/terminal.js';
import { installShortcuts } from './lib/keyboard.js';
import { installTooltips } from './lib/tooltip.js';
import { restoreSessions, runningTasks } from './lib/sessions.js';
import { App } from './components/App.jsx';
import { sidebarWidth } from './components/Sidebar.jsx';
import { setLiquidGlass } from './lib/liquid.js';
import { setVivid } from './lib/vivid.js';
import { language, locale, t } from './lib/i18n.js';

info.value = await api.info();
settings.value = await api.getSettings();
// Every project folder in the sidebar starts folded; what you open stays open until the app quits.
if (Object.keys(settings.value.folders || {}).length) saveSettings({ folders: {} });

const prefersDark = matchMedia('(prefers-color-scheme: dark)');
const resolveTheme = () => {
  const theme = settings.value.theme;
  return theme === 'system' ? (prefersDark.matches ? 'dark' : 'light') : theme;
};
prefersDark.addEventListener('change', () => { themeMode.value = resolveTheme(); });
// The app's language (Settings → General, lib/i18n.js); <html lang> for CJK line breaking and fonts.
effect(() => { language.value = settings.value.language || 'system'; });
effect(() => { document.documentElement.lang = locale.value; });
effect(() => { themeMode.value = resolveTheme(); });
effect(() => { api.setThemeSource(settings.value.theme); });
// Frosted glass: the window gets the system material and the frame around the work area turns see-through.
// A background image takes its place.
// Only where the window can be glass (glassAvailable: the system can, and the GPU composites the page onto it).
const glass = computed(() => Boolean(info.value.glassAvailable && settings.value.sidebarGlass && !backgroundUrl.value));
api.onGlassAvailable((on) => { info.value = { ...info.value, glassAvailable: on }; });
effect(() => {
  document.documentElement.dataset.theme = themeMode.value;
});
effect(() => {
  // The color theme tints the surfaces and greys (Default leaves app.css's own); everything else derives from them.
  for (const [name, value] of Object.entries(paletteTokens(settings.value.accent, themeMode.value))) {
    if (value) document.documentElement.style.setProperty(name, value);
    else document.documentElement.style.removeProperty(name);
  }
});
effect(() => {
  document.documentElement.style.setProperty('--chat-size', `${settings.value.chatFontSize || 14}px`);
});
// Liquid glass: the surfaces' tint and blur follow the clear-to-frosted slider.
effect(() => {
  const on = Boolean(settings.value.liquidGlass);
  const frost = Math.min(100, Math.max(0, Number(settings.value.liquidFrost ?? 35))) / 100;
  const root = document.documentElement;
  root.classList.toggle('liquid', on);
  const bright = themeMode.value === 'dark' ? 0.92 : 1.06;
  // Bars (the message box, the find bar) go from clear to frosted; menus and lists, which are full of text, stay
  // well frosted at any setting, so what is behind them never competes with their words.
  root.style.setProperty('--lg-tint', `${Math.round(12 + frost * 58)}%`);
  root.style.setProperty('--lg-after', `blur(${(1 + frost * 13).toFixed(1)}px) saturate(${(1.9 - frost * 0.5).toFixed(2)}) brightness(${bright})`);
  root.style.setProperty('--lg-tint-list', `${Math.round(66 + frost * 26)}%`);
  root.style.setProperty('--lg-after-list', `blur(${(18 + frost * 10).toFixed(1)}px) saturate(1.5) brightness(${bright})`);
  setLiquidGlass(on, (settings.value.uiScale || 105) / 100);
});
// Vivid color: patches of color behind the frame; a background image takes their place.
effect(() => {
  const s = settings.value;
  setVivid(Boolean(s.vividColor) && !backgroundUrl.value, {
    palette: s.vividPalette, strength: s.vividStrength ?? 50, dark: themeMode.value === 'dark', sidebar: sidebarWidth(s.sidebarWidth),
  });
});
// The sidebar's width, as dragged (SidebarResizer).
effect(() => {
  document.documentElement.style.setProperty('--sidebar-w', `${sidebarWidth(settings.value.sidebarWidth)}px`);
});
// UI scale (Settings → Appearance): set before the first paint, so the app never shows at another size first.
effect(() => { api.setZoom((settings.value.uiScale || 105) / 100); });
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
effect(() => {
  document.documentElement.classList.toggle('fill-edge', Boolean(settings.value.fillEdge));
  document.documentElement.classList.toggle('no-thinking-mark', !settings.value.thinkingMark);
});
// Frosted pop-ups follow the same switch, whether or not the window itself can be glass.
effect(() => {
  document.documentElement.classList.toggle('frost', Boolean(settings.value.sidebarGlass));
});
let glassOn = null;
effect(() => {
  const on = glass.value;
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
installTooltips();
render(<App />, document.getElementById('root'));

api.detectClaude(settings.value.claudePath).then((res) => { claudeCheck.value = res; });
// Questions from the main process, asked with the app's own dialog.
const ASKS = {
  quit: ({ count }) => {
    const tasks = sessions.peek().flatMap(runningTasks);
    return {
      title: count === 1 ? t('1 session is still running') : t('{n} sessions are still running', { n: count }),
      message: !tasks.length ? t('Quitting ends them. Conversations are saved, so you can continue them later.')
        : tasks.length === 1 ? t('Quitting ends them. Conversations are saved, so you can continue them later. A background task is running too: it may keep running on its own, but Claude won’t be told when it finishes.')
          : t('Quitting ends them. Conversations are saved, so you can continue them later. {n} background tasks are running too: they may keep running on their own, but Claude won’t be told when they finish.', { n: tasks.length }),
      confirm: t('End sessions and quit'),
      danger: true,
    };
  },
  // The window's close button, until a choice is remembered (Settings → General).
  close: () => ({
    title: t('Hide ccUI in the tray?'),
    message: t('Sessions keep running in the tray, and the tray icon brings the window back. Quitting ends them.'),
    confirm: t('Hide in the tray'), alt: t('Quit'), remember: t('Don’t ask again'),
  }),
  trust: ({ folder, detail }) => ({
    title: t('Trust this folder?'), detail: folder, message: detail, confirm: t('Trust this folder'), safeDefault: true,
  }),
};
api.onAsk((id, kind, payload) => {
  const ask = ASKS[kind];
  (ask ? confirmDialog(ask(payload || {})) : Promise.resolve(false)).then((yes) => api.answer(id, yes));
});
api.dshInstall.state().then((st) => { if (st) dshInstall.value = st; });
api.dshInstall.onState((st) => {
  const was = dshInstall.value.state;
  dshInstall.value = st;
  if (st.state === 'ready' && was !== 'ready' && was !== 'absent') toast(t('DeepSeek Harness {version} is ready.', { version: st.version }));
  else if (st.state === 'error' && was !== 'error') toast(st.error, 'error');
});
api.claudeUpdate.state().then((st) => { if (st) claudeUpdate.value = st; });
api.claudeUpdate.onState((st) => {
  const was = claudeUpdate.value.state;
  claudeUpdate.value = st;
  if (st.state === 'ready' && was !== 'ready') {
    api.detectClaude(settings.value.claudePath).then((res) => { claudeCheck.value = res; });
    toast(t('Claude Code {version} is ready. New sessions use it.', { version: st.target || st.current }));
  }
});
if (settings.value.restoreSessions) restoreSessions();
