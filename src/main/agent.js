// Chat sessions: each one is a long-lived Claude Agent SDK query fed by a message queue.
// SDK messages are forwarded to the window in small batches; permission requests become
// round-trips to the UI.
const fs = require('fs');
const { randomUUID } = require('crypto');
const { shellEnvReady, childEnv } = require('./shell-env');

let sdkModule = null;
const loadSdk = () => (sdkModule ??= import('@anthropic-ai/claude-agent-sdk'));

const MAX_TEXT = 200_000; // characters of any single tool result forwarded to the UI
const RECORD = process.env.CCUI_RECORD;

// Credentials a shareable app may use. Claude.ai subscription logins are not allowed for third-party apps.
const API_KEY_SOURCES = new Set(['ANTHROPIC_API_KEY', 'apiKeyHelper', '/login managed key']);

function usesSubscriptionLogin(account) {
  if (!account || !account.subscriptionType) return false;
  if (account.apiProvider && account.apiProvider !== 'firstParty') return false;
  if (API_KEY_SOURCES.has(account.apiKeySource) || account.tokenSource === 'ANTHROPIC_AUTH_TOKEN') return false;
  return true;
}

function truncate(text) {
  return typeof text === 'string' && text.length > MAX_TEXT
    ? `${text.slice(0, MAX_TEXT)}\n… (${text.length - MAX_TEXT} more characters not shown)`
    : text;
}

// Images larger than this are not sent to the window; the tool card says why instead of previewing.
const MAX_PREVIEW_BASE64 = Math.ceil((3 * 1024 * 1024 * 4) / 3); // 3 MB of image data (PREVIEW_LIMIT in ToolCard.jsx)
const base64Bytes = (b64) => Math.round((b64.length * 3) / 4);

function slimImage(block) {
  const data = block.source?.data;
  if (typeof data !== 'string' || data.length <= MAX_PREVIEW_BASE64) return block;
  return { type: 'image', omitted: true, bytes: base64Bytes(data), media_type: block.source.media_type };
}

// Keep IPC payloads small: drop whole-file copies, cap long tool output and oversized images.
function slim(message) {
  if (message.type !== 'user' || !Array.isArray(message.message?.content)) return message;
  let hasImage = false;
  const content = message.message.content.map((block) => {
    if (block.type !== 'tool_result') return block;
    if (typeof block.content === 'string') return { ...block, content: truncate(block.content) };
    if (Array.isArray(block.content)) {
      return {
        ...block,
        content: block.content.map((c) => {
          if (c.type === 'text') return { ...c, text: truncate(c.text) };
          if (c.type === 'image') {
            hasImage = true;
            return slimImage(c);
          }
          return c;
        }),
      };
    }
    return block;
  });
  let result = message.tool_use_result;
  if (result && typeof result === 'object') {
    result = { ...result };
    delete result.originalFile;
    for (const key of ['stdout', 'stderr', 'content']) if (typeof result[key] === 'string') result[key] = truncate(result[key]);
    if (result.file && typeof result.file.content === 'string') result.file = { ...result.file, content: truncate(result.file.content) };
    // An image Read carries the picture twice (tool_result block and here); keep one copy.
    if (result.file && typeof result.file.base64 === 'string') {
      const { base64, ...meta } = result.file;
      result.file = hasImage || base64.length > MAX_PREVIEW_BASE64
        ? { ...meta, base64Omitted: !hasImage, bytes: base64Bytes(base64) }
        : result.file;
    }
  }
  return { ...message, message: { ...message.message, content }, tool_use_result: result };
}

class AgentSession {
  constructor(id, opts, emit) {
    this.id = id;
    this.opts = opts;
    this.emit = emit;
    this.queue = [];
    this.wake = null;
    this.closed = false;
    this.pending = new Map();
    this.batch = [];
    this.flushTimer = null;
    this.stderr = '';
  }

