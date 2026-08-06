/**
 * commandError — the TypeScript twin of Rust's `CommandError` (WI-14).
 *
 * Purpose: let a caller BRANCH on why a Tauri command failed. Rule 50 §10 used
 * to canonize `Result<T, String>`, so the only thing that crossed the boundary
 * was prose, and the frontend reconstructed the class by matching text:
 * `saveToPath.ts` tested a `"PARENT_MISSING:"` prefix, the MCP browser handlers
 * ran `String(error).includes("APPROVAL_REQUIRED")` at four sites. Both are
 * substring matches on a sentence — they fire on any payload that happens to
 * contain the token, and they stop firing the day someone rewords the message.
 *
 * Wire shape (pinned by `src-tauri/src/command_error.test.rs`):
 *
 *     { code: "not-found", message: "…", i18nKey?: "errors.…", detail?: {…} }
 *
 * Absent optionals are absent, never `null`.
 *
 * Key decisions:
 *   - **`parseCommandError` returns `null`, not a throw**, for anything that is
 *     not the typed shape. The migration is incremental (see the ratchet in
 *     `scripts/check-command-error-ratchet.mjs`), so most commands still reject
 *     with a plain string and every caller must handle both.
 *   - **An unrecognised `code` still parses.** Rejecting it would make a newer
 *     backend look like a legacy string and throw away the message the user
 *     should see. It classifies as `fatal` — the safe default.
 *   - **`i18nKey` is not resolved here.** The Rust locale bundles are not loaded
 *     in the webview; the key travels so `lint:i18n` can see the string and so a
 *     future shared bundle can re-render it. Today the UI maps `code` to its own
 *     translation key.
 *
 * @coordinates-with src-tauri/src/command_error.rs — the Rust source of truth
 * @coordinates-with src/test/fixtures/commandErrorWire.json — generated fixtures
 * @module services/commands/commandError
 */

/** Every code Rust can emit. Kept in the same order as `ErrorCode::ALL`. */
export const COMMAND_ERROR_CODES = [
  "invalid-input",
  "not-found",
  "permission-denied",
  "approval-required",
  "conflict",
  "io",
  "network",
  "timeout",
  "cancelled",
  "feature-disabled",
  "unsupported",
  "internal",
] as const;

export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number];

/**
 * A parsed command rejection. `code` is a bare `string`, not the union: a
 * backend newer than this bundle may send a code we do not know yet, and
 * pretending otherwise would be a lie the type system enforces.
 */
export interface CommandError {
  code: string;
  message: string;
  i18nKey?: string;
  detail?: Record<string, unknown>;
}

/** What the UI should DO about a failure — the branch callers actually need. */
export type CommandErrorClass =
  /** Repeating the same call may work: disk, network, deadline, stale state. */
  | "retryable"
  /** Blocked pending the user's decision; raise an approval and retry after. */
  | "needs-approval"
  /** Refused outright — no approval can lift it. */
  | "denied"
  /** The user stopped it. Not something to shout about. */
  | "cancelled"
  /** Turned off or not implemented here. */
  | "unavailable"
  /** Surface it. Also the fallback for anything unrecognised. */
  | "fatal";

const CLASS_BY_CODE: Record<CommandErrorCode, CommandErrorClass> = {
  "invalid-input": "fatal",
  "not-found": "fatal",
  "permission-denied": "denied",
  "approval-required": "needs-approval",
  conflict: "retryable",
  io: "retryable",
  network: "retryable",
  timeout: "retryable",
  cancelled: "cancelled",
  "feature-disabled": "unavailable",
  unsupported: "unavailable",
  internal: "fatal",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse an `invoke` rejection into a typed error, or `null` when it is not one
 * (a legacy `Result<T, String>` command, an `Error`, or anything else).
 */
export function parseCommandError(error: unknown): CommandError | null {
  if (!isRecord(error)) return null;
  const { code, message, i18nKey, detail } = error;
  if (typeof code !== "string" || typeof message !== "string") return null;
  return {
    code,
    message,
    ...(typeof i18nKey === "string" ? { i18nKey } : {}),
    ...(isRecord(detail) ? { detail } : {}),
  };
}

/**
 * Exact-code test. A legacy string that merely *contains* the code does not
 * match — that permissiveness is the defect this replaces.
 */
export function isCommandErrorCode(error: unknown, code: CommandErrorCode): boolean {
  return parseCommandError(error)?.code === code;
}

/** Read `detail.<key>` as a string, or `null` when absent or the wrong type. */
export function commandErrorDetailString(error: unknown, key: string): string | null {
  const value = parseCommandError(error)?.detail?.[key];
  return typeof value === "string" ? value : null;
}

/**
 * Map a rejection to what the UI should do. Anything unrecognised — an unknown
 * code, a legacy string, a thrown `Error`, `undefined` — is `fatal`, so a gap
 * surfaces the failure rather than silently retrying or swallowing it.
 */
export function classifyCommandError(error: unknown): CommandErrorClass {
  const code = parseCommandError(error)?.code;
  if (code === undefined) return "fatal";
  return CLASS_BY_CODE[code as CommandErrorCode] ?? "fatal";
}

/**
 * Human-readable text for ANY rejection shape. Replaces `errorMessage()` at
 * boundaries that can receive a typed error, where it produced the literal
 * string "[object Object]".
 */
export function commandErrorMessage(error: unknown): string {
  const parsed = parseCommandError(error);
  if (parsed) return parsed.message;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (isRecord(error)) {
    try {
      return JSON.stringify(error);
    } catch {
      /* v8 ignore next -- circular structures only; the fallthrough below covers it */
    }
  }
  return String(error);
}
