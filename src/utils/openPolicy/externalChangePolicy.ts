/**
 * External-change policy
 *
 * Purpose: Decide how to handle an external file change event — auto-reload a
 * clean document, prompt the user for a dirty one, or ignore an unsaved buffer.
 *
 * @module utils/openPolicy/externalChangePolicy
 */

import type { ExternalChangeAction, ExternalChangeContext } from "./types";

/**
 * Determine how to handle an external file change event.
 *
 * Policy:
 * - Clean documents: auto-reload silently
 * - Dirty documents: prompt user to choose
 * - Unsaved (no path): ignore external changes
 *
 * @example
 * resolveExternalChangeAction({ isDirty: false, hasFilePath: true }) // "auto_reload"
 * resolveExternalChangeAction({ isDirty: true, hasFilePath: true }) // "prompt_user"
 */
export function resolveExternalChangeAction(
  context: ExternalChangeContext
): ExternalChangeAction {
  const { isDirty, hasFilePath } = context;

  // No file path means no external file to track
  if (!hasFilePath) {
    return "no_op";
  }

  // Dirty docs need user decision
  if (isDirty) {
    return "prompt_user";
  }

  // Clean docs auto-reload
  return "auto_reload";
}

/** What a queued conflict still needs to know about its document. */
export interface QueuedConflictContext {
  /** The document as it stands NOW, or undefined if the tab is gone. */
  document: { filePath: string | null; isDirty: boolean; isDivergent: boolean } | undefined;
  /** The path recorded when the conflict was queued. */
  queuedPath: string;
  /** Compare two paths the way the watcher does. */
  normalize: (path: string) => string;
}

/**
 * Is a queued conflict still worth resolving?
 *
 * A conflict waits out a debounce and then, for a multi-file batch, a modal the
 * user may sit on indefinitely. The entry names the tab and path captured when
 * it was QUEUED, and any of four things can happen in that window:
 *
 *   - the tab is closed          → there is nothing to resolve;
 *   - the document is saved      → the conflict resolved itself, and prompting
 *                                  would ask about a conflict that is gone;
 *   - the tab is renamed         → the entry names a path this document no
 *                                  longer has, so reloading it would pull the
 *                                  WRONG file's bytes into the buffer;
 *   - nothing                    → resolve it, which is the point.
 *
 * `isDivergent` counts as still-in-conflict alongside `isDirty`, for the same
 * reason `mcpBridge/v2/workspaceOpen.ts` gives: it marks content the user
 * deliberately kept after an external modification, so it is unsaved work even
 * though the dirty flag is clear.
 *
 * Pure, so the four cases are four assertions rather than four orchestrations
 * of a debounce, a watcher and a modal.
 */
export function isQueuedConflictStillLive(context: QueuedConflictContext): boolean {
  const { document, queuedPath, normalize } = context;
  if (!document) return false;
  if (!document.filePath) return false;
  if (normalize(document.filePath) !== normalize(queuedPath)) return false;
  return document.isDirty || document.isDivergent;
}
