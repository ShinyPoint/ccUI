// Check of the Changes panel (the files a turn changed, at the right of a chat), without API usage: Claude is
// scripted (intro-video/fakes.js) and edits real files in a throwaway project. Screenshots in dist/changes-check/.
// Usage: npx vite build && npx electron scripts/changes-check.js   (add --dark for the dark theme)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const { install, applyEdit, applyWrite } = require('./intro-video/fakes');

const outDir = path.join(__dirname, '..', 'dist', 'changes-check');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ccui-changes-profile-'));
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccui-changes-project-'));
const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'ccui-changes-elsewhere-'));
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.join(project, 'src'));
const LIMITER = Array.from({ length: 60 }, (_, i) => `// line ${i + 1}`);
LIMITER[29] = 'export const LIMIT = 10;';
fs.writeFileSync(path.join(project, 'src', 'limiter.js'), `${LIMITER.join('\n')}\n`);
fs.writeFileSync(path.join(elsewhere, 'notes.txt'), 'old note\n');

install({
  histories: [],
  transcripts: new Map(),
  script: () => async (c) => {
    await c.think(150);
    await c.tool('Read', { file_path: c.file('src/limiter.js') }, { run: 100 });
    await c.tool('Edit', { file_path: c.file('src/limiter.js'), old_string: 'export const LIMIT = 10;', new_string: 'export const LIMIT = 50;\nexport const WINDOW_MS = 60_000;' },
      { run: 120, effect: applyEdit });
    await c.tool('Write', { file_path: c.file('src/limiter.test.js'), content: "import { LIMIT } from './limiter.js';\n\ntest('limit', () => expect(LIMIT).toBe(50));\n" },
      { run: 120, effect: applyWrite });
    const outside = path.join(elsewhere, 'notes.txt');
    await c.tool('Edit', { file_path: outside, old_string: 'old note', new_string: 'new note' }, { run: 80, effect: applyEdit });
    await c.say('Raised the limit to 50, added a window, and a test for it.', { cps: 700 });
    c.finish(0.02);
  },
  prompt: () => 'PS ~> ',
  shell: () => '',
  cli: () => '',
});

