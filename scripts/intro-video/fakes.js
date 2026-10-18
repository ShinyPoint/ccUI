// Stand-ins for the Agent SDK sessions and the pseudo-terminals, so the intro video can be recorded with the
// real window and no API usage. A fake chat session emits the same message stream Claude Code does (see
// lib/chat-reducer.js), driven by the scripts in story.js; a fake terminal prints scripted text.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { structuredPatch } = require('diff');

const CLOSED = Symbol('closed');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MODELS = [
  { value: 'default', displayName: 'Default (recommended)', description: 'Use the default model (currently Opus 5.5)', resolvedModel: 'claude-opus-5-5', supportsAutoMode: true,
    supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'claude-opus-5-5', displayName: 'Opus', description: 'Opus 5.5 · Best for everyday, complex tasks', supportsAutoMode: true,
    supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'sonnet', displayName: 'Sonnet', description: 'Sonnet 5.5 · Efficient for routine tasks', supportsAutoMode: true,
    supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
  { value: 'haiku', displayName: 'Haiku', description: 'Haiku 4.5 · Fastest for quick answers' },
];
const COMMANDS = [
  { name: 'compact', description: 'Summarize the conversation to free up context' },
  { name: 'context', description: 'Show what is using the context window' },
  { name: 'init', description: 'Write a CLAUDE.md for this project' },
  { name: 'code-review', description: 'Review the current changes for bugs' },
  { name: 'security-review', description: 'Review the pending changes for security issues' },
];

class FakeAgentSession {
  constructor(id, opts, emit, director) {
    Object.assign(this, { id, opts, emit, director });
    this.cwd = opts.cwd;
    this.sessionId = opts.resume || randomUUID();
    this.mode = opts.permissionMode || 'default';
    this.pending = new Map();
    this.closed = false;
    this.inited = false;
    this.cost = 0;
    this.tokens = opts.resume ? 21400 : 0;
    this.msg = null; // the assistant message being streamed: { id, index }
    this.tasks = new Map(); // background tasks still running: task_id -> { toolUseId, description }
    if (!director.transcripts.has(this.sessionId)) director.transcripts.set(this.sessionId, []);
  }

  // ---------- plumbing ----------
  events(...messages) {
    if (this.closed) throw CLOSED;
    const stamped = messages.map((m) => ({ session_id: this.sessionId, parent_tool_use_id: null, uuid: randomUUID(), ...m }));
    const kept = stamped.filter((m) => m.type === 'user' || m.type === 'assistant');
    if (kept.length) this.director.transcripts.get(this.sessionId).push(...kept);
    this.emit('agent:events', this.id, stamped);
  }

  stream(event) {
    this.events({ type: 'stream_event', event });
  }

  async pause(ms) {
    await sleep(ms);
    if (this.closed) throw CLOSED;
  }

  file(rel) {
    return `${this.cwd}/${rel}`;
  }

  send({ text, uuid }) {
    this.director.transcripts.get(this.sessionId).push({ type: 'user', uuid, message: { role: 'user', content: text } });
    if (!this.inited) {
      this.inited = true;
      this.events({
        type: 'system', subtype: 'init', cwd: this.cwd, model: 'claude-opus-5-5', permissionMode: this.mode,
        tools: [], mcp_servers: [], slash_commands: COMMANDS.map((c) => c.name), terminal_slash_commands: [],
        claude_code_version: '2.1.287', apiKeySource: 'ANTHROPIC_API_KEY',
      });
    }
    const script = this.director.script(this, text);
    if (!script) return;
    this.turnStart = Date.now();
    this.steps = 0;
    this.events({ type: 'system', subtype: 'status', status: 'requesting' });
    script(this, text).catch((err) => { if (err !== CLOSED) console.error('[script]', err); });
  }

  // ---------- what a script can do in a turn ----------
  open() {
    if (this.msg) return;
    this.msg = { id: `msg_${randomUUID().slice(0, 12)}`, index: 0 };
    this.stream({ type: 'message_start', message: { id: this.msg.id } });
  }

  shut() {
    if (!this.msg) return;
    this.stream({ type: 'message_stop' });
    this.msg = null;
  }

  assistant(block) {
    this.events({ type: 'assistant', message: { id: this.msg.id, role: 'assistant', content: [block] } });
  }

  async think(ms) {
    this.open();
    const index = this.msg.index++;
    this.stream({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '' } });
    await this.pause(ms);
    this.stream({ type: 'content_block_stop', index });
    this.assistant({ type: 'thinking', thinking: '' });
  }

  async say(text, { cps = 150 } = {}) {
    this.open();
    const index = this.msg.index++;
    this.stream({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
    const pieces = text.match(/\s*\S+/g) || [];
    for (const piece of pieces) {
      this.stream({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: piece } });
      await this.pause((piece.length / cps) * 1000);
    }
    this.stream({ type: 'content_block_stop', index });
    this.assistant({ type: 'text', text });
    this.tokens += Math.round(text.length / 3);
  }

  // One tool call. `ask`: permission request fields (the call waits for the answer); `run`: how long it takes;
  // (or `until`: a promise it runs until); `typing`: how long the input takes to stream in; `effect()`: runs when
  // allowed and returns { result, data }; `fail`: the step ends in an error.
  async tool(name, input, { ask, run = 350, until, typing = 120, result = '', data = null, effect, progress = false, fail = false } = {}) {
    this.open();
    const index = this.msg.index++;
    const id = `toolu_${randomUUID().slice(0, 16)}`;
    this.stream({ type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, input: {} } });
    const json = JSON.stringify(input);
    const parts = Math.max(1, Math.round(typing / 40));
    const size = Math.ceil(json.length / parts);
    for (let i = 0; i < json.length; i += size) {
      this.stream({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json.slice(i, i + size) } });
      await this.pause(typing / parts);
    }
    this.stream({ type: 'content_block_stop', index });
    this.assistant({ type: 'tool_use', id, name, input });
    this.shut();
    this.steps++;

    let answer = { behavior: 'allow' };
    if (ask) answer = await this.ask(name, input, id, ask);
    if (answer.behavior !== 'allow') {
      this.toolResult(id, answer.message, null, true);
      return { denied: true, answer };
    }
    if (answer.updatedInput) input = answer.updatedInput;
    let end = Date.now() + (until ? Infinity : run);
    until?.then(() => { end = 0; });
    if (progress || until) {
      for (const started = Date.now(); Date.now() < end;) {
        this.events({ type: 'tool_progress', tool_use_id: id, tool_name: name, elapsed_time_seconds: (Date.now() - started) / 1000 });
        await this.pause(Math.min(500, Math.max(0, end - Date.now())));
      }
    } else await this.pause(run);
    if (effect) ({ result, data } = effect(input));
    this.toolResult(id, result, data, fail); // `fail`: the step ends in an error
    this.tokens += 900 + Math.round((json.length + String(result).length) / 3);
    return { answer, input, id };
  }

  // ---------- background tasks (subagents) ----------
  // A step of the subagent behind the Agent call `parent`: its tool call and, after `run` ms, its result.
  async childTool(parent, name, input, { run = 300, result = '', data = null } = {}) {
    const id = `toolu_${randomUUID().slice(0, 16)}`;
    const msgId = `msg_${randomUUID().slice(0, 12)}`;
    this.events({ type: 'assistant', parent_tool_use_id: parent, message: { id: msgId, role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
    await this.pause(run);
    this.events({
      type: 'user', parent_tool_use_id: parent,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: result || 'ok', is_error: false }] },
      ...(data ? { tool_use_result: data } : {}),
    });
    return id;
  }

  startTask({ id, toolUseId, description, subagentType = 'general-purpose', kind = 'local_agent' }) {
    this.tasks.set(id, { toolUseId, description });
    this.events({ type: 'system', subtype: 'task_started', task_id: id, tool_use_id: toolUseId, description, subagent_type: subagentType, task_type: kind, is_backgrounded: true });
  }

  taskProgress(id, { toolUses, lastTool, tokens = 1000 }) {
    const t = this.tasks.get(id);
    if (!t) return;
    this.events({ type: 'system', subtype: 'task_progress', task_id: id, tool_use_id: t.toolUseId, description: t.description, usage: { total_tokens: tokens, tool_uses: toolUses, duration_ms: 0 }, last_tool_name: lastTool });
  }

  endTask(id, status = 'completed', summary = '') {
    const t = this.tasks.get(id);
    if (!t) return false;
    this.tasks.delete(id);
    this.events({ type: 'system', subtype: 'task_notification', task_id: id, tool_use_id: t.toolUseId, status, summary, output_file: '' });
    return true;
  }

  // A turn Claude starts by itself (after a background task ended).
  wake() {
    this.turnStart = Date.now();
    this.steps = 0;
  }

  toolResult(id, content, data, isError) {
    this.events({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: content || '', is_error: isError }] },
      ...(data ? { tool_use_result: data } : {}),
    });
  }

  ask(toolName, input, toolUseID, fields) {
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      this.pending.set(requestId, { resolve, reject });
      this.emit('agent:permission', this.id, { requestId, toolName, input, toolUseID, suggestions: [], ...fields });
    });
  }

  answerPermission(requestId, answer) {
    const p = this.pending.get(requestId);
    if (!p) return;
    this.pending.delete(requestId);
    const mode = (answer.updatedPermissions || []).find((u) => u.type === 'setMode')?.mode;
    if (mode) {
      this.mode = mode;
      this.events({ type: 'system', subtype: 'status', status: null, permissionMode: mode });
    }
    p.resolve(answer);
  }

  finish(cost) {
    this.shut();
    this.cost += cost;
    this.events({
      type: 'result', subtype: 'success', total_cost_usd: this.cost, duration_ms: Date.now() - this.turnStart,
      num_turns: this.steps + 1, result: '',
    });
  }

  // ---------- the rest of what main.js calls ----------
  async control(action, arg) {
    if (action === 'mode') this.mode = arg;
    // Stop also ends background tasks, as Claude Code does for a client that doesn't stop them one by one.
    if (action === 'interrupt') {
      for (const id of [...this.tasks.keys()]) this.endTask(id, 'stopped');
      return { ok: true, value: { cancelled: [] } };
    }
    if (action === 'stop-task') {
      (this.director.stopped ||= []).push(arg);
      this.endTask(arg, 'stopped');
      return { ok: true };
    }
    if (action === 'context') {
      const totalTokens = 18200 + this.tokens;
      const categories = [
        { name: 'System prompt', tokens: 3100, kind: 'used' },
        { name: 'System tools', tokens: 11800, kind: 'used' },
        { name: 'Memory files', tokens: 1200, kind: 'used' },
        { name: 'Messages', tokens: totalTokens - 16100, kind: 'used' },
        { name: 'Free space', tokens: 200000 - totalTokens - 33000, kind: 'free' },
        { name: 'Autocompact buffer', tokens: 33000, kind: 'buffer' },
        { name: 'MCP tools', tokens: 900, kind: 'deferred' },
      ];
      return { ok: true, value: { totalTokens, maxTokens: 200000, percentage: (totalTokens / 200000) * 100, categories } };
    }
    return { ok: true };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) p.reject(CLOSED);
    this.pending.clear();
    setTimeout(() => this.emit('agent:exit', this.id, { error: null, stderr: '' }), 40);
  }
}

