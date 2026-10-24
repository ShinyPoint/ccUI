import test from 'node:test';
import assert from 'node:assert/strict';
import { initialChat, reduce, topLevel, childrenOf, currentActivity, groupTurns, backgroundTasks, before } from '../src/renderer/lib/chat-reducer.js';

const stream = (event, parent = null) => ({ type: 'stream_event', event, parent_tool_use_id: parent });
const start = (id) => stream({ type: 'message_start', message: { id } });
const blockStart = (index, block, parent) => stream({ type: 'content_block_start', index, content_block: block }, parent);
const delta = (index, d, parent) => stream({ type: 'content_block_delta', index, delta: d }, parent);
const stop = (index, parent) => stream({ type: 'content_block_stop', index }, parent);
const assistant = (id, content, parent = null) => ({ type: 'assistant', message: { id, content }, parent_tool_use_id: parent });
const toolResult = (id, content, data, isError = false) => ({
  type: 'user', parent_tool_use_id: null, tool_use_result: data,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
});
const result = (cost, extra = {}) => ({ type: 'result', subtype: 'success', total_cost_usd: cost, duration_ms: 1200, num_turns: 1, result: '', ...extra });

test('streamed text is reconciled with the final assistant message instead of duplicated', () => {
  let s = reduce(initialChat(), [{ type: 'ui/user', uuid: 'u1', text: 'hi' }]);
  s = reduce(s, [start('m1'), blockStart(0, { type: 'text', text: '' }), delta(0, { type: 'text_delta', text: 'Hel' }), delta(0, { type: 'text_delta', text: 'lo' })]);
  let text = s.items.find((i) => i.type === 'text');
  assert.equal(text.text, 'Hello');
  assert.equal(text.streaming, true);
  s = reduce(s, [stop(0), assistant('m1', [{ type: 'text', text: 'Hello!' }])]);
  const texts = s.items.filter((i) => i.type === 'text');
  assert.equal(texts.length, 1);
  assert.equal(texts[0].text, 'Hello!');
  assert.equal(texts[0].streaming, false);
});

test('tool calls: streamed input, final input, result data, and status', () => {
  let s = reduce(initialChat(), [
    { type: 'ui/user', text: 'edit it' },
    start('m2'),
    blockStart(0, { type: 'tool_use', id: 't1', name: 'Edit', input: {} }),
    delta(0, { type: 'input_json_delta', partial_json: '{"file_path":"a.js",' }),
    delta(0, { type: 'input_json_delta', partial_json: '"old_string":"x","new_string":"y"}' }),
    stop(0),
  ]);
  let tool = s.items[s.index.t1];
  assert.equal(tool.status, 'pending');
  assert.equal(tool.input.file_path, 'a.js');
  s = reduce(s, [
    assistant('m2', [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'a.js', old_string: 'x', new_string: 'y' } }]),
    toolResult('t1', 'The file a.js has been updated.', { structuredPatch: [{ oldStart: 1, lines: ['-x', '+y'] }], originalFile: null }),
  ]);
  tool = s.items[s.index.t1];
  assert.equal(tool.status, 'done');
  assert.equal(tool.result, 'The file a.js has been updated.');
  assert.equal(tool.data.structuredPatch[0].lines[1], '+y');
  assert.equal(s.items.filter((i) => i.type === 'tool').length, 1);
});

test('subagent messages nest under their Agent tool call', () => {
  let s = reduce(initialChat(), [
    assistant('m1', [{ type: 'tool_use', id: 'agent1', name: 'Agent', input: { description: 'Look around' } }]),
    assistant('s1', [{ type: 'tool_use', id: 'g1', name: 'Grep', input: { pattern: 'foo' } }], 'agent1'),
    toolResult('g1', 'a.js:1:foo'),
  ]);
  s.items[s.index.g1].parent === 'agent1' || assert.fail('grep should be nested');
  assert.deepEqual(topLevel(s).map((i) => i.key), ['agent1']);
  assert.deepEqual(childrenOf(s, 'agent1').map((i) => i.key), ['g1']);
});

