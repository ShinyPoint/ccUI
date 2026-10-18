// One row per tool call, expandable into details. Pending permission requests render inside the
// card that asked for them.
import { memo } from 'preact/compat';
import { useContext, useState } from 'preact/hooks';
import { ChatContext } from './context.js';
import { Markdown } from './Items.jsx';
import { Collapse, Icon } from '../ui.jsx';
import { PermissionPrompt, QuestionPrompt, PlanPrompt } from './Prompts.jsx';
import { highlight, languageForPath } from '../../lib/markdown.js';
import { relPath, formatDuration, formatBytes, pluralize } from '../../lib/format.js';
import { countDiff, patchesFor, EDIT_TOOLS } from '../../lib/diff.js';
import { openChanges } from '../../lib/side.js';

const TASK_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']);
const SUBAGENT_TOOLS = new Set(['Agent', 'Task']);
const firstLine = (s) => String(s || '').split('\n')[0];
const lineCount = (s) => (s ? String(s).split('\n').length : 0);

// The glyph a step shows in place of its verb (lib/icons.js, tool*).
const TOOL_ICONS = {
  Bash: 'toolRun', BashOutput: 'toolOutput', KillShell: 'toolStop', TaskStop: 'toolStop',
  Read: 'toolRead', Write: 'toolWrite', Edit: 'toolEdit', MultiEdit: 'toolEdit', NotebookEdit: 'toolEdit',
  Glob: 'toolFind', Grep: 'toolSearch', WebFetch: 'toolWeb', WebSearch: 'toolWeb', Agent: 'toolAgent', Task: 'toolAgent',
  TodoWrite: 'toolTasks', TaskCreate: 'toolTasks', TaskUpdate: 'toolTasks', TaskList: 'toolTasks', TaskGet: 'toolTasks',
  Skill: 'toolSkill', AskUserQuestion: 'toolQuestion', ExitPlanMode: 'toolPlan', EnterPlanMode: 'toolPlan',
};
export function toolIcon(item) {
  if (item.name === 'Read' && item.data?.type === 'image') return 'toolImage';
  return TOOL_ICONS[item.name] || (/^mcp__/.test(item.name || '') ? 'toolPlug' : 'toolOther');
}

// Verb, target and a small meta label for the collapsed row.
export function describe(item, cwd) {
  const { name, input = {}, data } = item;
  const file = input.file_path || input.notebook_path || input.path;
  switch (name) {
    case 'Read': {
      if (data?.type === 'image') return { verb: 'View image', target: relPath(file, cwd), meta: imageInfo(item) };
      const range = input.offset ? ` · lines ${input.offset}–${input.offset + (input.limit || 0)}` : '';
      return { verb: 'Read', target: relPath(file, cwd), meta: range.slice(3) };
    }
    case 'Write':
      return { verb: data?.type === 'update' ? 'Overwrite' : 'Write', target: relPath(file, cwd), meta: input.content ? pluralize(lineCount(input.content), 'line') : '' };
    case 'Edit':
    case 'MultiEdit': {
      const { add, del } = countDiff(patchesFor(item));
      return { verb: 'Edit', target: relPath(file, cwd), diff: { add, del } };
    }
    case 'NotebookEdit':
      return { verb: 'Edit notebook', target: relPath(file, cwd) };
    case 'Bash':
      return { verb: 'Run', target: firstLine(input.command), mono: true, title: input.description };
    case 'BashOutput':
      return { verb: 'Check output', target: input.bash_id || '' };
    case 'KillShell':
    case 'TaskStop':
      return { verb: 'Stop', target: input.shell_id || input.task_id || '' };
    case 'Glob':
      return { verb: 'Find files', target: input.pattern, mono: true, meta: data?.numFiles != null ? pluralize(data.numFiles, 'file') : '' };
    case 'Grep':
      return { verb: 'Search', target: input.pattern, mono: true, meta: input.path ? `in ${relPath(input.path, cwd)}` : '' };
    case 'WebFetch':
      return { verb: 'Fetch', target: input.url };
    case 'WebSearch':
      return { verb: 'Search the web', target: input.query };
    case 'Agent':
    case 'Task':
      return { verb: 'Agent', target: input.description || '', meta: input.subagent_type && input.subagent_type !== 'general-purpose' ? input.subagent_type : '' };
    case 'TodoWrite':
      return { verb: 'Update tasks', target: '' };
    case 'TaskCreate':
      return { verb: 'Add task', target: input.subject };
    case 'TaskUpdate':
      return { verb: 'Update task', target: `#${input.taskId}${input.status ? ` → ${input.status.replace('_', ' ')}` : ''}` };
    case 'Skill':
      return { verb: 'Use skill', target: input.skill || input.name || '' };
    case 'AskUserQuestion':
      return { verb: 'Question', target: input.questions?.[0]?.question || '' };
    case 'ExitPlanMode':
      return { verb: 'Plan ready', target: '' };
    case 'EnterPlanMode':
      return { verb: 'Plan first', target: '' };
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
      if (mcp) return { verb: mcp[2].replace(/_/g, ' '), target: '', meta: mcp[1] };
      return { verb: name || 'Tool', target: '' };
    }
  }
}

