// End-to-end check of /skills in a chat, with the real Claude Code process and no prompts sent (no API usage):
// a throwaway project with its own skill, the Skills panel lists it, turning it off and on again writes the
// project's .claude/settings.local.json and updates the / list, and CLI-only commands aren't sent to Claude.
// Only "This project" is changed, so your own Claude Code settings are left alone.
// Usage: npx vite build && npx electron scripts/skills-check.js   (writes dist/skills-check/*.png)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const outDir = path.join(__dirname, '..', 'dist', 'skills-check');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ccui-skills-profile-'));
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccui-skills-project-'));
const local = path.join(project, '.claude', 'settings.local.json');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.join(project, '.claude', 'skills', 'release-notes'), { recursive: true });
fs.writeFileSync(path.join(project, '.claude', 'skills', 'release-notes', 'SKILL.md'),
  '---\nname: release-notes\ndescription: Write release notes from the commits since the last tag.\n---\n\nRead git log, group by type, write NOTES.md.\n');
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  theme: 'light', confirmClose: false, notify: false, sidebarGlass: false,
  recent: [{ path: project, at: Date.now() }], trustedFolders: [project],
}));
app.setPath('userData', profile);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};
const overrides = () => { try { return JSON.parse(fs.readFileSync(local, 'utf8')).skillOverrides || {}; } catch { return {}; } };

app.on('browser-window-created', (_e, win) => {
  win.setSize(1320, 860);
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => fs.writeFileSync(path.join(outDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const until = async (label, condition, timeout = 30000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await js(condition).catch(() => false)) return true;
      await wait(150);
    }
    check(`waiting for ${label}`, false, 'timeout');
    return false;
  };
  const type = (text) => js(`{ const el = document.querySelector('.chat-composer .composer-input');
    el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); } true`);
  const enter = () => js("document.querySelector('.chat-composer .composer-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); true");
  const row = (name) => `[...document.querySelectorAll('.skill')].find((r) => r.querySelector('.skill-name span').textContent === '/${name}')`;
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });

  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(1200);
      check('the cc in the corner is Claude orange', (await js("getComputedStyle(document.querySelector('.wm-cc')).color")) === 'rgb(217, 119, 87)');
      await js("document.querySelector('.empty-recent .primary-btn').click(); true");
      await until('chat ready', "Boolean(document.querySelector('.chat-composer .composer-input'))");
      await until('the model menu', "Boolean(document.querySelector('.composer-bar .menu:not(.mode-menu)'))");
      check('the model menu is on the right, after the spacer', await js(`{ const bar = [...document.querySelector('.composer-bar').children];
        bar.indexOf(document.querySelector('.composer-bar .spacer')) < bar.indexOf(document.querySelector('.composer-bar .menu:not(.mode-menu)')) }`));

      await type('/ski');
      await wait(300);
      check('/skills is offered in the / list', await js("[...document.querySelectorAll('.autocomplete li')].some((li) => li.textContent.includes('/skills'))"));
      await type('/skills');
      await enter();
      await until('the Skills panel', "Boolean(document.querySelector('.dialog-skills[open] .skill'))");
      check('nothing was sent to Claude', await js("!document.querySelector('.msg-user')"));
      check("the project's own skill is listed under This project", await js(`[...document.querySelectorAll('.dialog-skills section')]
        .some((s) => s.querySelector('h4').textContent === 'This project' && s.textContent.includes('/release-notes'))`));
      await shot('1-skills');

      // Off, in this project only.
      await js(`{ const sel = ${row('release-notes')}.querySelector('select'); sel.value = 'off'; sel.dispatchEvent(new Event('change', { bubbles: true })); } true`);
      await until('off applied', `${row('release-notes')}?.querySelector('select').value === 'off' && ${row('release-notes')}.classList.contains('off')`);
      check('Off is written to the project’s settings.local.json', overrides()['release-notes'] === 'off', JSON.stringify(overrides()));
      await shot('2-off');
      await js("document.querySelector('.dialog-skills').close(); true");
      await wait(400);
      await type('/release');
      await wait(400);
      check('a skill that is off leaves the / list', await js("![...document.querySelectorAll('.autocomplete li')].some((li) => li.textContent.includes('/release-notes'))"));

      // Back on: the entry is removed again.
      await type('/skills');
      await enter();
      await until('the Skills panel again', `Boolean(${row('release-notes')})`);
      await js(`{ const sel = ${row('release-notes')}.querySelector('select'); sel.value = 'on'; sel.dispatchEvent(new Event('change', { bubbles: true })); } true`);
      await until('on applied', `${row('release-notes')}?.querySelector('select').value === 'on' && !${row('release-notes')}.classList.contains('off')`);
      check('On removes the entry', !('release-notes' in overrides()), JSON.stringify(overrides()));
      await js("document.querySelector('.dialog-skills').close(); true");
      await wait(400);
      await type('/release');
      await wait(400);
      check('and it is back in the / list', await js("[...document.querySelectorAll('.autocomplete li')].some((li) => li.textContent.includes('/release-notes'))"));

      // Commands a chat can't run.
      await type('/doctor');
      await enter();
      await wait(300);
      check('a CLI-only command is not sent and stays in the box', await js("!document.querySelector('.msg-user') && document.querySelector('.chat-composer .composer-input').value === '/doctor'"));
      check('and says where it works', await js("[...document.querySelectorAll('.toast')].some((t) => /CLI/.test(t.textContent))"));
      await shot('3-cli-only');
    } catch (err) {
      console.error('failed:', err);
      failures++;
    }
    console.log(failures ? `${failures} problem(s)` : 'all checks passed');
    process.exitCode = failures ? 1 : 0;
    app.quit();
  });
});

require('../src/main/main.js');
