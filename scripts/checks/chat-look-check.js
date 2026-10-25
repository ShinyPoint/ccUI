// Visual check of the chat, without API usage: Claude is scripted (fakes.js). Sends a few messages,
// checks that new items animate in and that the view eases down to them instead of jumping, opens the
// Terminal panel under the chat, and saves screenshots in dark and light.
// Usage: npx vite build && npx electron scripts/checks/chat-look-check.js   (writes dist/chat-look/*.png)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, clipboard } = require('electron');
const { tempDir } = require('./temp');
const { install } = require('./fakes');

const outDir = path.join(__dirname, '..', '..', 'dist', 'chat-look');
const profile = tempDir('look-profile');
const project = tempDir('look-project');
const other = tempDir('look-other'); // a second project, for a second session (one project has one new chat)
const chats = tempDir('look-chats'); // where New session's chats without a project go (not the real ~/ccUI)
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

// Math the way a problem statement writes it, with what must stay text: prices, shell variables, TeX that doesn't
// parse, and TeX that asks for a link.
const MATH = [
  '## 问题陈述',
  '',
  '在 xy 平面上有 $N$ 个点，点 $i$ 的坐标为 $(i, A_i)$。',
  '',
  '- $2 \\le N \\le 100$',
  '- $1 \\le A_i \\le 100$（$1 \\le i \\le N$）',
  '',
  'The total is',
  '$$',
  '\\sum_{i=1}^{N} \\frac{A_i}{2}',
  '$$',
  '',
  'It costs $5 and $10; set $HOME/$USER. Broken: $\\frac{1$. Linked: $\\href{https://example.com}{x}$.',
].join('\n');

