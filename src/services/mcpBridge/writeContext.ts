/**
 * MCP write context — who is behind one bridge request, frozen once and
 * handed to every handler that changes a document.
 *
 * Purpose: the router builds one `McpWriteContext` per request from the
 *   request's validated attribution and threads it through `dispatchV2` to
 *   the document mutators, so a write is recorded under the principal and
 *   connection that made it: a journaled edit files its attribution as the
 *   journal actor (`v2/journaledEdit.ts`).
 *
 * Key decisions:
 *   - Built from the attribution by re-running `parseMcpAttribution`, which
 *     returns a fresh deep-frozen copy: the context never aliases the event,
 *     and an event assembled without the hook's validation (a test, a future
 *     caller) cannot smuggle in a mutable or malformed principal.
 *   - An attribution that does not validate THROWS. There is no default
 *     principal: an unattributable write must fail, not be filed under
 *     someone.
 *   - One context per request, even on the same connection (the connection
 *     id is shared). It carries only who is writing: the request id and the
 *     operation reach each handler as its own arguments.
 *
 * @coordinates-with services/mcpBridge/attribution.ts — the validator and the frozen attribution
 * @coordinates-with services/mcpBridge/handleRequest.ts — the one builder
 * @coordinates-with services/mcpBridge/v2/dispatch.ts — threads it to the handlers
 * @module services/mcpBridge/writeContext
 */

import { parseMcpAttribution } from "./attribution";
import type { McpAttribution, McpRequestEvent } from "./types";

/** Who is behind one bridge request. Deep-frozen; never edited after build. */
export interface McpWriteContext {
  /** Principal and connection (established), label and name (untrusted). */
  readonly attribution: McpAttribution;
}

/**
 * Build the write context for one request. Throws when the request's
 * attribution does not validate, naming the request.
 */
export function createMcpWriteContext(event: McpRequestEvent): McpWriteContext {
  const attribution = parseMcpAttribution(event.attribution);
  if (attribution === null) {
    throw new Error(`MCP request ${event.id} carries no valid attribution`);
  }
  return Object.freeze({ attribution });
}
