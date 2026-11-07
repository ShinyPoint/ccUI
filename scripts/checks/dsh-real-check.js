// Check of chat sessions on the real DeepSeek Harness, against a stand-in for DeepSeek's API (fake-deepseek.js): no API
// usage, but dsh has to be on this computer. What is checked here is the main process's side: the messages the window
// gets, asking before tools in each permission mode, Stop, the model, saved conversations, forks, undoing file changes.
// Usage: npm run check:dsh-real   (the DeepSeek Harness the installed ccUI downloaded; Settings → DeepSeek Harness)
//        or with CCUI_DSH_DIR=<folder with node_modules/@deepseek-ai/dsh> CCUI_DSH_NODE=<node 24.9 or later>
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const { fakeDeepSeek } = require('./fake-deepseek');
const { DSH_VERSION, NODE_VERSION } = require('../../src/main/dsh-install');

const installed = path.join(app.getPath('appData'), 'ccUI', 'dsh');
process.env.CCUI_DSH_DIR ||= path.join(installed, DSH_VERSION);
process.env.CCUI_DSH_NODE ||= path.join(installed, `node-${NODE_VERSION}`, process.platform === 'win32' ? 'node.exe' : 'bin/node');
if (!fs.existsSync(path.join(process.env.CCUI_DSH_DIR, 'node_modules', '@deepseek-ai', 'dsh'))) {
  console.log(`FAIL  DeepSeek Harness is not at ${process.env.CCUI_DSH_DIR}: download it in ccUI's Settings, or set CCUI_DSH_DIR`);
  process.exit(1);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `: ${detail}`}`);
  if (!ok) failures++;
};
const until = async (test, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = test();
    if (value) return value;
    await wait(40);
  }
  return null;
};

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ccui-dsh-'));
const project = path.join(scratch, 'project');
fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'notes.txt'), 'alpha\nbeta\ngamma\ndelta\n');
process.env.CCUI_DSH_HOME = path.join(scratch, 'home');
app.setPath('userData', path.join(scratch, 'profile'));

app.whenReady().then(async () => {
  try {
    await run();
  } catch (err) {
    check('the check ran to its end', false, err.stack);
  }
  console.log(failures ? `failed: ${failures}` : 'all passed');
  app.exit(failures ? 1 : 0);
});

async function run() {
  // What each request answers, chosen by the words of the user's last message.
  const scripts = new Map();
  const answer = (body) => {
    // Everything since the model last spoke: dsh adds reminders of its own after the user's words.
    const messages = body.messages || [];
    let from = messages.length - 1;
    while (from > 0 && messages[from - 1].role !== 'assistant') from--;
    const last = JSON.stringify(messages.slice(from));
    for (const [word, steps] of scripts) {
      if (last.includes(word) && steps.length) return steps.shift();
    }
    for (const steps of scripts.values()) {
      if (steps.length && /tool_result|"role":"tool"/.test(last)) return steps.shift(); // Anthropic's and OpenAI's
    }
    return { text: 'Done.' };
  };
  const api = await fakeDeepSeek(answer);
  process.env.CCUI_DSH_BASE_URL = api.url;
  const { AgentManager } = require('../../src/main/agent');
  const { DshSession, listDshHistory, loadDshHistory, forkDshSession } = require('../../src/main/dsh');
  const { DshInstaller } = require('../../src/main/dsh-install');
  const installer = new DshInstaller(path.join(scratch, 'dsh'), { get: () => ({}) }, () => {});
  const install = installer.paths();

  const bySession = new Map();
  const logFor = (id) => {
    if (!bySession.has(id)) bySession.set(id, { messages: [], permissions: [], cancelled: [], meta: null, exit: null });
    return bySession.get(id);
  };
  const manager = new AgentManager((channel, id, payload) => {
    const log = logFor(id);
    if (channel === 'agent:events') log.messages.push(...payload);
    else if (channel === 'agent:permission') log.permissions.push(payload);
    else if (channel === 'agent:permission-cancel') log.cancelled.push(payload);
    else if (channel === 'agent:meta') log.meta = payload;
    else if (channel === 'agent:exit') log.exit = payload;
  });
  const open = async (opts = {}) => {
    const res = await manager.start({ Session: DshSession, cwd: project, install, apiKey: 'sk-fake', env: {}, ...opts });
    if (!res.ok) throw new Error(res.error);
    return { id: res.id, session: manager.get(res.id), log: logFor(res.id) };
  };
  const results = (log) => log.messages.filter((m) => m.type === 'result');
  const finished = (log, n) => until(() => results(log).length >= n);
  const toolResult = (log, id) => log.messages.find((m) => m.type === 'user' && m.message.content?.[0]?.tool_use_id === id);

  // ---------- a turn, in the chat's words ----------
  const started = Date.now();
  const a = await open({ permissionMode: 'default' });
  check('dsh starts and answers initialize', Boolean(a.session));
  console.log(`      (started in ${Date.now() - started} ms)`);
  check('it reports models with effort levels', a.log.meta?.models?.some((m) => m.value === 'deepseek-v4-pro' && m.supportedEffortLevels.includes('max')));
  scripts.set('hello', [{ think: 'Let me think.', text: 'Hello there.' }]);
  a.session.send({ text: 'hello', uuid: 'ui-1' });
  await finished(a.log, 1);
  const types = a.log.messages.map((m) => m.event?.type || m.subtype || m.type);
  check('the first message announces the conversation', a.log.messages[0].subtype === 'init' && /^dsh-/.test(a.log.messages[0].session_id));
  check('an answer streams, thinking and text', types.includes('content_block_delta') && a.log.messages.some((m) => m.event?.delta?.thinking === 'Let me think.') && a.log.messages.some((m) => m.event?.delta?.text === 'Hello there.'));
  const final = a.log.messages.find((m) => m.type === 'assistant');
  const opened = a.log.messages.find((m) => m.event?.type === 'message_start');
  check('the finished message confirms what streamed', final?.message.id === opened?.event.message.id && final.message.content.some((b) => b.type === 'text' && b.text === 'Hello there.'), JSON.stringify(final));
  check('a turn ends with a result', results(a.log)[0]?.subtype === 'success');
  check('the sent message is marked as taken up', a.log.messages.some((m) => m.user_message_uuid === 'ui-1'));
  const context = await a.session.control('context');
  check('context usage comes from what the API reported', context.ok && context.value.totalTokens === 1360 && context.value.maxTokens > 100000, JSON.stringify(context));
  check('the session log upload is off', !api.requests.some((r) => /session-log|upload/.test(r.url)), api.requests.map((r) => r.url).join(' '));

  // ---------- asking first ----------
  scripts.set('edit please', [
    { tools: [['write', { file_path: 'new.txt', content: 'one\ntwo\n' }]] },
    { tools: [['edit', { file_path: 'notes.txt', old_string: 'gamma', new_string: 'GAMMA' }]] },
    { tools: [['read', { file_path: 'notes.txt' }]] },
    { tools: [['pwsh', { description: 'List files', command: 'Get-ChildItem -Name' }]] },
    { text: 'All done.' },
  ]);
  a.session.send({ text: 'edit please', uuid: 'ui-2' });
  let ask = await until(() => a.log.permissions[0]);
  check('a write asks first in the default mode', ask?.toolName === 'Write' && ask.input.file_path === 'new.txt' && Boolean(ask.toolUseID), JSON.stringify(ask));
  check('nothing was written before the answer', !fs.existsSync(path.join(project, 'new.txt')));
  a.session.answerPermission(ask.requestId, { behavior: 'allow' });
  ask = await until(() => a.log.permissions[1]);
  check('so does an edit, separately', ask?.toolName === 'Edit');
  a.session.answerPermission(ask.requestId, { behavior: 'allow', updatedPermissions: ask.suggestions });
  ask = await until(() => a.log.permissions[2]);
  check('reading doesn’t ask; a command does', ask?.toolName === 'Bash' && ask.input.command === 'Get-ChildItem -Name', JSON.stringify(ask));
  a.session.answerPermission(ask.requestId, { behavior: 'allow' });
  await finished(a.log, 2);
  check('the turn ran to its end', results(a.log)[1]?.subtype === 'success');
  check('the file was written', fs.readFileSync(path.join(project, 'new.txt'), 'utf8') === 'one\ntwo\n');
  const edit = toolResult(a.log, 'toolu_3_0') || a.log.messages.find((m) => m.tool_use_result?.diffs);
  check('an edit carries its diff', edit?.tool_use_result?.diffs?.[0]?.newText?.includes('GAMMA'), JSON.stringify(edit?.tool_use_result));
  console.log(`      (diff text: ${JSON.stringify(edit?.tool_use_result?.diffs?.[0]).slice(0, 200)})`);
  const read = a.log.messages.find((m) => m.tool_use_result?.file);
  check('a read gives the file without its numbering', read?.tool_use_result.file.content === 'alpha\nbeta\nGAMMA\ndelta', JSON.stringify(read?.tool_use_result));
  const bash = a.log.messages.filter((m) => m.type === 'user').pop();
  check('a command gives its output', /notes\.txt/.test(JSON.stringify(bash?.message.content)), JSON.stringify(bash?.message.content).slice(0, 300));

  // "Allow and don't ask again" lasts for the session, for that tool.
  const before = a.log.permissions.length;
  scripts.set('again', [{ tools: [['edit', { file_path: 'notes.txt', old_string: 'alpha', new_string: 'ALPHA' }]] }, { text: 'ok' }]);
  a.session.send({ text: 'again', uuid: 'ui-3' });
  await finished(a.log, 3);
  check('an always-allowed tool no longer asks', a.log.permissions.length === before && fs.readFileSync(path.join(project, 'notes.txt'), 'utf8').startsWith('ALPHA'));

  // ---------- denying ----------
  scripts.set('forbidden', [{ tools: [['write', { file_path: 'no.txt', content: 'x' }]] }, { text: 'Understood.' }]);
  a.session.send({ text: 'forbidden', uuid: 'ui-4' });
  ask = await until(() => a.log.permissions[before]);
  a.session.answerPermission(ask.requestId, { behavior: 'deny', message: 'The user declined this action.' });
  await finished(a.log, 4);
  const denied = a.log.messages.filter((m) => m.type === 'user' && m.message.content?.[0]?.tool_use_id === ask.toolUseID).pop();
  check('a denied tool reports an error and doesn’t run', denied?.message.content[0].is_error && !fs.existsSync(path.join(project, 'no.txt')), JSON.stringify(denied?.message.content));

  // ---------- modes ----------
  await a.session.control('mode', 'acceptEdits');
  const asked = a.log.permissions.length;
  scripts.set('accepted', [{ tools: [['write', { file_path: 'accepted.txt', content: 'x' }]] }, { tools: [['write', { file_path: path.join(scratch, 'outside.txt'), content: 'x' }]] }, { text: 'ok' }]);
  a.session.send({ text: 'accepted', uuid: 'ui-5' });
  ask = await until(() => a.log.permissions[asked]);
  check('accept edits writes inside the folder without asking', fs.existsSync(path.join(project, 'accepted.txt')));
  check('and asks outside it', ask?.toolName === 'Write' && /outside\.txt/.test(ask.input.file_path), JSON.stringify(ask));
  a.session.answerPermission(ask.requestId, { behavior: 'allow' });
  await finished(a.log, 5);
  await a.session.control('mode', 'bypassPermissions');
  const asked2 = a.log.permissions.length;
  scripts.set('bypassed', [{ tools: [['pwsh', { description: 'x', command: "Set-Content -Path bypass.txt -Value hi" }]] }, { text: 'ok' }]);
  a.session.send({ text: 'bypassed', uuid: 'ui-6' });
  await finished(a.log, 6);
  check('bypass runs commands without asking', a.log.permissions.length === asked2 && fs.existsSync(path.join(project, 'bypass.txt')));

  // ---------- questions ----------
  await a.session.control('mode', 'default');
  const asked3 = a.log.permissions.length;
  scripts.set('choose', [{ tools: [['ask_user_question', { questions: [{ id: 'q1', header: 'Storage', question: 'Where?', options: [{ label: 'Memory', description: 'fast' }, { label: 'Redis' }] }] }]] }, { text: 'Thanks.' }]);
  a.session.send({ text: 'choose', uuid: 'ui-7' });
  ask = await until(() => a.log.permissions[asked3]);
  check('a question reaches the chat as a question', ask?.toolName === 'AskUserQuestion' && ask.input.questions[0].options.length === 2 && Boolean(ask.toolUseID), JSON.stringify(ask));
  a.session.answerPermission(ask.requestId, { behavior: 'allow', updatedInput: { answers: { 'Where?': 'Redis, my own thing' } } });
  await finished(a.log, 7);
  const answered = a.log.messages.find((m) => m.tool_use_result?.answers);
  check('the answer goes back, labels and typed text', answered?.tool_use_result.answers['Where?'] === 'Redis, my own thing', JSON.stringify(answered?.tool_use_result));

  // ---------- plan mode ----------
  await a.session.control('mode', 'plan');
  const asked4 = a.log.permissions.length;
  scripts.set('make a plan', [
    { tools: [['write', { file_path: 'planned.txt', content: 'x' }]] },
    { tools: [['exit_plan_mode', { plan: '# The plan\nDo it.' }]] },
    { text: 'Carrying out the plan.' },
  ]);
  a.session.send({ text: 'make a plan', uuid: 'ui-8' });
  ask = await until(() => a.log.permissions[asked4]);
  check('plan mode doesn’t let files change', !fs.existsSync(path.join(project, 'planned.txt')));
  check('a finished plan asks for approval', ask?.toolName === 'ExitPlanMode' && /# The plan/.test(ask.input.plan), JSON.stringify(ask));
  a.session.answerPermission(ask.requestId, { behavior: 'allow' });
  await finished(a.log, 8);
  check('approving leaves plan mode', a.log.messages.some((m) => m.subtype === 'status' && m.permissionMode === 'default') && a.session.mode === 'default', a.session.mode);

  // ---------- stop ----------
  scripts.set('long one', [{ text: 'word '.repeat(50), slow: 150 }]);
  a.session.send({ text: 'long one', uuid: 'ui-9' });
  await until(() => a.log.messages.some((m) => m.event?.delta?.text?.startsWith('word')));
  const stopped = await a.session.control('interrupt');
  await finished(a.log, 9);
  check('Stop ends the turn as interrupted', stopped.ok && results(a.log)[8]?.subtype === 'error_during_execution', JSON.stringify(results(a.log)[8]));

  // ---------- model ----------
  await a.session.control('model', 'deepseek-v4-pro');
  await a.session.control('effort', 'max');
  scripts.set('pro please', [{ text: 'On pro.' }]);
  a.session.send({ text: 'pro please', uuid: 'ui-10' });
  await finished(a.log, 10);
  const lastPost = api.requests.filter((r) => r.method === 'POST').pop();
  check('a chosen model and effort reach the API', lastPost.body.model === 'deepseek-v4-pro' && lastPost.body.output_config?.effort === 'max', JSON.stringify({ model: lastPost.body.model, c: lastPost.body.output_config }));

  // ---------- undoing file changes ----------
  fs.writeFileSync(path.join(project, 'undo.txt'), 'before\n');
  await a.session.control('mode', 'bypassPermissions');
  scripts.set('change undo', [{ tools: [['edit', { file_path: 'undo.txt', old_string: 'before', new_string: 'after' }]] }, { tools: [['write', { file_path: 'created.txt', content: 'new' }]] }, { text: 'ok' }]);
  a.session.send({ text: 'change undo', uuid: 'ui-11' });
  await finished(a.log, 11);
  const dry = await a.session.control('rewind', { uuid: 'ui-11', dryRun: true });
  check('undo reports what it would change', dry.ok && dry.value.canRewind && dry.value.filesChanged.length === 2 && fs.readFileSync(path.join(project, 'undo.txt'), 'utf8').startsWith('after'), JSON.stringify(dry));
  const undone = await a.session.control('rewind', { uuid: 'ui-11' });
  check('undo puts files back, and removes what was new', undone.ok && fs.readFileSync(path.join(project, 'undo.txt'), 'utf8') === 'before\n' && !fs.existsSync(path.join(project, 'created.txt')), JSON.stringify(undone));

  // ---------- subagents ----------
  scripts.set('send an agent', [
    { tools: [['subagent', { description: 'Look around', prompt: 'List the files.' }]] },
    { text: 'Started it.' },
  ]);
  a.session.send({ text: 'send an agent', uuid: 'ui-12' });
  const taskStart = await until(() => a.log.messages.find((m) => m.subtype === 'task_started'));
  check('a subagent shows as a background task of its call', taskStart?.tool_use_id === 'toolu_' + taskStart?.tool_use_id?.split('_')[1] + '_0' && taskStart.description === 'Look around', JSON.stringify(taskStart));
  const taskEnd = await until(() => a.log.messages.find((m) => m.subtype === 'task_notification'));
  check('and reports how it ended', taskEnd?.status === 'completed', JSON.stringify(taskEnd));
  check('its steps nest under the call', a.log.messages.some((m) => m.parent_tool_use_id === taskStart?.tool_use_id && m.type === 'assistant'));
  await until(() => a.session.waiting.length === 0 && results(a.log).length >= 12);
  await wait(1000);

  // ---------- compacting ----------
  const beforeCompact = results(a.log).length;
  a.session.send({ text: '/compact', uuid: 'ui-13' });
  await finished(a.log, beforeCompact + 1);
  check('/compact ends with a result too', results(a.log).length > beforeCompact, JSON.stringify(results(a.log).at(-1)));

  // ---------- a command dsh refuses, and one it answers ----------
  const beforeGoal = results(a.log).length;
  a.session.send({ text: '/goal resume', uuid: 'ui-g1' });
  await finished(a.log, beforeGoal + 1);
  const goalRefused = results(a.log).at(-1);
  check('a command dsh refuses says why', goalRefused?.subtype === 'error' && /goal/i.test(JSON.stringify(goalRefused.errors)), JSON.stringify(goalRefused));
  check('and the message stops showing as waiting', a.log.messages.some((m) => m.user_message_uuid === 'ui-g1'));
  a.session.send({ text: '/goal', uuid: 'ui-g2' });
  await finished(a.log, beforeGoal + 2);
  const usage = a.log.messages.filter((m) => m.subtype === 'local_command_output').at(-1);
  check('a command’s answer is shown', Boolean(usage?.content?.trim()), JSON.stringify(results(a.log).at(-1)));

  // ---------- saved conversations ----------
  const sessionId = a.session.sessionId;
  await a.session.flushLog();
  const listed = listDshHistory(install.home, project);
  check('the conversation is listed for its folder', listed.some((h) => h.sessionId === sessionId && h.firstPrompt === 'hello'), JSON.stringify(listed));
  check('not for another folder', listDshHistory(install.home, scratch).length === 0);
  const history = loadDshHistory(install.home, sessionId);
  const firstUser = history.find((m) => m.type === 'user');
  check('it reads back as messages', firstUser?.message.content.some((b) => b.text === 'hello') && Boolean(firstUser.at) && history.some((m) => m.type === 'assistant' && m.message.content.some((b) => b.type === 'tool_use' && b.name === 'Edit')), JSON.stringify(firstUser));

  // A copy up to a message, then continued.
  const secondId = history.filter((m) => m.type === 'user' && Array.isArray(m.message.content) && m.message.content.some((b) => b.type === 'text'))[1].uuid;
  const fork = forkDshSession(install.home, sessionId, secondId);
  check('a fork is a new conversation', /^dsh-/.test(fork.sessionId) && fork.sessionId !== sessionId);
  check('forking at the first message has nothing to copy', forkDshSession(install.home, sessionId, firstUser.uuid).sessionId === null);
  check('the commands you ran read back as yours', history.some((m) => m.type === 'user' && m.message.content === '/goal resume' && /^cmd-/.test(m.uuid)));
  let commandFork = null;
  try { commandFork = forkDshSession(install.home, sessionId, 'ui-g1'); } catch (err) { commandFork = { error: err.message }; }
  check('edit and resend works at a command too', /^dsh-/.test(commandFork?.sessionId || ''), JSON.stringify(commandFork));
  const forkHistory = loadDshHistory(install.home, fork.sessionId);
  check('the fork holds what came before', forkHistory.filter((m) => m.type === 'user' && Array.isArray(m.message.content) && m.message.content.some((b) => b.type === 'text')).length === 1);
  const b = await open({ resume: fork.sessionId, permissionMode: 'default' });
  scripts.set('continue the fork', [{ text: 'Forked and fine.' }]);
  b.session.send({ text: 'continue the fork', uuid: 'ui-f1' });
  await finished(b.log, 1);
  check('and continues from there', results(b.log)[0]?.subtype === 'success' && b.log.messages.some((m) => m.event?.delta?.text === 'Forked and fine.'), JSON.stringify(results(b.log)[0]));
  const sent = api.requests.filter((r) => r.method === 'POST').pop().body;
  check('with only the kept history going to the API', /hello/.test(JSON.stringify(sent.messages)) && !/edit please/.test(JSON.stringify(sent.messages)));
  manager.close(b.id);
  await until(() => b.log.exit);

  // ---------- resuming after a restart ----------
  manager.close(a.id);
  await until(() => a.log.exit);
  check('closing ends without an error', a.log.exit && !a.log.exit.error, JSON.stringify(a.log.exit));
  const c = await open({ resume: sessionId, permissionMode: 'default' });
  const resumedContext = await c.session.control('context');
  check('a resumed conversation knows its context', resumedContext.value.totalTokens > 0);
  scripts.set('back again', [{ text: 'Welcome back.' }]);
  c.session.send({ text: 'back again', uuid: 'ui-r1' });
  await finished(c.log, 1);
  check('it continues after a restart', results(c.log)[0]?.subtype === 'success');
  const resent = api.requests.filter((r) => r.method === 'POST').pop().body;
  // Compacted earlier: what came before is the summary, not the words.
  check('with its history', resent.messages.length > 2 && /back again/.test(JSON.stringify(resent.messages)), `${resent.messages.length} messages`);
  manager.close(c.id);
  await until(() => c.log.exit);

  // ---------- a custom provider: an OpenAI-compatible relay with its own key ----------
  const relay = await fakeDeepSeek(answer, { key: 'sk-relay-fake', models: [{ id: 'relay-model', context_length: 64000 }] });
  const providers = {
    dshProviders: [{
      id: 'custom-relay', name: 'Relay', api: 'openai-completions', baseURL: `${relay.url}/v1`,
      models: [{ id: 'relay-model', name: 'Relay Model', contextWindow: 64000, reasoning: { off: null, high: 'high' } }],
    }],
  };
  const e = await open({ providers, keys: { 'custom-relay': 'sk-relay-fake' }, model: 'custom-relay::relay-model', permissionMode: 'default' });
  const offered = e.log.meta?.models || [];
  check('a custom provider’s models are offered beside DeepSeek’s', offered.some((m) => m.value === 'custom-relay::relay-model' && m.description === 'Relay' && m.supportedEffortLevels.join() === 'off,high')
    && offered.some((m) => m.value === 'deepseek-flash'), JSON.stringify(offered.map((m) => m.value)));
  scripts.set('relay hello', [{ think: 'Relaying.', text: 'Hello from the relay.' }]);
  e.session.send({ text: 'relay hello', uuid: 'ui-c1' });
  await finished(e.log, 1);
  const relayed = () => relay.requests.filter((r) => r.method === 'POST');
  check('a chat on it goes to its address, in its protocol', relayed().length >= 1 && /\/v1\/chat\/completions$/.test(relayed()[0].url) && relayed()[0].body.model === 'relay-model', JSON.stringify(relayed().map((r) => r.url)));
  check('with its key, as a bearer token', relayed()[0]?.keyMatches && relayed()[0].bearer);
  check('and its answer streams back, thinking too', e.log.messages.some((m) => m.event?.delta?.text?.includes('Hello')) && e.log.messages.some((m) => m.event?.delta?.thinking === 'Relaying.')
    && results(e.log)[0]?.subtype === 'success', JSON.stringify(results(e.log)[0]));
  scripts.set('relay write', [{ tools: [['write', { file_path: 'relay.txt', content: 'r\n' }]] }, { text: 'Written.' }]);
  e.session.send({ text: 'relay write', uuid: 'ui-c2' });
  ask = await until(() => e.log.permissions[0]);
  check('its tool calls ask first too', ask?.toolName === 'Write', JSON.stringify(ask));
  if (ask) e.session.answerPermission(ask.requestId, { behavior: 'allow' });
  await finished(e.log, 2);
  check('and run', fs.existsSync(path.join(project, 'relay.txt')));
  await e.session.control('effort', 'high');
  scripts.set('relay think hard', [{ text: 'Thought hard.' }]);
  e.session.send({ text: 'relay think hard', uuid: 'ui-c3' });
  await finished(e.log, 3);
  const hard = relayed().at(-1).body;
  check('its reasoning level is sent as declared', /"high"/.test(JSON.stringify({ r: hard.reasoning_effort, t: hard.thinking, x: hard.reasoning })), JSON.stringify({ r: hard.reasoning_effort, t: hard.thinking, x: hard.reasoning }));
  check('a level the model doesn’t declare is refused', !(await e.session.control('effort', 'max')).ok);
  const deepseekBefore = api.requests.filter((r) => r.method === 'POST').length;
  await e.session.control('model', 'deepseek-flash');
  scripts.set('back to deepseek', [{ text: 'DeepSeek here.' }]);
  e.session.send({ text: 'back to deepseek', uuid: 'ui-c4' });
  await finished(e.log, 4);
  const toDeepseek = api.requests.filter((r) => r.method === 'POST').slice(deepseekBefore);
  check('switching to DeepSeek mid-conversation goes to DeepSeek', toDeepseek.length === 1 && toDeepseek[0].body.model === 'deepseek-flash' && /relay hello/.test(JSON.stringify(toDeepseek[0].body.messages)),
    JSON.stringify(toDeepseek.map((r) => r.url)));
  check('a model of no provider is refused', !(await e.session.control('model', 'custom-gone::x')).ok);
  manager.close(e.id);
  await until(() => e.log.exit);
  relay.close();

  // ---------- a refused key ----------
  scripts.set('refuse', [{ fail: 401, message: 'Authentication Fails' }, { fail: 401, message: 'Authentication Fails' }, { fail: 401, message: 'Authentication Fails' }, { fail: 401, message: 'Authentication Fails' }]);
  const d = await open({ permissionMode: 'default' });
  d.session.send({ text: 'refuse', uuid: 'ui-e1' });
  await finished(d.log, 1);
  const refused = results(d.log)[0];
  check('an API error ends the turn with its reason', refused?.subtype === 'error' && /auth/i.test(JSON.stringify(refused.errors)), JSON.stringify(refused));
  manager.close(d.id);
  await until(() => d.log.exit);
  api.close();
}
