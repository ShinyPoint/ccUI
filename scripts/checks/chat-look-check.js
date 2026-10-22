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
    if (/big file/.test(text)) {
      // A step that fills the context, then a slow answer: the context ring moves before the turn ends.
      await c.tool('Read', { file_path: c.file('big.txt') }, { run: 200, result: 'x'.repeat(30000) });
      await c.say('Read it all, now going through it.', { cps: 10 });
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
      await js("document.querySelector('#sidebar .folder-add').click(); true");
      await until('a second session', "document.querySelectorAll('#sidebar .session').length === 2", 10000);
      await wait(800);
      await js("document.querySelectorAll('#sidebar .session .session-main')[0].click(); true");
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
