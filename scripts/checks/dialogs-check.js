// Check of the app's own dialogs and the redesigned New session, without API usage (Claude is scripted, see
// fakes.js). A fresh profile: New session → the folder trust question (asked by the main process,
// shown in the window), the Bypass permissions confirmation, Settings, and quitting with a session running.
// Screenshots in dist/dialogs-check/.
// Usage: npx vite build && npx electron scripts/checks/dialogs-check.js   (add --dark for the dark theme)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const { tempDir } = require('./temp');
const { install } = require('./fakes');

const outDir = path.join(__dirname, '..', '..', 'dist', 'dialogs-check');
const profile = tempDir('dialogs-profile');
const project = tempDir('dialogs-project');
const other = tempDir('dialogs-other');
fs.mkdirSync(outDir, { recursive: true });

install({ histories: [], transcripts: new Map(), script: () => null, prompt: () => 'PS ~> ', shell: () => '', cli: () => '' });

const THEME = process.argv.includes('--dark') ? 'dark' : 'light';
// Not trusted yet, and quitting with sessions running asks first.
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  language: 'en', uiScale: 100, theme: THEME, confirmClose: true, notify: false,
  recent: [{ path: project, at: Date.now() }, { path: other, at: Date.now() - 1000 }],
  folders: { [project]: { collapsed: false } },
}));
app.setPath('userData', profile);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};
let finished = false;
const finish = () => {
  if (finished) return;
  finished = true;
  console.log(failures ? `${failures} problem(s)` : 'all checks passed');
  process.exitCode = failures ? 1 : 0;
};