test('result computes per-turn cost from the running total and ends the turn', () => {
  let s = reduce(initialChat(), [{ type: 'ui/user', text: 'a' }, assistant('m1', [{ type: 'text', text: 'one' }]), result(0.04)]);
  s = reduce(s, [{ type: 'ui/user', text: 'b' }, assistant('m2', [{ type: 'text', text: 'two' }]), result(0.1)]);
  const turns = s.items.filter((i) => i.type === 'turn');
  assert.equal(turns.length, 2);
  assert.ok(Math.abs(turns[1].cost - 0.06) < 1e-9);
  assert.equal(s.busy, false);
  assert.equal(s.costTotal, 0.1);
});

test('a slash command with no assistant text shows its output', () => {
  const s = reduce(initialChat(), [{ type: 'ui/user', text: '/context' }, result(0, { num_turns: 0, result: '## Context Usage' })]);
  const out = s.items.find((i) => i.type === 'command-output');
  assert.equal(out.text, '## Context Usage');
});

test('interrupting cancels tools that never finished', () => {
  const s = reduce(initialChat(), [
    { type: 'ui/user', text: 'go' },
    assistant('m1', [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'sleep 9' } }]),
    { type: 'result', subtype: 'error_during_execution', total_cost_usd: 0.01, duration_ms: 50, num_turns: 1, errors: [] },
  ]);
  assert.equal(s.items[s.index.b1].status, 'cancelled');
  assert.equal(s.items.find((i) => i.type === 'turn').interrupted, true);
  assert.equal(s.items.filter((i) => i.type === 'notice').length, 0);
});

test('TodoWrite and Task tools drive the task list', () => {
  let s = reduce(initialChat(), [assistant('m1', [{ type: 'tool_use', id: 'w1', name: 'TodoWrite', input: { todos: [
    { content: 'Read code', status: 'completed', activeForm: 'Reading code' },
    { content: 'Write tests', status: 'in_progress', activeForm: 'Writing tests' },
  ] } }])]);
  assert.deepEqual(s.tasks.map((t) => t.status), ['completed', 'in_progress']);

  s = reduce(initialChat(), [
    assistant('m1', [{ type: 'tool_use', id: 'c1', name: 'TaskCreate', input: { subject: 'Ship it' } }]),
    toolResult('c1', 'Task #7 created', { task: { id: '7', subject: 'Ship it' } }),
    assistant('m2', [{ type: 'tool_use', id: 'u1', name: 'TaskUpdate', input: { taskId: '7', status: 'completed' } }]),
  ]);
  assert.deepEqual(s.tasks.map((t) => [t.id, t.status]), [['7', 'completed']]);
});

test('permissions are tracked and reflected in activity', () => {
  let s = reduce(initialChat(), [{ type: 'ui/user', text: 'x' }, { type: 'ui/permission', request: { requestId: 'r1', toolName: 'Bash', toolUseID: 't9' } }]);
  assert.equal(currentActivity(s), 'Waiting for your answer');
  s = reduce(s, [{ type: 'ui/permission-done', requestId: 'r1', toolUseID: 't9', decision: 'allowed' }]);
  assert.equal(s.permissions.length, 0);
});

test('history replay hides transcript plumbing and keeps real prompts', () => {
  const s = reduce(initialChat(), [{ type: 'ui/history', messages: [
    { type: 'user', message: { role: 'user', content: 'Fix the bug' }, parent_tool_use_id: null, uuid: 'h1' },
    { type: 'assistant', message: { id: 'a1', content: [{ type: 'text', text: 'Done.' }] }, parent_tool_use_id: null },
    { type: 'user', message: { role: 'user', content: 'Caveat: The messages below were generated by the user while running local commands.' }, parent_tool_use_id: null },
    { type: 'user', message: { role: 'user', content: '<command-name>/context</command-name>\n<command-args></command-args>' }, parent_tool_use_id: null },
    { type: 'user', message: { role: 'user', content: '<local-command-stdout>42% used</local-command-stdout>' }, parent_tool_use_id: null },
  ] }]);
  assert.deepEqual(s.items.map((i) => i.type), ['user', 'text', 'user', 'command-output', 'divider']);
  assert.equal(s.items[2].text, '/context');
  assert.equal(s.busy, false);
});

