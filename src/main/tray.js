// The icon in the system tray (the menu bar on macOS): always there while ccUI runs, so a window hidden by its
// close button (Settings → General → When the window is closed) can be brought back. Clicking it shows the
// window; its menu shows it or quits.
const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');
const { t } = require('./i18n');

const ASSETS = path.join(__dirname, '..', '..', 'assets');

function trayImage() {
  // Windows picks the 16 px (or, scaled, 20/24 px) picture from the .ico; elsewhere the PNG is drawn at the menu
  // bar's size. Both are inside app.asar in an installed copy, which Electron reads.
  if (process.platform === 'win32') return nativeImage.createFromPath(path.join(ASSETS, 'icon.ico'));
  const size = process.platform === 'darwin' ? 18 : 22;
  return nativeImage.createFromPath(path.join(ASSETS, 'icon.png')).resize({ width: size, height: size, quality: 'best' });
}

class AppTray {
  // `show`: bring the window back (or make one); `quit`: quit the app (asking first if sessions are running).
  constructor({ show, quit }) {
    this.show = show;
    this.quit = quit;
    this.tray = new Tray(trayImage());
    this.tray.setToolTip('ccUI');
    // On Windows and Linux a click shows the window and the menu opens on a right click; macOS opens the menu
    // on a click, as menu bar icons do.
    if (process.platform !== 'darwin') this.tray.on('click', () => this.show());
    this.build();
  }

  // Built again when the language changes.
  build() {
    if (this.tray.isDestroyed()) return;
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: t('Show ccUI'), click: () => this.show() },
      { type: 'separator' },
      { label: t('Quit ccUI'), click: () => this.quit() },
    ]));
  }

  destroy() {
    if (!this.tray.isDestroyed()) this.tray.destroy();
  }
}

module.exports = { AppTray };
