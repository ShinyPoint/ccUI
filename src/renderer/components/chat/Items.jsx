// Timeline items other than tool calls.
import { memo } from 'preact/compat';
import { useState } from 'preact/hooks';
import { Icon, Collapse, openContextMenu } from '../ui.jsx';
import { api } from '../../lib/store.js';
import { rewindTo, undoFileChanges, forkFrom } from '../../lib/sessions.js';
import { renderMarkdown } from '../../lib/markdown.js';
import { formatCost, formatDuration } from '../../lib/format.js';
import { t, phrase } from '../../lib/i18n.js';

// What lib/chat-reducer.js writes into the timeline (notices, dividers, a background task ending) and says Claude
// is doing: it stays English there (pure, and tested as such) and is put in the app's language here, where it is
// shown. Texts from Claude Code itself (its own notices, a task's summary) are passed through as they are.
const FIXED = new Set([
  phrase('Interrupted'),
  phrase('Started a new conversation.'),
  phrase('Usage limit reached.'),
  phrase('Earlier in this conversation'),
  phrase('Conversation compacted'),
  phrase('Compacting failed.'),
  phrase('A background task finished'),
  phrase('A background task failed'),
  phrase('A background task was stopped'),
  phrase('Claude Code could not authenticate. Add an Anthropic API key in Settings, or sign Claude Code in with an API account.'),
  phrase('The account has a billing problem, so the request was refused.'),
  phrase('Rate limit reached. Wait a moment, then send your message again.'),
  phrase('The API is overloaded right now. Try again in a moment.'),
  phrase('The selected model is not available for this account. Pick another model.'),
  phrase('The reply hit the output length limit and was cut off.'),
  phrase('This organization does not allow this login. Use an API key instead.'),
  phrase('Waiting for your answer'),
  phrase('Compacting the conversation…'),
  phrase('Thinking…'),
  phrase('Working…'),
]);
const PATTERNS = [
  [/^Running (.+)…$/s, (m) => t('Running {tool}…', { tool: m[1] })],
  [/^Claude Code stopped: (.*)$/s, (m) => t('Claude Code stopped: {error}', { error: m[1] })],
  [/^Request failed \((.+)\)\. Retrying, attempt (\d+) of (\d+)…$/s, (m) => t('Request failed ({status}). Retrying, attempt {n} of {max}…', { status: m[1], n: m[2], max: m[3] })],
  [/^Request failed\. Retrying, attempt (\d+) of (\d+)…$/s, (m) => t('Request failed. Retrying, attempt {n} of {max}…', { n: m[1], max: m[2] })],
  [/^Request failed \((.+)\)\.$/s, (m) => t('Request failed ({error}).', { error: m[1] })],
  [/^The turn ended early \((.+)\)\.$/s, (m) => t('The turn ended early ({reason}).', { reason: m[1] })],
  [/^Compacting failed: (.*)$/s, (m) => t('Compacting failed: {error}', { error: m[1] })],
  [/^Conversation compacted \((\d+)k tokens summarized\)$/s, (m) => t('Conversation compacted ({n}k tokens summarized)', { n: m[1] })],
  [/^Usage limit reached\. Resets (.+)\.$/s, (m) => t('Usage limit reached. Resets {time}.', { time: m[1] })],
  [/^“(.+)” finished$/s, (m) => t('“{task}” finished', { task: m[1] })],
  [/^“(.+)” failed$/s, (m) => t('“{task}” failed', { task: m[1] })],
  [/^“(.+)” was stopped$/s, (m) => t('“{task}” was stopped', { task: m[1] })],
];
export function localText(text) {
  if (!text) return text;
  if (FIXED.has(text)) return t(text);
  for (const [re, make] of PATTERNS) {
    const m = re.exec(text);
    if (m) return make(m);
  }
  return t(text); // a text made in the app (a ui/notice) has its translation; anything else shows as it is
}

function onMarkdownClick(e) {
  const copy = e.target.closest('[data-copy-code]');
  if (copy) {
    const code = copy.closest('.code-block')?.querySelector('code')?.innerText || '';
    api.writeClipboard(code);
    copy.textContent = t('Copied');
    setTimeout(() => { copy.textContent = t('Copy'); }, 1400);
    return;
  }
  const link = e.target.closest('a[href]');
  if (link) {
    e.preventDefault();
    api.openExternal(link.href);
  }
}

export const Markdown = memo(({ text, className = '' }) => (
  // eslint-disable-next-line react/no-danger -- sanitized by DOMPurify in renderMarkdown
  <div class={`md ${className}`} onClick={onMarkdownClick} dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
));

