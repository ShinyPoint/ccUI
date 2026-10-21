// Shown on a session while it waits for the built-in Claude Code to be downloaded (the first session after
// installing, or a version chosen in Settings that isn't on this computer yet; main/claude-update.js): what is
// happening and how far along it is. The session starts on its own once it is done.
import { useRef } from 'preact/hooks';
import { usePresence } from './ui.jsx';
import { claudeUpdate } from '../lib/store.js';
import { formatBytes } from '../lib/format.js';
import { t } from '../lib/i18n.js';

const BUSY = ['checking', 'downloading', 'installing'];

// Whether the session is starting (s.starting, s.ptyStarting) is read here, not by the parent: those aren't
// signals, but every step of the download is, and re-renders this. The last step (ready or failed) ends `preparing`.
export function ClaudePreparing({ session: s }) {
  const u = claudeUpdate.value;
  const waiting = s.kind.value === 'chat' ? s.starting : s.ptyStarting;
  const el = useRef(null);
  const kept = usePresence(Boolean(waiting) && Boolean(u.preparing) && BUSY.includes(u.state), el);
  if (!kept) return null;
  const pct = u.state === 'downloading' ? (u.total ? Math.min(100, Math.round(((u.received || 0) / u.total) * 100)) : 0)
    : u.state === 'checking' ? 0 : 100;
  const version = u.target || '';
  const what = u.state === 'checking' ? t('Looking up Claude Code on npm…')
    : u.state === 'downloading' ? (u.total
      ? t('Downloading Claude Code {version}: {received} of {total}', { version, received: formatBytes(u.received || 0), total: formatBytes(u.total) })
      : t('Downloading Claude Code {version}…', { version }))
    : u.state === 'installing' ? t('Unpacking Claude Code {version}…', { version })
    : t('Claude Code {version} is ready.', { version });
  return (
    <div ref={el} class="preparing" role="status">
      <div class="preparing-title">{t('Getting Claude Code ready')}</div>
      <p>{u.pinned
        ? t('The version chosen in Settings is downloaded first. The session starts as soon as it is here.')
        : t('ccUI downloads Claude Code the first time it is used, once. The session starts as soon as it is here.')}</p>
      <div class="set-progress" role="progressbar" aria-label={t('Download')} aria-valuenow={pct}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div class="preparing-what">{what}</div>
    </div>
  );
}
