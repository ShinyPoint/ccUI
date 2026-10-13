// What happens in the intro video: the demo projects on disk, the conversations already in the sidebar,
// and what "Claude" does in each session (played by the fakes in fakes.js).
const fs = require('fs');
const path = require('path');
const { applyEdit, applyWrite } = require('./fakes');

const FILES = {
  'orbit-api': {
    'package.json': `${JSON.stringify({ name: 'orbit-api', version: '1.8.0', scripts: { start: 'node src/index.js', test: 'node --test' }, dependencies: { express: '^5.1.0' } }, null, 2)}\n`,
    'README.md': '# orbit-api\n\nThe public HTTP API for Orbit.\n',
    'src/index.js': "const app = require('./server');\n\napp.listen(process.env.PORT || 3000);\n",
    'src/server.js': `const express = require('express');
const { authenticate } = require('./middleware/auth');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

const app = express();
app.use(express.json());

app.use('/v1', authenticate, publicRoutes);
app.use('/admin', authenticate, adminRoutes);

app.use((err, req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message });
});

module.exports = app;
`,
    'src/middleware/auth.js': `const { findKey } = require('../lib/keys');

async function authenticate(req, res, next) {
  const key = await findKey(req.get('x-api-key'));
  if (!key) return res.status(401).json({ error: 'Unknown API key' });
  req.apiKey = key.id;
  next();
}

module.exports = { authenticate };
`,
    'src/routes/public.js': "const router = require('express').Router();\n\nrouter.get('/satellites', require('../lib/satellites').list);\n\nmodule.exports = router;\n",
    'src/routes/admin.js': "const router = require('express').Router();\n\nmodule.exports = router;\n",
    'src/lib/keys.js': 'const keys = new Map();\n\nmodule.exports = { findKey: async (value) => keys.get(value) };\n',
    'src/lib/satellites.js': 'module.exports = { list: (req, res) => res.json([]) };\n',
    'test/public.test.js': "const test = require('node:test');\n\ntest('lists satellites', () => {});\n",
  },
  'atlas-web': {
    'package.json': `${JSON.stringify({ name: 'atlas-web', version: '3.2.0', scripts: { build: 'vite build' }, dependencies: { react: '^18.3.1' } }, null, 2)}\n`,
    'src/main.jsx': "import { render } from 'react-dom';\n",
    'src/App.jsx': 'export function App() {\n  return null;\n}\n',
  },
  'field-notes': {
    'README.md': '# field-notes\n',
    'CHANGELOG.md': '# Changelog\n',
  },
};

const RATE_LIMIT = `// Fixed-window rate limiter, counted per API key.
const hits = new Map(); // apiKey -> { count, resetAt }

function rateLimit({ limit = 60, windowMs = 60_000 } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    let entry = hits.get(req.apiKey);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(req.apiKey, entry);
    }
    entry.count += 1;
    if (entry.count > limit) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    next();
  };
}

module.exports = { rateLimit };
`;

const TEST_OUTPUT = `> orbit-api@1.8.0 test
> node --test

✔ lists satellites (1.9ms)
✔ rejects an unknown API key (0.8ms)
✔ allows 60 requests in a minute (4.1ms)
✔ answers 429 with Retry-After on request 61 (1.2ms)
ℹ tests 14
ℹ pass 14
ℹ fail 0`;

const PROMPTS = {
  main: 'Add rate limiting to the public routes: 60 requests a minute per API key. Start from ',
  atlas: 'Upgrade to React 19 and fix whatever breaks in the build',
  deny: 'Not main. Push a branch and open a draft PR.',
};

function createProjects(home) {
  const projects = {};
  for (const [name, files] of Object.entries(FILES)) {
    const dir = path.join(home, 'code', name);
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    projects[name] = dir;
  }
  return projects;
}

const todos = (...status) => ({
  todos: ['Add the rate-limit middleware', 'Apply it to the /v1 routes', 'Run the tests'].map((content, i) => ({
    content, status: status[i], activeForm: ['Adding the rate-limit middleware', 'Applying it to the /v1 routes', 'Running the tests'][i],
  })),
});

