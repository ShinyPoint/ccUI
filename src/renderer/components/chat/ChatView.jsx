import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon, Collapse, Menu, usePresence } from '../ui.jsx';
import { ChatContext } from './context.js';
import { ToolCard, toolIcon } from './ToolCard.jsx';
import { PermissionPrompt } from './Prompts.jsx';
import { Composer } from './Composer.jsx';
import { FindBar } from './FindBar.jsx';
import { ClaudePreparing } from '../ClaudePreparing.jsx';
import { ProjectMenu } from '../ProjectMenu.jsx';
import { HistoryRail } from './HistoryRail.jsx';
import { UserItem, TextItem, ThinkingItem, NoticeItem, CommandOutputItem, TurnItem, DividerItem, WakeItem, Markdown, localText, MessageTime } from './Items.jsx';
import { topLevel, childrenOf, currentActivity, groupTurns, backgroundTasks, answerText } from '../../lib/chat-reducer.js';
import { api, settings, settingsDialog, findBar, toast, taskDialog } from '../../lib/store.js';
import { TASK_ICON, taskKindName } from '../dialogs/TaskDialog.jsx';
import { openInTerminal, retryChat, stopTask, stopAllTasks, dismissSideNote } from '../../lib/sessions.js';
import { formatCost, formatDuration, pluralize } from '../../lib/format.js';
import { turnChanges } from '../../lib/diff.js';
import { openChanges } from '../../lib/side.js';
import { t, phrase } from '../../lib/i18n.js';

const ITEM_VIEWS = {
  user: UserItem,
  text: TextItem,
  thinking: ThinkingItem,
  notice: NoticeItem,
  'command-output': CommandOutputItem,
  turn: TurnItem,
  divider: DividerItem,
  wake: WakeItem,
};

// Shown and sent in the app's language (t()).
const STARTERS = [
  phrase('Give me a quick tour of this project: what it does and how it is organized.'),
  phrase('Find the most likely bug in this code and explain it before fixing anything.'),
  phrase('Add tests for the least-tested part of this project.'),
];

function TaskStrip({ tasks: now, busy }) {
  const [open, setOpen] = useState(false);
  const el = useRef(null);
  const last = useRef(now);
  const present = now.length > 0 && !(now.every((task) => task.status === 'completed') && !busy && !open);
  if (present) last.current = now;
  const kept = usePresence(present, el);
  if (!kept) return null;
  const tasks = present ? now : last.current; // folding away: as it was
  const done = tasks.filter((task) => task.status === 'completed').length;
  const current = tasks.find((task) => task.status === 'in_progress');
  return (
    <div class={`tasks ${open ? 'open' : ''}`} ref={el}>
      <button class="tasks-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span class="tasks-progress"><span style={{ width: `${(done / tasks.length) * 100}%` }} /></span>
        <span class="tasks-count">{done}/{tasks.length}</span>
        <span class="tasks-current">{current ? current.activeForm || current.content : done === tasks.length ? t('All tasks done') : t('Tasks')}</span>
        <Icon name="chevron" size={14} />
      </button>
      <Collapse open={open}>
        <ul class="task-list">
          {tasks.map((task) => (
            <li key={task.id} data-status={task.status}>
              <span class="task-box">{task.status === 'completed' && <Icon name="check" size={11} />}</span>
              <span>{task.content}</span>
            </li>
          ))}
        </ul>
      </Collapse>
    </div>
  );
}

