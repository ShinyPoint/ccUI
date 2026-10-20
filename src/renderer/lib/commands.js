// Slash commands in a chat. Claude Code runs most of them when they are sent as a message, but its interactive ones
// draw a screen in its CLI, which a chat doesn't have: those the chat shows its own way (APP_COMMANDS), and the rest
// offer to continue the conversation in the CLI with the command typed in (CLI_COMMANDS).
import {
  api, toast, confirmDialog, infoDialog, settingsDialog, newSessionDialog, skillsDialog,
} from './store.js';
import {
  setModel, setEffort, setMode, renameSession, askSideQuestion, branchConversation, openInTerminal, endSession,
} from './sessions.js';
import { topLevel, groupTurns } from './chat-reducer.js';
import { pluralize, tildify } from './format.js';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'auto'];

// Claude's answers, latest first: each turn's final text.
function answers(s) {
  const chat = s.chat.value;
  return groupTurns(topLevel(chat), chat.busy).filter((g) => g.kind === 'turn')
    .map((g) => g.answer.filter((i) => i.type === 'text').map((i) => i.text).join('\n\n').trim())
    .filter(Boolean).reverse();
}

async function control(s, action, arg) {
  if (!s.agentId) {
    toast('The chat isn’t running yet: send a message first.', 'error');
    return null;
  }
  const res = await api.agent.control(s.agentId, action, arg);
  if (!res.ok) {
    toast(res.error || 'Claude Code could not do that.', 'error');
    return null;
  }
  return res.value;
}

// Values that look like a credential show only their last characters.
const masked = (label, value) => (/token|key|secret|password/i.test(label) && String(value).length > 8
  ? `••••${String(value).slice(-4)}` : String(value ?? ''));

async function showStatus(s) {
  const status = await control(s, 'status');
  if (!status) return;
  infoDialog.value = {
    title: 'Status',
    sections: (status.sections || []).map((sec) => ({
      title: sec.title,
      rows: (sec.rows || []).map((r) => ({ label: r.label, value: masked(r.label, r.value), mono: /id|url|cwd|version|path/i.test(r.label) })),
    })),
  };
}

async function showMemory(s) {
  const memory = await control(s, 'memory');
  if (!memory) return;
  const open = async (file) => {
    const opened = await api.openMemoryFile(file.path);
    if (!opened.ok) return toast(opened.error, 'error');
    infoDialog.value = null;
  };
  infoDialog.value = {
    title: 'Memory',
    note: 'Claude reads these instructions at the start of every session in this project.',
    sections: [
      {
        title: 'Instructions',
        rows: (memory.files || []).map((f) => ({
          label: f.label, note: f.exists ? tildify(f.path) : `${tildify(f.path)} · not there yet`, mono: false,
          action: { label: f.exists ? 'Open' : 'Create', run: () => open(f) },
        })),
      },
      ...(memory.folders?.length ? [{
        title: 'Auto memory',
        rows: memory.folders.map((f) => ({
          label: f.label, note: [f.description, memory.auto_memory?.status].filter(Boolean).join(' · '),
          action: { label: 'Open', run: () => { api.openPath(f.path); infoDialog.value = null; } },
        })),
      }] : []),
    ],
  };
}

async function showMcp(s) {
  const servers = await control(s, 'mcp-status');
  if (!servers) return;
  infoDialog.value = {
    title: 'MCP servers',
    note: servers.length ? 'Turn one on or off with /mcp enable <server> or /mcp disable <server>.' : 'No MCP servers are set up for this project.',
    sections: servers.length ? [{
      rows: servers.map((m) => ({
        label: m.name, note: [m.status, m.serverInfo?.version, m.scope].filter(Boolean).join(' · '),
        action: m.status === 'connected' ? null : {
          label: 'Reconnect',
          run: async () => {
            if (await control(s, 'mcp-reconnect', m.name) !== null) { toast(`Reconnecting ${m.name}…`); showMcp(s); }
          },
        },
      })),
    }] : [],
  };
}

async function exportConversation(s) {
  const out = await control(s, 'export');
  if (!out) return;
  const saved = await api.saveText(out.default_filename || 'conversation.txt', out.text || '', s.cwd);
  if (saved.ok) toast(`Saved to ${tildify(saved.path)}.`);
  else if (!saved.canceled) toast(saved.error || 'The file could not be saved.', 'error');
}

