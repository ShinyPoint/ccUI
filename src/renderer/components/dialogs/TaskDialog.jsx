// A background task's details, opened from its row above the message box: a subagent's instructions, its steps and
// what it reported (as its card in the conversation shows them, steps waiting for permission included); a shell's
// command and its output as it comes, read from the file Claude Code writes it to. Stop while it runs.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Dialog, Icon } from '../ui.jsx';
import { ToolDetails, backgroundView } from '../chat/ToolCard.jsx';
import { ChatContext } from '../chat/context.js';
import { api, sessions, taskDialog } from '../../lib/store.js';
import { childrenOf } from '../../lib/chat-reducer.js';
import { stopTask } from '../../lib/sessions.js';
import { formatDuration, pluralize } from '../../lib/format.js';
import { t, phrase } from '../../lib/i18n.js';

export const TASK_ICON = { local_bash: 'toolRun', mcp_task: 'toolPlug' }; // anything else is an agent of some kind
const KIND_NAME = { local_bash: phrase('Shell') };
export const taskKindName = (a) => (KIND_NAME[a.kind] ? t(KIND_NAME[a.kind]) : a.subagentType || t('Agent'));
const ENDED = { completed: phrase('Done'), failed: phrase('Failed'), stopped: phrase('Stopped') };

// Where a background shell writes its output: Claude Code says so when the task ends, and in the tool's result
// when it starts it ("… Output is being written to: <file>").
function outputFile(task, tool) {
  if (task.outputFile) return task.outputFile;
  const said = [tool?.result, tool?.data?.stdout].find((x) => typeof x === 'string' && /being written to:/i.test(x));
  return said?.match(/being written to:\s*(\S[^\r\n]*?)\s*$/im)?.[1] || '';
}

// The end of the output, read again every second while the shell runs (once more when it ends).
function ShellOutput({ file, running }) {
  const [out, setOut] = useState({ text: '', cut: false, read: false });
  const box = useRef(null);
  const stuck = useRef(true); // following the end, unless scrolled up
  useEffect(() => {
    if (!file) return undefined;
    let live = true;
    const read = () => api.taskOutput(file).then((res) => { if (live) setOut({ text: res.ok ? res.text : '', cut: Boolean(res.cut), read: true }); });
    read();
    const timer = running ? setInterval(read, 1000) : null;
    return () => { live = false; clearInterval(timer); };
  }, [file, running]);
  useEffect(() => { if (box.current && stuck.current) box.current.scrollTop = box.current.scrollHeight; }, [out.text]);
  if (!file) return <p class="tool-note">{t('Claude Code didn’t say where this shell’s output goes.')}</p>;
  return (
    <div class="tool-output task-output">
      {out.cut && <div class="more">{t('The last 64 KB')}</div>}
      <pre ref={box} onScroll={(e) => { const el = e.currentTarget; stuck.current = el.scrollHeight - el.clientHeight - el.scrollTop < 8; }}>
        {out.text || (out.read ? (running ? t('No output yet.') : t('No output.')) : t('Loading…'))}
      </pre>
    </div>
  );
}

function TaskBody({ s, chat, task }) {
  s.tick.value; // the elapsed time
  const raw = task.toolUseId != null ? chat.items[chat.index[task.toolUseId]] : null;
  const tool = raw ? backgroundView(raw) : null;
  const running = task.status === 'running';
  const shell = task.kind === 'local_bash';
  const permissions = useMemo(
    () => Object.fromEntries(chat.permissions.filter((p) => p.toolUseID).map((p) => [p.toolUseID, p])),
    [chat.permissions],
  );
  const meta = [
    running ? formatDuration(Date.now() - task.startedAt) : t(ENDED[task.status] || 'Ended'),
    task.toolUses ? pluralize(task.toolUses, 'tool') : '',
    task.tokens ? t('{n} tokens', { n: task.tokens.toLocaleString() }) : '',
  ].filter(Boolean).join(' · ');
  return (
    <ChatContext.Provider value={{ permissions }}>
      <div class="task-head">
        <span class="task-kind" title={taskKindName(task)}><Icon name={TASK_ICON[task.kind] || 'toolAgent'} size={16} /></span>
        <h3>{task.description || taskKindName(task)}</h3>
        <button type="button" class="icon-btn" aria-label={t('Close')} title={t('Close (Esc)')} onClick={() => { taskDialog.value = null; }}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <p class="task-meta">{[taskKindName(task), meta].join(' · ')}</p>
      <div class="task-body">
        {shell ? (
          <>
            {tool?.input?.command && <div class="bash"><div class="bash-cmd"><span class="prompt-sign">$</span><pre>{tool.input.command}</pre></div></div>}
            <ShellOutput file={outputFile(task, tool)} running={running} />
          </>
        ) : tool ? (
          <ToolDetails item={tool} cwd={s.cwd} session={s} childItems={childrenOf(chat, tool.id)} />
        ) : (
          <p class="tool-note">{task.summary || t('Claude Code hasn’t said more about this task.')}</p>
        )}
        {!shell && tool && !tool.result && task.summary && <p class="tool-note">{task.summary}</p>}
      </div>
      <div class="dialog-actions">
        {running && <button type="button" class="secondary-btn" onClick={() => stopTask(s, task.id)}>{t('Stop this task')}</button>}
        <button type="button" class="primary-btn" autofocus onClick={() => { taskDialog.value = null; }}>{t('Done')}</button>
      </div>
    </ChatContext.Provider>
  );
}

export function TaskDialog() {
  const open = taskDialog.value;
  const s = open ? sessions.value.find((x) => x.uid === open.uid) : null;
  const chat = s?.chat.value;
  const task = chat?.agents?.[open?.id];
  return (
    <Dialog open={Boolean(task)} className="dialog-task" onClose={() => { taskDialog.value = null; }}>
      {task && <TaskBody s={s} chat={chat} task={task} />}
    </Dialog>
  );
}
