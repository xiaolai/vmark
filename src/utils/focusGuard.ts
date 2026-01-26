/**
 * Focus Guard
 *
 * Determines when menu actions should be blocked based on current focus state.
 * Used by the unified menu dispatcher to prevent actions when focus is in
 * non-editor UI elements.
 */

/**
 * Check if menu actions should be blocked based on current focus.
 *
 * Blocks when:
 * - Search/find bar has focus
 * - Settings dialog is open
 * - Rename input is focused (file explorer)
 * - Modal dialog is open and capturing input
 *
 * @returns true if menu actions should be blocked
 */
export function shouldBlockMenuAction(): boolean {
  const activeElement = document.activeElement;
  if (!activeElement) return false;

  // Search/find bar focused
  if (activeElement.closest(".find-bar")) return true;

  // File explorer rename input
  if (activeElement.closest(".rename-input")) return true;

  // Quick open / command palette
  if (activeElement.closest(".quick-open")) return true;

  // Settings dialog inputs
  if (activeElement.closest(".settings-dialog input")) return true;
  if (activeElement.closest(".settings-dialog textarea")) return true;

  // Any modal dialog that should capture input
  // Check for aria-modal attribute which indicates a modal
  const modalDialog = document.querySelector("[role='dialog'][aria-modal='true']");
  if (modalDialog) {
    // If there's a modal and focus is inside it, block menu actions
    // unless the modal is specifically for editor operations
    if (activeElement.closest("[role='dialog'][aria-modal='true']")) {
      // Allow if it's an editor-related popup (link popup, etc.)
      // These have specific classes
      if (activeElement.closest(".link-popup")) return false;
      if (activeElement.closest(".wiki-link-popup")) return false;
      if (activeElement.closest(".image-popup")) return false;
      return true;
    }
  }

  return false;
}

/**
 * Check if the current focus is in an editor context where menu actions should apply.
 *
 * @returns true if focus is in an editor (WYSIWYG or Source)
 */
export function isEditorContext(): boolean {
  const activeElement = document.activeElement;
  if (!activeElement) return false;

  // WYSIWYG (ProseMirror)
  if (activeElement.closest(".ProseMirror")) return true;

  // Source (CodeMirror)
  if (activeElement.closest(".cm-editor")) return true;

  // Editor container (handles some edge cases)
  if (activeElement.closest(".editor-container")) return true;

  return false;
}
