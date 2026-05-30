/**
 * errorMessage — normalize an unknown thrown value to a string.
 *
 * Replaces the ubiquitous `e instanceof Error ? e.message : String(e)` ternary
 * that appeared ~120× across the codebase (WI-3.1, D1). Only that exact shape
 * was codemodded; sites with custom/localized fallbacks keep their bespoke
 * logic.
 *
 * @module utils/errorMessage
 */

/** Return `error.message` for `Error` instances, else `String(error)`. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
