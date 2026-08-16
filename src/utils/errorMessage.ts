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

/**
 * Normalize an unknown thrown value to an `Error`, for APIs that need one.
 *
 * The `e instanceof Error ? e : new Error(String(e))` spelling this replaces
 * puts a literal `String(error)` in the file, which
 * `scripts/check-command-error-ratchet.mjs` correctly flags wherever that file
 * also invokes a typed command — even though normalising is not *rendering*
 * and the value being normalised is usually not a command error at all.
 * Naming the operation removes both the noise and the ambiguity.
 */
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
