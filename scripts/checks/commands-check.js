// Check of slash commands in a chat, without API usage (Claude is scripted, see fakes.js): the /
// list (every command, the CLI-only ones marked), /btw answered beside the conversation, /status (credentials
// masked), /memory, /mcp, /export, /copy, /rename, /model, /effort, /plan, /theme, /help, an unknown command,
// and a CLI-only one (asks, then continues in the CLI with the command typed in). Screenshots in dist/commands-check/.
// Usage: npx vite build && npx electron scripts/checks/commands-check.js   (add --dark for the dark theme)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, dialog, shell, clipboard } = require('electron');
const { tempDir } = require('./temp');
const { install } = require('./fakes');

const outDir = path.join(__dirname, '..', '..', 'dist', 'commands-check');
const profile = tempDir('commands-profile');
const project = tempDir('commands-project');
fs.mkdirSync(outDir, { recursive: true });

const ANSWER = 'The rate limiter is the only open item.';
const director = {
  histories: [],
  transcripts: new Map(),
  script: () => async (c) => {
    await c.think(150);
    await c.say(ANSWER, { cps: 600 });
    c.finish(0.01);
  },
  prompt: () => 'PS ~> ',
  shell: () => '',
  cli: () => 'Claude Code (scripted)\r\n> ',
};
install(director);

// No OS windows or editors: the save dialog answers with a file in the profile, opening a file does nothing.
const exported = path.join(profile, 'exported.txt');
dialog.showSaveDialog = async () => ({ canceled: false, filePath: exported });
const opened = [];
shell.openPath = async (p) => { opened.push(p); return ''; };

const THEME = process.argv.includes('--dark') ? 'dark' : 'light';
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  language: 'en', uiScale: 100, theme: THEME, confirmClose: false, notify: false, recent: [{ path: project, at: Date.now() }], trustedFolders: [project],
}));
app.setPath('userData', profile);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};
const controls = (action) => (director.controls || []).filter(([a]) => a === action);

