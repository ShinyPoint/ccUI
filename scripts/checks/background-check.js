// Visual check of the background image, without API usage: a generated test image is set as the background
// of a throwaway profile; the script opens a chat (nothing is sent), the Terminal panel and Settings, checks
// the image is applied and that choosing and removing images works, and saves screenshots in dark and light.
// Usage: npx vite build && npx electron scripts/checks/background-check.js   (writes dist/background-check/*.png)
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { app } = require('electron');
const { tempDir } = require('./temp');
const { Background } = require('../../src/main/background');

const outDir = path.join(__dirname, '..', '..', 'dist', 'background-check');
const profile = tempDir('bg-profile');
const project = tempDir('bg-project');
fs.mkdirSync(outDir, { recursive: true });

// A small PNG encoder for the test image: a sunset-like gradient with a few soft discs.
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const discs = [[0.25, 0.3, 0.18, [255, 190, 90]], [0.7, 0.62, 0.24, [90, 170, 255]], [0.52, 0.18, 0.12, [255, 110, 160]]];
const image = png(640, 400, (x, y) => {
  const u = x / 640; const v = y / 400;
  let c = [40 + 120 * u, 30 + 60 * v, 110 + 100 * (1 - v)];
  for (const [cx, cy, r, col] of discs) {
    const d = Math.hypot(u - cx, (v - cy) * 0.625) / r;
    if (d < 1) c = c.map((ch, i) => ch + (col[i] - ch) * (1 - d * d));
  }
  return [...c.map((ch) => Math.max(0, Math.min(255, Math.round(ch)))), 255];
});
const imageFile = path.join(project, 'sunset.png');
fs.writeFileSync(imageFile, image);
fs.writeFileSync(path.join(project, 'notes.txt'), 'not an image');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

// Choosing and removing, on a separate fake profile.
{
  const dir = tempDir('bg-unit');
  const data = { backgroundImage: '' };
  const fake = { get: () => ({ ...data }), setPrivate: (patch) => Object.assign(data, patch) };
  const bg = new Background(dir, fake);
  check('a non-image is refused', !bg.use(path.join(project, 'notes.txt')).ok);
  const first = bg.use(imageFile);
  check('an image is copied in and becomes the background', first.ok && fs.existsSync(path.join(dir, 'backgrounds', data.backgroundImage)));
  const firstName = data.backgroundImage;
  const read = bg.read();
  check('it reads back as a PNG', read?.type === 'image/png' && read.data.equals(image));
  data.backgroundImage = '..\\..\\secret.png';
  check('a name outside the folder is not read', bg.read() === null);
  data.backgroundImage = firstName;
  bg.clear();
  check('removing clears the setting', data.backgroundImage === '' && bg.read() === null);
}

// The app itself, with the image already chosen.
fs.mkdirSync(path.join(profile, 'backgrounds'));
fs.writeFileSync(path.join(profile, 'backgrounds', 'background-1.png'), image);
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  language: 'en', theme: 'dark', confirmClose: false, notify: false, recent: [{ path: project, at: Date.now() }],
  trustedFolders: [project], backgroundImage: 'background-1.png',
}));
app.setPath('userData', profile);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.on('browser-window-created', (_e, win) => {
  win.setSize(1320, 860);
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => fs.writeFileSync(path.join(outDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(1500);
      check('the background is applied', await js(`document.documentElement.classList.contains('has-bg')
        && getComputedStyle(document.body, '::before').backgroundImage.includes('blob:')`));
      check('the window glass is off while an image is set', await js("!document.documentElement.classList.contains('glass')"));
      await shot('1-empty-dark');
      await js("document.querySelector('.empty-recent .primary-btn').click(); true");
      await wait(5000);
      await js(`{ const el = document.querySelector('.chat-composer .composer-input');
        el.value = 'Draft prompt over the background'; el.dispatchEvent(new Event('input', { bubbles: true })); } true`);
      await js("document.querySelector('.panel-toggle').click(); true");
      await wait(3500);
      await shot('2-chat-terminal-dark');
      // The project's name has no fill of its own, so the image shows through it like the rest of the bar.
      check('the project name sits in the bar without a fill', await js("getComputedStyle(document.querySelector('#topbar .project-menu .menu-button')).backgroundColor === 'rgba(0, 0, 0, 0)'"));
      // Frosted glass is on (the default): menus are see-through and blurred.
      await js("document.querySelector('.composer-bar .mode-menu .menu-button').click(); true");
      await wait(400);
      const frost = await js("(() => { const m = document.querySelector('.composer-bar .menu-list'); return m ? getComputedStyle(m).backdropFilter + ' | ' + getComputedStyle(m).backgroundColor : 'no menu'; })()");
      check('menus are frosted', /blur/.test(frost), frost);
      await shot('2b-frosted-menu-dark');
      await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
      await wait(200);
      await js("document.querySelector('.sidebar-bottom .icon-btn').click(); true");
      await wait(1200);
      await shot('3-chat-terminal-light');
      await js("[...document.querySelectorAll('.sidebar-bottom button')].find((b) => b.textContent.includes('Settings')).click(); true");
      await wait(800);
      await js("[...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent.includes('Appearance')).click(); true");
      await wait(400);
      check('Settings shows the image and its sliders', await js(`Boolean(document.querySelector('.bg-thumb:not(.empty)'))
        && [...document.querySelectorAll('.dialog .set-label')].some((l) => l.textContent.includes('Visibility'))`));
      await shot('4-settings');
      // Stronger image, less blur: saved and applied.
      await js(`{ const set = (label, v) => { const input = [...document.querySelectorAll('.dialog .set-row')]
          .find((f) => f.querySelector('.set-label').textContent === label).querySelector('input[type=range]');
          input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); };
        set('Visibility', 70); set('Blur', 2); } true`);
      await wait(200);
      await js("document.querySelector('.dialog .primary-btn[type=\"submit\"]').click(); true");
      await wait(600);
      check('the sliders apply', await js(`getComputedStyle(document.documentElement).getPropertyValue('--bg-show').trim() === '70%'
        && getComputedStyle(document.documentElement).getPropertyValue('--bg-blur').trim() === '2px'`));
      await shot('5-light-strong');
      // CLI over the image.
      await js("[...document.querySelectorAll('.text-btn')].find((b) => b.textContent.trim() === 'CLI').click(); true");
      await wait(6000);
      await shot('6-cli-light');
      // Over the image the CLI draws real text (xterm's DOM renderer), which stays sharp; WebGL would blur it.
      const renderer = await js("(() => { const h = document.querySelector('#stage .term-host.active'); return h ? JSON.stringify({ rows: Boolean(h.querySelector('.xterm-rows')), canvas: h.querySelectorAll('canvas').length }) : 'no terminal'; })()");
      check('the CLI over the image draws real text, not WebGL', /"rows":true/.test(renderer) && /"canvas":0/.test(renderer), renderer);
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
