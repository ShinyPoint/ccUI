// Backup of the original icon set (before the Apple-style redraw), kept for comparison and rollback.
// To switch back: in components/ui.jsx import LEGACY_ICONS as the icon source and set LEGACY_STROKE.
// SVG content for a 24×24 viewBox; strokes use currentColor.
export const LEGACY_STROKE = 1.8;

export const LEGACY_ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v4.5H8"/><path d="M12 8v4.5l3 1.8"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z"/>',
  sidebar: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>',
  send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  terminal: '<path d="M5 7l5 5-5 5M12.5 17H19"/>',
  chat: '<path d="M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 16h-6l-4.5 4v-4H7a2.5 2.5 0 0 1-2.5-2.5z"/>',
  clip: '<path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.3-8.3a3.3 3.3 0 0 1 4.7 4.7l-8.3 8.3a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6"/>',
  chevron: '<path d="M7 10l5 5 5-5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.5v.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', // added later, for message actions
  more: '<path d="M5.5 12h.01M12 12h.01M18.5 12h.01" stroke-width="3"/>',
  dollar: '<path d="M12 3.5v17M16.2 7.6c-.7-1.3-2.2-2.1-4.2-2.1-2.5 0-4.2 1.2-4.2 3.1 0 4.2 8.5 2.4 8.5 6.8 0 1.9-1.8 3.2-4.3 3.2-2 0-3.6-.8-4.4-2.2"/>',
};