  async start() {
    const sdk = await loadSdk();
    await shellEnvReady;
    if (this.closed) return { ok: false, code: 'closed', error: 'Session closed.' }; // closed while loading
    const { cwd, model, permissionMode, resume, claudeFile, apiKey } = this.opts;
    const self = this;
    async function* input() {
      while (!self.closed) {
        while (self.queue.length) yield self.queue.shift();
        await new Promise((r) => { self.wake = r; });
        self.wake = null;
      }
    }

    this.q = sdk.query({
      prompt: input(),
      options: {
        cwd,
        model: model || undefined,
        permissionMode: permissionMode || 'default',
        // Makes "Bypass permissions" selectable later in the session; it does not bypass anything by itself.
        allowDangerouslySkipPermissions: true,
        resume: resume || undefined,
        continue: this.opts.continue || undefined,
        includePartialMessages: true,
        enableFileCheckpointing: true, // lets a message's file changes be undone (control 'rewind')
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        settingSources: ['user', 'project', 'local'],
        pathToClaudeCodeExecutable: claudeFile || undefined,
        env: childEnv(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
        canUseTool: (toolName, toolInput, options) => this.askPermission(toolName, toolInput, options),
        stderr: (data) => { this.stderr = (this.stderr + data).slice(-4000); },
      },
    });

    let account = null;
    try {
      account = await this.q.accountInfo();
    } catch { /* not signed in yet: the first turn reports the problem */ }
    if (this.closed) return { ok: false, code: 'closed', error: 'Session closed.' };
    if (usesSubscriptionLogin(account)) {
      this.close();
      return { ok: false, code: 'subscription' };
    }

    this.pump();
    this.loadMeta();
    return {
      ok: true,
      account: account && { provider: account.apiProvider, apiKeySource: account.apiKeySource, tokenSource: account.tokenSource },
    };
  }

  async loadMeta() {
    try {
      const [commands, models] = await Promise.all([this.q.supportedCommands(), this.q.supportedModels()]);
      this.emit('agent:meta', this.id, { commands, models });
    } catch { /* optional */ }
  }

  async pump() {
    let error = null;
    try {
      for await (const message of this.q) {
        // Debug aid: CCUI_RECORD=<file> saves the raw stream (used to build reducer test fixtures).
        if (RECORD) fs.appendFileSync(RECORD, `${JSON.stringify(message)}\n`);
        this.batch.push(slim(message));
        if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 16);
      }
    } catch (err) {
      if (!this.closed) error = err.message || String(err);
    }
    this.flush();
    // Claude Code is gone (possibly on its own): release the input generator waiting for the next message.
    this.closed = true;
    this.wake?.();
    for (const [requestId, p] of this.pending) {
      p.resolve({ behavior: 'deny', message: 'Session ended.' });
      this.emit('agent:permission-cancel', this.id, requestId);
    }
    this.pending.clear();
    this.emit('agent:exit', this.id, { error, stderr: error ? this.stderr : '' });
  }

  flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.batch.length) return;
    this.emit('agent:events', this.id, this.batch);
    this.batch = [];
  }

  send({ text, images = [], uuid }) {
    const blocks = images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data },
    }));
    if (text) blocks.push({ type: 'text', text });
    this.queue.push({
      type: 'user',
      uuid: uuid || randomUUID(),
      message: { role: 'user', content: images.length ? blocks : text },
      parent_tool_use_id: null,
      origin: { kind: 'human' },
    });
    this.wake?.();
  }

  askPermission(toolName, input, options) {
    return new Promise((resolve) => {
      const requestId = options.requestId || randomUUID();
      this.pending.set(requestId, { resolve, input });
      options.signal?.addEventListener('abort', () => {
        if (!this.pending.delete(requestId)) return;
        resolve({ behavior: 'deny', message: 'Cancelled.' });
        this.emit('agent:permission-cancel', this.id, requestId);
      }, { once: true });
      this.flush(); // the tool_use block must reach the UI before its permission card
      this.emit('agent:permission', this.id, {
        requestId,
        toolName,
        input,
        toolUseID: options.toolUseID,
        agentID: options.agentID,
        title: options.title,
        displayName: options.displayName,
        description: options.description,
        decisionReason: options.decisionReason,
        blockedPath: options.blockedPath,
        suggestions: options.suppressAlwaysAllowRule ? [] : options.suggestions || [],
      });
    });
  }

  answerPermission(requestId, answer) {
    const p = this.pending.get(requestId);
    if (!p) return;
    this.pending.delete(requestId);
    if (answer.behavior === 'allow') {
      p.resolve({
        behavior: 'allow',
        updatedInput: answer.updatedInput || p.input,
        ...(answer.updatedPermissions?.length ? { updatedPermissions: answer.updatedPermissions } : {}),
      });
    } else {
      p.resolve({ behavior: 'deny', message: answer.message || 'The user declined this action.', interrupt: !!answer.interrupt });
    }
  }

  async control(action, arg) {
    try {
      switch (action) {
        // Stop means stop everything: messages still waiting in Claude Code's queue would otherwise start
        // the next turn right after the interrupted one. `value.cancelled` lists their uuids.
        case 'interrupt': return { ok: true, value: (await this.q.interrupt({ cancelQueued: true })) || null };
        case 'model': await this.q.setModel(arg || undefined); return { ok: true };
        case 'mode': await this.q.setPermissionMode(arg); return { ok: true };
        // Put files back the way they were when the user sent message `arg.uuid` (`dryRun`: only report).
        case 'rewind': return { ok: true, value: await this.q.rewindFiles(arg.uuid, { dryRun: Boolean(arg.dryRun) }) };
        case 'context': return { ok: true, value: await this.q.getContextUsage({ detail: 'summary' }) };
        default: return { ok: false, error: `Unknown action ${action}` };
      }
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.wake?.();
    try { this.q?.close(); } catch { /* already closed */ }
  }
}

class AgentManager {
  constructor(emit) {
    this.emit = emit;
    this.sessions = new Map();
    this.nextId = 1;
  }

  async start(opts) {
    const id = this.nextId++;
    const session = new AgentSession(id, opts, (channel, ...args) => {
      if (channel === 'agent:exit') this.sessions.delete(id);
      this.emit(channel, ...args);
    });
    this.sessions.set(id, session);
    try {
      const result = await session.start();
      if (!result.ok) this.sessions.delete(id);
      return { ...result, id };
    } catch (err) {
      this.sessions.delete(id);
      session.close();
      return { ok: false, error: err.message || String(err) };
    }
  }

  get(id) {
    return this.sessions.get(id);
  }

  close(id) {
    this.sessions.get(id)?.close();
  }

  closeAll() {
    for (const s of this.sessions.values()) s.close();
  }

  get liveCount() {
    return this.sessions.size;
  }
}

async function listHistory(cwd) {
  const sdk = await loadSdk();
  return sdk.listSessions({ dir: cwd, limit: 60 });
}

async function loadHistory(sessionId, cwd) {
  const sdk = await loadSdk();
  const messages = await sdk.getSessionMessages(sessionId, { dir: cwd });
  return messages.map((m) => slim({ ...m, message: m.message }));
}

// A copy of the conversation that ends just before the user's message `uuid` (the original is kept).
// Returns { sessionId } to resume, with sessionId null when that message was the first one.
async function forkBefore(sessionId, cwd, uuid) {
  const sdk = await loadSdk();
  const messages = await sdk.getSessionMessages(sessionId, { dir: cwd });
  const at = messages.findIndex((m) => m.uuid === uuid);
  if (at < 0) throw new Error('This message is not in the saved conversation, so it cannot be used as a starting point.');
  if (at === 0) return { sessionId: null };
  return sdk.forkSession(sessionId, { dir: cwd, upToMessageId: messages[at - 1].uuid });
}

module.exports = { AgentManager, listHistory, loadHistory, forkBefore, usesSubscriptionLogin, slim };
