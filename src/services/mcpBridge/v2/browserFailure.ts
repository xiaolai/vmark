/**
 * browserFailure — how a Rust browser refusal reaches its two audiences (WI-14).
 *
 * Purpose: the MCP browser handlers have to answer two different questions
 * about one rejection — "should VMark raise an approval prompt?" and "what
 * token does the AI client see?" — and before `CommandError` both were answered
 * by matching text.
 *
 * Key decisions:
 *   - **The approval question is decided by CODE alone; there is no text
 *     fallback.** One survived the migration for untyped rejections, "until the
 *     CommandError ratchet reaches zero for the browser producers". It has
 *     (round 4, #48): every `#[tauri::command]` under `src-tauri/src/browser/`
 *     returns `CommandError` and `scripts/command-error-baseline.json` carries no
 *     entry for that directory, so an untyped rejection can no longer BE an
 *     approval. What still arrives untyped is the webview's own plumbing
 *     (`TAB_DESTROYING`, an `Error` from a dead IPC channel) or caller-controlled
 *     text, and prompting for those would ask the user to approve something no
 *     approval can lift.
 *
 * @coordinates-with src-tauri/src/browser/ai_guards.rs — the producer
 * @coordinates-with services/commands/commandError — `isCommandErrorCode`, the exact-code test
 * @coordinates-with services/mcpBridge/v2/bridgeError — the one token derivation
 * @module services/mcpBridge/v2/browserFailure
 */
import { isCommandErrorCode } from "@/services/commands/commandError";
import { bridgeErrorEnvelope, bridgeErrorToken } from "./bridgeError";

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
  return isCommandErrorCode(error, "approval-required");
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
  // An UNTYPED object rejection has no token; its message is still the useful
  // part, and `String(object)` would print "[object Object]" (the WI-14 class).
  return bridgeErrorToken(error) ?? bridgeErrorEnvelope(error).error;
}
