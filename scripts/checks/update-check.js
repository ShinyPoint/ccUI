// End-to-end check of Claude Code updates (Settings → Claude Code → Updates), without API usage but with a real
// download from the npm registry (a few tens of MB). The app is made to believe its built-in Claude Code is
// 2.1.0, so the newest one is offered; the script presses Update and checks that the new build is unpacked
// into the (throwaway) profile, starts, and is used from then on. Screenshots in dist/update-check/.
// Usage: npx vite build && npx electron scripts/checks/update-check.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const outDir = path.join(__dirname, '..', '..', 'dist', 'update-check');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ccui-update-profile-'));
fs.mkdirSync(outDir, { recursive: true });

// The shipped build's version comes from the SDK's package.json (claude-binary.js); make it look old.
const realRead = fs.readFileSync;
fs.readFileSync = function readFileSync(file, ...rest) {
  if (typeof file === 'string' && /claude-agent-sdk[\\/]package\.json$/.test(file)) {
    return JSON.stringify({ ...JSON.parse(realRead.call(fs, file, 'utf8')), claudeCodeVersion: '2.1.0' });
  }
  return realRead.call(fs, file, ...rest);
};

// Automatic updates off, so the button is what starts it (the default, on, is checked below).
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ language: 'en', theme: 'light', confirmClose: false, notify: false, autoUpdateClaude: false }));
app.setPath('userData', profile);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

app.on('browser-window-created', (_e, win) => {
  win.setSize(1320, 860);
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => fs.writeFileSync(path.join(outDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const until = async (label, condition, timeout = 20000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await js(condition).catch(() => false)) return true;
      await wait(150);
    }
    check(`waiting for ${label}`, false, 'timeout');
    return false;
  };
  const note = "[...document.querySelectorAll('.dialog .set-row')].find((r) => r.textContent.includes('Built-in Claude Code'))?.querySelector('.set-note')?.textContent || ''";
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });

  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(1200);
      const { Settings } = require('../../src/main/settings');
      check('automatic updates are on by default', new Settings(fs.mkdtempSync(path.join(os.tmpdir(), 'ccui-update-fresh-'))).get().autoUpdateClaude === true);

      await js("[...document.querySelectorAll('.sidebar-bottom button')].find((b) => b.textContent.includes('Settings')).click(); true");
      await until('Settings', "Boolean(document.querySelector('.settings-nav'))");
      await js("[...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent.includes('Claude Code')).click(); true");
      await until('the Updates group', `Boolean(${note})`);
      check('it shows the built-in version', /2\.1\.0/.test(await js(note)), await js(note));

      await js("[...document.querySelectorAll('.dialog button')].find((b) => b.textContent === 'Check for updates').click(); true");
      await until('a newer version', `/is available/.test(${note})`, 30000);
      const latest = /Version (\d+\.\d+\.\d+)/.exec(await js(note))?.[1];
      check('a newer version is offered, with an Update button', Boolean(latest) && await js(`[...document.querySelectorAll('.dialog button')].some((b) => b.textContent === 'Update to ${latest}')`), await js(note));
      await shot('1-available');

      await js("[...document.querySelectorAll('.dialog button')].find((b) => b.textContent.startsWith('Update to')).click(); true");
      await until('the download', "Boolean(document.querySelector('.set-progress'))", 30000);
      await wait(1500);
      check('the download shows its progress', /Downloading .*%/.test(await js(note)), await js(note));
      await shot('2-downloading');
      await until('the update', `/Updated to/.test(${note})`, 10 * 60 * 1000);
      await wait(600);
      await shot('3-ready');

      const file = path.join(profile, 'claude-code', latest, process.platform === 'win32' ? 'claude.exe' : 'claude');
      check('the new build is in the profile', fs.existsSync(file), file);
      check('nothing half-done is left behind', fs.readdirSync(path.join(profile, 'claude-code')).every((n) => !n.startsWith('.')), fs.readdirSync(path.join(profile, 'claude-code')).join(', '));
      check('a toast says new sessions use it', await js(`[...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('${latest}'))`));
      const { resolveClaude } = require('../../src/main/claude-binary');
      check('new sessions start it', resolveClaude('').file === file, resolveClaude('').file);
      await until('the executable row to report it', `/Claude Code ${latest.replace(/\./g, '\\.')}/.test([...document.querySelectorAll('.dialog .set-note')].map((n) => n.textContent).join(' '))`, 60000);
      await js("[...document.querySelectorAll('.dialog button')].find((b) => b.textContent === 'Check for updates').click(); true");
      await until('up to date', `/the newest/.test(${note})`, 30000);
      await shot('4-up-to-date');
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
