// End-to-end check of the built-in Claude Code's downloads (Settings → Claude Code → Updates), without API usage
// but with two real downloads from the npm registry (about 135 MB each). The app is made to believe it was
// installed without Claude Code, as the installers are: the newest one is downloaded at launch and a new chat
// waits for it, showing how far along it is, then starts. Then Settings picks an older version from the list (a
// second download), a typed one, and goes back to Newest. Screenshots in dist/update-check/.
// Starting the chat starts the real Claude Code, without sending it anything.
// Usage: npx vite build && npx electron scripts/checks/update-check.js
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { tempDir } = require('./temp');

const outDir = path.join(__dirname, '..', '..', 'dist', 'update-check');
const profile = tempDir('update-profile');
const project = tempDir('update-project');
const downloads = path.join(profile, 'claude-code');
const EXE = process.platform === 'win32' ? 'claude.exe' : 'claude';
fs.mkdirSync(outDir, { recursive: true });

// The build the Agent SDK ships (claude-binary.js shipped()) isn't there, as in an installed app.
const realExists = fs.existsSync;
fs.existsSync = function existsSync(file, ...rest) {
  if (typeof file === 'string' && /claude-agent-sdk-[^\\/]+[\\/]claude(\.exe)?$/.test(file)) return false;
  return realExists.call(fs, file, ...rest);
};

// Automatic updates off, so only what the script does downloads anything (the default, on, is checked below).
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  language: 'en', theme: 'light', confirmClose: false, notify: false, autoUpdateClaude: false,
  trustedFolders: [project], recent: [{ path: project, at: Date.now() }],
}));
app.setPath('userData', profile);
const saved = () => JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

