/**
 * MCP coherence actor — the ledger `agent` an MCP client's write is recorded
 * under, derived from the connection that made the request.
 *
 * Purpose: the coherence ledger's agent is `{ type, id }`. An MCP write used
 *   to be filed under one shared id for every client, so two agents' writes
 *   were indistinguishable. The id now encodes the real actor: the
 *   credential-derived principal, the connection, and the session label.
 *
 * Key decisions:
 *   - The id is `mcp;principal=<p>;connection=<uuid>[;session=<label>]`, where
 *     `<p>` is `anonymous`, `unrecognized`, `ambiguous:<id>,<id>…` or
 *     `provider:<id>`. The four principal states stay distinct — none is
 *     collapsed into another or into an "unknown".
 *   - Every client-influenced value (provider ids, the session label) is
 *     percent-encoded, so `;`, `=`, `:` and `,` inside one can never forge a
 *     segment: a label cannot pose as a principal or a connection.
 *   - No session label omits the segment; an empty label keeps it, empty.
 *     The display name is NOT part of the id: it is untrusted and is kept
 *     apart from the principal.
 *   - The ledger schema is unchanged: the coherence ledger is an optional
 *     projection, and the edit journal records the structured actor.
 *
 * @coordinates-with services/coherence/mcpCapture.ts — the one caller
 * @coordinates-with services/mcpBridge/attribution.ts — the validated attribution it encodes
 * @module services/coherence/mcpActor
 */

import type { McpAttribution, McpPrincipal } from "@/services/mcpBridge/types";

/** The coherence ledger agent of one MCP write. */
export interface McpCoherenceAgent {
  readonly type: "model";
  readonly id: string;
}

function principalSegment(principal: McpPrincipal): string {
  switch (principal.kind) {
    case "anonymous":
    case "unrecognized":
      return principal.kind;
    case "ambiguous":
      return `ambiguous:${principal.providers.map(encodeURIComponent).join(",")}`;
    case "provider":
      return `provider:${encodeURIComponent(principal.providerId)}`;
  }
}

/** The ledger agent for a write made under `attribution`. */
export function mcpCoherenceAgent(attribution: McpAttribution): McpCoherenceAgent {
  const session =
    attribution.sessionLabel === null ? "" : `;session=${encodeURIComponent(attribution.sessionLabel)}`;
  return {
    type: "model",
    id: `mcp;principal=${principalSegment(attribution.principal)};connection=${attribution.connectionId}${session}`,
  };
}
