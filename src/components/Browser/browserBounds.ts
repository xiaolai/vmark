/**
 * browserBounds — one tab's `browser_set_bounds` channel (audit 2026-09-03 round 3, #167).
 *
 * Purpose: the React adapter reports the reserved rect on every resize and reflow, and
 * the driver must end up holding the LAST one. Each report used to be its own
 * fire-and-forget invoke with a fixed three-try timer, which left two holes: two rapid
 * reports could complete out of order (an older rect landing last, the native view
 * parked over unrelated UI), and a create slower than the retry budget exhausted every
 * attempt before there was a view to align. This wraps `makeSerializedPusher` —
 * latest-wins, one send in flight, retry with backoff until disposed — and HOLDS
 * reports until the tab's create has settled, so nothing is asked of the driver before
 * the view exists and the rect that finally goes out is the newest one, not the first.
 *
 * Key decisions:
 *   - Wait for creation to SETTLE, not to succeed. The hook's own create can lose to
 *     another path (an MCP open after approval creates the same tab's view), so a
 *     failed create is not "no view, ever": the report goes out and the driver's
 *     refusal is what gets retried, until the owner disposes the channel.
 *   - Held outside the pusher, not queued inside it. A send that awaited creation
 *     internally would already have snapshotted the first rect and would deliver it
 *     before any newer one — the ordering hole this exists to close.
 *   - Every failure is reported with its attempt number; the caller owns the lifetime
 *     and disposes on unmount, which ends the loop.
 *
 * @coordinates-with services/browser/serializedPusher — the retry/coalesce mechanism
 * @coordinates-with components/Browser/useBrowserNativeView — owns one per mounted tab
 * @module components/Browser/browserBounds
 */
import { invoke } from "@tauri-apps/api/core";
import { browserWarn } from "@/utils/debug";
import { makeSerializedPusher, type SerializedPusher } from "@/services/browser/serializedPusher";

/** The rect a surface reserves — the part of `getBoundingClientRect` Rust reads. */
export type BoundsRect = Pick<DOMRectReadOnly, "x" | "y" | "width" | "height">;

const noop = (): void => {};

export function makeBoundsPusher(
  tabId: string,
  nativeReady: Promise<unknown>,
  sleep?: (ms: number) => Promise<void>,
): SerializedPusher<BoundsRect> {
  const inner = makeSerializedPusher<BoundsRect>(
    (r) => invoke<void>("browser_set_bounds", { tabId, x: r.x, y: r.y, width: r.width, height: r.height }),
    (error, attempt) => {
      browserWarn("browser_set_bounds failed; retrying while the surface is mounted", { tabId, attempt, error });
    },
    sleep,
  );

  let held: BoundsRect | null = null;
  let ready = false;
  let disposed = false;
  void nativeReady.then(noop, noop).then(() => {
    ready = true;
    if (disposed || held === null) return;
    inner.push(held);
    held = null;
  });

  return {
    push: (rect) => {
      if (disposed) return;
      if (ready) inner.push(rect);
      else held = rect;
    },
    dispose: () => {
      disposed = true;
      held = null;
      inner.dispose();
    },
    isConverged: () => ready && held === null && inner.isConverged(),
  };
}
