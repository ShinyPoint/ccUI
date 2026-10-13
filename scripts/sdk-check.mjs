// Diagnostic: drive Claude Code through the Agent SDK and check every capability
// the chat UI depends on. Runs in a throwaway folder with the cheapest model.
// Usage: npm run sdk-check   (costs a few tens of cents: it sends Claude several short prompts)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccui-spike-'));
fs.writeFileSync(path.join(dir, 'notes.txt'), 'alpha\nbeta\n');

const env = { ...process.env };
for (const k of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_CHILD_SESSION']) delete env[k];

// Long-lived input: user messages are pushed whenever the "UI" wants.
const pending = [];
let wake = null;
async function* input() {
  for (;;) {
    while (pending.length) yield pending.shift();
    await new Promise((r) => { wake = r; });
    wake = null;
  }
}
function send(text) {
  pending.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, origin: { kind: 'human' } });
  wake?.();
}

const report = { permissionCalls: [], deltas: 0, messageTypes: {}, results: [] };
const q = query({
  prompt: input(),
  options: {
    cwd: dir,
    model: 'haiku',
    permissionMode: 'default',
    includePartialMessages: true,
    env,
    canUseTool: async (toolName, toolInput) => {
      report.permissionCalls.push({ mode: currentMode, toolName });
      if (toolName === 'AskUserQuestion') {
        const answers = Object.fromEntries(toolInput.questions.map((qq) => [qq.question, qq.options[0].label]));
        console.log('  ? AskUserQuestion', JSON.stringify(answers));
        return { behavior: 'allow', updatedInput: { ...toolInput, answers } };
      }
      console.log(`  ? permission ${toolName}`, JSON.stringify(toolInput).slice(0, 100));
      return { behavior: 'allow', updatedInput: toolInput };
    },
  },
});
let currentMode = 'default';

let resultWaiter = null;
let onDelta = null;
(async () => {
  for await (const m of q) {
    const key = m.subtype ? `${m.type}/${m.subtype}` : m.type;
    report.messageTypes[key] = (report.messageTypes[key] || 0) + 1;
    if (m.type === 'system' && m.subtype === 'init') {
      report.init = {
        apiKeySource: m.apiKeySource, model: m.model, version: m.claude_code_version,
        permissionMode: m.permissionMode, tools: m.tools.length, slashCommands: m.slash_commands.length,
        hasAskUserQuestion: m.tools.includes('AskUserQuestion'),
      };
      console.log('init', report.init);
    } else if (m.type === 'stream_event' && m.event.type === 'content_block_delta' && m.event.delta.type === 'text_delta') {
      report.deltas++;
      onDelta?.();
    } else if (m.type === 'assistant') {
      for (const b of m.message.content) {
        if (b.type === 'tool_use') console.log(`  > tool_use ${b.name}`);
        if (b.type === 'text') console.log(`  > text: ${b.text.replace(/\s+/g, ' ').slice(0, 110)}`);
      }
    } else if (m.type === 'result') {
      const r = { subtype: m.subtype, cost: m.total_cost_usd, turns: m.num_turns, text: String(m.result ?? '').slice(0, 80) };
      report.results.push(r);
      console.log('  = result', r);
      resultWaiter?.(m);
    } else if (m.type !== 'stream_event' && m.type !== 'user') {
      console.log(`  · ${key}`, JSON.stringify(m).slice(0, 160));
    }
  }
})().catch((e) => console.error('stream error', e));

const nextResult = () => new Promise((r) => { resultWaiter = r; });
async function turn(label, text) {
  console.log(`\n## ${label}`);
  const done = nextResult();
  send(text);
  return done;
}

const guard = setTimeout(() => { console.error('TIMEOUT'); process.exit(2); }, 6 * 60 * 1000);
try {
  const account = await q.accountInfo();
  console.log('account', { ...account, email: account.email ? '(present)' : undefined });

  if (!process.env.SKIP_T12) {
  await turn('T1 edit + bash in default mode',
    "Read notes.txt, append a line 'gamma' to it with the Edit tool, then run the shell command `node -v`. Finish with one short sentence.");
  console.log('notes.txt now:', JSON.stringify(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8')));

  await turn('T2 AskUserQuestion in default mode',
    'Use the AskUserQuestion tool to ask me whether I prefer red or blue (two options). Then reply with only the color I picked.');

  }
  // Auto mode is model-dependent (unavailable for Haiku); try it on Sonnet.
  await q.setModel('sonnet');
  try {
    await q.setPermissionMode('auto'); currentMode = 'auto';
    await turn('T3 AskUserQuestion in auto mode (sonnet)',
      'Use the AskUserQuestion tool to ask me whether I prefer cats or dogs (two options). Then reply with only my pick.');
  } catch (e) { console.log('  auto mode unavailable:', e.message); }
  await q.setModel('haiku');

  await q.setPermissionMode('plan'); currentMode = 'plan';
  await turn('T4 plan mode',
    "Plan how you would add a line 'delta' to notes.txt. Keep the plan to two bullet points, then present it for approval.");
  await q.setPermissionMode('default'); currentMode = 'default';

  await turn('T5 slash command', '/context');

  console.log('\n## T6 interrupt');
  const done = nextResult();
  let seen = 0;
  onDelta = () => { if (++seen === 30) { console.log('  ! interrupting'); q.interrupt(); } };
  send('Write a 600-word essay about lighthouses.');
  await done;
  onDelta = null;

  const commands = await q.supportedCommands();
  const models = await q.supportedModels();
  const ctx = await q.getContextUsage();
  console.log('\nsupportedCommands', commands.length, commands.slice(0, 8).map((c) => c.name));
  console.log('supportedModels', models.map((m) => m.value ?? m.id ?? m.displayName));
  console.log('contextUsage keys', Object.keys(ctx));
} catch (e) {
  console.error('FAILED', e);
} finally {
  clearTimeout(guard);
  console.log('\nREPORT', JSON.stringify({ ...report, totalCost: report.results.reduce((a, r) => a + (r.cost || 0), 0) }, null, 1));
  q.close?.();
  process.exit(0);
}