test('groupTurns separates working steps from the final answer', () => {
  const s = reduce(initialChat(), [
    { type: 'ui/user', uuid: 'u1', text: 'fix it' },
    assistant('m1', [{ type: 'text', text: 'Let me look.' }]),
    assistant('m1', [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.js' } }]),
    toolResult('t1', 'code'),
    assistant('m2', [{ type: 'text', text: 'Fixed: the loop was off by one.' }]),
    result(0.02),
    { type: 'ui/user', uuid: 'u2', text: 'thanks' },
    assistant('m3', [{ type: 'text', text: 'You are welcome.' }]),
  ]);
  const groups = groupTurns(topLevel(s), true);
  assert.equal(groups.length, 2);
  const [first, second] = groups;
  assert.deepEqual(first.work.map((i) => i.type), ['text', 'tool']);
  assert.deepEqual(first.answer.map((i) => i.text), ['Fixed: the loop was off by one.']);
  assert.equal(first.end.type, 'turn');
  assert.equal(first.live, false);
  assert.equal(second.live, true); // still running
  assert.equal(second.work.length, 0);
});

test('an answer followed by a step or two of tidying up is still the answer', () => {
  const answer = `## Binary search\n\nThe condition must be monotonic:\n\n\`\`\`\nF F F T T T\n\`\`\`\n\n- template 1\n- template 2\n- template 3`;
  const tidy = reduce(initialChat(), [
    { type: 'ui/user', uuid: 'u1', text: 'binary search templates?' },
    assistant('m1', [{ type: 'thinking', thinking: 'Plan the answer.' }]),
    assistant('m1', [{ type: 'text', text: answer }]),
    assistant('m1', [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'memory.md', old_string: 'a', new_string: 'b' } }]),
    toolResult('t1', 'ok'),
    assistant('m2', [{ type: 'thinking', thinking: 'Sum up.' }]),
    assistant('m2', [{ type: 'text', text: 'I also noted that templates get comments.' }]),
    result(0.02),
  ]);
  const [turn] = groupTurns(topLevel(tidy), false);
  assert.deepEqual(turn.answer.map((i) => i.text), [answer, 'I also noted that templates get comments.']);
  assert.deepEqual(turn.work.map((i) => i.type), ['thinking', 'tool', 'thinking']);

  // A remark on the way, or text followed by real work (more than two steps), stays with the work.
  const busy = reduce(initialChat(), [
    { type: 'ui/user', uuid: 'u2', text: 'fix it' },
    assistant('m3', [{ type: 'text', text: answer }]),
    ...['t2', 't3', 't4'].flatMap((id) => [assistant('m3', [{ type: 'tool_use', id, name: 'Read', input: { file_path: `${id}.js` } }]), toolResult(id, 'code')]),
    assistant('m4', [{ type: 'text', text: 'Fixed.' }]),
    result(0.02),
  ]);
  const [work] = groupTurns(topLevel(busy), false);
  assert.deepEqual(work.answer.map((i) => i.text), ['Fixed.']);
  assert.deepEqual(work.work.map((i) => i.type), ['text', 'tool', 'tool', 'tool']);
});

test('before a message: what came earlier, the same items, and nothing from it on', () => {
  const s = reduce(initialChat(), [
    { type: 'ui/user', uuid: 'u1', text: 'plan it' },
    assistant('m1', [{ type: 'tool_use', id: 't1', name: 'TodoWrite', input: { todos: [{ content: 'Plan', status: 'completed', activeForm: 'Planning' }] } }]),
    toolResult('t1', 'ok'),
    assistant('m1', [{ type: 'text', text: 'Planned.' }]),
    result(0.01),
    { type: 'ui/user', uuid: 'u2', text: 'do it' },
    assistant('m2', [{ type: 'tool_use', id: 't2', name: 'TodoWrite', input: { todos: [{ content: 'Plan', status: 'completed', activeForm: 'Planning' }, { content: 'Build', status: 'in_progress', activeForm: 'Building' }] } }]),
    assistant('m2', [{ type: 'tool_use', id: 't3', name: 'Agent', input: { description: 'Look around', prompt: 'look' } }]),
    assistant('m3', [{ type: 'tool_use', id: 'c1', name: 'Read', input: { file_path: 'a.js' } }], 't3'),
  ]);
  const b = before(s, 'u2');
  assert.deepEqual(b.items.map((i) => i.key), s.items.slice(0, s.index.u2).map((i) => i.key));
  assert.ok(b.items.every((item, i) => item === s.items[i]), 'the same item objects');
  assert.equal(b.index.u2, undefined);
  assert.deepEqual(b.children, {});
  assert.deepEqual(b.tasks.map((x) => x.content), ['Plan']);
  assert.equal(b.busy, false);
  assert.equal(b.permissions.length, 0);
  assert.equal(before(s, 'nope'), s);
});

