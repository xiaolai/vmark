/**
 * browserFailure — how a Rust browser refusal reaches its two audiences (WI-14).
 *
 * Purpose: the MCP browser handlers have to answer two different questions
 * about one rejection — "should VMark raise an approval prompt?" and "what
 * token does the AI client see?" — and before `CommandError` both were answered
 * by matching text.
 *
 * @coordinates-with src-tauri/src/browser/ai_guards.rs — the producer
 * @coordinates-with services/mcpBridge/v2/bridgeError — the one token derivation
 * @module services/mcpBridge/v2/browserFailure
 */
import { parseCommandError } from "@/services/commands/commandError";
import { bridgeErrorToken } from "./bridgeError";

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
  // Transitional, and its stated precondition has now MOVED. The comment here
  // used to name "the unmigrated human `browser_create` path" — that path is
  // typed as of WI-DP2.1, and a sweep of `src-tauri/src/browser/` finds no
  // remaining producer of a bare `APPROVAL_REQUIRED` string.
  //
  // It is kept anyway, deliberately: the CommandError ratchet is not at zero, a
  // grep is weaker evidence than a gate, and the cost of being wrong here is
  // asymmetric — losing this line turns "ask the user" into "fail silently" on a
  // security path. Delete it when `pnpm lint:command-errors` reports 0, which is
  // the condition that makes the sweep an invariant rather than an observation.
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
  return bridgeErrorToken(error) ?? String(error);
}