export function DiffView({ patches, path }) {
  const lang = languageForPath(path);
  return (
    <div class="diff">
      {patches.map((h, hi) => {
        let oldNo = h.oldStart;
        let newNo = h.newStart;
        return (
          <div class="hunk" key={hi}>
            {patches.length > 1 && <div class="hunk-head">@@ −{h.oldStart} +{h.newStart} @@</div>}
            {h.lines.filter((l) => !l.startsWith('\\')).map((line, li) => {
              const sign = line[0];
              const text = line.slice(1);
              const cls = sign === '+' ? 'add' : sign === '-' ? 'del' : 'ctx';
              const a = sign === '+' ? '' : oldNo++;
              const b = sign === '-' ? '' : newNo++;
              return (
                <div class={`diff-line ${cls}`} key={li}>
                  <span class="ln">{a}</span><span class="ln">{b}</span>
                  <span class="sign">{sign === ' ' ? '' : sign}</span>
                  <code dangerouslySetInnerHTML={{ __html: highlight(text, lang) || ' ' }} />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function CodeView({ code, path, limit = 400 }) {
  const lines = String(code || '').split('\n');
  const shown = lines.slice(0, limit).join('\n');
  return (
    <div class="code-view">
      <pre><code class="hljs" dangerouslySetInnerHTML={{ __html: highlight(shown, languageForPath(path)) }} /></pre>
      {lines.length > limit && <div class="more">{pluralize(lines.length - limit, 'more line')} not shown</div>}
    </div>
  );
}

function Output({ text, error, limit = 300 }) {
  if (!text) return null;
  const lines = String(text).split('\n');
  return (
    <div class={`tool-output ${error ? 'error' : ''}`}>
      <pre>{lines.slice(0, limit).join('\n')}</pre>
      {lines.length > limit && <div class="more">{pluralize(lines.length - limit, 'more line')} not shown</div>}
    </div>
  );
}

// Read results come back numbered like `cat -n`; strip that for display.
const stripLineNumbers = (text) => String(text || '').replace(/^ *\d+[→\t]/gm, '');

function imageInfo(item) {
  const file = item.data?.type === 'image' ? item.data.file : null;
  const dims = file?.dimensions;
  const w = dims?.originalWidth || dims?.displayWidth;
  const h = dims?.originalHeight || dims?.displayHeight;
  return [w && h ? `${w}×${h}` : '', file?.originalSize ? formatBytes(file.originalSize) : ''].filter(Boolean).join(' · ');
}

function ImagePreview({ img, caption }) {
  const [actual, setActual] = useState(false);
  if (img.omitted) {
    return (
      <p class="tool-note">
        No preview: the image is {formatBytes(img.bytes)}, larger than the {formatBytes(PREVIEW_LIMIT)} preview limit.
        Claude still received it.
      </p>
    );
  }
  if (!img.data) return <p class="tool-note">No preview: Claude Code did not return the image data.</p>;
  return (
    <figure class={`image-preview ${actual ? 'actual' : ''}`}>
      <button type="button" onClick={() => setActual(!actual)} title={actual ? 'Fit to width' : 'Show actual size'}>
        <img src={`data:${img.mediaType || 'image/png'};base64,${img.data}`} alt={caption || 'Image read by Claude'} />
      </button>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

const PREVIEW_LIMIT = 3 * 1024 * 1024; // matches MAX_PREVIEW_BASE64 in src/main/agent.js

function ReadDetails({ item }) {
  const { data, result, isError, input = {} } = item;
  const file = input.file_path;
  if (isError) return <Output text={result} error />;
  if (item.images?.length) {
    const caption = imageInfo(item);
    return <div class="image-list">{item.images.map((img, i) => <ImagePreview key={i} img={img} caption={caption} />)}</div>;
  }
  if (data?.type === 'image') return <p class="tool-note">No preview: Claude Code did not return the image data.</p>;
  if (data?.type === 'pdf') return <p class="tool-note">PDF read by Claude. PDFs are not previewed here; open the file to view it.</p>;
  if (data?.type === 'notebook') return <p class="tool-note">Notebook with {pluralize(data.file?.cells?.length || 0, 'cell')} read by Claude.</p>;
  const text = stripLineNumbers(data?.file?.content ?? result);
  if (!text.trim()) return <p class="tool-note">The file is empty.</p>;
  return <CodeView code={text} path={file} limit={200} />;
}

function Details({ item, cwd, childItems, session }) {
  const { name, input = {}, data, result, isError } = item;
  const file = input.file_path || input.notebook_path;
  switch (name) {
    case 'Edit':
    case 'MultiEdit':
      return (
        <>
          <DiffView patches={patchesFor(item)} path={file} />
          {isError && <Output text={result} error />}
        </>
      );
    case 'Write':
      return (
        <>
          <CodeView code={input.content} path={file} />
          {isError && <Output text={result} error />}
        </>
      );
    case 'Read':
      return <ReadDetails item={item} />;
    case 'Bash': {
      const out = data ? [data.stdout, data.stderr].filter(Boolean).join('\n') : result;
      return (
        <div class="bash">
          <div class="bash-cmd"><span class="prompt-sign">$</span><pre>{input.command}</pre></div>
          {item.status === 'running' && <div class="bash-running">Running{item.elapsed ? ` · ${Math.round(item.elapsed)}s` : '…'}</div>}
          <Output text={out} error={isError} />
        </div>
      );
    }
    case 'Agent':
    case 'Task':
      return (
        <div class="subagent">
          {input.prompt && <details class="subagent-brief"><summary>Instructions</summary><div class="brief-text">{input.prompt}</div></details>}
          {childItems?.length > 0 && <Children items={childItems} cwd={cwd} session={session} />}
          {result && <Markdown text={result} className="subagent-result" />}
        </div>
      );
    case 'WebFetch':
    case 'WebSearch':
      return result ? <Markdown text={result.slice(0, 20000)} className="web-result" /> : null;
    case 'ExitPlanMode':
      return typeof input.plan === 'string' ? <Markdown text={input.plan} className="plan-text" /> : null;
    case 'AskUserQuestion': {
      const answers = data?.answers || input.answers;
      return answers ? (
        <dl class="answers">
          {Object.entries(answers).flatMap(([q, a]) => [<dt key={`q:${q}`}>{q}</dt>, <dd key={`a:${q}`}>{a}</dd>])}
        </dl>
      ) : <Output text={result} error={isError} />;
    }
    default:
      return (
        <>
          {Object.keys(input).length > 0 && <Output text={JSON.stringify(input, null, 2)} />}
          <Output text={result} error={isError} />
        </>
      );
  }
}

// Nested activity of a subagent, collapsed to the latest few steps.
function Children({ items, cwd, session }) {
  const [all, setAll] = useState(false);
  const permissions = useContext(ChatContext).permissions;
  const tools = items.filter((i) => i.type === 'tool');
  // The latest few, plus any step waiting for permission (its prompt is in its row).
  const shown = all ? tools : tools.filter((t, i) => i >= tools.length - 4 || permissions[t.id]);
  return (
    <div class="children">
      {!all && tools.length > shown.length && (
        <button class="link-btn" onClick={() => setAll(true)}>Show all {tools.length} steps</button>
      )}
      {shown.map((child) => <ToolCard key={child.key} item={child} cwd={cwd} session={session} nested />)}
    </div>
  );
}

const STATUS_LABEL = { streaming: 'Preparing', pending: 'Waiting', running: 'Running', done: 'Done', error: 'Failed', cancelled: 'Not run' };
const IN_PROGRESS = new Set(['streaming', 'pending', 'running']);
const PROGRESS_VERBS = {
  Edit: 'Editing',
  MultiEdit: 'Editing',
  Write: 'Writing',
  NotebookEdit: 'Editing notebook',
  Read: 'Reading',
  Bash: 'Running',
  Grep: 'Searching',
  Glob: 'Finding files',
  WebFetch: 'Fetching',
  WebSearch: 'Searching the web',
};

// While the input is still streaming, pick the file path out of the partial JSON so the row can name it.
function partialPath(inputJson) {
  const m = /"(?:file_path|notebook_path)"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(inputJson || '');
  if (!m) return '';
  try { return JSON.parse(`"${m[1]}"`); } catch { return ''; }
}

// Edit/Write panels only make sense once there is something to show.
function hasBody(item) {
  switch (item.name) {
    case 'Edit':
    case 'MultiEdit':
      return patchesFor(item).length > 0 || item.isError;
    case 'Write':
      return Boolean(item.input?.content) || item.isError;
    default:
      return true;
  }
}

// An agent sent to the background: its tool result only says it was launched. The card shows it running until
// Claude Code reports it ended (bgStatus, from the reducer), then its outcome and summary.
const BG_STATUS = { completed: 'done', failed: 'error', stopped: 'cancelled' };
function backgroundView(item) {
  if (item.data?.status !== 'async_launched') return item;
  return {
    ...item,
    status: item.bgStatus ? BG_STATUS[item.bgStatus] || 'done' : 'running',
    isError: item.bgStatus === 'failed',
    result: item.bgSummary || '',
    background: true,
  };
}

export const ToolCard = memo(function ToolCard({ item: raw, cwd, session, childItems, nested }) {
  const item = backgroundView(raw);
  const permissions = useContext(ChatContext).permissions;
  const permission = permissions[item.id];
  const info = describe(item, cwd);
  const editLike = item.name === 'Edit' || item.name === 'MultiEdit' || item.name === 'Write';
  const [open, setOpen] = useState(editLike && !nested);
  const quiet = TASK_TOOLS.has(item.name);
  // A subagent's step waiting for permission shows its prompt inside this card, so the card opens for it.
  const childAsking = Boolean(childItems?.some((c) => permissions[c.id]));
  const expanded = (open || Boolean(permission) || childAsking) && !quiet;
  // Until the step finishes (or asks for permission) show only a present-tense header, no empty panel.
  const inProgress = IN_PROGRESS.has(item.status) && !permission;
  const showBody = expanded && !(editLike && inProgress) && hasBody(item);
  const verb = inProgress && PROGRESS_VERBS[item.name] ? PROGRESS_VERBS[item.name] : info.verb;
  const target = info.target || (inProgress ? relPath(partialPath(item.inputJson), cwd) : '');
  const status = permission ? 'asking' : item.decision === 'denied' && item.status !== 'done' ? 'denied' : item.status;
  const duration = item.endedAt && item.startedAt && item.status === 'done' && item.endedAt - item.startedAt > 1500
    ? formatDuration(item.endedAt - item.startedAt) : '';
  const errorLine = item.isError && !expanded ? firstLine(item.result).slice(0, 160) : '';

  let prompt = null;
  if (permission) {
    if (item.name === 'AskUserQuestion') prompt = <QuestionPrompt session={session} request={permission} />;
    else if (item.name === 'ExitPlanMode') prompt = <PlanPrompt session={session} request={permission} />;
    else prompt = <PermissionPrompt session={session} request={permission} />;
  }

  return (
    <div class={`tool ${nested ? 'nested' : ''} ${SUBAGENT_TOOLS.has(item.name) ? 'agent' : ''}`} data-status={status}>
      {/* The step's glyph stands for its verb (named in the tooltip and for screen readers): a fading gray circle
          while it works, the glyph when done, red when it failed. A step with nothing to name shows the verb. */}
      <button class="tool-head" onClick={() => !quiet && setOpen(!open)} aria-expanded={expanded} disabled={quiet}
              aria-label={`${verb}${target ? `: ${target}` : ''} (${STATUS_LABEL[item.status] || item.status})`}
              title={[verb, info.title].filter(Boolean).join(' — ')}>
        <span class="tool-glyph" aria-hidden="true"><Icon name={toolIcon(item)} size={15} /></span>
        {!target && <span class={`tool-target as-verb ${inProgress ? 'in-progress' : ''}`}>{verb}</span>}
        {target && (EDIT_TOOLS.has(item.name) && item.status === 'done' && session?.side
          ? <span class="tool-target file-link" role="link" tabIndex={0} title="Show in Changes"
                  onClick={(e) => { e.stopPropagation(); openChanges(session, { toolId: item.id, path: item.input?.file_path || item.input?.notebook_path }); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); openChanges(session, { toolId: item.id, path: item.input?.file_path || item.input?.notebook_path }); } }}>
              {target}
            </span>
          : <span class={`tool-target ${info.mono ? 'mono' : ''}`}>{target}</span>)}
        <span class="tool-meta">
          {info.diff && (info.diff.add > 0 || info.diff.del > 0) && (
            <span class="diffstat"><span class="add">+{info.diff.add}</span> <span class="del">−{info.diff.del}</span></span>
          )}
          {info.meta && <span>{info.meta}</span>}
          {SUBAGENT_TOOLS.has(item.name) && childItems?.length > 0 && <span>{pluralize(childItems.filter((c) => c.type === 'tool').length, 'step')}</span>}
          {item.background && item.status === 'running' && <span>In the background</span>}
          {item.background && item.bgStatus === 'stopped' && <span>Stopped</span>}
          {status === 'denied' && <span class="denied">Denied</span>}
          {duration && <span>{duration}</span>}
        </span>
      </button>
      {errorLine && <div class="tool-error-line">{errorLine}</div>}
      <Collapse open={showBody}>
        <div class="tool-body">
          <Details item={item} cwd={cwd} childItems={childItems} session={session} />
        </div>
      </Collapse>
      {prompt}
    </div>
  );
});
