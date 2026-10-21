// Check of the app in Simplified Chinese, without API usage (Claude is scripted, see fakes.js): with
// Settings → Language set to 简体中文 it goes through the main screens (empty window, new chat, a turn with steps,
// a permission prompt, a question and to-dos, the menus, the / list, the Changes and Terminal panels, every
// Settings section, New session, /status) and lists any visible text, tooltip or placeholder still in English:
// the app's own words must all be translated. What Claude or Claude Code wrote (replies, questions, its command
// and model descriptions), code, paths and the kept terms (Claude, CLI, MCP…) are left out. Then English and back,
// live. Screenshots in dist/i18n-check/.
// Usage: npx vite build && npx electron scripts/checks/i18n-check.js   (add --dark for the dark theme)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const { install, applyEdit, MODELS, COMMANDS } = require('./fakes');
const { tempDir } = require('./temp');

const outDir = path.join(__dirname, '..', '..', 'dist', 'i18n-check');
const profile = tempDir('i18n-profile');
const project = tempDir('i18n-project');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(project, 'limiter.js'), 'export const LIMIT = 10;\n');

// Everything Claude (or Claude Code) says in this script: not the app's words, so not checked.
const QUESTION = 'Where should the request counts live?';
const OPTIONS = [
  { label: 'In memory', description: 'No new dependency. Counts reset on restart.' },
  { label: 'Redis', description: 'Shared by every instance.' },
];
const ASK = { title: 'Allow Claude to run this command?', description: 'npm test' };
const REPLY = 'The limit is now 50.';
const TODOS = ['Raise the limit', 'Add a test'];
const fromClaude = [QUESTION, 'Storage', ...OPTIONS.flatMap((o) => [o.label, o.description]), ASK.title, ASK.description, REPLY, ...TODOS,
  ...MODELS.flatMap((m) => [m.displayName, m.description]), ...COMMANDS.map((c) => c.description), 'The user answered.', 'tests passed',
  'Run the tests', 'go', path.basename(project),
  // /status: Claude Code's own rows (fakes.js)
  'Session', 'Version', 'Session ID', 'cwd', 'Account', 'Auth token', 'Model', 'claude-opus-5-5', 'cdef'];

install({
  histories: [], transcripts: new Map(),
  script: (_c, text) => async (c) => {
    if (/^go/.test(text)) {
      await c.think(120);
      await c.tool('TodoWrite', { todos: TODOS.map((content, i) => ({ content, activeForm: content, status: i ? 'pending' : 'in_progress' })) }, { run: 60 });
      await c.tool('Read', { file_path: c.file('limiter.js') }, { run: 60, data: { type: 'text', file: { filePath: c.file('limiter.js'), content: 'x' } } });
      await c.tool('AskUserQuestion', { questions: [{ question: QUESTION, header: 'Storage', multiSelect: false, options: OPTIONS }] },
        { ask: {}, run: 60, effect: (input) => ({ result: 'The user answered.', data: { answers: input.answers } }) });
      await c.tool('Edit', { file_path: c.file('limiter.js'), old_string: 'LIMIT = 10', new_string: 'LIMIT = 50' }, { run: 60, effect: applyEdit });
      await c.tool('Bash', { command: 'npm test', description: 'Run the tests' }, { run: 60, result: 'tests passed', ask: ASK });
      await c.say(REPLY, { cps: 800 });
      c.finish(0.01);
    }
  },
  prompt: () => 'PS ~> ', shell: () => '', cli: () => '',
});

const THEME = process.argv.includes('--dark') ? 'dark' : 'light';
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  language: 'zh-CN', theme: THEME, confirmClose: false, notify: false, trustedFolders: [project], recent: [{ path: project, at: Date.now() }],
}));
app.setPath('userData', profile);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

