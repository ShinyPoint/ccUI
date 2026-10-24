// Check of the Plugins dialog against the real Claude Code's `claude plugin` commands (no API usage, no network),
// in a throwaway Claude Code config (CLAUDE_CONFIG_DIR) with a marketplace in a local folder: Plugins sits under
// Skills, lined up with it; a marketplace is added from a folder; its plugin is installed, turned off and on,
// shows what it adds, and is uninstalled after a confirmation. Your own Claude Code config is never touched.
// Usage: npx vite build && npx electron scripts/checks/plugins-check.js
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { tempDir } = require('./temp');
const { install } = require('./fakes');

const profile = tempDir('plugins-profile');
const project = tempDir('plugins-project');
process.env.CLAUDE_CONFIG_DIR = tempDir('plugins-claude'); // Claude Code's config for this check only
const market = tempDir('plugins-market');
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
write(path.join(market, '.claude-plugin', 'marketplace.json'), JSON.stringify({
  name: 'ccui-check', owner: { name: 'ccUI' }, plugins: [{ name: 'hello', source: './plugins/hello', description: 'Says hello' }],
}));
write(path.join(market, 'plugins', 'hello', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'hello', version: '1.0.0', description: 'Says hello' }));
write(path.join(market, 'plugins', 'hello', 'skills', 'hello', 'SKILL.md'), '---\nname: hello\ndescription: Say hello\n---\nSay hello.\n');

install({ script: () => null, prompt: () => '', shell: () => '', cli: () => '' });
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  language: 'en', uiScale: 100, theme: 'light', confirmClose: false, notify: false, trustedFolders: [project],
  recent: [{ path: project, at: Date.now() }],
}));
app.setPath('userData', profile);

const outDir = path.join(__dirname, '..', '..', 'dist', 'plugins-check');
fs.mkdirSync(outDir, { recursive: true });
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
  const shot = async (name) => fs.writeFileSync(path.join(outDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const until = async (label, condition, timeout = 60000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await js(condition).catch(() => false)) return true;
      await wait(150);
    }
    check(`waiting for ${label}`, false, 'timeout');
    return false;
  };
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });
  const hello = "[...document.querySelectorAll('.dialog-plugins .plugin')].find((li) => li.querySelector('.skill-name span')?.textContent === 'hello')";
  const tab = (name) => js(`[...document.querySelectorAll('.dialog-plugins .segmented label')].find((l) => l.textContent.startsWith(${JSON.stringify(name)})).click(); true`);

  win.webContents.once('did-finish-load', async () => {
    try {
      await until('the sidebar', "Boolean(document.querySelector('#sidebar .sidebar-link'))", 10000);
      // Under Skills, its icon's stroke where Skills' is.
      const side = JSON.parse(await js(`JSON.stringify((() => { const links = [...document.querySelectorAll('#sidebar .sidebar-link')];
        const ink = (svg) => { const k = svg.getBoundingClientRect().width / 24; return Math.min(...[...svg.children].map((c) => c.getBoundingClientRect().left)) - Number(svg.getAttribute('stroke-width')) / 2 * k; };
        return { order: links.map((l) => l.textContent), off: Math.round((ink(links[1].querySelector('svg')) - ink(links[0].querySelector('svg'))) * 10) / 10 }; })())`));
      check('Plugins sits under Skills, its icon lined up with Skills’', JSON.stringify(side.order) === '["Skills","Plugins"]' && Math.abs(side.off) <= 1, JSON.stringify(side));
      await js("[...document.querySelectorAll('#sidebar .sidebar-link')].find((l) => l.textContent === 'Plugins').click(); true");
      await until('the plugins', "Boolean(document.querySelector('.dialog-plugins .skills-bar'))");
      check('with nothing installed it opens on Discover, which says to add a marketplace',
        await js("/Add one below/.test(document.querySelector('.dialog-plugins .skills-list').textContent) && document.querySelector('.dialog-plugins .segmented input:checked').value === 'discover'"));

      // A marketplace from a folder, and its plugin.
      await js(`{ const el = document.querySelector('.plugin-add input'); el.value = ${JSON.stringify(market)}; el.dispatchEvent(new Event('input', { bubbles: true })); } true`);
      await wait(100);
      await js("document.querySelector('.plugin-add button[type=submit]').click(); true");
      await until('the marketplace’s plugin', `Boolean(${hello})`);
      check('a marketplace added from a folder lists its plugin', await js(`/Says hello/.test(${hello}.textContent) && /ccui-check/.test(document.querySelector('.plugin-markets').textContent)`));
      await shot('1-discover');
      await js(`${hello}.querySelector('.secondary-btn').click(); true`);
      await until('the install', `!${hello} && /Installed \\(1\\)/.test(document.querySelector('.dialog-plugins .segmented').textContent)`);
      check('Install installs it: it leaves Discover for Installed', await js("/Installed \\(1\\)/.test(document.querySelector('.dialog-plugins .segmented').textContent)"));
      const installed = JSON.parse(fs.readFileSync(path.join(process.env.CLAUDE_CONFIG_DIR, 'plugins', 'installed_plugins.json'), 'utf8'));
      check('in Claude Code’s own list of installed plugins', JSON.stringify(installed).includes('hello@ccui-check'));

      await tab('Installed');
      await until('the installed list', `Boolean(${hello}?.querySelector('.switch'))`);
      const on = await js(`${hello}.querySelector('.switch input').checked`);
      await js(`${hello}.querySelector('.switch input').click(); true`);
      await until('it to be off', `${hello} && !${hello}.querySelector('.switch input').checked && ${hello}.classList.contains('off')`);
      const settingsFile = path.join(process.env.CLAUDE_CONFIG_DIR, 'settings.json');
      const offInSettings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')).enabledPlugins?.['hello@ccui-check'];
      check('its switch turns it off, in Claude Code’s settings', on === true && offInSettings === false, `${on} → ${offInSettings}`);
      await js(`${hello}.querySelector('.switch input').click(); true`);
      await until('it to be on again', `${hello} && ${hello}.querySelector('.switch input').checked`);
      check('and on again', JSON.parse(fs.readFileSync(settingsFile, 'utf8')).enabledPlugins?.['hello@ccui-check'] === true);
      await js(`${hello}.querySelector('.plugin-more').click(); true`);
      await until('what it adds', `/Component inventory/.test(${hello}.querySelector('.plugin-details')?.textContent || '')`);
      check('it shows what it adds', await js(`/Skills \\(1\\)\\s+hello/.test(${hello}.querySelector('.plugin-details').textContent)`));
      check('with its description, from its manifest', await js(`${hello}.querySelector('.skill-desc')?.textContent === 'Says hello'`));
      await wait(400);
      await shot('2-installed');

      await js(`[...${hello}.querySelectorAll('.icon-btn')].find((b) => b.title === 'Uninstall').click(); true`);
      await until('the question', "Boolean(document.querySelector('.dialog-confirm[open]'))", 5000);
      check('Uninstall asks first', await js("/Uninstall hello\\?/.test(document.querySelector('.dialog-confirm').textContent)"));
      await js("document.querySelector('.dialog-confirm .danger-btn').click(); true");
      await until('it to go', `!${hello} && /No plugins installed yet/.test(document.querySelector('.dialog-plugins .skills-list').textContent)`);
      check('and uninstalls it', !JSON.stringify(JSON.parse(fs.readFileSync(path.join(process.env.CLAUDE_CONFIG_DIR, 'plugins', 'installed_plugins.json'), 'utf8'))).includes('hello@ccui-check'));
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