// The session the video follows.
async function orbit(c) {
  await c.think(1100);
  await c.say('I’ll check how the routes are wired up, then add the limiter as middleware.');
  await c.tool('Read', { file_path: c.file('src/server.js') }, {
    run: 420, data: { type: 'text', file: { filePath: c.file('src/server.js'), content: FILES['orbit-api']['src/server.js'] } },
  });
  await c.tool('Grep', { pattern: 'req.apiKey', path: c.file('src') }, { run: 480, result: 'src/middleware/auth.js:6:  req.apiKey = key.id;' });
  await c.pause(300);
  const question = 'Where should the request counts live?';
  const asked = await c.tool('AskUserQuestion', {
    questions: [{
      question, header: 'Storage', multiSelect: false,
      options: [
        { label: 'In memory', description: 'No new dependency. Counts reset on restart; right for a single instance.' },
        { label: 'Redis', description: 'Shared by every instance. Adds a Redis client and a connection to manage.' },
      ],
    }],
  }, { ask: {}, run: 150, effect: (input) => ({ result: 'The user answered.', data: { answers: input.answers } }) });
  if (asked.denied) return c.finish(0.02);
  await c.think(700);
  await c.tool('TodoWrite', todos('in_progress', 'pending', 'pending'), { run: 120 });
  const written = await c.tool('Write', { file_path: c.file('src/middleware/rate-limit.js'), content: RATE_LIMIT }, {
    typing: 900,
    run: 300,
    effect: applyWrite,
    ask: {
      title: 'Allow Claude to create rate-limit.js?',
      description: 'src/middleware/rate-limit.js',
      suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
    },
  });
  if (written.denied) return c.finish(0.03);
  await c.tool('TodoWrite', todos('completed', 'in_progress', 'pending'), { run: 120 });
  await c.tool('Edit', {
    file_path: c.file('src/server.js'),
    old_string: "const { authenticate } = require('./middleware/auth');\n",
    new_string: "const { authenticate } = require('./middleware/auth');\nconst { rateLimit } = require('./middleware/rate-limit');\n",
  }, { typing: 320, run: 380, effect: applyEdit });
  await c.tool('Edit', {
    file_path: c.file('src/server.js'),
    old_string: "app.use('/v1', authenticate, publicRoutes);",
    new_string: "app.use('/v1', authenticate, rateLimit({ limit: 60 }), publicRoutes);",
  }, { typing: 320, run: 380, effect: applyEdit });
  await c.tool('TodoWrite', todos('completed', 'completed', 'in_progress'), { run: 120 });
  const tested = await c.tool('Bash', { command: 'npm test', description: 'Run the test suite' }, {
    run: 2300,
    progress: true,
    result: TEST_OUTPUT,
    data: { stdout: TEST_OUTPUT, stderr: '' },
    ask: {
      title: 'Allow Claude to run this command?',
      description: 'npm test',
      suggestions: [{ type: 'addRules', behavior: 'allow', destination: 'localSettings', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }] }],
    },
  });
  if (tested.denied) return c.finish(0.05);
  await c.tool('TodoWrite', todos('completed', 'completed', 'completed'), { run: 120 });
  await c.say([
    'Rate limiting is on for every `/v1` route: **60 requests a minute per API key**.',
    '',
    '- `src/middleware/rate-limit.js` counts requests in a fixed window, per key',
    '- Request 61 gets a `429` with a `Retry-After` header',
    '',
    'All 14 tests pass.',
  ].join('\n'));
  c.finish(0.0731);
}

// A second session, working in the background: it keeps building until the video turns to it (cue "push"),
// then asks before pushing.
async function atlas(c) {
  await c.think(900);
  await c.say('I’ll bump React, then build and fix what breaks.');
  await c.tool('Read', { file_path: c.file('package.json') }, { run: 400, data: { type: 'text', file: { filePath: c.file('package.json'), content: FILES['atlas-web']['package.json'] } } });
  await c.tool('Bash', { command: 'npm install react@19 react-dom@19' }, { run: 2400, progress: true, result: 'added 2 packages, changed 2 packages in 6s' });
  await c.tool('Edit', {
    file_path: c.file('src/main.jsx'),
    old_string: "import { render } from 'react-dom';",
    new_string: "import { createRoot } from 'react-dom/client';",
  }, { typing: 300, run: 300, effect: applyEdit });
  await c.tool('Bash', { command: 'npm run build' }, { until: c.director.cue('push'), result: 'vite v8.3.2 building for production...\n✓ 214 modules transformed.\n✓ built in 41.2s' });
  await c.say('The build passes on React 19. Pushing the upgrade.');
  const pushed = await c.tool('Bash', { command: 'git push origin main' }, {
    run: 900,
    result: 'To github.com:orbit/atlas-web.git\n   4c1e2aa..9f03b7d  main -> main',
    ask: { title: 'Allow Claude to run this command?', description: 'git push origin main' },
  });
  if (pushed.denied) {
    await c.think(600);
    await c.say('Understood. I’ll push a branch and open a draft pull request instead.');
    await c.tool('Bash', { command: 'git switch -c upgrade/react-19 && git push -u origin upgrade/react-19' }, { run: 1500, progress: true, result: "branch 'upgrade/react-19' set up to track 'origin/upgrade/react-19'." });
    await c.tool('Bash', { command: 'gh pr create --draft --title "Upgrade to React 19"' }, { run: 1400, progress: true, result: 'https://github.com/orbit/atlas-web/pull/212' });
    await c.say('Draft pull request opened: **#212 Upgrade to React 19**.');
  }
  c.finish(0.1164);
}

