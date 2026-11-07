// DeepSeek Harness isn't in the installers (about 900 MB with its Node), and it needs a newer Node than Electron's,
// which can't run as Node anyway. Turning it on in Settings downloads both into <userData>/dsh: an exact Node build,
// checked against the SHA-256 written here, and exactly the packages in dsh-deps/npm-lock.json, which npm checks
// against the hashes there. Developer previews of dsh change without warning, so its version only changes with ccUI.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { execFile, spawn } = require('child_process');
const { t } = require('./i18n');

const DSH_VERSION = '0.2.2-rc.1';
const NODE_VERSION = '26.13.0';
// From https://nodejs.org/dist/v26.13.0/SHASUMS256.txt
const NODE_BUILDS = {
  'win32-x64': { name: 'win-x64', ext: 'zip', sha256: 'dcc60d59a0746999f99064a01c020445d54d84228c691cdbf25b49ac3b59150a' },
  'win32-arm64': { name: 'win-arm64', ext: 'zip', sha256: 'a9427139595156ef484e1fb08957676e09d4232368dd1743a2a9f93f3d241b14' },
  'darwin-x64': { name: 'darwin-x64', ext: 'tar.gz', sha256: '525c9b29bb0263d687de60a4cec0e2a6db876a8eb032369e5795eca71e7c358e' },
  'darwin-arm64': { name: 'darwin-arm64', ext: 'tar.gz', sha256: 'd38bd5e5a2ddce6bbb5ce45e46e208337da4d51fffe611e567fd32073d6439f6' },
  'linux-x64': { name: 'linux-x64', ext: 'tar.gz', sha256: '5848553868b402d3fabb5b09270649977780a390f832155721025a08b5104455' },
  'linux-arm64': { name: 'linux-arm64', ext: 'tar.gz', sha256: '439e9c438acdf6a6ffe47418da709153d66c4bed812e30a473faacb107dd2791' },
};
const SOURCES = {
  '': { node: 'https://nodejs.org/dist', npm: 'https://registry.npmjs.org' },
  npmmirror: { node: 'https://npmmirror.com/mirrors/node', npm: 'https://registry.npmmirror.com' },
};
// The permission presets ccUI's modes run under (dsh-bridge.mjs PRESETS). `ccui-ask` leaves commands unconfined
// because the plugin's gate asks before each one.
const PRESET_TABLE = {
  'ccui-ask': { sandbox: 'danger-full-access', approval: 'ask' },
  'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
  'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
};

const IS_WIN = process.platform === 'win32';