test('image reads keep a preview, or say why there is none', async () => {
  const { createRequire } = await import('node:module');
  const { slim } = createRequire(import.meta.url)('../src/main/agent.js');
  const imageResult = (b64) => ({
    type: 'user', parent_tool_use_id: null,
    tool_use_result: { type: 'image', file: { base64: b64, type: 'image/png', originalSize: 1234, dimensions: { originalWidth: 640, originalHeight: 480 } } },
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r1', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } }] }] },
  });
  const read = assistant('m1', [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'shot.png' } }]);

  // small image: one copy survives slimming and becomes a preview
  const small = slim(imageResult('iVBORw0KGgo'));
  assert.equal(small.tool_use_result.file.base64, undefined);
  let s = reduce(initialChat(), [read, small]);
  assert.deepEqual(s.items[s.index.r1].images, [{ mediaType: 'image/png', data: 'iVBORw0KGgo' }]);
  assert.equal(s.items[s.index.r1].data.file.dimensions.originalWidth, 640);

  // large image: no data is forwarded, the card can explain why
  const big = slim(imageResult('A'.repeat(5 * 1024 * 1024)));
  s = reduce(initialChat(), [read, big]);
  const [img] = s.items[s.index.r1].images;
  assert.equal(img.omitted, true);
  assert.equal(img.data, undefined);
  assert.ok(img.bytes > 3 * 1024 * 1024);
});

test('reduce never mutates items of the previous state', () => {
  const a = reduce(initialChat(), [start('m1'), blockStart(0, { type: 'text', text: '' })]);
  const before = a.items[0];
  const b = reduce(a, [delta(0, { type: 'text_delta', text: 'x' })]);
  assert.equal(before.text, '');
  assert.equal(b.items[0].text, 'x');
  assert.notEqual(a.items, b.items);
});

test('a message sent while Claude works is queued until picked up, and Stop can unsend it', () => {
  let s = reduce(initialChat(), [{ type: 'ui/user', uuid: 'u1', text: 'first' }]);
  assert.equal(s.items[0].queued, false);
  s = reduce(s, [{ type: 'ui/user', uuid: 'u2', text: 'second' }, { type: 'ui/user', uuid: 'u3', text: 'third' }]);
  assert.deepEqual(s.items.map((i) => i.queued), [false, true, true]);
  // Claude Code stamps the reply with the uuid it answers.
  s = reduce(s, [{ ...assistant('m1', [{ type: 'text', text: 'ok' }]), user_message_uuid: 'u2' }]);
  assert.deepEqual(s.items.filter((i) => i.type === 'user').map((i) => i.queued), [false, false, true]);
  // Stop cancels what is still queued: it leaves the timeline.
  s = reduce(s, [{ type: 'ui/unsent', uuids: ['u3'] }]);
  assert.deepEqual(s.items.filter((i) => i.type === 'user').map((i) => i.key), ['u1', 'u2']);
  assert.equal(s.items[s.index.u2].key, 'u2');
});

test('a queued message that starts the next turn stops showing as queued', () => {
  let s = reduce(initialChat(), [{ type: 'ui/user', uuid: 'u1', text: 'a' }, { type: 'ui/user', uuid: 'u2', text: 'b' }]);
  s = reduce(s, [assistant('m1', [{ type: 'text', text: 'one' }]), result(0.01)]);
  assert.equal(s.items[s.index.u2].queued, true);
  s = reduce(s, [assistant('m2', [{ type: 'text', text: 'two' }])]);
  assert.equal(s.items[s.index.u2].queued, false);
});

