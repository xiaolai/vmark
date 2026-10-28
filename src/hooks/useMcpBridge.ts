/**
 * MCP Bridge Hook — entry point.
 *
 * Purpose: Listens for `mcp-bridge:request` events from the Rust MCP server
 *   and forwards each request to `handleRequest`, which routes it through the
 *   pruned 5-tool v2 surface.
 *
 * Pipeline: AI client → MCP server (Rust) → WebSocket → Tauri event
 *   "mcp-bridge:request" → useMcpBridge parses args_json → handleRequest →
 *   dispatchV2 → tool handler → respond() back to Rust → MCP server → AI client
 *
 * Key decisions:
 *   - `processMcpRequest` takes each event payload from validation to
 *     dispatch; it parses `args_json` (handling Tauri's snake_case/camelCase
 *     IPC quirk) before forwarding to handleRequest.
 *   - Every request carries an `attribution` (principal, connection id,
 *     untrusted labels) validated by parseMcpAttribution; one that does not
 *     parse is refused with success:false, never dispatched under a default
 *     principal.
 *   - Duplicate deliveries of the same request id (Rust wake-and-retry)
 *     are dropped via requestDedup before dispatch — first sighting wins.
 *   - handleRequest applies the read-only guard (READ_ONLY_BLOCKED +
 *     isActiveDocReadOnly()), then routes through dispatchV2 — the pruned
 *     5-tool surface (vmark.session / workspace / document / workflow /
 *     selection).
 *   - The listener is scoped to this webview window. Rust sends each request
 *     to the one window it routed it to; a global `listen` matches every
 *     target, so every open window would run the request and the client would
 *     get whichever answer came first.
 *   - On mount the hook sends a 5-second `mcp_bridge_heartbeat` so the Rust
 *     side can tell the webview is alive under macOS App Nap.
 *   - Listener registration is async; mounted-state tracking handles React
 *     Strict Mode double-mount without leaking listeners.
 *   - A refused registration is retried with doubling backoff
 *     (`LISTEN_RETRY_MS`, `LISTEN_ATTEMPTS` in all). After the last attempt the
 *     failure is logged as fatal and the heartbeat stops: a webview that
 *     cannot serve a request must not keep reporting itself alive.
 *   - The registration's state goes to `mcpBridgeListenerStore`
 *     (registering → listening | failed), window-local and stored, so the
 *     status bar warns after exhaustion whenever it mounts. Cleanup resets it
 *     to `registering`; a discarded mount (Strict Mode) never writes after its
 *     cleanup, so the live mount alone decides the health.
 *
 * @coordinates-with src-tauri/src/mcp_bridge/live_emit.rs — the window-targeted send
 * @coordinates-with services/mcpBridge/handleRequest.ts — read-only guard + v2 routing
 * @coordinates-with services/mcpBridge/v2/dispatch.ts — dispatchV2, the 5-tool dispatcher
 * @coordinates-with services/mcpBridge/utils.ts — respond()
 * @coordinates-with services/mcpBridge/types.ts — McpRequestEvent, McpRequestEventRaw
 * @coordinates-with services/mcpBridge/attribution.ts — parseMcpAttribution
 * @coordinates-with stores/mcpBridgeListenerStore.ts — this window's listener health
 * @module hooks/useMcpBridge
 */

import { useEffect } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import type { McpRequestEvent, McpRequestEventRaw } from "@/services/mcpBridge/types";
import { respond } from "@/services/mcpBridge/utils";
import { mcpBridgeLog, mcpBridgeError } from "@/utils/debug";
import { handleRequest } from "@/services/mcpBridge/handleRequest";
import { parseMcpAttribution } from "@/services/mcpBridge/attribution";
import { classifyDelivery } from "@/services/mcpBridge/requestDedup";
import { useMcpBridgeListenerStore } from "@/stores/mcpBridgeListenerStore";

/** Runtime shape guard for the externally-driven MCP request payload.
 *  Exported for testing. */
export function isValidMcpRequestRaw(raw: unknown): raw is McpRequestEventRaw {
  return (
    typeof raw === "object" &&
    raw !== null &&
    typeof (raw as { id?: unknown }).id === "string" &&
    typeof (raw as { type?: unknown }).type === "string"
  );
}

/** Answer a request that cannot be dispatched, logging a failed reply. */
function refuse(id: string, error: string, context: string): void {
  respond({ id, success: false, error }).catch((err) => {
    mcpBridgeError(`Failed to respond to ${context}:`, err);
  });
}

