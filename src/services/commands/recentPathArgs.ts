/**
 * Shared argument parser for recent-entry commands (`file.openRecent`,
 * `workspace.openRecent`).
 *
 * `args` is either the tuple `[path, label]` (menu dispatch) or a plain path
 * string (programmatic call). Anything else — including `[]`, `null`, and
 * `undefined` — is rejected so it can't become a literal "undefined"/"null"
 * path.
 *
 * @module services/commands/recentPathArgs
 */

/** Normalize a recent-entry command argument to a non-empty path string. */
export function parseRecentPathArgs(args: unknown): string | null {
  const candidate = Array.isArray(args) ? args[0] : args;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}
