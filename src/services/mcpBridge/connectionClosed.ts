/**
 * MCP connection close — drops the per-connection state the webview keeps
 * for a client once the bridge says that client's connection is gone.
 *
 * Purpose: the read set a client builds (documents read since its last write,
 *   `services/coherence/mcpCapture.ts`) is keyed by its connection id. Rust
 *   announces every closed connection, and a stopped bridge closes them all;
 *   both land here so no partition outlives its client.
 *
 * Key decisions:
 *   - The payload crosses IPC typed only at compile time, so it is validated:
 *     an own `connectionId` in the exact form Rust sends. Anything else is
 *     logged and refused, and drops nobody's reads.
 *   - A close for a connection that never read anything is accepted and is a
 *     no-op.
 *
 * @coordinates-with src-tauri/src/mcp_bridge/connection_closed.rs — the announcement
 * @coordinates-with services/coherence/mcpCapture.ts — the read sets dropped
 * @coordinates-with hooks/useMcpConnectionReads.ts — the listener
 * @module services/mcpBridge/connectionClosed
 */

import { dropAllMcpConnectionReads, dropMcpConnectionReads } from "@/services/coherence/mcpCapture";
import { mcpBridgeError } from "@/utils/debug";
import { isMcpConnectionId } from "./attribution";

/**
 * Handle one `mcp-bridge:connection-closed` payload. Returns whether it was
 * valid (and the connection's reads were dropped).
 */
export function handleMcpConnectionClosed(payload: unknown): boolean {
  const connectionId =
    typeof payload === "object" && payload !== null && Object.hasOwn(payload, "connectionId")
      ? (payload as { connectionId: unknown }).connectionId
      : undefined;
  if (!isMcpConnectionId(connectionId)) {
    mcpBridgeError("Ignoring malformed connection-closed payload:", payload);
    return false;
  }
  dropMcpConnectionReads(connectionId);
  return true;
}

/** The bridge stopped: every connection is closed. */
export function handleMcpBridgeStopped(): void {
  dropAllMcpConnectionReads();
}
