// Small display helpers shared by the components.
import { info } from './store.js';
import { t, plural, locale } from './i18n.js';

const isWin = () => info.value?.platform === 'win32';

export const samePath = (a, b) => (isWin() ? a.toLowerCase() === b.toLowerCase() : a === b);
export const basename = (p) => (p || '').split(/[\\/]/).filter(Boolean).pop() || p || '';

export function tildify(p) {
  const home = info.value?.home;
  if (!p || !home) return p || '';
  return samePath(p.slice(0, home.length), home) ? `~${p.slice(home.length)}` : p;
}

// Paths inside the project are shown relative to it.
export function relPath(p, cwd) {
  if (!p) return '';
  if (cwd && samePath(p.slice(0, cwd.length), cwd)) return p.slice(cwd.length).replace(/^[\\/]/, '') || basename(p);
  return tildify(p);
}

export function quotePath(p) {
  if (!/[\s'"&()]/.test(p)) return p;
  return isWin() ? `"${p}"` : `'${p.replace(/'/g, `'\\''`)}'`;
}

export function formatDuration(ms) {
  if (ms == null) return '';
  if (ms < 1000) return t('{n}ms', { n: Math.round(ms) });
  const s = ms / 1000;
  if (s < 60) return t('{n}s', { n: s < 10 ? s.toFixed(1) : Math.round(s) });
  const m = Math.floor(s / 60);
  return m < 60 ? t('{m}m {s}s', { m, s: Math.round(s % 60) }) : t('{h}h {m}m', { h: Math.floor(m / 60), m: m % 60 });
}

export function formatCost(usd) {
  if (!usd) return '';
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

export function formatTokens(n) {
  if (n == null) return '';
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n);
}

export function relativeTime(ms) {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return t('just now');
  if (min < 60) return t('{n} min ago', { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return t('{n} h ago', { n: h });
  const days = Math.round(h / 24);
  return days < 30 ? t('{n} d ago', { n: days }) : new Date(ms).toLocaleDateString(locale.value);
}

// "3 files", in the app's language (lib/i18n.js plural).
export const pluralize = plural;

export function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Opening a folder in the system's file manager, named as the system names it.
export const fileManagerLabel = () => (info.value.platform === 'win32' ? t('Open in File Explorer')
  : info.value.platform === 'darwin' ? t('Show in Finder') : t('Open in file manager'));
