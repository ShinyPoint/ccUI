// Turns the Agent SDK message stream (plus a few local UI actions) into chat timeline state.
// Pure: reduce(state, messages) returns a new state and never mutates items of the old one,
// so memoized components re-render only the items that changed.

export function initialChat() {
  return {
    items: [], // timeline, in arrival order (subagent items carry `parent`)
    index: {}, // item key -> position in items
    children: {}, // parent tool_use_id -> [item keys]
    streams: {}, // stream (main or subagent) -> { msgId, blocks: { [blockIndex]: itemKey } }
    unconfirmed: {}, // assistant msgId -> { text: [keys], thinking: [keys] } streamed but not yet final
    permissions: [], // pending permission requests from canUseTool
    tasks: [], // [{ id, content, status, activeForm }]
    busy: false,
    activity: '', // 'requesting' | 'thinking' | 'compacting' | 'tool' | ''
    init: null,
    sessionId: null,
    costTotal: 0,
    turnHadText: false,
    seq: 0,
  };
}

const ERROR_TEXT = {
  authentication_failed: 'Claude Code could not authenticate. Add an Anthropic API key in Settings, or sign Claude Code in with an API account.',
  billing_error: 'The account has a billing problem, so the request was refused.',
  rate_limit: 'Rate limit reached. Wait a moment, then send your message again.',
  overloaded: 'The API is overloaded right now. Try again in a moment.',
  model_not_found: 'The selected model is not available for this account. Pick another model.',
  max_output_tokens: 'The reply hit the output length limit and was cut off.',
  oauth_org_not_allowed: 'This organization does not allow this login. Use an API key instead.',
};

const RUNNING = new Set(['streaming', 'pending', 'running']);

export function reduce(state, messages) {
  const d = {
    ...state,
    items: state.items.slice(),
    index: { ...state.index },
    children: { ...state.children },
    streams: { ...state.streams },
    unconfirmed: { ...state.unconfirmed },
  };
  for (const m of messages) apply(d, m, Date.now());
  return d;
}

// ---------- item helpers (operate on the draft) ----------
function add(d, item) {
  d.index[item.key] = d.items.length;
  d.items.push(item);
  if (item.parent) d.children[item.parent] = [...(d.children[item.parent] || []), item.key];
  return item;
}

function get(d, key) {
  const i = d.index[key];
  return i == null ? null : d.items[i];
}

function set(d, key, patch) {
  const i = d.index[key];
  if (i == null) return null;
  d.items[i] = { ...d.items[i], ...patch };
  return d.items[i];
}

const nextKey = (d, prefix) => `${prefix}:${++d.seq}`;

function notice(d, tone, text, key) {
  if (key && get(d, key)) return set(d, key, { tone, text });
  return add(d, { key: key || nextKey(d, 'notice'), type: 'notice', tone, text, parent: null });
}

function ensureTool(d, id, fields, now) {
  const existing = get(d, id);
  if (existing) return set(d, id, fields);
  return add(d, {
    key: id, type: 'tool', id, name: '', input: {}, inputJson: '', status: 'pending',
    result: null, data: null, isError: false, parent: null, startedAt: now, ...fields,
  });
}

function stopStreaming(d, interrupted, now) {
  d.items.forEach((item, i) => {
    if (item.streaming) d.items[i] = { ...item, streaming: false, endedAt: item.endedAt || now };
    else if (item.type === 'tool' && RUNNING.has(item.status) && interrupted) {
      d.items[i] = { ...item, status: 'cancelled', endedAt: now };
    }
  });
  d.streams = {};
  d.unconfirmed = {};
}

// `current` plus `extra` unless it already has it (a final block repeating what streamed, or empty).
function withText(current = '', extra = '') {
  if (!extra.trim() || current.includes(extra)) return current;
  return current.trim() ? `${current}\n\n${extra}` : extra;
}

// Queued messages Claude has taken off the queue (all of them, or the given uuids) stop showing as queued.
function pickedUp(d, uuids) {
  d.items.forEach((item, i) => {
    if (item.type === 'user' && item.queued && (!uuids || uuids.includes(item.key))) d.items[i] = { ...item, queued: false };
  });
}

function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

