// Settings → DeepSeek Harness → Model providers: DeepSeek's own API and the endpoints added (a relay, a self-hosted
// server, any OpenAI- or Anthropic-compatible API), one card each. A card opens into its editor: the API key, and
// under Custom settings the name, address, protocol and model catalog, which can be fetched from the endpoint. What
// they become in dsh is in main/dsh-catalog.mjs; keys are saved apart, encrypted, by the main process.
import { useState } from 'preact/hooks';
import { Collapse, Dropdown, Icon, Switch } from '../ui.jsx';
import { api, settings, saveSettings, toast, confirmDialog } from '../../lib/store.js';
import { formatTokens, pluralize } from '../../lib/format.js';
import { t, phrase } from '../../lib/i18n.js';
import {
  OFFICIAL, OFFICIAL_BASE_URL, OFFICIAL_MODELS, PROTOCOLS, LEVELS, STARTING_LEVELS, providerId, problemWith,
} from '../../../main/dsh-catalog.mjs';

// problemWith's messages, as phrases to translate where shown.
phrase('Give the provider a name.');
phrase('The API address must start with http:// or https://.');
phrase('Choose an API protocol.');
phrase('Add at least one model.');
phrase('Every model needs an ID.');
phrase('Two models have the same ID.');
phrase('Context window and max output are whole numbers of tokens.');
phrase('Another provider has this name.');
phrase('A model with reasoning needs a level beyond Off.');
phrase('Each reasoning level beyond Off needs the value to send.');

const officialCard = () => {
  const o = settings.value.dshOfficial || {};
  return { id: OFFICIAL, name: 'DeepSeek', api: 'anthropic-messages', baseURL: o.baseURL || '', models: o.models || null };
};

// A key's state for the card's dot: saved, saved but unreadable here, or none.
function keyState(id) {
  const s = settings.value;
  if (id === OFFICIAL) return s.deepseekKeyUnreadable ? 'bad' : s.hasDeepseekKey ? 'ok' : 'none';
  const k = s.dshKeys?.[id];
  return k === false ? 'bad' : k ? 'ok' : 'none';
}
const DOT_TITLE = {
  ok: phrase('A key is saved'),
  bad: phrase('The saved key can’t be decrypted on this computer. Enter it again.'),
  none: phrase('No key saved: requests go without one'),
};

// `startOpen`: the card to open with Settings (DeepSeek's, when a chat needs its key).
export function ModelProviders({ startOpen = null }) {
  const s = settings.value;
  const [open, setOpenNow] = useState(startOpen); // the card being edited: a provider id, or 'new'
  // Each opening starts from what is saved: the editor is made anew (its key), and kept while it folds away.
  const [round, setRound] = useState(0);
  const setOpen = (id) => { setOpenNow(id); if (id) setRound(round + 1); };
  const custom = s.dshProviders || [];
  const remove = async (p) => {
    if (!(await confirmDialog({
      title: t('Remove {name}?', { name: p.name }),
      message: t('Its models leave the model menu, and its saved key is deleted. Conversations that used it stay, but continue on another model.'),
      confirm: t('Remove'),
      danger: true,
    }))) return;
    await saveSettings({ dshProviders: custom.filter((x) => x.id !== p.id) });
    const res = await api.setDshKey(p.id, '');
    if (res?.ok) settings.value = res.settings;
    if (open === p.id) setOpen(null);
  };
  return (
    <section class="set-group">
      <h4>{t('Model providers')}</h4>
      <div class="providers">
        {[officialCard(), ...custom].map((p) => (
          <ProviderCard key={p.id} provider={p} open={open === p.id} round={round} onOpen={() => setOpen(open === p.id ? null : p.id)}
                        onClose={() => setOpen(null)} onRemove={p.id === OFFICIAL ? null : () => remove(p)} />
        ))}
        {open === 'new' && (
          <div class="provider-card open">
            <ProviderEditor provider={{ id: '', name: '', api: 'openai-completions', baseURL: '', models: [] }} isNew onClose={() => setOpen(null)} />
          </div>
        )}
      </div>
      {open !== 'new' && (
        <button type="button" class="secondary-btn provider-add" onClick={() => setOpen('new')}>
          <Icon name="plus" size={14} />{t('Add model provider')}
        </button>
      )}
    </section>
  );
}

