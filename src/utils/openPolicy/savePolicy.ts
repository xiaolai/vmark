/**
 * Missing-file save policy
 *
 * Purpose: Decide whether a save should be blocked because the file went
 * missing on disk while open (force Save As to avoid silently recreating it).
 *
 * @module utils/openPolicy/savePolicy
 */

import type { MissingFileSaveAction, MissingFileSaveContext } from "./types";

/**
 * Determine if a save operation should be blocked due to a missing file.
 *
 * When a file is marked as missing (deleted from disk while open), we require
 * Save As to prevent accidentally recreating the file at the original location
 * without user intent.
 *
 * @example
 * resolveMissingFileSaveAction({ isMissing: true, hasPath: true }) // "save_as_required"
 * resolveMissingFileSaveAction({ isMissing: false, hasPath: true }) // "allow_save"
 */
export function resolveMissingFileSaveAction(
  context: MissingFileSaveContext
): MissingFileSaveAction {
  const { isMissing, hasPath } = context;

  // Only block save if file is missing AND has a path
  // (missing without path is a theoretical edge case)
  if (isMissing && hasPath) {
    return "save_as_required";
  }

  return "allow_save";
}
