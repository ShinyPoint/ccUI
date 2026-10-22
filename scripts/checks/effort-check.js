// Check of the model menu's effort slider and the Settings switches and sliders, without API usage (Claude is
// scripted, see fakes.js): a 1M-context model id (claude-opus-5-5[1m]) is recognized as Opus and its
// effort can be changed; the slider floats at the menu's foot while the options scroll; it is drawn like a switch,
// its knob stretches while held and the level follows a drag; Settings switches can be dragged across and stretch
// while held, and its sliders are drawn the same way. Screenshots in dist/effort-check/.
// Usage: npx vite build && npx electron scripts/checks/effort-check.js   (add --dark for the dark theme)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const { tempDir } = require('./temp');
const { install, MODELS } = require('./fakes');

const outDir = path.join(__dirname, '..', '..', 'dist', 'effort-check');
const profile = tempDir('effort-profile');
const project = tempDir('effort-project');
fs.mkdirSync(outDir, { recursive: true });

const director = {
  histories: [], transcripts: new Map(),
  script: () => async (c) => { await c.say('Done.', { cps: 600 }); c.finish(0.01); },
  prompt: () => '', shell: () => '', cli: () => '',
  // More models than fit, so the list scrolls under the slider.
  models: [...MODELS, ...['Opus 4.1', 'Sonnet 4.5', 'Haiku 3.5', 'Opus 4', 'Sonnet 4'].map((name, i) => ({
    value: `legacy-${i}`, displayName: name, description: `${name} · An earlier model, kept for comparisons`,
  }))],
};
install(director);
const controls = (action) => (director.controls || []).filter(([a]) => a === action);

const THEME = process.argv.includes('--dark') ? 'dark' : 'light';
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  language: 'en', uiScale: 100, theme: THEME, confirmClose: false, notify: false, trustedFolders: [project], recent: [{ path: project, at: Date.now() }],
  defaultModel: 'claude-opus-5-5[1m]',
}));
app.setPath('userData', profile);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

