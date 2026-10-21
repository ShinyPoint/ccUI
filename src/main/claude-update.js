// Keeps the built-in Claude Code current between app releases. The newest build of the package the app ships
// (from the npm registry) is downloaded, checked against the sha512 the registry publishes for it, unpacked into
// <userData>/claude-code/<version>/ and tried once with --version. claude-binary.js then uses it for new
// sessions; running sessions keep the build they started with.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { Readable } = require('stream');
const { execFile } = require('child_process');
const { EXE, VERSION, platformPackage, compareVersions, shipped, builtIn } = require('./claude-binary');
const { t } = require('./i18n');

const REGISTRY = 'https://registry.npmjs.org';
const SDK = '@anthropic-ai/claude-agent-sdk';
const FIRST_CHECK = 30 * 1000; // after launch, once the app has settled
const EVERY = 6 * 60 * 60 * 1000;
const KEEP = 2; // downloaded builds kept: the newest, and the one before it (sessions may still run it)

// Reads a stream of chunks a given number of bytes at a time.
function reader(chunks) {
  const it = chunks[Symbol.asyncIterator]();
  let buf = Buffer.alloc(0);
  return {
    // Up to n bytes; fewer only at the end of the stream.
    async take(n) {
      while (buf.length < n) {
        const { value, done } = await it.next();
        if (done) break;
        buf = buf.length ? Buffer.concat([buf, value]) : value;
      }
      const out = buf.subarray(0, n);
      buf = buf.subarray(n);
      return out;
    },
  };
}

// Writes the file called `wanted` in a tar stream to `dest`. True if it was there. Handles the ustar name
// prefix and long names (pax and GNU), which is all npm tarballs use.
async function extractFromTar(chunks, wanted, dest) {
  const r = reader(chunks);
  let longName = null;
  for (;;) {
    const h = await r.take(512);
    if (h.length < 512 || h.every((b) => b === 0)) return false;
    const field = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0[\s\S]*$/, '');
    const size = parseInt(field(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48); // NUL is an old way to say "a file"
    const prefix = field(257, 263).startsWith('ustar') ? field(345, 500) : '';
    const name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    longName = null;
    const padded = Math.ceil(size / 512) * 512;
    if (type === 'x' || type === 'L') {
      const body = (await r.take(padded)).subarray(0, size).toString('utf8');
      longName = type === 'L' ? body.replace(/\0[\s\S]*$/, '') : (/(?:^|\n)\d+ path=([^\n]*)\n/.exec(body)?.[1] ?? null);
      continue;
    }
    if (type === '0' && name === wanted) {
      const fh = await fs.promises.open(dest, 'w', 0o755);
      try {
        for (let left = size; left > 0;) {
          const part = await r.take(Math.min(left, 1 << 20));
          if (!part.length) throw new Error(t('The download ended early.'));
          await fh.write(part);
          left -= part.length;
        }
      } finally {
        await fh.close();
      }
      return true;
    }
    for (let left = padded; left > 0;) {
      const part = await r.take(Math.min(left, 1 << 20));
      if (!part.length) return false;
      left -= part.length;
    }
  }
}

// "sha512-<base64>" from the registry, checked against what was downloaded.
function integrityMatches(integrity, digestBase64) {
  const m = /^sha512-(.+)$/.exec(integrity || '');
  return Boolean(m) && m[1] === digestBase64;
}

const runVersion = (file) => new Promise((resolve) => {
  execFile(file, ['--version'], { timeout: 60000, windowsHide: true } /* a virus scan of a new file can take a while */, (_err, stdout) => {
    resolve(/(\d+\.\d+\.\d+)/.exec(stdout || '')?.[1] || null);
  });
});

