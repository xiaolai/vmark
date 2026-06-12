/**
 * MCP Bridge — duplicate request delivery guard (audit 20260612 H20).
 *
 * Purpose: Ensure each MCP request id EXECUTES at most once while keeping
 *   the bridge's wake-and-retry recovery working. The Rust bridge re-emits
 *   a request with the SAME id when the webview misses the first delivery
 *   (macOS App Nap); on wake BOTH the queued original and the retry event
 *   fire. Without dedup a non-idempotent write executes twice; with a
 *   silent drop the retry could starve the bridge's retry channel of its
 *   response (cross-model review finding).
 *
 * Key decisions:
 *   - Execute-once, respond-at-least-once: the first delivery executes;
 *     a duplicate of a COMPLETED request re-sends the cached response (the
 *     Rust side resolves whichever pending channel is current and ignores
 *     responses for unknown ids); a duplicate of an IN-FLIGHT request is
 *     dropped — its eventual respond() lands in the bridge's retry channel,
 *     which is installed before the webview is woken.
 *   - Bounded memory: insertion-ordered Map capped at 256 ids — far beyond
 *     the 20s retry window at any realistic request rate.
 *
 * @coordinates-with useMcpBridge.ts — consults this before dispatching
 * @coordinates-with utils.ts — respond() records completed responses here
 * @module hooks/mcpBridge/requestDedup
 */

import type { McpResponse } from "./types";

const CAPACITY = 256;

type RequestRecord =
  | { status: "in-flight" }
  | { status: "done"; response: McpResponse };

/** Insertion-ordered map of recently seen request ids. */
const records = new Map<string, RequestRecord>();

function evictIfNeeded(): void {
  if (records.size > CAPACITY) {
    const oldest = records.keys().next().value;
    /* v8 ignore next -- @preserve size > CAPACITY guarantees a key */
    if (oldest !== undefined) records.delete(oldest);
  }
}

/**
 * Classify a delivery of `id`:
 * - `"execute"` — first sighting; the caller should run the handler.
 * - `"drop"` — duplicate of an in-flight request; its respond() will reach
 *   the bridge when the original execution finishes.
 * - a cached McpResponse — duplicate of a completed request; the caller
 *   should re-send it so the bridge's retry channel gets an answer.
 */
export function classifyDelivery(id: string): "execute" | "drop" | McpResponse {
  const existing = records.get(id);
  if (existing === undefined) {
    records.set(id, { status: "in-flight" });
    evictIfNeeded();
    return "execute";
  }
  if (existing.status === "done") return existing.response;
  return "drop";
}

/** Record the response sent for a request id (called from respond()). */
export function recordResponse(response: McpResponse): void {
  // Only track ids we saw arrive through the dispatcher; respond() is also
  // used by paths that never went through classifyDelivery.
  if (!records.has(response.id)) return;
  records.set(response.id, { status: "done", response });
}

/** Reset the dedup window. Test-only. */
export function resetRequestDedup(): void {
  records.clear();
}
