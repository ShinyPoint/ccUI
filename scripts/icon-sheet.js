// Renders the icon set next to the legacy set (dark and light, actual and large size) and saves
// dist/icon-sheet.png for review. Usage: npx electron scripts/icon-sheet.js
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow } = require('electron');

const lib = path.join(__dirname, '..', 'src', 'renderer', 'lib');
const out = path.join(__dirname, '..', 'dist');

function svg(body, stroke, size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

function panel(theme, ICONS, ICON_STROKE, LEGACY_ICONS, LEGACY_STROKE) {
  const names = Object.keys(ICONS);
  const row = (label, set, stroke, size) => `<div class="row"><span class="label">${label}</span>${names
    .map((n) => `<span class="cell" title="${n}">${svg(set[n] || '', stroke, size)}</span>`).join('')}</div>`;
  return `<section class="${theme}">
    <div class="row names"><span class="label"></span>${names.map((n) => `<span class="cell name">${n}</span>`).join('')}</div>
    ${row('old 16', LEGACY_ICONS, LEGACY_STROKE, 16)}
    ${row('new 16', ICONS, ICON_STROKE, 16)}
    ${row('old 32', LEGACY_ICONS, LEGACY_STROKE, 32)}
    ${row('new 32', ICONS, ICON_STROKE, 32)}
  </section>`;
}

app.whenReady().then(async () => {
  const { ICONS, ICON_STROKE } = await import(pathToFileURL(path.join(lib, 'icons.js')).href);
  const { LEGACY_ICONS, LEGACY_STROKE } = await import(pathToFileURL(path.join(lib, 'icons-legacy.js')).href);
  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; font: 11px system-ui, sans-serif; }
    section { padding: 14px 18px; }
    .dark { background: #161618; color: #F2F2F4; } .light { background: #FCFCFC; color: #1D1D1F; }
    .row { display: flex; align-items: center; height: 46px; }
    .names { height: 24px; opacity: .55; }
    .label { width: 54px; flex-shrink: 0; opacity: .55; }
    .cell { width: 56px; flex-shrink: 0; display: grid; place-items: center; }
    .name { font-size: 9.5px; }
  </style>${panel('dark', ICONS, ICON_STROKE, LEGACY_ICONS, LEGACY_STROKE)}${panel('light', ICONS, ICON_STROKE, LEGACY_ICONS, LEGACY_STROKE)}`;
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'icon-sheet.html');
  fs.writeFileSync(file, html);
  const width = 54 + 56 * Object.keys(ICONS).length + 40;
  const win = new BrowserWindow({ width, height: 560, show: false });
  await win.loadFile(file);
  await new Promise((r) => setTimeout(r, 300));
  fs.writeFileSync(path.join(out, 'icon-sheet.png'), (await win.webContents.capturePage()).toPNG());
  console.log('saved dist/icon-sheet.png');
  app.quit();
});
