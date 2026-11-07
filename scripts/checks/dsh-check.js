// Check of DeepSeek Harness in the window, without API usage (the chat is scripted, see fakes.js; the real dsh is
// checked by dsh-real-check.js): its Settings tab and key; with it on, new chats run on it, offer its models and
// efforts, ask with its name, and the CLI is offered nowhere; Claude Code's conversations stay as they were.
// Screenshots in dist/dsh-check/.
// Usage: npx vite build && npx electron scripts/checks/dsh-check.js
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { tempDir } = require('./temp');
const { install } = require('./fakes');
const { fakeDeepSeek } = require('./fake-deepseek');

const outDir = path.join(__dirname, '..', '..', 'dist', 'dsh-check');
const profile = tempDir('dsh-profile');
const project = tempDir('dsh-project');
fs.mkdirSync(outDir, { recursive: true });
// dsh counts as installed (main/dsh-install.js), so no download starts; the fake session stands in for it.
process.env.CCUI_DSH_DIR = tempDir('dsh-program');
process.env.CCUI_DSH_HOME = tempDir('dsh-home');

const director = {
  histories: [], transcripts: new Map(),
  script: () => async (c) => {
    await c.think(300, 'Checking the file first.');
    await c.tool('Write', { file_path: path.join(project, 'hello.txt'), content: 'hi\n' }, { ask: { title: undefined } });
    await c.say('Wrote it.', { cps: 600 });
    c.finish(0);
  },
  prompt: () => '', shell: () => '', cli: () => '',
};
install(director);
const starts = [];
{
  const { AgentManager } = require.cache[require.resolve('../../src/main/agent')].exports;
  const { start } = AgentManager.prototype;
  AgentManager.prototype.start = function (opts) { starts.push(opts); return start.call(this, opts); };
}

fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  language: 'en', uiScale: 100, theme: 'light', confirmClose: false, notify: false, trustedFolders: [project],
  recent: [{ path: project, at: Date.now() }], sidebarGlass: false,
}));
app.setPath('userData', profile);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail && !ok ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