app.on('browser-window-created', (_e, win) => {
  win.setSize(1320, 860);
  win.webContents.setBackgroundThrottling(false);
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => fs.writeFileSync(path.join(outDir, `${name}-${THEME}.png`), (await win.webContents.capturePage()).toPNG());
  const until = async (label, condition, timeout = 15000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await js(condition).catch(() => false)) return true;
      await wait(100);
    }
    check(`waiting for ${label}`, false, 'timeout');
    return false;
  };
  const confirmText = "document.querySelector('.dialog-confirm[open]')?.textContent || ''";
  const press = (label) => js(`[...document.querySelectorAll('.dialog-confirm[open] button')].find((b) => b.textContent === ${JSON.stringify(label)}).click(); true`);
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });
  win.on('closed', () => {
    check('confirming quits', true);
    finish();
  });

  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(1200);
      // A profile with nothing set: both window options are on (frosted glass, work area to the window's edge).
      check('by default the work area reaches the window’s edge and menus are frosted', await js("document.documentElement.classList.contains('fill-edge') && document.documentElement.classList.contains('frost')"));
      check('project folders start folded', await js("[...document.querySelectorAll('#sidebar .folder')].every((f) => f.classList.contains('collapsed'))"),
        await js("JSON.stringify([...document.querySelectorAll('#sidebar .folder')].map((f) => f.className))"));

      // New session
      await js("document.querySelector('#sidebar button.new-session').click(); true");
      await until('New session', "Boolean(document.querySelector('.dialog-new[open] .ns-recent'))");
      await wait(400);
      const look = JSON.parse(await js(`JSON.stringify({
        cards: document.querySelectorAll('.dialog-new .set-card').length,
        recents: document.querySelectorAll('.dialog-new .ns-recent').length,
        chosen: document.querySelector('.dialog-new .ns-recent.chosen .ns-recent-name')?.textContent,
        border: getComputedStyle(document.querySelector('.dialog-new')).borderTopWidth,
        cardBorder: getComputedStyle(document.querySelector('.dialog-new .set-card')).borderTopWidth,
        input: getComputedStyle(document.querySelector('.dialog-new input[type=text]')).borderTopWidth })`));
      check('New session is two cards of rows, with the recent folders as rows', look.cards === 2 && look.recents === 2, JSON.stringify(look));
      check('the chosen folder is checked', look.chosen === path.basename(project), look.chosen);
      check('and nothing has a border', look.border === '0px' && look.cardBorder === '0px' && look.input === '0px', JSON.stringify(look));
      await shot('1-new-session');
      await js("[...document.querySelectorAll('.dialog-new .segmented label')].find((l) => l.textContent === 'Pick one…').click(); true");
      await wait(500);
      await shot('1b-new-session-pick');
      await js("[...document.querySelectorAll('.dialog-new .segmented label')].find((l) => l.textContent === 'New').click(); true");
      await wait(200);
      await js("document.querySelector('.dialog-new .primary-btn[type=submit]').click(); true");

      // Folder trust, asked by the main process in the window
      await until('the trust question', `/Trust this folder\\?/.test(${confirmText})`);
      const trust = await js(confirmText);
      check('the trust question is the app’s dialog, with the folder', trust.includes(project), trust.slice(0, 80));
      check('Cancel has the focus', await js("document.activeElement?.textContent === 'Cancel'"));
      await wait(400);
      await shot('2-trust');
      await press('Trust this folder');
      await until('the chat', "Boolean(document.querySelector('.chat-composer .composer-input'))");
      check('trusting starts the chat', true);
      // Black is the default accent; the folder of the conversation on screen shows it, the others are faint.
      await wait(400);
      const accent = await js("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()");
      check('the default accent is black (white on dark)', /^#(000(000)?|fff(fff)?)$/i.test(accent), accent);
      const icons = JSON.parse(await js("JSON.stringify([...document.querySelectorAll('#sidebar .folder')].map((f) => ({ active: f.classList.contains('has-active'), color: getComputedStyle(f.querySelector('.folder-icon')).color })))"));
      const mine = icons.find((i) => i.active);
      check('the current conversation’s folder icon is in the accent color, the others are not', Boolean(mine) && /rgb\((0, 0, 0|255, 255, 255)\)/.test(mine.color)
        && icons.filter((i) => !i.active).every((i) => i.color !== mine.color), JSON.stringify(icons));
      check('and is remembered', JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).trustedFolders?.length === 1);

      // Bypass permissions asks first
      await wait(800);
      await js("document.querySelector('.mode-menu .menu-button').click(); true");
      await until('the permission menu', "[...document.querySelectorAll('.mode-menu [role=option]')].some((b) => b.textContent.includes('Bypass'))", 5000);
      await js("[...document.querySelectorAll('.mode-menu [role=option]')].find((b) => b.textContent.includes('Bypass')).click(); true");
      await until('the bypass question', `/Bypass permissions\\?/.test(${confirmText})`);
      check('the bypass question is red, with Cancel focused', await js("Boolean(document.querySelector('.dialog-confirm[open] .danger-btn')) && document.activeElement?.textContent === 'Cancel'"));
      await wait(400);
      await shot('3-bypass');
      await js("document.querySelector('.dialog-confirm[open]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.querySelector('.dialog-confirm[open]')?.close(); true");
      await wait(400);
      check('Esc keeps the mode', !/Bypass/.test(await js("document.querySelector('.mode-menu .menu-button').textContent")));

      // Tooltips are the app's own: hover a button with a hint and a rounded label shows it, no system tooltip.
      const hover = async (selector) => {
        const p = JSON.parse(await js(`JSON.stringify((() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`));
        win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(p.x) - 3, y: Math.round(p.y) });
        win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(p.x), y: Math.round(p.y) });
      };
      const shown = "(() => { const t = document.querySelector('.tooltip'); return t && t.matches(':popover-open') ? t.textContent : ''; })()";
      await hover('#sidebar .sidebar-top .icon-btn');
      if (!(await until('a tooltip', `Boolean(${shown})`, 3000))) {
        console.log('state', await js(`JSON.stringify({ dialog: document.querySelector('dialog[open]')?.className || null, focus: document.hasFocus(),
          under: (() => { const r = document.querySelector('#sidebar .sidebar-top .icon-btn').getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e && (e.className?.baseVal ?? e.className); })(),
          popover: document.querySelector('.tooltip').matches(':popover-open') })`));
      }
      const tip = JSON.parse(await js(`JSON.stringify({ text: ${shown}, radius: getComputedStyle(document.querySelector('.tooltip')).borderRadius,
        title: document.querySelector('#sidebar .sidebar-top .icon-btn').hasAttribute('title'), label: document.querySelector('#sidebar .sidebar-top .icon-btn').getAttribute('aria-label') })`));
      check('hovering a button shows the app’s tooltip, not the system’s', tip.text === 'Hide sidebar' && !tip.title && tip.label === 'Hide sidebar', JSON.stringify(tip));
      await wait(200);
      await shot('6-tooltip');
      if (process.platform !== 'darwin') {
        // Window buttons drawn by the app, with the same tooltips and corners.
        const btns = await js("JSON.stringify([...document.querySelectorAll('.window-controls .win-btn')].map((b) => [b.dataset.tip || b.title, getComputedStyle(b).borderRadius]))");
        check('the window has its own minimize, maximize and close buttons', /Minimize.*Maximize.*Close/.test(btns) && JSON.parse(btns).every(([, r]) => r === tip.radius), btns);
        await hover('.window-controls .win-btn');
        await until('the Minimize tooltip', `${shown} === 'Minimize'`, 3000);
        await wait(200);
        await shot('7-window-tooltip');
        await js("document.querySelectorAll('.window-controls .win-btn')[1].click(); true");
        await wait(700);
        check('Maximize maximizes, and the button turns into Restore', win.isMaximized() && await js("document.querySelectorAll('.window-controls .win-btn')[1].getAttribute('aria-label') === 'Restore' || document.querySelectorAll('.window-controls .win-btn')[1].dataset.tip === 'Restore' || document.querySelectorAll('.window-controls .win-btn')[1].title === 'Restore'"));
        await js("document.querySelectorAll('.window-controls .win-btn')[1].click(); true");
        await wait(700);
        check('and Restore brings it back', !win.isMaximized());
      }

      // Settings
      await js("[...document.querySelectorAll('.sidebar-bottom button')].find((b) => b.textContent.includes('Settings')).click(); true");
      await until('Settings', "Boolean(document.querySelector('.settings-nav'))");
      await wait(300);
      check('Settings cards and fields have no borders', await js(`[...document.querySelectorAll('.dialog-settings .set-card, .dialog-settings .dropdown > .menu-button, .dialog-settings')]
        .every((el) => getComputedStyle(el).borderTopWidth === '0px') && getComputedStyle(document.querySelector('.settings-nav')).borderRightWidth === '0px'`));
      await shot('4-settings');
      await js("[...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent.includes('Claude Code')).click(); true");
      await wait(300);
      await shot('4b-settings-claude');
      await js("document.querySelector('.settings-head .primary-btn').click(); true");
      await wait(300);

      // Quitting with a session running
      win.close();
      await until('the quit question', `/1 session is still running/.test(${confirmText})`);
      await wait(400);
      await shot('5-quit');
      await press('Cancel');
      await wait(500);
      check('Cancel keeps the window', !win.isDestroyed() && BrowserWindow.getAllWindows().length === 1);
      win.close();
      await until('the quit question again', `/still running/.test(${confirmText})`);
      await press('End sessions and quit');
      setTimeout(() => { check('the window closed after confirming', false); finish(); app.exit(1); }, 5000);
    } catch (err) {
      console.error('failed:', err);
      failures++;
      finish();
      app.exit(1);
    }
  });
});

require('../../src/main/main.js');
