// File changes Claude made: the diff of one edit, and everything one turn changed (the Changes panel).
import { structuredPatch } from 'diff';
import { childrenOf } from './chat-reducer.js';

export const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const SUBAGENT_TOOLS = new Set(['Agent', 'Task']);

export function countDiff(patches) {
  let add = 0;
  let del = 0;
  for (const h of patches || []) {
    for (const l of h.lines) {
      if (l[0] === '+') add++;
      else if (l[0] === '-') del++;
    }
  }
  return { add, del };
}

// The hunks of one edit: Claude Code's own patch when it sent one, otherwise rebuilt from the tool's input
// (conversations loaded from disk have no patch). A new file is all added lines.
export function patchesFor(item) {
  if (item.data?.structuredPatch?.length) return item.data.structuredPatch;
  const { input = {} } = item;
  if (item.name === 'Write') {
    return typeof input.content === 'string' ? structuredPatch('a', 'b', '', input.content, '', '', { context: 3 }).hunks : [];
  }
  const edits = Array.isArray(input.edits) ? input.edits : [input];
  return edits.flatMap((e) => (typeof e.old_string === 'string' && typeof e.new_string === 'string'
    ? structuredPatch('a', 'b', e.old_string, e.new_string, '', '', { context: 3 }).hunks
    : []));
}

export const editedPath = (item) => item.input?.file_path || item.input?.notebook_path || '';

// Finished edits among `items`, including those of subagents (their steps nest under the Agent call).
function editsIn(state, items, out = []) {
  for (const item of items) {
    if (item.type !== 'tool') continue;
    if (EDIT_TOOLS.has(item.name) && item.status === 'done' && editedPath(item)) out.push(item);
    else if (SUBAGENT_TOOLS.has(item.name)) editsIn(state, childrenOf(state, item.id), out);
  }
  return out;
}

// What one turn (from groupTurns) changed, a file per entry in the order first touched:
// [{ path, tools: [tool ids], patches, add, del, created }]. Hunks of successive edits are kept in order;
// their line numbers are those of the file at the time of each edit.
export function turnChanges(state, turn) {
  const files = new Map();
  for (const tool of editsIn(state, [...turn.work, ...turn.answer])) {
    const path = editedPath(tool);
    const f = files.get(path) || { path, tools: [], patches: [], add: 0, del: 0, created: false };
    const patches = patchesFor(tool);
    const { add, del } = countDiff(patches);
    f.tools.push(tool.id);
    f.patches.push(...patches);
    f.add += add;
    f.del += del;
    if (f.tools.length === 1 && tool.name === 'Write' && tool.data?.type === 'create') f.created = true;
    files.set(path, f);
  }
  return [...files.values()];
}

// Line numbers (in the file after the edit) of the lines the patches added.
export function addedLines(patches) {
  const lines = new Set();
  for (const h of patches || []) {
    let n = h.newStart;
    for (const l of h.lines) {
      if (l[0] === '+') lines.add(n++);
      else if (l[0] === ' ') n++;
    }
  }
  return lines;
}
