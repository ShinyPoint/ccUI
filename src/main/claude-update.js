// The built-in Claude Code: installers don't carry it, so it is downloaded the first time it is needed, kept
// current between app releases, or set to a version chosen in Settings (claudeVersion). A build of the package
// the Agent SDK uses (from the npm registry) is downloaded, checked against the sha512 the registry publishes for
// it, unpacked into <userData>/claude-code/<version>/ and tried once with --version. claude-binary.js then uses
// it for new sessions; running sessions keep the build they started with.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { Readable } = require('stream');
const { execFile } = require('child_process');
const { EXE, VERSION, platformPackage, compareVersions, shipped, builtIn, resolveClaude } = require('./claude-binary');
const { t } = require('./i18n');

const REGISTRY = 'https://registry.npmjs.org';
const SDK = '@anthropic-ai/claude-agent-sdk';
const FIRST_CHECK = 30 * 1000; // after launch, once the app has settled
const EVERY = 6 * 60 * 60 * 1000;
const KEEP = 2; // downloaded builds kept: the newest, and the one before it (sessions may still run it)
const LIST_FOR = 10 * 60 * 1000; // how long the list of versions is kept before it is asked for again
const SHOWN = 10; // versions offered in Settings (any other can be typed in)

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
    this.list = null; // { at, versions }
    this.status = { state: 'idle', current: builtIn(this.pinned())?.version || null, pinned: this.pinned() };
    this.cleanUp();
  }

  // The version chosen in Settings, or '' for the newest.
  pinned() {
    const v = String(this.settings.get().claudeVersion || '').trim();
    return VERSION.test(v) ? v : '';
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch, current: builtIn(this.pinned())?.version || null, pinned: this.pinned() };
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

  // Released Claude Code versions with a build for this computer, newest first: [{ version, sdk, date }]
  // (`sdk`: the Agent SDK version whose platform package holds it). Asked for at most every LIST_FOR.
  async versions() {
    if (this.list && Date.now() - this.list.at < LIST_FOR) return this.list.versions;
    const doc = await this.json(`${REGISTRY}/${SDK}`);
    const byVersion = new Map();
    for (const [sdk, meta] of Object.entries(doc.versions || {})) {
      const version = meta.claudeCodeVersion;
      if (!VERSION.test(sdk) || !VERSION.test(version || '') || !meta.optionalDependencies?.[platformPackage()]) continue;
      const date = doc.time?.[sdk] || '';
      // Several SDK releases can carry the same Claude Code: the newest of them.
      if (!byVersion.has(version) || date > byVersion.get(version).date) byVersion.set(version, { version, sdk, date, pkg: meta.optionalDependencies[platformPackage()] });
    }
    const versions = [...byVersion.values()].sort((a, b) => compareVersions(b.version, a.version));
    this.list = { at: Date.now(), versions };
    return versions;
  }

  // Where to get a Claude Code version (the newest when `version` is empty): { version, tarball, integrity, size }.
  async release(version = '') {
    let sdk = null;
    let pkgVersion = null;
    if (version) {
      const found = (await this.versions()).find((v) => v.version === version);
      if (!found) throw new Error(t('There is no Claude Code {version} on npm for this computer.', { version }));
      ({ sdk, pkg: pkgVersion } = found);
      version = found.version;
    } else {
      const latest = await this.json(`${REGISTRY}/${SDK}/latest`);
      pkgVersion = latest.optionalDependencies?.[platformPackage()];
      version = latest.claudeCodeVersion;
      sdk = latest.version;
      if (!version || !pkgVersion) throw new Error(t('No Claude Code build for this computer was found.'));
    }
    const pkg = await this.json(`${REGISTRY}/${platformPackage()}/${pkgVersion}`);
    return { version, sdk, tarball: pkg.dist?.tarball, integrity: pkg.dist?.integrity, size: pkg.dist?.unpackedSize };
  }

  installed(version) {
    return fs.existsSync(path.join(this.dir, version, EXE)) || shipped()?.version === version;
  }

  // The versions offered in Settings: the newest SHOWN, each marked when it is on this computer already.
  async recent() {
    return (await this.versions()).slice(0, SHOWN).map(({ version, date }) => ({ version, date, here: this.installed(version) }));
  }

  async check() {
    if (this.running) return this.status;
    this.setStatus({ state: 'checking', error: null });
    try {
      const latest = await this.release();
      const current = builtIn(this.pinned())?.version;
      // A version chosen in Settings stays: the newest is only mentioned.
      const state = this.pinned() ? 'pinned' : !current || compareVersions(latest.version, current) > 0 ? 'available' : 'up-to-date';
      this.setStatus({ state, latest: latest.version, checkedAt: Date.now() });
    } catch (err) {
      this.setStatus({ state: 'error', error: err.message });
    }
    return this.status;
  }

  // Downloads and installs the newest build if it is newer than the built-in one (the chosen version, if it
  // isn't downloaded yet).
  update() {
    return this.run(() => this.install(this.pinned()));
  }

  // One download at a time: a request while one runs gets that one.
  run(job) {
    if (!this.running) this.running = job().finally(() => { this.running = null; });
    return this.running;
  }

  // install(version), after whatever download is running now.
  async installNext(version, options) {
    while (this.running) await this.running;
    return this.run(() => this.install(version, options));
  }

  // Before a session starts: true when there is a Claude Code to start, downloading one first if there is none
  // yet (the first session after installing, or a chosen version not downloaded). Sessions starting meanwhile
  // wait for the same download.
  async ensure() {
    const has = () => !resolveClaude(this.settings.get().claudePath, this.pinned()).missing;
    if (has()) return true;
    this.setStatus({ preparing: true }); // a Claude Code that is missing: starting sessions show it, see ChatView
    while (this.running) {
      await this.running;
      if (has()) return true;
    }
    await this.run(() => this.install(this.pinned(), { preparing: true }));
    return has();
  }

  // Settings → Claude Code → Version: `version` to use from now on (downloaded if needed), '' for the newest.
  // Resolves to { ok } or { ok: false, error }; the caller saves the choice once the version is in place.
  async use(version = '') {
    const wanted = String(version || '').trim();
    if (wanted && !VERSION.test(wanted)) return { ok: false, error: t('A version looks like 2.1.300.') };
    // Back to the newest: what is here already does until the next update (which may need a network).
    if (!wanted && builtIn('')) {
      if (!this.running) this.setStatus({ state: 'idle', error: null, target: null });
      return { ok: true };
    }
    const status = await this.installNext(wanted);
    return status.state === 'error' ? { ok: false, error: status.error } : { ok: true };
  }

  // Installs `version` (the newest when empty) unless it is there already. `preparing`: a session waits for it.
  // `latest` in the status is always the newest on npm, `target` the version this is about.
  async install(version = '', { preparing = false } = {}) {
    let tmp = null;
    let partial = null;
    const done = (state, extra) => {
      this.setStatus({ state, checkedAt: Date.now(), preparing: false, ...extra });
      return this.status;
    };
    try {
      if (version && this.installed(version)) return done('ready', { error: null, target: version });
      this.setStatus({ state: 'checking', error: null, preparing: preparing || this.status.preparing, target: version || null });
      const release = await this.release(version);
      const latest = version ? {} : { latest: release.version };
      if (!version) {
        const current = builtIn('')?.version;
        if (current && compareVersions(release.version, current) <= 0) return done('up-to-date', { ...latest, target: null });
      }
      if (!VERSION.test(release.version) || !/^https:\/\//.test(release.tarball || '')) throw new Error(t('The registry sent an unexpected answer.'));

      fs.mkdirSync(this.dir, { recursive: true });
      tmp = path.join(this.dir, `.download-${release.version}.tgz`);
      partial = path.join(this.dir, `.partial-${release.version}`);
      const res = await this.fetch(release.tarball);
      if (!res.ok || !res.body) throw new Error(t('The download failed ({status}).', { status: res.status }));
      const total = Number(res.headers.get('content-length')) || null;
      this.setStatus({ state: 'downloading', ...latest, target: release.version, received: 0, total });
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
      if (!integrityMatches(release.integrity, hash.digest('base64'))) {
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
      const final = path.join(this.dir, release.version);
      fs.rmSync(final, { recursive: true, force: true });
      fs.renameSync(partial, final);
      partial = null;
      this.prune(release.version);
      done('ready', { ...latest, target: release.version });
    } catch (err) {
      done('error', { error: err.message });
    } finally {
      if (tmp) fs.rmSync(tmp, { force: true });
      if (partial) try { fs.rmSync(partial, { recursive: true, force: true }); } catch { /* next start */ }
    }
    return this.status;
  }

  // Builds that will not be used again: older than the newest KEEP, or not newer than the shipped one. The
  // version chosen in Settings, and `keep` (just installed), stay.
  prune(keep = '') {
    const ship = shipped()?.version;
    const pinned = this.pinned();
    let names = [];
    try { names = fs.readdirSync(this.dir).filter((n) => VERSION.test(n)).sort((a, b) => compareVersions(b, a)); } catch { return; }
    names.forEach((n, i) => {
      if (n === pinned || n === keep) return;
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
  // With no built-in Claude Code at all (just installed), one is downloaded right away, so the first session
  // doesn't have to wait for it. After a failed try, the next one is when a session starts (or from Settings).
  configure() {
    if (this.usesBuiltIn() && !builtIn(this.pinned()) && !this.running && this.status.state !== 'error') this.ensure();
    this.setStatus({}); // the version in use may have changed with the settings
    const on = Boolean(this.settings.get().autoUpdateClaude) && this.usesBuiltIn() && !this.pinned();
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
