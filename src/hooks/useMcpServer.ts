/**
 * MCP Bridge Control Hook
 *
 * Purpose: React state and controls for the VMark MCP bridge (WebSocket server) —
 *   start/stop/restart the bridge, track running state and port, listen for
 *   status change events from Rust.
 *
 * Key decisions:
 *   - AI clients spawn their own sidecars that connect to this bridge
 *   - Bridge runs in Rust process, frontend only controls and monitors
 *   - Port reported back to frontend for display and sidecar config
 *   - Lifecycle operations (start, stop, refresh) run one at a time, in the
 *     order issued (audit #382): Rust sees them in that order, and an older
 *     completion can never land on top of a newer one. `loading` stays on
 *     until the LAST pending mutation settles.
 *   - Events from Rust bypass the queue — they report transitions that have
 *     already happened — and either direction clears a stale error (#385).
 *     They are the source of truth: a command's returned status is a snapshot
 *     taken before the response travelled, and responses and events reach the
 *     webview on different channels with no ordering between them, so a
 *     snapshot that raced an event is older than what the event wrote and is
 *     dropped (#382).
 *   - The frontend CANNOT order an event against a command response, and does
 *     not need to (#382, round 3). Two facts about `mcp_server.rs` carry it:
 *     every bridge transition emits (`announce_started` on the last line of
 *     `mcp_bridge_start`; `mcp_bridge_stop` emits before its `Ok`), and both
 *     emits go out BEFORE their command returns, on one ordered channel. So
 *     the last event delivered is the freshest thing Rust has announced, and a
 *     DELAYED event that overwrites a newer command result is itself followed
 *     by that command's own event. The state converges with no version on the
 *     wire — pinned by "converges on the LAST event delivered" in the test.
 *
 *     The residual, stated rather than hidden: for the length of the event
 *     channel's delivery lag the hook can show the older announcement, and if
 *     an `app.emit` ever fails (Rust swallows it with `let _ =`) the value
 *     stays stale until the next `refresh()`. Closing either one means putting
 *     a sequence number on the event — a Rust change, not a frontend one.
 *   - The listeners are live BEFORE the first status read (audit #384), so no
 *     transition can fall between the snapshot and the subscription.
 *
 * @coordinates-with useMcpAutoStart.ts — auto-starts on app launch
 * @coordinates-with useMcpHealthCheck.ts — health check runs through this hook
 * @module hooks/useMcpServer
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { safeUnlistenAsync } from "@/utils/safeUnlisten";
import { commandErrorMessage } from "@/services/commands/commandError";

interface McpServerStatus {
  running: boolean;
  port: number | null;
}

/**
 * A bound TCP port, or null when the payload is not one (audit #749).
 *
 * `mcp-server:started` carries a `u16` from `announce_started`, so anything
 * else is a broken contract rather than a value to display. The old check —
 * `typeof payload === "number"` — accepted `0`, `-1`, `3.5` and `70000` as
 * ports, and any non-number silently became `{ running: true, port: null }`:
 * a pair the interface above says cannot exist ("null if not running"), which
 * the panel then shows as a running bridge with no address.
 */
function portFromPayload(payload: unknown): number | null {
  return typeof payload === "number" &&
    Number.isInteger(payload) &&
    payload > 0 &&
    payload <= 65535
    ? payload
    : null;
}

interface UseMcpServerResult {
  /** Whether the server is currently running */
  running: boolean;
  /** The actual port the bridge is running on (null if not running) */
  port: number | null;
  /** Whether an operation is in progress */
  loading: boolean;
  /** Error message if the last operation failed */
  error: string | null;
  /** Start the MCP bridge (port is auto-assigned) */
  start: () => Promise<void>;
  /** Stop the MCP bridge */
  stop: () => Promise<void>;
  /**
   * Refresh the bridge status. Resolves with the status as the hook now knows
   * it — the fetched snapshot, or the newer event-derived state that superseded
   * it (#382) — or null on error.
   */
  refresh: () => Promise<McpServerStatus | null>;
}

/**
 * Hook to control the VMark MCP bridge.
 *
 * The bridge is a WebSocket server that AI client sidecars connect to.
 * VMark only starts the bridge; AI clients spawn their own sidecars.
 *
 * The port is automatically assigned by the OS and written to the app data
 * directory (mcp-port file) for sidecar discovery. Users don't need to configure it.
 *
 * Usage:
 * ```tsx
 * const { running, port, loading, error, start, stop } = useMcpServer();
 *
 * // Start the bridge (port auto-assigned)
 * await start();
 *
 * // Stop the bridge
 * await stop();
 * ```
 */
