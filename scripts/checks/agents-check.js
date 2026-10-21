// Check of background subagents in a chat, without API usage (Claude is scripted, see fakes.js).
// A turn sends two agents to the background and ends; the chat must go idle (no Stop button, you can type),
// the strip above the message box shows both agents, ✕ stops one, and the other's return starts a turn of
// its own, marked in the timeline. Then Stop (Esc) during a turn ends it and its agents, and nothing stays
// "working". Screenshots in dist/agents-check/.
// Usage: npx vite build && npx electron scripts/checks/agents-check.js   (add --dark for the dark theme)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const { tempDir } = require('./temp');
const { install, sleep } = require('./fakes');

const outDir = path.join(__dirname, '..', '..', 'dist', 'agents-check');
const profile = tempDir('agents-profile');
const project = tempDir('agents-project');
fs.mkdirSync(outDir, { recursive: true });

const launched = (description) => ({ status: 'async_launched', agentId: description, description, prompt: description, outputFile: '' });
const director = {
  histories: [],
  transcripts: new Map(),
  script: (_c, text) => async (c) => {
    if (/survey/i.test(text)) {
      await c.think(150);
      const a = await c.tool('Agent', { description: 'Map the modules', prompt: 'Map the modules', subagent_type: 'Explore' },
        { run: 80, result: 'Async agent launched successfully.', data: launched('Map the modules') });
      c.startTask({ id: 'task-a', toolUseId: a.id, description: 'Map the modules', subagentType: 'Explore' });
      const b = await c.tool('Agent', { description: 'Check the tests', prompt: 'Check the tests', subagent_type: 'general-purpose' },
        { run: 80, result: 'Async agent launched successfully.', data: launched('Check the tests') });
      c.startTask({ id: 'task-b', toolUseId: b.id, description: 'Check the tests' });
      await c.say('Two agents are on it. I will report back when they are done.', { cps: 600 });
      c.finish(0.01);
      // Agent A works a while, then reports; Claude picks up by itself.
      (async () => {
        for (let i = 1; i <= 16; i++) {
          await c.childTool(a.id, 'Grep', { pattern: `module${i}` }, { run: 450 });
          c.taskProgress('task-a', { toolUses: i, lastTool: 'Grep' });
        }
        c.endTask('task-a', 'completed', 'Found 3 modules: app, lib, cli.');
        await sleep(300);
        c.wake();
        await c.say('The survey is back: the project has three modules, app, lib and cli.', { cps: 600 });
        c.finish(0.01);
      })().catch(() => {});
      // Agent B keeps going until it is stopped.
      (async () => {
        for (let i = 1; c.tasks.has('task-b') && i < 200; i++) {
          await c.childTool(b.id, 'Read', { file_path: c.file(`test${i}.js`) }, { run: 400 });
          c.taskProgress('task-b', { toolUses: i, lastTool: 'Read' });
        }
      })().catch(() => {});
      return;
    }
    // "again": a turn that sends an agent off and then keeps thinking until stopped.
    await c.think(100);
    const d = await c.tool('Agent', { description: 'Profile the build', prompt: 'Profile the build' },
      { run: 80, result: 'Async agent launched successfully.', data: launched('Profile the build') });
    c.startTask({ id: 'task-d', toolUseId: d.id, description: 'Profile the build' });
    await c.think(60000);
  },
  prompt: () => 'PS ~> ',
  shell: () => '',
  cli: () => '',
};
install(director);

const THEME = process.argv.includes('--dark') ? 'dark' : 'light';
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  language: 'en', theme: THEME, confirmClose: false, notify: false, recent: [{ path: project, at: Date.now() }], trustedFolders: [project],
}));
app.setPath('userData', profile);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