function fakeAgents(director) {
  class AgentManager {
    constructor(emit) {
      this.emit = emit;
      this.sessions = new Map();
      this.nextId = 1;
    }

    async start(opts) {
      const id = this.nextId++;
      await sleep(320);
      const session = new FakeAgentSession(id, opts, (channel, ...args) => {
        if (channel === 'agent:exit') this.sessions.delete(id);
        this.emit(channel, ...args);
      }, director);
      this.sessions.set(id, session);
      setTimeout(() => this.emit('agent:meta', id, { commands: COMMANDS, models: MODELS }), 60);
      return { ok: true, id, account: { provider: 'firstParty', apiKeySource: 'ANTHROPIC_API_KEY' } };
    }

    get(id) { return this.sessions.get(id); }
    close(id) { this.sessions.get(id)?.close(); }
    closeAll() { for (const s of this.sessions.values()) s.close(); }
    get liveCount() { return this.sessions.size; }
  }

  return {
    AgentManager,
    listHistory: async (cwd) => director.histories.filter((h) => h.cwd === cwd)
      .map(({ sessionId, summary, lastModified }) => ({ sessionId, summary, lastModified })),
    loadHistory: async (sessionId) => director.transcripts.get(sessionId) || [],
    forkBefore: async () => { throw new Error('Not available while recording.'); },
  };
}

