// Check of the Changes panel (the files a turn changed, at the right of a chat), without API usage: Claude is
// scripted (fakes.js) and edits real files in a throwaway project. Screenshots in dist/changes-check/.
// Usage: npx vite build && npx electron scripts/checks/changes-check.js   (add --dark for the dark theme)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, clipboard } = require('electron');
const { tempDir } = require('./temp');
const { install, applyEdit, applyWrite } = require('./fakes');

const outDir = path.join(__dirname, '..', '..', 'dist', 'changes-check');
const profile = tempDir('changes-profile');
const project = tempDir('changes-project');
const elsewhere = tempDir('changes-elsewhere');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.join(project, 'src'));
const LIMITER = Array.from({ length: 60 }, (_, i) => `// line ${i + 1}`);
LIMITER[29] = 'export const LIMIT = 10;';
// A line much wider than the panel, so the file scrolls sideways.
LIMITER[4] = `// ${'a long comment that runs on and on '.repeat(8)}`;
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
    await c.tool('Bash', { command: 'npm run lint', description: 'Lint' }, { run: 80, result: 'lint: 2 problems', fail: true });
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
  language: 'en', theme: THEME, confirmClose: false, notify: false, recent: [{ path: project, at: Date.now() }], trustedFolders: [project],
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
  // The turn's files are in the menu under the file name in the panel's header.
  const openFiles = async () => {
    if (!(await js("Boolean(document.querySelector('.side-files .menu-list'))"))) await js("document.querySelector('.side-files .menu-button').click(); true");
    await until('the file menu', "Boolean(document.querySelector('.side-files .menu-list'))", 3000);
  };
  const files = async () => {
    await openFiles();
    const list = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.side-files .menu-list button')].map((b) => b.querySelector('.sf-option').textContent.replace(/\\s+/g, ' ')))`));
    await js("document.querySelector('.side-files .menu-button').click(); true");
    await wait(150);
    return list;
  };
  const pickFile = async (i) => {
    await openFiles();
    await js(`document.querySelectorAll('.side-files .menu-list button')[${i}].click(); true`);
    await wait(400);
  };
  const shownFile = "document.querySelector('.side-head .sf-name').textContent";
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

      // It slides in from the right while the chat narrows: sample both during the first frames.
      const slide = await js(`new Promise((done) => {
        document.querySelector('.ws-files').click();
        const out = []; const t0 = performance.now();
        const f = () => { const p = document.querySelector('.side-panel'); const c = document.querySelector('.chat');
          if (p) out.push(Math.round(new DOMMatrix(getComputedStyle(p).transform).m41) + ':' + Math.round(innerWidth - c.getBoundingClientRect().right));
          if (performance.now() - t0 < 450) requestAnimationFrame(f); else done(out); };
        requestAnimationFrame(f); })`);
      const steps = slide.map((v) => v.split(':').map(Number));
      check('the panel slides in while the chat makes room', steps.some(([x]) => x > 20 && x < 400) && steps.at(-1)[0] === 0
        && steps.some(([, r]) => r > 20 && r < steps.at(-1)[1] - 20), slide.filter((v, i) => v !== slide[i - 1]).slice(0, 12).join(' '));
      await until('the panel', "Boolean(document.querySelector('.side-panel .side-files'))");
      await wait(400);
      check('the panel shows the first file, named in its header', (await js(shownFile)) === 'limiter.js', await js(shownFile));
      const listed = await files();
      check('the file name opens a menu of the turn’s files with their counts', listed.length === 3 && /^limiter\.js ?\+2 −1/.test(listed[0]) && /^limiter\.test\.js ?new ?\+3 −0/.test(listed[1]), JSON.stringify(listed));
      check('a new file is marked new', /new/.test(listed[1]));
      check('the chat makes room for it', await js(`{ const c = document.querySelector('.chat').getBoundingClientRect(); const p = document.querySelector('.side-panel').getBoundingClientRect();
        Math.abs(c.right - p.left) < 2 }`));
      check('Changes shows the diff', await js("document.querySelectorAll('.side-file-body .diff-line.add').length === 2 && document.querySelectorAll('.side-file-body .diff-line.del').length === 1"));
      check('the diff doesn’t scroll by itself: the panel does', await js("getComputedStyle(document.querySelector('.side-file-body .diff')).overflowX === 'visible'"));
      await shot('1-changes');
      await openFiles();
      await wait(200);
      await shot('1b-file-menu');
      await js("document.querySelector('.side-files .menu-button').click(); true");
      await wait(150);
      // A new file's diff has no old line numbers: that column takes no room, so the code starts near the edge.
      await pickFile(1);
      const gutter = JSON.parse(await js(`JSON.stringify((() => { const b = document.querySelector('.side-file-body').getBoundingClientRect();
        const line = document.querySelector('.side-file-body .diff-line'); return { noOld: Boolean(document.querySelector('.side-file-body .diff.no-old')),
          code: Math.round(line.querySelector('code').getBoundingClientRect().left - b.left), num: Math.round(line.querySelectorAll('.ln')[1].getBoundingClientRect().left - b.left) }; })())`));
      check('a new file’s diff has no empty old-number column', gutter.noOld && gutter.code < 50 && gutter.num < 8, JSON.stringify(gutter));
      await shot('1c-new-file');
      await pickFile(0);

      await js("[...document.querySelectorAll('.side-bar .segmented label')].find((l) => l.textContent === 'File').click(); true");
      await until('the file', "Boolean(document.querySelector('.file-view'))", 5000);
      const marked = await js("JSON.stringify([...document.querySelectorAll('.fv-line.added .ln')].map((n) => n.textContent))");
      check('File shows the file now, with the lines the turn added marked', marked === '["30","31"]', marked);
      check('with its syntax colored', await js("Boolean(document.querySelector('.file-view .hljs-keyword'))"));
      await shot('2-file');

      // One scroller for both directions: the sideways scrollbar is at the panel's bottom, wherever it is scrolled to.
      const body = "document.querySelector('.side-file-body')";
      const box = JSON.parse(await js(`JSON.stringify((() => { const b = ${body}; const p = document.querySelector('.side-panel').getBoundingClientRect(); const r = b.getBoundingClientRect();
        return { wide: b.scrollWidth > b.clientWidth + 50, tall: b.scrollHeight > b.clientHeight, own: getComputedStyle(document.querySelector('.file-view')).overflowX, bottom: Math.round(p.bottom - r.bottom) }; })())`));
      check('the file scrolls sideways in the panel itself, its scrollbar at the panel’s bottom edge', box.wide && box.tall && box.own === 'visible' && box.bottom <= 1, JSON.stringify(box));
      const before = JSON.parse(await js(`JSON.stringify((() => { const l = document.querySelectorAll('.fv-line')[10]; return { ln: l.querySelector('.ln').getBoundingClientRect().left, code: l.querySelector('code').getBoundingClientRect().left }; })())`));
      await js(`{ const b = ${body}; b.scrollTop = 300; b.scrollLeft = 200; } true`);
      await wait(150);
      const after = JSON.parse(await js(`JSON.stringify((() => { const l = document.querySelectorAll('.fv-line')[10]; return { ln: l.querySelector('.ln').getBoundingClientRect().left, code: l.querySelector('code').getBoundingClientRect().left }; })())`));
      check('scrolled sideways, the line numbers stay and the code moves', Math.abs(after.ln - before.ln) < 1 && Math.abs(before.code - after.code - 200) < 2, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      await shot('2b-scrolled');
      // Wrap lines: nothing scrolls sideways; remembered.
      await js("document.querySelector('.side-wrap').click(); true");
      await wait(300);
      check('Wrap lines folds long lines: no sideways scroll', await js(`{ const b = ${body}; b.scrollWidth <= b.clientWidth + 1 }`));
      check('and it is remembered', JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).sidePanelWrap === true);
      await shot('2c-wrap');
      await js("document.querySelector('.side-wrap').click(); true");
      await wait(300);
      // Copy: the whole file.
      clipboard.writeText('');
      await js("document.querySelector('.side-head .icon-btn[title=\"Copy the file\"], .side-head .icon-btn[data-tip=\"Copy the file\"]').click(); true");
      await wait(200);
      const copied = await clipboard.readText();
      check('Copy puts the file on the clipboard', copied === fs.readFileSync(path.join(project, 'src', 'limiter.js'), 'utf8'), `${copied.length} chars`);
      await js(`{ const b = ${body}; b.scrollTop = 0; b.scrollLeft = 0; } true`);

      await pickFile(2);
      const note = await js("document.querySelector('.side-file-body').textContent");
      check('a file outside the project is not read', /outside the project/.test(note), note.slice(0, 80));

      // The diff and the file can be copied: a drag over the File view takes code, not line numbers.
      await pickFile(0);
      await until('the file again', "document.querySelectorAll('.fv-line code').length > 30", 5000);
      const fileBox = JSON.parse(await js("JSON.stringify((() => { const l = [...document.querySelectorAll('.fv-line code')]; const a = l[28].getBoundingClientRect(); const b = l[30].getBoundingClientRect(); return { x1: a.left + 2, y1: a.top + a.height / 2, x2: b.right - 2, y2: b.top + b.height / 2 }; })())"));
      await js('getSelection().removeAllRanges(); true');
      win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(fileBox.x1), y: Math.round(fileBox.y1) });
      win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(fileBox.x1), y: Math.round(fileBox.y1), button: 'left', clickCount: 1 });
      await wait(80);
      for (let i = 1; i <= 10; i++) {
        win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(fileBox.x1 + ((fileBox.x2 - fileBox.x1) * i) / 10), y: Math.round(fileBox.y1 + ((fileBox.y2 - fileBox.y1) * i) / 10), button: 'left' });
        await wait(40);
      }
      win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(fileBox.x2), y: Math.round(fileBox.y2), button: 'left', clickCount: 1 });
      await wait(200);
      const picked = await js('getSelection().toString()');
      check('the file can be selected for copying, without its line numbers', /export const LIMIT = 50/.test(picked) && !/^\s*30/m.test(picked), JSON.stringify(picked));
      check('its scrollbar shows without hovering', await js("getComputedStyle(document.querySelector('.side-file-body'), '::-webkit-scrollbar-thumb').backgroundColor !== 'rgba(0, 0, 0, 0)'"),
        await js("getComputedStyle(document.querySelector('.side-file-body'), '::-webkit-scrollbar-thumb').backgroundColor"));

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
      // A smaller window: the panel gives way so the chat keeps room, and the message box still fits, its send
      // button in view (it used to run under the panel); the width chosen comes back with the room.
      for (const size of [900, 760]) {
        win.setSize(size, 860);
        await wait(600);
        const narrow = JSON.parse(await js(`JSON.stringify((() => { const r = (q) => document.querySelector(q).getBoundingClientRect();
          const bar = document.querySelector('.composer-bar'); const box = r('.chat-composer'); const send = r('.chat-composer .send-btn');
          return { chat: Math.round(r('.chat').width), panel: Math.round(r('.side-panel').width), over: bar.scrollWidth - bar.clientWidth,
            send: send.left >= box.left && send.right <= box.right, chip: r('.ws-files').right <= r('.chat').right }; })())`));
        check(`in a ${size}px window the panel gives way and the message box still fits`, narrow.panel < width && narrow.chat >= 260 && narrow.over <= 0 && narrow.send && narrow.chip, JSON.stringify(narrow));
      }
      await shot('2d-narrow');
      win.setSize(1320, 860);
      await wait(600);
      check('the width chosen comes back with the room', Math.abs((await js("document.querySelector('.side-panel').getBoundingClientRect().width")) - width) < 4);

      // Close, then the file name in an Edit card opens that file.
      await js("document.querySelector('.side-head .icon-btn[aria-label=\"Close\"]').click(); true");
      await wait(80);
      const leaving = await js("Math.round(new DOMMatrix(getComputedStyle(document.querySelector('.side-panel')).transform).m41)");
      await wait(400);
      check('it slides out, then goes', leaving > 0 && await js("!document.querySelector('.side-panel')"), `x ${leaving}px after 80ms`);
      await js("document.querySelector('.work-summary').click(); true");
      await wait(500);
      await js("[...document.querySelectorAll('.tool-target.file-link')].find((t) => t.textContent.includes('limiter.test.js')).click(); true");
      await until('the panel again', "Boolean(document.querySelector('.side-panel .side-head .sf-name'))", 5000);
      await wait(300);
      check('a file name in a card opens that file', /limiter\.test\.js/.test(await js(shownFile)), await js(shownFile));
      // The top bar button and the shortcut toggle it.
      await js("document.querySelector('.changes-toggle').click(); true");
      await wait(450);
      check('the top bar button hides it', await js("!document.querySelector('.side-panel')"));
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'D', modifiers: process.platform === 'darwin' ? ['meta', 'shift'] : ['control', 'shift'] });
      await wait(400);
      check('the shortcut shows it', await js("Boolean(document.querySelector('.side-panel'))"));
      await shot('3-from-card');
      // Steps show glyphs, not verbs: done ones in the text color, the failed one in red.
      const glyphs = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.work-steps > .tool')].map((t) => ({
        status: t.dataset.status, icon: Boolean(t.querySelector('.tool-glyph svg')), color: getComputedStyle(t.querySelector('.tool-glyph')).color,
        text: t.querySelector('.tool-head').textContent.trim().slice(0, 30) })))`));
      const danger = await js("getComputedStyle(document.documentElement).getPropertyValue('--danger').trim()");
      check('each step shows a glyph instead of a verb', glyphs.length >= 5 && glyphs.every((g) => g.icon) && !glyphs.some((g) => /^(Read|Edit|Write|Run)/.test(g.text)), JSON.stringify(glyphs));
      const failed = glyphs.find((g) => g.status === 'error');
      check('a failed step shows its glyph in red', Boolean(failed) && failed.color !== glyphs.find((g) => g.status === 'done').color, `${JSON.stringify(failed)} --danger ${danger}`);
      await js("document.querySelector('.side-head .icon-btn[aria-label=\"Close\"]').click(); true");
      await wait(300);
      await shot('4-steps');
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
