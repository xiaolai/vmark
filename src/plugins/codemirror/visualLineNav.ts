/**
 * Visual Line Navigation
 *
 * Purpose: Makes Up/Down arrow keys move by visual (wrapped) lines when word wrap
 * is enabled, and implements smart Home key that toggles between first non-whitespace
 * character and absolute line start.
 *
 * Key decisions:
 *   - Uses CodeMirror's built-in cursorLineUp/Down which already respect visual lines
 *   - Smart Home is a common editor convention (VS Code, Sublime) — first press goes to
 *     first non-whitespace, second press goes to column 0
 *   - All keybindings are IME-guarded
 *
 * @module plugins/codemirror/visualLineNav
 */

import { type KeyBinding } from "@codemirror/view";
import {
  cursorLineUp,
  cursorLineDown,
  selectLineUp,
  selectLineDown,
} from "@codemirror/commands";
import { guardCodeMirrorKeyBinding } from "@/utils/imeGuard";

/**
 * Smart Home command - toggles between first non-whitespace and line start.
 * First press: go to first non-whitespace character
 * Second press (if already at first non-whitespace): go to column 0
 * Exported for testing.
 */
export function smartHome(view: import("@codemirror/view").EditorView): boolean {
  const { state } = view;
  const { head } = state.selection.main;
  const line = state.doc.lineAt(head);

  // Find first non-whitespace character position
  const lineText = line.text;
  let firstNonWhitespace = 0;
  while (firstNonWhitespace < lineText.length && /\s/.test(lineText[firstNonWhitespace])) {
    firstNonWhitespace++;
  }
  const firstNonWhitespacePos = line.from + firstNonWhitespace;

  // If cursor is at first non-whitespace (or beyond in whitespace-only line),
  // go to absolute line start. Otherwise go to first non-whitespace.
  const targetPos = head === firstNonWhitespacePos || head === line.from
    ? (head === line.from ? firstNonWhitespacePos : line.from)
    : firstNonWhitespacePos;

  if (targetPos !== head) {
    view.dispatch({
      selection: { anchor: targetPos },
      scrollIntoView: true,
    });
  }
  return true;
}

/**
 * Smart Home with selection extension.
 * Exported for testing.
 */
export function smartHomeSelect(view: import("@codemirror/view").EditorView): boolean {
  const { state } = view;
  const { anchor, head } = state.selection.main;
  const line = state.doc.lineAt(head);

  const lineText = line.text;
  let firstNonWhitespace = 0;
  while (firstNonWhitespace < lineText.length && /\s/.test(lineText[firstNonWhitespace])) {
    firstNonWhitespace++;
  }
  const firstNonWhitespacePos = line.from + firstNonWhitespace;

  const targetPos = head === firstNonWhitespacePos || head === line.from
    ? (head === line.from ? firstNonWhitespacePos : line.from)
    : firstNonWhitespacePos;

  if (targetPos !== head) {
    view.dispatch({
      selection: { anchor, head: targetPos },
      scrollIntoView: true,
    });
  }
  return true;
}

/**
 * Keybinding for visual line up (respects word wrap).
 * CodeMirror's cursorLineUp already moves by visual lines when lineWrapping is enabled.
 */
export const visualLineUpKeymap: KeyBinding = guardCodeMirrorKeyBinding({
  key: "ArrowUp",
  run: cursorLineUp,
});

/**
 * Keybinding for visual line down (respects word wrap).
 */
export const visualLineDownKeymap: KeyBinding = guardCodeMirrorKeyBinding({
  key: "ArrowDown",
  run: cursorLineDown,
});

/**
 * Keybinding for visual line up with selection.
 */
export const visualLineUpSelectKeymap: KeyBinding = guardCodeMirrorKeyBinding({
  key: "Shift-ArrowUp",
  run: selectLineUp,
});

/**
 * Keybinding for visual line down with selection.
 */
export const visualLineDownSelectKeymap: KeyBinding = guardCodeMirrorKeyBinding({
  key: "Shift-ArrowDown",
  run: selectLineDown,
});

/**
 * Smart Home keybinding.
 */
export const smartHomeKeymap: KeyBinding = guardCodeMirrorKeyBinding({
  key: "Home",
  run: smartHome,
});

/**
 * Smart Home with selection keybinding.
 */
export const smartHomeSelectKeymap: KeyBinding = guardCodeMirrorKeyBinding({
  key: "Shift-Home",
  run: smartHomeSelect,
});
