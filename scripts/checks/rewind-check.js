// Check of Edit and resend, without API usage (Claude is scripted, see fakes.js): going back to before a message
// says "Rewinding…" while the message and what followed fold away, the chat is never empty on the way, the
// conversation before it stays, and the message comes back in the message box.
// Usage: npx vite build && npx electron scripts/checks/rewind-check.js
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { tempDir } = require('./temp');
const { install } = require('./fakes');

const profile = tempDir('rewind-profile');
const project = tempDir('rewind-project');
const outDir = path.join(__dirname, '..', '..', 'dist', 'rewind-check');
fs.mkdirSync(outDir, { recursive: true });

const director = {
  histories: [],
  transcripts: new Map(),
  forkDelay: 600, // reading the copy takes a moment, as it does for real
  script: (_c, text) => async (c) => {
    await c.think(100);
    await c.say(`Answer to: ${text}\n\n${Array.from({ length: 6 }, (_, i) => `Line ${i + 1} of it.`).join('\n\n')}`, { cps: 2000 });
    c.finish(0.01);
  },
  prompt: () => '', shell: () => '', cli: () => '',
};
install(director);

fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  language: 'en', uiScale: 100, theme: 'light', confirmClose: false, notify: false, trustedFolders: [project],
  recent: [{ path: project, at: Date.now() }],
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
  const until = async (label, condition, timeout = 15000) => {
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
    await js(`{ const el = document.querySelector('.chat-composer .composer-input'); el.focus(); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); } true`);
    await wait(80);
    await js("document.querySelector('.chat-composer .composer-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); true");
    await until(`the answer to ${text}`, `${idle} && /Answer to: ${text}/.test(document.querySelector('.timeline').textContent)`);
    await wait(300);
  };
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });

  win.webContents.once('did-finish-load', async () => {
    try {
      await until('the project', "Boolean(document.querySelector('#sidebar .folder .folder-add'))");
      await js("document.querySelector('#sidebar .folder .folder-add').click(); true");
      await until('the chat', "Boolean(document.querySelector('.chat-composer .composer-input'))");
      await wait(800);
      await say('First question');
      await say('Second question');

      // What comes before the message is marked, to see it is still the same on screen afterwards.
      await js("document.querySelectorAll('.timeline > *').forEach((el, i) => { if (i < 3) el.dataset.before = 'yes'; }); true");
      const earlier = await js("[...document.querySelectorAll('[data-before]')].map((el) => el.textContent).join('|')");
      // Every frame from the click until the message is back in the box: what the chat shows.
      const frames = js(`new Promise((done) => { const out = []; const t0 = performance.now();
        const f = () => { const tl = document.querySelector('.timeline'); const box = document.querySelector('.chat-composer .composer-input');
          const second = [...document.querySelectorAll('.msg-user-wrap')].find((w) => w.textContent.includes('Second question'));
          out.push({ empty: Boolean(document.querySelector('.chat.empty')) || !tl || !/First question/.test(tl.textContent),
            rewinding: /Rewinding/.test(document.querySelector('.activity')?.textContent || ''),
            secondHeight: second ? Math.round(second.getBoundingClientRect().height) : -1, back: box?.value === 'Second question' });
          if (box?.value === 'Second question' || performance.now() - t0 > 8000) done(out); else requestAnimationFrame(f); };
        requestAnimationFrame(f); })`);
      await js("[...document.querySelectorAll('.msg-user-wrap')].find((w) => w.textContent.includes('Second question')).querySelector('.msg-actions .icon-btn[title^=\"Edit and resend\"]').click(); true");
      await wait(250);
      await shot('1-rewinding');
      const seen = await frames;
      const heights = [...new Set(seen.map((f) => f.secondHeight).filter((h) => h >= 0))];
      check('the chat is never empty on the way', seen.length > 5 && !seen.some((f) => f.empty), `${seen.length} frames, ${seen.filter((f) => f.empty).length} empty`);
      check('it says “Rewinding…” meanwhile', seen.some((f) => f.rewinding), `${seen.filter((f) => f.rewinding).length} frames`);
      check('the message and what followed fold away rather than vanish', heights.length >= 3 && Math.min(...heights) < Math.max(...heights) / 2, heights.slice(0, 10).join(' '));
      check('the message comes back in the message box', seen.at(-1)?.back === true);
      await wait(800);
      const after = JSON.parse(await js(`JSON.stringify({ text: document.querySelector('.timeline').textContent, messages: document.querySelectorAll('.msg-user-wrap').length,
        rewinding: Boolean(document.querySelector('.activity')), divider: Boolean(document.querySelector('.timeline .divider')),
        kept: [...document.querySelectorAll('[data-before]')].map((el) => el.textContent).join('|') })`));
      check('the conversation before it stays, and nothing after it', /Answer to: First question/.test(after.text) && !/Second question/.test(after.text) && after.messages === 1 && !after.rewinding,
        JSON.stringify({ ...after, text: undefined, kept: undefined }));
      check('what came before is untouched: the same rows on screen, as they were, with no divider added', after.kept === earlier && earlier.length > 0 && !after.divider,
        JSON.stringify({ divider: after.divider, same: after.kept === earlier }));
      await shot('2-after');
      await say('Second question, edited');
      check('sending again continues from there', await js("document.querySelectorAll('.msg-user-wrap').length === 2"));
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