// Background tasks (subagents, background shells) above the message box: what each is doing, and a button to
// stop it. Ended ones stay a few seconds, then fold away.
const ENDED_SHOWN_MS = 5000;
const ENDED_LABEL = { completed: phrase('Done'), failed: phrase('Failed'), stopped: phrase('Stopped') };
function AgentStrip({ s, chat }) {
  s.tick.value; // elapsed times, and ended tasks leaving
  const [open, setOpen] = useState(true);
  const el = useRef(null);
  const last = useRef([]);
  const now = Date.now();
  const listed = backgroundTasks(chat).filter((a) => a.status === 'running' || now - a.endedAt < ENDED_SHOWN_MS);
  if (listed.length) last.current = listed;
  const kept = usePresence(listed.length > 0, el);
  if (!kept) return null;
  const shown = listed.length ? listed : last.current; // folding away: as it was
  // In its last second an ended task folds out of the list, unless it is the last one (then the strip goes).
  const staying = shown.filter((a) => a.status === 'running' || now - a.endedAt < ENDED_SHOWN_MS - 1000);
  const leaving = (a) => staying.length > 0 && !staying.includes(a);
  const running = shown.filter((a) => a.status === 'running').length;
  return (
    <div class={`tasks agents ${open ? 'open' : ''}`} ref={el}>
      <div class="agents-head">
        <button class="agents-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span class={`agents-dot ${running ? 'busy' : ''}`} />
          <span class="tasks-current">
            {running ? t('{tasks} running', { tasks: pluralize(running, 'background task') }) : t('Background tasks done')}
          </span>
          <Icon name="chevron" size={14} />
        </button>
        {running > 1 && <button class="agents-stop-all" onClick={() => stopAllTasks(s)}>{t('Stop all')}</button>}
      </div>
      <Collapse open={open}>
        <ul class="agent-list">
          {shown.map((a) => (
            <li key={a.id} data-status={a.status} class={leaving(a) ? 'leaving' : ''}>
              {/* The row opens the task's details (TaskDialog): a subagent's steps, a shell's output. */}
              <button type="button" class="agent-open" aria-label={t('Details of {task}', { task: a.description || taskKindName(a) })}
                      onClick={() => { taskDialog.value = { uid: s.uid, id: a.id }; }}>
                <span class="agent-mark">
                  {a.status === 'completed' ? <Icon name="check" size={12} /> : a.status !== 'running' ? <Icon name="x" size={12} /> : null}
                </span>
                <span class="agent-kind" title={taskKindName(a)}><Icon name={TASK_ICON[a.kind] || 'toolAgent'} size={14} /></span>
                <span class="agent-desc" title={a.summary || a.description}>{a.description || t('Working')}</span>
                <span class="agent-meta">
                  {a.status === 'running'
                    ? [formatDuration(now - a.startedAt), a.toolUses ? pluralize(a.toolUses, 'tool') : '', a.lastTool].filter(Boolean).join(' · ')
                    : ENDED_LABEL[a.status] ? t(ENDED_LABEL[a.status]) : t('Ended')}
                </span>
              </button>
              {a.status === 'running'
                ? <button class="icon-btn agent-stop" title={t('Stop this task')} aria-label={a.description ? t('Stop {task}', { task: a.description }) : t('Stop this task')}
                          onClick={() => stopTask(s, a.id)}><Icon name="stop" size={12} /></button>
                : <span />}
            </li>
          ))}
        </ul>
      </Collapse>
    </div>
  );
}

// /btw: side questions and their answers, above the message box. They aren't part of the conversation, so they
// stay here (one at a time is the usual case) until closed.
function SideNotes({ s }) {
  const el = useRef(null);
  const last = useRef([]);
  const now = s.sideNotes.value;
  if (now.length) last.current = now;
  const kept = usePresence(now.length > 0, el);
  if (!kept) return null;
  const notes = now.length ? now : last.current; // folding away: as it was
  return (
    <div class="tasks side-notes" ref={el}>
      {notes.map((n) => (
        <div class={`side-note-item ${n.state}`} key={n.id}>
          <div class="side-note-head">
            <span class="side-note-tag">btw</span>
            <span class="side-note-q" title={n.question}>{n.question}</span>
            {n.state === 'done' && (
              <button class="icon-btn" title={t('Copy the answer')} onClick={() => { api.writeClipboard(n.answer); toast(t('Copied.')); }}>
                <Icon name="copy" size={13} />
              </button>
            )}
            <button class="icon-btn" title={t('Close')} onClick={() => dismissSideNote(s, n.id)}><Icon name="x" size={13} /></button>
          </div>
          {n.state === 'asking'
            ? <div class="side-note-wait"><span class="agents-dot busy" />{t('Claude is answering beside the conversation…')}</div>
            : <Markdown className="side-note-a" text={n.answer} />}
        </div>
      ))}
    </div>
  );
}