// Runs in the window: English words left in what is shown. Leaves out code, paths, Claude's text and the kept terms.
const SCAN = `((fromClaude) => {
  const KEPT = new Set(['Claude', 'Code', 'CLI', 'MCP', 'API', 'ccUI', 'Opus', 'Sonnet', 'Haiku', 'Fable', 'PowerShell', 'pwsh', 'Shift', 'Ctrl',
    'Enter', 'Esc', 'Tab', 'Alt', 'Cmd', 'Option', 'Space', 'Home', 'End', 'Backspace', 'Delete', 'GitHub', 'npm', 'JSON', 'Markdown', 'macOS',
    'Windows', 'Linux', 'Anthropic', 'Bedrock', 'Vertex', 'Foundry', 'Amazon', 'Google', 'Microsoft', 'AI', 'SDK', 'URL', 'ID', 'OK', 'PS', 'KB', 'MB',
    'GB', 'ms', 'px', 'k', 'M', 'JetBrains', 'Mono', 'Instrument', 'Sans', 'Serif', 'WebGL', 'Explore', 'Enter', 'xhigh', 'max', 'Max', 'Auto', 'CLAUDE', 'md', 'local',
    // Names kept as they are: Claude Code's terms and other products, the language's own name, an example flag.
    'hook', 'hooks', 'Vim', 'GitHub', 'Actions', 'Desktop', 'Shell', 'shell', 'English', 'key', 'value', 'sk-ant', 'ai', 'model', 'sonnet', 'bug', 'Artifacts']);
  const SKIP = '.md, .msg-user-text, code, pre, kbd, .xterm, .term-host, .diff, .file-view, .tool-target, .panel-path, .sf-dir, .sf-name, .wm-cc, .info-value, '
    + '.project-menu .menu-text, .project-menu .menu-label, .session-name, .folder-name, .intro-project, .ac-label, .diffstat, .shortcut-keys, [data-i18n-skip]';
  const claude = fromClaude.map((s) => s.trim()).filter(Boolean);
  const isClaude = (s) => claude.some((c) => c === s || c.includes(s) || s.includes(c));
  const clean = (s) => s
    .replace(/(?:[A-Za-z]:)?[~.]?[\\\\/][^\\s，。、）)]*/g, ' ')   // paths
    .replace(/\\b[\\w.-]+\\.(?:js|jsx|ts|md|json|txt|png|cpp|py)\\b/g, ' ') // file names
    .replace(/\\/[a-z][\\w:-]*/g, ' ')                           // slash commands
    .replace(/\\[[^\\]]*\\]|<[^>]*>/g, ' ')                     // argument syntax: [low|high], <question>
    .replace(/\\bhttps?:\\S+/g, ' ')
    .replace(/[\\w.+-]+@[\\w.-]+/g, ' ');
  const english = (s) => {
    if (!s || isClaude(s.trim())) return [];
    return (clean(s).match(/[A-Za-z][A-Za-z’'-]*[A-Za-z]|[A-Za-z]/g) || []).filter((w) => !KEPT.has(w) && !/^(?:[A-Z]{1,3}|[a-z])$/.test(w));
  };
  const out = [];
  const visible = (el) => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest(SKIP) || el.closest('script, style, [hidden], [inert]') || !visible(el)) continue;
    const words = english(n.textContent);
    if (words.length) out.push({ text: n.textContent.trim().slice(0, 90), words: words.join(' '), in: el.className || el.tagName });
  }
  for (const el of document.querySelectorAll('[title], [data-tip], [aria-label], [placeholder]')) {
    if (el.closest(SKIP) || el.closest('[hidden], [inert]') || !visible(el)) continue;
    for (const attr of ['title', 'data-tip', 'aria-label', 'placeholder']) {
      const v = el.getAttribute(attr);
      const words = english(v || '');
      if (words.length) out.push({ text: attr + ': ' + v.slice(0, 90), words: words.join(' '), in: el.className || el.tagName });
    }
  }
  return JSON.stringify(out);
})`;

// Runs in the window: the app's own text drawn bold, Chinese (`letters` = CHINESE) or any (LETTERS). The app has no
// bold (Microsoft YaHei has no semibold: 600 takes its heavy Bold); Claude's text (.md) keeps its emphasis, and
// the wordmark is a logo.
const CHINESE = '/[\\u4e00-\\u9fff]/';
const LETTERS = '/[A-Za-z\\u4e00-\\u9fff]/';
const BOLD = (letters) => `((letters) => {
  const out = new Set();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n.parentElement;
    if (!el || !letters.test(n.textContent) || el.closest('.md, .wordmark, script, style, [hidden], [inert]') || !el.getClientRects().length) continue;
    const w = Number(getComputedStyle(el).fontWeight);
    if (w >= 600) out.add(n.textContent.trim().slice(0, 24) + ' (' + w + ' ' + (el.className || el.tagName) + ')');
  }
  return JSON.stringify([...out]);
})(${letters})`;

