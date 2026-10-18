// Intro video, step 1 of 2: records the app. Opens the built app on a throwaway profile with demo projects,
// plays the story in story.js (Claude and the terminals are scripted, see fakes.js: no API usage), and saves
// what the window shows as numbered frames plus a timeline of captions, pointer moves and camera moves.
// Step 2 (compose.js) turns those into the video.
// Usage: npm run video   (writes dist/intro-video/)
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { app } = require('electron');

// Twice the video's pixel density, so zoomed-in shots stay sharp.
app.commandLine.appendSwitch('force-device-scale-factor', '2');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'dist', 'intro-video'));
const RAW = path.join(OUT, 'raw');
const VIEW = { width: 1280, height: 720 };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccui-intro-'));
const home = path.join(root, 'home');
const profile = path.join(root, 'profile');
fs.rmSync(RAW, { recursive: true, force: true });
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(profile, { recursive: true });

// The demo projects live in a made-up home folder, so paths read "~\code\orbit-api" on any computer.
os.homedir = () => home;

const { install, sleep } = require('./fakes');
const { createProjects, makeDirector, PROMPTS, HISTORIES } = require('./story');
const projects = createProjects(home);
const director = makeDirector(projects);
install(director);

// The main process keeps its Settings object to itself; the background image is set through it.
let settings = null;
{
  const file = require.resolve('../../src/main/settings.js');
  const real = require(file);
  require.cache[file].exports = { ...real, Settings: class extends real.Settings { constructor(dir) { super(dir); settings = this; } } };
}
const { Background } = require('../../src/main/background');

const saved = (key) => {
  const h = HISTORIES.find((x) => x.key === key);
  return { kind: 'chat', cwd: projects[h.project], title: h.title, sessionId: `0000${key}-demo` };
};
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  theme: 'dark', confirmClose: false, notify: false, sidebarGlass: false, settingsVersion: 2,
  recent: Object.values(projects).map((p) => ({ path: p, at: Date.now() })),
  trustedFolders: Object.values(projects),
  lastSessions: [saved('tests'), { kind: 'chat', cwd: projects['atlas-web'], active: true }, saved('notes')],
}));
app.setPath('userData', profile);
app.on('quit', () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* still in use */ } });

