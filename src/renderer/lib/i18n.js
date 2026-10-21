// The app's own words in the language chosen in Settings → General (or the system's). The English text is the
// key (Stop shows as 停止 in Chinese), and anything without a translation shows as written, never blank.
// `{name}` in the text is filled from `vars`. Claude's replies, Claude Code's own CLI and file contents are not
// the app's words and are never passed through here.
import { signal, computed } from '@preact/signals';
import zhCN from '../locales/zh-CN/index.js';

const TABLES = { 'zh-CN': zhCN };
export const LANGUAGES = [
  { value: 'system', label: 'Follow system' },
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
];

// The setting ('system' | 'en' | 'zh-CN'), kept in step with Settings by main.jsx.
export const language = signal('system');
export const systemLocale = () => (typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '') ? 'zh-CN' : 'en');
export const locale = computed(() => (TABLES[language.value] || language.value === 'en' ? language.value : systemLocale()));

const fill = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text);

export function t(text, vars) {
  const table = TABLES[locale.value];
  return fill((table && table[text]) || text, vars);
}

// Marks text that is translated later, where it is shown (tables of labels): returns it as it is. The i18n test
// reads these too, so every such text has its translation.
export const phrase = (text) => text;

// "3 files": English adds an s; Chinese has its own form per word (plural:file → {n} 个文件).
export function plural(n, word) {
  const table = TABLES[locale.value];
  const own = table && table[`plural:${word}`];
  return own ? fill(own, { n }) : `${n} ${word}${n === 1 ? '' : 's'}`;
}