test('a turn stays open (not folded) while a message sent during it is queued', () => {
  const s = reduce(initialChat(), [
    { type: 'ui/user', uuid: 'u1', text: 'run it' },
    assistant('m1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'sleep 20' } }]),
    { type: 'ui/user', uuid: 'u2', text: 'and then this' },
  ]);
  const turns = groupTurns(topLevel(s), s.busy).filter((g) => g.kind === 'turn');
  assert.deepEqual(turns.map((g) => [g.key, g.live]), [['u1', true], ['u2', true]]);
});

test('a hidden thinking block and its summary block become one thinking item that keeps the summary', () => {
  // The shape Claude Code streams: block 0 thinking with no text (its final copy is empty too), then block 1
  // thinking with the visible summary, then a tool call — all in one API message.
  const ev = (event) => ({ type: 'stream_event', parent_tool_use_id: null, event });
  const thinkingMsg = (text) => ({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'thinking', thinking: text, signature: 'sig' }] } });
  const s = reduce(initialChat(), [
    { type: 'ui/user', uuid: 'u1', text: 'go' },
    ev({ type: 'message_start', message: { id: 'm1' } }),
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
    ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } }),
    thinkingMsg(''),
    ev({ type: 'content_block_stop', index: 0 }),
    ev({ type: 'content_block_start', index: 1, content_block: { type: 'thinking', thinking: '' } }),
    ev({ type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: 'Plan: read the file first.' } }),
    thinkingMsg('Plan: read the file first.'),
    ev({ type: 'content_block_stop', index: 1 }),
    ev({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 't1', name: 'Read' } }),
  ]);
  const thinking = s.items.filter((i) => i.type === 'thinking');
  assert.equal(thinking.length, 1);
  assert.equal(thinking[0].text, 'Plan: read the file first.');
  assert.equal(thinking[0].streaming, false);
  assert.ok(thinking[0].endedAt >= thinking[0].startedAt);
});

test('a streamed thinking block is not emptied by its empty final copy', () => {
  const ev = (event) => ({ type: 'stream_event', parent_tool_use_id: null, event });
  const s = reduce(initialChat(), [
    { type: 'ui/user', uuid: 'u1', text: 'go' },
    ev({ type: 'message_start', message: { id: 'm2' } }),
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
    ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'long reasoning' } }),
    { type: 'assistant', parent_tool_use_id: null, message: { id: 'm2', content: [{ type: 'thinking', thinking: '' }] } },
    ev({ type: 'content_block_stop', index: 0 }),
  ]);
  assert.equal(s.items.find((i) => i.type === 'thinking').text, 'long reasoning');
});

test('Stop shows as stopped, a real execution error shows its message', () => {
  const stopped = reduce(initialChat(), [
    { type: 'ui/user', uuid: 'u1', text: 'go' },
    result(0, { subtype: 'error_during_execution', terminal_reason: 'aborted_tools', errors: ['[ede_diagnostic] result_type=user stop_reason=tool_use'] }),
  ]);
  assert.equal(stopped.items.find((i) => i.type === 'turn').interrupted, true);
  assert.equal(stopped.items.filter((i) => i.type === 'notice' && i.tone === 'error').length, 0);
  const failed = reduce(initialChat(), [
    { type: 'ui/user', uuid: 'u1', text: 'go' },
    result(0, { subtype: 'error_during_execution', terminal_reason: 'model_error', errors: ['API Error: 529 overloaded'] }),
  ]);
  assert.equal(failed.items.find((i) => i.type === 'turn').interrupted, false);
  assert.match(failed.items.find((i) => i.type === 'notice').text, /overloaded/);
});

