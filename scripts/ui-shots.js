// Visual check without API usage: opens the built app with a throwaway profile, starts a chat session
// (no message is sent), opens the Terminal panel, and saves screenshots in dark and light themes.
// Usage: npm run build && npx electron scripts/ui-shots.js   (writes dist/ui-shots/*.png)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const { tempDir } = require('./checks/temp');

const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'ui-shots'));
const profile = tempDir('shots-profile');
const project = tempDir('shots-project');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(project, 'README.md'), '# demo\n');
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  language: 'en', theme: 'dark', confirmClose: false, notify: false, recent: [{ path: project, at: Date.now() }],
  trustedFolders: [project], // a throwaway folder: skip the trust prompt
}));
app.setPath('userData', profile);

// Where the visible terminals are, against the areas that hold them: a terminal must end inside its area.
const LAYOUT = `{ const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return r.width ? [r.left, r.top, r.right, r.bottom].map(Math.round).join(',') : null; };
  JSON.stringify({ window: innerWidth + 'x' + innerHeight, stage: box(document.querySelector('#stage')),
    cli: [...document.querySelectorAll('#term-stack .term-host')].map((h) => box(h.querySelector('.xterm-screen'))).filter(Boolean),
    cliHost: [...document.querySelectorAll('#term-stack .term-host')].map(box).filter(Boolean),
    overlay: box(document.querySelector('.term-composer, .terminal-composer')),
    panel: box(document.querySelector('.bottom-panel')),
    panelTerm: [...document.querySelectorAll('.panel-stack .term-host')].map((h) => box(h.querySelector('.xterm-screen'))).filter(Boolean) }) }`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Where the new-chat intro sits: the middle of its centered part (the two lines, or the lines plus the
// suggested prompts) against the middle of the chat area.
const MEASURE = `{ const area = document.querySelector('.chat-scroll').getBoundingClientRect();
  const top = document.querySelector('.chat-intro h2').getBoundingClientRect().top;
  const name = document.querySelector('.intro-project');
  const starters = document.querySelector('.starters');
  const bottom = starters ? starters.getBoundingClientRect().bottom : name.getBoundingClientRect().bottom - 26;
  'block middle ' + Math.round((top + bottom) / 2) + ', area middle ' + Math.round((area.top + area.bottom) / 2) }`;

app.on('browser-window-created', (_e, win) => {
  win.setSize(1320, 860);
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => {
    fs.writeFileSync(path.join(outDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    console.log('saved', name);
  };
  win.webContents.on('console-message', (ev) => {
    if (ev.level === 'error') console.log('[renderer]', ev.message);
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(1500);
      await shot('1-empty');
      await js(`document.querySelector('.empty-recent .primary-btn').click()`);
      await wait(6000);
      await js(`{ const el = document.querySelector('.chat-composer .composer-input');
        el.value = 'Draft prompt to show the message box'; el.dispatchEvent(new Event('input', { bubbles: true })); }`);
      await wait(400);
      console.log('centering:', await js(MEASURE));
      await shot('2-chat-dark');
      // A Markdown table as Claude would write it (rounded like code blocks), added for the picture and removed.
      await js(`{ const el = document.createElement('div');
        el.className = 'msg-text md shot-table';
        el.innerHTML = '<p>Here is the comparison:</p><table><thead><tr><th>Option</th><th>Speed</th><th>Notes</th></tr></thead>'
          + '<tbody><tr><td>Haiku</td><td>Fastest</td><td>Quick answers</td></tr><tr><td>Sonnet</td><td>Fast</td><td>Routine work</td></tr>'
          + '<tr><td>Opus</td><td>Thorough</td><td>Complex tasks</td></tr></tbody></table>';
        document.querySelector('.chat-intro').style.display = 'none';
        document.querySelector('.timeline').append(el); } true`);
      await wait(300);
      console.log('table corners:', await js("getComputedStyle(document.querySelector('.shot-table table')).borderRadius"));
      await shot('2c-table');
      await js(`document.querySelector('.shot-table').remove(); document.querySelector('.chat-intro').style.display = ''; true`);
      await wait(300);
      // Long draft so the message box scrolls; hover it to reveal the scrollbar.
      const box = await js(`{ const el = document.querySelector('.chat-composer .composer-input');
        el.value = Array.from({ length: 40 }, (_, i) => 'Line ' + (i + 1) + ' of a long prompt').join('\\n');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        const r = el.getBoundingClientRect(); ({ x: Math.round(r.right - 30), y: Math.round(r.top + r.height / 2) }); }`);
      await wait(300);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: box.x, y: box.y });
      await wait(400);
      await shot('2b-scrollbar-hover');
      await js(`document.querySelector('.panel-toggle').click()`);
      await wait(3500);
      await shot('3-terminal-panel-dark');
      await js(`document.querySelector('.sidebar-bottom .icon-btn').click()`);
      await wait(1200);
      await shot('4-terminal-panel-light');
      // Color theme: pick Clay in Settings, then save and see it applied.
      await js(`[...document.querySelectorAll('.sidebar-bottom button')].find((b) => b.textContent.includes('Settings')).click()`);
      for (let i = 0; i < 40 && !(await js(`Boolean(document.querySelector('.settings-nav'))`)); i++) await wait(100);
      await js(`[...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent.includes('Appearance')).click()`);
      await wait(200);
      await js(`document.querySelector('.swatch input[value="ember"]').click()`);
      await wait(300);
      await shot('5-color-theme-picker');
      // Also turn on suggested prompts, then empty the message box to see the intro with them.
      await js(`[...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent.includes('General')).click()`);
      await wait(200);
      await shot('5b-settings-general');
      await js(`[...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent.includes('Terminal')).click()`);
      await wait(200);
      await shot('5c-settings-terminal');
      await js(`[...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent.includes('Claude Code')).click()`);
      await wait(600);
      await shot('5d-settings-claude');
      await js(`[...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent.includes('General')).click()`);
      await wait(200);
      await js(`[...document.querySelectorAll('.dialog .set-row')].find((r) => r.textContent.includes('Suggested prompts')).querySelector('input').click()`);
      await js(`document.querySelector('.dialog .primary-btn[type="submit"]').click()`);
      await wait(500);
      await js(`{ const el = document.querySelector('.chat-composer .composer-input');
        el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }`);
      await wait(800);
      console.log('centering with suggestions:', await js(MEASURE));
      await shot('6-clay-light');
      // Claude Code's own CLI in the same session (nothing is sent), with the Terminal panel still open.
      await js(`[...document.querySelectorAll('.text-btn')].find((b) => b.textContent.trim() === 'CLI').click()`);
      await wait(7000);
      console.log('cli layout:', await js(LAYOUT));
      await shot('7-cli-with-panel');
      await js(`document.querySelector('.panel-toggle').click()`);
      await wait(1500);
      console.log('cli layout, panel closed:', await js(LAYOUT));
      await shot('8-cli');
    } catch (err) {
      console.error('failed:', err);
      process.exitCode = 1;
    }
    app.quit();
  });
});

require('../src/main/main.js');
