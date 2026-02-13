/**
 * List Smart Indent/Outdent for Source Mode
 *
 * Tab on a list line inserts tabSize spaces at line start (semantic indent).
 * Shift+Tab on a list line removes up to tabSize spaces from line start.
 * Non-list lines return false to fall through to other handlers.
 */

import { type KeyBinding, type EditorView } from "@codemirror/view";
import { type ChangeSpec } from "@codemirror/state";
import { guardCodeMirrorKeyBinding } from "@/utils/imeGuard";
import { useSettingsStore } from "@/stores/settingsStore";
import { LIST_ITEM_PATTERN, TASK_ITEM_PATTERN } from "./structuralCharProtection";

function getTabSize(): number {
  return useSettingsStore.getState().general.tabSize;
}

/**
 * Check if a line of text is a list item (-, *, +, 1., - [ ], - [x], etc.).
 */
function isListLine(text: string): boolean {
  return LIST_ITEM_PATTERN.test(text) || TASK_ITEM_PATTERN.test(text);
}

/**
 * Indent list lines: insert tabSize spaces at the start of each list line
 * in the selection range. Returns false if no list lines are found.
 */
export function listSmartIndent(view: EditorView): boolean {
  const { state } = view;
  const tabSize = getTabSize();
  const spaces = " ".repeat(tabSize);
  const { from, to } = state.selection.main;

  const startLine = state.doc.lineAt(from);
  const endLine = state.doc.lineAt(to);

  const changes: ChangeSpec[] = [];

  // Iterate lines from bottom to top to preserve positions
  for (let lineNum = endLine.number; lineNum >= startLine.number; lineNum--) {
    const line = state.doc.line(lineNum);
    if (isListLine(line.text)) {
      changes.push({ from: line.from, to: line.from, insert: spaces });
    }
  }

  if (changes.length === 0) return false;

  view.dispatch({
    changes,
    scrollIntoView: true,
  });
  return true;
}

/**
 * Outdent list lines: remove up to tabSize leading spaces from the start
 * of each list line in the selection range. Returns false if no list lines.
 */
export function listSmartOutdent(view: EditorView): boolean {
  const { state } = view;
  const tabSize = getTabSize();
  const { from, to } = state.selection.main;

  const startLine = state.doc.lineAt(from);
  const endLine = state.doc.lineAt(to);

  const changes: ChangeSpec[] = [];
  let hasListLine = false;

  // Iterate lines from bottom to top to preserve positions
  for (let lineNum = endLine.number; lineNum >= startLine.number; lineNum--) {
    const line = state.doc.line(lineNum);
    if (isListLine(line.text)) {
      hasListLine = true;
      const leadingSpaces = line.text.match(/^[ ]*/)?.[0].length ?? 0;
      if (leadingSpaces > 0) {
        const spacesToRemove = Math.min(leadingSpaces, tabSize);
        changes.push({ from: line.from, to: line.from + spacesToRemove, insert: "" });
      }
    }
  }

  if (!hasListLine) return false;

  if (changes.length > 0) {
    view.dispatch({
      changes,
      scrollIntoView: true,
    });
  }
  return true;
}

/**
 * Tab keybinding: smart indent for list lines.
 */
export const listSmartIndentKeymap: KeyBinding = guardCodeMirrorKeyBinding({
  key: "Tab",
  run: listSmartIndent,
});

/**
 * Shift+Tab keybinding: smart outdent for list lines.
 */
export const listSmartOutdentKeymap: KeyBinding = guardCodeMirrorKeyBinding({
  key: "Shift-Tab",
  run: listSmartOutdent,
});