test('queuing a message mid-turn does not repeat the answer as command output', () => {
  const s = reduce(initialChat(), [
    { type: 'ui/user', uuid: 'u1', text: 'a' },
    assistant('m1', [{ type: 'text', text: 'the answer' }]),
    { type: 'ui/user', uuid: 'u2', text: 'b' },
    result(0.01, { result: 'the answer' }),
  ]);
  assert.equal(s.items.filter((i) => i.type === 'command-output').length, 0);
});

// ---------- background subagents ----------
const system = (subtype, fields = {}) => ({ type: 'system', subtype, ...fields });
const launchBackgroundAgent = (s, id = 'agent1') => reduce(s, [
  start('m1'),
  assistant('m1', [{ type: 'tool_use', id, name: 'Agent', input: { description: 'Survey the code', prompt: 'Look around' } }]),
  toolResult(id, 'Async agent launched', { status: 'async_launched', agentId: 'a1', description: 'Survey the code' }),
  system('task_started', { task_id: 't1', tool_use_id: id, description: 'Survey the code', subagent_type: 'Explore', task_type: 'local_agent' }),
]);

test('a background agent keeps working after the turn ends, without making the chat busy again', () => {
  let s = reduce(initialChat(), [{ type: 'ui/user', uuid: 'u1', text: 'look around' }]);
  s = launchBackgroundAgent(s);
  // the subagent's own step, still running when the turn ends
  s = reduce(s, [assistant('sub1', [{ type: 'tool_use', id: 'grep1', name: 'Grep', input: { pattern: 'x' } }], 'agent1')]);
  s = reduce(s, [result(0.01)]);
  assert.equal(s.busy, false);
  assert.equal(s.items.find((i) => i.id === 'grep1').status, 'pending', 'its running step is not cancelled');
  s = reduce(s, [
    assistant('sub2', [{ type: 'tool_use', id: 'read1', name: 'Read', input: { file_path: 'a' } }], 'agent1'),
    { type: 'tool_progress', tool_use_id: 'read1', tool_name: 'Read', parent_tool_use_id: 'agent1', elapsed_time_seconds: 1 },
    system('task_progress', { task_id: 't1', description: 'Survey the code', usage: { total_tokens: 900, tool_uses: 2, duration_ms: 3000 }, last_tool_name: 'Read' }),
  ]);
  assert.equal(s.busy, false, 'subagent messages leave the chat idle');
  assert.equal(currentActivity(s), '');
  const [task] = backgroundTasks(s);
  assert.equal(task.status, 'running');
  assert.equal(task.subagentType, 'Explore');
  assert.equal(task.toolUses, 2);
  assert.equal(task.lastTool, 'Read');
});

test('a finished background agent reports on its card, and the turn Claude starts by itself gets a marker', () => {
  let s = reduce(initialChat(), [{ type: 'ui/user', uuid: 'u1', text: 'look around' }]);
  s = launchBackgroundAgent(s);
  s = reduce(s, [result(0.01)]);
  s = reduce(s, [system('task_notification', { task_id: 't1', tool_use_id: 'agent1', status: 'completed', summary: 'Found 3 modules', output_file: '/tmp/x' })]);
  assert.equal(backgroundTasks(s)[0].status, 'completed');
  const card = s.items.find((i) => i.id === 'agent1');
  assert.equal(card.bgStatus, 'completed');
  assert.equal(card.bgSummary, 'Found 3 modules');
  s = reduce(s, [start('m2'), blockStart(0, { type: 'text', text: '' }), delta(0, { type: 'text_delta', text: 'The survey is in.' })]);
  assert.equal(s.busy, true);
  const wake = s.items.find((i) => i.type === 'wake');
  assert.ok(wake, 'a wake marker opens the new turn');
  assert.match(wake.text, /Survey the code/);
  s = reduce(s, [assistant('m2', [{ type: 'text', text: 'The survey is in.' }]), result(0.02)]);
  const turns = groupTurns(topLevel(s), s.busy).filter((g) => g.kind === 'turn');
  assert.equal(turns.length, 2);
  assert.equal(turns[1].user.type, 'wake');
  assert.equal(turns[1].answer[0].text, 'The survey is in.');
});

