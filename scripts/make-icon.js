// Renders the app icon (the sidebar's italic "cc" wordmark, no tile) with a transparent background:
// assets/icon.png (1024×1024; macOS / Linux, and electron-builder's source) and assets/icon.ico (16–256 px,
// each size drawn on its own; Windows uses it for the taskbar). The letters are measured and centered
// exactly. Usage: npm run icon
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const SIZE = 1024;
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const FILL = 0.86; // the letters' larger side, as a share of the canvas
const fonts = path.join(__dirname, '..', 'node_modules', '@fontsource', 'instrument-serif', 'files');
const italic = fs.readdirSync(fonts).find((f) => /latin-400-italic\.woff2$/.test(f));

const html = `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: "Instrument Serif"; font-style: italic; src: url("${path.join(fonts, italic).replace(/\\/g, '/')}"); }
</style><body>`;

// Runs in the page: draws "cc" centered by its ink bounds, with the warm top-to-bottom shade of the accent.
const draw = (size) => `(async () => {
  await document.fonts.load('italic 100px "Instrument Serif"');
  const size = ${size}, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const setFont = (px) => { ctx.font = 'italic ' + px + 'px "Instrument Serif"'; ctx.letterSpacing = (-0.03 * px) + 'px'; };
  setFont(1000);
  let m = ctx.measureText('cc');
  const scale = ${FILL} * size / Math.max(m.actualBoundingBoxLeft + m.actualBoundingBoxRight, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
  setFont(1000 * scale);
  m = ctx.measureText('cc');
  const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  const x = (size - w) / 2 + m.actualBoundingBoxLeft, y = (size - h) / 2 + m.actualBoundingBoxAscent;
  const shade = ctx.createLinearGradient(0, y - m.actualBoundingBoxAscent, 0, y + m.actualBoundingBoxDescent);
  shade.addColorStop(0, '#F5A57C');
  shade.addColorStop(0.5, '#E58A5E');
  shade.addColorStop(1, '#CF6E44');
  ctx.fillStyle = shade;
  ctx.fillText('cc', x, y);
  return canvas.toDataURL('image/png');
})()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  const file = path.join(app.getPath('temp'), 'ccui-icon.html');
  fs.writeFileSync(file, html);
  await win.loadFile(file);
  const render = async (size) => Buffer.from((await win.webContents.executeJavaScript(draw(size))).split(',')[1], 'base64');
  const out = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.png'), await render(SIZE));
  const pngs = [];
  for (const size of ICO_SIZES) pngs.push({ size, data: await render(size) });
  fs.writeFileSync(path.join(out, 'icon.ico'), ico(pngs));
  console.log('saved assets/icon.png and assets/icon.ico');
  app.quit();
});

// An .ico file holding PNG images (supported since Windows Vista): a 6-byte header, one 16-byte entry per
// image, then the images.
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e); // 0 means 256
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2); // no palette
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4); // color planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((im) => im.data)]);
}