const HISTORIES = [
  {
    key: 'tests', project: 'orbit-api', title: 'Write tests for the webhook retry queue', ago: 52,
    messages: [
      ['user', 'Write tests for the webhook retry queue'],
      ['assistant', 'Added `test/webhooks.test.js` with six cases covering backoff, the retry cap and the dead-letter path. All of them pass.'],
    ],
  },
  {
    key: 'notes', project: 'field-notes', title: 'Draft the release notes for 2.4', ago: 180,
    messages: [
      ['user', 'Draft the release notes for 2.4'],
      ['assistant', 'The draft is in `CHANGELOG.md`: three features, five fixes, and one breaking change called out at the top.'],
    ],
  },
];

// Colors for the scripted terminals (they follow the terminal palette in lib/themes.js).
const A = { dim: '\x1b[90m', accent: '\x1b[38;2;229;138;94m', green: '\x1b[32m', red: '\x1b[31m', bold: '\x1b[1m', off: '\x1b[0m' };

function makeDirector(projects) {
  const cues = {};
  const cue = (name) => (cues[name] ??= (() => { let fire; const p = new Promise((r) => { fire = r; }); p.fire = fire; return p; })());
  const histories = HISTORIES.map((h) => ({
    ...h, sessionId: `0000${h.key}-demo`, cwd: projects[h.project], summary: h.title, lastModified: Date.now() - h.ago * 60000,
  }));
  const transcripts = new Map(histories.map((h) => [h.sessionId, h.messages.map(([role, text], i) => (role === 'user'
    ? { type: 'user', uuid: `${h.sessionId}-${i}`, message: { role, content: text } }
    : { type: 'assistant', uuid: `${h.sessionId}-${i}`, message: { id: `msg_${h.key}${i}`, role, content: [{ type: 'text', text }] } }))]));
  const shown = (cwd) => `C:\\Users\\dev\\code\\${path.basename(cwd)}`;
  return {
    histories,
    transcripts,
    cue,
    fire: (name) => cue(name).fire(),
    script(session) {
      const name = path.basename(session.cwd);
      if (name === 'orbit-api' && !session.opts.resume) return orbit;
      if (name === 'atlas-web') return atlas;
      return null;
    },
    prompt: (cwd) => `${A.dim}PS${A.off} ${shown(cwd)}${A.dim}>${A.off} `,
    shell(line) {
      if (/^git status/.test(line)) {
        return ` ${A.red}M${A.off} src/server.js\r\n${A.red}??${A.off} src/middleware/rate-limit.js\r\n`;
      }
      if (/^npm test/.test(line)) return `${TEST_OUTPUT.replace(/✔/g, `${A.green}✔${A.off}`).replace(/\n/g, '\r\n')}\r\n`;
      return '';
    },
    // A plain rendition of Claude Code's command-line interface showing the same conversation.
    cli: () => [
      '',
      ` ${A.accent}✻${A.off} ${A.bold}Claude Code${A.off} ${A.dim}v2.1.287${A.off}`,
      `   ${A.dim}Opus 5.5 · ~\\code\\orbit-api${A.off}`,
      '',
      `${A.dim}>${A.off} ${PROMPTS.main}@src/server.js`,
      '',
      `${A.green}●${A.off} I’ll check how the routes are wired up, then add the limiter as middleware.`,
      '',
      `${A.green}●${A.off} ${A.bold}Read${A.off}(src/server.js)`,
      `${A.green}●${A.off} ${A.bold}Write${A.off}(src/middleware/rate-limit.js)`,
      `  ${A.dim}⎿  Wrote 21 lines${A.off}`,
      `${A.green}●${A.off} ${A.bold}Update${A.off}(src/server.js)`,
      `  ${A.dim}⎿  Added 2 lines, removed 1 line${A.off}`,
      `${A.green}●${A.off} ${A.bold}Bash${A.off}(npm test)`,
      `  ${A.dim}⎿  tests 14 · pass 14 · fail 0${A.off}`,
      '',
      `${A.green}●${A.off} Rate limiting is on for every /v1 route: 60 requests a minute per API key.`,
      '',
      `${A.dim}${'─'.repeat(96)}${A.off}`,
      `${A.dim}>${A.off} `,
    ].join('\r\n'),
  };
}

module.exports = { createProjects, makeDirector, PROMPTS, HISTORIES };
