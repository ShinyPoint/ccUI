// DeepSeek Harness speaks in session events; the chat reads Agent SDK messages (fakes.js is the compact list of the
// shapes). This turns the one into the other, so the timeline, the diffs and the permission cards need no second
// version. Pure: no process, no files, so it also reads saved conversations, and test/dsh-translate.test.mjs can run it.
const { t } = require('./i18n');

const TOOL_NAMES = {
  read: 'Read', read_image: 'Read', edit: 'Edit', write: 'Write', pwsh: 'Bash', bash: 'Bash', grep: 'Grep', glob: 'Glob',
  web_fetch: 'WebFetch', web_search: 'WebSearch', subagent: 'Agent', subagent_fork: 'Agent', todo_write: 'TodoWrite',
  skill: 'Skill', ask_user_question: 'AskUserQuestion', exit_plan_mode: 'ExitPlanMode', job_output: 'BashOutput', job_kill: 'KillShell',
};
const toolName = (name) => TOOL_NAMES[name] || name;

const parse = (json) => {
  if (json && typeof json === 'object') return json;
  try { return JSON.parse(json); } catch { return {}; }
};

// A tool's arguments under the names the chat's cards read. Everything else about them is the same.
function toolInput(name, args) {
  const input = parse(args) || {};
  switch (name) {
    case 'web_search': return { ...input, query: (input.queries || []).join(', ') };
    case 'job_output': return { ...input, bash_id: input.job_id || input.jobId || '' };
    case 'job_kill': return { ...input, shell_id: input.job_id || input.jobId || '' };
    case 'ask_user_question': return { ...input, questions: askedQuestions(input.questions) };
    default: return input;
  }
}

// dsh's questions as the question card reads them. dsh allows a question without options (free text only).
function askedQuestions(questions = []) {
  return questions.map((q) => ({ ...q, multiSelect: Boolean(q.multi_select ?? q.multiSelect), options: q.options || [] }));
}

