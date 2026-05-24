/**
 * Read-Only Guard
 *
 * Purpose: Central guard for checking whether the active document is in
 *   read-only mode. Used by MCP bridge, auto-save, drag-drop, and other
 *   mutation paths that bypass the editor's built-in editable check.
 *
 * @coordinates-with documentStore.ts — reads readOnly flag
 * @coordinates-with activeDocument.ts — resolves active tab ID
 * @module utils/readOnlyGuard
 */

import { useDocumentStore } from "@/stores/documentStore";
import { getActiveTabId } from "@/services/navigation/activeDocument";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";

/**
 * Check if a specific document is in read-only mode.
 */
export function isDocReadOnly(tabId: string): boolean {
  return useDocumentStore.getState().isReadOnly(tabId);
}

/**
 * Check if the active document in the current window is in read-only mode.
 */
export function isActiveDocReadOnly(): boolean {
  const tabId = getActiveTabId(getCurrentWindowLabel());
  if (!tabId) return false;
  return isDocReadOnly(tabId);
}
