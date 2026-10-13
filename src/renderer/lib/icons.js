// App icons, drawn in the style of Apple's SF Symbols: one 1.6 stroke on a 24×24 grid, round caps and joins,
// soft generously-rounded geometry, glyphs optically sized to a ~17-unit box, and fills only where SF uses them
// (stop, ellipsis). Strokes and fills use currentColor. The previous set is kept in icons-legacy.js.
export const ICON_STROKE = 1.6;

const fill = 'fill="currentColor" stroke="none"';

export const ICONS = {
  // plus
  plus: '<path d="M12 5.25v13.5M5.25 12h13.5"/>',

  // magnifyingglass: round lens, short handle to the lower right
  search: '<circle cx="10.75" cy="10.75" r="5.75"/><path d="M15 15l4.25 4.25"/>',

  // xmark
  x: '<path d="M6.75 6.75l10.5 10.5M17.25 6.75l-10.5 10.5"/>',

  // folder: tab on the left, a seam under it, soft corners
  folder: '<path d="M3.5 7.4A2.4 2.4 0 0 1 5.9 5h3.05c.62 0 1.2.25 1.64.68l.98.97c.44.43 1.02.68 1.64.68h4.89a2.4 2.4 0 0 1 2.4 2.4v7.37a2.4 2.4 0 0 1-2.4 2.4H5.9a2.4 2.4 0 0 1-2.4-2.4z"/>'
    + '<path d="M3.5 9.6h17"/>',

  // arrow.clockwise: arc from the upper right, clockwise round to the top, arrowhead tip on the arc's end
  refresh: '<path d="M15.5 5.94A7 7 0 1 1 12 5"/><path d="M9.65 2.7L12 5 9.65 7.3"/>',

  // stop.fill: rounded square
  stop: `<rect x="6.25" y="6.25" width="11.5" height="11.5" rx="3" ${fill}/>`,

  // clock.arrow.circlepath
  history: '<path d="M4.9 12a7.1 7.1 0 1 0 2.1-5.05"/><path d="M6.6 3.6v3.55h3.55"/><path d="M12 8.6v3.7l2.5 1.5"/>',

  // slider.horizontal.3
  settings: '<path d="M4.5 7h8.4M16.9 7h2.6M4.5 12h1.9M10.4 12h9.1M4.5 17h6.4M14.9 17h4.6"/>'
    + '<circle cx="14.9" cy="7" r="2"/><circle cx="8.4" cy="12" r="2"/><circle cx="12.9" cy="17" r="2"/>',

  // sun.max
  sun: '<circle cx="12" cy="12" r="3.6"/>'
    + '<path d="M12 3.6v1.6M12 18.8v1.6M3.6 12h1.6M18.8 12h1.6M6.06 6.06l1.13 1.13M16.81 16.81l1.13 1.13M6.06 17.94l1.13-1.13M16.81 7.19l1.13-1.13"/>',

  // moon
  moon: '<path d="M19.6 14.7A7.7 7.7 0 0 1 9.3 4.4a7.9 7.9 0 1 0 10.3 10.3z"/>',

  // sidebar.left: window with a sidebar holding two short rows
  sidebar: '<rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="M9.5 5v14M5.9 8.4h1.4M5.9 10.9h1.4"/>',

  // arrow.up (inside the round send button)
  send: '<path d="M12 18.5V5.75M6.75 11L12 5.75 17.25 11"/>',

  // terminal: window with a prompt chevron and a cursor bar
  terminal: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M7.6 9.4l2.6 2.35-2.6 2.35M12.6 14.6h3.8"/>',

  // bubble.left: round speech bubble with a tail at the lower left
  chat: '<path d="M12 4.75c4.56 0 8.25 3.03 8.25 6.77s-3.69 6.76-8.25 6.76c-.95 0-1.86-.13-2.7-.37L5.6 19.7c-.47.21-.98-.24-.82-.73l.88-2.75C4.4 14.98 3.75 13.32 3.75 11.52c0-3.74 3.69-6.77 8.25-6.77z"/>',

  // paperclip
  clip: '<path d="M15.9 8.1l-6.4 6.4a1.6 1.6 0 0 0 2.27 2.27l6.73-6.73a3.3 3.3 0 0 0-4.67-4.67l-6.9 6.9a5 5 0 0 0 7.07 7.07l5.9-5.9"/>',

  // chevron.down
  chevron: '<path d="M6.75 9.5L12 14.75 17.25 9.5"/>',

  // checkmark
  check: '<path d="M5.5 12.6l4.1 4.1 8.9-9.2"/>',

  // exclamationmark.triangle: rounded triangle, bar and dot
  alert: '<path d="M10.27 5.05a2 2 0 0 1 3.46 0l6.83 11.87a2 2 0 0 1-1.73 3H5.17a2 2 0 0 1-1.73-3z"/>'
    + '<path d="M12 9.6v4"/><circle cx="12" cy="16.55" r=".95" ' + fill + '/>',

  // doc.on.doc: two stacked rounded sheets
  copy: '<rect x="4.5" y="8.25" width="11.25" height="11.25" rx="2.5"/><path d="M8.25 8.25V6.9a2.4 2.4 0 0 1 2.4-2.4h6.45a2.4 2.4 0 0 1 2.4 2.4v6.45a2.4 2.4 0 0 1-2.4 2.4h-1.35"/>',

  // pencil
  edit: '<path d="M15.6 5.4l3 3M5.5 18.5l.8-3.6L15.1 6.1a2.1 2.1 0 0 1 3 3l-8.8 8.8z"/>',

  // arrow.down
  arrowDown: '<path d="M12 5.5v12.75M6.75 13L12 18.25 17.25 13"/>',

  // ellipsis: three filled dots
  more: `<circle cx="6" cy="12" r="1.55" ${fill}/><circle cx="12" cy="12" r="1.55" ${fill}/><circle cx="18" cy="12" r="1.55" ${fill}/>`,

  // dollarsign
  dollar: '<path d="M12 3.75v16.5M15.9 8.2c-.62-1.37-2.05-2.2-3.9-2.2-2.36 0-3.95 1.2-3.95 2.96 0 4.27 8.15 2.43 8.15 6.6 0 1.84-1.69 3.18-4.2 3.18-1.96 0-3.47-.86-4.15-2.34"/>',
};
