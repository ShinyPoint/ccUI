// Owns every pseudo-terminal (terminal-mode Claude Code and plain shells).
// The renderer only ever sees numeric ids.
const fs = require('fs');
const { execFileSync } = require('child_process');
const pty = require('@lydell/node-pty');
const { childEnv } = require('./shell-env');
const { t } = require('./i18n');

const isWin = process.platform === 'win32';

function posixQuote(s) {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

function winQuote(s) {
  return /^[\w@%+=:,./\\-]+$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`;
}

// Split a user-typed argument string, honouring single and double quotes.
function splitArgs(str) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(str || ''))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// PowerShell 7 when installed, else the Windows PowerShell that ships with Windows.
let windowsShell = null;
function findWindowsShell() {
  if (!windowsShell) {
    try {
      execFileSync('where.exe', ['pwsh.exe'], { stdio: 'ignore', windowsHide: true, timeout: 3000 });
      windowsShell = 'pwsh.exe';
    } catch {
      windowsShell = 'powershell.exe';
    }
  }
  return windowsShell;
}

function defaultShell() {
  if (isWin) return { file: findWindowsShell(), args: ['-NoLogo'] };
  return { file: process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'), args: ['-l'] };
}

// A real executable is started directly. A bare command name (e.g. an npm-installed `claude`, which is a
// .cmd shim on Windows) goes through a shell so PATH lookup and shims work.
function claudeLaunch(claude, args) {
  if (claude.file) return { file: claude.file, args };
  if (isWin) {
    // cmd.exe expands %VAR% (and !VAR! with delayed expansion) even inside quotes, and ^ escapes: arguments
    // with these characters cannot be passed through it safely.
    const unsafe = args.find((a) => /[%!^\r\n]/.test(a));
    if (unsafe) throw new Error(t('This argument cannot be passed to Claude Code through cmd.exe: {argument}', { argument: unsafe }));
    const line = [claude.command, ...args.map(winQuote)].join(' ');
    return { file: 'cmd.exe', args: `/d /s /c "${line}"` };
  }
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  return { file: shell, args: ['-l', '-i', '-c', `exec ${claude.command} ${args.map(posixQuote).join(' ')}`] };
}

class PtyManager {
  constructor(send) {
    this.send = send;
    this.sessions = new Map();
    this.nextId = 1;
  }

  // kind: 'terminal' runs Claude Code, 'shell' runs the user's shell.
  // `env`: added to Claude Code's environment (the app's settings, see claudeEnv in main.js).
  create({ kind, cwd, claude, args = [], extraArgs = '', cols = 100, rows = 30, env = {} }) {
    if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      throw new Error(t('Folder not found: {path}', { path: cwd }));
    }
    const launch = kind === 'shell' ? defaultShell() : claudeLaunch(claude, [...args, ...splitArgs(extraArgs)]);

    const options = {
      name: 'xterm-256color',
      cols: Math.max(cols, 20),
      rows: Math.max(rows, 5),
      cwd,
      env: childEnv({ TERM: 'xterm-256color', COLORTERM: 'truecolor', ...env }),
      useConpty: true,
    };
    // On Windows, the ConPTY that comes with node-pty rather than the system's: the system's drops the answers to
    // Claude Code's queries that it doesn't know (the one that lets Claude Code say what it is doing, see
    // programStatus in the window). The system's if that one can't start.
    let proc;
    try {
      proc = pty.spawn(launch.file, launch.args, { ...options, useConptyDll: isWin });
    } catch (err) {
      if (!isWin) throw err;
      proc = pty.spawn(launch.file, launch.args, options);
    }

    const id = this.nextId++;
    const session = { id, proc, buffer: '', timer: null };
    this.sessions.set(id, session);

    // Coalesce the many tiny chunks a TUI produces into fewer IPC messages.
    proc.onData((data) => {
      session.buffer += data;
      if (!session.timer) session.timer = setTimeout(() => this.flush(session), 6);
    });
    proc.onExit(({ exitCode, signal }) => {
      this.flush(session);
      this.sessions.delete(id);
      this.send('pty:exit', id, { exitCode, signal });
    });

    return { id, proc };
  }

  flush(session) {
    clearTimeout(session.timer);
    session.timer = null;
    if (!session.buffer) return;
    this.send('pty:data', session.id, session.buffer);
    session.buffer = '';
  }

  write(id, data) {
    this.sessions.get(id)?.proc.write(data);
  }

  resize(id, cols, rows) {
    const s = this.sessions.get(id);
    if (!s || cols < 2 || rows < 2) return;
    try { s.proc.resize(cols, rows); } catch { /* process is exiting */ }
  }

  kill(id) {
    const s = this.sessions.get(id);
    if (!s) return;
    try { s.proc.kill(); } catch { /* already gone */ }
  }

  killAll() {
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }

  get liveCount() {
    return this.sessions.size;
  }
}

module.exports = { PtyManager, claudeLaunch };
