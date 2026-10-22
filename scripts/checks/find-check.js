// End-to-end check of Find in chat (Ctrl+F) and the project search (Ctrl+Shift+F). Launches the built app
// with a throwaway profile and project, has one short chat on Haiku, then drives the shortcuts and saves
// screenshots. Usage: npx vite build && npx electron scripts/checks/find-check.js (writes dist/find-check/*.png)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const { tempDir } = require('./temp');

const outDir = path.join(__dirname, '..', '..', 'dist', 'find-check');
const profile = tempDir('find-profile');
const project = tempDir('find-project');
const other = tempDir('other-folder');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  language: 'en', uiScale: 100, theme: 'dark', confirmClose: false, notify: false, defaultModel: 'haiku', defaultPermissionMode: 'default',
  recent: [{ path: project, at: Date.now() }, { path: other, at: Date.now() - 1000 }],
  trustedFolders: [project],
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
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => fs.writeFileSync(path.join(outDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const until = async (label, condition, timeout = 90000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await js(condition).catch(() => false)) return true;
      await wait(300);
    }
    check(`waiting for ${label}`, false, 'timeout');
    return false;
  };
  const key = (k, mods = {}) => js(`(document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown',
    { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true, ...${JSON.stringify(mods)} })); true`);
  const type = (selector, text) => js(`{
    const el = document.querySelector(${JSON.stringify(selector)});
    el.value = ${JSON.stringify(text)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } true`);
  const text = (selector) => js(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
  const busy = "Boolean(document.querySelector('.send-btn.stop') || document.querySelector('.activity'))";
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });

  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(1200);
      await js("document.querySelector('.empty-recent .primary-btn').click()");
      await until('chat ready', "Boolean(document.querySelector('.chat-composer .composer-input'))");
      await wait(3000);
      await type('.chat-composer .composer-input', 'Reply with exactly this line and nothing else: banana apple banana cherry banana');
      await wait(80);
      await js("document.querySelector('.chat-composer .composer-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); true");
      await until('the reply', `!${busy} && /cherry/.test([...document.querySelectorAll('.msg-text')].at(-1)?.textContent || '')`);
      await wait(500);

      // Find in chat
      await key('f', { ctrlKey: true });
      await wait(200);
      check('Ctrl+F opens the find bar', await js("Boolean(document.querySelector('.find-bar'))"));
      check('the find box has the focus', await js("document.activeElement === document.querySelector('.find-bar input')"));
      await type('.find-bar input', 'BANANA');
      await wait(200);
      const count = await text('.find-count');
      const marks = await js("CSS.highlights.get('find')?.size ?? 0");
      check('matches are counted and highlighted, ignoring case', /^\d+\/6$/.test(count) && marks === 6, `${count}, ${marks} highlighted`);
      const at = (c) => Number(c.split('/')[0]);
      const first = at(count);
      await key('Enter');
      await wait(100);
      check('Enter goes to the next match', at(await text('.find-count')) === (first % 6) + 1, await text('.find-count'));
      await key('Enter', { shiftKey: true });
      await wait(100);
      check('Shift+Enter goes back', at(await text('.find-count')) === first, await text('.find-count'));
      check('the current match is highlighted on its own', await js("CSS.highlights.get('find-current')?.size === 1"));
      await shot('1-find-in-chat');
      await type('.find-bar input', 'no such words here');
      await wait(150);
      check('no matches says so', (await text('.find-count')) === 'No results', await text('.find-count'));
      await key('Escape');
      await wait(150);
      check('Esc closes the bar and clears the highlights',
        await js("!document.querySelector('.find-bar') && !CSS.highlights.has('find')"));
      check('the message box gets the focus back', await js("document.activeElement?.classList.contains('composer-input')"));
      await key('f', { ctrlKey: true });
      await wait(200);
      check('reopening keeps the last search', (await js("document.querySelector('.find-bar input').value")) === 'no such words here');
      await key('Escape');

      // Project search
      const name = await text('.session-name'); // the chat is named after its first message by now
      await key('F', { ctrlKey: true, shiftKey: true });
      await wait(200);
      check('Ctrl+Shift+F opens the project search', await js("document.activeElement === document.querySelector('.project-search input')"));
      const folders = () => js("[...document.querySelectorAll('.folder-name')].map((e) => e.textContent)");
      check('both folders listed before typing', (await folders()).length === 2, JSON.stringify(await folders()));
      await type('.project-search input', 'OTHER-fold');
      await wait(150);
      check('typing filters by folder name', JSON.stringify(await folders()) === JSON.stringify([path.basename(other)]), JSON.stringify(await folders()));
      await shot('2-project-search');
      await type('.project-search input', name.slice(0, 12).toUpperCase());
      await wait(150);
      check('a session name matches too', JSON.stringify(await folders()) === JSON.stringify([path.basename(project)])
        && (await js("document.querySelectorAll('.session').length")) === 1, `${name}: ${JSON.stringify(await folders())}`);
      await type('.project-search input', 'zzzz');
      await wait(150);
      check('no match says so', /No projects/.test(await text('.sidebar-hint')), await text('.sidebar-hint'));
      await key('Escape');
      await wait(150);
      check('Esc clears the search', !(await js("document.querySelector('.project-search')")) && (await folders()).length === 2);

      // Ctrl+F from the sidebar searches the projects
      await js("document.querySelector('.folder-main').focus(); true");
      await key('f', { ctrlKey: true });
      await wait(200);
      check('Ctrl+F in the sidebar opens the project search', await js("document.activeElement === document.querySelector('.project-search input') && !document.querySelector('.find-bar')"));
      await key('Escape');
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