install({
  histories: [],
  transcripts: new Map(),
  // Enough of them for the context pop-up to be taller than its room (it scrolls then).
  contextRows: [{ name: 'Skills', tokens: 2400, kind: 'used' }, { name: 'Custom agents', tokens: 800, kind: 'used' }],
  script: () => async (c, text) => {
    await c.think(300);
    if (/big file/.test(text)) {
      // A step that fills the context, then a slow answer: the context ring moves before the turn ends.
      await c.tool('Read', { file_path: c.file('big.txt') }, { run: 200, result: 'x'.repeat(30000) });
      await c.say('Read it all, now going through it.', { cps: 10 });
    } else if (/templates/.test(text)) {
      // The answer, then a little tidying up (a note in memory) and a last line: the answer stays the answer.
      await c.say('## Binary search\n\nThe condition must be monotonic:\n\n```\nF F F T T T\n```\n\n- first true\n- last true\n- on the answer', { cps: 1500 });
      await c.tool('Edit', { file_path: c.file('memory.md'), old_string: 'a', new_string: 'b' }, { run: 150, result: 'ok' });
      await c.think(150);
      await c.say('I also noted that templates get comments.', { cps: 600 });
    } else if (/what you think/.test(text)) {
      // A step described in words, thinking in words, and thinking without words that took no time.
      await c.think(1500, '**Checking the build**\n\nThe build script lives in package.json.');
      await c.think(0);
      await c.tool('Bash', { command: 'npm run build -- --mode production', description: 'Build the app for production' }, { run: 2500, result: 'built' });
      await c.think(200, '**Reading the output**\n\nTwo files changed.');
      await c.tool('Read', { file_path: c.file('notes.md') }, { run: 100 });
      await c.tool('Read', { file_path: c.file('notes.md'), offset: 1, limit: 2 }, { run: 100 });
      await c.say('Built.', { cps: 600 });
    } else if (/math/.test(text)) {
      await c.say(MATH, { cps: 1500 });
    } else if (/code block/.test(text)) {
      await c.say('Compile it with:\n\n```\ng++ "{source_file}" -std=c++17 -o "{file_name}"\n```', { cps: 600 });
    } else if (/long/.test(text)) {
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
  language: 'en', uiScale: 100, theme: 'dark', confirmClose: false, notify: false, sidebarGlass: true, fillEdge: false, // the gaps are measured with it off
  recent: [{ path: project, at: Date.now() }, { path: other, at: Date.now() - 1000 }], trustedFolders: [project, other],
  chatsFolder: chats,
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

      // A new chat: the question right above the message box, the two together in the middle; the question in
      // plain UI type, without the app's mark; the project and Chat as chips over the message box; the paperclip
      // first in the message box's bar, left of the permission mode.
      const intro = JSON.parse(await js(`JSON.stringify((() => { const chat = document.querySelector('.chat').getBoundingClientRect();
        const box = document.querySelector('.chat-composer').getBoundingClientRect(); const h2 = document.querySelector('.chat-intro h2');
        const h = h2.getBoundingClientRect(); const bar = document.querySelector('.composer-bar');
        const chips = [...document.querySelectorAll('.intro-chips .menu-text')].map((c) => c.textContent);
        return { boxMid: Math.round(box.top + box.height / 2 - chat.top), chatH: Math.round(chat.height), gap: Math.round(box.top - h.bottom),
          title: Math.round(h.height), mark: Boolean(document.querySelector('.chat-intro .intro-mark, .chat-intro img')),
          clipFirst: (([first, second]) => Boolean(first?.matches('.icon-btn') && second?.classList.contains('mode-menu')))([...bar.children].filter((e) => !e.hidden)),
          font: getComputedStyle(h2).fontFamily.split(',')[0], weight: getComputedStyle(h2).fontWeight, chips }; })())`));
      check('a new chat has the message box in the middle, the question right above it', Math.abs(intro.boxMid - intro.chatH / 2) < intro.chatH * 0.2 && intro.gap >= 0 && intro.gap < 90, JSON.stringify(intro));
      check('the question is plain UI type, regular weight, with no mark', intro.title < 50 && !intro.mark && !/Serif/.test(intro.font) && intro.weight === '400', JSON.stringify(intro));
      check('the paperclip comes first in the message box, left of the permission mode', intro.clipFirst, JSON.stringify(intro));
      check('over the message box: the project and Chat as chips', intro.chips.length === 2 && intro.chips[0] === path.basename(project) && intro.chips[1] === 'Chat', JSON.stringify(intro.chips));
      await shot('0-new-chat-dark');
      // An image attached in the message box stays there while another session is shown.
      await js(`(async () => { const c = document.createElement('canvas'); c.width = c.height = 8; const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
        const dt = new DataTransfer(); dt.items.add(new File([blob], 'dot.png', { type: 'image/png' }));
        const input = document.querySelector('.chat-composer input[type=file]'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); })(); true`);
      await until('the attached image', "document.querySelectorAll('.chat-composer .attachment').length === 1", 5000);
      await js("document.querySelector('#topbar .project-menu .menu-button').click(); true");
      await until('the folder list', "Boolean(document.querySelector('#topbar .project-menu .menu-list'))", 3000);
      await js(`[...document.querySelectorAll('#topbar .project-menu .menu-list button')].find((b) => b.textContent.includes(${JSON.stringify(path.basename(other))})).click(); true`);
      await until('a second session', "document.querySelectorAll('#sidebar .session').length === 2", 10000);
      await wait(800);
      await js(`[...document.querySelectorAll('#sidebar .folder')].find((f) => f.textContent.includes(${JSON.stringify(path.basename(project))})).querySelector('.session-main').click(); true`);
      await wait(800);
      check('an attached image is still there after switching away and back', await js("document.querySelectorAll('.chat-composer .attachment').length === 1"));
      await js("document.querySelector('.chat-composer .attachment .icon-btn').click(); true");
      await wait(200);
      const centered = await js("Math.round(document.querySelector('.chat-bottom').getBoundingClientRect().top)");

      await say('What is left in notes.md?');
      // The box slides down to the bottom rather than jumping there.
      // (and your message pops in meanwhile)
      const slideRun = await js(`new Promise((done) => { const out = []; let popped = false; const t0 = performance.now();
        const f = () => { out.push(Math.round(document.querySelector('.chat-bottom').getBoundingClientRect().top));
          popped = popped || Boolean(document.querySelector('.msg-user-wrap.enter'));
          if (performance.now() - t0 < 500) requestAnimationFrame(f); else done({ out, popped }); };
        requestAnimationFrame(f); })`);
      const slide = slideRun.out;
      check('after the first message the box slides down to the bottom', slide.some((y) => y > centered + 10 && y < slide.at(-1) - 10) && slide.at(-1) > centered + 100,
        `${centered} → ${slide.filter((y, i) => y !== slide[i - 1]).slice(0, 8).join(' ')}`);
      check('your message pops in', slideRun.popped);
      const bubble = await js(`{ const b = document.querySelector('.msg-user').getBoundingClientRect();
        const t = document.querySelector('.timeline').getBoundingClientRect();
        JSON.stringify({ right: Math.round(t.right - b.right), width: Math.round(b.width), timeline: Math.round(t.width) }) }`);
      const { right, width, timeline } = JSON.parse(bubble);
      check('your message is a bubble on the right, sized to its text', right < 40 && width < timeline * 0.6, bubble);
      await until('the reply', `${idle} && /start on it/.test(document.querySelector('.msg-text')?.textContent || '')`);
      await wait(600);
      await shot('1-chat-dark');
      // Under the answer, at its left: Copy, which takes the answer and not the steps.
      const foot = JSON.parse(await js(`JSON.stringify((() => { const b = document.querySelector('.turn-foot .answer-actions .icon-btn'); if (!b) return null;
        const text = [...document.querySelectorAll('.msg-text')].at(-1).getBoundingClientRect(); const icon = b.querySelector('svg').getBoundingClientRect();
        return { left: Math.round(icon.left - text.left), below: Math.round(b.getBoundingClientRect().top - text.bottom) }; })())`));
      check('a finished answer has Copy under it, at its left', Boolean(foot) && Math.abs(foot.left) <= 2 && foot.below > -10 && foot.below < 12, JSON.stringify(foot));
      clipboard.writeText('');
      await js("document.querySelector('.turn-foot .answer-actions .icon-btn').click(); true");
      await wait(200);
      const copiedAnswer = await clipboard.readText();
      check('Copy takes the answer, without the steps', copiedAnswer === REPLY.trim(), JSON.stringify(copiedAnswer.slice(0, 60)));
      check('and shows it did', await js("Boolean(document.querySelector('.answer-actions .copied'))"));

      // Times: your message's and the answer's, each shown only while pointed at.
      const mouse = (x, y) => win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
      const center = async (sel) => JSON.parse(await js(`JSON.stringify((() => { const r = [...document.querySelectorAll(${JSON.stringify(sel)})].at(-1).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })())`));
      const timeShown = (sel) => js(`{ const t = [...document.querySelectorAll(${JSON.stringify(sel)})].at(-1); t && /\\d:\\d\\d/.test(t.textContent) ? Number(getComputedStyle(t).opacity) * Number(getComputedStyle(t.parentElement).opacity) : -1 }`);
      mouse(5, 5);
      await wait(300);
      const hidden = [await timeShown('.msg-user-wrap .msg-time'), await timeShown('.answer .msg-time')];
      mouse(...(await center('.msg-user')));
      await wait(350);
      const userTime = await timeShown('.msg-user-wrap .msg-time');
      mouse(...(await center('.answer .msg-text')));
      await wait(350);
      const answerTime = await timeShown('.answer .msg-time');
      check('your message and the answer have their time, hidden until pointed at', hidden[0] === 0 && hidden[1] === 0 && userTime === 1 && answerTime === 1,
        `hidden ${hidden}, pointed ${userTime} ${answerTime}`);
      await shot('1b-answer-time');
      mouse(5, 5);

      // A long reply: the view should ease down, not jump.
      await say('Give me a long answer.');
      await wait(300);
      const row = JSON.parse(await js(`JSON.stringify((() => { const r = document.querySelector('#sidebar .session[aria-current="true"]');
        const icon = r.querySelector('.session-icon').getBoundingClientRect(); const name = r.querySelector('.session-name').getBoundingClientRect();
        const label = document.querySelector('#sidebar .section-label');
        const range = document.createRange(); range.selectNodeContents(label.firstChild);
        // Where the ink starts: the icon's strokes (their geometry less half the stroke), the heading's first letter.
        const ink = (svg) => { const k = svg.getBoundingClientRect().width / 24;
          return Math.min(...[...svg.children].map((c) => c.getBoundingClientRect().left)) - Number(svg.getAttribute('stroke-width')) / 2 * k; };
        const ctx = document.createElement('canvas').getContext('2d'); const ls = getComputedStyle(label);
        ctx.font = ls.fontWeight + ' ' + ls.fontSize + ' ' + ls.fontFamily;
        const labelInk = range.getBoundingClientRect().left - ctx.measureText(label.firstChild.textContent.trim()[0]).actualBoundingBoxLeft;
        const off = (sel) => Math.round((ink(document.querySelector(sel)) - labelInk) * 10) / 10;
        return { spin: Boolean(r.querySelector('.session-spin')), onIcon: r.querySelector('.session-icon').children.length, iconH: Math.round(icon.height),
          middle: Math.abs((icon.top + icon.bottom) / 2 - (name.top + name.bottom) / 2) < 2, words: Boolean(r.querySelector('.state-word, .session-sub')),
          newSession: off('.new-session .icon'), skills: off('.sidebar-link .icon'), newWeight: getComputedStyle(document.querySelector('.new-session')).fontWeight,
          newFill: getComputedStyle(document.querySelector('.new-session')).backgroundColor, counts: document.querySelectorAll('.folder-row .count').length }; })())`));
      check('a working session shows a spinner at the right, and nothing on its icon or in words', row.spin && row.onIcon === 1 && !row.words, JSON.stringify(row));
      check('its icon is the text’s size, beside it', row.iconH <= 16 && row.middle, JSON.stringify(row));
      check('New session: no fill, regular weight; its icon and Skills’ start where Projects does', Math.abs(row.newSession) <= .6 && Math.abs(row.skills) <= .6 && row.newWeight === '400' && /rgba\(0, 0, 0, 0\)|transparent/.test(row.newFill), JSON.stringify(row));
      check('project folders show no session count', row.counts === 0);
      // Pointing at a row shows its ×, the title stopping short of it; pointed at, the × brightens, with no fill.
      const closeLook = async () => JSON.parse(await js(`JSON.stringify((() => { const r = document.querySelector('#sidebar .session[aria-current="true"]'); const x = r.querySelector('.session-close');
        const name = r.querySelector('.session-name'); const cs = getComputedStyle(x);
        return { shown: cs.opacity, fill: cs.backgroundColor, color: cs.color, gap: Math.round(x.getBoundingClientRect().left - name.getBoundingClientRect().right) }; })())`));
      mouse(...(await center('#sidebar .session[aria-current="true"] .session-name')));
      await wait(300);
      const onRow = await closeLook();
      mouse(...(await center('#sidebar .session[aria-current="true"] .session-close')));
      await wait(300);
      const onX = await closeLook();
      check('pointing at a row shows its ×, clear of the title', onRow.shown === '1' && onRow.gap >= 0, JSON.stringify(onRow));
      check('pointed at, the × brightens with no circle behind it', /rgba\(0, 0, 0, 0\)|transparent/.test(onX.fill) && onX.color !== onRow.color, JSON.stringify({ onRow, onX }));
      mouse(5, 5);
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

      // The history rail: pointing at the chat's right edge shows a tick per message of yours and a button; the list
      // it opens jumps to one; Esc closes it, and Esc Esc in the empty message box opens it.
      const rail = JSON.parse(await js(`JSON.stringify((() => { const r = document.querySelector('.history-rail')?.getBoundingClientRect(); return r ? [r.right - 6, r.top + r.height / 2] : null; })())`));
      check('a conversation with two messages of yours has the history rail', Boolean(rail));
      const ticks = () => js("JSON.stringify([...document.querySelectorAll('.history-tick')].map((t) => getComputedStyle(t).opacity))");
      const ticksBefore = await ticks();
      mouse(...rail);
      await wait(350);
      const pointed = await ticks();
      check('its ticks show only while pointed at, one per message', ticksBefore === '["0","0"]' && pointed === '["1","1"]', `${ticksBefore} → ${pointed}`);
      await js("document.querySelector('.history-open').click(); true");
      await until('the list', "document.querySelectorAll('.history-item').length === 2", 3000);
      await wait(300);
      check('the list has your messages, the one in view marked', (await js("[...document.querySelectorAll('.history-item')].map((b) => b.querySelector('.history-text').textContent).join(' | ')")) === 'What is left in notes.md? | Give me a long answer.'
        && await js("document.querySelectorAll('.history-item')[1].classList.contains('current')"));
      await shot('2a-history');
      await js("document.querySelectorAll('.history-item')[0].click(); true");
      await wait(1200);
      const jumped = JSON.parse(await js(`JSON.stringify((() => { const el = document.querySelector('.chat-scroll'); const m = document.querySelector('.msg-user-wrap').getBoundingClientRect();
        return { offset: Math.round(m.top - el.getBoundingClientRect().top), fromBottom: Math.round(el.scrollHeight - el.clientHeight - el.scrollTop) }; })())`));
      check('choosing one brings it to the top of the view, and the view stays there', jumped.offset >= 0 && jumped.offset < 60 && jumped.fromBottom > 200, JSON.stringify(jumped));
      await wait(800);
      check('(it is not pulled back to the bottom)', Math.round(await js("document.querySelector('.chat-scroll').scrollHeight - document.querySelector('.chat-scroll').clientHeight - document.querySelector('.chat-scroll').scrollTop")) === jumped.fromBottom);
      await js("document.querySelector('.history-panel').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
      await until('the list to close', "!document.querySelector('.history-panel')", 3000);
      const esc = "document.querySelector('.chat-composer .composer-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true";
      await js(esc);
      await wait(120);
      await js(esc);
      await until('the list from Esc Esc', "Boolean(document.querySelector('.history-panel'))", 3000);
      check('Esc twice in the empty message box opens the list', await js("Boolean(document.querySelector('.history-panel'))"));
      await js("document.querySelector('.history-panel .history-head .icon-btn').click(); true");
      await until('the list to close again', "!document.querySelector('.history-panel')", 3000);
      mouse(5, 5);
      await js("{ const el = document.querySelector('.chat-scroll'); el.scrollTop = el.scrollHeight; } true");
      await wait(400);

      // A code block without a language says Plain text; its head is the body's color; a glow lifts it.
      await say('Show me a code block.');
      await until('the code block', `${idle} && Boolean([...document.querySelectorAll('.code-block')].at(-1)?.textContent.includes('g++'))`);
      const block = JSON.parse(await js(`JSON.stringify((() => { const b = [...document.querySelectorAll('.code-block')].at(-1); const h = b.querySelector('.code-head');
        return { label: h.querySelector('span').textContent, head: getComputedStyle(h).backgroundColor, body: getComputedStyle(b).backgroundColor, shadow: getComputedStyle(b).boxShadow,
          weight: getComputedStyle(h).fontWeight }; })())`));
      check('a code block without a language is labeled Plain text', block.label === 'Plain text', block.label);
      check('its head is the color of the code under it, with a glow around the block', /rgba\(0, 0, 0, 0\)|transparent/.test(block.head) && block.shadow !== 'none' && Number(block.weight) <= 500, JSON.stringify(block));
      await shot('2c-code-block');

      // Math in Claude's answers is typeset (KaTeX, in its own fonts); prices, shell variables and broken TeX stay text.
      await say('Show me some math.');
      await until('the math', `${idle} && Boolean([...document.querySelectorAll('.msg-text .md')].at(-1)?.querySelector('.katex-display'))`);
      const math = JSON.parse(await js(`(async () => { await document.fonts.ready; const md = [...document.querySelectorAll('.msg-text .md')].at(-1);
        const text = md.querySelector('p:last-of-type').textContent;
        return JSON.stringify({ inline: md.querySelectorAll('.katex:not(.katex-display .katex)').length, display: md.querySelectorAll('.katex-display').length,
          sum: md.querySelector('.katex-display')?.textContent.includes('∑'), paragraph: [...md.querySelectorAll('p')].some((p) => p.textContent.trim() === 'The total is'),
          raw: /\\$N\\$|\\$\\$/.test(md.textContent.replace(/\\$5|\\$10|\\$HOME|\\$USER|\\$\\\\frac\\{1\\$|\\$\\\\href[^$]*\\$/g, '')), text,
          positioned: Boolean(md.querySelector('.katex-html [style]')), links: md.querySelectorAll('.katex a').length,
          font: [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'KaTeX_Main' && f.status === 'loaded') }); })()`));
      check('inline math ($…$) is typeset, Chinese punctuation after it included', math.inline >= 6 && !math.raw, JSON.stringify({ inline: math.inline, raw: math.raw }));
      check('display math ($$ on its own lines) is typeset as a block, after the paragraph before it', math.display === 1 && math.sum && math.paragraph, JSON.stringify({ display: math.display, sum: math.sum }));
      check('formulas keep KaTeX’s layout and load its fonts', math.positioned && math.font, JSON.stringify({ positioned: math.positioned, font: math.font }));
      check('prices, shell variables, TeX that doesn’t parse and TeX asking for a link stay as written',
        /costs \$5 and \$10; set \$HOME\/\$USER\. Broken: \$\\frac\{1\$\. Linked: \$\\href\{https:\/\/example\.com\}\{x\}\$\./.test(math.text) && math.links === 0,
        JSON.stringify({ text: math.text.slice(0, 120), links: math.links }));
      await shot('2d-math');

      // A step's description instead of its command, swept by a light while it runs; thinking shows what was thought.
      await say('Tell me what you think.');
      await until('the thinking', "/Checking the build/.test(document.querySelector('.timeline').textContent)", 8000);
      const live = JSON.parse(await js(`JSON.stringify((() => { const h = [...document.querySelectorAll('.thinking-head')].at(-1); const cs = getComputedStyle(h);
        return { text: h.textContent, font: cs.fontFamily.split(',')[0], sweep: cs.animationName }; })())`));
      check('thinking shows what Claude thought, in the conversation’s type, swept while it goes on', live.text === 'Checking the build' && !/Mono/.test(live.font) && live.sweep === 'sweep', JSON.stringify(live));
      await js("[...document.querySelectorAll('.work-summary')].at(-1)?.getAttribute('aria-expanded') === 'false' && [...document.querySelectorAll('.work-summary')].at(-1).click(); true");
      await until('the step', "[...document.querySelectorAll('.tool-target')].some((x) => x.textContent === 'Build the app for production')", 8000);
      const step = JSON.parse(await js(`JSON.stringify((() => { const x = [...document.querySelectorAll('.tool-target')].find((e) => e.textContent === 'Build the app for production'); const cs = getComputedStyle(x);
        return { font: cs.fontFamily.split(',')[0], sweep: cs.animationName, tip: x.closest('.tool-head').title }; })())`));
      check('a command Claude described shows the description, not the command, in the conversation’s type', !/Mono/.test(step.font) && /npm run build/.test(step.tip), JSON.stringify(step));
      check('while it runs a light sweeps across it', step.sweep === 'sweep', step.sweep);
      // While it runs, the thought (no ✻ by default) starts where the step's glyph does, in the step's size, and the
      // two rows' words share a middle line with the glyph.
      const rows = JSON.parse(await js(`JSON.stringify((() => {
        const think = [...document.querySelectorAll('.thinking')].at(-1); const tool = [...document.querySelectorAll('.tool')].find((x) => x.textContent.includes('Build the app'));
        const box = (el) => el.getBoundingClientRect(); const mid = (el) => box(el).top + box(el).height / 2;
        const words = think.querySelector('.thinking-head'); const glyph = tool.querySelector('.tool-glyph'); const target = tool.querySelector('.tool-target');
        return { start: Math.round(box(words).left - box(glyph).left), size: [getComputedStyle(words).fontSize, getComputedStyle(target).fontSize],
          middle: Math.round(mid(glyph) - mid(target)) }; })())`));
      check('the running thought starts where the step’s glyph does, in the same size, the glyph centered on its words',
        Math.abs(rows.start) <= 1 && rows.size[0] === rows.size[1] && Math.abs(rows.middle) <= 1, JSON.stringify(rows));
      await shot('2e-step-running');
      await until('the turn', `${idle} && /Built\./.test(document.querySelector('.timeline').textContent)`);
      await wait(400);
      await js("{ const w = [...document.querySelectorAll('.work-summary')].at(-1); if (w && w.getAttribute('aria-expanded') === 'false') w.click(); } true");
      await until('the steps again', "[...document.querySelectorAll('.tool-target')].some((x) => x.textContent === 'Build the app for production')", 5000);
      const after = JSON.parse(await js(`JSON.stringify({ zero: [...document.querySelectorAll('.thinking')].some((x) => /Thought for/.test(x.textContent)),
        sweep: getComputedStyle([...document.querySelectorAll('.tool-target')].find((e) => e.textContent === 'Build the app for production')).animationName })`));
      check('no “Thought for 0 ms” rows, and the light stops when it is done', !after.zero && after.sweep === 'none', JSON.stringify(after));
      // The turn's steps and thoughts make one even column, with no lines between them: each row's middle the same
      // distance from the next. Claude's ✻ is off by default and a thought then starts where the steps' glyphs do;
      // on in Settings, the ✻ takes that place and the thought's words line up with the steps'.
      const column = async () => JSON.parse(await js(`JSON.stringify((() => {
        const steps = [...document.querySelectorAll('.work-steps')].at(-1);
        const rows = [...steps.children].filter((x) => x.matches('.tool, .thinking'));
        const box = (el) => el.getBoundingClientRect();
        const mid = (el) => { const r = box(el); return r.top + r.height / 2; };
        const parts = rows.map((r) => ({ kind: r.classList.contains('tool') ? 'step' : 'thought', words: r.querySelector('.tool-target, .thinking-head') }));
        const mids = parts.map((p) => mid(p.words));
        const left = (sel) => [...new Set([...steps.querySelectorAll(sel)].map((e) => Math.round(box(e).left)))];
        return { kinds: parts.map((p) => p.kind).join(' '), pitch: mids.slice(1).map((m, i) => Math.round(m - mids[i])),
          glyphs: left(':scope > .tool .tool-glyph'), stepWords: left(':scope > .tool .tool-target'), thoughtWords: left(':scope > .thinking .thinking-head'),
          mark: getComputedStyle(steps.querySelector('.thinking-mark')).display,
          lines: rows.filter((r) => getComputedStyle(r, '::before').content !== 'none').length }; })())`));
      const plain = await column();
      check('steps and thoughts make one even column, with no lines between them',
        plain.kinds === 'thought step thought step step' && new Set(plain.pitch).size === 1 && plain.lines === 0, JSON.stringify(plain));
      check('without Claude’s ✻ by default, a thought starts where the steps’ glyphs do',
        plain.mark === 'none' && plain.glyphs.length === 1 && plain.thoughtWords.length === 1 && Math.abs(plain.thoughtWords[0] - plain.glyphs[0]) <= 1, JSON.stringify(plain));
      await js("[...document.querySelectorAll('.work-steps')].at(-1).scrollIntoView({ block: 'center' }); true");
      await wait(300);
      await shot('2f-steps-column-plain');
      await js("document.querySelector('#sidebar .sidebar-bottom .settings-btn, #sidebar .sidebar-bottom button').click(); true");
      await until('Settings', "Boolean(document.querySelector('.dialog-settings[open]'))", 5000);
      await js("[...document.querySelectorAll('.settings-nav button')].find((b) => /Appearance/.test(b.textContent)).click(); true");
      await until('the switch', "[...document.querySelectorAll('.dialog-settings .set-row')].some((r) => /before Claude/.test(r.textContent))", 5000);
      await js("[...document.querySelectorAll('.dialog-settings .set-row')].find((r) => /before Claude/.test(r.textContent)).querySelector('.switch input').click(); true");
      await wait(200);
      await js("document.querySelector('.dialog-settings button[type=submit].primary-btn').click(); true");
      await wait(400);
      const marked = await column();
      check('with ✻ on in Settings it takes that place, the thought’s words lined up with the steps’, the spacing the same',
        marked.mark !== 'none' && marked.thoughtWords.length === 1 && Math.abs(marked.thoughtWords[0] - marked.stepWords[0]) <= 1
        && JSON.stringify(marked.pitch) === JSON.stringify(plain.pitch) && marked.lines === 0, JSON.stringify(marked));
      await js("[...document.querySelectorAll('.work-steps')].at(-1).scrollIntoView({ block: 'center' }); true");
      await wait(300);
      await shot('2f-steps-column');
      // Opening the steps was reading (the chat stopped following the bottom): back to the end.
      await js("{ const el = document.querySelector('.chat-scroll'); el.scrollTop = el.scrollHeight; } true");
      await wait(400);

      await say('Binary search templates?');
      await until('the answer', `${idle} && /noted that templates/.test(document.querySelector('.timeline').textContent)`);
      const tidy = JSON.parse(await js(`JSON.stringify((() => { const h = [...document.querySelectorAll('.timeline h2')].find((x) => x.textContent === 'Binary search');
        return { shown: Boolean(h && h.getClientRects().length), inWork: Boolean(h?.closest('.work-steps')) }; })())`));
      check('an answer followed by a note in memory stays the answer, not one of the steps', tidy.shown && !tidy.inWork, JSON.stringify(tidy));

      // A long paste stands in the message box as a placeholder; the whole text is what is sent.
      const long = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of a long log that was pasted in.`).join('\n');
      await js(`{ const el = document.querySelector('.chat-composer .composer-input'); el.focus(); const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(long)});
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); } true`);
      await wait(300);
      const boxText = await js("document.querySelector('.chat-composer .composer-input').value");
      check('a long paste shows as [Pasted text #1 · N chars]', boxText === `[Pasted text #1 · ${long.length.toLocaleString()} chars]`, boxText);
      const chip = JSON.parse(await js(`JSON.stringify((() => { const m = document.querySelector('.composer-marks .paste-chip'); if (!m) return null;
        const cs = getComputedStyle(m); const box = document.querySelector('.chat-composer .composer-input').getBoundingClientRect();
        const r = m.getClientRects()[0]; const layer = m.parentElement.getBoundingClientRect();
        return { text: m.textContent, bg: cs.backgroundColor, glow: cs.boxShadow.split(/,(?![^(]*\\))/).length,
          dx: Math.round((r.left - box.left) * 10) / 10, room: Math.round(Math.min(r.left - layer.left, r.top - layer.top)) }; })())`));
      check('drawn as one chip, with a background and a glow', Boolean(chip) && chip.text === boxText && !/rgba\(0, 0, 0, 0\)/.test(chip.bg) && chip.glow >= 3, JSON.stringify(chip));
      check('under the textarea’s own text, with room round it for the glow', Boolean(chip) && Math.abs(chip.dx) < .5 && chip.room >= 14, JSON.stringify(chip));
      await shot('2d-pasted');
      const backspace = "{ const el = document.querySelector('.chat-composer .composer-input'); el.focus(); el.selectionStart = el.selectionEnd = el.value.length; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })); } true";
      await js(backspace);
      await wait(200);
      check('Backspace removes the whole chip at once', (await js("document.querySelector('.chat-composer .composer-input').value")) === '' && !(await js("Boolean(document.querySelector('.paste-chip'))")));
      await js(`{ const el = document.querySelector('.chat-composer .composer-input'); el.focus(); const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(long)});
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); } true`);
      await wait(300);
      await js("document.querySelector('.chat-composer .composer-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); true");
      await until('the pasted message', `[...document.querySelectorAll('.msg-user-text')].some((m) => m.textContent.includes('Line 30 of a long log'))`);
      check('and the whole text is sent', (await js("[...document.querySelectorAll('.msg-user-text')].at(-1).textContent")) === long);
      await until('its reply', idle);

      // No status bar; the chat card runs down to the window's edge, rounded at the top only, 8px in on both sides.
      check('there is no status bar', await js("!document.querySelector('#statusbar')"));
      // Frosted glass: the sidebar, the top bar and the gaps are one see-through surface; the work area stays solid.
      const glass = await js(`{ const cs = (q) => getComputedStyle(document.querySelector(q));
        JSON.stringify({ on: document.documentElement.classList.contains('glass'), app: cs('#app').backgroundColor,
          sidebar: cs('#sidebar').backgroundColor, main: cs('#main').backgroundColor, seam: cs('#sidebar').borderRightWidth,
          stage: cs('#stage').backgroundColor }) }`);
      const g = JSON.parse(glass);
      if (g.on) {
        // Opacity of a computed color: rgb(…) is 1, rgba(…, a) and color(srgb … / a) carry it.
        const alpha = (c) => { const m = /\/\s*([\d.]+)\)$/.exec(c) || /^rgba\([^)]*,\s*([\d.]+)\)$/.exec(c); return m ? Number(m[1]) : 1; };
        check('the frame is one see-through surface', alpha(g.app) < 1 && alpha(g.sidebar) === 0 && alpha(g.main) === 0, glass);
        check('with no seam between the sidebar and the top bar', g.seam === '0px', glass);
        check('and the work area stays solid', alpha(g.stage) === 1, glass);
      } else console.log('(glass not available here: skipped the glass checks)');
      const sheet = await js(`{ const st = document.querySelector('#stage'); const r = st.getBoundingClientRect(); const cs = getComputedStyle(st);
        const side = document.querySelector('#sidebar').getBoundingClientRect();
        JSON.stringify({ bottom: Math.round(innerHeight - r.bottom), left: Math.round(r.left - side.right), right: Math.round(innerWidth - r.right),
          top: cs.borderTopLeftRadius + ' ' + cs.borderTopRightRadius, under: cs.borderBottomLeftRadius + ' ' + cs.borderBottomRightRadius }) }`);
      const sh = JSON.parse(sheet);
      check('the chat card reaches the bottom edge', sh.bottom === 0, sheet);
      check('rounded at the top only', sh.top === '18px 18px' && sh.under === '0px 0px', sheet);
      check('with the same gap on the left and the right', sh.left === 8 && sh.right === 8, sheet);
      // The option (Settings → Appearance): the work area runs out to the window's right edge.
      const edge = async () => JSON.parse(await js(`{ const st = document.querySelector('#stage'); const r = st.getBoundingClientRect(); const cs = getComputedStyle(st);
        JSON.stringify({ right: Math.round(innerWidth - r.right), top: cs.borderTopLeftRadius + ' ' + cs.borderTopRightRadius }) }`));
      const toggleEdge = async () => {
        await js("document.querySelector('.sidebar-bottom .ghost-btn').click(); true");
        await until('Settings', "Boolean(document.querySelector('.settings-nav'))");
        await js("[...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent.includes('Appearance')).click(); true");
        await wait(200);
        await js("[...document.querySelectorAll('.dialog .set-row')].find((r) => r.textContent.includes('window’s edge')).querySelector('input').click(); true");
        await wait(300);
        await js("document.querySelector('.settings-head .primary-btn').click(); true");
        await wait(400);
      };
      check('the option is off here (this profile)', !(await js("document.documentElement.classList.contains('fill-edge')")));
      await toggleEdge();
      const on = await edge();
      check('turned on, the work area reaches the right edge, rounded at its top-left only', on.right === 0 && on.top === '18px 0px', JSON.stringify(on));
      await toggleEdge();
      const off = await edge();
      check('turned off again, the gap is back', off.right === 8 && off.top === '18px 18px', JSON.stringify(off));
      // The top bar: the project's name, then the model menu; the folder button next to CLI.
      const bar = JSON.parse(await js(`JSON.stringify((() => { const r = (q) => document.querySelector(q)?.getBoundingClientRect();
        const p = r('#topbar .project-menu'); const m = r('#topbar .model-menu'); const f = r('#topbar .open-folder'); const c = r('#topbar .text-btn');
        return { order: Boolean(p && m && p.right <= m.left), folder: Boolean(f && c && f.left >= c.right - 1), inBox: Boolean(document.querySelector('.composer-bar .model-menu')),
          weight: getComputedStyle(document.querySelector('#topbar .project-menu .menu-button')).fontWeight,
          same: (() => { const a = getComputedStyle(document.querySelector('#topbar .project-menu .menu-button')); const b = getComputedStyle(document.querySelector('#topbar .model-menu .menu-button'));
            return ['fontSize', 'color', 'fontFamily', 'fontWeight'].every((k) => a[k] === b[k]); })() }; })())`));
      check('the model menu is written like the project name', bar.same, JSON.stringify(bar));
      check('the top bar has the project, then the model menu, and the folder button by CLI', bar.order && bar.folder && !bar.inBox, JSON.stringify(bar));
      check('the project name is not bold', bar.weight === '400', bar.weight);
      check('small headings are written as they are, not in capitals', await js("getComputedStyle(document.querySelector('.section-label')).textTransform === 'none'"));
      check('your bubble is plain grey', await js("getComputedStyle(document.querySelector('.msg-user')).backgroundColor === getComputedStyle(document.querySelector('.composer-bar .menu-button')).getPropertyValue('--raise') || getComputedStyle(document.querySelector('.msg-user')).backgroundColor === 'rgb(44, 44, 46)'"));

      // The context pop-up.
      await js("document.querySelector('.context-menu-wrap .menu-button').click(); true");
      await until('the context pop-up', "Boolean(document.querySelector('.context-pop .ctx-rows li'))");
      const pop = await js(`JSON.stringify({ rows: [...document.querySelectorAll('.context-pop .ctx-rows li span:first-child')].map((e) => e.textContent),
        total: document.querySelector('.ctx-total').textContent, cost: document.querySelector('.ctx-cost').textContent })`);
      const p = JSON.parse(pop);
      check('it lists what takes the space, without deferred tools', p.rows.includes('Messages') && p.rows.includes('Free space') && !p.rows.includes('MCP tools'), pop);
      check('and the session cost', /\$0\.0\d/.test(p.cost), p.cost);
      const fullness = JSON.parse(await js(`JSON.stringify((() => { const pop = document.querySelector('.context-pop'); const bar = pop.querySelector('.ctx-bar');
        return { bar: Math.round(bar.getBoundingClientRect().height * 10) / 10, fill: Math.round(bar.firstElementChild.getBoundingClientRect().width), room: pop.clientHeight, content: pop.scrollHeight }; })())`));
      check('its bar keeps its height when the pop-up is fuller than its room', fullness.content > fullness.room && fullness.bar >= 5.5 && fullness.fill > 0, JSON.stringify(fullness));
      await shot('2b-context');
      await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
      await wait(200);
      check('Esc closes it', await js("!document.querySelector('.context-pop')"));
      await js("document.querySelector('.context-menu-wrap .menu-button').click(); true");
      await until('the context pop-up again', "Boolean(document.querySelector('.context-pop'))");
      await js("document.querySelector('.context-pop .secondary-btn').click(); true");
      await until('the compact message', "[...document.querySelectorAll('.msg-user-text')].some((e) => e.textContent === '/compact')", 5000);
      check('Compact conversation sends /compact', await js("!document.querySelector('.context-pop')"));
      await until('idle again', idle);

      // The ring follows the conversation while Claude works: no click needed, no waiting for the turn to end.
      const ring = "Number(document.querySelector('.context-meter').textContent.replace('%', ''))";
      const before = await js(ring);
      const copies = await js("document.querySelectorAll('.answer-actions').length");
      await say('Read the big file.');
      const moved = await until('the ring to move during the turn', `${ring} > ${before} && Boolean(document.querySelector('.send-btn.stop'))`, 3000);
      check('the context ring updates by itself while Claude works', moved, `${before}% → ${await js(ring)}%`);
      const word = "document.querySelector('.activity > span:nth-child(2)')?.textContent";
      const act = JSON.parse(await js(`JSON.stringify({ word: ${word}, star: getComputedStyle(document.querySelector('.activity-mark'), '::before').animationName })`));
      await wait(900);
      const later = await js(word);
      check('meanwhile one of Claude Code’s words, the same through the turn, by a star that changes', /^[A-Z][\w' -]+…$/.test(act.word || '') && later === act.word && act.star === 'activity-star',
        JSON.stringify({ ...act, later }));
      check('a turn still going has no Copy yet', (await js("document.querySelectorAll('.answer-actions').length")) === copies);
      await until('idle again', idle);
      await wait(300);
      check('every finished answer has its Copy', (await js("document.querySelectorAll('.answer-actions').length")) === copies + 1);

      // Terminal panel joined to the chat.
      await js("document.querySelector('.panel-toggle').click(); true");
      await wait(1500);
      const seam = await js(`{ const s = document.querySelector('#stage').getBoundingClientRect();
        const p = document.querySelector('.bottom-panel').getBoundingClientRect();
        JSON.stringify({ gap: Math.round(p.top - s.bottom), radius: getComputedStyle(document.querySelector('#stage')).borderBottomLeftRadius }) }`);
      const bottom = JSON.parse(await js(`JSON.stringify((() => { const el = document.querySelector('.chat-scroll');
        return { off: Math.round(el.scrollHeight - el.clientHeight - el.scrollTop), jump: Boolean(document.querySelector('.jump-latest')) }; })())`));
      check('opening it keeps the chat at the bottom', bottom.off < 2 && !bottom.jump, JSON.stringify(bottom));
      check('the Terminal panel is joined to the chat', JSON.parse(seam).gap === 0 && JSON.parse(seam).radius === '0px', seam);
      await shot('2-chat-terminal-dark');
      await js("document.querySelector('.sidebar-bottom .icon-btn').click(); true");
      await wait(1200);
      await shot('3-chat-terminal-light');
      await js("document.querySelector('.chat-scroll').scrollTop = 0; true");
      await wait(300);
      await shot('4-top-light');

      // The arrow by the project's name lists the project folders; choosing one starts a new chat there.
      const sessionsBefore = await js("document.querySelectorAll('#sidebar .session').length");
      await js("document.querySelector('#topbar .project-menu .menu-button').click(); true");
      await until('the folder list', "Boolean(document.querySelector('#topbar .project-menu .menu-list'))", 3000);
      const listed = JSON.parse(await js("JSON.stringify([...document.querySelectorAll('#topbar .project-menu .menu-list .menu-label')].map((e) => e.textContent))"));
      check('the project menu lists the project folders, then Open folder…', listed[0] === path.basename(project) && listed.at(-1) === 'Open folder…', JSON.stringify(listed));
      await wait(300); // the list fades in
      await shot('5-project-menu');
      await js("document.querySelector('#topbar .project-menu .menu-list button').click(); true");
      check('choosing a folder starts a new chat there', await until('the new chat', `document.querySelectorAll('#sidebar .session').length === ${sessionsBefore + 1}`, 6000));

      // New session: a new chat without a project, right away, listed on its own above the projects and lined up
      // with New session (the icon's stroke under its +, the name under its label).
      const listedBefore = await js("document.querySelectorAll('#sidebar .session').length");
      await js("document.querySelector('#sidebar button.new-session').click(); true");
      await until('the chat without a project', `Boolean(document.querySelector('#sidebar .loose .session[aria-current="true"]')) && Boolean(document.querySelector('.chat.empty .chat-intro'))`, 8000);
      await wait(600);
      const loose = JSON.parse(await js(`JSON.stringify((() => {
        const ink = (svg) => { const k = svg.getBoundingClientRect().width / 24; return Math.min(...[...svg.children].map((c) => c.getBoundingClientRect().left)) - Number(svg.getAttribute('stroke-width')) / 2 * k; };
        const row = document.querySelector('#sidebar .loose .session');
        const label = document.querySelector('.new-session span').getBoundingClientRect().left;
        return { heading: document.querySelector('#sidebar .loose .section-label').firstChild.textContent, rows: document.querySelectorAll('#sidebar .loose .session').length,
          icon: Math.round((ink(row.querySelector('.session-icon svg')) - ink(document.querySelector('.new-session .icon'))) * 10) / 10,
          name: Math.round((row.querySelector('.session-name').getBoundingClientRect().left - label) * 10) / 10,
          chip: document.querySelector('.intro-chips .project-menu .menu-text')?.textContent,
          projects: [...document.querySelectorAll('#sidebar .folder-name')].map((f) => f.textContent) }; })())`));
      check('New session opens a new chat at once, with no project', loose.rows === 1 && loose.heading === 'Sessions' && loose.chip === 'No project', JSON.stringify(loose));
      check('it is listed on its own, not as a project', !loose.projects.includes(path.basename(chats)), JSON.stringify(loose.projects));
      check('its icon and name line up with New session’s', Math.abs(loose.icon) <= 1 && Math.abs(loose.name) <= 1, JSON.stringify(loose));
      await shot('6-new-session');
      await js("document.querySelector('#sidebar button.new-session').click(); true");
      await wait(700);
      check('New session again shows that same unused chat', (await js("document.querySelectorAll('#sidebar .loose .session').length")) === 1
        && (await js("document.querySelectorAll('#sidebar .session').length")) === listedBefore + 1);
      await js("document.querySelector('.intro-chips .project-menu .menu-button').click(); true");
      await until('the chip’s folder list', "Boolean(document.querySelector('.intro-chips .project-menu .menu-list'))", 3000);
      await js(`[...document.querySelectorAll('.intro-chips .project-menu .menu-list button')].find((b) => b.textContent.includes(${JSON.stringify(path.basename(other))})).click(); true`);
      const inProject = `!document.querySelector('#sidebar .loose') && [...document.querySelectorAll('#sidebar .folder')].some((f) => f.textContent.includes(${JSON.stringify(path.basename(other))}) && f.querySelector('.session[aria-current="true"]'))`;
      check('given a project in its chip, the unused chat moves there', await until('the chat in the project', inProject, 6000));
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
