/**
 * Revision Tracker
 *
 * Purpose: Integrates revision tracking with the Tiptap editor — generates
 *   a new revision ID on each document transaction so MCP clients can detect
 *   when the document has changed.
 *
 * @coordinates-with revisionStore.ts — stores current revision ID
 * @coordinates-with components/Editor/TiptapEditor.tsx — calls initializeRevisionTracking on editor creation
 * @module hooks/mcpBridge/revisionTracker
 */

import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { useRevisionStore, generateRevisionId } from "@/stores/documentStore";

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
