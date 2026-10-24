// Check of CLI sessions, without API usage (the CLI is a fake that writes what Claude Code does): Claude Code's
// logo is drawn as solid blocks, with no seams between the cells, at the UI scale it is shown at, and still is in a
// terminal shown again after ten others (WebGL contexts run out at 16); Claude Code's own report of its state
// (OSC 7501) is what the sidebar shows: ccUI answers its probe, shows a spinner while it works and a dot when it
// waits for you, and output alone doesn't count as working. With Settings' task list on, Claude Code is started with
// its task tools (CLAUDE_CODE_ENABLE_TODO_TOOLS).
// Usage: npx vite build && npx electron scripts/checks/cli-check.js
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { tempDir } = require('./temp');
const { install } = require('./fakes');

const profile = tempDir('cli-profile');
const project = tempDir('cli-project');
const others = Array.from({ length: 10 }, (_, i) => tempDir(`cli-other${i}`));
const late = tempDir('cli-late'); // a project whose CLI starts while the layout changes
const outDir = path.join(__dirname, '..', '..', 'dist', 'cli-check');
fs.mkdirSync(outDir, { recursive: true });

// Claude Code 2.1's welcome logo (its own colors), then two rows of full blocks to measure seams on.
const ORANGE = '\x1b[38;2;215;119;87m';
const LOGO = [' ▐▛███▛█', '▝▜██████▀', ' ▝▝   ▝▝'];
const BAR = '██████████';
const PROBE = '\x1b]7501;?\x07';
const status = (state) => `\x1b]7501;state=${state}:app=claude-code\x07`;
let cli = null; // writes as the first fake CLI
let last = null; // the CLI started last
const director = {
  script: () => null, prompt: () => '', shell: () => '',
  cli: () => `${PROBE}${ORANGE}${LOGO.join('\r\n')}\x1b[0m\r\n\r\n${ORANGE}${BAR}\r\n${BAR}\x1b[0m\r\n`,
  onPty: (p) => {
    if (p.kind === 'shell') return;
    if (!cli) cli = p;
    last = p;
  },
};
install(director);

