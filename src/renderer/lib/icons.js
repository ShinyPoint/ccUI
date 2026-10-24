// App icons, drawn in the style of Apple's SF Symbols: one 1.6 stroke on a 24×24 grid, round caps and joins,
// soft generously-rounded geometry, glyphs optically sized to a ~17-unit box, and fills only where SF uses them
// (stop, ellipsis). Strokes and fills use currentColor. scripts/icon-sheet.js draws them all.
export const ICON_STROKE = 1.6;

const fill = 'fill="currentColor" stroke="none"';
// shield outline: rounded top and shoulders, sides curving into a soft point
const SHIELD = 'M11.3 3.4a2 2 0 0 1 1.4 0l5.4 2.05A1.6 1.6 0 0 1 19.1 7v4.1c0 4.3-2.8 8.05-6.7 9.5a1.2 1.2 0 0 1-.8 0C7.7 19.15 4.9 15.4 4.9 11.1V7a1.6 1.6 0 0 1 1-1.55z';

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
  // arrow.up.right.square: opens in another app
  external: '<path d="M13.5 4.5h6v6M19.5 4.5l-8.25 8.25"/><path d="M17.25 13.5v3.6a2.4 2.4 0 0 1-2.4 2.4H6.9a2.4 2.4 0 0 1-2.4-2.4V9.15a2.4 2.4 0 0 1 2.4-2.4h3.6"/>',
  // text.word.wrap: long lines folded
  wrap: '<path d="M4.5 6.5h15M4.5 12h12a3 3 0 0 1 0 6h-3.5M4.5 17.5h4.5"/><path d="M14.75 15.75 12.5 18l2.25 2.25"/>',

  // pencil
  edit: '<path d="M15.6 5.4l3 3M5.5 18.5l.8-3.6L15.1 6.1a2.1 2.1 0 0 1 3 3l-8.8 8.8z"/>',

  // arrow.down
  arrowDown: '<path d="M12 5.5v12.75M6.75 13L12 18.25 17.25 13"/>',

  // ellipsis: three filled dots
  more: `<circle cx="6" cy="12" r="1.55" ${fill}/><circle cx="12" cy="12" r="1.55" ${fill}/><circle cx="18" cy="12" r="1.55" ${fill}/>`,

  // Permission modes (the message box's mode menu): a shield family, plus a list for plan mode.
  // shield: Ask before acting
  modeAsk: `<path d="${SHIELD}"/>`,
  // checkmark.shield: Accept edits
  modeAcceptEdits: `<path d="${SHIELD}"/><path d="M9.1 11.9l2.05 2.05 3.75-4.1"/>`,
  // list.bullet: Plan first
  modePlan: '<path d="M10 7h9.25M10 12h9.25M10 17h9.25"/>'
    + `<circle cx="5.6" cy="7" r="1.25" ${fill}/><circle cx="5.6" cy="12" r="1.25" ${fill}/><circle cx="5.6" cy="17" r="1.25" ${fill}/>`,
  // bolt.shield: Auto
  modeAuto: `<path d="${SHIELD}"/><path ${fill} d="M12.95 7.4a.35.35 0 0 0-.62-.27l-3.4 4.62a.4.4 0 0 0 .32.64h2.15l-.35 3.2a.35.35 0 0 0 .62.27l3.4-4.62a.4.4 0 0 0-.32-.64h-2.15z"/>`,
  // shield.slash: Bypass permissions
  modeBypass: `<path d="${SHIELD}"/><path d="M4.4 3.9l15.2 16.2"/>`,

  // rectangle.bottomthird.inset: a window with its bottom part marked, for the Terminal panel
  panelBottom: '<rect x="3.75" y="5" width="16.5" height="14" rx="2.6"/><path d="M3.75 14.25h16.5"/><path d="M7 16.6h4" />',

  // rectangle.righthalf.inset: a window with a panel at its right, for the Changes panel
  panelRight: '<rect x="3.75" y="5" width="16.5" height="14" rx="2.6"/><path d="M14.5 5v14"/><path d="M16.6 8.6h1.4M16.6 11h1.4"/>',
  // plus.forwardslash.minus: a file's changes
  diff: '<path d="M12 4.5v7M8.5 8h7M8.5 18.5h7"/>',

  // ---------- window buttons (WindowControls in App.jsx, not on macOS) ----------
  winMinimize: '<path d="M6.25 12h11.5"/>',
  winMaximize: '<rect x="6.25" y="6.25" width="11.5" height="11.5" rx="2.4"/>',
  // two overlapping squares: back to the size it had
  winRestore: '<rect x="5.75" y="8.25" width="10" height="10" rx="2.2"/><path d="M8.75 5.75h7a2.5 2.5 0 0 1 2.5 2.5v7"/>',

  // ---------- tool steps in the chat (ToolCard.jsx): one glyph per kind of step ----------
  // a window with a prompt and a cursor (run a command; a shell)
  toolRun: '<rect x="3.75" y="4.75" width="16.5" height="14.5" rx="3.5"/><path d="M7.4 9.4l2.75 2.6-2.75 2.6M12.6 14.6h4"/>',
  // the same window, its prompt followed by lines of output (a background shell's output)
  toolOutput: '<rect x="3.75" y="4.75" width="16.5" height="14.5" rx="3.5"/><path d="M7.4 9.25l2.1 1.95-2.1 1.95M11.5 9.25h5M11.5 12.2h3.5M7.5 15.6h9"/>',
  // a rounded square (stop a background task)
  toolStop: '<rect x="6.25" y="6.25" width="11.5" height="11.5" rx="2.6"/>',
  // a page with lines (read a file)
  toolRead: '<path d="M7.35 3.75h6.15l4.75 4.75v10.1a1.65 1.65 0 0 1-1.65 1.65H7.35a1.65 1.65 0 0 1-1.65-1.65V5.4a1.65 1.65 0 0 1 1.65-1.65z"/><path d="M13.3 3.95v3.4a1.2 1.2 0 0 0 1.2 1.2h3.55M9 12.6h6M9 15.9h4"/>',
  // a page with a plus (write a file)
  toolWrite: '<path d="M7.35 3.75h6.15l4.75 4.75v10.1a1.65 1.65 0 0 1-1.65 1.65H7.35a1.65 1.65 0 0 1-1.65-1.65V5.4a1.65 1.65 0 0 1 1.65-1.65z"/><path d="M13.3 3.95v3.4a1.2 1.2 0 0 0 1.2 1.2h3.55M12 11.4v5.6M9.2 14.2h5.6"/>',
  // a pencil (edit a file)
  toolEdit: '<path d="M15.35 5.2a2.1 2.1 0 0 1 2.95 0l.5.5a2.1 2.1 0 0 1 0 2.95L9.1 18.35l-4.05 1.1 1.1-4.05z"/><path d="M13.6 7l3.4 3.4"/>',
  // a picture: frame, sun, hills (look at an image)
  toolImage: '<rect x="3.75" y="5" width="16.5" height="14" rx="2.6"/><circle cx="9" cy="9.9" r="1.55"/><path d="M4.3 16.9l4.4-3.95a1.4 1.4 0 0 1 1.9.03l2.35 2.25 2.05-1.85a1.4 1.4 0 0 1 1.9 0l2.85 2.6"/>',
  // a folder with a magnifier (find files)
  toolFind: '<path d="M11.4 18.75H5.75a2 2 0 0 1-2-2V7.25a2 2 0 0 1 2-2h3.5l2 2.1h7a2 2 0 0 1 2 2v1.9"/><circle cx="16.4" cy="15.4" r="2.85"/><path d="M18.5 17.5l1.9 1.9"/>',
  // a magnifier over lines (search in files)
  toolSearch: '<circle cx="10.6" cy="10.6" r="6.1"/><path d="M15.1 15.1l4.4 4.4M8.2 9.2h4.8M8.2 12.1h3"/>',
  // a globe (search the web, fetch a page)
  toolWeb: '<circle cx="12" cy="12" r="8.25"/><path d="M3.95 12h16.1M12 3.75c2.15 2.3 3.25 5.05 3.25 8.25S14.15 17.95 12 20.25M12 3.75C9.85 6.05 8.75 8.8 8.75 12s1.1 5.95 3.25 8.25"/>',
  // a four-point sparkle (a subagent)
  toolAgent: '<path d="M12 3.75l1.6 4.45a2.4 2.4 0 0 0 1.45 1.45L19.5 11.25l-4.45 1.6a2.4 2.4 0 0 0-1.45 1.45L12 18.75l-1.6-4.45a2.4 2.4 0 0 0-1.45-1.45L4.5 11.25l4.45-1.6a2.4 2.4 0 0 0 1.45-1.45z"/>',
  // a checklist (the task list)
  toolTasks: '<path d="M4.75 7.1l1.65 1.65L9.3 5.85M4.75 15.1l1.65 1.65 2.9-2.9M12.75 7.25h6.5M12.75 15.25h6.5"/>',
  // a lightning bolt (a skill)
  toolSkill: '<path d="M13.4 3.75L6 13.2h5.55l-.95 7.05 7.4-9.45h-5.55z"/>',
  // a speech bubble with a question mark (a question for you)
  toolQuestion: '<path d="M12 4.5c4.55 0 8.25 2.95 8.25 6.75S16.55 18 12 18c-.85 0-1.7-.1-2.5-.3L5.6 19.6l1.05-3.2c-1.75-1.2-2.9-3.05-2.9-5.15C3.75 7.45 7.45 4.5 12 4.5z"/><path d="M10.2 9.4a1.9 1.9 0 1 1 2.6 1.75c-.5.2-.8.6-.8 1.15v.3M12 14.75h.01"/>',
  // a list with marks (a plan)
  toolPlan: '<path d="M10 6.75h9.25M10 12h9.25M10 17.25h9.25"/><circle cx="5.75" cy="6.75" r="1.15"/><circle cx="5.75" cy="12" r="1.15"/><circle cx="5.75" cy="17.25" r="1.15"/>',
  // a plug (an MCP tool)
  toolPlug: '<path d="M9.25 3.75v4M14.75 3.75v4M6.75 7.75h10.5v3a5.25 5.25 0 0 1-10.5 0zM12 16v4.25"/>',
  // a wrench (any other tool)
  toolOther: '<path d="M15.6 4.15a4.25 4.25 0 0 0-5.2 5.45l-5.5 5.5a1.95 1.95 0 0 0 2.75 2.75l5.5-5.5a4.25 4.25 0 0 0 5.45-5.2l-2.55 2.55-2.25-.45-.45-2.25z"/>',

  // keyboard: rounded body, a row of keys, the space bar
  keyboard: '<rect x="3.25" y="6.25" width="17.5" height="11.5" rx="2.4"/><path d="M7.1 10h.01M10.37 10h.01M13.63 10h.01M16.9 10h.01M8.6 14h6.8"/>',

  // dollarsign
  dollar: '<path d="M12 3.75v16.5M15.9 8.2c-.62-1.37-2.05-2.2-3.9-2.2-2.36 0-3.95 1.2-3.95 2.96 0 4.27 8.15 2.43 8.15 6.6 0 1.84-1.69 3.18-4.2 3.18-1.96 0-3.47-.86-4.15-2.34"/>',
};