// Images a tool returned (e.g. Read of a picture): [{ mediaType, data } | { mediaType, omitted: true, bytes }].
function toolResultImages(content, data) {
  const images = (Array.isArray(content) ? content : [])
    .filter((c) => c.type === 'image')
    .map((c) => (c.omitted
      ? { mediaType: c.media_type, omitted: true, bytes: c.bytes }
      : { mediaType: c.source?.media_type, data: c.source?.data }));
  const file = data?.type === 'image' ? data.file : null;
  if (!images.length && file) {
    if (file.base64) images.push({ mediaType: file.type, data: file.base64 });
    else if (file.base64Omitted) images.push({ mediaType: file.type, omitted: true, bytes: file.bytes });
  }
  return images.length ? images : null;
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// ---------- task list (TodoWrite and the Task* tools) ----------
function trackTasks(d, tool) {
  const { name, input = {}, id } = tool;
  if (name === 'TodoWrite' && Array.isArray(input.todos)) {
    d.tasks = input.todos.map((t, i) => ({ id: String(i + 1), content: t.content, status: t.status, activeForm: t.activeForm }));
  } else if (name === 'TaskUpdate' && input.taskId) {
    if (input.status === 'deleted') d.tasks = d.tasks.filter((t) => t.id !== String(input.taskId));
    else {
      d.tasks = d.tasks.map((t) => (t.id === String(input.taskId) ? {
        ...t,
        ...(input.status ? { status: input.status } : {}),
        ...(input.subject ? { content: input.subject } : {}),
        ...(input.activeForm ? { activeForm: input.activeForm } : {}),
      } : t));
    }
  } else if (name === 'TaskCreate' && input.subject && !d.tasks.some((t) => t.toolId === id)) {
    d.tasks = [...d.tasks, { id, toolId: id, content: input.subject, status: 'pending', activeForm: input.activeForm }];
  }
}

function trackTaskResult(d, tool, data) {
  const realId = data?.task?.id;
  if (tool.name === 'TaskCreate' && realId) {
    d.tasks = d.tasks.map((t) => (t.toolId === tool.id ? { ...t, id: String(realId) } : t));
  }
}

// ---------- transcript text that Claude Code stores but people don't type ----------
function replayUserText(d, text) {
  const command = /<command-name>([\s\S]*?)<\/command-name>/.exec(text);
  if (command) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim();
    return { text: `${command[1].trim()}${args ? ` ${args}` : ''}` };
  }
  const stdout = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/.exec(text);
  if (stdout) {
    if (stdout[1].trim()) add(d, { key: nextKey(d, 'out'), type: 'command-output', text: stdout[1].trim(), parent: null });
    return null;
  }
  if (/^\[Request interrupted/.test(text)) {
    notice(d, 'info', 'Interrupted');
    return null;
  }
  if (/^(Caveat:|<system-reminder>|<local-command-caveat>)/.test(text.trim())) return null;
  return { text };
}

// ---------- message handlers ----------
function apply(d, m, now) {
  // A message queued during the previous turn starts a new turn right after that turn's result.
  if (!m.replay && (m.type === 'stream_event' || m.type === 'assistant' || m.type === 'tool_progress')) {
    if (!d.busy) pickedUp(d);
    d.busy = true;
  }
  // Claude Code stamps replies and results with the uuids of the messages they answer.
  if (m.user_message_uuid) pickedUp(d, [m.user_message_uuid]);
  if (Array.isArray(m.user_message_uuids)) pickedUp(d, m.user_message_uuids);
  switch (m.type) {
    case 'stream_event': return onStream(d, m, now);
    case 'assistant': return onAssistant(d, m, now);
    case 'user': return onUser(d, m, now);
    case 'result': return onResult(d, m, now);
    case 'system': return onSystem(d, m, now);
    case 'tool_progress': {
      const tool = get(d, m.tool_use_id);
      if (tool && RUNNING.has(tool.status)) set(d, m.tool_use_id, { status: 'running', elapsed: m.elapsed_time_seconds });
      if (!m.parent_tool_use_id) d.activity = 'tool';
      return;
    }
    case 'conversation_reset':
      Object.assign(d, { ...initialChat(), init: d.init, sessionId: m.new_conversation_id || d.sessionId, costTotal: d.costTotal });
      notice(d, 'info', 'Started a new conversation.');
      return;
    case 'rate_limit_event': {
      const info = m.rate_limit_info || {};
      if (info.status && info.status !== 'allowed' && info.status !== 'allowed_warning') {
        const reset = info.resetsAt ? ` Resets ${new Date(info.resetsAt * 1000).toLocaleTimeString()}.` : '';
        notice(d, 'warn', `Usage limit reached.${reset}`, 'rate-limit');
      }
      return;
    }

    // Local UI actions
    case 'ui/user':
      // Sent while Claude is working: it waits in Claude Code's queue until Claude picks it up.
      add(d, { key: m.uuid || nextKey(d, 'user'), type: 'user', text: m.text, images: m.images || [], parent: null, at: now, queued: d.busy });
      if (!d.busy) { // a queued message leaves the running turn as it is
        d.activity = 'requesting';
        d.turnHadText = false;
      }
      d.busy = true;
      return;
    case 'ui/unsent': {
      // Queued messages cancelled by Stop: they never reached Claude.
      const gone = new Set(m.uuids);
      d.items = d.items.filter((item) => !(item.type === 'user' && gone.has(item.key)));
      d.index = Object.fromEntries(d.items.map((item, i) => [item.key, i]));
      return;
    }
    case 'ui/permission':
      d.permissions = [...d.permissions, m.request];
      return;
    case 'ui/permission-done':
      d.permissions = d.permissions.filter((p) => p.requestId !== m.requestId);
      if (m.toolUseID && m.decision) set(d, m.toolUseID, { decision: m.decision });
      return;
    case 'ui/notice':
      notice(d, m.tone || 'info', m.text, m.key);
      return;
    case 'ui/history':
      for (const sm of m.messages) {
        if (sm.type === 'user' || sm.type === 'assistant') apply(d, { ...sm, replay: true }, now);
      }
      stopStreaming(d, true, now); // tools without a result in the transcript never ran
      if (m.messages.length) add(d, { key: nextKey(d, 'divider'), type: 'divider', text: 'Earlier in this conversation', parent: null });
      return;
    case 'ui/exit':
      d.busy = false;
      d.activity = '';
      d.permissions = [];
      stopStreaming(d, true, now);
      if (m.error) notice(d, 'error', `Claude Code stopped: ${m.error}`);
      return;
    default:
  }
}

function onStream(d, m, now) {
  const streamKey = m.parent_tool_use_id || 'main';
  const parent = m.parent_tool_use_id || null;
  const ev = m.event || {};
  const stream = d.streams[streamKey];
  switch (ev.type) {
    case 'message_start':
      d.streams[streamKey] = { msgId: ev.message?.id, blocks: {} };
      return;
    case 'content_block_start': {
      if (!stream) return;
      const b = ev.content_block || {};
      let key = null;
      // Claude Code sends one thinking step as consecutive thinking blocks (a long hidden one without text,
      // then a short one with the summary): they continue the same item.
      const prevKey = stream.blocks[ev.index - 1];
      const prev = b.type === 'thinking' && prevKey ? get(d, prevKey) : null;
      if (prev?.type === 'thinking') {
        key = prevKey;
        set(d, key, { streaming: true, endedAt: undefined });
        const pending = d.unconfirmed[stream.msgId] || { text: [], thinking: [] };
        d.unconfirmed[stream.msgId] = { ...pending, thinking: [...pending.thinking, key] };
        if (!parent) d.activity = 'thinking';
      } else if (b.type === 'text' || b.type === 'thinking') {
        key = `${b.type}:${stream.msgId}:${ev.index}`;
        if (!get(d, key)) add(d, { key, type: b.type, msgId: stream.msgId, text: b.text || b.thinking || '', streaming: true, parent, startedAt: now });
        const pending = d.unconfirmed[stream.msgId] || { text: [], thinking: [] };
        d.unconfirmed[stream.msgId] = { ...pending, [b.type]: [...pending[b.type], key] };
        if (b.type === 'thinking' && !parent) d.activity = 'thinking';
        if (b.type === 'text' && !parent) { d.turnHadText = true; d.activity = ''; }
      } else if (b.id && /tool_use$/.test(b.type)) {
        key = b.id;
        ensureTool(d, b.id, { name: b.name, status: 'streaming', parent }, now);
      }
      if (key) d.streams[streamKey] = { ...stream, blocks: { ...stream.blocks, [ev.index]: key } };
      return;
    }
    case 'content_block_delta': {
      const key = stream?.blocks[ev.index];
      const item = key && get(d, key);
      if (!item) return;
      const delta = ev.delta || {};
      if (delta.type === 'text_delta') set(d, key, { text: item.text + delta.text });
      else if (delta.type === 'thinking_delta') set(d, key, { text: item.text + delta.thinking });
      else if (delta.type === 'input_json_delta') set(d, key, { inputJson: item.inputJson + delta.partial_json });
      return;
    }
    case 'content_block_stop': {
      const key = stream?.blocks[ev.index];
      const item = key && get(d, key);
      if (!item) return;
      if (item.type === 'tool') {
        const input = parseJson(item.inputJson);
        set(d, key, { status: item.status === 'streaming' ? 'pending' : item.status, ...(input ? { input } : {}) });
      } else {
        set(d, key, { streaming: false, endedAt: now });
      }
      return;
    }
    default:
  }
}

function onAssistant(d, m, now) {
  const msgId = m.message?.id;
  const parent = m.parent_tool_use_id || null;
  for (const b of m.message?.content || []) {
    if (b.type === 'text' || b.type === 'thinking') {
      const text = b.type === 'text' ? b.text : b.thinking;
      const pending = msgId && d.unconfirmed[msgId];
      const key = pending?.[b.type]?.[0];
      if (key) {
        d.unconfirmed[msgId] = { ...pending, [b.type]: pending[b.type].slice(1) };
        const item = get(d, key);
        // Thinking keeps what was streamed: one item can span several blocks, and Claude Code's final copy
        // of a hidden block is empty.
        const keep = b.type === 'thinking' && item?.text?.trim();
        set(d, key, { text: keep ? item.text : text, streaming: false, endedAt: item?.endedAt || now });
      } else if (text) {
        add(d, { key: nextKey(d, b.type), type: b.type, text, streaming: false, parent, startedAt: now, endedAt: now, msgId });
      }
      if (b.type === 'text' && text?.trim() && !parent) d.turnHadText = true;
    } else if (b.id && /tool_use$/.test(b.type)) {
      const existing = get(d, b.id);
      const status = !existing || existing.status === 'streaming' ? 'pending' : existing.status;
      const tool = ensureTool(d, b.id, { name: b.name, input: b.input || {}, status, parent }, now);
      trackTasks(d, tool);
    }
  }
  if (m.error && !m.replay) notice(d, 'error', ERROR_TEXT[m.error] || `Request failed (${m.error}).`);
}

function onUser(d, m, now) {
  const content = m.message?.content;
  const parent = m.parent_tool_use_id || null;
  if (typeof content === 'string') {
    if (m.replay && !parent) {
      const shown = replayUserText(d, content);
      if (shown) add(d, { key: m.uuid || nextKey(d, 'user'), type: 'user', text: shown.text, images: [], parent: null });
    }
    return;
  }
  if (!Array.isArray(content)) return;
  const texts = [];
  const images = [];
  for (const b of content) {
    if (b.type === 'tool_result') {
      const tool = get(d, b.tool_use_id) || ensureTool(d, b.tool_use_id, { name: 'Tool', parent }, now);
      const data = m.tool_use_result ?? tool.data;
      set(d, b.tool_use_id, {
        status: b.is_error ? 'error' : 'done',
        isError: !!b.is_error,
        result: toolResultText(b.content),
        data: data && typeof data === 'object' ? data : null,
        images: toolResultImages(b.content, data),
        endedAt: now,
      });
      trackTaskResult(d, tool, data);
    } else if (b.type === 'text') texts.push(b.text);
    else if (b.type === 'image') images.push({ mediaType: b.source?.media_type, data: b.source?.data });
  }
  if (m.replay && !parent && (texts.length || images.length)) {
    const shown = texts.length ? replayUserText(d, texts.join('\n')) : { text: '' };
    if (shown) add(d, { key: m.uuid || nextKey(d, 'user'), type: 'user', text: shown.text, images, parent: null });
  }
}

function onResult(d, m, now) {
  // Stop ends the turn as error_during_execution too, with only internal "[ede_diagnostic]" lines and an
  // aborted terminal_reason; anything else under that subtype is a real failure and is shown.
  const realErrors = (m.errors || []).filter((e) => !/^\[ede_diagnostic\]/.test(e));
  const interrupted = m.subtype === 'error_during_execution'
    && (/^aborted/.test(m.terminal_reason || '') || !realErrors.length);
  m = { ...m, errors: realErrors };
  stopStreaming(d, true, now);
  const total = typeof m.total_cost_usd === 'number' ? m.total_cost_usd : d.costTotal;
  const cost = Math.max(0, total - d.costTotal);
  d.costTotal = total;

  if (m.subtype === 'success' && !d.turnHadText && m.result) {
    add(d, { key: nextKey(d, 'out'), type: 'command-output', text: m.result, parent: null });
  } else if (m.subtype !== 'success' && !interrupted) {
    notice(d, 'error', m.errors?.length ? m.errors.join('\n') : `The turn ended early (${m.subtype}).`);
  }
  add(d, {
    key: nextKey(d, 'turn'), type: 'turn', parent: null,
    durationMs: m.duration_ms, cost, interrupted, numTurns: m.num_turns,
  });
  d.busy = false;
  d.activity = '';
  d.turnHadText = false;
}

function onSystem(d, m, now) {
  switch (m.subtype) {
    case 'init':
      d.init = {
        model: m.model,
        permissionMode: m.permissionMode,
        cwd: m.cwd,
        tools: m.tools,
        slashCommands: m.slash_commands,
        terminalCommands: m.terminal_slash_commands || [],
        mcpServers: m.mcp_servers,
        version: m.claude_code_version,
        apiKeySource: m.apiKeySource,
      };
      d.sessionId = m.session_id;
      return;
    case 'status':
      d.activity = m.status === 'compacting' ? 'compacting' : m.status === 'requesting' ? 'requesting' : d.busy ? d.activity : '';
      if (m.permissionMode && d.init) d.init = { ...d.init, permissionMode: m.permissionMode };
      if (m.compact_result === 'failed') notice(d, 'error', `Compacting failed${m.compact_error ? `: ${m.compact_error}` : '.'}`);
      return;
    case 'thinking_tokens':
      if (d.busy) d.activity = 'thinking';
      return;
    case 'compact_boundary': {
      const meta = m.compact_metadata || {};
      const tokens = meta.pre_tokens ? ` (${Math.round(meta.pre_tokens / 1000)}k tokens summarized)` : '';
      add(d, { key: nextKey(d, 'divider'), type: 'divider', text: `Conversation compacted${tokens}`, parent: null });
      return;
    }
    case 'api_retry':
      notice(d, 'warn', `Request failed${m.error_status ? ` (${m.error_status})` : ''}. Retrying, attempt ${m.attempt} of ${m.max_retries}…`, 'api-retry');
      return;
    case 'local_command_output':
      if (m.content?.trim()) add(d, { key: nextKey(d, 'out'), type: 'command-output', text: m.content, parent: null });
      d.turnHadText = true;
      return;
    case 'informational':
      notice(d, m.level === 'warning' ? 'warn' : 'info', m.content);
      return;
    case 'notification':
      if (m.priority === 'high' || m.priority === 'immediate') notice(d, 'info', m.text, `notification:${m.key}`);
      return;
    case 'permission_denied':
      set(d, m.tool_use_id, { decision: 'denied', deniedReason: m.message });
      return;
    default:
  }
}

// ---------- selectors ----------
export function topLevel(state) {
  return state.items.filter((item) => !item.parent);
}

export function childrenOf(state, toolId) {
  return (state.children[toolId] || []).map((key) => state.items[state.index[key]]);
}

// Splits top-level items into turns: the prompt, Claude's work (tool calls, thinking, and text between
// them), the answer (whatever follows the last step), and the turn summary. Items outside any turn are
// passed through. A turn is `live` while Claude is still busy with it: the last turn, or one followed only
// by messages sent while it ran (they wait in the queue, so the turn has not ended).
export function groupTurns(items, busy) {
  const out = [];
  let turn = null;
  const close = (live) => {
    if (!turn) return;
    const body = turn.body.filter((i) => i.type !== 'turn');
    let lastStep = -1;
    body.forEach((i, n) => { if (i.type === 'tool' || i.type === 'thinking') lastStep = n; });
    const work = body.slice(0, lastStep + 1);
    out.push({
      kind: 'turn',
      key: turn.user.key,
      user: turn.user,
      work: work.filter((i) => !(i.type === 'notice' && i.tone === 'error')),
      errors: work.filter((i) => i.type === 'notice' && i.tone === 'error'),
      answer: body.slice(lastStep + 1),
      end: turn.body.find((i) => i.type === 'turn') || null,
      live,
    });
    turn = null;
  };
  for (const item of items) {
    if (item.type === 'user') {
      close(busy && item.queued);
      turn = { user: item, body: [] };
    } else if (!turn || item.type === 'divider') {
      close(false);
      out.push({ kind: 'item', item });
    } else {
      turn.body.push(item);
      if (item.type === 'turn') close(false);
    }
  }
  close(busy);
  return out;
}

export function currentActivity(state) {
  if (state.permissions.length) return 'Waiting for your answer';
  if (!state.busy) return '';
  if (state.activity === 'compacting') return 'Compacting the conversation…';
  if (state.activity === 'thinking') return 'Thinking…';
  const running = [...state.items].reverse().find((i) => i.type === 'tool' && i.status === 'running' && !i.parent);
  if (running) return `Running ${running.name}…`;
  return 'Working…';
}
