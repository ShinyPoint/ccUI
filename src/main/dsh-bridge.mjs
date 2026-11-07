// ccUI's plugin inside DeepSeek Harness (loaded through a --patch file, see dsh.js). Its JSON-RPC server reports only
// what is committed and has no way to stop a turn or change model, and it asks only about commands that leave the
// sandbox. This plugin adds what a chat needs: the answer as it is written, Stop, the model and effort, the same
// permission modes as Claude Code's, and a copy of each file before an edit (what undoing goes back to). It is
// copied next to dsh's node_modules, since dsh's own Node can't read inside the app's asar. Commands arrive as JSON
// lines on fd 3; what it says goes to stdout as JSON-RPC notifications, between the server's own.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export const name = 'ccui-bridge';
export const inject = ['agents', 'permissionPresets'];

// What each ccUI mode runs under. Asking is ccUI's gate (below), so that a command needs no sandbox to be safe: the
// Windows sandbox has to rewrite the project folder's ACL, and fails where the user doesn't own that folder.
export const PRESETS = {
  default: 'ccui-ask',
  acceptEdits: 'ccui-ask',
  plan: 'ccui-ask',
  auto: 'workspace-write', // dsh's own way: confined to the folder, asking only to leave it
  bypassPermissions: 'danger-full-access',
};

// Tools that only look, or only talk: never asked about, as in Claude Code.
const QUIET = new Set([
  'read', 'read_image', 'glob', 'grep', 'todo_write', 'ask_user_question', 'skill', 'present', 'exit_plan_mode',
  'list_agents', 'subagent', 'subagent_fork', 'send_message', 'interrupt_agent', 'job_list', 'job_output',
  'get_goal', 'create_goal', 'update_goal', 'working_directory',
]);
const EDITS = new Set(['edit', 'write']);
const MAX_COPY = 5 * 1024 * 1024; // a larger file isn't copied before an edit: it can't be restored

const inside = (file, cwd) => {
  const rel = path.relative(cwd, path.resolve(cwd, String(file || '')));
  return !rel.startsWith('..') && !path.isAbsolute(rel);
};

// What the gate does with a tool call in a mode: 'allow', 'ask', or 'deny' (plan mode changes nothing yet).
export function decide(mode, tool, args, cwd, allowed = new Set()) {
  if (mode === 'auto' || mode === 'bypassPermissions' || QUIET.has(tool)) return 'allow';
  if (EDITS.has(tool)) {
    if (mode === 'plan') return 'deny';
    if (mode === 'acceptEdits' && inside(args?.file_path, cwd)) return 'allow';
  }
  return allowed.has(tool) ? 'allow' : 'ask';
}

export function apply(ctx) {
  const root = process.env.CCUI_DSH_SESSION;
  const checkpoints = process.env.CCUI_DSH_CHECKPOINTS;
  const cwd = process.cwd();
  let mode = process.env.CCUI_DSH_MODE || 'default';
  const allowed = new Set();
  let message = ''; // the user's message being worked on: what file copies are filed under
  const copied = new Set();

  const out = (method, params) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  const rootAgent = () => ctx.agents.get(root);
  const setPreset = (session) => ctx.permissionPresets.set(session, PRESETS[mode] || PRESETS.default);
  let wanted = null; // a model chosen before the conversation exists

  ctx.on('agent/assistant-stream', ({ frame }) => out('ccui.stream', frame));
  ctx.on('agent/created', ({ agent }) => {
    if (String(agent.session.id) !== root) return;
    setPreset(agent.session);
    if (wanted) agent.model.select(wanted);
  });
  ctx.on('session/event', (session, event) => {
    if (String(session.id) === root && event.type === 'user/message' && event.data.source?.kind === 'user') message = event.data.id;
  });

  ctx.on('tools/pre-execute', async (exec, next) => {
    const verdict = decide(mode, exec.name, exec.arguments, cwd, allowed);
    if (verdict === 'deny') return { kind: 'deny', reason: 'Plan mode: files are not changed until the plan is approved. Present the plan with exit_plan_mode.' };
    if (verdict === 'allow') return next();
    const downstream = await next();
    return downstream.kind === 'allow' ? { kind: 'ask', reason: `ccUI asks before ${exec.name}` } : downstream;
  }, { prepend: true });

  // Around the tool's body, so after any question was answered: the file as it is just before this edit.
  ctx.on('tools/execute', async (exec, next) => {
    if (checkpoints && message && EDITS.has(exec.name)) {
      try { keepCopy(path.resolve(cwd, String(exec.arguments?.file_path || ''))); } catch { /* never in the way of the edit */ }
    }
    return next();
  });

  function keepCopy(file) {
    const seen = `${message}\n${file}`;
    if (copied.has(seen)) return;
    copied.add(seen);
    const dir = path.join(checkpoints, message);
    fs.mkdirSync(dir, { recursive: true });
    const entry = { path: file, existed: fs.existsSync(file) };
    if (entry.existed) {
      if (fs.statSync(file).size > MAX_COPY) entry.tooLarge = true;
      else {
        const bytes = fs.readFileSync(file);
        entry.blob = crypto.createHash('sha1').update(bytes).digest('hex');
        const blob = path.join(checkpoints, 'blobs', entry.blob);
        fs.mkdirSync(path.dirname(blob), { recursive: true });
        if (!fs.existsSync(blob)) fs.writeFileSync(blob, bytes);
      }
    }
    fs.appendFileSync(path.join(dir, 'files.jsonl'), `${JSON.stringify(entry)}\n`);
  }

  const commands = {
    // Stops the running turn, and what was waiting behind it.
    cancel: () => rootAgent()?.cancel({ kind: 'user' }),
    'stop-agent': ({ sessionId }) => ctx.agents.get(sessionId)?.cancel({ kind: 'user' }),
    model: ({ provider, model, effort }) => {
      wanted = { provider, model, ...(effort ? { reasoningEffort: effort } : {}) };
      rootAgent()?.model.select(wanted);
    },
    mode: ({ value }) => {
      mode = value;
      const agent = rootAgent();
      if (agent) setPreset(agent.session);
    },
    allow: ({ tool }) => { allowed.add(tool); },
    flush: async () => {
      const agent = rootAgent();
      if (agent) await ctx.get('sessions')?.flush(agent.session);
    },
    rename: ({ title }) => rootAgent()?.session.append('session/title', { title, messageSeqs: [], source: { kind: 'user' } }),
    skills: async () => {
      const found = await ctx.get('skills')?.list({ cwd });
      const list = Array.isArray(found) ? found : found?.skills || found?.candidates || [];
      return list.map((s) => ({ name: s.name, description: s.description || '', dir: s.path || s.dir || '', source: s.source || s.provider || '' }));
    },
  };

  readline.createInterface({ input: fs.createReadStream(null, { fd: 3 }) }).on('line', async (line) => {
    let cmd = null;
    try {
      cmd = JSON.parse(line);
      out('ccui.reply', { id: cmd.id, ok: true, value: (await commands[cmd.cmd]?.(cmd)) ?? null });
    } catch (err) {
      out('ccui.reply', { id: cmd?.id, ok: false, error: err.message || String(err) });
    }
  });
  out('ccui.ready', {});
}