// Actions on one of your messages, like Claude Code's rewind menu (Esc Esc): go back to before it, undo
// the file changes made since, or carry on from there in a new chat.
function messageMenu(s, item) {
  return [
    { label: t('Edit and resend'), hint: t('Go back to before this message'), run: () => rewindTo(s, item) },
    { label: t('Edit and resend, undo file changes'), hint: t('Also restore files'), run: () => rewindTo(s, item, { files: true }) },
    { label: t('Undo file changes since here'), hint: t('Keep the conversation'), run: () => undoFileChanges(s, item) },
    '-',
    { label: t('Fork into a new chat'), hint: t('This one stays as it is'), run: () => forkFrom(s, item) },
    { label: t('Copy text'), run: () => api.writeClipboard(item.text || '') },
  ];
}

export const UserItem = memo(({ item, s, saved }) => {
  // Only messages saved in the conversation (sent from here or loaded from it) can be a starting point.
  const actionable = s && saved && !item.queued && !item.key.includes(':');
  return (
    <div class="msg-user-wrap" onContextMenu={actionable ? (e) => openContextMenu(e, messageMenu(s, item)) : undefined}>
      <div class={`msg-user ${item.queued ? 'queued' : ''}`}>
        {item.queued && <span class="msg-queued" title={t('Claude reads this at its next step. Stop cancels it and puts it back in the message box.')}>{t('Queued')}</span>}
        {item.images?.length > 0 && (
          <div class="msg-images">
            {item.images.map((img, i) => (
              <img key={i} alt={t('Attached image')} src={img.preview || `data:${img.mediaType};base64,${img.data}`} />
            ))}
          </div>
        )}
        {item.text && <div class="msg-user-text">{item.text}</div>}
      </div>
      {actionable && (
        <div class="msg-actions">
          <button type="button" class="icon-btn" title={t('Copy')} onClick={() => api.writeClipboard(item.text || '')}><Icon name="copy" size={14} /></button>
          <button type="button" class="icon-btn" title={t('Edit and resend: go back to before this message')} onClick={() => rewindTo(s, item)}><Icon name="edit" size={14} /></button>
          <button type="button" class="icon-btn" title={t('More')} onClick={(e) => openContextMenu(e, messageMenu(s, item))}><Icon name="more" size={14} /></button>
        </div>
      )}
    </div>
  );
});

export const TextItem = memo(({ item }) => (
  <div class={`msg-text ${item.streaming ? 'streaming' : ''}`}>
    <Markdown text={item.text} />
  </div>
));

export const ThinkingItem = memo(({ item }) => {
  const seconds = item.endedAt && item.startedAt ? formatDuration(item.endedAt - item.startedAt) : '';
  const label = item.streaming ? t('Thinking…') : seconds ? t('Thought for {time}', { time: seconds }) : t('Thought');
  // Claude Code often keeps the thinking itself hidden: then there is nothing to open.
  if (!item.text?.trim()) {
    return <div class="thinking empty"><span class="thinking-summary"><span class="thinking-mark">✻</span>{label}</span></div>;
  }
  return <ThinkingToggle label={label} text={item.text} />;
});

function ThinkingToggle({ label, text }) {
  const [open, setOpen] = useState(false);
  return (
    <div class={`thinking ${open ? 'open' : ''}`}>
      <button type="button" class="thinking-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span class="thinking-mark">✻</span>{label}
      </button>
      {/* Claude's thinking often ends with line breaks (and has runs of them): they would show as empty lines. */}
      <Collapse open={open}><div class="thinking-text">{text.trim().replace(/\n{3,}/g, '\n\n')}</div></Collapse>
    </div>
  );
}

export const NoticeItem = memo(({ item }) => (
  <div class={`notice-row ${item.tone}`} role={item.tone === 'error' ? 'alert' : undefined}>
    <Icon name={item.tone === 'info' ? 'check' : 'alert'} size={14} />
    <span>{localText(item.text)}</span>
  </div>
));

export const CommandOutputItem = memo(({ item }) => (
  <div class="cmd-output"><Markdown text={item.text} /></div>
));

export const TurnItem = memo(({ item }) => (
  <div class="turn-end">
    {item.interrupted && <span class="turn-stopped">{t('Stopped')}</span>}
    {item.durationMs > 0 && <span>{formatDuration(item.durationMs)}</span>}
    {item.cost > 0 && <span>{formatCost(item.cost)}</span>}
  </div>
));

export const DividerItem = memo(({ item }) => (
  <div class="divider"><span>{localText(item.text)}</span></div>
));

// Claude picking up again by itself: a background task it started has ended, and Claude Code told it.
const WAKE_ICON = { completed: 'check', failed: 'x', stopped: 'stop' };
export const WakeItem = memo(({ item }) => (
  <div class="wake" data-status={item.status || 'completed'}>
    <Icon name={WAKE_ICON[item.status] || 'check'} size={13} /><span>{localText(item.text)}</span>
  </div>
));
