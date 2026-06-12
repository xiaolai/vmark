/**
 * MCP Bridge Utilities
 *
 * Purpose: Shared helper for all MCP bridge handlers — send a response back to
 *   the Rust bridge. The v1 text-match / editor / window helpers that used to
 *   live here were superseded by `mcpBridge/v2/` and removed (WI-0.7/WI-1.4);
 *   `respond` is the only still-live export (used by handleRequest.ts and the
 *   v2 handlers).
 *
 * Key decisions:
 *   - respond() sends result back to Rust via invoke (not emit) for reliability.
 *
 * @module hooks/mcpBridge/utils
 */

import { invoke } from "@tauri-apps/api/core";
import type { McpResponse } from "./types";
import { mcpBridgeLog, mcpBridgeError } from "@/utils/debug";
import { recordResponse } from "./requestDedup";

/**
 * Send response back to the MCP bridge.
 */
export async function respond(response: McpResponse): Promise<void> {
  mcpBridgeLog("Sending response:", response.id, response.success);
  // Cache for duplicate-delivery re-send (wake-and-retry; audit 20260612).
  recordResponse(response);
  try {
    await invoke("mcp_bridge_respond", { payload: response });
  } catch (error) {
    mcpBridgeError("Failed to send response:", error);
  }
}
