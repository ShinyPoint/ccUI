// Renders the app icon: the sidebar's italic "cc" wordmark in clay, on a white tile. The tile is a superellipse
// (continuous corners, like Apple's icon shape), so its corners are the same shape at every size, with a lit
// edge: a white rim along the top, a faint shade along the bottom and a hairline outline that keeps it apart
// from light backgrounds; large sizes also float on a soft shadow. Writes assets/icon.png (1024×1024, on Apple's
// icon grid: macOS / Linux, and electron-builder's source) and assets/icon.ico (16–256 px, each size drawn on its
// own; Windows). `--preview` also saves dist/icon-preview.png: every size on light and dark.
// Usage: npm run icon   (npm run icon -- --preview)
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const SIZE = 1024;
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const fonts = path.join(__dirname, '..', 'node_modules', '@fontsource', 'instrument-serif', 'files');
const italic = fs.readdirSync(fonts).find((f) => /latin-400-italic\.woff2$/.test(f));

const html = `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: "Instrument Serif"; font-style: italic; src: url("${path.join(fonts, italic).replace(/\\/g, '/')}"); }
</style><body>`;

// Runs in the page. `tileShare`: the tile's side as a share of the canvas (Apple's grid puts an 824 px tile on a
// 1024 px canvas, leaving room for the shadow; the small Windows sizes use more of theirs).
const draw = (size, tileShare) => `(async () => {
  await document.fonts.load('italic 100px "Instrument Serif"');
  const size = ${size};
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const tile = size * ${tileShare};
  const x0 = (size - tile) / 2;
  const y0 = (size - tile) / 2 - (size >= 128 ? size * 0.008 : 0); // a touch up, above its shadow
  // The tile's outline: a superellipse, |x|^5 + |y|^5 = 1.
  const shape = (inset = 0) => {
    const r = tile / 2 - inset, cx = x0 + tile / 2, cy = y0 + tile / 2;
    ctx.beginPath();
    for (let i = 0; i < 720; i++) {
      const t = (i / 720) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
      const px = cx + r * Math.sign(c) * Math.abs(c) ** 0.4, py = cy + r * Math.sign(s) * Math.abs(s) ** 0.4;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  };
  const unit = Math.max(1, tile / 256); // one hairline at 256 px, never under a pixel

  // The tile, on its shadow when there is room for one.
  if (size >= 64) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
    ctx.shadowBlur = size * 0.035;
    ctx.shadowOffsetY = size * 0.012;
    shape();
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.restore();
  }
  const paper = ctx.createLinearGradient(0, y0, 0, y0 + tile);
  paper.addColorStop(0, '#FFFFFF');
  paper.addColorStop(0.55, '#FBFAF7');
  paper.addColorStop(1, '#EFECE5');
  shape();
  ctx.fillStyle = paper;
  ctx.fill();

  // The lit edge, inside the tile: bright along the top, shaded along the bottom.
  ctx.save();
  shape();
  ctx.clip();
  const rim = ctx.createLinearGradient(0, y0, 0, y0 + tile);
  rim.addColorStop(0, 'rgba(255, 255, 255, 1)');
  rim.addColorStop(0.45, 'rgba(255, 255, 255, 0.35)');
  rim.addColorStop(0.75, 'rgba(0, 0, 0, 0.02)');
  rim.addColorStop(1, 'rgba(120, 100, 80, 0.20)');
  shape(unit * 1.2);
  ctx.lineWidth = unit * 2.4;
  ctx.strokeStyle = rim;
  ctx.stroke();
  // A soft sheen across the upper half.
  const sheen = ctx.createRadialGradient(x0 + tile * 0.3, y0 - tile * 0.1, 0, x0 + tile * 0.3, y0 - tile * 0.1, tile * 0.9);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(x0, y0, tile, tile);
  ctx.restore();

  // The hairline outline, so the white tile keeps its edge on a white background.
  shape(unit * 0.5);
  ctx.lineWidth = unit;
  ctx.strokeStyle = 'rgba(60, 45, 30, ' + (size <= 32 ? 0.22 : 0.14) + ')';
  ctx.stroke();

  // "cc", centered by its ink bounds, in the warm top-to-bottom shade of Clay.
  const setFont = (px) => { ctx.font = 'italic ' + px + 'px "Instrument Serif"'; ctx.letterSpacing = (-0.03 * px) + 'px'; };
  setFont(1000);
  let m = ctx.measureText('cc');
  const fill = tile * (size <= 24 ? 0.66 : 0.6);
  setFont(1000 * fill / Math.max(m.actualBoundingBoxLeft + m.actualBoundingBoxRight, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent));
  m = ctx.measureText('cc');
  const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  const x = x0 + (tile - w) / 2 + m.actualBoundingBoxLeft, y = y0 + (tile - h) / 2 + m.actualBoundingBoxAscent;
  const shade = ctx.createLinearGradient(0, y - m.actualBoundingBoxAscent, 0, y + m.actualBoundingBoxDescent);
  shade.addColorStop(0, '#E8936A');
  shade.addColorStop(0.5, '#D97757');
  shade.addColorStop(1, '#C2603C');
  ctx.fillStyle = shade;
  ctx.fillText('cc', x, y);
  return canvas.toDataURL('image/png');
})()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  const file = path.join(app.getPath('temp'), 'ccui-icon.html');
  fs.writeFileSync(file, html);
  await win.loadFile(file);
  const render = async (size, share) => Buffer.from((await win.webContents.executeJavaScript(draw(size, share))).split(',')[1], 'base64');
  const out = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(out, { recursive: true });
  const big = await render(SIZE, 824 / 1024);
  fs.writeFileSync(path.join(out, 'icon.png'), big);
  const pngs = [];
  for (const size of ICO_SIZES) pngs.push({ size, data: await render(size, size <= 48 ? 0.94 : 0.88) });
  fs.writeFileSync(path.join(out, 'icon.ico'), ico(pngs));
  console.log('saved assets/icon.png and assets/icon.ico');
  if (process.argv.includes('--preview')) await preview(win, [...pngs, { size: 1024, data: big, shown: 256 }]);
  app.quit();
});

// Every size at its own pixel size (the 1024 one at 256), on the light and the dark theme's backgrounds.
async function preview(win, images) {
  const row = (bg) => `<div style="display:flex;align-items:center;gap:18px;padding:24px;background:${bg}">${images
    .map((im) => `<img src="data:image/png;base64,${im.data.toString('base64')}" width="${im.shown || im.size}" height="${im.shown || im.size}">`).join('')}</div>`;
  win.setContentSize(1300, 640);
  const page = path.join(app.getPath('temp'), 'ccui-icon-preview.html');
  fs.writeFileSync(page, `<body style="margin:0">${row('#F3F3F3')}${row('#1E1E1E')}${row('#5A6B7D')}</body>`);
  await win.loadFile(page);
  await new Promise((r) => setTimeout(r, 300));
  const dist = path.join(__dirname, '..', 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'icon-preview.png'), (await win.webContents.capturePage()).toPNG());
  console.log('saved dist/icon-preview.png');
}

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