function ProviderCard({ provider: p, open, round, onOpen, onClose, onRemove }) {
  const state = keyState(p.id);
  return (
    <div class={`provider-card ${open ? 'open' : ''}`}>
      <div class="provider-head">
        <span class="provider-name">{p.name}</span>
        <span class="provider-tag">{p.id === OFFICIAL ? t('Built in') : t('Custom')}</span>
        <span class={`provider-dot ${state}`} title={t(DOT_TITLE[state])} />
        <span class="spacer" />
        <button type="button" class="secondary-btn" aria-expanded={open} onClick={onOpen}>{open ? t('Close') : t('Edit')}</button>
        {onRemove && <button type="button" class="text-danger" onClick={onRemove}>{t('Delete')}</button>}
      </div>
      <Collapse open={open}>
        <ProviderEditor key={round} provider={p} onClose={onClose} />
      </Collapse>
    </div>
  );
}

const blankModel = () => ({ id: '', name: '' });

function ProviderEditor({ provider, isNew = false, onClose }) {
  const official = provider.id === OFFICIAL;
  const [draft, setDraft] = useState(() => ({ ...provider, models: (provider.models || OFFICIAL_MODELS).map((m) => ({ ...m })) }));
  // Whether DeepSeek's model list is the user's own (saved) rather than dsh's defaults.
  const [customModels, setCustomModels] = useState(!official || Boolean(provider.models));
  const [key, setKey] = useState('');
  const [fold, setFold] = useState(!official);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const state = isNew ? 'none' : keyState(provider.id);
  const set = (patch) => { setDraft({ ...draft, ...patch }); setError(''); };
  const setModels = (models) => { set({ models }); setCustomModels(true); };

  const restore = () => {
    if (official) {
      set({ models: OFFICIAL_MODELS.map((m) => ({ ...m })) });
      setCustomModels(false);
    } else if (draft.fetched?.length) setModels(draft.fetched.map((m) => ({ ...m })));
  };
  const fetchModels = async () => {
    setFetching(true);
    setError('');
    const res = await api.listDshModels({ id: isNew ? '' : provider.id, api: draft.api, baseURL: draft.baseURL.trim(), key });
    setFetching(false);
    if (!res?.ok) return setError(res?.error || t('The models could not be fetched.'));
    // Rows already set up keep what was set for them (capacities, reasoning); the rest come as listed.
    const kept = new Map(draft.models.filter((m) => m.id).map((m) => [m.id, m]));
    setDraft({ ...draft, fetched: res.models, models: res.models.map((m) => ({ ...m, ...(kept.get(m.id) || {}) })) });
    setCustomModels(true);
    toast(t('{models} found.', { models: pluralize(res.models.length, 'model') }));
  };

  const save = async () => {
    const all = settings.value.dshProviders || [];
    const cleaned = { ...draft, name: draft.name.trim(), baseURL: draft.baseURL.trim(), models: draft.models.map((m) => ({ ...m, id: m.id.trim(), name: (m.name || '').trim() })) };
    const problem = problemWith(cleaned, all);
    if (problem) return setError(t(problem));
    setSaving(true);
    let id = provider.id;
    if (official) {
      await saveSettings({ dshOfficial: { baseURL: cleaned.baseURL, models: customModels ? cleaned.models : null } });
    } else {
      if (isNew) id = providerId(cleaned.name, all.map((p) => p.id));
      const saved = { id, name: cleaned.name, api: cleaned.api, baseURL: cleaned.baseURL, models: cleaned.models, ...(draft.fetched ? { fetched: draft.fetched } : {}) };
      await saveSettings({ dshProviders: isNew ? [...all, saved] : all.map((p) => (p.id === id ? saved : p)) });
    }
    if (key.trim()) {
      const res = await api.setDshKey(id, key.trim());
      if (!res?.ok) {
        setSaving(false);
        return setError(res?.error || t('The key could not be saved.'));
      }
      settings.value = res.settings;
    }
    setSaving(false);
    toast(t('Saved. New chats use it; open ones keep what they started with.'));
    onClose();
  };

  return (
    <div class="provider-editor">
      <label class="pv-field">
        <span class="pv-label">
          {t('API key')}
          <span class="pv-help" title={t('Saved encrypted on this computer and handed to DeepSeek Harness when a chat starts; never written into its files.')}>?</span>
        </span>
        <input type="password" value={key} autocomplete="new-password" spellcheck={false}
               aria-label={t('API key')} onInput={(e) => setKey(e.currentTarget.value)}
               placeholder={state === 'ok' ? t('Leave empty to use the saved key') : official ? 'sk-…' : t('Leave empty if the endpoint needs none')} />
        {state === 'bad' && <span class="pv-note bad">{t(DOT_TITLE.bad)}</span>}
      </label>

      <button type="button" class={`pv-fold ${fold ? 'on' : ''}`} aria-expanded={fold} onClick={() => setFold(!fold)}>
        <Icon name="chevron" size={12} />{t('Custom settings')}
      </button>
      <Collapse open={fold}>
        <div class="pv-custom">
          {!official && (
            <label class="pv-field">
              <span class="pv-label">{t('Display name')}</span>
              <input type="text" value={draft.name} spellcheck={false} placeholder={t('e.g. My relay')} onInput={(e) => set({ name: e.currentTarget.value })} />
            </label>
          )}
          <label class="pv-field">
            <span class="pv-label">{t('API address')}</span>
            <input type="text" value={draft.baseURL} spellcheck={false} placeholder={official ? OFFICIAL_BASE_URL : 'https://api.example.com/v1'}
                   onInput={(e) => set({ baseURL: e.currentTarget.value })} />
          </label>
          <div class="pv-field">
            <span class="pv-label">{t('API protocol')}</span>
            <Dropdown className="pv-protocol" label={t('API protocol')} value={draft.api} disabled={official} onChange={(v) => set({ api: v })}
                      options={PROTOCOLS.map((p) => ({ value: p.value, label: p.label }))} />
          </div>
          <div class="pv-models-head">
            <div>
              <div class="pv-label">{t('Model catalog')}</div>
              <div class="pv-note">{customModels ? t('Customized model catalog') : t('DeepSeek Harness’s default models')}</div>
            </div>
            <span class="spacer" />
            <button type="button" class="link-btn" disabled={official ? !customModels : !draft.fetched?.length} onClick={restore}
                    title={official ? t('Back to DeepSeek Harness’s own list') : t('Back to the list last fetched from the endpoint')}>
              {t('Restore default models')}
            </button>
            <button type="button" class="link-btn" disabled={fetching || !(official || draft.baseURL.trim())} onClick={fetchModels}>
              {fetching ? t('Fetching…') : t('Fetch available models')}
            </button>
          </div>
          <ul class="pv-models">
            {draft.models.map((m, i) => (
              <ModelRow key={i} model={m} reasoning={!official}
                        onChange={(next) => setModels(draft.models.map((x, j) => (j === i ? next : x)))}
                        onRemove={() => setModels(draft.models.filter((_, j) => j !== i))} />
            ))}
          </ul>
          <button type="button" class="secondary-btn pv-add" onClick={() => setModels([...draft.models, blankModel()])}>
            <Icon name="plus" size={13} />{t('Add model')}
          </button>
        </div>
      </Collapse>

      {error && <p class="pv-note bad pv-error" role="alert">{error}</p>}
      <div class="pv-foot">
        <button type="button" class="secondary-btn" onClick={onClose}>{t('Cancel')}</button>
        <button type="button" class="primary-btn" disabled={saving} onClick={save}>{t('Save')}</button>
      </div>
    </div>
  );
}

