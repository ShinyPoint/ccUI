// End-to-end smoke test: launches the built app with a throwaway profile and a throwaway project,
// drives a real chat session (on the cheapest model), and saves screenshots.
// Usage: npm run smoke  (writes dist/smoke/*.png and dist/smoke/stream.jsonl)
// Costs a few cents: it sends Claude three short prompts.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const { tempDir } = require('./temp');

const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'dist', 'smoke'));
const profile = tempDir('smoke-profile');
const project = tempDir('smoke-project');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(project, 'notes.txt'), 'alpha\nbeta\ngamma\n');
fs.writeFileSync(path.join(project, 'greet.js'), "function greet(name) {\n  return 'Hello ' + name;\n}\n\nmodule.exports = { greet };\n");
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  language: 'en', uiScale: 100, theme: 'dark',
  confirmClose: false,
  notify: false,
  defaultModel: 'haiku',
  defaultPermissionMode: 'default',
  recent: [{ path: project, at: Date.now() }],
  trustedFolders: [project], // a throwaway folder: skip the trust prompt
}));
app.setPath('userData', profile);
process.env.CCUI_RECORD = path.join(outDir, 'stream.jsonl');
fs.rmSync(process.env.CCUI_RECORD, { force: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

app.on('browser-window-created', (_e, win) => {
  win.setSize(1320, 860);
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${name}.png`), image.toPNG());
    console.log('saved', name);
  };
  const until = async (label, condition, timeout = 90000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await js(condition).catch(() => false)) return true;
      await wait(400);
    }
    console.log(`TIMEOUT waiting for ${label}`);
    failures++;
    return false;
  };
  const status = () => js(`document.querySelector('.session[aria-current="true"]')?.dataset.status`);
  const say = (text) => js(`{
    const el = document.querySelector('.chat-composer .composer-input');
    el.value = ${JSON.stringify(text)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(() => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })), 50);
  }`);
  win.webContents.on('console-message', (ev) => {
    if (ev.level === 'warning' || ev.level === 'error') console.log('[renderer]', ev.message);
  });

  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(2000);
      await shot('01-empty');

      await js(`document.querySelector('.empty-recent .primary-btn').click()`);
      await until('chat ready', `document.querySelector('.session')?.dataset.status === 'idle'`, 60000);
      await wait(800);
      await shot('02-chat-intro');

      await say("Read notes.txt and greet.js. Then use the Edit tool to change greet.js so it uses a template literal. Then run `node -e \"console.log(require('./greet').greet('ccUI'))\"`. Reply in one sentence.");
      await wait(2500);
      await shot('03-working');
      for (let i = 0; i < 4; i++) {
        const asked = await until('permission or idle', `!!document.querySelector('.prompt') || document.querySelector('.session')?.dataset.status === 'idle'`, 90000);
        if (!asked || !(await js(`!!document.querySelector('.prompt')`))) break;
        if (i === 0) await shot('04-permission');
        await js(`document.querySelector('.prompt .primary-btn').click()`);
        await wait(1500);
      }
      await until('turn finished', `document.querySelector('.session')?.dataset.status === 'idle' && !!document.querySelector('.turn-end')`, 90000);
      await wait(800);
      await shot('05-turn-done');
      console.log('greet.js now:', JSON.stringify(fs.readFileSync(path.join(project, 'greet.js'), 'utf8')));

      await say('Use the AskUserQuestion tool to ask me whether the greeting should be formal or casual (two options). Then reply with only my choice.');
      if (await until('question', `!!document.querySelector('.prompt.question')`, 90000)) {
        await wait(500);
        await shot('06-question');
        await js(`document.querySelector('.q-option input').click()`);
        await wait(200);
        await js(`document.querySelector('.prompt.question .primary-btn').click()`);
      }
      await until('answer turn finished', `document.querySelectorAll('.turn-end').length >= 2`, 90000);
      await wait(600);
      await shot('07-answered');
      console.log('status after answer:', await status());

      await js(`[...document.querySelectorAll('.topbar-actions .text-btn')].find((b) => b.textContent.includes('CLI')).click()`);
      await until('terminal running', `document.querySelector('.session')?.dataset.status === 'idle' && document.getElementById('stage').classList.contains('mode-terminal')`, 60000);
      await wait(3000);
      await shot('08-terminal');

      await js(`[...document.querySelectorAll('.topbar-actions .text-btn')].find((b) => b.textContent.includes('Chat')).click()`);
      await until('chat restored', `!!document.querySelector('.divider') && document.querySelector('.session')?.dataset.status === 'idle'`, 60000);
      await wait(1000);
      await shot('09-back-to-chat');

      await js(`document.querySelector('.sidebar-bottom .icon-btn').click()`);
      await wait(1000);
      await shot('10-light');

      await js(`document.querySelector('.sidebar-bottom .ghost-btn').click()`);
      await wait(1500);
      await shot('11-settings');
      await js(`document.querySelector('dialog[open] .settings-head .primary-btn').click()`);
      await wait(400);

      // New session starts a chat; its menu (right-click) has the full dialog.
      await js("{ const b = document.querySelector('#sidebar button.new-session'); const r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.top + 10 })); } true");
      await wait(200);
      await js("[...document.querySelectorAll('.context-menu button')].find((x) => /More options/.test(x.textContent)).click(); true");
      await wait(400);
      await js(`[...document.querySelectorAll('dialog[open] .segmented span')].find((s) => s.textContent.includes('Pick one')).click()`);
      await wait(1500);
      await shot('12-new-session-history');
    } catch (err) {
      console.error('smoke failed:', err);
      failures++;
    }
    console.log(failures ? `FAILED (${failures})` : 'OK');
    process.exitCode = failures ? 1 : 0;
    app.quit();
  });
});

require('../../src/main/main.js');
