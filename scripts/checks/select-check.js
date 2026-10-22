// Check of text selection in the chat, without API usage (Claude is scripted, see fakes.js): real mouse
// drags over a reply, from a reply into the space around it, and across your message and a reply, then reports
// what got selected. Only conversation text should be: not buttons, labels, icons or the message box.
// Usage: npx vite build && npx electron scripts/checks/select-check.js   (writes dist/select-check/*.png)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const { tempDir } = require('./temp');
const { install } = require('./fakes');

const outDir = path.join(__dirname, '..', '..', 'dist', 'select-check');
const profile = tempDir('select-profile');
const project = tempDir('select-project');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(project, 'notes.md'), '# Notes\n');

install({
  histories: [],
  transcripts: new Map(),
  script: () => async (c) => {
    await c.think(200);
    await c.tool('Read', { file_path: c.file('notes.md') }, { run: 200, data: { type: 'text', file: { filePath: c.file('notes.md'), content: '# Notes' } } });
    await c.say('Students this year:\n\n- Yongzhi Shi (BS, 2026) → MS at TJU\n- Lina Park (MS, 2025) → PhD at ETH\n\nThe query:\n\n```js\nconst grads = students.filter((s) => s.year === 2026);\n```\n\n| Name | Next |\n| --- | --- |\n| Yongzhi | TJU |\n\nThat is everyone on the list.', { cps: 900 });
    c.finish(0.01);
  },
  prompt: () => 'PS ~> ',
  shell: () => '',
  cli: () => '',
});

const THEME = process.argv.includes('--dark') ? 'dark' : 'light';
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  language: 'en', uiScale: 100, theme: THEME, confirmClose: false, notify: false, sidebarGlass: false,
  recent: [{ path: project, at: Date.now() }], trustedFolders: [project],
}));
app.setPath('userData', profile);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

// What the selection holds: its text, and the elements it touches that are not conversation text.
const REPORT = `{ const sel = getSelection(); const text = sel.toString();
  const stray = new Set();
  if (sel.rangeCount) {
    const r = sel.getRangeAt(0);
    const walker = document.createTreeWalker(r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentNode, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!r.intersectsNode(n) || !n.data.trim()) continue;
      const el = n.parentElement;
      if (getComputedStyle(el).userSelect === 'none') continue; // not highlighted, not copied
      if (!el.closest('.msg-text, .msg-user-text, .md, .tool-output, .code-block pre, .diff, .bash-cmd, .thinking-text')) stray.add(el.className || el.tagName);
    }
  }
  JSON.stringify({ text, stray: [...stray] }) }`;

