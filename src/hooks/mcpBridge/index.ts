/**
 * MCP Bridge Hook — entry point.
 *
 * Purpose: Listens for mcp-bridge:request events from the Rust MCP server and
 *   routes each request to the category sub-dispatchers in `dispatchers/` via
 *   `handleRequest`. Blocks editor-dependent tools in source mode via
 *   sourceModeGuard.
 *
 * Pipeline: AI client → MCP server (Rust) → WebSocket → Tauri event
 *   "mcp-bridge:request" → source mode guard → handleRequest → category
 *   sub-dispatcher → handler function → respond() back to Rust → MCP server
 *   → AI client
 *
 * Key decisions:
 *   - The route table is split across category sub-dispatchers (document,
 *     editor, workspace, insert, aiMcp) in `dispatchers/`.
 *   - Handlers organized by domain: document, selection, mutation, structure, etc.
 *   - All mutations wrapped in AI suggestion layer for user approval.
 *   - Idempotency cache prevents duplicate execution of identical requests.
 *   - Source mode guard blocks editor-dependent tools before sub-dispatchers run.
 *
 * @coordinates-with handleRequest.ts — guards + dispatcher chain
 * @coordinates-with utils.ts — respond(), getEditor(), resolveWindowId()
 * @coordinates-with types.ts — McpRequestEvent, McpResponse
 * @module hooks/mcpBridge
 */

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { McpRequestEvent, McpRequestEventRaw } from "./types";
import { respond } from "./utils";
import { mcpBridgeLog, mcpBridgeError } from "@/utils/debug";
import { handleRequest } from "./handleRequest";
import { hydrateCheckpoints } from "@/stores/mcpCheckpointPersistence";

/**
 * Hook to enable MCP bridge request handling.
 * Should be used once in the main app component.
 *
 * Note: Properly handles React Strict Mode double-mount by tracking
 * mounted state and cleaning up async listener registration.
 */
export function useMcpBridge(): void {
  useEffect(() => {
    // Load persisted checkpoint history. Fire-and-forget — failures
    // are logged inside the persistence module and never block.
    void hydrateCheckpoints();

    let unlisten: (() => void) | undefined;
    let mounted = true;

    // Send heartbeat every 5 seconds to track webview health.
    // Lets the Rust side know the webview JS event loop is alive,
    // which is important when macOS App Nap suspends the webview.
    const heartbeatInterval = setInterval(() => {
      invoke("mcp_bridge_heartbeat").catch(() => {
        // Ignore errors — bridge may not be running
      });
    }, 5000);

    listen<McpRequestEventRaw>("mcp-bridge:request", (event) => {
      // Parse args_json to avoid Tauri IPC double-encoding issues
      const raw = event.payload;

      mcpBridgeLog("Event received:", raw.type, raw.id);

      // Try both snake_case and camelCase (Tauri might convert)
      const argsJsonStr = raw.args_json ?? raw.argsJson ?? "{}";

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(argsJsonStr);
      } catch {
        // Malformed JSON - respond with error (fire-and-forget with error logging)
        respond({
          id: raw.id,
          success: false,
          error: "Invalid JSON in request args",
        }).catch((err) => {
          mcpBridgeError("Failed to respond to malformed request:", err);
        });
        return;
      }

      const parsed: McpRequestEvent = {
        id: raw.id,
        type: raw.type,
        args,
      };
      // Fire-and-forget with error logging to prevent unhandled rejections
      handleRequest(parsed).catch((err) => {
        mcpBridgeError("Unhandled error in request handler:", err);
      });
    }).then((fn) => {
      // If unmounted before Promise resolved, clean up immediately
      if (!mounted) {
        fn();
        return;
      }
      unlisten = fn;
    }).catch((err) => {
      mcpBridgeError("Failed to register event listener:", err);
    });

    return () => {
      mounted = false;
      unlisten?.();
      clearInterval(heartbeatInterval);
    };
  }, []);
}
