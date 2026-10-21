import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractFromTar, integrityMatches, ClaudeUpdater } = require('../src/main/claude-update.js');
const { compareVersions, downloaded, builtIn, useDownloads, shipped, EXE } = require('../src/main/claude-binary.js');

// A tar archive, as npm packs them: ustar headers, pax headers for long names.
function header(name, size, type = '0') {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0);
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return h;
}
const pad = (buf) => Buffer.concat([buf, Buffer.alloc((512 - (buf.length % 512)) % 512)]);
function tar(entries) {
  const parts = [];
  for (const { name, data } of entries) {
    if (name.length > 100) {
      const rec = (len) => `${len} path=${name}\n`;
      let len = rec(0).length;
      while (rec(len).length !== len) len = rec(len).length;
      const pax = Buffer.from(rec(len));
      parts.push(header('PaxHeader', pax.length, 'x'), pad(pax));
    }
    parts.push(header(name, data.length), pad(data));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
const chunked = (buf, size = 1000) => Readable.from(Array.from({ length: Math.ceil(buf.length / size) }, (_, i) => buf.subarray(i * size, (i + 1) * size)));
// Throwaway folders, removed once the tests are done (left behind, every run would add some to the temp folder).
const made = [];
const tmpDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccui-update-test-'));
  made.push(dir);
  return dir;
};
after(() => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

test('the executable is taken out of a package tarball, past other files and long names', async () => {
  const exe = crypto.randomBytes(70000);
  const archive = tar([
    { name: 'package/package.json', data: Buffer.from('{"name":"x"}') },
    { name: `package/${'deep/'.repeat(30)}file.txt`, data: Buffer.from('long name') },
    { name: `package/${EXE}`, data: exe },
    { name: 'package/README.md', data: Buffer.from('readme') },
  ]);
  const dir = tmpDir();
  const dest = path.join(dir, EXE);
  assert.equal(await extractFromTar(chunked(zlib.gzipSync(archive)).pipe(zlib.createGunzip()), `package/${EXE}`, dest), true);
  assert.ok(fs.readFileSync(dest).equals(exe));
  const long = path.join(dir, 'long.txt');
  assert.equal(await extractFromTar(chunked(archive), `package/${'deep/'.repeat(30)}file.txt`, long), true);
  assert.equal(fs.readFileSync(long, 'utf8'), 'long name');
  assert.equal(await extractFromTar(chunked(archive), 'package/missing', path.join(dir, 'none')), false);
});

test('a download is used only if it matches the published sha512', () => {
  const data = Buffer.from('package');
  const digest = crypto.createHash('sha512').update(data).digest('base64');
  assert.equal(integrityMatches(`sha512-${digest}`, digest), true);
  assert.equal(integrityMatches(`sha512-${digest}`, crypto.createHash('sha512').update('other').digest('base64')), false);
  assert.equal(integrityMatches(`sha1-${digest}`, digest), false);
  assert.equal(integrityMatches(undefined, digest), false);
});

test('versions compare by number, not as text', () => {
  assert.equal(compareVersions('2.1.301', '2.1.287'), 1);
  assert.equal(compareVersions('2.1.99', '2.1.100'), -1);
  assert.equal(compareVersions('2.10.0', '2.9.9'), 1);
  assert.equal(compareVersions('2.1.3', '2.1.3'), 0);
});

test('the built-in Claude Code is the newest of the shipped build and the downloaded ones', () => {
  const dir = tmpDir();
  useDownloads(dir);
  const add = (name) => { fs.mkdirSync(path.join(dir, name)); fs.writeFileSync(path.join(dir, name, EXE), 'x'); };
  assert.equal(downloaded(), null);
  add('2.1.0');
  add('.partial-99.0.0');
  fs.mkdirSync(path.join(dir, '98.0.0')); // no executable in it
  assert.equal(downloaded().version, '2.1.0');
  const ship = shipped();
  if (ship?.version) assert.equal(builtIn().file, ship.file, 'an older download is not used');
  add('99.1.0');
  assert.equal(builtIn().version, '99.1.0');
  assert.equal(builtIn().downloaded, true);
  useDownloads(null);
});

test('a download with the wrong checksum is refused and leaves nothing behind', async () => {
  const dir = tmpDir();
  const archive = zlib.gzipSync(tar([{ name: `package/${EXE}`, data: Buffer.from('not claude') }]));
  const wrong = `sha512-${crypto.createHash('sha512').update('something else').digest('base64')}`;
  const responses = {
    'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/latest': () => Response.json({
      claudeCodeVersion: '99.0.0',
      optionalDependencies: { [`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`]: '9.0.0' },
    }),
    [`https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/9.0.0`]: () => Response.json({
      dist: { tarball: 'https://registry.npmjs.org/x.tgz', integrity: wrong },
    }),
    'https://registry.npmjs.org/x.tgz': () => new Response(archive, { headers: { 'content-length': String(archive.length) } }),
  };
  const states = [];
  const settings = { get: () => ({ autoUpdateClaude: false, claudePath: '' }) };
  const updater = new ClaudeUpdater(dir, settings, (_ch, st) => states.push(st.state), {
    fetch: async (url) => (responses[url] ? responses[url]() : new Response('', { status: 404 })),
  });
  const checked = await updater.check();
  assert.equal(checked.state, 'available');
  assert.equal(checked.latest, '99.0.0');
  const result = await updater.update();
  assert.equal(result.state, 'error');
  assert.match(result.error, /checksum/);
  assert.ok(states.includes('downloading'));
  assert.deepEqual(fs.readdirSync(dir), []);
});

// A registry with Claude Code releases for this computer: SDK `0.3.<n>` carries Claude Code `<cc>`.
const { platformPackage } = require('../src/main/claude-binary.js');
const PKG = platformPackage();
const REGISTRY = 'https://registry.npmjs.org';
function packument(releases) {
  const doc = { versions: {}, time: {} };
  for (const [sdk, meta, date] of releases) {
    doc.versions[sdk] = meta;
    doc.time[sdk] = date;
  }
  return doc;
}
const release = (n, cc, day) => [`0.3.${n}`, { claudeCodeVersion: cc, optionalDependencies: { [PKG]: `0.3.${n}` } }, `2026-09-${String(day).padStart(2, '0')}T00:00:00.000Z`];
const quiet = { get: () => ({ autoUpdateClaude: false, claudePath: '' }) };

test('the versions offered are released builds for this computer, newest first, ten of them', async () => {
  const doc = packument([
    ...Array.from({ length: 12 }, (_, i) => release(200 + i, `90.0.${i}`, i + 1)),
    release(300, '98.9.0', 20),
    release(301, '98.9.0', 21), // the same Claude Code again: the newer SDK release holds it
    ['0.3.302-beta.1', { claudeCodeVersion: '99.0.0-beta.1', optionalDependencies: { [PKG]: '0.3.302-beta.1' } }, '2026-09-22T00:00:00.000Z'],
    ['0.3.303', { optionalDependencies: { [PKG]: '0.3.303' } }, '2026-09-23T00:00:00.000Z'], // no Claude Code version
    ['0.3.304', { claudeCodeVersion: '99.1.0', optionalDependencies: { 'some-other-platform': '0.3.304' } }, '2026-09-24T00:00:00.000Z'],
  ]);
  const asked = [];
  const dir = tmpDir();
  const updater = new ClaudeUpdater(dir, quiet, () => {}, {
    fetch: async (url) => {
      asked.push(url);
      if (url === `${REGISTRY}/@anthropic-ai/claude-agent-sdk`) return Response.json(doc);
      if (url === `${REGISTRY}/${PKG}/0.3.301`) return Response.json({ dist: { tarball: 'https://registry.npmjs.org/b.tgz', integrity: 'sha512-x' } });
      return new Response('', { status: 404 });
    },
  });
  const all = await updater.versions();
  assert.deepEqual(all.slice(0, 3).map((v) => [v.version, v.sdk]), [['98.9.0', '0.3.301'], ['90.0.11', '0.3.211'], ['90.0.10', '0.3.210']]);
  assert.equal(all.length, 13);
  fs.mkdirSync(path.join(dir, '90.0.11'));
  fs.writeFileSync(path.join(dir, '90.0.11', EXE), 'x');
  const recent = await updater.recent();
  assert.equal(recent.length, 10);
  assert.deepEqual(recent.slice(0, 2).map((v) => [v.version, v.here]), [['98.9.0', false], ['90.0.11', true]]);
  assert.equal(asked.filter((u) => u.endsWith('/claude-agent-sdk')).length, 1, 'the list is asked for once, then kept a while');

  // A chosen version is fetched from the platform package of the SDK release that holds it.
  const found = await updater.release('98.9.0');
  assert.equal(found.tarball, 'https://registry.npmjs.org/b.tgz');
  await assert.rejects(updater.release('1.0.0'), /no Claude Code 1\.0\.0/);
});

test('a version chosen in Settings is used as it is, and no other', () => {
  const dir = tmpDir();
  useDownloads(dir);
  for (const v of ['2.1.0', '99.1.0']) {
    fs.mkdirSync(path.join(dir, v));
    fs.writeFileSync(path.join(dir, v, EXE), 'x');
  }
  assert.equal(builtIn('').version, '99.1.0');
  assert.equal(builtIn('2.1.0').version, '2.1.0');
  assert.equal(builtIn('50.0.0'), null, 'not downloaded: nothing, not some other version');
  const ship = shipped();
  if (ship?.version) assert.equal(builtIn(ship.version).file, ship.file);
  useDownloads(null);
});

test('sessions starting together without a Claude Code wait for one download of it', async () => {
  const dir = tmpDir();
  useDownloads(dir);
  // A stand-in that answers --version: Node itself on Windows (an .exe is needed), a script elsewhere.
  const exe = process.platform === 'win32' ? fs.readFileSync(process.execPath) : Buffer.from('#!/bin/sh\necho 98.9.0\n');
  const archive = zlib.gzipSync(tar([{ name: `package/${EXE}`, data: exe }]), { level: 1 });
  const integrity = `sha512-${crypto.createHash('sha512').update(archive).digest('base64')}`;
  const doc = packument([release(301, '98.9.0', 21)]);
  let downloads = 0;
  const settings = { get: () => ({ autoUpdateClaude: false, claudePath: '', claudeVersion: '98.9.0' }) };
  const states = [];
  const updater = new ClaudeUpdater(dir, settings, (_ch, st) => states.push(st), {
    fetch: async (url) => {
      if (url === `${REGISTRY}/@anthropic-ai/claude-agent-sdk`) return Response.json(doc);
      if (url === `${REGISTRY}/${PKG}/0.3.301`) return Response.json({ dist: { tarball: 'https://registry.npmjs.org/c.tgz', integrity } });
      if (url === 'https://registry.npmjs.org/c.tgz') {
        downloads++;
        return new Response(archive, { headers: { 'content-length': String(archive.length) } });
      }
      return new Response('', { status: 404 });
    },
  });
  assert.equal(updater.status.current, null);
  const [a, b] = await Promise.all([updater.ensure(), updater.ensure()]);
  assert.equal(a && b, true);
  assert.equal(downloads, 1);
  assert.equal(builtIn('98.9.0').version, '98.9.0');
  assert.ok(states.some((st) => st.state === 'downloading' && st.preparing && st.target === '98.9.0'), 'the sessions are told what they wait for');
  assert.deepEqual([updater.status.state, updater.status.preparing, updater.status.current], ['ready', false, '98.9.0']);
  assert.equal(await updater.ensure(), true);
  assert.equal(downloads, 1, 'once it is here, nothing more is downloaded');

  // Back to the newest: what is here does, without asking the network; a malformed version is refused.
  assert.deepEqual(await updater.use(''), { ok: true });
  assert.match((await updater.use('2.1')).error, /2\.1\.300/);
  useDownloads(null);
});