class ClaudeUpdater {
  // `fetch`: Electron's net.fetch (uses the system proxy); replaceable in tests.
  constructor(dir, settings, send, { fetch } = {}) {
    this.dir = dir;
    this.settings = settings;
    this.send = send;
    this.fetch = fetch || ((url) => require('electron').net.fetch(url));
    this.timer = null;
    this.auto = false;
    this.round = 0;
    this.running = null;
    this.status = { state: 'idle', current: builtIn()?.version || null };
    this.cleanUp();
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch, current: builtIn()?.version || null };
    this.send('claude-update:state', this.status);
  }

  // Only the built-in build is updated; a Claude Code chosen in Settings is the user's to update.
  usesBuiltIn() {
    return !(this.settings.get().claudePath || '').trim();
  }

  async json(url) {
    const res = await this.fetch(url);
    if (!res.ok) throw new Error(t('The npm registry answered {status}.', { status: res.status }));
    return res.json();
  }

  // What the registry has: { version (Claude Code's), tarball, integrity, size }.
  async latest() {
    const sdk = await this.json(`${REGISTRY}/${SDK}/latest`);
    const pkgVersion = sdk.optionalDependencies?.[platformPackage()];
    if (!sdk.claudeCodeVersion || !pkgVersion) throw new Error(t('No Claude Code build for this computer was found.'));
    const pkg = await this.json(`${REGISTRY}/${platformPackage()}/${pkgVersion}`);
    return { version: sdk.claudeCodeVersion, tarball: pkg.dist?.tarball, integrity: pkg.dist?.integrity, size: pkg.dist?.unpackedSize };
  }

  async check() {
    if (this.running) return this.status;
    this.setStatus({ state: 'checking', error: null });
    try {
      const latest = await this.latest();
      const current = builtIn()?.version;
      const newer = !current || compareVersions(latest.version, current) > 0;
      this.setStatus({ state: newer ? 'available' : 'up-to-date', latest: latest.version, checkedAt: Date.now() });
    } catch (err) {
      this.setStatus({ state: 'error', error: err.message });
    }
    return this.status;
  }

  // Downloads and installs the newest build if it is newer than the built-in one. One at a time.
  update() {
    if (!this.running) this.running = this.install().finally(() => { this.running = null; });
    return this.running;
  }

  async install() {
    let tmp = null;
    let partial = null;
    try {
      this.setStatus({ state: 'checking', error: null });
      const latest = await this.latest();
      const current = builtIn()?.version;
      if (current && compareVersions(latest.version, current) <= 0) {
        this.setStatus({ state: 'up-to-date', latest: latest.version, checkedAt: Date.now() });
        return this.status;
      }
      if (!VERSION.test(latest.version) || !/^https:\/\//.test(latest.tarball || '')) throw new Error(t('The registry sent an unexpected answer.'));

      fs.mkdirSync(this.dir, { recursive: true });
      tmp = path.join(this.dir, `.download-${latest.version}.tgz`);
      partial = path.join(this.dir, `.partial-${latest.version}`);
      const res = await this.fetch(latest.tarball);
      if (!res.ok || !res.body) throw new Error(t('The download failed ({status}).', { status: res.status }));
      const total = Number(res.headers.get('content-length')) || null;
      this.setStatus({ state: 'downloading', latest: latest.version, received: 0, total });
      const hash = crypto.createHash('sha512');
      const out = fs.createWriteStream(tmp);
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
      if (!integrityMatches(latest.integrity, hash.digest('base64'))) {
        throw new Error(t('The download did not match its published checksum, so it was not used.'));
      }

      this.setStatus({ state: 'installing', received });
      fs.rmSync(partial, { recursive: true, force: true });
      fs.mkdirSync(partial);
      const file = path.join(partial, EXE);
      const found = await extractFromTar(fs.createReadStream(tmp).pipe(zlib.createGunzip()), `package/${EXE}`, file);
      if (!found) throw new Error(t('The download has no Claude Code in it.'));
      const reported = await runVersion(file);
      if (!reported) throw new Error(t('The new Claude Code did not start.'));
      const final = path.join(this.dir, latest.version);
      fs.rmSync(final, { recursive: true, force: true });
      fs.renameSync(partial, final);
      partial = null;
      this.prune();
      this.setStatus({ state: 'ready', latest: latest.version, checkedAt: Date.now() });
    } catch (err) {
      this.setStatus({ state: 'error', error: err.message });
    } finally {
      if (tmp) fs.rmSync(tmp, { force: true });
      if (partial) try { fs.rmSync(partial, { recursive: true, force: true }); } catch { /* next start */ }
    }
    return this.status;
  }

  // Builds that will not be used again: older than the newest KEEP, or not newer than the shipped one.
  prune() {
    const ship = shipped()?.version;
    let names = [];
    try { names = fs.readdirSync(this.dir).filter((n) => VERSION.test(n)).sort((a, b) => compareVersions(b, a)); } catch { return; }
    names.forEach((n, i) => {
      if (i < KEEP && !(ship && compareVersions(n, ship) <= 0)) return;
      // A build a session is still running cannot be removed on Windows; it goes on a later start.
      try { fs.rmSync(path.join(this.dir, n), { recursive: true, force: true }); } catch { /* in use */ }
    });
  }

  // Leftovers of a download that was cut off (the app quit halfway).
  cleanUp() {
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch { return; }
    for (const n of names) {
      if (n.startsWith('.download-') || n.startsWith('.partial-')) {
        try { fs.rmSync(path.join(this.dir, n), { recursive: true, force: true }); } catch { /* in use */ }
      }
    }
    this.prune();
  }

  // Starts or stops the automatic updates to match the settings. Called at launch and when settings change.
  configure() {
    const on = Boolean(this.settings.get().autoUpdateClaude) && this.usesBuiltIn();
    if (on === this.auto) return;
    this.auto = on;
    clearTimeout(this.timer);
    if (!on) return;
    const round = ++this.round; // a check still running from before a switch off and on again ends its round
    const run = (delay) => {
      this.timer = setTimeout(async () => {
        await this.update();
        if (this.auto && round === this.round) run(EVERY);
      }, delay);
    };
    run(FIRST_CHECK);
  }
}

module.exports = { ClaudeUpdater, extractFromTar, integrityMatches };
