// xterm.js instances for terminal and shell sessions. Each lives in its own host element inside
// the persistent #term-stack, so switching sessions never re-creates a terminal.
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import { api, info, settings, themeMode } from './store.js';
import { xtermTheme } from './themes.js';

export const termStack = document.createElement('div');
termStack.id = 'term-stack';

// Same idea for the shells in the bottom Terminal panel.
export const panelStack = document.createElement('div');
panelStack.className = 'panel-stack';

// 'dark' or 'light'. Settings can pin the terminal to dark, the palette Claude Code's own colors are made for.
export function terminalMode() {
  return settings.value.terminalTheme === 'dark' ? 'dark' : themeMode.value;
}

// With a background image the terminal is see-through (its area is tinted like the chat's). xterm only allows
// that if set before it opens, so terminals opened before an image was chosen stay solid.
const seeThrough = () => Boolean(settings.value.backgroundImage);

function options() {
  const s = settings.value;
  return {
    allowTransparency: seeThrough(),
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    cursorBlink: s.cursorBlink,
    // A thin bar, like a text field's, rather than a solid block; unfocused, a dimmer outline of it.
    cursorStyle: 'bar',
    cursorWidth: 2,
    cursorInactiveStyle: 'bar',
    scrollback: s.scrollback,
    theme: xtermTheme(terminalMode(), s.accent, seeThrough()),
    // Claude Code paints with its own 24-bit colors, picked for its own theme. On a background they weren't
    // picked for (e.g. near-white text on our light terminal), xterm shifts them until they are readable.
    minimumContrastRatio: 4.5,
    allowProposedApi: true,
    macOptionIsMeta: true,
    drawBoldTextInBrightColors: false,
    ...(info.value.platform === 'win32' ? { windowsPty: { backend: 'conpty', buildNumber: info.value.windowsBuild } } : {}),
  };
}

// WebGL draws faster, and draws block and box characters exactly (Claude Code's logo, its borders), where the DOM
// renderer leaves seams between the cells. A window gets 16 WebGL contexts at most (one more, and the oldest is
// lost), and with every terminal holding one a few sessions would use them up: only the terminals shown last hold
// one, the others draw with the DOM renderer until shown again. A context lost anyway (a GPU reset) is made again
// when its terminal is shown.
// On a transparent background (over a background image) WebGL's glyphs lose their sharp antialiasing and the text
// looks blurry: see-through terminals always use the DOM renderer, real text the browser draws crisply.
const WEBGL_MAX = 8;
const webglUsers = []; // { term, addon, shown, disposed }, the one shown last at the end

function dropWebgl(user) {
  const i = webglUsers.indexOf(user);
  if (i >= 0) webglUsers.splice(i, 1);
  const { addon } = user;
  user.addon = null;
  try { addon?.dispose(); } catch { /* gone with its terminal already */ }
}

function useWebgl(user) {
  if (user.disposed || user.term.options.allowTransparency) return;
  const i = webglUsers.indexOf(user);
  if (i >= 0) webglUsers.splice(i, 1);
  if (!user.addon) {
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        if (user.addon !== addon) return;
        dropWebgl(user);
        setTimeout(() => { if (user.shown) useWebgl(user); }, 1000);
      });
      user.term.loadAddon(addon);
      user.addon = addon;
    } catch {
      return; // no WebGL here: the DOM renderer
    }
  }
  webglUsers.push(user);
  while (webglUsers.length > WEBGL_MAX) dropWebgl(webglUsers[0]);
}

// `handlers`: { onData(data), onResize(cols, rows), onTitle(title), onContextMenu(), onProgramStatus(data) }
export function createTerminal(handlers, container = termStack) {
  const term = new Terminal(options());
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon((_e, uri) => api.openExternal(uri)));
  const unicode = new Unicode11Addon();
  term.loadAddon(unicode);
  term.unicode.activeVersion = '11';

  // The padded host holds an unpadded mount: the fit addon sizes the terminal from its parent's computed
  // width and height, which (box-sizing: border-box) would include the host's padding and give the terminal
  // more columns and rows than fit, pushing its last ones under the edge.
  const host = document.createElement('div');
  host.className = 'term-host';
  const mount = document.createElement('div');
  mount.className = 'term-mount';
  host.append(mount);
  container.append(host);
  term.open(mount);
  // Shown: its host is the active one of its stack (the others are there, hidden).
  const user = { term, addon: null, shown: false, disposed: false };
  const watch = new MutationObserver(() => {
    const shown = host.classList.contains('active');
    if (shown && !user.shown) useWebgl(user);
    user.shown = shown;
  });
  watch.observe(host, { attributes: true, attributeFilter: ['class'] });
  // Its WebGL context, and the watch for it being shown, go with it.
  term.loadAddon({ activate() {}, dispose() { user.disposed = true; watch.disconnect(); dropWebgl(user); } });

  term.onData(handlers.onData);
  if (handlers.onKey) term.onKey(handlers.onKey);
  term.onResize(({ cols, rows }) => handlers.onResize(cols, rows));
  term.onTitleChange(handlers.onTitle);
  // Claude Code's report of what it is doing (OSC 7501), for the program running in the terminal to tell.
  if (handlers.onProgramStatus) term.parser.registerOscHandler(7501, (data) => { handlers.onProgramStatus(data); return true; });
  term.onSelectionChange(() => {
    if (settings.value.copyOnSelect && term.hasSelection()) api.writeClipboard(term.getSelection());
  });
  host.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    handlers.onContextMenu();
  });
  return { term, fit, host };
}

export function fitTerminal(s) {
  try { s.fit?.fit(); } catch { /* host not measurable */ }
}

export function applyTerminalOptions(terms) {
  const s = settings.value;
  for (const term of terms) {
    Object.assign(term.options, {
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      fontFamily: s.fontFamily,
      cursorBlink: s.cursorBlink,
      theme: xtermTheme(terminalMode(), s.accent, term.options.allowTransparency && seeThrough()),
    });
  }
}