app.on('browser-window-created', (_e, win) => {
  win.setSize(1320, 860);
  win.webContents.setBackgroundThrottling(false);
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => fs.writeFileSync(path.join(outDir, `${name}-${THEME}.png`), (await win.webContents.capturePage()).toPNG());
  const until = async (label, condition, timeout = 10000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await js(condition).catch(() => false)) return true;
      await wait(100);
    }
    check(`waiting for ${label}`, false, 'timeout');
    return false;
  };
  const type = (text) => js(`{ const el = document.querySelector('.chat-composer .composer-input'); el.focus();
    el.value = ${JSON.stringify(text)}; el.selectionStart = el.selectionEnd = el.value.length;
    el.dispatchEvent(new Event('input', { bubbles: true })); } true`);
  const enter = () => js("document.querySelector('.chat-composer .composer-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); true");
  // Typed and sent in one go (Enter on an open / list runs a command typed out in full).
  const run = async (text) => { await type(text); await wait(120); await js("document.querySelector('.autocomplete') && document.querySelector('.chat-composer .composer-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true"); await wait(60); await enter(); await wait(250); };
  const boxText = "document.querySelector('.chat-composer .composer-input').value";
  const toasts = "[...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ')";
  const info = "document.querySelector('.dialog-info[open]')?.textContent || ''";
  const closeInfo = async () => { await js("document.querySelector('.dialog-info[open] .primary-btn')?.click(); true"); await wait(300); };
  const userBubbles = "document.querySelectorAll('.msg-user').length";
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });

  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(1200);
      await js("document.querySelector('.empty-recent .primary-btn').click(); true");
      await until('chat ready', "Boolean(document.querySelector('.chat-composer .composer-input'))");
      await wait(800);
      await run('What is left?');
      await until('the answer', `/rate limiter/.test(document.querySelector('.timeline')?.textContent || '') && !document.querySelector('.send-btn.stop')`);
      await wait(300);

      // The / list: every command, more than fit, the CLI-only ones marked.
      await type('/');
      await until('the / list', "Boolean(document.querySelector('.autocomplete'))", 3000);
      const list = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.autocomplete li')].map((li) => li.querySelector('.ac-label').textContent + (li.querySelector('.ac-tag') ? ' CLI' : '')))`));
      check('the / list has every command, not just 8', list.length > 30, `${list.length}`);
      check('the chat’s own commands are in it', ['/btw', '/status', '/memory', '/mcp', '/export', '/copy', '/rename', '/resume', '/help'].every((n) => list.includes(n)), list.slice(0, 12).join(' '));
      check('Claude Code’s commands too', list.includes('/compact') && list.includes('/init'));
      check('the CLI-only ones are marked', list.includes('/hooks CLI') && list.includes('/permissions CLI') && !list.includes('/btw CLI'));
      await shot('1-list');
      await type('/cos');
      await wait(200);
      check('a command is found by another name for it (/cost → /usage)', (await js("document.querySelector('.autocomplete li .ac-label')?.textContent")) === '/usage');
      await type('');
      await wait(100);

      // /btw: answered beside the conversation, not in it.
      const before = await js(userBubbles);
      await run('/btw why is the sky blue?');
      check('/btw clears the message box', (await js(boxText)) === '');
      await until('the side answer', "/Side answer to: why is the sky blue/.test(document.querySelector('.side-notes')?.textContent || '')", 4000);
      check('the question went to Claude Code as a side question', controls('side-question').some(([, q]) => q === 'why is the sky blue?'));
      check('and not into the conversation', (await js(userBubbles)) === before);
      check('the answer is Markdown', await js("Boolean(document.querySelector('.side-note-a strong'))"));
      await shot('2-btw');
      await js("[...document.querySelectorAll('.side-note-head .icon-btn')].at(-1).click(); true");
      await wait(500); // it folds away first
      check('✕ closes it', await js("!document.querySelector('.side-notes')"));
      await run('/btw');
      check('/btw with no question says what to add', /Add your question/.test(await js(toasts)));

      // /status, with anything like a credential masked.
      await run('/status');
      await until('Status', `/Status/.test(${info})`, 3000);
      const status = await js(info);
      check('/status shows Claude Code’s status', /2\.1\.287/.test(status) && /Session ID/.test(status), status.slice(0, 100));
      check('a token is masked', !status.includes('0123456789abcdef') && status.includes('••••cdef'));
      await shot('3-status');
      await closeInfo();

      // /memory: the instructions files; one not there yet is created and opened.
      await run('/memory');
      await until('Memory', `/Project memory/.test(${info})`, 3000);
      await shot('4-memory');
      await js("[...document.querySelectorAll('.dialog-info[open] .set-row')].find((r) => r.textContent.includes('Project memory')).querySelector('button').click(); true");
      await wait(500);
      check('/memory creates the project CLAUDE.md and opens it', fs.existsSync(path.join(project, 'CLAUDE.md')) && opened.some((p) => p.endsWith('CLAUDE.md')), opened.join(', '));
      check('and the dialog closes', !(await js(info)));

      // /mcp: the servers; a failed one can be reconnected.
      await run('/mcp');
      await until('MCP servers', `/github/.test(${info}) && /docs/.test(${info})`, 3000);
      await js("[...document.querySelectorAll('.dialog-info[open] .set-row')].find((r) => r.textContent.includes('docs')).querySelector('button').click(); true");
      await wait(400);
      check('/mcp reconnects a failed server', controls('mcp-reconnect').some(([, n]) => n === 'docs'));
      await closeInfo();
      const sent = await js(userBubbles);
      await run('/mcp disable docs');
      await wait(300);
      check('/mcp with arguments goes to Claude Code', (await js(userBubbles)) === sent + 1);
      await until('idle', "!document.querySelector('.send-btn.stop')");

      // /export, /copy.
      await run('/export');
      await until('the export', `/Saved to/.test(${toasts})`, 3000);
      check('/export saves the conversation to the chosen file', fs.existsSync(exported) && fs.readFileSync(exported, 'utf8').includes('Exported conversation'));
      clipboard.writeText('');
      await run('/copy');
      await wait(200);
      const copied = await clipboard.readText();
      check('/copy copies Claude’s last answer', copied === ANSWER, copied);
      await run('/copy 9');
      check('/copy N past the start says so', /no answer number 9/.test(await js(toasts)));

      // /rename, /model, /effort, /plan.
      await run('/rename Rate limiter work');
      await wait(200);
      check('/rename names the session', (await js("document.querySelector('#sidebar .session-name').textContent")) === 'Rate limiter work');
      check('the top bar shows the new name too', (await js("document.querySelector('#topbar .top-task')?.textContent || ''")) === 'Rate limiter work');
      check('and tells Claude Code', controls('rename').some(([, n]) => n === 'Rate limiter work'));
      await run('/model');
      check('/model opens the model menu', await until('the model menu', "Boolean(document.querySelector('.model-menu .menu-list'))", 2000));
      await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
      await wait(200);
      await run('/model sonnet');
      await wait(300);
      check('/model sonnet switches', /Sonnet/.test(await js("document.querySelector('.model-menu .menu-button').textContent")));
      await run('/effort high');
      await wait(300);
      check('/effort high sets it', controls('effort').some(([, l]) => l === 'high'));
      await run('/effort loud');
      check('/effort with a wrong level says which there are', /Effort is one of/.test(await js(toasts)));
      await run('/plan');
      await wait(300);
      check('/plan switches to plan mode', controls('mode').some(([, m]) => m === 'plan') && /Plan/.test(await js("document.querySelector('.mode-menu .menu-button').textContent")));

      // /theme opens Settings at Appearance; /help shows the list.
      await run('/theme');
      await until('Settings', "Boolean(document.querySelector('.settings-nav'))", 3000);
      check('/theme opens Settings at Appearance', (await js("document.querySelector('.settings-nav button.on').textContent")).includes('Appearance'));
      await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.querySelector('dialog[open]')?.close(); true");
      await wait(400);
      await run('/help');
      await wait(300);
      const help = await js(`JSON.stringify({ items: document.querySelectorAll('.autocomplete li').length, box: ${boxText}, dialogs: document.querySelectorAll('dialog[open]').length })`);
      check('/help shows every command', JSON.parse(help).items > 30 && JSON.parse(help).box === '/', help);
      await type('');
      await wait(150);

      // An unknown command stays to be fixed.
      await run('/frobnicate');
      check('an unknown command is not sent, and says so', (await js(boxText)) === '/frobnicate' && /isn’t a command/.test(await js(toasts)));

      // A CLI-only command: asks; Cancel keeps it; yes continues in the CLI with it typed in.
      await run('/hooks');
      await until('the CLI question', "/opens in the CLI/.test(document.querySelector('.dialog-confirm[open]')?.textContent || '')", 3000);
      await shot('5-cli-ask');
      await js("[...document.querySelectorAll('.dialog-confirm[open] button')].find((b) => b.textContent === 'Cancel').click(); true");
      await wait(300);
      check('Cancel keeps the command in the message box', (await js(boxText)) === '/hooks');
      await run('/hooks');
      await until('the CLI question again', "Boolean(document.querySelector('.dialog-confirm[open]'))", 3000);
      await js("document.querySelector('.dialog-confirm[open] .primary-btn').click(); true");
      await until('the CLI', "Boolean(document.querySelector('#stage .term-host.active'))", 6000);
      const end = Date.now() + 5000;
      while (Date.now() < end && !(director.typed || []).includes('/hooks')) await wait(100);
      check('the CLI opens with /hooks typed in (not run)', (director.typed || []).includes('/hooks'), JSON.stringify(director.typed || []));
      await shot('6-cli');
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
