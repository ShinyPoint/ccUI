// Builds the window once, then runs the scripted checks one after another (Claude is faked by fakes.js: no API
// usage, no network) and sums them up. Each check prints PASS / FAIL lines and saves screenshots under dist/.
// Usage: npm run check                    every scripted check
//        npm run check -- changes i18n    only these
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPTED = ['agents', 'changes', 'chat-look', 'cli', 'commands', 'dialogs', 'effort', 'glass', 'i18n', 'rewind', 'select', 'sessions', 'sidebar'];
const electron = createRequire(import.meta.url)('electron'); // from Node, the package is the path to its binary

const names = process.argv.slice(2).length ? process.argv.slice(2) : SCRIPTED;
await build({ configFile: path.join(root, 'vite.config.mjs'), logLevel: 'warn' });

const failed = [];
for (const name of names) {
  const started = Date.now();
  // A check that doesn't parse would stop Electron at a modal error dialog until someone closes it: Node reports
  // it here instead.
  const parse = spawnSync(process.execPath, ['--check', path.join(root, 'scripts', 'checks', `${name}-check.js`)], { encoding: 'utf8' });
  if (parse.status !== 0) {
    failed.push(name);
    console.log(`FAIL  ${name} (does not parse)`);
    for (const line of parse.stderr.split(/\r?\n/).filter(Boolean).slice(0, 5)) console.log(`      ${line}`);
    continue;
  }
  const run = spawnSync(electron, [path.join(root, 'scripts', 'checks', `${name}-check.js`)], {
    cwd: root,
    env: { ...process.env, VITE_DEV_SERVER_URL: '' }, // the built window, never a dev server
    encoding: 'utf8',
    timeout: 5 * 60 * 1000,
  });
  // Its throwaway folders (temp.js) that its window's helper processes still held when it exited: gone now.
  for (const name of fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('ccui-'))) {
    const dir = path.join(os.tmpdir(), name);
    try { if (fs.statSync(dir).mtimeMs >= started - 1000) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch { /* in use */ }
  }
  const lines = `${run.stdout || ''}${run.stderr || ''}`.split(/\r?\n/);
  const passed = lines.filter((l) => l.startsWith('PASS')).length;
  const problems = lines.filter((l) => l.startsWith('FAIL') || /^failed:/.test(l));
  const seconds = Math.round((Date.now() - started) / 1000);
  if (run.status === 0 && !problems.length) {
    console.log(`ok    ${name} (${passed} passed, ${seconds}s)`);
  } else {
    failed.push(name);
    console.log(`FAIL  ${name} (${seconds}s${run.error ? `, ${run.error.message}` : ''})`);
    // No FAIL line (a crash, a timeout): the end of what it printed says why.
    for (const line of problems.length ? problems : lines.filter(Boolean).slice(-6)) console.log(`      ${line}`);
  }
}
console.log(failed.length ? `\n${failed.length} of ${names.length} failed: ${failed.join(', ')}` : `\nall ${names.length} passed`);
process.exitCode = failed.length ? 1 : 0;