app.on('browser-window-created', (_e, win) => {
  win.setSize(1320, 860);
  win.webContents.setBackgroundThrottling(false);
  const js = (code) => win.webContents.executeJavaScript(code);
  const until = async (label, condition, timeout = 10000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await js(condition).catch(() => false)) return true;
      await wait(100);
    }
    check(`waiting for ${label}`, false, 'timeout');
    return false;
  };
  const type = (selector, value) => js(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.focus(); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const shot = async (name) => fs.writeFileSync(path.join(outDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const click = (selector, text) => js(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.includes(${JSON.stringify(text)})); el?.click(); return Boolean(el); })()`);
  const contextItems = async (selector) => {
    await js(`{ const b = document.querySelector(${JSON.stringify(selector)}); const r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 10, clientY: r.top + 10 })); } true`);
    await wait(250);
    const items = await js("JSON.stringify([...document.querySelectorAll('.context-menu button')].map((b) => b.textContent))");
    await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
    await wait(200);
    return JSON.parse(items);
  };
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log('[renderer]', ev.message); });

  win.webContents.once('did-finish-load', async () => {
    // An OpenAI-compatible endpoint to add as a provider: Fetch available models asks it.
    const relay = await fakeDeepSeek(() => ({ text: 'Relayed.' }), { key: 'sk-relay-0000', models: [{ id: 'relay-model', context_length: 64000 }, { id: 'relay-mini' }] });
    try {
      await wait(1000);
      check('with DeepSeek Harness off, the CLI is offered', (await contextItems('#sidebar button.new-session')).some((x) => /New CLI session/.test(x)));

      // Settings → DeepSeek Harness
      await click('.sidebar-bottom button', 'Settings');
      await until('Settings', "Boolean(document.querySelector('.settings-nav'))");
      check('Settings has a DeepSeek Harness section', await click('.settings-nav button', 'DeepSeek Harness'));
      await wait(400);
      const tab = JSON.parse(await js(`JSON.stringify({
        title: document.querySelector('.settings-head h2')?.textContent,
        cards: [...document.querySelectorAll('.provider-card')].map((c) => c.querySelector('.provider-name').textContent + '|' + c.querySelector('.provider-tag').textContent + '|' + c.querySelector('.provider-dot').className),
        program: document.querySelector('.settings-body')?.textContent.includes('on this computer'),
        privacy: /turns both off/.test(document.querySelector('.settings-body')?.textContent || '') })`));
      check('it has the switch, the providers, the model, the program and what is sent', tab.title === 'DeepSeek Harness' && tab.program && tab.privacy, JSON.stringify(tab));
      check('DeepSeek is a built-in provider, without a key yet', tab.cards.length === 1 && tab.cards[0] === 'DeepSeek|Built in|provider-dot none', JSON.stringify(tab.cards));
      await shot('1-settings');

      // DeepSeek's key, in its card
      await click('.provider-card .secondary-btn', 'Edit');
      await until('the editor', "Boolean(document.querySelector('.provider-editor input[type=password]'))");
      await type('.provider-editor input[type=password]', 'sk-test-0000');
      await click('.pv-foot .primary-btn', 'Save');
      await until('the key saved', "document.querySelector('.provider-card .provider-dot')?.classList.contains('ok')");
      let stored = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'));
      check('the key is stored encrypted, not as typed', Boolean(stored.deepseekKeyEnc) && !JSON.stringify(stored).includes('sk-test-0000'));
      check('and the card’s dot turns green', true);

      // A custom provider: name, key, address, its models fetched from it
      await click('.settings-body button', 'Add model provider');
      await until('the new provider’s editor', "Boolean(document.querySelector('.provider-card.open .pv-custom'))");
      await click('.provider-card.open .pv-foot .primary-btn', 'Save');
      await wait(200);
      check('saving without a name says what is missing', /Give the provider a name/.test(await js("document.querySelector('.pv-error')?.textContent || ''")));
      await type('.provider-card.open input[type=password]', 'sk-relay-0000');
      await type('.provider-card.open input[placeholder="e.g. My relay"]', 'Relay');
      await type('.provider-card.open input[placeholder="https://api.example.com/v1"]', `${relay.url}/v1`);
      check('OpenAI Chat Completions is the protocol to start with', /OpenAI Chat Completions/.test(await js("document.querySelector('.provider-card.open .pv-protocol')?.textContent || ''")));
      await click('.provider-card.open .link-btn', 'Fetch available models');
      await until('the fetched models', "document.querySelectorAll('.provider-card.open .pv-model').length === 2");
      const rows = JSON.parse(await js("JSON.stringify([...document.querySelectorAll('.provider-card.open .pv-model')].map((r) => r.querySelector('.pv-model-id').value))"));
      check('Fetch available models lists the endpoint’s models', JSON.stringify(rows) === '["relay-model","relay-mini"]', JSON.stringify(rows));
      check('asking it with the key typed in', relay.requests.some((r) => r.method === 'GET' && r.url === '/v1/models' && r.keyMatches && r.bearer), JSON.stringify(relay.requests.map((r) => r.url)));
      await js("document.querySelector('.provider-card.open .pv-model .pv-more').click(); true");
      await wait(400);
      await js("document.querySelector('.provider-card.open .pv-model .switch input').click(); true");
      await wait(300);
      check('a model’s options include its reasoning levels', (await js("document.querySelectorAll('.provider-card.open .pv-model .pv-level').length")) === 4);
      await js("document.querySelector('.provider-card.open .pv-model .pv-pair input').scrollIntoView({ block: 'center' }); true");
      await shot('1b-custom-provider');
      await click('.provider-card.open .pv-foot .primary-btn', 'Save');
      await until('the new card', "document.querySelectorAll('.provider-card').length === 2 && !document.querySelector('.provider-card.open')");
      const cards = JSON.parse(await js("JSON.stringify([...document.querySelectorAll('.provider-card')].map((c) => c.querySelector('.provider-name').textContent + '|' + c.querySelector('.provider-tag').textContent + '|' + c.querySelector('.provider-dot').className))"));
      check('it is listed as a custom provider with its key', cards[1] === 'Relay|Custom|provider-dot ok', JSON.stringify(cards));
      stored = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'));
      const provider = stored.dshProviders?.[0];
      check('it is saved with its address, protocol and models', provider?.id === 'custom-relay' && provider.api === 'openai-completions' && provider.baseURL === `${relay.url}/v1`
        && provider.models.length === 2 && provider.models[0].reasoning?.high === 'high' && provider.models[0].contextWindow === 64000, JSON.stringify(provider));
      check('its key encrypted apart, never as typed', Boolean(stored.dshKeysEnc?.['custom-relay']) && !JSON.stringify(stored).includes('sk-relay-0000'));
      check('its models can be the default for new chats', (await js("[...document.querySelectorAll('.settings-body .dropdown')].some((d) => d.textContent.includes('DeepSeek V4.1 Flash'))")));
      await shot('1c-providers');
      await js("document.querySelector('.settings-body .switch input')?.click(); true");
      await until('the switch on', `JSON.parse(${JSON.stringify('true')}) && document.querySelector('.settings-body .switch input')?.checked`);
      await wait(300);
      check('switching it on is saved', JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).dshEnabled === true);
      await click('.settings-nav button', 'General');
      await wait(300);
      check('Default session no longer offers the CLI', !(await js("[...document.querySelectorAll('.settings-body .segmented label')].some((l) => l.textContent === 'CLI')")));
      await click('.settings-head button', 'Done');
      await wait(500);

      // No CLI anywhere
      check('New session’s menu has no CLI', !(await contextItems('#sidebar button.new-session')).some((x) => /CLI/.test(x)));

      // A new chat on it
      await js("document.querySelector('#sidebar button.new-session').click(); true");
      await until('a new chat', "Boolean(document.querySelector('.chat.empty .chat-composer'))");
      await wait(900);
      const started = starts.at(-1);
      check('a new chat starts on DeepSeek Harness, with its model', Boolean(started?.Session) && started.model === 'deepseek-flash', JSON.stringify({ model: started?.model, engine: started?.engine }));
      check('it says so over the message box, with no CLI choice', await js("document.querySelector('.intro-chips')?.textContent.includes('DeepSeek') && !document.querySelector('.intro-chips .menu-button[title=\"How the session is shown\"]')"));
      check('the top bar has no CLI button', !(await js("[...document.querySelectorAll('.topbar-actions .text-btn')].some((b) => b.textContent.includes('CLI'))")));
      await shot('2-new-chat');
      await js("document.querySelector('.model-menu .menu-button').click(); true");
      await wait(400);
      const menu = JSON.parse(await js("JSON.stringify({ models: [...document.querySelectorAll('.model-menu [role=option]')].map((o) => o.textContent), stops: document.querySelectorAll('.model-menu .effort-stop, .model-menu [data-stop]').length, text: document.querySelector('.model-menu')?.textContent })"));
      check('the model menu lists DeepSeek’s models', menu.models.some((m) => m.includes('V4 Pro')) && menu.models.some((m) => m.includes('Flash')), JSON.stringify(menu.models));
      check('and the custom provider’s, named with it', menu.models.some((m) => m.includes('relay-model') && m.includes('Relay')), JSON.stringify(menu.models));
      // Auto, then Off, Low, High, Max: one step right of Auto is Off.
      await js("{ const tr = document.querySelector('.model-menu .effort-track'); tr.focus(); tr.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); } true");
      await wait(600);
      const effort = JSON.parse(await js("JSON.stringify({ stops: document.querySelectorAll('.model-menu .effort-stop').length, value: document.querySelector('.model-menu .effort-value')?.textContent })"));
      check('and its efforts, Off included', effort.stops === 5 && effort.value === 'Off', JSON.stringify(effort));
      check('which the session is told', starts.length > 0 && JSON.stringify(director.controls || []).includes('"effort","off"'), JSON.stringify(director.controls));
      await shot('3-model-menu');
      await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
      await wait(300);
      await js("document.querySelector('.model-menu .menu-button[aria-expanded=true]')?.click(); true");

      // Commands: its own, no CLI ones
      await js(`(() => { const i = document.querySelector('.composer-input'); i.focus(); i.value = '/'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await wait(500);
      const commands = JSON.parse(await js("JSON.stringify([...document.querySelectorAll('.autocomplete [role=option], .autocomplete button, .autocomplete li')].map((x) => x.textContent))"));
      check('/ offers DeepSeek Harness’s commands and none of the CLI’s', commands.some((c) => c.includes('/goal')) && commands.some((c) => c.includes('/compact')) && !commands.some((c) => /\/(btw|mcp|permissions|login)\b/.test(c)), JSON.stringify(commands.slice(0, 30)));
      await js(`(() => { const i = document.querySelector('.composer-input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await wait(200);

      // A turn that asks first
      await js(`(() => { const i = document.querySelector('.composer-input'); i.focus(); i.value = 'Write hello.txt'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await wait(100);
      await js("document.querySelector('.send-btn').click(); true");
      await until('the permission card', "Boolean(document.querySelector('.prompt .prompt-title'))", 15000);
      const title = await js("document.querySelector('.prompt .prompt-title').textContent");
      check('it asks with DeepSeek’s name', /Allow DeepSeek to use Write\?/.test(title), title);
      await shot('4-asks');
      await click('.prompt .primary-btn', 'Allow');
      await until('the answer', "/Wrote it\\./.test(document.querySelector('.timeline')?.textContent || '')", 15000);
      check('the turn finishes', true);
      const sidebar = await contextItems('#sidebar .session');
      check('its session menu has no Open in CLI', !sidebar.some((x) => /CLI/.test(x)), JSON.stringify(sidebar));
      await shot('5-answered');
      const saved = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'));
      check('the open session is remembered as a DeepSeek Harness chat', saved.lastSessions?.some((x) => x.engine === 'dsh' && /^dsh-/.test(x.sessionId || '')), JSON.stringify(saved.lastSessions));

      // Off again: new chats are Claude Code's, and the CLI comes back; the DeepSeek chat stays on DeepSeek.
      await click('.sidebar-bottom button', 'Settings');
      await until('Settings', "Boolean(document.querySelector('.settings-nav'))");
      await click('.settings-nav button', 'DeepSeek Harness');
      await wait(300);
      await js("document.querySelector('.settings-body .switch input')?.click(); true");
      await wait(300);
      await click('.settings-head button', 'Done');
      await wait(400);
      check('switched off, the CLI is offered again', (await contextItems('#sidebar button.new-session')).some((x) => /New CLI session/.test(x)));
      check('but not for the DeepSeek chat', !(await contextItems('#sidebar .session')).some((x) => /CLI/.test(x)));

      // Removing the custom provider asks first, then takes its key too.
      await click('.sidebar-bottom button', 'Settings');
      await until('Settings', "Boolean(document.querySelector('.settings-nav'))");
      await click('.settings-nav button', 'DeepSeek Harness');
      await wait(300);
      await click('.provider-card .text-danger', 'Delete');
      await until('the confirmation', "Boolean(document.querySelector('.dialog-confirm[open] .danger-btn'))");
      await js("document.querySelector('.dialog-confirm[open] .danger-btn').click(); true");
      await until('the card gone', "document.querySelectorAll('.provider-card').length === 1");
      await wait(300);
      const after = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'));
      check('deleting a provider removes it and its key', !after.dshProviders.length && !after.dshKeysEnc?.['custom-relay'], JSON.stringify({ p: after.dshProviders, k: Object.keys(after.dshKeysEnc || {}) }));
      relay.close();
    } catch (err) {
      check('the check ran to its end', false, err.stack);
    }
    console.log(failures ? `failed: ${failures}` : 'all passed');
    app.exit(failures ? 1 : 0);
  });
});

require('../../src/main/main.js');
