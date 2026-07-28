/**
 * Read-Only Guard
 *
 * Purpose: Central guard for checking whether a document is in read-only
 *   mode. Used by MCP bridge, auto-save, drag-drop, and other mutation paths
 *   that bypass the editor's built-in editable check.
 *
 *   Two entry points, and the difference matters: `isActiveDocReadOnly`
 *   asks about the focused tab, while `isTargetDocReadOnly` asks about the
 *   tab an operation NAMES. MCP mutations carry a `tabId`, so gating them on
 *   the active tab let a write to a read-only background tab through and
 *   refused a write to a writable one (audit 20260728 §1.4).
 *
 * @coordinates-with documentStore.ts — reads readOnly flag
 * @coordinates-with activeDocument.ts — resolves active tab ID
 * @module utils/readOnlyGuard
 */

import { useDocumentStore } from "@/stores/documentStore";
import { getActiveTabId } from "@/services/navigation/activeDocument";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";

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

/**
 * Check whether the document a mutation *targets* is read-only.
 *
 * MCP mutations (`document.write`, `document.transform`,
 * `workflow.apply_patch`) carry an optional `tabId`, so gating them on the
 * ACTIVE tab was wrong in both directions: a write aimed at a read-only
 * background tab slipped past the guard, and a write aimed at a writable
 * background tab was refused whenever the active doc happened to be read-only.
 *
 * A non-string `tabId` falls back to the active tab rather than throwing —
 * argument validation belongs to the handler, not the guard. An unknown tab
 * reports writable so the handler can raise its own `TAB_NOT_FOUND` instead of
 * a misleading `READ_ONLY`.
 */
export function isTargetDocReadOnly(tabIdArg: unknown): boolean {
  if (typeof tabIdArg === "string" && tabIdArg.length > 0) {
    return isDocReadOnly(tabIdArg);
  }
  return isActiveDocReadOnly();
}
