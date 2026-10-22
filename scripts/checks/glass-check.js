// Check of the window on a computer without graphics acceleration (no driver, a virtual machine, Remote Desktop),
// simulated with --disable-gpu: there the frosted-glass window would show the system material and nothing on it,
// so the window stays solid, the app is drawn on it, and Settings says why the window isn't glass. No API usage.
// (Where the GPU works, chat-look-check covers the glass itself.) Screenshots in dist/glass-check/.
// Usage: npx vite build && npx electron scripts/checks/glass-check.js
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { tempDir } = require('./temp');

app.disableHardwareAcceleration();

const outDir = path.join(__dirname, '..', '..', 'dist', 'glass-check');
const profile = tempDir('glass-profile');
fs.mkdirSync(outDir, { recursive: true });
// Frosted glass is on, as it is for everyone at first.
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ language: 'en', uiScale: 100, theme: 'light', confirmClose: false, notify: false, sidebarGlass: true }));
app.setPath('userData', profile);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

app.on('browser-window-created', (_e, win) => {
  win.webContents.setBackgroundThrottling(false);
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => fs.writeFileSync(path.join(outDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });

  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(1500);
      check('the GPU does not composite here', app.getGPUFeatureStatus().gpu_compositing !== 'enabled', app.getGPUFeatureStatus().gpu_compositing);
      check('so the window is solid, not see-through', win.getBackgroundColor().length === 7 && win.getBackgroundColor() !== '#000000', win.getBackgroundColor());
      check('the app is drawn', await js("Boolean(document.querySelector('.empty-state') && document.querySelector('#sidebar'))"));
      // Off glass, the body paints the frame's color under everything (#app itself has none).
      check('and the page leaves nothing see-through for the glass', await js(`!document.documentElement.classList.contains('glass')
        && /^rgb\\(/.test(getComputedStyle(document.body).backgroundColor)`), await js('getComputedStyle(document.body).backgroundColor'));
      await shot('1-window');

      await js("[...document.querySelectorAll('.sidebar-bottom button')].find((b) => b.textContent.includes('Settings')).click(); true");
      await wait(600);
      await js("[...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent.includes('Appearance')).click(); true");
      await wait(500);
      const note = await js("[...document.querySelectorAll('.dialog .set-row')].find((r) => r.querySelector('.set-label')?.textContent === 'Frosted glass')?.querySelector('.set-note')?.textContent || ''");
      check('Settings says the window needs graphics acceleration', /graphics acceleration/.test(note), note);
      await shot('2-settings');
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
