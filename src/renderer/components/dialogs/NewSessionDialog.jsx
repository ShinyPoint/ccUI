import { useEffect, useState } from 'preact/hooks';
import { Dialog, Segmented, Icon, SetGroup, SetRow } from '../ui.jsx';
import { MODE_LABELS } from '../chat/Prompts.jsx';
import { api, active, settings, newSessionDialog } from '../../lib/store.js';
import { openSession } from '../../lib/sessions.js';
import { basename, relativeTime, tildify, samePath } from '../../lib/format.js';

export const MODEL_CHOICES = [
  { value: '', label: 'Claude Code default' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
];

function HistoryList({ cwd, value, onChange }) {
  const [state, setState] = useState({ loading: true, list: [] });
  useEffect(() => {
    let live = true;
    setState({ loading: true, list: [] });
    api.history.list(cwd).then((res) => {
      if (!live) return;
      setState({ loading: false, list: res.ok ? res.sessions : [], error: res.ok ? null : res.error });
      if (res.ok && res.sessions[0] && !value) onChange(res.sessions[0].sessionId);
    });
    return () => { live = false; };
  }, [cwd]);
  if (state.loading) return <p class="ns-empty">Loading conversations…</p>;
  if (!state.list.length) return <p class="ns-empty">No earlier conversations in this folder.</p>;
  return (
    <ul class="history-list" role="listbox">
      {state.list.map((h) => (
        <li key={h.sessionId}>
          <label class={value === h.sessionId ? 'chosen' : ''}>
            <input type="radio" name="history" checked={value === h.sessionId} onChange={() => onChange(h.sessionId)} />
            <span class="h-title">{h.customTitle || h.summary || h.firstPrompt || 'Untitled conversation'}</span>
            <span class="h-meta">{relativeTime(h.lastModified)}{h.gitBranch ? ` · ${h.gitBranch}` : ''}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function Form({ prefill }) {
  const s = settings.value;
  const [cwd, setCwd] = useState(prefill.cwd || active.value?.cwd || s.recent?.[0]?.path || '');
  const [kind, setKind] = useState(prefill.kind || s.defaultKind || 'chat');
  const [mode, setMode] = useState('new');
  const [resumeId, setResumeId] = useState('');
  const [model, setModel] = useState(s.defaultModel || '');
  const [permissionMode, setPermissionMode] = useState(s.defaultPermissionMode || 'default');
  const [extraArgs, setExtraArgs] = useState(s.defaultArgs || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const claudeKind = kind !== 'shell';

  const submit = async (e) => {
    e.preventDefault();
    if (!cwd.trim()) return setError('Choose a project folder first.');
    if (mode === 'resume' && claudeKind && !resumeId) return setError('Pick a conversation to continue.');
    setBusy(true);
    const res = await openSession({
      cwd: cwd.trim(),
      kind,
      mode: claudeKind ? mode : 'new',
      resume: claudeKind && mode === 'resume' ? resumeId : undefined,
      // A resumed conversation keeps the model and permissions it had.
      model: kind === 'chat' && mode === 'new' ? model : undefined,
      permissionMode: kind === 'chat' && mode === 'new' ? permissionMode : undefined,
      extraArgs,
    });
    setBusy(false);
    if (res.ok) newSessionDialog.value = null;
    else setError(res.error || 'The session could not start.');
  };

  const pick = (path) => { setCwd(path); setResumeId(''); setError(''); };
  const recent = (s.recent || []).slice(0, 5);
  const note = !claudeKind ? 'Your system shell, without Claude.'
    : kind === 'chat' && mode !== 'new' ? 'The conversation keeps the model and permissions it had.'
    : kind === 'terminal' ? 'Claude Code’s own command-line interface.' : '';

  return (
    <form class="ns-form" onSubmit={submit}>
      <header class="ns-head">
        <h3>New session</h3>
        <button type="button" class="icon-btn" aria-label="Close" title="Close (Esc)" onClick={() => { newSessionDialog.value = null; }}>
          <Icon name="x" />
        </button>
      </header>

      <SetGroup title="Project">
        <div class="ns-folder">
          <span class="ns-folder-icon"><Icon name="folder" /></span>
          <input type="text" value={cwd} spellcheck={false} autoFocus aria-label="Project folder"
                 placeholder="The folder Claude should work in" onInput={(e) => pick(e.currentTarget.value)} />
          <button type="button" class="secondary-btn" onClick={async () => {
            const folder = await api.pickFolder(cwd || undefined);
            if (folder) pick(folder);
          }}>Choose…</button>
        </div>
        {recent.map(({ path }) => {
          const chosen = samePath(path, cwd.trim());
          return (
            <button type="button" key={path} class={`ns-recent ${chosen ? 'chosen' : ''}`} aria-pressed={chosen} onClick={() => pick(path)}>
              <span class="ns-folder-icon"><Icon name="folder" size={15} /></span>
              <span class="ns-recent-name">{basename(path)}</span>
              <span class="ns-recent-path">{tildify(path)}</span>
              <span class="ns-check">{chosen && <Icon name="check" size={14} />}</span>
            </button>
          );
        })}
      </SetGroup>

      <SetGroup title="Session">
        <SetRow label="Open as">
          <Segmented name="kind" value={kind} onChange={setKind} options={[
            { value: 'chat', label: 'Chat', title: 'Claude Code in a chat view' },
            { value: 'terminal', label: 'CLI', title: 'Claude Code’s own command-line interface' },
            { value: 'shell', label: 'Shell', title: 'Your system shell, without Claude' },
          ]} />
        </SetRow>
        {claudeKind && (
          <SetRow label="Conversation">
            <Segmented name="mode" value={mode} onChange={setMode} options={[
              { value: 'new', label: 'New' },
              { value: 'continue', label: 'Latest' },
              { value: 'resume', label: 'Pick one…' },
            ]} />
          </SetRow>
        )}
        {claudeKind && mode === 'resume' && (
          <div class="ns-history">
            {cwd.trim() ? <HistoryList cwd={cwd.trim()} value={resumeId} onChange={setResumeId} />
              : <p class="ns-empty">Choose a project folder to see its conversations.</p>}
          </div>
        )}
        {kind === 'chat' && mode === 'new' && (
          <>
            <SetRow label="Model">
              <select value={model} aria-label="Model" onChange={(e) => setModel(e.currentTarget.value)}>
                {MODEL_CHOICES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </SetRow>
            <SetRow label="Permissions">
              <select value={permissionMode} aria-label="Permissions" onChange={(e) => setPermissionMode(e.currentTarget.value)}>
                {['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'].map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
              </select>
            </SetRow>
          </>
        )}
        {kind === 'terminal' && (
          <SetRow label="Extra arguments" note="Optional, added to the claude command">
            <input type="text" value={extraArgs} spellcheck={false} placeholder="e.g. --model opus" aria-label="Extra arguments"
                   onInput={(e) => setExtraArgs(e.currentTarget.value)} />
          </SetRow>
        )}
      </SetGroup>

      <footer class="ns-foot">
        <span class={error ? 'form-error' : 'ns-note'}>{error || note}</span>
        <button type="button" class="secondary-btn" onClick={() => { newSessionDialog.value = null; }}>Cancel</button>
        <button type="submit" class="primary-btn" disabled={busy}>{busy ? 'Starting…' : 'Start session'}</button>
      </footer>
    </form>
  );
}

export function NewSessionDialog() {
  const prefill = newSessionDialog.value;
  return (
    <Dialog open={Boolean(prefill)} className="dialog-new" onClose={() => { newSessionDialog.value = null; }}>
      {prefill && <Form prefill={prefill} />}
    </Dialog>
  );
}
