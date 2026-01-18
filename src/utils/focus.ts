/**
 * Focus utilities for determining which UI area has keyboard focus.
 * Used for scope-based shortcut handling.
 */

/**
 * Check if the terminal view has focus.
 * Returns true if activeElement is inside the terminal container.
 */
export function isTerminalFocused(): boolean {
  const activeEl = document.activeElement;
  if (!activeEl) return false;

  // Check if inside terminal container (xterm renders into .terminal-view)
  return !!activeEl.closest(".terminal-view");
}

/**
 * Check if the editor has focus.
 * Returns true if activeElement is inside the ProseMirror editor.
 */
export function isEditorFocused(): boolean {
  const activeEl = document.activeElement;
  if (!activeEl) return false;

  // Check for ProseMirror editor or CodeMirror (source mode)
  return (
    !!activeEl.closest(".ProseMirror") ||
    !!activeEl.closest(".cm-editor")
  );
}

/**
 * Get the current focus context for shortcut scoping.
 */
export function getFocusContext(): "terminal" | "editor" | "other" {
  if (isTerminalFocused()) return "terminal";
  if (isEditorFocused()) return "editor";
  return "other";
}
