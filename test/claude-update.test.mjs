import test from 'node:test';
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
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ccui-update-test-'));

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
