// The Changes panel at the right of a chat (components/SidePanel.jsx): opening it on a turn or a file.

// `turnKey`: the turn (its first item's key, see groupTurns); `toolId`: an edit, whose turn is looked up;
// `path`: the file to select. With none of them, the latest turn that changed files.
export function openChanges(s, { turnKey = null, toolId = null, path = null } = {}) {
  s.side.value = { ...s.side.value, open: true, turnKey, toolId, path };
}

export function closeChanges(s) {
  s.side.value = { ...s.side.value, open: false };
}

export function toggleChanges(s) {
  if (!s || s.kind.value !== 'chat') return;
  if (s.side.value.open) closeChanges(s);
  else openChanges(s);
}