// `ui`: what only the message box can do: { openModelMenu, openContext, showAll, setText }.
export const APP_COMMANDS = [
  { name: 'btw', argumentHint: '<question>', description: 'Ask a quick side question without interrupting the conversation',
    run: (s, args) => (args ? askSideQuestion(s, args) : toast('Add your question: /btw why is this test slow?')) },
  { name: 'skills', description: 'Manage skills: turn them on or off, see what they cost in context', run: (s) => { skillsDialog.value = s; } },
  { name: 'rename', aliases: ['name'], argumentHint: '[name]', description: 'Rename this conversation',
    run: async (s, args) => {
      if (!args) return toast('Add the new name: /rename Fix the login bug');
      renameSession(s, args);
      if (s.agentId && (s.chat.value.sessionId || s.sessionId)) await control(s, 'rename', args);
      toast(`Renamed to “${args}”.`);
    } },
  { name: 'model', argumentHint: '[model]', description: 'Choose the model (with no name, opens the model menu)',
    run: (s, args, ui) => (args ? setModel(s, args) : ui.openModelMenu()) },
  { name: 'effort', argumentHint: '[low|medium|high|xhigh|max]', description: 'Set the effort level (with none, opens the model menu)',
    run: async (s, args, ui) => {
      if (!args) return ui.openModelMenu();
      if (!EFFORTS.includes(args)) return toast(`Effort is one of ${EFFORTS.join(', ')}.`, 'error');
      if (await setEffort(s, args === 'auto' ? '' : args)) toast(`Effort: ${args}.`);
    } },
  { name: 'plan', description: 'Switch to plan mode: Claude plans before it changes anything', run: (s) => setMode(s, 'plan') },
  { name: 'context', description: 'Show what fills the context window', run: (s, args, ui) => ui.openContext() },
  { name: 'usage', aliases: ['cost', 'stats'], description: 'Show what this session has cost so far', run: (s, args, ui) => ui.openContext() },
  { name: 'status', aliases: ['version'], description: 'Show Claude Code’s status: version, model, account, settings', run: showStatus },
  { name: 'memory', description: 'Open the CLAUDE.md instructions Claude reads', run: showMemory },
  { name: 'mcp', argumentHint: '[reconnect|enable|disable <server>]', description: 'Show the MCP servers (with arguments, Claude Code runs it)',
    passWithArgs: true, run: showMcp },
  { name: 'export', description: 'Save this conversation to a file', run: exportConversation },
  { name: 'copy', argumentHint: '[N]', description: 'Copy Claude’s last answer (or the Nth latest)',
    run: (s, args) => {
      const n = Math.max(1, parseInt(args, 10) || 1);
      const text = answers(s)[n - 1];
      if (!text) return toast(n === 1 ? 'Claude hasn’t answered yet.' : `There is no answer number ${n}.`);
      api.writeClipboard(text);
      toast(n === 1 ? 'Copied Claude’s last answer.' : `Copied the answer ${pluralize(n - 1, 'answer')} back.`);
    } },
  { name: 'branch', description: 'Continue a copy of this conversation in a new chat', run: branchConversation },
  { name: 'resume', description: 'Open an earlier conversation from this folder',
    run: (s) => { newSessionDialog.value = { cwd: s.cwd, kind: 'chat', mode: 'resume' }; } },
  { name: 'config', aliases: ['settings'], argumentHint: '[key=value]', description: 'Open Settings (with key=value, Claude Code sets it)',
    passWithArgs: true, run: () => { settingsDialog.value = true; } },
  { name: 'theme', description: 'Change the theme and colors', run: () => { settingsDialog.value = 'appearance'; } },
  { name: 'tasks', aliases: ['bashes'], description: 'Show what is running in the background',
    run: (s) => {
      const running = Object.values(s.chat.value.agents || {}).filter((a) => a.status === 'running');
      toast(running.length ? `${pluralize(running.length, 'background task')} running: see the strip above the message box.` : 'Nothing is running in the background.');
    } },
  { name: 'help', description: 'Show every command', run: (s, args, ui) => ui.showAll() },
  { name: 'exit', aliases: ['quit'], description: 'End this session (the conversation is saved)', run: (s) => endSession(s) },
];

