// Chat sessions on DeepSeek Harness (Settings → DeepSeek Harness): one dsh process per chat, its SDK profile spoken to
// over JSON-RPC, with ccUI's plugin inside it (dsh-bridge.mjs). A session here has the same methods as an AgentSession
// and emits the same messages (dsh-translate.js), so the window treats both alike. Conversations are dsh's own session
// logs, read directly; their ids start with `dsh-`, which is how the app tells whose a conversation is.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { spawn, execFile } = require('child_process');
const { randomUUID } = require('crypto');
const { pathToFileURL } = require('url');
const { shellEnvReady, childEnv } = require('./shell-env');
const { slim } = require('./agent');
const { DshTranslator, replayEvents, toolName, askedQuestions } = require('./dsh-translate');
const { PRESET_TABLE, DSH_VERSION } = require('./dsh-install');
const { catalog, parseModel, patchEntries } = require('./dsh-catalog.mjs');
const { t } = require('./i18n');

const isDshSession = (id) => /^dsh-/.test(id || '');
const START_TIMEOUT = 120 * 1000; // a first start in a large folder, or under a virus scan, can take a while

// The model menu's entries for the providers in `providers` ({ dshOfficial, dshProviders }, from the settings).
function modelsFor(providers) {
  return catalog(providers).map((m) => ({
    value: m.value, displayName: m.name, description: m.providerName, resolvedModel: m.value,
    supportsEffort: m.efforts.length > 0, supportedEffortLevels: m.efforts, supportsAutoMode: false,
  }));
}
// With DeepSeek's own models only, as before any provider was added (the checks' fake sessions show these).
const MODELS = modelsFor({});
const COMMANDS = [
  { name: 'compact', description: 'Summarize the conversation to free up context', argumentHint: '' },
  { name: 'goal', description: 'Set a goal the agent keeps working toward', argumentHint: '[goal]' },
];
// A line starting with / goes to session/query: dsh runs its own commands (/compact, /goal, /plan…) and takes any other
// line as a prompt.
const COMMAND_LINE = /^\//;

// The patch dsh starts with, one entry per line (JSON is YAML too). Off: uploading the session log with official API
// requests (dsh's default, which this app's privacy promise rules out). The model providers come from Settings; their
// keys stay out of the file, in the environment variables `keyEnv` names. `CCUI_DSH_BASE_URL`: the checks' stand-in
// for DeepSeek's API.
function writePatch(install, providers, keyEnv) {
  const entries = [
    { id: 'session-log-deepseek', config: { enabled: false } },
    ...patchEntries(providers, keyEnv),
    { id: 'permission', config: { presets: PRESET_TABLE } },
    { insert: [{ id: 'ccui-bridge', name: pathToFileURL(install.bridge).href, inject: ['agents', 'permissionPresets'] }] },
  ];
  if (process.env.CCUI_DSH_BASE_URL) entries[1].config.baseURL = process.env.CCUI_DSH_BASE_URL;
  fs.writeFileSync(install.patch, `${entries.map((e) => `- ${JSON.stringify(e)}`).join('\n')}\n`);
}

class DshSession {
  constructor(id, opts, emit) {
    this.id = id;
    this.opts = opts;
    this.emit = emit;
    this.sessionId = opts.resume || `dsh-${randomUUID()}`;
    this.tr = new DshTranslator(this.sessionId);
    // `providers`: the model providers from Settings; `keys`: their API keys, by provider id.
    this.models = modelsFor(opts.providers || {});
    this.model = this.models.some((m) => m.value === opts.model) ? opts.model : this.models[0].value;
    this.effort = this.levels().includes(opts.effort) ? opts.effort : '';
    this.mode = opts.permissionMode || 'default';
    this.beforePlan = 'default';
    this.planActive = false;
    this.closed = false;
    this.exists = Boolean(opts.resume); // dsh has this conversation (it is made by the first message)
    this.inited = false;
    this.batch = [];
    this.flushTimer = null;
    this.stderr = '';
    this.nextRpc = 1;
    this.rpcs = new Map();
    this.nextCmd = 1;
    this.cmds = new Map();
    this.pending = new Map(); // ccUI's permission request id -> how to answer dsh
    this.waiting = []; // messages sent, not yet taken up by dsh: [{ uuid, messageId }]
    this.seen = new Set(); // dsh message ids that have started, in case the event beats the answer to session/prompt
    this.userIds = []; // the conversation's messages, in order (undoing file changes)
    this.openQuestions = []; // ask_user_question calls not answered yet
    this.sending = Promise.resolve();
  }