export function useMcpServer(): UseMcpServerResult {
  const [running, setRunning] = useState(false);
  const [port, setPort] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The tail of the operation queue: each operation waits for the previous to settle.
  const tail = useRef<Promise<void>>(Promise.resolve());
  // Mutations requested but not yet settled; `loading` is on while this is non-zero.
  const pendingMutations = useRef(0);
  // Bumped by every event from Rust: a command whose response arrives under a
  // later epoch raced an event and carries an older snapshot (#382).
  const eventEpoch = useRef(0);
  // The status this hook currently believes — what a superseded refresh resolves with.
  const known = useRef<McpServerStatus>({ running: false, port: null });

  /** Run `operation` after every operation queued before it has settled. */
  const serialized = useCallback(<T>(operation: () => Promise<T>): Promise<T> => {
    const run = tail.current.then(operation);
    tail.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  const applyStatus = useCallback((status: McpServerStatus) => {
    known.current = status;
    setRunning(status.running);
    setPort(status.port);
  }, []);

  /** Adopt a command's returned status unless an event landed while it was in flight; returns what is known now. */
  const adopt = useCallback(
    (epochAtRequest: number, status: McpServerStatus): McpServerStatus => {
      if (epochAtRequest === eventEpoch.current) applyStatus(status);
      return known.current;
    },
    [applyStatus],
  );

  // Fetch the bridge status. Returns it for callers that need fresh values.
  const refresh = useCallback(
    () =>
      serialized(async (): Promise<McpServerStatus | null> => {
        const epoch = eventEpoch.current;
        try {
          const status = adopt(epoch, await invoke<McpServerStatus>("mcp_server_status"));
          setError(null);
          return status;
        } catch (err) {
          setError(commandErrorMessage(err));
          return null;
        }
      }),
    [adopt, serialized],
  );

  // One bridge mutation (audit #383): loading on until the last pending one
  // settles, the previous error cleared, the reported status adopted, and a
  // failure recorded then rethrown so the caller can react. The command
  // literal stays at each call site so the IPC-contract gate can still
  // resolve it against the Rust handler.
  const runBridgeCommand = useCallback(
    (request: () => Promise<McpServerStatus>) => {
      pendingMutations.current += 1;
      setLoading(true);
      setError(null);
      return serialized(async () => {
        const epoch = eventEpoch.current;
        try {
          adopt(epoch, await request());
          // Cleared on SUCCESS, not only on enqueue (audit #748). The clear
          // above happens when a command joins the queue, so an earlier queued
          // command that fails AFTER a later one was enqueued leaves its error
          // on screen over the later command's success — the bridge stopped,
          // the last thing the user did worked, and the panel still shows
          // "failed to start". `refresh` has always cleared here; a mutation
          // has more claim to, not less.
          setError(null);
        } catch (err) {
          setError(commandErrorMessage(err));
          throw err;
        } finally {
          pendingMutations.current -= 1;
          if (pendingMutations.current === 0) setLoading(false);
        }
      });
    },
    [adopt, serialized],
  );

  // Start the bridge — the OS assigns the port and the status reports it (D9)
  const start = useCallback(
    () => runBridgeCommand(() => invoke<McpServerStatus>("mcp_bridge_start")),
    [runBridgeCommand],
  );

  // Stop the bridge
  const stop = useCallback(
    () => runBridgeCommand(() => invoke<McpServerStatus>("mcp_bridge_stop")),
    [runBridgeCommand],
  );

  // Subscribe to server events, then read the current status.
  useEffect(() => {
    let disposed = false;

    // mcp_server.rs emits the bound port with `mcp-server:started`; adopt it so
    // a bridge started elsewhere (auto-start, another window) reports its port
    // without waiting for the next refresh(). `mcp-server:stopped` carries
    // nothing, and a stopped bridge has no port (the interface says null).
    // There is no `mcp-server:sidecar-terminated` emitter anywhere in the
    // crate; a listener for it was dead code with a hardcoded English string.
    const unlistenStarted = listen<number>("mcp-server:started", (event) => {
      eventEpoch.current += 1;
      const port = portFromPayload(event.payload);
      // The event's own claim is still the freshest thing Rust has announced,
      // so `running` is adopted either way — a malformed payload is no reason
      // to report a live bridge as stopped.
      applyStatus({ running: true, port });
      setError(null);
      // …but an unusable port is not a state to sit in: ASK for the real
      // status rather than leave the panel advertising a bridge with no
      // address until something else happens to refresh (audit #749).
      if (port === null) void refresh();
    });

    const unlistenStopped = listen("mcp-server:stopped", () => {
      eventEpoch.current += 1;
      applyStatus({ running: false, port: null });
      setError(null);
    });

    // The first read waits until both subscriptions are live (audit #384):
    // `listen` resolves once Rust has registered the handler. If it rejects
    // (outside Tauri) the status is still worth fetching.
    void Promise.allSettled([unlistenStarted, unlistenStopped]).then(() => {
      if (!disposed) void refresh();
    });

    return () => {
      disposed = true;
      safeUnlistenAsync(unlistenStarted);
      safeUnlistenAsync(unlistenStopped);
    };
  }, [applyStatus, refresh]);

  return {
    running,
    port,
    loading,
    error,
    start,
    stop,
    refresh,
  };
}
