// Timeline items other than tool calls.
import { memo } from 'preact/compat';
import { useState } from 'preact/hooks';
import { Icon, Collapse, openContextMenu } from '../ui.jsx';
import { api } from '../../lib/store.js';
import { rewindTo, undoFileChanges, forkFrom } from '../../lib/sessions.js';
import { renderMarkdown } from '../../lib/markdown.js';
import { formatCost, formatDuration } from '../../lib/format.js';

function onMarkdownClick(e) {
  const copy = e.target.closest('[data-copy-code]');
  if (copy) {
    const code = copy.closest('.code-block')?.querySelector('code')?.innerText || '';
    api.writeClipboard(code);
    copy.textContent = 'Copied';
    setTimeout(() => { copy.textContent = 'Copy'; }, 1400);
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
    { label: 'Edit and resend', hint: 'Go back to before this message', run: () => rewindTo(s, item) },
    { label: 'Edit and resend, undo file changes', hint: 'Also restore files', run: () => rewindTo(s, item, { files: true }) },
    { label: 'Undo file changes since here', hint: 'Keep the conversation', run: () => undoFileChanges(s, item) },
    '-',
    { label: 'Fork into a new chat', hint: 'This one stays as it is', run: () => forkFrom(s, item) },
    { label: 'Copy text', run: () => api.writeClipboard(item.text || '') },
  ];
}

export const UserItem = memo(({ item, s, saved }) => {
  // Only messages saved in the conversation (sent from here or loaded from it) can be a starting point.
  const actionable = s && saved && !item.queued && !item.key.includes(':');
  return (
    <div class="msg-user-wrap" onContextMenu={actionable ? (e) => openContextMenu(e, messageMenu(s, item)) : undefined}>
      <div class={`msg-user ${item.queued ? 'queued' : ''}`}>
        {item.queued && <span class="msg-queued" title="Claude reads this at its next step. Stop cancels it and puts it back in the message box.">Queued</span>}
        {item.images?.length > 0 && (
          <div class="msg-images">
            {item.images.map((img, i) => (
              <img key={i} alt="Attached image" src={img.preview || `data:${img.mediaType};base64,${img.data}`} />
            ))}
          </div>
        )}
        {item.text && <div class="msg-user-text">{item.text}</div>}
      </div>
      {actionable && (
        <div class="msg-actions">
          <button type="button" class="icon-btn" title="Copy" onClick={() => api.writeClipboard(item.text || '')}><Icon name="copy" size={14} /></button>
          <button type="button" class="icon-btn" title="Edit and resend: go back to before this message" onClick={() => rewindTo(s, item)}><Icon name="edit" size={14} /></button>
          <button type="button" class="icon-btn" title="More" onClick={(e) => openContextMenu(e, messageMenu(s, item))}><Icon name="more" size={14} /></button>
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
  const label = item.streaming ? 'Thinking…' : seconds ? `Thought for ${seconds}` : 'Thought';
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
    <span>{item.text}</span>
  </div>
));

export const CommandOutputItem = memo(({ item }) => (
  <div class="cmd-output"><Markdown text={item.text} /></div>
));

export const TurnItem = memo(({ item }) => (
  <div class="turn-end">
    {item.interrupted && <span class="turn-stopped">Stopped</span>}
    {item.durationMs > 0 && <span>{formatDuration(item.durationMs)}</span>}
    {item.cost > 0 && <span>{formatCost(item.cost)}</span>}
  </div>
));

export const DividerItem = memo(({ item }) => (
  <div class="divider"><span>{item.text}</span></div>
));

// Claude picking up again by itself: a background task it started has ended, and Claude Code told it.
const WAKE_ICON = { completed: 'check', failed: 'x', stopped: 'stop' };
export const WakeItem = memo(({ item }) => (
  <div class="wake" data-status={item.status || 'completed'}>
    <Icon name={WAKE_ICON[item.status] || 'check'} size={13} /><span>{item.text}</span>
  </div>
));
