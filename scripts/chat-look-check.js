// Visual check of the chat, without API usage: Claude is scripted (intro-video/fakes.js). Sends a few messages,
// checks that new items animate in and that the view eases down to them instead of jumping, opens the
// Terminal panel under the chat, and saves screenshots in dark and light.
// Usage: npx vite build && npx electron scripts/chat-look-check.js   (writes dist/chat-look/*.png)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const { install } = require('./intro-video/fakes');

const outDir = path.join(__dirname, '..', 'dist', 'chat-look');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ccui-look-profile-'));
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccui-look-project-'));
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(project, 'notes.md'), '# Notes\n\nShip the rate limiter.\n');

const REPLY = [
  'Here is what I found in **notes.md**:',
  '',
  '- The only open item is shipping the rate limiter.',
  '- Nothing else is pending, so this can go out with the next release.',
  '',
  'Want me to start on it?',
].join('\n');

install({
  histories: [],
  transcripts: new Map(),
  script: () => async (c, text) => {
    await c.think(300);
    if (/long/.test(text)) {
      await c.say(Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of a longer answer that streams in word by word.`).join('\n\n'), { cps: 1500 });
    } else {
      await c.tool('Read', { file_path: c.file('notes.md') }, { run: 300, data: { type: 'text', file: { filePath: c.file('notes.md'), content: '# Notes' } } });
      await c.say(REPLY, { cps: 400 });
    }
    c.finish(0.01);
  },
  prompt: () => 'PS ~\\look> ',
  shell: () => '',
  cli: () => 'Claude Code (scripted)\r\n',
});

fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  theme: 'dark', confirmClose: false, notify: false, sidebarGlass: false,
  recent: [{ path: project, at: Date.now() }], trustedFolders: [project],
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
  const until = async (label, condition, timeout = 20000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await js(condition).catch(() => false)) return true;
      await wait(100);
    }
    check(`waiting for ${label}`, false, 'timeout');
    return false;
  };
  const idle = "!document.querySelector('.send-btn.stop') && !document.querySelector('.activity')";
  const say = async (text) => {
    await js(`{ const el = document.querySelector('.chat-composer .composer-input');
      el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); } true`);
    await wait(80);
    await js("document.querySelector('.chat-composer .composer-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); true");
  };
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });

  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(1200);
      await js("document.querySelector('.empty-recent .primary-btn').click(); true");
      await until('chat ready', "Boolean(document.querySelector('.chat-composer .composer-input'))");
      await wait(1500);
      check('the model label has no effort in it', !(await js("document.querySelector('.composer-bar').textContent")).includes('·'));
      check('the message box has no border', await js("getComputedStyle(document.querySelector('.chat-composer')).borderTopWidth === '0px'"));

      await say('What is left in notes.md?');
      await wait(40);
      check('your message pops in', await js("document.querySelector('.msg-user-wrap')?.classList.contains('enter')"));
      const bubble = await js(`{ const b = document.querySelector('.msg-user').getBoundingClientRect();
        const t = document.querySelector('.timeline').getBoundingClientRect();
        JSON.stringify({ right: Math.round(t.right - b.right), width: Math.round(b.width), timeline: Math.round(t.width) }) }`);
      const { right, width, timeline } = JSON.parse(bubble);
      check('your message is a bubble on the right, sized to its text', right < 40 && width < timeline * 0.6, bubble);
      await until('the reply', `${idle} && /start on it/.test(document.querySelector('.msg-text')?.textContent || '')`);
      await wait(600);
      await shot('1-chat-dark');

      // A long reply: the view should ease down, not jump.
      await say('Give me a long answer.');
      console.log('reduced motion:', await js("matchMedia('(prefers-reduced-motion: reduce)').matches"));
      // How far from the bottom the view is on each frame, for 3 s.
      const positions = await js(`new Promise((done) => {
        const el = document.querySelector('.chat-scroll'); const out = []; const t0 = performance.now();
        const frame = (now) => { out.push(Math.round(el.scrollHeight - el.clientHeight - el.scrollTop));
          if (now - t0 < 3000) requestAnimationFrame(frame); else done(out); };
        requestAnimationFrame(frame); })`);
      check('the view eases down while the reply streams in', positions.some((p) => p > 2) && positions.some((p, i) => i && p > 0 && p < positions[i - 1]), positions.filter((p, i) => p !== positions[i - 1]).slice(0, 24).join(','));
      await until('the long reply', `${idle} && /Line 40/.test(document.querySelector('.timeline').textContent)`);
      await wait(800);
      check('it ends at the bottom', await js("{ const el = document.querySelector('.chat-scroll'); el.scrollHeight - el.clientHeight - el.scrollTop < 2 }"));

      // Terminal panel joined to the chat.
      await js("[...document.querySelectorAll('.st-btn')].find((b) => b.textContent.includes('Terminal')).click(); true");
      await wait(1500);
      const seam = await js(`{ const s = document.querySelector('#stage').getBoundingClientRect();
        const p = document.querySelector('.bottom-panel').getBoundingClientRect();
        JSON.stringify({ gap: Math.round(p.top - s.bottom), radius: getComputedStyle(document.querySelector('#stage')).borderBottomLeftRadius }) }`);
      check('opening it keeps the chat at the bottom', await js(`{ const el = document.querySelector('.chat-scroll');
        el.scrollHeight - el.clientHeight - el.scrollTop < 2 && !document.querySelector('.jump-latest') }`));
      check('the Terminal panel is joined to the chat', JSON.parse(seam).gap === 0 && JSON.parse(seam).radius === '0px', seam);
      await shot('2-chat-terminal-dark');
      await js("document.querySelector('.sidebar-bottom .icon-btn').click(); true");
      await wait(1200);
      await shot('3-chat-terminal-light');
      await js("document.querySelector('.chat-scroll').scrollTop = 0; true");
      await wait(300);
      await shot('4-top-light');
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
