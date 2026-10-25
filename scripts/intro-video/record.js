// Intro video, step 1 of 2: records the app. Opens the built app on a throwaway profile with demo projects,
// plays the story in story.js (Claude and the terminals are scripted, see ../checks/fakes.js: no API usage), and saves
// what the window shows as numbered frames plus a timeline of captions, pointer moves and camera moves.
// Step 2 (compose.js) turns those into the video. One take per language: the app, Claude's words and the captions
// in English or Chinese, for the README in that language.
// Usage: npm run video   (both languages), or electron scripts/intro-video/record.js zh-CN   (writes dist/intro-video/<lang>/)
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { app } = require('electron');

// Twice the video's pixel density, so zoomed-in shots stay sharp.
app.commandLine.appendSwitch('force-device-scale-factor', '2');

const LANG = process.argv.includes('zh-CN') ? 'zh-CN' : 'en';
const OUT = path.join(__dirname, '..', '..', 'dist', 'intro-video', LANG);
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

const { install, sleep } = require('../checks/fakes');
const { createProjects, makeDirector, HISTORIES } = require('./story');
const projects = createProjects(home);
const director = makeDirector(projects, LANG);
const { T } = director;
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
  return { kind: 'chat', cwd: projects[h.project], title: T.histories[key][0], sessionId: `0000${key}-demo` };
};
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  // The look ccUI is shown in: light, Clay, at 110%, frosted glass, the work area to the window's edge. A current
  // settingsVersion, so no migration of older settings files touches it.
  language: LANG, uiScale: 110, theme: 'light', accent: 'ember', sidebarGlass: true, fillEdge: true,
  confirmClose: false, notify: false, settingsVersion: 8,
  autoUpdateClaude: false, // no real Claude Code download (and its toast) in the middle of the take
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

// In the page: the box of the nth element matching `sel` whose text contains `text`, in window pixels: the page's
// own (CSS) pixels times the UI scale (__zoom), since mouse events, the pointer and the frames are in those.
const FIND = `window.__box = (sel, text, nth) => {
  const el = [...document.querySelectorAll(sel)].filter((e) => !text || e.textContent.includes(text))[nth || 0];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const z = window.__zoom || 1;
  return r.width ? { x: r.left * z, y: r.top * z, w: r.width * z, h: r.height * z } : null;
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
  // Drags from `target` to where `to(from)` says, over `ms`.
  const drag = async (target, to, ms) => {
    await move(target);
    const from = pointer;
    const end = to(from);
    wc.sendInputEvent({ type: 'mouseDown', ...from, button: 'left', clickCount: 1 });
    await sleep(120);
    mark('move', { ...end, ms });
    const steps = Math.max(8, Math.round(ms / 30));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; // the same easing compose.js draws the pointer with
      wc.sendInputEvent({ type: 'mouseMove', x: Math.round(from.x + (end.x - from.x) * e), y: Math.round(from.y + (end.y - from.y) * e), modifiers: ['leftButtonDown'] });
      await sleep(ms / steps);
    }
    pointer = end;
    wc.sendInputEvent({ type: 'mouseUp', ...end, button: 'left', clickCount: 1 });
    await sleep(200);
  };
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

    // Before the recording starts: the second session gets its task (it works in the background the whole time),
    // then a new chat opens in orbit-api. Folders start folded at launch, except the open chat's: unfold the others.
    await until(`document.querySelectorAll('.folder').length === 3 && Boolean(document.querySelector('.chat-composer .composer-input'))`, 'restored sessions');
    // The UI scale is applied once the app has started (main.jsx), not at load: read it now.
    await js(`window.__zoom = ${wc.getZoomFactor()}; 0`);
    console.log('UI scale in the take:', wc.getZoomFactor(), 'language:', LANG);
    await js(`document.querySelectorAll('.folder.collapsed .folder-main').forEach((b) => b.click()); 0`);
    await until(`document.querySelectorAll('.session').length === 3`, 'the folders unfolded');
    await sleep(900);
    await js(`{ const el = document.querySelector('.chat-composer .composer-input');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(T.atlas)});
      el.dispatchEvent(new Event('input', { bubbles: true })); }`);
    await sleep(200);
    await js(`document.querySelector('.chat-composer .send-btn').click()`);
    await sleep(600);
    await js(`[...document.querySelectorAll('.folder')].find((f) => f.querySelector('.folder-name').textContent === 'orbit-api').querySelector('.folder-add').click()`);
    await until(`Boolean(document.querySelector('.chat-intro'))`, 'the new chat');
    await sleep(3500);
    wc.sendInputEvent({ type: 'mouseMove', ...pointer });

    record();
    const size = await js('({ w: Math.round(innerWidth * (window.__zoom || 1)), h: Math.round(innerHeight * (window.__zoom || 1)) })');

    // 1. The look: close on the new chat's question, then slowly out to the whole window.
    await camera(['.chat-intro'], [120, 90, 120, 160], 1);
    await sleep(500);
    await camera(null, undefined, 2200);
    await sleep(2100);

    // 2. A prompt; Claude thinks in words and works in steps, one even column.
    await click(['.chat-composer .composer-input']);
    await type(T.prompt, LANG === 'en' ? 64 : 22);
    await sleep(350);
    await key('Enter');
    await sleep(500);
    caption(T.captions.steps);
    await until(`Boolean(document.querySelector('.katex-display'))`, 'the answer', 30000);
    await sleep(600);

    // 3. The answer: math and code, typeset.
    caption(T.captions.math);
    await camera(['.msg-text', 'Retry-After'], [40, 30, 40, 30], 900);
    await sleep(2600);
    await camera(null, undefined, 700);
    await sleep(500);

    // 4. The same conversation in Claude Code's own CLI, and back.
    caption(T.captions.cli);
    await click(['#topbar .text-btn'], 600);
    await sleep(2200);
    await click(['#topbar .text-btn'], 300);
    await sleep(1000);

    // 5. The sidebar: wider, and a project dragged to the top.
    caption(T.captions.arrange);
    await drag(['.sidebar-resizer'], (from) => ({ x: from.x + 90, y: from.y }), 700);
    await sleep(400);
    const top = await box(['.folder-row']);
    await drag(['.folder-row', 'field-notes'], (from) => ({ x: from.x, y: top.y + 4 }), 900);
    await move({ x: 760, y: 420 }, 450); // off the row, before its tooltip shows
    await sleep(500);

    // 6. Looks: dark, then another color theme and a background image, which the video ends on.
    caption(T.captions.looks);
    await click(['.sidebar-bottom .icon-btn'], 600);
    await sleep(1000);
    await click(['.sidebar-bottom .ghost-btn'], 400);
    await sleep(450);
    await click(['.settings-nav button', T.labels.appearance], 450);
    await sleep(300);
    await click(['.swatch', null, 1], 450); // Pink
    await sleep(600);
    const image = path.join(root, 'dusk.png');
    fs.writeFileSync(image, wallpaper(960, 540));
    new Background(profile, settings).use(image);
    await click(['dialog[open] button[type="submit"]'], 400);
    await sleep(2200);

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