class DshInstaller {
  // `dir`: <userData>/dsh. `fetch`, `proxyFor(url)`: Electron's, through the system proxy; replaceable in tests.
  constructor(dir, settings, send, { fetch, proxyFor } = {}) {
    this.dir = dir;
    this.settings = settings;
    this.send = send;
    this.fetch = fetch || ((url) => require('electron').net.fetch(url));
    this.proxyFor = proxyFor || (async () => '');
    this.running = null;
    this.status = { state: this.installed() ? 'ready' : 'absent', version: DSH_VERSION };
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch, version: DSH_VERSION };
    this.send('dsh-install:state', this.status);
  }

  nodeDir() { return path.join(this.dir, `node-${NODE_VERSION}`); }
  packageDir() { return path.join(this.dir, DSH_VERSION); }

  nodeFile() {
    return IS_WIN ? path.join(this.nodeDir(), 'node.exe') : path.join(this.nodeDir(), 'bin', 'node');
  }

  installed() {
    return Boolean(process.env.CCUI_DSH_DIR) || (fs.existsSync(this.nodeFile()) && fs.existsSync(path.join(this.packageDir(), '.complete')));
  }

  // DSH_HOME: dsh's settings, skills and conversations. Kept when dsh is removed or updated.
  home() {
    return process.env.CCUI_DSH_HOME || path.join(this.dir, 'home');
  }

  // Everything a session needs to start dsh. CCUI_DSH_DIR: a dsh already unpacked (the checks).
  paths() {
    const packages = process.env.CCUI_DSH_DIR || this.packageDir();
    const home = this.home();
    fs.mkdirSync(home, { recursive: true });
    const bridge = path.join(packages, 'ccui-bridge.mjs');
    fs.writeFileSync(bridge, fs.readFileSync(path.join(__dirname, 'dsh-bridge.mjs'))); // a real file for dsh's Node
    return {
      node: process.env.CCUI_DSH_NODE || this.nodeFile(),
      bin: path.join(packages, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      bridge,
      patch: path.join(packages, 'ccui.patch.yml'),
      home,
      checkpoints: path.join(home, 'ccui-checkpoints'),
    };
  }

  // Before a session starts: true when dsh is here, downloading it first if not.
  async ensure() {
    if (this.installed()) return true;
    this.setStatus({ preparing: true });
    await this.install();
    return this.installed();
  }

  install() {
    if (!this.running) this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }

  async run() {
    const mirror = SOURCES[this.settings.get().dshMirror] || SOURCES[''];
    try {
      this.setStatus({ state: 'checking', error: null, received: 0, total: 0 });
      fs.mkdirSync(this.dir, { recursive: true });
      if (!fs.existsSync(this.nodeFile())) await this.installNode(mirror);
      this.setStatus({ state: 'installing', received: 0, total: 0 });
      await this.installPackages(mirror);
      this.prune();
      this.setStatus({ state: 'ready', preparing: false });
    } catch (err) {
      this.setStatus({ state: 'error', error: err.message, preparing: false });
    }
    return this.status;
  }

  async installNode(mirror) {
    const build = NODE_BUILDS[`${process.platform}-${process.arch}`];
    if (!build) throw new Error(t('DeepSeek Harness is not available for this computer.'));
    const file = `node-v${NODE_VERSION}-${build.name}.${build.ext}`;
    const archive = path.join(this.dir, `.download-${file}`);
    const partial = path.join(this.dir, `.partial-node-${NODE_VERSION}`);
    try {
      const res = await this.fetch(`${mirror.node}/v${NODE_VERSION}/${file}`);
      if (!res.ok || !res.body) throw new Error(t('The download failed ({status}).', { status: res.status }));
      const total = Number(res.headers.get('content-length')) || 0;
      this.setStatus({ state: 'downloading', received: 0, total });
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(archive);
      let received = 0;
      let shown = 0;
      try {
        for await (const chunk of Readable.fromWeb(res.body)) {
          hash.update(chunk);
          if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
          received += chunk.length;
          if (received - shown > 512 * 1024) {
            shown = received;
            this.setStatus({ received });
          }
        }
      } finally {
        await new Promise((r) => out.end(r));
      }
      if (hash.digest('hex') !== build.sha256) throw new Error(t('The download did not match its published checksum, so it was not used.'));
      fs.rmSync(partial, { recursive: true, force: true });
      fs.mkdirSync(partial);
      await unpack(archive, partial);
      const inner = path.join(partial, `node-v${NODE_VERSION}-${build.name}`);
      fs.rmSync(this.nodeDir(), { recursive: true, force: true });
      fs.renameSync(inner, this.nodeDir());
    } finally {
      fs.rmSync(archive, { force: true });
      fs.rmSync(partial, { recursive: true, force: true });
    }
  }

  async installPackages(mirror) {
    const dir = this.packageDir();
    fs.rmSync(path.join(dir, '.complete'), { force: true });
    fs.mkdirSync(dir, { recursive: true });
    // The lock file ships as npm-lock.json: electron-builder leaves any file named package-lock.json out of the app.
    fs.copyFileSync(path.join(__dirname, 'dsh-deps', 'package.json'), path.join(dir, 'package.json'));
    fs.copyFileSync(path.join(__dirname, 'dsh-deps', 'npm-lock.json'), path.join(dir, 'package-lock.json'));
    const npm = IS_WIN ? path.join(this.nodeDir(), 'node_modules', 'npm', 'bin', 'npm-cli.js') : path.join(this.nodeDir(), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const proxy = await this.proxyFor(mirror.npm);
    await new Promise((resolve, reject) => {
      // --ignore-scripts: nothing downloaded runs as it is installed. The lock file's hashes hold with any registry.
      const child = spawn(this.nodeFile(), [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--progress=false', '--loglevel=error', `--registry=${mirror.npm}`, '--replace-registry-host=always'], {
        cwd: dir,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, NODE_OPTIONS: '', ...(proxy ? { HTTPS_PROXY: proxy, HTTP_PROXY: proxy } : {}) },
      });
      let errors = '';
      child.stderr.on('data', (d) => { errors = (errors + d).slice(-2000); });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(t('The packages could not be installed: {reason}', { reason: errors.trim().split('\n').slice(-2).join(' ') || code })));
      });
    });
    // The builds of LibreOffice and of a speech recognizer, for dsh's Office skill and voice input (about 250 MB):
    // chats here use neither. Not --omit=optional, which also drops native parts dsh can't start without.
    const modules = path.join(dir, 'node_modules');
    for (const [scope, prefix] of [['@deepseek-ai', 'libreoffice-kit-'], ['', 'sherpa-onnx-']]) {
      let names = [];
      try { names = fs.readdirSync(path.join(modules, scope)); } catch { continue; }
      for (const name of names.filter((n) => n.startsWith(prefix))) fs.rmSync(path.join(modules, scope, name), { recursive: true, force: true });
    }
    fs.writeFileSync(path.join(dir, '.complete'), DSH_VERSION);
  }

  // Other versions of dsh and Node, left by an earlier ccUI. One a session still runs can't go on Windows: next time.
  prune() {
    for (const name of fs.readdirSync(this.dir)) {
      if (name === DSH_VERSION || name === `node-${NODE_VERSION}` || name === 'home') continue;
      try { fs.rmSync(path.join(this.dir, name), { recursive: true, force: true }); } catch { /* in use */ }
    }
  }

  // Settings → Remove: the program, not the conversations (home).
  async remove() {
    if (this.running) await this.running;
    try {
      fs.rmSync(this.packageDir(), { recursive: true, force: true });
      fs.rmSync(this.nodeDir(), { recursive: true, force: true });
      this.setStatus({ state: 'absent', error: null });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

// Unpacks an archive with the system's tar (on Windows 10 and later it reads zip too; Git's tar on the PATH doesn't,
// so System32's by name).
function unpack(archive, dest) {
  const tar = IS_WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  return new Promise((resolve, reject) => {
    execFile(tar, ['-xf', archive, '-C', dest], { windowsHide: true, timeout: 5 * 60 * 1000 }, (err, _out, stderr) => {
      if (err) reject(new Error(t('The download could not be unpacked: {reason}', { reason: stderr || err.message })));
      else resolve();
    });
  });
}

module.exports = { DshInstaller, DSH_VERSION, NODE_VERSION, PRESET_TABLE };
