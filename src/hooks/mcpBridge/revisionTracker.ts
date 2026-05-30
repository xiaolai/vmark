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
import { useRevisionStore } from "@/stores/documentStore";

/**
 * Hook the editor to update revisions on document changes.
 * Should be called once when the editor is initialized.
 *
 * `tabId` scopes the revision to this editor's document (WI-0.10, C5). The
 * editor remounts per tab, so the active tab at mount is this editor's tab.
 */
export function initializeRevisionTracking(editor: Editor, tabId: string): void {
  // Ensure the tab has a revision WITHOUT resetting an existing one. The editor
  // remounts on every tab switch; resetting here would invalidate a revision an
  // MCP client already read for this tab (e.g. a lazily-initialized background
  // tab), causing false STALE rejections. `getRevision` lazily initializes only
  // when absent; real content changes bump it via the transaction listener below.
  useRevisionStore.getState().getRevision(tabId);

  // Update revision on document changes
  editor.on("transaction", ({ transaction }) => {
    if (shouldUpdateRevision(transaction)) {
      useRevisionStore.getState().updateRevision(tabId);
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