// Applies an Edit to the real file in the demo project, so the diff shows real line numbers.
function applyEdit({ file_path: file, old_string: before, new_string: after }) {
  const original = fs.readFileSync(file, 'utf8');
  const updated = original.replace(before, after);
  fs.writeFileSync(file, updated);
  const { hunks } = structuredPatch('a', 'b', original, updated, '', '', { context: 2 });
  return { result: 'The file has been updated.', data: { filePath: file, oldString: before, newString: after, structuredPatch: hunks } };
}

function applyWrite({ file_path: file, content }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return { result: 'File created.', data: { type: 'create', filePath: file, content } };
}

// ---------- terminals ----------
function fakePtys(director) {
  return class PtyManager {
    constructor(send) {
      this.send = send;
      this.sessions = new Map();
      this.nextId = 1;
    }

    create({ kind, cwd, args = [] }) {
      const id = this.nextId++;
      const session = { id, kind, cwd, line: '' };
      this.sessions.set(id, session);
      const out = (text) => { if (this.sessions.has(id)) this.send('pty:data', id, text); };
      session.out = out;
      if (kind === 'shell') setTimeout(() => out(director.prompt(cwd)), 260);
      else setTimeout(() => out(director.cli(cwd, args)), 420);
      return { id, proc: { pid: 21400 + id * 37 } };
    }

    // A shell just echoes what is typed and prints the scripted output of the command.
    write(id, data) {
      const s = this.sessions.get(id);
      if (!s || s.kind !== 'shell') return;
      for (const ch of data) {
        if (ch === '\r') {
          const output = director.shell(s.line.trim(), s.cwd);
          s.line = '';
          s.out('\r\n');
          setTimeout(() => s.out(`${output}${director.prompt(s.cwd)}`), 180);
        } else if (ch === '\x7f') {
          if (s.line) { s.line = s.line.slice(0, -1); s.out('\b \b'); }
        } else if (ch >= ' ') {
          s.line += ch;
          s.out(ch);
        }
      }
    }

    resize() {}

    kill(id) {
      if (!this.sessions.delete(id)) return;
      setTimeout(() => this.send('pty:exit', id, { exitCode: 0 }), 30);
    }

    killAll() { for (const id of [...this.sessions.keys()]) this.kill(id); }
    get liveCount() { return this.sessions.size; }
  };
}

// Puts the fakes in place of src/main/agent.js and src/main/pty.js. Call before requiring src/main/main.js.
function install(director) {
  const swap = (file, change) => {
    const real = require(file);
    require.cache[require.resolve(file)].exports = { ...real, ...change };
  };
  swap('../../src/main/agent.js', fakeAgents(director));
  swap('../../src/main/pty.js', { PtyManager: fakePtys(director) });
}

module.exports = { install, applyEdit, applyWrite, sleep };
