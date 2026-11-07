// DeepSeek Harness's events, translated (main/dsh-translate.js) and read by the chat's reducer: what a chat on it
// shows. The events are shaped as dsh 0.2.2 sends them (live: plugin stream frames, then committed session events).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { initialChat, reduce, topLevel, groupTurns } from '../src/renderer/lib/chat-reducer.js';
import { patchesFor, countDiff } from '../src/renderer/lib/diff.js';
import { decide, PRESETS } from '../src/main/dsh-bridge.mjs';

const require = createRequire(import.meta.url);
const { DshTranslator, replayEvents } = require('../src/main/dsh-translate.js');

const ID = 'dsh-test';
let seq = 0;
const ev = (type, data) => ({ type, seq: seq++, time: 1_800_000_000_000 + seq * 10, data });
const frames = (attempt, chunks) => [
  { type: 'start', attemptId: `${ID}:${attempt}`, revision: 1, turn: 1, step: attempt },
  ...chunks.map((chunk, i) => ({ type: 'chunk', attemptId: `${ID}:${attempt}`, revision: i + 2, index: i, chunk })),
  { type: 'end', attemptId: `${ID}:${attempt}`, outcome: { kind: 'committed' } },
];
const usage = { inputTokens: 1200, outputTokens: 60, cacheReadTokens: 100, cacheWriteTokens: 0, totalTokens: 1360 };

// One turn: thinking and a tool call (an edit), its result, then the answer.
function turn() {
  const editArgs = JSON.stringify({ file_path: 'notes.txt', old_string: 'gamma', new_string: 'GAMMA' });
  return [
    ['event', ev('turn/start', { turn: 1 })],
    ['event', ev('user/message', { content: [{ type: 'text', text: 'Fix it' }], source: { kind: 'user' }, role: 'user', id: 'msg-1' })],
    ['event', ev('user/message', { content: [{ type: 'text', text: '<runtime context>' }], source: { kind: 'runtime-context' }, role: 'user', id: 'msg-x' })],
    ['event', ev('request/context', { provider: 'deepseek-official', model: 'deepseek-flash', contextWindow: 1000000 })],
    ...frames(1, [
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'Look at the file.' },
      { type: 'block-end', index: 0 },
      { type: 'block-start', index: 1, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 1, id: 'call-1', name: 'edit', argumentsDelta: '' },
      { type: 'tool-call-delta', index: 1, id: 'call-1', argumentsDelta: editArgs },
      { type: 'block-end', index: 1 },
    ]).map((f) => ['frame', f]),
    ['event', ev('assistant/message', {
      message: { role: 'assistant', content: [{ type: 'reasoning', text: 'Look at the file.' }, { type: 'tool-call', id: 'call-1', name: 'edit', arguments: editArgs }], source: { kind: 'model', model: 'deepseek-flash' }, id: 'a1' },
      usage,
    })],
    ['event', ev('tool/call', { callId: 'call-1', name: 'edit', arguments: editArgs })],
    ['event', ev('tool/result', {
      message: { role: 'tool', toolCallId: 'call-1', content: [{ type: 'text', text: 'The file notes.txt has been updated successfully.' }], isError: false, id: 'r1' },
      meta: { path: '/p/notes.txt', diffs: [{ path: '/p/notes.txt', oldText: 'alpha\nbeta\ngamma\ndelta', newText: 'alpha\nbeta\nGAMMA\ndelta' }] },
    })],
    ...frames(2, [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Fixed ' },
      { type: 'text-delta', index: 0, text: 'it.' },
      { type: 'block-end', index: 0 },
    ]).map((f) => ['frame', f]),
    ['event', ev('assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed it.' }], source: { kind: 'model', model: 'deepseek-flash' }, id: 'a2' }, usage })],
    ['event', ev('turn/end', { turn: 1, reason: { kind: 'completed' } })],
  ];
}

const live = (steps) => {
  const tr = new DshTranslator(ID);
  return { tr, messages: steps.flatMap(([kind, x]) => (kind === 'frame' ? tr.frame(x) : tr.event(ID, x))) };
};

test('a live DeepSeek Harness turn reads as a chat turn: thinking, an edit with its diff, the answer', () => {
  seq = 0;
  const { tr, messages } = live(turn());
  let s = reduce(initialChat(), [{ type: 'ui/user', uuid: 'u1', text: 'Fix it' }]);
  s = reduce(s, messages);
  const items = topLevel(s);
  const thinking = items.filter((i) => i.type === 'thinking');
  assert.equal(thinking.length, 1, 'streamed thinking is confirmed, not repeated');
  assert.equal(thinking[0].text, 'Look at the file.');
  const tool = items.find((i) => i.type === 'tool');
  assert.equal(tool.name, 'Edit');
  assert.equal(tool.status, 'done');
  assert.deepEqual(tool.input, { file_path: 'notes.txt', old_string: 'gamma', new_string: 'GAMMA' });
  assert.deepEqual(countDiff(patchesFor(tool)), { add: 1, del: 1 });
  const texts = items.filter((i) => i.type === 'text');
  assert.equal(texts.length, 1);
  assert.equal(texts[0].text, 'Fixed it.');
  assert.equal(s.busy, false, 'the turn ended');
  assert.ok(!items.some((i) => i.type === 'user' && i.text === '<runtime context>'), 'dsh’s own context is not a message');
  const [group] = groupTurns(items, false);
  assert.equal(group.answer.map((i) => i.text).join(''), 'Fixed it.');
  assert.equal(tr.lastUsage.totalTokens, 1360);
  assert.equal(tr.contextWindow, 1000000);
});

