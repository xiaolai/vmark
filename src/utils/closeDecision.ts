/**
 * Close Decision Logic
 *
 * Pure helper for the 3-way dirty-close decision state machine.
 * Separates decision logic from side effects (dialogs, file I/O).
 *
 * Decision outcomes:
 * - Save: User wants to save before closing
 * - Discard: User wants to close without saving
 * - Cancel: User wants to cancel the close operation
 */

/**
 * Possible outcomes of a dirty-close decision.
 */
export type CloseDecision = "save" | "discard" | "cancel";

/**
 * Map dialog result to a close decision.
 *
 * The Tauri `ask()` dialog returns:
 * - `true`: User clicked OK/Save button
 * - `false`: User clicked Cancel/Don't Save button
 * - `null`: User pressed Escape or closed the dialog
 *
 * @param dialogResult - Result from ask() dialog
 * @returns The close decision
 */
export function mapDialogResultToDecision(
  dialogResult: boolean | null
): CloseDecision {
  if (dialogResult === null) {
    return "cancel";
  }
  return dialogResult ? "save" : "discard";
}

/**
 * Check if a document needs a dirty-close prompt.
 *
 * @param isDirty - Whether the document has unsaved changes
 * @returns true if user should be prompted before closing
 */
export function needsDirtyClosePrompt(isDirty: boolean): boolean {
  return isDirty;
}

/**
 * Determine if close should proceed based on decision and save result.
 *
 * @param decision - The user's close decision
 * @param saveSucceeded - Whether save was successful (only relevant if decision is "save")
 * @returns true if close should proceed
 */
export function shouldProceedWithClose(
  decision: CloseDecision,
  saveSucceeded: boolean = true
): boolean {
  switch (decision) {
    case "cancel":
      return false;
    case "discard":
      return true;
    case "save":
      return saveSucceeded;
  }
}
