// Check of session housekeeping, without API usage (Claude is scripted, see fakes.js): at launch the
// shown session's folder is open and the others folded; restored chats read their history one at a time; a chat
// left alone lets its Claude Code go (the clock is moved on) without a notice, and starts again on the same
// conversation when selected; a crashed window is logged and loads again with its sessions.
// Usage: npx vite build && npx electron scripts/checks/sessions-check.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const { install } = require('./fakes');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ccui-sessions-profile-'));
const a = fs.mkdtempSync(path.join(os.tmpdir(), 'ccui-sessions-a-'));
const b = fs.mkdtempSync(path.join(os.tmpdir(), 'ccui-sessions-b-'));

// Two saved conversations, one per folder; the one in B was on screen.
const msg = (type, text) => ({ type, uuid: `${type}-${Math.random()}`, message: { role: type, content: type === 'user' ? text : [{ type: 'text', text }] } });
const transcripts = new Map([
  ['conv-a', [msg('user', 'Question in A'), msg('assistant', 'Answer in A')]],
  ['conv-b', [msg('user', 'Question in B'), msg('assistant', 'Answer in B')]],
]);
const director = { histories: [], transcripts, script: () => null, prompt: () => '', shell: () => '', cli: () => '' };
install(director);
const agentModule = require.cache[require.resolve('../../src/main/agent')].exports;
// What the app asks of Claude Code: sessions started (with what they resume) and closed; histories read, in order.
const started = [];
const closed = [];
const reads = [];
const { start, close } = agentModule.AgentManager.prototype;
agentModule.AgentManager.prototype.start = function (opts) { started.push(opts.resume || 'new'); return start.call(this, opts); };
agentModule.AgentManager.prototype.close = function (id) { closed.push(id); return close.call(this, id); };
const load = agentModule.loadHistory;
agentModule.loadHistory = async (id, cwd) => { reads.push(`start:${id}`); await new Promise((r) => setTimeout(r, 300)); reads.push(`end:${id}`); return load(id, cwd); };

fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  language: 'en', theme: 'light', confirmClose: false, notify: false, trustedFolders: [a, b],
  recent: [{ path: a, at: Date.now() }, { path: b, at: Date.now() - 1000 }],
  lastSessions: [
    { kind: 'chat', cwd: a, title: 'Chat in A', sessionId: 'conv-a' },
    { kind: 'chat', cwd: b, title: 'Chat in B', sessionId: 'conv-b', active: true },
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
  const until = async (label, condition, timeout = 10000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await js(condition).catch(() => false)) return true;
      await wait(100);
    }
    check(`waiting for ${label}`, false, 'timeout');
    return false;
  };
  const folders = `JSON.stringify([...document.querySelectorAll('#sidebar .folder')].map((f) => (f.classList.contains('collapsed') ? 'folded:' : 'open:') + f.querySelector('.folder-name').textContent.replace(/ccui-sessions-|-\\w+$/g, '')))`;
  const pick = (title) => js(`[...document.querySelectorAll('#sidebar .session')].find((x) => x.textContent.includes(${JSON.stringify(title)})).querySelector('.session-main').click(); true`);
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });

  win.webContents.once('did-finish-load', async () => {
    try {
      await until('the restored chat', "/Answer in B/.test(document.querySelector('.timeline')?.textContent || '')");
      await wait(800);
      check('the shown session’s folder is open, the other folded', (await js(folders)) === JSON.stringify(['folded:a', 'open:b']), await js(folders));
      check('histories are read one at a time, the shown one first', reads.join(' ') === 'start:conv-b end:conv-b start:conv-a end:conv-a', reads.join(' '));
      check('only the shown chat starts Claude Code', JSON.stringify(started) === '["conv-b"]', JSON.stringify(started));

      // A, then back to B: A now runs too. Moved 21 minutes on, A (not shown) lets its Claude Code go.
      await js("document.querySelectorAll('#sidebar .folder')[0].querySelector('.folder-main').click(); true");
      await wait(400);
      await pick('Chat in A');
      await until('chat A', "/Answer in A/.test(document.querySelector('.timeline')?.textContent || '')");
      await wait(600);
      await pick('Chat in B');
      await wait(400);
      check('selecting A started it', started.includes('conv-a'), JSON.stringify(started));
      const before = closed.length;
      await js('{ const real = Date.now; Date.now = () => real() + 21 * 60 * 1000; } true');
      const end = Date.now() + 70000;
      while (Date.now() < end && closed.length === before) await wait(500);
      check('after 20 minutes unseen, A’s Claude Code is let go', closed.length === before + 1, `${closed.length - before} closed`);
      check('B, on screen, keeps running', started.filter((x) => x === 'conv-b').length === 1);
      await wait(500);
      check('A shows no “ended” notice and keeps its state', !(await js("[...document.querySelectorAll('#sidebar .session')].find((x) => x.textContent.includes('Chat in A')).textContent")).match(/Ended|Exited/i),
        await js("[...document.querySelectorAll('#sidebar .session')].find((x) => x.textContent.includes('Chat in A')).querySelector('.session-sub').textContent"));
      await pick('Chat in A');
      await until('A again', "/Answer in A/.test(document.querySelector('.timeline')?.textContent || '')");
      await wait(800);
      check('selecting it again starts it on the same conversation', started.filter((x) => x === 'conv-a').length === 2, JSON.stringify(started));
      check('without the conversation shown twice', (await js("(document.querySelector('.timeline').textContent.match(/Answer in A/g) || []).length")) === 1);
      check('and without an “ended” notice', !(await js("/ended|exited/i.test(document.querySelector('.timeline').textContent)")));

      // A crash: logged, and the window comes back with its sessions.
      win.webContents.forcefullyCrashRenderer();
      await wait(1500);
      await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()));
      // A was on screen, so A comes back (and B's folder starts folded, so only A's session is drawn).
      const back = "document.querySelectorAll('#sidebar .folder').length === 2 && /Answer in A/.test(document.querySelector('.timeline')?.textContent || '')";
      await until('the sessions after the crash', back, 15000);
      const log = fs.existsSync(path.join(profile, 'crash.log')) ? fs.readFileSync(path.join(profile, 'crash.log'), 'utf8') : '';
      check('the crash is noted in crash.log', /window process gone: crashed/.test(log), log.trim().split('\n').at(-1));
      check('the window loads again with its sessions', await js(back));
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
