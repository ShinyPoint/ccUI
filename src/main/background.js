// The window's background image. The chosen file is copied into the app's data folder (so moving or deleting
// the original changes nothing) and handed to the window as bytes: the window may only load files from the
// app itself (see guardRequests in main.js). Only the file named in the settings is ever read.
const fs = require('fs');
const path = require('path');
const { t } = require('./i18n');

const TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif', '.bmp': 'image/bmp',
};
const MAX_BYTES = 40 * 1024 * 1024;

class Background {
  constructor(dir, settings) {
    this.dir = path.join(dir, 'backgrounds');
    this.settings = settings;
  }

  static extensions() {
    return Object.keys(TYPES).map((ext) => ext.slice(1));
  }

  // Copies `file` in and makes it the background. Returns { ok, settings } or { ok: false, error }.
  use(file) {
    const ext = path.extname(file).toLowerCase();
    if (!TYPES[ext]) return { ok: false, error: t('Choose a PNG, JPEG, WebP, GIF, AVIF or BMP image.') };
    try {
      const { size } = fs.statSync(file);
      if (size > MAX_BYTES) return { ok: false, error: t('That image is larger than 40 MB.') };
      fs.mkdirSync(this.dir, { recursive: true });
      const name = `background-${Date.now()}${ext}`;
      fs.copyFileSync(file, path.join(this.dir, name));
      this.removeFiles(name);
      this.settings.setPrivate({ backgroundImage: name });
      return { ok: true, settings: this.settings.get() };
    } catch (err) {
      return { ok: false, error: t('The image could not be copied: {error}', { error: err.message }) };
    }
  }

  clear() {
    this.removeFiles(null);
    this.settings.setPrivate({ backgroundImage: '' });
    return { ok: true, settings: this.settings.get() };
  }

  // { type, data } of the current image, or null.
  read() {
    const name = this.settings.get().backgroundImage;
    const type = TYPES[path.extname(name || '').toLowerCase()];
    if (!name || !type || path.basename(name) !== name) return null;
    try {
      return { type, data: fs.readFileSync(path.join(this.dir, name)) };
    } catch {
      return null;
    }
  }

  // Deletes the copies other than `keep` (earlier choices).
  removeFiles(keep) {
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch { return; }
    for (const name of names) {
      if (name !== keep) fs.rm(path.join(this.dir, name), { force: true }, () => {});
    }
  }
}

module.exports = { Background };