app.on('browser-window-created', (_e, win) => {
  win.setSize(1320, 860);
  win.webContents.setBackgroundThrottling(false);
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => fs.writeFileSync(path.join(outDir, `${name}-${THEME}.png`), (await win.webContents.capturePage()).toPNG());
  const until = async (label, condition, timeout = 20000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await js(condition).catch(() => false)) return true;
      await wait(100);
    }
    check(`waiting for ${label}`, false, 'timeout');
    return false;
  };
  const say = async (text) => {
    await js(`{ const el = document.querySelector('.chat-composer .composer-input');
      el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); } true`);
    await wait(80);
    await js("document.querySelector('.chat-composer .composer-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); true");
  };
  const rows = "[...document.querySelectorAll('.agent-list li')].map((li) => li.dataset.status + ':' + li.querySelector('.agent-desc').textContent)";
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });

  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(1200);
      await js("document.querySelector('.empty-recent .primary-btn').click(); true");
      await until('chat ready', "Boolean(document.querySelector('.chat-composer .composer-input'))");
      await wait(600);
      await say('Survey the project');
      await until('the turn to end', "/report back/.test(document.querySelector('.timeline').textContent) && Boolean(document.querySelector('.turn-end, .work-summary'))");
      await wait(400);
      check('the turn is over: no Stop button while the agents work', await js("!document.querySelector('.send-btn.stop')"));
      check('and nothing says Claude is working', await js("!document.querySelector('.activity')"));
      await until('both agents in the strip', `${rows}.filter((r) => r.startsWith('running')).length === 2`);
      check('the strip shows the two agents', true, (await js(`JSON.stringify(${rows})`)));
      check('it says how many are running', /2 background tasks running/.test(await js("document.querySelector('.agents-head').textContent")));
      await wait(1500);
      check('their progress shows (tools used, last tool)', /tool/.test(await js("document.querySelector('.agent-list li .agent-meta').textContent")),
        await js("document.querySelector('.agent-list li .agent-meta').textContent"));
      await shot('1-running');
      // Switching to the CLI or ending the session would lose the agents: both ask first.
      const asked = "document.querySelector('.dialog-confirm[open]')?.textContent || ''";
      const cancel = "[...document.querySelectorAll('.dialog-confirm[open] button')].find((b) => b.textContent === 'Cancel').click(); true";
      await js("[...document.querySelectorAll('#topbar .text-btn')].find((b) => b.textContent.trim() === 'CLI').click(); true");
      await until('the switch question', `/2 background tasks are still running/.test(${asked})`, 5000);
      check('switching to the CLI asks first, naming the tasks', /Map the modules/.test(await js(asked)) && /Switch anyway/.test(await js(asked)), (await js(asked)).slice(0, 120));
      await wait(400);
      await shot('1b-switch-asks');
      await js(cancel);
      await wait(400);
      check('Cancel keeps the chat', await js("Boolean(document.querySelector('.chat-composer'))"));
      await js("document.querySelector('.session .session-close').click(); true");
      await until('the end question', `/background tasks are still running/.test(${asked}) && /End anyway/.test(${asked})`, 5000);
      await js(cancel);
      await wait(400);
      check('ending the session asks too, and Cancel keeps it', await js("document.querySelectorAll('.session').length === 1 && Boolean(document.querySelector('.chat-composer'))"));
      // Open the steps: the Agent cards say they run in the background, and their steps are not "Not run".
      await js("document.querySelector('.work-summary')?.click(); true");
      await wait(500);
      // A step at work: a gray circle of a fixed size that only fades, no glyph.
      const pulse = [];
      for (let i = 0; i < 6; i++) {
        pulse.push(JSON.parse(await js(`JSON.stringify((() => { const g = document.querySelector('.tool.agent[data-status="running"] .tool-glyph');
          const b = getComputedStyle(g, '::before'); return { w: b.width, h: b.height, o: Number(b.opacity), icon: getComputedStyle(g.querySelector('svg')).display }; })())`)));
        await wait(230);
      }
      check('a working step is a gray circle of fixed size that fades', pulse.every((p) => p.w === '8px' && p.h === '8px' && p.icon === 'none')
        && Math.max(...pulse.map((p) => p.o)) - Math.min(...pulse.map((p) => p.o)) > 0.15, JSON.stringify(pulse.map((p) => p.o.toFixed(2))));
      check('the Agent cards say they run in the background', await js("[...document.querySelectorAll('.tool.agent .tool-meta')].every((m) => /In the background/.test(m.textContent))"));

      // Stop one of them.
      await js("[...document.querySelectorAll('.agent-list li')].find((li) => li.textContent.includes('Check the tests')).querySelector('.agent-stop').click(); true");
      await until('it to be stopped', `${rows}.some((r) => r === 'stopped:Check the tests')`);
      check('✕ stops that agent only', await js(`${rows}.some((r) => r === 'running:Map the modules')`), await js(`JSON.stringify(${rows})`));
      check('its card says Stopped', await js("[...document.querySelectorAll('.tool.agent')].some((t) => /Check the tests/.test(t.textContent) && /Stopped/.test(t.textContent))"));

      // The other one comes back; Claude continues on its own.
      await until('the agent to come back and Claude to answer', "/three modules/.test(document.querySelector('.timeline').textContent)", 20000);
      await until('that turn to end', "!document.querySelector('.send-btn.stop')");
      await wait(500);
      const wake = await js("document.querySelector('.wake')?.textContent || ''");
      check('a marker says why Claude continued', /Map the modules.*finished/.test(wake), wake);
      await shot('2-returned');
      // Opened, the agent's card lists its steps. Consecutive steps (its own, and the turn's) are joined by a short
      // line in the gap between their icons that never runs over either icon.
      await js("[...document.querySelectorAll('.tool.agent')].find((t) => /Map the modules/.test(t.textContent)).querySelector('.tool-head').click(); true");
      await until('its steps', "document.querySelectorAll('.tool.nested').length > 3", 4000);
      await wait(500);
      const rails = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.tool + .tool')].filter((el) => el.offsetParent).map((el) => {
        const prev = el.previousElementSibling.querySelector('.tool-glyph').getBoundingClientRect();
        const glyph = el.querySelector('.tool-glyph').getBoundingClientRect();
        const b = getComputedStyle(el, '::before'); const top = el.getBoundingClientRect().top + parseFloat(b.top);
        return { nested: el.classList.contains('nested'), gapTop: +(top - prev.bottom).toFixed(1), gapBottom: +(glyph.top - (top + parseFloat(b.height))).toFixed(1) };
      }))`));
      check('step connectors sit between the icons, touching neither', rails.length > 3 && rails.every((r) => r.gapTop >= 0.5 && r.gapBottom >= 0.5),
        JSON.stringify(rails.slice(0, 4)));
      await shot('2b-agent-steps');
      {
        const head = JSON.parse(await js("JSON.stringify((() => { const r = document.querySelector('.tool.agent').getBoundingClientRect(); return { x: r.left, y: r.top - 120 }; })())"));
        const img = await win.webContents.capturePage({ x: Math.max(0, Math.round(head.x) - 20), y: Math.max(0, Math.round(head.y)), width: 360, height: 340 });
        fs.writeFileSync(path.join(outDir, `crop-agent-steps-${THEME}.png`), img.resize({ width: 1080 }).toPNG());
      }
      await js("[...document.querySelectorAll('.tool.agent')].find((t) => /Map the modules/.test(t.textContent)).querySelector('.tool-head').click(); true");
      await wait(300);
      // When the last ended task's time is up, the strip folds away (its height eases down) rather than vanishing.
      const fold = await js(`new Promise((done) => { const out = []; const t0 = performance.now();
        const f = () => { const el = document.querySelector('.agents'); out.push(el ? Math.round(el.getBoundingClientRect().height) : 0);
          if (el && performance.now() - t0 < 9000) requestAnimationFrame(f); else done(out); };
        requestAnimationFrame(f); })`);
      const full = fold[0];
      const between = [...new Set(fold.filter((h) => h > 2 && h < full - 2))];
      check('the strip folds away, not vanishing', fold.at(-1) === 0 && between.length >= 3, `${full}px → ${between.slice(0, 8).join(' ')} → 0`);
      check('the session is not left working', await js("!document.querySelector('.session-row.working, .status-badge.working')"));

      // Stop during a turn ends it and its agents.
      await say('Do it again');
      await until('the new agent', `${rows}.some((r) => r === 'running:Profile the build')`);
      check('during a turn the Stop button shows', await js("Boolean(document.querySelector('.send-btn.stop'))"));
      await shot('3-turn-running');
      await js("document.querySelector('.chat-composer .composer-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
      await until('the agent to be stopped', `${rows}.some((r) => r === 'stopped:Profile the build') || !document.querySelector('.agents')`, 5000);
      await until('the chat to stop working', "!document.querySelector('.send-btn.stop') && !document.querySelector('.activity')", 6000);
      check('Esc ended the turn and its agent', true);
      check('stop-task was sent for the agent you stopped', (director.stopped || []).includes('task-b'), JSON.stringify(director.stopped));
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
