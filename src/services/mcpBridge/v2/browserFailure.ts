/**
 * browserFailure — how a Rust browser refusal reaches its two audiences (WI-14).
 *
 * Purpose: the MCP browser handlers have to answer two different questions
 * about one rejection — "should VMark raise an approval prompt?" and "what
 * token does the AI client see?" — and before `CommandError` both were answered
 * by matching text.
 *
 * @coordinates-with src-tauri/src/browser/ai_guards.rs — the producer
 * @module services/mcpBridge/v2/browserFailure
 */
import { parseCommandError } from "@/services/commands/commandError";

/**
 * Does this refusal mean "ask the user, then retry"? (WI-14)
 *
 * This replaced `String(error).includes("APPROVAL_REQUIRED")` at four sites.
 * The substring form fired on any payload carrying that token — including a URL
 * the caller passed — and stopped firing the moment anyone reworded the
 * message. It also could not tell `approval-required` from `permission-denied`,
 * which is the difference between raising a prompt and refusing outright: no
 * user approval can lift an SSRF block.
 */
export function needsNavigationApproval(error: unknown): boolean {
  const parsed = parseCommandError(error);
  if (parsed) return parsed.code === "approval-required";
  // Transitional: the unmigrated human `browser_create` path still rejects with
  // the bare token. Remove with the last entry in the CommandError ratchet.
  return String(error).includes("APPROVAL_REQUIRED");
}

/**
 * The error token the MCP client sees.
 *
 * `code` is VMark's internal class; the MCP tool protocol has its own,
 * finer-grained vocabulary that predates WI-14 and that shipped clients match
 * on, so Rust carries it in `detail.mcpCode`. Without this, `String(error)` on
 * a typed rejection would have sent the AI the literal text "[object Object]".
 */
export function browserFailureToken(error: unknown): string {
  const parsed = parseCommandError(error);
  if (!parsed) return String(error);
  const token = parsed.detail?.mcpCode;
  if (typeof token === "string") return token;
  return parsed.code.toUpperCase().replace(/-/g, "_");
}

