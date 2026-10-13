import { useEffect, useState } from 'preact/hooks';
import { Dialog, Segmented } from '../ui.jsx';
import { MODE_LABELS } from '../chat/Prompts.jsx';
import { api, active, settings, newSessionDialog } from '../../lib/store.js';
import { openSession } from '../../lib/sessions.js';
import { basename, relativeTime } from '../../lib/format.js';

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
  if (state.loading) return <p class="field-note">Loading conversations…</p>;
  if (!state.list.length) return <p class="field-note">No earlier conversations in this folder.</p>;
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

  return (
    <form onSubmit={submit}>
      <label class="field">
        <span class="field-label">Project folder</span>
        <div class="input-row">
          <input type="text" value={cwd} spellcheck={false} autoFocus placeholder="The folder Claude should work in"
                 onInput={(e) => { setCwd(e.currentTarget.value); setResumeId(''); }} />
          <button type="button" class="secondary-btn" onClick={async () => {
            const folder = await api.pickFolder(cwd || undefined);
            if (folder) { setCwd(folder); setResumeId(''); }
          }}>Browse…</button>
        </div>
      </label>
      {(s.recent || []).length > 0 && (
        <div class="recent-chips">
          {s.recent.slice(0, 6).map(({ path }) => (
            <button type="button" key={path} title={path} onClick={() => { setCwd(path); setResumeId(''); }}>{basename(path)}</button>
          ))}
        </div>
      )}

      <div class="field">
        <span class="field-label">Open as</span>
        <Segmented name="kind" value={kind} onChange={setKind} options={[
          { value: 'chat', label: 'Chat', title: 'Claude Code in a chat view' },
          { value: 'terminal', label: 'CLI', title: 'Claude Code’s own command-line interface' },
          { value: 'shell', label: 'Plain shell', title: 'Your system shell, without Claude' },
        ]} />
      </div>

      {claudeKind && (
        <div class="field">
          <span class="field-label">Conversation</span>
          <Segmented name="mode" value={mode} onChange={setMode} options={[
            { value: 'new', label: 'Start fresh' },
            { value: 'continue', label: 'Continue latest' },
            { value: 'resume', label: 'Pick one…' },
          ]} />
          {mode === 'resume' && cwd.trim() && <HistoryList cwd={cwd.trim()} value={resumeId} onChange={setResumeId} />}
        </div>
      )}

      {kind === 'chat' && mode !== 'new' && (
        <p class="field-note">The conversation continues with the model and permission mode it used before.</p>
      )}
      {kind === 'chat' && mode === 'new' && (
        <div class="field-pair">
          <label class="field">
            <span class="field-label">Model</span>
            <select value={model} onChange={(e) => setModel(e.currentTarget.value)}>
              {MODEL_CHOICES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          <label class="field">
            <span class="field-label">Permissions</span>
            <select value={permissionMode} onChange={(e) => setPermissionMode(e.currentTarget.value)}>
              {['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'].map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
            </select>
          </label>
        </div>
      )}

      {kind === 'terminal' && (
        <label class="field">
          <span class="field-label">Extra arguments <em>optional</em></span>
          <input type="text" value={extraArgs} spellcheck={false} placeholder="e.g. --model opus"
                 onInput={(e) => setExtraArgs(e.currentTarget.value)} />
        </label>
      )}

      {error && <p class="form-error">{error}</p>}
      <div class="dialog-actions">
        <button type="button" class="secondary-btn" onClick={() => { newSessionDialog.value = null; }}>Cancel</button>
        <button type="submit" class="primary-btn" disabled={busy}>{busy ? 'Starting…' : 'Start session'}</button>
      </div>
    </form>
  );
}

export function NewSessionDialog() {
  const prefill = newSessionDialog.value;
  return (
    <Dialog open={Boolean(prefill)} title="New session" onClose={() => { newSessionDialog.value = null; }}>
      {prefill && <Form prefill={prefill} />}
    </Dialog>
  );
}