app.on('browser-window-created', (_e, win) => {
  win.setSize(1320, 760);
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
  const rect = (sel) => js(`JSON.stringify((() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })())`).then(JSON.parse);
  const mouse = (type, x, y) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });

  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(1200);
      await js("document.querySelector('.empty-recent .primary-btn').click(); true");
      await until('chat ready', "Boolean(document.querySelector('.chat-composer .composer-input'))");
      await js(`{ const el = document.querySelector('.chat-composer .composer-input'); el.value = 'hi'; el.dispatchEvent(new Event('input', { bubbles: true })); } true`);
      await wait(100);
      await js("document.querySelector('.chat-composer .composer-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); true");
      await until('the reply', "/Done/.test(document.querySelector('.timeline')?.textContent || '') && !document.querySelector('.send-btn.stop')");
      await wait(300);

      // The 1M model: named as Opus, not by its raw id, and its effort can be changed.
      const label = await js("document.querySelector('.model-menu .menu-button').textContent.trim()");
      check('claude-opus-5-5[1m] shows as Opus · 1M', label === 'Opus · 1M', label);
      await js("document.querySelector('.model-menu .menu-button').click(); true");
      await until('the model menu', "Boolean(document.querySelector('.model-menu .menu-list'))", 3000);
      await wait(300);
      check('and its effort slider is on', await js("!document.querySelector('.effort').classList.contains('disabled') && document.querySelectorAll('.effort-stop').length === 6"));
      check('the menu marks Opus as the one in use', /Opus/.test(await js("document.querySelector('.model-menu .menu-list button.selected')?.textContent || ''")));

      // It floats at the menu's foot: in sight with the list scrolled to the top, as at the bottom.
      const inSight = async () => JSON.parse(await js(`JSON.stringify((() => { const m = document.querySelector('.model-menu .menu-list'); const f = document.querySelector('.menu-footer').getBoundingClientRect(); const r = m.getBoundingClientRect();
        return { scrolls: m.scrollHeight > m.clientHeight + 4, top: Math.round(f.top - r.top), bottom: Math.round(r.bottom - f.bottom), inside: f.top >= r.top && f.bottom <= r.bottom + 1 }; })())`));
      await js("document.querySelector('.model-menu .menu-list').scrollTop = 0; true");
      await wait(150);
      const atTop = await inSight();
      check('the effort slider floats at the foot of the menu while the options scroll', atTop.scrolls && atTop.inside && atTop.bottom <= 1, JSON.stringify(atTop));
      await shot('1-menu');

      // Drawn like a switch: a 22px pill, a 16px knob inset 3px.
      const look = JSON.parse(await js(`JSON.stringify((() => { const tr = document.querySelector('.effort-track').getBoundingClientRect(); const th = document.querySelector('.effort-thumb').getBoundingClientRect();
        return { track: Math.round(tr.height), knob: Math.round(th.width) + 'x' + Math.round(th.height), inset: Math.round(th.top - tr.top) }; })())`));
      check('the slider is a 22px pill with a 16px knob inset 3px', look.track === 22 && look.knob === '16x16' && look.inset === 3, JSON.stringify(look));
      // The fill ends round around the knob, 3px past it, not square at its middle.
      check('the fill ends round, around the knob', /round 11px/.test(await js("getComputedStyle(document.querySelector('.effort-fill')).clipPath")));

      // Held, the knob stretches; dragged to the end, the level is Max.
      const knob = await rect('.effort-thumb');
      const track = await rect('.effort-track');
      mouse('mouseMove', knob.x + 8, knob.y + 8);
      mouse('mouseDown', knob.x + 8, knob.y + 8);
      await wait(260);
      const held = await js("Math.round(document.querySelector('.effort-thumb').getBoundingClientRect().width)");
      check('held, the knob stretches into a pill', held === 22, `${held}px`);
      const xs = [];
      for (let i = 1; i <= 12; i++) {
        mouse('mouseMove', knob.x + 8 + ((track.x + track.w - knob.x) * i) / 12, knob.y + 8);
        await wait(30);
        xs.push(await js("Math.round(document.querySelector('.effort-thumb').getBoundingClientRect().left)"));
      }
      await shot('2-dragging');
      mouse('mouseUp', track.x + track.w - 2, knob.y + 8);
      await wait(500);
      check('the knob follows the drag', xs.every((x, i) => !i || x >= xs[i - 1]) && xs.at(-1) - xs[0] > track.w / 2, xs.join(' '));
      check('and the level taken is Max', controls('effort').some(([, l]) => l === 'max') && /Max/.test(await js("document.querySelector('.effort-value').textContent")),
        JSON.stringify(controls('effort')));
      check('let go, the knob is round again', (await js("Math.round(document.querySelector('.effort-thumb').getBoundingClientRect().width)")) === 16);
      await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
      await wait(300);

      // Settings: a switch held stretches, and dragged across, toggles; sliders are pills.
      await js("document.querySelector('.sidebar-bottom .ghost-btn').click(); true");
      await until('Settings', "Boolean(document.querySelector('.settings-nav'))", 3000);
      await js("[...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent.includes('Appearance')).click(); true");
      await wait(300);
      const row = "[...document.querySelectorAll('.dialog .set-row')].find((r) => r.querySelector('.switch'))";
      const name = await js(`${row}.querySelector('.set-label').textContent`);
      const before = await js(`${row}.querySelector('.switch input').checked`);
      const sw = JSON.parse(await js(`JSON.stringify((() => { const r = ${row}.querySelector('.switch span').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })())`));
      const from = before ? sw.x + sw.w - 10 : sw.x + 10;
      const to = before ? sw.x + 4 : sw.x + sw.w - 4;
      mouse('mouseMove', from, sw.y + sw.h / 2);
      mouse('mouseDown', from, sw.y + sw.h / 2);
      await wait(260);
      const stretched = await js(`getComputedStyle(${row}.querySelector('.switch span'), '::after').width`);
      check('a held switch stretches its knob', stretched === '21px', `${name}: ${stretched}`);
      for (let i = 1; i <= 8; i++) {
        mouse('mouseMove', from + ((to - from) * i) / 8, sw.y + sw.h / 2);
        await wait(30);
      }
      mouse('mouseUp', to, sw.y + sw.h / 2);
      await wait(400);
      const after = await js(`${row}.querySelector('.switch input').checked`);
      check('dragged across, the switch toggles (once)', after === !before, `${name}: ${before} → ${after}`);
      const slider = JSON.parse(await js(`JSON.stringify((() => { const i = document.querySelector('.dialog .set-slider input[type=range]'); if (!i) return null; const cs = getComputedStyle(i);
        return { h: Math.round(i.getBoundingClientRect().height), appearance: cs.appearance, f: i.style.getPropertyValue('--f') }; })())`));
      check('Settings sliders are drawn as the same pill', slider && slider.h === 22 && slider.appearance === 'none' && slider.f !== '', JSON.stringify(slider));
      await shot('3-settings');

      // Color themes tint the surfaces, not the buttons: Clay is Claude's desktop palette, the accent stays.
      const colors = () => js(`JSON.stringify((() => { const cs = getComputedStyle(document.documentElement); const btn = getComputedStyle(document.querySelector('.new-session'));
        return { surface: cs.getPropertyValue('--surface').trim(), chrome: cs.getPropertyValue('--chrome').trim(), accent: cs.getPropertyValue('--accent').trim(),
          button: btn.backgroundColor + ' ' + btn.color, body: getComputedStyle(document.body).backgroundColor,
          card: getComputedStyle(document.querySelector('.dialog .set-card')).backgroundColor }; })())`).then(JSON.parse);
      const plain = await colors();
      await js("document.querySelector('.swatch input[value=\"ember\"]').click(); true");
      await wait(300);
      const clay = await colors();
      const CLAY = THEME === 'light' ? { surface: '#FAF9F5', chrome: '#F5F4ED' } : { surface: '#262624', chrome: '#1F1E1D' };
      check('Clay turns the surfaces to Claude’s palette', clay.surface === CLAY.surface && clay.chrome === CLAY.chrome && clay.body !== plain.body, `${JSON.stringify(plain)} → ${JSON.stringify(clay)}`);
      check('and leaves the buttons and the accent as they were', clay.accent === plain.accent && clay.button === plain.button, `${plain.button} → ${clay.button}`);
      // Settings' cards too: on light, Clay's paper rather than a cold white on its warm dialog.
      check('and tints the Settings cards with them', clay.card !== plain.card && (THEME !== 'light' || clay.card === 'rgb(250, 249, 245)'), `${plain.card} → ${clay.card}`);
      await shot('4-clay');
      await js("document.querySelector('.swatch input[value=\"black\"]').click(); true");
      await wait(300);
      check('Default brings the neutral greys back', (await colors()).surface === plain.surface);

      // UI scale: 105% unless chosen (this profile pins 100%, like every check's, so the mouse lands where the page
      // says); dragging only moves the number; let go, the whole window is drawn larger, the smallest window grows
      // with it, and the scale is kept across a reload.
      const scaleRow = "[...document.querySelectorAll('.dialog .set-row')].find((r) => r.querySelector('.set-label')?.textContent === 'UI scale')";
      const width0 = await js('innerWidth');
      const { Settings } = require('../../src/main/settings');
      check('the UI scale is 105% by default', new Settings(tempDir('effort-fresh')).get().uiScale === 105);
      check('this profile is drawn at 100%', (await js(`${scaleRow}.querySelector('output').textContent`)) === '100%' && width0 === win.getContentSize()[0],
        `${width0} CSS px in ${win.getContentSize()[0]}`);
      const setScale = (v, ev) => js(`{ const i = ${scaleRow}.querySelector('input[type=range]'); i.value = '${v}'; i.dispatchEvent(new Event('${ev}', { bubbles: true })); } true`);
      await setScale(125, 'input');
      await wait(300);
      check('dragging the UI scale moves the number, not the window', (await js(`${scaleRow}.querySelector('output').textContent`)) === '125%' && (await js('innerWidth')) === width0,
        `${await js(`${scaleRow}.querySelector('output').textContent`)}, ${width0} → ${await js('innerWidth')}`);
      await setScale(125, 'change');
      await wait(600);
      const width1 = await js('innerWidth');
      check('let go, the window is drawn at 125%', Math.abs(width1 * 1.25 - width0) <= 2, `${width0} → ${width1} CSS px`);
      check('and the smallest window grows with it', win.getMinimumSize()[0] === 950, JSON.stringify(win.getMinimumSize()));
      await shot('5-ui-scale');
      win.webContents.reload();
      await new Promise((r) => win.webContents.once('did-finish-load', r));
      await wait(1200);
      check('the scale is kept across a reload', Math.abs((await js('innerWidth')) - width1) <= 2, `${await js('innerWidth')}`);
      await js("document.querySelector('.sidebar-bottom .ghost-btn').click(); true");
      await until('Settings again', "Boolean(document.querySelector('.settings-nav'))", 3000);
      await js("[...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent.includes('Appearance')).click(); true");
      await wait(300);
      await setScale(100, 'input');
      await setScale(100, 'change');
      await wait(600);
      check('back to 100%', (await js('innerWidth')) === width0 && win.getMinimumSize()[0] === 760, `${await js('innerWidth')} ${JSON.stringify(win.getMinimumSize())}`);
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
