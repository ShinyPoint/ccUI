import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon, Collapse } from '../ui.jsx';
import { ChatContext } from './context.js';
import { ToolCard } from './ToolCard.jsx';
import { PermissionPrompt } from './Prompts.jsx';
import { Composer } from './Composer.jsx';
import { FindBar } from './FindBar.jsx';
import { UserItem, TextItem, ThinkingItem, NoticeItem, CommandOutputItem, TurnItem, DividerItem, WakeItem } from './Items.jsx';
import { topLevel, childrenOf, currentActivity, groupTurns, backgroundTasks } from '../../lib/chat-reducer.js';
import { settings, settingsDialog, findBar } from '../../lib/store.js';
import { openInTerminal, retryChat, displayName, stopTask, stopAllTasks } from '../../lib/sessions.js';
import { formatCost, formatDuration, pluralize } from '../../lib/format.js';
import { turnChanges } from '../../lib/diff.js';
import { openChanges } from '../../lib/side.js';

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

const STARTERS = [
  'Give me a quick tour of this project: what it does and how it is organized.',
  'Find the most likely bug in this code and explain it before fixing anything.',
  'Add tests for the least-tested part of this project.',
];

function TaskStrip({ tasks, busy }) {
  const [open, setOpen] = useState(false);
  if (!tasks.length) return null;
  const done = tasks.filter((t) => t.status === 'completed').length;
  if (done === tasks.length && !busy && !open) return null;
  const current = tasks.find((t) => t.status === 'in_progress');
  return (
    <div class={`tasks ${open ? 'open' : ''}`}>
      <button class="tasks-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span class="tasks-progress"><span style={{ width: `${(done / tasks.length) * 100}%` }} /></span>
        <span class="tasks-count">{done}/{tasks.length}</span>
        <span class="tasks-current">{current ? current.activeForm || current.content : done === tasks.length ? 'All tasks done' : 'Tasks'}</span>
        <Icon name="chevron" size={14} />
      </button>
      <Collapse open={open}>
        <ul class="task-list">
          {tasks.map((t) => (
            <li key={t.id} data-status={t.status}>
              <span class="task-box">{t.status === 'completed' && <Icon name="check" size={11} />}</span>
              <span>{t.content}</span>
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
const ENDED_LABEL = { completed: 'Done', failed: 'Failed', stopped: 'Stopped' };
function AgentStrip({ s, chat }) {
  s.traceTick.value; // elapsed times, and ended tasks leaving
  const [open, setOpen] = useState(true);
  const now = Date.now();
  const shown = backgroundTasks(chat).filter((a) => a.status === 'running' || now - a.endedAt < ENDED_SHOWN_MS);
  if (!shown.length) return null;
  const running = shown.filter((a) => a.status === 'running').length;
  return (
    <div class={`tasks agents ${open ? 'open' : ''}`}>
      <div class="agents-head">
        <button class="agents-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span class={`agents-dot ${running ? 'busy' : ''}`} />
          <span class="tasks-current">
            {running ? `${pluralize(running, 'background task')} running` : 'Background tasks done'}
          </span>
          <Icon name="chevron" size={14} />
        </button>
        {running > 1 && <button class="agents-stop-all" onClick={() => stopAllTasks(s)}>Stop all</button>}
      </div>
      <Collapse open={open}>
        <ul class="agent-list">
          {shown.map((a) => (
            <li key={a.id} data-status={a.status}>
              <span class="agent-mark">
                {a.status === 'completed' ? <Icon name="check" size={12} /> : a.status !== 'running' ? <Icon name="x" size={12} /> : null}
              </span>
              <span class="agent-type">{a.subagentType || (a.kind === 'local_bash' ? 'Shell' : 'Agent')}</span>
              <span class="agent-desc" title={a.summary || a.description}>{a.description || 'Working'}</span>
              <span class="agent-meta">
                {a.status === 'running'
                  ? [formatDuration(now - a.startedAt), a.toolUses ? pluralize(a.toolUses, 'tool') : '', a.lastTool].filter(Boolean).join(' · ')
                  : ENDED_LABEL[a.status] || 'Ended'}
              </span>
              {a.status === 'running'
                ? <button class="icon-btn agent-stop" title="Stop this task" aria-label={`Stop ${a.description || 'this task'}`}
                          onClick={() => stopTask(s, a.id)}><Icon name="stop" size={12} /></button>
                : <span />}
            </li>
          ))}
        </ul>
      </Collapse>
    </div>
  );
}

function ProblemCard({ s }) {
  const problem = s.problem.value;
  const subscription = problem.code === 'subscription';
  const title = subscription ? 'Chat sessions need an API key'
    : problem.code === 'no-binary' ? 'Claude Code was not found'
    : problem.code === 'untrusted' ? 'This folder is not trusted'
    : 'Claude Code could not start';
  return (
    <div class="problem">
      <h2>{title}</h2>
      {subscription ? (
        <p>
          Claude Code on this computer is signed in with a Claude.ai subscription. Apps like this one can only use an
          Anthropic API key or a cloud provider (Amazon Bedrock, Google Vertex AI, Microsoft Foundry) for chat sessions.
          Add a key in Settings, or keep working in Claude Code’s own CLI.
        </p>
      ) : (
        <p class="problem-detail">{problem.text}</p>
      )}
      <div class="problem-actions">
        {subscription && <button class="primary-btn" onClick={() => { settingsDialog.value = 'account'; }}>Add API key</button>}
        {problem.code === 'no-binary' && <button class="primary-btn" onClick={() => { settingsDialog.value = true; }}>Open settings</button>}
        <button class="secondary-btn" onClick={() => openInTerminal(s)}><Icon name="terminal" />Open in CLI</button>
        <button class="secondary-btn" onClick={() => retryChat(s)}>{problem.code === 'untrusted' ? 'Ask again' : 'Try again'}</button>
      </div>
    </div>
  );
}

// The intro is centered in the chat area (the space above the message box): the question and the project
// name alone, or together with the suggested prompts when those are turned on (Settings). On short windows
// it moves up just enough to fit.
function Intro({ s, onPick }) {
  const ref = useRef(null);
  const starters = Boolean(settings.value.showStarters);
  useLayoutEffect(() => {
    const el = ref.current;
    const scroller = el.closest('.chat-scroll');
    const place = () => {
      el.style.marginTop = '0px';
      const box = scroller.getBoundingClientRect();
      const toContent = (y) => y - box.top + scroller.scrollTop;
      const top = toContent(el.querySelector('h2').getBoundingClientRect().top);
      const last = el.querySelector(starters ? '.starters' : '.intro-project');
      const bottom = toContent(last.getBoundingClientRect().bottom - parseFloat(getComputedStyle(last).paddingBottom));
      const want = scroller.clientHeight / 2 - (top + bottom) / 2;
      const room = scroller.clientHeight - scroller.firstElementChild.offsetHeight; // free space below the content
      el.style.marginTop = `${Math.max(0, Math.min(want, room))}px`;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [starters]);
  return (
    <div class="chat-intro" ref={ref}>
      <h2>What should we do in</h2>
      <div class="intro-project" title={s.cwd}>{displayName(s)}</div>
      {starters && (
        <div class="starters">
          {STARTERS.map((text) => <button key={text} class="starter" onClick={() => onPick(text)}>{text}</button>)}
        </div>
      )}
    </div>
  );
}

const GLIDE_MS = 220;
const easeOutCubic = (t) => 1 - (1 - t) ** 3;

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
    const t = Math.min(1, (now - start) / GLIDE_MS);
    el.scrollTop = from + (end() - from) * easeOutCubic(t);
    if (t < 1) el.glide = requestAnimationFrame(frame);
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
  if (!foldable) {
    return <>{renderItem(g.user)}{g.work.map(renderItem)}{g.errors.map(renderItem)}{g.answer.map(renderItem)}{g.end && renderItem(g.end)}</>;
  }
  const changes = turnChanges(s.chat.value, g);
  const added = changes.reduce((n, c) => n + c.add, 0);
  const removed = changes.reduce((n, c) => n + c.del, 0);
  const failed = steps.filter((i) => i.status === 'error').length;
  const duration = g.end?.durationMs ? formatDuration(g.end.durationMs) : '';
  const details = [
    steps.length ? pluralize(steps.length, 'step') : '',

    failed ? `${failed} failed` : '',
  ].filter(Boolean).join(' · ');
  return (
    <>
      {renderItem(g.user)}
      <div class="ws-row">
        <button class={`work-summary ${open ? 'open' : ''}`} aria-expanded={open} onClick={toggle}
                title={open ? 'Hide the steps Claude took' : 'Show the steps Claude took'}>
          <Icon name="chevron" size={14} />
          <span class="ws-title">{g.end?.interrupted ? 'Stopped' : 'Worked'}{duration && ` for ${duration}`}</span>
          {details && <span class="ws-details">{details}</span>}
          {g.end?.cost > 0 && <span class="ws-cost">{formatCost(g.end.cost)}</span>}
        </button>
        {changes.length > 0 && (
          <button class="ws-files" title="Show what this turn changed" onClick={() => openChanges(s, { turnKey: g.key })}>
            <Icon name="diff" size={13} />{pluralize(changes.length, 'file')}
            <span class="diffstat"><span class="add">+{added}</span> <span class="del">−{removed}</span></span>
          </button>
        )}
      </div>
      <Collapse open={open}><div class="work-steps">{g.work.map(renderItem)}</div></Collapse>
      {g.errors.map(renderItem)}
      {g.answer.map(renderItem)}
    </>
  );
}

function Activity({ s, chat }) {
  s.traceTick.value; // re-render every second for the elapsed time
  const label = currentActivity(chat);
  if (!label) return null;
  const lastUser = [...chat.items].reverse().find((i) => i.type === 'user');
  const elapsed = lastUser?.at ? formatDuration(Date.now() - lastUser.at) : '';
  return (
    <div class={`activity ${chat.permissions.length ? 'asking' : ''}`} aria-live="polite">
      <span class="activity-mark">✻</span>
      <span>{label}</span>
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
      <div class="chat">
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
            {!s.problem.value && items.length === 0 && <Intro s={s} onPick={pick} />}
            {groups.map((g) => (g.kind === 'item'
              ? renderItem(g.item)
              : <Turn key={g.key} g={g} s={s} renderItem={renderItem} />))}
            {orphans.map((p) => (
              <div class="tool" data-status="asking" key={p.requestId}>
                <div class="tool-head static"><span class="tool-glyph" /><span class="tool-verb">{p.displayName || p.toolName}</span></div>
                <PermissionPrompt session={s} request={p} />
              </div>
            ))}
            <Activity s={s} chat={chat} />
          </div>
        </div>
        <div class="chat-bottom">
          {showJump && (
            <button class="jump-latest" onClick={() => {
              stick.current = true;
              setShowJump(false);
              stopFollowing(scroller.current);
              glideToBottom(scroller.current);
            }}>
              <Icon name="arrowDown" size={14} />Latest
            </button>
          )}
          <AgentStrip s={s} chat={chat} />
          <TaskStrip tasks={chat.tasks} busy={chat.busy} />
          <Composer key={s.uid} s={s} prefill={prefill} />
        </div>
      </div>
    </ChatContext.Provider>
  );
}

