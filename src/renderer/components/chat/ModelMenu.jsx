// The chat's model menu, with the effort slider at its foot. It sits in the top bar, next to the project; the
// message box asks it for the model in use (which permission modes it offers).
import { Menu } from '../ui.jsx';
import { setModel, setEffort } from '../../lib/sessions.js';
import { EffortSlider } from './EffortSlider.jsx';
import { t } from '../../lib/i18n.js';

// The model menu's entry for the model in use. Ids may carry a context-size suffix the list doesn't (claude-opus-5-5[1m]
// runs Opus with a 1M window), and the list may name a model by its alias (opus) rather than its id.
const baseId = (id) => String(id || '').replace(/\[\w+\]$/, '').toLowerCase();
const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable'];
function findModel(models, selected, running) {
  const exact = selected && models.find((m) => m.value === selected);
  if (exact) return exact;
  const want = baseId(selected || running);
  if (!want) return null;
  // Nothing chosen: the default, when that is what runs.
  const byDefault = !selected && models.find((m) => m.value === 'default' && m.resolvedModel && baseId(m.resolvedModel) === want);
  if (byDefault) return byDefault;
  const named = models.find((m) => m.value !== 'default' && (baseId(m.value) === want || (m.resolvedModel && baseId(m.resolvedModel) === want)));
  if (named) return named;
  const family = FAMILIES.find((f) => want.includes(f));
  return (family && models.find((m) => m.value !== 'default' && (baseId(m.value) === family || m.displayName?.toLowerCase().startsWith(family)))) || null;
}

// The session's model list and the entry for the model in use (null until it is known).
export function currentModel(s) {
  const models = s.meta.value.models || [];
  return { models, current: findModel(models, s.selectedModel.value, s.chat.value.init?.model) };
}

export function ModelMenu({ s }) {
  const { models, current } = currentModel(s);
  if (!models.length) return null;
  const running = s.chat.value.init?.model;
  const longContext = /\[1m\]$/i.test(s.selectedModel.value || running || '');
  const label = current ? `${current.displayName}${longContext && !/1m/i.test(current.displayName) ? ' · 1M' : ''}`
    : running || s.selectedModel.value || t('Default model');
  // Effort levels come from the running model; before the first turn names it, from Claude Code's default.
  const effortModel = current || (!s.selectedModel.value && models.find((m) => m.value === 'default'));
  const effortLevels = effortModel?.supportsEffort ? effortModel.supportedEffortLevels || [] : [];
  return (
    <Menu
      className="model-menu"
      title={t('Model and effort')}
      up={false}
      label={<span class="menu-text">{label}</span>}
      value={current?.value}
      options={models.map((m) => ({ value: m.value, label: m.displayName, hint: m.description }))}
      onSelect={(v) => setModel(s, v)}
      footer={<EffortSlider levels={effortLevels} value={s.effort.value} onChange={(level) => setEffort(s, level)} />}
    />
  );
}
