// Markdown to sanitized HTML, with syntax-highlighted code blocks and math (KaTeX).
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import 'katex/contrib/copy-tex'; // copying a selection with a formula in it copies its TeX
import 'katex/dist/katex.min.css';
import { t } from './i18n.js';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const LANGUAGES = { bash, c, cpp, csharp, css, diff, go, java, javascript, json, kotlin, markdown, php, powershell, python, ruby, rust, sql, swift, typescript, xml, yaml };
for (const [name, lang] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, lang);
hljs.registerAliases(['sh', 'shell', 'zsh', 'console'], { languageName: 'bash' });
hljs.registerAliases(['js', 'jsx', 'mjs', 'cjs'], { languageName: 'javascript' });
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['html', 'svg', 'vue'], { languageName: 'xml' });
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });
hljs.registerAliases(['ps1', 'pwsh'], { languageName: 'powershell' });
hljs.registerAliases(['rs'], { languageName: 'rust' });
hljs.registerAliases(['cs'], { languageName: 'csharp' });
hljs.registerAliases(['kt'], { languageName: 'kotlin' });
hljs.registerAliases(['rb'], { languageName: 'ruby' });
hljs.registerAliases(['md'], { languageName: 'markdown' });
hljs.registerAliases(['h', 'hpp', 'cc'], { languageName: 'cpp' });

const escapeHtml = (s) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export function highlight(code, lang) {
  if (lang && hljs.getLanguage(lang)) {
    try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch { /* fall through */ }
  }
  return escapeHtml(code);
}

export function languageForPath(path) {
  const ext = /\.([a-z0-9]+)$/i.exec(path || '')?.[1]?.toLowerCase();
  return ext && hljs.getLanguage(ext) ? ext : null;
}

// Math: $…$ and \(…\) in a line, $$…$$ and \[…\] on their own. A single $ only opens before a non-space and closes
// after one, not followed by a letter or digit, so prices ($5 and $10) and shell variables ($HOME/$USER) stay text.
// The formulas are kept aside while the rest is parsed and sanitized, and put in afterwards (see renderMarkdown).
let formulas = [];
let nonce = '';

const mathToken = (type, raw, tex, display) => ({ type, raw, text: tex.trim(), display });

const mathBlock = {
  name: 'mathBlock',
  level: 'block',
  // Where a paragraph may end for it: a line starting with one ($$ further along a line is inline).
  start: (src) => {
    const at = /\n {0,3}(?:\$\$|\\\[)/.exec(src)?.index;
    return at == null ? undefined : at + 1;
  },
  tokenizer(src) {
    const m = /^ {0,3}(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])[ \t]*(?:\n+|$)/.exec(src);
    if (m) return mathToken('mathBlock', m[0], m[1] ?? m[2], true);
  },
  renderer: (token) => `<div data-math="${nonce}-${formulas.push(token) - 1}"></div>`,
};

const mathInline = {
  name: 'mathInline',
  level: 'inline',
  start: (src) => /(?<![\w\\$])\$|\\[([]/.exec(src)?.index,
  tokenizer(src) {
    let m = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])/.exec(src);
    if (m) return mathToken('mathInline', m[0], m[1] ?? m[2], true);
    m = /^\\\(([\s\S]+?)\\\)/.exec(src);
    if (m) return mathToken('mathInline', m[0], m[1], false);
    m = /^\$(?![\s$])((?:\\.|[^\\$\n])+?)\$(?![0-9A-Za-z])/.exec(src);
    if (m && !/\s$/.test(m[1])) return mathToken('mathInline', m[0], m[1], false);
  },
  renderer: (token) => `<span data-math="${nonce}-${formulas.push(token) - 1}"></span>`,
};

// Claude's TeX is untrusted too: KaTeX's trust is off (no links, classes, styles or ids from the TeX), sizes are
// capped, and what doesn't parse is shown as it was written. So is TeX with a command trust turns away, which KaTeX
// would otherwise draw in its error color (only those use it here, so the color tells them apart).
const REFUSED = '#cc0001';

function renderFormula({ raw, text, display }) {
  try {
    const html = katex.renderToString(text, { displayMode: display, throwOnError: true, errorColor: REFUSED, strict: 'ignore', trust: false, maxSize: 10, maxExpand: 1000 });
    return html.includes(REFUSED) ? escapeHtml(raw) : html;
  } catch {
    return escapeHtml(raw);
  }
}

const marked = new Marked({ gfm: true, breaks: false });
marked.use({
  extensions: [mathBlock, mathInline],
  renderer: {
    code({ text, lang }) {
      const language = (lang || '').trim().split(/\s+/)[0];
      return `<div class="code-block"><div class="code-head"><span>${escapeHtml(language || t('Plain text'))}</span>`
        + `<button type="button" class="code-copy" data-copy-code>${escapeHtml(t('Copy'))}</button></div>`
        + `<pre><code class="hljs">${highlight(text, language)}</code></pre></div>`;
    },
  },
});

// Claude's text is untrusted (a prompt injection can make it write anything), so the HTML is held to plain
// content: no styles, forms or media; images only when embedded (data:), so nothing is fetched from anywhere;
// links only to the web; and only the classes the code blocks themselves use, so no output can pass for app UI.
const SANITIZE = {
  ADD_ATTR: ['data-copy-code'],
  FORBID_TAGS: ['style', 'form', 'textarea', 'select', 'option', 'video', 'audio', 'source', 'track', 'picture', 'image', 'svg', 'math', 'meta', 'link', 'base'],
  FORBID_ATTR: ['style', 'srcset', 'poster', 'background', 'action', 'formaction', 'ping', 'xlink:href'],
};
const OWN_CLASS = /^(hljs[\w-]*|code-block|code-head|code-copy|language-[\w+-]+)$/;

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.hasAttribute('class')) {
    const kept = node.getAttribute('class').split(/\s+/).filter((c) => OWN_CLASS.test(c));
    if (kept.length) node.setAttribute('class', kept.join(' '));
    else node.removeAttribute('class');
  }
  if (node.tagName === 'IMG' && !/^data:image\/(png|gif|jpe?g|webp|bmp);/i.test(node.getAttribute('src') || '')) {
    node.removeAttribute('src');
  }
  if (node.hasAttribute('href') && !/^(https?:|mailto:|#)/i.test(node.getAttribute('href'))) node.removeAttribute('href');
  if (node.tagName === 'BUTTON' && !node.hasAttribute('data-copy-code')) node.setAttribute('disabled', '');
  if (node.tagName === 'INPUT') { // task lists (- [x]): a read-only checkbox is the only input allowed
    node.setAttribute('type', 'checkbox');
    node.setAttribute('disabled', '');
  }
});

const cache = new Map();

export function renderMarkdown(text) {
  const hit = cache.get(text);
  if (hit) return hit;
  // A new nonce for each text, so a placeholder written in Claude's own HTML can't stand for a formula.
  formulas = [];
  nonce = Math.random().toString(36).slice(2);
  const html = DOMPurify.sanitize(marked.parse(text || ''), SANITIZE)
    .replace(/<(span|div) data-math="(\w+)-(\d+)"><\/\1>/g, (_m, _tag, n, i) => (n === nonce && formulas[i] ? renderFormula(formulas[i]) : ''));
  formulas = [];
  if (cache.size > 400) cache.delete(cache.keys().next().value);
  cache.set(text, html);
  return html;
}
