// What happens in the intro video: the demo projects on disk, the conversations already in the sidebar, what
// "Claude" does in each session (played by the fakes in fakes.js), and the words shown, in English or Chinese
// (`lang`: 'en' | 'zh-CN'; one video for each README).
const fs = require('fs');
const path = require('path');
const { applyEdit, applyWrite } = require('../checks/fakes');

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

// The code block in the answer (the same in both languages: code isn't translated).
const CODE = [
  '```js',
  "res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));",
  "return res.status(429).json({ error: 'Rate limit exceeded' });",
  '```',
].join('\n');
const FORMULA = '$$\n\\text{burst}_{\\max} = 2L = 120 \\qquad (W = 60\\,\\text{s},\\ L = 60)\n$$';

const TEXT = {
  en: {
    prompt: 'Add rate limiting to the public routes: 60 requests a minute per API key.',
    atlas: 'Upgrade to React 19 and fix whatever breaks in the build',
    thinkRoutes: '**Reading how the routes are wired**\n\nThe /v1 routes are mounted in server.js, after authenticate sets req.apiKey.',
    thinkPlan: '**Planning a fixed-window limiter**\n\nA middleware that counts per key and answers 429 past the limit.',
    say: 'I’ll check how the routes are wired up, then add the limiter as middleware.',
    test: 'Run the test suite',
    answer: [
      'Rate limiting is on for every `/v1` route: **60 requests a minute per API key**.',
      '',
      'With a fixed window of $W$ seconds and a limit of $L$, a client can still fit up to $2L$ requests around a window’s edge:',
      '',
      FORMULA,
      '',
      'Request 61 gets a `429` with a `Retry-After` header:',
      '',
      CODE,
      '',
      'All 14 tests pass.',
    ].join('\n'),
    atlasSay: 'I’ll bump React, then build and fix what breaks.',
    histories: { tests: ['Write tests for the webhook retry queue', 'Added `test/webhooks.test.js` with six cases covering backoff, the retry cap and the dead-letter path. All of them pass.'],
      notes: ['Draft the release notes for 2.4', 'The draft is in `CHANGELOG.md`: three features, five fixes, and one breaking change called out at the top.'] },
    cliAnswer: 'Rate limiting is on for every /v1 route: 60 requests a minute per API key.',
    captions: {
      steps: 'Every step, readable.',
      math: 'Math and code, typeset.',
      cli: 'One conversation: chat or CLI.',
      arrange: 'Arranged your way.',
      looks: 'Light, dark, your colors.',
    },
    labels: { appearance: 'Appearance' },
    cards: {
      title: 'A desktop GUI for Claude Code',
      line: 'Chat when you want it. <em>The CLI when you need it.</em>',
      small: 'Windows<b>·</b>macOS<b>·</b>Linux<b>·</b>Free and open source',
      download: 'Download',
      star: 'If you like it, leave a <span class="star">★</span> on GitHub',
    },
  },
  'zh-CN': {
    prompt: '给公开接口加上限流：每个 API key 每分钟最多 60 次请求。',
    atlas: '升级到 React 19，并修好构建里出现的问题',
    thinkRoutes: '**先看路由是怎么挂载的**\n\n/v1 路由挂在 server.js 里，authenticate 之后 req.apiKey 已经可用。',
    thinkPlan: '**用固定窗口实现限流**\n\n写一个中间件，按 key 计数，超过上限就返回 429。',
    say: '我先看看路由是怎么组织的，再把限流做成中间件加进去。',
    test: '运行测试',
    answer: [
      '所有 `/v1` 路由都已限流：**每个 API key 每分钟 60 次请求**。',
      '',
      '固定窗口长度为 $W$ 秒、上限为 $L$ 时，客户端在窗口交界处最多仍能发出 $2L$ 次请求：',
      '',
      FORMULA,
      '',
      '第 61 次请求会收到带 `Retry-After` 头的 `429`：',
      '',
      CODE,
      '',
      '14 个测试全部通过。',
    ].join('\n'),
    atlasSay: '我先升级 React，然后构建并修复出现的问题。',
    histories: { tests: ['为 webhook 重试队列写测试', '新增了 `test/webhooks.test.js`，六个用例覆盖退避、重试上限和死信路径，全部通过。'],
      notes: ['起草 2.4 版的发布说明', '草稿在 `CHANGELOG.md` 里：三个新功能、五个修复，开头单独标出了一处不兼容的改动。'] },
    cliAnswer: '所有 /v1 路由都已限流：每个 API key 每分钟 60 次请求。',
    captions: {
      steps: '每一步，都看得清楚',
      math: '公式和代码，排版好看',
      cli: '同一段对话，对话或 CLI 随时切换',
      arrange: '侧边栏，按你的习惯摆放',
      looks: '浅色、深色，随你配色',
    },
    labels: { appearance: '外观' },
    cards: {
      title: 'Claude Code 的桌面图形界面',
      line: '想聊天就用对话，<em>需要时切到 CLI</em>',
      small: 'Windows<b>·</b>macOS<b>·</b>Linux<b>·</b>免费开源',
      download: '下载',
      star: '喜欢的话，在 GitHub 上点个 <span class="star">★</span> Star',
    },
  },
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

const HISTORIES = [
  { key: 'tests', project: 'orbit-api', ago: 52 },
  { key: 'notes', project: 'field-notes', ago: 180 },
];

// Colors for the scripted terminals (they follow the terminal palette in lib/themes.js).
const A = { dim: '\x1b[90m', accent: '\x1b[38;2;229;138;94m', green: '\x1b[32m', red: '\x1b[31m', bold: '\x1b[1m', off: '\x1b[0m' };

function makeDirector(projects, lang) {
  const T = TEXT[lang];
  const cues = {};
  const cue = (name) => (cues[name] ??= (() => { let fire; const p = new Promise((r) => { fire = r; }); p.fire = fire; return p; })());

  // The session the video follows: thinking in words, steps, then an answer with math and code. Nothing asks for
  // permission (the video doesn't stop on a prompt).
  async function orbit(c) {
    await c.think(1100, T.thinkRoutes);
    await c.say(T.say, { cps: 220 });
    await c.tool('Read', { file_path: c.file('src/server.js') }, {
      run: 300, data: { type: 'text', file: { filePath: c.file('src/server.js'), content: FILES['orbit-api']['src/server.js'] } },
    });
    await c.tool('Grep', { pattern: 'req.apiKey', path: c.file('src') }, { run: 300, result: 'src/middleware/auth.js:6:  req.apiKey = key.id;' });
    await c.think(800, T.thinkPlan);
    await c.tool('Write', { file_path: c.file('src/middleware/rate-limit.js'), content: RATE_LIMIT }, { typing: 450, run: 250, effect: applyWrite });
    await c.tool('Edit', {
      file_path: c.file('src/server.js'),
      old_string: "app.use('/v1', authenticate, publicRoutes);",
      new_string: "app.use('/v1', authenticate, rateLimit({ limit: 60 }), publicRoutes);",
    }, { typing: 250, run: 250, effect: applyEdit });
    await c.tool('Bash', { command: 'npm test', description: T.test }, { run: 1400, progress: true, result: TEST_OUTPUT, data: { stdout: TEST_OUTPUT, stderr: '' } });
    await c.say(T.answer, { cps: 900 });
    c.finish(0.0731);
  }

  // A second session, working in the background the whole time: its spinner turns in the sidebar.
  async function atlas(c) {
    await c.think(900);
    await c.say(T.atlasSay);
    await c.tool('Bash', { command: 'npm install react@19 react-dom@19' }, { run: 2400, progress: true, result: 'added 2 packages, changed 2 packages in 6s' });
    await c.tool('Bash', { command: 'npm run build' }, { until: cue('end'), result: '✓ built in 41.2s' });
    c.finish(0.1164);
  }

  const histories = HISTORIES.map((h) => {
    const [title, answer] = T.histories[h.key];
    return { ...h, title, messages: [['user', title], ['assistant', answer]], sessionId: `0000${h.key}-demo`, cwd: projects[h.project], summary: title, lastModified: Date.now() - h.ago * 60000 };
  });
  const transcripts = new Map(histories.map((h) => [h.sessionId, h.messages.map(([role, text], i) => (role === 'user'
    ? { type: 'user', uuid: `${h.sessionId}-${i}`, message: { role, content: text } }
    : { type: 'assistant', uuid: `${h.sessionId}-${i}`, message: { id: `msg_${h.key}${i}`, role, content: [{ type: 'text', text }] } }))]));
  const shown = (cwd) => `C:\\Users\\dev\\code\\${path.basename(cwd)}`;
  return {
    T,
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
    shell: () => '',
    // A plain rendition of Claude Code's command-line interface showing the same conversation.
    cli: () => [
      '',
      ` ${A.accent}✻${A.off} ${A.bold}Claude Code${A.off} ${A.dim}v2.1.310${A.off}`,
      `   ${A.dim}Opus 5.5 · ~\\code\\orbit-api${A.off}`,
      '',
      `${A.dim}>${A.off} ${T.prompt}`,
      '',
      `${A.green}●${A.off} ${T.say}`,
      '',
      `${A.green}●${A.off} ${A.bold}Read${A.off}(src/server.js)`,
      `${A.green}●${A.off} ${A.bold}Search${A.off}(pattern: "req.apiKey", path: "src")`,
      `${A.green}●${A.off} ${A.bold}Write${A.off}(src/middleware/rate-limit.js)`,
      `  ${A.dim}⎿  Wrote 21 lines${A.off}`,
      `${A.green}●${A.off} ${A.bold}Update${A.off}(src/server.js)`,
      `  ${A.dim}⎿  Added 1 line, removed 1 line${A.off}`,
      `${A.green}●${A.off} ${A.bold}Bash${A.off}(npm test)`,
      `  ${A.dim}⎿  tests 14 · pass 14 · fail 0${A.off}`,
      '',
      `${A.green}●${A.off} ${T.cliAnswer}`,
      '',
      `${A.dim}${'─'.repeat(96)}${A.off}`,
      `${A.dim}>${A.off} `,
    ].join('\r\n'),
  };
}

module.exports = { createProjects, makeDirector, TEXT, HISTORIES };