/**
 * Take one `mcp-bridge:request` payload from validation to dispatch:
 * shape check, duplicate-delivery handling, attribution, args parsing,
 * then `handleRequest`. Every failure is answered or logged here; nothing
 * is thrown.
 */
function processMcpRequest(raw: unknown): void {
  // Zero-trust at the externally-driven MCP request boundary: the payload is
  // read off an IPC event whose shape is only typed at compile time. Validate
  // `id`/`type` are strings before use so a malformed payload is dropped
  // loudly rather than propagating `undefined` into a handler (and an
  // undefined id can't even be replied to).
  if (!isValidMcpRequestRaw(raw)) {
    mcpBridgeError("Dropping malformed MCP request payload:", raw);
    return;
  }

  mcpBridgeLog("Event received:", raw.type, raw.id);

  // The Rust bridge's App Nap wake-and-retry re-emits the SAME request id;
  // on wake both deliveries fire. Execute only the first; re-send the cached
  // response for duplicates of completed requests so the bridge's retry
  // channel always gets an answer.
  const delivery = classifyDelivery(raw.id);
  if (delivery === "drop") {
    mcpBridgeLog("Dropping duplicate in-flight MCP delivery:", raw.type, raw.id);
    return;
  }
  if (delivery !== "execute") {
    mcpBridgeLog("Re-sending cached response for duplicate delivery:", raw.type, raw.id);
    respond(delivery).catch((err) => {
      mcpBridgeError("Failed to re-send cached response:", err);
    });
    return;
  }

  // Who sent it. Rust always attaches this; a request without a valid one
  // is a protocol defect, answered rather than attributed to a default.
  const attribution = parseMcpAttribution(raw.attribution);
  if (attribution === null) {
    mcpBridgeError("Refusing MCP request with invalid attribution:", raw.id);
    refuse(raw.id, "Invalid request attribution", "unattributed request");
    return;
  }

  // Try both snake_case and camelCase (Tauri might convert)
  const argsJsonStr = raw.args_json ?? raw.argsJson ?? "{}";
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJsonStr);
  } catch {
    refuse(raw.id, "Invalid JSON in request args", "malformed request");
    return;
  }

  const parsed: McpRequestEvent = { id: raw.id, type: raw.type, args, attribution };
  // Fire-and-forget with error logging to prevent unhandled rejections
  handleRequest(parsed).catch((err) => {
    mcpBridgeError("Unhandled error in request handler:", err);
  });
}

/** First retry delay for a refused request-listener registration; doubles each time. */
export const LISTEN_RETRY_MS = 500;
/** Registration attempts before the bridge gives up (the first one included). */
export const LISTEN_ATTEMPTS = 6;

/**
 * Hook to enable MCP bridge request handling.
 * Should be used once in the main app component.
 *
 * Note: Properly handles React Strict Mode double-mount by tracking
 * mounted state and cleaning up async listener registration.
 */
export function useMcpBridge(): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let mounted = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const { setStatus } = useMcpBridgeListenerStore.getState();
    setStatus("registering");

    // Send heartbeat every 5 seconds to track webview health.
    // Lets the Rust side know the webview JS event loop is alive,
    // which is important when macOS App Nap suspends the webview.
    const heartbeatInterval = setInterval(() => {
      invoke("mcp_bridge_heartbeat").catch(() => {
        // Ignore errors — bridge may not be running
      });
    }, 5000);

    // @edge-case A refused registration (a transient IPC failure) is retried
    // with backoff; once every attempt is spent the webview cannot serve a
    // request, so it says so and stops the heartbeat rather than look alive.
    const register = (attempt: number): void => {
      getCurrentWebviewWindow()
        .listen<McpRequestEventRaw>("mcp-bridge:request", (event) => processMcpRequest(event.payload))
        .then((fn) => {
          // If unmounted before Promise resolved, clean up immediately
          if (!mounted) {
            fn();
            return;
          }
          unlisten = fn;
          setStatus("listening");
        })
        .catch((err: unknown) => {
          if (!mounted) return;
          mcpBridgeError("Failed to register event listener:", err);
          if (attempt + 1 >= LISTEN_ATTEMPTS) {
            mcpBridgeError("MCP bridge cannot serve requests: the request listener never registered:", err);
            clearInterval(heartbeatInterval);
            setStatus("failed");
            return;
          }
          retry = setTimeout(() => register(attempt + 1), LISTEN_RETRY_MS * 2 ** attempt);
        });
    };
    register(0);

    return () => {
      mounted = false;
      clearTimeout(retry);
      unlisten?.();
      clearInterval(heartbeatInterval);
      setStatus("registering");
    };
  }, []);
}