// The project's + opens a CLI (the default kind here).
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  language: 'en', uiScale: 110, theme: 'light', confirmClose: false, notify: false, trustedFolders: [project, ...others, late],
  recent: [project, ...others, late].map((p, i) => ({ path: p, at: Date.now() - i * 1000 })), defaultKind: 'terminal', taskList: true,
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
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });

  // The bar of full blocks in the shown terminal, in screen pixels: how many lines of pixels across it and down
  // it are not the blocks' color (seams between cells). Also saves the logo, enlarged.
  const seams = async (name) => {
    const box = JSON.parse(await js(`JSON.stringify((() => { const r = document.querySelector('.term-host.active .xterm-screen').getBoundingClientRect();
      return { x: r.left, y: r.top, w: Math.min(r.width, 400), h: Math.min(r.height, 200), inner: innerWidth }; })())`));
    const img = await win.webContents.capturePage();
    const f = Math.max(...img.getScaleFactors());
    const size = img.getSize(f);
    const bmp = img.toBitmap({ scaleFactor: f });
    const k = size.width / box.inner; // screen pixels per CSS pixel
    const at = (x, y) => { const i = (y * size.width + x) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i]]; };
    const dist = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
    const x0 = Math.round(box.x * k); const y0 = Math.round(box.y * k);
    const x1 = Math.round((box.x + box.w) * k); const y1 = Math.round((box.y + box.h) * k);
    const bg = at(x1 - 3, y1 - 3);
    // The bar: the lines with the most ink.
    const ink = [];
    for (let y = y0; y < y1; y++) {
      let n = 0;
      for (let x = x0; x < x1; x++) if (dist(at(x, y), bg) > 80) n++;
      ink.push(n);
    }
    const most = Math.max(...ink);
    const rows = ink.map((n, i) => (n >= most * 0.6 ? y0 + i : -1)).filter((y) => y >= 0);
    // Its last block of lines (the logo above has rows nearly as full).
    let top = rows.at(-1);
    while (rows.includes(top - 1) || rows.includes(top - 2)) top -= rows.includes(top - 1) ? 1 : 2;
    const bottom = rows.at(-1);
    const mid = Math.round((top + bottom) / 2);
    let left = x0; while (left < x1 && dist(at(left, mid), bg) <= 80) left++;
    let right = x1 - 1; while (right > left && dist(at(right, mid), bg) <= 80) right--;
    const color = at(Math.round((left + right) / 2), Math.round((top + mid) / 2));
    // Lines inside the bar (less the antialiased edge) with pixels off its color.
    let across = 0;
    let down = 0;
    for (let y = top + 2; y <= bottom - 2; y++) {
      for (let x = left + 2; x <= right - 2; x++) if (dist(at(x, y), color) > 40) { across++; break; }
    }
    for (let x = left + 2; x <= right - 2; x++) {
      for (let y = top + 2; y <= bottom - 2; y++) if (dist(at(x, y), color) > 40) { down++; break; }
    }
    const logo = img.crop({ x: box.x * k / f, y: box.y * k / f, width: (right - x0) / f, height: (top - y0) / f });
    fs.writeFileSync(path.join(outDir, `${name}.png`), logo.resize({ width: Math.round(logo.getSize().width * 4), quality: 'good' }).toPNG());
    return { k: Math.round(k * 1000) / 1000, cell: [Math.round((right - left) / 10 * 10) / 10, Math.round((bottom - top) / 2 * 10) / 10], linesAcross: across, linesDown: down };
  };

  const folder = (dir) => `[...document.querySelectorAll('#sidebar .folder')].find((f) => f.querySelector('.folder-name').textContent === ${JSON.stringify(path.basename(dir))})`;
  const row = `[...document.querySelectorAll('#sidebar .session')].find((x) => x.querySelector('.session-icon').title === 'CLI session' && ${folder(project)}.contains(x))`;
  const look = () => js(`JSON.stringify((() => { const r = ${row}; return { status: r.dataset.status, spin: Boolean(r.querySelector('.session-spin')), dot: Boolean(r.querySelector('.session-wait')) }; })())`).then(JSON.parse);

  win.webContents.once('did-finish-load', async () => {
    try {
      await until('the project', `Boolean(${folder(project)}?.querySelector('.folder-add'))`);
      await js(`${folder(project)}.querySelector('.folder-add').click(); true`);
      await until('the CLI', "Boolean(document.querySelector('.term-host.active .xterm-screen'))");
      await wait(1500);
      const at110 = await seams('logo-110');
      check('a project’s + opens the default kind, here a CLI', await js(`Boolean(${row})`));
      check('with the task list on in Settings, Claude Code gets its task tools', cli.env.CLAUDE_CODE_ENABLE_TODO_TOOLS === '1', JSON.stringify(Object.keys(cli.env)));
      check('at 110%, the logo’s blocks join with no seams', at110.linesAcross === 0 && at110.linesDown === 0, JSON.stringify(at110));

      // Claude Code's report of its state.
      check('ccUI answers Claude Code’s probe for its state', (director.typed || []).some((d) => d.startsWith('\x1b]7501;?')), JSON.stringify(director.typed || []));
      cli.out(status('idle'));
      await wait(300);
      const idle = await look();
      check('Idle: no spinner, no dot', !idle.spin && !idle.dot && idle.status === 'idle', JSON.stringify(idle));
      for (let i = 0; i < 6; i++) {
        cli.out(`\x1b[2;1Hredrawn ${i}`);
        await wait(400);
      }
      await wait(2000);
      const redrawn = await look();
      check('output while Claude Code says it is idle doesn’t make it working, nor waiting after', !redrawn.spin && !redrawn.dot && redrawn.status === 'idle', JSON.stringify(redrawn));
      cli.out(status('working'));
      await wait(300);
      const working = await look();
      check('Working: the spinner', working.spin && working.status === 'working', JSON.stringify(working));
      await wait(2500);
      check('and still working through a quiet spell', (await look()).spin);

      // The others, each in its own project: the first is out of sight.
      for (const dir of others) {
        await js(`${folder(dir)}.querySelector('.folder-add').click(); true`);
        await until(`the CLI in ${path.basename(dir)}`, `document.querySelector('.term-host.active') && ${folder(dir)}.querySelector('.session[aria-current="true"]')`);
        await wait(250);
      }
      cli.out(status('done'));
      await wait(300);
      const done = await look();
      check('Done while out of sight: the dot, waiting for you', done.dot && !done.spin && done.status === 'attention', JSON.stringify(done));
      cli.out('\x1b]7501;state=blocked:app=claude-code:kind=permission\x07');
      await wait(300);
      const blocked = await look();
      check('Asking for permission: the dot, needing your answer', blocked.dot && blocked.status === 'needs-you', JSON.stringify(blocked));
      const webgl = await js("[...document.querySelectorAll('.term-host')].filter((h) => h.querySelector('.xterm-screen canvas')).length");
      check('of eleven terminals, at most eight draw with WebGL', webgl <= 8 && webgl >= 1, `${webgl}`);
      await js(`${row}.querySelector('.session-main').click(); true`);
      await until('the first CLI again', `${row}.getAttribute('aria-current') === 'true'`);
      await wait(1500);
      check('shown again, it draws with WebGL again', await js("Boolean(document.querySelector('.term-host.active .xterm-screen canvas'))"));
      const again = await seams('logo-again');
      check('and its logo joins with no seams', again.linesAcross === 0 && again.linesDown === 0, JSON.stringify(again));
      cli.out(status('working'));
      await wait(300);
      check('answered, it works again', (await look()).spin);

      win.webContents.setZoomFactor(1);
      await wait(1200);
      const at100 = await seams('logo-100');
      check('at 100%, the logo’s blocks join with no seams', at100.linesAcross === 0 && at100.linesDown === 0, JSON.stringify(at100));

      // The layout changes while Claude Code is starting (here the window gets shorter; also the message bar, a
      // panel): Claude Code still ends up told the terminal's size, so the bottom of its pages isn't cut off.
      director.slowPid = 900;
      director.beforeReply = () => { director.beforeReply = null; win.setSize(1320, 660); };
      await js(`${folder(late)}.querySelector('.folder-add').click(); true`);
      await wait(2500);
      const shown = await js("(document.querySelector('#topbar .project-menu [title]')?.title.match(/(\\d+)×(\\d+)/) || []).slice(1).join('×')");
      const told = `${last.size().cols}×${last.size().rows}`;
      check('a layout change while Claude Code starts still reaches it: it is told the size the terminal has', shown && told === shown, `told ${told}, terminal ${shown}`);
      director.slowPid = 0;
      win.setSize(1320, 860);
      await wait(1200);
      const after = await js("(document.querySelector('#topbar .project-menu [title]')?.title.match(/(\\d+)×(\\d+)/) || []).slice(1).join('×')");
      check('and every change after it', `${last.size().cols}×${last.size().rows}` === after, `told ${last.size().cols}×${last.size().rows}, terminal ${after}`);
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
