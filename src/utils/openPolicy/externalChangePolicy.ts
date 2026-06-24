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