// A PNG of soft color fields, used as the background image in the last scene.
function wallpaper(width, height) {
  const blobs = [[0.18, 0.2, 0.55, [232, 122, 78]], [0.82, 0.3, 0.6, [92, 84, 196]], [0.55, 0.95, 0.6, [38, 150, 160]], [0.95, 0.9, 0.4, [236, 170, 96]]];
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width; const v = y / height;
      const c = [26, 22, 48];
      for (const [cx, cy, r, col] of blobs) {
        const d = Math.hypot(u - cx, (v - cy) * (height / width)) / r;
        const k = d < 1 ? (1 - d * d) ** 2 : 0;
        for (let i = 0; i < 3; i++) c[i] += (col[i] - c[i]) * k;
      }
      raw.set([...c.map(Math.round), 255], y * (width * 4 + 1) + 1 + x * 4);
    }
  }
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = table[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// In the page: the box of the nth element matching `sel` whose text contains `text`.
const FIND = `window.__box = (sel, text, nth) => {
  const el = [...document.querySelectorAll(sel)].filter((e) => !text || e.textContent.includes(text))[nth || 0];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
}; document.hasFocus = () => true; 0;`;

app.on('browser-window-created', (_e, win) => {
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code);
  wc.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });

  let startedAt = 0;
  const events = [];
  const frames = [];
  const now = () => Date.now() - startedAt;
  const mark = (type, data = {}) => { if (startedAt) events.push({ t: now(), type, ...data }); };

  let recording = false;
  let loop = null;
  const writes = [];
  const record = () => {
    recording = true;
    startedAt = Date.now();
    loop = (async () => {
      while (recording) {
        const image = await wc.capturePage();
        const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
        frames.push({ t: now(), file });
        writes.push(fs.promises.writeFile(path.join(RAW, file), image.toJPEG(95)));
      }
    })();
  };

  const until = async (code, what = code, timeout = 20000) => {
    for (const end = Date.now() + timeout; Date.now() < end; await sleep(50)) {
      const value = await js(code);
      if (value) return value;
    }
    throw new Error(`Timed out waiting for ${what}`);
  };
  // target: [selector, text?, nth?] or a point { x, y }
  const box = (target) => until(`__box(${target.map((v) => JSON.stringify(v ?? null)).join(',')})`, target.join(' '));
  const point = async (target) => {
    if (!Array.isArray(target)) return target;
    const b = await box(target);
    return { x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2) };
  };

  // The pointer is drawn by compose.js from these marks; the real mouse events make hovers and clicks happen.
  let pointer = { x: 700, y: 430 };
  const move = async (target, ms) => {
    const to = await point(target);
    const duration = ms ?? Math.round(Math.min(900, 320 + Math.hypot(to.x - pointer.x, to.y - pointer.y) * 0.7));
    mark('move', { ...to, ms: duration });
    await sleep(duration);
    pointer = to;
    wc.sendInputEvent({ type: 'mouseMove', ...to });
  };
  const click = async (target, ms) => {
    await move(target, ms);
    await sleep(140);
    mark('click', pointer);
    wc.sendInputEvent({ type: 'mouseDown', ...pointer, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', ...pointer, button: 'left', clickCount: 1 });
    await sleep(220);
  };
  const type = async (text, cps = 30) => {
    for (const ch of text) {
      wc.sendInputEvent({ type: 'char', keyCode: ch });
      await sleep((1000 / cps) * (0.6 + Math.random() * 0.8));
    }
  };
  const key = async (keyCode) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
    await sleep(80);
  };
  const caption = (text) => mark('caption', { text });
  // Zoom the view in on an area (`pad`: [left, top, right, bottom] extra room around it), or back out with null.
  const camera = async (target, pad = [0, 0, 0, 0], ms = 800) => {
    if (!target) return mark('camera', { box: null, ms });
    const b = await box(target);
    mark('camera', { box: { x: b.x - pad[0], y: b.y - pad[1], w: b.w + pad[0] + pad[2], h: b.h + pad[1] + pad[3] }, ms });
  };

  async function story() {
    win.setContentSize(VIEW.width, VIEW.height);
    win.center();
    win.focus();
    wc.focus();
    await js(FIND);

    // Before the recording starts: the second session gets its task, then a new chat opens in orbit-api.
    await until(`document.querySelectorAll('.session').length === 3 && Boolean(document.querySelector('.chat-composer .composer-input'))`, 'restored sessions');
    await sleep(900);
    await js(`{ const el = document.querySelector('.chat-composer .composer-input');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(PROMPTS.atlas)});
      el.dispatchEvent(new Event('input', { bubbles: true })); }`);
    await sleep(200);
    await js(`document.querySelector('.chat-composer .send-btn').click()`);
    await sleep(600);
    await js(`[...document.querySelectorAll('.folder')].find((f) => f.querySelector('.folder-name').textContent === 'orbit-api').querySelector('.folder-add').click()`);
    await until(`Boolean(document.querySelector('.chat-intro'))`, 'the new chat');
    await sleep(5000);
    wc.sendInputEvent({ type: 'mouseMove', ...pointer });

    record();
    const size = await js('({ w: innerWidth, h: innerHeight })');

    // 1. A new chat
    caption('Every Claude Code session opens as a chat.');
    await sleep(2800);

    // 2. Writing the prompt
    await camera(['.chat-composer'], [40, 250, 40, 30]);
    await click(['.chat-composer .composer-input']);
    caption('Type @ to mention a file, / to run a command.');
    await type(PROMPTS.main, 40);
    await type('@ser', 7);
    await sleep(1300);
    await key('Enter');
    await sleep(900);
    await key('Enter');
    await camera(null);
    await sleep(500);
    caption('Each step is one row: what Claude read, searched, changed and ran.');

    // 3. Claude asks a question
    await box(['.prompt.question']);
    await sleep(500);
    caption('Claude’s questions become a form.');
    await camera(['.prompt.question'], [60, 110, 60, 40]);
    await sleep(1300);
    await click(['.q-option', 'In memory']);
    await sleep(500);
    await click(['.prompt.question .primary-btn']);
    await sleep(400);
    await camera(null);

    // 4. An edit that needs permission
    await box(['.prompt .secondary-btn', 'ask again']);
    caption('Edits arrive as diffs. Permissions are buttons.');
    await sleep(2600);
    await click(['.prompt .secondary-btn', 'ask again']);
    await sleep(600);

    // 5. A command
    await box(['.prompt-desc', 'npm test']);
    caption('Allow once, allow always, or deny with a note.');
    await sleep(2200);
    await click(['.prompt .primary-btn', 'Allow']);
    director.fire('push');
    await sleep(900);
    caption('The task list, context use and cost stay in view.');
    await until(`!document.querySelector('.chat-composer .send-btn.stop') && Boolean(document.querySelector('.work-summary'))`, 'the end of the turn');
    await sleep(3200);

    // 6. The other session needs an answer
    await box(['.session[data-status="needs-you"]']);
    caption('Run sessions side by side. The sidebar shows which one needs you.');
    await camera(['.session[data-status="needs-you"]'], [40, 230, 380, 150]);
    await sleep(2400);
    await click(['.session[data-status="needs-you"] .session-main']);
    await camera(null);
    await box(['.prompt-desc', 'git push']);
    await sleep(1500);
    caption('Deny with a note, and Claude changes course.');
    await click(['.prompt .secondary-btn', 'Deny']);
    await sleep(300);
    await type(PROMPTS.deny, 34);
    await sleep(500);
    await click(['.prompt-deny .danger-btn']);
    await sleep(5200);

    // 7. The same conversation in Claude Code's CLI, and back
    await click(['.session .session-main', 'Add rate limiting']);
    await sleep(900);
    caption('Need the command line? Continue in Claude Code’s own CLI…');
    await click(['#topbar .text-btn', 'CLI']);
    await sleep(3600);
    caption('…and come back. It is the same conversation.');
    await click(['#topbar .text-btn', 'Chat']);
    await box(['.msg-text']);
    await sleep(2600);

    // 8. The Terminal panel
    caption('A shell in the project folder, one click away.');
    await click(['.panel-toggle']);
    await sleep(1600);
    await type('git status --short', 16);
    await key('Enter');
    await sleep(2600);
    await click(['.panel-toggle']);
    await sleep(500);

    // 9. Appearance
    caption('Light or dark, ten accent colors, your own background.');
    await click(['.sidebar-bottom .icon-btn']);
    await sleep(2000);
    await click(['.sidebar-bottom .ghost-btn']);
    await sleep(900);
    await click(['.settings-nav button', 'Appearance']);
    await sleep(600);
    await click(['.swatch[title="Purple"]']);
    await sleep(900);
    const image = path.join(root, 'dusk.png');
    fs.writeFileSync(image, wallpaper(960, 540));
    new Background(profile, settings).use(image);
    await click(['dialog[open] button[type="submit"]']);
    await sleep(2600);
    await click(['.sidebar-bottom .icon-btn']);
    await sleep(3200);

    recording = false;
    await loop;
    await Promise.all(writes);
    fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify({ size, duration: now(), frames, events }));
    console.log(`recorded ${frames.length} frames, ${(now() / 1000).toFixed(1)} s`);
  }

  wc.once('did-finish-load', async () => {
    try {
      await story();
    } catch (err) {
      console.error('failed:', err);
      recording = false;
      try { fs.writeFileSync(path.join(OUT, 'failed.png'), (await wc.capturePage()).toPNG()); } catch { /* window gone */ }
      process.exitCode = 1;
    }
    app.quit();
  });
});

require('../../src/main/main.js');