function ProblemCard({ s }) {
  const problem = s.problem.value;
  const subscription = problem.code === 'subscription';
  const title = subscription ? t('Chat sessions need an API key')
    : problem.code === 'no-binary' ? t('Claude Code was not found')
    : problem.code === 'untrusted' ? t('This folder is not trusted')
    : t('Claude Code could not start');
  return (
    <div class="problem">
      <h2>{title}</h2>
      {subscription ? (
        <p>
          {t('Claude Code on this computer is signed in with a Claude.ai subscription. Apps like this one can only use an Anthropic API key or a cloud provider (Amazon Bedrock, Google Vertex AI, Microsoft Foundry) for chat sessions. Add a key in Settings, or keep working in Claude Code’s own CLI.')}
        </p>
      ) : (
        <p class="problem-detail">{problem.text}</p>
      )}
      <div class="problem-actions">
        {subscription && <button class="primary-btn" onClick={() => { settingsDialog.value = 'account'; }}>{t('Add API key')}</button>}
        {problem.code === 'no-binary' && <button class="primary-btn" onClick={() => { settingsDialog.value = true; }}>{t('Open settings')}</button>}
        <button class="secondary-btn" onClick={() => openInTerminal(s)}><Icon name="terminal" />{t('Open in CLI')}</button>
        <button class="secondary-btn" onClick={() => retryChat(s)}>{problem.code === 'untrusted' ? t('Ask again') : t('Try again')}</button>
      </div>
    </div>
  );
}

// A new chat: a question right above the message box; the two sit together in the middle (.chat.empty), with the
// suggested prompts under the question when those are on (Settings). The project is in the chips over the message
// box (IntroChips).
function Intro({ onPick }) {
  const starters = Boolean(settings.value.showStarters);
  return (
    <div class="chat-intro">
      <h2>{t('What should Claude do today?')}</h2>
      {starters && (
        <div class="starters">
          {STARTERS.map((text) => <button key={text} class="starter" onClick={() => onPick(t(text))}>{t(text)}</button>)}
        </div>
      )}
    </div>
  );
}

// Over the message box of a new chat: the project (choosing another starts a new chat there) and how the
// session is shown (choosing CLI continues it in Claude Code's own CLI).
function IntroChips({ s }) {
  return (
    <div class="intro-chips">
      <ProjectMenu s={s} chip />
      <Menu className="intro-chip" title={t('How the session is shown')} up={false} value="chat"
            label={<><Icon name="chat" size={15} /><span class="menu-text">{t('Chat')}</span></>}
            options={[
              { value: 'chat', label: t('Chat'), hint: t('Claude’s work as a conversation you can read and steer.') },
              { value: 'terminal', label: 'CLI', hint: t('Claude Code’s own command-line interface.') },
            ]}
            onSelect={(kind) => { if (kind === 'terminal') openInTerminal(s); }} />
    </div>
  );
}

const GLIDE_MS = 220;
const easeOutCubic = (x) => 1 - (1 - x) ** 3;

// Quick slide to the bottom: a fixed ~0.2 s ease-out however far away it is. Long jumps start the slide
// a screen and a half from the end so the motion stays readable. Wheel or click stops it; with
// "reduce motion" it jumps.
function glideToBottom(el) {
  cancelAnimationFrame(el.glide);
  const end = () => el.scrollHeight - el.clientHeight; // re-read each frame: content may still be streaming in
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.scrollTop = end();
    return;
  }
  const runway = el.clientHeight * 1.5;
  if (end() - el.scrollTop > runway) el.scrollTop = end() - runway;
  const from = el.scrollTop;
  const start = performance.now();
  const stop = () => {
    cancelAnimationFrame(el.glide);
    el.glide = 0;
    el.removeEventListener('wheel', stop);
    el.removeEventListener('pointerdown', stop);
  };
  const frame = (now) => {
    const progress = Math.min(1, (now - start) / GLIDE_MS);
    el.scrollTop = from + (end() - from) * easeOutCubic(progress);
    if (progress < 1) el.glide = requestAnimationFrame(frame);
    else stop();
  };
  el.addEventListener('wheel', stop, { passive: true });
  el.addEventListener('pointerdown', stop);
  el.glide = requestAnimationFrame(frame);
}