test('a saved conversation reads back with the user’s own messages and their ids', () => {
  seq = 0;
  const events = turn().filter(([kind]) => kind === 'event').map(([, e]) => e);
  const history = replayEvents(ID, events);
  const users = history.filter((m) => m.type === 'user' && m.message.content.some((b) => b.type === 'text'));
  assert.equal(users.length, 1);
  assert.equal(users[0].uuid, 'msg-1');
  let s = reduce(initialChat(), [{ type: 'ui/history', messages: history }]);
  const items = topLevel(s);
  assert.equal(items.find((i) => i.type === 'user').key, 'msg-1', 'edit and resend can name the message to dsh');
  assert.equal(items.find((i) => i.type === 'tool').status, 'done');
  assert.ok(items.some((i) => i.type === 'text' && i.text === 'Fixed it.'));
});

test('a stopped turn, a failed one, and a subagent', () => {
  const tr = new DshTranslator(ID);
  assert.equal(tr.event(ID, ev('turn/end', { reason: { kind: 'aborted' } }))[0].subtype, 'error_during_execution');
  assert.equal(tr.event(ID, ev('turn/end', { reason: { kind: 'error', message: 'Authentication Fails' } }))[0].errors[0], 'Authentication Fails');
  tr.event(ID, ev('assistant/message', { message: { content: [{ type: 'tool-call', id: 'call-9', name: 'subagent', arguments: '{"description":"Look around","prompt":"x"}' }] } }));
  const [started] = tr.subagentStarted({ parentSessionId: ID, childSessionId: 'child-1' });
  assert.equal(started.tool_use_id, 'call-9');
  assert.equal(started.description, 'Look around');
  const [child] = tr.event('child-1', ev('assistant/message', { message: { content: [{ type: 'text', text: 'Found 3 files.' }] } }));
  assert.equal(child.parent_tool_use_id, 'call-9', 'its steps nest under the call');
  const [done] = tr.subagentFinished({ childSessionId: 'child-1', status: 'ok', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'Found 3 files.' }] });
  assert.equal(done.status, 'completed');
  assert.equal(done.summary, 'Found 3 files.');
});

test('what asks first in each permission mode', () => {
  const cwd = process.platform === 'win32' ? 'C:\\p' : '/p';
  const outside = process.platform === 'win32' ? 'C:\\elsewhere\\x.txt' : '/elsewhere/x.txt';
  assert.equal(decide('default', 'read', {}, cwd), 'allow');
  assert.equal(decide('default', 'edit', { file_path: 'a.txt' }, cwd), 'ask');
  assert.equal(decide('default', 'pwsh', { command: 'ls' }, cwd), 'ask');
  assert.equal(decide('default', 'pwsh', {}, cwd, new Set(['pwsh'])), 'allow', 'allowed for the session');
  assert.equal(decide('acceptEdits', 'edit', { file_path: 'a.txt' }, cwd), 'allow');
  assert.equal(decide('acceptEdits', 'write', { file_path: outside }, cwd), 'ask', 'only inside the folder');
  assert.equal(decide('acceptEdits', 'bash', {}, cwd), 'ask');
  assert.equal(decide('plan', 'write', { file_path: 'a.txt' }, cwd), 'deny');
  assert.equal(decide('plan', 'exit_plan_mode', {}, cwd), 'allow');
  assert.equal(decide('bypassPermissions', 'pwsh', {}, cwd), 'allow');
  assert.equal(PRESETS.bypassPermissions, 'danger-full-access');
});

