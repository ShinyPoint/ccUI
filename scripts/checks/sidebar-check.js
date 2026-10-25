// Check of the sidebar's dragging, without API usage (Claude is scripted, see fakes.js), with real mouse input:
// a session dragged to another place in its folder lifts and the others make room, and the order is kept (also
// after the window loads again); a press that doesn't move is still a click; Esc puts a dragged item back; project
// folders are dragged into an order of their own; the sidebar's edge makes it wider or narrower, within limits,
// and a double-click brings back its first width.
// Usage: npx vite build && npx electron scripts/checks/sidebar-check.js
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { tempDir } = require('./temp');
const { install } = require('./fakes');

const profile = tempDir('sidebar-profile');
const a = tempDir('sidebar-a');
const b = tempDir('sidebar-b');
const outDir = path.join(__dirname, '..', '..', 'dist', 'sidebar-check');
fs.mkdirSync(outDir, { recursive: true });

const msg = (type, text) => ({ type, uuid: `${type}-${Math.random()}`, message: { role: type, content: type === 'user' ? text : [{ type: 'text', text }] } });
const conv = (name) => [msg('user', `Question: ${name}`), msg('assistant', `Answer: ${name}`)];
const transcripts = new Map([['a1', conv('a1')], ['a2', conv('a2')], ['a3', conv('a3')], ['b1', conv('b1')]]);
install({ histories: [], transcripts, script: () => null, prompt: () => '', shell: () => '', cli: () => '' });

fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  language: 'en', uiScale: 100, theme: 'light', confirmClose: false, notify: false, trustedFolders: [a, b],
  recent: [{ path: a, at: Date.now() }, { path: b, at: Date.now() - 1000 }],
  lastSessions: [
    { kind: 'chat', cwd: a, title: 'First in A', sessionId: 'a1' },
    { kind: 'chat', cwd: a, title: 'Second in A', sessionId: 'a2' },
    { kind: 'chat', cwd: a, title: 'Third in A', sessionId: 'a3' },
    { kind: 'chat', cwd: b, title: 'Chat in B', sessionId: 'b1', active: true },
  ],
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
  // Real mouse input: a press, moves in small steps (held), a release.
  const send = (type, x, y, extra = {}) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), ...extra });
  const press = async (x, y) => { send('mouseMove', x, y); await wait(30); send('mouseDown', x, y, { button: 'left', clickCount: 1 }); await wait(30); };
  const moveTo = async (from, to, steps = 12) => {
    for (let i = 1; i <= steps; i++) {
      send('mouseMove', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, { modifiers: ['leftButtonDown'] });
      await wait(25);
    }
  };
  const release = async (x, y) => { send('mouseUp', x, y, { button: 'left', clickCount: 1 }); await wait(400); };
  const box = (selector) => js(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width } : null; })()`);
  const rowOf = (title) => `[...document.querySelectorAll('#sidebar .session')].find((li) => li.textContent.includes(${JSON.stringify(title)}))`;
  const rowBox = (title) => js(`(() => { const r = ${rowOf(title)}?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top } : null; })()`);
  const order = () => js("[...document.querySelectorAll('#sidebar .folder')].map((f) => f.querySelector('.folder-name').textContent + ': ' + [...f.querySelectorAll('.session-name')].map((n) => n.textContent).join(', '))");
  const folderNames = () => js("[...document.querySelectorAll('#sidebar .folder-name')].map((n) => n.textContent)");
  const saved = () => js('window.ccui.getSettings()');
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });

  let reloaded = false;
  win.webContents.on('did-finish-load', async () => {
    if (reloaded) return;
    reloaded = true;
    try {
      const A = path.basename(a);
      const B = path.basename(b);
      await until('both projects', "document.querySelectorAll('#sidebar .folder').length === 2");
      await wait(600);
      check('the projects start in their natural order', JSON.stringify(await folderNames()) === JSON.stringify([A, B]), (await folderNames()).join(', '));

      // A press on a folder's row that doesn't move is still a click: it opens the folder.
      const aRow = await box('#sidebar .folder:first-child .folder-row');
      await press(aRow.x - 40, aRow.y);
      await release(aRow.x - 40, aRow.y);
      check('a click on a project still opens it', await js("document.querySelector('#sidebar .folder:first-child .folder-main').getAttribute('aria-expanded') === 'true'"));
      await wait(500);

      // A session dragged above the first one in its folder: lifted, the others make room, then put there.
      const third = await rowBox('Third in A');
      const first = await rowBox('First in A');
      await press(third.x, third.y);
      await moveTo(third, { x: third.x, y: first.top + 2 });
      await wait(250);
      const mid = JSON.parse(await js(`JSON.stringify({ lifted: ${rowOf('Third in A')}.classList.contains('sort-lifted'),
        made: [${rowOf('First in A')}, ${rowOf('Second in A')}].map((li) => li.style.transform) })`));
      check('a dragged session lifts and the others in its folder make room', mid.lifted && mid.made.every((t) => /translateY\(\d/.test(t)), JSON.stringify(mid));
      await shot('1-dragging-session');
      await release(third.x, first.top + 2);
      check('let go, it stays there', (await order())[0] === `${A}: Third in A, First in A, Second in A`, (await order())[0]);
      check('and dragging it was not a click on it: the session shown is the same', await js(`${rowOf('Chat in B')}.getAttribute('aria-current') === 'true'`));
      const kept = (await saved()).lastSessions.map((x) => x.title);
      check('the new order is kept for the next launch', JSON.stringify(kept) === JSON.stringify(['Third in A', 'First in A', 'Second in A', 'Chat in B']), kept.join(', '));

      // Esc while dragging puts it back.
      const second = await rowBox('Second in A');
      const top = await rowBox('Third in A');
      await press(second.x, second.y);
      await moveTo(second, { x: second.x, y: top.top + 2 });
      send('keyDown', 0, 0, { keyCode: 'Escape' });
      await wait(300);
      await release(second.x, top.top + 2);
      check('Esc while dragging puts it back', (await order())[0] === `${A}: Third in A, First in A, Second in A`, (await order())[0]);

      // A project dragged above the other one.
      const bRow = await box('#sidebar .folder:last-child .folder-row');
      const aTop = await box('#sidebar .folder:first-child .folder-row');
      await press(bRow.x - 40, bRow.y);
      await moveTo({ x: bRow.x - 40, y: bRow.y }, { x: bRow.x - 40, y: aTop.top + 2 }, 16);
      await wait(250);
      await shot('2-dragging-folder');
      await release(bRow.x - 40, aTop.top + 2);
      check('a project dragged above another one goes there', JSON.stringify(await folderNames()) === JSON.stringify([B, A]), (await folderNames()).join(', '));
      const folderOrder = (await saved()).folderOrder.map((p) => path.basename(p));
      check('and the projects’ order is kept', JSON.stringify(folderOrder) === JSON.stringify([B, A]), folderOrder.join(', '));

      // The sidebar's edge.
      const edge = await box('.sidebar-resizer');
      const before = (await box('#sidebar')).width;
      await press(edge.x, edge.y);
      await moveTo(edge, { x: edge.x + 100, y: edge.y }, 10);
      await release(edge.x + 100, edge.y);
      const wider = (await box('#sidebar')).width;
      check('dragging the sidebar’s edge makes it wider', Math.abs(wider - (before + 100)) <= 2, `${before} → ${wider}`);
      check('and its width is kept', (await saved()).sidebarWidth === Math.round(wider), String((await saved()).sidebarWidth));
      const stage = await box('#stage');
      check('the work area starts where the sidebar now ends, past the same gap', Math.abs(stage.left - wider - 8) <= 2, `sidebar ${wider}, work area at ${stage.left}`);
      await shot('3-wider');
      const edge2 = await box('.sidebar-resizer');
      await press(edge2.x, edge2.y);
      await moveTo(edge2, { x: edge2.x + 900, y: edge2.y }, 10);
      await release(edge2.x + 900, edge2.y);
      check('not wider than 480px', Math.round((await box('#sidebar')).width) === 480, String((await box('#sidebar')).width));
      const edge3 = await box('.sidebar-resizer');
      await press(edge3.x, edge3.y);
      await moveTo(edge3, { x: 0, y: edge3.y }, 10);
      await release(0, edge3.y);
      check('nor narrower than 200px', Math.round((await box('#sidebar')).width) === 200, String((await box('#sidebar')).width));
      const edge4 = await box('.sidebar-resizer');
      send('mouseDown', edge4.x, edge4.y, { button: 'left', clickCount: 1 });
      send('mouseUp', edge4.x, edge4.y, { button: 'left', clickCount: 1 });
      send('mouseDown', edge4.x, edge4.y, { button: 'left', clickCount: 2 });
      send('mouseUp', edge4.x, edge4.y, { button: 'left', clickCount: 2 });
      await wait(500);
      check('a double-click on the edge brings back its first width', Math.round((await box('#sidebar')).width) === 256, String((await box('#sidebar')).width));
      const edge5 = await box('.sidebar-resizer');
      await press(edge5.x, edge5.y);
      await moveTo(edge5, { x: edge5.x + 60, y: edge5.y }, 6);
      await release(edge5.x + 60, edge5.y);
      const width = Math.round((await box('#sidebar')).width);
      check('(set to another width before the window loads again)', width === 316, String(width));

      // Everything as it was left, after the window loads again.
      win.webContents.reload();
      await wait(1500);
      await until('the sidebar again', "document.querySelectorAll('#sidebar .folder').length === 2");
      await wait(800);
      await js("[...document.querySelectorAll('#sidebar .folder-main')].forEach((b) => b.getAttribute('aria-expanded') === 'false' && b.click()); true");
      await wait(800);
      const after = await order();
      check('after the window loads again: the projects’ order, the sessions’ order and the width are as left',
        JSON.stringify(after) === JSON.stringify([`${B}: Chat in B`, `${A}: Third in A, First in A, Second in A`]) && Math.round((await box('#sidebar')).width) === width,
        `${after.join(' | ')}; ${Math.round((await box('#sidebar')).width)} (${width})`);
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
