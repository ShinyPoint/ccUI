// Check of vivid color (Settings → Appearance → Window), without API usage: switched on in Settings, soft patches of
// color drift behind the frame (the sidebar shows color it didn't have, measured in the screenshot) while the chat
// sheet stays solid; a color set and the strength change them; dark has its own colors; off takes it all away.
// Screenshots in dist/vivid-check/.
// Usage: npx vite build && npx electron scripts/checks/vivid-check.js
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { tempDir } = require('./temp');
const { install } = require('./fakes');

const profile = tempDir('vivid-profile');
const outDir = path.join(__dirname, '..', '..', 'dist', 'vivid-check');
fs.mkdirSync(outDir, { recursive: true });
install({ histories: [], transcripts: new Map(), script: () => null, prompt: () => '', shell: () => '', cli: () => '' });
// Without frosted glass, so the screenshot shows only what the page draws.
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  settingsVersion: 8, language: 'en', uiScale: 100, theme: 'light', confirmClose: false, notify: false, sidebarGlass: false,
}));
app.setPath('userData', profile);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail && !ok ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

app.on('browser-window-created', (_e, win) => {
  win.setSize(1320, 860);
  win.webContents.setBackgroundThrottling(false);
  const js = (code) => win.webContents.executeJavaScript(code);
  const until = async (label, condition, timeout = 10000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await js(condition).catch(() => false)) return true;
      await wait(100);
    }
    check(`waiting for ${label}`, false, 'timeout');
    return false;
  };
  const click = (selector, text) => js(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.includes(${JSON.stringify(text)})); el?.click(); return Boolean(el); })()`);
  // A part of the window's pixels (BGRA), saving the whole screenshot as `name` when given.
  const pixels = async (rect, name) => {
    const image = await win.webContents.capturePage();
    if (name) fs.writeFileSync(path.join(outDir, `${name}.png`), image.toPNG());
    const scale = image.getSize().width / (await js('window.innerWidth'));
    return image.crop({ x: Math.round(rect.x * scale), y: Math.round(rect.y * scale), width: Math.round(rect.w * scale), height: Math.round(rect.h * scale) }).toBitmap();
  };
  // How far two shots of the same part differ: the mean channel difference, 0 to 255.
  const differ = (a, b) => {
    let sum = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (i % 4 !== 3) sum += Math.abs(a[i] - b[i]);
    return sum / (Math.min(a.length, b.length) * 0.75);
  };
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });

  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(1200);
      // An empty part of the sidebar, and one inside the chat sheet.
      const sidebar = { x: 16, y: 470, w: 200, h: 280 };
      const sheet = JSON.parse(await js("JSON.stringify((() => { const r = document.querySelector('#stage').getBoundingClientRect(); return { x: r.left + 40, y: r.top + 60, w: 200, h: 120 }; })())"));
      const before = await pixels(sidebar, '1-off');
      const sheetBefore = await pixels(sheet);

      // On, from Settings
      await click('.sidebar-bottom button', 'Settings');
      await until('Settings', "Boolean(document.querySelector('.settings-nav'))");
      await click('.settings-nav button', 'Appearance');
      await wait(300);
      const row = "[...document.querySelectorAll('.dialog .set-row')].find((r) => r.querySelector('.set-label')?.textContent === 'Vivid color')";
      check('Appearance has Vivid color, off at first', await js(`Boolean(${row}) && !${row}.querySelector('input').checked`));
      await js(`${row}.querySelector('input').click(); true`);
      await until('its options', "document.querySelectorAll('.vivid-swatch').length === 4");
      check('switched on, it offers four color sets and a strength', await js("document.querySelectorAll('.vivid-swatch').length === 4 && [...document.querySelectorAll('.dialog .set-label')].some((l) => l.textContent === 'Strength')"));
      await wait(500);
      fs.writeFileSync(path.join(outDir, '2-settings.png'), (await win.webContents.capturePage()).toPNG());
      await click('.settings-head button', 'Done');
      await wait(1200);

      const layer = JSON.parse(await js(`JSON.stringify({
        vivid: document.documentElement.classList.contains('vivid'),
        blobs: document.querySelectorAll('#vivid .vivid-blob').length,
        running: document.querySelectorAll('#vivid .vivid-blob').length && [...document.querySelectorAll('#vivid .vivid-blob')].every((b) => b.getAnimations().some((a) => a.playState === 'running')),
        sidebar: getComputedStyle(document.querySelector('#sidebar')).backgroundColor,
        sheet: getComputedStyle(document.querySelector('#stage')).backgroundColor,
        behind: getComputedStyle(document.querySelector('#vivid')).zIndex })`));
      check('patches of color are drawn behind the frame, each moving on its own', layer.vivid && layer.blobs === 6 && layer.running && layer.behind === '-1', JSON.stringify(layer));
      check('the sidebar lets them through; the chat sheet stays solid', /rgba\(0, 0, 0, 0\)|transparent/.test(layer.sidebar) && !/rgba/.test(layer.sheet), JSON.stringify(layer));
      const change = differ(before, await pixels(sidebar, '3-on'));
      check('the sidebar now has color', change > 5, change.toFixed(1));
      const sheetChange = differ(sheetBefore, await pixels(sheet));
      check('the chat sheet does not', sheetChange < 1, sheetChange.toFixed(2));

      // Another color set, then the strongest
      await js('window.ccui.setSettings({ vividPalette: \'sunset\' })');
      await js("location.hash = ''; true");
      await win.webContents.executeJavaScript("window.dispatchEvent(new Event('focus')); true");
      await wait(300);
      // Settings saved from outside the window aren't pushed to it: the window reads them on its next load.
      win.webContents.reload();
      await new Promise((r) => win.webContents.once('did-finish-load', r));
      await wait(1500);
      const sunset = await js("getComputedStyle(document.querySelector('#vivid .vivid-blob')).backgroundImage");
      check('a color set changes the patches’ colors', /rgb\(255, 164, 119\)|rgb\(255, 127, 156\)|rgb\(255, 210, 122\)|rgb\(201, 155, 255\)|rgb\(255, 179, 138\)/.test(sunset), sunset.slice(0, 80));
      // The frame's tint: Chromium reports a color-mix() as color(srgb r g b / alpha).
      const tint = () => js("Number(/\\/ ([\\d.]+)\\)$/.exec(getComputedStyle(document.querySelector('#app')).backgroundColor)?.[1] ?? 1)");
      const weak = await tint();
      await js('window.ccui.setSettings({ vividStrength: 100 })');
      win.webContents.reload();
      await new Promise((r) => win.webContents.once('did-finish-load', r));
      await wait(1500);
      const strong = await tint();
      check('more strength, a lighter tint over them', strong < weak, `${weak} → ${strong}`);
      await pixels(sidebar, '4-sunset-strong');
      await js('window.ccui.setSettings({ theme: \'dark\' })');
      win.webContents.reload();
      await new Promise((r) => win.webContents.once('did-finish-load', r));
      await wait(1500);
      const dark = await js("getComputedStyle(document.querySelector('#vivid .vivid-blob')).backgroundImage");
      check('dark has its own, deeper colors', /rgb\(181, 80, 42\)|rgb\(163, 48, 79\)|rgb\(166, 122, 30\)|rgb\(106, 63, 168\)|rgb\(142, 58, 46\)/.test(dark), dark.slice(0, 80));
      await pixels(sidebar, '5-dark');

      // Off
      await js('window.ccui.setSettings({ vividColor: false })');
      win.webContents.reload();
      await new Promise((r) => win.webContents.once('did-finish-load', r));
      await wait(1200);
      check('turned off, it is all gone', !(await js("document.documentElement.classList.contains('vivid') || Boolean(document.querySelector('#vivid'))")));
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
