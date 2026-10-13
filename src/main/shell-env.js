// Apps started from the macOS Dock or a Linux launcher get a minimal PATH. Claude runs git, npm and
// friends, so import the environment the user's login shell would have.
const { spawn } = require('child_process');

const MARKER = '__CCUI_ENV__';
const TIMEOUT = 8000;

function loadShellEnv() {
  if (process.platform === 'win32') return Promise.resolve();
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const body = out.split(`\n${MARKER}\n`)[1];
      if (body) {
        for (const entry of body.split('\0')) {
          const i = entry.indexOf('=');
          if (i <= 0) continue;
          const key = entry.slice(0, i);
          if (key === 'PATH' || !(key in process.env)) process.env[key] = entry.slice(i + 1);
        }
      }
      resolve();
    };
    // No stdin (an rc file that reads input gets EOF instead of waiting), and a hard deadline: an interactive
    // shell ignores SIGTERM, so it is killed with SIGKILL, and startup goes on even if it never exits.
    let child;
    try {
      child = spawn(shell, ['-ilc', `printf '\\n${MARKER}\\n'; env -0`], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      finish();
    }, TIMEOUT);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { if (out.length < 4 << 20) out += chunk; });
    child.on('error', finish);
    child.on('close', finish);
  });
}

const shellEnvReady = loadShellEnv();

// Variables that would make a nested Claude Code think it runs inside another Claude Code session.
const STRIP_ENV = [
  'ELECTRON_RUN_AS_NODE', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_CHILD_SESSION',
];

function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of STRIP_ENV) delete env[key];
  return env;
}

module.exports = { shellEnvReady, childEnv };
