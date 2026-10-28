/**
 * MCP bridge listener store — whether THIS window's `mcp-bridge:request`
 * listener is registered, so the status bar can warn when the window cannot
 * answer AI requests.
 *
 * Key decisions:
 *   - Window-local by construction: each webview has its own JS context and
 *     so its own store. Rust's server status cannot say whether this window
 *     dispatches; this store can.
 *   - Stored state, not an event: a warning mounted after registration gave
 *     up still reads `failed`, whatever the mount order.
 *   - `registering` covers both the first attempt and the retry backoff; only
 *     `failed` (every attempt spent) is worth a warning.
 *
 * @coordinates-with hooks/useMcpBridge.ts — the only writer
 * @coordinates-with components/StatusBar/McpBridgeListenerWarning.tsx — shows `failed`
 * @module stores/mcpBridgeListenerStore
 */

import { create } from "zustand";

type McpBridgeListenerStatus = "registering" | "listening" | "failed";

interface McpBridgeListenerState {
  status: McpBridgeListenerStatus;
  setStatus: (status: McpBridgeListenerStatus) => void;
}

export const useMcpBridgeListenerStore = create<McpBridgeListenerState>()((set) => ({
  status: "registering",
  setStatus: (status) => set({ status }),
}));