// One model: its id and the name shown for it, and under the arrow its capacities, whether it reads images and (on a
// custom provider) its reasoning levels: each level the effort slider offers, and what is sent for it.
function ModelRow({ model: m, onChange, onRemove, reasoning }) {
  const [open, setOpen] = useState(false);
  const levels = m.reasoning && typeof m.reasoning === 'object' ? Object.entries(m.reasoning) : null;
  const setLevels = (entries) => onChange({ ...m, reasoning: Object.fromEntries(entries) });
  const capacity = (field, placeholder) => (
    <label class="pv-field">
      <span class="pv-label">{field === 'contextWindow' ? t('Context window') : t('Max output tokens')}</span>
      <input type="text" inputMode="numeric" value={m[field] ?? ''} placeholder={placeholder} spellcheck={false}
             onInput={(e) => { const v = e.currentTarget.value.replace(/[^\d]/g, ''); onChange({ ...m, [field]: v ? Number(v) : undefined }); }} />
    </label>
  );
  return (
    <li class={`pv-model ${open ? 'open' : ''}`}>
      <div class="pv-model-main">
        <input type="text" class="pv-model-id" value={m.id} spellcheck={false} placeholder={t('Model ID')} aria-label={t('Model ID')}
               onInput={(e) => onChange({ ...m, id: e.currentTarget.value })} />
        <input type="text" value={m.name || ''} spellcheck={false} placeholder={m.id || t('Display name')} aria-label={t('Display name')}
               onInput={(e) => onChange({ ...m, name: e.currentTarget.value })} />
        <button type="button" class={`icon-btn pv-more ${open ? 'on' : ''}`} aria-expanded={open} title={t('Model options')} onClick={() => setOpen(!open)}>
          <Icon name="chevron" size={13} />
        </button>
        <button type="button" class="icon-btn" title={t('Remove this model')} onClick={onRemove}><Icon name="trash" size={14} /></button>
      </div>
      <Collapse open={open}>
        <div class="pv-model-options">
          <div class="pv-pair">
            {capacity('contextWindow', formatTokens(1000000))}
            {capacity('maxTokens', formatTokens(128000))}
          </div>
          <div class="pv-field">
            <span class="pv-label">{t('Input types')}</span>
            <div class="pv-checks">
              <label><input type="checkbox" checked disabled />{t('Text')}</label>
              <label><input type="checkbox" checked={Boolean(m.image)} onChange={(e) => onChange({ ...m, image: e.currentTarget.checked })} />{t('Image')}</label>
            </div>
          </div>
          {reasoning && (
            <div class="pv-field">
              <div class="pv-reasoning-head">
                <span class="pv-label">
                  {t('Reasoning levels')}
                  <span class="pv-help" title={t('Left: the level the effort slider offers. Right: what is sent to the endpoint for it (empty for Off sends nothing).')}>?</span>
                </span>
                <Switch label={t('Reasoning levels')} checked={Boolean(levels)}
                        onChange={(on) => onChange({ ...m, reasoning: on ? { ...STARTING_LEVELS } : false })} />
              </div>
              {levels && (
                <>
                  {levels.map(([level, wire], i) => (
                    <div class="pv-level" key={i}>
                      <Dropdown label={t('Level')} value={level}
                                options={LEVELS.filter((l) => l === level || !(l in m.reasoning)).map((l) => ({ value: l, label: l }))}
                                onChange={(v) => setLevels(levels.map((e, j) => (j === i ? [v, e[1]] : e)))} />
                      <input type="text" value={wire ?? ''} spellcheck={false} placeholder={level === 'off' ? t('(nothing sent)') : level}
                             aria-label={t('Value sent')} onInput={(e) => setLevels(levels.map((x, j) => (j === i ? [x[0], e.currentTarget.value || (x[0] === 'off' ? null : '')] : x)))} />
                      <button type="button" class="icon-btn" title={t('Remove this level')} onClick={() => setLevels(levels.filter((_, j) => j !== i))}>
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  ))}
                  {levels.length < LEVELS.length && (
                    <button type="button" class="link-btn" onClick={() => {
                      const next = LEVELS.find((l) => !(l in m.reasoning));
                      setLevels([...levels, [next, next]]);
                    }}>{t('Add level')}</button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </Collapse>
    </li>
  );
}