app.on('browser-window-created', (_e, win) => {
  win.setSize(1320, 860);
  win.webContents.setBackgroundThrottling(false);
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => fs.writeFileSync(path.join(outDir, `${name}-${THEME}.png`), (await win.webContents.capturePage()).toPNG());
  const until = async (label, condition, timeout = 10000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await js(condition).catch(() => false)) return true;
      await wait(100);
    }
    check(`waiting for ${label}`, false, 'timeout');
    return false;
  };
  const seen = new Set();
  const scan = async (screen) => {
    const left = JSON.parse(await js(`${SCAN}(${JSON.stringify(fromClaude)})`)).filter((x) => !seen.has(x.text));
    left.forEach((x) => seen.add(x.text));
    check(`${screen}: all in Chinese`, !left.length, left.slice(0, 12).map((x) => `“${x.text}” [${x.words}] in ${x.in}`).join(' | '));
    if (left.length > 12) console.log(`   …and ${left.length - 12} more:`, left.slice(12).map((x) => x.text).join(' | '));
    const bold = JSON.parse(await js(BOLD(CHINESE))).filter((x) => !seen.has(`bold:${x}`));
    bold.forEach((x) => seen.add(`bold:${x}`));
    check(`${screen}: no bold Chinese`, !bold.length, bold.slice(0, 12).join(' | '));
  };
  const say = async (text) => {
    await js(`{ const el = document.querySelector('.chat-composer .composer-input'); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); } true`);
    await wait(100);
    await js("document.querySelector('.chat-composer .composer-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); true");
  };
  const escape = () => js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });

  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(1200);
      check('the window is marked Chinese', (await js('document.documentElement.lang')) === 'zh-CN');
      await scan('empty window');
      await shot('0-empty');
      await js("document.querySelector('.empty-recent .primary-btn').click(); true");
      await until('chat ready', "Boolean(document.querySelector('.chat-composer .composer-input'))");
      await wait(800);
      await scan('new chat');
      // Titles aren't stretched sideways in Chinese (the stretch, for Instrument Serif's Latin, flattens characters).
      // Code is in the app's code face, never the browser's language-picked monospace (NSimSun for Chinese).
      check('code blocks keep the code face', /^"JetBrains Mono"/.test(await js("(() => { const p = document.createElement('pre'); const c = document.createElement('code'); p.append(c); document.body.append(p); const f = getComputedStyle(c).fontFamily; p.remove(); return f; })()")));
      check('Chinese titles are not stretched', (await js("getComputedStyle(document.querySelector('.chat-intro h2')).transform")) === 'none');
      await shot('1-new-chat');

      // A turn: to-dos, a step, a question, an edit, a permission prompt.
      await say('go');
      await until('the question', "Boolean(document.querySelector('.prompt.question'))", 8000);
      await wait(400);
      await scan('a question from Claude');
      await shot('2-question');
      await js("[...document.querySelectorAll('.prompt.question .q-option')].find((b) => b.textContent.includes('In memory'))?.click(); true");
      await wait(200);
      await js("document.querySelector('.prompt.question .primary-btn')?.click(); true");
      await until('the permission prompt', "Boolean(document.querySelector('.prompt:not(.question):not(.plan)'))", 8000);
      await wait(400);
      await scan('a permission prompt');
      await shot('3-permission');
      await js("document.querySelector('.prompt:not(.question):not(.plan) .primary-btn')?.click(); true");
      await until('the reply', "/limit is now 50/.test(document.querySelector('.timeline')?.textContent || '') && !document.querySelector('.send-btn.stop')", 10000);
      await wait(500);
      await js("document.querySelector('.work-summary')?.click(); true");
      await wait(500);
      await scan('a finished turn with its steps');
      await shot('4-turn');

      // Menus, the context pop-up and the / list.
      for (const [name, sel] of [['permission menu', '.mode-menu .menu-button'], ['model menu', '.model-menu .menu-button'], ['context pop-up', '.context-menu-wrap .menu-button']]) {
        await js(`document.querySelector(${JSON.stringify(sel)})?.click(); true`);
        await wait(400);
        await scan(name);
        if (name === 'model menu') await shot('5-model-menu');
        await escape();
        await wait(250);
      }
      await js(`{ const el = document.querySelector('.chat-composer .composer-input'); el.focus(); el.value = '/'; el.selectionStart = el.selectionEnd = 1; el.dispatchEvent(new Event('input', { bubbles: true })); } true`);
      await wait(400);
      await scan('the / list');
      await shot('6-commands');
      await js(`{ const el = document.querySelector('.chat-composer .composer-input'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } true`);
      await wait(200);

      // The Changes and Terminal panels.
      await js("document.querySelector('.changes-toggle')?.click(); true");
      await wait(700);
      await scan('the Changes panel');
      await js("document.querySelector('.panel-toggle')?.click(); true");
      await wait(1200);
      await scan('the Terminal panel');
      await shot('7-panels');
      await js("document.querySelector('.panel-toggle')?.click(); document.querySelector('.changes-toggle')?.click(); true");
      await wait(500);

      // /status.
      await say('/status');
      await until('the status dialog', "Boolean(document.querySelector('.dialog-info[open]'))", 4000);
      await scan('/status');
      await js("document.querySelector('.dialog-info[open] .primary-btn')?.click(); true");
      await wait(400);

      // Settings, every section; then English and back, live.
      await js("document.querySelector('.sidebar-bottom .ghost-btn').click(); true");
      await until('Settings', "Boolean(document.querySelector('.settings-nav'))", 4000);
      const sections = await js("document.querySelectorAll('.settings-nav button').length");
      for (let i = 0; i < sections; i++) {
        await js(`document.querySelectorAll('.settings-nav button')[${i}].click(); true`);
        await wait(350);
        await scan(`Settings ${i + 1}`);
        if (i === 0) await shot('8-settings');
      }
      await js("document.querySelectorAll('.settings-nav button')[0].click(); true");
      await wait(300);
      const pickLanguage = async (name) => {
        await js("document.querySelector('.dialog .dropdown .menu-button').click(); true");
        await wait(250);
        await js(`[...document.querySelectorAll('.dialog .dropdown .menu-list button')].find((b) => b.querySelector('.menu-label').textContent === ${JSON.stringify(name)}).click(); true`);
      };
      check('Language is a dropdown of the app’s own', await js("Boolean(document.querySelector('.dialog .dropdown .menu-button')) && !document.querySelector('.dialog-settings select')"));
      await js("document.querySelector('.dialog .dropdown .menu-button').click(); true");
      await wait(300);
      await shot('8b-language-menu');
      await js("document.querySelector('.dialog .dropdown .menu-button').click(); true");
      await wait(200);
      await pickLanguage('English');
      await wait(400);
      const boldEnglish = JSON.parse(await js(BOLD(LETTERS)));
      check('in English, nothing the app writes is bold either', !boldEnglish.length, boldEnglish.slice(0, 12).join(' | '));
      check('switching to English is immediate', await js("document.documentElement.lang === 'en' && /Settings/.test(document.querySelector('.settings-nav').textContent)"),
        await js("document.querySelector('.settings-nav').textContent.slice(0, 40)"));
      await pickLanguage('简体中文');
      await wait(400);
      check('and back to Chinese', await js("document.documentElement.lang === 'zh-CN' && /设置/.test(document.querySelector('.settings-nav').textContent)"));
      await js("document.querySelector('.settings-head .primary-btn, .dialog .primary-btn')?.click(); true");
      await wait(400);

      // New session.
      await js("document.querySelector('#sidebar button.new-session').click(); true");
      await until('New session', "Boolean(document.querySelector('.dialog-new[open]'))", 4000);
      await wait(300);
      await scan('New session');
      await shot('9-new-session');
    } catch (err) {
      console.error('failed:', err);
      failures++;
    }
    console.log(failures ? `${failures} problem(s)` : 'all checks passed');
    process.exitCode = failures ? 1 : 0;
    app.quit();
  });
});

require('../../src/main/main.js');