  async start() {
    await shellEnvReady;
    if (this.closed) return { ok: false, code: 'closed', error: t('Session closed.') };
    const { cwd, install, apiKey, keys = {} } = this.opts;
    const keyEnv = (id) => (keys[id] ? `CCUI_DSH_KEY_${Object.keys(keys).indexOf(id)}` : '');
    writePatch(install, this.opts.providers || {}, keyEnv);
    if (this.opts.resume) {
      // What the conversation has used so far, for the context ring and for undoing file changes.
      for (const e of readEvents(findSession(install.home, this.sessionId)?.file)) {
        this.tr.event(this.sessionId, e);
        if (e.type === 'user/message' && e.data?.source?.kind === 'user') this.userIds.push(e.data.id);
        else if (e.type === 'command/run' && e.data?.source?.kind === 'user') this.userIds.push(e.data.commandId);
        if (e.type === 'plan/mode') this.planActive = Boolean(e.data?.active);
      }
    }
    this.child = spawn(install.node, [install.bin, '--profile', 'sdk', '--patch', install.patch], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: childEnv({
        ...this.opts.env,
        DSH_HOME: install.home,
        DEEPSEEK_API_KEY: apiKey || '',
        ...Object.fromEntries(Object.entries(keys).map(([id, key]) => [keyEnv(id), key])),
        DSH_TELEMETRY_DISABLED: '1', // dsh's telemetry stays off, as the app's privacy promise says
        CCUI_DSH_SESSION: this.sessionId,
        CCUI_DSH_MODE: this.mode,
        CCUI_DSH_CHECKPOINTS: install.checkpoints,
        NODE_OPTIONS: '',
      }),
    });
    const ready = new Promise((resolve) => { this.onReady = resolve; });
    const exited = new Promise((_resolve, reject) => {
      this.child.once('error', reject);
      this.child.once('exit', () => reject(new Error(this.stderr.trim().split('\n').slice(-3).join('\n') || t('DeepSeek Harness stopped while it was starting.'))));
    });
    this.child.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-4000); });
    readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', (line) => this.onLine(line));
    this.child.stdin.on('error', () => {});
    this.child.stdio[3].on('error', () => {});
    this.child.once('exit', () => this.onExit());

    const timedOut = new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error(t('DeepSeek Harness took too long to start.'))), START_TIMEOUT).unref?.();
    });
    await Promise.race([
      (async () => {
        await this.rpc('initialize', {
          cwd, ...parseModel(this.model), ...(this.effort ? { reasoningEffort: this.effort } : {}), approvalRequests: true, capabilities: { userQuestions: true },
        });
        await ready;
        if (this.opts.resume) await this.rpc('session/resume', { sessionId: this.sessionId });
      })(),
      exited,
      timedOut,
    ]);
    exited.catch(() => {});
    this.emit('agent:meta', this.id, { commands: COMMANDS, models: this.models });
    return { ok: true, account: { provider: 'deepseek' } };
  }

  // ---------- from dsh ----------
  onLine(line) {
    let m = null;
    try { m = JSON.parse(line); } catch { return; } // dsh's own logging
    if (m.method && m.id != null) this.onRequest(m);
    else if (m.id != null) {
      const rpc = this.rpcs.get(m.id);
      this.rpcs.delete(m.id);
      if (m.error) rpc?.reject(new Error(m.error.message || JSON.stringify(m.error)));
      else rpc?.resolve(m.result);
    } else this.onNotice(m.method, m.params || {});
  }

  onNotice(method, p) {
    switch (method) {
      case 'ccui.ready': this.onReady?.(); return;
      case 'ccui.reply': {
        const cmd = this.cmds.get(p.id);
        this.cmds.delete(p.id);
        if (p.ok) cmd?.resolve(p.value);
        else cmd?.reject(new Error(p.error));
        return;
      }
      case 'ccui.stream': this.push(this.tr.frame(p)); return;
      case 'session.event': this.onEvent(p.sessionId, p.event); return;
      case 'session.status':
        if (p.sessionId !== this.sessionId) return;
        if (p.status === 'idle') {
          this.dropPending();
          this.push([{ type: 'system', subtype: 'session_state_changed', state: 'idle', session_id: this.sessionId, uuid: randomUUID() }]);
        }
        return;
      case 'subagent.started': this.push(this.tr.subagentStarted(p)); return;
      case 'subagent.finished': this.push(this.tr.subagentFinished(p)); return;
      case 'user-question.cancelled':
        for (const [requestId, q] of this.pending) {
          if (q.dshId === p.requestId) {
            this.pending.delete(requestId);
            this.emit('agent:permission-cancel', this.id, requestId);
          }
        }
        return;
      default:
    }
  }

  onEvent(sessionId, e) {
    if (!e) return;
    if (sessionId === this.sessionId) {
      if (e.type === 'user/message' && e.data?.source?.kind === 'user') this.tookUp(e.data.id);
      else if (e.type === 'command/run' && e.data?.source?.kind === 'user') this.userIds.push(e.data.commandId);
      else if (e.type === 'plan/mode') this.onPlanMode(Boolean(e.data?.active));
      else if (e.type === 'session/title') this.title = e.data?.title;
    }
    if (e.type === 'assistant/message') {
      for (const b of e.data?.message?.content || []) {
        if (b.type === 'tool-call' && b.name === 'ask_user_question') this.openQuestions.push(b.id);
      }
    }
    this.push(this.tr.event(sessionId, e));
  }

  // A message's turn has begun: it stops showing as queued, and file copies from now on belong to it.
  tookUp(messageId) {
    this.userIds.push(messageId);
    this.seen.add(messageId);
    const at = this.waiting.findIndex((w) => w.messageId === messageId);
    if (at >= 0) {
      const [{ uuid }] = this.waiting.splice(at, 1);
      this.push([{ type: 'system', subtype: 'status', status: 'requesting', user_message_uuid: uuid, session_id: this.sessionId, uuid: randomUUID() }]);
    }
  }

  // dsh left plan mode by itself: the plan was approved.
  onPlanMode(active) {
    const was = this.planActive;
    this.planActive = active;
    if (active === was) return;
    this.setGate(active ? 'plan' : this.beforePlan);
    this.push([{ type: 'system', subtype: 'status', status: null, permissionMode: this.mode, session_id: this.sessionId, uuid: randomUUID() }]);
  }

  setGate(mode) {
    this.mode = mode;
    this.command('mode', { value: mode }).catch(() => {});
  }

  // Questions dsh asks the host: a tool that needs approval, a question for the user, a plan to review.
  onRequest(m) {
    const answer = (result) => { try { this.write({ jsonrpc: '2.0', id: m.id, result }); } catch { /* gone */ } };
    this.flush(); // the tool's card must reach the chat before its question
    if (m.method === 'approval/request') this.askApproval(m.params || {}, answer);
    else if (m.method === 'user-question/ask') this.askUser(m.params || {}, answer);
    else this.write({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Unknown method ${m.method}` } });
  }

  askApproval(p, answer) {
    const requestId = randomUUID();
    const call = this.tr.calls.get(p.callId);
    const raw = call?.name || p.toolName;
    const input = (call && this.tr.inputOf(p.callId)) || {};
    // dsh's own reasons are for commands leaving the sandbox; the gate's are only a label.
    const own = /^ccUI asks before /.test(p.reason || '');
    this.pending.set(requestId, { kind: 'approval', raw, answer });
    this.emit('agent:permission', this.id, {
      requestId,
      toolName: toolName(raw),
      input,
      toolUseID: p.callId,
      agentID: p.sessionId !== this.sessionId ? p.sessionId : undefined,
      description: input.description,
      decisionReason: own ? input.justification : (input.justification || p.reason),
      suggestions: [{ type: 'addRules', behavior: 'allow', destination: 'session', rules: [{ toolName: toolName(raw) }] }],
    });
  }

  askUser(p, answer) {
    const requestId = randomUUID();
    const questions = p.questions || [];
    const review = questions[0]?.intent?.kind === 'plan-review' ? questions[0] : null;
    if (review) {
      this.pending.set(requestId, { kind: 'plan', review, answer, dshId: p.requestId });
      this.emit('agent:permission', this.id, { requestId, toolName: 'ExitPlanMode', input: { plan: review.detail || '' }, toolUseID: review.intent.callId });
      return;
    }
    this.pending.set(requestId, { kind: 'question', questions, answer, dshId: p.requestId });
    this.emit('agent:permission', this.id, {
      requestId, toolName: 'AskUserQuestion', input: { questions: askedQuestions(questions) }, toolUseID: this.openQuestions.shift(),
    });
  }

  answerPermission(requestId, reply) {
    const p = this.pending.get(requestId);
    if (!p) return;
    this.pending.delete(requestId);
    const allow = reply.behavior === 'allow';
    if (p.kind === 'approval') {
      if (allow && reply.updatedPermissions?.some((u) => u.type === 'addRules')) this.command('allow', { tool: p.raw }).catch(() => {});
      p.answer({ outcome: allow ? 'allowed-once' : 'rejected' });
      // An approval has no room for words: what the user said instead follows as their next message.
      const said = /^The user declined and said: ([\s\S]*)$/.exec(reply.message || '')?.[1];
      if (!allow && said) this.prompt([{ type: 'text', text: said }]).catch(() => {});
    } else if (p.kind === 'plan') {
      const [approve, keep] = (p.review.options || []).map((o) => o.label);
      if (allow && reply.updatedPermissions?.some((u) => u.type === 'setMode')) this.beforePlan = 'acceptEdits';
      const feedback = /Feedback on the plan: ([\s\S]*)$/.exec(reply.message || '')?.[1];
      p.answer({ answers: [{ id: p.review.id, selected: [allow ? approve : keep], ...(feedback ? { custom: feedback } : {}) }] });
    } else if (allow) {
      const answers = reply.updatedInput?.answers || {};
      p.answer({
        answers: p.questions.map((q) => {
          const labels = (q.options || []).map((o) => o.label);
          // The card joins what was picked with ", "; anything that isn't one of the options is what was typed.
          const parts = String(answers[q.question] || '').split(', ');
          const selected = parts.filter((x) => labels.includes(x));
          const custom = parts.filter((x) => x && !labels.includes(x)).join(', ');
          return { id: q.id, selected, ...(custom ? { custom } : {}) };
        }),
      });
    } else p.answer({ cancelled: true });
  }

  // Nothing is left to ask about (the turn ended or was stopped).
  dropPending() {
    for (const [requestId, p] of this.pending) {
      p.answer(p.kind === 'approval' ? { outcome: 'cancelled' } : { cancelled: true });
      this.emit('agent:permission-cancel', this.id, requestId);
    }
    this.pending.clear();
  }

  push(messages) {
    if (!messages?.length) return;
    this.batch.push(...messages.map(slim));
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 16);
  }

  flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.batch.length) return;
    this.emit('agent:events', this.id, this.batch);
    this.batch = [];
  }

  onExit() {
    const error = this.closed ? null : (this.stderr.trim().split('\n').slice(-3).join('\n') || t('DeepSeek Harness stopped.'));
    this.flush();
    this.closed = true;
    for (const { reject } of [...this.rpcs.values(), ...this.cmds.values()]) reject(new Error(t('Session closed.')));
    this.rpcs.clear();
    this.cmds.clear();
    for (const requestId of this.pending.keys()) this.emit('agent:permission-cancel', this.id, requestId);
    this.pending.clear();
    this.emit('agent:exit', this.id, { error, stderr: error ? this.stderr : '' });
  }

  // ---------- to dsh ----------
  write(message) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.nextRpc++;
      this.rpcs.set(id, { resolve, reject });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  // A command for ccUI's plugin inside dsh.
  command(cmd, fields = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextCmd++;
      this.cmds.set(id, { resolve, reject });
      this.child.stdio[3].write(`${JSON.stringify({ id, cmd, ...fields })}\n`);
    });
  }

  prompt(contentBlocks) {
    return this.rpc('session/prompt', { sessionId: this.sessionId, contentBlocks });
  }

  // The first message tells the chat which conversation this is, as Claude Code's first message does.
  announce() {
    if (this.inited) return;
    this.inited = true;
    this.push([{
      type: 'system', subtype: 'init', session_id: this.sessionId, uuid: randomUUID(), cwd: this.opts.cwd, model: this.model, permissionMode: this.mode,
      tools: [], mcp_servers: [], slash_commands: COMMANDS.map((c) => c.name), terminal_slash_commands: [], claude_code_version: DSH_VERSION, apiKeySource: 'user',
    }]);
  }

  send({ text, images = [], uuid }) {
    this.announce();
    const blocks = images.map((img) => ({ type: 'image', data: img.data, mimeType: img.mediaType }));
    if (text) blocks.push({ type: 'text', text });
    // One at a time, in the order sent: session/query and session/prompt may otherwise overtake each other.
    this.sending = this.sending.then(async () => {
      if (this.closed) return;
      try {
        const line = (text || '').trim();
        const startPlan = this.mode === 'plan' && !this.planActive;
        if (COMMAND_LINE.test(line) && !startPlan) {
          const res = await this.rpc('session/query', { sessionId: this.sessionId, contentBlocks: blocks });
          this.exists = true;
          this.answered(uuid, res);
        } else if (startPlan) {
          // Plan mode chosen before the first message: /plan with a message makes it that message's mode.
          const planned = await this.rpc('session/query', { sessionId: this.sessionId, contentBlocks: [{ type: 'text', text: `/plan ${text || ''}`.trim() }, ...blocks.filter((b) => b.type === 'image')] });
          this.exists = true;
          this.answered(uuid, planned);
        } else {
          const res = await this.prompt(blocks);
          this.exists = true;
          this.note(uuid, res?.messageId);
        }
      } catch (err) {
        if (!this.closed) this.push([this.tr.stamp(this.sessionId, this.tr.turnResult({ kind: 'error', message: err.message }))]);
      }
    });
  }

  // What session/query did with a line: ran one of dsh's commands ({ kind: 'command', execution }), whose answer the
  // chat shows (a refusal as an error) and which ends there, unless it starts work of its own (a goal's rounds come as
  // turns of their own); or took it as a prompt ({ kind: 'prompt', messageId }), whose turn follows.
  answered(uuid, res) {
    if (res?.kind !== 'command') return this.note(uuid, res?.messageId);
    const { commandId, result = {} } = res.execution || {};
    if (uuid && commandId) messageIds.set(uuid, commandId);
    const stamp = (m) => this.tr.stamp(this.sessionId, m);
    const picked = { type: 'system', subtype: 'status', status: null, user_message_uuid: uuid, session_id: this.sessionId, uuid: randomUUID() };
    if (result.kind === 'error') {
      this.push([picked, stamp(this.tr.turnResult({ kind: 'error', message: result.text || t('DeepSeek Harness could not run this command.') }))]);
      return;
    }
    this.push([picked, ...(result.text ? [stamp({ type: 'system', subtype: 'local_command_output', content: result.text })] : []),
      stamp(this.tr.turnResult({ kind: 'completed' }))]);
  }

  note(uuid, messageId) {
    if (!uuid || !messageId) return;
    messageIds.set(uuid, messageId);
    if (this.seen.has(messageId)) this.push([{ type: 'system', subtype: 'status', status: 'requesting', user_message_uuid: uuid, session_id: this.sessionId, uuid: randomUUID() }]);
    else this.waiting.push({ uuid, messageId });
  }

  async control(action, arg) {
    try {
      switch (action) {
        case 'interrupt': {
          const cancelled = this.waiting.map((w) => w.uuid);
          this.waiting = [];
          await this.sending;
          await this.command('cancel');
          this.dropPending();
          return { ok: true, value: { cancelled } };
        }
        case 'stop-task':
          await this.command('stop-agent', { sessionId: arg });
          return { ok: true };
        case 'model':
          if (arg && arg !== 'default' && !this.models.some((m) => m.value === arg)) return { ok: false, error: t('There is no model {model} among the providers in Settings.', { model: arg }) };
          this.model = arg && arg !== 'default' ? arg : this.models[0].value;
          if (this.effort && !this.levels().includes(this.effort)) this.effort = ''; // the new model's default
          await this.selectModel();
          return { ok: true };
        case 'effort':
          if (arg && !this.levels().includes(arg)) return { ok: false, error: t('This model has no effort level {level}.', { level: arg }) };
          this.effort = arg || '';
          await this.selectModel();
          return { ok: true };
        case 'mode': return await this.switchMode(arg);
        case 'rewind': return { ok: true, value: rewindFiles(this.opts.install, this.userIds, messageIds.get(arg.uuid) || arg.uuid, Boolean(arg.dryRun)) };
        case 'context': return { ok: true, value: this.contextUsage() };
        case 'skills':
        case 'reload-skills': return { ok: true, value: await this.listSkills() };
        case 'skills-folder': {
          const dir = arg === 'user' ? path.join(this.opts.install.home, 'skills') : path.join(this.opts.cwd, '.dsh', 'skills');
          fs.mkdirSync(dir, { recursive: true });
          return { ok: true, value: dir };
        }
        case 'status': return { ok: true, value: this.status() };
        case 'export': return { ok: true, value: await this.exportText() };
        case 'memory': return { ok: true, value: this.memoryFiles() };
        case 'rename':
          if (typeof arg !== 'string' || !arg.trim()) return { ok: false, error: t('No name given.') };
          if (this.exists) await this.command('rename', { title: arg.trim() });
          return { ok: true };
        default: return { ok: false, error: t('DeepSeek Harness has no way to do this.') };
      }
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  selectModel() {
    return this.command('model', { ...parseModel(this.model), effort: this.effort });
  }

  // The current model's reasoning levels.
  levels() {
    return this.models.find((m) => m.value === this.model)?.supportedEffortLevels || [];
  }

  async switchMode(mode) {
    const wasPlan = this.mode === 'plan';
    if (mode !== 'plan') this.beforePlan = mode;
    else if (!wasPlan) this.beforePlan = this.mode;
    this.setGate(mode);
    if (!this.exists) return { ok: true }; // the first message starts it
    if (mode === 'plan' && !this.planActive) await this.rpc('session/query', { sessionId: this.sessionId, contentBlocks: [{ type: 'text', text: '/plan' }] });
    if (mode !== 'plan' && this.planActive) await this.rpc('session/query', { sessionId: this.sessionId, contentBlocks: [{ type: 'text', text: '/plan off' }] });
    return { ok: true };
  }

  contextUsage() {
    const { lastUsage: u, contextWindow, usage } = this.tr;
    const totalTokens = u ? (u.inputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0) + (u.outputTokens || 0) : 0;
    const maxTokens = contextWindow || 1048576;
    return {
      totalTokens,
      maxTokens,
      percentage: (totalTokens / maxTokens) * 100,
      categories: [
        { name: 'Messages', tokens: totalTokens, kind: 'used' },
        { name: 'Free space', tokens: Math.max(0, maxTokens - totalTokens), kind: 'free' },
      ],
      sessionTokens: usage,
    };
  }

  async listSkills() {
    const found = await this.command('skills');
    const home = path.resolve(this.opts.install.home);
    const cwd = path.resolve(this.opts.cwd);
    const source = (dir) => (!dir ? 'built-in' : path.resolve(dir).startsWith(cwd) ? 'projectSettings' : path.resolve(dir).startsWith(home) ? 'userSettings' : 'userSettings');
    return {
      skills: (found || []).map((x) => ({ name: x.name, description: x.description, argumentHint: '', source: source(x.dir), tokens: 0, dir: x.dir, state: 'on', fixed: true })),
      folders: { user: path.join(home, 'skills'), project: path.join(cwd, '.dsh', 'skills') },
      readOnly: true,
    };
  }

  status() {
    const { install, cwd } = this.opts;
    return {
      sections: [{
        title: 'DeepSeek Harness',
        rows: [
          { label: t('Version'), value: DSH_VERSION },
          { label: t('Model'), value: this.model },
          { label: t('Effort'), value: this.effort || t('Auto') },
          { label: t('Conversation ID'), value: this.sessionId },
          { label: 'cwd', value: cwd },
          { label: t('Data folder'), value: install.home },
        ],
      }],
    };
  }

  async exportText() {
    await this.command('flush').catch(() => {});
    const events = readEvents(findSession(this.opts.install.home, this.sessionId)?.file);
    const lines = [];
    for (const m of replayEvents(this.sessionId, events)) {
      for (const b of Array.isArray(m.message?.content) ? m.message.content : []) {
        if (b.type === 'text') lines.push(`${m.type === 'user' ? '> ' : ''}${b.text}\n`);
        else if (b.type === 'tool_use') lines.push(`[${b.name}] ${b.input?.file_path || b.input?.command || b.input?.pattern || ''}\n`);
      }
    }
    return { text: lines.join('\n'), default_filename: `${this.sessionId}.txt` };
  }

  // dsh reads AGENTS.md and CLAUDE.md, in the project and in its own folder.
  memoryFiles() {
    const { cwd, install } = this.opts;
    const file = (full, label) => ({ kind: 'file', path: full, label, exists: fs.existsSync(full) });
    return { files: [file(path.join(cwd, 'AGENTS.md'), 'AGENTS.md'), file(path.join(cwd, 'CLAUDE.md'), 'CLAUDE.md'), file(path.join(install.home, 'AGENTS.md'), t('Yours (all projects)'))], folders: [] };
  }

  // Written out before anything reads the session's log (forking from it).
  async flushLog() {
    await this.command('flush').catch(() => {});
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    const child = this.child;
    if (!child) return;
    this.flush();
    try { this.write({ jsonrpc: '2.0', id: this.nextRpc++, method: 'shutdown' }); } catch { /* gone */ }
    // dsh ends its own commands on shutdown; one that doesn't is ended with everything it started.
    const timer = setTimeout(() => {
      if (child.exitCode != null) return;
      if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
      else child.kill('SIGKILL');
    }, 3000);
    child.once('exit', () => clearTimeout(timer));
  }
}

// ccUI's id of a message sent in this run -> dsh's. A conversation read back from disk uses dsh's ids directly.
const messageIds = new Map();

// ---------- conversations on disk ----------
const ZSTD_MAGIC = 0xfd2fb528;

// Where each Zstandard frame of a session log ends: dsh appends one per write, and Node's decoder stops after one.
function zstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 5 <= buffer.length && buffer.readUInt32LE(offset) === ZSTD_MAGIC) {
    const start = offset;
    const descriptor = buffer[offset + 4];
    offset += 5;
    const sizeFlag = descriptor >>> 6;
    const single = (descriptor & 32) !== 0;
    const dictionary = [0, 1, 2, 4][descriptor & 3];
    offset += (single ? 0 : 1) + dictionary + (sizeFlag === 0 ? (single ? 1 : 0) : 1 << sizeFlag);
    let last = false;
    while (!last) {
      if (offset + 3 > buffer.length) return frames; // cut off while it was written
      const header = buffer.readUIntLE(offset, 3);
      last = (header & 1) !== 0;
      const type = (header >>> 1) & 3;
      offset += 3 + (type === 1 ? 1 : header >>> 3);
    }
    if (descriptor & 4) offset += 4; // the frame's checksum
    if (offset > buffer.length) return frames;
    frames.push(buffer.subarray(start, offset));
  }
  return frames;
}

const logCache = new Map(); // file -> { mtimeMs, size, lines }

function readLog(file) {
  if (!file) return [];
  let stat = null;
  try { stat = fs.statSync(file); } catch { return []; }
  const cached = logCache.get(file);
  if (cached?.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.lines;
  const text = zstdFrames(fs.readFileSync(file)).map((f) => zlib.zstdDecompressSync(f).toString('utf8')).join('');
  const lines = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { lines.push(JSON.parse(line)); } catch { /* a line cut off while it was written */ }
  }
  if (logCache.size > 200) logCache.clear();
  logCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, lines });
  return lines;
}

const readEvents = (file) => readLog(file).filter((l) => l.type !== 'session' && l.seq != null);
const LOG_NAME = 'session.v4.jsonl.zstd';

// { dir, file } of a conversation, under whichever workspace folder dsh filed it.
function findSession(home, sessionId) {
  const base = path.join(home, 'sessions');
  let spaces = [];
  try { spaces = fs.readdirSync(base); } catch { return null; }
  for (const space of spaces) {
    const file = path.join(base, space, sessionId, LOG_NAME);
    if (fs.existsSync(file)) return { dir: path.join(base, space), file };
  }
  return null;
}

const samePath = (a, b) => {
  const norm = (p) => path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
};

function listDshHistory(home, cwd) {
  const base = path.join(home, 'sessions');
  const all = [];
  let spaces = [];
  try { spaces = fs.readdirSync(base); } catch { return []; }
  for (const space of spaces) {
    let ids = [];
    try { ids = fs.readdirSync(path.join(base, space)); } catch { continue; }
    for (const id of ids) {
      if (!isDshSession(id)) continue; // a subagent's own log
      const file = path.join(base, space, id, LOG_NAME);
      try { all.push({ id, file, lastModified: fs.statSync(file).mtimeMs }); } catch { /* being written */ }
    }
  }
  all.sort((a, b) => b.lastModified - a.lastModified);
  const out = [];
  for (const { id, file, lastModified } of all) {
    if (out.length >= 60) break;
    const lines = readLog(file);
    if (!lines[0]?.cwd || !samePath(lines[0].cwd, cwd)) continue;
    let summary = '';
    let customTitle = '';
    let firstPrompt = '';
    for (const e of lines) {
      if (e.type === 'session/title') {
        if (e.data?.source?.kind === 'user') customTitle = e.data.title;
        else summary = e.data?.title || summary;
      } else if (!firstPrompt && e.type === 'user/message' && e.data?.source?.kind === 'user') {
        firstPrompt = (e.data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ').slice(0, 200);
      }
    }
    if (firstPrompt) out.push({ sessionId: id, summary, customTitle, firstPrompt, lastModified });
  }
  return out;
}

const loadDshHistory = (home, sessionId) => replayEvents(sessionId, readEvents(findSession(home, sessionId)?.file)).map(slim);

// A copy of the conversation that ends just before message `uuid` (of all of it without one), written the way dsh
// writes a fork of its own: the events up to the end of a turn, then the mark that they were inherited. Returns
// { sessionId }, null when the message was the first.
function forkDshSession(home, sessionId, uuid) {
  const source = findSession(home, sessionId);
  if (!source) throw new Error(t('This conversation was not found.'));
  const lines = readLog(source.file);
  const messageId = uuid ? (messageIds.get(uuid) || uuid) : null;
  const events = lines.filter((l) => l.seq != null);
  // A message of yours, or a command you ran (dsh logs those as command/run).
  const at = messageId ? events.findIndex((e) => (e.type === 'user/message' && e.data?.id === messageId)
    || (e.type === 'command/run' && e.data?.commandId === messageId)) : events.length;
  if (at < 0) throw new Error(t('This message is not in the saved conversation, so it cannot be used as a starting point.'));
  let boundary = -1;
  for (let i = at - 1; i >= 0; i--) {
    if (events[i].type === 'turn/end') { boundary = i; break; }
  }
  if (boundary < 0) {
    if (messageId) return { sessionId: null };
    throw new Error(t('There is nothing to branch yet: send a message first.'));
  }
  const id = `dsh-${randomUUID()}`;
  const header = { ...lines[0], id, createdAt: Date.now(), isSeeded: true };
  const kept = events.slice(0, boundary + 1);
  const end = kept[kept.length - 1];
  kept.push({ type: 'session/end-seed', seq: end.seq + 1, time: end.time, data: { inherited: true } });
  const dir = path.join(source.dir, id);
  fs.mkdirSync(dir, { recursive: true });
  // The header in a frame of its own, as dsh writes it (it reads the first frame as the header alone).
  const frame = (lines) => zlib.zstdCompressSync(Buffer.from(`${lines.map((l) => JSON.stringify(l)).join('\n')}\n`, 'utf8'));
  fs.writeFileSync(path.join(dir, LOG_NAME), Buffer.concat([frame([header]), frame(kept)]));
  return { sessionId: id };
}

// ---------- undoing file changes ----------
// The files as they were before message `messageId`: the first copy of each made since (the plugin files them under
// the message being worked on). `dryRun` only reports, in the shape the chat reads from Claude Code's rewind.
function rewindFiles(install, userIds, messageId, dryRun) {
  const at = userIds.indexOf(messageId);
  if (at < 0) return { canRewind: false, error: t('There is no saved file state for this message.') };
  const earliest = new Map();
  for (const id of userIds.slice(at)) {
    let text = '';
    try { text = fs.readFileSync(path.join(install.checkpoints, id, 'files.jsonl'), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line) continue;
      const entry = JSON.parse(line);
      if (!earliest.has(entry.path)) earliest.set(entry.path, entry);
    }
  }
  const blob = (entry) => path.join(install.checkpoints, 'blobs', entry.blob);
  const filesChanged = [];
  let insertions = 0;
  let deletions = 0;
  for (const entry of earliest.values()) {
    if (entry.tooLarge) return { canRewind: false, error: t('{file} is too large to have been saved.', { file: path.basename(entry.path) }) };
    let now = null;
    try { now = fs.readFileSync(entry.path); } catch { /* deleted since */ }
    const then = entry.existed ? fs.readFileSync(blob(entry)) : null;
    if ((now && then && now.equals(then)) || (!now && !then)) continue;
    filesChanged.push(entry.path);
    const count = lineChanges(then ? then.toString('utf8') : '', now ? now.toString('utf8') : '');
    insertions += count.added;
    deletions += count.removed;
    if (!dryRun) {
      if (then) {
        fs.mkdirSync(path.dirname(entry.path), { recursive: true });
        fs.writeFileSync(entry.path, then);
      } else fs.rmSync(entry.path, { force: true });
    }
  }
  return { canRewind: true, filesChanged, insertions, deletions };
}

// Lines only in the one text or the other: the count shown before undoing, not a diff.
function lineChanges(before, after) {
  const counts = new Map();
  for (const line of before.split('\n')) counts.set(line, (counts.get(line) || 0) + 1);
  let added = 0;
  for (const line of after.split('\n')) {
    const n = counts.get(line) || 0;
    if (n) counts.set(line, n - 1);
    else added++;
  }
  let removed = 0;
  for (const n of counts.values()) removed += n;
  return { added, removed };
}

module.exports = { DshSession, isDshSession, listDshHistory, loadDshHistory, forkDshSession, readEvents, findSession, rewindFiles, MODELS, modelsFor };