app.on('browser-window-created', (_e, win) => {
  win.setSize(1320, 860);
  win.webContents.setBackgroundThrottling(false); // behind other windows, its animations and timers keep time
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
  const row = (label) => `[...document.querySelectorAll('.dialog .set-row')].find((r) => r.querySelector('.set-label')?.textContent === ${JSON.stringify(label)})`;
  const note = `(${row('Built-in Claude Code')}?.querySelector('.set-note')?.textContent || '')`;
  const toasts = "[...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ')";
  const openVersions = async () => {
    await js(`${row('Version')}.querySelector('.menu-button').click(); true`);
    // The list arrives from npm a moment after Settings opens; the open menu fills in then.
    await until('the list of versions', `${row('Version')}?.querySelectorAll('.menu-list button').length > 2`, 30000);
    await wait(250);
  };
  const choose = async (label) => {
    await openVersions();
    await js(`[...${row('Version')}.querySelectorAll('.menu-list button')].find((b) => b.querySelector('.menu-label').textContent === ${JSON.stringify(label)}).click(); true`);
    await wait(300);
  };
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });

  win.webContents.once('did-finish-load', async () => {
    try {
      const { Settings } = require('../../src/main/settings');
      const fresh = new Settings(tempDir('update-fresh')).get();
      check('automatic updates are on by default, for the newest version', fresh.autoUpdateClaude === true && fresh.claudeVersion === '');

      // Nothing to start sessions with: the download starts at launch, before any session asks.
      let downloading = false;
      for (let i = 0; i < 100 && !downloading; i++) {
        downloading = realExists(downloads) && fs.readdirSync(downloads).some((n) => n.startsWith('.download-'));
        if (!downloading) await wait(150);
      }
      check('with no Claude Code at all, it is downloaded right after launch', downloading);

      // A new chat waits for it and says so.
      await js("document.querySelector('.empty-recent .primary-btn').click(); true");
      await until('the preparing card', "Boolean(document.querySelector('.chat .preparing'))");
      await until('its progress', "/Downloading Claude Code \\d+\\.\\d+\\.\\d+: [\\d.]+ MB of [\\d.]+ MB/.test(document.querySelector('.preparing-what')?.textContent || '')", 60000);
      const card = await js("document.querySelector('.chat .preparing').textContent");
      check('a new chat says Claude Code is downloaded once, and how far along it is', /first time it is used, once/.test(card), card);
      await shot('1-first-run');
      await until('the download to finish', `/Claude Code \\d+\\.\\d+\\.\\d+ is ready/.test(${toasts})`, 15 * 60 * 1000);
      const newest = fs.readdirSync(downloads).find((n) => /^\d+\.\d+\.\d+$/.test(n));
      check('it is unpacked into the profile', Boolean(newest) && realExists(path.join(downloads, newest, EXE)), fs.readdirSync(downloads).join(', '));
      check('a toast says it is ready', new RegExp(`${newest.replace(/\./g, '\\.')} is ready`).test(await js(toasts)), await js(toasts));
      await until('the card to go', "!document.querySelector('.chat .preparing')");
      await wait(4000);
      check('and the chat starts with it', await js("!document.querySelector('.problem') && Boolean(document.querySelector('.chat-composer .composer-input'))"),
        await js("document.querySelector('.problem')?.textContent || ''"));
      await shot('2-chat-started');

      // Settings: the version list, newest first, marking what is here.
      await js("[...document.querySelectorAll('.sidebar-bottom button')].find((b) => b.textContent.includes('Settings')).click(); true");
      await until('Settings', "Boolean(document.querySelector('.settings-nav'))");
      await js("[...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent.includes('Claude Code')).click(); true");
      await until('the Updates group', `Boolean(${note})`);
      check('it shows the version in use', new RegExp(newest.replace(/\./g, '\\.')).test(await js(note)), await js(note));
      check('Version: Newest', (await js(`${row('Version')}.querySelector('.menu-button').textContent`)) === 'Newest');
      await openVersions();
      const options = JSON.parse(await js(`JSON.stringify([...${row('Version')}.querySelectorAll('.menu-list button')].map((b) => [b.querySelector('.menu-label').textContent, b.querySelector('.menu-hint')?.textContent || '']))`));
      check('the list: Newest, ten recent versions, Other version…', options.length === 12 && options[0][0] === 'Newest' && options[11][0] === 'Other version…'
        && options.slice(1, 11).every(([v]) => /^\d+\.\d+\.\d+$/.test(v)), JSON.stringify(options.map(([v]) => v)));
      check('newest first, with the one here marked', options[1][0] === newest && /on this computer/.test(options[1][1]) && !/on this computer/.test(options[2][1]),
        JSON.stringify(options.slice(0, 3)));
      await shot('3-versions');
      await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
      await wait(300);

      // An older one: downloaded, then used, and automatic updates pause.
      const older = options[2][0];
      await choose(older);
      await until('its download', `/Downloading ${older.replace(/\./g, '\\.')}/.test(${note})`, 60000);
      await shot('4-downloading-older');
      await until('the older version', `/Version ${older.replace(/\./g, '\\.')} is ready/.test(${note})`, 15 * 60 * 1000);
      await wait(500);
      check('choosing an older version saves it once it is here', saved().claudeVersion === older, saved().claudeVersion);
      const { resolveClaude } = require('../../src/main/claude-binary');
      check('new sessions start that one', resolveClaude('', older).file === path.join(downloads, older, EXE), resolveClaude('', older).file);
      check('the menu shows it', (await js(`${row('Version')}.querySelector('.menu-button').textContent`)) === older);
      check('automatic updates are off while a version is chosen', await js(`${row('Update automatically')}.querySelector('input').disabled && !${row('Update automatically')}.querySelector('input').checked`));
      await js("[...document.querySelectorAll('.dialog button')].find((b) => b.textContent === 'Check for updates').click(); true");
      await until('the check', `/chosen below/.test(${note})`, 30000);
      check('a check names the newest without switching to it', new RegExp(`Version ${older.replace(/\./g, '\\.')}, chosen below\\. The newest is ${newest.replace(/\./g, '\\.')}`).test(await js(note)), await js(note));
      await shot('5-older-in-use');

      // Typed in: a version npm doesn't have is refused; one that is here is used without a download.
      await choose('Other version…');
      await until('the version field', "Boolean(document.querySelector('.set-version-other input'))");
      const type = async (text) => {
        await js(`{ const el = document.querySelector('.set-version-other input'); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); } true`);
        await wait(150);
        await js("[...document.querySelectorAll('.set-version-other button')].find((b) => b.textContent === 'Use').click(); true");
      };
      await type('0.0.1');
      const versionNote = `(${row('Version')}.querySelector('.set-note')?.textContent || '')`;
      await until('a refusal', `/no Claude Code 0\\.0\\.1/.test(${versionNote})`, 30000);
      check('a version npm doesn’t have is refused in the row, and nothing changes', saved().claudeVersion === older
        && await js(`Boolean(${row('Version')}.querySelector('.set-note .bad'))`), await js(versionNote));
      await shot('6-typed-missing');
      const before = fs.readdirSync(downloads).length;
      await type(newest);
      await until('the typed version', `${row('Version')}.querySelector('.menu-button').textContent === ${JSON.stringify(newest)}`, 30000);
      check('a typed version is used', saved().claudeVersion === newest && fs.readdirSync(downloads).length === before, saved().claudeVersion);

      // Back to Newest: updates resume.
      await choose('Newest');
      await until('Newest', `${row('Version')}.querySelector('.menu-button').textContent === 'Newest'`);
      await wait(300);
      check('back to Newest, nothing is pinned and automatic updates can be turned on', saved().claudeVersion === ''
        && await js(`!${row('Update automatically')}.querySelector('input').disabled`));
      await js("[...document.querySelectorAll('.dialog button')].find((b) => b.textContent === 'Check for updates').click(); true");
      await until('up to date', `/the newest/.test(${note})`, 30000);
      check('and the newest is the one in use', resolveClaude('', '').file === path.join(downloads, newest, EXE), await js(note));
      check('nothing half-done is left behind', fs.readdirSync(downloads).every((n) => !n.startsWith('.')), fs.readdirSync(downloads).join(', '));
      await shot('7-newest');
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
