/**
 * Focus utilities for determining which UI area has keyboard focus.
 */

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
export function getFocusContext(): "editor" | "other" {
  if (isEditorFocused()) return "editor";
  return "other";
}