test('a message queued during a turn starts the next one without a wake marker', () => {
  let s = reduce(initialChat(), [{ type: 'ui/user', uuid: 'u1', text: 'one' }]);
  s = launchBackgroundAgent(s);
  s = reduce(s, [{ type: 'ui/user', uuid: 'u2', text: 'two' }, result(0.01)]);
  s = reduce(s, [start('m2'), blockStart(0, { type: 'text', text: '' })]);
  assert.equal(s.items.some((i) => i.type === 'wake'), false);
  assert.equal(s.items.find((i) => i.key === 'u2').queued, false);
});

test('Stop with no turn to end, Claude Code going idle, and Claude Code exiting all end the work', () => {
  let s = reduce(initialChat(), [{ type: 'ui/user', uuid: 'u1', text: 'go' }]);
  s = reduce(s, [{ type: 'ui/stopped' }]);
  assert.equal(s.busy, false);
  s = reduce(s, [{ type: 'ui/user', uuid: 'u2', text: 'again' }, system('session_state_changed', { state: 'idle' })]);
  assert.equal(s.busy, false);
  s = launchBackgroundAgent(reduce(s, [{ type: 'ui/user', uuid: 'u3', text: 'more' }]));
  s = reduce(s, [{ type: 'ui/exit' }]);
  assert.equal(backgroundTasks(s)[0].status, 'stopped');
});

test('the set of background tasks replaces what is thought to run', () => {
  let s = launchBackgroundAgent(reduce(initialChat(), [{ type: 'ui/user', uuid: 'u1', text: 'go' }]));
  s = reduce(s, [system('background_tasks_changed', { tasks: [{ task_id: 'sh1', task_type: 'local_bash', description: 'npm run dev' }] })]);
  const byId = Object.fromEntries(backgroundTasks(s).map((t) => [t.id, t]));
  assert.equal(byId.t1.status, 'completed');
  assert.equal(byId.sh1.status, 'running');
  assert.equal(byId.sh1.kind, 'local_bash');
});

// ---------- task notifications in a replayed conversation ----------
const notification = (summary, status = 'completed') =>
  `<task-notification>\n<task-id>b1</task-id>\n<output-file>C:\tmp\b1.output</output-file>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>`;
const replayed = (content, uuid) => ({ type: 'user', uuid, message: { role: 'user', content }, parent_tool_use_id: null });

test('a replayed task notification is a quiet line that opens a turn, never a message of yours', () => {
  const s = reduce(initialChat(), [{ type: 'ui/history', messages: [
    replayed('Run the tests in the background', 'u1'),
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Started.' }] }, parent_tool_use_id: null },
    replayed(notification('Background command "npm test" completed (exit code 0)'), 'u2'),
    { type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'All tests pass.' }] }, parent_tool_use_id: null },
  ] }]);
  const users = s.items.filter((i) => i.type === 'user');
  assert.deepEqual(users.map((u) => u.text), ['Run the tests in the background']);
  const wake = s.items.find((i) => i.type === 'wake');
  assert.equal(wake.text, 'Background command "npm test" completed (exit code 0)');
  assert.equal(wake.status, 'completed');
  const turns = groupTurns(topLevel(s), false).filter((g) => g.kind === 'turn');
  assert.equal(turns[1].user.type, 'wake');
  assert.equal(turns[1].answer[0].text, 'All tests pass.');
});

test('every notification in a message counts, also in a text block or inside a system reminder, with its status', () => {
  const s = reduce(initialChat(), [{ type: 'ui/history', messages: [
    replayed([{ type: 'text', text: `${notification('Agent "Map" finished')}\n${notification('Command "dev" was stopped', 'killed')}` }], 'u1'),
    replayed(`<system-reminder>\nAn automated event.\n\n${notification('Agent "Lint" failed', 'failed')}\n</system-reminder>`, 'u2'),
  ] }]);
  assert.equal(s.items.some((i) => i.type === 'user'), false);
  assert.deepEqual(s.items.filter((i) => i.type === 'wake').map((w) => [w.text, w.status]), [
    ['Agent "Map" finished', 'completed'],
    ['Command "dev" was stopped', 'stopped'],
    ['Agent "Lint" failed', 'failed'],
  ]);
});