// Following the bottom as content arrives: instead of jumping, the view eases a fifth of the remaining way each
// frame, so new lines slide in (a reply streaming, a step appearing, your message going out). The end is re-read
// every frame, so it keeps up with content that is still growing. With "reduce motion" it jumps.
function follow(el) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.scrollTop = el.scrollHeight;
    return;
  }
  if (el.follow) return; // already on its way
  const frame = () => {
    const end = el.scrollHeight - el.clientHeight;
    const gap = end - el.scrollTop;
    if (gap <= 1) {
      el.scrollTop = end;
      el.follow = 0;
      return;
    }
    el.scrollTop += Math.ceil(gap * 0.2);
    el.follow = requestAnimationFrame(frame);
  };
  el.follow = requestAnimationFrame(frame);
}

function stopFollowing(el) {
  cancelAnimationFrame(el.follow);
  el.follow = 0;
}

// Parents whose new children animate in (.enter in chat.css): the conversation, a turn's opened steps, a subagent's.
const ENTER_PARENTS = '.timeline, .work-steps, .children';
// More than this many at once is a conversation being loaded, not something arriving: it just appears.
const ENTER_MAX = 8;

// A finished turn folds Claude's working steps into one line; the answer stays visible.
function Turn({ g, s, renderItem }) {
  const [open, setOpen] = useState(() => s.openTurns.has(g.key));
  const steps = g.work.filter((i) => i.type === 'tool');
  const foldable = !g.live && (steps.length > 0 || g.work.some((i) => i.type === 'thinking'));
  const toggle = () => {
    if (open) s.openTurns.delete(g.key);
    else s.openTurns.add(g.key);
    setOpen(!open);
  };
  const answer = g.live ? '' : answerText(g);
  if (!foldable) {
    // The answer's Copy and the turn's time and cost share the line under it.
    const foot = answer ? <div class="turn-foot"><AnswerActions text={answer} at={answerTime(g)} />{g.end && renderItem(g.end)}</div> : g.end && renderItem(g.end);
    return <>{renderItem(g.user)}{g.work.map(renderItem)}{g.errors.map(renderItem)}<Answer g={g} renderItem={renderItem}>{foot}</Answer></>;
  }
  const changes = turnChanges(s.chat.value, g);
  const added = changes.reduce((n, c) => n + c.add, 0);
  const removed = changes.reduce((n, c) => n + c.del, 0);
  const failed = steps.filter((i) => i.status === 'error').length;
  const duration = g.end?.durationMs ? formatDuration(g.end.durationMs) : '';
  const details = [
    steps.length ? pluralize(steps.length, 'step') : '',

    failed ? t('{n} failed', { n: failed }) : '',
  ].filter(Boolean).join(' · ');
  return (
    <>
      {renderItem(g.user)}
      <div class="ws-row">
        <button class={`work-summary ${open ? 'open' : ''}`} aria-expanded={open} onClick={toggle}
                title={open ? t('Hide the steps Claude took') : t('Show the steps Claude took')}>
          <Icon name="chevron" size={14} />
          <span class="ws-title">{g.end?.interrupted
            ? (duration ? t('Stopped for {time}', { time: duration }) : t('Stopped'))
            : (duration ? t('Worked for {time}', { time: duration }) : t('Worked'))}</span>
          {details && <span class="ws-details">{details}</span>}
          {g.end?.cost > 0 && <span class="ws-cost">{formatCost(g.end.cost)}</span>}
        </button>
        {changes.length > 0 && (
          <button class="ws-files" title={t('Show what this turn changed')} onClick={() => openChanges(s, { turnKey: g.key })}>
            <Icon name="diff" size={13} />{pluralize(changes.length, 'file')}
            <span class="diffstat"><span class="add">+{added}</span> <span class="del">−{removed}</span></span>
          </button>
        )}
      </div>
      <Collapse open={open}><div class="work-steps">{g.work.map(renderItem)}</div></Collapse>
      {g.errors.map(renderItem)}
      <Answer g={g} renderItem={renderItem}>{answer && <div class="turn-foot"><AnswerActions text={answer} at={answerTime(g)} /></div>}</Answer>
    </>
  );
}