const textOf = (content) => (Array.isArray(content) ? content : []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

function imageBlocks(content) {
  return (Array.isArray(content) ? content : []).filter((c) => c.type === 'image' && (c.data || c.source?.data))
    .map((c) => ({ type: 'image', source: c.source || { type: 'base64', media_type: c.mimeType || c.mediaType, data: c.data } }));
}

// A file as `read` returns it, without the wrapping the model sees.
const unwrapRead = (text) => /<content>\n?([\s\S]*?)\n*(?:\(End of file[^\n]*\)\n*)?<\/content>/.exec(text)?.[1] ?? text;

// What the chat's cards read about a finished tool call, beyond its text (Claude Code's tool_use_result).
function toolData(call, data) {
  const meta = data.meta || {};
  const text = textOf(data.message?.content);
  switch (call?.name) {
    case 'read':
      return { type: 'text', file: { filePath: meta.path, content: meta.lines ? meta.lines.map((l) => l.text).join('\n') : unwrapRead(text) } };
    case 'write':
      return { type: meta.operation === 'create' ? 'create' : 'update', filePath: meta.path };
    case 'edit':
      return { filePath: meta.path, ...(meta.diffs?.length ? { diffs: meta.diffs } : {}) }; // lib/diff.js makes hunks of them
    case 'glob':
      return meta.total != null ? { numFiles: meta.total } : null;
    case 'subagent':
    case 'subagent_fork':
      return data.message?.isError ? null : { status: 'async_launched' };
    case 'ask_user_question': {
      const answers = parse(text)?.answers;
      if (!Array.isArray(answers)) return null;
      const asked = askedQuestions(parse(call.args)?.questions);
      return {
        answers: Object.fromEntries(answers.map((a) => [
          asked.find((q) => q.id === a.id)?.question || a.id,
          [...(a.selected || []), ...(a.custom ? [a.custom] : [])].join(', '),
        ])),
      };
    }
    default:
      return null;
  }
}

// The model's words about a finished background agent, for its card.
const lastWords = (message) => (Array.isArray(message) ? textOf(message) : typeof message === 'string' ? message : '');

class DshTranslator {
  // `id`: the conversation's session id; `replay`: reading a saved conversation, not a live one.
  constructor(id, { replay = false } = {}) {
    this.id = id;
    this.replay = replay;
    this.calls = new Map(); // callId -> { name, args }
    this.children = new Map(); // child session id -> the call that started it
    this.unassigned = []; // subagent calls whose child hasn't been reported yet
    this.streams = new Map(); // session id -> { msgId, blocks: Map(dsh index -> started) }
    this.turnStarted = 0;
    this.steps = 0;
    this.usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    this.lastUsage = null;
    this.contextWindow = 0;
  }

  // A call's arguments as its card shows them.
  inputOf(callId) {
    const call = this.calls.get(callId);
    return call ? toolInput(call.name, call.args) : null;
  }

  stamp(sessionId, message) {
    return { session_id: this.id, parent_tool_use_id: sessionId === this.id ? null : this.children.get(sessionId) || null, uuid: `${sessionId}:${++DshTranslator.next}`, ...message };
  }

  // One frame of an answer being written (the plugin's ccui.stream).
  frame(f) {
    const sessionId = String(f.attemptId || '').replace(/:\d+$/, '');
    const out = [];
    const event = (ev) => out.push(this.stamp(sessionId, { type: 'stream_event', event: ev }));
    if (f.type === 'start') {
      const msgId = `dsh-msg-${f.attemptId}`;
      this.streams.set(sessionId, { msgId, blocks: new Map() });
      event({ type: 'message_start', message: { id: msgId } });
      if (sessionId === this.id) out.push(this.stamp(sessionId, { type: 'system', subtype: 'status', status: 'requesting' }));
    } else if (f.type === 'chunk') {
      const stream = this.streams.get(sessionId);
      const c = f.chunk;
      if (!stream || !c) return out;
      if (c.type === 'block-start') {
        if (c.blockType === 'reasoning') event({ type: 'content_block_start', index: c.index, content_block: { type: 'thinking', thinking: '' } });
        else if (c.blockType === 'text') event({ type: 'content_block_start', index: c.index, content_block: { type: 'text', text: '' } });
        stream.blocks.set(c.index, c.blockType !== 'tool-call');
      } else if (c.type === 'reasoning-delta') event({ type: 'content_block_delta', index: c.index, delta: { type: 'thinking_delta', thinking: c.text } });
      else if (c.type === 'text-delta') event({ type: 'content_block_delta', index: c.index, delta: { type: 'text_delta', text: c.text } });
      else if (c.type === 'tool-call-delta') {
        // A tool call's id and name come with its first delta, not when its block starts.
        if (!stream.blocks.get(c.index) && c.id && c.name) {
          stream.blocks.set(c.index, true);
          event({ type: 'content_block_start', index: c.index, content_block: { type: 'tool_use', id: c.id, name: toolName(c.name), input: {} } });
        }
        if (c.argumentsDelta) event({ type: 'content_block_delta', index: c.index, delta: { type: 'input_json_delta', partial_json: c.argumentsDelta } });
      } else if (c.type === 'block-end') event({ type: 'content_block_stop', index: c.index });
    } else if (f.type === 'end') {
      event({ type: 'message_stop' });
    }
    return out;
  }

  // One session event (session.event, or a line of a saved conversation).
  event(sessionId, e) {
    const d = e.data || {};
    const at = this.replay ? { at: e.time } : {};
    const say = (message) => [this.stamp(sessionId, { ...message, ...at })];
    switch (e.type) {
      case 'command/run':
        // A command you ran, as you typed it; its answer follows (command/done). Live, dsh.js shows both itself.
        if (!this.replay || sessionId !== this.id || d.source?.kind !== 'user') return [];
        return [{ ...this.stamp(sessionId, { type: 'user', message: { role: 'user', content: `/${d.name}${d.args || ''}` }, ...at }), uuid: d.commandId }];
      case 'command/done':
        if (!this.replay || sessionId !== this.id || !d.text) return [];
        return say({ type: 'user', message: { role: 'user', content: `<local-command-stdout>${d.text}</local-command-stdout>` } });
      case 'user/message': {
        // A goal's round: dsh starts it by itself, so it opens a turn of its own, marked as such (not a message of yours).
        if (sessionId === this.id && d.source?.kind === 'goal') {
          const objective = /Objective: "([^"\n]*)"/.exec(textOf(d.content))?.[1] || '';
          const summary = objective ? t('Goal round {round}: {objective}', { round: d.source.round, objective }) : t('Goal round {round}', { round: d.source.round });
          return [this.stamp(sessionId, { type: 'user', replay: true, at: e.time, message: { role: 'user', content: `<task-notification><summary>${summary}</summary><status>completed</status></task-notification>` } })];
        }
        if (!this.replay || sessionId !== this.id || d.source?.kind !== 'user') return [];
        const images = imageBlocks(d.content);
        const text = textOf(d.content);
        return [{ ...this.stamp(sessionId, { type: 'user', message: { role: 'user', content: [...images, ...(text ? [{ type: 'text', text }] : [])] }, ...at }), uuid: d.id }];
      }
      case 'turn/start':
        if (sessionId === this.id) {
          this.turnStarted = e.time || Date.now();
          this.steps = 0;
        }
        return [];
      case 'step/start':
        if (sessionId === this.id) this.steps++;
        return [];
      case 'request/context':
        if (d.contextWindow) this.contextWindow = d.contextWindow;
        return [];
      case 'assistant/message': {
        const message = d.message || {};
        const stream = this.streams.get(sessionId);
        this.streams.delete(sessionId);
        if (d.usage && sessionId === this.id) {
          this.lastUsage = d.usage;
          this.usage.input += d.usage.inputTokens || 0;
          this.usage.output += d.usage.outputTokens || 0;
          this.usage.cacheRead += d.usage.cacheReadTokens || 0;
          this.usage.cacheWrite += d.usage.cacheWriteTokens || 0;
        }
        const content = [];
        for (const b of message.content || []) {
          if (b.type === 'reasoning') content.push({ type: 'thinking', thinking: b.text || '' });
          else if (b.type === 'text') content.push({ type: 'text', text: b.text || '' });
          else if (b.type === 'tool-call') {
            this.calls.set(b.id, { name: b.name, args: b.arguments });
            if (b.name === 'subagent' || b.name === 'subagent_fork') this.unassigned.push(b.id);
            content.push({ type: 'tool_use', id: b.id, name: toolName(b.name), input: toolInput(b.name, b.arguments) });
          }
        }
        return say({ type: 'assistant', message: { id: stream?.msgId || message.id, role: 'assistant', model: message.source?.model, content } });
      }
      case 'tool/call':
        if (this.replay) return [];
        return say({ type: 'tool_progress', tool_use_id: d.callId, tool_name: toolName(d.name), elapsed_time_seconds: 0 });
      case 'tool/result': {
        const message = d.message || {};
        const callId = message.toolCallId;
        const call = this.calls.get(callId);
        const text = textOf(message.content);
        const images = imageBlocks(message.content);
        const isSubagent = call?.name === 'subagent' || call?.name === 'subagent_fork';
        // A saved conversation has no one to report a background agent's end later, so its card doesn't wait.
        const data = this.replay && isSubagent ? null : toolData(call, d);
        return say({
          type: 'user',
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: callId, is_error: Boolean(message.isError), content: images.length ? [{ type: 'text', text }, ...images] : text }] },
          ...(data ? { tool_use_result: data } : {}),
        });
      }
      case 'turn/end': {
        if (sessionId !== this.id || this.replay) return [];
        return [this.stamp(sessionId, this.turnResult(d.reason || {}, e.time))];
      }
      case 'compaction/start':
        return sessionId === this.id ? say({ type: 'system', subtype: 'status', status: 'compacting' }) : [];
      case 'compaction/summary':
        return sessionId === this.id ? say({ type: 'system', subtype: 'compact_boundary', compact_metadata: { pre_tokens: d.preTokens || d.tokensBefore || 0 } }) : [];
      case 'compaction/end':
        return sessionId === this.id ? say({ type: 'system', subtype: 'status', status: null }) : [];
      case 'llm/retry-started':
        return sessionId === this.id ? say({ type: 'system', subtype: 'api_retry', error_status: d.status || d.error?.status, attempt: d.attempt, max_retries: d.maxAttempts ?? d.maxRetries }) : [];
      default:
        return [];
    }
  }

  turnResult(reason, time) {
    const stopped = ['aborted', 'interrupted', 'forked'].includes(reason.kind);
    const failed = reason.kind === 'error' || reason.kind === 'blocked';
    return {
      type: 'result',
      subtype: stopped ? 'error_during_execution' : failed ? 'error' : 'success',
      ...(stopped ? { terminal_reason: 'aborted' } : {}),
      ...(failed ? { errors: [reason.message || reason.error?.message || reason.reason || reason.kind] } : {}),
      duration_ms: this.turnStarted ? Math.max(0, (time || Date.now()) - this.turnStarted) : 0,
      num_turns: this.steps,
      result: '',
    };
  }

  subagentStarted({ childSessionId }) {
    const callId = this.unassigned.shift() || null;
    this.children.set(childSessionId, callId);
    const call = callId ? parse(this.calls.get(callId)?.args) : {};
    return [this.stamp(this.id, { type: 'system', subtype: 'task_started', task_id: childSessionId, tool_use_id: callId, description: call.description || '', subagent_type: '', task_type: 'local_agent' })];
  }

  subagentFinished({ childSessionId, status, stopReason, lastAssistantMessage }) {
    const stopped = stopReason === 'aborted' || stopReason === 'interrupted' || status === 'cancelled';
    return [this.stamp(this.id, {
      type: 'system', subtype: 'task_notification', task_id: childSessionId, tool_use_id: this.children.get(childSessionId) || null,
      status: stopped ? 'stopped' : status === 'ok' ? 'completed' : 'failed', summary: lastWords(lastAssistantMessage).slice(0, 2000),
    })];
  }
}
DshTranslator.next = 0;

// A saved conversation, event by event, as the chat's history reads it. Returns its messages.
function replayEvents(id, events) {
  const tr = new DshTranslator(id, { replay: true });
  return events.flatMap((e) => tr.event(id, e)).filter((m) => m.type === 'user' || m.type === 'assistant');
}

module.exports = { DshTranslator, replayEvents, toolName, askedQuestions };