test('model providers: values, the patch dsh starts with, listings, and what Settings refuses', async () => {
  const c = await import('../src/main/dsh-catalog.mjs');
  const settings = {
    dshOfficial: { baseURL: '', models: null },
    dshProviders: [{
      id: 'custom-relay', name: 'Relay', api: 'openai-completions', baseURL: 'https://relay.example/v1',
      models: [{ id: 'org/model-a', name: 'Model A', contextWindow: 64000, image: true, reasoning: { off: null, high: 'high' } }, { id: 'model-b' }],
    }],
  };
  const all = c.catalog(settings);
  assert.deepEqual(all.map((m) => m.value), ['deepseek-flash', 'deepseek-v4-pro', 'custom-relay::org/model-a', 'custom-relay::model-b']);
  assert.deepEqual(c.parseModel('custom-relay::org/model-a'), { provider: 'custom-relay', model: 'org/model-a' }, 'ids may hold slashes');
  assert.deepEqual(c.parseModel('deepseek-flash'), { provider: 'deepseek-official', model: 'deepseek-flash' }, 'DeepSeek’s ids stay bare');
  assert.deepEqual(all[2].efforts, ['off', 'high']);
  assert.deepEqual(all[3].efforts, []);

  const entries = c.patchEntries(settings, (id) => (id === 'custom-relay' ? 'CCUI_DSH_KEY_0' : ''));
  assert.deepEqual(entries[0], { id: 'llm-deepseek', config: { apiKeyEnv: 'DEEPSEEK_API_KEY' } }, 'DeepSeek’s defaults stay dsh’s');
  const route = entries[1].config.providers['custom-relay'];
  assert.equal(route.apiKeyEnv, 'CCUI_DSH_KEY_0');
  assert.equal(route.api, 'openai-completions');
  assert.deepEqual(route.models[0], { id: 'org/model-a', name: 'Model A', contextWindow: 64000, input: ['text', 'image'], reasoningEfforts: { off: null, high: 'high' } });
  assert.equal(route.models[1].reasoningEfforts, false, 'no levels: a model that doesn’t reason');
  assert.ok(!JSON.stringify(entries).includes('sk-'), 'no key in the patch');
  const edited = c.patchEntries({ dshOfficial: { baseURL: 'https://gw.example/anthropic', models: [{ id: 'deepseek-flash', name: 'Flash', image: true }] }, dshProviders: [] }, () => '');
  assert.deepEqual(edited, [{ id: 'llm-deepseek', config: { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: 'https://gw.example/anthropic', models: [{ id: 'deepseek-flash', name: 'Flash', inputModalities: ['text', 'image'] }] } }]);

  assert.deepEqual(c.listing('openai-completions', 'https://relay.example/v1/', 'k'), { url: 'https://relay.example/v1/models', headers: { authorization: 'Bearer k' } });
  assert.equal(c.listing('anthropic-messages', 'https://gw.example/v1', 'k').url, 'https://gw.example/v1/models?limit=1000');
  assert.equal(c.listing('anthropic-messages', 'https://gw.example', '').url, 'https://gw.example/v1/models?limit=1000');
  assert.deepEqual(c.parseListing({ data: [{ id: 'a', context_length: 8000 }, { id: 'b', display_name: 'Bee', max_output_tokens: 4096 }, { id: 'a' }] }),
    [{ id: 'a', name: 'a', contextWindow: 8000 }, { id: 'b', name: 'Bee', maxTokens: 4096 }]);

  const ok = settings.dshProviders[0];
  assert.equal(c.problemWith(ok, []), '');
  assert.match(c.problemWith({ ...ok, name: ' ' }), /name/);
  assert.match(c.problemWith({ ...ok, baseURL: 'relay.example' }), /http/);
  assert.match(c.problemWith({ ...ok, models: [] }), /at least one/);
  assert.match(c.problemWith({ ...ok, models: [{ id: 'x' }, { id: 'x' }] }), /same ID/);
  assert.match(c.problemWith({ ...ok, models: [{ id: 'x', reasoning: { off: null } }] }), /beyond Off/);
  assert.match(c.problemWith({ ...ok, models: [{ id: 'x', reasoning: { high: '' } }] }), /value to send/);
  assert.match(c.problemWith({ ...ok, id: 'custom-other' }, [ok]), /same name|this name/);
  assert.equal(c.providerId('ai8 中转', ['custom-ai8']), 'custom-ai8-2');
});

test('commands you ran and a goal’s rounds read back in a saved conversation', () => {
  seq = 0;
  const events = [
    ev('command/run', { commandId: 'cmd-1', name: 'goal', args: ' finish the plan', source: { kind: 'user' } }),
    ev('command/done', { commandId: 'cmd-1', kind: 'ok', text: 'Goal created' }),
    ev('turn/start', { turn: 1 }),
    ev('user/message', { content: [{ type: 'text', text: '<goal_round>\nObjective: "finish the plan"\nRound: 1/256' }], source: { kind: 'goal', round: 1 }, role: 'user', id: 'g1' }),
    ev('assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: 'Round one done.' }] } }),
    ev('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ev('command/run', { commandId: 'cmd-2', name: 'goal', args: ' resume now', source: { kind: 'user' } }),
    ev('command/done', { commandId: 'cmd-2', kind: 'error', text: 'A goal is already paused.' }),
  ];
  const chat = reduce(initialChat(), [{ type: 'ui/history', messages: replayEvents(ID, events) }]);
  const groups = groupTurns(topLevel(chat), false).filter((g) => g.kind === 'turn');
  assert.deepEqual(groups.map((g) => g.user.type), ['user', 'wake', 'user']);
  assert.equal(groups[0].user.text, '/goal finish the plan');
  assert.equal(groups[0].user.key, 'cmd-1', 'edit and resend can name the command to dsh');
  assert.ok(groups[0].answer.some((i) => i.type === 'command-output' && i.text === 'Goal created'));
  assert.match(groups[1].user.text, /round 1: finish the plan/i);
  assert.ok(groups[1].answer.some((i) => i.text === 'Round one done.'));
  assert.ok(groups[2].answer.some((i) => i.type === 'command-output' && /already paused/.test(i.text)), 'a refusal is shown, not lost');
});