// Claude Code's commands that only its CLI can show. Name, other names, and what it does.
export const CLI_COMMANDS = [
  ['permissions', ['allowed-tools'], 'Manage allow and deny rules for tools'],
  ['hooks', [], 'View hook configurations for tool events'],
  ['agents', [], 'Create and manage subagents'],
  ['plugin', ['plugins', 'marketplace'], 'Manage Claude Code plugins'],
  ['ide', [], 'Manage IDE integrations and show status'],
  ['login', [], 'Sign in with your Anthropic account'],
  ['logout', [], 'Sign out from your Anthropic account'],
  ['doctor', ['checkup'], 'Check the health of your Claude Code installation'],
  ['color', [], 'Set the prompt bar color for this session'],
  ['focus', [], 'Toggle focus view'],
  ['vim', [], 'Toggle Vim editing mode'],
  ['terminal-setup', [], 'Set up Shift+Enter for new lines in your terminal'],
  ['statusline', [], 'Set up a status line'],
  ['feedback', ['bug'], 'Send feedback to Anthropic or report a bug'],
  ['release-notes', [], 'Show what is new in Claude Code'],
  ['privacy-settings', [], 'View and update your privacy settings'],
  ['install-github-app', [], 'Set up Claude GitHub Actions for a repository'],
  ['add-dir', [], 'Add a new working directory'],
  ['cd', [], 'Move this session to a new working directory'],
  ['fork', [], 'Spawn a background agent that inherits the full conversation'],
  ['subtask', [], 'Send a subagent off with your full context'],
  ['autocompact', [], 'Set how full the context gets before auto-summarizing'],
  ['output-style', [], 'Choose an output style'],
  ['advisor', [], 'Let Claude consult a stronger model at key moments'],
  ['brief', [], 'Toggle brief-only mode'],
  ['background', ['bg'], 'Send this session to the background'],
  ['workflows', [], 'Browse running and completed workflows'],
  ['loops', [], 'List, create and delete loops'],
  ['artifacts', [], 'Browse your published and shared artifacts'],
  ['upgrade', [], 'Upgrade your plan'],
  ['usage-credits', [], 'Configure usage credits'],
  ['rate-limit-options', [], 'Manage usage limits'],
  ['setup-bedrock', [], 'Set up Amazon Bedrock'],
  ['setup-vertex', [], 'Set up Google Vertex AI'],
  ['import', [], 'Import config from another AI coding agent'],
  ['tui', [], 'Set the terminal UI renderer'],
  ['scroll-speed', [], 'Adjust mouse wheel scroll speed'],
  ['wellbeing', ['breaks'], 'Break reminders and quiet hours'],
  ['powerup', [], 'Learn Claude Code features in short lessons'],
  ['teleport', [], 'Send this session to the cloud, or resume one'],
  ['desktop', ['app'], 'Continue the session in Claude Desktop'],
  ['mobile', ['ios', 'android'], 'Download the Claude mobile app'],
].map(([name, aliases, description]) => ({ name, aliases, description, argumentHint: '', cli: true }));

const matches = (c, name) => c.name === name || c.aliases?.includes(name);
// `/name args` at the start of a message (not a path like /usr/bin).
export function parseCommand(text) {
  const m = /^\/([\w:.-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  return m ? { name: m[1], args: (m[2] || '').trim() } : null;
}

// What the message box offers after "/": the chat's own commands, Claude Code's, and the CLI's (marked).
export function commandList(s) {
  const own = APP_COMMANDS;
  const claude = (s.meta.value.commands || []).filter((c) => !own.some((a) => matches(a, c.name)));
  const terminal = new Set(s.chat.value.init?.terminalCommands || []);
  const cli = CLI_COMMANDS.filter((c) => !own.some((a) => matches(a, c.name)) && !claude.some((x) => matches(x, c.name) && !terminal.has(x.name)));
  return [
    ...own,
    ...claude.map((c) => (terminal.has(c.name) ? { ...c, cli: true } : c)),
    ...cli,
  ];
}

// Runs `text` if it is a command the chat handles. Returns 'ran' (the message box empties), 'blocked' (it keeps
// the text), or false to send it to Claude Code as it is.
export function runCommand(s, text, ui) {
  const cmd = parseCommand(text);
  if (!cmd) return false;
  const own = APP_COMMANDS.find((c) => matches(c, cmd.name));
  if (own && !(own.passWithArgs && cmd.args)) {
    own.run(s, cmd.args, ui);
    return 'ran';
  }
  if (own) return false;
  const commands = s.meta.value.commands || [];
  const terminal = new Set(s.chat.value.init?.terminalCommands || []);
  const claude = commands.find((c) => matches(c, cmd.name));
  if (claude && !terminal.has(claude.name)) return false;
  const cli = claude || CLI_COMMANDS.find((c) => matches(c, cmd.name));
  if (cli) {
    confirmDialog({
      title: `/${cmd.name} opens in the CLI`,
      message: `${cli.description ? `${cli.description}. ` : ''}It is one of Claude Code’s interactive screens, which only its CLI shows. `
        + 'Continue this conversation in the CLI? The command is typed in for you there.',
      confirm: 'Open in the CLI',
    }).then((yes) => { if (yes) openInTerminal(s, { input: text.trim() }); });
    return 'blocked';
  }
  if (!commands.length) return false; // Claude Code's list hasn't come yet: let it decide
  toast(`/${cmd.name} isn’t a command. Type / to see them all.`, 'error');
  return 'blocked';
}