// A turn's answer and the line under it, together, so pointing anywhere on the answer shows its time.
function Answer({ g, renderItem, children }) {
  if (!g.answer.length && !children) return null;
  return <div class="answer">{g.answer.map(renderItem)}{children}</div>;
}

// When the answer was written: its last part's time.
const answerTime = (g) => g.answer.filter((i) => i.type === 'text' && i.at).at(-1)?.at || null;

// Under a finished turn's answer, at its left: Copy takes the answer (as Claude wrote it, in Markdown), not the
// steps Claude took on the way; then the time it was written, shown on hover.
function AnswerActions({ text, at }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div class="answer-actions">
      <button type="button" class={`icon-btn ${copied ? 'copied' : ''}`} title={t('Copy the answer')}
              onClick={() => { api.writeClipboard(text); setCopied(true); }}>
        <Icon name={copied ? 'check' : 'copy'} size={14} />
      </button>
      {at && <MessageTime at={at} />}
    </div>
  );
}

// How Claude Code says it is at work: one of its playful verbs, the same through a turn and another the next.
const VERBS = [
  phrase('Accomplishing…'), phrase('Architecting…'), phrase('Baking…'), phrase('Brewing…'), phrase('Calculating…'),
  phrase('Cerebrating…'), phrase('Channeling…'), phrase('Choreographing…'), phrase('Churning…'), phrase('Clauding…'),
  phrase('Coalescing…'), phrase('Cogitating…'), phrase('Composing…'), phrase('Computing…'), phrase('Concocting…'),
  phrase('Considering…'), phrase('Contemplating…'), phrase('Cooking…'), phrase('Crafting…'), phrase('Crunching…'),
  phrase('Crystallizing…'), phrase('Deciphering…'), phrase('Deliberating…'), phrase('Doodling…'),
  phrase('Elucidating…'), phrase('Envisioning…'), phrase('Fermenting…'), phrase('Forging…'), phrase('Hatching…'),
  phrase('Ideating…'), phrase('Imagining…'), phrase('Improvising…'), phrase('Incubating…'), phrase('Inferring…'),
  phrase('Kneading…'), phrase('Marinating…'), phrase('Meandering…'), phrase('Moseying…'), phrase('Mulling…'),
  phrase('Noodling…'), phrase('Orchestrating…'), phrase('Philosophizing…'), phrase('Polishing…'),
  phrase('Pondering…'), phrase('Puzzling…'), phrase('Ruminating…'), phrase('Simmering…'), phrase('Sketching…'),
  phrase('Spelunking…'), phrase('Stewing…'), phrase('Synthesizing…'), phrase('Thinking…'), phrase('Tinkering…'),
  phrase('Unraveling…'), phrase('Vibing…'), phrase('Whisking…'), phrase('Working…'), phrase('Wrangling…'),
];
const verbFor = (key) => VERBS[[...String(key)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % VERBS.length];

function Activity({ s, chat }) {
  s.tick.value; // re-render every second for the elapsed time
  const label = currentActivity(chat);
  if (!label) return null;
  const lastUser = [...chat.items].reverse().find((i) => i.type === 'user');
  const elapsed = lastUser?.at ? formatDuration(Date.now() - lastUser.at) : '';
  const generic = label === 'Thinking…' || label === 'Working…';
  return (
    <div class={`activity ${chat.permissions.length ? 'asking' : ''}`} aria-live="polite">
      <span class="activity-mark" aria-hidden="true" />
      <span>{generic ? t(verbFor(lastUser?.key ?? chat.items.length)) : localText(label)}</span>
      {elapsed && <span class="activity-time">{elapsed}</span>}
    </div>
  );
}

export function ChatView({ s }) {
  const chat = s.chat.value;
  const scroller = useRef(null);
  const timeline = useRef(null);
  const stick = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [prefill, setPrefill] = useState(null);

  const items = useMemo(() => topLevel(chat), [chat.items]);
  const empty = !s.problem.value && items.length === 0;
  // The first message sends the message box from the middle down to the bottom: it slides there (FLIP).
  const bottom = useRef(null);
  const placed = useRef({ top: null, empty });
  useLayoutEffect(() => {
    const el = bottom.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const before = placed.current;
    if (before.empty && !empty && before.top != null && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const dy = before.top - top;
      if (Math.abs(dy) > 4) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 340, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    }
    placed.current = { top, empty };
  });
  const saved = Boolean(chat.sessionId || s.sessionId); // the conversation exists on disk: messages can be rewound or forked
  const groups = useMemo(() => groupTurns(items, chat.busy), [items, chat.busy]);
  const renderItem = (item) => {
    if (item.type === 'tool') {
      const kids = item.name === 'Agent' || item.name === 'Task' ? childrenOf(chat, item.id) : undefined;
      return <ToolCard key={item.key} item={item} cwd={s.cwd} session={s} childItems={kids} />;
    }
    const View = ITEM_VIEWS[item.type];
    return View ? <View key={item.key} item={item} s={s} saved={saved} /> : null;
  };
  const permissions = useMemo(
    () => Object.fromEntries(chat.permissions.filter((p) => p.toolUseID).map((p) => [p.toolUseID, p])),
    [chat.permissions],
  );
  const context = useMemo(() => ({ permissions }), [permissions]);
  const orphans = chat.permissions.filter((p) => !p.toolUseID || chat.index[p.toolUseID] == null);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (s.scrollTop != null) {
      el.scrollTop = s.scrollTop;
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    } else el.scrollTop = el.scrollHeight;
    return () => { s.scrollTop = stick.current ? null : el.scrollTop; };
  }, [s.uid]);

  useLayoutEffect(() => {
    // While the "Latest" glide runs it owns the scroll position (it also follows new content).
    if (stick.current && !scroller.current.glide) follow(scroller.current);
  });

  useEffect(() => {
    // New permission prompts always come into view.
    if (chat.permissions.length) {
      stick.current = true;
      follow(scroller.current);
    }
  }, [chat.permissions.length]);

  useEffect(() => {
    // What is added after the chat is shown animates in. Classes are added before the next paint (mutation
    // observers run first), so nothing shows in place for a frame before it moves.
    const observer = new MutationObserver((records) => {
      const added = [];
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1 && !node.classList.contains('collapse') && node.parentElement?.matches(ENTER_PARENTS)) added.push(node);
        }
      }
      if (added.length > ENTER_MAX) return;
      for (const node of added) {
        const done = (e) => {
          if (e.target !== node) return; // a child's own animation
          node.classList.remove('enter');
          node.removeEventListener('animationend', done);
        };
        node.addEventListener('animationend', done);
        node.classList.add('enter');
      }
    });
    observer.observe(timeline.current, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // Content can change height without a re-render here (bars animating open or shut), and the chat itself
    // can get shorter (the Terminal panel opening, the window resizing): follow the bottom if we are following,
    // otherwise show or hide "Latest" for what is now below.
    const el = scroller.current;
    const observer = new ResizeObserver(() => {
      if (el.glide) return;
      if (stick.current) follow(el);
      else setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight >= 80);
    });
    observer.observe(el.firstElementChild);
    observer.observe(el);
    return () => {
      observer.disconnect();
      stopFollowing(el);
    };
  }, []);

  // One of your messages, from the history rail: brought to the top of the view (a little below its edge), and the
  // chat stops following the bottom, as when you scroll up yourself.
  const jumpTo = (key) => {
    const el = scroller.current;
    const node = el?.querySelector(`.msg-user-wrap[data-key="${CSS.escape(key)}"]`);
    if (!node) return;
    cancelAnimationFrame(el.glide);
    el.glide = 0;
    stopFollowing(el);
    stick.current = false;
    const top = node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 16;
    el.scrollTo({ top: Math.max(0, top), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    node.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(.9)' }, { filter: 'brightness(1)' }], { duration: 700, delay: 250 });
  };

  const onScroll = () => {
    const el = scroller.current;
    const before = el.lastTop ?? el.scrollTop;
    el.lastTop = el.scrollTop;
    if (el.glide || el.follow) return; // positions on the way down are not the user's choice
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    // The chat got shorter (the Terminal panel opened, the window shrank) and the browser moved the view: that
    // is not scrolling away, so keep following.
    if (stick.current && !atBottom && el.scrollTop >= before - 1) {
      follow(el);
      return;
    }
    stick.current = atBottom;
    setShowJump(!atBottom);
  };

  const pick = (text) => setPrefill({ text, at: Date.now() });

  return (
    <ChatContext.Provider value={context}>
      <div class={`chat ${empty ? 'empty' : ''}`}>
        {findBar.value > 0 && <FindBar root={timeline} scroller={scroller} />}
        <div class="chat-scroll" ref={scroller} onScroll={onScroll}
             onClick={(e) => {
               // Opening or closing a bar means reading: keep the view where it is instead of following the bottom.
               if (e.target.closest('[aria-expanded]')) stick.current = false;
             }}
             onWheel={(e) => {
               // Scrolling up means "stop following" right away, before a re-render could snap back down.
               if (e.deltaY < 0 && !scroller.current.glide) {
                 stopFollowing(scroller.current);
                 stick.current = false;
               }
             }}
             onPointerDown={(e) => {
               // Grabbing the scrollbar: let go of the bottom so the drag isn't fought.
               if (e.target === e.currentTarget) stopFollowing(e.currentTarget);
             }}>
          <div class="timeline" ref={timeline}>
            {s.problem.value && <ProblemCard s={s} />}
            <ClaudePreparing session={s} />
            {empty && <Intro onPick={pick} />}
            {groups.map((g) => (g.kind === 'item'
              ? renderItem(g.item)
              : <Turn key={g.key} g={g} s={s} renderItem={renderItem} />))}
            {orphans.map((p) => (
              <div class="tool" data-status="asking" key={p.requestId}>
                <div class="tool-head static">
                  <span class="tool-glyph" aria-hidden="true"><Icon name={toolIcon({ name: p.toolName })} size={15} /></span>
                  <span class="tool-target as-verb">{p.displayName || p.toolName}</span>
                </div>
                <PermissionPrompt session={s} request={p} />
              </div>
            ))}
            <Activity s={s} chat={chat} />
          </div>
        </div>
        {!empty && <HistoryRail chat={chat} scroller={scroller} onJump={jumpTo} />}
        <div class="chat-bottom" ref={bottom}>
          {showJump && (
            <button class="jump-latest" onClick={() => {
              stick.current = true;
              setShowJump(false);
              stopFollowing(scroller.current);
              glideToBottom(scroller.current);
            }}>
              <Icon name="arrowDown" size={14} />{t('Latest')}
            </button>
          )}
          <SideNotes s={s} />
          <AgentStrip s={s} chat={chat} />
          <TaskStrip tasks={chat.tasks} busy={chat.busy} />
          {empty && <IntroChips s={s} />}
          <Composer key={s.uid} s={s} prefill={prefill} />
        </div>
      </div>
    </ChatContext.Provider>
  );
}