app.on('browser-window-created', (_e, win) => {
  win.setSize(1320, 860);
  // The window runs in the background, behind whatever you are doing; at full speed, so drags aren't throttled.
  win.webContents.setBackgroundThrottling(false);
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => fs.writeFileSync(path.join(outDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const until = async (label, condition, timeout = 20000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await js(condition).catch(() => false)) return true;
      await wait(100);
    }
    check(`waiting for ${label}`, false, 'timeout');
    return false;
  };
  const point = (code) => js(`{ const r = (${code}); JSON.stringify(r) }`).then(JSON.parse);
  // Each drag starts from nothing selected: a press inside the current selection would drag that text instead.
  const drag = async (from, to, retried = false) => {
    await js('getSelection().removeAllRanges(); true');
    const send = (type, p) => win.webContents.sendInputEvent({ type, x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1 });
    send('mouseMove', from);
    send('mouseDown', from);
    await wait(80); // a hand doesn't move in the same instant it presses
    // At a hand's pace: Chromium updates the selection on its own frames, and a pointer jumping faster than that
    // can end the drag before the selection catches up.
    for (let i = 1; i <= 20; i++) {
      send('mouseMove', { x: from.x + ((to.x - from.x) * i) / 20, y: from.y + ((to.y - from.y) * i) / 20 });
      await wait(40);
    }
    // Let the selection catch up with the pointer before letting go. The pointer wiggles a pixel: a move to
    // where it already is isn't a move, and Chromium ignores it. On a character's edge that pixel flips the
    // selection by one character each time, so the wait has a limit.
    for (let last = -1, same = 0, k = 0; same < 3 && k < 20; k++) {
      send('mouseMove', { x: to.x + (k % 2), y: to.y });
      await wait(60);
      const n = await js('getSelection().toString().length');
      same = n === last ? same + 1 : 0;
      last = n;
    }
    send('mouseUp', to);
    await wait(150);
    const report = JSON.parse(await js(REPORT));
    // Nothing at all: a synthetic drag to a window in the background is sometimes lost. Once more.
    if (!report.text && !retried) return drag(from, to, true);
    return report;
  };
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });

  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(1200);
      await js("document.querySelector('.empty-recent .primary-btn').click(); true");
      await until('chat ready', "Boolean(document.querySelector('.chat-composer .composer-input'))");
      await wait(800);
      await js(`{ const el = document.querySelector('.chat-composer .composer-input');
        el.value = 'Who graduated?'; el.dispatchEvent(new Event('input', { bubbles: true })); } true`);
      await wait(80);
      await js("document.querySelector('.chat-composer .composer-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); true");
      await until('the reply', "!document.querySelector('.activity') && /everyone/.test(document.querySelector('.msg-text')?.textContent || '')");
      await wait(800);

      // Where things are: a word inside the first list item, the end of the reply, the space beside and below it.
      const li = await point(`(() => { const r = [...document.querySelectorAll('.msg-text li')][0].getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2, right: r.right, bottom: r.bottom }; })()`);
      const reply = await point(`(() => { const r = document.querySelector('.msg-text').getBoundingClientRect(); return { x: r.left, y: r.top, right: r.right, bottom: r.bottom }; })()`);
      const bubble = await point(`(() => { const r = document.querySelector('.msg-user-text').getBoundingClientRect(); return { x: r.left + 4, y: r.top + r.height / 2 }; })()`);

      const inside = await drag({ x: li.x, y: li.y }, { x: li.x + 160, y: li.y });
      check('a drag inside a line selects just that text', inside.text.length > 3 && !inside.text.includes('\n') && !inside.stray.length, JSON.stringify(inside));
      await shot(`1-inside-${THEME}`);

      const out = await drag({ x: li.x, y: li.y }, { x: reply.x + 700, y: reply.bottom + 260 });
      check('dragging out into the empty chat keeps the selection, to the end of the reply', /Yongzhi|ngzhi/.test(out.text) && /everyone/.test(out.text) && !out.stray.length && !/Ask Claude|Ask before|Worked for/.test(out.text), JSON.stringify(out));
      await shot(`2-out-${THEME}`);

      const across = await drag(bubble, { x: li.x + 60, y: li.y });
      check('dragging from your message into the reply takes both, and nothing in between', /Who graduated\?/.test(across.text) && /Students this year/.test(across.text) && !across.stray.length && !/Worked for|step|Copy|Edit/.test(across.text), JSON.stringify(across));
      await shot(`3-across-${THEME}`);

      // Across the code block and the table, from the line above to the line after.
      const lead = await point(`(() => { const p = [...document.querySelectorAll('.msg-text p')].find((e) => e.textContent.includes('The query')).getBoundingClientRect(); return { x: p.left + 2, y: p.top + p.height / 2 }; })()`);
      const tail = await point(`(() => { const p = [...document.querySelectorAll('.msg-text p')].find((e) => e.textContent.includes('everyone')).getBoundingClientRect(); return { x: p.left + 60, y: p.top + p.height / 2 }; })()`);
      const block = await drag(lead, tail);
      console.log('across the code block and table:', JSON.stringify(block.text));
      check('dragging across a code block and a table keeps going, and takes the code, not its label or Copy button',
        /const grads/.test(block.text) && /TJU/.test(block.text) && /That is/.test(block.text) && !block.text.includes('Copy') && !/^js$/m.test(block.text), JSON.stringify(block.text));
      await shot(`4-block-${THEME}`);

      // Across the folded steps ("Worked for …") between your message and the reply, then with them open.
      const steps = await drag(bubble, { x: li.x + 30, y: li.y });
      console.log('across the folded steps:', JSON.stringify(steps.text));
      check('the "Worked for" line is not part of the copied text', /Students/.test(steps.text) && !/Worked for|1 step|\$0\.01/.test(steps.text), JSON.stringify(steps.text));
      await js("document.querySelector('.work-summary').click(); true");
      await wait(700);
      const li2 = await point(`(() => { const r = [...document.querySelectorAll('.msg-text li')][0].getBoundingClientRect(); return { x: r.left + 50, y: r.top + r.height / 2 }; })()`);
      const open = await drag(bubble, li2);
      console.log('across the open steps:', JSON.stringify(open.text), JSON.stringify(open.stray));
      check('with the steps open, their labels are left out too', /Students/.test(open.text) && !/Worked for|1 step/.test(open.text), JSON.stringify(open.text));
      await shot(`5-steps-${THEME}`);

      const sideways = await drag(li2, { x: 140, y: li2.y }); // the open steps moved the reply down
      check('dragging into the sidebar selects nothing there', !sideways.stray.length && !/Projects|New session|Settings/.test(sideways.text), JSON.stringify(sideways));

      const colors = await js(`JSON.stringify((() => { const st = getComputedStyle(document.querySelector('.msg-text p'), '::selection');
        return { bg: st.backgroundColor, color: st.color }; })())`);
      const c = JSON.parse(colors);
      const textColor = await js("getComputedStyle(document.documentElement).getPropertyValue('--text').trim()");
      check('selected text is the text color with the page color on it', c.bg !== 'rgba(0, 0, 0, 0)' && !/rgb\(\s*0, 1[0-9]{2}, 2[0-9]{2}/.test(c.bg), `${colors} text ${textColor}`);
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
