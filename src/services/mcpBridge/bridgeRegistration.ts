/**
 * Bridge registration — keep one fact about THIS window (its workspace root,
 * its tabs) registered with the Rust bridge, which records it for the window
 * the call comes from and routes MCP requests by it.
 *
 * Key decisions:
 *   - Registers the current value on start and on every change, deduped by
 *     the last value sent (compared by `key`).
 *   - A failed registration rolls back only if it is still the latest
 *     attempt, so an older failure never invalidates a newer registration of
 *     the same value, and the next change retries.
 *   - Teardown-safe: teardown registers the cleared value, and a
 *     registration that lands after teardown is undone, so a closed window
 *     never keeps a registration.
 *
 * @coordinates-with windowWorkspaceSync.ts — the workspace root
 * @coordinates-with windowTabsSync.ts — the window's tabs
 * @module services/mcpBridge/bridgeRegistration
 */
import type { invoke as tauriInvoke } from "@tauri-apps/api/core";

/** What one registration sends, and how it learns of changes. */
export interface BridgeRegistration<T> {
  invoke: typeof tauriInvoke;
  /** The bridge command that records the value for the calling window. */
  command: string;
  /** The command's arguments for `value`. */
  args: (value: T) => Record<string, unknown>;
  /** The value that clears the registration (teardown sends it). */
  cleared: T;
  /** Equal keys are the same registration. */
  key: (value: T) => string;
  current: () => T;
  /** Calls `onValue` with each new value; returns the unsubscriber. */
  subscribe: (onValue: (value: T) => void) => () => void;
  /** Reports a failed registration (it is retried on the next change). */
  onError: (error: unknown) => void;
}

/** Start keeping the registration current; returns the disposer that clears it. */
export function startBridgeRegistration<T>(r: BridgeRegistration<T>): () => void {
  let last: string | undefined;
  // Monotonic per-attempt token so an OLDER failure can't roll back a NEWER
  // registration (register A, →B, →A again, then A's first invoke fails —
  // `last === key(A)` would wrongly clear the still-valid third A).
  let attempt = 0;
  // Set once on teardown: no new registration fires, no post-teardown
  // rollback resurrects a retry, and a registration that lands late is undone.
  let disposed = false;

  const clear = () => r.invoke(r.command, r.args(r.cleared)).catch(() => {});

  const register = (value: T) => {
    const key = r.key(value);
    if (disposed || key === last) return;
    // Advance optimistically so rapid duplicate changes dedupe without
    // waiting on the round-trip.
    last = key;
    const mine = ++attempt;
    // A single settle handler (not `.then().catch()`) keeps rollback one
    // microtask away, so a retry after a failed registration is prompt.
    void r.invoke(r.command, r.args(value)).then(
      () => {
        // Torn down while this was in flight: undo what it registered.
        if (disposed) void clear();
      },
      (error: unknown) => {
        if (!disposed && mine === attempt) last = undefined;
        r.onError(error);
      },
    );
  };

  register(r.current());
  const unsubscribe = r.subscribe(register);

  return () => {
    disposed = true;
    unsubscribe();
    void clear();
  };
}
