// The model providers a DeepSeek Harness chat can use (Settings → DeepSeek Harness → Model providers): DeepSeek's own
// API, and endpoints the user adds (a relay, a self-hosted server, any OpenAI- or Anthropic-compatible API). Shared
// by the main process (dsh.js writes them into dsh's patch) and the window (the Settings editor, the model menus),
// so it imports nothing. Custom providers become routes of dsh's llm-pi-ai adapter.

export const OFFICIAL = 'deepseek-official';
export const OFFICIAL_BASE_URL = 'https://api.deepseek.com/anthropic';
// dsh-llm-deepseek's own catalog, shown until the user edits it ("Restore default models" goes back to it).
export const OFFICIAL_MODELS = [
  { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
];
const OFFICIAL_EFFORTS = ['off', 'low', 'high', 'max'];

// The protocols llm-pi-ai speaks to a route it doesn't ship (its supportedProtocols()).
export const PROTOCOLS = [
  { value: 'openai-completions', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
];
// Reasoning levels llm-pi-ai accepts as keys of reasoningEfforts, least to most.
export const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
// What a model's reasoning starts as when it is switched on: off sends nothing, the others their own name.
export const STARTING_LEVELS = { off: null, low: 'low', medium: 'medium', high: 'high' };

// A model's value in ccUI (the model menu, settings, remembered conversations): DeepSeek's are their bare ids, as
// before custom providers; a custom provider's carry the provider in front.
const SEP = '::';
export const modelValue = (provider, model) => (provider === OFFICIAL ? model : `${provider}${SEP}${model}`);
export function parseModel(value) {
  const at = String(value || '').indexOf(SEP);
  return at < 0 ? { provider: OFFICIAL, model: String(value || '') } : { provider: value.slice(0, at), model: value.slice(at + SEP.length) };
}

// A new provider's id, from its name: lowercase and hyphens (what dsh's routes and credential records accept), with
// a prefix no route of dsh's own catalog has, made unique among `taken`.
export function providerId(name, taken = []) {
  const slug = String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'api';
  let id = `custom-${slug}`;
  for (let n = 2; taken.includes(id); n++) id = `custom-${slug}-${n}`;
  return id;
}

// A model's levels for the effort slider: its declared reasoning levels, or none.
const effortsOf = (m) => (m.reasoning && typeof m.reasoning === 'object' ? LEVELS.filter((l) => l in m.reasoning) : []);

// Every model to choose from: [{ value, provider, providerName, model, name, efforts }], DeepSeek's first.
export function catalog(settings) {
  const official = settings.dshOfficial || {};
  const out = (official.models || OFFICIAL_MODELS).map((m) => ({
    value: modelValue(OFFICIAL, m.id), provider: OFFICIAL, providerName: 'DeepSeek', model: m.id, name: m.name || m.id, efforts: OFFICIAL_EFFORTS,
  }));
  for (const p of settings.dshProviders || []) {
    for (const m of p.models || []) {
      if (m.id) out.push({ value: modelValue(p.id, m.id), provider: p.id, providerName: p.name || p.id, model: m.id, name: m.name || m.id, efforts: effortsOf(m) });
    }
  }
  return out;
}

// What is wrong with a provider as edited (Settings refuses to save it): an English message, or ''.
export function problemWith(p, others = []) {
  if (!String(p.name || '').trim()) return 'Give the provider a name.';
  if (p.id !== OFFICIAL) {
    if (!/^https?:\/\/\S+$/.test(String(p.baseURL || '').trim())) return 'The API address must start with http:// or https://.';
    if (!PROTOCOLS.some((x) => x.value === p.api)) return 'Choose an API protocol.';
    if (!(p.models || []).length) return 'Add at least one model.';
  } else if (p.baseURL && !/^https?:\/\/\S+$/.test(String(p.baseURL).trim())) return 'The API address must start with http:// or https://.';
  const ids = (p.models || []).map((m) => String(m.id || '').trim());
  if (ids.some((id) => !id)) return 'Every model needs an ID.';
  if (new Set(ids).size !== ids.length) return 'Two models have the same ID.';
  const bad = (n) => n != null && n !== '' && !(Number.isInteger(Number(n)) && Number(n) > 0);
  if ((p.models || []).some((m) => bad(m.contextWindow) || bad(m.maxTokens))) return 'Context window and max output are whole numbers of tokens.';
  // llm-pi-ai's own rules for reasoningEfforts: each level beyond Off says what to send, and there is one at least.
  for (const m of p.models || []) {
    if (!m.reasoning || typeof m.reasoning !== 'object') continue;
    const levels = Object.entries(m.reasoning);
    if (!levels.some(([l]) => l !== 'off')) return 'A model with reasoning needs a level beyond Off.';
    if (levels.some(([l, wire]) => l !== 'off' && !String(wire || '').trim())) return 'Each reasoning level beyond Off needs the value to send.';
  }
  if (others.some((o) => o.id !== p.id && o.name.trim().toLowerCase() === p.name.trim().toLowerCase())) return 'Another provider has this name.';
  return '';
}

const num = (n) => (n == null || n === '' ? undefined : Number(n));
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// dsh's configuration for the providers, as patch entries (dsh.js). `keyEnv(id)`: the environment variable that
// carries a provider's key into dsh, or '' for a provider without one.
export function patchEntries(settings, keyEnv) {
  const official = settings.dshOfficial || {};
  const deepseek = defined({
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    baseURL: official.baseURL || undefined,
    models: official.models ? official.models.map((m) => defined({
      id: m.id, name: m.name || undefined, contextWindow: num(m.contextWindow), maxTokens: num(m.maxTokens),
      inputModalities: m.image ? ['text', 'image'] : undefined,
    })) : undefined,
  });
  const providers = {};
  for (const p of settings.dshProviders || []) {
    providers[p.id] = defined({
      displayName: p.name,
      api: p.api,
      baseURL: p.baseURL,
      apiKeyEnv: keyEnv(p.id) || undefined,
      models: (p.models || []).map((m) => defined({
        id: m.id, name: m.name || undefined, contextWindow: num(m.contextWindow), maxTokens: num(m.maxTokens),
        input: m.image ? ['text', 'image'] : ['text'],
        reasoningEfforts: m.reasoning && typeof m.reasoning === 'object' ? m.reasoning : false,
      })),
    });
  }
  return [
    { id: 'llm-deepseek', config: deepseek },
    ...(Object.keys(providers).length ? [{ id: 'llm-pi-ai', config: { providers } }] : []),
  ];
}

// Where a provider lists its models (llm-pi-ai's listingUrl), and the headers it wants.
export function listing(api, baseURL, key) {
  const base = String(baseURL || '').replace(/\/+$/, '');
  if (api === 'anthropic-messages') {
    return {
      url: `${base.endsWith('/v1') ? base.slice(0, -3) : base}/v1/models?limit=1000`,
      headers: { 'anthropic-version': '2023-06-01', ...(key ? { 'x-api-key': key } : {}) },
    };
  }
  return { url: `${base}/models`, headers: key ? { authorization: `Bearer ${key}` } : {} };
}

// A listing's answer as catalog rows: OpenAI's { data: [{ id }] }, Anthropic's { data: [{ id, display_name }] }, and
// the capacities gateways add (OpenRouter's context_length, others' context_window and max_output_tokens).
export function parseListing(body) {
  const entries = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  const first = (...xs) => xs.find((x) => Number.isInteger(x) && x > 0);
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    const id = typeof e === 'string' ? e : e?.id || e?.name;
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    const name = typeof e === 'object' && (e.display_name || e.displayName || (e.name !== id ? e.name : '')) || '';
    out.push(defined({
      id, name: name || id,
      contextWindow: first(e?.context_window, e?.context_length, e?.max_input_tokens, e?.limit?.context),
      maxTokens: first(e?.max_output_tokens, e?.max_tokens, e?.limit?.output, e?.top_provider?.max_completion_tokens),
    }));
  }
  return out;
}
