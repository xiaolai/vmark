/**
 * useInFlightAction — run an async action behind a SYNCHRONOUS re-entry guard.
 *
 * The breakdown mutation controls (lifecycle, judgment, anchor) each write an
 * append-only ledger entry, and each guarded it with a `busy` state flag. A
 * state flag is read stale within a render tick: two native clicks that fire
 * before React commits both see `busy === false` and both append a duplicate.
 * A `useRef` flips synchronously on the first call, so the second is refused in
 * the same tick — the only guard that actually holds for an append-only write.
 *
 * Returns `[run, busy]`: `run(fn)` starts `fn` unless one is already in flight;
 * `busy` drives disabled/spinner state. The guard clears on both resolve and
 * reject, and never sets state after unmount.
 *
 * @module components/BreakdownPanel/useInFlightAction
 */
import { useCallback, useEffect, useRef, useState } from "react";

export function useInFlightAction(): [(fn: () => Promise<unknown>) => void, boolean] {
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback((fn: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    // Call `fn` now (so the action starts this tick), but wrap it so a
    // synchronous throw still lands in `finally` and can never wedge the guard.
    let started: Promise<unknown>;
    try {
      started = Promise.resolve(fn());
    } catch (err) {
      started = Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    void started
      .catch(() => {})
      .finally(() => {
        inFlight.current = false;
        if (mounted.current) setBusy(false);
      });
  }, []);

  return [run, busy];
}
