/**
 * MCP Bridge — duplicate request delivery guard (audit H20).
 *
 * Purpose: Drop re-deliveries of the same MCP request id. The Rust bridge
 *   re-emits a request with the SAME id when the webview misses the first
 *   delivery (macOS App Nap wake-and-retry, server.rs). On wake, BOTH the
 *   queued original and the retry event are delivered — without dedup a
 *   non-idempotent write (e.g. selection.set without expected_revision)
 *   executes twice.
 *
 * Key decisions:
 *   - First sighting wins: the id is recorded before execution, so whichever
 *     delivery runs first executes and the other is dropped silently. The
 *     Rust side keeps one pending entry per id, so a single respond() is
 *     exactly what it expects.
 *   - Bounded memory: insertion-ordered Set capped at 256 ids — far beyond
 *     the 20s retry window at any realistic request rate.
 *
 * @coordinates-with index.ts — calls shouldProcessRequest before handleRequest
 * @module hooks/mcpBridge/requestDedup
 */

const CAPACITY = 256;

/** Insertion-ordered set of recently seen request ids. */
const seen = new Set<string>();

/**
 * Record a request id and report whether this delivery should execute.
 * Returns false for a duplicate delivery of an already-seen id.
 */
export function shouldProcessRequest(id: string): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > CAPACITY) {
    const oldest = seen.values().next().value;
    /* v8 ignore next -- @preserve size > CAPACITY guarantees a value */
    if (oldest !== undefined) seen.delete(oldest);
  }
  return true;
}

/** Reset the dedup window. Test-only. */
export function resetRequestDedup(): void {
  seen.clear();
}
