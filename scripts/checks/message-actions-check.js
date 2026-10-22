// End-to-end check of Stop with a queued message, and of the actions on a sent message (edit and resend
// with file undo, fork). Launches the built app with a throwaway profile and project, drives a real chat
// on Haiku, and saves screenshots. Usage: npx vite build && npx electron scripts/checks/message-actions-check.js
// (writes dist/message-actions/*.png; costs a few cents)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const { tempDir } = require('./temp');

const outDir = path.join(__dirname, '..', '..', 'dist', 'message-actions');
const profile = tempDir('actions-profile');
const project = tempDir('actions-project');
const notes = path.join(project, 'notes.txt');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(notes, 'alpha\n');
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  language: 'en', uiScale: 100, theme: 'dark', confirmClose: false, notify: false, defaultModel: 'haiku', defaultPermissionMode: 'bypassPermissions',
  recent: [{ path: project, at: Date.now() }],
  trustedFolders: [project], // a throwaway folder: skip the trust prompt
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
  const busy = "Boolean(document.querySelector('.send-btn.stop') || document.querySelector('.activity'))";
  const setDraft = (text) => js(`{
    const el = document.querySelector('.chat-composer .composer-input');
    el.value = ${JSON.stringify(text)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }`);
  const say = async (text) => {
    await setDraft(text);
    await wait(80);
    await js("document.querySelector('.chat-composer .composer-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))");
  };
  const userTexts = () => js("[...document.querySelectorAll('.msg-user-text')].map((e) => e.textContent)");
  const replies = () => js("[...document.querySelectorAll('.msg-text')].map((e) => e.textContent).join(' | ')");
  const draft = () => js("document.querySelector('.chat-composer .composer-input').value");
  const menu = async (index, label) => {
    await js(`document.querySelectorAll('.msg-user-wrap')[${index}].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 600, clientY: 300 }))`);
    await wait(200);
    await js(`[...document.querySelectorAll('.context-menu button')].find((b) => b.textContent.includes(${JSON.stringify(label)})).click()`);
  };
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });

  win.webContents.once('did-finish-load', async () => {
    try {
      await js('window.confirm = () => true; true');
      await wait(1200);
      await js("document.querySelector('.empty-recent .primary-btn').click()");
      await until('chat ready', "Boolean(document.querySelector('.chat-composer .composer-input'))");
      await wait(4000);

      // 1. Stop while a message is queued: the queued one is cancelled and comes back to the message box.
      await say('Run the shell command `sleep 20` with the Bash tool, then reply with the single word SLEPT.');
      await until('the Bash call', "document.querySelectorAll('.tool').length > 0");
      await say('Reply with the single word QUEUED.');
      await until('queued badge', "Boolean(document.querySelector('.msg-queued'))", 5000);
      await wait(300);
      console.log('while queued:', await js(`JSON.stringify({ queued: [...document.querySelectorAll('.msg-queued')].map((e) => e.closest('.msg-user').textContent),
        box: document.querySelector('.chat-composer .composer-input').value })`));
      await js("document.querySelector('.msg-queued')?.scrollIntoView({ block: 'center' }); true");
      await wait(300);
      await shot('1-queued');
      await wait(1500);
      await js("document.querySelector('.chat-composer .composer-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
      await until('stopped', `!${busy}`, 20000);
      await wait(8000); // a queued turn would have started by now
      const texts = await userTexts();
      check('Stop removed the queued message from the chat', !texts.some((t) => t.includes('QUEUED')), JSON.stringify(texts));
      check('the queued message is back in the message box', (await draft()).includes('QUEUED'), JSON.stringify(await draft()));
      check('no turn ran after Stop', !/QUEUED/.test(await replies()), await replies());
      await shot('2-after-stop');
      await setDraft('');

      // 2. Two turns, the second changes a file; then "Edit and resend, undo file changes" on the second.
      await say('Reply with the single word ONE.');
      await until('turn ONE', `/\\bONE\\b/.test([...document.querySelectorAll('.msg-text')].map((e) => e.textContent).join(' ')) && !${busy}`);
      await say('Use the Write tool to overwrite notes.txt so it contains only the word CHANGED. Then reply with the single word TWO.');
      await until('turn TWO', `/\\bTWO\\b/.test([...document.querySelectorAll('.msg-text')].map((e) => e.textContent).join(' ')) && !${busy}`);
      check('Claude changed the file', fs.readFileSync(notes, 'utf8').includes('CHANGED'));
      const before = (await userTexts()).length;
      // Expand / collapse animation: sample the height of the "Worked…" steps while opening and closing.
      const sample = (label) => js(`new Promise((done) => {
        const out = []; const t0 = performance.now();
        const tick = () => {
          const c = [...document.querySelectorAll('.work-steps')].at(-1)?.closest('.collapse');
          out.push(c ? Math.round(c.getBoundingClientRect().height) : 'gone');
          if (performance.now() - t0 < 420) requestAnimationFrame(tick); else done(out);
        };
        [...document.querySelectorAll('.work-summary')].at(-1).click();
        requestAnimationFrame(tick);
      })`).then((h) => { console.log(label, h.filter((x, i) => i % 3 === 0).join(' ')); return h; });
      const opening = await sample('opening heights:');
      await shot('3-two-turns');
      const closing = await sample('closing heights:');
      const grows = opening.filter((x) => typeof x === 'number');
      check('opening animates (height grows over several frames)', new Set(grows).size > 3 && grows.at(-1) > grows[0], `${grows[0]}→${grows.at(-1)}`);
      check('closing animates, then the steps unmount', new Set(closing.filter((x) => typeof x === 'number')).size > 3 && closing.at(-1) === 'gone');
      await menu(before - 1, 'Edit and resend, undo file changes');
      await until('rewound', `document.querySelectorAll('.msg-user-text').length === ${before - 1} && Boolean(document.querySelector('.chat-composer .composer-input').value)`, 30000);
      await wait(1500);
      check('file restored', fs.readFileSync(notes, 'utf8') === 'alpha\n', JSON.stringify(fs.readFileSync(notes, 'utf8')));
      check('the message is back in the message box for editing', (await draft()).includes('CHANGED'), JSON.stringify(await draft()));
      check('the conversation ends before it', !/\bTWO\b/.test(await replies()), await replies());
      await shot('4-rewound');
      await setDraft('');
      await say('Which single words have you replied with so far in this conversation? Answer with just those words, comma separated.');
      await until('memory answer', `!${busy} && /,|ONE/.test([...document.querySelectorAll('.msg-text')].at(-1)?.textContent || '')`);
      const answer = await js("[...document.querySelectorAll('.msg-text')].at(-1).textContent");
      check('Claude remembers the kept turn and not the rewound one', /ONE/.test(answer) && !/TWO/.test(answer), JSON.stringify(answer));

      // 3. Fork from the "ONE" message into a new session.
      const sessionsBefore = await js("document.querySelectorAll('.session').length");
      const idx = await js("[...document.querySelectorAll('.msg-user-text')].findIndex((e) => e.textContent.includes('single word ONE'))");
      await menu(idx, 'Fork into a new chat');
      await until('forked session', `document.querySelectorAll('.session').length === ${sessionsBefore + 1}`, 30000);
      await until('forked draft', "document.querySelector('.chat-composer .composer-input')?.value.includes('ONE')", 20000);
      check('fork opened a new session with the message in its box', (await draft()).includes('ONE'), JSON.stringify(await draft()));
      await shot('5-forked');
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
