/**
 * useMcpConnectionReads — drops an MCP client's tracked reads when its
 * bridge connection closes or the bridge stops.
 *
 * Purpose: React adapter over `services/mcpBridge/connectionClosed.ts`. Each
 *   window tracks the reads it served per connection; this keeps that state
 *   from outliving the clients that made it.
 *
 * Key decisions:
 *   - Mounted once per document window, beside `useMcpBridge`: every window
 *     that can serve a read hears the close (Rust broadcasts it).
 *   - Listener registration is async; `safeUnlistenAsync` removes a listener
 *     that resolves after unmount (React Strict Mode).
 *   - A failed registration is retried while mounted, with bounded backoff
 *     (`REGISTER_RETRY_DELAYS_MS`), then given up loudly: a permanent no-op
 *     would let read partitions outlive their clients unnoticed.
 *
 * @coordinates-with services/mcpBridge/connectionClosed.ts — the handlers
 * @coordinates-with hooks/lifecycle/useWindowLifecycle.ts — where it mounts
 * @module hooks/useMcpConnectionReads
 */

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { handleMcpBridgeStopped, handleMcpConnectionClosed } from "@/services/mcpBridge/connectionClosed";
import { safeUnlistenAsync } from "@/utils/safeUnlisten";
import { mcpBridgeError } from "@/utils/debug";

/** Waits between registration attempts; bounded, so a bridge that never comes up stops costing anything. */
export const REGISTER_RETRY_DELAYS_MS: readonly number[] = [250, 1000, 4000];

const noop = () => {};
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Listen while `mounted()`, retrying a failed registration with backoff.
 * Every failure is logged; the last one says the window gave up, since its
 * read partitions then go only by the connection cap.
 */
async function register(event: string, handler: (payload: unknown) => void, mounted: () => boolean): Promise<() => void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await listen(event, (e) => handler(e.payload));
    } catch (error: unknown) {
      const delay = REGISTER_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        mcpBridgeError(`Giving up registering ${event} after ${attempt + 1} attempts:`, error);
        return noop;
      }
      mcpBridgeError(`Failed to register ${event} listener:`, error);
      await sleep(delay);
      if (!mounted()) return noop;
    }
  }
}

/** Drop a client's tracked reads when its connection closes. */
export function useMcpConnectionReads(): void {
  useEffect(() => {
    let mounted = true;
    const isMounted = () => mounted;
    const closed = register("mcp-bridge:connection-closed", handleMcpConnectionClosed, isMounted);
    const stopped = register("mcp-server:stopped", () => handleMcpBridgeStopped(), isMounted);
    return () => {
      mounted = false;
      safeUnlistenAsync(closed);
      safeUnlistenAsync(stopped);
    };
  }, []);
}
