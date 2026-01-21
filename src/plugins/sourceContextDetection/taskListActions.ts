/**
 * Task List Actions for Source Mode
 *
 * Toggle task list checkbox state:
 * - [ ] (unchecked) ↔ [x] (checked)
 * - Plain list item → task list item
 */

import type { EditorView } from "@codemirror/view";

// Patterns for task list detection
const TASK_UNCHECKED = /^(\s*[-*+]\s)\[ \](.*)$/;
const TASK_CHECKED = /^(\s*[-*+]\s)\[[xX]\](.*)$/;
const PLAIN_LIST = /^(\s*[-*+]\s)(.*)$/;

/**
 * Toggle task list checkbox on the current line.
 *
 * Behavior:
 * - [x] → [ ] (uncheck)
 * - [ ] → [x] (check)
 * - - item → - [ ] item (convert to task)
 */
export function toggleTaskList(view: EditorView): boolean {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const text = line.text;

  // Check if it's a checked task → uncheck
  let match = text.match(TASK_CHECKED);
  if (match) {
    const newText = `${match[1]}[ ]${match[2]}`;
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: newText },
    });
    view.focus();
    return true;
  }

  // Check if it's an unchecked task → check
  match = text.match(TASK_UNCHECKED);
  if (match) {
    const newText = `${match[1]}[x]${match[2]}`;
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: newText },
    });
    view.focus();
    return true;
  }

  // Check if it's a plain list item → convert to task
  match = text.match(PLAIN_LIST);
  if (match) {
    const newText = `${match[1]}[ ] ${match[2]}`;
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: newText },
    });
    view.focus();
    return true;
  }

  // Not a list item - do nothing
  return false;
}

