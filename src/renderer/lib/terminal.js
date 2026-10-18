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

// `handlers`: { onData(data), onResize(cols, rows), onTitle(title), onContextMenu() }
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
  // WebGL draws faster, but on a transparent background (over a background image) its glyphs lose their sharp
  // antialiasing and the text looks blurry: see-through terminals use xterm's DOM renderer, real text the browser
  // draws crisply.
  if (!term.options.allowTransparency) {
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch { /* falls back to the DOM renderer */ }
  }

  term.onData(handlers.onData);
  term.onResize(({ cols, rows }) => handlers.onResize(cols, rows));
  term.onTitleChange(handlers.onTitle);
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
