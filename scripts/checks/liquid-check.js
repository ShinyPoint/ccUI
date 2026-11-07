// Check of liquid glass (Settings → Appearance), without API usage (Claude is scripted, see fakes.js), at a 110% UI
// scale and the clearest glass: the message box floats over the conversation, whose last line stays above it; a
// menu opened from the message box can read what is behind it (the box itself has no backdrop filter, which would
// stop the menu's at the box) and stays well frosted, its lens filter covering all of it at the UI scale (in CSS
// pixels it would leave a strip unfiltered, sharp); turning it off takes it all away. Screenshots in
// dist/liquid-check/.
// Usage: npx vite build && npx electron scripts/checks/liquid-check.js
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { tempDir } = require('./temp');
const { install } = require('./fakes');

const profile = tempDir('liquid-profile');
const project = tempDir('liquid-project');
const outDir = path.join(__dirname, '..', '..', 'dist', 'liquid-check');
fs.mkdirSync(outDir, { recursive: true });
const ANSWER = Array.from({ length: 30 }, (_, i) => `- Line ${i + 1} of a long answer, so there is text behind the message box and its menus.`).join('\n');
install({
  histories: [], transcripts: new Map(),
  script: () => async (c) => { await c.say(ANSWER, { cps: 20000 }); c.finish(0.01); },
  prompt: () => '', shell: () => '', cli: () => '',
});
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  settingsVersion: 8, language: 'en', uiScale: 110, theme: 'light', accent: 'ember', confirmClose: false, notify: false,
  liquidGlass: true, liquidFrost: 0, trustedFolders: [project], recent: [{ path: project, at: Date.now() }],
}));
app.setPath('userData', profile);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

app.on('browser-window-created', (_e, win) => {
  win.setSize(1320, 860);
  win.webContents.setBackgroundThrottling(false);
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => fs.writeFileSync(path.join(outDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const until = async (label, condition, timeout = 10000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await js(condition).catch(() => false)) return true;
      await wait(100);
    }
    check(`waiting for ${label}`, false, 'timeout');
    return false;
  };
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error' && !/ResizeObserver loop/.test(ev.message)) console.log('[renderer]', ev.message); });

  win.webContents.once('did-finish-load', async () => {
    try {
      await until('the project', "Boolean(document.querySelector('#sidebar .folder .folder-add'))");
      await js("document.querySelector('#sidebar .folder .folder-add').click(); true");
      await until('the chat', "Boolean(document.querySelector('.chat-composer .composer-input'))");
      await wait(800);
      await js("{ const el = document.querySelector('.chat-composer .composer-input'); el.focus(); el.value = 'Go'; el.dispatchEvent(new Event('input', { bubbles: true })); } true");
      await js("document.querySelector('.chat-composer .composer-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); true");
      await until('the answer', "/Line 30/.test(document.querySelector('.timeline').textContent) && !document.querySelector('.send-btn.stop')");
      await wait(800);
      const zoom = win.webContents.getZoomFactor();

      // The message box floats over the conversation; scrolled to the end, the last line sits above it.
      await js("{ const sc = document.querySelector('.chat-scroll'); sc.scrollTop = sc.scrollHeight; } true");
      await wait(400);
      const box = JSON.parse(await js(`JSON.stringify((() => { const c = document.querySelector('.chat-composer'); const last = [...document.querySelectorAll('.timeline li')].at(-1);
        return { floats: getComputedStyle(document.querySelector('.chat-bottom')).position === 'absolute',
          lastBottom: Math.round(last.getBoundingClientRect().bottom), boxTop: Math.round(c.getBoundingClientRect().top),
          own: getComputedStyle(c).backdropFilter, layer: getComputedStyle(c, '::before').backdropFilter }; })())`));
      check('the message box floats over the conversation, and its last line stays above the box', box.floats && box.lastBottom <= box.boxTop, JSON.stringify(box));
      check('the box’s glass is a layer behind its content, with the lens, not a filter on the box itself', box.own === 'none' && /url\(.*liquid-/.test(box.layer), `${box.own} | ${box.layer.slice(0, 60)}`);
      await shot('1-message-box');

      // A menu opened from the message box, over the conversation's text.
      await js("{ const sc = document.querySelector('.chat-scroll'); sc.scrollTop = sc.scrollHeight / 3; } true");
      await js("document.querySelector('.mode-menu .menu-button').click(); true");
      await until('the permission menu', "Boolean(document.querySelector('.mode-menu .menu-list'))", 3000);
      await wait(600);
      const menu = JSON.parse(await js(`JSON.stringify((() => { const m = document.querySelector('.mode-menu .menu-list'); const cs = getComputedStyle(m);
        const id = /#(liquid-\\d+)/.exec(cs.backdropFilter)?.[1]; const f = id && document.getElementById(id);
        return { filter: cs.backdropFilter, blur: Number(/blur\\(([\\d.]+)px\\)/.exec(cs.backdropFilter)?.[1] || 0), tint: cs.backgroundColor,
          w: m.offsetWidth, h: m.offsetHeight, fw: Number(f?.getAttribute('width')), fh: Number(f?.getAttribute('height')) }; })())`));
      const alpha = Number(/\/ ([\d.]+)\)/.exec(menu.tint)?.[1] ?? 1);
      check('a menu opened from the message box is frosted well even at the clearest glass', menu.blur >= 18 && alpha >= 0.6, `blur ${menu.blur}px, tint ${alpha}`);
      check('its lens filter covers all of it at the UI scale (no strip left sharp)', Math.abs(menu.fw - menu.w * zoom) <= 1 && Math.abs(menu.fh - menu.h * zoom) <= 1,
        `menu ${menu.w}×${menu.h} at ${zoom}, filter ${menu.fw}×${menu.fh}`);
      await shot('2-menu-from-the-box');
      await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
      await wait(300);

      // Off again: no glass, no floating box, no filters left on the surfaces.
      await js('window.ccui.setSettings({ liquidGlass: false })');
      win.webContents.reload();
      await new Promise((r) => win.webContents.once('did-finish-load', r));
      await until('the chat again', "Boolean(document.querySelector('.chat-composer'))", 8000);
      await wait(800);
      const off = JSON.parse(await js(`JSON.stringify({ liquid: document.documentElement.classList.contains('liquid'), floats: getComputedStyle(document.querySelector('.chat-bottom')).position === 'absolute',
        layer: getComputedStyle(document.querySelector('.chat-composer'), '::before').content })`));
      check('turned off, it is all gone', !off.liquid && !off.floats && off.layer === 'none', JSON.stringify(off));
    } catch (err) {
      console.error('failed:', err);
      failures++;
    }
    console.log(failures ? `${failures} problem(s)` : 'all checks passed');
    process.exitCode = failures ? 1 : 0;
    app.quit();
  });
});

require('../../src/main/main.js');
