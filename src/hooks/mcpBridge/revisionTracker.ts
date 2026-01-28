/**
 * Revision Tracker
 *
 * Integrates revision tracking with the Tiptap editor.
 * Updates revision on document transactions.
 */

import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { useRevisionStore, generateRevisionId } from "@/stores/revisionStore";

/**
 * Hook the editor to update revisions on document changes.
 * Should be called once when the editor is initialized.
 */
export function initializeRevisionTracking(editor: Editor): void {
  // Generate initial revision on document load
  useRevisionStore.getState().setRevision(generateRevisionId());

  // Update revision on document changes
  editor.on("transaction", ({ transaction }) => {
    if (shouldUpdateRevision(transaction)) {
      useRevisionStore.getState().updateRevision();
    }
  });
}

/**
 * Determine if a transaction should update the revision.
 * Only document-modifying transactions trigger revision updates.
 */
function shouldUpdateRevision(tr: Transaction): boolean {
  // Only update revision for actual document changes
  return tr.docChanged;
}

/**
 * Get the current document revision.
 */
export function getCurrentRevision(): string {
  return useRevisionStore.getState().getRevision();
}

/**
 * Check if a revision matches the current document state.
 * Used for optimistic concurrency control.
 */
export function isValidRevision(revision: string): boolean {
  return useRevisionStore.getState().isCurrentRevision(revision);
}

/**
 * Validate a base revision for a mutation operation.
 * Returns an error object if invalid, null if valid.
 */
export function validateBaseRevision(
  baseRevision: string | undefined
): { error: string; currentRevision: string } | null {
  const currentRevision = getCurrentRevision();

  if (!baseRevision) {
    return {
      error: "baseRevision is required for mutations",
      currentRevision,
    };
  }

  if (!isValidRevision(baseRevision)) {
    return {
      error: `Revision conflict: document has changed. Expected ${baseRevision}, current is ${currentRevision}`,
      currentRevision,
    };
  }

  return null;
}
