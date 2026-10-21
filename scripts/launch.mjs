// Starts the app from source the way `electron .` does, but under the ccUI name and icon. Windows (and the docks
// people put on it) name and draw a program's taskbar button, Task Manager row and Alt+Tab entry after its
// executable: run as electron.exe, the app is "Electron" with Electron's icon whatever its window says. So on
// Windows it runs as ccUI.exe, a copy of electron.exe beside it (it needs Electron's files next to it) stamped with
// the ccUI name and icon, made once per Electron install and icon. A packaged build is its own ccUI.exe already.
// Usage: node scripts/launch.mjs   (npm start; scripts/dev.mjs starts the same executable)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const electron = require('electron'); // from Node, the package is the path to its binary

// The executable to start the app with: ccUI.exe on Windows (made or refreshed first), Electron's own elsewhere,
// or when ccUI.exe can't be made.
export async function appExecutable() {
  if (process.platform !== 'win32') return electron;
  const dir = path.dirname(electron);
  const exe = path.join(dir, 'ccUI.exe');
  const icon = path.join(root, 'assets', 'icon.ico');
  // Copies set aside by an earlier run while they were still running: gone once nothing uses them.
  for (const name of fs.readdirSync(dir).filter((n) => n.startsWith('ccUI.exe.old-'))) {
    try { fs.unlinkSync(path.join(dir, name)); } catch { /* still running */ }
  }
  const marker = path.join(dir, '.ccui-exe');
  const stamp = `${require('electron/package.json').version} ${fs.statSync(icon).mtimeMs}`;
  if (fs.existsSync(exe) && fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === stamp) return exe;
  // Stamped as a copy, then moved into place: a running exe can't be written, but it can be renamed out of the way.
  const fresh = `${exe}.new`;
  try {
    const { rcedit } = await import('rcedit');
    fs.copyFileSync(electron, fresh);
    await rcedit(fresh, {
      icon,
      'version-string': { FileDescription: 'ccUI', ProductName: 'ccUI', InternalFilename: 'ccUI', OriginalFilename: 'ccUI.exe' },
    });
    if (fs.existsSync(exe)) fs.renameSync(exe, `${exe}.old-${Date.now()}`);
    fs.renameSync(fresh, exe);
    fs.writeFileSync(marker, stamp);
    return exe;
  } catch (err) {
    try { fs.unlinkSync(fresh); } catch { /* not made */ }
    console.warn(`Starting as electron.exe: ccUI.exe could not be made (${err.message.split('\n')[0]})`);
    return fs.existsSync(exe) ? exe : electron;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const child = spawn(await appExecutable(), ['.', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}