const THEME = process.argv.includes('--dark') ? 'dark' : 'light';
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  theme: THEME, confirmClose: false, notify: false, recent: [{ path: project, at: Date.now() }], trustedFolders: [project],
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
  const shot = async (name) => fs.writeFileSync(path.join(outDir, `${name}-${THEME}.png`), (await win.webContents.capturePage()).toPNG());
  const until = async (label, condition, timeout = 20000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await js(condition).catch(() => false)) return true;
      await wait(100);
    }
    check(`waiting for ${label}`, false, 'timeout');
    return false;
  };
  const files = "[...document.querySelectorAll('.side-files button')].map((b) => b.querySelector('.sf-name').textContent + ' ' + b.querySelector('.diffstat').textContent.replace(/\\s+/g, ' '))";
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });

  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(1200);
      await js("document.querySelector('.empty-recent .primary-btn').click(); true");
      await until('chat ready', "Boolean(document.querySelector('.chat-composer .composer-input'))");
      await wait(600);
      await js(`{ const el = document.querySelector('.chat-composer .composer-input');
        el.value = 'Raise the rate limit'; el.dispatchEvent(new Event('input', { bubbles: true })); } true`);
      await wait(80);
      await js("document.querySelector('.chat-composer .composer-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); true");
      await until('the turn to end', "Boolean(document.querySelector('.ws-files'))");
      const chip = await js("document.querySelector('.ws-files').textContent");
      check('the turn summary has a chip with the files it changed', /3 files/.test(chip) && /\+\d+/.test(chip), chip);

      await js("document.querySelector('.ws-files').click(); true");
      await until('the panel', "Boolean(document.querySelector('.side-panel .side-files'))");
      await wait(400);
      const listed = JSON.parse(await js(`JSON.stringify(${files})`));
      check('the panel lists the files of that turn', listed.length === 3 && /^limiter\.js \+2 −1/.test(listed[0]) && /^limiter\.test\.js \+3 −0/.test(listed[1]), JSON.stringify(listed));
      check('a new file is marked new', await js("[...document.querySelectorAll('.side-files button')][1].textContent.includes('new')"));
      check('the chat makes room for it', await js(`{ const c = document.querySelector('.chat').getBoundingClientRect(); const p = document.querySelector('.side-panel').getBoundingClientRect();
        Math.abs(c.right - p.left) < 2 }`));
      check('Changes shows the diff', await js("document.querySelectorAll('.side-file-body .diff-line.add').length === 2 && document.querySelectorAll('.side-file-body .diff-line.del').length === 1"));
      await shot('1-changes');

      await js("[...document.querySelectorAll('.side-file-head .segmented label')].find((l) => l.textContent === 'File').click(); true");
      await until('the file', "Boolean(document.querySelector('.file-view'))", 5000);
      const marked = await js("JSON.stringify([...document.querySelectorAll('.fv-line.added .ln')].map((n) => n.textContent))");
      check('File shows the file now, with the lines the turn added marked', marked === '["30","31"]', marked);
      check('with its syntax colored', await js("Boolean(document.querySelector('.file-view .hljs-keyword'))"));
      await shot('2-file');

      await js("[...document.querySelectorAll('.side-files button')][2].click(); true");
      await wait(500);
      const note = await js("document.querySelector('.side-file-body').textContent");
      check('a file outside the project is not read', /outside the project/.test(note), note.slice(0, 80));

      // Resize: drag the left edge 120px to the left; the width is kept.
      const edge = JSON.parse(await js("JSON.stringify((() => { const r = document.querySelector('.side-resize').getBoundingClientRect(); return { x: r.left + 3, y: r.top + 300, w: document.querySelector('.side-panel').getBoundingClientRect().width }; })())"));
      win.webContents.sendInputEvent({ type: 'mouseMove', x: edge.x, y: edge.y });
      win.webContents.sendInputEvent({ type: 'mouseDown', x: edge.x, y: edge.y, button: 'left', clickCount: 1 });
      for (let i = 1; i <= 10; i++) {
        win.webContents.sendInputEvent({ type: 'mouseMove', x: edge.x - i * 12, y: edge.y, button: 'left' });
        await wait(30);
      }
      win.webContents.sendInputEvent({ type: 'mouseUp', x: edge.x - 120, y: edge.y, button: 'left', clickCount: 1 });
      await wait(400);
      const width = await js("Math.round(document.querySelector('.side-panel').getBoundingClientRect().width)");
      const saved = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).sidePanelWidth;
      check('the panel resizes and remembers its width', Math.abs(width - (edge.w + 120)) < 4 && Math.abs(saved - width) < 4, `${edge.w} → ${width}, saved ${saved}`);

      // Close, then the file name in an Edit card opens that file.
      await js("document.querySelector('.side-head .icon-btn[aria-label=\"Close\"]').click(); true");
      await wait(300);
      check('it closes', await js("!document.querySelector('.side-panel')"));
      await js("document.querySelector('.work-summary').click(); true");
      await wait(500);
      await js("[...document.querySelectorAll('.tool-target.file-link')].find((t) => t.textContent.includes('limiter.test.js')).click(); true");
      await until('the panel again', "Boolean(document.querySelector('.side-files button.on'))", 5000);
      check('a file name in a card opens that file', /limiter\.test\.js/.test(await js("document.querySelector('.side-files button.on').textContent")));
      // The top bar button and the shortcut toggle it.
      await js("document.querySelector('.changes-toggle').click(); true");
      await wait(300);
      check('the top bar button hides it', await js("!document.querySelector('.side-panel')"));
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'D', modifiers: process.platform === 'darwin' ? ['meta', 'shift'] : ['control', 'shift'] });
      await wait(400);
      check('the shortcut shows it', await js("Boolean(document.querySelector('.side-panel'))"));
      await shot('3-from-card');
    } catch (err) {
      console.error('failed:', err);
      failures++;
    }
    console.log(failures ? `${failures} problem(s)` : 'all checks passed');
    process.exitCode = failures ? 1 : 0;
    app.quit();
  });
});

require('../src/main/main.js');
